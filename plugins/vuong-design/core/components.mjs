// Components (plan 3b Task 2): which subtrees of the target specs become Figma components, their variants and
// properties. Pure and deterministic: no browser, no model, no clock; the output does not depend on the order of
// screens.
//
// findComponents(screens: [{ screen: IR screen, spec: modelled SNode root }], { bareMin = 2, decl }) -> {
//   v: 1,
//   components: [{ name, kind, reason, key, count, screens, axes, props: [{ name, type, default }], icons?,
//                  variants: [{ props, template: { screen, node }, bind: { prop: path }, nested: { path: name },
//                               nodes: [{ screen, node, vals, ov? }] }], detached?: [{ screen, node, reason }] }],
//   proposed: [{ key, count, screens, nodes }], skipped: [{ key, count, reason, nodes? }], warnings: [string] }
//
// decl = readComponentsFile('vd-components.json'): what the user declared per base class (kind, extra state classes,
// modifier classes as variant axes, name, shapes, stateMap: { class: state id } read by states.mjs), bare groups to keep and component names to drop. Nothing is guessed: the
// corpus and the vd-html profile carry no role / aria / data-state / button / input (measured 2026-11-24), and
// Planora marks controls and states with short classes (btn, ck, tog, on, off, done), so kinds, extra states and
// modifiers only come from the declaration. componentsDraft() writes suggestions the user may copy.
//
// Identity of a source node: tag + its classes that are neither state classes (inventory STATE, or the `states`
// declared for its base class) nor declared modifier classes (`variants`). The base class is the first class (sorted)
// that has a declaration. An undeclared extra class is part of the identity, so `ck L` and `ck` stay two components
// until `L` is declared (each is still right on its own).
//
// Groups: a root with identity classes -> key `c:<identity>`; a bare root (tag only) -> key `b:<8 hex>` of its source
// parent's identity + its structural signature (t, lay.d, identity, syn kind, kids in order, recursively; never text,
// icon, size or colour). The parent is part of a bare key so unrelated bare blocks of the same shape do not merge.
//
// Selection (spec §10, no fixed count of occurrences or screens), reason per group:
//  - control: kind other than 'other' (tag button / input / select / textarea, or decl kind): even once, even 1 node.
//  - state:   some occurrence carries a state class.
//  - class:   identity classes, own paint (bg not transparent, a border > 0, shadow, bgImage) and >= 2 nodes.
//  - bare:    bare, >= bareMin occurrences, own paint, >= 2 nodes: `proposed`, a component only when decl.keep has
//             its key. The value is its name, or { name, kind?, stateMap? }: a bare block has no class to
//             declare, so its kind (other than 'other': a control, with that kind's state table) and its stateMap
//             ({ class: state id }, read by states.mjs) go on its keep entry.
//  Never: the screen root, synthetic frames, pseudo elements, a group whose occurrences are all 1 node (except
//  control). A dropped name (decl.drop) -> skipped 'user'. A class / bare group whose every occurrence lies inside an
//  occurrence of another component (not a mere proposal) with the same count -> skipped 'nested'. Control and state groups are always
//  their own component (a nested instance inside the outer one).
//
// Shapes: the occurrences of a group are clustered by structure within each variant (each joins the first, largest
// template it embeds in); structure may differ between variants. One shape per variant: built as below. More than one: only as the user chose for the base class (decl shapes):
// 'variants' -> one component set with an axis `shape` ('1', '2'... largest first); 'split' -> one component per
// shape index (`<name>-1`, key `<key>#1`...: the largest shape of each variant goes to -1); 'container' or no answer -> skipped 'shapes' (sizes per shape), built as
// layers, as plan 3 does. A card holding different content each time is such a container.
// Variants: axis `state` (state classes joined '+', none = 'default') when any occurrence has one, plus each
// declared modifier axis that is used (absent = 'default'). A different paint or text without a different class is an
// override (Task 5, see 'instances must rebuild their target' below), never a variant. Structure may differ between variants.
// Template of a variant: its occurrence with the most nodes (tie: first by screen, then cmpNodeId). Every other
// occurrence must embed in it: same t and lay.d at the root, its kids matching a subsequence of the template's kids in
// order by shallow key (t, lay.d, identity), recursively; a nested component occurrence matches another occurrence of
// the same component without looking inside. An occurrence that does not embed -> skipped 'structure' (built as
// layers).
// Properties, on the template, not inside nested instances: a text that differs -> TEXT; a template node missing
// in an occurrence whose parent is there -> BOOLEAN (`show-<name>`, default true); an icon ref that differs ->
// INSTANCE_SWAP (all refs in `icons`). Name = the node's first identity class, else text / icon / its tag; a name
// taken in the variant or by another type gets '-2', '-3'... Properties are merged by name over the variants; the
// default is the first variant's template value; `vals` on an occurrence lists only values that differ from it.
// Paths (bind, nested) are node ids relative to the occurrence root (`n.0.6.1` under `n.0.6` -> '1').
// Names: decl name, else the identity classes joined by '-'; a kept bare group takes its keep value; a bare control
// takes its tag; else cmp-<n>. A name used twice gets '-<tag>', then '-2'...
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { STATE, cmpNodeId } from './inventory.mjs';

