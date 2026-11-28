// Figma variables and styles from tokens.json (plan 3, Task 6). Pure and deterministic: same tokens -> same bytes.
//
// varsPayload(tokens, { limit = PAYLOAD_LIMIT, collections = { primitive: 'Primitive', role: 'Role' }, variants = [] }) -> string[]
//   One use_figma code string per batch (UTF-8 bytes <= limit; one self-contained call each: aliases to Primitive
//   variables made in an earlier batch are found by name). Run them in order. Each returns BatchResult (below).
// varsPlan(tokens, variants = []) -> { vars, textStyles, effectStyles, skipped }   the data of the payload, for tests and tools.
//   variants: figma-encode.mjs enc.variants ([name, base style, decoration, case], see "Style variants" there): each is
//   a text style copied from its base with that textDecoration ('' = NONE) and textCase, listed after the token styles;
//   one whose base is not a token style is skipped (reason 'variant-base-missing').
// varNames(tokens) -> string[]   names of the Figma variables the payload creates: the table `V` of figma-encode.mjs
//   (tokens order: primitive groups in order, then role tokens). Font family / weight, shadow and typography have no
//   variable (they are styles, or values inside a style); a role token that aliases a typography or shadow has none.
//
// Names (figma-encode.mjs figmaVarName): variable = token path without `primitive.`, '.' -> '/' (color/c01, space/12,
//   radius/full, font/size/10_5, role/text-muted); text style `type/<name>` of primitive.typography.<name>; effect style
//   `shadow/<name>` of primitive.shadow.<name>.
// Collections `Primitive` and `Role`, and `State` when tokens has a `state` group (states.mjs stateTokens: number
//   tokens of the approved state rules; width -> STROKE_FLOAT, the rest OPACITY x 100) (one mode each: the default mode, renamed `Value`). A role variable is a
//   VARIABLE_ALIAS to the Primitive variable its $value reaches (an alias to another role is followed to the end); a
//   role token holding a literal gets the literal. Description = $description. Every variable has explicit scopes:
//     color (primitive and role)  FRAME_FILL SHAPE_FILL TEXT_FILL STROKE_COLOR EFFECT_COLOR
//     space -> GAP (Figma has no padding scope: GAP covers gap and padding)   size -> WIDTH_HEIGHT
//     radius -> CORNER_RADIUS   border -> STROKE_FLOAT   opacity -> OPACITY (value = token x 100: Figma reads an opacity
//     variable as a percentage, 0.9 -> 90; measured live in T8, a 0.9 variable drew at 0.009)
//     font.size -> FONT_SIZE   font.lineHeight -> LINE_HEIGHT   font.letterSpacing -> LETTER_SPACING
//   A role takes the scopes of the primitive it reaches (a literal role dimension: by name: radius, padding / gap,
//   border, opacity (x 100, as above), else WIDTH_HEIGHT). Colours: components 0..1 and alpha in the COLOR value {r, g, b, a}.
// Text styles: fontName (the runtime's face resolution: exact face, else the nearest weight of the family, else
//   Inter; every substitution is in fontMissing), fontSize, lineHeight (PIXELS from $extensions.lineHeightPx, else
//   PERCENT = ratio x 100), letterSpacing PIXELS, textCase from $extensions.textTransform, italic from fontStyle,
//   textDecoration NONE (a variant: its own decoration and case).
//   Effect styles: one DROP_SHADOW / INNER_SHADOW per layer, same order as the encoder's `sh` (first = top).
// Skipped (never silently): a token the payload cannot express (colour space other than srgb, unit other than px, an
//   alias that resolves nowhere, a shadow without $type): varsPlan().skipped, and in the first batch's result.
// Idempotent: found by name (variables within their collection); created when missing; values, scopes, description
//   updated when they differ (colours within 1e-4); nothing is ever deleted.
// BatchResult = { batch, collections: { created, updated, unchanged }, variables: {..}, textStyles: {..}, effectStyles: {..},
//   created: { collections: [{ name, id }], variables, textStyles, effectStyles }, fontMissing: [{ style, family,
//   fontStyle, used }], errors: [{ kind, name, msg }], skipped: [{ path, reason }] (first batch only) }.
//   An item that throws is listed in errors and the rest of the batch still runs.
import { PAYLOAD_LIMIT } from './pipeline.mjs';

