// Coverage (plan 2, Task 7): the design-system checklist of spec §8.3 checked against what the source shows, plus the
// project questions of spec §8.4 with defaults read from the source. Pure and deterministic (no clock, no browser).
//
// loadChecklist(path = <plugin>/checklist.json) -> checklist. validateChecklist(checklist, where) throws an Error that
//   names the file / key for: a missing file, invalid JSON, `version` not 1, `groups` not an array, an item without
//   id / label, a tag other than ask / default / derived, an unknown `check`, a duplicate item id.
//   checklist = { version: 1, groups: [{ id, label, items: [{ id, label, tag, check?, question? }] }] }; `question`
//   links an item to a project question key (an answer marks the item 'answered').
//
// coverage(checklist, { inv, tokens, screens, rules }) -> { items, contrast, touch, summary, vars }
//  - vars (R79): { complex, unreadable } = the sums of capture's screen.varsComplex (var() declarations inside a function
//    or with a fallback: no token attributed) and screen.varsUnreadable (stylesheets that could not be read).
//  - inv: inventory; tokens: buildTokens().tokens; screens: capture IR screens (tree, W, vars ...), each with an optional
//    `darkMode` boolean the caller fills (the CSS has dark-mode styles); rules: readRules() result.
//  - items: one per checklist item, in checklist order: { id, group, label, tag, state, evidence }.
//    state: 'covered' (an automatic check found it in the source), 'answered' (rules.answers has the item's question;
//    also when its check is missing), 'missing' (anything else; evidence says why: check result, 'not answered yet',
//    'not derived automatically in this version', or that the platform standard's default applies).
//  - Automatic checks: colorRoles, stateColors (classes / variable names for error, selected, disabled), darkMode
//    (screens[i].darkMode; absent everywhere -> missing, 'not measured'), typeScale, spaceScale, sizes, radius,
//    shadow, borderWidth, opacity (primitive tokens of that kind), screenSizes, icons, images (IR), contrast, touch,
//    naming (missing while role tokens have generated names), codeMapping (tokens exist -> tokens.css maps them).
//  - contrast: WCAG 2.2 AA failures, one per text colour of a text node (node colour and each run colour), against
//    the background composed from the nearest ancestor (or the node) with an opaque background plus translucent
//    backgrounds below it; no opaque ancestor -> white is assumed (bgFrom 'assumed white'). Large text = >= 24 px, or
//    >= 18.66 px at weight >= 700: needs 3:1, other text 4.5:1. Entry: { screen, node, text, color, bg, bgFrom,
//    ratio, ratioText ('2.85:1'), required ('4.5:1'), fontSize ('14px'), fontWeight, large }. Ancestor opacity,
//    background images and overlapping siblings are not considered. Sorted by screen, node, colour.
//  - touch: interactive elements (tag a, button, input, select, textarea, or role 'button' when the IR carries it)
//    narrower or lower than 44 px at width A: { screen, node, tag, w, h, size ('32×32 px') }. Zero-area nodes skipped.
//
// projectQuestions({ inv, screens, tokens?, rules? }) -> Question[] in normalize's shape ({ key, cat: 'project',
//   code: 'PROJECT', text, options (null = free answer), default, affects (screens), answered? }), keys sorted. The
//   eleven questions of §8.4: project.adjectives, brandAssets, darkMode, density, font, i18n, iconStyle, platform,
//   primaryColor, screenSizes, shadows. Confirmations only: an answer is never checked against options and never
//   blocks a run.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseColor, toHex, contrast as ratioOf, oklchOf } from './color.mjs';
import { cmpNodeId } from './inventory.mjs';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const CHECKLIST_VERSION = 1;
export const DEFAULT_CHECKLIST = fileURLToPath(new URL('../checklist.json', import.meta.url));
const TAGS = new Set(['ask', 'default', 'derived']);
const CHECKS = ['colorRoles', 'stateColors', 'darkMode', 'typeScale', 'spaceScale', 'sizes', 'radius', 'shadow', 'borderWidth', 'opacity',
  'screenSizes', 'icons', 'images', 'contrast', 'touch', 'naming', 'codeMapping'];
const TOUCH_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea']);
const TOUCH_MIN = 44;

// ---------------- checklist file ----------------

