from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

import aiohttp

from .api import OpenMoticsClient

_LOGGER = logging.getLogger(__name__)
_WS_LOGGER = logging.getLogger("custom_components.renson_smartliving.ws")

INITIAL_BACKOFF = 5
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
}


class SyncLoop:
    """Manages the full sync lifecycle for one OpenMotics gateway.

    Phases: login → WebSocket config collection → entity CRUD →
    initial state → replay buffered changes → active phase.
    """

    def __init__(
        self,
        client: OpenMoticsClient,
        on_config: Callable[[dict[str, Any]], None],
        on_full_update: Callable[[dict[str, Any]], None],
        on_event: Callable[[dict[str, Any]], None],
    ) -> None:
        self._client = client
        self._on_config = on_config
        self._on_full_update = on_full_update
        self._on_event = on_event
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

    async def _run(self) -> None:
        backoff = INITIAL_BACKOFF
        while True:
            try:
                await self._sync()
                backoff = INITIAL_BACKOFF
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.exception(
                    "Sync failed for %s, retrying in %ds",
                    self._client.host,
                    backoff,
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * BACKOFF_FACTOR, MAX_BACKOFF)

    async def _sync(self) -> None:
        _LOGGER.info("Connecting to %s", self._client.host)

        await self._client.login()
        ws = await self._client.connect_events()

        try:
            await self._client.trigger_sync()

            # Phase 1: collect config, buffer change events
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

            # Phase 2: entity/room CRUD
            self._on_config(config)

            # Phase 3: initial state
            output_status = await self._client.get_output_status()
            shutter_status = await self._client.get_shutter_status()
            config["output_status"] = output_status
            config["shutter_status"] = shutter_status
            self._on_full_update(config)

            # Phase 4: replay buffered change events
            for event in buffered:
                self._on_event(event)
            if buffered:
                _LOGGER.info(
                    "Replayed %d buffered events for %s",
                    len(buffered),
                    self._client.host,
                )

            # Phase 5: active — process events in real-time
            await self._active_phase(ws)
        finally:
            await ws.close()

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