export const COMPONENTS_VERSION = 1;
export const KINDS = ['button', 'input', 'checkbox', 'radio', 'switch', 'chip', 'tab', 'other'];
export const SHAPES = ['variants', 'split', 'container'];
const TAG_KIND = { button: 'button', input: 'input', select: 'input', textarea: 'input' };
const KIND_HINT = {
  btn: 'button', button: 'button', fab: 'button', ck: 'checkbox', check: 'checkbox', checkbox: 'checkbox',
  tog: 'switch', toggle: 'switch', switch: 'switch', radio: 'radio', chip: 'chip', tab: 'tab', input: 'input', field: 'input',
};
const STATE_WORDS = new Set(['done', 'off', 'checked', 'open', 'error', 'current', 'empty', 'invalid', 'pressed', 'loading', 'expanded', 'collapsed']);

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// a keep entry is a name or { name, kind?, stateMap? }
export const keepName = (v) => (typeof v === 'string' ? v : isObj(v) ? v.name : '');
const EMPTY = () => ({ version: COMPONENTS_VERSION, classes: {}, keep: {}, drop: [] });

// ---- declaration file ----------------------------------------------------------------------------------------------

export function readComponentsFile(path) {
  if (!path || !existsSync(path)) return EMPTY();
  let j;
  try {
    j = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`components file ${path}: not valid JSON (${e.message})`);
  }
  return checkDecl(j, `components file ${path}`);
}

function checkDecl(j, where) {
  const strs = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string' && x);
  if (!isObj(j)) throw new Error(`${where}: the top level must be an object`);
  for (const k of Object.keys(j)) if (!['version', 'classes', 'keep', 'drop', 'notes'].includes(k)) throw new Error(`${where}: unknown top-level key "${k}"`);
  if (j.version !== COMPONENTS_VERSION) throw new Error(`${where}: "version" is ${JSON.stringify(j.version)}, expected ${COMPONENTS_VERSION}`);
  const out = EMPTY();
  if (j.classes !== undefined && !isObj(j.classes)) throw new Error(`${where}: "classes" must be an object`);
  for (const [c, d] of Object.entries(j.classes || {})) {
    if (!isObj(d)) throw new Error(`${where}: classes.${c} must be an object`);
    for (const k of Object.keys(d)) if (!['kind', 'states', 'variants', 'name', 'shapes', 'stateMap'].includes(k)) throw new Error(`${where}: classes.${c}: unknown key "${k}"`);
    if (d.kind !== undefined && !KINDS.includes(d.kind)) throw new Error(`${where}: classes.${c}.kind "${d.kind}" is not one of ${KINDS.join(', ')}`);
    if (d.states !== undefined && !strs(d.states)) throw new Error(`${where}: classes.${c}.states must be a list of class names`);
    if (d.variants !== undefined && (!isObj(d.variants) || !Object.values(d.variants).every(strs))) throw new Error(`${where}: classes.${c}.variants must map an axis to a list of class names`);
    if (d.shapes !== undefined && !SHAPES.includes(d.shapes)) throw new Error(`${where}: classes.${c}.shapes "${d.shapes}" is not one of ${SHAPES.join(', ')}`);
    if (d.stateMap !== undefined && (!isObj(d.stateMap) || !Object.values(d.stateMap).every((v) => typeof v === 'string' && v))) throw new Error(`${where}: classes.${c}.stateMap must map a class to a state id (states.mjs STATE_TABLE)`);
    if (d.name !== undefined && (typeof d.name !== 'string' || !d.name)) throw new Error(`${where}: classes.${c}.name must be a non-empty string`);
    out.classes[c] = JSON.parse(JSON.stringify(d));
  }
  if (j.keep !== undefined && !isObj(j.keep)) throw new Error(`${where}: "keep" must map a bare key to a name or { name, kind?, stateMap? }`);
  for (const [k, v] of Object.entries(j.keep || {})) {
    if (typeof v === 'string' && v) continue;
    if (!isObj(v)) throw new Error(`${where}: keep.${k} must be a name or { name, kind?, stateMap? }`);
    for (const x of Object.keys(v)) if (!['name', 'kind', 'stateMap'].includes(x)) throw new Error(`${where}: keep.${k}: unknown key "${x}"`);
    if (typeof v.name !== 'string' || !v.name) throw new Error(`${where}: keep.${k}.name must be a non-empty string`);
    if (v.kind !== undefined && !KINDS.includes(v.kind)) throw new Error(`${where}: keep.${k}.kind "${v.kind}" is not one of ${KINDS.join(', ')}`);
    if (v.stateMap !== undefined && (!isObj(v.stateMap) || !Object.values(v.stateMap).every((m) => typeof m === 'string' && m))) throw new Error(`${where}: keep.${k}.stateMap must map a class to a state id (states.mjs STATE_TABLE)`);
  }
  if (j.drop !== undefined && !strs(j.drop)) throw new Error(`${where}: "drop" must be a list of component names`);
  out.keep = JSON.parse(JSON.stringify(j.keep || {}));
  out.drop = [...(j.drop || [])];
  return out;
}

// ---- tree records ---------------------------------------------------------------------------------------------------