export function validateChecklist(j, where = 'checklist') {
  if (!isObj(j)) throw new Error(`${where}: the top level must be an object`);
  if (j.version !== CHECKLIST_VERSION) throw new Error(`${where}: "version" is ${JSON.stringify(j.version)}, expected ${CHECKLIST_VERSION}`);
  if (!Array.isArray(j.groups)) throw new Error(`${where}: "groups" must be an array`);
  const ids = new Set();
  for (const g of j.groups) {
    if (!isObj(g) || typeof g.id !== 'string' || typeof g.label !== 'string' || !Array.isArray(g.items)) {
      throw new Error(`${where}: every group needs a string "id", a string "label" and an "items" array (${JSON.stringify(g && g.id)})`);
    }
    for (const it of g.items) {
      if (!isObj(it) || typeof it.id !== 'string' || typeof it.label !== 'string') throw new Error(`${where}: group "${g.id}": every item needs a string "id" and "label"`);
      if (!TAGS.has(it.tag)) throw new Error(`${where}: item "${it.id}": tag ${JSON.stringify(it.tag)} is not ask, default or derived`);
      if (it.check !== undefined && !CHECKS.includes(it.check)) throw new Error(`${where}: item "${it.id}": unknown check "${it.check}"`);
      if (ids.has(it.id)) throw new Error(`${where}: duplicate item id "${it.id}"`);
      ids.add(it.id);
    }
  }
  return j;
}

export function loadChecklist(path = DEFAULT_CHECKLIST) {
  if (!existsSync(path)) throw new Error(`checklist file ${path} not found`);
  let j;
  try { j = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new Error(`checklist file ${path}: not valid JSON (${e.message})`); }
  return validateChecklist(j, `checklist file ${path}`);
}

// ---------------- IR helpers ----------------

function eachNode(screens, fn) {
  for (const s of screens || []) {
    const sid = String(s.id ?? s.name);
    const rec = (n, chain) => { fn(n, sid, chain, s); const next = [...chain, n]; (n.kids || []).forEach((k) => rec(k, next)); };
    if (s.tree) rec(s.tree, []);
  }
}
const opaque = (c) => c && c.unparsed === undefined && (c.a ?? 1) >= 1;
const over = (top, under) => {
  const a = top.a ?? 1;
  const m = (k) => top[k] * a + under[k] * (1 - a);
  return { r: m('r'), g: m('g'), b: m('b'), a: 1 };
};

// background behind node n: nearest opaque bg in [n, ...ancestors], translucent ones above it composed over it
function backgroundOf(n, chain) {
  const layers = [];
  for (const x of [n, ...[...chain].reverse()]) {
    const bg = x.paint && x.paint.bg;
    if (!bg) continue;
    const c = parseColor(bg);
    if (c.unparsed !== undefined || (c.a ?? 1) === 0) continue;
    layers.push({ c, id: x.id });
    if (opaque(c)) break;
  }
  const base = layers.length && opaque(layers[layers.length - 1].c) ? layers.pop() : { c: { r: 1, g: 1, b: 1, a: 1 }, id: 'assumed white' };
  let c = base.c;
  for (const l of layers.reverse()) c = over(l.c, c);
  return { c, from: base.id };
}

export function contrastIssues(screens) {
  const out = [];
  eachNode(screens, (n, sid, chain) => {
    if (n.kind !== 'text' || !n.font) return;
    const f = n.font;
    const runs = n.runs && n.runs.length ? n.runs : [{ t: '' }];
    const seen = new Set();
    const { c: bg, from } = backgroundOf(n, chain);
    for (const r of runs) {
      if (r.br) continue;
      const s = r.s || {};
      const col = s.c ?? f.c;
      const size = num(s.fs ?? f.fs), weight = num(s.fw ?? f.fw) ?? 400;
      const key = `${col}|${size}|${weight}`;
      if (!col || seen.has(key)) continue;
      seen.add(key);
      const c = parseColor(col);
      if (c.unparsed !== undefined || (c.a ?? 1) === 0) continue;
      const ratio = ratioOf(c, bg);
      const large = size != null && (size >= 24 || (size >= 18.66 && weight >= 700));
      const need = large ? 3 : 4.5;
      if (ratio + 1e-9 >= need) continue;
      const text = runs.map((x) => x.t || '').join('').replace(/\s+/g, ' ').trim();
      out.push({
        screen: sid, node: n.id, text: text.length > 40 ? text.slice(0, 39) + '…' : text, color: toHex(c), bg: toHex(bg), bgFrom: from,
        ratio: r2(ratio), ratioText: `${r2(ratio).toFixed(2)}:1`, required: `${need}:1`, fontSize: size != null ? `${size}px` : null, fontWeight: weight, large,
      });
    }
  });
  return out.sort((a, b) => cmpStr(a.screen, b.screen) || cmpNodeId(a.node, b.node) || cmpStr(a.color, b.color));
}

