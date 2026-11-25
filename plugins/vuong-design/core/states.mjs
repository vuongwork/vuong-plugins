// Component states (plan 3b Task 3, spec §10): the state table of each component kind, where each state comes from
// (the HTML, a design-system rule, or nowhere) and the concrete change a rule makes. Pure and deterministic: no
// browser, no model, no clock.
//
// STATE_TABLE: the states each kind must have (mobile: no hover). The first one is the base state, the one an
// occurrence without a state class is in. 'other' has no table: its HTML states are kept as they are.
//
// HTML state classes -> state ids: a class (a leading 'is-' dropped) that names a state of the kind maps to it:
// pressed; disabled; loading / busy; focus / focused / focus-visible; error / invalid; filled; empty; on / checked /
// selected / active / current -> the kind's 'on' state (checked, selected, on; 'active' is pressed on a button); off /
// unchecked / unselected -> the base state. A class declared in vd-components.json `classes.<base>.stateMap`
// ({ class: state id }) wins over this. A class that maps to nothing in the table is an `extra` HTML state: kept,
// listed, never renamed. Several state classes on one occurrence (`on+disabled`) map part by part.
//
// Source of each table state, in this order (spec §10):
//  - html: some variant of the component (Task 2) is in that state (for the base state: a variant with no state
//    class). `variants` lists their indexes.
//  - proposed: the state has a rule (pressed, disabled, focus, error, loading) and the rule applies to the
//    component: one proposed variant per base variant (each modifier combination without a state class), `props`
//    = the base variant's props with state = the state id, `patch` = the change below.
//  - missing: no rule for the state (checked, selected, on, filled, empty ...: draw them in the HTML), or the rule
//    needs something the design system does not have (a focus / error colour token, a text to replace, a content
//    colour). `reason` says which; the entry is also in `missing` (for coverage.json).
//
// Rules: vd-rules.json `states` (read by rules-file.mjs, checked by stateRules). Defaults of spec §10:
//   pressed  { overlay: 0.1 }                    overlay in the content colour at 10 % on the root
//   disabled { content: 0.38, container: 0.12 }  content (the root's kids) at 38 % opacity; root fill and stroke at 12 %
//   focus    { width: 2, token: null }           an outside ring of 2 px in the focus colour token
//   error    { width: 1, token: null }           the root stroke in the error colour token (width: when it has none)
//   loading  { spinner: true }                   the label texts replaced by a spinner of the label's size and colour
// token null -> the role token whose name has 'focus' (error: 'error', 'danger', 'destructive' or 'invalid'), first
// by name; a token path ('role.ring') names it. Proposed states are drawn only after the user approved the rules:
// `states.approved: true`, written by the user, never by an agent. forFigma() drops every proposed variant until then.
//
// Patches (paths relative to the component root, '' = the root; colours '#rrggbb[aa]'):
//   pressed  { overlay: { color, opacity } }
//   disabled { contentOpacity?, fillOpacity?, strokeOpacity? }   (only the parts the root has)
//   focus    { ring: { width, color, token } }
//   error    { stroke: { width, color, token } }
//   loading  { spinner: { replace: [paths], size, color } }
//
// componentStates(result of findComponents, { specs: { [screen]: spec root }, tokens, rules, decl }) -> {
//   v: 1, approved, rules: { effective rule values },
//   components: [{ name, kind, states: [{ state, source, variants?, rule?, reason? }], extra: [{ state, variants }],
//                  proposed: [{ state, base, props, patch }] }],
//   missing: [{ component, kind, state, reason }], warnings: [string] }
// statesDraft(rules) -> the `states` section for vd-rules.draft.json: the effective values, approved '' (to fill).
import { parseColor, toHex } from './color.mjs';

