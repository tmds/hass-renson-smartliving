from __future__ import annotations

from custom_components.renson_smartliving.coordinator import (
    OpenMoticsCoordinator,
    RoomInfo,
    _expand_truncated_name,
)


async def test_naming_room_equals_name(coordinator: OpenMoticsCoordinator) -> None:
    """When room name == entity name, room is in unique_id but not entity_id."""
    coordinator.rooms = {1: RoomInfo(id=1, name="Kitchen", floor=0)}

    naming = coordinator.resolve_entity_naming("Kitchen", 1, "light", 10, "light")

    assert "kitchen_kitchen" in naming.unique_id
    assert naming.suggested_entity_id == "light.kitchen"


async def test_naming_room_differs_from_name(coordinator: OpenMoticsCoordinator) -> None:
    """When room name != entity name, room appears in both unique_id and entity_id."""
    coordinator.rooms = {1: RoomInfo(id=1, name="Kitchen", floor=0)}

    naming = coordinator.resolve_entity_naming("Ceiling", 1, "light", 11, "light")

    assert "kitchen_ceiling" in naming.unique_id
    assert naming.suggested_entity_id == "light.kitchen_ceiling"


async def test_naming_no_room(coordinator: OpenMoticsCoordinator) -> None:
    """When room_id is None, unique_id and entity_id use just the name."""
    naming = coordinator.resolve_entity_naming("Doorbell", None, "input", 5, "event")

    assert "doorbell" in naming.unique_id
    assert "input_5_doorbell" in naming.unique_id
    assert naming.suggested_entity_id == "event.doorbell"


def test_expand_truncated_name_matches_room() -> None:
    """Truncated name whose first 16 chars match room name is expanded."""
    assert _expand_truncated_name("Slaapkamer Ouder", "Slaapkamer Ouders") == "Slaapkamer Ouders"


def test_expand_truncated_name_no_match() -> None:
    """Name that doesn't match room is returned as-is."""
    assert _expand_truncated_name("Garage", "Slaapkamer Ouders") == "Garage"


def test_expand_truncated_name_long_room() -> None:
    """Longer room name is expanded when first 16 chars match."""
    assert _expand_truncated_name("Very Long Room N", "Very Long Room Name Here") == "Very Long Room Name Here"


def test_expand_truncated_name_short_room() -> None:
    """Room name <= 16 chars is never expanded (no truncation possible)."""
    assert _expand_truncated_name("Garage", "Garage") == "Garage"


def test_expand_truncated_name_no_room() -> None:
    """Empty room name returns the name unchanged."""
    assert _expand_truncated_name("Something", "") == "Something"


async def test_naming_truncated_name_expanded(coordinator: OpenMoticsCoordinator) -> None:
    """Truncated sensor name is expanded to full room name for entity_id and friendly_name."""
    coordinator.rooms = {12: RoomInfo(id=12, name="Slaapkamer Ouders", floor=255)}

    naming = coordinator.resolve_entity_naming(
        "Slaapkamer Ouder", 12, "sensor_temperature", 5, "sensor",
    )

    assert naming.friendly_name == "Slaapkamer Ouders"
    assert naming.suggested_entity_id == "sensor.slaapkamer_ouders"


async def test_naming_entity_id_prefix(coordinator: OpenMoticsCoordinator) -> None:
    """entity_id_prefix is prepended to the entity_id but not the friendly_name."""
    coordinator.rooms = {12: RoomInfo(id=12, name="Slaapkamer Ouders", floor=255)}

    naming = coordinator.resolve_entity_naming(
        "Slaapkamer Ouders", 12, "sensor_temperature", 5, "sensor",
        entity_id_prefix="temp",
    )

    assert naming.friendly_name == "Slaapkamer Ouders"
    assert naming.suggested_entity_id == "sensor.temp_slaapkamer_ouders"
