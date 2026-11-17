/**
 * Renson rooms grid: all room tiles in one responsive full-width grid.
 *
 * Config:
 *   type: custom:renson-rooms-grid
 *   rooms:
 *     - path: /lovelace/praktijk
 *       title: Praktijk
 *       climate: climate.praktijk
 *       lights: [light.x]
 *       covers: [cover.y]
 *
 * Use in a panel view (type: panel) so the grid spans the full width.
 */
class RensonRoomsGrid extends HTMLElement {
  static getStubConfig() {
    return { rooms: [] };
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
    this._config = config;
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._render();
  }

  getCardSize() {
    return 8;
  }

  _sec(t) {
    const [h, m] = String(t).split(":").map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  }

  _fmtTemp(t) {
    return t === undefined || t === null
      ? "?" : Number(t).toFixed(1).replace(/\.0$/, "");
  }

  _shortName(raw) {
    raw = raw || "";
    return raw.includes(") ") ? raw.split(") ").slice(1).join(") ") : raw;
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

  _signature() {
    if (!this._hass) return "";
    const parts = [];
    for (const room of this._config.rooms || []) {
      const cl = room.climate ? this._hass.states[room.climate] : null;
      if (cl) parts.push(cl.state, cl.attributes.current_temperature,
        cl.attributes.temperature);
      for (const eid of [...(room.lights || []), ...(room.covers || [])]) {
        const s = this._hass.states[eid];
        parts.push(eid, s ? s.state : "?");
      }
    }
    return parts.join("|");
  }

  _toggle(entity_id, domain) {
    this._hass.callService(domain, "toggle", { entity_id });
  }

  _navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed"));
  }

  _roomHtml(room) {
    const cl = room.climate ? this._hass.states[room.climate] : null;
    const temp = cl ? cl.attributes.current_temperature : null;
    const target = cl ? cl.attributes.temperature : null;
    const heat = cl && cl.state === "heat";
    const lights = room.lights || [];
    const covers = room.covers || [];
    const chips = [];
    for (const eid of lights) {
      const s = this._hass.states[eid];
      const on = s && s.state === "on";
      chips.push(
        `<button class="chip light ${on ? "on" : ""}" data-entity="${eid}" data-domain="light" ` +
        `data-name="${this._shortName(s && s.attributes.friendly_name) || eid}">` +
        `<ha-icon icon="mdi:lightbulb"></ha-icon></button>`
      );
    }
    for (const eid of covers) {
      const s = this._hass.states[eid];
      const open = s && s.state === "open";
      chips.push(
        `<button class="chip cover ${open ? "on" : ""}" data-entity="${eid}" data-domain="cover" ` +
        `data-name="${this._shortName(s && s.attributes.friendly_name) || eid}">` +
        `<ha-icon icon="mdi:window-shutter"></ha-icon></button>`
      );
    }
    const sub = [];
    if (target !== null && target !== undefined) sub.push(`${this._fmtTemp(target)}\u00B0 target`);
    if (lights.length) {
      const on = lights.filter((e) => {
        const s = this._hass.states[e];
        return s && s.state === "on";
      }).length;
      sub.push(`${on}/${lights.length} lights on`);
    }
    return `
      <div class="tile" data-path="${room.path}">
        <div class="row">
          <div>
            <div class="name">${room.title}</div>
            <div class="sub">${sub.join(" &middot; ") || "&nbsp;"}</div>
          </div>
          <span class="temp">${temp !== null && temp !== undefined ? `${this._fmtTemp(temp)}\u00B0` : ""}</span>
        </div>
        ${heat ? `<span class="badge heat"><ha-icon icon="mdi:fire"></ha-icon>Heating</span>` : ""}
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
      </div>
    `;
  }

  _render() {
    if (!this.renderRoot || !this._hass) return;
    const rooms = this._config.rooms || [];
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
        }
        .tile {
          background: var(--card-background-color, var(--paper-card-background-color));
          border: 1px solid var(--divider-color, rgba(0,0,0,.08));
          border-radius: var(--ha-card-border-radius, 16px);
          padding: 16px 18px;
          cursor: pointer;
          transition: border-color .15s ease, transform .05s ease;
          min-height: 150px;
          box-sizing: border-box;
        }
        .tile:hover { border-color: var(--primary-color); }
        .tile:active { transform: scale(.99); }
        .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .name { font-weight: 700; font-size: 1.05em; color: var(--primary-text-color); }
        .sub { font-size: .78em; color: var(--secondary-text-color); margin-top: 4px; }
        .temp { font-size: 1.7em; font-weight: 700; color: var(--primary-text-color); white-space: nowrap; }
        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 10px;
          font-size: .72em; font-weight: 600; margin-top: 8px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
        }
        .badge.heat { background: rgba(255,112,67,.18); color: #e8602c; }
        .badge ha-icon { --mdc-icon-size: 13px; }
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
      <div class="grid">
        ${rooms.map((r) => this._roomHtml(r)).join("")}
      </div>
    `;
    this.renderRoot.querySelectorAll(".tile").forEach((tile) => {
      tile.addEventListener("click", (e) => {
        if (e.target.closest(".chip")) return;
        this._navigate(tile.dataset.path);
      });
    });
    this.renderRoot.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggle(chip.dataset.entity, chip.dataset.domain);
      });
    });
  }
}

customElements.define("renson-rooms-grid", RensonRoomsGrid);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-rooms-grid",
  name: "Renson Rooms Grid",
  description: "All room tiles in one responsive full-width grid",
});
