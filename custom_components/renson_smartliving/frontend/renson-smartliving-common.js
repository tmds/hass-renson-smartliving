/**
 * Shared utilities and i18n strings for the Renson Smart Living custom cards.
 *
 * The language follows hass.locale.language (e.g. "nl", "en-US");
 * anything unknown falls back to English.
 */

const STRINGS = {
  en: {
    auto: "Auto",
    manual: "Manual",
    hour_unit: "h",
    override_title: "Until when?",
    override_hint: "Setpoint {temp}\u00B0, default until {end}",
    override_until: "Until (time)",
    override_permanent: "Permanent (no end time)",
    override_apply: "Apply",
    hvac_mode_heating: "HVAC mode: heating",
    hvac_mode_cooling: "HVAC mode: cooling",
    screen_timings: "Configure screen timings",
    gw_title: "Gateway configuration",
    gw_connected: "Connected",
    gw_unavailable: "Unavailable",
    gw_select_gateway: "Gateway",
    gw_count_inputs: "{n} inputs",
    gw_count_automations: "{n} automations",
    gw_count_screens: "{n} screens",
    gw_count_climate: "{n} thermostats",
    gw_edit_schedule: "Edit schedule",
    gw_no_climate: "No OpenMotics thermostats found",
    gw_away: "away",
    gw_manual_until: "manual until {time}",
    gw_tab_inputs: "Inputs",
    gw_tab_automations: "Automations",
    gw_tab_screens: "Screens",
    gw_tab_climate: "Thermostats",
    screen_timings_short: "Timers",
    timer_up_short: "up",
    timer_down_short: "down",
    no_timers: "No timers set",
    no_screens: "No OpenMotics screens found",
    gw_tab_inputs: "Inputs",
    gw_tab_automations: "Automations",
    gw_tab_screens: "Screens",
    configure_timings: "configureer de timings",
    timer_up: "Timer up (seconds to open)",
    timer_down: "Timer down (seconds to close)",
    save: "Save",
    timings_saved: "Timings saved",
    heating: "Heating",
    cooling: "Cooling",
    reorder_rooms: "Reorder rooms",
    edit_hint: "Drag the tiles to reorder, click the check to finish",
    lights_on: "{on}/{total} lights on",
    target: "target",
    configure_schedule: "Configure schedule",
    weekly_schedule: "Weekly schedule",
    now: "now",
    all: "All",
    add_setpoint: "+ Add setpoint",
    no_setpoints: "No setpoints for this day yet",
    remove: "Remove",
    away: "Away",
    lead_time: "Lead time",
    copy_schedule: "Copy schedule",
    save_settings: "Save settings",
    save_schedule: "Save schedule",
    copy_this_day: "Copy this day to another day",
    copy_week_other: "Copy week schedule to other thermostat",
    copy_src_to: "Copy <b>{src}</b> to:",
    copy: "Copy",
    copy_this_week_to: "Copy this week to:",
    copy_week: "Copy week",
    no_other_thermostat: "No other OpenMotics thermostat found",
    entity_not_found: "Entity not found: {entity}",
    schedule_saved: "Schedule saved",
    settings_saved: "Settings saved",
    copied_day_to: "Copied {src} to {targets}",
    week_copied_to: "Week copied to {entity}",
    link: "Link",
    no_room: "No room",
    linked_to: "Linked to {name}",
    not_linked: "Not linked",
    gateway_automation: "Gateway automation (long-press, screen toggle, ...)",
    runs_automation: "Runs automation {name}",
    tab_output: "Output",
    tab_automation: "Automation",
    new_automation: "+ New automation",
    new_automation_name: "Name of the new automation (max 16 chars)",
    currently_configured: "currently configured",
    ga_press: "{name} (on press)",
    ga_longpress: "{name} (long-press {sec}s)",
    ga_release: "{name} (on release)",
    ga_on_short: "{name} on short press",
    ga_on_long: "{name} on long press (>2s)",
    press_short: "On short press",
    press_long: "On long press (>2s)",
    no_automation: "(no automation)",
    multi_automation_warning: "This button triggers multiple automations. Saving replaces the whole sequence with the selected one.",
    longpress_runs: "Long-press {sec}s: run {name}",
    ba_shutter_toggle: "{name} up/stop/down toggle",
    ba_shutter_up_toggle: "{name} up/stop/up toggle",
    ba_shutter_down_toggle: "{name} down/stop/down toggle",
    link_hint: "Choose the output this button controls on the gateway. Pick nothing and save to unlink.",
    no_outputs: "No outputs found in this room",
    save_link: "Save link",
    cancel: "Cancel",
    extended_warning: "This button has extended gateway actions (timers, group actions, ...). Linking it to an output erases those actions and they cannot be restored by unlinking.",
    room: "Room",
    all_rooms: "All rooms",
    currently_linked: "currently linked",
    screen_label: "screen",
    editor_title: "Gateway automations",
    loading: "Loading...",
    unnamed: "Unnamed",
    tag_internal: "incomplete",
    tag_unsupported: "not editable",
    run: "Run",
    edit: "Edit",
    new_automation: "+ New automation",
    empty_action: "(empty)",
    raw_pair: "Unsupported action ({a},{n})",
    locked_unsupported: "This automation contains unsupported gateway actions. Editing is locked to avoid corrupting it (the gateway would silently drop them on save). You can still rename it and run it.",
    no_steps: "No steps yet. Add steps below.",
    add_step: "Add step",
    cat_output: "Output / light",
    cat_shutter: "Screen",
    cat_condition: "Condition",
    cat_other: "Other",
    field_name: "Name (max 16 characters, shown in the OpenMotics app)",
    out_on: "{name} on",
    out_off: "{name} off",
    out_toggle: "{name} toggle",
    out_on_min: "{name} on (min dimmer)",
    out_on_max: "{name} on (max dimmer)",
    out_dim_min: "{name} dimmer to minimum",
    out_dim_max: "{name} dimmer to maximum",
    out_on_dim: "{name} on at {dim}%",
    out_toggle_dim: "{name} toggle at {dim}%",
    out_on_timer: "{name} on for {timer} min ({over})",
    timer_overrule: "restarts timer",
    timer_keep: "keeps timer",
    shutter_up: "{name} up",
    shutter_down: "{name} down",
    shutter_stop: "{name} stop",
    shutter_toggle: "{name} up/stop/down",
    shutter_group_up: "Shutter group {name} up",
    shutter_group_down: "Shutter group {name} down",
    shutter_group_stop: "Shutter group {name} stop",
    shutter_group_toggle: "Shutter group {name} up/stop/down",
    shutter_up_stop_up: "{name} up/stop/up",
    shutter_down_stop_down: "{name} down/stop/down",
    shutter_group_up_stop_up: "Shutter group {name} up/stop/up",
    shutter_group_down_stop_down: "Shutter group {name} down/stop/down",
    kw_if: "IF",
    kw_and: "AND",
    kw_or: "OR",
    kw_then: "THEN",
    kw_else: "ELSE",
    kw_endif: "END IF",
    cond_output_on: "{name} is on",
    cond_output_off: "{name} is off",
    cond_input_on: "button {name} is pressed",
    cond_input_off: "button {name} is not pressed",
    cond_bit_on: "flag {id} is set",
    cond_bit_off: "flag {id} is clear",
    all_lights_off: "All lights off",
    all_outputs_off: "All outputs off",
    virt_press: "Press button {name}",
    virt_release: "Release button {name}",
    input_disable: "Disable button {name}",
    input_enable: "Enable button {name}",
    bit_set: "Set flag {id}",
    bit_clear: "Clear flag {id}",
    bit_toggle: "Toggle flag {id}",
    run_action: "Run automation {name}",
    save_failed: "Saving failed:",
  },
  nl: {
    auto: "Auto",
    manual: "Handmatig",
    hour_unit: "u",
    override_title: "Tot wanneer?",
    override_hint: "Setpoint {temp}\u00B0, standaard tot {end}",
    override_until: "Tot (tijdstip)",
    override_permanent: "Permanent (geen eindtijd)",
    override_apply: "Toepassen",
    hvac_mode_heating: "HVAC-modus: verwarming",
    hvac_mode_cooling: "HVAC-modus: koeling",
    screen_timings: "Screentimers instellen",
    gw_title: "Gatewayconfiguratie",
    gw_connected: "Verbonden",
    gw_unavailable: "Niet beschikbaar",
    gw_select_gateway: "Gateway",
    gw_count_inputs: "{n} ingangen",
    gw_count_automations: "{n} automatiseringen",
    gw_count_screens: "{n} screens",
    gw_count_climate: "{n} thermostaten",
    gw_edit_schedule: "Schema bewerken",
    gw_no_climate: "Geen OpenMotics thermostaten gevonden",
    gw_away: "afwezig",
    gw_manual_until: "handmatig tot {time}",
    gw_tab_inputs: "Ingangen",
    gw_tab_automations: "Automatiseringen",
    gw_tab_screens: "Screens",
    gw_tab_climate: "Thermostaten",
    screen_timings_short: "Timers",
    timer_up_short: "op",
    timer_down_short: "neer",
    no_timers: "Geen timers ingesteld",
    no_screens: "Geen OpenMotics screens gevonden",
    gw_tab_inputs: "Ingangen",
    gw_tab_automations: "Automatiseringen",
    gw_tab_screens: "Screens",
    configure_timings: "configureer de timings",
    timer_up: "Timer open (seconden tot open)",
    timer_down: "Timer dicht (seconden tot dicht)",
    save: "Opslaan",
    timings_saved: "Timers opgeslagen",
    heating: "Verwarming",
    cooling: "Koeling",
    reorder_rooms: "Kamers herordenen",
    edit_hint: "Sleep de tegels om te herordenen, klik op het vinkje om te sluiten",
    lights_on: "{on}/{total} lichten aan",
    target: "doel",
    configure_schedule: "Schema instellen",
    weekly_schedule: "Weekschema",
    now: "nu",
    all: "Alle",
    add_setpoint: "+ Setpoint toevoegen",
    no_setpoints: "Nog geen setpoints voor deze dag",
    remove: "Verwijderen",
    away: "Afwezig",
    lead_time: "Aanlooptijd",
    copy_schedule: "Schema kopiëren",
    save_settings: "Instellingen opslaan",
    save_schedule: "Schema opslaan",
    copy_this_day: "Kopieer deze dag naar een andere dag",
    copy_week_other: "Kopieer weekschema naar andere thermostaat",
    copy_src_to: "Kopieer <b>{src}</b> naar:",
    copy: "Kopiëren",
    copy_this_week_to: "Kopieer deze week naar:",
    copy_week: "Week kopiëren",
    no_other_thermostat: "Geen andere OpenMotics-thermostaat gevonden",
    entity_not_found: "Entiteit niet gevonden: {entity}",
    schedule_saved: "Schema opgeslagen",
    settings_saved: "Instellingen opgeslagen",
    copied_day_to: "{src} gekopieerd naar {targets}",
    week_copied_to: "Week gekopieerd naar {entity}",
    link: "Koppelen",
    no_room: "Geen ruimte",
    linked_to: "Gekoppeld aan {name}",
    not_linked: "Niet gekoppeld",
    gateway_automation: "Gateway-automation (long-press, screen-toggle, ...)",
    runs_automation: "Voert automation {name} uit",
    tab_output: "Output",
    tab_automation: "Automation",
    new_automation: "+ Nieuwe automation",
    new_automation_name: "Naam van de nieuwe automation (max 16 tekens)",
    currently_configured: "nu geconfigureerd",
    ga_press: "{name} (bij indrukken)",
    ga_longpress: "{name} (lang drukken {sec}s)",
    ga_release: "{name} (bij loslaten)",
    ga_on_short: "{name} bij kort drukken",
    ga_on_long: "{name} bij lang drukken (>2s)",
    press_short: "Bij kort drukken",
    press_long: "Bij lang drukken (>2s)",
    no_automation: "(geen automation)",
    multi_automation_warning: "Deze knop roept meerdere automations aan. Opslaan vervangt de hele reeks door de geselecteerde.",
    longpress_runs: "Lang drukken {sec}s: voert {name} uit",
    ba_shutter_toggle: "{name} omhoog/stop/omlaag",
    ba_shutter_up_toggle: "{name} omhoog/stop/omhoog",
    ba_shutter_down_toggle: "{name} omlaag/stop/omlaag",
    link_hint: "Kies de output die deze knop op de gateway bedient. Niets kiezen en opslaan = ontkoppelen.",
    no_outputs: "Geen outputs gevonden in deze ruimte",
    save_link: "Koppeling opslaan",
    cancel: "Annuleren",
    extended_warning: "Deze knop heeft uitgebreide gateway-acties (timers, groepsacties, ...). Koppeling aan een output wist die acties; ontkoppelen herstelt ze niet.",
    room: "Ruimte",
    all_rooms: "Alle ruimtes",
    currently_linked: "nu gekoppeld",
    screen_label: "scherm",
    editor_title: "Gateway-automations",
    loading: "Laden...",
    unnamed: "Naamloos",
    tag_internal: "incompleet",
    tag_unsupported: "niet bewerkbaar",
    run: "Uitvoeren",
    edit: "Bewerken",
    new_automation: "+ Nieuwe automation",
    empty_action: "(leeg)",
    raw_pair: "Niet-ondersteunde actie ({a},{n})",
    locked_unsupported: "Deze automation bevat niet-ondersteunde gateway-acties. Bewerken is vergrendeld om beschadiging te voorkomen (de gateway zou die stilletjes laten vallen bij het opslaan). Hernoemen en uitvoeren kan wel.",
    no_steps: "Nog geen stappen. Voeg hieronder stappen toe.",
    add_step: "Stap toevoegen",
    cat_output: "Output / licht",
    cat_shutter: "Scherm",
    cat_condition: "Voorwaarde",
    cat_other: "Overig",
    field_name: "Naam (max 16 tekens, zichtbaar in de OpenMotics-app)",
    out_on: "{name} aan",
    out_off: "{name} uit",
    out_toggle: "{name} togglen",
    out_on_min: "{name} aan (dimmer min)",
    out_on_max: "{name} aan (dimmer max)",
    out_dim_min: "{name} dimmer naar minimum",
    out_dim_max: "{name} dimmer naar maximum",
    out_on_dim: "{name} aan op {dim}%",
    out_toggle_dim: "{name} togglen op {dim}%",
    out_on_timer: "{name} aan gedurende {timer} min ({over})",
    timer_overrule: "herstart timer",
    timer_keep: "behoudt timer",
    shutter_up: "{name} omhoog",
    shutter_down: "{name} omlaag",
    shutter_stop: "{name} stop",
    shutter_toggle: "{name} omhoog/stop/omlaag",
    shutter_group_up: "Schermgroep {name} omhoog",
    shutter_group_down: "Schermgroep {name} omlaag",
    shutter_group_stop: "Schermgroep {name} stop",
    shutter_group_toggle: "Schermgroep {name} omhoog/stop/omlaag",
    shutter_up_stop_up: "{name} omhoog/stop/omhoog",
    shutter_down_stop_down: "{name} omlaag/stop/omlaag",
    shutter_group_up_stop_up: "Schermgroep {name} omhoog/stop/omhoog",
    shutter_group_down_stop_down: "Schermgroep {name} omlaag/stop/omlaag",
    kw_if: "ALS",
    kw_and: "EN",
    kw_or: "OF",
    kw_then: "DAN",
    kw_else: "ANDERS",
    kw_endif: "EINDE ALS",
    cond_output_on: "{name} is aan",
    cond_output_off: "{name} is uit",
    cond_input_on: "knop {name} is ingedrukt",
    cond_input_off: "knop {name} is niet ingedrukt",
    cond_bit_on: "vlag {id} staat aan",
    cond_bit_off: "vlag {id} staat uit",
    all_lights_off: "Alle lichten uit",
    all_outputs_off: "Alle outputs uit",
    virt_press: "Knop {name} indrukken",
    virt_release: "Knop {name} loslaten",
    input_disable: "Knop {name} uitschakelen",
    input_enable: "Knop {name} inschakelen",
    bit_set: "Vlag {id} zetten",
    bit_clear: "Vlag {id} wissen",
    bit_toggle: "Vlag {id} togglen",
    run_action: "Automation {name} uitvoeren",
    save_failed: "Opslaan mislukt:",
  },
};

