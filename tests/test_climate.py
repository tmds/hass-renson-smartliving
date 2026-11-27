from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.components.climate import (
    PRESET_AWAY,
    PRESET_NONE,
    HVACAction,
    HVACMode,
)

from custom_components.renson_smartliving.climate import (
    OpenMoticsClimate,
    create_entities,
    seconds_to_time,
    time_to_seconds,
)
from custom_components.renson_smartliving.const import (
    CONF_PRESET_EXPIRATION_HOURS,
    PRESET_AUTO,
)
from custom_components.renson_smartliving.coordinator import OpenMoticsCoordinator
from tests.fixtures import (
    SAMPLE_THERMOSTAT_EVENT,
    SAMPLE_THERMOSTATS,
    make_naming,
)


def _make_climate(
    coordinator: OpenMoticsCoordinator, thermostat_id: int = 0
) -> OpenMoticsClimate:
    return OpenMoticsClimate(
        coordinator=coordinator,
        naming=make_naming("climate", unique_id=f"t{thermostat_id}", name="Living"),
        thermostat_id=thermostat_id,
    )


def _load_status(coordinator: OpenMoticsCoordinator) -> None:
    coordinator.handle_full_update(
        {
            "output_status": [],
            "shutter_status": {},
            "THERMOSTAT_CONTROL": SAMPLE_THERMOSTATS,
        }
    )


