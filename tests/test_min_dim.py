"""Tests for the set_min_dim_levels service."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.renson_smartliving import (
    OpenMoticsRuntimeData,
    async_setup,
)
from custom_components.renson_smartliving.api import OpenMoticsClient
from custom_components.renson_smartliving.const import CONF_MIN_DIM_LEVELS, DOMAIN
from custom_components.renson_smartliving.coordinator import (
    GatewayInfo,
    OpenMoticsCoordinator,
)


async def _setup_with_entry(hass: HomeAssistant, options: dict | None = None):
    """Register services and provide one entry with a mock client."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"host": "192.168.1.100", "username": "admin", "password": "secret"},
        options=options or {},
    )
    entry.add_to_hass(hass)
    client = AsyncMock(spec=OpenMoticsClient)
    coordinator = OpenMoticsCoordinator(hass, client, entry)
    coordinator.gateway_info = GatewayInfo(device_id="aabbccddeeff")
    entry.runtime_data = OpenMoticsRuntimeData(coordinator=coordinator)
    await async_setup(hass, {})
    return entry, coordinator


async def test_set_min_dim_levels_writes_options(hass: HomeAssistant) -> None:
    """The service maps light entity ids to output ids in the options."""
    entry, coordinator = await _setup_with_entry(hass)
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["light.living"] = SimpleNamespace(
        coordinator=coordinator, entity_id="light.living", _om_id=27
    )

    await hass.services.async_call(
        DOMAIN,
        "set_min_dim_levels",
        {"levels": [{"entity_id": "light.living", "percent": 12}]},
        blocking=True,
    )

    assert entry.options[CONF_MIN_DIM_LEVELS] == "27:12"


async def test_set_min_dim_levels_merges_and_clears(hass: HomeAssistant) -> None:
    """Existing levels are kept; percent 0 removes a level."""
    entry, coordinator = await _setup_with_entry(
        hass, options={CONF_MIN_DIM_LEVELS: "27:12,21:30"}
    )
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["light.living"] = SimpleNamespace(
        coordinator=coordinator, entity_id="light.living", _om_id=27
    )
    registry["light.kitchen"] = SimpleNamespace(
        coordinator=coordinator, entity_id="light.kitchen", _om_id=21
    )

    await hass.services.async_call(
        DOMAIN,
        "set_min_dim_levels",
        {
            "levels": [
                {"entity_id": "light.living", "percent": 0},
                {"entity_id": "light.kitchen", "percent": 25},
            ]
        },
        blocking=True,
    )

    assert entry.options[CONF_MIN_DIM_LEVELS] == "21:25"


async def test_set_min_dim_levels_rejects_non_light(hass: HomeAssistant) -> None:
    """Only OpenMotics lights are accepted."""
    _entry, coordinator = await _setup_with_entry(hass)
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["switch.fan"] = SimpleNamespace(
        coordinator=coordinator, entity_id="switch.fan", _om_id=3
    )

    with pytest.raises(ValueError):
        await hass.services.async_call(
            DOMAIN,
            "set_min_dim_levels",
            {"levels": [{"entity_id": "switch.fan", "percent": 10}]},
            blocking=True,
        )
