/**
 * Renson Gateway Configuration card: one card to configure the gateway.
 *
 * Tabs:
 *  - Inputs:   link wall buttons to outputs / gateway automations
 *  - Automations: visual editor for the gateway's group actions
 *  - Screens:  travel timers (timer up / timer down) per screen
 *  - Dimming:  per-output minimum dim levels
 *
 * The Inputs and Automations tabs reuse the standalone cards as building
 * blocks; this card only adds the tab shell, the screen timers list and
 * the dimming panel.
 */
import "./renson-smartliving-common.js";
import "./renson-smartliving-input-link-card.js";
import "./renson-smartliving-automation-editor.js";
import { t, esc } from "./renson-smartliving-common.js";

class RensonGatewayConfigCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = config || {};
    this._tab = this._tab || "inputs";
    this._lang = this._lang || "en";
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || this._lang || "en";
    if (lang !== this._lang || !this._built) {
      this._lang = lang;
      this._built = true;
      this._render();
    }
    // Pass hass through to the embedded cards.
    for (const child of this._embedded || []) {
      if (child && "hass" in child) child.hass = hass;
    }
  }

  getCardSize() {
    return 6;
  }

  _t(key, params) {
    return t(this._lang, key, params);
  }

  _omEntities(domain) {
    const hass = this._hass;
    if (!hass || !hass.entities) return [];
    return Object.keys(hass.states).filter((eid) => {
      if (eid.split(".")[0] !== domain) return false;
      const info = hass.entities[eid];
      return info && info.platform === "renson_smartliving";
    });
  }

  /* -- Screens tab helpers ------------------------------------------- */

  _covers() {
    return this._omEntities("cover").filter((eid) => {
      const st = this._hass.states[eid];
      return st && st.attributes
        && (st.attributes.timer_up !== undefined
          || st.attributes.timer_down !== undefined);
    });
  }

  _openTimings(eid) {
    const st = this._hass.states[eid];
    const attrs = (st && st.attributes) || {};
    const overlay = this.renderRoot.querySelector(".timings-overlay");
    overlay.style.display = "flex";
    overlay.querySelector("h3").textContent = shortTitle(this._hass, eid);
    overlay.querySelector(".up").value =
      attrs.timer_up !== undefined && attrs.timer_up !== null ? attrs.timer_up : "";
    overlay.querySelector(".down").value =
      attrs.timer_down !== undefined && attrs.timer_down !== null ? attrs.timer_down : "";
    overlay.querySelector(".saved").textContent = "";
    overlay.dataset.entity = eid;
  }

  async _saveTimings() {
    const overlay = this.renderRoot.querySelector(".timings-overlay");
    const eid = overlay.dataset.entity;
    const data = { entity_id: eid };
    const up = overlay.querySelector(".up").value;
    const down = overlay.querySelector(".down").value;
    if (up !== "") data.timer_up = Number(up);
    if (down !== "") data.timer_down = Number(down);
    await this._hass.callService("renson_smartliving", "set_shutter_timings", data);
    overlay.querySelector(".saved").textContent = this._t("timings_saved");
    setTimeout(() => { overlay.style.display = "none"; }, 900);
  }

  /* -- Dimming tab helpers ------------------------------------------- */

  _dimmableLights() {
    return this._omEntities("light").filter((eid) => {
      const st = this._hass.states[eid];
      return st && st.attributes
        && Array.isArray(st.attributes.supported_color_modes)
        && st.attributes.supported_color_modes.some((m) => m !== "onoff");
    });
  }

  _currentMinDim() {
    return (this._dimOptions && this._dimOptions.min_dim_levels) || "";
  }

  async _fetchOptions() {
    if (!this._hass || this._optionsLoading) return;
    this._optionsLoading = true;
    try {
      const entries = await this._hass.callWS({ type: "config_entries/get" });
      const entry = (entries || []).find(
        (e) => e.domain === "renson_smartliving"
      );
      if (entry) {
        this._entryId = entry.entry_id;
        this._dimOptions = entry.options || {};
      }
    } catch (err) {
      // non-fatal: the tab shows a hint instead of the rows
    }
    this._optionsLoading = false;
    if (this._tab === "dimming") this._renderDimRows();
  }

  async _saveDimLevels() {
    const levels = [];
    for (const row of this.renderRoot.querySelectorAll(".dim-row")) {
      const eid = row.dataset.entity;
      const val = row.querySelector("input").value.trim();
      if (val === "") continue;
      levels.push({
        entity_id: eid,
        percent: Math.max(0, Math.min(100, Number(val))),
      });
    }
    if (!levels.length) return;
    try {
      await this._hass.callService(
        "renson_smartliving", "set_min_dim_levels", { levels }
      );
      this.renderRoot.querySelector(".dim-saved").textContent =
        this._t("dim_saved");
      setTimeout(() => {
        const el = this.renderRoot.querySelector(".dim-saved");
        if (el) el.textContent = "";
      }, 2000);
    } catch (err) {
      this.renderRoot.querySelector(".dim-saved").textContent =
        this._t("dim_save_failed");
    }
  }

  _renderDimRows() {
    const wrap = this.renderRoot.querySelector(".dim-rows");
    if (!wrap) return;
    const parsed = {};
    for (const part of String(this._currentMinDim()).split(",")) {
      const [oid, pct] = part.split(":");
      if (oid && pct) parsed[Number(oid)] = Number(pct);
    }
    const lights = this._dimmableLights();
    if (!lights.length) {
      wrap.innerHTML = `<div class="hint">${esc(this._t("dim_no_lights"))}</div>`;
      return;
    }
    wrap.innerHTML = lights.map((eid) => {
      const st = this._hass.states[eid];
      const cur = st && st.attributes ? st.attributes.min_dim : 0;
      const val = cur && cur > 0 ? cur : "";
      return `
        <div class="dim-row" data-entity="${eid}">
          <div class="name">${esc(shortTitle(this._hass, eid))}</div>
          <input type="number" min="0" max="100" step="1" value="${val}"
                 placeholder="0">
          <span class="pct">%</span>
        </div>`;
    }).join("");
  }

  /* -- Rendering ------------------------------------------------------ */

  _render() {
    const lang = this._lang || "en";
    const tabs = [
      ["inputs", "gw_tab_inputs"],
      ["automations", "gw_tab_automations"],
      ["screens", "gw_tab_screens"],
      ["dimming", "gw_tab_dimming"],
    ];
    const covers = this._tab === "screens" && this._hass ? this._covers() : [];
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          display: block; padding: 12px 14px 16px;
          background: var(--card-background-color, #fff);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          font-family: inherit; color: var(--primary-text-color);
        }
        .tabs {
          display: flex; gap: 6px; margin-bottom: 12px;
          border-bottom: 1px solid var(--divider-color); padding-bottom: 8px;
        }
        .tabs button {
          flex: 1; border: none; background: transparent;
          color: var(--secondary-text-color);
          font: inherit; font-size: .85em; font-weight: 600;
          padding: 8px 4px; border-radius: 10px; cursor: pointer;
        }
        .tabs button.active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .tabbody { display: none; }
        .tabbody.active { display: block; }
        .hint {
          font-size: .85em; color: var(--secondary-text-color);
          padding: 8px 2px;
        }
        .cover-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 9px 4px; border-bottom: 1px solid var(--divider-color);
        }
        .cover-row:last-child { border-bottom: none; }
        .cover-row .name { font-size: .95em; }
        .cover-row .timers { font-size: .8em; color: var(--secondary-text-color); }
        .cover-row button {
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 10px; padding: 6px 12px; cursor: pointer;
          font: inherit; font-size: .82em; font-weight: 600;
        }
        .cover-row button:hover { border-color: var(--primary-color); }
        .dim-row {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 4px; border-bottom: 1px solid var(--divider-color);
        }
        .dim-row:last-child { border-bottom: none; }
        .dim-row .name { flex: 1; font-size: .95em; }
        .dim-row input {
          width: 74px; box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 10px; padding: 7px 10px;
          font: inherit; font-size: .95em;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }
        .dim-row .pct { font-size: .85em; color: var(--secondary-text-color); }
        .dim-actions { margin-top: 14px; text-align: center; }
        .dim-actions button {
          border: none; border-radius: 14px; padding: 12px 28px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          font: inherit; font-weight: 700; cursor: pointer;
        }
        .dim-saved {
          display: block; text-align: center; margin-top: 8px;
          font-size: .85em; color: var(--primary-color); font-weight: 600;
        }
        .dim-saved:empty { display: none; }
        .timings-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.5);
          display: none; align-items: center; justify-content: center;
          padding: 16px;
        }
        .timings-dialog {
          position: relative; width: 380px; max-width: 94vw;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 20px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
          font-family: inherit;
        }
        .timings-dialog .close {
          position: absolute; top: 10px; right: 12px;
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color);
          width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; font-size: 1.05em;
        }
        .timings-dialog h3 { margin: 0 0 14px; font-size: 1.05em; }
        .timings-dialog label {
          display: block; font-size: .78em; font-weight: 600;
          color: var(--secondary-text-color); margin: 12px 0 4px;
        }
        .timings-dialog input {
          width: 100%; box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 10px; padding: 10px 12px;
          font-size: 1em; background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }
        .timings-dialog .save {
          display: block; width: 100%; box-sizing: border-box;
          border: none; border-radius: 14px; padding: 14px; margin-top: 18px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          font-weight: 700; cursor: pointer; font-size: 1em; font-family: inherit;
        }
        .timings-dialog .saved {
          display: block; text-align: center; margin-top: 10px;
          font-size: .85em; color: var(--primary-color); font-weight: 600;
        }
        .timings-dialog .saved:empty { display: none; }
      </style>
      <ha-card>
        <div class="tabs">
          ${tabs.map(([id, key]) => `
            <button class="${this._tab === id ? "active" : ""}" data-tab="${id}">
              ${esc(this._t(key))}
            </button>`).join("")}
        </div>
        <div class="tabbody ${this._tab === "inputs" ? "active" : ""}" data-tab="inputs">
          <renson-smartliving-input-link-card id="inputs-card"></renson-smartliving-input-link-card>
        </div>
        <div class="tabbody ${this._tab === "automations" ? "active" : ""}" data-tab="automations">
          <renson-smartliving-automation-editor id="automations-card"></renson-smartliving-automation-editor>
        </div>
        <div class="tabbody ${this._tab === "screens" ? "active" : ""}" data-tab="screens">
          ${covers.length ? covers.map((eid) => {
            const st = this._hass.states[eid];
            const attrs = st.attributes || {};
            const timers = [];
            if (attrs.timer_up !== undefined && attrs.timer_up !== null) {
              timers.push(this._t("timer_up_short") + " " + attrs.timer_up + "s");
            }
            if (attrs.timer_down !== undefined && attrs.timer_down !== null) {
              timers.push(this._t("timer_down_short") + " " + attrs.timer_down + "s");
            }
            return `
              <div class="cover-row" data-entity="${eid}">
                <div>
                  <div class="name">${esc(shortTitle(this._hass, eid))}</div>
                  <div class="timers">${esc(timers.join(" · ") || this._t("no_timers"))}</div>
                </div>
                <button data-entity="${eid}">${esc(this._t("screen_timings_short"))}</button>
              </div>`;
          }).join("") : `<div class="hint">${esc(this._t("no_screens"))}</div>`}
        </div>
        <div class="tabbody ${this._tab === "dimming" ? "active" : ""}" data-tab="dimming">
          <div class="hint">${esc(this._t("dim_hint"))}</div>
          <div class="dim-rows"></div>
          <div class="dim-actions">
            <button class="dim-save">${esc(this._t("save"))}</button>
            <span class="dim-saved"></span>
          </div>
        </div>
        <div class="timings-overlay">
          <div class="timings-dialog">
            <button class="close">&times;</button>
            <h3></h3>
            <label>${esc(this._t("timer_up"))}</label>
            <input class="up" type="number" min="0" max="255" step="1">
            <label>${esc(this._t("timer_down"))}</label>
            <input class="down" type="number" min="0" max="255" step="1">
            <button class="save">${esc(this._t("save"))}</button>
            <span class="saved"></span>
          </div>
        </div>
      </ha-card>
    `;

    // Tab switching.
    for (const btn of this.renderRoot.querySelectorAll(".tabs button")) {
      btn.addEventListener("click", () => {
        this._tab = btn.dataset.tab;
        this._render();
      });
    }

    // Screens tab.
    for (const btn of this.renderRoot.querySelectorAll(".cover-row button")) {
      btn.addEventListener("click", () => this._openTimings(btn.dataset.entity));
    }
    const overlay = this.renderRoot.querySelector(".timings-overlay");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
    overlay.querySelector(".close").addEventListener("click", () => {
      overlay.style.display = "none";
    });
    overlay.querySelector(".save").addEventListener("click", () => this._saveTimings());

    // Dimming tab.
    this._renderDimRows();
    this.renderRoot.querySelector(".dim-save").addEventListener(
      "click", () => this._saveDimLevels()
    );

    // Embedded cards: configure and pass hass through.
    const inputsCard = this.renderRoot.querySelector("#inputs-card");
    inputsCard.setConfig({
      entities: this._config.entities || this._omEntities("event"),
    });
    if (this._hass) inputsCard.hass = this._hass;
    const automationsCard = this.renderRoot.querySelector("#automations-card");
    automationsCard.setConfig({});
    if (this._hass) automationsCard.hass = this._hass;
    this._embedded = [inputsCard, automationsCard];

    if (this._tab === "dimming") this._fetchOptions();
  }
}

function shortTitle(hass, eid) {
  const st = hass && hass.states[eid];
  const name = (st && st.attributes && st.attributes.friendly_name) || eid;
  // Strip the device prefix ("CV Living" -> "Living" style duplicates are
  // kept as-is; only exact "Room Room" duplicates collapse).
  const parts = name.split(" ");
  if (parts.length > 1 && parts[0] === parts[1]) return parts.slice(1).join(" ");
  return name;
}

customElements.define("renson-smartliving-gateway-config", RensonGatewayConfigCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-gateway-config",
  name: "Renson Gateway Configuration",
  description: "Configure the gateway: input links, automations, screen timers and dim levels",
});
