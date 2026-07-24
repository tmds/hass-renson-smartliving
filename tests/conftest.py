from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.renson_smartliving.api import OpenMoticsClient
from custom_components.renson_smartliving.const import CONF_HOST, DOMAIN
from custom_components.renson_smartliving.coordinator import (
    GatewayInfo,
    OpenMoticsCoordinator,
)
from tests.fixtures import PLATFORM_DETAILS


@pytest.fixture
def mock_config_entry(hass: HomeAssistant) -> MockConfigEntry:
    """Create a mock config entry."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Smart Living Controller (192.168.1.100)",
        data={
            CONF_HOST: "192.168.1.100",
            CONF_USERNAME: "admin",
            CONF_PASSWORD: "secret",
            "platform_details": PLATFORM_DETAILS,
        },
    )
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
def coordinator(
    hass: HomeAssistant, mock_config_entry: MockConfigEntry
) -> OpenMoticsCoordinator:
    """Create a coordinator with a mock client and dummy gateway info."""
    client = AsyncMock(spec=OpenMoticsClient)
    coord = OpenMoticsCoordinator(hass, client, mock_config_entry)
    coord.gateway_info = GatewayInfo(device_id="aabbccddeeff")
    return coord


@pytest.fixture
def mock_dispatcher():
    """Patch async_dispatcher_send and yield the mock."""
    with patch(
        "custom_components.renson_smartliving.coordinator.async_dispatcher_send"
    ) as mock:
        yield mock
