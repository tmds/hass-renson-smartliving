from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.renson_smartliving.api import (
    AuthenticationError,
    OpenMoticsClient,
    OpenMoticsError,
)


def _mock_response(status: int = 200, json_data: dict | None = None):
    """Create a mock aiohttp response usable as an async context manager."""
    resp = AsyncMock()
    resp.status = status
    resp.json = AsyncMock(return_value=json_data or {})
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
    resp.json = AsyncMock(return_value={"success": False, "msg": "Not found"})

    with pytest.raises(OpenMoticsError, match="Not found"):
        await OpenMoticsClient._read_response("/path", resp)