async def test_create_entities_skips_unnamed(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """Thermostats without a name are not exposed."""
    coordinator.thermostats = [
        {"id": 0, "name": "Living", "room": 2, "status": {}},
        {"id": 1, "name": "", "room": 3, "status": {}},
    ]
    entities = create_entities(coordinator)
    assert len(entities) == 1
    assert entities[0]._thermostat_id == 0


async def test_initial_state_from_control_list(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """The REST control list seeds the entity state (lowercase values)."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)

    assert climate.current_temperature == 19.0
    assert climate.target_temperature == 18.0
    assert climate.hvac_mode == HVACMode.HEAT
    assert climate.hvac_action == HVACAction.HEATING
    assert climate.preset_mode == PRESET_AUTO

    off = _make_climate(coordinator, thermostat_id=1)
    assert off.hvac_mode == HVACMode.OFF
    assert off.hvac_action == HVACAction.OFF
    assert off.preset_mode == PRESET_NONE
    assert off.hvac_action != HVACAction.IDLE


async def test_ws_event_updates_state(coordinator: OpenMoticsCoordinator) -> None:
    """A THERMOSTAT_CHANGE event updates the entity (uppercase values)."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)

    coordinator.apply_event(SAMPLE_THERMOSTAT_EVENT)

    state = coordinator.get_thermostat_state(0)
    assert state["active_preset"] == "override"
    assert state["state"] == "on"
    assert climate.target_temperature == 20.0
    assert climate.preset_mode == PRESET_NONE
    assert climate.hvac_action == HVACAction.HEATING


async def test_set_temperature_sends_expiration(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """set_temperature PUTs the setpoint with a +2h preset expiration."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)
    coordinator.client = MagicMock()
    coordinator.client.set_thermostat_control = AsyncMock()
    coordinator.client.get_timezone = AsyncMock(return_value="Europe/Brussels")

    before = datetime.now()
    await climate.async_set_temperature(temperature=21.5)

    args = coordinator.client.set_thermostat_control.call_args
    thermostat_id, payload = args.args
    assert thermostat_id == 0
    assert payload["setpoint"] == 21.5
    expires = datetime.fromisoformat(payload["preset_expiration"])
    assert expires.tzinfo is None
    assert before + timedelta(hours=1.9) < expires < before + timedelta(hours=2.1)


async def test_set_hvac_mode(coordinator: OpenMoticsCoordinator) -> None:
    """HVAC mode maps to state on/off."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)
    coordinator.client = MagicMock()
    coordinator.client.set_thermostat_control = AsyncMock()

    await climate.async_set_hvac_mode(HVACMode.OFF)
    assert coordinator.client.set_thermostat_control.call_args.args[1] == {
        "state": "off"
    }

    await climate.async_set_hvac_mode(HVACMode.HEAT)
    assert coordinator.client.set_thermostat_control.call_args.args[1] == {
        "state": "on"
    }


async def test_set_preset_mode(coordinator: OpenMoticsCoordinator) -> None:
    """AUTO restores the schedule; other presets have no expiration."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)
    coordinator.client = MagicMock()
    coordinator.client.set_thermostat_control = AsyncMock()

    await climate.async_set_preset_mode(PRESET_AUTO)
    assert coordinator.client.set_thermostat_control.call_args.args[1] == {
        "active_preset": "auto"
    }

    await climate.async_set_preset_mode(PRESET_AWAY)
    assert coordinator.client.set_thermostat_control.call_args.args[1] == {
        "active_preset": "away",
        "preset_expiration": None,
    }


async def test_climate_limits() -> None:
    """The entity enforces the OpenMotics setpoint range."""
    climate = _make_climate(MagicMock())
    assert climate.min_temp == 6
    assert climate.max_temp == 32
    assert climate.target_temperature_step == 0.5
    assert climate.hvac_modes == [HVACMode.OFF, HVACMode.HEAT]


async def test_extra_state_attributes(coordinator: OpenMoticsCoordinator) -> None:
    """Schedule, away temperature and lead time are exposed as attributes."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)
    coordinator.thermostats = [
        {
            "id": 0,
            "name": "Living",
            "room": 2,
            "away_heating": 13.0,
            "early_heating": 30,
            "heating_schedule": {
                "mon": {"0": 14, "25200": 19},
                "tue": {"0": 14, "25200": 19},
            },
        }
    ]
    attrs = climate.extra_state_attributes
    assert attrs["away_temperature"] == 13.0
    assert attrs["lead_time"] == 30
    assert attrs["heating_schedule"]["mon"] == {"00:00": 14, "07:00": 19}


def test_time_conversion() -> None:
    """HH:MM strings and time objects map to seconds since midnight."""
    assert time_to_seconds("08:00") == 28800
    assert time_to_seconds("22:30") == 81000
    assert time_to_seconds("00:00") == 0
    assert time_to_seconds(time(6, 30)) == 23400
    with pytest.raises(ValueError):
        time_to_seconds("24:00")
    with pytest.raises(ValueError):
        time_to_seconds("not-a-time")


async def test_build_schedule_payload_keeps_other_days(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """Only the listed days are replaced; other days keep their schedule."""
    from custom_components.renson_smartliving.__init__ import (
        _build_schedule_payload,
    )

    coordinator.thermostats = [
        {
            "id": 0,
            "heating_schedule": {
                "mon": {"0": 14},
                "tue": {"0": 14, "25200": 19},
                "wed": {"0": 15},
            },
        }
    ]
    payload = _build_schedule_payload(
        coordinator,
        0,
        ["tue"],
        [{"time": "08:00", "temperature": 20}],
    )
    schedule = payload["heating_schedule"]
    assert schedule["tue"] == {28800: 20.0}
    assert schedule["mon"] == {"0": 14}
    assert schedule["wed"] == {"0": 15}

    payload_all = _build_schedule_payload(
        coordinator, 0, None, [{"time": "21:00", "temperature": 17}]
    )
    assert all(
        day == {75600: 17.0} for day in payload_all["heating_schedule"].values()
    )


async def test_build_schedule_payload_week(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """A week payload replaces only the listed days."""
    from custom_components.renson_smartliving.__init__ import (
        _build_schedule_payload,
    )

    coordinator.thermostats = [
        {
            "id": 0,
            "heating_schedule": {
                "mon": {"0": 14},
                "tue": {"0": 14, "25200": 19},
                "wed": {"0": 15},
            },
        }
    ]
    payload = _build_schedule_payload(
        coordinator,
        0,
        None,
        None,
        {
            "mon": [{"time": "07:00", "temperature": 20}],
            "tue": [{"time": "07:00", "temperature": 21}],
        },
    )
    schedule = payload["heating_schedule"]
    assert schedule["mon"] == {25200: 20.0}
    assert schedule["tue"] == {25200: 21.0}
    assert schedule["wed"] == {"0": 15}


async def test_update_local_config_refreshes_attributes(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """After a schedule write the attributes reflect the change at once."""
    from custom_components.renson_smartliving.__init__ import (
        _update_local_config,
    )

    _load_status(coordinator)
    climate = _make_climate(coordinator)
    coordinator.thermostats = [
        {
            "id": 0,
            "name": "Living",
            "room": 2,
            "away_heating": 13.0,
            "early_heating": 0,
            "heating_schedule": {"mon": {"0": 14}},
        }
    ]

    _update_local_config(
        coordinator, 0, {"early_heating": 30, "away_heating": 12.0}
    )
    attrs = climate.extra_state_attributes
    assert attrs["lead_time"] == 30
    assert attrs["away_temperature"] == 12.0


async def test_set_temperature_zero_expiration_is_permanent(
    hass: HomeAssistant,
    coordinator: OpenMoticsCoordinator,
) -> None:
    """expiration_hours=0 sends no preset_expiration (permanent override)."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)
    hass.config_entries.async_update_entry(
        coordinator.entry, options={CONF_PRESET_EXPIRATION_HOURS: 0}
    )
    coordinator.client = MagicMock()
    coordinator.client.set_thermostat_control = AsyncMock()
    coordinator.client.get_timezone = AsyncMock(return_value="Europe/Brussels")

    await climate.async_set_temperature(temperature=22.0)

    payload = coordinator.client.set_thermostat_control.call_args.args[1]
    assert payload == {"setpoint": 22.0}
    assert "preset_expiration" not in payload
    coordinator.client.get_timezone.assert_not_called()


async def test_set_temperature_timezone_fallback(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """When get_timezone raises, set_temperature still succeeds."""
    _load_status(coordinator)
    climate = _make_climate(coordinator)
    coordinator.client = MagicMock()
    coordinator.client.set_thermostat_control = AsyncMock()
    coordinator.client.get_timezone = AsyncMock(side_effect=RuntimeError("timeout"))

    before = datetime.now()
    await climate.async_set_temperature(temperature=19.0)

    payload = coordinator.client.set_thermostat_control.call_args.args[1]
    assert payload["setpoint"] == 19.0
    expires = datetime.fromisoformat(payload["preset_expiration"])
    assert before + timedelta(hours=1.9) < expires < before + timedelta(hours=2.1)


async def test_set_schedule_requires_setpoints_or_week() -> None:
    """Calling _async_set_schedule with neither setpoints nor week raises."""
    from custom_components.renson_smartliving.__init__ import _async_set_schedule

    call = MagicMock()
    call.data = {"entity_id": ["climate.living"]}
    call.hass = MagicMock()

    with pytest.raises(ValueError, match="setpoints or week"):
        await _async_set_schedule(call)


async def test_set_config_requires_a_field() -> None:
    """Calling _async_set_config with no config fields raises."""
    from custom_components.renson_smartliving.__init__ import _async_set_config

    call = MagicMock()
    call.data = {"entity_id": ["climate.living"]}
    call.hass = MagicMock()

    with pytest.raises(ValueError, match="away_temperature and/or lead_time"):
        await _async_set_config(call)


async def test_resolve_thermostat_unknown_entity(
    coordinator: OpenMoticsCoordinator,
) -> None:
    """_resolve_thermostat raises for an unknown entity id."""
    from custom_components.renson_smartliving.__init__ import _resolve_thermostat
    from custom_components.renson_smartliving.const import DOMAIN

    coordinator.hass.data.setdefault(DOMAIN, {})["climate_entities"] = {}

    with pytest.raises(ValueError, match="Unknown OpenMotics climate entity"):
        _resolve_thermostat(coordinator.hass, "climate.nonexistent")


def test_seconds_to_time_edges() -> None:
    """seconds_to_time handles midnight and end-of-day."""
    assert seconds_to_time(0) == "00:00"
    assert seconds_to_time(86340) == "23:59"
    assert seconds_to_time(43200) == "12:00"
