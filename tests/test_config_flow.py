from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.renson_smartliving.const import CONF_HOST, DOMAIN
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
