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
    const prev = this._hass;
    this._hass = hass;
    if (!prev || !this._edit) this._render();
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._selectedDay = "mon";
    this._edit = null;
    this._savedFlash = "";
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
    const data = { entity_id: entity.entity_id };
    if (day !== "all") data.days = [day];
    // "All" applies the currently shown day's schedule to every day.
    data.setpoints = (edit[day === "all" ? "mon" : day] || [])
      .slice()
      .sort((a, b) => this._sec(a.time) - this._sec(b.time))
      .map((sp) => ({ time: sp.time, temperature: sp.temp }));
    if (day === "all") delete data.days;
    this._hass.callService(
      "renson_smartliving", "set_thermostat_schedule", data
    );
    this._flash("Schedule saved");
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
    this._flash("Settings saved");
  }

  _flash(msg) {
    this._savedFlash = msg;
    this._render();
    setTimeout(() => {
      if (this._savedFlash === msg) {
        this._savedFlash = "";
        this._render();
      }
    }, 2500);
  }

  _color(temp) {
    // App-style palette: soft yellow -> amber -> deep orange.
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

  _roomName(entity) {
    const name = entity.attributes && entity.attributes.friendly_name
      ? entity.attributes.friendly_name : entity.entity_id;
    const parts = String(name).split(") ");
    const last = parts[parts.length - 1].trim();
    return last.charAt(0).toUpperCase() + last.slice(1);
  }

  _nowPct() {
    const now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  }

  _fmtTemp(t) {
    return Number(t).toFixed(1).replace(/\.0$/, "");
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
    const dayKey = day === "all" ? "mon" : day;
    const rows = (edit[dayKey] || [])
      .slice()
      .sort((a, b) => this._sec(a.time) - this._sec(b.time));

    const heat = [];
    for (let i = 0; i < rows.length; i++) {
      const from = this._sec(rows[i].time);
      const to = i + 1 < rows.length ? this._sec(rows[i + 1].time) : 86400;
      heat.push({ width: (to - from) / 864, temp: rows[i].temp });
    }

    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: 20px;
          border-radius: var(--ha-card-border-radius, 16px);
          background: var(--card-background-color, var(--paper-card-background-color));
          box-shadow: var(--ha-card-box-shadow, none);
          border: 1px solid var(--divider-color, rgba(0,0,0,.08));
          display: block;
        }
        .warn { color: var(--error-color); padding: 8px; }
        .head { display: flex; justify-content: space-between; align-items: center; }
        .name {
          font-size: 1.25em; font-weight: 700;
          color: var(--primary-text-color); letter-spacing: -.01em;
        }
        .room { font-size: .78em; color: var(--secondary-text-color); margin-top: 2px; }
        .now {
          display: flex; align-items: center; gap: 8px;
          background: var(--secondary-background-color);
          padding: 10px 16px; border-radius: 16px;
        }
        .now .t { font-size: 1.7em; font-weight: 700; color: var(--primary-text-color); }
        .now .d {
          font-size: .72em; color: var(--secondary-text-color);
          line-height: 1.4; text-align: left;
        }
        .heatwrap { margin: 20px 0 4px; }
        .heatbox { position: relative; }
        .heat {
          display: flex; height: 20px; border-radius: 10px; overflow: hidden;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
        }
        .heat div { height: 100%; transition: background .3s ease; }
        .nowmark {
          position: absolute; top: -3px; bottom: -3px; width: 2px;
          background: var(--primary-text-color); opacity: .6;
          border-radius: 1px;
        }
        .nowmark::after {
          content: ""; position: absolute; top: -4px; left: -3px;
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--primary-text-color); opacity: .6;
        }
        .axis {
          display: flex; justify-content: space-between;
          font-size: .68em; color: var(--secondary-text-color); margin-top: 6px;
        }
        .days {
          display: flex; gap: 3px; margin: 16px 0;
          background: var(--secondary-background-color);
          border-radius: 12px; padding: 3px;
        }
        .days button {
          flex: 1; border: none; background: transparent;
          color: var(--secondary-text-color); padding: 7px 0;
          border-radius: 10px; cursor: pointer; font-size: .85em;
          font-weight: 500; transition: all .18s ease;
        }
        .days button.sel {
          background: var(--primary-color);
          color: var(--primary-text-color);
          box-shadow: 0 1px 4px rgba(0,0,0,.2);
        }
        .sp-list { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
        .sp-row {
          display: flex; gap: 8px; align-items: center;
          background: var(--secondary-background-color);
          border-radius: 12px; padding: 8px 12px;
        }
        .sp-row input[type=time] {
          border: none; background: transparent;
          color: var(--primary-text-color);
          font-size: 1em; font-weight: 500; width: 96px;
          font-family: inherit;
        }
        .sp-row input[type=time]::-webkit-calendar-picker-indicator {
          filter: invert(.5); cursor: pointer;
        }
        .stepper {
          display: flex; align-items: center; gap: 2px;
          margin-left: auto;
        }
        .stepper button {
          border: none; background: var(--primary-background-color);
          color: var(--primary-text-color); width: 26px; height: 26px;
          border-radius: 8px; cursor: pointer; font-size: 1em;
          line-height: 1; transition: background .15s ease;
        }
        .stepper button:hover { background: var(--primary-color); }
        .stepper .val {
          min-width: 44px; text-align: center;
          font-weight: 600; color: var(--primary-text-color);
        }
        .stepper .unit { color: var(--secondary-text-color); font-size: .8em; }
        .sp-row .clock { color: var(--secondary-text-color); }
        .del {
          border: none; background: transparent;
          color: var(--secondary-text-color);
          border-radius: 8px; width: 28px; height: 28px;
          cursor: pointer; font-size: 1.05em;
          transition: all .15s ease;
        }
        .del:hover { color: var(--error-color); background: var(--primary-background-color); }
        .btn {
          border: none; border-radius: 12px; padding: 12px 16px;
          cursor: pointer; font-size: .95em; font-weight: 600;
          width: 100%; transition: filter .15s ease, transform .05s ease;
          font-family: inherit;
        }
        .btn:active { transform: scale(.99); }
        .btn:hover { filter: brightness(1.08); }
        .primary {
          background: var(--primary-color); color: var(--primary-text-color);
          margin-top: 12px;
        }
        .ghost {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border: 1px dashed var(--divider-color);
          margin-top: 8px;
        }
        .cfg { display: flex; gap: 10px; margin-top: 16px; }
        .field {
          flex: 1; background: var(--secondary-background-color);
          border-radius: 12px; padding: 10px 14px;
          display: flex; flex-direction: column; gap: 2px;
        }
        .field label {
          font-size: .7em; text-transform: uppercase; letter-spacing: .06em;
          color: var(--secondary-text-color);
        }
        .field .frow { display: flex; align-items: baseline; gap: 4px; }
        .field input {
          border: none; background: transparent;
          color: var(--primary-text-color);
          font-size: 1.25em; font-weight: 600; width: 70px;
          font-family: inherit;
        }
        .field .unit { color: var(--secondary-text-color); font-size: .8em; }
        .actions { display: flex; gap: 10px; margin-top: 14px; align-items: center; }
        .actions .btn { width: auto; flex: 1; padding: 10px 16px; }
        .saved { color: var(--success-color); font-size: .85em; white-space: nowrap; }
        .foot { margin-top: 10px; text-align: center; font-size: .72em; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="head">
          <div>
            <div class="name">${this._roomName(entity)}</div>
            <div class="room">Weekly schedule</div>
          </div>
          <div class="now">
            <span class="t">${attrs.current_temperature ?? "?"}&deg;</span>
            <span class="d">now<br>${this._fmtTemp(attrs.temperature ?? 0)}&deg; target</span>
          </div>
        </div>

        <div class="heatwrap">
          <div class="heatbox">
            <div class="heat">
              ${heat.map((h) =>
                `<div style="width:${h.width}%;background:${this._color(h.temp)}"></div>`
              ).join("")}
            </div>
            <span class="nowmark" style="left:${this._nowPct()}%"></span>
          </div>
          <div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        </div>

        <div class="days">
          ${this._days().map(([d, lbl]) =>
            `<button class="${d === day ? "sel" : ""}" data-day="${d}">${lbl}</button>`
          ).join("")}
          <button class="${day === "all" ? "sel" : ""}" data-day="all">All</button>
        </div>

        <div class="sp-list">
          ${rows.length === 0 ? `<div class="foot">No setpoints for this day yet</div>` : ""}
          ${rows.map((r) => `
            <div class="sp-row" data-day="${dayKey}" data-i="${r.time}">
              <input type="time" value="${r.time}">
              <div class="stepper">
                <button class="minus">&minus;</button>
                <span class="val">${this._fmtTemp(r.temp)}&deg;</span>
                <button class="plus">+</button>
                <span class="unit">C</span>
              </div>
              <button class="del" title="Remove">&times;</button>
            </div>
          `).join("")}
        </div>

        <button class="btn ghost sp-add">+ Add setpoint</button>

        <div class="cfg">
          <div class="field">
            <label>Away</label>
            <div class="frow">
              <input class="away-input" type="number" step="0.5" value="${attrs.away_temperature ?? ""}">
              <span class="unit">&deg;C</span>
            </div>
          </div>
          <div class="field">
            <label>Lead time</label>
            <div class="frow">
              <input class="lead-input" type="number" step="1" value="${attrs.lead_time ?? ""}">
              <span class="unit">min</span>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn ghost cfg-save">Save settings</button>
          <button class="btn primary sch-save">Save schedule</button>
          ${this._savedFlash ? `<span class="saved">${this._savedFlash}</span>` : ""}
        </div>
      </ha-card>
    `;

    this.renderRoot.querySelectorAll(".days button").forEach((b) => {
      b.addEventListener("click", () => {
        this._selectedDay = b.dataset.day;
        this._render();
      });
    });
    this.renderRoot.querySelector(".sp-add").addEventListener("click", () => {
      const list = edit[dayKey] || (edit[dayKey] = []);
      list.push({ time: "07:00", temp: 19 });
      this._render();
    });
    this.renderRoot.querySelectorAll(".sp-row").forEach((row) => {
      const list = edit[row.dataset.day] || [];
      const sp = list.find((s) => s.time === row.dataset.i);
      if (!sp) return;
      row.querySelector("input[type=time]").addEventListener("change", (e) => {
        sp.time = e.target.value || "00:00";
        this._render();
      });
      row.querySelector(".minus").addEventListener("click", () => {
        sp.temp = Math.max(6, Math.round((sp.temp - 0.5) * 2) / 2);
        this._render();
      });
      row.querySelector(".plus").addEventListener("click", () => {
        sp.temp = Math.min(32, Math.round((sp.temp + 0.5) * 2) / 2);
        this._render();
      });
      row.querySelector(".del").addEventListener("click", () => {
        const idx = list.findIndex((s) => s.time === row.dataset.i);
        if (idx >= 0) list.splice(idx, 1);
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
