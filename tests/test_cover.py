from __future__ import annotations

from homeassistant.components.cover import CoverEntityFeature

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


async def test_set_cover_position_mapping(coordinator: OpenMoticsCoordinator) -> None:
    """HA 100=open -> OM 0, HA 0=closed -> OM 99, midpoint stays midpoint."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )

    await cover.async_set_cover_position(position=100)
    args = coordinator.client.shutter_goto.call_args
    assert args.args == (0, 0)

    await cover.async_set_cover_position(position=0)
    args = coordinator.client.shutter_goto.call_args
    assert args.args == (0, 99)

    await cover.async_set_cover_position(position=50)
    args = coordinator.client.shutter_goto.call_args
    om = args.args[1]
    assert 49 <= om <= 50

    # out-of-range values are clamped before conversion
    await cover.async_set_cover_position(position=250)
    assert coordinator.client.shutter_goto.call_args.args == (0, 0)


async def test_cover_advertises_set_position(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """The cover must advertise SET_POSITION or HA hides the position slider."""
    cover = OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Blinds"),
        shutter_id=0,
    )
    assert cover.supported_features & CoverEntityFeature.SET_POSITION
