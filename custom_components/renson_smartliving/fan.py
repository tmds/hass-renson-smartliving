from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.fan import FanEntity, FanEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .const import OUTPUT_TYPE_LIGHT, OUTPUT_TYPE_SHUTTER_RELAY
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics fans."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "fan", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsFan]:
    """Create fan entities from output config (dimmer, non-light)."""
    entities: list[OpenMoticsFan] = []
    for output in coordinator.outputs:
        output_type = output.get("type")
        # module_type "D" = dimmer output not assigned as a light — treat as fan.
        if output_type in (OUTPUT_TYPE_SHUTTER_RELAY, OUTPUT_TYPE_LIGHT):
            continue
        if output.get("module_type") != "D":
            continue
        if not output.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            output["name"], output.get("room"), "fan", output["id"], "fan"
        )
        entities.append(
            OpenMoticsFan(
                coordinator=coordinator,
                naming=naming,
                output_id=output["id"],
                room_id=output.get("room"),
            )
        )
    return entities


class OpenMoticsFan(OpenMoticsEntity, FanEntity):
    """An OpenMotics fan (dimmer non-light output) entity."""

    _attr_supported_features = (
        FanEntityFeature.SET_SPEED
        | FanEntityFeature.TURN_ON
        | FanEntityFeature.TURN_OFF
    )
    _attr_speed_count = 100

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        output_id: int,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._output_id = output_id
        self._ws_change_type = "OUTPUT_CHANGE"
        self._om_id = output_id

    @property
    def is_on(self) -> bool | None:
        state = self.coordinator.get_output_state(self._output_id)
        if state is None:
            return None
        return state["on"]

    @property
    def percentage(self) -> int | None:
        state = self.coordinator.get_output_state(self._output_id)
        if state is None:
            return None
        return state["dimmer"]

    async def async_set_percentage(self, percentage: int) -> None:
        await self.coordinator.client.set_output(
            self._output_id, is_on=percentage > 0, dimmer=percentage
        )

    async def async_turn_on(
        self,
        percentage: int | None = None,
        preset_mode: str | None = None,
        **kwargs: Any,
    ) -> None:
        await self.coordinator.client.set_output(
            self._output_id, is_on=True, dimmer=percentage
        )

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.client.set_output(
            self._output_id, is_on=False
        )