export function touchIssues(screens) {
  const out = [];
  eachNode(screens, (n, sid) => {
    if (!(TOUCH_TAGS.has(n.tag) || n.role === 'button') || !Array.isArray(n.rA)) return;
    const [, , w, h] = n.rA;
    if (!(w > 0 && h > 0) || (w >= TOUCH_MIN && h >= TOUCH_MIN)) return;
    out.push({ screen: sid, node: n.id, tag: n.tag, w: r2(w), h: r2(h), size: `${r2(w)}×${r2(h)} px` });
  });
  return out.sort((a, b) => cmpStr(a.screen, b.screen) || cmpNodeId(a.node, b.node));
}

// ---------------- checks ----------------

const leaves = (g) => (g ? Object.entries(g).filter(([k]) => !k.startsWith('$')).flatMap(([k, v]) => (v && '$value' in v ? [[k, v]] : leaves(v).map(([kk, vv]) => [`${k}.${kk}`, vv]))) : []);
const pxList = (g) => leaves(g).map(([, t]) => t.$value && t.$value.value).filter((v) => typeof v === 'number').sort((a, b) => a - b);
const listPx = (vs) => (vs.length > 8 ? `${vs.slice(0, 8).join(', ')} … px` : `${vs.join(', ')} px`);
const plural = (n, w) => `${n} ${n === 1 ? w : w === 'radius' ? 'radii' : w + 's'}`;
// screen width at A: capture writes W = [A, B]; a number is accepted; else the root box
const widthOf = (s) => (Array.isArray(s.W) ? s.W[0] : typeof s.W === 'number' ? s.W : s.tree && Array.isArray(s.tree.rA) ? s.tree.rA[2] : null);
const STATE_RX = {
  error: /(^|[-_])(error|danger|invalid|alert)([-_]|$)/i,
  selected: /^(is-)?(selected|active|on|checked|current)$|(^|[-_])(selected|active|checked)([-_]|$)/i,
  disabled: /(^|[-_])disabled([-_]|$)/i,
};

