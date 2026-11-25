from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

import aiohttp

from .api import REQUEST_TIMEOUT, OpenMoticsClient, OpenMoticsError

_LOGGER = logging.getLogger(__name__)
_WS_LOGGER = logging.getLogger("custom_components.renson_smartliving.ws")

RECONNECT_TIMEOUT = 5
INITIAL_BACKOFF = 10
MAX_BACKOFF = 300
BACKOFF_FACTOR = 2
CONFIG_PHASE_TIMEOUT = 30

EXPECTED_CONTROL_EVENTS = {
    "OUTPUT_CONTROL",
    "SENSOR_CONTROL",
    "SHUTTER_CONTROL",
    "ROOM_CONTROL",
    "GROUP_ACTION_CONTROL",
    "PLATFORM_DETAILS",
}

# V2 (CLASSIC) gateways don't emit VERSION over WebSocket;
# fetched via REST fallback in _sync() when missing.
OPTIONAL_CONTROL_EVENTS = {
    "VERSION",
}

CHANGE_EVENTS = {
    "OUTPUT_CHANGE",
    "INPUT_CHANGE",
    "SENSOR_CHANGE",
    "SHUTTER_CHANGE",
    "THERMOSTAT_CHANGE",
}


class SyncLoop:
    """Manages the full sync lifecycle for one OpenMotics gateway.

    Login → WebSocket config collection → entity CRUD →
    initial state → replay buffered changes → active.
    """

    def __init__(
        self,
        client: OpenMoticsClient,
        on_config: Callable[[dict[str, Any]], None],
        on_full_update: Callable[[dict[str, Any]], None],
        on_event: Callable[[dict[str, Any]], None],
        on_availability_change: Callable[[bool], None] | None = None,
    ) -> None:
        self._client = client
        self._on_config = on_config
        self._on_full_update = on_full_update
        self._on_event = on_event
        self._on_availability_change = on_availability_change
        self._backoff: float = INITIAL_BACKOFF
        self._sync_active: bool = False
        self._available: bool = False
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        """Start the sync loop as a background task."""
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Cancel the sync loop and wait for it to finish."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._client.close()

    def _set_available(self, available: bool) -> None:
        if self._available == available:
            return
        self._available = available
        if self._on_availability_change is not None:
            self._on_availability_change(available)

    async def _run(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await self._sync()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if not self._sync_active:
                    self._set_available(False)
                elapsed = time.monotonic() - started
                remaining = max(0, self._backoff - elapsed)
                if isinstance(
                    exc,
                    (
                        ConnectionError,
                        TimeoutError,
                        OpenMoticsError,
                        aiohttp.ClientError,
                    ),
                ):
                    reason = str(exc) or type(exc).__name__
                    _LOGGER.error(
                        "Sync failed for %s: %s",
                        self._client.host,
                        reason,
                    )
                else:
                    _LOGGER.exception(
                        "Sync failed for %s",
                        self._client.host,
                    )
                if remaining > 0:
                    _LOGGER.info(
                        "Retrying %s in %ds",
                        self._client.host,
                        remaining,
                    )
                    await asyncio.sleep(remaining)

    async def _sync(self) -> None:
        self._sync_active = False
        self._client.reset_session()

        login_timeout = RECONNECT_TIMEOUT if self._available else None
        _LOGGER.info(
            "Connecting to %s (timeout: %ds)",
            self._client.host,
            login_timeout or REQUEST_TIMEOUT,
        )
        try:
            await self._client.login(timeout=login_timeout)
        except Exception:
            self._backoff = min(self._backoff * BACKOFF_FACTOR, MAX_BACKOFF)
            raise
        self._backoff = INITIAL_BACKOFF
        ws = await self._client.connect_events()
        _LOGGER.info("Connected to %s, syncing state", self._client.host)

        try:
            use_rest_config = False
            try:
                await self._client.trigger_sync()
            except OpenMoticsError as exc:
                if exc.status != 404:
                    raise
                # Firmware without the sync control API (e.g.
                # OpenMotics CORE 3.9.9) never emits *_CONTROL
                # events over the websocket. Collect the
                # configuration via legacy REST endpoints instead.
                use_rest_config = True
                _LOGGER.info(
                    "Gateway %s has no sync control API, "
                    "using REST configuration fallback",
                    self._client.host,
                )

            if use_rest_config:
                config = await self._collect_config_rest()
                buffered: list[dict[str, Any]] = []
            else:
                # Collect config, buffer change events
                config, buffered = await self._collect_config(ws)
            _LOGGER.info(
                "Retrieved configuration from %s: %s",
                self._client.host,
                {
                    k: len(v) if isinstance(v, list) else "obj"
                    for k, v in config.items()
                },
            )

            if "VERSION" not in config:
                v = await self._client.get_version()
                config["VERSION"] = {
                    "gateway": v.get("gateway", ""),
                    "master": v.get("master", ""),
                }

            # WS INPUT_CONTROL only includes in_use inputs; fetch via
            # REST to also include inputs not in_use on the gateway,
            # as the user may want to use them for HA automations.
            config["INPUT_CONTROL"] = (
                await self._client.get_input_configurations()
            )

            # Entity/room CRUD
            self._on_config(config)

            # Current state
            output_status = await self._client.get_output_status()
            shutter_status = await self._client.get_shutter_status()
            config["output_status"] = output_status
            config["shutter_status"] = shutter_status
            # Thermostats (V1 API): the control list holds both the
            # configuration (name, room) and the current status.
            try:
                config["thermostat_status"] = (
                    await self._client.get_thermostat_control()
                )
            except OpenMoticsError:
                # Older firmware without the V1 thermostat API.
                _LOGGER.warning(
                    "Gateway %s has no V1 thermostat API, "
                    "climate entities are not created",
                    self._client.host,
                )
                config["thermostat_status"] = []
            self._on_full_update(config)

        except BaseException:
            await ws.close()
            raise

        try:
            # Replay buffered change events
            for event in buffered:
                self._on_event(event)
            if buffered:
                _LOGGER.info(
                    "Replayed %d buffered events for %s",
                    len(buffered),
                    self._client.host,
                )

            # Setup complete — mark entities available.
            self._sync_active = True
            self._set_available(True)
            # Process events in real-time
            await self._active_phase(ws)
        finally:
            await ws.close()

    async def _collect_config_rest(self) -> dict[str, Any]:
        """Collect the configuration via legacy REST endpoints.

        Used on firmware that has no sync control API and therefore
        never pushes *_CONTROL events over the websocket.
        """
        client = self._client
        config: dict[str, Any] = {
            "OUTPUT_CONTROL": await client.get_output_configurations(),
            "SHUTTER_CONTROL": await client.get_shutter_configurations(),
            "SENSOR_CONTROL": await client.get_sensor_configurations(),
            "ROOM_CONTROL": await client.get_room_configurations(),
            "GROUP_ACTION_CONTROL": (
                await client.get_group_action_configurations()
            ),
            "PLATFORM_DETAILS": await client.get_platform_details(),
        }
        v = await client.get_version()
        config["VERSION"] = {
            "gateway": v.get("gateway", ""),
            "master": v.get("master", ""),
        }
        return config

    async def _collect_config(
        self, ws: aiohttp.ClientWebSocketResponse
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        config: dict[str, Any] = {}
        buffered: list[dict[str, Any]] = []
        received: set[str] = set()

        try:
            async with asyncio.timeout(CONFIG_PHASE_TIMEOUT):
                async for msg in ws:
                    if msg.type not in (
                        aiohttp.WSMsgType.TEXT,
                        aiohttp.WSMsgType.BINARY,
                    ):
                        if msg.type == aiohttp.WSMsgType.ERROR:
                            raise ConnectionError(
                                f"WebSocket error: {ws.exception()}"
                            )
                        raise ConnectionError("WebSocket closed during config phase")

                    event = msg.json()
                    _WS_LOGGER.debug("WS <- %s", event)
                    event_type = event.get("type", "")

                    if event_type in EXPECTED_CONTROL_EVENTS | OPTIONAL_CONTROL_EVENTS:
                        data = event.get("data", {})
                        config[event_type] = data.get("control", data)
                        received.add(event_type)
                        if received >= EXPECTED_CONTROL_EVENTS:
                            return config, buffered

                    elif event_type in CHANGE_EVENTS:
                        buffered.append(event)

            raise ConnectionError("WebSocket closed during config phase")

        except TimeoutError:
            missing = EXPECTED_CONTROL_EVENTS - received
            raise ConnectionError(
                f"Config phase timed out for {self._client.host},"
                f" missing: {missing}"
            ) from None

    async def _active_phase(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        _LOGGER.info("Synchronizing state with %s", self._client.host)
        async for msg in ws:
            if msg.type in (aiohttp.WSMsgType.TEXT, aiohttp.WSMsgType.BINARY):
                event = msg.json()
                _WS_LOGGER.debug("WS <- %s", event)
                event_type = event.get("type", "")

                if event_type in CHANGE_EVENTS:
                    self._on_event(event)

            elif msg.type == aiohttp.WSMsgType.ERROR:
                raise ConnectionError(f"WebSocket error: {ws.exception()}")
            elif msg.type in (
                aiohttp.WSMsgType.CLOSE,
                aiohttp.WSMsgType.CLOSING,
                aiohttp.WSMsgType.CLOSED,
            ):
                _LOGGER.warning("WebSocket closed by %s", self._client.host)
                return
