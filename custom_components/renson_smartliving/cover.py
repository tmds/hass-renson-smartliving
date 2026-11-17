from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.cover import (
    ATTR_POSITION,
    CoverDeviceClass,
    CoverEntity,
    CoverEntityFeature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities


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

    @property
    def current_cover_position(self) -> int | None:
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

    async def async_open_cover(self, **kwargs: Any) -> None:
        await self.coordinator.client.shutter_up(self._shutter_id)

    async def async_close_cover(self, **kwargs: Any) -> None:
        await self.coordinator.client.shutter_down(self._shutter_id)

    async def async_stop_cover(self, **kwargs: Any) -> None:
        await self.coordinator.client.shutter_stop(self._shutter_id)

    async def async_set_cover_position(self, **kwargs: Any) -> None:
        """Set the shutter to an absolute position.

        HA: 100 = fully open, 0 = fully closed.
        OM: 0 = fully open, 99 = fully closed.
        Inverse of current_cover_position: om = round(99 - ha * 99 / 100).
        """
        position = kwargs[ATTR_POSITION]
        om_position = round(99 - max(0, min(100, position)) * 99 / 100)
        await self.coordinator.client.shutter_goto(self._shutter_id, om_position)
