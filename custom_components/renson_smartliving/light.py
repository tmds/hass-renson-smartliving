from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.light import ATTR_BRIGHTNESS, ColorMode, LightEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util.color import brightness_to_value, value_to_brightness

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .const import CONF_MIN_DIM_LEVELS, OUTPUT_TYPE_LIGHT, parse_min_dim_levels
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities

_SCALE = (1, 100)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics lights."""
    coordinator = entry.runtime_data.coordinator
    min_dim_levels = parse_min_dim_levels(
        entry.options.get(CONF_MIN_DIM_LEVELS, "")
    )

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator, min_dim_levels)
        remove_stale_entities(hass, entry, "light", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
    min_dim_levels: dict[int, int] | None = None,
) -> list[OpenMoticsLight]:
    """Create light entities from output config."""
    min_dim_levels = min_dim_levels or {}
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
                min_dim=min_dim_levels.get(output["id"], 0),
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
        min_dim: int = 0,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._output_id = output_id
        self._min_dim = min_dim
        self._ws_change_type = "OUTPUT_CHANGE"
        self._om_id = output_id
        self._attr_color_mode = (
            ColorMode.BRIGHTNESS if supports_brightness else ColorMode.ONOFF
        )
        self._attr_supported_color_modes = {self._attr_color_mode}

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the configured minimum dim level for UI cards."""
        return {"min_dim": self._min_dim}

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
        dimmer = state.get("dimmer", 0)
        slider_pct = self._dimmer_to_slider(dimmer)
        if slider_pct <= 0:
            return 0
        return value_to_brightness(_SCALE, slider_pct)

    def _slider_to_dimmer(self, slider_pct: int) -> int:
        """Map slider 0-100% to the OM dimmer value."""
        slider_pct = max(0, min(100, slider_pct))
        if not self._min_dim:
            return slider_pct
        if slider_pct <= 0:
            return 0
        lo = self._min_dim
        return round(lo + (slider_pct - 1) * (100 - lo) / 99)

    def _dimmer_to_slider(self, dimmer_pct: int) -> int:
        """Map the OM dimmer value back to slider 1-100%."""
        if not self._min_dim:
            return dimmer_pct
        lo = self._min_dim
        if lo >= 100:
            return 100
        if dimmer_pct <= lo:
            return 1
        return round(1 + (dimmer_pct - lo) * 99 / (100 - lo))

    async def async_turn_on(self, **kwargs: Any) -> None:
        dimmer: int | None = None
        if ATTR_BRIGHTNESS in kwargs:
            slider_pct = round(brightness_to_value(_SCALE, kwargs[ATTR_BRIGHTNESS]))
            dimmer = self._slider_to_dimmer(slider_pct)
        elif self._min_dim:
            # Plain "on" reuses the last dimmer value on the gateway. When
            # that value sits below the driver floor the lamp comes on dark,
            # so force the configured minimum instead.
            state = self.coordinator.get_output_state(self._output_id)
            if state is not None and state["dimmer"] < self._min_dim:
                dimmer = self._min_dim
        await self.coordinator.client.set_output(
            self._output_id, is_on=True, dimmer=dimmer
        )

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.client.set_output(
            self._output_id, is_on=False
        )
