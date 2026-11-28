/**
 * Shared utilities and i18n strings for the Renson Smart Living custom cards.
 *
 * The language follows hass.locale.language (e.g. "nl", "en-US");
 * anything unknown falls back to English.
 */

const STRINGS = {
  en: {
    target: "target",
    auto: "Auto",
    manual: "Manual",
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
    target: "doel",
    auto: "Auto",
    manual: "Handmatig",
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
  `;
}

export function openDialog(host, { title, bodyHTML = "", footerHTML = "", wide = false }) {
  const overlay = document.createElement("div");
  overlay.className = "dlg-overlay";
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
