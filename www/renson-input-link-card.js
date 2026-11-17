/**
 * Renson input link card: shows the inputs (buttons) of a room and lets you
 * link an input directly to an output on the OpenMotics gateway by clicking it.
 *
 * A linked input toggles its output on press, on the gateway itself, even
 * without Home Assistant running (the link is written to the gateway config).
 *
 * Config:
 *   type: custom:renson-input-link-card
 *   entities: [event.keuken_keuken_kant_deur_1_4, ...]   (required)
 *   outputs:  [light.keuken_inbouwspots, ...]            (optional; defaults to
 *              all OpenMotics lights/switches in the same area as the inputs)
 */
import { t } from "./renson-i18n.js?v=9";

class RensonInputLinkCard extends HTMLElement {
  static getStubConfig() {
    return { entities: [], outputs: [] };
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || this._lang || "en";
    const sig = this._signature(lang);
    if (sig !== this._lastSig && !this._open) {
      this._lastSig = sig;
      this._lang = lang;
      this._render();
    }
  }

  _signature(lang) {
    // Only re-render when something user-visible changes. Re-rendering on
    // every hass update replaces the DOM mid-click and eats clicks.
    const parts = [lang];
    for (const eid of this._config.entities || []) {
      const st = this._hass && this._hass.states[eid];
      if (!st) { parts.push("missing"); continue; }
      const a = st.attributes || {};
      parts.push(eid, a.linked_output_id === undefined ? "-" : a.linked_output_id,
                 a.linked_output_name || "", a.has_extended_actions ? "x" : "");
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
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._render();
  }

  getCardSize() {
    return Math.max(1, (this._config.entities || []).length);
  }

  _friendly(entityId) {
    const st = this._hass && this._hass.states[entityId];
    if (!st) return entityId;
    let name = st.attributes.friendly_name || entityId;
    // Strip the "Smart Living Controller (host)" device prefix HA adds.
    return name.replace(/^Smart Living Controller \([^)]*\)\s*/, "");
  }

  _linked(entityId) {
    const st = this._hass && this._hass.states[entityId];
    if (!st || !st.attributes || st.attributes.linked_output_id === undefined) {
      return null;
    }
    return {
      id: st.attributes.linked_output_id,
      name: st.attributes.linked_output_name,
    };
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

  _outputIdOf(entityId) {
    const st = this._hass && this._hass.states[entityId];
    const attrId = st && st.attributes && st.attributes.openmotics_id;
    if (attrId !== undefined) return Number(attrId);
    const reg = this._hass && this._hass.entities && this._hass.entities[entityId];
    const uid = reg && reg.unique_id;
    if (!uid) return null;
    const m = String(uid).match(/_output_(\d+)_/);
    return m ? Number(m[1]) : null;
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
    const rows = this._config.entities.map((eid) => {
      const linked = this._linked(eid);
      const st = this._hass && this._hass.states[eid];
      const extended = !!(st && st.attributes && st.attributes.has_extended_actions);
      const linkText = linked
        ? this._t("linked_to", { name: linked.name || ("output " + linked.id) })
        : extended
          ? this._t("gateway_automation")
          : this._t("not_linked");
      return `
        <div class="row" data-entity="${eid}">
          <div class="info">
            <div class="name">${this._friendly(eid)}</div>
            <div class="link ${linked ? "on" : ""}">${linkText}</div>
          </div>
          <button class="go" data-entity="${eid}">${this._t("link")}</button>
        </div>`;
    });
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: 12px 14px;
          background: var(--card-background-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          border: 1px solid var(--divider-color, rgba(0,0,0,.1));
        }
        .row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 0; gap: 10px;
        }
        .row + .row { border-top: 1px solid var(--divider-color, rgba(0,0,0,.06)); }
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
        .roomrow {
          display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
        }
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
        }
      </style>
      <ha-card>
        ${rows.join("")}
      </ha-card>
      <div class="overlay" style="display:none"></div>
    `;
    this.renderRoot.querySelectorAll("button.go").forEach((btn) => {
      btn.addEventListener("click", () => this._openDialog(btn.dataset.entity));
    });
  }

  _openDialog(entityId) {
    this._open = true;
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

    const selectedId = current ? current.id : null;

    const renderOpts = () => {
      const list = roomFilter === "all"
        ? outputs
        : outputs.filter((eid) => this._roomOf(eid) === roomFilter);
      return list
        .map((eid) => {
          const sel = selectedId !== null && this._outputIdOf(eid) === selectedId;
          return `
          <div class="opt ${sel ? "sel" : ""}" data-entity="${eid}">
            <div>
              <div>${this._friendly(eid)}${eid.startsWith("cover.") ? ' <span class="cur">' + this._t("screen_label") + "</span>" : ""}${sel ? ' <span class="cur">' + this._t("currently_linked") + "</span>" : ""}</div>
              <div class="dom">${eid}</div>
            </div>
          </div>`;
        })
        .join("") || `<div class="sub">${this._t("no_outputs")}</div>`;
    };

    const roomOptions = [];
    if (currentRoom) {
      roomOptions.push(`<option value="${currentRoom}">${this._areaName(currentRoom)}</option>`);
    }
    roomOptions.push(`<option value="all">${this._t("all_rooms")}</option>`);
    for (const r of rooms) {
      if (r !== currentRoom) {
        roomOptions.push(`<option value="${r}">${this._areaName(r)}</option>`);
      }
    }

    overlay.innerHTML = `
      <div class="dialog">
        <button class="close">&times;</button>
        <h3>${this._friendly(entityId)}</h3>
        <div class="sub">${this._t("link_hint")}</div>
        ${extended ? `<div class="warn">${this._t("extended_warning")}</div>` : ""}
        <div class="roomrow">
          <label>${this._t("room")}</label>
          <select class="roomsel">${roomOptions.join("")}</select>
        </div>
        <div class="opts">${renderOpts()}</div>
        <div class="actions">
          <button class="cancel">${t(this._lang, "cancel")}</button>
          <button class="save" ${extended && selectedId === null ? "disabled" : ""}>${t(this._lang, "save_link")}</button>
        </div>
      </div>`;

    let selected = null;
    // Pre-select the currently linked output (even when filtered out of view).
    if (selectedId !== null) {
      const match = outputs.find((eid) => this._outputIdOf(eid) === selectedId);
      if (match) selected = match;
    }
    const saveBtn = overlay.querySelector(".save");
    const syncSave = () => {
      // Unlinking an extended input would erase its gateway actions.
      saveBtn.disabled = extended && !selected;
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
    const close = () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
      this._open = false;
    };
    overlay.querySelector(".close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".cancel").addEventListener("click", close);
    overlay.querySelector(".save").addEventListener("click", async () => {
      const serviceData = { entity_id: [entityId] };
      if (selected) serviceData.output_entity = selected;
      if (extended) serviceData.force = true;
      await this._hass.callService("renson_smartliving", "set_input_link", serviceData);
      close();
      this._render();
    });
  }

  _omIdOf(entityId) {
    return this._outputIdOf(entityId);
  }
}

customElements.define("renson-input-link-card", RensonInputLinkCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-input-link-card",
  name: "Renson Input Link Card",
  description: "Link OpenMotics inputs (buttons) to outputs by clicking them",
});
