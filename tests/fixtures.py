"""Test data and helpers for Renson Smart Living tests."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

from custom_components.renson_smartliving.coordinator import EntityNaming


def mock_response(
    status: int = 200,
    json_data: dict | list | None = None,
    text: str | None = None,
):
    """Create a mock aiohttp response usable as an async context manager."""
    resp = AsyncMock()
    resp.status = status
    if text is None:
        text = "" if json_data is None else json.dumps(json_data)
    resp.text = AsyncMock(return_value=text)
    resp.json = AsyncMock(return_value=json_data if json_data is not None else {})
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def make_naming(
    platform: str,
    unique_id: str = "test",
    name: str = "Test",
) -> EntityNaming:
    """Create an EntityNaming for use in tests."""
    return EntityNaming(
        unique_id=unique_id,
        friendly_name=name,
        hass_platform=platform,
        object_id=unique_id,
    )

PLATFORM_DETAILS = {
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "platform": "BRAIN_PLUS",
    "master_serial": "SN123456",
}

PLATFORM_DETAILS_V2 = {
    "mac_address": "94:A9:A8:82:3A:36",
    "platform": "CLASSIC",
    "hardware": "BBB",
    "hardware_serial": None,
    "master_serial": None,
}

VERSION = {
    "gateway": "1.2.3",
    "master": "4.5.6",
}

VERSION_REST = {
    "success": True,
    "version": "3.11.1",
    "gateway": "3.11.1",
    "master": "3.143.131",
    "python_version": "3.8.12",
}

SAMPLE_GROUP_ACTIONS = [
    {"id": 5, "name": "All Off", "show_in_app": True},
    {"id": 12, "name": "Movie Mode", "show_in_app": True},
    {"id": 20, "name": "", "show_in_app": True},
    {"id": 30, "name": "Internal", "show_in_app": False},
    {"id": 40, "name": "Hidden", "show_in_app": False},
]

SAMPLE_CONFIG = {
    "OUTPUT_CONTROL": [
        {
            "id": 0,
            "name": "Ceiling",
            "type": 255,
            "module_type": "D",
            "room": 1,
        },
        {
            "id": 1,
            "name": "Plug",
            "type": 0,
            "module_type": "O",
            "room": 1,
        },
    ],
    "SHUTTER_CONTROL": [
        {"id": 0, "name": "Blinds", "room": 1},
    ],
    "SENSOR_CONTROL": [
        {
            "id": 0,
            "name": "Temp",
            "physical_quantity": "temperature",
            "in_use": True,
            "room": 1,
        },
    ],
    "INPUT_CONTROL": [
        {"id": 0, "name": "Button", "room": 1},
    ],
    "GROUP_ACTION_CONTROL": SAMPLE_GROUP_ACTIONS,
    "ROOM_CONTROL": [
        {"id": 1, "name": "Kitchen", "floor": 0},
    ],
    "VERSION": VERSION,
    "PLATFORM_DETAILS": PLATFORM_DETAILS,
}

SAMPLE_OUTPUT_STATUS = [
    {"id": 0, "status": 1, "dimmer": 75},
    {"id": 1, "status": 0, "dimmer": 0},
]

SAMPLE_SHUTTER_STATUS = {
    "detail": {
        "0": {"state": "UP", "actual_position": 0},
        "3": {"state": "DOWN", "actual_position": 99},
    },
}

SAMPLE_THERMOSTATS = [
    {
        "id": 0,
        "name": "Living",
        "room": 2,
        "status": {
            "current_temperature": 19.0,
            "mode": "heating",
            "steering_power": 40,
            "state": "ON",
            "active_preset": "auto",
            "preset_expiration": None,
            "current_setpoint": 18.0,
        },
    },
    {
        "id": 1,
        "name": "Office",
        "room": 3,
        "status": {
            "current_temperature": 20.5,
            "mode": "heating",
            "steering_power": 0,
            "state": "OFF",
            "active_preset": "manual",
            "preset_expiration": None,
            "current_setpoint": 15.0,
        },
    },
]

# WebSocket event as sent by the gateway (uppercase enum values).
SAMPLE_THERMOSTAT_EVENT = {
    "type": "THERMOSTAT_CHANGE",
    "data": {
        "id": 0,
        "status": {
            "state": "ON",
            "current_setpoint": 20.0,
            "steering_power": 100,
            "active_preset": "OVERRIDE",
            "current_temperature": 19.0,
            "mode": "HEATING",
            "preset_expiration": None,
            "previous_preset": "AUTO",
        },
    },
}
