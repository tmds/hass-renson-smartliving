"""Tests for group action (gateway automation) services and validation."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import HomeAssistant

from custom_components.renson_smartliving.api import OpenMoticsClient
from custom_components.renson_smartliving.const import DOMAIN
from custom_components.renson_smartliving.group_actions import (
    GroupActionValidationError,
    parse_actions,
    validate_actions,
)
from tests.fixtures import mock_response


async def test_set_group_action_configuration_sends_form_param(
    client: OpenMoticsClient, mock_session: MagicMock
) -> None:
    """set_group_action_configuration posts the config as a form param."""
    client._token = "tok"  # noqa: SLF001, S105
    mock_session.request.return_value = mock_response(200, {"success": True})

    config = {"id": 5, "name": "test", "actions": "161,21"}
    await client.set_group_action_configuration(config)

    args, kwargs = mock_session.request.call_args
    assert args[0] == "POST"
    assert args[1].endswith("/set_group_action_configuration")
    assert kwargs["params"] == {"config": json.dumps(config)}


# -- Validation --


def test_parse_actions_empty() -> None:
    assert parse_actions("") == []
    assert parse_actions("  ") == []


def test_parse_actions_basic() -> None:
    assert parse_actions("161,21,160,22") == [161, 21, 160, 22]


def test_parse_actions_odd_raises() -> None:
    with pytest.raises(GroupActionValidationError):
        validate_actions(parse_actions("161,21,160"))


def test_parse_actions_non_numeric_raises() -> None:
    with pytest.raises(GroupActionValidationError):
        parse_actions("161,abc")


def test_validate_known_opcodes_ok() -> None:
    validate_actions([161, 21, 160, 22])
    validate_actions([240, 0, 243, 21, 240, 10, 161, 21, 240, 255])
    validate_actions([240, 0, 243, 21, 240, 1, 243, 22, 240, 10, 162, 63, 240, 255])
    validate_actions([240, 0, 243, 21, 240, 10, 161, 21, 240, 20, 160, 21, 240, 255])
    validate_actions([103, 25])


def test_validate_unknown_opcode_raises() -> None:
    # 235 (delay) is NOT in the supported set: the gateway mapper would
    # silently drop it, so writing it back must be refused.
    with pytest.raises(GroupActionValidationError, match="235"):
        validate_actions([235, 10, 161, 21])


def test_validate_odd_length_raises() -> None:
    with pytest.raises(GroupActionValidationError):
        validate_actions([161, 21, 160])


def test_validate_unclosed_if_raises() -> None:
    with pytest.raises(GroupActionValidationError, match="ENDIF"):
        validate_actions([240, 0, 243, 21, 240, 10, 161, 21])


def test_validate_stray_endif_raises() -> None:
    with pytest.raises(GroupActionValidationError, match="ENDIF"):
        validate_actions([240, 255])


def test_validate_then_without_if_raises() -> None:
    with pytest.raises(GroupActionValidationError, match="THEN"):
        validate_actions([240, 10, 161, 21])


def test_validate_else_without_then_raises() -> None:
    with pytest.raises(
        GroupActionValidationError, match="ELSE"
    ):
        validate_actions([240, 0, 243, 21, 240, 20, 160, 21, 240, 255])


def test_validate_and_outside_condition_region_raises() -> None:
    with pytest.raises(GroupActionValidationError, match="AND"):
        validate_actions([240, 0, 240, 10, 240, 1, 161, 21, 240, 255])


def test_validate_nested_if_ok() -> None:
    validate_actions(
        [
            240, 0, 243, 21, 240, 10,
            240, 0, 243, 22, 240, 10, 161, 22, 240, 255,
            240, 255,
        ]
    )


def test_validate_nested_if_in_else_ok() -> None:
    validate_actions(
        [
            240, 0, 243, 21, 240, 10, 161, 21,
            240, 20,
            240, 0, 243, 22, 240, 10, 161, 22, 240, 255,
            240, 255,
        ]
    )


# -- Services --


async def _setup_with_entry(hass: HomeAssistant):
    """Register services and provide one entry with a mock client."""
    from pytest_homeassistant_custom_component.common import (  # noqa: PLC0415
        MockConfigEntry,
    )

    from custom_components.renson_smartliving import (  # noqa: PLC0415
        OpenMoticsRuntimeData,
        async_setup,
    )
    from custom_components.renson_smartliving.coordinator import (  # noqa: PLC0415
        GatewayInfo,
        OpenMoticsCoordinator,
    )

    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"host": "192.168.1.100", "username": "admin", "password": "secret"},
    )
    entry.add_to_hass(hass)
    client = AsyncMock(spec=OpenMoticsClient)
    coordinator = OpenMoticsCoordinator(hass, client, entry)
    coordinator.gateway_info = GatewayInfo(device_id="aabbccddeeff")
    entry.runtime_data = OpenMoticsRuntimeData(coordinator=coordinator)
    await async_setup(hass, {})
    return coordinator


async def test_get_group_actions_returns_response(hass: HomeAssistant) -> None:
    """get_group_actions returns the gateway configs plus device name maps."""
    coordinator = await _setup_with_entry(hass)
    actions = [{"id": 2, "name": "toggle radio", "actions": "162,63",
                "internal": False, "show_in_app": True}]
    outputs = [{"id": 63, "name": "radio"}]
    coordinator.client.get_group_action_configurations.return_value = actions
    coordinator.outputs = outputs

    resp = await hass.services.async_call(
        DOMAIN,
        "get_group_actions",
        {},
        blocking=True,
        return_response=True,
    )
    assert resp["actions"] == actions
    assert resp["outputs"] == outputs


async def test_save_group_action_validates_and_writes(
    hass: HomeAssistant,
) -> None:
    coordinator = await _setup_with_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "save_group_action",
        {"id": 5, "name": "test", "actions": "161,21"},
        blocking=True,
    )
    coordinator.client.set_group_action_configuration.assert_awaited_once_with(
        {"id": 5, "name": "test", "actions": "161,21"}
    )


async def test_save_group_action_rejects_unknown_opcode(
    hass: HomeAssistant,
) -> None:
    coordinator = await _setup_with_entry(hass)

    with pytest.raises(Exception):  # noqa: B017, PT011
        await hass.services.async_call(
            DOMAIN,
            "save_group_action",
            {"id": 5, "name": "bad", "actions": "235,10,161,21"},
            blocking=True,
        )
    coordinator.client.set_group_action_configuration.assert_not_awaited()


async def test_save_group_action_name_too_long_rejected(
    hass: HomeAssistant,
) -> None:
    coordinator = await _setup_with_entry(hass)

    with pytest.raises(Exception):  # noqa: B017, PT011
        await hass.services.async_call(
            DOMAIN,
            "save_group_action",
            {"id": 5, "name": "x" * 20},
            blocking=True,
        )
    coordinator.client.set_group_action_configuration.assert_not_awaited()


async def test_run_group_action(hass: HomeAssistant) -> None:
    coordinator = await _setup_with_entry(hass)

    await hass.services.async_call(
        DOMAIN, "run_group_action", {"id": 2}, blocking=True
    )
    coordinator.client.do_group_action.assert_awaited_once_with(2)


# -- Input links to group actions --


def test_linked_group_action_detects_run_encoding() -> None:
    from types import SimpleNamespace  # noqa: PLC0415

    from custom_components.renson_smartliving.event import (  # noqa: PLC0415
        _linked_group_action,
    )

    coordinator = SimpleNamespace(
        inputs=[{"id": 12, "action": 240, "basic_actions": "2,1"}]
    )
    assert _linked_group_action(coordinator, 12) == 1
    assert _linked_group_action(coordinator, 13) is None


def test_linked_group_action_ignores_other_encodings() -> None:
    from types import SimpleNamespace  # noqa: PLC0415

    from custom_components.renson_smartliving.event import (  # noqa: PLC0415
        _linked_group_action,
    )

    coordinator = SimpleNamespace(
        inputs=[
            {"id": 10, "action": 240, "basic_actions": "108,4"},
            {"id": 11, "action": 15, "basic_actions": ""},
            {"id": 12, "action": 240, "basic_actions": "2,1,2,2"},
        ]
    )
    assert _linked_group_action(coordinator, 10) is None
    assert _linked_group_action(coordinator, 11) is None
    assert _linked_group_action(coordinator, 12) is None


async def test_set_input_link_group_action(hass: HomeAssistant) -> None:
    """set_input_link with group_action_id writes the extended encoding."""
    from types import SimpleNamespace  # noqa: PLC0415

    coordinator = await _setup_with_entry(hass)
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test"] = SimpleNamespace(
        coordinator=coordinator, entity_id="event.test", input_id=12
    )

    await hass.services.async_call(
        DOMAIN,
        "set_input_link",
        {"entity_id": ["event.test"], "group_action_id": 2},
        blocking=True,
    )
    coordinator.client.set_input_configuration.assert_awaited_once_with(
        {"id": 12, "action": 240, "basic_actions": "2,2"}
    )


async def test_set_input_link_group_action_new_automation(
    hass: HomeAssistant,
) -> None:
    """Chaining save_group_action + set_input_link links the new automation."""
    from types import SimpleNamespace  # noqa: PLC0415

    coordinator = await _setup_with_entry(hass)
    registry: dict = hass.data.setdefault(DOMAIN, {}).setdefault("om_entities", {})
    registry["event.test"] = SimpleNamespace(
        coordinator=coordinator, entity_id="event.test", input_id=12
    )

    await hass.services.async_call(
        DOMAIN,
        "save_group_action",
        {"id": 5, "name": "nieuw", "actions": ""},
        blocking=True,
    )
    await hass.services.async_call(
        DOMAIN,
        "set_input_link",
        {"entity_id": ["event.test"], "group_action_id": 5},
        blocking=True,
    )
    calls = coordinator.client.set_input_configuration.await_args_list
    assert calls[-1].args[0] == {"id": 12, "action": 240, "basic_actions": "2,5"}
