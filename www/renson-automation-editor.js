/**
 * Renson automation editor card: view, edit, create and trigger the
 * gateway's own automations (group actions) from Home Assistant.
 *
 * The gateway stores automations as classic bytecode: comma-separated
 * (action_type, action_number) pairs. This card decodes the supported
 * subset into friendly steps, and encodes edits back. Unsupported
 * opcodes lock editing (the gateway silently DROPS unknown action
 * types on save, so writing them back would corrupt the automation).
 *
 * Config:
 *   type: custom:renson-automation-editor
 *   title: (optional heading)
 */
import { t } from "./renson-i18n.js?v=15";

/* ------------------------------------------------------------------ */
/* Bytecode codec (mirrors gateway GroupActionMapper, fw 3.9.9)        */
/* ------------------------------------------------------------------ */

const TIMERS = [
  { min: 2.5, over: 195, keep: 201 },
  { min: 7.5, over: 196, keep: 202 },
  { min: 15, over: 197, keep: 203 },
  { min: 25, over: 198, keep: 204 },
  { min: 37, over: 199, keep: 205 },
  { min: 52, over: 200, keep: 206 },
];

function encodeStep(s) {
  switch (s.kind) {
    case "output":
      if (s.op === "on") return [161, s.id];
      if (s.op === "off") return [160, s.id];
      if (s.op === "toggle") return [162, s.id];
      if (s.op === "on_min") return [165, s.id];
      if (s.op === "on_max") return [166, s.id];
      if (s.op === "dim_min") return [169, s.id];
      if (s.op === "dim_max") return [170, s.id];
      if (s.op === "on_dim") {
        if (s.dim >= 100) return [166, s.id];
        return [176 + Math.round(s.dim / 10) - 1, s.id];
      }
      if (s.op === "toggle_dim") {
        return [185 + Math.round(s.dim / 10) - 1, s.id];
      }
      if (s.op === "on_timer") {
        const tm = TIMERS.find((x) => x.min === s.timer);
        return [(s.overrule ? tm.over : tm.keep), s.id];
      }
      return null;
    case "shutter":
      if (s.op === "up") return [100, s.id];
      if (s.op === "down") return [101, s.id];
      if (s.op === "stop") return [102, s.id];
      if (s.op === "toggle") return [103, s.id];
      if (s.op === "group_up") return [104, s.id];
      if (s.op === "group_down") return [105, s.id];
      if (s.op === "group_stop") return [106, s.id];
      if (s.op === "group_toggle") return [107, s.id];
      if (s.op === "up_stop_up") return [108, s.id];
      if (s.op === "down_stop_down") return [109, s.id];
      if (s.op === "group_up_stop_up") return [110, s.id];
      if (s.op === "group_down_stop_down") return [111, s.id];
      return null;
    case "if": return [240, 0];
    case "and": return [240, 1];
    case "or": return [240, 2];
    case "then": return [240, 10];
    case "else": return [240, 20];
    case "endif": return [240, 255];
    case "cond":
      if (s.what === "output_on") return [243, s.id];
      if (s.what === "output_off") return [244, s.id];
      if (s.what === "input_on") return [241, s.id];
      if (s.what === "input_off") return [242, s.id];
      if (s.what === "bit_on") return [245, s.id];
      if (s.what === "bit_off") return [246, s.id];
      return null;
    case "all_off": return [s.lights_only ? 163 : 164, 255];
    case "virtual_input": return [s.op === "press" ? 68 : 69, s.id];
    case "input_enable": return [s.disable ? 116 : 117, s.id];
    case "bit":
      if (s.op === "set") return [237, s.id];
      if (s.op === "clear") return [238, s.id];
      return [239, s.id];
    case "run_action": return [2, s.id];
    default:
      return null;
  }
}

function encode(steps) {
  const pairs = [];
  for (const s of steps) {
    const p = encodeStep(s);
    if (!p) throw new Error("unencodable step " + s.kind);
    pairs.push(p[0], p[1]);
  }
  return pairs.join(",");
}

