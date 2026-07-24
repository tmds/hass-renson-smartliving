from __future__ import annotations

from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.light import OpenMoticsLight
from tests.fixtures import make_naming


async def test_brightness_conversion_boundaries(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """OM 0-100 dimmer <-> HA 0-255 brightness at boundaries."""
    light = OpenMoticsLight(
        coordinator=coordinator,
        naming=make_naming("light", unique_id="test_light", name="Ceiling"),
        output_id=0,
        supports_brightness=True,
    )

    # OM 0 -> HA 0
    coordinator._output_states[0] = {"on": False, "dimmer": 0}
    assert light.brightness == 0

    # OM 100 -> HA 255
    coordinator._output_states[0] = {"on": True, "dimmer": 100}
    assert light.brightness == 255

    # OM 50 -> HA ~128
    coordinator._output_states[0] = {"on": True, "dimmer": 50}
    assert 127 <= light.brightness <= 128

    # Round-trip: HA 255 -> OM -> HA should stay 255
    await light.async_turn_on(brightness=255)
    call_args = coordinator.client.set_output.call_args
    dimmer_sent = call_args.kwargs.get("dimmer") or call_args[1].get("dimmer")
    assert dimmer_sent == 100

    coordinator.client.set_output.reset_mock()

    # Round-trip: HA 0 -> OM -> HA should stay 0
    await light.async_turn_on(brightness=1)
    call_args = coordinator.client.set_output.call_args
    dimmer_sent = call_args.kwargs.get("dimmer") or call_args[1].get("dimmer")
    assert dimmer_sent >= 0
