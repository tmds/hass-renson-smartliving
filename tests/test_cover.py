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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Closing from open: shutter_down, stop after the scaled travel time."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_down": 23}]

    # start fully open (OM 0); target HA 0 = OM 99 (fully closed) -> going down
    coordinator._shutter_states[0] = {"state": "UP", "position": 0}
    await cover.async_set_cover_position(position=0)

    # the goto runs in a background task; capture the computed sleep
    slept: list[float] = []

    async def fake_sleep(duration: float) -> None:
        slept.append(duration)

    monkeypatch.setattr(
        "custom_components.renson_smartliving.cover.asyncio.sleep", fake_sleep
    )
    await cover._goto_task
    assert coordinator.client.shutter_down.await_count >= 1
    # 23 s full travel scaled to the full 99-step distance -> 23 s
    assert slept == [pytest.approx(23.0)]
    assert coordinator.client.shutter_stop.await_count == 1
    coordinator.client.shutter_up.assert_not_called()


async def test_set_cover_position_scales_travel_time(
    coordinator: OpenMoticsCoordinator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A partial move stops proportionally earlier than the full travel."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_down": 20}]

    # OM 0 (open) -> OM 33: 33/99 of the travel time
    coordinator._shutter_states[0] = {"state": "UP", "position": 0}
    await cover.async_set_cover_position(position=67)

    slept: list[float] = []

    async def fake_sleep(duration: float) -> None:
        slept.append(duration)

    monkeypatch.setattr(
        "custom_components.renson_smartliving.cover.asyncio.sleep", fake_sleep
    )
    await cover._goto_task
    assert slept == [pytest.approx(20.0 * 33 / 99)]


async def test_set_cover_position_reports_estimated_position(
    coordinator: OpenMoticsCoordinator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """While travelling, the position is estimated from elapsed time."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_down": 2}]

    coordinator._shutter_states[0] = {"state": "UP", "position": 0}

    release = asyncio.Event()
    real_sleep = asyncio.sleep

    async def fake_sleep(_duration: float) -> None:
        await release.wait()

    monkeypatch.setattr(
        "custom_components.renson_smartliving.cover.asyncio.sleep", fake_sleep
    )
    try:
        await cover.async_set_cover_position(position=0)
        # let the goto task start and reach its (blocked) sleep
        await real_sleep(0.01)
        # just after the start the estimate is still near fully open
        assert cover.current_cover_position >= 90
        # halfway through the 2 s motion: HA ~50 (OM ~49.5)
        await real_sleep(1.0)
        assert 40 <= cover.current_cover_position <= 60
    finally:
        release.set()
    await cover._goto_task
    # after the motion the reported gateway position wins again
    # (gateway still reports OM 0 = fully open = HA 100)
    assert cover.current_cover_position == 100


async def test_set_cover_position_opens_upwards(
    coordinator: OpenMoticsCoordinator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Opening from closed: shutter_up and stop after the travel time."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    coordinator.shutters = [{"id": 0, "name": "screen", "timer_up": 24}]

    # start closed (OM 99); target HA 100 = OM 0 (fully open) -> going up
    coordinator._shutter_states[0] = {"state": "DOWN", "position": 99}
    await cover.async_set_cover_position(position=100)

    slept: list[float] = []

    async def fake_sleep(duration: float) -> None:
        slept.append(duration)

    monkeypatch.setattr(
        "custom_components.renson_smartliving.cover.asyncio.sleep", fake_sleep
    )
    await cover._goto_task
    assert coordinator.client.shutter_up.await_count == 1
    assert slept == [pytest.approx(24.0)]
    assert coordinator.client.shutter_stop.await_count == 1
    coordinator.client.shutter_down.assert_not_called()


async def test_stop_cover_cancels_goto(
    coordinator: OpenMoticsCoordinator,
    monkeypatch: pytest.MonkeyPatch,
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

    real_sleep = asyncio.sleep

    async def fake_sleep(_duration: float) -> None:
        await real_sleep(5)

    monkeypatch.setattr(
        "custom_components.renson_smartliving.cover.asyncio.sleep", fake_sleep
    )
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