export const STATE_TABLE = {
  button: ['default', 'pressed', 'disabled', 'loading', 'focus'],
  input: ['empty', 'focus', 'filled', 'error', 'disabled'],
  checkbox: ['unchecked', 'checked', 'disabled'],
  radio: ['unselected', 'selected', 'disabled'],
  switch: ['off', 'on', 'disabled'],
  chip: ['unselected', 'selected', 'disabled'],
  tab: ['unselected', 'selected'],
  other: [],
};
const ON = { checkbox: 'checked', radio: 'selected', switch: 'on', chip: 'selected', tab: 'selected', button: 'pressed' };
const ALIAS = {
  pressed: 'pressed', disabled: 'disabled', loading: 'loading', busy: 'loading', focus: 'focus', focused: 'focus',
  'focus-visible': 'focus', error: 'error', invalid: 'error', filled: 'filled', empty: 'empty',
  on: '@on', checked: '@on', selected: '@on', active: '@on', current: '@on', off: '@base', unchecked: '@base', unselected: '@base',
};
export const RULE_DEFAULTS = {
  pressed: { overlay: 0.1 },
  disabled: { content: 0.38, container: 0.12 },
  focus: { width: 2, token: null },
  error: { width: 1, token: null },
  loading: { spinner: true },
};
const TOKEN_WORDS = { focus: /focus/i, error: /error|danger|destructive|invalid/i };
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---- rules ----------------------------------------------------------------------------------------------------------

// rules = readRules() result; its `states` section is optional. Throws naming the key for anything malformed.
export function stateRules(rules) {
  const s = rules && rules.states;
  const where = 'rules file: states';
  const out = { approved: false, rules: JSON.parse(JSON.stringify(RULE_DEFAULTS)) };
  if (s === undefined) return out;
  if (!isObj(s)) throw new Error(`${where} must be an object`);
  for (const [k, v] of Object.entries(s)) {
    if (k === 'approved') {
      if (v !== true && v !== false && v !== '') throw new Error(`${where}.approved must be true, false or ""`);
      continue;
    }
    if (k === 'notes') continue;
    if (!RULE_DEFAULTS[k]) throw new Error(`${where}: unknown rule "${k}" (rules: ${Object.keys(RULE_DEFAULTS).join(', ')})`);
    if (!isObj(v)) throw new Error(`${where}.${k} must be an object`);
    for (const [p, x] of Object.entries(v)) {
      if (!(p in RULE_DEFAULTS[k])) throw new Error(`${where}.${k}: unknown key "${p}"`);
      const bad = p === 'token' ? !(x === null || (typeof x === 'string' && x))
        : p === 'spinner' ? typeof x !== 'boolean'
          : p === 'width' ? !(typeof x === 'number' && x > 0 && x <= 16)
            : !(typeof x === 'number' && x > 0 && x <= 1);
      if (bad) throw new Error(`${where}.${k}.${p}: ${JSON.stringify(x)} is not allowed (${p === 'token' ? 'null or a token path' : p === 'spinner' ? 'true or false' : p === 'width' ? 'a number of px, 0 to 16' : 'a fraction, 0 to 1'})`);
      out.rules[k][p] = x;
    }
  }
  out.approved = s.approved === true;
  return out;
}

export function statesDraft(rules) {
  const { rules: eff } = stateRules(rules);
  return { approved: '', ...eff, notes: 'Rules that draw the states the HTML does not have (spec §10). Check them on the component preview page, then copy this section to vd-rules.json and set "approved": true yourself.' };
}

// ---- class -> state ------------------------------------------------------------------------------------------------

function mapClass(cls, kind, stateMap) {
  const table = STATE_TABLE[kind] || [];
  if (stateMap && typeof stateMap[cls] === 'string') return stateMap[cls];
  const a = ALIAS[cls.replace(/^is-/, '')];
  if (!a) return null;
  const id = a === '@on' ? ON[kind] : a === '@base' ? table[0] : a;
  return id && table.includes(id) ? id : null;
}

// ---- tokens and colours ----------------------------------------------------------------------------------------------

const hexOf = (css) => {
  if (!css) return null;
  const c = parseColor(css);
  return c.unparsed === undefined ? toHex(c) : null;
};
const visible = (css) => { if (!css || css === 'transparent') return false; const c = parseColor(css); return c.unparsed === undefined && (c.a ?? 1) > 0; };

