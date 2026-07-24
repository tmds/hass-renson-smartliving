"""Tests for sync loop active phase — event forwarding, WS errors, WS close."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import pytest

from custom_components.renson_smartliving.sync import SyncLoop
from tests.fixtures import SAMPLE_OUTPUT_STATUS, SAMPLE_SHUTTER_STATUS, VERSION
from tests.test_sync import FakeWS, _make_client, _make_config_messages, _make_ws_msg


async def test_active_phase_forwards_change_events() -> None:
    """CHANGE events after config phase are forwarded to on_event."""
    config_msgs = _make_config_messages()
    change1 = _make_ws_msg("OUTPUT_CHANGE", {"id": 0, "status": {"on": True, "value": 80}})
    change2 = _make_ws_msg("SHUTTER_CHANGE", {"id": 1, "status": {"state": "GOING_UP"}})
    ws = FakeWS(config_msgs + [change1, change2])

    client = _make_client()
    client.connect_events.return_value = ws

    on_event = MagicMock()
    loop = SyncLoop(client, MagicMock(), MagicMock(), on_event)
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    change_calls = [
        c for c in on_event.call_args_list
        if c[0][0]["type"] in ("OUTPUT_CHANGE", "SHUTTER_CHANGE")
    ]
    assert len(change_calls) == 2
    assert change_calls[0][0][0]["type"] == "OUTPUT_CHANGE"
    assert change_calls[1][0][0]["type"] == "SHUTTER_CHANGE"


async def test_active_phase_ignores_non_change_events() -> None:
    """Non-CHANGE events in active phase are silently dropped."""
    config_msgs = _make_config_messages()
    ignored = _make_ws_msg("SOME_OTHER_TYPE", {"foo": "bar"})
    ws = FakeWS(config_msgs + [ignored])

    client = _make_client()
    client.connect_events.return_value = ws

    on_event = MagicMock()
    loop = SyncLoop(client, MagicMock(), MagicMock(), on_event)
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    # on_event should not be called for the non-change event (only for buffered replays, if any)
    for call in on_event.call_args_list:
        assert call[0][0]["type"] != "SOME_OTHER_TYPE"


async def test_active_phase_ws_error_triggers_reconnect() -> None:
    """WS ERROR in active phase raises ConnectionError, triggering _run() retry."""
    error_msg = MagicMock()
    error_msg.type = aiohttp.WSMsgType.ERROR

    def make_ws():
        ws = FakeWS(_make_config_messages() + [error_msg])
        ws.exception = lambda: Exception("ws broke")
        return ws

    client = _make_client()
    client.connect_events.side_effect = lambda: make_ws()

    on_config = MagicMock()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.05)
        loop = SyncLoop(client, on_config, MagicMock(), MagicMock())
        loop.start()
        await asyncio.sleep(0.3)
        await loop.stop()

    # _run() should have retried after the error — on_config called more than once
    assert on_config.call_count >= 2


async def test_active_phase_ws_close_returns_gracefully() -> None:
    """WS CLOSE in active phase returns without error, triggering a fresh sync."""
    close_msg = MagicMock()
    close_msg.type = aiohttp.WSMsgType.CLOSE

    client = _make_client()
    call_count = 0

    def _make_ws():
        nonlocal call_count
        call_count += 1
        ws = FakeWS(_make_config_messages() + [close_msg])
        if call_count >= 3:
            # After enough reconnects, block so the loop doesn't spin forever
            ws = FakeWS(_make_config_messages())
        return ws

    client.connect_events.side_effect = _make_ws

    on_config = MagicMock()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("custom_components.renson_smartliving.sync.INITIAL_BACKOFF", 0.05)
        loop = SyncLoop(client, on_config, MagicMock(), MagicMock())
        loop.start()
        await asyncio.sleep(0.3)
        await loop.stop()

    # Graceful close should loop back and do a fresh sync (on_config called again)
    assert on_config.call_count >= 2
