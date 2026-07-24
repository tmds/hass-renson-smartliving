"""Tests for remove_stale_entities — cleaning up entities no longer on the gateway."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.light import OpenMoticsLight
from custom_components.renson_smartliving.entity import remove_stale_entities
from tests.fixtures import make_naming


def _make_light(coordinator: OpenMoticsCoordinator, unique_id: str) -> OpenMoticsLight:
    return OpenMoticsLight(
        coordinator=coordinator,
        naming=make_naming("light", unique_id=unique_id, name=unique_id),
        output_id=0,
        supports_brightness=False,
    )


def _make_reg_entry(domain: str, unique_id: str, entity_id: str) -> MagicMock:
    entry = MagicMock()
    entry.domain = domain
    entry.unique_id = unique_id
    entry.entity_id = entity_id
    return entry


async def test_removes_entity_no_longer_on_gateway(
    hass: HomeAssistant,
    coordinator: OpenMoticsCoordinator,
    mock_config_entry: MockConfigEntry,
) -> None:
    """An entity in the registry but not in current_entities gets removed."""
    current = [_make_light(coordinator, "light_a")]
    stale = _make_reg_entry("light", "light_gone", "light.gone")
    kept = _make_reg_entry("light", "light_a", "light.a")

    with patch(
        "custom_components.renson_smartliving.entity.er"
    ) as mock_er:
        mock_registry = MagicMock()
        mock_er.async_get.return_value = mock_registry
        mock_er.async_entries_for_config_entry.return_value = [stale, kept]

        remove_stale_entities(hass, mock_config_entry, "light", current)

        mock_registry.async_remove.assert_called_once_with("light.gone")


async def test_keeps_entities_still_on_gateway(
    hass: HomeAssistant,
    coordinator: OpenMoticsCoordinator,
    mock_config_entry: MockConfigEntry,
) -> None:
    """Entities matching current_entities are not removed."""
    current = [_make_light(coordinator, "light_a"), _make_light(coordinator, "light_b")]
    reg_a = _make_reg_entry("light", "light_a", "light.a")
    reg_b = _make_reg_entry("light", "light_b", "light.b")

    with patch(
        "custom_components.renson_smartliving.entity.er"
    ) as mock_er:
        mock_registry = MagicMock()
        mock_er.async_get.return_value = mock_registry
        mock_er.async_entries_for_config_entry.return_value = [reg_a, reg_b]

        remove_stale_entities(hass, mock_config_entry, "light", current)

        mock_registry.async_remove.assert_not_called()


async def test_only_removes_matching_domain(
    hass: HomeAssistant,
    coordinator: OpenMoticsCoordinator,
    mock_config_entry: MockConfigEntry,
) -> None:
    """Stale entries in a different domain are left alone."""
    current = []  # no current lights
    switch_entry = _make_reg_entry("switch", "switch_x", "switch.x")

    with patch(
        "custom_components.renson_smartliving.entity.er"
    ) as mock_er:
        mock_registry = MagicMock()
        mock_er.async_get.return_value = mock_registry
        mock_er.async_entries_for_config_entry.return_value = [switch_entry]

        remove_stale_entities(hass, mock_config_entry, "light", current)

        mock_registry.async_remove.assert_not_called()
