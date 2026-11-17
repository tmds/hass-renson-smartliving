from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall

from custom_components.renson_smartliving.api import OpenMoticsClient
from custom_components.renson_smartliving.const import DOMAIN
from custom_components.renson_smartliving.event import OpenMoticsEvent, _linked_output


def _mock_response(
    status: int = 200, json_data: dict | list | None = None, text: str | None = None
):
    """Create a mock aiohttp response usable as an async context manager."""
    resp = AsyncMock()
    resp.status = status
    if text is None:
        text = "" if json_data is None else json.dumps(json_data)
    resp.text = AsyncMock(return_value=text)
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


# -- API --


@pytest.fixture
def client():
    return OpenMoticsClient("gw.local", "user", "pass")


@pytest.fixture
def mock_session(client: OpenMoticsClient):
    """Create a mock aiohttp session and patch it onto the client."""
    session = MagicMock()
    with patch.object(client, "_get_session", return_value=session):
        yield session


async def test_set_input_configuration_sends_form_param(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """set_input_configuration posts the config as a query param (legacy API)."""
    client._token = "tok"  # noqa: SLF001, S105
    mock_session.request.return_value = _mock_response(200, {"success": True})

    await client.set_input_configuration({"id": 0, "action": 23})

    args, kwargs = mock_session.request.call_args
    assert args[0] == "POST"
    assert args[1].endswith("/set_input_configuration")
    assert kwargs["params"] == {"config": json.dumps({"id": 0, "action": 23})}


# -- Linked output attributes --


def _event_entity(coord, input_id: int) -> OpenMoticsEvent:
    naming = coord.resolve_entity_naming(
        "test input", None, "input", input_id, "event"
    )
    return OpenMoticsEvent(coordinator=coord, naming=naming, input_id=input_id)


def test_linked_output_direct_link(coordinator) -> None:
    coordinator.inputs = [{"id": 5, "name": "btn", "action": 23}]
    coordinator.outputs = [{"id": 23, "name": "tafel licht"}]
    assert _linked_output(coordinator, 5) == {"id": 23, "name": "tafel licht"}


def test_linked_output_unknown_output(coordinator) -> None:
    coordinator.inputs = [{"id": 5, "name": "btn", "action": 99}]
    coordinator.outputs = []
    assert _linked_output(coordinator, 5) == {"id": 99, "name": None}


def test_linked_output_unlinked(coordinator) -> None:
    for action in (None, 255, 240, 241):
        coordinator.inputs = [{"id": 5, "name": "btn", "action": action}]
        assert _linked_output(coordinator, 5) is None, action


def test_linked_output_missing_input(coordinator) -> None:
    coordinator.inputs = []
    assert _linked_output(coordinator, 7) is None


def test_event_entity_attributes(coordinator) -> None:
    coordinator.inputs = [{"id": 5, "name": "btn", "action": 23}]
    coordinator.outputs = [{"id": 23, "name": "tafel licht"}]
    entity = _event_entity(coordinator, 5)
    assert entity.extra_state_attributes == {
        "openmotics_id": 5,
        "linked_output_id": 23,
        "linked_output_name": "tafel licht",
    }


def test_event_entity_attributes_unlinked(coordinator) -> None:
    coordinator.inputs = [{"id": 5, "name": "btn", "action": 255}]
    entity = _event_entity(coordinator, 5)
    assert entity.extra_state_attributes == {"openmotics_id": 5}


# -- Service --


async def test_set_input_link_service_links(
    hass: HomeAssistant, coordinator
) -> None:
    """The service writes action=<output_id> and updates the local cache."""
    from custom_components.renson_smartliving import _async_set_input_link

    coordinator.inputs = [{"id": 5, "name": "btn", "action": 255}]
    coordinator.outputs = [{"id": 23, "name": "tafel licht"}]

    input_entity = _event_entity(coordinator, 5)
    input_entity.hass = hass
    input_entity.entity_id = "event.test_input"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test_input"] = input_entity

    output_entity = MagicMock()
    output_entity.entity_id = "light.tafel_licht"
    output_entity._om_id = 23
    registry["light.tafel_licht"] = output_entity

    call = ServiceCall(
        hass,
        DOMAIN,
        "set_input_link",
        {ATTR_ENTITY_ID: ["event.test_input"], "output_entity": "light.tafel_licht"},
    )

    with patch.object(
        coordinator.client, "set_input_configuration", new_callable=AsyncMock
    ) as mock_write:
        await _async_set_input_link(call)

    mock_write.assert_awaited_once_with({"id": 5, "action": 23})
    assert coordinator.inputs[0]["action"] == 23


async def test_set_input_link_service_unlinks(
    hass: HomeAssistant, coordinator
) -> None:
    """No output means unlink: action 255."""
    from custom_components.renson_smartliving import _async_set_input_link

    coordinator.inputs = [{"id": 5, "name": "btn", "action": 23}]

    input_entity = _event_entity(coordinator, 5)
    input_entity.hass = hass
    input_entity.entity_id = "event.test_input"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test_input"] = input_entity

    call = ServiceCall(
        hass, DOMAIN, "set_input_link", {ATTR_ENTITY_ID: ["event.test_input"]}
    )

    with patch.object(
        coordinator.client, "set_input_configuration", new_callable=AsyncMock
    ) as mock_write:
        await _async_set_input_link(call)

    mock_write.assert_awaited_once_with({"id": 5, "action": 255})
    assert coordinator.inputs[0]["action"] is None


async def test_set_input_link_preserves_basic_actions(
    hass: HomeAssistant, coordinator
) -> None:
    """Existing extended actions are sent along (the gateway resets them)."""
    from custom_components.renson_smartliving import _async_set_input_link

    coordinator.inputs = [
        {"id": 5, "name": "btn", "action": 240, "basic_actions": "2,1"}
    ]

    input_entity = _event_entity(coordinator, 5)
    input_entity.hass = hass
    input_entity.entity_id = "event.test_input"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test_input"] = input_entity

    output_entity = MagicMock()
    output_entity.entity_id = "light.tafel_licht"
    output_entity._om_id = 23
    registry["light.tafel_licht"] = output_entity

    call = ServiceCall(
        hass,
        DOMAIN,
        "set_input_link",
        {
            ATTR_ENTITY_ID: ["event.test_input"],
            "output_entity": "light.tafel_licht",
            "force": True,
        },
    )

    with patch.object(
        coordinator.client, "set_input_configuration", new_callable=AsyncMock
    ) as mock_write:
        await _async_set_input_link(call)

    mock_write.assert_awaited_once_with(
        {"id": 5, "action": 23, "basic_actions": "2,1"}
    )


def test_event_entity_attributes_extended_actions(coordinator) -> None:
    coordinator.inputs = [
        {"id": 5, "name": "btn", "action": 240, "basic_actions": "2,1"}
    ]
    entity = _event_entity(coordinator, 5)
    assert entity.extra_state_attributes == {
        "openmotics_id": 5,
        "has_extended_actions": True,
    }


def test_linked_output_shutter_toggle(coordinator) -> None:
    coordinator.inputs = [
        {"id": 21, "name": "btn", "action": 240, "basic_actions": "103,22"}
    ]
    coordinator.shutters = [{"id": 22, "name": "bureau screen"}]
    assert _linked_output(coordinator, 21) == {"id": 22, "name": "bureau screen"}


def test_linked_output_shutter_unknown(coordinator) -> None:
    coordinator.inputs = [
        {"id": 21, "name": "btn", "action": 240, "basic_actions": "103,99"}
    ]
    coordinator.shutters = []
    assert _linked_output(coordinator, 21) == {"id": 99, "name": None}


def test_has_extended_actions_false_cases(coordinator) -> None:
    from custom_components.renson_smartliving.event import _has_extended_actions

    assert not _has_extended_actions({"action": 255, "basic_actions": ""})
    assert not _has_extended_actions({"action": 15, "basic_actions": ""})
    assert not _has_extended_actions({"action": 240, "basic_actions": ""})
    assert not _has_extended_actions({"action": 240, "basic_actions": "103,22"})
    assert _has_extended_actions({"action": 240, "basic_actions": "2,1"})
    assert _has_extended_actions(
        {"action": 240, "basic_actions": "207,2,236,0,2,1,236,255"}
    )


async def test_set_input_link_cover_uses_shutter_toggle(
    hass: HomeAssistant, coordinator
) -> None:
    """A cover target writes the classic shutter toggle 103,<shutter>."""
    from custom_components.renson_smartliving import _async_set_input_link

    coordinator.inputs = [{"id": 5, "name": "btn", "action": 255}]
    input_entity = _event_entity(coordinator, 5)
    input_entity.hass = hass
    input_entity.entity_id = "event.test_input"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test_input"] = input_entity

    cover_entity = MagicMock()
    cover_entity.entity_id = "cover.bureau_screen"
    cover_entity._om_id = 22
    registry["cover.bureau_screen"] = cover_entity

    call = ServiceCall(
        hass,
        DOMAIN,
        "set_input_link",
        {ATTR_ENTITY_ID: ["event.test_input"], "output_entity": "cover.bureau_screen"},
    )
    with patch.object(
        coordinator.client, "set_input_configuration", new_callable=AsyncMock
    ) as mock_write:
        await _async_set_input_link(call)
    mock_write.assert_awaited_once_with(
        {"id": 5, "action": 240, "basic_actions": "103,22"}
    )


async def test_set_input_link_requires_force_on_extended(
    hass: HomeAssistant, coordinator
) -> None:
    """Inputs with extended actions refuse a plain link."""
    from custom_components.renson_smartliving import _async_set_input_link

    coordinator.inputs = [
        {"id": 5, "name": "btn", "action": 240, "basic_actions": "2,1"}
    ]
    input_entity = _event_entity(coordinator, 5)
    input_entity.hass = hass
    input_entity.entity_id = "event.test_input"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test_input"] = input_entity

    output_entity = MagicMock()
    output_entity.entity_id = "light.tafel_licht"
    output_entity._om_id = 23
    registry["light.tafel_licht"] = output_entity

    call = ServiceCall(
        hass,
        DOMAIN,
        "set_input_link",
        {ATTR_ENTITY_ID: ["event.test_input"], "output_entity": "light.tafel_licht"},
    )
    with pytest.raises(ValueError, match="force=true"):
        await _async_set_input_link(call)

    # With force the write goes through and basic_actions is preserved.
    call_force = ServiceCall(
        hass,
        DOMAIN,
        "set_input_link",
        {
            ATTR_ENTITY_ID: ["event.test_input"],
            "output_entity": "light.tafel_licht",
            "force": True,
        },
    )
    with patch.object(
        coordinator.client, "set_input_configuration", new_callable=AsyncMock
    ) as mock_write:
        await _async_set_input_link(call_force)
    mock_write.assert_awaited_once_with(
        {"id": 5, "action": 23, "basic_actions": "2,1"}
    )


async def test_set_input_link_unlink_extended_requires_force(
    hass: HomeAssistant, coordinator
) -> None:
    """Unlinking an extended input would erase its actions: refuse."""
    from custom_components.renson_smartliving import _async_set_input_link

    coordinator.inputs = [
        {"id": 5, "name": "btn", "action": 240, "basic_actions": "2,1"}
    ]
    input_entity = _event_entity(coordinator, 5)
    input_entity.hass = hass
    input_entity.entity_id = "event.test_input"
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test_input"] = input_entity

    call = ServiceCall(
        hass, DOMAIN, "set_input_link", {ATTR_ENTITY_ID: ["event.test_input"]}
    )
    with pytest.raises(ValueError, match="force=true"):
        await _async_set_input_link(call)


async def test_set_input_link_rejects_non_event(
    hass: HomeAssistant, coordinator
) -> None:
    from custom_components.renson_smartliving import _async_set_input_link

    light_entity = MagicMock()
    light_entity.entity_id = "light.some"
    light_entity._om_id = 1
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["light.some"] = light_entity

    call = ServiceCall(hass, DOMAIN, "set_input_link", {ATTR_ENTITY_ID: ["light.some"]})
    with pytest.raises(ValueError, match="not an OpenMotics input"):
        await _async_set_input_link(call)