const visualOf = (p) => {
  if (!p) return false;
  const bg = p.bg && p.bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(p.bg);
  const border = Array.isArray(p.border) && p.border.some((s) => s && s.w > 0);
  return !!(bg || border || (p.shadow && p.shadow !== 'none') || (p.bgImage && p.bgImage !== 'none'));
};
const textOf = (sn) => (sn.runs || []).map((r) => (r.br ? '\n' : r.t ?? '')).join('');
const hash8 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);

function identOf(sn, ir, decl, warn) {
  if (sn.syn) return { key: `syn:${sn.syn}`, rest: [], states: [], mods: {}, base: null, tag: '', special: true };
  if (!ir || ir.kind === 'pseudo' || /\.(a|b)$/.test(sn.id)) {
    return { key: /\.b$/.test(sn.id) ? '::before' : /\.a$/.test(sn.id) ? '::after' : '?', rest: [], states: [], mods: {}, base: null, tag: '', special: true };
  }
  const cls = [...new Set(String(ir.cls || '').split(/\s+/).filter(Boolean))].sort(cmpStr);
  const bases = cls.filter((c) => Object.hasOwn(decl.classes, c));
  if (bases.length > 1) warn(`classes ${bases.join(', ')} are all declared on one element; "${bases[0]}" is used as its base class`);
  const base = bases[0] || null;
  const dc = base ? decl.classes[base] : {};
  const states = cls.filter((c) => c !== base && (STATE.test(c) || (dc.states || []).includes(c)));
  const mods = {};
  for (const ax of Object.keys(dc.variants || {}).sort(cmpStr)) mods[ax] = cls.find((c) => c !== base && !states.includes(c) && dc.variants[ax].includes(c)) || 'default';
  const used = new Set(Object.values(mods));
  const rest = cls.filter((c) => !states.includes(c) && !used.has(c));
  return { key: [ir.tag || '', ...rest].join('.'), rest, states, mods, base, tag: ir.tag || '', special: false };
}

function records(list, decl, warn) {
  const all = [];
  for (const { screen, spec } of list) {
    const sid = String(screen.id ?? screen.name);
    const ir = new Map();
    const idx = (n) => { ir.set(n.id, n); (n.kids || []).forEach(idx); };
    if (screen.tree) idx(screen.tree);
    const rec = (sn, parent, depth) => {
      const r = { screen: sid, sn, parent, depth, ident: identOf(sn, sn.syn ? null : ir.get(sn.id), decl, warn) };
      r.kids = (sn.kids || []).map((k) => rec(k, r, depth + 1));
      r.size = 1 + r.kids.reduce((s, k) => s + k.size, 0);
      r.shallow = `${sn.t}|${(sn.lay && sn.lay.d) || ''}|${r.ident.key}`;
      r.sig = r.kids.length ? `${r.shallow}(${r.kids.map((k) => k.sig).join(',')})` : r.shallow;
      all.push(r);
      return r;
    };
    if (spec) rec(spec, null, 0);
  }
  return all;
}
const srcParent = (r) => { let p = r.parent; while (p && p.sn.syn) p = p.parent; return p; };
const cmpRec = (a, b) => cmpStr(a.screen, b.screen) || cmpNodeId(a.sn.id, b.sn.id);
const rel = (id, root) => (id === root ? '' : id.slice(root.length + 1));
const ref = (r) => ({ screen: r.screen, node: r.sn.id });

// ---- groups and selection -------------------------------------------------------------------------------------------

