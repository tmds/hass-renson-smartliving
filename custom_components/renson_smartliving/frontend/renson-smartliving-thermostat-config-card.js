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
 *   type: custom:renson-smartliving-thermostat-config-card
 *   entity: climate.praktijk
 */
import { t, esc, shortName, dayLabels, dayLabel } from "./renson-smartliving-common.js";

class RensonThermostatConfigCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    this._lang = (hass.locale && hass.locale.language) || this._lang || "en";
    if (!prev || !this._edit) this._render();
  }

  _t(key, params) {
    return t(this._lang, key, params);
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._embeddedMode = !!config.embedded;
    this._selectedDay = "mon";
    this._edit = null;
    this._savedFlash = "";
    if (!this.renderRoot) {
      this.renderRoot = this.attachShadow({ mode: "open" });
    }
  }

  getCardSize() {
    return 6;
  }

  _entity() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  _days() {
    return dayLabels(this._lang);
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
    this._flash(this._t("schedule_saved"));
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
    this._flash(this._t("settings_saved"));
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

  _nowPct() {
    const now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  }

  _fmtTemp(t) {
    return Number(t).toFixed(1).replace(/\.0$/, "");
  }

  _rensonClimateEntities() {
    if (!this._hass) return [];
    return Object.values(this._hass.states)
      .filter((s) =>
        s.entity_id.startsWith("climate.")
        && s.attributes && s.attributes.heating_schedule
        && s.entity_id !== this._config.entity
      )
      .map((s) => ({ id: s.entity_id, name: s.attributes.friendly_name || s.entity_id }));
  }

  _copyDayToDays(sourceDay, targetDays) {
    const entity = this._entity();
    if (!entity || !targetDays.length) return;
    const edit = this._editSchedule(entity);
    const src = (edit[sourceDay] || [])
      .slice()
      .sort((a, b) => this._sec(a.time) - this._sec(b.time))
      .map((sp) => ({ time: sp.time, temp: sp.temp }));
    for (const d of targetDays) edit[d] = JSON.parse(JSON.stringify(src));
    this._hass.callService("renson_smartliving", "set_thermostat_schedule", {
      entity_id: entity.entity_id,
      days: targetDays,
      setpoints: src.map((sp) => ({ time: sp.time, temperature: sp.temp })),
    });
    this._flash(this._t("copied_day_to", {
      src: dayLabel(this._lang, sourceDay),
      targets: targetDays.map((d) => dayLabel(this._lang, d)).join(", "),
    }));
    this._render();
  }

  _copyWeekTo(targetEntityId) {
    const entity = this._entity();
    if (!entity) return;
    const edit = this._editSchedule(entity);
    const week = {};
    for (const [d] of this._days()) {
      week[d] = (edit[d] || [])
        .slice()
        .sort((a, b) => this._sec(a.time) - this._sec(b.time))
        .map((sp) => ({ time: sp.time, temperature: sp.temp }));
    }
    this._hass.callService("renson_smartliving", "set_thermostat_schedule", {
      entity_id: targetEntityId,
      week,
    });
    this._flash(this._t("week_copied_to", { entity: targetEntityId }));
  }

  _wireCopyDialog() {
    const overlay = this.renderRoot.querySelector(".copy-overlay");
    const body = this.renderRoot.querySelector(".copy-body");
    const close = () => { overlay.style.display = "none"; };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    this.renderRoot.querySelector(".copy-close").addEventListener("click", close);
    this.renderRoot.querySelectorAll(".copy-opt").forEach((b) => {
      b.addEventListener("click", () => {
        this.renderRoot.querySelectorAll(".copy-opt").forEach((x) => x.style.display = "none");
        body.style.display = "block";
        const opt = b.dataset.opt;
        if (opt === "day") {
          const src = this._selectedDay === "all" ? "mon" : this._selectedDay;
          body.innerHTML = `
            <div style="font-size:.85em;color:var(--secondary-text-color)">${this._t("copy_src_to", { src: dayLabel(this._lang, src) })}</div>
            <div class="daygrid">
              ${this._days().map(([d, lbl]) =>
                d === src ? "" : `<button data-day="${d}">${lbl}</button>`
              ).join("")}
              <button data-all="1">${this._t("all")}</button>
            </div>
            <button class="btn primary copy-go" disabled>${this._t("copy")}</button>
          `;
          const picked = new Set();
          const dayBtns = [...body.querySelectorAll(".daygrid button[data-day]")];
          const allBtn = body.querySelector(".daygrid button[data-all]");
          const sync = () => {
            dayBtns.forEach((b) => b.classList.toggle("sel", picked.has(b.dataset.day)));
            allBtn.classList.toggle("sel", picked.size === dayBtns.length);
            body.querySelector(".copy-go").disabled = picked.size === 0;
          };
          dayBtns.forEach((db) => {
            db.addEventListener("click", () => {
              const d = db.dataset.day;
              if (picked.has(d)) picked.delete(d);
              else picked.add(d);
              sync();
            });
          });
          // "All" selects every other day; pressed again it clears them.
          allBtn.addEventListener("click", () => {
            if (picked.size === dayBtns.length) picked.clear();
            else dayBtns.forEach((b) => picked.add(b.dataset.day));
            sync();
          });
          body.querySelector(".copy-go").addEventListener("click", () => {
            this._copyDayToDays(src, [...picked]);
            close();
          });
        } else {
          const ents = this._rensonClimateEntities();
          body.innerHTML = `
            <div style="font-size:.85em;color:var(--secondary-text-color)">${this._t("copy_this_week_to")}</div>
            <select class="copy-target">
              ${ents.length === 0 ? `<option value="">${this._t("no_other_thermostat")}</option>` : ""}
              ${ents.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}
            </select>
            <button class="btn primary copy-go" ${ents.length === 0 ? "disabled" : ""}>${this._t("copy_week")}</button>
          `;
          body.querySelector(".copy-go").addEventListener("click", () => {
            const t = body.querySelector(".copy-target").value;
            if (t) { this._copyWeekTo(t); close(); }
          });
        }
      });
    });
    this.renderRoot.querySelector(".copy-btn")
      .addEventListener("click", () => {
        overlay.style.display = "flex";
        this.renderRoot.querySelectorAll(".copy-opt").forEach((x) => x.style.display = "block");
        body.style.display = "none";
      });
  }

  _render() {
    if (!this.renderRoot) return;
    const entity = this._entity();
    if (!entity) {
      this.renderRoot.innerHTML =
        `<ha-card><div class="warn">${this._t("entity_not_found", { entity: this._config.entity })}</div></ha-card>`;
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
          padding: ${this._embeddedMode ? "0" : "20px"};
          border-radius: var(--ha-card-border-radius, 16px);
          background: ${this._embeddedMode ? "transparent" : "var(--card-background-color, var(--paper-card-background-color))"};
          box-shadow: ${this._embeddedMode ? "none" : "var(--ha-card-box-shadow, none)"};
          border: ${this._embeddedMode ? "none" : "1px solid var(--divider-color, rgba(0,0,0,.08))"};
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
          display: flex; align-items: center; gap: 6px;
          margin-left: auto;
        }
        .stepper button {
          border: none; background: var(--primary-background-color);
          color: var(--primary-text-color); width: 26px; height: 26px;
          border-radius: 8px; cursor: pointer; font-size: 1em;
          line-height: 1; transition: background .15s ease;
          display: flex; align-items: center; justify-content: center;
          padding: 0; flex-shrink: 0;
        }
        .stepper button:hover { background: var(--primary-color); }
        .stepper .val {
          min-width: 44px; text-align: center;
          font-weight: 600; color: var(--primary-text-color);
        }
        .sp-row .clock { color: var(--secondary-text-color); }
        .del {
          border: none; background: transparent;
          color: var(--secondary-text-color);
          border-radius: 8px; width: 28px; height: 28px;
          cursor: pointer; font-size: 1.05em;
          transition: all .15s ease;
          display: flex; align-items: center; justify-content: center;
          padding: 0; line-height: 1; flex-shrink: 0;
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
        .copy-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.45);
          display: flex; align-items: center; justify-content: center;
        }
        .copy-dialog {
          position: relative; width: 340px; max-width: 90vw;
          background: var(--card-background-color, #fff);
          border-radius: 16px; padding: 18px;
          box-shadow: 0 12px 40px rgba(0,0,0,.3);
          color: var(--primary-text-color);
        }
        .copy-title { font-weight: 700; margin-bottom: 12px; }
        .copy-opt {
          display: block; width: 100%; text-align: left;
          border: none; background: transparent;
          color: var(--primary-text-color);
          font-size: 1em; padding: 12px 8px; cursor: pointer;
          border-bottom: 1px solid var(--divider-color);
          border-radius: 8px; font-family: inherit;
        }
        .copy-opt:hover { background: var(--secondary-background-color); }
        .copy-close {
          position: absolute; top: 8px; right: 10px;
          border: none; background: transparent;
          color: var(--secondary-text-color);
          font-size: 1.2em; cursor: pointer;
        }
        .copy-body { margin-top: 10px; }
        .copy-body .daygrid {
          display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px;
        }
        .copy-body .daygrid button {
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color); padding: 7px 12px;
          border-radius: 10px; cursor: pointer; font-size: .85em;
        }
        .copy-body .daygrid button.sel {
          background: var(--primary-color);
        }
        .copy-body select {
          width: 100%; padding: 10px; border-radius: 10px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color); font-size: .95em;
          margin-bottom: 12px; font-family: inherit;
        }
        .copy-body .btn { margin-top: 0; }
      </style>
      <ha-card>
        <div class="head">
          <div>
            <div class="name">${esc(shortName(this._hass, this._config.entity))}</div>
            <div class="room">${this._t("weekly_schedule")}</div>
          </div>
          <div class="now">
            <span class="t">${attrs.current_temperature ?? "?"}&deg;</span>
            <span class="d">${this._t("now")}<br>${this._fmtTemp(attrs.temperature ?? 0)}&deg; ${this._t("target")}</span>
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
          <button class="${day === "all" ? "sel" : ""}" data-day="all">${this._t("all")}</button>
        </div>

        <div class="sp-list">
          ${rows.length === 0 ? `<div class="foot">${this._t("no_setpoints")}</div>` : ""}
          ${rows.map((r) => `
            <div class="sp-row" data-day="${dayKey}" data-i="${r.time}">
              <input type="time" value="${r.time}">
              <div class="stepper">
                <button class="minus">&minus;</button>
                <span class="val">${this._fmtTemp(r.temp)}&deg;</span>
                <button class="plus">+</button>
              </div>
              <button class="del" title="${this._t("remove")}">&times;</button>
            </div>
          `).join("")}
        </div>

        <button class="btn ghost sp-add">${this._t("add_setpoint")}</button>

        <div class="cfg">
          <div class="field">
            <label>${this._t("away")}</label>
            <div class="frow">
              <input class="away-input" type="number" step="0.5" value="${attrs.away_temperature ?? ""}">
              <span class="unit">&deg;C</span>
            </div>
          </div>
          <div class="field">
            <label>${this._t("lead_time")}</label>
            <div class="frow">
              <input class="lead-input" type="number" step="1" value="${attrs.lead_time ?? ""}">
              <span class="unit">min</span>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn ghost copy-btn">${this._t("copy_schedule")}</button>
          <button class="btn ghost cfg-save">${this._t("save_settings")}</button>
          <button class="btn primary sch-save">${this._t("save_schedule")}</button>
          ${this._savedFlash ? `<span class="saved">${this._savedFlash}</span>` : ""}
        </div>
        <div class="copy-overlay" style="display:none">
          <div class="copy-dialog">
            <div class="copy-title">${this._t("copy_schedule")}</div>
            <button class="copy-opt" data-opt="day">${this._t("copy_this_day")}</button>
            <button class="copy-opt" data-opt="week">${this._t("copy_week_other")}</button>
            <div class="copy-body" style="display:none"></div>
            <button class="copy-close">&times;</button>
          </div>
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
    this._wireCopyDialog();
  }
}

customElements.define(
  "renson-smartliving-thermostat-config-card", RensonThermostatConfigCard
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-thermostat-config-card",
  name: "Renson Thermostat Config Card",
  description: "Edit OpenMotics thermostat schedules, away and lead time",
});
