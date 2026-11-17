/**
 * Renson Smart Living thermostat tile with a Configure schedule popup.
 *
 * Compact tile for one OpenMotics thermostat; the button opens the
 * renson-thermostat-config-card editor in a modal overlay.
 *
 * Manual card config:
 *   type: custom:renson-thermostat-card
 *   entity: climate.praktijk
 */
import { t } from "./renson-i18n.js?v=7";

class RensonThermostatCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  set hass(hass) {
    this._hass = hass;
    this._lang = (hass.locale && hass.locale.language) || this._lang || "en";
    this._renderSummary();
    if (this._open && this._editor) {
      this._editor.hass = hass;
    }
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._open = false;
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._renderShell();
  }

  getCardSize() {
    return 3;
  }

  _entity() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  _roomName(entity) {
    const name = entity.attributes && entity.attributes.friendly_name
      ? entity.attributes.friendly_name : entity.entity_id;
    const parts = String(name).split(") ");
    const last = parts[parts.length - 1].trim();
    return last.charAt(0).toUpperCase() + last.slice(1);
  }

  _fmtTemp(t) {
    return t === undefined || t === null ? "?" : Number(t).toFixed(1).replace(/\.0$/, "");
  }

  _renderShell() {
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: 14px 16px;
          border-radius: var(--ha-card-border-radius, 16px);
          background: var(--card-background-color, var(--paper-card-background-color));
          border: 1px solid var(--divider-color, rgba(0,0,0,.08));
          display: block;
        }
        .warn { color: var(--error-color); padding: 8px; }
        .row { display: flex; justify-content: space-between; align-items: center; }
        .name { font-weight: 700; font-size: 1.05em; color: var(--primary-text-color); }
        .sub { font-size: .75em; color: var(--secondary-text-color); margin-top: 2px; }
        .temps { display: flex; align-items: baseline; gap: 6px; }
        .cur { font-size: 1.6em; font-weight: 700; color: var(--primary-text-color); }
        .tgt { font-size: .85em; color: var(--secondary-text-color); }
        .cfg-btn {
          margin-top: 12px; width: 100%;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 12px; padding: 9px 14px;
          cursor: pointer; font-size: .9em; font-weight: 600;
          font-family: inherit; transition: filter .15s ease;
        }
        .cfg-btn:hover { filter: brightness(1.05); border-color: var(--primary-color); }
        .heatwrap { margin: 12px 0 2px; }
        .heatbox { position: relative; }
        .heat {
          display: flex; height: 14px; border-radius: 7px; overflow: hidden;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
          background: var(--secondary-background-color);
        }
        .heat div { height: 100%; transition: background .3s ease; }
        .nowmark {
          position: absolute; top: -2px; bottom: -2px; width: 2px;
          background: var(--primary-text-color); opacity: .55;
          border-radius: 1px;
        }
        .axis {
          display: flex; justify-content: space-between;
          font-size: .62em; color: var(--secondary-text-color); margin-top: 4px;
        }
        .overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .dialog {
          position: relative; width: 440px; max-width: 94vw;
          max-height: 92vh; overflow-y: auto;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 8px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
        }
        .close {
          position: absolute; top: 10px; right: 12px; z-index: 2;
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color);
          width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; font-size: 1.05em;
        }
      </style>
      <ha-card>
        <div class="row">
          <div>
            <div class="name"></div>
            <div class="sub"></div>
          </div>
          <div class="temps">
            <span class="cur"></span>
            <span class="tgt"></span>
          </div>
        </div>
        <div class="heatwrap">
          <div class="heatbox">
            <div class="heat"></div>
            <span class="nowmark" style="left:0%"></span>
          </div>
          <div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        </div>
        <button class="cfg-btn">${t(this._lang, "configure_schedule")}</button>
        <div class="overlay" style="display:none">
          <div class="dialog">
            <button class="close">&times;</button>
            <div class="editor-host"></div>
          </div>
        </div>
      </ha-card>
    `;
    this.renderRoot.querySelector(".cfg-btn").addEventListener("click", () => {
      this._open = true;
      const overlay = this.renderRoot.querySelector(".overlay");
      const host = this.renderRoot.querySelector(".editor-host");
      if (!this._editor) {
        this._editor = document.createElement("renson-thermostat-config-card");
        this._editor.setConfig({ entity: this._config.entity });
        host.appendChild(this._editor);
      }
      if (this._hass) this._editor.hass = this._hass;
      overlay.style.display = "flex";
    });
    const overlay = this.renderRoot.querySelector(".overlay");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.style.display = "none";
        this._open = false;
      }
    });
    this.renderRoot.querySelector(".close").addEventListener("click", () => {
      overlay.style.display = "none";
      this._open = false;
    });
    this._renderSummary();
  }

  _sec(t) {
    const [h, m] = String(t).split(":").map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  }

  _color(temp) {
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

  _renderHeatmap(entity) {
    const heat = this.renderRoot.querySelector(".heat");
    const mark = this.renderRoot.querySelector(".nowmark");
    if (!heat || !mark) return;
    const attrs = entity.attributes || {};
    const src = attrs.heating_schedule || {};
    const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const today = dayKeys[(new Date().getDay() + 6) % 7];
    const setpoints = Object.entries(src[today] || {})
      .map(([time, temp]) => ({ time, temp: Number(temp) }))
      .sort((a, b) => this._sec(a.time) - this._sec(b.time));
    if (!setpoints.length) {
      heat.innerHTML = "";
      mark.style.display = "none";
      return;
    }
    mark.style.display = "";
    mark.style.left = `${this._nowPct()}%`;
    const parts = [];
    for (let i = 0; i < setpoints.length; i++) {
      const from = this._sec(setpoints[i].time);
      const to = i + 1 < setpoints.length
        ? this._sec(setpoints[i + 1].time) : 86400;
      parts.push(
        `<div style="width:${(to - from) / 864}%;background:${this._color(setpoints[i].temp)}"></div>`
      );
    }
    heat.innerHTML = parts.join("");
  }

  _renderSummary() {
    if (!this.renderRoot || !this._hass) return;
    const entity = this._entity();
    if (!entity) {
      const n = this.renderRoot.querySelector(".name");
      if (n) n.textContent = `Not found: ${this._config.entity}`;
      return;
    }
    const attrs = entity.attributes || {};
    this.renderRoot.querySelector(".name").textContent =
      this._roomName(entity);
    this.renderRoot.querySelector(".sub").textContent =
      (attrs.hvac_action || entity.state) === "heating" ? "Heating" : "Idle";
    this.renderRoot.querySelector(".cur").textContent =
      `${this._fmtTemp(attrs.current_temperature)}\u00B0`;
    this.renderRoot.querySelector(".tgt").textContent =
      `\u2192 ${this._fmtTemp(attrs.temperature)}\u00B0`;
    this._renderHeatmap(entity);
  }
}

customElements.define("renson-thermostat-card", RensonThermostatCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-thermostat-card",
  name: "Renson Thermostat Card",
  description: "OpenMotics thermostat tile with a schedule editor popup",
});
