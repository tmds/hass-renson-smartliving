from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "renson_smartliving"

PLATFORMS: list[Platform] = [
    Platform.COVER,
    Platform.EVENT,
    Platform.FAN,
    Platform.LIGHT,
    Platform.SENSOR,
    Platform.SWITCH,
]

CONF_HOST = "host"

OUTPUT_TYPE_LIGHT = 255
OUTPUT_TYPE_SHUTTER_RELAY = 127
