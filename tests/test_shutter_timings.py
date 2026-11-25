from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant

from custom_components.renson_smartliving.api import OpenMoticsClient
from custom_components.renson_smartliving.const import DOMAIN
from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from custom_components.renson_smartliving.cover import OpenMoticsCover
from tests.fixtures import make_naming, mock_response


async def test_set_shutter_configuration_sends_form_param(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """set_shutter_configuration posts the config as a query param."""
    client._token = "tok"  # noqa: SLF001, S105
    mock_session.request.return_value = mock_response(200, {"success": True})

    await client.set_shutter_configuration({"id": 4, "timer_up": 28})

    args, kwargs = mock_session.request.call_args
    assert args[0] == "POST"
    assert args[1].endswith("/set_shutter_configuration")
    assert kwargs["params"] == {"config": json.dumps({"id": 4, "timer_up": 28})}


# -- Entity attributes --


def _cover(coordinator: OpenMoticsCoordinator, shutter_id: int = 4) -> OpenMoticsCover:
    return OpenMoticsCover(
        coordinator=coordinator,
        naming=make_naming("cover", unique_id="test_cover", name="Screen"),
        shutter_id=shutter_id,
    )


def test_cover_exposes_timer_attributes(coordinator: OpenMoticsCoordinator) -> None:
    coordinator.shutters = [
        {"id": 4, "name": "screen keuken", "timer_up": 28, "timer_down": 27}
    ]
    cover = _cover(coordinator)
    assert cover.extra_state_attributes == {"openmotics_id": 4, "timer_up": 28, "timer_down": 27}


def test_cover_timer_attributes_without_config(
    coordinator: OpenMoticsCoordinator,
) -> None:
    coordinator.shutters = []
    cover = _cover(coordinator)
    assert cover.extra_state_attributes == {"openmotics_id": 4, "timer_up": None, "timer_down": None}


# -- Service --


async def test_set_shutter_timings_sends_full_config(
    hass: HomeAssistant, coordinator: OpenMoticsCoordinator
) -> None:
    """The service must merge the new timers into the COMPLETE config
    (the gateway resets missing fields to defaults)."""
    from custom_components.renson_smartliving import _async_set_shutter_timings

    coordinator.shutters = [
        {
            "id": 4,
            "name": "screen keuken",
            "timer_up": 28,
            "timer_down": 27,
            "up_down_config": 1,
            "room": 1,
            "steps": 65535,
        }
    ]
    cover = _cover(coordinator)
    cover.hass = hass
    cover.entity_id = "cover.screen_keuken"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["cover.screen_keuken"] = cover

    call = MagicMock()
    call.hass = hass
    call.data = {
        ATTR_ENTITY_ID: ["cover.screen_keuken"],
        "timer_up": 30,
        "timer_down": 25,
    }
    await _async_set_shutter_timings(call)

    config = coordinator.client.set_shutter_configuration.call_args.args[0]
    assert config["id"] == 4
    assert config["timer_up"] == 30
    assert config["timer_down"] == 25
    # de bestaande velden moeten mee verstuurd worden
    assert config["name"] == "screen keuken"
    assert config["up_down_config"] == 1
    assert config["room"] == 1
    # lokale cache bijgewerkt
    assert coordinator.shutters[0]["timer_up"] == 30
    assert coordinator.shutters[0]["timer_down"] == 25


async def test_set_shutter_timings_rejects_non_cover(
    hass: HomeAssistant, coordinator: OpenMoticsCoordinator
) -> None:
    from custom_components.renson_smartliving import _async_set_shutter_timings

    entity = MagicMock()
    entity.entity_id = "light.tafel_licht"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["light.tafel_licht"] = entity

    call = MagicMock()
    call.hass = hass
    call.data = {ATTR_ENTITY_ID: ["light.tafel_licht"], "timer_up": 30}
    with pytest.raises(ValueError, match="not an OpenMotics shutter"):
        await _async_set_shutter_timings(call)