const DAY_LABELS = {
  en: [
    ["mon", "Mo"], ["tue", "Tu"], ["wed", "We"], ["thu", "Th"],
    ["fri", "Fr"], ["sat", "Sa"], ["sun", "Su"],
  ],
  nl: [
    ["mon", "Ma"], ["tue", "Di"], ["wed", "Wo"], ["thu", "Do"],
    ["fri", "Vr"], ["sat", "Za"], ["sun", "Zo"],
  ],
};

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function shortName(hass, entityId) {
  const st = hass && hass.states[entityId];
  if (!st) return entityId;
  const raw = st.attributes.friendly_name || entityId;
  return raw.includes(") ") ? raw.split(") ").slice(1).join(") ") : raw;
}

export function normLang(lang) {
  return String(lang || "en").split(/[-_]/)[0].toLowerCase();
}

export function t(lang, key, params = {}) {
  const dict = STRINGS[normLang(lang)] || STRINGS.en;
  let s = dict[key] !== undefined ? dict[key] : STRINGS.en[key];
  if (s === undefined) return key;
  for (const [k, v] of Object.entries(params)) {
    s = s.split("{" + k + "}").join(esc(String(v)));
  }
  return s;
}

export function dayLabels(lang) {
  return DAY_LABELS[normLang(lang)] || DAY_LABELS.en;
}

