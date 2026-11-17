/**
 * Renson Smart Living thermostat config card.
 *
 * Edit the weekly heating schedule, away temperature and lead time of
 * an OpenMotics thermostat from the renson_smartliving integration.
 * Reads the entity attributes written by the integration and calls the
 * renson_smartliving.set_thermostat_schedule / set_thermostat_config
 * services.
 *
 * Manual card config:
 *   type: custom:renson-thermostat-config-card
 *   entity: climate.praktijk
 */
class RensonThermostatConfigCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._selectedDay = "mon";
    this._edit = null;
    this.renderRoot = this.attachShadow({ mode: "open" });
  }

  getCardSize() {
    return 6;
  }

  _entity() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  _days() {
    return [
      ["mon", "Mo"], ["tue", "Tu"], ["wed", "We"], ["thu", "Th"],
      ["fri", "Fr"], ["sat", "Sa"], ["sun", "Su"],
    ];
  }

  _schedule(entity) {
    const attrs = entity.attributes || {};
    const src = attrs.heating_schedule || {};
    const out = {};
    for (const [day, setpoints] of Object.entries(src)) {
      out[day] = Object.entries(setpoints)
        .map(([time, temp]) => ({ time, temp: Number(temp) }))
        .sort((a, b) => this._sec(a.time) - this._sec(b.time));
    }
    return out;
  }

  _sec(t) {
    const [h, m] = String(t).split(":").map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  }

  _editSchedule(entity) {
    if (!this._edit) {
      const s = this._schedule(entity);
      this._edit = JSON.parse(JSON.stringify(s));
      for (const [day] of this._days()) {
        if (!this._edit[day]) this._edit[day] = [];
      }
    }
    return this._edit;
  }

  _saveSchedule() {
    const entity = this._entity();
    if (!entity) return;
    const edit = this._editSchedule(entity);
    const day = this._selectedDay;
    const setpoints = (edit[day] || [])
      .slice()
      .sort((a, b) => this._sec(a.time) - this._sec(b.time))
      .map((sp) => ({ time: sp.time, temperature: sp.temp }));
    const data = { entity_id: entity.entity_id, setpoints };
    if (day !== "all") data.days = [day];
    this._hass.callService(
      "renson_smartliving", "set_thermostat_schedule", data
    );
    // Optimistic: keep local edit state as-is; attributes refresh via HA.
  }

  _saveConfig() {
    const entity = this._entity();
    if (!entity) return;
    const away = this.renderRoot.querySelector(".away-input").value;
    const lead = this.renderRoot.querySelector(".lead-input").value;
    const data = { entity_id: entity.entity_id };
    if (away !== "") data.away_temperature = Number(away);
    if (lead !== "") data.lead_time = Number(lead);
    this._hass.callService(
      "renson_smartliving", "set_thermostat_config", data
    );
  }

  _color(temp) {
    // Simple heatmap: cold -> warm.
    const min = 8, max = 24;
    const t = Math.max(0, Math.min(1, (temp - min) / (max - min)));
    const r = Math.round(255 * (0.35 + 0.65 * t));
    const g = Math.round(255 * (0.85 - 0.45 * t));
    const b = Math.round(80 + 40 * (1 - t));
    return `rgb(${r},${g},${b})`;
  }

  _render() {
    if (!this.renderRoot) return;
    const entity = this._entity();
    if (!entity) {
      this.renderRoot.innerHTML =
        `<ha-card><div class="warn">Entity not found: ` +
        `${this._config.entity}</div></ha-card>`;
      return;
    }
    const attrs = entity.attributes || {};
    const edit = this._editSchedule(entity);
    const day = this._selectedDay;
    const dayList = day === "all"
      ? this._days().map(([d]) => d)
      : [day];
    const rows = [];
    for (const d of dayList) {
      for (const sp of edit[d] || []) {
        rows.push({ day: d, ...sp });
      }
    }
    rows.sort((a, b) => this._sec(a.time) - this._sec(b.time));

    // Heatmap for the selected day (or a merged view for "all").
    const heat = [];
    const heatDay = day === "all" ? "mon" : day;
    const sps = edit[heatDay] || [];
    for (let i = 0; i < sps.length; i++) {
      const from = this._sec(sps[i].time);
      const to = i + 1 < sps.length
        ? this._sec(sps[i + 1].time) : 86400;
      const pct = ((to - from) / 864) / 1;
      heat.push({ width: pct, temp: sps[i].temp });
    }

    this.renderRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; display: block; }
        .warn { color: var(--error-color); padding: 8px; }
        .head { display: flex; justify-content: space-between; align-items: baseline; }
        .title { font-size: 1.2em; font-weight: 500; }
        .cur { color: var(--secondary-text-color); }
        .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
        input {
          border: none; border-bottom: 1px solid var(--divider-color);
          background: transparent; color: var(--primary-text-color);
          padding: 4px; font-size: 1em; width: 60px; text-align: center;
        }
        input.temp { width: 50px; }
        .days { display: flex; gap: 4px; margin: 10px 0; flex-wrap: wrap; }
        .days button {
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color); padding: 6px 10px;
          border-radius: 16px; cursor: pointer;
        }
        .days button.sel {
          background: var(--primary-color); color: var(--primary-text-color);
        }
        .heat { display: flex; height: 14px; border-radius: 7px; overflow: hidden; margin: 10px 0; }
        .heat div { height: 100%; }
        .sp-row { display: flex; gap: 8px; align-items: center; }
        .del {
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color); border-radius: 50%;
          width: 28px; height: 28px; cursor: pointer; font-size: 1em;
        }
        .btn {
          border: none; border-radius: 8px; padding: 10px 16px;
          cursor: pointer; font-size: 1em; margin-top: 10px; width: 100%;
        }
        .save { background: var(--primary-color); color: var(--primary-text-color); }
        .add { background: var(--secondary-background-color); color: var(--primary-color); width: auto; }
        .lbl { color: var(--secondary-text-color); min-width: 90px; }
        .unit { color: var(--secondary-text-color); }
        .saved { color: var(--success-color); font-size: 0.9em; margin-left: 8px; }
      </style>
      <ha-card>
        <div class="head">
          <span class="title">${attrs.friendly_name || entity.entity_id}</span>
          <span class="cur">${attrs.current_temperature ?? "?"}&deg;C &rarr; ${attrs.temperature ?? "?"}&deg;C</span>
        </div>
        <div class="row">
          <span class="lbl">Away</span>
          <input class="away-input" type="number" step="0.5" value="${attrs.away_temperature ?? ""}">
          <span class="unit">&deg;C</span>
          <span class="lbl">Lead time</span>
          <input class="lead-input" type="number" step="1" value="${attrs.lead_time ?? ""}">
          <span class="unit">min</span>
        </div>
        <div class="row">
          <button class="btn add cfg-save">Save settings</button>
        </div>
        <div class="days">
          ${this._days().map(([d, lbl]) =>
            `<button class="${d === day ? "sel" : ""}" data-day="${d}">${lbl}</button>`
          ).join("")}
          <button class="${day === "all" ? "sel" : ""}" data-day="all">All</button>
        </div>
        <div class="heat">
          ${heat.map((h) => `<div style="width:${h.width}%;background:${this._color(h.temp)}"></div>`).join("")}
        </div>
        ${rows.map((r) => `
          <div class="sp-row">
            <input class="sp-time" data-day="${r.day}" data-i="${r.time}" type="time" value="${r.time}">
            <input class="sp-temp temp" data-day="${r.day}" data-i="${r.time}" type="number" step="0.5" value="${r.temp}">
            <span class="unit">&deg;C</span>
            ${day === "all" ? `<span class="unit">${r.day}</span>` : ""}
            <button class="del" data-day="${r.day}" data-i="${r.time}">&times;</button>
          </div>
        `).join("")}
        <button class="btn add sp-add">+ Add setpoint</button>
        <button class="btn save sch-save">Save schedule${day === "all" ? " (all days)" : ` (${day})`}</button>
      </ha-card>
    `;

    this.renderRoot.querySelectorAll(".days button").forEach((b) => {
      b.addEventListener("click", () => {
        this._selectedDay = b.dataset.day;
        this._render();
      });
    });
    this.renderRoot.querySelector(".sp-add").addEventListener("click", () => {
      const list = edit[day === "all" ? "mon" : day] || (edit[day] = []);
      list.push({ time: "07:00", temp: 19 });
      this._render();
    });
    this.renderRoot.querySelectorAll(".del").forEach((b) => {
      b.addEventListener("click", () => {
        const list = edit[b.dataset.day] || [];
        const idx = list.findIndex((sp) => sp.time === b.dataset.i);
        if (idx >= 0) list.splice(idx, 1);
        this._render();
      });
    });
    this.renderRoot.querySelectorAll(".sp-time, .sp-temp").forEach((inp) => {
      inp.addEventListener("change", () => {
        const list = edit[inp.dataset.day] || [];
        const sp = list.find((s) => s.time === inp.dataset.i);
        if (!sp) return;
        if (inp.classList.contains("sp-time")) sp.time = inp.value || "00:00";
        else sp.temp = Number(inp.value) || 0;
        this._render();
      });
    });
    this.renderRoot.querySelector(".sch-save")
      .addEventListener("click", () => this._saveSchedule());
    this.renderRoot.querySelector(".cfg-save")
      .addEventListener("click", () => this._saveConfig());
  }
}

customElements.define(
  "renson-thermostat-config-card", RensonThermostatConfigCard
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-thermostat-config-card",
  name: "Renson Thermostat Config Card",
  description: "Edit OpenMotics thermostat schedules, away and lead time",
});