const COLOR_SC = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'EFFECT_COLOR'];
// scope sets, referenced by index from the data (the same table is in the runtime)
export const SCOPE_SETS = [COLOR_SC, ['GAP'], ['WIDTH_HEIGHT'], ['CORNER_RADIUS'], ['STROKE_FLOAT'], ['OPACITY'], ['FONT_SIZE'], ['LINE_HEIGHT'], ['LETTER_SPACING']];
const GROUP_SC = { color: 0, space: 1, size: 2, radius: 3, border: 4, opacity: 5, 'font.size': 6, 'font.lineHeight': 7, 'font.letterSpacing': 8 };
const VAR_TYPES = new Set(['color', 'dimension', 'number']);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
const isTok = (o) => o && typeof o === 'object' && '$value' in o;
const aliasOf = (v) => { const m = typeof v === 'string' && /^\{(.+)\}$/.exec(v); return m ? m[1] : null; };

function tokenAt(tokens, path) {
  let o = tokens;
  for (const k of String(path).split('.')) { if (!o || typeof o !== 'object') return null; o = o[k]; }
  return isTok(o) ? o : null;
}
// follow aliases -> { path, token } of the last token, or null (missing / loop)
function resolve(tokens, path) {
  for (let i = 0; i < 12; i++) {
    const t = tokenAt(tokens, path);
    if (!t) return null;
    const a = aliasOf(t.$value);
    if (!a) return { path, token: t };
    path = a;
  }
  return null;
}
function* leaves(o, prefix) {
  for (const k of Object.keys(o || {})) {
    const v = o[k], p = prefix ? prefix + '.' + k : k;
    if (isTok(v)) yield [p, v]; else if (v && typeof v === 'object' && !k.startsWith('$')) yield* leaves(v, p);
  }
}
export const varNameOf = (path) => String(path).replace(/^primitive\./, '').replace(/\./g, '/');
const groupOf = (path) => { const p = path.replace(/^primitive\./, '').split('.'); return p[0] === 'font' ? 'font.' + p[1] : p[0]; };

// the JS value of a variable token: { ty: 0 colour | 1 float, val } or { skip: reason }
function valueOf(t) {
  const v = t.$value;
  if (t.$type === 'color') {
    if (!v || v.colorSpace !== 'srgb' || !Array.isArray(v.components) || v.components.length !== 3) return { skip: 'color-space' };
    return { ty: 0, val: [...v.components.map(r4), v.alpha == null ? 1 : r4(v.alpha)] };
  }
  if (t.$type === 'dimension') return v && v.unit === 'px' && Number.isFinite(v.value) ? { ty: 1, val: v.value } : { skip: 'unit' };
  return Number.isFinite(v) ? { ty: 1, val: v } : { skip: 'value' };
}
const roleScope = (name) => (/radius/.test(name) ? 3 : /padding|gap/.test(name) ? 1 : /border/.test(name) ? 4 : /opacity/.test(name) ? 5 : 2);
// T8 item E: Figma reads a FLOAT variable bound to opacity as a percentage (0..100), so the token's 0..1 is x 100
const stored = (val, sc) => (sc === 5 ? r4(val * 100) : val);