function groups(all, decl) {
  const by = new Map();
  for (const r of all) {
    if (!r.parent || r.ident.special) continue; // screen root, syn, pseudo
    const key = r.ident.rest.length ? `c:${r.ident.key}` : `b:${hash8(`${srcParent(r) ? srcParent(r).ident.key : ''}>${r.sig}`)}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const out = [];
  for (const key of [...by.keys()].sort(cmpStr)) {
    const occ = by.get(key).sort(cmpRec);
    const f = occ[0].ident;
    // a kept bare block declares its name, kind and stateMap on its keep entry
    const kv = key.startsWith('b:') ? decl.keep[key] : undefined;
    const dc = f.base ? decl.classes[f.base] : isObj(kv) ? kv : {};
    const kind = TAG_KIND[f.tag] || dc.kind || 'other';
    out.push({ key, occ, kind, bare: key.startsWith('b:'), ident: f, dc,
      hasState: occ.some((r) => r.ident.states.length), visual: occ.some((r) => visualOf(r.sn.paint)), big: occ.some((r) => r.size >= 2) });
  }
  return out;
}

function reasonOf(g, bareMin) {
  if (g.kind !== 'other') return 'control';
  if (!g.big) return null;
  if (g.hasState) return 'state';
  if (!g.bare && g.visual) return 'class';
  if (g.bare && g.visual && g.occ.length >= bareMin) return 'bare';
  return null;
}

export function findComponents(screens, opts = {}) {
  const decl = opts.decl ? checkDecl(opts.decl, 'components declaration') : EMPTY();
  const bareMin = opts.bareMin ?? 2;
  const warnings = new Set();
  const warn = (m) => warnings.add(m);
  const list = [...(screens || [])].sort((a, b) => cmpStr(String(a.screen.id ?? a.screen.name), String(b.screen.id ?? b.screen.name)));
  const all = records(list, decl, warn);

  const cand = [];
  for (const g of groups(all, decl)) {
    g.reason = reasonOf(g, bareMin);
    if (g.reason) cand.push(g);
  }
  // names
  const taken = new Map();
  for (const g of cand) {
    let name = g.dc.name || (g.bare ? keepName(decl.keep[g.key]) || (g.reason === 'control' ? g.ident.tag : '') : g.ident.rest.join('-'));
    if (!name) name = 'cmp';
    g.name0 = name;
    if (!taken.has(name)) taken.set(name, []);
    taken.get(name).push(g);
  }
  let n = 0;
  const final = new Set();
  for (const g of cand) {
    const same = taken.get(g.name0);
    let name = g.name0 === 'cmp' ? `cmp-${++n}` : g.name0;
    if (same.length > 1 && g.name0 !== 'cmp') name = `${g.name0}-${g.ident.tag || 'x'}`;
    let k = 2;
    while (final.has(name)) name = `${g.name0}-${k++}`;
    final.add(name);
    g.name = name;
  }
  const skipped = [];
  const dropped = new Set(decl.drop);
  for (const d of decl.drop) if (!cand.some((g) => g.name === d)) warn(`drop: no component named "${d}"`);
  for (const k of Object.keys(decl.keep)) if (!cand.some((g) => g.key === k)) warn(`keep: no bare group "${k}"`);
  for (const c of Object.keys(decl.classes)) if (!all.some((r) => r.ident.base === c)) warn(`classes: "${c}" is not on any element`);
  let live = cand.filter((g) => {
    if (!dropped.has(g.name)) return true;
    skipped.push({ key: g.key, count: g.occ.length, reason: 'user' });
    return false;
  });
  // A class / bare group whose every occurrence lies inside an occurrence of another component (not a mere proposal)
  // with the same count is nested. A group with more than one structure is built only as the user chose (decl
  // shapes), else as layers ('container'). Dropping a container makes its parents look inside it, which can split
  // them, and frees groups nested in it: repeat until no new container (containers only grow, so this ends).
  const isComp = (g) => g.reason !== 'bare' || Object.hasOwn(decl.keep, g.key);
  const inside = (r, set) => { for (let p = r.parent; p; p = p.parent) if (set.has(p)) return true; return false; };
  const mapOf = (list) => { const m = new Map(); for (const g of list) for (const r of g.occ) m.set(r, g); return m; };
  const containers = new Set();
  let comps, nested, instOf;
  for (;;) {
    const pool = live.filter((g) => !containers.has(g));
    const hosts = pool.filter(isComp);
    const occOf = new Map(hosts.map((h) => [h, new Set(h.occ)]));
    nested = new Set(pool.filter((g) => (g.reason === 'class' || g.reason === 'bare') &&
      hosts.some((h) => h !== g && h.occ.length === g.occ.length && g.occ.every((r) => inside(r, occOf.get(h))))));
    comps = pool.filter((g) => isComp(g) && !nested.has(g));
    instOf = mapOf(comps);
    for (const g of comps) g.shapeList = shapesOf(g.occ, instOf);
    const out = comps.filter((g) => g.shapeList.some((x) => x.idx > 1) && (g.dc.shapes || 'container') === 'container');
    if (!out.length) break;
    for (const g of out) containers.add(g);
  }
  for (const g of containers) skipped.push({ key: g.key, count: g.occ.length, reason: 'shapes', sizes: g.shapeList.map((x) => x.members.length) });
  for (const g of nested) skipped.push({ key: g.key, count: g.occ.length, reason: 'nested' });
  const proposed = live.filter((g) => !isComp(g) && !nested.has(g))
    .map((g) => ({ key: g.key, count: g.occ.length, screens: [...new Set(g.occ.map((r) => r.screen))], nodes: g.occ.map(ref) }));
  comps = comps.flatMap((g) => {
    const n = Math.max(...g.shapeList.map((x) => x.idx));
    if (n < 2 || g.dc.shapes !== 'split') return [g];
    return Array.from({ length: n }, (_, i) => g.shapeList.filter((x) => x.idx === i + 1).flatMap((x) => x.members)).map((m, i) => {
      let name = `${g.name}-${i + 1}`, k = 2;
      while (final.has(name)) name = `${g.name}-${i + 1}-${k++}`;
      final.add(name);
      return { ...g, key: `${g.key}#${i + 1}`, name, occ: [...m].sort(cmpRec) };
    });
  });
  instOf = mapOf(comps);

  const components = cascade(comps.map((g) => build(g, instOf, skipped)).filter(Boolean), skipped).sort((a, b) => cmpStr(a.name, b.name));
  skipped.sort((a, b) => cmpStr(a.key, b.key) || cmpStr(a.reason, b.reason));
  return { v: COMPONENTS_VERSION, components, proposed, skipped, warnings: [...warnings].sort(cmpStr) };
}

