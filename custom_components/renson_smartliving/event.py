from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .const import DOMAIN
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics events (input press/release)."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "event", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsEvent]:
    """Create event entities from input config."""
    entities: list[OpenMoticsEvent] = []
    for inp in coordinator.inputs:
        if not inp.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            inp["name"], inp.get("room"), "input", inp["id"], "event"
        )
        entities.append(
            OpenMoticsEvent(
                coordinator=coordinator,
                naming=naming,
                input_id=inp["id"],
                room_id=inp.get("room"),
            )
        )
    return entities


def _find_entity_id(
    coordinator: OpenMoticsCoordinator, om_id: int, domain: str
) -> str | None:
    """Find the HA entity ID for a gateway object by its domain and gateway ID."""
    by_om_id = coordinator.hass.data.get(DOMAIN, {}).get("om_id_to_entity", {})
    return by_om_id.get((domain, om_id))


def _linked_output(
    coordinator: OpenMoticsCoordinator, input_id: int
) -> str | None:
    """Return the HA entity ID of the output or screen linked to an input."""
    for inp in coordinator.inputs:
        if inp.get("id") != input_id:
            continue
        action = inp.get("action")
        if action is None:
            return None
        if action == 240:
            actions = str(inp.get("basic_actions") or "").split(",")
            if len(actions) == 2 and actions[0] in (
                "100", "101", "102", "103", "108", "109"
            ):
                shutter_id = int(actions[1])
                return _find_entity_id(coordinator, shutter_id, "cover")
            return None
        if action >= 240:
            return None
        return _find_entity_id(coordinator, action, "light") or \
            _find_entity_id(coordinator, action, "switch")
    return None


def _linked_group_action(
    coordinator: OpenMoticsCoordinator, input_id: int
) -> int | None:
    """Return the group action id an input triggers, if linked as "2,<id>"."""
    for inp in coordinator.inputs:
        if inp.get("id") != input_id:
            continue
        if inp.get("action") != 240:
            return None
        actions = str(inp.get("basic_actions") or "").split(",")
        if len(actions) == 2 and actions[0] == "2":
            try:
                return int(actions[1])
            except ValueError:
                return None
        return None
    return None


def _has_extended_actions(inp: dict[str, Any]) -> bool:
    """True when the input has extended basic actions beyond a simple link.

    Writing a direct output link (or unlinking) erases those extended
    actions on the gateway: an input has either a direct link OR extended
    actions, never both. Single-pair shutter encodings ("103,<shutter>"
    toggle but also 100/101/102 up/down/stop and 108/109 up/stop/up,
    down/stop/down) are NOT extended: they are first-class links the
    card can manage.
    """
    action = inp.get("action")
    if action is None or action < 240:
        return False
    actions = str(inp.get("basic_actions") or "").split(",")
    if len(actions) == 2 and actions[0] in (
        "100", "101", "102", "103", "108", "109"
    ):
        return False
    return bool(inp.get("basic_actions"))


class OpenMoticsEvent(OpenMoticsEntity, EventEntity):
    """An OpenMotics event (input) entity."""

    _attr_event_types = ["press", "release"]

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        input_id: int,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator, naming, room_id)
        self._input_id = input_id
        self._ws_change_type = "INPUT_CHANGE"
        self._om_id = input_id

    @property
    def input_id(self) -> int:
        """The OpenMotics input id."""
        return self._input_id

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        attrs: dict[str, Any] = {}
        linked = _linked_output(self.coordinator, self._input_id)
        if linked is not None:
            attrs["linked_output"] = linked
        ga_id = _linked_group_action(self.coordinator, self._input_id)
        if ga_id is not None:
            attrs["linked_group_action_id"] = ga_id
        current = next(
            (inp for inp in self.coordinator.inputs if inp.get("id") == self._input_id),
            None,
        )
        if current is not None and _has_extended_actions(current):
            attrs["has_extended_actions"] = True
            attrs["basic_actions"] = current.get("basic_actions") or ""
        return attrs or None


    @callback
    def _handle_om_event(self, pressed: bool) -> None:
        self._trigger_event("press" if pressed else "release")
        self.async_write_ha_state()
