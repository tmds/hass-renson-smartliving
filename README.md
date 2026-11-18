# Renson Smart Living

Home Assistant integration for Renson Smart Living (OpenMotics) gateways.

The integration synchronizes the Smart Living system configuration to Home Assistant. The configuration is re-applied each time the configuration loads. This happens when a connection is established. The user can also do this through the Home Assistant UI by clicking 'Reload' on the configuration item.

Rooms are added if they do not exist in home assistant.

The OpenMotics "entities" are mapped as follows to Home Assistant entities:

| OpenMotics Entity | Home Assistant Entity |
|---|---|
| Output (type Light) | Light |
| Output (type ShutterRelay) | Cover |
| Output (dimmer module, not Light) | Fan |
| Output (relay module, not Light/ShutterRelay) | Switch |
| Sensor (temperature, humidity, co2, power) | Sensor |
| Input | Event (press/release) |
| Group Action | Scene |
| Thermostat | Climate |

The entity ids are formatted: `{hass_platform}.{room}_{name}`, for example, `light.living_eettafel`. When the room name and entity name match, the room name is omitted. Sensor names are prefixed with the type of sensor, for example: `sensor.temp_bureau`. Group action scenes are prefixed with `ga_`, for example: `scene.ga_all_off`.

When the names/rooms change in the smart living system, the entities provided by the integration will change to match. Stale entities are automatically removed.

## Services

### Thermostats

- `renson_smartliving.set_thermostat_schedule`: replace the heating schedule of a thermostat for one, several or all days. Setpoints are `{time: "HH:MM", temperature: x}` entries; a full week can be copied between thermostats with the `week` field.

  ```yaml
  service: renson_smartliving.set_thermostat_schedule
  target:
    entity_id: climate.living
  data:
    setpoints:
      - {time: "06:30", temperature: 20}
      - {time: "22:00", temperature: 17}
  ```

- `renson_smartliving.set_thermostat_config`: set the away temperature and the lead time (early heating, minutes before a schedule setpoint).

Setting a temperature on the climate entity writes the setpoint with a preset expiration (default 2 hours, configurable per config entry); returning the preset to `auto` resumes the schedule.

### Inputs and shutters

- `renson_smartliving.set_input_link`: link an input (button) directly to an output, a screen or a gateway automation. A linked input acts on the gateway itself, even without Home Assistant running. Omit the target to unlink; inputs with extended gateway actions require `force: true` because linking or unlinking erases them.

  ```yaml
  service: renson_smartliving.set_input_link
  target:
    entity_id: event.bureau_bureau_deur_1_2
  data:
    output_entity: light.bureau_bureau
  ```

  Automations support short/long press: `group_action_id` runs on a short
  press, `group_action_id_long` on a long press (>2s hold). Both together
  write the gateway's combined 8-byte form (`207,<long>,236,0,2,<short>,236,255`).

- `renson_smartliving.set_shutter_timings`: set the travel timers (`timer_up` / `timer_down`, seconds) of a shutter. These drive the gateway's position estimate and the position slider.

### Gateway automations (group actions)

Gateway automations are stored as classic bytecode (`action_type, action_number` pairs). The integration validates that bytecode before writing, because the gateway silently drops unsupported action types.

- `renson_smartliving.get_group_actions`: read all gateway automations plus the output/shutter/input name maps.
- `renson_smartliving.save_group_action`: create or update an automation (`id`, `name`, `actions` as comma-separated pairs, `show_in_app`).
- `renson_smartliving.run_group_action`: trigger an automation by id.

The `renson-automation-editor` Lovelace card (in `www/`) provides a visual editor for these automations, including IF/THEN/ELSE blocks, dimmer and timer actions and shutter toggles.

## Installation

### HACS

1. Open HACS in Home Assistant
2. Go to **Integrations**
3. Click the three-dot menu (top right) and select **Custom repositories**
4. Add `https://github.com/tmds/hass-renson-smartliving` with category **Integration**
5. Click **Download** on the Renson Smart Living card
6. Restart Home Assistant

## Configuration

The integration is configured via the UI. You will need:

- **Host**: IP address or hostname of your OpenMotics gateway
- **Username**: Gateway login username
- **Password**: Gateway login password

## Logging

Add the following to your `configuration.yaml` to enable debug logging:

```yaml
logger:
  default: warning
  logs:
    custom_components.renson_smartliving: info
    # custom_components.renson_smartliving.http: debug
    # custom_components.renson_smartliving.ws: debug
```

The `.http` logger traces REST API requests and responses. The `.ws` logger traces WebSocket messages. Both can be enabled independently.

## Development

Using a [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) provides a simple way to run home assistant locally with the integration in a container.

1. Open the project in VS Code
2. When prompted, click **Reopen in Container** (or use the command palette: *Dev Containers: Reopen in Container*)
3. Wait for the container to build and setup to complete (first time takes a few minutes)
4. Open a terminal and run `scripts/start`
5. Open `http://localhost:8123` in your browser
6. Complete the HA onboarding, then go to **Settings > Devices & Services > Add Integration** and search for "Renson Smart Living"

Code changes are picked up on restart. The HA config is stored in `config/` at the repo root (`configuration.yaml` is tracked, all other runtime state is gitignored).

### Linting and tests

```bash
uv run ruff check .
uv run pytest
```
