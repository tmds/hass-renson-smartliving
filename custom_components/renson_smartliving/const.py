from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "renson_smartliving"

PLATFORMS: list[Platform] = [
    Platform.CLIMATE,
    Platform.COVER,
    Platform.EVENT,
    Platform.FAN,
    Platform.LIGHT,
    Platform.SCENE,
    Platform.SENSOR,
    Platform.SWITCH,
]

CONF_HOST = "host"
# Hours a manual setpoint override stays active before the schedule resumes.
# 0 means the override never expires (permanent until AUTO is selected).
CONF_PRESET_EXPIRATION_HOURS = "preset_expiration_hours"


# Thermostat defaults: matches the old Homebridge behavior where a
# manual setpoint change expires after 2 hours and the schedule
# takes over again.
DEFAULT_PRESET_EXPIRATION_HOURS = 2

# OpenMotics setpoint range.
THERMOSTAT_MIN_TEMP = 6
THERMOSTAT_MAX_TEMP = 32

# HA preset for the gateway "auto" preset (schedule in control).
# HA has no PRESET_AUTO constant.
PRESET_AUTO = "auto"

# Day keys used by the gateway schedule format.
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

OUTPUT_TYPE_LIGHT = 255
OUTPUT_TYPE_SHUTTER_RELAY = 127
