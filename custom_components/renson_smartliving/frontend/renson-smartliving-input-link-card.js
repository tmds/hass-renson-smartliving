/**
 * Renson input link card: shows the inputs (buttons) of a room and lets you
 * link an input directly to an output on the OpenMotics gateway by clicking it.
 *
 * A linked input toggles its output on press, on the gateway itself, even
 * without Home Assistant running (the link is written to the gateway config).
 *
 * Config:
 *   type: custom:renson-smartliving-input-link-card
 *   entities: [event.keuken_keuken_kant_deur_1_4, ...]   (required)
 *   outputs:  [light.keuken_inbouwspots, ...]            (optional; defaults to
 *              all OpenMotics lights/switches in the same area as the inputs)
 */
import { t, esc, shortName } from "./renson-smartliving-common.js";

class RensonInputLinkCard extends HTMLElement {
  static getStubConfig() {
    return { entities: [], outputs: [] };
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || this._lang || "en";
    // Detect physical button presses: event entities update their state
    // (last-triggered timestamp) when the gateway pushes INPUT_CHANGE.
    let pressed = null;
    for (const eid of this._config.entities || []) {
      const st = hass.states[eid];
      const cur = st ? String(st.state) : null;
      if (this._lastStates && eid in this._lastStates
          && cur !== null && cur !== this._lastStates[eid]) {
        this._flash = this._flash || {};
        this._flash[eid] = Date.now();
        pressed = eid;
      }
      this._lastStates = this._lastStates || {};
      this._lastStates[eid] = cur;
    }
    const sig = this._signature(lang);
    if ((sig !== this._lastSig || pressed) && !this._open) {
      this._lastSig = sig;
      this._lang = lang;
      this._render();
    }
    if (pressed && !this._flashTimer) {
      // Re-render once to clear the flash animation.
      this._flashTimer = setTimeout(() => {
        this._flashTimer = null;
        if (!this._open) this._render();
      }, 2600);
    }
    // Fetch the gateway automations once so rows can show WHICH automation
    // an input triggers (attribute linked_group_action_id).
    if (!this._gas && !this._gaLoading && !this._open) this._fetchGas();
  }

  async _fetchGas() {
    this._gaLoading = true;
    try {
      const raw = await this._hass.callService(
        "renson_smartliving", "get_group_actions", {}, undefined, undefined, true
      );
      const resp = raw && raw.response ? raw.response : raw;
      if (resp && Array.isArray(resp.actions)) {
        this._gas = resp.actions.filter((g) => g.name || g.actions);
        this._gaResp = resp;
        this._gaRetry = false;
        this._shuttersMap = {};
        for (const s of resp.shutters || []) this._shuttersMap[s.id] = s.name || "";
      }
    } catch (err) {
      // non-fatal: rows fall back to the generic text; retry once shortly
      if (!this._gaRetry) {
        this._gaRetry = true;
        setTimeout(() => { this._gaLoading = false; this._fetchGas(); }, 3000);
        return;
      }
    }
    this._gaLoading = false;
    if (this._open && this._dialogRefresh) this._dialogRefresh();
    else if (!this._open) this._render();
  }

  _gaName(id) {
    const ga = (this._gas || []).find((g) => g.id === id);
    return ga && ga.name ? ga.name : "#" + id;
  }

  _shutterName(id) {
    const n = this._shuttersMap ? this._shuttersMap[id] : null;
    return n || "#" + id;
  }

