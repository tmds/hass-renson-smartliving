/**
 * Shared i18n strings for the Renson Smart Living custom cards.
 *
 * The language follows hass.locale.language (e.g. "nl", "en-US");
 * anything unknown falls back to English. Import it from the cards:
 *
 *   import { t, dayLabels } from "./renson-i18n.js?v=1";
 *
 * Bump the ?v= in every importing card when this file changes.
 */

const STRINGS = {
  en: {
    hvac_mode_heating: "HVAC mode: heating",
    hvac_mode_cooling: "HVAC mode: cooling",
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
  },
  nl: {
    hvac_mode_heating: "HVAC-modus: verwarming",
    hvac_mode_cooling: "HVAC-modus: koeling",
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

export function normLang(lang) {
  return String(lang || "en").split(/[-_]/)[0].toLowerCase();
}

export function t(lang, key, params = {}) {
  const dict = STRINGS[normLang(lang)] || STRINGS.en;
  let s = dict[key] !== undefined ? dict[key] : STRINGS.en[key];
  if (s === undefined) return key;
  for (const [k, v] of Object.entries(params)) {
    s = s.split("{" + k + "}").join(String(v));
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