function tokenAt(tokens, path) {
  let t = tokens;
  for (const p of String(path).split('.')) t = t && isObj(t) ? t[p] : undefined;
  return t && isObj(t) && '$value' in t ? t : null;
}
function tokenHex(tokens, path, seen = new Set()) {
  const t = tokenAt(tokens, path);
  if (!t || seen.has(path)) return null;
  seen.add(path);
  const v = t.$value;
  if (typeof v === 'string' && /^\{.+\}$/.test(v)) return tokenHex(tokens, v.slice(1, -1), seen);
  if (isObj(v) && typeof v.hex === 'string') return v.hex + (typeof v.alpha === 'number' && v.alpha < 1 ? Math.round(v.alpha * 255).toString(16).padStart(2, '0') : '');
  return typeof v === 'string' ? hexOf(v) : null;
}
// -> { token, color } or { reason }
function findToken(tokens, which, named) {
  if (named) {
    const color = tokens ? tokenHex(tokens, named) : null;
    return color ? { token: named, color } : { reason: `token ${named} (vd-rules.json states.${which}.token) is not a colour in tokens.json` };
  }
  const role = (tokens && tokens.role) || {};
  const name = Object.keys(role).filter((n) => TOKEN_WORDS[which].test(n)).sort(cmpStr).find((n) => tokenHex(tokens, `role.${n}`));
  return name ? { token: `role.${name}`, color: tokenHex(tokens, `role.${name}`) }
    : { reason: `no ${which} colour token (no role token named ${which === 'focus' ? '*focus*' : '*error*, *danger*, *destructive* or *invalid*'}; name one in vd-rules.json states.${which}.token)` };
}

// ---- template helpers ------------------------------------------------------------------------------------------------

const rel = (root, id) => (id === root.id ? '' : id.slice(root.id.length + 1));
function walk(n, fn) { fn(n); for (const k of n.kids || []) walk(k, fn); }
function contentColor(root) {
  let c = null;
  walk(root, (n) => {
    if (c) return;
    if (n.t === 'T' && n.font && hexOf(n.font.c)) c = hexOf(n.font.c);
    else if (n.icon) c = hexOf(n.icon.color) || hexOf(n.icon.stroke);
  });
  return c;
}
const findNode = (n, id) => { if (n.id === id) return n; for (const k of n.kids || []) { const x = findNode(k, id); if (x) return x; } return null; };

function patchFor(state, root, R, tokens) {
  const p = root.paint || {};
  const hasBg = visible(p.bg);
  const hasStroke = Array.isArray(p.border) && p.border.some((b) => b && b.w > 0 && visible(b.color));
  switch (state) {
    case 'pressed': {
      const color = contentColor(root);
      return color ? { patch: { overlay: { color, opacity: R.pressed.overlay } } } : { reason: 'no text or icon colour to tint the overlay with' };
    }
    case 'disabled': {
      const patch = {};
      if ((root.kids || []).length) patch.contentOpacity = R.disabled.content;
      if (hasBg) patch.fillOpacity = R.disabled.container;
      if (hasStroke) patch.strokeOpacity = R.disabled.container;
      return Object.keys(patch).length ? { patch } : { reason: 'nothing to fade (no content, fill or stroke)' };
    }
    case 'focus': {
      const t = findToken(tokens, 'focus', R.focus.token);
      return t.reason ? t : { patch: { ring: { width: R.focus.width, color: t.color, token: t.token } } };
    }
    case 'error': {
      const t = findToken(tokens, 'error', R.error.token);
      const w = hasStroke ? Math.max(...p.border.map((b) => (b && b.w) || 0)) : R.error.width;
      return t.reason ? t : { patch: { stroke: { width: w, color: t.color, token: t.token } } };
    }
    case 'loading': {
      if (!R.loading.spinner) return { reason: 'the loading rule is off (states.loading.spinner false)' };
      const texts = [];
      walk(root, (n) => { if (n.t === 'T') texts.push(n); });
      if (!texts.length) return { reason: 'no label to replace with a spinner' };
      const fs = parseFloat(texts[0].font && texts[0].font.fs);
      const color = hexOf(texts[0].font && texts[0].font.c);
      if (!color) return { reason: 'no label colour for the spinner' };
      return { patch: { spinner: { replace: texts.map((n) => rel(root, n.id)), size: r3(Number.isFinite(fs) ? fs : 16), color } } };
    }
    default:
      return { reason: 'no rule draws this state; draw it in the HTML' };
  }
}

// ---- main ------------------------------------------------------------------------------------------------------------

