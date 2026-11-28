/**
 * Renson screen timings button: opens a small dialog to edit the travel
 * timers (timer_up / timer_down) of an OpenMotics shutter.
 *
 * Reads the timer_up / timer_down entity attributes exposed by the
 * renson_smartliving cover and saves via the
 * renson_smartliving.set_shutter_timings service.
 *
 * Config:
 *   type: custom:renson-smartliving-screen-timings-button
 *   entity: cover.keuken_screen_keuken
 */
import { t } from "./renson-smartliving-common.js?v=0.2.4";

class RensonScreenTimingsButton extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || "en";
    if (lang !== this._lang) {
      this._lang = lang;
      this._renderShell();
    }
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._lang = this._lang || "en";
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._renderShell();
  }

  getCardSize() {
    return 1;
  }

  _t(key) {
    return t(this._lang, key);
  }

  _renderShell() {
    if (!this.renderRoot) return;
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        button.open {
          width: 100%;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 12px; padding: 10px 14px;
          cursor: pointer; font-size: .9em; font-weight: 600;
          font-family: inherit;
          transition: filter .15s ease, border-color .15s ease;
        }
        button.open:hover { filter: brightness(1.05); border-color: var(--primary-color); }
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
      <button class="open">${this._t("screen_timings")}</button>
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
    this.renderRoot.querySelector("button.open").addEventListener("click", () => {
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

customElements.define("renson-smartliving-screen-timings-button", RensonScreenTimingsButton);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-screen-timings-button",
  name: "Renson Screen Timings Button",
  description: "Edit the travel timers of an OpenMotics shutter",
});
