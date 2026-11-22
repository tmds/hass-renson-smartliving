from __future__ import annotations

import asyncio

import pytest
from homeassistant.components.cover import CoverEntityFeature
from homeassistant.exceptions import HomeAssistantError

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.cover import OpenMoticsCover
from tests.fixtures import make_naming


async def test_position_mapping_boundaries(coordinator: OpenMoticsCoordinator) -> None:
    """OM 0=open -> HA 100, OM 99=closed -> HA 0, OM 50 -> midpoint."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )

    coordinator._shutter_states[0] = {"state": "UP", "position": 0}
    assert cover.current_cover_position == 100
    assert cover.is_closed is False

    coordinator._shutter_states[0] = {"state": "DOWN", "position": 99}
    assert cover.current_cover_position == 0
    assert cover.is_closed is True

    coordinator._shutter_states[0] = {"state": "STOPPED", "position": 50}
    pos = cover.current_cover_position
    assert 49 <= pos <= 51

    coordinator._shutter_states[0] = {"state": "STOPPED", "position": None}
    assert cover.current_cover_position is None
    assert cover.is_closed is None


async def test_set_cover_position_unknown_raises(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """Without a known position we cannot navigate; the call must raise."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator._shutter_states[0] = {"state": "STOPPED", "position": None}
    with pytest.raises(HomeAssistantError):
        await cover.async_set_cover_position(position=50)
    coordinator.client.shutter_up.assert_not_called()
    coordinator.client.shutter_down.assert_not_called()


async def test_set_cover_position_drives_and_stops(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """Closing from open: shutter_down, poll until target reached, then stop."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_down": 23}]

    # start fully open (OM 0); target HA 0 = OM 99 (fully closed) -> going down
    coordinator._shutter_states[0] = {"state": "UP", "position": 0}
    await cover.async_set_cover_position(position=0)

    # the poll loop runs in a background task; simulate the gateway
    # pushing positions and let the loop reach the target
    async def drive() -> None:
        for om_pos in (20, 60, 99):
            await asyncio.sleep(0.05)
            coordinator._shutter_states[0] = {
                "state": "GOING_DOWN",
                "position": om_pos,
            }

    await asyncio.gather(drive(), cover._goto_task)
    assert coordinator.client.shutter_down.await_count >= 1
    assert coordinator.client.shutter_stop.await_count == 1
    coordinator.client.shutter_up.assert_not_called()


async def test_set_cover_position_opens_upwards(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """Opening from closed: shutter_up until the OM target is reached."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_up": 24}]

    # start closed (OM 99); target HA 100 = OM 0 (fully open) -> going up
    coordinator._shutter_states[0] = {"state": "DOWN", "position": 99}
    await cover.async_set_cover_position(position=100)

    async def drive() -> None:
        for om_pos in (70, 30, 0):
            await asyncio.sleep(0.05)
            coordinator._shutter_states[0] = {"state": "GOING_UP", "position": om_pos}

    await asyncio.gather(drive(), cover._goto_task)
    assert coordinator.client.shutter_up.await_count == 1
    assert coordinator.client.shutter_stop.await_count == 1
    coordinator.client.shutter_down.assert_not_called()


async def test_stop_cover_cancels_goto(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """async_stop_cover cancels a running goto and still sends stop."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_down": 23}]
    coordinator._shutter_states[0] = {"state": "UP", "position": 0}
    await cover.async_set_cover_position(position=0)
    assert cover._goto_task is not None

    await cover.async_stop_cover()
    assert cover._goto_task is None
    assert coordinator.client.shutter_stop.await_count >= 1


async def test_cover_advertises_set_position(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """The cover must advertise SET_POSITION or HA hides the position slider."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    assert cover.supported_features & CoverEntityFeature.SET_POSITION