function runChecks({ inv, tokens, screens, contrast, touch }) {
  const prim = (tokens && tokens.primitive) || {};
  const roles = leaves(tokens && tokens.role);
  const font = prim.font || {};
  const ok = (state, evidence) => ({ state, evidence });
  const scale = (g, what, min) => {
    const vs = [...new Set(pxList(g))];
    return vs.length >= min ? ok('covered', `${plural(vs.length, what)}: ${listPx(vs)}`) : ok('missing', vs.length ? `only ${listPx(vs)}` : `no ${what} in the source`);
  };
  const r = {};
  const colorRoles = roles.filter(([, t]) => t.$type === 'color');
  const named = colorRoles.filter(([, t]) => t.$extensions && t.$extensions['vuong-design'] && t.$extensions['vuong-design'].var).length;
  r.colorRoles = colorRoles.length ? ok('covered', `${plural(colorRoles.length, 'colour role token')} (${named} named by CSS variables)`) : ok('missing', 'no colour is used twice in one role');
  // state colours: classes on IR nodes, CSS variable names
  const found = {};
  eachNode(screens, (n) => {
    for (const c of String(n.cls || '').split(/\s+/).filter(Boolean)) {
      for (const [k, rx] of Object.entries(STATE_RX)) if (rx.test(c) && !found[k]) found[k] = `.${c} on ${n.id}`;
    }
  });
  for (const name of Object.keys((inv && inv.vars) || {}).sort(cmpStr)) {
    for (const [k, rx] of Object.entries(STATE_RX)) if (rx.test(name.replace(/^--/, '')) && !found[k]) found[k] = `variable ${name}`;
  }
  const states = Object.keys(STATE_RX), have = states.filter((k) => found[k]), lack = states.filter((k) => !found[k]);
  r.stateColors = ok(lack.length ? 'missing' : 'covered',
    [have.length ? `found ${have.map((k) => `${k} (${found[k]})`).join(', ')}` : '', lack.length ? `not found: ${lack.join(', ')}` : ''].filter(Boolean).join('; '));
  const dm = (screens || []).map((s) => s.darkMode).filter((x) => typeof x === 'boolean');
  r.darkMode = !dm.length ? ok('missing', 'not measured') : dm.some(Boolean) ? ok('covered', 'the CSS has dark-mode styles') : ok('missing', 'no dark-mode styles in the CSS');
  r.typeScale = scale(font.size, 'font size', 2);
  r.spaceScale = scale(prim.space, 'spacing value', 2);
  r.sizes = scale(prim.size, 'fixed size', 1);
  r.radius = scale(prim.radius, 'radius', 1);
  r.borderWidth = scale(prim.border, 'border width', 1);
  const sh = leaves(prim.shadow);
  r.shadow = sh.length ? ok('covered', `${plural(sh.length, 'shadow')}`) : ok('missing', 'no box-shadow in the source');
  const op = leaves(prim.opacity).map(([, t]) => t.$value);
  r.opacity = op.length ? ok('covered', `${plural(op.length, 'opacity level')}: ${op.map((v) => `${r2(v * 100)}%`).join(', ')}`) : ok('missing', 'no opacity below 100% in the source');
  const widths = [...new Set((screens || []).map(widthOf).filter((w) => typeof w === 'number'))].sort((a, b) => a - b);
  r.screenSizes = widths.length ? ok('covered', `${listPx(widths)} wide (${plural((screens || []).length, 'screen')})`) : ok('missing', 'no screen width measured');
  let icons = 0, images = 0;
  eachNode(screens, (n) => { if (n.kind === 'icon') icons++; if (n.kind === 'image' || n.tag === 'img') images++; });
  r.icons = icons ? ok('covered', `${plural(icons, 'icon')} in the screens`) : ok('missing', 'no icons in the source');
  r.images = images ? ok('covered', `${plural(images, 'image')} in the screens`) : ok('missing', 'no images in the source');
  r.contrast = contrast.length ? ok('missing', `${plural(contrast.length, 'text colour')} below WCAG AA (4.5:1, large text 3:1)`) : ok('covered', 'every text colour meets WCAG AA (4.5:1, large text 3:1)');
  r.touch = touch.length ? ok('missing', `${plural(touch.length, 'interactive element')} smaller than ${TOUCH_MIN}×${TOUCH_MIN} px`) : ok('covered', `no interactive element smaller than ${TOUCH_MIN}×${TOUCH_MIN} px`);
  const gen = roles.filter(([, t]) => !(t.$extensions && t.$extensions['vuong-design'] && t.$extensions['vuong-design'].var)).length;
  r.naming = !roles.length ? ok('missing', 'no role tokens') : gen ? ok('missing', `${plural(gen, 'role token')} of ${roles.length} still have generated names; name them in vd-names.json`)
    : ok('covered', `all ${plural(roles.length, 'role token')} are named by CSS variables`);
  const total = leaves(tokens && tokens.primitive).length + roles.length;
  r.codeMapping = total ? ok('covered', `tokens.css maps ${plural(total, 'token')} to CSS variables (Compose / SwiftUI layers: plan 3)`) : ok('missing', 'no tokens');
  return r;
}