/** Decode pairs into steps. Unknown opcodes become {kind:"raw"}. */
function decode(pairs) {
  const steps = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i], n = pairs[i + 1];
    let s = null;
    if (a === 240) {
      const kw = { 0: "if", 1: "and", 2: "or", 10: "then", 20: "else", 255: "endif" }[n];
      s = kw ? { kind: kw } : null;
    } else if (a === 160) s = { kind: "output", op: "off", id: n };
    else if (a === 161) s = { kind: "output", op: "on", id: n };
    else if (a === 162) s = { kind: "output", op: "toggle", id: n };
    else if (a === 165) s = { kind: "output", op: "on_min", id: n };
    else if (a === 166) s = { kind: "output", op: "on_max", id: n };
    else if (a === 169) s = { kind: "output", op: "dim_min", id: n };
    else if (a === 170) s = { kind: "output", op: "dim_max", id: n };
    else if (a >= 176 && a <= 184) s = { kind: "output", op: "on_dim", dim: (a - 175) * 10, id: n };
    else if (a >= 185 && a <= 194) s = { kind: "output", op: "toggle_dim", dim: (a - 184) * 10, id: n };
    else if (a >= 195 && a <= 200) s = { kind: "output", op: "on_timer", timer: TIMERS[a - 195].min, overrule: true, id: n };
    else if (a >= 201 && a <= 206) s = { kind: "output", op: "on_timer", timer: TIMERS[a - 201].min, overrule: false, id: n };
    else if (a === 100) s = { kind: "shutter", op: "up", id: n };
    else if (a === 101) s = { kind: "shutter", op: "down", id: n };
    else if (a === 102) s = { kind: "shutter", op: "stop", id: n };
    else if (a === 103) s = { kind: "shutter", op: "toggle", id: n };
    else if (a === 104) s = { kind: "shutter", op: "group_up", id: n };
    else if (a === 105) s = { kind: "shutter", op: "group_down", id: n };
    else if (a === 106) s = { kind: "shutter", op: "group_stop", id: n };
    else if (a === 107) s = { kind: "shutter", op: "group_toggle", id: n };
    else if (a === 108) s = { kind: "shutter", op: "up_stop_up", id: n };
    else if (a === 109) s = { kind: "shutter", op: "down_stop_down", id: n };
    else if (a === 110) s = { kind: "shutter", op: "group_up_stop_up", id: n };
    else if (a === 111) s = { kind: "shutter", op: "group_down_stop_down", id: n };
    else if (a === 243) s = { kind: "cond", what: "output_on", id: n };
    else if (a === 244) s = { kind: "cond", what: "output_off", id: n };
    else if (a === 241) s = { kind: "cond", what: "input_on", id: n };
    else if (a === 242) s = { kind: "cond", what: "input_off", id: n };
    else if (a === 245) s = { kind: "cond", what: "bit_on", id: n };
    else if (a === 246) s = { kind: "cond", what: "bit_off", id: n };
    else if (a === 163) s = { kind: "all_off", lights_only: true };
    else if (a === 164) s = { kind: "all_off", lights_only: false };
    else if (a === 68) s = { kind: "virtual_input", op: "press", id: n };
    else if (a === 69) s = { kind: "virtual_input", op: "release", id: n };
    else if (a === 116) s = { kind: "input_enable", disable: true, id: n };
    else if (a === 117) s = { kind: "input_enable", disable: false, id: n };
    else if (a === 237) s = { kind: "bit", op: "set", id: n };
    else if (a === 238) s = { kind: "bit", op: "clear", id: n };
    else if (a === 239) s = { kind: "bit", op: "toggle", id: n };
    else if (a === 2) s = { kind: "run_action", id: n };
    if (!s) s = { kind: "raw", a, n };
    steps.push(s);
  }
  return steps;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

class RensonAutomationEditor extends HTMLElement {
  static getStubConfig() {
    return { title: "" };
  }

  constructor() {
    super();
    this._lang = "en";
    this._data = null; // {actions, outputs, shutters, inputs}
    this._loading = false;
    this._error = null;
    this._open = false;
  }

  set hass(hass) {
    this._hass = hass;
    const lang = (hass.locale && hass.locale.language) || this._lang || "en";
    const count = this._data && this._data.actions ? this._data.actions.length : "-";
    const sig = "editor" + lang + count;
    if (sig !== this._lastSig && !this._open) {
      this._lastSig = sig;
      this._lang = lang;
      if (!this._data && !this._loading) this._load();
      else if (this.renderRoot) this._render();
    }
    // The coordinator syncs its device name maps shortly AFTER HA start; if
    // the card loaded before that, retry until the name maps arrive.
    if (
      this._data && !(this._data.outputs || []).length && !this._loading
      && Date.now() > (this._retryAt || 0)
    ) {
      this._retryAt = Date.now() + 10000;
      this._load();
    }
  }

  setConfig(config) {
    this._config = config || {};
    this.renderRoot = this.attachShadow({ mode: "open" });
    this._render();
  }

  getCardSize() { return 4; }

  _t(key, params) { return t(this._lang, key, params); }

