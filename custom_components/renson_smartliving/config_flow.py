from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME

from .api import AuthenticationError, OpenMoticsClient
from .const import CONF_HOST, DOMAIN

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Required(CONF_USERNAME): str,
        vol.Required(CONF_PASSWORD): str,
    }
)


async def _connect_and_get_details(
    user_input: dict[str, Any],
) -> dict[str, Any]:
    """Validate credentials and return platform_details or raise."""
    client = OpenMoticsClient(
        host=user_input[CONF_HOST],
        username=user_input[CONF_USERNAME],
        password=user_input[CONF_PASSWORD],
    )
    try:
        await client.login()
        return await client.get_platform_details()
    finally:
        await client.close()


class OpenMoticsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Config flow for OpenMotics gateway."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                platform_details = await _connect_and_get_details(user_input)
            except AuthenticationError:
                errors["base"] = "invalid_auth"
            except Exception:
                _LOGGER.exception("Unexpected error during config flow")
                errors["base"] = "cannot_connect"
            else:
                # MAC address as unique_id prevents duplicate entries for the same gateway.
                mac = platform_details.get("mac_address", "")
                await self.async_set_unique_id(mac)
                self._abort_if_unique_id_configured()

                user_input["platform_details"] = platform_details

                return self.async_create_entry(
                    title=f"Smart Living Controller ({user_input[CONF_HOST]})",
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )

