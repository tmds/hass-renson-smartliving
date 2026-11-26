"""REST config fallback exercised through the real OpenMoticsClient.

These tests patch the HTTP session (not the client), so a missing api.py
endpoint method fails the test instead of being silently mocked away.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from custom_components.renson_smartliving.api import OpenMoticsClient
from custom_components.renson_smartliving.sync import SyncLoop
from tests.fixtures import mock_response

OUTPUTS = [{"id": 15, "name": "Living lights", "type": 255}]
SHUTTERS = [{"id": 22, "name": "Bureau screen", "timer_up": 23, "timer_down": 22}]
SENSORS = [{"id": 527, "name": "Temp living"}]
ROOMS = [{"id": 2, "name": "Living"}]
GROUP_ACTIONS = [{"id": 5, "name": "Avond", "actions": "161,21"}]
THERMOSTATS = [{"id": 0, "name": "Living", "status": {"current_setpoint": 18.0}}]
PLATFORM_DETAILS = {"mac_address": "AA:BB:CC:DD:EE:FF", "gateway": "ok"}
VERSION = {"gateway": "3.9.9", "master": "3.143.131"}

REST_CONFIG = {
    "/get_output_configurations": {"config": OUTPUTS},
    "/get_input_configurations": {"config": [{"id": 11, "name": "Doorbell"}]},
    "/get_output_status": {"status": [{"id": 15, "on": True, "dimmer": 80}]},
    "/get_shutter_status": {"status": {"22": {"state": "DOWN"}}},
    "/get_shutter_configurations": {"config": SHUTTERS},
    "/get_sensor_configurations": {"config": SENSORS},
    "/get_room_configurations": {"config": ROOMS},
    "/get_group_action_configurations": {"config": GROUP_ACTIONS},
    "/get_platform_details": PLATFORM_DETAILS,
    "/api/thermostat/control": THERMOSTATS,
    "/get_version": VERSION,
}


async def _async_noop(*args, **kwargs):
    pass


async def _fake_connect():
    return FakeWS()


async def _trigger_sync_404():
    from custom_components.renson_smartliving.api import OpenMoticsError
    raise OpenMoticsError("HTTP 404", status=404)


class FakeWS:
    """Idle websocket: yields nothing and blocks until closed."""

    def __init__(self) -> None:
        self._block = asyncio.Event()

    async def close(self) -> None:
        self._block.set()

    def __aiter__(self):
        return self

    async def __anext__(self):
        await self._block.wait()
        raise StopAsyncIteration


def _real_client_with_mock_http() -> tuple[OpenMoticsClient, MagicMock]:
    client = OpenMoticsClient(
        host="192.168.77.150", username="user", password="hunter2"  # noqa: S106
    )
    client._token = "test-token"  # noqa: SLF001, S105

    session = MagicMock()

    def route(method, url, **kwargs):
        path = url.split("?")[0]
        for endpoint, payload in REST_CONFIG.items():
            if path.endswith(endpoint):
                return mock_response(200, json_data=payload)
        return mock_response(404, json_data={"success": False, "msg": "nf"})

    session.request = MagicMock(side_effect=route)
    session.closed = False
    client._session = session  # noqa: SLF001
    # reset_session would drop the mocked session and login would do real
    # HTTP; both are patched so only the fallback endpoints hit the mock.
    client.reset_session = lambda: None
    client.login = _async_noop
    client.trigger_sync = _trigger_sync_404
    client.close = _async_noop
    client.connect_events = _fake_connect
    return client, session


async def test_rest_fallback_real_client_collects_all_sections() -> None:
    """The fallback loads outputs, shutters, sensors, rooms, actions."""
    client, _session = _real_client_with_mock_http()
    on_config = MagicMock()
    on_full_update = MagicMock()
    loop = SyncLoop(client, on_config, on_full_update, MagicMock())
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    on_config.assert_called_once()
    config = on_config.call_args[0][0]
    assert config["OUTPUT_CONTROL"] == OUTPUTS
    assert config["SHUTTER_CONTROL"] == SHUTTERS
    assert config["SENSOR_CONTROL"] == SENSORS
    assert config["ROOM_CONTROL"] == ROOMS
    assert config["GROUP_ACTION_CONTROL"] == GROUP_ACTIONS
    assert config["PLATFORM_DETAILS"] == PLATFORM_DETAILS
    assert config["THERMOSTAT_CONTROL"] == THERMOSTATS
    assert config["VERSION"] == {"gateway": "3.9.9", "master": "3.143.131"}


async def test_rest_fallback_real_client_hits_all_endpoints() -> None:
    """Every legacy endpoint the fallback needs is actually requested."""
    client, session = _real_client_with_mock_http()

    async def fake_ws():
        return FakeWS()

    client.connect_events = fake_ws
    on_config = MagicMock()
    loop = SyncLoop(client, on_config, MagicMock(), MagicMock())
    loop.start()
    await asyncio.sleep(0.1)
    await loop.stop()

    requested = set()
    for call in session.request.call_args_list:
        url = call.args[1] if len(call.args) > 1 else call.kwargs.get("url", "")
        for endpoint in REST_CONFIG:
            if url.endswith(endpoint):
                requested.add(endpoint)
    missing = set(REST_CONFIG) - requested
    assert not missing, f"fallback did not request: {sorted(missing)}"