export function varsPlan(tokens, variants = []) {
  const skipped = [], vars = [];
  const desc = (t) => (typeof t.$description === 'string' ? t.$description : '');
  const known = new Set();
  for (const [path, t] of leaves(tokens.primitive, 'primitive')) {
    if (!VAR_TYPES.has(t.$type)) continue;
    const sc = GROUP_SC[groupOf(path)];
    if (sc === undefined) { skipped.push({ path, reason: 'no-scope-rule' }); continue; }
    const v = valueOf(t);
    if (v.skip) { skipped.push({ path, reason: v.skip }); continue; }
    vars.push({ name: varNameOf(path), coll: 0, ty: v.ty, val: stored(v.val, sc), sc, desc: desc(t) });
    known.add(path);
  }
  for (const [path, t] of leaves(tokens.role, 'role')) {
    const name = varNameOf(path), r = resolve(tokens, path);
    if (!r) { skipped.push({ path, reason: 'alias-missing' }); continue; }
    if (!VAR_TYPES.has(r.token.$type)) continue; // typography / shadow alias: a style, not a variable
    if (r.path !== path && r.path.startsWith('primitive.')) {
      if (!known.has(r.path)) { skipped.push({ path, reason: 'alias-target-no-variable' }); continue; }
      const target = vars.find((x) => x.name === varNameOf(r.path));
      vars.push({ name, coll: 1, ty: target.ty, val: target.name, sc: target.sc, desc: desc(t) });
    } else {
      const v = valueOf(r.token);
      if (v.skip) { skipped.push({ path, reason: v.skip }); continue; }
      const sc = v.ty === 0 ? 0 : roleScope(name);
      vars.push({ name, coll: 1, ty: v.ty, val: stored(v.val, sc), sc, desc: desc(t) });
    }
  }

  // state tokens (plan 3b Task 6 part 2, states.mjs stateTokens): collection State; a width is a stroke weight, every
  // other value an opacity (x 100, as above)
  for (const [path, t] of leaves(tokens.state, 'state')) {
    if (!VAR_TYPES.has(t.$type)) continue;
    const v = valueOf(t);
    if (v.skip) { skipped.push({ path, reason: v.skip }); continue; }
    const sc = /.width$/.test(path) ? 4 : 5;
    vars.push({ name: varNameOf(path), coll: 2, ty: v.ty, val: stored(v.val, sc), sc, desc: desc(t) });
  }

  const textStyles = [], effectStyles = [];
  const px = (tokens_, x) => { // dimension token / alias / object -> number
    let v = x;
    const a = aliasOf(v);
    if (a) { const r = resolve(tokens_, a); if (!r) return null; v = r.token.$value; }
    if (typeof v === 'number') return v;
    return v && v.unit === 'px' && Number.isFinite(v.value) ? v.value : null;
  };
  const prim = (x) => { const a = aliasOf(x); if (!a) return x; const r = resolve(tokens, a); return r ? r.token.$value : null; };
  for (const [key, t] of Object.entries(tokens.primitive.typography || {})) {
    if (!isTok(t) || t.$type !== 'typography') continue;
    const path = 'primitive.typography.' + key, v = t.$value || {}, ext = (t.$extensions && t.$extensions['vuong-design']) || {};
    const ff = prim(v.fontFamily), fw = Number(prim(v.fontWeight)), fs = px(tokens, v.fontSize), ls = v.letterSpacing == null ? 0 : px(tokens, v.letterSpacing);
    if (typeof ff !== 'string' || !ff || !(fw > 0) || !(fs > 0) || ls === null) { skipped.push({ path, reason: 'typography-unresolved' }); continue; }
    let lh = null;
    if (Number.isFinite(ext.lineHeightPx)) lh = ['p', ext.lineHeightPx];
    else if (typeof v.lineHeight === 'number') lh = ['%', r4(v.lineHeight * 100)];
    else if (v.lineHeight != null) { const n = px(tokens, v.lineHeight); if (n !== null) lh = ['p', n]; }
    const tc = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' }[ext.textTransform] || '';
    textStyles.push({ name: 'type/' + key, ff, fw, it: /italic|oblique/.test(ext.fontStyle || '') ? 1 : 0, fs, lh, ls, tc, desc: desc(t) });
  }
  for (const [key, t] of Object.entries(tokens.primitive.shadow || {})) {
    if (!isTok(t)) continue;
    const path = 'primitive.shadow.' + key;
    if (t.$type !== 'shadow') { skipped.push({ path, reason: 'shadow-unparsed' }); continue; }
    const layers = Array.isArray(t.$value) ? t.$value : [t.$value];
    const fx = layers.map((l) => {
      const c = l && l.color;
      const x = l && px(tokens, l.offsetX), y = l && px(tokens, l.offsetY), b = l && px(tokens, l.blur), s = l && px(tokens, l.spread == null ? { value: 0, unit: 'px' } : l.spread);
      if (!c || c.colorSpace !== 'srgb' || !Array.isArray(c.components) || [x, y, b, s].some((n) => n === null)) return null;
      return [...c.components.map(r4), c.alpha == null ? 1 : r4(c.alpha), x, y, b, s, l.inset ? 1 : 0];
    });
    if (!fx.length || fx.some((f) => f === null)) { skipped.push({ path, reason: 'shadow-layer-unresolved' }); continue; }
    effectStyles.push({ name: 'shadow/' + key, fx, desc: desc(t) });
  }
  const own = new Set(textStyles.map((t) => t.name));
  for (const [name, base, td, tc] of [...variants].sort((a, b) => cmp(a[0], b[0]))) {
    const b = textStyles.find((t) => t.name === base);
    if (!b || own.has(name)) { skipped.push({ path: name, reason: b ? 'variant-name-taken' : 'variant-base-missing' }); continue; }
    own.add(name);
    const what = [td && td.toLowerCase(), tc !== (b.tc || 'ORIGINAL') && `case ${tc.toLowerCase()}`].filter(Boolean).join(', ');
    textStyles.push({ ...b, name, tc: tc === 'ORIGINAL' ? '' : tc, td: td || '', desc: [b.desc, `vuong-design variant of ${base}: ${what}`].filter(Boolean).join(' | ') });
  }
  skipped.sort((a, b) => cmp(a.path, b.path) || cmp(a.reason, b.reason));
  return { vars, textStyles, effectStyles, skipped };
}

