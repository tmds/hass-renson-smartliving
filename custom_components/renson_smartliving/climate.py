from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from homeassistant.components.climate import (
    PRESET_AWAY,
    PRESET_BOOST,
    PRESET_NONE,
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .const import (
    DEFAULT_PRESET_EXPIRATION_HOURS,
    DOMAIN,
    PRESET_AUTO,
    THERMOSTAT_MAX_TEMP,
    THERMOSTAT_MIN_TEMP,
)
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities

# Gateway active_preset values (lowercase) mapped to HA presets.
_PRESET_TO_OM = {
    PRESET_AUTO: "auto",
    PRESET_AWAY: "away",
    PRESET_BOOST: "party",
    PRESET_NONE: "manual",
}
_OM_PRESET_TO_HA = {
    "auto": PRESET_AUTO,
    "away": PRESET_AWAY,
    "party": PRESET_BOOST,
    "manual": PRESET_NONE,
    # A setpoint write without explicit preset is reported as
    # "override" by the gateway: a manual, temporary or permanent
    # setpoint override of the schedule.
    "override": PRESET_NONE,
}

def time_to_seconds(value: Any) -> int:
    """Convert an HH:MM(:SS) time string or time object to seconds."""
    if isinstance(value, time):
        return value.hour * 3600 + value.minute * 60 + value.second
    parts = str(value).split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"Invalid time: {value}")
    hours, minutes = int(parts[0]), int(parts[1])
    seconds = int(parts[2]) if len(parts) == 3 else 0
    if not (0 <= hours < 24 and 0 <= minutes < 60 and 0 <= seconds < 60):
        raise ValueError(f"Invalid time: {value}")
    return hours * 3600 + minutes * 60 + seconds


def seconds_to_time(value: int) -> str:
    """Convert seconds since midnight to an HH:MM string."""
    value = int(value)
    return f"{value // 3600:02d}:{(value % 3600) // 60:02d}"


def format_schedule(schedule: dict[str, Any] | None) -> dict[str, Any] | None:
    """Render a gateway schedule (seconds keys) as HH:MM keys."""
    if not isinstance(schedule, dict):
        return None
    return {
        day: {
            seconds_to_time(int(t)): temp
            for t, temp in day_schedule.items()
        }
        for day, day_schedule in schedule.items()
    }


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics climates (thermostats)."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "climate", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsClimate]:
    """Create climate entities from the thermostat control list."""
    entities: list[OpenMoticsClimate] = []
    for thermostat in coordinator.thermostats:
        if not thermostat.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            thermostat["name"],
            thermostat.get("room"),
            "thermostat",
            thermostat["id"],
            "climate",
        )
        entities.append(
            OpenMoticsClimate(
                coordinator=coordinator,
                naming=naming,
                thermostat_id=thermostat["id"],
                room_id=thermostat.get("room"),
            )
        )
    return entities


class OpenMoticsClimate(OpenMoticsEntity, ClimateEntity):
    """An OpenMotics thermostat entity."""

    _attr_hvac_modes = [HVACMode.OFF, HVACMode.HEAT]
    _attr_max_temp = THERMOSTAT_MAX_TEMP
    _attr_min_temp = THERMOSTAT_MIN_TEMP
    _attr_preset_modes = [
        PRESET_NONE,
        PRESET_AUTO,
        PRESET_AWAY,
        PRESET_BOOST,
    ]
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.PRESET_MODE
        | ClimateEntityFeature.TURN_OFF
        | ClimateEntityFeature.TURN_ON
    )
    _attr_target_temperature_step = 0.5
    _attr_temperature_unit = UnitOfTemperature.CELSIUS

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        thermostat_id: int,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._thermostat_id = thermostat_id
        self._ws_change_type = "THERMOSTAT_CHANGE"
        self._om_id = thermostat_id

    @property
    def thermostat_id(self) -> int:
        """The OpenMotics thermostat id."""
        return self._thermostat_id

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        registry: dict[str, Any] = self.hass.data.setdefault(DOMAIN, {})
        entities: dict[str, Any] = registry.setdefault("climate_entities", {})
        entities[self.entity_id] = self

    async def async_will_remove_from_hass(self) -> None:
        await super().async_will_remove_from_hass()
        registry = self.hass.data.get(DOMAIN, {})
        entities: dict[str, Any] = registry.get("climate_entities", {})
        entities.pop(self.entity_id, None)

    def _thermostat_config(self) -> dict[str, Any] | None:
        """Return the full control-list entry (config + status)."""
        for thermostat in self.coordinator.thermostats:
            if thermostat.get("id") == self._thermostat_id:
                return thermostat
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Expose the schedule configuration for dashboards and services."""
        config = self._thermostat_config()
        if config is None:
            return None
        return {
            "heating_schedule": format_schedule(
                config.get("heating_schedule")
            ),
            "away_temperature": config.get("away_heating"),
            "lead_time": config.get("early_heating"),
        }

    def _status(self) -> dict[str, Any] | None:
        return self.coordinator.get_thermostat_state(self._thermostat_id)

    @property
    def current_temperature(self) -> float | None:
        status = self._status()
        if status is None:
            return None
        return status.get("current_temperature")

    @property
    def target_temperature(self) -> float | None:
        status = self._status()
        if status is None:
            return None
        return status.get("current_setpoint")

    @property
    def hvac_mode(self) -> HVACMode | None:
        status = self._status()
        if status is None:
            return None
        if str(status.get("state", "")).lower() == "off":
            return HVACMode.OFF
        return HVACMode.HEAT

    @property
    def hvac_action(self) -> HVACAction | None:
        status = self._status()
        if status is None:
            return None
        if str(status.get("state", "")).lower() == "off":
            return HVACAction.OFF
        if float(status.get("steering_power") or 0) > 0:
            return HVACAction.HEATING
        return HVACAction.IDLE

    @property
    def preset_mode(self) -> str | None:
        status = self._status()
        if status is None:
            return None
        preset = str(status.get("active_preset", "")).lower()
        return _OM_PRESET_TO_HA.get(preset)

    async def async_set_temperature(self, **kwargs: Any) -> None:
        """Set a new target setpoint.

        The change is applied as a temporary override that expires
        after a configurable number of hours (default 2, matching the
        old Homebridge behavior), after which the schedule resumes.
        """
        target = kwargs.get("temperature")
        if target is None:
            return
        expiration_hours = self.coordinator.entry.options.get(
            "preset_expiration_hours", DEFAULT_PRESET_EXPIRATION_HOURS
        )
        payload: dict[str, Any] = {"setpoint": float(target)}
        if expiration_hours:
            try:
                tz_name = await self.coordinator.client.get_timezone()
                gw_tz = ZoneInfo(tz_name)
            except Exception:
                gw_tz = None
            expires = datetime.now(gw_tz) + timedelta(hours=float(expiration_hours))
            payload["preset_expiration"] = expires.replace(tzinfo=None).isoformat()
        await self.coordinator.client.set_thermostat_control(
            self._thermostat_id, payload
        )

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        payload: dict[str, Any] = {
            "state": "on" if hvac_mode == HVACMode.HEAT else "off"
        }
        await self.coordinator.client.set_thermostat_control(
            self._thermostat_id, payload
        )

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Switch the thermostat preset.

        Setting AUTO restores the heating schedule; switching away
        from AUTO applies the preset without expiration.
        """
        om_preset = _PRESET_TO_OM[preset_mode]
        payload: dict[str, Any] = {"active_preset": om_preset}
        if om_preset != "auto":
            payload["preset_expiration"] = None
        await self.coordinator.client.set_thermostat_control(
            self._thermostat_id, payload
        )