// ---- instances must rebuild their target (Task 5) -------------------------------------------------------------------
//
// An occurrence becomes an instance only if its variant's template + its property values (vals) + its overrides (ov)
// rebuild its own target spec. expandInstance() does what the Figma runtime will do; instanceDiff() compares the
// result with the target as plan 1 does (frames within 0.5 px, texts within 1 px, paint, type and icons equal).
// Overrides: { '<path>': { '<key>': value | null } } ('' = the root, paths relative to the template root as in
// `bind`; null deletes the key). Only OVERRIDABLE keys are written; any other difference stays and detaches the
// occurrence (`detached` on the component, with the reason): it is built as layers, as plan 3 does. Inside a nested
// instance nothing is compared (its own component checks it); an occurrence that holds a detached occurrence is
// detached too (Figma cannot detach a nested instance alone), and a template that holds one takes its whole variant
// with it. A component left with no occurrence is skipped 'detached'.
// The root's placement (abs.*) belongs to the instance node, not to the component, and is not compared; its size and
// sizing (w, h, sz, min, max, paint.pos) are the instance's own (overrides at '').
// Until the Figma probe (Task 1, cmpProps) says more, structure, layout direction, wrap, absolute placement, clip,
// transforms, image fills and icon refs (those go through INSTANCE_SWAP) are not overridable.
const OBJ_KEYS = new Set(['paint', 'font', 'icon', 'lay', 'abs']);
export const OVERRIDABLE = new Set([
  'w', 'h', 'sz', 'runs',
  'paint.bg', 'paint.radius', 'paint.border', 'paint.strokeOverlay', 'paint.opacity', 'paint.shadow', 'paint.textDecoration',
  'font.ff', 'font.fs', 'font.fw', 'font.fst', 'font.lh', 'font.ls', 'font.c', 'font.td', 'font.tt', 'font.ta', 'font.ws', 'font.remeasure',
  'icon.color', 'icon.fill', 'icon.stroke', 'icon.sw',
  'lay.p', 'lay.g', 'lay.cg', 'lay.pa', 'lay.ca', 'lay.sb',
]);
const ROOT_OWN = new Set(['w', 'h', 'sz', 'min', 'max', 'paint.pos']);
const GEO = new Set(['w', 'h', 'min', 'max', 'lay.p', 'lay.g', 'lay.cg', 'abs.x', 'abs.y', 'paint.radius', 'paint.border', 'font.lh']);
const TOL_FRAME = 0.5, TOL_TEXT = 1, TOL_EXACT = 1e-6;

function flat(sn) {
  const m = new Map();
  for (const [k, v] of Object.entries(sn)) {
    if (k === 'id' || k === 'kids' || v === undefined) continue;
    if (OBJ_KEYS.has(k) && isObj(v)) { for (const [s, x] of Object.entries(v)) if (x !== undefined) m.set(`${k}.${s}`, x); } else m.set(k, v);
  }
  return m;
}
function same(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i], tol));
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) return false;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k], tol)) return false;
    return true;
  }
  return a === b;
}
const tolOf = (key, sn) => (!GEO.has(key) ? TOL_EXACT : (key === 'w' || key === 'h') && sn.t === 'T' ? TOL_TEXT : TOL_FRAME);
const show = (v) => (v === undefined ? 'none' : JSON.stringify(v).slice(0, 60));
// keys that differ between a and b (b's type sets the tolerance); the root's placement is left out. w
// and h count only on an axis FIXED in both (HUG / FILL sizes are Figma's result, checked on the readback).
const fixedOn = (sn, i) => !Array.isArray(sn.sz) || sn.sz[i] === 'FIXED';
function diffKeys(a, b, root) {
  const fa = flat(a), fb = flat(b), out = [];
  for (const k of [...new Set([...fa.keys(), ...fb.keys()])].sort(cmpStr)) {
    if (root && k.startsWith('abs.')) continue;
    if ((k === 'w' || k === 'h') && !(fixedOn(a, k === 'w' ? 0 : 1) && fixedOn(b, k === 'w' ? 0 : 1))) continue;
    if (!same(fa.get(k), fb.get(k), tolOf(k, b))) out.push({ k, a: fa.get(k), b: fb.get(k) });
  }
  return out;
}
const textRuns = (s) => String(s).split('\n').flatMap((t, i) => (i ? [{ br: true }, ...(t ? [{ t }] : [])] : [{ t }]));
function setKey(sn, key, v) {
  const dot = key.indexOf('.');
  const k = dot < 0 ? key : key.slice(0, dot), s = dot < 0 ? null : key.slice(dot + 1);
  if (s === null) { if (v === null) delete sn[k]; else sn[k] = JSON.parse(JSON.stringify(v)); return; }
  if (v === null) { if (isObj(sn[k])) { delete sn[k][s]; if (!Object.keys(sn[k]).length) delete sn[k]; } return; }
  if (!isObj(sn[k])) sn[k] = {};
  sn[k][s] = JSON.parse(JSON.stringify(v));
}
const relId = (id, root) => (id === root ? '' : id.slice(root.length + 1));

