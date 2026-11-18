# Thermostat support, gateway automation editor, input/output linking and dashboard cards

This PR adds thermostat (climate) support to the Renson Smart Living integration, a full editor for the gateway's own automations (group actions), extended input/output linking, and a set of Lovelace cards for a room-centric dashboard. It is developed and running against a Gateway with firmware 3.9.9 (V1 API, local connection), with 171 tests green (upstream's 103 plus 68 new) and ruff/mypy clean on all changed code.

## Climate platform (thermostats)

- New `climate` platform exposing every OpenMotics thermostat as a climate entity.
  - Heating-only: HVAC modes `off` / `heat`, target temperature 6-32 C in 0.5 steps.
  - `hvac_action` derived from the thermostat's steering power, so "currently heating" is visible in HA.
  - Preset mapping: gateway `auto` / `away` / `party` / `manual` map to HA `none` / `away` / `boost` / `none+override`.
  - Setting a temperature writes the setpoint with a configurable preset expiration (default: 2 hours); returning to the schedule returns the preset to `auto`.
- Real-time updates purely via WebSocket push: `THERMOSTAT_CHANGE` and `THERMOSTAT_GROUP_CHANGE` are added to the subscription; no polling.
- Gateway API: V1 thermostat endpoints with JSON-body PUTs; raw-list and empty-body responses are handled.

## REST configuration fallback for older firmware

- Firmware 3.9.9 does not implement `/api/sync/control` (404) and never pushes `*_CONTROL` config events over WebSocket.
- When the sync-control API is unavailable, the coordinator falls back to the legacy REST endpoints (`get_output/shutter/sensor/room/group_action_configurations`, `get_platform_details`, `get_version`) so the integration still works on older gateways.
- Enum casing is normalized (REST returns lowercase, WS events uppercase).

## Gateway automation (group action) editor

The gateway stores its own automations ("group actions") as classic bytecode: comma-separated `(action_type, action_number)` pairs. This PR decodes that format and builds a full editor on top of it:

- New `group_actions.py` validation module. The gateway's own mapper silently DROPS unknown action types when saving; the integration validates the pair list before writing (even length, known opcodes, structurally sound IF/AND/OR/THEN/ELSE/ENDIF nesting) and refuses unsafe writes.
- New services:
  - `get_group_actions`: returns all group actions plus the output/shutter/input name maps (used by the editor card).
  - `save_group_action`: create or update a group action (validated).
  - `run_group_action`: trigger a group action by id.
- New `renson-automation-editor` card:
  - Lists every gateway automation with a decoded summary, Run and Edit buttons, and "+ New automation".
  - Visual step editor: colored keyword pills (IF/AND/OR/THEN/ELSE/END IF) with code-style indentation, icons per action type (output on/off/dim/timer, shutter up/down/stop/toggle, conditions, virtual inputs, validation bits), reorder and delete per step.
  - The add-step menu greys out options that cannot follow the current sequence (conditions only inside an IF condition region, ELSE only after THEN, actions only outside condition regions, ...), mirroring the validator.
  - Automations containing unsupported opcodes are marked "not editable" and can only be renamed or run, preventing silent corruption.
- Supported opcode subset: outputs (on/off/toggle/dim %/timers), shutters, IF/AND/OR/THEN/ELSE/ENDIF with output/input/validation-bit conditions, all-lights-off, virtual input press/release, input enable/disable, validation bits, nested group action calls.

## Input/output linking (extended)

- `set_input_link` now supports three target kinds:
  - a direct output link (`action = output_id`),
  - a screen link (`240` + `103,<shutter>` toggle),
  - a gateway automation (`240` + `2,<group_action_id>`, the gateway's own encoding).
- Event entities expose `linked_output_id/name`, `linked_group_action_id`, `has_extended_actions` and the raw `basic_actions`, and recognize all single-pair shutter encodings (100/101/102/103/108/109).
- The link dialog has Output/Automation tabs:
  - Automations that the button currently triggers are badged "currently configured"; a pure automation link is pre-selected.
  - An automation can be created on the fly ("+ New automation": picks a free slot, writes the name, links it in one step).
  - Rows show exactly what a button does, decoded: "toggle radio (long-press 1s) · keuken all on (on press)", "screen keuken up/stop/up toggle".
  - Each automation row has an Edit button that opens the automation editor dialog inline (instant, no extra round-trip); closing it refreshes the link dialog.
  - Rows flash with a tap icon when the physical button is pressed (gateway INPUT_CHANGE push -> event entity update).
  - Combo inputs (long-press + release sequences) warn that saving replaces the whole sequence, since the gateway encoding only supports a single target per save.
- Covers expose `openmotics_id` so cards can map an entity back to its shutter id.

## Services

- `renson_smartliving.set_thermostat_schedule`: write a thermostat schedule, including a full 7-day week payload.
- `renson_smartliving.set_thermostat_config`: write thermostat configuration (setpoints, away temperature, lead time).
- `renson_smartliving.set_input_link`: link an input to an output, a screen or a gateway automation from HA.
- `renson_smartliving.set_shutter_timings`: set the up/down travel timers of a shutter. The full shutter configuration is always sent, because the gateway serializer resets omitted fields to their defaults.
- `renson_smartliving.get_group_actions` / `save_group_action` / `run_group_action`: gateway automation read/write/trigger.

## Covers

- Covers now advertise `SUPPORT_SET_POSITION` and implement it via `do_shutter_goto` on firmware that supports it.
- On firmware without goto support, position requests are emulated with calibrated up/down runs and position polling (hybrid slider), so the slider works everywhere.
- Shutter timers (`timer_up` / `timer_down`) are exposed as entity attributes for the UI.

## Compatibility

- `UnitOfTemperature` is imported from `homeassistant.const` (moved there in newer HA versions), keeping the integration installable on current and older cores.

## Lovelace cards (www/)

A set of custom cards for a room-centric dashboard, all NL/EN localized via a shared `renson-i18n.js` module (language follows the HA profile):

- **rooms-grid**: full-width panel view with one tile per room: quick-toggle icon chips for lights and shutters, heating badge with flame/snowflake, hover tooltips with entity names, and drag & drop reordering in an edit mode. The persisted room order also reorders the dashboard tabs.
- **room-card**: standalone room entry card for navigation.
- **thermostat-config-card**: schedule editor with a heatmap of the week, day tabs, setpoint steppers, away temperature and lead time, plus a "copy schedule" dialog (single day or whole week to another thermostat).
- **schedule-button**: button that opens the schedule editor popup next to the native thermostat card.
- **thermostat-card**: thermostat tile with today's schedule heatmap.
- **screen-card**: cover tile (up/stop/down + position slider) with an integrated timer button that opens a dialog to edit the shutter timings.
- **screen-timings-button**: standalone variant of the timings dialog.
- **input-link-card**: dialog to link an input to an output, a screen or a gateway automation (or create a new automation inline), with room dropdown, current-link preselection, decoded link descriptions and a press flash when the physical button is used.
- **automation-editor**: view/edit/create/trigger the gateway's own automations, as described above.

## Testing

- 171 tests green (103 upstream + 68 new: climate, schedule/config services, input link, shutter timings, cover position, group action validation and services).
- ruff and mypy clean on all changed files.
- Everything verified end-to-end against a real gateway on firmware 3.9.9 in a dedicated dev HA instance (climate service -> PUT -> WS push -> entity update; automation editor -> validated write -> gateway config; input link -> gateway EEPROM -> physical press).
