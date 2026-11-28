/**
 * Renson Gateway Configuration card: one card to configure the gateway.
 *
 * Tabs:
 *  - Inputs:       link wall buttons to outputs / gateway automations
 *  - Automations:  visual editor for the gateway's group actions
 *  - Screens:      travel timers (timer up / timer down) per screen
 *  - Thermostats:  per-room overview with today's schedule, opens the
 *                  schedule editor in a dialog
 *
 * The Inputs and Automations tabs reuse the standalone cards as embedded
 * building blocks (config `embedded: true` drops their card chrome).
 * The shell is built once; tab switches only toggle visibility, and the
 * screens/thermostats lists re-render only when their data changes.
 */
import "./renson-smartliving-common.js?v=0.2.4";
import "./renson-smartliving-input-link-card.js?v=0.2.4";
import "./renson-smartliving-automation-editor.js?v=0.2.4";
import "./renson-smartliving-thermostat-config-card.js?v=0.2.4";
import {
  t, esc, shortName, openDialog, dialogCSS,
  scheduleStripCSS, scheduleStripHTML, fmtTemp,
} from "./renson-smartliving-common.js?v=0.2.4";

class RensonGatewayConfigCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this._tab = "inputs";
    this._lang = "en";
    this._screensSig = "";
    this._climateSig = "";
    this._entries = [];
  }

  setConfig(config) {
    this._config = config || {};
    if (!this.renderRoot) {
      this.renderRoot = this.attachShadow({ mode: "open" });
    }
    this._renderShell();
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || this._lang || "en";
    if (lang !== this._lang) {
      this._lang = lang;
      this._renderShell();
    }
    if (!this._embConfigured && this.renderRoot.querySelector("#inputs-card")) {
      this._configureEmbedded();
      this._embConfigured = true;
    }
    // The input event entities can show up after the card (e.g. right after
    // a Home Assistant restart); configure the inputs card as soon as they do.
    if (this._embConfigured) this._configureInputs();
    this._updateHeader();
    this._updateCounts();
    // Pass hass through to the embedded cards.
    for (const child of this._embedded || []) {
      if (child && "hass" in child) child.hass = hass;
    }
    this._updateScreens();
    this._updateClimate();
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
      return info && info.platform === "renson_smartliving"
        && (!this._deviceFilter || info.device_id === this._deviceFilter);
    });
  }

  _gatewayDevices() {
    // Distinct OpenMotics gateway devices (one per config entry).
    const hass = this._hass;
    if (!hass || !hass.entities || !hass.devices) return [];
    const ids = new Set();
    for (const eid of Object.keys(hass.states)) {
      const info = hass.entities[eid];
      if (info && info.platform === "renson_smartliving" && info.device_id) {
        ids.add(info.device_id);
      }
    }
    return [...ids].map((id) => ({ id, name: hass.devices[id].name || id }));
  }

  _gatewayLabel() {
    const devices = this._gatewayDevices();
    if (this._deviceFilter) {
      const d = devices.find((d) => d.id === this._deviceFilter);
      return d ? d.name : "";
    }
    return devices.length ? devices[0].name : "";
  }

  _statusOK() {
    // Connected when at least one OpenMotics entity reports a non-unavailable state.
    const eids = this._omEntities("climate");
    if (!eids.length) eids.push(...this._omEntities("light"));
    for (const eid of eids.slice(0, 5)) {
      const st = this._hass && this._hass.states[eid];
      if (st && st.state !== "unavailable" && st.state !== "unknown") return true;
    }
    return eids.length === 0 ? true : false;
  }

  /* -- Screens tab ---------------------------------------------------- */

  _covers() {
    return this._omEntities("cover").filter((eid) => {
      const st = this._hass.states[eid];
      return st && st.attributes
        && (st.attributes.timer_up !== undefined
          || st.attributes.timer_down !== undefined);
    });
  }

  _screensSignature() {
    return this._covers().map((eid) => {
      const a = this._hass.states[eid].attributes;
      return [eid, a.timer_up, a.timer_down].join(":");
    }).join("|") + "|" + this._lang;
  }

  _updateScreens() {
    if (!this._hass) return;
    const sig = this._screensSignature();
    if (sig === this._screensSig) return;
    this._screensSig = sig;
    const wrap = this.renderRoot.querySelector('[data-tabbody="screens"] .rows');
    if (!wrap) return;
    const covers = this._covers();
    if (!covers.length) {
      wrap.innerHTML = `
        <div class="empty">
          <ha-icon icon="mdi:window-shutter"></ha-icon>
          <div>${esc(this._t("no_screens"))}</div>
        </div>`;
      return;
    }
    wrap.innerHTML = covers.map((eid) => {
      const attrs = this._hass.states[eid].attributes || {};
      const chips = [];
      if (attrs.timer_up !== undefined && attrs.timer_up !== null) {
        chips.push(`<span class="chip"><ha-icon icon="mdi:arrow-up"></ha-icon>${attrs.timer_up} s</span>`);
      }
      if (attrs.timer_down !== undefined && attrs.timer_down !== null) {
        chips.push(`<span class="chip"><ha-icon icon="mdi:arrow-down"></ha-icon>${attrs.timer_down} s</span>`);
      }
      return `
        <div class="row" data-entity="${eid}">
          <span class="ico"><ha-icon icon="mdi:window-shutter"></ha-icon></span>
          <div class="rowmain">
            <div class="name">${esc(shortName(this._hass, eid))}</div>
            <div class="sub">${chips.join("") || esc(this._t("no_timers"))}</div>
          </div>
          <button class="btn" data-entity="${eid}">${esc(this._t("screen_timings_short"))}</button>
        </div>`;
    }).join("");
    for (const btn of wrap.querySelectorAll("button.btn")) {
      btn.addEventListener("click", () => this._openTimings(btn.dataset.entity));
    }
  }

  _openTimings(eid) {
    const st = this._hass.states[eid];
    const attrs = (st && st.attributes) || {};
    const overlay = openDialog(this, {
      title: shortName(this._hass, eid),
      bodyHTML: `
        <label class="dlg-field">${esc(this._t("timer_up"))}</label>
        <div class="dlg-input-wrap">
          <input class="dlg-input up" type="number" min="0" max="255" step="1"
                 value="${attrs.timer_up !== undefined && attrs.timer_up !== null ? attrs.timer_up : ""}">
          <span class="dlg-input-suffix">s</span>
        </div>
        <label class="dlg-field">${esc(this._t("timer_down"))}</label>
        <div class="dlg-input-wrap">
          <input class="dlg-input down" type="number" min="0" max="255" step="1"
                 value="${attrs.timer_down !== undefined && attrs.timer_down !== null ? attrs.timer_down : ""}">
          <span class="dlg-input-suffix">s</span>
        </div>
        <span class="saved"></span>`,
      footerHTML: `<button class="dlg-primary save">${esc(this._t("save"))}</button>`,
    });
    overlay.querySelector(".save").addEventListener("click", async () => {
      const data = { entity_id: eid };
      const up = overlay.querySelector(".up").value;
      const down = overlay.querySelector(".down").value;
      if (up !== "") data.timer_up = Number(up);
      if (down !== "") data.timer_down = Number(down);
      await this._hass.callService("renson_smartliving", "set_shutter_timings", data);
      overlay.querySelector(".saved").textContent = this._t("timings_saved");
      setTimeout(() => overlay.close(), 900);
    });
  }

  /* -- Thermostats tab ------------------------------------------------ */

  _climateEntities() {
    return this._omEntities("climate");
  }

  _climateSignature() {
    return this._climateEntities().map((eid) => {
      const a = this._hass.states[eid].attributes;
      return [eid, a.current_temperature, a.temperature, a.active_preset,
        a.hvac_action, a.preset_expiration].join(":");
    }).join("|") + "|" + this._lang;
  }

  _roomGroups(entityIds) {
    // Group entity ids by HA area: entity area first, then the device's.
    const hass = this._hass;
    const groups = new Map();
    for (const eid of entityIds) {
      const info = hass.entities[eid] || {};
      const device = info.device_id ? (hass.devices || {})[info.device_id] : null;
      const area = info.area_id || (device && device.area_id) || "";
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(eid);
    }
    return [...groups.entries()].sort((a, b) => {
      const an = a[0] ? this._areaName(a[0]) : this._t("no_room");
      const bn = b[0] ? this._areaName(b[0]) : this._t("no_room");
      return an.localeCompare(bn, this._lang);
    });
  }

  _areaName(areaId) {
    const hass = this._hass;
    return (hass && hass.areas && hass.areas[areaId] && hass.areas[areaId].name) || areaId;
  }

  _presetText(attrs) {
    const preset = attrs.active_preset;
    if (preset === "away") return this._t("gw_away");
    if (preset === "manual" || preset === "override") {
      const exp = attrs.preset_expiration;
      if (exp) {
        const d = new Date(exp);
        if (!isNaN(d)) {
          return this._t("gw_manual_until", {
            time: d.toLocaleTimeString(this._lang, { hour: "2-digit", minute: "2-digit" }),
          });
        }
      }
      return "manual";
    }
    return preset || "";
  }

  _updateClimate() {
    if (!this._hass) return;
    const sig = this._climateSignature();
    if (sig === this._climateSig) return;
    this._climateSig = sig;
    const wrap = this.renderRoot.querySelector('[data-tabbody="climate"] .rows');
    if (!wrap) return;
    const eids = this._climateEntities();
    if (!eids.length) {
      wrap.innerHTML = `
        <div class="empty">
          <ha-icon icon="mdi:thermostat"></ha-icon>
          <div>${esc(this._t("gw_no_climate"))}</div>
        </div>`;
      return;
    }
    const groups = this._roomGroups(eids);
    const parts = [];
    for (const [area, list] of groups) {
      const areaInfo = area && this._hass.areas ? this._hass.areas[area] : null;
      const areaIcon = (areaInfo && areaInfo.icon) || (area ? "mdi:door-open" : "mdi:help-circle-outline");
      parts.push(`<div class="roomhead">
        <span class="roompill${area ? "" : " none"}">
          <ha-icon icon="${esc(areaIcon)}"></ha-icon>
          <span class="roomname">${esc(area ? this._areaName(area) : this._t("no_room"))}</span>
        </span>
      </div>`);
      for (const eid of list) {
        const st = this._hass.states[eid];
        const attrs = st.attributes || {};
        const heating = attrs.hvac_action === "heating";
        const preset = this._presetText(attrs);
        const temps = [
          attrs.current_temperature !== undefined
            ? fmtTemp(attrs.current_temperature) + "\u00B0" : "",
          attrs.temperature !== undefined ? "\u2192 " + fmtTemp(attrs.temperature) + "\u00B0" : "",
        ].filter(Boolean).join(" ");
        const sub = [temps, preset].filter(Boolean).join(" · ");
        parts.push(`
          <div class="row" data-entity="${eid}">
            <span class="ico ${heating ? "heating" : ""}"><ha-icon icon="mdi:thermostat"></ha-icon></span>
            <div class="rowmain">
              <div class="name">${esc(shortName(this._hass, eid))}</div>
              <div class="sub">${esc(sub)}</div>
              ${scheduleStripHTML(st)}
            </div>
            <button class="btn" data-entity="${eid}">${esc(this._t("gw_edit_schedule"))}</button>
          </div>`);
      }
    }
    wrap.innerHTML = parts.join("");
    for (const btn of wrap.querySelectorAll("button.btn")) {
      btn.addEventListener("click", () => this._openSchedule(btn.dataset.entity));
    }
  }

  _openSchedule(eid) {
    const overlay = openDialog(this, {
      // The editor shows the thermostat name itself; avoid saying it twice.
      title: this._t("gw_edit_schedule"), bodyHTML: "", wide: true,
    });
    const body = overlay.querySelector(".dlg-body");
    const editor = document.createElement("renson-smartliving-thermostat-config-card");
    editor.setConfig({ entity: eid, embedded: true });
    editor.hass = this._hass;
    body.style.padding = "4px 20px 20px";
    body.appendChild(editor);
    // Keep the editor's hass fresh while the dialog is open.
    const iv = setInterval(() => {
      if (!overlay.isConnected) {
        clearInterval(iv);
        return;
      }
      editor.hass = this._hass;
    }, 1000);
  }

  /* -- Header ---------------------------------------------------------- */

  _updateHeader() {
    if (!this._hass) return;
    const sub = this.renderRoot.querySelector(".gw-sub");
    const devices = this._gatewayDevices();
    if (sub) {
      if (devices.length > 1) {
        // Multiple gateways: dropdown to pick which one this card shows.
        if (!sub.querySelector("select")) {
          sub.innerHTML = `
            <select aria-label="${esc(this._t("gw_select_gateway"))}">
              ${devices.map((d) => `<option value="${esc(d.id)}"${d.id === this._deviceFilter ? " selected" : ""}>${esc(d.name)}</option>`).join("")}
            </select>`;
          sub.querySelector("select").addEventListener("change", (e) => {
            this._deviceFilter = e.target.value || null;
            this._screensSig = "";
            this._climateSig = "";
            this._embedded = [];
            this._renderShell();
            this._configureEmbedded();
            for (const child of this._embedded) child.hass = this._hass;
            this._updateHeader();
            this._updateCounts();
            this._updateScreens();
            this._updateClimate();
          });
        }
      } else {
        sub.textContent = this._gatewayLabel();
      }
    }
    const chip = this.renderRoot.querySelector(".gw-chip");
    if (chip) {
      const ok = this._statusOK();
      chip.classList.toggle("bad", !ok);
      chip.querySelector("span").textContent =
        ok ? this._t("gw_connected") : this._t("gw_unavailable");
    }
  }

  _updateCounts() {
    if (!this._hass) return;
    const counts = {
      inputs: this._omEntities("event").length,
      automations: (this._gasCount || 0),
      screens: this._covers().length,
      climate: this._climateEntities().length,
    };
    for (const [tab, n] of Object.entries(counts)) {
      const el = this.renderRoot.querySelector(`[data-count="${tab}"]`);
      if (el) el.textContent = n;
    }
  }

  /* -- Shell (built once) ----------------------------------------------- */

  _renderShell() {
    if (!this.renderRoot) return;
    const lang = this._lang || "en";
    const tabs = [
      ["inputs", "gw_tab_inputs", "mdi:gesture-tap-button"],
      ["automations", "gw_tab_automations", "mdi:robot"],
      ["screens", "gw_tab_screens", "mdi:window-shutter"],
      ["climate", "gw_tab_climate", "mdi:thermostat"],
    ];
    this.renderRoot.innerHTML = `
      <style>
        ${dialogCSS()}
        ${scheduleStripCSS()}
        :host { display: block; }
        ha-card {
          display: block; margin: 0 auto; max-width: 960px;
          background: var(--card-background-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          font-family: inherit; color: var(--primary-text-color);
        }
        .head {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 16px 10px;
        }
        .head .gw-ico {
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(var(--rgb-primary-color), .12);
          color: var(--primary-color);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .head .gw-ico ha-icon { --mdc-icon-size: 22px; }
        .headmain { flex: 1; min-width: 0; }
        .head .gw-title { font-size: 1em; font-weight: 600; }
        .head .gw-sub {
          font-size: .8em; color: var(--secondary-text-color);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .gw-chip {
          display: flex; align-items: center; gap: 4px;
          font-size: .72em; font-weight: 600;
          color: var(--success-color, green);
          background: var(--secondary-background-color);
          border-radius: 10px; padding: 3px 8px; flex-shrink: 0;
        }
        .gw-chip.bad { color: var(--error-color, red); }
        .gw-chip ha-icon { --mdc-icon-size: 12px; }
        .tabs {
          display: flex; gap: 4px; margin: 4px 16px 12px;
          background: var(--secondary-background-color);
          border-radius: 12px; padding: 4px;
        }
        .tabs button {
          flex: 1; display: flex; align-items: center; justify-content: center;
          gap: 6px; border: none; background: transparent;
          color: var(--secondary-text-color);
          font: inherit; font-size: .85em; font-weight: 600;
          padding: 8px 4px; border-radius: 9px; cursor: pointer;
          transition: background .15s ease, color .15s ease;
        }
        .tabs button ha-icon { --mdc-icon-size: 16px; }
        .tabs button .cnt {
          font-size: .78em; font-weight: 700;
          background: var(--divider-color);
          color: var(--primary-text-color);
          border-radius: 8px; padding: 0 6px; min-width: 14px;
        }
        .tabs button.active {
          background: var(--card-background-color);
          color: var(--primary-color);
          box-shadow: 0 1px 3px rgba(0,0,0,.15);
        }
        .tabbody { display: none; padding: 0 8px 8px; }
        .tabbody.active { display: block; }
        .rows {
          border-radius: 14px;
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          padding: 2px 16px;
        }
        .roomhead {
          position: sticky; top: 0; z-index: 1;
          padding: 14px 0 6px;
          background: var(--card-background-color);
        }
        .roomhead:first-child { padding-top: 12px; }
        .roompill {
          display: inline-flex; align-items: center; gap: 7px;
          max-width: 100%;
          padding: 5px 14px 5px 9px; border-radius: 999px;
          background: rgba(var(--rgb-primary-color), .14);
          color: var(--primary-color);
          font-weight: 700; font-size: .95em; letter-spacing: .01em;
        }
        .roompill ha-icon { --mdc-icon-size: 18px; flex-shrink: 0; }
        .roompill.none {
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
        }
        .roompill .roomname {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .roompill .roomname::first-letter { text-transform: uppercase; }
        .row {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 0;
        }
        .row + .row { border-top: 1px solid var(--divider-color); }
        .row:hover { background: rgba(var(--rgb-primary-color), .04); }
        .ico {
          width: 34px; height: 34px; border-radius: 50%;
          background: rgba(var(--rgb-primary-color), .12);
          color: var(--primary-color);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ico ha-icon { --mdc-icon-size: 18px; }
        .ico.heating {
          background: rgba(var(--rgb-state-climate-heat-color, 255, 112, 67), .18);
          color: var(--state-climate-heat-color, var(--primary-color));
        }
        .rowmain { flex: 1; min-width: 0; }
        .rowmain .name { font-size: .92em; font-weight: 600; }
        .rowmain .sub {
          font-size: .78em; color: var(--secondary-text-color);
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }
        .rowmain .schedwrap { margin-top: 8px; }
        .chip {
          display: inline-flex; align-items: center; gap: 2px;
          font-size: .95em;
        }
        .chip ha-icon { --mdc-icon-size: 12px; }
        .btn {
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          border-radius: 10px; padding: 6px 12px; cursor: pointer;
          font: inherit; font-size: .8em; font-weight: 600;
          flex-shrink: 0;
          transition: filter .15s ease, border-color .15s ease;
        }
        .btn:hover { filter: brightness(1.05); border-color: var(--primary-color); }
        .empty {
          text-align: center; padding: 26px 10px;
          color: var(--secondary-text-color); font-size: .9em;
        }
        .empty ha-icon { --mdc-icon-size: 30px; display: block; margin: 0 auto 6px; }
        .saved {
          display: block; text-align: center; margin-top: 8px;
          font-size: .85em; color: var(--primary-color); font-weight: 600;
        }
        .saved:empty { display: none; }
        @media (max-width: 450px) {
          .tabs button .lbl { display: none; }
          .tabs button .cnt { font-size: .7em; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; }
        }
      </style>
      <ha-card>
        <div class="head">
          <span class="gw-ico"><ha-icon icon="mdi:router-wireless"></ha-icon></span>
          <div class="headmain">
            <div class="gw-title">${esc(this._t("gw_title"))}</div>
            <div class="gw-sub"></div>
          </div>
          <div class="gw-chip"><ha-icon icon="mdi:check-circle"></ha-icon><span></span></div>
        </div>
        <div class="tabs">
          ${tabs.map(([id, key, icon]) => `
            <button class="${this._tab === id ? "active" : ""}" data-tab="${id}">
              <ha-icon icon="${icon}"></ha-icon>
              <span class="lbl">${esc(this._t(key))}</span>
              <span class="cnt" data-count="${id}"></span>
            </button>`).join("")}
        </div>
        <div class="tabbody ${this._tab === "inputs" ? "active" : ""}" data-tabbody="inputs">
          <renson-smartliving-input-link-card id="inputs-card"></renson-smartliving-input-link-card>
        </div>
        <div class="tabbody ${this._tab === "automations" ? "active" : ""}" data-tabbody="automations">
          <renson-smartliving-automation-editor id="automations-card"></renson-smartliving-automation-editor>
        </div>
        <div class="tabbody ${this._tab === "screens" ? "active" : ""}" data-tabbody="screens">
          <div class="rows"></div>
        </div>
        <div class="tabbody ${this._tab === "climate" ? "active" : ""}" data-tabbody="climate">
          <div class="rows"></div>
        </div>
      </ha-card>
    `;

    // Tab switching: toggle classes only, no rebuild.
    for (const btn of this.renderRoot.querySelectorAll(".tabs button")) {
      btn.addEventListener("click", () => {
        this._tab = btn.dataset.tab;
        for (const b of this.renderRoot.querySelectorAll(".tabs button")) {
          b.classList.toggle("active", b.dataset.tab === this._tab);
        }
        for (const body of this.renderRoot.querySelectorAll(".tabbody")) {
          body.classList.toggle("active", body.dataset.tabbody === this._tab);
        }
      });
    }

    // Screens list lives outside the embedded cards; wire its dialog opener.
    this._screensSig = "";
    this._climateSig = "";
    this._embConfigured = false;
    this._inputsConfigured = false;
    if (this._hass) {
      this._embConfigured = true;
      this._updateScreens();
      this._updateClimate();
      this._configureEmbedded();
    }
  }

  _configureInputs() {
    if (this._inputsConfigured) return true;
    const inputsCard = this.renderRoot.querySelector("#inputs-card");
    if (!inputsCard) return false;
    const entities = this._config.entities || this._omEntities("event");
    // The input-link card throws on an empty list ("Please define
    // entities"), which turns the whole dashboard card into a
    // Configuration error. Wait until there is something to show.
    if (!entities.length) return false;
    inputsCard.setConfig({ entities, embedded: true });
    inputsCard.hass = this._hass;
    this._embedded = this._embedded || [];
    this._embedded.push(inputsCard);
    this._inputsConfigured = true;
    return true;
  }

  _configureEmbedded() {
    this._embedded = [];
    this._inputsConfigured = false;
    this._configureInputs();
    const automationsCard = this.renderRoot.querySelector("#automations-card");
    if (automationsCard) {
      automationsCard.setConfig({ embedded: true });
      automationsCard.hass = this._hass;
      this._embedded.push(automationsCard);
      // Count badge for automations comes from the editor's own fetch.
      automationsCard.addEventListener("gas-loaded", (e) => {
        this._gasCount = e.detail && e.detail.count;
        this._updateCounts();
      });
    }
  }
}

customElements.define("renson-smartliving-gateway-config", RensonGatewayConfigCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-gateway-config",
  name: "Renson Gateway Configuration",
  description: "Configure the gateway: input links, automations and screen timers",
});