// template spec subtree + { bind: { prop: path }, props: { prop: { type, default } }, vals, ov } -> the spec the instance
// will have (template ids). Every bound property is set: its value in vals, else its default (as Figma shows it).
export function expandInstance(tpl, { bind = {}, props = {}, vals = {}, ov = {} } = {}) {
  const root = JSON.parse(JSON.stringify(tpl));
  const at = new Map();
  const idx = (n, parent) => { at.set(rel(n.id, root.id), { n, parent }); (n.kids || []).forEach((k) => idx(k, n)); };
  idx(root, null);
  const hide = [];
  for (const name of Object.keys(bind)) {
    const x = at.get(bind[name]);
    if (!x) throw new Error(`property ${name}: no node at "${bind[name]}"`);
    const type = props[name] && props[name].type;
    const v = Object.hasOwn(vals, name) ? vals[name] : props[name] && props[name].default;
    if (v === undefined) continue;
    if (type === 'TEXT') x.n.runs = textRuns(v);
    else if (type === 'INSTANCE_SWAP') x.n.icon = { ...(x.n.icon || {}), ref: v };
    else if (type === 'BOOLEAN') { if (v === false) hide.push(x); } else throw new Error(`property ${name}: unknown type ${type}`);
  }
  for (const [path, keys] of Object.entries(ov)) {
    const x = at.get(path);
    if (!x) throw new Error(`override: no node at "${path}"`);
    for (const [k, v] of Object.entries(keys)) setKey(x.n, k, v);
  }
  for (const x of hide) if (x.parent) x.parent.kids = x.parent.kids.filter((k) => k !== x.n);
  for (const { n } of at.values()) if (n.kids && !n.kids.length) delete n.kids;
  return root;
}

// expanded instance vs target subtree -> [{ path, key, a, b }] (a: the instance, b: the target); nested: { path: name }
export function instanceDiff(exp, target, { nested = {} } = {}) {
  const out = [];
  const go = (a, b, root) => {
    const path = rel(a.id, exp.id);
    if (!root && Object.hasOwn(nested, path)) return;
    for (const d of diffKeys(a, b, root)) if (!(root && ROOT_OWN.has(d.k))) out.push({ path, key: d.k, a: d.a, b: d.b });
    const ka = a.kids || [], kb = b.kids || [];
    if (ka.length !== kb.length) { out.push({ path, key: 'kids', a: ka.length, b: kb.length }); return; }
    ka.forEach((k, i) => go(k, kb[i], false));
  };
  go(exp, target, true);
  return out;
}

// the overrides that turn the template + vals into the target, and what they cannot cover (diff, empty when it rebuilds)
export function instanceOf(tpl, target, { bind = {}, props = {}, vals = {}, nested = {} } = {}) {
  const base = expandInstance(tpl, { bind, props, vals });
  const ov = {};
  const go = (a, b, root) => {
    const path = rel(a.id, base.id);
    if (!root && Object.hasOwn(nested, path)) return;
    for (const d of diffKeys(a, b, root)) {
      if (!OVERRIDABLE.has(d.k) && !(root && ROOT_OWN.has(d.k))) continue;
      (ov[path] ||= {})[d.k] = d.b === undefined ? null : d.b;
    }
    const ka = a.kids || [], kb = b.kids || [];
    if (ka.length === kb.length) ka.forEach((k, i) => go(k, kb[i], false));
  };
  go(base, target, true);
  const sorted = {};
  for (const p of Object.keys(ov).sort((x, y) => cmpNodeId(x ? `r.${x}` : 'r', y ? `r.${y}` : 'r'))) sorted[p] = ov[p];
  const diff = instanceDiff(expandInstance(tpl, { bind, props, vals, ov: sorted }), target, { nested });
  return { ov: sorted, diff };
}
export const diffReason = (diff) => diff.slice(0, 3).map((d) => `${d.path || 'root'} ${d.key}: ${show(d.a)} in the component, ${show(d.b)} here${d.key === 'kids' ? ' (children)' : OVERRIDABLE.has(d.key) ? '' : ' (not overridable)'}`).join('; ') + (diff.length > 3 ? `; +${diff.length - 3} more` : '');

// an occurrence holding a detached occurrence is detached; a template holding one takes its variant (repeat)
function cascade(components, skipped) {
  const det = [];
  for (const c of components) for (const d of c.detached) det.push(d);
  const holds = (x) => det.find((d) => d.screen === x.screen && d.node.startsWith(`${x.node}.`)) || null;
  for (let changed = true; changed;) {
    changed = false;
    for (const c of components) {
      const keep = [];
      for (const v of c.variants) {
        const t = holds(v.template);
        if (t) {
          for (const x of v.nodes) {
            const d = { screen: x.screen, node: x.node, reason: `the template ${v.template.screen} ${v.template.node} holds detached ${t.screen} ${t.node}` };
            c.detached.push(d);
            det.push(d);
          }
          changed = true;
          continue;
        }
        v.nodes = v.nodes.filter((x) => {
          const h = holds(x);
          if (!h) return true;
          const d = { screen: x.screen, node: x.node, reason: `holds detached ${h.screen} ${h.node}` };
          c.detached.push(d);
          det.push(d);
          changed = true;
          return false;
        });
        if (v.nodes.length) keep.push(v);
      }
      c.variants = keep;
    }
  }
  const out = [];
  for (const c of components) {
    c.detached.sort((a, b) => cmpStr(a.screen, b.screen) || cmpNodeId(a.node, b.node));
    const used = c.variants.flatMap((v) => v.nodes);
    if (!used.length) { skipped.push({ key: c.key, count: c.detached.length, reason: 'detached', nodes: c.detached.map((d) => ({ screen: d.screen, node: d.node })) }); continue; }
    c.count = used.length;
    c.screens = [...new Set(used.map((x) => x.screen))];
    if (!c.detached.length) delete c.detached;
    out.push(c);
  }
  return out;
}

// ---- one component: variants, templates, properties ---------------------------------------------------------------

