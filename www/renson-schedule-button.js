/**
 * Renson schedule button: opens the thermostat schedule editor popup.
 *
 * Config:
 *   type: custom:renson-schedule-button
 *   entity: climate.praktijk
 */
import { t } from "./renson-i18n.js?v=8";

class RensonScheduleButton extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || "en";
    if (lang !== this._lang) {
      this._lang = lang;
      if (!this._open) this._renderShell();
    }
    if (this._open && this._editor) this._editor.hass = hass;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._renderShell();
  }

  getCardSize() {
    return 1;
  }

  _renderShell() {
    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        button {
          width: 100%;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 12px; padding: 10px 14px;
          cursor: pointer; font-size: .9em; font-weight: 600;
          font-family: inherit; transition: filter .15s ease, border-color .15s ease;
        }
        button:hover { filter: brightness(1.05); border-color: var(--primary-color); }
        .overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .dialog {
          position: relative; width: 440px; max-width: 94vw;
          max-height: 92vh; overflow-y: auto;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 8px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
        }
        .close {
          position: absolute; top: 10px; right: 12px; z-index: 2;
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color);
          width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; font-size: 1.05em;
        }
      </style>
      <button>${t(this._lang, "configure_schedule")}</button>
      <div class="overlay" style="display:none">
        <div class="dialog">
          <button class="close">&times;</button>
          <div class="editor-host"></div>
        </div>
      </div>
    `;
    this.renderRoot.querySelector("button").addEventListener("click", () => {
      this._open = true;
      const overlay = this.renderRoot.querySelector(".overlay");
      const host = this.renderRoot.querySelector(".editor-host");
      if (!this._editor) {
        this._editor = document.createElement("renson-thermostat-config-card");
        this._editor.setConfig({ entity: this._config.entity });
        host.appendChild(this._editor);
      }
      if (this._hass) this._editor.hass = this._hass;
      overlay.style.display = "flex";
    });
    const overlay = this.renderRoot.querySelector(".overlay");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.style.display = "none";
        this._open = false;
      }
    });
    this.renderRoot.querySelector(".close").addEventListener("click", () => {
      overlay.style.display = "none";
      this._open = false;
    });
  }
}

customElements.define("renson-schedule-button", RensonScheduleButton);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-schedule-button",
  name: "Renson Schedule Button",
  description: "Opens the OpenMotics thermostat schedule editor in a popup",
});
