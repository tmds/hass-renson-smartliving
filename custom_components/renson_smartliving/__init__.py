from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import voluptuous as vol
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from .api import OpenMoticsClient
from .const import CONF_HOST, DAY_KEYS, DOMAIN, PLATFORMS
from .coordinator import GatewayInfo, OpenMoticsCoordinator
from .event import _has_extended_actions
from .group_actions import parse_actions, validate_actions
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

SERVICE_SET_INPUT_LINK_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_ids,
        vol.Optional("output_entity"): cv.entity_id,
        vol.Optional("output_id"): int,
        vol.Optional("group_action_id"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=255)
        ),
        vol.Optional("group_action_id_long"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=255)
        ),
        vol.Optional("force"): bool,
    }
)

SERVICE_SET_SHUTTER_TIMINGS_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_ids,
        vol.Optional("timer_up"): vol.All(vol.Coerce(int), vol.Range(min=0, max=255)),
        vol.Optional("timer_down"): vol.All(vol.Coerce(int), vol.Range(min=0, max=255)),
    }
)

SERVICE_SAVE_GROUP_ACTION_SCHEMA = vol.Schema(
    {
        vol.Required("id"): vol.Coerce(int),
        vol.Optional("name"): vol.All(str, vol.Length(max=16)),
        vol.Optional("actions"): str,
        vol.Optional("show_in_app"): bool,
    }
)

SERVICE_RUN_GROUP_ACTION_SCHEMA = vol.Schema(
    {
        vol.Required("id"): vol.Coerce(int),
    }
)


def _resolve_om_entity(
    hass: HomeAssistant, entity_id: str
) -> tuple[OpenMoticsCoordinator, Any]:
    """Resolve any OpenMotics entity id to its coordinator and entity object."""
    registry: dict[str, Any] = hass.data.setdefault(DOMAIN, {}).setdefault(
        "om_entities", {}
    )
    entity = registry.get(entity_id)
    if entity is None:
        raise ValueError(f"Unknown OpenMotics entity: {entity_id}")
    return entity.coordinator, entity


