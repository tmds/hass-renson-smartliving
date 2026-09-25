from __future__ import annotations

import logging
import ssl
from typing import Any

import aiohttp
from homeassistant.exceptions import HomeAssistantError

_LOGGER = logging.getLogger(__name__)
_HTTP_LOGGER = logging.getLogger("custom_components.renson_smartliving.http")

WS_SUBSCRIPTION_TYPES = [
    # Config (flushed by sync/control)
    "OUTPUT_CONTROL",
    "INPUT_CONTROL",
    "SENSOR_CONTROL",
    "SHUTTER_CONTROL",
    "ROOM_CONTROL",
    "GROUP_ACTION_CONTROL",
    # System (flushed by sync/control)
    "VERSION",
    "PLATFORM_DETAILS",
    # State changes (real-time)
    "OUTPUT_CHANGE",
    "INPUT_CHANGE",
    "SENSOR_CHANGE",
    "SHUTTER_CHANGE",
]


def _create_ssl_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class OpenMoticsError(HomeAssistantError):
    """Raised when a gateway API call fails."""

    def __init__(self, msg: str, status: int | None = None) -> None:
        super().__init__(msg)
        self.status = status


class AuthenticationError(OpenMoticsError):
    """Raised when login fails."""


class OpenMoticsClient:
    """API client for an OpenMotics gateway (V0 local HTTPS API)."""

    def __init__(self, host: str, username: str, password: str) -> None:
        self._host = host
        self._username = username
        self._password = password
        self._token: str | None = None
        self._ssl = _create_ssl_context()
        self._session: aiohttp.ClientSession | None = None

    @property
    def host(self) -> str:
        return self._host

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30)
            )
        return self._session

    @property
    def _base_url(self) -> str:
        return f"https://{self._host}"

    async def login(self) -> None:
        """Authenticate with the gateway and store the token."""
        session = self._get_session()
        url = (
            f"{self._base_url}/login"
            f"?username={self._username}"
            f"&password={self._password}"
            f"&accept_terms=true&timeout=30"
        )
        async with session.get(url, ssl=self._ssl) as resp:
            data = await resp.json()
            if not data.get("success"):
                raise AuthenticationError(
                    data.get("msg", "Login failed")
                )
            self._token = data["token"]

    async def _request(
        self, method: str, path: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Make an authenticated request, re-login and retry on 401 (token expiry)."""
        if self._token is None:
            await self.login()

        session = self._get_session()
        url = f"{self._base_url}{path}"
        headers = {"Authorization": f"Bearer {self._token}"}
        _HTTP_LOGGER.debug("%s %s %s", method, path, params or "")

        async with session.request(
            method, url, params=params, headers=headers, ssl=self._ssl
        ) as resp:
            if resp.status == 401:
                _HTTP_LOGGER.debug("Token expired, re-authenticating")
                await self.login()
                headers = {"Authorization": f"Bearer {self._token}"}
                async with session.request(
                    method, url, params=params, headers=headers, ssl=self._ssl
                ) as retry_resp:
                    return await self._read_response(path, retry_resp)
            return await self._read_response(path, resp)

    @staticmethod
    async def _read_response(path: str, resp: aiohttp.ClientResponse) -> dict[str, Any]:
        """Read, log, and validate a gateway response."""
        if resp.status >= 400:
            raise OpenMoticsError(f"HTTP {resp.status}", status=resp.status)
        if resp.status == 204:
            _HTTP_LOGGER.debug("%s -> 204 No Content", path)
            return {}
        data = await resp.json()
        _HTTP_LOGGER.debug("%s -> %s", path, data)
        if not data.get("success", True):
            raise OpenMoticsError(data.get("msg", "Unknown error"))
        return data

    async def get(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        return await self._request("GET", path, params)

    async def post(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        return await self._request("POST", path, params)

    # -- Sync --

    async def trigger_sync(self) -> None:
        """Trigger the gateway to flush all config through the WebSocket."""
        await self.get("/api/sync/control")

    # -- Gateway info --

    async def get_platform_details(self) -> dict[str, Any]:
        return await self.get("/get_platform_details")

    async def get_version(self) -> dict[str, Any]:
        return await self.get("/get_version")

    # -- Status (needed for initial state) --

    async def get_output_status(self) -> list[dict[str, Any]]:
        data = await self.get("/get_output_status")
        return data.get("status", [])

    async def get_shutter_status(self) -> dict[str, Any]:
        return await self.get("/get_shutter_status")

    async def get_input_configurations(self) -> list[dict[str, Any]]:
        data = await self.get("/get_input_configurations")
        return data.get("config", [])

    # -- Commands --

    async def set_output(
        self,
        output_id: int,
        is_on: bool,
        dimmer: int | None = None,
        timer: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"id": output_id, "is_on": str(is_on).lower()}
        if dimmer is not None:
            params["dimmer"] = dimmer
        if timer is not None:
            params["timer"] = timer
        return await self.post("/set_output", params)

    async def shutter_up(self, shutter_id: int) -> dict[str, Any]:
        return await self.get("/do_shutter_up", {"id": shutter_id})

    async def shutter_down(self, shutter_id: int) -> dict[str, Any]:
        return await self.get("/do_shutter_down", {"id": shutter_id})

    async def shutter_stop(self, shutter_id: int) -> dict[str, Any]:
        return await self.get("/do_shutter_stop", {"id": shutter_id})

    async def do_group_action(self, group_action_id: int) -> dict[str, Any]:
        return await self.post("/do_group_action", {"group_action_id": group_action_id})

    # -- WebSocket --

    async def connect_events(self) -> aiohttp.ClientWebSocketResponse:
        """Open a WebSocket connection for real-time events."""
        if self._token is None:
            await self.login()

        session = self._get_session()
        ws_url = f"wss://{self._host}/ws_events?report_all=false&serialization=json"
        ws = await session.ws_connect(
            ws_url,
            headers={"Authorization": f"Bearer {self._token}"},
            ssl=self._ssl,
        )
        await ws.send_json(
            {
                "type": "ACTION",
                "data": {
                    "action": "set_subscription",
                    "types": WS_SUBSCRIPTION_TYPES,
                },
            }
        )
        return ws

    async def close(self) -> None:
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None