  async _load() {
    this._loading = true;
    this._error = null;
    try {
      const raw = await this._hass.callService(
        "renson_smartliving", "get_group_actions", {}, undefined, undefined, true
      );
      // callService resolves to {context, response} when returnResponse is set
      const resp = raw && raw.response ? raw.response : raw;
      if (!resp || !Array.isArray(resp.actions)) {
        this._error = "Unexpected service response"
            + (resp ? ": " + JSON.stringify(resp).slice(0, 200) : " (null)");
        this._data = null;
      } else {
        this._data = resp;
      }
    } catch (err) {
      this._error = String(err && err.message ? err.message : err);
    }
    this._loading = false;
    this._render();
  }

  /* ---- name maps ---- */

  _nameMap(list) {
    const m = {};
    for (const item of (list || [])) m[item.id] = item.name || "";
    return m;
  }
  get _outputs() { return this._nameMap(this._data && this._data.outputs); }
  get _shutters() { return this._nameMap(this._data && this._data.shutters); }
  get _inputs() { return this._nameMap(this._data && this._data.inputs); }
  _devName(map, id) {
    const n = map[id];
    return n ? n : (id === undefined ? "?" : "#" + id);
  }

  /* ---- step rendering ---- */

  _stepText(s) {
    const t = (k, p) => this._t(k, p);
    switch (s.kind) {
      case "output":
        if (s.op === "on") return t("out_on", { name: this._devName(this._outputs, s.id) });
        if (s.op === "off") return t("out_off", { name: this._devName(this._outputs, s.id) });
        if (s.op === "toggle") return t("out_toggle", { name: this._devName(this._outputs, s.id) });
        if (s.op === "on_min") return t("out_on_min", { name: this._devName(this._outputs, s.id) });
        if (s.op === "on_max") return t("out_on_max", { name: this._devName(this._outputs, s.id) });
        if (s.op === "dim_min") return t("out_dim_min", { name: this._devName(this._outputs, s.id) });
        if (s.op === "dim_max") return t("out_dim_max", { name: this._devName(this._outputs, s.id) });
        if (s.op === "on_dim") return t("out_on_dim", { name: this._devName(this._outputs, s.id), dim: s.dim });
        if (s.op === "toggle_dim") return t("out_toggle_dim", { name: this._devName(this._outputs, s.id), dim: s.dim });
        if (s.op === "on_timer") return t("out_on_timer", {
          name: this._devName(this._outputs, s.id), timer: s.timer,
          over: s.overrule ? t("timer_overrule") : t("timer_keep"),
        });
        return "?";
      case "shutter": {
        const group = s.op.startsWith("group_");
        const base = group ? s.op.slice(6) : s.op;
        const name = group ? "#" + s.id : this._devName(this._shutters, s.id);
        return t("shutter_" + base, { name });
      }
      case "if": return t("kw_if");
      case "and": return t("kw_and");
      case "or": return t("kw_or");
      case "then": return t("kw_then");
      case "else": return t("kw_else");
      case "endif": return t("kw_endif");
      case "cond":
        return t("cond_" + s.what, {
          name: s.what.startsWith("output")
            ? this._devName(this._outputs, s.id)
            : s.what.startsWith("input")
              ? this._devName(this._inputs, s.id)
              : "#" + s.id,
        });
      case "all_off":
        return s.lights_only ? t("all_lights_off") : t("all_outputs_off");
      case "virtual_input":
        return t(s.op === "press" ? "virt_press" : "virt_release",
          { name: this._devName(this._inputs, s.id) });
      case "input_enable":
        return t(s.disable ? "input_disable" : "input_enable",
          { name: this._devName(this._inputs, s.id) });
      case "bit":
        return t("bit_" + s.op, { id: s.id });
      case "run_action": {
        const ga = (this._data && this._data.actions || []).find((g) => g.id === s.id);
        return t("run_action", { name: ga && ga.name ? ga.name : "#" + s.id });
      }
      case "raw":
        return t("raw_pair", { a: s.a, n: s.n });
      default:
        return "?";
    }
  }

  _isBlockKeyword(s) {
    return ["if", "and", "or", "then", "else", "endif"].includes(s.kind);
  }

  _summary(ga) {
    const steps = decode(ga.actions ? ga.actions.split(",").map(Number) : []);
    if (!steps.length) return this._t("empty_action");
    const parts = [];
    for (const s of steps) {
      if (this._isBlockKeyword(s)) parts.push(this._t("kw_" + s.kind));
      else parts.push(this._stepText(s));
    }
    return parts.join(" · ");
  }

