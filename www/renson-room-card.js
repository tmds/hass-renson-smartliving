/**
 * Renson room card: clean entry tile for one room.
 *
 * Shows room name, current temperature and lights-on count, and
 * navigates to the room view on click.
 *
 * Config:
 *   type: custom:renson-room-card
 *   path: /lovelace/badkamer-beneden
 *   title: Badkamer beneden
 *   climate: climate.badkamer_beneden
 *   lights: [light.x, light.y]
 */
class RensonRoomCard extends HTMLElement {
  static getStubConfig() {
    return { path: "", title: "", climate: "" };
  }

  set hass(hass) {
    this._hass = hass;
    const sig = this._signature();
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
  }

  setConfig(config) {
    if (!config.path || !config.title) {
      throw new Error("path and title are required");
    }
    this._config = config;
    this.renderRoot = this.attachShadow({ mode: "open" });
  }

  getCardSize() {
    return 2;
  }

  _fmtTemp(t) {
    return t === undefined || t === null ? "?" : Number(t).toFixed(1).replace(/\.0$/, "");
  }

  _lightsOn() {
    const lights = this._config.lights || [];
    if (!this._hass) return { on: 0, total: lights.length };
    const on = lights.filter((e) => {
      const s = this._hass.states[e];
      return s && s.state === "on";
    }).length;
    return { on, total: lights.length };
  }

  _signature() {
    if (!this._hass) return "";
    const parts = [];
    const cl = this._config.climate
      ? this._hass.states[this._config.climate] : null;
    if (cl) {
      parts.push(cl.state, cl.attributes.current_temperature,
        cl.attributes.temperature);
    }
    for (const eid of [...(this._config.lights || []), ...(this._config.covers || [])]) {
      const s = this._hass.states[eid];
      parts.push(eid, s ? s.state : "?");
    }
    return parts.join("|");
  }

  _toggle(entity_id, domain) {
    this._hass.callService(domain, "toggle", { entity_id });
  }

  _iconStrip() {
    const lights = this._config.lights || [];
    const covers = this._config.covers || [];
    if ((!lights.length && !covers.length) || !this._hass) return "";
    const chips = [];
    for (const eid of lights) {
      const s = this._hass.states[eid];
      const on = s && s.state === "on";
      const raw = (s && s.attributes.friendly_name) || eid;
      const name = raw.includes(") ")
        ? raw.split(") ").slice(1).join(") ")
        : raw;
      chips.push(
        `<button class="chip light ${on ? "on" : ""}" data-entity="${eid}" data-domain="light" ` +
        `data-name="${name}">` +
        `<ha-icon icon="mdi:lightbulb"></ha-icon></button>`
      );
    }
    for (const eid of covers) {
      const s = this._hass.states[eid];
      const open = s && s.state === "open";
      const raw = (s && s.attributes.friendly_name) || eid;
      const name = raw.includes(") ")
        ? raw.split(") ").slice(1).join(") ")
        : raw;
      chips.push(
        `<button class="chip cover ${open ? "on" : ""}" data-entity="${eid}" data-domain="cover" ` +
        `data-name="${name}">` +
        `<ha-icon icon="mdi:window-shutter"></ha-icon></button>`
      );
    }
    return `<div class="chips">${chips.join("")}</div>`;
  }

  _navigate() {
    window.history.pushState(null, "", this._config.path);
    window.dispatchEvent(new Event("location-changed"));
  }

  _render() {
    if (!this.renderRoot || !this._hass) return;
    const climate = this._config.climate
      ? this._hass.states[this._config.climate] : null;
    const temp = climate ? climate.attributes.current_temperature : null;
    const target = climate ? climate.attributes.temperature : null;
    const lights = this._lightsOn();
    const heat = climate && climate.state === "heat";
    const sub = [];
    if (temp !== null && temp !== undefined) {
      sub.push(`${this._fmtTemp(target)}\u00B0 target`);
    }
    if (lights.total) sub.push(`${lights.on}/${lights.total} lights on`);

    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: 16px 18px;
          border-radius: var(--ha-card-border-radius, 16px);
          background: var(--card-background-color, var(--paper-card-background-color));
          border: 1px solid var(--divider-color, rgba(0,0,0,.08));
          cursor: pointer;
          transition: border-color .15s ease, transform .05s ease;
          display: block;
        }
        ha-card:hover { border-color: var(--primary-color); }
        ha-card:active { transform: scale(.99); }
        .row { display: flex; justify-content: space-between; align-items: center; }
        .name { font-weight: 700; font-size: 1.05em; color: var(--primary-text-color); }
        .chev { color: var(--secondary-text-color); font-size: 1.2em; }
        .temp { font-size: 1.7em; font-weight: 700; color: var(--primary-text-color); }
        .sub { font-size: .78em; color: var(--secondary-text-color); margin-top: 4px; }
        .badge {
          display: inline-block; padding: 3px 10px; border-radius: 10px;
          font-size: .72em; font-weight: 600; margin-top: 8px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
        }
        .badge.heat { background: rgba(255,112,67,.18); color: #e8602c; }
        .chips { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        .chip {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          cursor: pointer; padding: 0;
          transition: all .15s ease;
        }
        .chip:hover { border-color: var(--primary-color); }
        .chip::after {
          content: attr(data-name);
          position: absolute; bottom: calc(100% + 6px); left: 50%;
          transform: translateX(-50%);
          background: var(--primary-text-color, #222);
          color: var(--card-background-color, #fff);
          font-size: .72em; font-weight: 500;
          padding: 4px 8px; border-radius: 6px;
          white-space: nowrap; pointer-events: none;
          opacity: 0; transition: opacity .12s ease;
          z-index: 5;
        }
        .chip:hover::after { opacity: 1; }
        .chip.on.light { background: rgba(255,183,77,.22); color: #f5a623; border-color: rgba(245,166,35,.45); }
        .chip.on.cover { background: rgba(25,118,210,.14); color: var(--primary-color); border-color: rgba(25,118,210,.4); }
      </style>
      <ha-card>
        <div class="row">
          <div>
            <div class="name">${this._config.title}</div>
            <div class="sub">${sub.join(" &middot; ") || "&nbsp;"}</div>
            ${heat ? `<span class="badge heat">Heating schedule active</span>` : ""}
          </div>
          <div class="row">
            <span class="temp">${temp !== null && temp !== undefined ? `${this._fmtTemp(temp)}\u00B0` : ""}</span>
            <span class="chev">&rsaquo;</span>
          </div>
        </div>
        ${this._iconStrip()}
      </ha-card>
    `;
    this.renderRoot.querySelector("ha-card")
      .addEventListener("click", () => this._navigate());
    this.renderRoot.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggle(chip.dataset.entity, chip.dataset.domain);
      });
    });
  }
}

customElements.define("renson-room-card", RensonRoomCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-room-card",
  name: "Renson Room Card",
  description: "Clean room entry tile that navigates to the room view",
});
