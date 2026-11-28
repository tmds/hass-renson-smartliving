from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import TYPE_CHECKING, Any

from homeassistant.components.cover import (
    ATTR_POSITION,
    CoverDeviceClass,
    CoverEntity,
    CoverEntityFeature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities

_GOTO_FALLBACK_TRAVEL = 30.0  # seconden wanneer geen rijtimer geconfigureerd is


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics covers (shutters)."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "cover", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsCover]:
    """Create cover entities from shutter config."""
    entities: list[OpenMoticsCover] = []
    for shutter in coordinator.shutters:
        if not shutter.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            shutter["name"], shutter.get("room"), "cover", shutter["id"], "cover"
        )
        entities.append(
            OpenMoticsCover(
                coordinator=coordinator,
                naming=naming,
                shutter_id=shutter["id"],
                room_id=shutter.get("room"),
            )
        )
    return entities


class OpenMoticsCover(OpenMoticsEntity, CoverEntity):
    """An OpenMotics cover (shutter) entity."""

    _attr_device_class = CoverDeviceClass.SHUTTER
    _attr_supported_features = (
        CoverEntityFeature.OPEN
        | CoverEntityFeature.CLOSE
        | CoverEntityFeature.STOP
        | CoverEntityFeature.SET_POSITION
    )

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        shutter_id: int,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._shutter_id = shutter_id
        self._ws_change_type = "SHUTTER_CHANGE"
        self._om_id = shutter_id
        self._goto_task: asyncio.Task[None] | None = None
        # actieve beweging, om tussentijds een geschatte positie te tonen:
        # {"start_om", "target_om", "duration", "started"}
        self._goto_motion: dict[str, float] | None = None

    @property
    def current_cover_position(self) -> int | None:
        motion = self._goto_motion
        if motion is not None:
            # de gateway pusht geen posities tijdens het rijden; toon de
            # geschatte positie op basis van verstreken rijtijd
            duration = motion["duration"]
            frac = (
                1.0
                if duration <= 0
                else min(
                    1.0,
                    (asyncio.get_running_loop().time() - motion["started"]) / duration,
                )
            )
            om = motion["start_om"] + (motion["target_om"] - motion["start_om"]) * frac
            return int(round((99 - om) * 100 / 99))
        state = self.coordinator.get_shutter_state(self._shutter_id)
        if state is None or state["position"] is None:
            return None
        # OM: 0=open, 99=closed (100 steps). HA: 100=open, 0=closed (101 values).
        return int(round((99 - state["position"]) * 100 / 99))

    @property
    def is_opening(self) -> bool:
        state = self.coordinator.get_shutter_state(self._shutter_id)
        return state is not None and state["state"] == "GOING_UP"

    @property
    def is_closing(self) -> bool:
        state = self.coordinator.get_shutter_state(self._shutter_id)
        return state is not None and state["state"] == "GOING_DOWN"

    @property
    def is_closed(self) -> bool | None:
        pos = self.current_cover_position
        if pos is None:
            return None
        return pos == 0

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the travel timers used by the position emulation."""
        config = self._shutter_config() or {}
        return {
            "timer_up": config.get("timer_up"),
            "timer_down": config.get("timer_down"),
        }

    async def async_open_cover(self, **kwargs: Any) -> None:
        self._cancel_goto()
        await self.coordinator.client.shutter_up(self._shutter_id)

    async def async_close_cover(self, **kwargs: Any) -> None:
        self._cancel_goto()
        await self.coordinator.client.shutter_down(self._shutter_id)

    async def async_stop_cover(self, **kwargs: Any) -> None:
        # het goto-taakje stopt zelf in zijn finally; dubbel stoppen is onschadelijk
        self._cancel_goto()
        await self.coordinator.client.shutter_stop(self._shutter_id)

    async def async_set_cover_position(self, **kwargs: Any) -> None:
        """Move the shutter to an absolute position (time-based emulation).

        The gateway (fw 3.9.9) has no do_shutter_goto support
        ("Shutter timers are not supported") and does not push position
        updates while the shutter travels. So: start up/down and stop
        after the estimated travel time (configured travel timer scaled
        by the requested distance). HA: 100 = open, 0 = closed.
        OM: 0 = open, 99 = closed.
        """
        target = max(0, min(100, int(kwargs[ATTR_POSITION])))
        state = self.coordinator.get_shutter_state(self._shutter_id)
        if state is None or state.get("position") is None:
            raise HomeAssistantError(
                f"Position of {self.entity_id} is unknown; fully open or "
                "close the shutter once to calibrate"
            )
        self._cancel_goto()
        self._goto_task = asyncio.create_task(self._goto_position(target))

    def _cancel_goto(self) -> None:
        if self._goto_task is not None and not self._goto_task.done():
            self._goto_task.cancel()
        self._goto_task = None

    def _shutter_config(self) -> dict[str, Any] | None:
        for shutter in self.coordinator.shutters:
            if shutter.get("id") == self._shutter_id:
                return shutter
        return None

    async def _goto_position(self, target: int) -> None:
        """Drive the shutter to target and stop; runs as background task.

        Purely time-based: the gateway does not report intermediate
        positions while the motor moves, so the stop moment is computed
        from the configured travel timer scaled by the travel distance.
        """
        om_target = round(99 - target * 99 / 100)
        state = self.coordinator.get_shutter_state(self._shutter_id)
        om_current = state["position"] if state else 0
        if om_target == om_current:
            return
        going_up = om_target < om_current  # OM: 0 = fully open
        config = self._shutter_config() or {}
        travel = config.get("timer_up" if going_up else "timer_down")
        if not travel or travel == 255:
            travel = _GOTO_FALLBACK_TRAVEL
        # schaal de volledige rijtijd op de af te leggen afstand
        duration = float(travel) * abs(om_target - om_current) / 99
        client = self.coordinator.client
        self._goto_motion = {
            "start_om": om_current,
            "target_om": om_target,
            "duration": duration,
            "started": asyncio.get_running_loop().time(),
        }
        try:
            if going_up:
                await client.shutter_up(self._shutter_id)
            else:
                await client.shutter_down(self._shutter_id)
            await asyncio.sleep(duration)
        finally:
            self._goto_motion = None
            with suppress(Exception):
                await client.shutter_stop(self._shutter_id)
