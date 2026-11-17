from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from custom_components.renson_smartliving.api import (
    AuthenticationError,
    OpenMoticsClient,
    OpenMoticsError,
)


def _mock_response(status: int = 200, json_data: dict | list | None = None, text: str | None = None):
    """Create a mock aiohttp response usable as an async context manager."""
    import json as jsonlib

    resp = AsyncMock()
    resp.status = status
    if text is None:
        text = "" if json_data is None else jsonlib.dumps(json_data)
    resp.text = AsyncMock(return_value=text)
    resp.json = AsyncMock(return_value=json_data if json_data is not None else {})
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


@pytest.fixture
def client():
    return OpenMoticsClient("gw.local", "user", "pass")


@pytest.fixture
def mock_session(client: OpenMoticsClient):
    """Create a mock aiohttp session and patch it onto the client."""
    session = MagicMock()
    session.closed = False
    with patch.object(client, "_get_session", return_value=session):
        yield session


async def test_request_auto_login(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """When _token is None, _request logs in first, then makes the request."""
    assert client._token is None

    mock_session.get = MagicMock(
        return_value=_mock_response(200, {"success": True, "token": "tok123"})
    )
    mock_session.request = MagicMock(
        return_value=_mock_response(200, {"success": True, "value": 42})
    )

    result = await client.get("/test")

    assert client._token == "tok123"
    assert result["value"] == 42
    mock_session.get.assert_called_once()
    mock_session.request.assert_called_once()


async def test_request_retry_on_401(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """On 401, re-authenticates and retries the request."""
    client._token = "expired"

    first_resp = _mock_response(401)
    retry_resp = _mock_response(200, {"success": True, "answer": "ok"})
    login_resp = _mock_response(200, {"success": True, "token": "fresh"})

    call_count = 0

    def request_side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return first_resp
        return retry_resp

    mock_session.request = MagicMock(side_effect=request_side_effect)
    mock_session.get = MagicMock(return_value=login_resp)

    result = await client.get("/data")

    assert client._token == "fresh"
    assert result["answer"] == "ok"
    assert call_count == 2


async def test_request_raises_on_login_failure(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """Login with success=false raises AuthenticationError."""
    mock_session.get = MagicMock(
        return_value=_mock_response(200, {"success": False, "msg": "Bad creds"})
    )

    with pytest.raises(AuthenticationError, match="Bad creds"):
        await client.login()


async def test_request_raises_on_http_error(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """Non-401 HTTP error raises OpenMoticsError with status."""
    client._token = "valid"

    mock_session.request = MagicMock(return_value=_mock_response(500, {}))

    with pytest.raises(OpenMoticsError, match="HTTP 500") as exc_info:
        await client.get("/broken")

    assert exc_info.value.status == 500


async def test_read_response_success_false() -> None:
    """Response with success=false raises OpenMoticsError."""
    resp = AsyncMock()
    resp.status = 200
    resp.text = AsyncMock(
        return_value='{"success": false, "msg": "Not found"}'
    )

    with pytest.raises(OpenMoticsError, match="Not found"):
        await OpenMoticsClient._read_response("/path", resp)


async def test_request_retries_on_transient_error(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """Transient connection errors are retried with backoff."""
    client._token = "valid"

    ok_resp = _mock_response(200, {"success": True, "value": 1})

    call_count = 0

    def request_side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            raise aiohttp.ClientConnectorError(
                connection_key=MagicMock(), os_error=OSError("Connection reset")
            )
        return ok_resp

    mock_session.request = MagicMock(side_effect=request_side_effect)

    with patch("custom_components.renson_smartliving.api.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        result = await client.get("/test")

    assert result["value"] == 1
    assert call_count == 3
    assert mock_sleep.await_count == 2
    mock_sleep.assert_any_await(0.1)
    mock_sleep.assert_any_await(0.2)


async def test_request_gives_up_after_max_retries(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """After exhausting retries, raises OpenMoticsError."""
    client._token = "valid"

    mock_session.request = MagicMock(
        side_effect=aiohttp.ServerDisconnectedError()
    )

    with patch("custom_components.renson_smartliving.api.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(OpenMoticsError, match="Failed after 4 attempts"):
            await client.get("/test")

    assert mock_session.request.call_count == 4


async def test_request_no_retry_on_non_transient_error(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """Non-transient errors (e.g. HTTP 500) are not retried."""
    client._token = "valid"

    mock_session.request = MagicMock(return_value=_mock_response(500, {}))

    with pytest.raises(OpenMoticsError, match="HTTP 500"):
        await client.get("/broken")

    mock_session.request.assert_called_once()


async def test_connect_events_sets_ws_heartbeat(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """WebSocket connection must use a heartbeat to detect dead connections."""
    client._token = "valid"

    ws = AsyncMock()
    mock_session.ws_connect = AsyncMock(return_value=ws)

    await client.connect_events()

    mock_session.ws_connect.assert_called_once()
    _, kwargs = mock_session.ws_connect.call_args
    assert kwargs.get("heartbeat") is not None


async def test_reset_session_creates_fresh_session(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """reset_session replaces the session and clears the token."""
    client._token = "valid"
    client._session = mock_session
    mock_session.closed = False
    mock_session.close = AsyncMock()

    with patch("custom_components.renson_smartliving.api.asyncio.sleep", new_callable=AsyncMock):
        client.reset_session()

        assert client._token is None
        assert client._session is None
        mock_session.close.assert_not_called()

        for task in list(client._closing):
            await task

    mock_session.close.assert_called_once()


async def test_read_response_raw_list(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """V1 API list responses are raw JSON arrays and are returned as-is."""
    client._token = "valid"
    thermostats = [{"id": 0, "name": "Living"}]

    mock_session.request = MagicMock(
        return_value=_mock_response(200, json_data=thermostats)
    )

    result = await client.get_thermostat_control()
    assert result == thermostats


async def test_read_response_empty_body(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """V1 API PUT returns 200 with an empty body."""
    client._token = "valid"

    mock_session.request = MagicMock(
        return_value=_mock_response(200, json_data=None, text="")
    )

    result = await client.set_thermostat_control(0, {"setpoint": 20.0})
    assert result == {}

    call_args = mock_session.request.call_args
    assert call_args.args[0] == "PUT"
    assert call_args.args[1].endswith("/api/thermostat/control/0")
    assert call_args.kwargs["json"] == {"setpoint": 20.0}
