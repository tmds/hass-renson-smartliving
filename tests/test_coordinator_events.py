from __future__ import annotations

from unittest.mock import MagicMock, patch

from custom_components.renson_smartliving.coordinator import (
    OpenMoticsCoordinator,
    signal_entity_event,
)
from custom_components.renson_smartliving.event import OpenMoticsEvent
from tests.fixtures import (
    PLATFORM_DETAILS,
    SAMPLE_CONFIG,
    SAMPLE_OUTPUT_STATUS,
    SAMPLE_SHUTTER_STATUS,
    make_naming,
)


async def test_apply_output_change(
    coordinator: OpenMoticsCoordinator, mock_dispatcher: MagicMock
) -> None:
    event = {
        "type": "OUTPUT_CHANGE",
        "data": {"id": 5, "status": {"on": True, "value": 80}},
    }
    coordinator.apply_event(event)

    state = coordinator.get_output_state(5)
    assert state == {"on": True, "dimmer": 80}
    mock_dispatcher.assert_called_once_with(
        coordinator.hass, signal_entity_event("OUTPUT_CHANGE", 5)
    )


async def test_apply_shutter_change(
    coordinator: OpenMoticsCoordinator, mock_dispatcher: MagicMock
) -> None:
    event = {
        "type": "SHUTTER_CHANGE",
        "data": {"id": 2, "status": {"state": "GOING_UP", "position": 30}},
    }
    coordinator.apply_event(event)

    state = coordinator.get_shutter_state(2)
    assert state == {"state": "GOING_UP", "position": 30}
    mock_dispatcher.assert_called_once_with(
        coordinator.hass, signal_entity_event("SHUTTER_CHANGE", 2)
    )


async def test_apply_sensor_change(
    coordinator: OpenMoticsCoordinator, mock_dispatcher: MagicMock
) -> None:
    event = {
        "type": "SENSOR_CHANGE",
        "data": {"id": 7, "value": 22.5},
    }
    coordinator.apply_event(event)

    assert coordinator.get_sensor_value(7) == 22.5
    mock_dispatcher.assert_called_once_with(
        coordinator.hass, signal_entity_event("SENSOR_CHANGE", 7)
    )


async def test_apply_input_change(
    coordinator: OpenMoticsCoordinator, mock_dispatcher: MagicMock
) -> None:
    event = {
        "type": "INPUT_CHANGE",
        "data": {"id": 3, "status": True},
    }
    coordinator.apply_event(event)

    mock_dispatcher.assert_called_once_with(
        coordinator.hass, signal_entity_event("INPUT_CHANGE", 3), True
    )


async def test_apply_unknown_event(
    coordinator: OpenMoticsCoordinator, mock_dispatcher: MagicMock
) -> None:
    event = {"type": "UNKNOWN_TYPE", "data": {"id": 1}}
    coordinator.apply_event(event)

    mock_dispatcher.assert_not_called()


async def test_handle_config_parses_gateway_info(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.handle_config(SAMPLE_CONFIG)

    gw = coordinator.gateway_info
    assert gw.mac_address == "AA:BB:CC:DD:EE:FF"
    assert gw.device_id == "AABBCCDDEEFF"
    assert gw.platform == "BRAIN_PLUS"
    assert gw.model == "BRAIN+"
    assert gw.master_serial == "SN123456"
    assert gw.gateway_version == "1.2.3"
    assert gw.master_version == "4.5.6"


async def test_handle_config_builds_rooms(
    coordinator: OpenMoticsCoordinator,
) -> None:
    config = {
        **SAMPLE_CONFIG,
        "ROOM_CONTROL": [
            {"id": 1, "name": "Kitchen", "floor": 0},
            {"id": 2, "name": "", "floor": 1},
            {"id": 3, "name": "Bedroom", "floor": 1},
        ],
    }
    coordinator.handle_config(config)

    assert 1 in coordinator.rooms
    assert coordinator.rooms[1].name == "Kitchen"
    assert 2 not in coordinator.rooms
    assert 3 in coordinator.rooms
    assert coordinator.rooms[3].name == "Bedroom"


async def test_update_initial_state(coordinator: OpenMoticsCoordinator) -> None:
    data = {
        "output_status": SAMPLE_OUTPUT_STATUS,
        "shutter_status": SAMPLE_SHUTTER_STATUS,
    }
    coordinator._update_initial_state(data)

    assert coordinator.get_output_state(0) == {"on": True, "dimmer": 75}
    assert coordinator.get_output_state(1) == {"on": False, "dimmer": 0}
    assert coordinator.get_shutter_state(0) == {"state": "UP", "position": 0}
    assert coordinator.get_shutter_state(3) == {"state": "DOWN", "position": 99}


async def test_event_entity_press(coordinator: OpenMoticsCoordinator) -> None:
    """INPUT_CHANGE with pressed=True fires a "press" event on the entity."""
    event = OpenMoticsEvent(
        coordinator=coordinator, naming=make_naming("event", name="E"), input_id=4,
    )
    with patch.object(event, "_trigger_event") as mock_trigger, \
         patch.object(event, "async_write_ha_state"):
        event._handle_om_event(True)
        mock_trigger.assert_called_once_with("press")


async def test_event_entity_release(coordinator: OpenMoticsCoordinator) -> None:
    """INPUT_CHANGE with pressed=False fires a "release" event on the entity."""
    event = OpenMoticsEvent(
        coordinator=coordinator, naming=make_naming("event", name="E"), input_id=4,
    )
    with patch.object(event, "_trigger_event") as mock_trigger, \
         patch.object(event, "async_write_ha_state"):
        event._handle_om_event(False)
        mock_trigger.assert_called_once_with("release")
