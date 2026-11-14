"""Tests for connection state tracking — unavailability after repeated failures."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock

import aiohttp
import pytest

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.sensor import OpenMoticsSensor
from custom_components.renson_smartliving.sync import SyncLoop
from tests.fixtures import make_naming
from tests.test_sync import FakeWS, _make_client, _make_config_messages


def _close_msg() -> MagicMock:
    msg = MagicMock()
    msg.type = aiohttp.WSMsgType.CLOSE
    return msg


@pytest.fixture
def sensor(coordinator: OpenMoticsCoordinator) -> OpenMoticsSensor:
    return OpenMoticsSensor(
        coordinator=coordinator,
        naming=make_naming("sensor", name="Temp"),
        sensor_id=0,
        physical_quantity="temperature",
    )


def test_entity_available_mirrors_coordinator(
    coordinator: OpenMoticsCoordinator, sensor: OpenMoticsSensor
) -> None:
    """Entity available property follows coordinator.connected."""
    assert not sensor.available
    coordinator.connected = True
    assert sensor.available
    coordinator.connected = False
    assert not sensor.available


async def test_connected_after_successful_sync() -> None:
    """on_availability_change(True) is called after a successful sync."""
    ws = FakeWS(_make_config_messages())
    client = _make_client()
    client.connect_events.return_value = ws

    states: list[bool] = []
    loop = SyncLoop(
        client, MagicMock(), MagicMock(), MagicMock(),
        on_availability_change=lambda c: states.append(c),
    )
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    assert True in states


async def test_connected_survives_single_failure() -> None:
    """A single sync failure does not trigger on_availability_change(False)."""
    call_count = 0

    def _make_ws():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise ConnectionError("fail once")
        return FakeWS(_make_config_messages())

    client = _make_client()
    client.connect_events.side_effect = _make_ws

    states: list[bool] = []

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.05)
        loop = SyncLoop(
            client, MagicMock(), MagicMock(), MagicMock(),
            on_availability_change=lambda c: states.append(c),
        )
        loop.start()
        await asyncio.sleep(0.3)
        await loop.stop()

    assert False not in states
    assert True in states


async def test_disconnected_on_login_failure() -> None:
    """Login failure marks entities unavailable."""
    call_count = 0

    def _login(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return
        raise ConnectionError("gateway down")

    client = _make_client()
    client.login.side_effect = _login
    client.connect_events.side_effect = lambda: FakeWS(
        _make_config_messages() + [_close_msg()]
    )

    states: list[bool] = []

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.05)
        loop = SyncLoop(
            client, MagicMock(), MagicMock(), MagicMock(),
            on_availability_change=lambda c: states.append(c),
        )
        loop.start()
        await asyncio.sleep(0.5)
        await loop.stop()

    assert True in states
    assert False in states


async def test_reconnect_after_disconnect() -> None:
    """on_availability_change(True) fires when sync recovers after failures."""
    call_count = 0

    def _login(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1 or call_count >= 5:
            return
        raise ConnectionError("still down")

    client = _make_client()
    client.login.side_effect = _login
    ws_call_count = 0

    def _make_ws():
        nonlocal ws_call_count
        ws_call_count += 1
        if ws_call_count == 1:
            return FakeWS(_make_config_messages() + [_close_msg()])
        return FakeWS(_make_config_messages())

    client.connect_events.side_effect = _make_ws

    states: list[bool] = []

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.05)
        loop = SyncLoop(
            client, MagicMock(), MagicMock(), MagicMock(),
            on_availability_change=lambda c: states.append(c),
        )
        loop.start()
        await asyncio.sleep(1.0)
        await loop.stop()

    assert True in states
    assert False in states
    last_true = max(i for i, s in enumerate(states) if s is True)
    last_false = max(i for i, s in enumerate(states) if s is False)
    assert last_true > last_false


async def test_backoff_resets_after_successful_login() -> None:
    """Login failures grow backoff; a successful login resets it."""
    login_count = 0
    login_timestamps: list[float] = []

    def _login(**kwargs):
        nonlocal login_count
        login_count += 1
        login_timestamps.append(time.monotonic())
        if login_count <= 3:
            raise ConnectionError("down")
        # Login 4+ succeeds

    client = _make_client()
    client.login.side_effect = _login
    ws_count = 0

    def _make_ws():
        nonlocal ws_count
        ws_count += 1
        if ws_count <= 2:
            return FakeWS(_make_config_messages() + [_close_msg()])
        return FakeWS(_make_config_messages())

    client.connect_events.side_effect = _make_ws

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.1)
        loop = SyncLoop(client, MagicMock(), MagicMock(), MagicMock())
        loop.start()
        await asyncio.sleep(2.0)
        await loop.stop()

    assert len(login_timestamps) >= 5
    # Logins 1-3 fail, backoff grows: 0.1 -> 0.2 -> 0.4
    # Gap between login 2 and 3 should be larger than between 1 and 2.
    gap_2_3 = login_timestamps[2] - login_timestamps[1]
    gap_1_2 = login_timestamps[1] - login_timestamps[0]
    assert gap_2_3 > gap_1_2
    # Login 4 succeeds, resets backoff. Login 5 (after WS close) should
    # be close to INITIAL_BACKOFF, not the grown backoff.
    gap_4_5 = login_timestamps[4] - login_timestamps[3]
    assert gap_4_5 < 0.3


async def test_ws_closed_during_config_raises() -> None:
    """WebSocket closing during config phase raises ConnectionError."""
    ws = FakeWS(_make_config_messages()[:2])
    client = _make_client()

    call_count = 0

    def _connect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return ws
        raise ConnectionError("stop")

    client.connect_events.side_effect = _connect

    on_config = MagicMock()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.05)
        loop = SyncLoop(client, on_config, MagicMock(), MagicMock())
        loop.start()
        await asyncio.sleep(0.3)
        await loop.stop()

    on_config.assert_not_called()


async def test_no_availability_change_without_callback() -> None:
    """SyncLoop works without on_availability_change callback."""
    ws = FakeWS(_make_config_messages())
    client = _make_client()
    client.connect_events.return_value = ws

    loop = SyncLoop(client, MagicMock(), MagicMock(), MagicMock())
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()