  _hasUnsupported(ga) {
    return (ga.actions ? ga.actions.split(",").map(Number) : []).some(
      (a, i) => i % 2 === 0 && ![2, 68, 69, 100, 101, 102, 103, 104, 105,
        106, 107, 108, 109, 110, 111, 116, 117,
        160, 161, 162, 163, 164, 165, 166, 169, 170, 171, 172, 173,
        176, 177, 178, 179, 180, 181, 182, 183, 184,
        185, 186, 187, 188, 189, 190, 191, 192, 193, 194,
        195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206,
        237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 254]
        .includes(a)
    );
  }

  /* ---- render ---- */

  _render() {
    if (!this.renderRoot) return;
    const lang = this._lang;
    const data = this._data;
    const rows = data
      ? (data.actions || []).filter((ga) => ga.name || ga.actions).map((ga) => `        <div class="row" data-id="${ga.id}">
          <div class="rowmain">
            <div class="rowname">${ga.name ? this._esc(ga.name) : this._t("unnamed") + " #" + ga.id}
              ${ga.internal ? `<span class="tag warn">${this._t("tag_internal")}</span>` : ""}
              ${this._hasUnsupported(ga) ? `<span class="tag warn">${this._t("tag_unsupported")}</span>` : ""}
            </div>
            <div class="rowsum">${this._esc(this._summary(ga))}</div>
          </div>
          <div class="rowbtns">
            <button class="btn run" data-id="${ga.id}">${this._t("run")}</button>
            <button class="btn edit" data-id="${ga.id}">${this._t("edit")}</button>
          </div>
        </div>`).join("")
      : "";
    const empty = data
      ? `<button class="btn new">${this._t("new_automation")}</button>`
      : "";

    this.renderRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card { background: var(--card-background-color, #fff); border-radius: 12px;
                padding: 14px 16px; color: var(--primary-text-color, #111); }
        h3 { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
        .row { display: flex; align-items: center; gap: 10px; padding: 9px 0;
               border-top: 1px solid var(--divider-color, #eee); }
        .rowmain { flex: 1; min-width: 0; }
        .rowname { font-weight: 600; font-size: 14px; }
        .rowsum { font-size: 12px; opacity: .7; overflow: hidden; text-overflow: ellipsis;
                  white-space: nowrap; }
        .tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; margin-left: 6px;
               background: rgba(255,171,64,.25); }
        .btn { border: none; border-radius: 8px; padding: 7px 12px; cursor: pointer;
               font-size: 13px; background: var(--secondary-background-color, #eee);
               color: var(--primary-text-color, #111); }
        .btn.run { background: var(--accent-color, #03a9f4); color: var(--text-primary-color, #fff); }
        .rowbtns { display: flex; gap: 6px; flex-shrink: 0; }
        .err { color: var(--error-color, #db4437); font-size: 13px; margin: 8px 0; }
        .overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.5);
                   display: none; align-items: center; justify-content: center; }
        .dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color, #111);
                  border-radius: 14px; padding: 18px; width: min(640px, 94vw);
                  max-height: 88vh; overflow: auto; }
        .dialog h3 { margin: 0 0 12px; }
        .dialog input[type=text] { width: 100%; box-sizing: border-box; padding: 9px 10px;
               border: 1px solid var(--divider-color, #ccc); border-radius: 8px; font-size: 14px;
               background: var(--secondary-background-color, #fafafa); color: inherit; }
        .steps { margin: 12px 0; max-height: min(46vh, 420px); overflow-y: auto;
                 overscroll-behavior: contain; padding-right: 4px; }
        .step { display: flex; align-items: center; gap: 6px; padding: 5px 6px;
                font-size: 13px; border-radius: 8px; position: relative; }
        .step + .step { margin-top: 2px; }
        .step .grow { flex: 1; min-width: 0; }
        .step ha-icon { --mdc-icon-size: 18px; flex-shrink: 0;
                        color: var(--secondary-text-color, #888); }
        .actrow { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .actrow .sicon { color: var(--primary-color, #03a9f4); }
        .kwrow { border-left: 3px solid var(--divider-color, #ccc); }
        .kwrow ha-icon { color: inherit; }
        .kwpill { font-weight: 700; font-size: 11px; letter-spacing: .5px;
                  padding: 2px 10px; border-radius: 10px; color: #fff; }
        .kw-if .kwpill { background: #1976d2; }
        .kw-if { border-left-color: #1976d2; }
        .kw-and .kwpill, .kw-or .kwpill { background: #7b1fa2; }
        .kw-and, .kw-or { border-left-color: #7b1fa2; }
        .kw-then .kwpill { background: #388e3c; }
        .kw-then { border-left-color: #388e3c; }
        .kw-else .kwpill { background: #f57c00; }
        .kw-else { border-left-color: #f57c00; }
        .kw-endif .kwpill { background: var(--secondary-text-color, #888); }
        .kw-endif { border-left-color: var(--secondary-text-color, #888); }
        .kw-if, .kw-and, .kw-or { color: var(--primary-text-color, #111); }
        .kwrow ha-icon { color: var(--primary-text-color, #111); }
        .mini { border: none; background: transparent; cursor: pointer; font-size: 14px;
                color: var(--secondary-text-color, #888); padding: 2px 5px; border-radius: 6px; }
        .mini:hover { background: var(--secondary-background-color, #eee); }
        .addrow { margin: 10px 0; }
        select, .dialog select { padding: 7px 8px; border-radius: 8px; font-size: 13px;
               border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff);
               color: inherit; max-width: 100%; }
        .warnbox { background: rgba(255,171,64,.15); border-radius: 8px; padding: 8px 10px;
                   font-size: 12px; margin: 8px 0; }
        .actions { display: flex; gap: 8px; margin-top: 14px; }
        .actions .btn.primary { background: var(--primary-color, #03a9f4);
                                color: var(--text-primary-color, #fff); flex: 1; }
        .msg { color: var(--error-color, #db4437); font-size: 12px; margin-top: 8px; min-height: 14px; }
        .new { margin-top: 10px; }
      </style>
      <div class="card">
        <h3>${this._esc(this._config.title || this._t("editor_title"))}</h3>
        ${this._error ? `<div class="err">${this._esc(this._error)}</div>` : ""}
        ${this._loading && !data ? `<div class="rowsum">${this._t("loading")}</div>` : rows}
        ${empty}
      </div>
      <div class="overlay"></div>
    `;

    for (const b of this.renderRoot.querySelectorAll(".row .run")) {
      b.addEventListener("click", () => this._run(Number(b.dataset.id)));
    }
    for (const b of this.renderRoot.querySelectorAll(".row .edit")) {
      b.addEventListener("click", () => {
        const ga = (this._data.actions || []).find((g) => g.id === Number(b.dataset.id));
        if (ga) this._openEditor(ga);
      });
    }
    const nb = this.renderRoot.querySelector(".new");
    if (nb) nb.addEventListener("click", () => this._openNew());
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async _run(id) {
    try {
      await this._hass.callService("renson_smartliving", "run_group_action", { id });
    } catch (err) {
      alert(String(err && err.message ? err.message : err));
    }
  }

  /* ---- editor dialog ---- */

  _openEditor(ga) {
    this._open = true;
    const steps = decode(ga.actions ? ga.actions.split(",").map(Number) : []);
    const locked = steps.some((s) => s.kind === "raw");
    this._dialog(ga, steps, locked);
  }

  _openNew() {
    this._open = true;
    const used = new Set(((this._data && this._data.actions) || [])
      .filter((g) => g.name || g.actions).map((g) => g.id));
    let id = 0;
    while (used.has(id) && id < 256) id++;
    this._dialog({ id, name: "", internal: false, show_in_app: true, actions: "" },
      [], false);
  }

  _dialog(ga, steps, locked) {
    const overlay = this.renderRoot.querySelector(".overlay");
    overlay.style.display = "flex";

    const KW_META = {
      if: { icon: "mdi:code-if", cls: "kw-if" },
      and: { icon: "mdi:code-equal", cls: "kw-and" },
      or: { icon: "mdi:code-braces", cls: "kw-or" },
      then: { icon: "mdi:arrow-right-thick", cls: "kw-then" },
      else: { icon: "mdi:debug-step-over", cls: "kw-else" },
      endif: { icon: "mdi:code-not-equal-variant", cls: "kw-endif" },
    };

    const STEP_ICON = (s) => {
      switch (s.kind) {
        case "output":
          if (s.op === "off") return "mdi:lightbulb-off";
          if (s.op === "on") return "mdi:lightbulb-on";
          if (s.op === "toggle") return "mdi:lightbulb";
          if (s.op === "on_timer") return "mdi:timer-outline";
          if (s.op === "dim_min" || s.op === "dim_max") return "mdi:lightbulb-outline";
          return "mdi:lightbulb-on-60";
        case "shutter":
          if (s.op === "up") return "mdi:arrow-up-bold-box-outline";
          if (s.op === "down") return "mdi:arrow-down-bold-box-outline";
          if (s.op === "stop") return "mdi:stop-circle-outline";
          return "mdi:swap-vertical";
        case "cond":
          return s.what.startsWith("input") ? "mdi:gesture-tap-button" : "mdi:eye-outline";
        case "all_off": return "mdi:lightbulb-group-off-outline";
        case "virtual_input": return "mdi:gesture-tap";
        case "input_enable": return "mdi:button-cursor";
        case "bit": return "mdi:flag-outline";
        case "run_action": return "mdi:play-circle-outline";
        case "raw": return "mdi:alert-octagon-outline";
        default: return "mdi:help-circle-outline";
      }
    };

    let renderDev = null;

    const renderSteps = () => {
      const list = this.renderRoot.querySelector(".steps");
      // Recompute indentation from the CURRENT steps (add/move/delete change
      // the block structure).
      const depths = [];
      let openIfs = 0;
      for (const s of steps) {
        if (s.kind === "if") { depths.push(openIfs); openIfs++; }
        else if (s.kind === "and" || s.kind === "or") depths.push(openIfs);
        else if (s.kind === "then" || s.kind === "else") depths.push(Math.max(0, openIfs - 1));
        else if (s.kind === "endif") { openIfs = Math.max(0, openIfs - 1); depths.push(openIfs); }
        else depths.push(openIfs);
      }
      list.innerHTML = steps.map((s, i) => {
        const kw = KW_META[s.kind];
        const depth = depths[i] || 0;
        if (kw) {
          return `
        <div class="step kwrow ${kw.cls}" style="padding-left:${depth * 18}px" data-i="${i}">
          <ha-icon icon="${kw.icon}"></ha-icon>
          <span class="kwpill">${this._esc(this._stepText(s))}</span>
          <span class="grow"></span>
          <button class="mini up" data-i="${i}" title="up">&#8593;</button>
          <button class="mini dn" data-i="${i}" title="down">&#8595;</button>
          <button class="mini del" data-i="${i}" title="remove">&#10005;</button>
        </div>`;
        }
        return `
        <div class="step actrow" style="padding-left:${(depth + 1) * 18}px" data-i="${i}">
          <ha-icon class="sicon" icon="${STEP_ICON(s)}"></ha-icon>
          <span class="grow">${this._esc(this._stepText(s))}</span>
          <button class="mini up" data-i="${i}" title="up">&#8593;</button>
          <button class="mini dn" data-i="${i}" title="down">&#8595;</button>
          <button class="mini del" data-i="${i}" title="remove">&#10005;</button>
        </div>`;
      }).join("") || `<div class="rowsum">${this._t("no_steps")}</div>`;
      for (const b of list.querySelectorAll(".up")) b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; renderSteps(); }
      });
      for (const b of list.querySelectorAll(".dn")) b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        if (i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; renderSteps(); }
      });
      for (const b of list.querySelectorAll(".del")) b.addEventListener("click", () => {
        steps.splice(Number(b.dataset.i), 1); renderSteps();
      });
      // Grey out add-step options that cannot follow the current sequence.
      const sel = this.renderRoot.querySelector(".addsel");
      if (sel) {
        const allow = _allowedNext(steps);
        const invalid = sel.value && !allow.has(sel.value);
        Array.from(sel.options).forEach((o) => {
          o.disabled = !allow.has(o.value);
        });
        if (invalid && renderDev) { sel.value = ""; renderDev(); }
      }
    };

    function _allowedNext(steps) {
      // Mirrors the gateway IF/THEN/ELSE structure (see group_actions.py):
      // returns the add-menu option values valid after the current steps.
      const stack = [];
      for (const s of steps) {
        if (s.kind === "if") stack.push("if");
        else if (s.kind === "then") { if (stack.length) stack[stack.length - 1] = "then"; }
        else if (s.kind === "else") { if (stack.length) stack[stack.length - 1] = "else"; }
        else if (s.kind === "endif") stack.pop();
      }
      const top = stack[stack.length - 1] || null;
      const allow = new Set();
      const ACTIONS = [
        "output:on", "output:off", "output:toggle", "output:on_dim",
        "output:toggle_dim", "output:on_timer",
        "shutter:up", "shutter:down", "shutter:stop", "shutter:toggle",
        "all_off:lights", "all_off:all",
        "virtual_input:press", "virtual_input:release",
        "bit:set", "bit:clear", "bit:toggle", "run_action",
      ];
      if (!top) {
        allow.add("if");
        ACTIONS.forEach((a) => allow.add(a));
      } else if (top === "if") {
        // Condition region: more conditions, AND/OR between them, THEN closes.
        ["and", "or", "cond:output_on", "cond:output_off",
         "cond:input_on", "cond:input_off", "then"].forEach((k) => allow.add(k));
      } else {
        // Branch body: actions and nested IF; THEN-block also allows ELSE.
        allow.add("endif");
        if (top === "then") allow.add("else");
        allow.add("if");
        ACTIONS.forEach((a) => allow.add(a));
      }
      return allow;
    }

    const devOptions = (map, label) =>
      Object.entries(map).map(([id, name]) =>
        `<option value="${id}">${this._esc(name || "#" + id)}</option>`).join("");

    const addMenuHtml = `
      <div class="addrow">
        <select class="addsel">
          <option value="">+ ${this._t("add_step")}</option>
          <optgroup label="${this._t("cat_output")}">
            <option value="output:on">${this._t("out_on", { name: "" })}</option>
            <option value="output:off">${this._t("out_off", { name: "" })}</option>
            <option value="output:toggle">${this._t("out_toggle", { name: "" })}</option>
            <option value="output:on_dim">${this._t("out_on_dim", { name: "", dim: "" })}</option>
            <option value="output:toggle_dim">${this._t("out_toggle_dim", { name: "", dim: "" })}</option>
            <option value="output:on_timer">${this._t("out_on_timer", { name: "", timer: "", over: "" })}</option>
          </optgroup>
          <optgroup label="${this._t("cat_shutter")}">
            <option value="shutter:up">${this._t("shutter_up", { name: "" })}</option>
            <option value="shutter:down">${this._t("shutter_down", { name: "" })}</option>
            <option value="shutter:stop">${this._t("shutter_stop", { name: "" })}</option>
            <option value="shutter:toggle">${this._t("shutter_toggle", { name: "" })}</option>
          </optgroup>
          <optgroup label="${this._t("cat_condition")}">
            <option value="if">${this._t("kw_if")}</option>
            <option value="and">${this._t("kw_and")}</option>
            <option value="or">${this._t("kw_or")}</option>
            <option value="cond:output_on">${this._t("cond_output_on", { name: "" })}</option>
            <option value="cond:output_off">${this._t("cond_output_off", { name: "" })}</option>
            <option value="cond:input_on">${this._t("cond_input_on", { name: "" })}</option>
            <option value="cond:input_off">${this._t("cond_input_off", { name: "" })}</option>
            <option value="then">${this._t("kw_then")}</option>
            <option value="else">${this._t("kw_else")}</option>
            <option value="endif">${this._t("kw_endif")}</option>
          </optgroup>
          <optgroup label="${this._t("cat_other")}">
            <option value="all_off:lights">${this._t("all_lights_off")}</option>
            <option value="all_off:all">${this._t("all_outputs_off")}</option>
            <option value="virtual_input:press">${this._t("virt_press", { name: "" })}</option>
            <option value="virtual_input:release">${this._t("virt_release", { name: "" })}</option>
            <option value="bit:set">${this._t("bit_set", { id: "" })}</option>
            <option value="bit:clear">${this._t("bit_clear", { id: "" })}</option>
            <option value="bit:toggle">${this._t("bit_toggle", { id: "" })}</option>
            <option value="run_action">${this._t("run_action", { name: "" })}</option>
          </optgroup>
        </select>
        <span class="devwrap"></span>
      </div>`;

    overlay.innerHTML = `
      <div class="dialog">
        <h3>${ga.name ? this._esc(ga.name) : this._t("new_automation")}</h3>
        <label>${this._t("field_name")}</label>
        <input type="text" class="ganame" maxlength="16" value="${this._esc(ga.name || "")}">
        ${locked ? `<div class="warnbox">${this._t("locked_unsupported")}</div>` : ""}
        <div class="steps"></div>
        ${locked ? "" : addMenuHtml}
        <div class="actions">
          <button class="btn close">${this._t("cancel")}</button>
          ${ga.actions ? `<button class="btn runnow">${this._t("run")}</button>` : ""}
          <button class="btn primary save" ${locked ? "disabled" : ""}>${this._t("save")}</button>
        </div>
        <div class="msg"></div>
      </div>`;

    renderSteps();

    if (!locked) {
      const sel = overlay.querySelector(".addsel");
      const devwrap = overlay.querySelector(".devwrap");
      const buildDev = () => {
        const v = sel.value;
        let html = "";
        if (v.startsWith("output:") || v.startsWith("cond:output")) {
          html = `<select class="devsel">${devOptions(this._outputs)}</select>`;
          if (v === "output:on_dim" || v === "output:toggle_dim") {
            html += ` <select class="dimsel">${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
              .map((d) => `<option value="${d}">${d}%</option>`).join("")}</select>`;
          }
          if (v === "output:on_timer") {
            html += ` <select class="timersel">${TIMERS
              .map((x) => `<option value="${x.min}">${x.min} min</option>`).join("")}</select>
              <select class="ovsel"><option value="1">${this._t("timer_overrule")}</option>
              <option value="0">${this._t("timer_keep")}</option></select>`;
          }
        } else if (v.startsWith("shutter:")) {
          html = `<select class="devsel">${devOptions(this._shutters)}</select>`;
        } else if (v.startsWith("cond:input") || v.startsWith("virtual_input:")) {
          html = `<select class="devsel">${devOptions(this._inputs)}</select>`;
        } else if (v === "bit:set" || v === "bit:clear" || v === "bit:toggle") {
          html = ` <input type="number" class="bitsel" min="0" max="255" value="0"
                   style="width:70px;padding:7px;border-radius:8px;border:1px solid #ccc">`;
        } else if (v === "run_action") {
          html = `<select class="gasel">${(this._data.actions || [])
            .filter((g) => g.actions)
            .map((g) => `<option value="${g.id}">${this._esc(g.name || "#" + g.id)}</option>`)
            .join("")}</select>`;
        }
        devwrap.innerHTML = html;
      };
      renderDev = buildDev;
      renderDev();
      sel.addEventListener("change", renderDev);

      sel.addEventListener("change", () => {
        const v = sel.value;
        if (!v) return;
        const dev = overlay.querySelector(".devsel");
        const mk = (s) => { steps.push(s); renderSteps(); sel.value = ""; renderDev(); };
        if (v.startsWith("output:")) {
          const op = v.split(":")[1];
          const id = dev ? Number(dev.value) : 0;
          if (op === "on_dim") mk({ kind: "output", op, id, dim: Number(overlay.querySelector(".dimsel").value) });
          else if (op === "toggle_dim") mk({ kind: "output", op, id, dim: Number(overlay.querySelector(".dimsel").value) });
          else if (op === "on_timer") mk({ kind: "output", op, id,
            timer: Number(overlay.querySelector(".timersel").value),
            overrule: overlay.querySelector(".ovsel").value === "1" });
          else mk({ kind: "output", op, id });
        } else if (v.startsWith("shutter:")) {
          mk({ kind: "shutter", op: v.split(":")[1], id: Number(dev.value) });
        } else if (v.startsWith("cond:")) {
          mk({ kind: "cond", what: v.split(":")[1], id: Number(dev.value) });
        } else if (["if", "and", "or", "then", "else", "endif"].includes(v)) {
          mk({ kind: v });
        } else if (v === "all_off:lights") mk({ kind: "all_off", lights_only: true });
        else if (v === "all_off:all") mk({ kind: "all_off", lights_only: false });
        else if (v.startsWith("virtual_input:")) {
          mk({ kind: "virtual_input", op: v.split(":")[1], id: Number(dev.value) });
        } else if (v.startsWith("bit:")) {
          mk({ kind: "bit", op: v.split(":")[1], id: Number(overlay.querySelector(".bitsel").value) });
        } else if (v === "run_action") {
          mk({ kind: "run_action", id: Number(overlay.querySelector(".gasel").value) });
        }
      });
    }

    const close = () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
      this._open = false;
    };
    overlay.querySelector(".close").addEventListener("click", close);
    const rn = overlay.querySelector(".runnow");
    if (rn) rn.addEventListener("click", () => this._run(ga.id));
    overlay.querySelector(".save").addEventListener("click", async () => {
      const name = overlay.querySelector(".ganame").value.trim();
      let actions = "";
      try {
        actions = encode(steps);
      } catch (err) {
        overlay.querySelector(".msg").textContent = this._t("save_failed");
        return;
      }
      try {
        await this._hass.callService("renson_smartliving", "save_group_action", {
          id: ga.id, name, actions, show_in_app: ga.show_in_app !== false,
        });
        close();
        await this._load();
      } catch (err) {
        overlay.querySelector(".msg").textContent =
          this._t("save_failed") + " " + String(err && err.message ? err.message : err);
      }
    });
  }
}

customElements.define("renson-automation-editor", RensonAutomationEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "renson-automation-editor",
  name: "Renson Automation Editor",
  description: "Edit OpenMotics gateway automations (group actions)",
});
