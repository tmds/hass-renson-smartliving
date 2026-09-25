from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import EntityNaming, OpenMoticsCoordinator, signal_entity_event

_LOGGER = logging.getLogger(__name__)


def remove_stale_entities(
    hass: HomeAssistant,
    entry: ConfigEntry,
    domain: str,
    current_entities: list[OpenMoticsEntity],
) -> None:
    """Remove entities that no longer exist on the gateway."""
    ent_reg = er.async_get(hass)
    current_unique_ids = {e.unique_id for e in current_entities}
    existing = er.async_entries_for_config_entry(ent_reg, entry.entry_id)
    for reg_entry in existing:
        if (
            reg_entry.domain == domain
            and reg_entry.unique_id not in current_unique_ids
        ):
            _LOGGER.info(
                "Removing stale entity %s (unique_id=%s)",
                reg_entry.entity_id,
                reg_entry.unique_id,
            )
            ent_reg.async_remove(reg_entry.entity_id)


class OpenMoticsEntity(CoordinatorEntity[OpenMoticsCoordinator]):
    """Base entity for OpenMotics."""

    _ws_change_type: str | None = None
    _om_id: int | None = None

    def __init__(
        self,
        coordinator: OpenMoticsCoordinator,
        naming: EntityNaming,
        room_id: int | None = None,
    ) -> None:
        super().__init__(coordinator)
        self._naming = naming
        self._attr_unique_id = naming.unique_id
        self._attr_name = naming.friendly_name
        self.entity_id = naming.suggested_entity_id
        self.om_room_id = room_id

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if self._ws_change_type is not None and self._om_id is not None:
            self.async_on_remove(
                async_dispatcher_connect(
                    self.hass,
                    signal_entity_event(
                        self._ws_change_type,
                        self._om_id,
                        self.coordinator.entry.entry_id,
                    ),
                    self._handle_om_event,
                )
            )
        # Override the registry name to prevent HA from prefixing the device name.
        ent_reg = er.async_get(self.hass)
        updates: dict[str, Any] = {"name": self._naming.friendly_name}
        if self.om_room_id is not None:
            area_id = self.coordinator.room_to_area.get(self.om_room_id)
            if area_id:
                updates["area_id"] = area_id
        ent_reg.async_update_entity(self.entity_id, **updates)

    @callback
    def _handle_om_event(self, *_args: Any) -> None:
        self.async_write_ha_state()

    @property
    def device_info(self) -> DeviceInfo:
        gw = self.coordinator.gateway_info
        return DeviceInfo(
            identifiers={(DOMAIN, gw.device_id)},
            name=f"Smart Living Controller ({self.coordinator.client.host})",
            manufacturer="Renson NV",
            model=gw.model,
            sw_version=gw.gateway_version,
            serial_number=gw.master_serial,
        )