export const varNames = (tokens) => varsPlan(tokens).vars.map((v) => v.name);

// ---- the code of a use_figma call (runtime): plain JS, no ??, ?. or ||=; __DATA__ is replaced by the batch data ----
const RUNTIME = `// vuong-design variables and styles (plan 3 Task 6). D: figma-vars.mjs header.
const D = __DATA__;
const F = figma, EPS = 0.0001, SC = ${JSON.stringify(SCOPE_SETS)};
const cnt = () => ({ created: 0, updated: 0, unchanged: 0 });
const R = { batch: D.n, collections: cnt(), variables: cnt(), textStyles: cnt(), effectStyles: cnt(),
  created: { collections: [], variables: [], textStyles: [], effectStyles: [] }, fontMissing: [], errors: [] };
if (D.skipped) R.skipped = D.skipped;
const near = (a, b) => Math.abs(a - b) <= EPS;
// R99: a variable or text style value change reflows the hug frames and texts that use it (sizes and positions move):
// that is this batch's change, not a hand edit. Before the first such change, the roots with a signature (screens,
// component variants) are checked with the sig of the installed screen runtime; after the changes the unedited ones get
// their signature again, an edited one keeps its old signature (still edited).
const NS = 'vuongdesign', AK = 'const screen=async sc=>{';
let PRE = null;
const pre = async () => {
  if (PRE) return;
  PRE = { ok: [], n: 0 };
  const rt = F.root.getSharedPluginData(NS, 'rt');
  if (!rt || !rt.includes(AK)) return;
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('D', 'figma', rt.replace(AK, 'if(D.rs)return D.rs(sig);' + AK))(
      { page: F.currentPage.name, screens: [], rs: (s) => { PRE.sig = s; } }, F);
  } catch (x) { err('signature', 'runtime', x); return; }
  if (!PRE.sig) return;
  for (const p of F.root.children) {
    await p.loadAsync();
    for (const c of p.children) for (const n of c.type === 'COMPONENT_SET' ? c.children : [c]) {
      const g = n.getSharedPluginData(NS, 'sig');
      if (!g) continue;
      PRE.n++;
      if (g === PRE.sig(n) || g === PRE.sig(n, 1)) PRE.ok.push(n);
    }
  }
};
const err = (kind, name, x) => R.errors.push({ kind, name, msg: String((x && x.message) || x).slice(0, 200) });
const tally = (k, name, made, changed, o) => {
  if (made) { R[k].created++; R.created[k].push({ name, id: o.id }); } else if (changed) R[k].updated++; else R[k].unchanged++;
};
const CL = new Map, VK = new Map, VN = new Map, seen = new Set;
for (const c of await F.variables.getLocalVariableCollectionsAsync()) if (!CL.has(c.name)) CL.set(c.name, c);
for (const v of await F.variables.getLocalVariablesAsync()) { VK.set(v.variableCollectionId + '|' + v.name, v); if (!VN.has(v.name)) VN.set(v.name, v); }
const coll = (i) => {
  const name = D.cn[i];
  let c = CL.get(name);
  if (!c) {
    c = F.variables.createVariableCollection(name);
    c.renameMode(c.modes[0].modeId, 'Value');
    CL.set(name, c); tally('collections', name, true, false, c); seen.add(name);
  } else if (!seen.has(name)) { seen.add(name); R.collections.unchanged++; }
  return c;
};
const same = (a, b) => {
  if (a === undefined || a === null) return false;
  if (b.type === 'VARIABLE_ALIAS') return a.type === b.type && a.id === b.id;
  if (typeof b === 'number') return typeof a === 'number' && near(a, b);
  return typeof a === 'object' && near(a.r, b.r) && near(a.g, b.g) && near(a.b, b.b) && near(a.a === undefined ? 1 : a.a, b.a);
};
for (const [name, ci, ty, val, si, desc] of D.v) {
  try {
    const c = coll(ci), mode = c.modes[0].modeId, scopes = SC[si], rt = ty === 0 ? 'COLOR' : 'FLOAT';
    let want = val;
    if (typeof val === 'string') {
      const t = VN.get(val);
      if (!t) throw new Error('alias target missing: ' + val);
      want = { type: 'VARIABLE_ALIAS', id: t.id };
    } else if (ty === 0) want = { r: val[0], g: val[1], b: val[2], a: val[3] };
    let v = VK.get(c.id + '|' + name), made = false, changed = false;
    if (!v) { v = F.variables.createVariable(name, c, rt); VK.set(c.id + '|' + name, v); if (!VN.has(name)) VN.set(name, v); made = true; }
    else if (v.resolvedType !== rt) throw new Error('exists as ' + v.resolvedType + ', needs ' + rt);
    if (made || !same(v.valuesByMode[mode], want)) { if (!made) await pre(); v.setValueForMode(mode, want); changed = true; }
    if (made || JSON.stringify(v.scopes) !== JSON.stringify(scopes)) { v.scopes = scopes; changed = true; }
    if (made || v.description !== desc) { v.description = desc; changed = true; }
    tally('variables', name, made, changed, v);
  } catch (x) { err('variable', name, x); }
}
// fonts: the face resolution of figma-runtime.js
const WN = 'Thin ExtraLight Light Regular Medium SemiBold Bold ExtraBold Black'.split(' '), WL = WN.map((x) => x.toLowerCase());
const AV = new Map, LD = new Set;
if (D.t.length) {
  for (const { fontName: f } of await F.listAvailableFontsAsync()) {
    const k = f.style.toLowerCase().replace(/[\\s_-]/g, ''), w = WL.indexOf(k.replace(/italic|oblique/, '') || 'regular') * 100 + 100;
    if (w) (AV.get(f.family) || AV.set(f.family, []).get(f.family)).push({ s: f.style, w, it: /italic|oblique/.test(k) });
  }
}
const load = async (f) => { const k = f.family + ' ' + f.style; if (!LD.has(k)) { await F.loadFontAsync(f); LD.add(k); } };
const TS = new Map, ES = new Map;
for (const s of await F.getLocalTextStylesAsync()) if (!TS.has(s.name)) TS.set(s.name, s);
for (const s of await F.getLocalEffectStylesAsync()) if (!ES.has(s.name)) ES.set(s.name, s);
for (const [name, ff, fw, it, fs, lh, ls, tc, desc, td] of D.t) {
  try {
    const fm = AV.has(ff) ? ff : 'Inter', want = !!it;
    const p = (AV.get(fm) || []).slice().sort((a, b) => (a.it !== want) - (b.it !== want) || Math.abs(a.w - fw) - Math.abs(b.w - fw))[0] || { s: 'Regular' };
    const face = { family: fm, style: p.s }, wanted = (WN[fw / 100 - 1] || fw) + (want ? ' Italic' : '');
    if (fm !== ff || p.w !== fw || p.it !== want) R.fontMissing.push({ style: name, family: ff, fontStyle: wanted, used: fm + ' ' + p.s });
    await load(face);
    let s = TS.get(name), made = !s, changed = false;
    if (made) { s = F.createTextStyle(); s.name = name; TS.set(name, s); }
    else { try { await load(s.fontName); } catch (x) {} }
    const lhv = lh ? { unit: lh[0] === 'p' ? 'PIXELS' : 'PERCENT', value: lh[1] } : { unit: 'AUTO' };
    const lsv = { unit: 'PIXELS', value: ls }, tcv = tc || 'ORIGINAL', tdv = td || 'NONE';
    const ops = [
      [() => s.fontName.family !== face.family || s.fontName.style !== face.style, () => { s.fontName = face; }],
      [() => s.fontSize !== fs, () => { s.fontSize = fs; }],
      [() => s.lineHeight.unit !== lhv.unit || (lhv.unit !== 'AUTO' && !near(s.lineHeight.value, lhv.value)), () => { s.lineHeight = lhv; }],
      [() => s.letterSpacing.unit !== 'PIXELS' || !near(s.letterSpacing.value, ls), () => { s.letterSpacing = lsv; }],
      [() => s.textCase !== tcv, () => { s.textCase = tcv; }],
      [() => s.textDecoration !== tdv, () => { s.textDecoration = tdv; }],
    ];
    for (const [c, f] of ops) if (made || c()) { if (!made) await pre(); f(); changed = true; }
    if (made || s.description !== desc) { s.description = desc; changed = true; }
    tally('textStyles', name, made, changed, s);
  } catch (x) { err('textStyle', name, x); }
}
const fxSame = (a, b) => a.length === b.length && a.every((e, i) => e.type === b[i].type && near(e.color.r, b[i].color.r) && near(e.color.g, b[i].color.g)
  && near(e.color.b, b[i].color.b) && near(e.color.a, b[i].color.a) && near(e.offset.x, b[i].offset.x) && near(e.offset.y, b[i].offset.y)
  && near(e.radius, b[i].radius) && near(e.spread || 0, b[i].spread) && e.visible !== false);
for (const [name, fx, desc] of D.e) {
  try {
    const want = fx.map((l) => ({ type: l[8] ? 'INNER_SHADOW' : 'DROP_SHADOW', color: { r: l[0], g: l[1], b: l[2], a: l[3] }, offset: { x: l[4], y: l[5] },
      radius: l[6], spread: l[7], visible: true, blendMode: 'NORMAL' }));
    let s = ES.get(name), made = !s, changed = false;
    if (made) { s = F.createEffectStyle(); s.name = name; ES.set(name, s); }
    if (made || !fxSame(s.effects, want)) { s.effects = want; changed = true; }
    if (made || s.description !== desc) { s.description = desc; changed = true; }
    tally('effectStyles', name, made, changed, s);
  } catch (x) { err('effectStyle', name, x); }
}
if (PRE && PRE.sig) {
  let k = 0;
  for (const n of PRE.ok) if (!n.removed) { const s = PRE.sig(n); if (s !== n.getSharedPluginData(NS, 'sig')) { n.setSharedPluginData(NS, 'sig', s); k++; } }
  R.signed = { roots: PRE.n, edited: PRE.n - PRE.ok.length, again: k };
}
return R;
`;