  /* Decode a basic_actions string into a human description (name first). */
  _describeBasic(ba) {
    if (!ba) return "";
    const t = String(ba).split(",").map(Number);
    // Combined short + long form the gateway writes:
    // 207,<long>,236,0,2,<short>,236,255
    if (t.length === 8 && t[0] >= 207 && t[0] <= 211 && t[2] === 236) {
      return this._t("ga_on_long", { name: this._gaName(t[1]) })
        + " · " + this._t("ga_on_short", { name: this._gaName(t[5]) });
    }
    // Release-only form: 236,0,2,<short>,236,255
    if (t.length === 6 && t[0] === 236 && t[2] === 2) {
      return this._t("ga_on_short", { name: this._gaName(t[3]) });
    }
    const parts = [];
    for (let i = 0; i + 1 < t.length; i += 2) {
      const a = t[i], n = t[i + 1];
      if (a === 2) {
        parts.push(this._t("ga_press", { name: this._gaName(n) }));
      } else if (a >= 207 && a <= 211) {
        parts.push(this._t("ga_on_long", { name: this._gaName(n) }));
      } else if (a === 103) {
        parts.push(this._t("ba_shutter_toggle",
          { name: this._shutterName(n) }));
      } else if (a === 108) {
        parts.push(this._t("ba_shutter_up_toggle",
          { name: this._shutterName(n) }));
      } else if (a === 109) {
        parts.push(this._t("ba_shutter_down_toggle",
          { name: this._shutterName(n) }));
      }
    }
    return parts.join(" · ");
  }

  _signature(lang) {
    // Only re-render when something user-visible changes. Re-rendering on
    // every hass update replaces the DOM mid-click and eats clicks.
    const parts = [lang, this._gas ? this._gas.length : "-"];
    for (const eid of this._config.entities || []) {
      const st = this._hass && this._hass.states[eid];
      if (!st) { parts.push("missing"); continue; }
      const a = st.attributes || {};
      parts.push(eid, a.linked_output_id === undefined ? "-" : a.linked_output_id,
                 a.linked_output_name || "", a.has_extended_actions ? "x" : "",
                 a.linked_group_action_id === undefined ? "-" : a.linked_group_action_id,
                 a.basic_actions || "");
    }
    return parts.join("|");
  }

  _t(key, params) {
    return t(this._lang, key, params);
  }

  setConfig(config) {
    if (!Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("Please define entities (input event entities)");
    }
    this._config = config;
    this._embeddedMode = !!config.embedded;
    this._filter = "";
    if (!this.renderRoot) {
      this.renderRoot = this.attachShadow({ mode: "open" });
    }
    this._render();
  }

  getCardSize() {
    return Math.max(1, (this._config.entities || []).length);
  }

  _friendly(entityId) {
    return shortName(this._hass, entityId);
  }

  _linked(entityId) {
    const st = this._hass && this._hass.states[entityId];
    return st && st.attributes && st.attributes.linked_output || null;
  }

  _candidateOutputs() {
    if (Array.isArray(this._config.outputs) && this._config.outputs.length) {
      return this._config.outputs;
    }
    // All OpenMotics lights/switches (platform filter), for the room dropdown.
    const hass = this._hass;
    if (!hass || !hass.entities) return [];
    return Object.keys(hass.states).filter((eid) => {
      const domain = eid.split(".")[0];
      const info = hass.entities[eid];
      return (
        (domain === "light" || domain === "switch" || domain === "cover") &&
        info && info.platform === "renson_smartliving"
      );
    });
  }

  _roomOf(entityId) {
    const hass = this._hass;
    const info = hass && hass.entities && hass.entities[entityId];
    return (info && info.area_id) || null;
  }

  _areaName(areaId) {
    const hass = this._hass;
    return (hass && hass.areas && hass.areas[areaId] && hass.areas[areaId].name) || areaId;
  }

