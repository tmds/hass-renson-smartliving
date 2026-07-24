"""Tests for entity state-reading properties — verifying coordinator state is correctly
exposed through each platform's HA-facing properties."""

from __future__ import annotations

import pytest

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.cover import OpenMoticsCover
from custom_components.renson_smartliving.fan import OpenMoticsFan
from custom_components.renson_smartliving.light import OpenMoticsLight
from custom_components.renson_smartliving.sensor import OpenMoticsSensor
from custom_components.renson_smartliving.switch import OpenMoticsSwitch
from tests.fixtures import make_naming


@pytest.fixture
def light(coordinator: OpenMoticsCoordinator) -> OpenMoticsLight:
    return OpenMoticsLight(
        coordinator=coordinator, naming=make_naming("light", name="L"),
        output_id=7, supports_brightness=True,
    )


@pytest.fixture
def switch(coordinator: OpenMoticsCoordinator) -> OpenMoticsSwitch:
    return OpenMoticsSwitch(
        coordinator=coordinator, naming=make_naming("switch", name="S"), output_id=3,
    )


@pytest.fixture
def fan(coordinator: OpenMoticsCoordinator) -> OpenMoticsFan:
    return OpenMoticsFan(
        coordinator=coordinator, naming=make_naming("fan", name="F"), output_id=5,
    )


@pytest.fixture
def cover(coordinator: OpenMoticsCoordinator) -> OpenMoticsCover:
    return OpenMoticsCover(
        coordinator=coordinator, naming=make_naming("cover", name="C"), shutter_id=2,
    )


@pytest.fixture
def sensor(coordinator: OpenMoticsCoordinator) -> OpenMoticsSensor:
    return OpenMoticsSensor(
        coordinator=coordinator, naming=make_naming("sensor", name="Temp"),
        sensor_id=4, physical_quantity="temperature",
    )


# -- Light state --


def test_light_is_on(light: OpenMoticsLight, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._output_states[7] = {"on": True, "dimmer": 80}
    assert light.is_on is True

    coordinator._output_states[7] = {"on": False, "dimmer": 0}
    assert light.is_on is False


def test_light_is_on_no_state(light: OpenMoticsLight) -> None:
    assert light.is_on is None


def test_light_brightness_no_state(light: OpenMoticsLight) -> None:
    assert light.brightness is None


# -- Switch state --


def test_switch_is_on(switch: OpenMoticsSwitch, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._output_states[3] = {"on": True, "dimmer": 0}
    assert switch.is_on is True

    coordinator._output_states[3] = {"on": False, "dimmer": 0}
    assert switch.is_on is False


def test_switch_is_on_no_state(switch: OpenMoticsSwitch) -> None:
    assert switch.is_on is None


# -- Fan state --


def test_fan_is_on(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._output_states[5] = {"on": True, "dimmer": 50}
    assert fan.is_on is True

    coordinator._output_states[5] = {"on": False, "dimmer": 0}
    assert fan.is_on is False


def test_fan_is_on_no_state(fan: OpenMoticsFan) -> None:
    assert fan.is_on is None


def test_fan_percentage(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._output_states[5] = {"on": True, "dimmer": 75}
    assert fan.percentage == 75

    coordinator._output_states[5] = {"on": True, "dimmer": 0}
    assert fan.percentage == 0

    coordinator._output_states[5] = {"on": True, "dimmer": 100}
    assert fan.percentage == 100


def test_fan_percentage_no_state(fan: OpenMoticsFan) -> None:
    assert fan.percentage is None


# -- Cover state --


def test_cover_is_opening(cover: OpenMoticsCover, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._shutter_states[2] = {"state": "GOING_UP", "position": 50}
    assert cover.is_opening is True

    coordinator._shutter_states[2] = {"state": "STOPPED", "position": 50}
    assert cover.is_opening is False

    coordinator._shutter_states[2] = {"state": "GOING_DOWN", "position": 50}
    assert cover.is_opening is False


def test_cover_is_opening_no_state(cover: OpenMoticsCover) -> None:
    assert cover.is_opening is False


def test_cover_is_closing(cover: OpenMoticsCover, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._shutter_states[2] = {"state": "GOING_DOWN", "position": 50}
    assert cover.is_closing is True

    coordinator._shutter_states[2] = {"state": "STOPPED", "position": 50}
    assert cover.is_closing is False

    coordinator._shutter_states[2] = {"state": "GOING_UP", "position": 50}
    assert cover.is_closing is False


def test_cover_is_closing_no_state(cover: OpenMoticsCover) -> None:
    assert cover.is_closing is False


# -- Sensor state --


def test_sensor_native_value(sensor: OpenMoticsSensor, coordinator: OpenMoticsCoordinator) -> None:
    coordinator._sensor_values[4] = 21.5
    assert sensor.native_value == 21.5

    coordinator._sensor_values[4] = 0.0
    assert sensor.native_value == 0.0


def test_sensor_native_value_no_state(sensor: OpenMoticsSensor) -> None:
    assert sensor.native_value is None
