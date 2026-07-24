from __future__ import annotations

from homeassistant.components.light import ColorMode

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.cover import (
    create_entities as cover_create,
)
from custom_components.renson_smartliving.event import (
    create_entities as event_create,
)
from custom_components.renson_smartliving.fan import (
    create_entities as fan_create,
)
from custom_components.renson_smartliving.light import (
    create_entities as light_create,
)
from custom_components.renson_smartliving.sensor import (
    create_entities as sensor_create,
)
from custom_components.renson_smartliving.switch import (
    create_entities as switch_create,
)


async def test_light_creates_only_type_255(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.outputs = [
        {"id": 0, "name": "Lamp", "type": 255, "module_type": "D", "room": 1},
        {"id": 1, "name": "Relay", "type": 0, "module_type": "O", "room": 1},
        {"id": 2, "name": "Shutter", "type": 127, "module_type": "O", "room": 1},
    ]
    entities = light_create(coordinator)
    assert len(entities) == 1
    assert entities[0]._output_id == 0


async def test_light_skips_unnamed(coordinator: OpenMoticsCoordinator) -> None:
    coordinator.outputs = [
        {"id": 0, "name": "", "type": 255, "module_type": "D", "room": 1},
        {"id": 1, "name": "Named", "type": 255, "module_type": "D", "room": 1},
    ]
    entities = light_create(coordinator)
    assert len(entities) == 1
    assert entities[0]._output_id == 1


async def test_light_dimmer_vs_onoff(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.outputs = [
        {"id": 0, "name": "Dimmer", "type": 255, "module_type": "D"},
        {"id": 1, "name": "Relay", "type": 255, "module_type": "O"},
    ]
    entities = light_create(coordinator)
    assert len(entities) == 2
    dimmer_entity = next(e for e in entities if e._output_id == 0)
    relay_entity = next(e for e in entities if e._output_id == 1)
    assert dimmer_entity.color_mode == ColorMode.BRIGHTNESS
    assert relay_entity.color_mode == ColorMode.ONOFF


async def test_switch_creates_relay_non_light(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.outputs = [
        {"id": 0, "name": "Light", "type": 255, "module_type": "O"},
        {"id": 1, "name": "ShutRelay", "type": 127, "module_type": "O"},
        {"id": 2, "name": "Plug", "type": 0, "module_type": "O"},
        {"id": 3, "name": "Fan", "type": 0, "module_type": "D"},
    ]
    entities = switch_create(coordinator)
    assert len(entities) == 1
    assert entities[0]._output_id == 2


async def test_fan_creates_dimmer_non_light(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.outputs = [
        {"id": 0, "name": "Light", "type": 255, "module_type": "D"},
        {"id": 1, "name": "ShutRelay", "type": 127, "module_type": "D"},
        {"id": 2, "name": "Vent", "type": 0, "module_type": "D"},
        {"id": 3, "name": "Plug", "type": 0, "module_type": "O"},
    ]
    entities = fan_create(coordinator)
    assert len(entities) == 1
    assert entities[0]._output_id == 2


async def test_sensor_filters_by_name_and_quantity(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.sensors = [
        {"id": 0, "name": "Temp", "physical_quantity": "temperature", "in_use": True},
        {"id": 1, "name": "Humid", "physical_quantity": "humidity", "in_use": False},
        {"id": 2, "name": "Unknown", "physical_quantity": "brightness", "in_use": True},
        {"id": 3, "name": "", "physical_quantity": "temperature", "in_use": True},
        {"id": 4, "name": "CO2", "physical_quantity": "co2", "in_use": True},
    ]
    entities = sensor_create(coordinator)
    ids = [e._sensor_id for e in entities]
    # id 2 skipped: unknown quantity; id 3 skipped: empty name
    assert ids == [0, 1, 4]


async def test_sensor_inherits_room_from_sibling_via_external_id(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """Humidity sensor inherits room from temperature sensor on the same device."""
    coordinator.rooms = {20: coordinator.rooms.get(20)} if 20 in coordinator.rooms else {}
    coordinator.rooms[20] = type(
        "RoomInfo", (), {"id": 20, "name": "Badkamer", "floor": 255}
    )()
    coordinator.sensors = [
        {"id": 11, "name": "Badkamer", "physical_quantity": "temperature",
         "external_id": "7", "room": 20, "in_use": True},
        {"id": 16, "name": "Badkamer", "physical_quantity": "humidity",
         "external_id": "7", "room": 255, "in_use": True},
    ]
    entities = sensor_create(coordinator)
    temp = next(e for e in entities if e._sensor_id == 11)
    hum = next(e for e in entities if e._sensor_id == 16)
    assert temp.om_room_id == 20
    assert hum.om_room_id == 20


async def test_sensor_entity_id_has_quantity_prefix(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.sensors = [
        {"id": 0, "name": "Kitchen", "physical_quantity": "temperature", "in_use": True},
        {"id": 1, "name": "Kitchen", "physical_quantity": "humidity", "in_use": True},
    ]
    entities = sensor_create(coordinator)
    entity_ids = [e.entity_id for e in entities]
    assert "sensor.temp_kitchen" in entity_ids
    assert "sensor.hum_kitchen" in entity_ids


async def test_cover_creates_all_named_shutters(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.shutters = [
        {"id": 0, "name": "Blinds", "room": 1},
        {"id": 1, "name": ""},
        {"id": 2, "name": "Curtain", "room": 1},
    ]
    entities = cover_create(coordinator)
    ids = [e._shutter_id for e in entities]
    assert ids == [0, 2]


async def test_event_creates_all_named_inputs(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.inputs = [
        {"id": 0, "name": "Button", "room": 1},
        {"id": 1, "name": ""},
        {"id": 2, "name": "Switch", "room": 1},
    ]
    entities = event_create(coordinator)
    ids = [e._input_id for e in entities]
    assert ids == [0, 2]
