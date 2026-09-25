from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.light import ATTR_BRIGHTNESS, ColorMode, LightEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .const import OUTPUT_TYPE_LIGHT
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics lights."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "light", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsLight]:
    """Create light entities from output config."""
    entities: list[OpenMoticsLight] = []
    for output in coordinator.outputs:
        # type 255 = light; other types are shutter relays, ...
        if output.get("type") != OUTPUT_TYPE_LIGHT:
            continue
        if not output.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            output["name"], output.get("room"), "light", output["id"], "light"
        )
        entities.append(
            OpenMoticsLight(
                coordinator=coordinator,
                naming=naming,
                output_id=output["id"],
                supports_brightness=output.get("module_type") == "D",
                room_id=output.get("room"),
            )
        )
    return entities


class OpenMoticsLight(OpenMoticsEntity, LightEntity):
    """An OpenMotics light entity."""

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        output_id: int,
        supports_brightness: bool,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._output_id = output_id
        self._ws_change_type = "OUTPUT_CHANGE"
        self._om_id = output_id
        self._attr_color_mode = (
            ColorMode.BRIGHTNESS if supports_brightness else ColorMode.ONOFF
        )
        self._attr_supported_color_modes = {self._attr_color_mode}

    @property
    def is_on(self) -> bool | None:
        state = self.coordinator.get_output_state(self._output_id)
        if state is None:
            return None
        return state["on"]

    @property
    def brightness(self) -> int | None:
        state = self.coordinator.get_output_state(self._output_id)
        if state is None:
            return None
        # OM: 0-100 dimmer percentage. HA: 0-255 brightness.
        return round(state["dimmer"] * 255 / 100)

    async def async_turn_on(self, **kwargs: Any) -> None:
        dimmer = None
        if ATTR_BRIGHTNESS in kwargs:
            dimmer = round(kwargs[ATTR_BRIGHTNESS] * 100 / 255)
        await self.coordinator.client.set_output(
            self._output_id, is_on=True, dimmer=dimmer
        )

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.client.set_output(
            self._output_id, is_on=False
        )
