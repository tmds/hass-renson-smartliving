from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import slugify

from .api import OpenMoticsClient
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


SIGNAL_CONFIG_LOADED = f"{DOMAIN}_config_loaded"


def signal_entity_event(event_type: str, om_id: int) -> str:
    """Dispatcher signal for a specific entity's real-time event."""
    return f"{DOMAIN}_event_{event_type}_{om_id}"


@dataclass
class GatewayInfo:
    """Gateway device information from PLATFORM_DETAILS and VERSION."""

    mac_address: str = ""
    device_id: str = ""
    platform: str = ""
    model: str = ""
    master_serial: str = ""
    gateway_version: str = ""
    master_version: str = ""

    @classmethod
    def from_config(
        cls,
        platform_details: dict[str, Any],
        version: dict[str, Any],
    ) -> GatewayInfo:
        mac = platform_details.get("mac_address", "")
        platform = platform_details.get("platform", "")
        return cls(
            mac_address=mac,
            device_id=mac.replace(":", ""),
            platform=platform,
            model=platform.replace("_PLUS", "+"),
            master_serial=platform_details.get("master_serial", ""),
            gateway_version=version.get("gateway", ""),
            master_version=version.get("master", ""),
        )


@dataclass
class RoomInfo:
    """OpenMotics room."""

    id: int
    name: str
    floor: int


@dataclass(frozen=True)
class EntityNaming:
    """Resolved naming for an OpenMotics entity."""

    unique_id: str
    friendly_name: str
    hass_platform: str
    object_id: str

    @property
    def suggested_entity_id(self) -> str:
        return f"{self.hass_platform}.{self.object_id}"


def _expand_truncated_name(name: str, room_name: str) -> str:
    """Expand a gateway-truncated name using the full room name.

    Output, sensor, shutter, and input names are limited to 16 chars.
    When the truncated name matches the start of the room name, use
    the full room name instead.
    """
    if not room_name or len(room_name) <= 16:
        return name
    if room_name[:16] == name[:16]:
        return room_name
    return name


class OpenMoticsCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Data container for OpenMotics state, updated by the sync loop.

    Lifecycle (driven by SyncLoop):
      handle_config      — config from WS control events (every reconnect)
      handle_full_update — initial state from REST, signals entity creation
      apply_event        — real-time state changes from WS
    """

    def __init__(
        self,
        hass: HomeAssistant,
        client: OpenMoticsClient,
        entry: ConfigEntry,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name="Renson Smart Living",
        )
        self.client = client
        self.entry = entry
        self.data = {}
        self.gateway_info = GatewayInfo()
        self.rooms: dict[int, RoomInfo] = {}
        self.room_to_area: dict[int, str] = {}
        self.outputs: list[dict[str, Any]] = []
        self.shutters: list[dict[str, Any]] = []
        self.sensors: list[dict[str, Any]] = []
        self.inputs: list[dict[str, Any]] = []
        self.group_actions: list[dict[str, Any]] = []
        self._config_loaded = False
        self._output_states: dict[int, dict[str, Any]] = {}
        self._shutter_states: dict[int, dict[str, Any]] = {}
        self._sensor_values: dict[int, float] = {}

    def resolve_entity_naming(
        self,
        name: str,
        room_id: int | None,
        om_type: str,
        om_id: int,
        hass_platform: str,
        entity_id_prefix: str = "",
    ) -> EntityNaming:
        """Resolve naming for an OpenMotics item."""
        room = self.rooms.get(room_id) if room_id is not None else None
        room_name = room.name if room else ""
        name = _expand_truncated_name(name, room_name)
        room_differs = room_name and room_name != name

        # Room and name are included so that a rename or room move in
        # OpenMotics creates a fresh HA entity with the correct entity_id
        # (HA locks entity_ids at creation). The old entity is cleaned up
        # by remove_stale_entities.
        uid_parts = [
            self.gateway_info.device_id,
            om_type,
            str(om_id),
            room_name,
            name,
        ]
        unique_id = slugify("_".join(part for part in uid_parts if part))

        # Entity ID: include room when it differs from name
        if room_differs:
            object_id = slugify(f"{room_name}_{name}")
        else:
            object_id = slugify(name)
        if entity_id_prefix:
            object_id = f"{slugify(entity_id_prefix)}_{object_id}"

        return EntityNaming(
            unique_id=unique_id,
            friendly_name=name,
            hass_platform=hass_platform,
            object_id=object_id,
        )

    def handle_config(self, config: dict[str, Any]) -> None:
        """Process config from sync loop: update gateway info, rooms, areas."""
        platform_details = config.get("PLATFORM_DETAILS", {})
        version = config.get("VERSION", {})
        self.gateway_info = GatewayInfo.from_config(platform_details, version)

        self.rooms = {}
        for room in config.get("ROOM_CONTROL", []):
            name = room.get("name", "")
            if name:
                self.rooms[room["id"]] = RoomInfo(
                    id=room["id"],
                    name=name,
                    floor=room.get("floor", 255),
                )

        self.outputs = config.get("OUTPUT_CONTROL", [])
        self.shutters = config.get("SHUTTER_CONTROL", [])
        self.sensors = config.get("SENSOR_CONTROL", [])
        self.inputs = config.get("INPUT_CONTROL", [])
        self.group_actions = config.get("GROUP_ACTION_CONTROL", [])
        self._create_areas(config)

    def _create_areas(self, config: dict[str, Any]) -> None:
        """Create HA areas from OpenMotics rooms."""
        registry = ar.async_get(self.hass)
        self.room_to_area = {}
        rooms = config.get("ROOM_CONTROL", [])
        for room in rooms:
            name = room.get("name", "")
            if name:
                area = registry.async_get_or_create(name)
                self.room_to_area[room["id"]] = area.id
        _LOGGER.info("Areas synced: %d rooms processed", len(rooms))

    def handle_full_update(self, data: dict[str, Any]) -> None:
        """Process initial state and signal platforms to create entities."""
        self._update_initial_state(data)
        self.async_set_updated_data(data)
        if not self._config_loaded:
            self._config_loaded = True
            async_dispatcher_send(self.hass, SIGNAL_CONFIG_LOADED)

    def _update_initial_state(self, data: dict[str, Any]) -> None:
        """Store initial output and shutter state from REST calls."""
        for status in data.get("output_status", []):
            self._output_states[status["id"]] = {
                "on": bool(status.get("status")),
                "dimmer": status.get("dimmer", 0),
            }

        shutter_status = data.get("shutter_status", {})
        detail = shutter_status.get("detail", {})
        # REST response uses string keys; convert to int to match event IDs.
        for shutter_id_str, info in detail.items():
            self._shutter_states[int(shutter_id_str)] = {
                "state": info.get("state", ""),
                "position": info.get("actual_position"),
            }

    def apply_event(self, event: dict[str, Any]) -> None:
        """Apply a real-time change event to the state."""
        event_type = event.get("type", "")
        event_data = event.get("data", {})

        if event_type == "OUTPUT_CHANGE":
            output_id = event_data["id"]
            status = event_data.get("status", {})
            self._output_states[output_id] = {
                "on": status.get("on", False),
                "dimmer": status.get("value", 0),
            }
            self._signal_entity(event_type, output_id)
        elif event_type == "SHUTTER_CHANGE":
            shutter_id = event_data["id"]
            status = event_data.get("status", {})
            self._shutter_states[shutter_id] = {
                "state": status.get("state", ""),
                "position": status.get("position"),
            }
            self._signal_entity(event_type, shutter_id)
        elif event_type == "SENSOR_CHANGE":
            sensor_id = event_data["id"]
            self._sensor_values[sensor_id] = event_data["value"]
            self._signal_entity(event_type, sensor_id)
        elif event_type == "INPUT_CHANGE":
            input_id = event_data["id"]
            async_dispatcher_send(
                self.hass,
                signal_entity_event(event_type, input_id),
                event_data.get("status", False),
            )

    def _signal_entity(self, event_type: str, om_id: int) -> None:
        """Signal the entity affected by an event."""
        async_dispatcher_send(
            self.hass, signal_entity_event(event_type, om_id)
        )

    def get_output_state(self, output_id: int) -> dict[str, Any] | None:
        return self._output_states.get(output_id)

    def get_shutter_state(self, shutter_id: int) -> dict[str, Any] | None:
        return self._shutter_states.get(shutter_id)

    def get_sensor_value(self, sensor_id: int) -> float | None:
        return self._sensor_values.get(sensor_id)

    async def _async_update_data(self) -> dict[str, Any]:
        return self.data
