from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import (
    CONCENTRATION_PARTS_PER_MILLION,
    PERCENTAGE,
    UnitOfPower,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities

SENSOR_SHORT_NAMES: dict[str, str] = {
    "temperature": "temp",
    "humidity": "hum",
    "co2": "co2",
    "power": "power",
}

SENSOR_TYPES: dict[str, tuple[SensorDeviceClass, str, SensorStateClass]] = {
    "temperature": (
        SensorDeviceClass.TEMPERATURE,
        UnitOfTemperature.CELSIUS,
        SensorStateClass.MEASUREMENT,
    ),
    "humidity": (
        SensorDeviceClass.HUMIDITY,
        PERCENTAGE,
        SensorStateClass.MEASUREMENT,
    ),
    "co2": (
        SensorDeviceClass.CO2,
        CONCENTRATION_PARTS_PER_MILLION,
        SensorStateClass.MEASUREMENT,
    ),
    "power": (
        SensorDeviceClass.POWER,
        UnitOfPower.WATT,
        SensorStateClass.MEASUREMENT,
    ),
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics sensors."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "sensor", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def _resolve_room(
    sensor_cfg: dict[str, Any],
    coordinator: OpenMoticsCoordinator,
    room_by_external_id: dict[str, int],
) -> int | None:
    """Resolve a sensor's room, falling back to a sibling on the same device.

    The gateway sometimes leaves room unset (255) for humidity sensors
    while correctly assigning the temperature sensor on the same physical
    device.  Use external_id to inherit the room from a sibling.
    """
    room = sensor_cfg.get("room")
    if room is not None and room in coordinator.rooms:
        return room
    ext_id = sensor_cfg.get("external_id")
    if ext_id is not None:
        return room_by_external_id.get(ext_id)
    return None


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsSensor]:
    """Create sensor entities from sensor config."""
    # Build a map of external_id -> room from sensors that have valid rooms,
    # so sensors missing a room can inherit from their sibling.
    room_by_external_id: dict[str, int] = {}
    for s in coordinator.sensors:
        ext_id = s.get("external_id")
        room = s.get("room")
        if ext_id is not None and room is not None and room in coordinator.rooms:
            room_by_external_id[ext_id] = room

    entities: list[OpenMoticsSensor] = []
    for sensor_cfg in coordinator.sensors:
        if not sensor_cfg.get("name"):
            continue
        physical_quantity = sensor_cfg.get("physical_quantity", "")
        # Skip quantities we don't have a device class for.
        if physical_quantity not in SENSOR_TYPES:
            continue
        room_id = _resolve_room(sensor_cfg, coordinator, room_by_external_id)
        naming = coordinator.resolve_entity_naming(
            sensor_cfg["name"], room_id,
            f"sensor_{physical_quantity}", sensor_cfg["id"], "sensor",
            entity_id_prefix=SENSOR_SHORT_NAMES[physical_quantity],
        )
        entities.append(
            OpenMoticsSensor(
                coordinator=coordinator,
                naming=naming,
                sensor_id=sensor_cfg["id"],
                physical_quantity=physical_quantity,
                room_id=room_id,
            )
        )

    # Valve position (steering_power) per thermostat, push-updated via
    # THERMOSTAT_CHANGE. The gateway drives 0-10V valves proportionally;
    # this exposes the computed valve position in %.
    for thermostat in coordinator.thermostats:
        if not thermostat.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            thermostat["name"],
            thermostat.get("room"),
            "valve",
            thermostat["id"],
            "sensor",
            entity_id_prefix="valve",
        )
        entities.append(
            OpenMoticsValveSensor(
                coordinator=coordinator,
                naming=naming,
                thermostat_id=thermostat["id"],
                room_id=thermostat.get("room"),
            )
        )
    return entities


class OpenMoticsSensor(OpenMoticsEntity, SensorEntity):
    """An OpenMotics sensor entity."""

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        sensor_id: int,
        physical_quantity: str,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._sensor_id = sensor_id
        self._ws_change_type = "SENSOR_CHANGE"
        self._om_id = sensor_id
        device_class, unit, state_class = SENSOR_TYPES[physical_quantity]
        self._attr_device_class = device_class
        self._attr_native_unit_of_measurement = unit
        self._attr_state_class = state_class

    @property
    def native_value(self) -> float | None:
        return self.coordinator.get_sensor_value(self._sensor_id)


class OpenMoticsValveSensor(OpenMoticsEntity, SensorEntity):
    """Valve position (steering_power %) of an OpenMotics thermostat."""

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
        self._attr_native_unit_of_measurement = PERCENTAGE
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_icon = "mdi:valve"

    @property
    def native_value(self) -> float | None:
        status = self.coordinator.get_thermostat_state(self._thermostat_id)
        if status is None:
            return None
        value = status.get("steering_power")
        if value is None:
            return None
        return float(value)
