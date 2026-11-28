/**
 * Renson climate card: the native HA thermostat card plus an
 * Auto / Away / Manual preset switch underneath. The active preset is
 * highlighted and follows the entity state live (attributes.preset_mode:
 * "auto", "away" or "none" for manual/override).
 *
 * Config:
 *   type: custom:renson-smartliving-climate-card
 *   entity: climate.keuken
 *   features: []            # optional, forwarded to the native card
 */
import { t } from "./renson-smartliving-common.js";

const PRESETS = [
  { ha: "auto", key: "auto" },
  { ha: "away", key: "away" },
  { ha: "none", key: "manual" },
];

class RensonClimateCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "" };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity");
    }
    this._config = config;
    this._lang = this._lang || "en";
    this._tileConfig = {
      type: "thermostat",
      entity: config.entity,
      features: config.features || [],
    };
    this._tile = null;
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || "en";
    if (lang !== this._lang && this.renderRoot) {
      this._lang = lang;
      this._renderPresets();
    }
    this._lang = lang;
    if (this._tile) {
      this._tile.hass = hass;
    }
    this._renderPresets();
  }

  getCardSize() {
    return 5;
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
        :host { display: block; }
        .tilehost { display: block; }
        .presets {
          margin-top: 8px; display: flex; gap: 4px;
          background: var(--secondary-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 12px; padding: 3px;
        }
        .presets button {
          flex: 1; border: none; background: transparent;
          color: var(--primary-text-color);
          border-radius: 9px; padding: 7px 0;
          cursor: pointer; font-size: .82em; font-weight: 600;
          font-family: inherit; transition: background .15s ease, color .15s ease;
        }
        .presets button.active {
          background: var(--primary-color); color: var(--text-on-primary, #fff);
        }
        .presets button:not(.active):hover { filter: brightness(1.05); }
      </style>
      <div class="tilehost"></div>
      <div class="presets">
        ${PRESETS.map((p) => `<button data-preset="${p.ha}"></button>`).join("")}
      </div>
    `;
    this.renderRoot.querySelectorAll(".preset").forEach(() => {});
    this.renderRoot.querySelectorAll(".presets button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!this._hass) return;
        this._hass.callService("climate", "set_preset_mode", {
          entity_id: this._config.entity,
          preset_mode: btn.dataset.preset,
        });
      });
    });
    this._ensureTile();
    this._renderPresets();
  }

  _activePreset() {
    if (!this._hass || !this._config) return "none";
    const entity = this._hass.states[this._config.entity];
    if (!entity) return null;
    const mode = (entity.attributes || {}).preset_mode;
    return mode === "auto" || mode === "away" ? mode : "none";
  }

  _renderPresets() {
    if (!this.renderRoot) return;
    const active = this._activePreset();
    this.renderRoot.querySelectorAll(".presets button").forEach((btn) => {
      const preset = btn.dataset.preset;
      btn.classList.toggle("active", preset === active);
      const p = PRESETS.find((x) => x.ha === preset);
      btn.textContent = t(this._lang, p.key);
    });
  }
}

customElements.define("renson-smartliving-climate-card", RensonClimateCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-climate-card",
  name: "Renson Climate Card",
  description: "Native thermostat card with an Auto/Away/Manual preset switch",
});
