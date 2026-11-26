from __future__ import annotations

from typing import Any

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
# Per-output minimum dim level (LED drivers that go dark below their floor).
# Stored as a comma separated "output_id:percent" list, e.g. "27:12,21:30".
CONF_MIN_DIM_LEVELS = "min_dim_levels"
# Hours a manual setpoint override stays active before the schedule resumes.
# 0 means the override never expires (permanent until AUTO is selected).
CONF_PRESET_EXPIRATION_HOURS = "preset_expiration_hours"
def parse_min_dim_levels(raw: Any) -> dict[int, int]:
    """Parse a "27:12,21:30" style string into {output_id: min_percent}."""
    result: dict[int, int] = {}
    if not raw:
        return result
    for part in str(raw).split(","):
        part = part.strip()
        if ":" not in part:
            continue
        oid, _, pct = part.partition(":")
        try:
            value = int(pct)
        except ValueError:
            continue
        if 0 < value <= 100:
            try:
                result[int(oid)] = value
            except ValueError:
                continue
    return result


# OpenMotics setpoint range.
THERMOSTAT_MIN_TEMP = 6
THERMOSTAT_MAX_TEMP = 32

# HA preset for the gateway "auto" preset (schedule in control).
# HA has no PRESET_AUTO constant.
PRESET_AUTO = "auto"

# Day keys used by the gateway schedule format.
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# Thermostat defaults: matches the old Homebridge behavior where a
# manual setpoint change expires after 2 hours and the schedule
# takes over again.
DEFAULT_PRESET_EXPIRATION_HOURS = 2

OUTPUT_TYPE_LIGHT = 255
OUTPUT_TYPE_SHUTTER_RELAY = 127
