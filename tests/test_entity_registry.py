"""Tests for entity registry updates in async_added_to_hass — name override and area assignment."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from custom_components.renson_smartliving.coordinator import EntityNaming, OpenMoticsCoordinator
from custom_components.renson_smartliving.light import OpenMoticsLight


def _make_entity(
    coordinator: OpenMoticsCoordinator,
    *,
    name: str = "Kitchen",
    room_id: int | None = None,
) -> OpenMoticsLight:
    return OpenMoticsLight(
        coordinator=coordinator,
        naming=EntityNaming(
            unique_id="test",
            friendly_name=name,
            hass_platform="light",
            object_id="kitchen",
        ),
        output_id=1,
        supports_brightness=False,
        room_id=room_id,
    )


@pytest.fixture
def mock_registry():
    with patch("custom_components.renson_smartliving.entity.er") as mock_er:
        registry = MagicMock()
        mock_er.async_get.return_value = registry
        yield registry


@pytest.fixture
def mock_super():
    with patch(
        "homeassistant.helpers.update_coordinator.CoordinatorEntity.async_added_to_hass"
    ), patch(
        "custom_components.renson_smartliving.entity.async_dispatcher_connect"
    ):
        yield


async def test_name_override_applied(
    coordinator: OpenMoticsCoordinator,
    mock_registry: MagicMock,
    mock_super: None,
) -> None:
    """Registry name is always set to _attr_name to prevent device-name prefixing."""
    entity = _make_entity(coordinator, name="Kitchen")
    await entity.async_added_to_hass()

    mock_registry.async_update_entity.assert_called_once_with(
        "light.kitchen", name="Kitchen",
    )


async def test_area_assigned_when_room_mapped(
    coordinator: OpenMoticsCoordinator,
    mock_registry: MagicMock,
    mock_super: None,
) -> None:
    """Area is set when the entity's room_id has a mapping in room_to_area."""
    coordinator.room_to_area = {5: "kitchen_area"}
    entity = _make_entity(coordinator, name="Kitchen", room_id=5)
    await entity.async_added_to_hass()

    mock_registry.async_update_entity.assert_called_once_with(
        "light.kitchen", name="Kitchen", area_id="kitchen_area",
    )


async def test_no_area_when_room_not_mapped(
    coordinator: OpenMoticsCoordinator,
    mock_registry: MagicMock,
    mock_super: None,
) -> None:
    """No area_id when room_id is set but absent from room_to_area."""
    coordinator.room_to_area = {}
    entity = _make_entity(coordinator, name="Kitchen", room_id=99)
    await entity.async_added_to_hass()

    mock_registry.async_update_entity.assert_called_once_with(
        "light.kitchen", name="Kitchen",
    )


async def test_no_area_when_no_room(
    coordinator: OpenMoticsCoordinator,
    mock_registry: MagicMock,
    mock_super: None,
) -> None:
    """No area_id when room_id is None."""
    entity = _make_entity(coordinator)
    await entity.async_added_to_hass()

    mock_registry.async_update_entity.assert_called_once_with(
        "light.kitchen", name="Kitchen",
    )