export function coverage(checklist, { inv, tokens, screens, rules } = {}) {
  validateChecklist(checklist);
  const answers = (rules && rules.answers) || {};
  const contrast = contrastIssues(screens);
  const touch = touchIssues(screens);
  const checks = runChecks({ inv, tokens, screens, contrast, touch });
  const items = [];
  for (const g of checklist.groups) {
    for (const it of g.items) {
      let state = 'missing', evidence;
      if (it.check) ({ state, evidence } = checks[it.check]);
      else if (it.tag === 'ask') evidence = 'not answered yet';
      else if (it.tag === 'default') evidence = 'not derived from the source; the platform standard default applies';
      else evidence = 'not derived automatically in this version';
      if (state === 'missing' && it.question && answers[it.question] !== undefined) {
        state = 'answered';
        evidence = `answered: ${JSON.stringify(answers[it.question])}`;
      }
      items.push({ id: it.id, group: g.id, label: it.label, tag: it.tag, state, evidence });
    }
  }
  const summary = { total: items.length, covered: 0, answered: 0, missing: 0 };
  for (const it of items) summary[it.state]++;
  // R79: CSS variable uses capture could not attribute (var() inside a function or with a fallback: no token) and
  // stylesheets it could not read, summed over the file's screens
  const vars = { complex: 0, unreadable: 0 };
  for (const s of screens || []) { vars.complex += Number(s.varsComplex) || 0; vars.unreadable += Number(s.varsUnreadable) || 0; }
  return { items, contrast, touch, summary, vars };
}

// ---------------- project questions (§8.4) ----------------