export function dayLabel(lang, key) {
  const pair = dayLabels(lang).find(([d]) => d === key);
  return pair ? pair[1] : key;
}

/* ------------------------------------------------------------------ */
/* Shared dialog                                                        */
/*                                                                      */
/* One overlay/dialog look for every card in this integration: rounded  */
/* panel, header with title + close button, scrollable body, footer     */
/* with a right-aligned primary button. Close on Escape and backdrop    */
/* click. openDialog returns the overlay element; the caller wires its  */
/* own buttons and calls overlay.close().                               */
/* ------------------------------------------------------------------ */

export function dialogCSS() {
  return `
    .dlg-overlay {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,.5);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    .dlg {
      position: relative; width: 420px; max-width: 94vw;
      max-height: 88vh; display: flex; flex-direction: column;
      background: var(--card-background-color);
      border-radius: var(--ha-card-border-radius, 16px);
      box-shadow: 0 12px 40px rgba(0,0,0,.35);
      color: var(--primary-text-color);
      font-family: inherit;
    }
    .dlg-head {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 16px 10px;
    }
    .dlg-head h3 {
      margin: 0; flex: 1; font-size: 1em; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dlg-close {
      border: none; background: var(--secondary-background-color);
      color: var(--primary-text-color);
      width: 32px; height: 32px; border-radius: 50%;
      cursor: pointer; font-size: 1.05em; flex-shrink: 0;
    }
    .dlg-body { padding: 0 16px; overflow-y: auto; }
    .dlg-foot {
      padding: 12px 16px 14px; display: flex;
      justify-content: flex-end; gap: 8px;
    }
    .dlg-primary {
      border: none; border-radius: 12px; padding: 10px 22px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font: inherit; font-weight: 600; cursor: pointer;
    }
    .dlg-field {
      display: block; font-size: .78em; font-weight: 600;
      color: var(--secondary-text-color); margin: 12px 0 4px;
    }
    .dlg-input-wrap { position: relative; display: flex; align-items: center; }
    .dlg-input-suffix {
      margin-left: 8px; font-size: .85em;
      color: var(--secondary-text-color);
    }
    .dlg input.dlg-input {
      width: 100%; box-sizing: border-box;
      border: 1px solid var(--divider-color);
      border-radius: 10px; padding: 10px 12px;
      font-size: 1em; background: var(--secondary-background-color);
      color: var(--primary-text-color);
    }
  `;
}