export function componentStates(result, { specs = {}, tokens = null, rules, decl } = {}) {
  const { approved, rules: R } = stateRules(rules);
  const classes = (decl && decl.classes) || {};
  const warnings = [];
  const missing = [];
  const out = [];
  for (const c of (result && result.components) || []) {
    const kind = c.kind || 'other';
    const table = STATE_TABLE[kind] || [];
    // stateMap of the base class: the declared class whose name or kind matches (decl names, else the key's classes)
    const base = Object.keys(classes).filter((k) => classes[k].stateMap && (classes[k].name === c.name || String(c.key).split(/[.#]/).includes(k))).sort(cmpStr)[0];
    // a kept bare block (key b:<hex>, '#<n>' when split) declares it on its keep entry
    const bareKey = String(c.key).split('#')[0];
    const kv = decl && decl.keep ? decl.keep[bareKey] : undefined;
    const stateMap = base ? classes[base].stateMap : kv && typeof kv === 'object' && kv.stateMap ? kv.stateMap : null;
    const where = base ? `classes.${base}` : `keep.${bareKey}`;
    if (stateMap) for (const [cls, id] of Object.entries(stateMap)) {
      if (!table.includes(id)) throw new Error(`components file: ${where}.stateMap.${cls}: "${id}" is not a state of kind ${kind} (${table.join(', ') || 'none'})`);
    }
    const have = new Map(); // state id -> [variant idx]
    const extra = new Map();
    const baseVariants = [];
    c.variants.forEach((v, i) => {
      const raw = v.props && v.props.state && v.props.state !== 'default' ? v.props.state.split('+') : [];
      const ids = new Set();
      for (const cls of raw) {
        const id = mapClass(cls, kind, stateMap);
        if (id) { if (id !== table[0]) ids.add(id); } else { if (!extra.has(cls)) extra.set(cls, []); extra.get(cls).push(i); }
      }
      if (!ids.size && !raw.some((cls) => !mapClass(cls, kind, stateMap))) baseVariants.push(i);
      for (const id of ids) { if (!have.has(id)) have.set(id, []); have.get(id).push(i); }
    });
    if (table.length && baseVariants.length) have.set(table[0], [...baseVariants]);
    const states = [];
    const proposed = [];
    for (const st of table) {
      if (have.has(st)) { states.push({ state: st, source: 'html', variants: have.get(st) }); continue; }
      if (!RULE_DEFAULTS[st]) {
        const reason = 'no rule draws this state; draw it in the HTML';
        states.push({ state: st, source: 'missing', reason });
        missing.push({ component: c.name, kind, state: st, reason });
        continue;
      }
      if (!baseVariants.length) {
        const reason = 'no variant in the base state to derive it from';
        states.push({ state: st, source: 'missing', rule: st, reason });
        missing.push({ component: c.name, kind, state: st, reason });
        continue;
      }
      let why = null;
      const made = [];
      for (const i of baseVariants) {
        const v = c.variants[i];
        const spec = specs[v.template.screen];
        const root = spec && findNode(spec, v.template.node);
        if (!root) { why = `template ${v.template.screen} ${v.template.node} not found in the specs`; break; }
        const r = patchFor(st, root, R, tokens);
        if (r.reason) { why = r.reason; break; }
        made.push({ state: st, base: i, props: { ...v.props, state: st }, patch: r.patch });
      }
      if (why) {
        states.push({ state: st, source: 'missing', rule: st, reason: why });
        missing.push({ component: c.name, kind, state: st, reason: why });
      } else {
        states.push({ state: st, source: 'proposed', rule: st });
        proposed.push(...made);
      }
    }
    const ex = [...extra].sort((a, b) => cmpStr(a[0], b[0])).map(([state, variants]) => ({ state, variants: [...new Set(variants)] }));
    if (ex.length && table.length) warnings.push(`${c.name} (${kind}): HTML state class${ex.length > 1 ? 'es' : ''} ${ex.map((e) => e.state).join(', ')} not in the ${kind} table; kept as extra states (map one with classes.<base>.stateMap)`);
    out.push({ name: c.name, kind, states, extra: ex, proposed });
  }
  return { v: 1, approved, rules: R, components: out, missing, warnings };
}

// What may go to Figma: proposed variants only once the rules are approved.
export function forFigma(st) {
  return { ...st, components: st.components.map((c) => ({ ...c, proposed: st.approved ? c.proposed : [] })) };
}
