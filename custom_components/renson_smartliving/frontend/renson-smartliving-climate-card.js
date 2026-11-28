/**
 * Renson climate card: the native HA thermostat card plus an
 * Auto / Away / Manual preset switch underneath, and an "until when?"
 * dialog whenever the temperature is changed manually.
 *
 * The dialog asks how long the override should last (default: the
 * configured preset_expiration_hours, with the computed end time),
 * with quick hour choices, an explicit until-time and a permanent
 * option. Applying it calls renson_smartliving.set_thermostat_override.
 *
 * Config:
 *   type: custom:renson-smartliving-climate-card
 *   entity: climate.keuken
 *   features: []            # optional, forwarded to the native card
 */
import { t } from "./renson-smartliving-common.js?v=2";

const PRESETS = [
  { ha: "auto", key: "auto" },
  { ha: "away", key: "away" },
  { ha: "none", key: "manual" },
];

const QUICK_HOURS = [1, 2, 4, 8];

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
    const prevTemp = this._lastTemp;
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
    // Handmatige temperatuurwijziging (via de +/- knoppen van de native
    // card, die hun service via de lovelace API-context sturen en dus
    // niet te intercepten zijn): zodra de setpoint verandert, vraag de
    // "tot wanneer?"-popup. De wijziging is dan al toegepast met de
    // default expiration; de popup past die nadien aan.
    const entity = hass.states[this._config.entity];
    const temp = entity && entity.attributes
      ? entity.attributes.temperature : undefined;
    if (
      temp !== undefined &&
      prevTemp !== undefined &&
      Number(temp) !== Number(prevTemp) &&
      !this._dialog
    ) {
      this._askOverride(Number(temp));
    }
    this._lastTemp = temp;
  }

  getCardSize() {
    return 5;
  }

  _askOverride(temperature) {
    const hours = this._defaultHours();
    this._dialog = {
      temperature,
      mode: "hours",
      hours,
      until: this._fmtClock(new Date(Date.now() + hours * 3600000)),
      permanent: false,
    };
    this._renderDialog();
  }

  _closeDialog(apply) {
    const d = this._dialog;
    const overlay = this.renderRoot.querySelector(".overlay");
    if (overlay) overlay.remove();
    this._dialog = null;
    if (apply && d && this._hass) {
      const payload = {
        entity_id: this._config.entity,
        temperature: d.temperature,
      };
      if (d.permanent) {
        payload.permanent = true;
      } else if (d.mode === "until") {
        payload.until = d.until;
      } else {
        payload.hours = d.hours;
      }
      this._hass.callService("renson_smartliving", "set_thermostat_override", payload);
    }
  }

  _defaultHours() {
    const entity = this._hass && this._hass.states[this._config.entity];
    const h = entity && entity.attributes
      ? Number(entity.attributes.preset_expiration_hours)
      : NaN;
    return Number.isFinite(h) && h > 0 ? h : 2;
  }

  _fmtClock(d) {
    return String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
  }

  _askOverride(temperature, realHass) {
    const hours = this._defaultHours();
    this._dialog = {
      temperature,
      mode: "hours",
      hours,
      until: this._fmtClock(new Date(Date.now() + hours * 3600000)),
      permanent: false,
    };
    this._renderDialog();
    return new Promise((resolve) => {
      this._dialogResolve = () => {
        this._dialogResolve = null;
        resolve();
      };
    });
  }

  _closeDialog(apply) {
    const d = this._dialog;
    const overlay = this.renderRoot.querySelector(".overlay");
    if (overlay) overlay.remove();
    this._dialog = null;
    if (apply && d && this._hass) {
      const payload = {
        entity_id: this._config.entity,
        temperature: d.temperature,
      };
      if (d.permanent) {
        payload.permanent = true;
      } else if (d.mode === "until") {
        payload.until = d.until;
      } else {
        payload.hours = d.hours;
      }
      this._hass.callService("renson_smartliving", "set_thermostat_override", payload);
    }
    if (this._dialogResolve) this._dialogResolve();
  }

  _renderDialog() {
    const d = this._dialog;
    if (!d) return;
    const lang = this._lang;
    const quick = QUICK_HOURS.map((h) => {
      const end = this._fmtClock(new Date(Date.now() + h * 3600000));
      const active = d.mode === "hours" && d.hours === h;
      return `<button type="button" class="chip ${active ? "active" : ""}" data-hours="${h}">
        ${h}${t(lang, "hour_unit")} (${end})</button>`;
    }).join("");
    const defEnd = this._fmtClock(new Date(Date.now() + d.hours * 3600000));
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="overlay">
        <div class="dialog">
          <button class="close" type="button">&times;</button>
          <h3>${t(lang, "override_title")}</h3>
          <div class="hint">${t(lang, "override_hint", {
            temp: d.temperature.toFixed(1).replace(/\.0$/, ""),
            end: defEnd,
          })}</div>
          <div class="chips">${quick}</div>
          <div class="row">
            <label>${t(lang, "override_until")}</label>
            <input type="time" class="until" value="${d.until}">
          </div>
          <div class="row">
            <label>${t(lang, "override_permanent")}</label>
            <input type="checkbox" class="perm">
          </div>
          <button class="apply" type="button">${t(lang, "override_apply")}</button>
        </div>
      </div>
    `;
    this.renderRoot.appendChild(host.firstElementChild);
    const overlay = this.renderRoot.querySelector(".overlay");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this._closeDialog(false);
    });
    overlay.querySelector(".close").addEventListener("click", () => this._closeDialog(false));
    overlay.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        d.mode = "hours";
        d.hours = Number(chip.dataset.hours);
        d.permanent = false;
        overlay.querySelector(".perm").checked = false;
        overlay.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
      });
    });
    overlay.querySelector(".until").addEventListener("change", (e) => {
      d.mode = "until";
      d.until = e.target.value || d.until;
      d.permanent = false;
      overlay.querySelector(".perm").checked = false;
      overlay.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    });
    overlay.querySelector(".perm").addEventListener("change", (e) => {
      d.permanent = e.target.checked;
    });
    overlay.querySelector(".apply").addEventListener("click", () => this._closeDialog(true));
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
        .until-pill {
          margin-top: 6px; padding: 6px 12px;
          border-radius: 10px;
          background: var(--primary-color);
          color: var(--text-on-primary, #fff);
          font-size: .8em; font-weight: 600;
          text-align: center;
        }
        .overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .dialog {
          position: relative; width: 360px; max-width: 94vw;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 18px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
          color: var(--primary-text-color);
        }
        .dialog h3 { margin: 0 0 6px; font-size: 1.05em; }
        .dialog .hint { font-size: .8em; color: var(--secondary-text-color); margin-bottom: 12px; }
        .dialog .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
        .dialog .chip {
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 10px; padding: 7px 10px;
          cursor: pointer; font-size: .82em; font-weight: 600; font-family: inherit;
        }
        .dialog .chip.active {
          background: var(--primary-color); color: var(--text-on-primary, #fff);
          border-color: var(--primary-color);
        }
        .dialog .row {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 10px; font-size: .9em;
        }
        .dialog input[type="time"] {
          border: 1px solid var(--divider-color); border-radius: 8px;
          padding: 6px 8px; background: var(--secondary-background-color);
          color: var(--primary-text-color); font-family: inherit;
        }
        .dialog .apply {
          margin-top: 6px; width: 100%;
          border: none; border-radius: 12px; padding: 10px 14px;
          background: var(--primary-color); color: var(--text-on-primary, #fff);
          cursor: pointer; font-size: .9em; font-weight: 600; font-family: inherit;
        }
        .dialog .close {
          position: absolute; top: 10px; right: 12px;
          border: none; background: var(--secondary-background-color);
          color: var(--primary-text-color);
          width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; font-size: 1.05em;
        }
      </style>
      <div class="tilehost"></div>
      <div class="presets">
        ${PRESETS.map((p) => `<button data-preset="${p.ha}"></button>`).join("")}
      </div>
      <div class="until-pill" style="display:none"></div>
    `;
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
    // "manual until <tijd>"-pill bij een actieve override
    const pill = this.renderRoot.querySelector(".until-pill");
    if (!pill) return;
    const entity = this._hass && this._hass.states[this._config.entity];
    const exp = entity && entity.attributes
      ? entity.attributes.override_expiration : null;
    if (active === "none" && exp) {
      const d = new Date(exp);
      const when = isNaN(d.getTime())
        ? String(exp)
        : this._fmtClock(d);
      pill.textContent = t(this._lang, "gw_manual_until", { time: when });
      pill.style.display = "";
    } else {
      pill.style.display = "none";
    }
  }
}

customElements.define("renson-smartliving-climate-card", RensonClimateCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-smartliving-climate-card",
  name: "Renson Climate Card",
  description: "Native thermostat card with a preset switch and an override dialog",
});
