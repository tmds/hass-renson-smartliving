from __future__ import annotations

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.cover import OpenMoticsCover
from tests.fixtures import make_naming


async def test_position_mapping_boundaries(coordinator: OpenMoticsCoordinator) -> None:
    """OM 0=open -> HA 100, OM 99=closed -> HA 0, OM 50 -> midpoint."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )

    coordinator._shutter_states[0] = {"state": "UP", "position": 0}
    assert cover.current_cover_position == 100
    assert cover.is_closed is False

    coordinator._shutter_states[0] = {"state": "DOWN", "position": 99}
    assert cover.current_cover_position == 0
    assert cover.is_closed is True

    coordinator._shutter_states[0] = {"state": "STOPPED", "position": 50}
    pos = cover.current_cover_position
    assert 49 <= pos <= 51

    coordinator._shutter_states[0] = {"state": "STOPPED", "position": None}
    assert cover.current_cover_position is None
    assert cover.is_closed is None
