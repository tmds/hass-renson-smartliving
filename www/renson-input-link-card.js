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
import { t } from "./renson-i18n.js?v=5";

class RensonInputLinkCard extends HTMLElement {
  static getStubConfig() {
    return { entities: [], outputs: [] };
  }

  set hass(hass) {
    this._hass = hass;
    this._lang = (hass.locale && hass.locale.language) || this._lang || "en";
    if (!this._open) this._render();
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
    // Fallback: OpenMotics lights/switches in the same area as the first input.
    const hass = this._hass;
    if (!hass || !hass.entities) return [];
    const first = this._config.entities[0];
    const areaId = hass.entities[first] && hass.entities[first].area_id;
    if (!areaId) return [];
    return Object.keys(hass.entities).filter((eid) => {
      const info = hass.entities[eid];
      const domain = eid.split(".")[0];
      return (
        info.area_id === areaId &&
        (domain === "light" || domain === "switch") &&
        hass.states[eid]
      );
    });
  }

  _render() {
    const lang = this._lang || "en";
    const rows = this._config.entities.map((eid) => {
      const linked = this._linked(eid);
      const linkText = linked
        ? this._t("linked_to", { name: linked.name || ("output " + linked.id) })
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
    const current = this._linked(entityId);
    const st = this._hass && this._hass.states[entityId];
    const extended = !!(st && st.attributes && st.attributes.has_extended_actions);
    const outputs = this._candidateOutputs();
    const opts = outputs
      .map((eid) => {
        const sel = current && current.id !== null && this._omIdOf(eid) === current.id;
        return `
          <div class="opt ${sel ? "sel" : ""}" data-entity="${eid}">
            <div>
              <div>${this._friendly(eid)}</div>
              <div class="dom">${eid}</div>
            </div>
          </div>`;
      })
      .join("");
    overlay.innerHTML = `
      <div class="dialog">
        <button class="close">&times;</button>
        <h3>${this._friendly(entityId)}</h3>
        <div class="sub">${this._t("link_hint")}</div>
        ${extended ? `<div class="warn">${this._t("extended_warning")}</div>` : ""}
        <div class="opts">${opts || `<div class="sub">${this._t("no_outputs")}</div>`}</div>
        <div class="actions">
          <button class="cancel">${t(this._lang, "cancel")}</button>
          <button class="save">${t(this._lang, "save_link")}</button>
        </div>
      </div>`;
    let selected = null;
    overlay.querySelectorAll(".opt").forEach((el) => {
      el.addEventListener("click", () => {
        overlay.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
        el.classList.add("sel");
        selected = el.dataset.entity;
      });
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
    const st = this._hass && this._hass.states[entityId];
    if (!st) return null;
    // OpenMotics entity unique_ids contain "<device>-output-<id>-...".
    const reg = this._hass.entities && this._hass.entities[entityId];
    const uid = reg && reg.unique_id;
    if (!uid) return null;
    const m = String(uid).match(/_output_(\d+)_/);
    return m ? Number(m[1]) : null;
  }
}

customElements.define("renson-input-link-card", RensonInputLinkCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-input-link-card",
  name: "Renson Input Link Card",
  description: "Link OpenMotics inputs (buttons) to outputs by clicking them",
});
