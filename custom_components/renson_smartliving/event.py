from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .coordinator import SIGNAL_CONFIG_LOADED, EntityNaming, OpenMoticsCoordinator
from .entity import OpenMoticsEntity, remove_stale_entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics events (input press/release)."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "event", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, SIGNAL_CONFIG_LOADED, _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsEvent]:
    """Create event entities from input config."""
    entities: list[OpenMoticsEvent] = []
    for inp in coordinator.inputs:
        if not inp.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            inp["name"], inp.get("room"), "input", inp["id"], "event"
        )
        entities.append(
            OpenMoticsEvent(
                coordinator=coordinator,
                naming=naming,
                input_id=inp["id"],
                room_id=inp.get("room"),
            )
        )
    return entities


class OpenMoticsEvent(OpenMoticsEntity, EventEntity):
    """An OpenMotics event (input) entity."""

    _attr_event_types = ["press", "release"]

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        input_id: int,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._input_id = input_id
        self._ws_change_type = "INPUT_CHANGE"
        self._om_id = input_id

    @callback
    def _handle_om_event(self, pressed: bool) -> None:
        self._trigger_event("press" if pressed else "release")
        self.async_write_ha_state()
