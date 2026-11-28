/**
 * Renson rooms grid: all room tiles in one responsive full-width grid.
 *
 * Config:
 *   type: custom:renson-smartliving-rooms-grid
 *   rooms:
 *     - path: /lovelace/praktijk
 *       title: Praktijk
 *       climate: climate.praktijk
 *       lights: [light.x]
 *       covers: [cover.y]
 *
 * Use in a panel view (type: panel) so the grid spans the full width.
 */
import { t, esc, shortName } from "./renson-smartliving-common.js?v=0.2.3";

class RensonRoomsGrid extends HTMLElement {
  static getStubConfig() {
    return { rooms: [] };
  }

  set hass(hass) {
    this._hass = hass;
    this._lang = (hass.locale && hass.locale.language) || this._lang || "en";
    // In edit-modus NIET re-renderen op state-updates: een innerHTML-vervanging
    // tijdens een actieve drag vernietigt het gesleepte element en de drag-state.
    if (this._editMode) return;
    const sig = this._signature();
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
  }

  _t(key, params) {
    return t(this._lang, key, params);
  }

  setConfig(config) {
    this._config = config;
    // HA freezet de card-config (Object.freeze): muteren gooit een fout.
    // Werken met een eigen kopie; alleen _persistOrder schrijft naar HA.
    this._rooms = Array.isArray(config.rooms) ? [...config.rooms] : [];
    this._editMode = false;
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
    for (const room of this._rooms) {
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
    // Twee verschillende signalen:
    // - mode-icoon (zonnetje bij hvac_mode heat, vriesicoontje bij cool): de
    //   ingestelde modus, staat dus op bijna elke tile.
    // - actie-badge (vlam/sneeuwvlok bij hvac_action): wat er effectief gebeurt.
    const action = cl && cl.attributes ? cl.attributes.hvac_action : undefined;
    const heat = action === "heating" || action === "preheating"
      || action === "defrosting"
      || (action === undefined && cl && cl.state === "heat");
    const cool = action === "cooling" || action === "drying"
      || action === "fan";
    const mode = cl ? cl.state : null;
    const modeIcon = mode === "heat" ? "mdi:white-balance-sunny"
      : mode === "cool" ? "mdi:snowflake" : null;
    const modeClass = mode === "cool" ? "mode-cool" : "mode-heat";
    const lights = room.lights || [];
    const covers = room.covers || [];
    const chips = [];
    for (const eid of lights) {
      const s = this._hass.states[eid];
      const on = s && s.state === "on";
      chips.push(
        `<button class="chip light ${on ? "on" : ""}" data-entity="${eid}" data-domain="light" ` +
        `data-name="${esc(shortName(this._hass, eid))}">` +
        `<ha-icon icon="mdi:lightbulb"></ha-icon></button>`
      );
    }
    for (const eid of covers) {
      const s = this._hass.states[eid];
      const open = s && s.state === "open";
      const pos = s && s.attributes && s.attributes.current_position;
      const posTag = (pos !== undefined && pos !== null && pos > 0 && pos < 100)
        ? `<span class="pos">${pos}%</span>`
        : "";
      chips.push(
        `<button class="chip cover ${open ? "on" : ""}" data-entity="${eid}" data-domain="cover" ` +
        `data-name="${esc(shortName(this._hass, eid))}">` +
        `<ha-icon icon="mdi:window-shutter"></ha-icon>${posTag}</button>`
      );
    }
    const sub = [];
    if (target !== null && target !== undefined) sub.push(`${this._fmtTemp(target)}\u00B0 ${this._t("target")}`);
    if (lights.length) {
      const on = lights.filter((e) => {
        const s = this._hass.states[e];
        return s && s.state === "on";
      }).length;
      sub.push(this._t("lights_on", { on, total: lights.length }));
    }
    const tileTag = this._editMode ? "div" : "a";
    const hrefAttr = this._editMode ? "" : ` href="${room.path}"`;
    return `
      <${tileTag} class="tile" data-path="${room.path}"${hrefAttr} draggable="${this._editMode}">
        <div class="row">
          <div>
            <div class="name">${room.title}</div>
            <div class="sub">${sub.join(" &middot; ") || "&nbsp;"}</div>
          </div>
          <span class="temp">${temp !== null && temp !== undefined ? `${this._fmtTemp(temp)}\u00B0` : ""}</span>
        </div>
        <div class="modes">
        ${modeIcon ? `<span class="mode-circle ${modeClass}" title="${mode === "cool" ? this._t("hvac_mode_cooling") : this._t("hvac_mode_heating")}"><ha-icon icon="${modeIcon}"></ha-icon></span>` : ""}${heat ? `<span class="badge heat"><ha-icon icon="mdi:fire"></ha-icon>${this._t("heating")}</span>` : ""}
        ${cool ? `<span class="badge cool"><ha-icon icon="mdi:snowflake"></ha-icon>${this._t("cooling")}</span>` : ""}
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
      </${tileTag}>
    `;
  }

  _render() {
    if (!this.renderRoot || !this._hass) return;
    const rooms = this._rooms;
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap { position: relative; padding: 18px 22px; }
        .editbtn {
          position: absolute; top: 12px; right: 14px; z-index: 3;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, var(--paper-card-background-color));
          color: var(--secondary-text-color);
          width: 32px; height: 32px; border-radius: 50%; box-sizing: border-box;
          cursor: pointer; padding: 0;
          transition: all .15s ease;
        }
        .editbtn:hover { color: var(--primary-color); border-color: var(--primary-color); }
        .editbtn.on {
          background: var(--primary-color); color: var(--primary-text-color);
          border-color: var(--primary-color);
        }
        .hint {
          position: absolute; top: 16px; right: 58px; z-index: 3;
          font-size: .75em; color: var(--secondary-text-color);
          background: var(--secondary-background-color);
          padding: 4px 10px; border-radius: 10px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
        }
        .tile, a.tile {
          display: block;
          position: relative;
          text-decoration: none;
          color: inherit;
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
        .tile.dragging {
          opacity: .45;
          border-style: dashed;
          border-color: var(--primary-color);
        }
        .tile.drop-target {
          border-color: var(--primary-color);
          border-width: 2px;
        }
        .tile[draggable="true"] { cursor: grab; }
        .tile[draggable="true"]:active { cursor: grabbing; }
        .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .name { font-weight: 700; font-size: 1.05em; color: var(--primary-text-color); }
        .sub { font-size: .78em; color: var(--secondary-text-color); margin-top: 4px; }
        .temp { font-size: 1.7em; font-weight: 700; color: var(--primary-text-color); white-space: nowrap; }
        .modes {
          display: flex; align-items: center; gap: 6px;
          margin-top: 8px; flex-wrap: wrap;
        }
        .modes:empty { display: none; }
        .modes .badge { margin-top: 0; }
        .mode-circle {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 50%; box-sizing: border-box;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          cursor: default; flex: none;
        }
        .mode-circle ha-icon { --mdc-icon-size: 18px; }
        .mode-circle.mode-heat ha-icon { color: #f5a623; }
        .mode-circle.mode-cool ha-icon { color: var(--primary-color); }
        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 10px;
          font-size: .72em; font-weight: 600; margin-top: 8px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
        }
        .badge.heat { background: rgba(255,112,67,.18); color: #e8602c; }
        .badge.cool { background: rgba(25,118,210,.14); color: var(--primary-color); }
        .badge ha-icon { --mdc-icon-size: 13px; }
        .chips { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        .chip {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 50%; box-sizing: border-box;
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
        .chip .pos {
          position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%);
          font-size: 8.5px; font-weight: 700; line-height: 1;
          padding: 2px 4px; border-radius: 6px;
          background: var(--primary-color); color: #fff;
          pointer-events: none; white-space: nowrap;
        }
      </style>
      <div class="wrap">
        <button class="editbtn" title="${this._t("reorder_rooms")}">
          <ha-icon icon="${this._editMode ? "mdi:check" : "mdi:pencil"}"></ha-icon>
        </button>
        ${this._editMode ? `<span class="hint">${this._t("edit_hint")}</span>` : ""}
        <div class="grid">
          ${rooms.map((r) => this._roomHtml(r)).join("")}
        </div>
      </div>
    `;
    this.renderRoot.querySelectorAll("a.tile").forEach((tile) => {
      // native navigatie via de anchor; alleen in edit-modus blokkeren
      tile.addEventListener("click", (e) => {
        if (this._editMode) e.preventDefault();
      });
    });
    this.renderRoot.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (this._editMode) return;
        this._toggle(chip.dataset.entity, chip.dataset.domain);
      });
    });
    this.renderRoot.querySelector(".editbtn").addEventListener("click", () => {
      this._editMode = !this._editMode;
      this._lastSig = null;
      this._render();
      // bij het afsluiten van de edit-modus de volgorde 1x wegschrijven
      if (!this._editMode) this._persistOrder();
    });
    if (this._editMode) this._wireDrag();
  }

  _wireDrag() {
    const wrap = this.renderRoot.querySelector(".wrap");
    const grid = this.renderRoot.querySelector(".grid");
    const tiles = [...grid.querySelectorAll(".tile")];
    let dragEl = null;
    tiles.forEach((tile) => {
      tile.addEventListener("dragstart", (e) => {
        dragEl = tile;
        tile.classList.add("dragging");
        // Firefox vereist setData, Chrome gebruikt het niet
        try { e.dataTransfer.setData("text/plain", tile.dataset.path); } catch (err) { /* noop */ }
        e.dataTransfer.effectAllowed = "move";
      });
      tile.addEventListener("dragend", () => {
        tile.classList.remove("dragging");
        tiles.forEach((t) => t.classList.remove("drop-target"));
        dragEl = null;
        this._commitDomOrder();
      });
    });
    const moveUnderCursor = (e) => {
      if (!dragEl) return;
      const target = tiles.find((t) => {
        if (t === dragEl) return false;
        const r = t.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right
          && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      tiles.forEach((t) => t.classList.remove("drop-target"));
      if (!target) return;
      target.classList.add("drop-target");
      const r = target.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      grid.insertBefore(dragEl, after ? target.nextSibling : target);
    };
    // dragover/drop op de grid (bubbelt vanaf de tiles): overal accepteren,
    // anders speelt Chrome de snap-back-animatie en "springt" de tile terug.
    grid.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      moveUnderCursor(e);
    });
    grid.addEventListener("drop", (e) => {
      e.preventDefault();
      moveUnderCursor(e);
    });
    // ook net buiten de grid (in .wrap) accepteren: geen snap-back
    wrap.addEventListener("dragover", (e) => e.preventDefault());
    wrap.addEventListener("drop", (e) => e.preventDefault());
  }

  _commitDomOrder() {
    const grid = this.renderRoot.querySelector(".grid");
    const domPaths = [...grid.querySelectorAll(".tile")].map((t) => t.dataset.path);
    const rooms = this._rooms;
    const byPath = new Map(rooms.map((r) => [r.path, r]));
    // alleen committen als de volgorde echt veranderd is én alle paths bekend
    if (domPaths.length !== rooms.length || domPaths.some((p) => !byPath.has(p))) return;
    const reordered = domPaths.map((p) => byPath.get(p));
    if (reordered.every((r, i) => r === rooms[i])) return;
    this._rooms = reordered;
    this._lastSig = null;
    this._render();
    // NIET hier persisteren: de lovelace-config-save re-creëert de card en
    // haalt de gebruiker uit de edit-modus. Persisteer bij het afsluiten (editbtn).
  }

  async _persistOrder() {
    try {
      // De grid kan op een eigen dashboard staan (bv. openmotics-home):
      // zonder url_path leest/slaat HA het STANDAARD-dashboard op en faalt
      // de type-check stil (niets wordt opgeslaan, ook de tabs niet).
      const seg = window.location.pathname.split("/")[1];
      const urlPath = seg && seg !== "lovelace" ? seg : undefined;
      const config = await this._hass.connection.sendMessagePromise({
        type: "lovelace/config",
        url_path: urlPath,
      });
      const view = config.views && config.views[0];
      const card = view && view.cards && view.cards[0];
      if (card && card.type === "custom:renson-smartliving-rooms-grid") {
        card.rooms = this._rooms;
        // De tab-rij volgt de view-volgorde: herschik de ruimte-views
        // mee met de gesleepte volgorde. Views[0] (Overview) blijft eerst;
        // views die niet in de kamerlijst staan (bv. extra dashboards)
        // blijven achteraan in hun onderlinge volgorde staan.
        // Tile-paths hebben de vorm "/lovelace/<path>", view.path alleen "<path>".
        // tile-paths kunnen /lovelace/<path> OF /<dashboard>/<path> zijn;
        // het laatste segment is de view.path
        const norm = (p) => String(p).split("/").filter(Boolean).pop() || "";
        const order = this._rooms.map((r) => norm(r.path));
        const first = config.views[0];
        const rest = config.views.slice(1);
        const byPath = new Map(rest.map((v) => [v.path, v]));
        const sorted = order.map((p) => byPath.get(p)).filter(Boolean);
        const leftovers = rest.filter((v) => !order.includes(v.path));
        config.views = [first, ...sorted, ...leftovers];
        await this._hass.connection.sendMessagePromise({
          type: "lovelace/config/save",
          url_path: urlPath,
          config,
        });
      }
    } catch (err) {
      // order blijft lokaal bewaard tot een volgende save slaagt
      console.error("renson-rooms-grid: persist failed", err);
    }
  }
}

customElements.define("renson-smartliving-rooms-grid", RensonRoomsGrid);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-rooms-grid",
  name: "Renson Rooms Grid",
  description: "All room tiles in one responsive full-width grid",
});
