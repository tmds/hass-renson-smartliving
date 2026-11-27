from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from .api import OpenMoticsClient
from .const import CONF_HOST, DAY_KEYS, DOMAIN, PLATFORMS
from .coordinator import GatewayInfo, OpenMoticsCoordinator
from .sync import SyncLoop

_LOGGER = logging.getLogger(__name__)

type OpenMoticsConfigEntry = ConfigEntry[OpenMoticsRuntimeData]


@dataclass
class OpenMoticsRuntimeData:
    """Runtime data for an OpenMotics config entry."""

    coordinator: OpenMoticsCoordinator
    sync_loop: SyncLoop | None = None


SCHEDULE_SETPOINT_SCHEMA = vol.Schema(
    {
        vol.Required("time"): cv.time,
        vol.Required("temperature"): vol.Coerce(float),
    }
)

SERVICE_SET_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_ids,
        vol.Optional("days"): [vol.In(DAY_KEYS)],
        vol.Optional("setpoints"): [SCHEDULE_SETPOINT_SCHEMA],
        vol.Optional("week"): {
            vol.In(DAY_KEYS): [SCHEDULE_SETPOINT_SCHEMA]
        },
    }
)

SERVICE_SET_CONFIG_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_ids,
        vol.Optional("away_temperature"): vol.Coerce(float),
        vol.Optional("lead_time"): vol.Coerce(int),
    }
)

def _resolve_thermostat(
    hass: HomeAssistant, entity_id: str
) -> tuple[OpenMoticsCoordinator, int]:
    """Resolve a climate entity id to its coordinator and thermostat id."""
    registry: dict[str, Any] = hass.data.setdefault(DOMAIN, {}).setdefault(
        "climate_entities", {}
    )
    entity = registry.get(entity_id)
    if entity is None:
        raise ValueError(f"Unknown OpenMotics climate entity: {entity_id}")
    return entity.coordinator, entity.thermostat_id


def _convert_setpoints(setpoints: list[dict[str, Any]]) -> dict[int, Any]:
    """Convert a setpoint list to the gateway seconds-keyed format."""
    from .climate import time_to_seconds

    return {
        time_to_seconds(str(sp["time"])): sp["temperature"]
        for sp in setpoints
    }


