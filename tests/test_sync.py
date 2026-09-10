from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, call

import aiohttp
import pytest

from custom_components.renson_smartliving.sync import (
    EXPECTED_CONTROL_EVENTS,
    SyncLoop,
)
from tests.fixtures import PLATFORM_DETAILS, SAMPLE_CONFIG, SAMPLE_GROUP_ACTIONS, SAMPLE_OUTPUT_STATUS, SAMPLE_SHUTTER_STATUS, VERSION


def _make_ws_msg(event_type: str, data: dict | None = None) -> MagicMock:
    """Create a fake aiohttp WebSocket message."""
    msg = MagicMock()
    msg.type = aiohttp.WSMsgType.TEXT
    payload = {"type": event_type, "data": data or {}}
    msg.json.return_value = payload
    return msg


def _make_config_messages() -> list[MagicMock]:
    """Build the full set of control messages for a successful config phase."""
    return [
        _make_ws_msg("OUTPUT_CONTROL", {"control": [{"id": 0, "name": "Light"}]}),
        _make_ws_msg("INPUT_CONTROL", {"control": [{"id": 0, "name": "Button"}]}),
        _make_ws_msg("SENSOR_CONTROL", {"control": [{"id": 0, "name": "Temp"}]}),
        _make_ws_msg("SHUTTER_CONTROL", {"control": [{"id": 0, "name": "Blinds"}]}),
        _make_ws_msg("ROOM_CONTROL", {"control": [{"id": 1, "name": "Kitchen"}]}),
        _make_ws_msg("GROUP_ACTION_CONTROL", {"control": SAMPLE_GROUP_ACTIONS}),
        _make_ws_msg("VERSION", VERSION),
        _make_ws_msg("PLATFORM_DETAILS", PLATFORM_DETAILS),
    ]


class FakeWS:
    """A fake WebSocket that yields pre-loaded messages then waits forever."""

    def __init__(self, messages: list[MagicMock]) -> None:
        self._messages = list(messages)
        self._closed = False
        self._block = asyncio.Event()

    async def close(self) -> None:
        self._closed = True
        self._block.set()

    def __aiter__(self):
        return self

    async def __anext__(self) -> MagicMock:
        if self._messages:
            return self._messages.pop(0)
        # Block until close() is called (simulates idle WebSocket)
        await self._block.wait()
        raise StopAsyncIteration


def _make_client() -> AsyncMock:
    client = AsyncMock()
    client.host = "192.168.1.100"
    client.login = AsyncMock()
    client.connect_events = AsyncMock()
    client.trigger_sync = AsyncMock()
    client.get_output_status = AsyncMock(return_value=SAMPLE_OUTPUT_STATUS)
    client.get_shutter_status = AsyncMock(return_value=SAMPLE_SHUTTER_STATUS)
    client.get_input_configurations = AsyncMock(
        return_value=SAMPLE_CONFIG["INPUT_CONTROL"]
    )
    client.close = AsyncMock()
    return client


async def test_collect_config_complete() -> None:
    """Config phase completes when all expected control events are received."""
    ws = FakeWS(_make_config_messages())
    client = _make_client()
    client.connect_events.return_value = ws

    on_config = MagicMock()
    on_full_update = MagicMock()
    on_event = MagicMock()

    loop = SyncLoop(client, on_config, on_full_update, on_event)
    loop.start()
    # Give the sync loop time to complete the config + full_update phases
    await asyncio.sleep(0.1)
    await loop.stop()

    on_config.assert_called_once()
    config = on_config.call_args[0][0]
    assert set(config.keys()) >= EXPECTED_CONTROL_EVENTS

    on_full_update.assert_called_once()


async def test_inputs_fetched_via_rest() -> None:
    """Inputs come from REST, not WS, so non-in_use inputs are included."""
    ws = FakeWS(_make_config_messages())
    client = _make_client()
    client.connect_events.return_value = ws
    rest_inputs = [
        {"id": 0, "name": "Button", "in_use": True},
        {"id": 5, "name": "BM Achterdeur", "in_use": False},
    ]
    client.get_input_configurations.return_value = rest_inputs

    on_config = MagicMock()
    loop = SyncLoop(client, on_config, MagicMock(), MagicMock())
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    config = on_config.call_args[0][0]
    assert config["INPUT_CONTROL"] is rest_inputs


async def test_collect_config_buffers_change_events() -> None:
    """CHANGE events during config phase are buffered and replayed after initial state."""
    messages = _make_config_messages()
    change_event = _make_ws_msg(
        "OUTPUT_CHANGE", {"id": 0, "status": {"on": True, "value": 80}}
    )
    # Insert a change event in the middle of config events
    messages.insert(3, change_event)

    ws = FakeWS(messages)
    client = _make_client()
    client.connect_events.return_value = ws

    on_config = MagicMock()
    on_full_update = MagicMock()
    on_event = MagicMock()

    loop = SyncLoop(client, on_config, on_full_update, on_event)
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    # The change event should have been replayed after full_update
    on_event.assert_called_once()
    replayed = on_event.call_args[0][0]
    assert replayed["type"] == "OUTPUT_CHANGE"


async def test_collect_config_timeout() -> None:
    """Config phase times out if not all control events arrive."""
    # Only send one of the expected events
    incomplete = [_make_config_messages()[0]]
    ws = FakeWS(incomplete)
    client = _make_client()
    client.connect_events.return_value = ws

    on_config = MagicMock()
    on_full_update = MagicMock()
    on_event = MagicMock()

    loop = SyncLoop(client, on_config, on_full_update, on_event)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "custom_components.renson_smartliving.sync.CONFIG_PHASE_TIMEOUT", 0.1
        )
        loop.start()
        # Wait for the timeout + backoff retry
        await asyncio.sleep(0.5)
        await loop.stop()

    # Config was never complete, so on_config should not have been called
    on_config.assert_not_called()


async def test_full_sync_sequence() -> None:
    """Full sync: login -> WS -> trigger_sync -> config -> full_update."""
    ws = FakeWS(_make_config_messages())
    client = _make_client()
    client.connect_events.return_value = ws

    call_order: list[str] = []

    def track_config(*args):
        call_order.append("config")

    def track_full_update(*args):
        call_order.append("full_update")

    loop = SyncLoop(client, track_config, track_full_update, MagicMock())
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    client.login.assert_called_once()
    client.connect_events.assert_called_once()
    client.trigger_sync.assert_called_once()
    client.get_input_configurations.assert_called_once()
    client.get_output_status.assert_called_once()
    client.get_shutter_status.assert_called_once()

    assert call_order == ["config", "full_update"]