def _resolve_any_coordinator(
    hass: HomeAssistant,
) -> OpenMoticsCoordinator:
    """Resolve the coordinator of any loaded OpenMotics config entry."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        runtime = getattr(entry, "runtime_data", None)
        coordinator = getattr(runtime, "coordinator", None)
        if coordinator is not None:
            return cast("OpenMoticsCoordinator", coordinator)
    raise ValueError("No loaded OpenMotics config entry found")


def _resolve_output_id(
    hass: HomeAssistant,
    output_entity: str | None,
    output_id: int | None,
) -> int | None:
    """Resolve the target output id; None means unlink."""
    if output_id is not None:
        return output_id
    if output_entity is None:
        return None
    _coordinator, entity = _resolve_om_entity(hass, output_entity)
    domain = entity.entity_id.split(".")[0]
    if domain not in ("light", "switch", "cover"):
        raise ValueError(
            f"{output_entity} is not an OpenMotics light, switch or cover"
        )
    output = cast("int | None", entity._om_id)  # noqa: SLF001
    if output is None:
        raise ValueError(f"{output_entity} has no OpenMotics output id")
    return output


def _update_input_config(
    coordinator: OpenMoticsCoordinator,
    input_id: int,
    action: int | None,
    basic_actions: str | None = None,
) -> None:
    """Merge the written action into the local input config cache."""
    for inp in coordinator.inputs:
        if inp.get("id") == input_id:
            inp["action"] = action
            if basic_actions is not None:
                inp["basic_actions"] = basic_actions
            break
    coordinator.async_set_updated_data(coordinator.data)


async def _async_set_input_link(call: ServiceCall) -> None:
    output_entity_id = call.data.get("output_entity")
    output_id = _resolve_output_id(
        call.hass,
        output_entity_id,
        call.data.get("output_id"),
    )
    group_action_id = call.data.get("group_action_id")
    group_action_id_long = call.data.get("group_action_id_long")
    action = 255 if output_id is None else output_id
    for entity_id in call.data[ATTR_ENTITY_ID]:
        coordinator, entity = _resolve_om_entity(call.hass, entity_id)
        if entity.entity_id.split(".")[0] != "event":
            raise ValueError(f"{entity_id} is not an OpenMotics input (event)")
        input_id = entity.input_id
        # The gateway serializer resets missing fields to their defaults, so
        # basic_actions MUST be sent along or extended input actions (timers,
        # group actions, ...) on the input would be wiped.
        current = next(
            (inp for inp in coordinator.inputs if inp.get("id") == input_id),
            None,
        )
        if (
            current is not None
            and _has_extended_actions(current)
            and not call.data.get("force")
        ):
            raise ValueError(
                f"{entity_id} has extended gateway actions (timers, group "
                "actions, ...). Linking OR unlinking it erases those actions "
                "on the gateway. Repeat with force=true to overwrite them."
            )
        config: dict[str, Any] = {"id": input_id, "action": action}
        # A group action link uses the extended encoding: action 240 with
        # basic_actions. Short press only keeps the simple "2,<id>" (run
        # group action on press). Long press uses opcode 207
        # (the gateway's long-press hold slot). Both together use the 8-byte
        # combined form the gateway itself writes:
        #   207,<long>,236,0,2,<short>,236,255
        # (207 slot = long press, the 236,0,2,N,236,255 tail = on release).
        if group_action_id_long is not None and group_action_id is not None:
            config["action"] = 240
            config["basic_actions"] = (
                f"207,{group_action_id_long},"
                f"236,0,2,{group_action_id},236,255"
            )
        elif group_action_id_long is not None:
            config["action"] = 240
            config["basic_actions"] = f"207,{group_action_id_long}"
        elif group_action_id is not None:
            config["action"] = 240
            config["basic_actions"] = f"2,{group_action_id}"
        # Covers (screens/shutters) cannot be toggled as a plain output: they
        # get the classic shutter toggle action 103,<shutter> (up/stop/down).
        elif output_entity_id and output_entity_id.split(".")[0] == "cover":
            config["action"] = 240
            config["basic_actions"] = f"103,{output_id}"
        elif current is not None and current.get("basic_actions"):
            config["basic_actions"] = current["basic_actions"]
        await coordinator.client.set_input_configuration(config)
        _update_input_config(
            coordinator,
            input_id,
            None if config["action"] == 255 else config["action"],
            config.get("basic_actions"),
        )
        _LOGGER.info(
            "Input link updated for %s (input %d): action=%s basic_actions=%s",
            entity_id,
            input_id,
            config["action"],
            config.get("basic_actions", ""),
        )


async def _async_set_shutter_timings(call: ServiceCall) -> None:
    """Update the travel timers of an OpenMotics shutter (cover)."""
    for entity_id in call.data[ATTR_ENTITY_ID]:
        coordinator, entity = _resolve_om_entity(call.hass, entity_id)
        if entity.entity_id.split(".")[0] != "cover":
            raise ValueError(f"{entity_id} is not an OpenMotics shutter (cover)")
        shutter_id = cast("int", entity._om_id)  # noqa: SLF001
        current = next(
            (s for s in coordinator.shutters if s.get("id") == shutter_id),
            None,
        )
        if current is None:
            raise ValueError(f"No shutter configuration found for {entity_id}")
        # the gateway serializer resets missing fields to defaults, so the
        # COMPLETE current config must be sent, merged with the new timers
        config = dict(current)
        if "timer_up" in call.data:
            config["timer_up"] = call.data["timer_up"]
        if "timer_down" in call.data:
            config["timer_down"] = call.data["timer_down"]
        await coordinator.client.set_shutter_configuration(config)
        current.update(
            {
                k: config[k]
                for k in ("timer_up", "timer_down")
                if k in config
            }
        )
        coordinator.async_set_updated_data(coordinator.data)
        _LOGGER.info(
            "Shutter timings updated for %s (shutter %d): up=%s down=%s",
            entity_id,
            shutter_id,
            config.get("timer_up"),
            config.get("timer_down"),
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


async def _async_get_group_actions(call: ServiceCall) -> dict[str, Any]:
    """Read all gateway group actions plus device name maps for the editor."""
    coordinator = _resolve_any_coordinator(call.hass)
    actions = await coordinator.client.get_group_action_configurations()
    return {
        "actions": actions,
        "outputs": coordinator.outputs,
        "shutters": coordinator.shutters,
        "inputs": coordinator.inputs,
    }


async def _async_save_group_action(call: ServiceCall) -> None:
    """Write a single gateway group action (automation)."""
    coordinator = _resolve_any_coordinator(call.hass)
    config: dict[str, Any] = {"id": call.data["id"]}
    if "name" in call.data:
        config["name"] = call.data["name"]
    if "show_in_app" in call.data:
        config["show_in_app"] = call.data["show_in_app"]
    if "actions" in call.data:
        values = parse_actions(call.data["actions"])
        validate_actions(values)
        config["actions"] = call.data["actions"]
    await coordinator.client.set_group_action_configuration(config)
    _LOGGER.info(
        "Group action %d saved: name=%r actions=%r",
        config["id"],
        config.get("name"),
        config.get("actions"),
    )


async def _async_run_group_action(call: ServiceCall) -> None:
    """Trigger a gateway group action by id."""
    coordinator = _resolve_any_coordinator(call.hass)
    await coordinator.client.do_group_action(call.data["id"])
    _LOGGER.info("Group action %d triggered", call.data["id"])


FRONTEND_URL_BASE = "/renson_smartliving"
FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the OpenMotics services and frontend resources."""
    if hass.http:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, str(FRONTEND_DIR), True)]
        )
        try:
            from homeassistant.components.frontend import add_extra_js_url
            import json as _json
            _manifest = _json.loads((FRONTEND_DIR.parent / "manifest.json").read_text())
            add_extra_js_url(
                hass,
                f"{FRONTEND_URL_BASE}/renson-smartliving-loader.js?v={_manifest['version']}",
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
    hass.services.async_register(
        DOMAIN,
        "set_input_link",
        _async_set_input_link,
        schema=SERVICE_SET_INPUT_LINK_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        "set_shutter_timings",
        _async_set_shutter_timings,
        schema=SERVICE_SET_SHUTTER_TIMINGS_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        "get_group_actions",
        _async_get_group_actions,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "save_group_action",
        _async_save_group_action,
        schema=SERVICE_SAVE_GROUP_ACTION_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        "run_group_action",
        _async_run_group_action,
        schema=SERVICE_RUN_GROUP_ACTION_SCHEMA,
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