def _build_schedule_payload(
    coordinator: OpenMoticsCoordinator,
    thermostat_id: int,
    days: list[str] | None,
    setpoints: list[dict[str, Any]] | None,
    week: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Build a heating_schedule payload, keeping unlisted days untouched."""
    current: dict[str, Any] = {}
    for thermostat in coordinator.thermostats:
        if thermostat.get("id") == thermostat_id:
            current = thermostat.get("heating_schedule") or {}
            break

    schedule: dict[str, Any] = {}
    for day in DAY_KEYS:
        if week is not None and day in week:
            schedule[day] = _convert_setpoints(week[day])
        elif week is None and (days is None or day in days):
            schedule[day] = _convert_setpoints(setpoints or [])
        elif day in current:
            schedule[day] = dict(current[day])
    return {"heating_schedule": schedule}


def _update_local_config(
    coordinator: OpenMoticsCoordinator,
    thermostat_id: int,
    updates: dict[str, Any],
) -> None:
    """Merge written config fields into the local control list.

    THERMOSTAT_CHANGE events only carry status, so without this the
    schedule attributes would be stale until the next reconnect.
    """
    for thermostat in coordinator.thermostats:
        if thermostat.get("id") == thermostat_id:
            thermostat.update(updates)
            break
    coordinator._signal_entity("THERMOSTAT_CHANGE", thermostat_id)  # noqa: SLF001


async def _async_set_schedule(call: ServiceCall) -> None:
    week = call.data.get("week")
    setpoints = call.data.get("setpoints")
    if week is None and setpoints is None:
        raise ValueError("Provide setpoints or week")
    for entity_id in call.data[ATTR_ENTITY_ID]:
        coordinator, thermostat_id = _resolve_thermostat(
            call.hass, entity_id
        )
        payload = _build_schedule_payload(
            coordinator,
            thermostat_id,
            call.data.get("days"),
            setpoints,
            week,
        )
        await coordinator.client.set_thermostat_control(
            thermostat_id, payload
        )
        _update_local_config(coordinator, thermostat_id, payload)
        _LOGGER.info(
            "Schedule updated for %s (thermostat %d, days: %s)",
            entity_id,
            thermostat_id,
            sorted(payload["heating_schedule"].keys()),
        )


async def _async_set_config(call: ServiceCall) -> None:
    payload: dict[str, Any] = {}
    if "away_temperature" in call.data:
        payload["away_heating"] = call.data["away_temperature"]
    if "lead_time" in call.data:
        payload["early_heating"] = call.data["lead_time"]
    if not payload:
        raise ValueError("Provide away_temperature and/or lead_time")
    for entity_id in call.data[ATTR_ENTITY_ID]:
        coordinator, thermostat_id = _resolve_thermostat(
            call.hass, entity_id
        )
        await coordinator.client.set_thermostat_control(
            thermostat_id, payload
        )
        _update_local_config(coordinator, thermostat_id, payload)
        _LOGGER.info(
            "Config updated for %s (thermostat %d): %s",
            entity_id,
            thermostat_id,
            payload,
        )


FRONTEND_DIR = Path(__file__).parent / "frontend"
_MANIFEST_VERSION = json.loads(
    (Path(__file__).parent / "manifest.json").read_text()
).get("version", "0")
FRONTEND_URL_BASE = f"/renson_smartliving/{_MANIFEST_VERSION}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the OpenMotics services and frontend resources."""
    if hass.http:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, str(FRONTEND_DIR), True)]
        )
        try:
            from homeassistant.components.frontend import add_extra_js_url
            add_extra_js_url(
                hass,
                f"{FRONTEND_URL_BASE}/renson-smartliving-loader.js",
            )
        except Exception:
            pass

    hass.services.async_register(
        DOMAIN,
        "set_thermostat_schedule",
        _async_set_schedule,
        schema=SERVICE_SET_SCHEDULE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        "set_thermostat_config",
        _async_set_config,
        schema=SERVICE_SET_CONFIG_SCHEMA,
    )
    return True


async def async_setup_entry(
    hass: HomeAssistant, entry: OpenMoticsConfigEntry
) -> bool:
    """Set up Renson Smart Living from a config entry."""
    client = OpenMoticsClient(
        host=entry.data[CONF_HOST],
        username=entry.data[CONF_USERNAME],
        password=entry.data[CONF_PASSWORD],
    )

    coordinator = OpenMoticsCoordinator(hass, client, entry)

    platform_details = entry.data.get("platform_details", {})
    if platform_details:
        coordinator.gateway_info = GatewayInfo.from_config(
            platform_details, {}
        )
        dev_reg = dr.async_get(hass)
        gw = coordinator.gateway_info
        dev_reg.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, gw.device_id)},
            name=f"Smart Living Controller ({entry.data[CONF_HOST]})",
            manufacturer="Renson NV",
            model=gw.model,
            sw_version=gw.gateway_version,
            serial_number=gw.master_serial,
        )

    runtime_data = OpenMoticsRuntimeData(coordinator=coordinator)
    entry.runtime_data = runtime_data

    def _on_availability_change(connected: bool) -> None:
        coordinator.connected = connected
        coordinator.async_set_updated_data(coordinator.data)

    runtime_data.sync_loop = SyncLoop(
        client=client,
        on_config=coordinator.handle_config,
        on_full_update=coordinator.handle_full_update,
        on_event=coordinator.apply_event,
        on_availability_change=_on_availability_change,
    )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    runtime_data.sync_loop.start()

    async def _on_options_updated(
        hass: HomeAssistant, updated_entry: OpenMoticsConfigEntry
    ) -> None:
        await hass.config_entries.async_reload(updated_entry.entry_id)

    entry.async_on_unload(
        entry.add_update_listener(_on_options_updated)
    )
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: OpenMoticsConfigEntry
) -> bool:
    """Unload an OpenMotics config entry."""
    if entry.runtime_data.sync_loop is not None:
        await entry.runtime_data.sync_loop.stop()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