  _render() {
    const lang = this._lang || "en";
    const makeRow = (eid) => {
      const linked = this._linked(eid);
      const st = this._hass && this._hass.states[eid];
      const extended = !!(st && st.attributes && st.attributes.has_extended_actions);
      const gaId = st && st.attributes ? st.attributes.linked_group_action_id : undefined;
      const flashing = this._flash && this._flash[eid]
        && (Date.now() - this._flash[eid]) < 2500;
      let linkText;
      if (gaId !== undefined) {
        linkText = this._t("runs_automation", { name: this._gaName(gaId) });
      } else if (extended) {
        const desc = this._describeBasic(
          st && st.attributes ? st.attributes.basic_actions : ""
        );
        linkText = desc || (linked
          ? this._t("linked_to", { name: this._friendly(linked) })
          : this._t("gateway_automation"));
      } else if (linked) {
        linkText = this._t("linked_to", { name: this._friendly(linked) });
      } else {
        linkText = this._t("not_linked");
      }
      return `
        <div class="row ${flashing ? "flash" : ""}" data-entity="${eid}">
          <span class="ico"><ha-icon icon="mdi:gesture-tap"></ha-icon></span>
          <div class="info">
            <div class="name">${esc(this._friendly(eid))}${flashing ? ' <ha-icon class="pressicon" icon="mdi:gesture-tap"></ha-icon>' : ""}</div>
            <div class="link ${linked ? "on" : ""}">${linkText}</div>
          </div>
          <button class="go" data-entity="${eid}">${this._t("link")}</button>
        </div>`;
    };
    // Optional filter (search box): match on input name, room or linked target.
    let visible = this._config.entities || [];
    if (this._filter) {
      const q = this._filter.toLowerCase();
      visible = visible.filter((eid) => {
        const st = this._hass && this._hass.states[eid];
        const name = (st && st.attributes && st.attributes.friendly_name) || eid;
        const area = this._roomOf(eid) ? this._areaName(this._roomOf(eid)) : "";
        const linked = this._linked(eid);
        const target = linked ? ((this._hass.states[linked] || {}).attributes || {}).friendly_name || "" : "";
        return name.toLowerCase().includes(q) || area.toLowerCase().includes(q)
          || target.toLowerCase().includes(q);
      });
    }
    // Group rows by room (area). A standalone card in a room view shows a
    // single group, so the headers only appear when there is more than one.
    const groups = new Map();
    for (const eid of visible) {
      const area = this._roomOf(eid) || "";
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(eid);
    }
    const sortedAreas = [...groups.keys()].sort((a, b) => {
      const an = a ? this._areaName(a) : this._t("no_room");
      const bn = b ? this._areaName(b) : this._t("no_room");
      return an.localeCompare(bn, lang);
    });
    const multi = sortedAreas.length > 1;
    const rows = [];
    for (const area of sortedAreas) {
      if (multi) {
        rows.push(`<div class="roomhead">${esc(
          area ? this._areaName(area) : this._t("no_room")
        )}</div>`);
      }
      for (const eid of groups.get(area)) rows.push(makeRow(eid));
    }
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: ${this._embeddedMode ? "0" : "12px 14px"};
          background: ${this._embeddedMode ? "transparent" : "var(--card-background-color)"};
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: ${this._embeddedMode ? "none" : "var(--ha-card-box-shadow, none)"};
          border: 1px solid var(--divider-color, rgba(0,0,0,.1));
        }
        .row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 0; gap: 10px;
        }
        .row .info { flex: 1; min-width: 0; }
        .row + .row { border-top: 1px solid var(--divider-color, rgba(0,0,0,.06)); }
        .ico {
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(var(--rgb-primary-color), .12);
          color: var(--primary-color);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ico ha-icon { --mdc-icon-size: 17px; }
        .roomhead {
          position: sticky; top: 0; z-index: 1;
          font-size: .72em; font-weight: 700; text-transform: uppercase;
          letter-spacing: .05em; color: var(--secondary-text-color);
          padding: 10px 2px 4px;
          background: var(--card-background-color);
        }
        .roomhead:first-child { margin-top: 2px; }
        .search {
          display: flex; align-items: center; gap: 6px;
          margin: 0 0 10px; padding: 0 10px;
          background: var(--secondary-background-color);
          border-radius: 12px;
        }
        .search ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
        .search input {
          flex: 1; border: none; background: transparent; outline: none;
          padding: 10px 0; font: inherit; font-size: .9em;
          color: var(--primary-text-color);
        }
        .row.flash {
          animation: renson-press 1.2s ease-in-out 2;
          border-radius: 8px;
        }
        @keyframes renson-press {
          0%, 100% { background: transparent; }
          50% { background: var(--accent-color, #03a9f4); opacity: .85; }
        }
        .pressicon { --mdc-icon-size: 18px; vertical-align: -3px;
                     color: var(--accent-color, #03a9f4); }
        .name { font-size: .92em; font-weight: 600; }
        .link { font-size: .78em; color: var(--secondary-text-color); }
        .link.on { color: var(--primary-color); font-weight: 600; }
        button.go {
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 10px; padding: 6px 12px;
          cursor: pointer; font-size: .82em; font-family: inherit;
          transition: filter .15s ease, border-color .15s ease;
        }
        button.go:hover { filter: brightness(1.05); border-color: var(--primary-color); }
        .overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .dialog {
          position: relative; width: 420px; max-width: 94vw;
          max-height: 88vh; overflow-y: auto;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 16px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
        }
        .dialog h3 { margin: 0 0 10px; font-size: 1em; }
        .dialog .sub { font-size: .8em; color: var(--secondary-text-color); margin-bottom: 10px; }
        .dialog .warn {
          font-size: .8em; color: var(--warning-color, #b58a00);
          background: var(--secondary-background-color);
          border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
        }
        .secthead {
          font-size: .75em; font-weight: 600; text-transform: uppercase;
          letter-spacing: .04em; color: var(--secondary-text-color);
          margin: 10px 2px 4px;
        }
        .roomrow {
          display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
        }
        .tabs {
          display: flex; gap: 6px; margin-bottom: 10px;
        }
        .tabs .tab {
          flex: 1; border: 1px solid var(--divider-color, #ccc); background: transparent;
          color: var(--primary-text-color, #111); border-radius: 10px;
          padding: 8px 10px; font-size: 13px; cursor: pointer;
        }
        .tabs .tab.active {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color, #03a9f4);
        }
        .gaedit {
          border: 1px solid var(--divider-color, #ccc); background: transparent;
          color: var(--primary-text-color, #111); border-radius: 8px;
          padding: 5px 10px; font-size: 12px; cursor: pointer; flex-shrink: 0;
        }
        .gaedit:hover { border-color: var(--primary-color, #03a9f4); }
        .roomrow label { font-size: .8em; color: var(--secondary-text-color); }
        .roomrow select {
          flex: 1; padding: 7px 9px; border-radius: 10px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color); font-family: inherit; font-size: .85em;
        }
        .opt .cur {
          font-size: .75em; color: var(--primary-color); font-weight: 600;
          margin-left: 4px;
        }
        .opt {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: 10px; cursor: pointer;
          border: 1px solid transparent; font-size: .9em;
        }
        .opts {
          overscroll-behavior: contain; padding-right: 4px;
        }
        .pressrow {
          display: flex; align-items: center; gap: 8px; margin: 8px 0;
        }
        .pressrow label {
          font-size: .8em; color: var(--secondary-text-color);
          width: 118px; flex-shrink: 0;
        }
        .pressrow select {
          flex: 1; padding: 7px 9px; border-radius: 10px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color); font-family: inherit; font-size: .85em;
          min-width: 0;
        }
        .grouplist {
          max-height: min(20vh, 175px); overflow-y: auto;
          overscroll-behavior: contain; padding-right: 4px;
        }
        .opt:hover { background: var(--secondary-background-color); }
        .opt.sel { border-color: var(--primary-color); background: var(--secondary-background-color); }
        .opt .dom { color: var(--secondary-text-color); font-size: .8em; }
        .actions { display: flex; gap: 8px; margin-top: 12px; }
        .actions button {
          flex: 1; border: none; border-radius: 12px; padding: 10px;
          cursor: pointer; font-weight: 600; font-family: inherit; font-size: .9em;
        }
        .save { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .save:disabled { opacity: .45; cursor: not-allowed; }
        .cancel { background: var(--secondary-background-color); color: var(--primary-text-color); }
        .close {
          position: absolute; top: 10px; right: 12px;
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color);
          width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; font-size: 1.05em;
          display: flex; align-items: center; justify-content: center;
          padding: 0; line-height: 1;
        }
      </style>
      <ha-card>
        ${(this._config.entities || []).length > 6 ? `
        <div class="search">
          <ha-icon icon="mdi:magnify"></ha-icon>
          <input type="text" placeholder="${esc(this._t("gw_search"))}" value="${esc(this._filter)}">
        </div>` : ""}
        ${rows.join("")}
      </ha-card>
      <div class="overlay" style="display:none"></div>
    `;
    this.renderRoot.querySelectorAll("button.go").forEach((btn) => {
      btn.addEventListener("click", () => this._openDialog(btn.dataset.entity));
    });
    const search = this.renderRoot.querySelector(".search input");
    if (search) {
      search.addEventListener("input", () => {
        this._filter = search.value;
        const pos = search.selectionStart;
        this._render();
        const again = this.renderRoot.querySelector(".search input");
        if (again) {
          again.focus();
          again.setSelectionRange(pos, pos);
        }
      });
    }
  }

  _openDialog(entityId) {
    this._open = true;
    if (!this._gas && !this._gaLoading) this._fetchGas();
    const overlay = this.renderRoot.querySelector(".overlay");
    overlay.style.display = "flex";
    const current = this._linked(entityId);
    const st = this._hass && this._hass.states[entityId];
    const extended = !!(st && st.attributes && st.attributes.has_extended_actions);
    const outputs = this._candidateOutputs();
    const currentRoom = this._roomOf(entityId);

    // Rooms that actually contain candidate outputs.
    const rooms = [...new Set(outputs.map((eid) => this._roomOf(eid)).filter(Boolean))];
    let roomFilter = currentRoom && rooms.includes(currentRoom) ? currentRoom : "all";

    const renderOpts = () => {
      const list = roomFilter === "all"
        ? outputs
        : outputs.filter((eid) => this._roomOf(eid) === roomFilter);
      return list
        .map((eid) => {
          const sel = current !== null && eid === current;
          return `
          <div class="opt ${sel ? "sel" : ""}" data-entity="${eid}">
            <div>
              <div>${esc(this._friendly(eid))}${eid.startsWith("cover.") ? ' <span class="cur">' + this._t("screen_label") + "</span>" : ""}${sel ? ' <span class="cur">' + this._t("currently_linked") + "</span>" : ""}</div>
              <div class="dom">${eid}</div>
            </div>
          </div>`;
        })
        .join("") || `<div class="sub">${this._t("no_outputs")}</div>`;
    };

    const roomOptions = [];
    if (currentRoom) {
      roomOptions.push(`<option value="${currentRoom}">${esc(this._areaName(currentRoom))}</option>`);
    }
    roomOptions.push(`<option value="all">${this._t("all_rooms")}</option>`);
    for (const r of rooms) {
      if (r !== currentRoom) {
        roomOptions.push(`<option value="${r}">${esc(this._areaName(r))}</option>`);
      }
    }

    overlay.innerHTML = `
      <div class="dialog">
        <button class="close">&times;</button>
        <h3>${esc(this._friendly(entityId))}</h3>
        <div class="sub">${this._t("link_hint")}</div>
        <div class="tabs">
          <button class="tab tabout active">${this._t("tab_output")}</button>
          <button class="tab tabauto">${this._t("tab_automation")}</button>
        </div>
        <div class="roomrow">
          <label>${this._t("room")}</label>
          <select class="roomsel">${roomOptions.join("")}</select>
        </div>
        <div class="opts">${renderOpts()}</div>
        <div class="actions">
          <button class="cancel">${t(this._lang, "cancel")}</button>
          <button class="save" ${extended && current === null ? "disabled" : ""}>${t(this._lang, "save_link")}</button>
        </div>
      </div>`;

    let mode = "output";
    const gaIdAttr = st && st.attributes ? st.attributes.linked_group_action_id : undefined;
    // Decode the current basic_actions into per-slot selections: which
    // automation runs on a short press and which on a long press.
    let currentShort = null;
    let currentLong = null;
    let currentGAs = new Set();
    if (extended && st && st.attributes && st.attributes.basic_actions) {
      const t = String(st.attributes.basic_actions).split(",").map(Number);
      if (t.length === 8 && t[0] >= 207 && t[0] <= 211 && t[2] === 236) {
        // Combined form: 207,<long>,236,0,2,<short>,236,255
        currentLong = t[1];
        currentShort = t[5];
      } else if (t.length === 6 && t[0] === 236 && t[2] === 2) {
        currentShort = t[3];
      } else {
        for (let i = 0; i + 1 < t.length; i += 2) {
          if (t[i] === 2) currentShort = t[i + 1];
          else if (t[i] >= 207 && t[i] <= 211) currentLong = t[i + 1];
        }
      }
    }
    if (currentShort === null && currentLong === null && gaIdAttr !== undefined) {
      currentShort = gaIdAttr;
    }
    if (currentShort !== null) currentGAs.add(currentShort);
    if (currentLong !== null) currentGAs.add(currentLong);
    let selectedShort = currentShort;
    let selectedLong = currentLong;
    // Open on the Automation tab when the button currently triggers one.
    const initialMode = (currentShort !== null || currentLong !== null)
      ? "automation"
      : "output";
    const roomRow = overlay.querySelector(".roomrow");
    const tabsHost = overlay.querySelector(".tabs");
    const setMode = (m) => {
      mode = m;
      tabsHost.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      tabsHost.querySelector(m === "output" ? ".tabout" : ".tabauto").classList.add("active");
      roomRow.style.display = m === "output" ? "" : "none";
      if (m === "output") {
        selectedShort = null;
        selectedLong = null;
        this._dialogRefresh = null;
        optsHost.innerHTML = renderOpts();
        wireOpts();
        selected = null;
        if (current !== null) {
          selected = outputs.includes(current) ? current : null;
        }
      } else {
        selected = null;
        optsHost.innerHTML = renderGAs();
        wireGAs();
        // Preload the editor module so the first Edit click is instant.
        import("/renson_smartliving/renson-smartliving-automation-editor.js").catch(() => {});
        // Re-render when the group actions fetch completes while open.
        this._dialogRefresh = () => {
          optsHost.innerHTML = renderGAs();
          wireGAs();
          syncSave();
        };
      }
      syncSave();
    };
    tabsHost.querySelector(".tabout").addEventListener("click", () => setMode("output"));
    tabsHost.querySelector(".tabauto").addEventListener("click", () => setMode("automation"));

    const gas = this._gas || [];
    const gaOptions = (slot, includeNew) => {
      const sel = slot === "short" ? selectedShort : selectedLong;
      const opts = [];
      opts.push(`<option value="none" ${sel === null ? "selected" : ""}>${this._t("no_automation")}</option>`);
      if (includeNew) {
        opts.push(`<option value="new" ${sel === "new" ? "selected" : ""}>${this._t("new_automation")}</option>`);
      }
      for (const g of gas.filter((g) => g.actions)) {
        const cur = (slot === "short" ? currentShort : currentLong) === g.id;
        opts.push(`<option value="${g.id}" ${sel === g.id ? "selected" : ""}>${esc((g.name || "#" + g.id) + (cur ? " ✓" : ""))}</option>`);
      }
      return opts.join("");
    };
    const renderGAs = () => {
      const warn = currentGAs.size > 1
        ? `<div class="warn">${this._t("multi_automation_warning")}</div>` : "";
      return `
        <div class="pressrow">
          <label>${this._t("press_short")}</label>
          <select class="selslot" data-slot="short">${gaOptions("short", true)}</select>
          <button class="gaedit" data-slot="short" ${selectedShort === "new" || selectedShort === null ? "disabled style='opacity:.4'" : ""}>${this._t("edit")}</button>
        </div>
        ${selectedShort === "new" ? `<input type="text" class="ganame" maxlength="16"
              placeholder="${this._t("new_automation_name")}"
              style="width:100%;box-sizing:border-box;margin:2px 0 8px;padding:7px 9px;border:1px solid var(--divider-color,#ccc);border-radius:8px;font-size:13px;background:var(--card-background-color,#fff);color:inherit">` : ""}
        ${warn}
        <div class="pressrow">
          <label>${this._t("press_long")}</label>
          <select class="selslot" data-slot="long">${gaOptions("long", false)}</select>
          <button class="gaedit" data-slot="long" ${selectedLong === null ? "disabled style='opacity:.4'" : ""}>${this._t("edit")}</button>
        </div>`;
    };
    const wireGAs = () => {
      optsHost.querySelectorAll("select.selslot").forEach((sel) => {
        sel.addEventListener("change", () => {
          const slot = sel.dataset.slot;
          const v = sel.value;
          const val = v === "new" ? "new" : (v === "none" ? null : Number(v));
          if (slot === "short") selectedShort = val;
          else selectedLong = val;
          if (slot === "short" && val === "new") {
            // Re-render so the name input appears, then focus it.
            optsHost.innerHTML = renderGAs();
            wireGAs();
            const inp = optsHost.querySelector(".ganame");
            if (inp) inp.focus();
          } else {
            // Refresh the Edit-button enabled states.
            optsHost.innerHTML = renderGAs();
            wireGAs();
          }
          syncSave();
        });
      });
      optsHost.querySelectorAll("button.gaedit").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const slot = b.dataset.slot;
          const v = slot === "short" ? selectedShort : selectedLong;
          if (typeof v === "number") this._openAutomationEditor(v);
        });
      });
    };

    let selected = null;
    // Pre-select the currently linked output (even when filtered out of view).
    if (current !== null) {
      selected = outputs.includes(current) ? current : null;
    }
    const saveBtn = overlay.querySelector(".save");
    const syncSave = () => {
      // Unlinking an extended input would erase its gateway actions.
      if (mode === "automation") {
        saveBtn.disabled = extended && selectedShort === null && selectedLong === null;
      } else {
        saveBtn.disabled = extended && !selected;
      }
    };
    syncSave();
    const optsHost = overlay.querySelector(".opts");
    const wireOpts = () => {
      optsHost.querySelectorAll(".opt").forEach((el) => {
        el.addEventListener("click", () => {
          optsHost.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
          el.classList.add("sel");
          selected = el.dataset.entity;
          syncSave();
        });
      });
    };
    wireOpts();
    overlay.querySelector(".roomsel").value = roomFilter;
    overlay.querySelector(".roomsel").addEventListener("change", (e) => {
      roomFilter = e.target.value;
      optsHost.innerHTML = renderOpts();
      wireOpts();
      syncSave();
    });
    setMode(initialMode);
    const close = () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
      this._open = false;
      this._dialogRefresh = null;
    };
    overlay.querySelector(".close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".cancel").addEventListener("click", close);
    overlay.querySelector(".save").addEventListener("click", async () => {
      const serviceData = { entity_id: [entityId] };
      if (mode === "automation") {
        if (selectedShort === "new") {
          const nameInput = optsHost.querySelector(".ganame");
          const name = nameInput ? nameInput.value.trim() : "";
          const used = new Set((this._gas || []).map((g) => g.id));
          let id = 0;
          while (used.has(id) && id < 256) id++;
          await this._hass.callService("renson_smartliving", "save_group_action", {
            id, name, actions: "", show_in_app: true,
          });
          serviceData.group_action_id = id;
          this._gas = null; // refetch so rows show the new automation
        } else if (selectedShort !== null) {
          serviceData.group_action_id = selectedShort;
        }
        if (selectedLong !== null) {
          serviceData.group_action_id_long = selectedLong;
        }
      } else if (selected) {
        serviceData.output_entity = selected;
      }
      if (extended) serviceData.force = true;
      await this._hass.callService("renson_smartliving", "set_input_link", serviceData);
      close();
      if (this._gas === null) await this._fetchGas();
      this._render();
    });
  }

  /* Open the automation editor dialog for one group action. The editor card
     is loaded as a module and hosted off-screen; its overlay is position:fixed
     so the dialog shows over everything. The editor opens IMMEDIATELY with
     the data we already fetched (no wait); when it closes, refresh. */
  async _openAutomationEditor(gaId) {
    try {
      await import("/renson_smartliving/renson-smartliving-automation-editor.js");
    } catch (err) { return; }
    const C = customElements.get("renson-smartliving-automation-editor");
    if (!C) return;
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;overflow:visible;";
    document.body.appendChild(host);
    const ed = document.createElement("renson-smartliving-automation-editor");
    host.appendChild(ed);
    ed.setConfig({});
    if (this._gaResp) {
      // Inject our fresh data so the editor opens instantly with names.
      ed._data = this._gaResp;
    }
    ed.hass = this._hass;
    ed.style.cssText = "position:fixed;top:0;left:-10000px;width:0;height:0;";
    const ga = ((ed._data && ed._data.actions) || []).find((g) => g.id === gaId);
    if (ga) ed._openEditor(ga);
    else ed._openNew();
    const overlay = ed.renderRoot.querySelector(".overlay");
    const mo = new MutationObserver(() => {
      if (overlay.style.display === "none") {
        mo.disconnect();
        host.remove();
        this._gas = null;
        this._fetchGas();
      }
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ["style"] });
  }

  _gaSummary(ga) {
    const pairs = ga.actions ? ga.actions.split(",").map(Number) : [];
    const parts = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i], n = pairs[i + 1];
      if (a === 240) {
        parts.push({ 0: "IF", 1: "AND", 2: "OR", 10: "THEN", 20: "ELSE", 255: "END IF" }[n] || "?");
      } else if (a === 2) parts.push(this._t("runs_automation", { name: this._gaName(n) }));
      else if (a === 243) parts.push("#" + n + " on?");
      else if (a === 244) parts.push("#" + n + " off?");
      else if (a === 241) parts.push("btn #" + n);
      else if (a === 242) parts.push("!btn #" + n);
      else if (a === 160) parts.push("#" + n + " off");
      else if (a === 161) parts.push("#" + n + " on");
      else if (a === 162) parts.push("#" + n + " toggle");
      else if (a === 165) parts.push("#" + n + " on min");
      else if (a === 166) parts.push("#" + n + " on max");
      else if (a >= 176 && a <= 184) parts.push("#" + n + " on " + (a - 175) * 10 + "%");
      else if (a >= 185 && a <= 194) parts.push("#" + n + " toggle " + (a - 184) * 10 + "%");
      else if (a >= 195 && a <= 200) parts.push("#" + n + " on " + [2.5, 7.5, 15, 25, 37, 52][a - 195] + "m");
      else if (a >= 201 && a <= 206) parts.push("#" + n + " on " + [2.5, 7.5, 15, 25, 37, 52][a - 201] + "m*");
      else if (a === 103) parts.push(this._t("ba_shutter_toggle", { name: this._shutterName(n) }));
      else if (a === 108) parts.push(this._t("ba_shutter_up_toggle", { name: this._shutterName(n) }));
      else if (a === 109) parts.push(this._t("ba_shutter_down_toggle", { name: this._shutterName(n) }));
      else if (a === 68) parts.push("press btn #" + n);
      else if (a === 69) parts.push("release btn #" + n);
      else parts.push("BA " + a + "," + n);
    }
    return parts.join(" · ") || "(empty)";
  }

}

customElements.define("renson-smartliving-input-link-card", RensonInputLinkCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-input-link-card",
  name: "Renson Input Link Card",
  description: "Link OpenMotics inputs (buttons) to outputs by clicking them",
});
