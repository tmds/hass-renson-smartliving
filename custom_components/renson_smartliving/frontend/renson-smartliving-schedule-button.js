/**
 * Renson schedule button: opens the thermostat schedule editor popup.
 *
 * Uses the shared dialog (same look as the gateway configuration card).
 *
 * Config:
 *   type: custom:renson-smartliving-schedule-button
 *   entity: climate.praktijk
 */
import { t, openDialog } from "./renson-smartliving-common.js?v=0.2.3";

class RensonScheduleButton extends HTMLElement {
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
    if (this._overlay && this._overlay.isConnected && this._editor) {
      this._editor.hass = hass;
    }
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    if (!this.renderRoot) {
      this.renderRoot = this.attachShadow({ mode: "open" });
    }
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
      </style>
      <button>${t(this._lang, "configure_schedule")}</button>
    `;
    this.renderRoot.querySelector("button").addEventListener("click", () => {
      const overlay = openDialog(this, { title: t(this._lang, "configure_schedule"), bodyHTML: "" });
      const body = overlay.querySelector(".dlg-body");
      body.style.padding = "0 0 8px";
      this._editor = document.createElement("renson-smartliving-thermostat-config-card");
      this._editor.setConfig({ entity: this._config.entity, embedded: true });
      if (this._hass) this._editor.hass = this._hass;
      body.appendChild(this._editor);
      this._overlay = overlay;
      // Keep the editor's hass fresh while the dialog is open.
      this._refreshTimer = setInterval(() => {
        if (!overlay.isConnected) {
          clearInterval(this._refreshTimer);
          this._overlay = null;
          return;
        }
        if (this._hass) this._editor.hass = this._hass;
      }, 1000);
    });
  }
}

customElements.define("renson-smartliving-schedule-button", RensonScheduleButton);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-schedule-button",
  name: "Renson Schedule Button",
  description: "Opens the OpenMotics thermostat schedule editor in a popup",
});
