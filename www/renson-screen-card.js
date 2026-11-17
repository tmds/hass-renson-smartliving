/**
 * Renson screen card: the native HA tile card (with the cover position
 * slider and open/close/stop buttons) plus a small timer button in the
 * top-right corner. Clicking the timer button opens a dialog to edit the
 * shutter travel timers via renson_smartliving.set_shutter_timings.
 *
 * Config:
 *   type: custom:renson-screen-card
 *   entity: cover.keuken_screen_keuken
 */
import { t } from "./renson-i18n.js?v=8";

class RensonScreenCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  _t(key) {
    return t(this._lang, key);
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._lang = this._lang || "en";
    this._tileConfig = {
      type: "tile",
      entity: config.entity,
      features: config.features || [
        { type: "cover-open-close" },
        { type: "cover-position" },
      ],
    };
    this._tile = null;
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || "en";
    const langChanged = lang !== this._lang;
    this._lang = lang;
    if (this._tile) {
      this._tile.hass = hass;
    }
    if (langChanged && this.renderRoot) {
      // tooltip en knoplabels herschrijven bij taalwissel
      const btn = this.renderRoot.querySelector(".timerbtn");
      if (btn) btn.title = this._t("configure_timings");
      const save = this.renderRoot.querySelector(".save");
      if (save) save.textContent = this._t("save");
    }
  }

  getCardSize() {
    return 3;
  }

  async _ensureTile() {
    if (this._tile) return;
    const helpers = await window.loadCardHelpers();
    this._tile = helpers.createCardElement(this._tileConfig);
    if (this._hass) this._tile.hass = this._hass;
    this._tile.addEventListener("ll-rebuild", () => {
      this._tile = null;
      this._ensureTile().then(() => this._render());
    });
    const host = this.renderRoot.querySelector(".tilehost");
    if (host) host.appendChild(this._tile);
  }

  _render() {
    if (!this.renderRoot) return;
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; }
        .tilehost { display: block; }
        .timerbtn {
          position: absolute; top: 8px; right: 10px; z-index: 3;
          display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          cursor: pointer; padding: 0;
          transition: color .15s ease, border-color .15s ease;
        }
        .timerbtn:hover { color: var(--primary-color); border-color: var(--primary-color); }
        .timerbtn ha-icon { --mdc-icon-size: 16px; }
        .overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .dialog {
          position: relative; width: 380px; max-width: 94vw;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 20px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
          font-family: inherit;
        }
        .close {
          position: absolute; top: 10px; right: 12px;
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color);
          width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; font-size: 1.05em;
        }
        h3 { margin: 0 0 14px; font-size: 1.05em; }
        label {
          display: block; font-size: .78em; font-weight: 600;
          color: var(--secondary-text-color); margin: 12px 0 4px;
        }
        input {
          width: 100%; box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 10px; padding: 10px 12px;
          font-size: 1em; background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }
        .row { margin-top: 18px; }
        .save {
          display: block; width: 100%; box-sizing: border-box;
          border: none; border-radius: 14px; padding: 14px;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
          font-weight: 700; cursor: pointer; font-size: 1em; font-family: inherit;
        }
        .saved {
          display: block; text-align: center; margin-top: 10px;
          font-size: .85em; color: var(--primary-color); font-weight: 600;
        }
        .saved:empty { display: none; }
      </style>
      <div class="tilehost"></div>
      <button class="timerbtn" title="${this._t("configure_timings")}">
        <ha-icon icon="mdi:timer-outline"></ha-icon>
      </button>
      <div class="overlay" style="display:none">
        <div class="dialog">
          <button class="close">&times;</button>
          <h3>${this._t("screen_timings")}</h3>
          <label>${this._t("timer_up")}</label>
          <input class="up" type="number" min="0" max="255" step="1">
          <label>${this._t("timer_down")}</label>
          <input class="down" type="number" min="0" max="255" step="1">
          <div class="row">
            <button class="save">${this._t("save")}</button>
            <span class="saved"></span>
          </div>
        </div>
      </div>
    `;
    this._ensureTile();
    this.renderRoot.querySelector(".timerbtn").addEventListener("click", () => {
      const state = this._hass.states[this._config.entity];
      const attrs = (state && state.attributes) || {};
      this.renderRoot.querySelector(".up").value =
        attrs.timer_up !== undefined && attrs.timer_up !== null ? attrs.timer_up : "";
      this.renderRoot.querySelector(".down").value =
        attrs.timer_down !== undefined && attrs.timer_down !== null ? attrs.timer_down : "";
      this.renderRoot.querySelector(".saved").textContent = "";
      this.renderRoot.querySelector(".overlay").style.display = "flex";
    });
    const overlay = this.renderRoot.querySelector(".overlay");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
    this.renderRoot.querySelector(".close").addEventListener("click", () => {
      overlay.style.display = "none";
    });
    this.renderRoot.querySelector(".save").addEventListener("click", async () => {
      const data = { entity_id: this._config.entity };
      const up = this.renderRoot.querySelector(".up").value;
      const down = this.renderRoot.querySelector(".down").value;
      if (up !== "") data.timer_up = Number(up);
      if (down !== "") data.timer_down = Number(down);
      await this._hass.callService(
        "renson_smartliving", "set_shutter_timings", data
      );
      this.renderRoot.querySelector(".saved").textContent = this._t("timings_saved");
      setTimeout(() => { overlay.style.display = "none"; }, 900);
    });
  }
}

customElements.define("renson-screen-card", RensonScreenCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-screen-card",
  name: "Renson Screen Card",
  description: "Native cover tile with a travel-timer configuration button",
});