export function varsPayload(tokens, { limit = PAYLOAD_LIMIT, collections = {}, variants = [] } = {}) {
  const plan = varsPlan(tokens, variants);
  const cn = [collections.primitive || 'Primitive', collections.role || 'Role', ...(plan.vars.some((v) => v.coll === 2) ? [collections.state || 'State'] : [])];
  const items = [
    ...plan.vars.map((v) => ['v', JSON.stringify([v.name, v.coll, v.ty, v.val, v.sc, v.desc])]),
    ...plan.textStyles.map((t) => ['t', JSON.stringify([t.name, t.ff, t.fw, t.it, t.fs, t.lh, t.ls, t.tc, t.desc, ...(t.td ? [t.td] : [])])]),
    ...plan.effectStyles.map((e) => ['e', JSON.stringify([e.name, e.fx, e.desc])]),
  ];
  const [pre, post] = RUNTIME.split('__DATA__');
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  const make = (n, group, skipped) => {
    const by = (k) => group.filter((g) => g[0] === k).map((g) => g[1]).join(',');
    const D = `{"n":${n},"cn":${JSON.stringify(cn)},"v":[${by('v')}],"t":[${by('t')}],"e":[${by('e')}]${skipped.length ? ',"skipped":' + JSON.stringify(skipped) : ''}}`;
    return pre + D + post;
  };
  const out = [];
  let group = [];
  const flush = () => { if (group.length || (!out.length && plan.skipped.length)) out.push(make(out.length, group, out.length ? [] : plan.skipped)); group = []; };
  let size = bytes(make(0, [], plan.skipped));
  for (const it of items) {
    const b = bytes(it[1]) + 1;
    if (group.length && size + b > limit) { flush(); size = bytes(make(out.length, [], [])); }
    if (size + b > limit) throw new Error(`varsPayload: one item does not fit in ${limit} bytes: ${it[1].slice(0, 80)}`);
    group.push(it); size += b;
  }
  flush();
  out.forEach((c, i) => { if (bytes(c) > limit) throw new Error(`varsPayload: batch ${i} is ${bytes(c)} bytes (limit ${limit})`); });
  return out;
}