function embed(a, b, map, root, instOf) {
  if (root) {
    if (a.sn.t !== b.sn.t || ((a.sn.lay && a.sn.lay.d) || '') !== ((b.sn.lay && b.sn.lay.d) || '')) return false;
  } else if (a.shallow !== b.shallow) return false;
  map.set(a, b);
  if (!root && instOf.has(a)) return instOf.get(b) === instOf.get(a);
  let j = 0;
  for (const kb of b.kids) {
    while (j < a.kids.length && a.kids[j].shallow !== kb.shallow) j++;
    if (j === a.kids.length || !embed(a.kids[j], kb, map, false, instOf)) return false;
    j++;
  }
  return true;
}

// occurrences clustered by structure within each variant (state classes + modifier classes; structure may differ
// between variants), largest first: each joins the first shape whose template (its first, largest member) it embeds
// in. Returns [{ idx (1-based within its variant), members }], variants in key order.
const partOf = (r) => JSON.stringify([r.ident.states.join('+'), r.ident.mods]);
function shapesOf(occ, instOf) {
  const byPart = new Map();
  for (const r of [...occ].sort((x, y) => y.size - x.size || cmpRec(x, y))) {
    const k = partOf(r);
    if (!byPart.has(k)) byPart.set(k, []);
    const list = byPart.get(k);
    const m = list.find((sh) => embed(sh[0], r, new Map(), true, instOf));
    if (m) m.push(r); else list.push([r]);
  }
  return [...byPart.keys()].sort(cmpStr).flatMap((k) => byPart.get(k).map((members, i) => ({ idx: i + 1, members })));
}

function build(g, instOf, skipped) {
  const stateAxis = g.occ.some((r) => r.ident.states.length);
  const modAxes = Object.keys(g.dc.variants || {}).sort(cmpStr).filter((ax) => g.occ.some((r) => (r.ident.mods[ax] || 'default') !== 'default'));
  // shapes: occurrences clustered by structure, largest first; each joins the first shape whose template it embeds in
  const shapes = shapesOf(g.occ, instOf), shapeOf = new Map();
  for (const x of shapes) for (const r of x.members) shapeOf.set(r, String(x.idx));
  const shapeAxis = shapes.some((x) => x.idx > 1);
  const axes = [...(shapeAxis ? ['shape'] : []), ...(stateAxis ? ['state'] : []), ...modAxes];
  const vkey = (r) => {
    const p = {};
    if (shapeAxis) p.shape = shapeOf.get(r);
    if (stateAxis) p.state = r.ident.states.length ? r.ident.states.join('+') : 'default';
    for (const ax of modAxes) p[ax] = r.ident.mods[ax] || 'default';
    return p;
  };
  const byV = new Map();
  for (const r of g.occ) {
    const p = vkey(r), k = JSON.stringify(p);
    if (!byV.has(k)) byV.set(k, { props: p, occ: [] });
    byV.get(k).occ.push(r);
  }
  const registry = new Map(); // name -> { type, default }
  const props = [];
  const icons = new Set();
  const bad = [];
  const variants = [];
  const detached = [];
  for (const k of [...byV.keys()].sort(cmpStr)) {
    const v = byV.get(k);
    const tpl = v.occ.reduce((a, b) => (b.size > a.size ? b : a));
    const maps = new Map();
    for (const r of v.occ) {
      const m = new Map();
      if (r === tpl || embed(tpl, r, m, true, instOf)) maps.set(r, r === tpl ? null : m);
      else bad.push(r);
    }
    if (!maps.size) continue;
    const at = (r, node) => (maps.get(r) === null ? node : maps.get(r).get(node));
    const occ = [...maps.keys()];
    const root = tpl.sn.id;
    const bind = {}, nested = {}, vals = new Map(occ.map((r) => [r, {}]));
    const used = new Set();
    const nameFor = (base, type) => {
      let name = base, i = 2;
      while (used.has(name) || (registry.has(name) && registry.get(name).type !== type)) name = `${base}-${i++}`;
      used.add(name);
      return name;
    };
    const addProp = (node, type, base, valueOf) => {
      const name = nameFor(base, type);
      const def = registry.has(name) ? registry.get(name).default : valueOf(tpl, node);
      if (!registry.has(name)) { registry.set(name, { type, default: def }); props.push({ name, type, default: def }); }
      bind[name] = rel(node.sn.id, root);
      for (const r of occ) {
        const x = valueOf(r, at(r, node));
        if (x !== def) vals.get(r)[name] = x;
      }
    };
    const walk = (node) => {
      const isRoot = node === tpl;
      const inst = !isRoot && instOf.has(node);
      const base = node.ident.rest[0] || (node.sn.t === 'T' ? 'text' : node.sn.t === 'V' ? 'icon' : node.ident.tag || 'node');
      if (inst) nested[rel(node.sn.id, root)] = instOf.get(node).name;
      if (!isRoot) {
        const miss = occ.filter((r) => !at(r, node));
        if (miss.length && miss.every((r) => at(r, node.parent))) addProp(node, 'BOOLEAN', `show-${base}`, (r, x) => !!x);
      }
      if (inst) return;
      const present = occ.filter((r) => at(r, node));
      if (node.sn.t === 'T' && new Set(present.map((r) => textOf(at(r, node).sn))).size > 1) {
        addProp(node, 'TEXT', base, (r, x) => (x ? textOf(x.sn) : undefined));
      }
      if (node.sn.icon && new Set(present.map((r) => at(r, node).sn.icon && at(r, node).sn.icon.ref)).size > 1) {
        for (const r of present) icons.add(at(r, node).sn.icon.ref);
        addProp(node, 'INSTANCE_SWAP', base, (r, x) => (x && x.sn.icon ? x.sn.icon.ref : undefined));
      }
      node.kids.forEach(walk);
    };
    walk(tpl);
    for (const r of occ) for (const [name, x] of Object.entries(vals.get(r))) if (x === undefined) delete vals.get(r)[name];
    // Task 5: each occurrence (the template too) must rebuild from the component, else it is detached
    const propsOf = Object.fromEntries([...registry].map(([name, x]) => [name, { type: x.type, default: x.default }]));
    const nodes = [];
    for (const r of occ) {
      const { ov, diff } = instanceOf(tpl.sn, r.sn, { bind, props: propsOf, vals: vals.get(r), nested });
      if (diff.length) { detached.push({ ...ref(r), reason: diffReason(diff) }); continue; }
      nodes.push(Object.keys(ov).length ? { ...ref(r), vals: vals.get(r), ov } : { ...ref(r), vals: vals.get(r) });
    }
    if (nodes.length) variants.push({ props: v.props, template: ref(tpl), bind, nested, nodes });
  }
  if (bad.length) skipped.push({ key: g.key, count: bad.length, reason: 'structure', nodes: bad.map(ref) });
  if (!variants.length) {
    if (detached.length) skipped.push({ key: g.key, count: detached.length, reason: 'detached', nodes: detached.map((d) => ({ screen: d.screen, node: d.node })) });
    return null;
  }
  const used = variants.flatMap((v) => v.nodes);
  const out = { name: g.name, kind: g.kind, reason: g.reason, key: g.key, count: used.length,
    screens: [...new Set(used.map((x) => x.screen))], axes, props, variants, detached };
  if (icons.size) out.icons = [...icons].sort(cmpStr);
  return out;
}

