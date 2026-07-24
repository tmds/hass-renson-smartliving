"""Tests for platform command methods — verifying correct API calls and param translation."""

from __future__ import annotations

import pytest

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.cover import OpenMoticsCover
from custom_components.renson_smartliving.fan import OpenMoticsFan
from custom_components.renson_smartliving.light import OpenMoticsLight
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


# -- Light commands --


async def test_light_turn_on_with_brightness(light: OpenMoticsLight, coordinator: OpenMoticsCoordinator) -> None:
    """turn_on with brightness converts HA 0-255 to OM 0-100 dimmer."""
    await light.async_turn_on(brightness=128)
    coordinator.client.set_output.assert_called_once_with(7, is_on=True, dimmer=50)


async def test_light_turn_on_without_brightness(light: OpenMoticsLight, coordinator: OpenMoticsCoordinator) -> None:
    """turn_on without brightness sends dimmer=None (gateway keeps current level)."""
    await light.async_turn_on()
    coordinator.client.set_output.assert_called_once_with(7, is_on=True, dimmer=None)


async def test_light_turn_off(light: OpenMoticsLight, coordinator: OpenMoticsCoordinator) -> None:
    await light.async_turn_off()
    coordinator.client.set_output.assert_called_once_with(7, is_on=False)


# -- Switch commands --


async def test_switch_turn_on(switch: OpenMoticsSwitch, coordinator: OpenMoticsCoordinator) -> None:
    await switch.async_turn_on()
    coordinator.client.set_output.assert_called_once_with(3, is_on=True)


async def test_switch_turn_off(switch: OpenMoticsSwitch, coordinator: OpenMoticsCoordinator) -> None:
    await switch.async_turn_off()
    coordinator.client.set_output.assert_called_once_with(3, is_on=False)


# -- Fan commands --


async def test_fan_set_percentage(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    """set_percentage passes value directly (OM dimmer is already 0-100)."""
    await fan.async_set_percentage(75)
    coordinator.client.set_output.assert_called_once_with(5, is_on=True, dimmer=75)


async def test_fan_set_percentage_zero_turns_off(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    """set_percentage(0) sends is_on=False."""
    await fan.async_set_percentage(0)
    coordinator.client.set_output.assert_called_once_with(5, is_on=False, dimmer=0)


async def test_fan_turn_on_with_percentage(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    await fan.async_turn_on(percentage=60)
    coordinator.client.set_output.assert_called_once_with(5, is_on=True, dimmer=60)


async def test_fan_turn_on_without_percentage(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    """turn_on without percentage sends dimmer=None (gateway decides)."""
    await fan.async_turn_on()
    coordinator.client.set_output.assert_called_once_with(5, is_on=True, dimmer=None)


async def test_fan_turn_off(fan: OpenMoticsFan, coordinator: OpenMoticsCoordinator) -> None:
    await fan.async_turn_off()
    coordinator.client.set_output.assert_called_once_with(5, is_on=False)


# -- Cover commands --


async def test_cover_open(cover: OpenMoticsCover, coordinator: OpenMoticsCoordinator) -> None:
    await cover.async_open_cover()
    coordinator.client.shutter_up.assert_called_once_with(2)


async def test_cover_close(cover: OpenMoticsCover, coordinator: OpenMoticsCoordinator) -> None:
    await cover.async_close_cover()
    coordinator.client.shutter_down.assert_called_once_with(2)


async def test_cover_stop(cover: OpenMoticsCover, coordinator: OpenMoticsCoordinator) -> None:
    await cover.async_stop_cover()
    coordinator.client.shutter_stop.assert_called_once_with(2)