export function openDialog(host, { title, bodyHTML = "", footerHTML = "", wide = false }) {
  const overlay = document.createElement("div");
  overlay.className = "dlg-overlay";
  // The overlay lives in document.body, outside every card's shadow root,
  // so it has to bring its own styles (the card's <style> does not reach it).
  overlay.innerHTML = `
    <style>${dialogCSS()}
      .dlg.wide { width: 760px; }
      .dlg-overlay { box-sizing: border-box; }
      .dlg .saved {
        display: block; text-align: center; margin-top: 8px;
        font-size: .85em; color: var(--primary-color); font-weight: 600;
      }
      .dlg .saved:empty { display: none; }
    </style>
    <div class="dlg${wide ? " wide" : ""}" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h3>${esc(title)}</h3>
        <button class="dlg-close" aria-label="Close">&#215;</button>
      </div>
      <div class="dlg-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="dlg-foot">${footerHTML}</div>` : ""}
    </div>`;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".dlg-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  overlay.close = close;
  document.body.appendChild(overlay);
  return overlay;
}

/* ------------------------------------------------------------------ */
/* Schedule strip: today's heating schedule as a colored bar with a     */
/* "now" marker. Shared by the thermostat tile card and the gateway     */
/* configuration card's Thermostats tab.                                */
/* ------------------------------------------------------------------ */

function _sec(t) {
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
}

function _scheduleColor(temp) {
  const stops = [
    [255, 224, 130],
    [255, 183, 77],
    [255, 112, 67],
  ];
  const min = 8, max = 24;
  const t = Math.max(0, Math.min(1, (temp - min) / (max - min)));
  const seg = t < 0.5 ? 0 : 1;
  const f = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg], b = stops[seg + 1];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function scheduleStripCSS() {
  return `
    .schedwrap { container-type: inline-size; }
    .schedbar { position: relative; }
    .sched { position: relative; height: 10px; border-radius: 5px;
             overflow: hidden; background: var(--secondary-background-color); }
    .sched div { position: absolute; top: 0; bottom: 0; }
    .sched .nowmark { top: -2px; bottom: -2px; width: 2px;
                      background: var(--primary-text-color); opacity: .8; }
    /* Hover layer on top of the bar. It sits outside the bar's
       overflow:hidden so the popup is not clipped; one block per segment. */
    .schedhover { position: absolute; inset: -3px 0; }
    .schedhover div { position: absolute; top: 0; bottom: 0; border-radius: 6px; }
    .schedhover div:hover { box-shadow: inset 0 0 0 2px var(--primary-text-color); }
    .schedhover div:hover::after {
      content: attr(data-tip);
      position: absolute; bottom: calc(100% + 6px); left: 50%;
      transform: translateX(-50%);
      white-space: nowrap; pointer-events: none; z-index: 5;
      font-size: .74rem; font-weight: 600; line-height: 1.2;
      padding: 5px 9px; border-radius: 8px;
      background: var(--primary-text-color);
      color: var(--card-background-color);
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
    }
    .schedhover div.edge-l:hover::after { left: 0; transform: none; }
    .schedhover div.edge-r:hover::after { left: auto; right: 0; transform: none; }
    .schedlabels { position: relative; height: 12px; margin-top: 4px;
                   font-size: .6em; color: var(--secondary-text-color);
                   font-variant-numeric: tabular-nums; }
    .schedlabels span { position: absolute; top: 0; transform: translateX(-50%); }
    .schedlabels span:last-child { transform: translateX(-100%); }
    /* Narrow bars: every other hour, then every six hours. */
    @container (max-width: 560px) { .schedlabels span.odd { display: none; } }
    @container (max-width: 260px) { .schedlabels span:not(.q) { display: none; } }
  `;
}

function _hhmm(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

export function scheduleStripHTML(entity) {
  const attrs = (entity && entity.attributes) || {};
  const src = attrs.heating_schedule || {};
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const today = dayKeys[(new Date().getDay() + 6) % 7];
  const setpoints = Object.entries(src[today] || {})
    .map(([time, temp]) => ({ time, temp: Number(temp) }))
    .sort((a, b) => _sec(a.time) - _sec(b.time));
  // Hour labels 01..24 on their exact position under the bar.
  const hours = [];
  for (let h = 1; h <= 24; h++) {
    const cls = [h % 2 ? "odd" : "", h % 6 === 0 ? "q" : ""].filter(Boolean).join(" ");
    hours.push(`<span class="${cls}" style="left:${((h / 24) * 100).toFixed(3)}%">${String(h).padStart(2, "0")}</span>`);
  }
  const labels = `<div class="schedlabels">${hours.join("")}</div>`;
  if (!setpoints.length) {
    return `<div class="schedwrap"><div class="schedbar"><div class="sched"></div></div>${labels}</div>`;
  }
  // The setpoint that is active at 00:00 is the last one of the previous
  // day (fall back to today's last one). Without this the bar starts at
  // the first setpoint and the left part of the day stays empty.
  const prevKey = dayKeys[(dayKeys.indexOf(today) + 6) % 7];
  const prevSetpoints = Object.entries(src[prevKey] || {})
    .map(([time, temp]) => ({ time, temp: Number(temp) }))
    .sort((a, b) => _sec(a.time) - _sec(b.time));
  const carrySrc = prevSetpoints.length ? prevSetpoints : setpoints;
  const carry = carrySrc[carrySrc.length - 1];
  const segs = [];
  const firstFrom = _sec(setpoints[0].time);
  if (firstFrom > 0) segs.push({ from: 0, to: firstFrom, temp: carry.temp });
  for (let i = 0; i < setpoints.length; i++) {
    const from = _sec(setpoints[i].time);
    const to = i + 1 < setpoints.length ? _sec(setpoints[i + 1].time) : 86400;
    if (to > from) segs.push({ from, to, temp: setpoints[i].temp });
  }
  const pos = (sg) => `left:${(sg.from / 864).toFixed(3)}%;width:${((sg.to - sg.from) / 864).toFixed(3)}%`;
  const bar = segs.map((sg) => `<div style="${pos(sg)};background:${_scheduleColor(sg.temp)}"></div>`);
  const nowPct = ((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * 100;
  bar.push(`<div class="nowmark" style="left:${nowPct.toFixed(3)}%"></div>`);
  const hover = segs.map((sg) => {
    // Popup centred on the block, except near the card edges.
    const mid = (sg.from + sg.to) / 2;
    const edge = mid < 8640 ? "edge-l" : mid > 77760 ? "edge-r" : "";
    const tip = `${_hhmm(sg.from)}-${_hhmm(sg.to)} · ${fmtTemp(sg.temp)}°`;
    return `<div class="${edge}" style="${pos(sg)}" data-tip="${esc(tip)}"></div>`;
  });
  return `<div class="schedwrap"><div class="schedbar"><div class="sched">${bar.join("")}</div><div class="schedhover">${hover.join("")}</div></div>${labels}</div>`;
}

export function fmtTemp(t) {
  return t === undefined || t === null ? "?" : Number(t).toFixed(1).replace(/\.0$/, "");
}
