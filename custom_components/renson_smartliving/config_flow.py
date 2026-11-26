from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import callback

from .api import AuthenticationError, OpenMoticsClient
from .const import (
    CONF_HOST,
    CONF_MIN_DIM_LEVELS,
    CONF_PRESET_EXPIRATION_HOURS,
    DEFAULT_PRESET_EXPIRATION_HOURS,
    DOMAIN,
    parse_min_dim_levels,
)

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


class OpenMoticsOptionsFlowHandler(OptionsFlow):
    """Options flow: per-output minimum dim levels and preset expiration."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            raw = user_input.get(CONF_MIN_DIM_LEVELS, "")
            parsed = parse_min_dim_levels(raw)
            hours = user_input.get(
                CONF_PRESET_EXPIRATION_HOURS, DEFAULT_PRESET_EXPIRATION_HOURS
            )
            if raw and not parsed:
                errors["base"] = "invalid_min_dim"
            else:
                # Options are replaced wholesale on save: carry over anything
                # already set so the dim-level save cannot drop other keys.
                data = dict(self.config_entry.options)
                data[CONF_MIN_DIM_LEVELS] = raw.strip()
                data[CONF_PRESET_EXPIRATION_HOURS] = int(hours)
                return self.async_create_entry(title="", data=data)
        current = self.config_entry.options.get(CONF_MIN_DIM_LEVELS, "")
        current_hours = self.config_entry.options.get(
            CONF_PRESET_EXPIRATION_HOURS, DEFAULT_PRESET_EXPIRATION_HOURS
        )
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_MIN_DIM_LEVELS,
                    default=current,
                    description={"suggested_value": current},
                ): str,
                vol.Optional(
                    CONF_PRESET_EXPIRATION_HOURS,
                    default=current_hours,
                    description={"suggested_value": current_hours},
                ): vol.All(vol.Coerce(int), vol.Range(min=0, max=48)),
            }
        )
        return self.async_show_form(
            step_id="init", data_schema=schema, errors=errors
        )


class OpenMoticsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Config flow for OpenMotics gateway."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> OpenMoticsOptionsFlowHandler:
        """Get the options flow for this handler."""
        return OpenMoticsOptionsFlowHandler()

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
                # MAC address as unique_id prevents duplicate entries
                # for the same gateway.
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

