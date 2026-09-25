from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.scene import Scene
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

if TYPE_CHECKING:
    from . import OpenMoticsConfigEntry
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_config_loaded
from .entity import OpenMoticsEntity, remove_stale_entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OpenMoticsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenMotics scenes (group actions)."""
    coordinator = entry.runtime_data.coordinator

    @callback
    def _on_config_loaded() -> None:
        entities = create_entities(coordinator)
        remove_stale_entities(hass, entry, "scene", entities)
        async_add_entities(entities)

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, signal_config_loaded(entry.entry_id), _on_config_loaded
        )
    )


def create_entities(
    coordinator: OpenMoticsCoordinator,
) -> list[OpenMoticsScene]:
    """Create scene entities from group action config."""
    entities: list[OpenMoticsScene] = []
    for ga in coordinator.group_actions:
        if not ga.get("name"):
            continue
        naming = coordinator.resolve_entity_naming(
            ga["name"], None, "group_action", ga["id"], "scene",
            entity_id_prefix="ga",
        )
        entities.append(
            OpenMoticsScene(
                coordinator=coordinator,
                naming=naming,
                group_action_id=ga["id"],
            )
        )
    return entities


class OpenMoticsScene(OpenMoticsEntity, Scene):
    """An OpenMotics group action exposed as a scene."""

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        group_action_id: int,
    ) -> None:
        super().__init__(coordinator, naming)
        self._group_action_id = group_action_id

    async def async_activate(self, **kwargs: Any) -> None:
        await self.coordinator.client.do_group_action(self._group_action_id)
