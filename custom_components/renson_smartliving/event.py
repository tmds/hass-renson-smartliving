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


def _linked_output(
    coordinator: OpenMoticsCoordinator, input_id: int
) -> dict[str, Any] | None:
    """Describe the output or screen linked to an input, if any."""
    for inp in coordinator.inputs:
        if inp.get("id") != input_id:
            continue
        action = inp.get("action")
        if action is None:
            return None
        if action == 240:
            # Extended actions: recognise the shutter toggle "103,<shutter>".
            actions = str(inp.get("basic_actions") or "").split(",")
            if len(actions) == 2 and actions[0] == "103":
                shutter_id = int(actions[1])
                for shutter in coordinator.shutters:
                    if shutter.get("id") == shutter_id:
                        return {"id": shutter_id, "name": shutter.get("name")}
                return {"id": shutter_id, "name": None}
            return None
        if action >= 240:
            return None
        for output in coordinator.outputs:
            if output.get("id") == action:
                return {"id": action, "name": output.get("name")}
        return {"id": action, "name": None}
    return None


def _has_extended_actions(inp: dict[str, Any]) -> bool:
    """True when the input has extended basic actions beyond a simple link.

    Writing a direct output link (or unlinking) erases those extended
    actions on the gateway: an input has either a direct link OR extended
    actions, never both. The single shutter toggle "103,<shutter>" is NOT
    extended: it is a first-class link the card can manage.
    """
    action = inp.get("action")
    if action is None or action < 240:
        return False
    actions = str(inp.get("basic_actions") or "").split(",")
    if len(actions) == 2 and actions[0] == "103":
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
        attrs: dict[str, Any] = {"openmotics_id": self._input_id}
        linked = _linked_output(self.coordinator, self._input_id)
        linked = _linked_output(self.coordinator, self._input_id)
        if linked is not None:
            attrs["linked_output_id"] = linked["id"]
            attrs["linked_output_name"] = linked["name"]
        current = next(
            (inp for inp in self.coordinator.inputs if inp.get("id") == self._input_id),
            None,
        )
        if current is not None and _has_extended_actions(current):
            attrs["has_extended_actions"] = True
        return attrs or None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        registry: dict[str, Any] = self.hass.data.setdefault(DOMAIN, {})
        entities: dict[str, Any] = registry.setdefault("event_entities", {})
        entities[self.entity_id] = self

    async def async_will_remove_from_hass(self) -> None:
        await super().async_will_remove_from_hass()
        registry = self.hass.data.get(DOMAIN, {})
        entities: dict[str, Any] = registry.get("event_entities", {})
        entities.pop(self.entity_id, None)

    @callback
    def _handle_om_event(self, pressed: bool) -> None:
        self._trigger_event("press" if pressed else "release")
        self.async_write_ha_state()