const median = (vs) => { if (!vs.length) return null; const s = [...vs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

export function projectQuestions({ inv, screens, rules } = {}) {
  const uses = (inv && inv.uses) || [];
  const answers = (rules && rules.answers) || {};
  const nScreens = (screens || []).length;
  const qs = [];
  const q = (key, text, options, def) => {
    const o = { key, cat: 'project', code: 'PROJECT', text, options, default: def, affects: nScreens };
    if (answers[key] !== undefined) o.answered = answers[key];
    qs.push(o);
  };
  // platform and sizes from the screen widths
  const widths = (screens || []).map(widthOf).filter((w) => typeof w === 'number');
  const mw = median(widths);
  const sizes = [...new Set(widths)].sort((a, b) => a - b);
  q('project.platform', `Which platforms is this for? The screens are ${mw == null ? 'of unknown width' : `${mw} px wide (median)`}.`,
    ['android', 'ios', 'android+ios', 'web'], mw != null && mw > 600 ? 'web' : 'android+ios');
  q('project.screenSizes', `Which screen sizes must the design fit? Measured: ${sizes.length ? sizes.map((w) => `${w} px`).join(', ') : 'none'}.`,
    null, sizes.length ? sizes.map((w) => `${w} px`).join(', ') : 'none');
  // interactive nodes (and their descendants) for the primary colour
  const clickable = new Set();
  eachNode(screens, (n, sid, chain) => { if (TOUCH_TAGS.has(n.tag) || n.role === 'button' || chain.some((x) => TOUCH_TAGS.has(x.tag) || x.role === 'button')) clickable.add(`${sid}|${n.id}`); });
  const sat = (hex) => { const c = parseColor(hex); return c.unparsed === undefined && (c.a ?? 1) >= 1 ? oklchOf(c).c : 0; };
  const colorCount = (list) => {
    const m = new Map();
    for (const u of list) if (u.cat === 'color' && typeof u.value === 'string' && sat(u.value) >= 0.05) m.set(u.value, (m.get(u.value) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]));
  };
  const onClick = colorCount(uses.filter((u) => clickable.has(`${u.screen}|${u.node}`)));
  const all = colorCount(uses);
  const primary = (onClick[0] || all[0] || [null])[0];
  q('project.primaryColor', `What is the primary (brand) colour? Proposed: the saturated colour used most ${onClick.length ? 'on interactive elements' : 'in the screens'}${primary ? ` (${primary})` : ''}.`,
    null, primary || 'none');
  // font
  const fam = new Map();
  for (const u of uses) if (u.cat === 'type' && u.value && u.value.family) fam.set(u.value.family, (fam.get(u.value.family) || 0) + 1);
  const fams = [...fam].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0])).map(([f]) => f);
  q('project.font', `Which font family? Used in the screens: ${fams.length ? fams.join(', ') : 'none'} (pick one that covers every language you need).`,
    fams.length ? fams : null, fams[0] || 'system');
  // density from the median padding
  const pads = uses.filter((u) => u.cat === 'space' && /^padding/.test(u.prop) && typeof u.value === 'number').map((u) => u.value);
  const mp = median(pads);
  const density = mp == null ? 'comfortable' : mp < 8 ? 'compact' : mp <= 16 ? 'comfortable' : 'spacious';
  q('project.density', `How dense should the UI be? Median padding in the screens: ${mp == null ? 'none' : `${r2(mp)} px`}.`, ['compact', 'comfortable', 'spacious'], density);
  // dark mode
  const dm = (screens || []).map((s) => s.darkMode).filter((x) => typeof x === 'boolean');
  q('project.darkMode', `Do you need a dark mode? ${dm.length ? (dm.some(Boolean) ? 'The CSS has dark-mode styles.' : 'The CSS has no dark-mode styles.') : 'Not measured in the source.'}`,
    ['yes', 'no', 'later'], dm.some(Boolean) ? 'yes' : 'no');
  // languages from the text
  let vi = 0, latin = 0, other = 0;
  eachNode(screens, (n) => {
    if (n.kind !== 'text') return;
    const t = (n.runs || []).map((r) => r.t || '').join('');
    if (VI.test(t)) vi++; else if (/[^\x00-\x7F -ɏ -⁯←-⇿−]/.test(t)) other++; else if (/[A-Za-z]/.test(t)) latin++;
  });
  const lang = vi ? 'vi' : other > latin ? 'other' : 'en';
  q('project.i18n', `Which languages must the UI support? The screens read as ${lang === 'vi' ? 'Vietnamese' : lang === 'en' ? 'English' : 'a non-Latin script'}.`, null, lang);
  // icon style: stroke-drawn svg icons are outline (the root fill is ignored: it can be the initial black, M2-a)
  let outline = 0, filled = 0, glyphFamily = null;
  eachNode(screens, (n) => {
    if (n.kind !== 'icon' || !n.icon) return;
    if (n.icon.glyph !== undefined) {
      const ff = String((n.font && n.font.ff) || '');
      glyphFamily ||= ff.split(',')[0].replace(/["']/g, '').trim() || null;
      if (/outline|symbols/i.test(ff)) outline++; else filled++;
    } else if (n.icon.stroke && n.icon.stroke !== 'none') outline++;
    else filled++;
  });
  const tot = outline + filled;
  const style = !tot ? 'outline' : outline / tot >= 0.75 ? 'outline' : filled / tot >= 0.75 ? 'filled' : 'mixed';
  q('project.iconStyle', `Which icon style? In the screens: ${tot ? `${outline} outline, ${filled} filled icon(s)` : 'no icons'}${glyphFamily ? ` (icon font ${glyphFamily})` : ''}.`,
    ['outline', 'filled', 'duotone', 'mixed'], style);
  // shadows
  const shadows = uses.filter((u) => u.cat === 'shadow').length;
  q('project.shadows', `Use shadows for elevation? The screens have ${shadows ? `${plural(shadows, 'shadow')}` : 'none'}.`, ['yes', 'no'], shadows ? 'yes' : 'no');
  // brand assets
  const logos = [];
  eachNode(screens, (n, sid) => {
    const hay = `${n.cls || ''} ${(n.icon && n.icon.ref) || ''} ${n.alt || ''}`;
    if (/logo|brand/i.test(hay)) logos.push(`${sid}:${n.id}`);
  });
  q('project.brandAssets', `Which brand assets exist (logo, app icon, illustrations)? ${logos.length ? `Logo-like elements found: ${logos.slice(0, 3).join(', ')}${logos.length > 3 ? ` (+${logos.length - 3} more)` : ''}.` : 'None found in the screens.'}`,
    null, logos.length ? 'logo in the screens' : 'none');
  // three adjectives from radius, density and colour
  const radii = uses.filter((u) => u.cat === 'radius' && typeof u.value === 'number').map((u) => u.value);
  const mr = median(radii);
  const a1 = mr == null ? 'balanced' : mr >= 12 ? 'soft' : mr <= 4 ? 'crisp' : 'balanced';
  const a2 = { compact: 'efficient', comfortable: 'clear', spacious: 'airy' }[density];
  const a3 = primary && sat(primary) >= 0.15 ? 'vivid' : 'calm';
  q('project.adjectives', `Three words for how the app should feel? Proposed from the screens (median radius ${mr == null ? 'none' : `${r2(mr)} px`}, ${density} density, primary colour).`,
    null, `${a1}, ${a2}, ${a3}`);
  return qs.sort((a, b) => cmpStr(a.key, b.key));
}