// ---- draft of the declaration file --------------------------------------------------------------------------------

export function componentsDraft(screens, opts = {}) {
  const list = [...(screens || [])].sort((a, b) => cmpStr(String(a.screen.id ?? a.screen.name), String(b.screen.id ?? b.screen.name)));
  const all = records(list, EMPTY(), () => {});
  const info = new Map();
  for (const r of all) {
    if (!r.parent || r.ident.special) continue;
    const ir = r.ident;
    for (const c of ir.rest) {
      if (!info.has(c)) info.set(c, { roots: 0, screens: new Set(), alone: false, extras: new Set(), visual: false, state: false });
      const e = info.get(c);
      e.roots++;
      e.screens.add(r.screen);
      if (ir.rest.length === 1) e.alone = true;
      for (const x of ir.rest) if (x !== c) e.extras.add(x);
      if (visualOf(r.sn.paint)) e.visual = true;
      if (ir.states.length) e.state = true;
    }
  }
  const out = { version: COMPONENTS_VERSION, classes: {}, keep: {}, drop: [], notes: {} };
  for (const c of [...info.keys()].sort(cmpStr)) {
    const e = info.get(c);
    if (!e.alone || !(e.visual || e.state || KIND_HINT[c])) continue;
    const extras = [...e.extras].filter((x) => !(info.get(x) && info.get(x).alone)).sort(cmpStr);
    const d = { kind: KIND_HINT[c] || 'other' };
    const st = extras.filter((x) => STATE_WORDS.has(x)), mo = extras.filter((x) => !STATE_WORDS.has(x));
    if (st.length) d.states = st;
    if (mo.length) d.variants = { variant: mo };
    out.classes[c] = d;
    const sc = [...e.screens].sort(cmpStr);
    out.notes[`cls:${c}`] = `${e.roots} roots on ${sc.length} screen${sc.length === 1 ? '' : 's'} (${sc.join(', ')})` +
      (e.extras.size ? `; seen with: ${[...e.extras].sort(cmpStr).join(', ')}` : '') +
      (KIND_HINT[c] ? `; kind suggested from the class name` : '');
  }
  const found = findComponents(screens, { bareMin: opts.bareMin });
  for (const sk of found.skipped.filter((x) => x.reason === 'shapes')) {
    const c = sk.key.startsWith('c:') ? sk.key.slice(2).split('.').slice(1) : [];
    const note = `${sk.sizes.length} shapes (occurrences per shape: ${sk.sizes.join(', ')}); set "shapes" to "variants" (one component set), "split" (one component each) or "container" (layers)`;
    if (c.length === 1 && out.classes[c[0]]) { out.classes[c[0]].shapes = 'container'; out.notes[`cls:${c[0]}`] += `; ${note}`; }
    else out.notes[sk.key] = note;
  }
  for (const p of found.proposed) {
    out.notes[p.key] = `${p.count} bare blocks on ${p.screens.join(', ')} (${p.nodes.slice(0, 3).map((x) => `${x.screen} ${x.node}`).join('; ')}${p.count > 3 ? '; ...' : ''}); add "${p.key}": "<name>" (or { "name": "<name>", "kind": "<kind>" }) to keep to make it a component`;
  }
  return out;
}
