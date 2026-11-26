from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType, InvalidData

from custom_components.renson_smartliving.const import (
    CONF_HOST,
    DEFAULT_PRESET_EXPIRATION_HOURS,
    DOMAIN,
)
from tests.fixtures import PLATFORM_DETAILS


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_user_flow_success(hass: HomeAssistant) -> None:
    """Test the happy path: valid credentials create an entry with MAC unique_id."""
    with (
        patch(
            "custom_components.renson_smartliving.config_flow._connect_and_get_details",
            new_callable=AsyncMock,
            return_value=PLATFORM_DETAILS,
        ),
        patch(
            "custom_components.renson_smartliving.async_setup_entry",
            return_value=True,
        ),
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": "user"}
        )
        assert result["type"] is FlowResultType.FORM

        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_HOST: "192.168.1.100",
                "username": "admin",
                "password": "secret",
            },
        )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Smart Living Controller (192.168.1.100)"
    assert result["data"][CONF_HOST] == "192.168.1.100"
    assert result["result"].unique_id == "AA:BB:CC:DD:EE:FF"


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_options_flow_sets_preset_expiration(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """The options flow stores preset_expiration_hours and keeps other options."""
    hass.config_entries.async_update_entry(
        mock_config_entry, options={"existing_key": "keep-me"}
    )
    result = await hass.config_entries.options.async_init(mock_config_entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"

    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"min_dim_levels": "", "preset_expiration_hours": 3},
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["preset_expiration_hours"] == 3
    assert result["data"]["existing_key"] == "keep-me"


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_options_flow_preset_expiration_defaults_and_zero(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Default is the built-in default; 0 (permanent) is accepted."""
    result = await hass.config_entries.options.async_init(mock_config_entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"min_dim_levels": ""},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["preset_expiration_hours"] == DEFAULT_PRESET_EXPIRATION_HOURS

    result = await hass.config_entries.options.async_init(mock_config_entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"min_dim_levels": "", "preset_expiration_hours": 0},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["preset_expiration_hours"] == 0


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_options_flow_rejects_out_of_range(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Values outside 0-48 are rejected by the schema."""
    result = await hass.config_entries.options.async_init(mock_config_entry.entry_id)
    with pytest.raises(InvalidData):
        await hass.config_entries.options.async_configure(
            result["flow_id"],
            {"min_dim_levels": "", "preset_expiration_hours": 99},
        )
