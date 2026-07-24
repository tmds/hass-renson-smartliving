from __future__ import annotations

import logging
from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .api import OpenMoticsClient
from .const import CONF_HOST, DOMAIN, PLATFORMS
from .coordinator import GatewayInfo, OpenMoticsCoordinator
from .sync import SyncLoop

_LOGGER = logging.getLogger(__name__)

type OpenMoticsConfigEntry = ConfigEntry[OpenMoticsRuntimeData]


@dataclass
class OpenMoticsRuntimeData:
    """Runtime data for an OpenMotics config entry."""

    coordinator: OpenMoticsCoordinator
    sync_loop: SyncLoop | None = None


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

    runtime_data.sync_loop = SyncLoop(
        client=client,
        on_config=coordinator.handle_config,
        on_full_update=coordinator.handle_full_update,
        on_event=coordinator.apply_event,
    )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    runtime_data.sync_loop.start()
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: OpenMoticsConfigEntry
) -> bool:
    """Unload an OpenMotics config entry."""
    if entry.runtime_data.sync_loop is not None:
        await entry.runtime_data.sync_loop.stop()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
