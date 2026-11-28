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

const QUICK_HOURS = [1, 2, 4, 8, 12, 14];

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
    const attrs = entity ? entity.attributes || {} : {};
    const temp = attrs.temperature;
    const preset = attrs.preset_mode;
    if (
      temp !== undefined &&
      prevTemp !== undefined &&
      Number(temp) !== Number(prevTemp) &&
      preset === "none" &&
      !this._dialog
    ) {
      // Mogelijke race: bij een preset-klik kan de temperatuur-update
      // vóór de preset-update binnenkomen. Kort uitstellen en
      // hervalideren: alleen popup als de override blijft staan.
      clearTimeout(this._pendingTimer);
      const expected = Number(temp);
      this._pendingTimer = setTimeout(() => {
        const e = this._hass && this._hass.states[this._config.entity];
        const a = e ? e.attributes || {} : {};
        if (
          !this._dialog &&
          a.preset_mode === "none" &&
          a.temperature !== undefined &&
          Number(a.temperature) === expected
        ) {
          this._askOverride(expected);
        }
      }, 1500);
    } else if (preset && preset !== "none") {
      clearTimeout(this._pendingTimer);
    }
    this._lastTemp = temp;
  }

  getCardSize() {
    return 5;
  }

  _askOverride(temperature, prefill) {
    const hours = this._defaultHours();
    // slots: eindtijden op schone halve uren (:00/:30), tot 24h vooruit
    const base = new Date();
    base.setSeconds(0, 0);
    base.setMinutes(base.getMinutes() < 30 ? 30 : 60);
    const slots = [];
    for (let k = 0; k < 48; k++) {
      const t = new Date(base.getTime() + k * 1800000);
      if (t - Date.now() > 14400000 * 6) break;
      slots.push(t);
    }
    // default: huidige expiratie (prefill) of de geconfigureerde duur;
    // kies de dichtstbijzijnde slot
    let target = prefill && prefill.until
      ? this._todayAt(prefill.until).getTime()
      : (this._hass && this._hass.states[this._config.entity]
          && this._hass.states[this._config.entity].attributes
          ? this._hass.states[this._config.entity].attributes.override_expiration
          : null);
    if (!target) {
      target = Date.now() + hours * 3600000;
    }
    let idx = 0;
    let best = Infinity;
    slots.forEach((t, i) => {
      const diff = Math.abs(t.getTime() - Number(target));
      if (diff < best) { best = diff; idx = i; }
    });
    this._slots = slots;
    this._dialog = {
      temperature,
      idx,
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
      } else {
        const slot = (this._slots || [])[d.idx];
        if (!slot) return;
        payload.until = this._fmtClock(slot);
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

  _renderDialog() {
    const d = this._dialog;
    const slots = this._slots || [];
    if (!d || !slots.length) return;
    const lang = this._lang;
    const fmtDur = (ms) => {
      const mins = Math.max(1, Math.round(ms / 60000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return (h ? h + t(lang, "hour_unit") : "") +
        (m ? (h ? " " : "") + m + t(lang, "min_unit") : "");
    };
    // boven: klok-labels op hele uren; onder: duur-markeringen (1h, 2h, ...)
    const N = slots.length;
    const timeticks = [];
    const durticks = [];
    slots.forEach((t, i) => {
      const left = (i / (N - 1)) * 100;
      if (t.getMinutes() === 0) {
        timeticks.push(`<span class="timetick" style="left:${left}%">${t.getHours()}${t(lang, "hour_unit")}</span>`);
      }
      const durH = (t.getTime() - Date.now()) / 3600000;
      if (Math.abs(durH - Math.round(durH)) < 2 / 60 && Math.round(durH) >= 1) {
        durticks.push(`<span class="tick" style="left:${left}%">${Math.round(durH)}${t(lang, "hour_unit")}</span>`);
      }
    });
    const slot = slots[d.idx];
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="overlay">
        <div class="dialog">
          <button class="close" type="button">&times;</button>
          <h3>${t(lang, "override_title")}</h3>
          <div class="hint">${t(lang, "override_hint", {
            temp: d.temperature.toFixed(1).replace(/\.0$/, ""),
            end: this._fmtClock(slot),
          })}</div>
          <div class="durlabel"></div>
          <div class="sliderwrap">
            <ha-icon class="rowicon" icon="mdi:clock-outline"></ha-icon>
            <div class="timeticks">${timeticks.join("")}</div>
            <span class="rowspacer"></span>
            <input type="range" class="dur" min="0" max="${N - 1}" step="1" value="${d.idx}">
            <ha-icon class="rowicon" icon="mdi:timer-outline"></ha-icon>
            <div class="ticks">${durticks.join("")}</div>
          </div>
          <div class="row">
            <label>${t(lang, "override_until")}</label>
            <input type="time" class="until" value="${this._fmtClock(slot)}">
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
    const label = overlay.querySelector(".durlabel");
    const untilInput = overlay.querySelector(".until");
    const syncLabel = () => {
      const slot = slots[d.idx];
      const dur = slot.getTime() - Date.now();
      label.textContent = `${this._fmtClock(slot)} (${fmtDur(dur)})`;
      untilInput.value = this._fmtClock(slot);
    };
    overlay.querySelector(".dur").addEventListener("input", (e) => {
      d.idx = Number(e.target.value);
      d.permanent = false;
      overlay.querySelector(".perm").checked = false;
      syncLabel();
    });
    untilInput.addEventListener("change", (e) => {
      const v = e.target.value;
      if (!v) return;
      // dichtstbijzijnde slot bij de gekozen tijd
      const target = this._todayAt(v).getTime();
      let best = Infinity;
      slots.forEach((t, i) => {
        const diff = Math.abs(t.getTime() - target);
        if (diff < best) { best = diff; d.idx = i; }
      });
      d.permanent = false;
      overlay.querySelector(".perm").checked = false;
      overlay.querySelector(".dur").value = d.idx;
      syncLabel();
    });
    overlay.querySelector(".perm").addEventListener("change", (e) => {
      d.permanent = e.target.checked;
    });
    syncLabel();
    overlay.querySelector(".apply").addEventListener("click", () => this._closeDialog(true));
  }

  _todayAt(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    const now = new Date();
    now.setHours(h || 0, m || 0, 0, 0);
    return now;
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
          position: relative; width: 640px; max-width: 94vw;
          background: var(--card-background-color, #fff);
          border-radius: 18px; padding: 18px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35);
          color: var(--primary-text-color);
        }
        .dialog h3 { margin: 0 0 6px; font-size: 1.05em; }
        .dialog .hint { font-size: .8em; color: var(--secondary-text-color); margin-bottom: 12px; }
        .dialog .durlabel {
          font-size: .95em; font-weight: 700; margin-bottom: 6px;
        }
        .dialog .sliderwrap {
          display: grid; grid-template-columns: 22px 1fr; column-gap: 6px;
          align-items: center; margin: 4px 0 14px;
        }
        .dialog .rowicon {
          --mdc-icon-size: 16px;
          color: var(--secondary-text-color);
        }
        .dialog .rowicon[icon="mdi:timer-outline"] {
          position: relative; top: -5px;
        }
        .dialog .rowspacer { display: block; }
        .dialog input[type="range"] {
          width: 100%; accent-color: var(--primary-color);
          cursor: pointer;
        }
        .dialog .timeticks {
          position: relative; height: 14px;
          font-size: .58em; color: var(--primary-text-color);
          font-weight: 600;
        }
        .dialog .timetick {
          position: absolute; transform: translateX(-50%);
          top: 0;
        }
        .dialog .ticks {
          position: relative; height: 14px;
          font-size: .58em; color: var(--secondary-text-color);
        }
        .dialog .tick {
          position: absolute; transform: translateX(-50%);
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
      if (!pill._wired) {
        pill._wired = true;
        pill.style.cursor = "pointer";
        pill.title = t(this._lang, "override_title");
        pill.addEventListener("click", () => {
          const e = this._hass && this._hass.states[this._config.entity];
          if (!e || !e.attributes) return;
          const temp = Number(e.attributes.temperature);
          const exp2 = e.attributes.override_expiration;
          const d2 = exp2 ? new Date(exp2) : null;
          const prefill = d2 && !isNaN(d2.getTime())
            ? { until: this._fmtClock(d2) } : {};
          if (Number.isFinite(temp)) this._askOverride(temp, prefill);
        });
      }
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
