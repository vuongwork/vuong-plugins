// Verify layers 1-3 (spec §14). Two proxies are compared with the source HTML, node by node, at widths A and B:
//  - layout: renderProxy of the inferred spec WITHOUT applyFigmaModel (pure auto-layout semantics). Its deviations
//    are layout errors and give the roots.
//  - proxy: renderProxy of the modelled spec (after applyFigmaModel), i.e. what Figma will produce. A node outside
//    tolerance here but within tolerance in the layout comparison deviates because of the Figma model: it is listed in
//    `modelDeltas` (explainedBy 'figmaModel', with magnitude) for the normalisation report, never as a root.
//    Colours, text, icons and fonts are read from this proxy's DOM. Crops are taken from the layout proxy: the content
//    is the same (the model only resizes text boxes; fonts are already substituted in capture) and the model's
//    glyph shifts inside a box, reported in modelDeltas, would otherwise exceed the 1px crop search.
// Nothing is skipped silently: a node that cannot be compared is `unchecked` (with a reason) and fails the screen; a
// layer that was not run is in `skipped` and fails the screen.
//
// Layer 1, coverage: total = source INodes in the screen tree (syn frames `<id>.g<k>` are not source nodes; nodes
//   capture excluded are listed by capture with reasons and are not in the tree). checked = nodes with a source box,
//   a layout box and a proxy box at both widths.
// Layer 2, position: d = box - source box ([dx, dy, dw, dh], CSS px, relative to the root). A node is within
//   tolerance when |d| <= tol (tolText for text, i.e. kind 'text' and pseudo text that infer turns into a text node;
//   tolFrame for everything else). Invariant: every node outside tolerance is attributed to a root in itself, an
//   ancestor or an earlier sibling, and a reference counts only if it really moved (its own edge delta is beyond tol);
//   otherwise the node is a root. Per axis:
//    - size is inherited when |dw| <= tol, or the node is FILL (spec sizing) and its nearest source ancestor's size
//      moved the same way by at least as much, or the node is FILL and non-FILL siblings' size changes it absorbs
//      account for it, or the node is HUG and its size change equals the extent change of its grounded children
//      (non-FILL, not positioned from this node's far/middle edge). So a wrongly sized parent whose FILL children
//      absorb the change is the root, not its children; and a hugging frame around a wrong child is not a second root.
//    - position is inherited when one of its edges (near, far, middle) is within tol of 0, or matches a moved edge of
//      the nearest source ancestor (near, far, middle) or of the previous source sibling (near, far).
//   Small offsets cannot add up unseen: the first node whose offset exceeds tol while its references stayed within
//   tol is a root. root.why lists the axes: x/y position, w/h size.
//   Flags (R12): a node's own flag explains its root; an ancestor's flag explains a descendant root only if that
//   ancestor is itself outside tolerance at that width and the flag is not text-only (mixedRunHeight).
//   fontSubstitution explains nothing (R10: capture measures the source in the Figma font). On a screen flagged
//   unsafeWiden, roots at width B are `unchecked` (reason unsafeWiden), never explained.
// Layer 3, content (modelled proxy):
//   data: text (proxy DOM text vs source runs, whitespace normalised), icon (proxy <use> ref / glyph / inline svg),
//   font (expected = the Figma family of the modelled spec, actual = the family the proxy DOM computed; a family in
//   fontsMissing did not render; a screen.fontSubs entry 'override-failed' is a mismatch on the root), color (text:
//   source computed colour vs proxy computed colour; other nodes: source computed background colour, transparent if
//   none, vs proxy computed background colour).
//   crops: input.crops = [{id, width, ratio, diff, peak}] from measureCrops at A and B on source nodes whose box has
//   area <= 4000px². Fails when ratio (differing / ink pixels) > 0.05 or peak (differing pixels in the densest
//   8x8 CSS px square) >= 40. A failure on a node that is (inside) a raster node is in `cropExplained`.
// pixel (whole screen, modelled proxy) and strict (share of checked nodes within tolerance, modelled) are reference.
import { firstFamily } from './font-map.mjs';
import { cropDiffMany, pixelDiff } from './imgdiff.mjs';

const TOL_FRAME = 0.5;
const TOL_TEXT = 1;
const CROP_RATIO = 0.05;
const CROP_PEAK = 40;
const CROP_MAX_AREA = 4000;
const EPS = 1e-6;
const W = ['A', 'B'];
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const SELF_ONLY = new Set(['mixedRunHeight']);
const NEVER_EXPLAINS = new Set(['fontSubstitution', 'unsafeWiden']);

const isTextSrc = (n) => !n.icon && (n.kind === 'text' || (n.kind === 'pseudo' && !!n.runs));
const runsText = (runs) => (runs || []).map((r) => (r.br ? '\n' : r.t ?? '')).join('');
const normWs = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const iconKey = (ic) => (!ic ? null : ic.ref ? ic.ref : ic.glyph != null ? `glyph:${ic.glyph}` : ic.svg ? 'svg' : null);
const domIcon = (d) => (!d ? null : d.icon ? d.icon : d.text != null ? `glyph:${d.text.trim()}` : null);
// computed CSS colour -> canonical 'rgb(r, g, b)' / 'rgba(r, g, b, a)' / 'transparent'
export function normColor(c) {
  if (c == null || c === '' || c === 'transparent') return 'transparent';
  const m = /rgba?\(([^)]+)\)/.exec(String(c));
  if (!m) return String(c).trim();
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const a = v.length > 3 ? v[3] : 1;
  if (a === 0) return 'transparent';
  return a === 1 ? `rgb(${v[0]}, ${v[1]}, ${v[2]})` : `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${r3(a)})`;
}

// Source nodes in pre-order with their source parent and previous source sibling.
function flatten(tree) {
  const out = [];
  const v = (n, parent, prev) => {
    const e = { n, parent, prev }; out.push(e);
    let p = null;
    for (const k of n.kids || []) p = v(k, e, p);
    return e;
  };
  v(tree, null, null);
  return out;
}

export function verifyScreen(input, opts = {}) {
  const tolFrame = opts.tolFrame ?? TOL_FRAME, tolText = opts.tolText ?? TOL_TEXT;
  const cropRatio = opts.cropRatio ?? CROP_RATIO, cropPeak = opts.cropPeak ?? CROP_PEAK;
  const { screen, spec, proxy, layout, flags = [], crops, pixel = null } = input;
  const skipped = [];
  if (!layout) skipped.push('layout');

  const specById = new Map();
  const indexSpec = (s) => { if (!s.syn) specById.set(s.id, s); (s.kids || []).forEach(indexSpec); };
  if (spec) indexSpec(spec);
  const flagsById = new Map();
  for (const f of flags) { if (!flagsById.has(f.id)) flagsById.set(f.id, []); flagsById.get(f.id).push(f.kind); }
  const unsafeWiden = flags.some((f) => f.kind === 'unsafeWiden');

  const list = flatten(screen.tree);
  const byId = new Map(list.map((e) => [e.n.id, e]));
  const tolOf = (n) => (isTextSrc(n) ? tolText : tolFrame);
  const src = (n, M) => (M === 'A' ? n.rA : n.rB);

  // ---- layer 1 + deltas ----
  const MD = { A: new Map(), B: new Map() }; // modelled proxy - source
  const LD = { A: new Map(), B: new Map() }; // layout proxy - source
  const unchecked = []; const uncheckedReasons = {};
  const uncheck = (id, why) => {
    if (!uncheckedReasons[id]) { unchecked.push(id); uncheckedReasons[id] = why; } else uncheckedReasons[id] += `; ${why}`;
  };
  const sub = (p, s) => [0, 1, 2, 3].map((i) => r2(p[i] - s[i]));
  for (const { n } of list) {
    const why = [];
    for (const M of W) {
      const s = src(n, M);
      const p = proxy[M] && proxy[M].boxes ? proxy[M].boxes[n.id] : null;
      const l = layout && layout[M] && layout[M].boxes ? layout[M].boxes[n.id] : null;
      if (!s) why.push(`no source box at ${M}`);
      if (!p) why.push(`no proxy box at ${M}`);
      if (layout && !l) why.push(`no layout box at ${M}`);
      if (s && p) MD[M].set(n.id, sub(p, s));
      if (s && l) LD[M].set(n.id, sub(l, s));
    }
    if (why.length) uncheck(n.id, why.join('; '));
  }
  const within = (n, d) => !!d && d.every((v) => Math.abs(v) <= tolOf(n) + EPS);

  // ---- layer 2: roots from the layout comparison ----
  const roots = [];
  for (const M of layout ? W : []) {
    const D = LD[M];
    const ancestor = (e) => { let a = e.parent; while (a && !D.has(a.n.id)) a = a.parent; return a; };
    const prevOf = (e) => { let p = e.prev; while (p && !D.has(p.n.id)) p = p.prev; return p; };
    const sz = (id, ax) => { const s = specById.get(id); return s && s.sz ? s.sz[ax] : null; };
    const edges = (d, ax) => [d[ax], d[ax] + d[ax + 2], d[ax] + d[ax + 2] / 2]; // near, far, middle
    const posOK = (e, ax, withParentFar) => {
      const t = tolOf(e.n), mine = edges(D.get(e.n.id), ax);
      if (mine.some((v) => Math.abs(v) <= t + EPS)) return true;
      const refs = [];
      const a = ancestor(e);
      if (a) { const pe = edges(D.get(a.n.id), ax); refs.push(pe[0]); if (withParentFar) refs.push(pe[1], pe[2]); }
      const p = prevOf(e);
      if (p) { const se = edges(D.get(p.n.id), ax); refs.push(se[0], se[1]); }
      return refs.filter((r) => Math.abs(r) > t + EPS).some((r) => mine.some((v) => Math.abs(v - r) <= t + EPS));
    };
    const sizeOK = (e, ax) => {
      const d = D.get(e.n.id), t = tolOf(e.n), dz = d[ax + 2];
      if (Math.abs(dz) <= t + EPS) return true;
      const me = sz(e.n.id, ax);
      const a = ancestor(e);
      if (me === 'FILL' && a) {
        const pz = D.get(a.n.id)[ax + 2];
        if (Math.abs(pz) > tolOf(a.n) + EPS && Math.sign(pz) === Math.sign(dz) && Math.abs(dz) <= Math.abs(pz) + t + EPS) return true;
        // absorbs size changes of non-FILL siblings (the sibling is attributed on its own)
        const sib = (a.n.kids || []).filter((k) => k.id !== e.n.id && D.has(k.id) && sz(k.id, ax) !== 'FILL');
        const moved = sib.map((k) => D.get(k.id)[ax + 2]).filter((v) => Math.abs(v) > t + EPS);
        const sum = moved.reduce((x, y) => x + y, 0);
        if (moved.length && Math.sign(sum) === -Math.sign(dz) && Math.abs(dz) <= Math.abs(sum) + t + EPS) return true;
      }
      if (me === 'HUG' && (e.n.kids || []).length) {
        const ks = e.n.kids.filter((k) => D.has(k.id) && sz(k.id, ax) !== 'FILL' && posOK(byId.get(k.id), ax, false));
        if (ks.length) {
          const ext = (boxes) => Math.max(...boxes.map((b) => b[ax] + b[ax + 2])) - Math.min(...boxes.map((b) => b[ax]));
          const dU = ext(ks.map((k) => layout[M].boxes[k.id])) - ext(ks.map((k) => src(k, M)));
          if (Math.abs(dz - dU) <= t + EPS) return true;
        }
      }
      return false;
    };
    const outside = (id) => !within(byId.get(id).n, D.get(id));
    const explain = (e) => {
      for (let a = e, self = true; a; a = a.parent, self = false) {
        if (!self && (!D.has(a.n.id) || !outside(a.n.id))) continue;
        for (const k of flagsById.get(a.n.id) || []) {
          if (NEVER_EXPLAINS.has(k) || (!self && SELF_ONLY.has(k))) continue;
          return k;
        }
      }
      return null;
    };
    for (const e of list) {
      if (!D.has(e.n.id) || !outside(e.n.id)) continue;
      const why = [];
      for (const ax of [0, 1]) {
        if (!sizeOK(e, ax)) why.push(ax ? 'h' : 'w');
        else if (!posOK(e, ax, true)) why.push(ax ? 'y' : 'x');
      }
      if (!why.length) continue;
      const root = { id: e.n.id, width: M, delta: D.get(e.n.id), why };
      if (M === 'B' && unsafeWiden) { uncheck(e.n.id, `unsafeWiden: deviates at B (${why.join(',')})`); continue; }
      const by = explain(e);
      if (by) root.explainedBy = by;
      roots.push(root);
    }
  }

  // ---- Figma-model deltas: outside tolerance in the modelled proxy only ----
  const modelDeltas = [];
  for (const M of layout ? W : []) {
    for (const { n } of list) {
      const md = MD[M].get(n.id), ld = LD[M].get(n.id);
      if (md && ld && !within(n, md) && within(n, ld)) {
        modelDeltas.push({ id: n.id, width: M, delta: md, magnitude: r2(Math.max(...md.map(Math.abs))), explainedBy: 'figmaModel' });
      }
    }
  }

  // ---- layer 3: data (observed in the modelled proxy DOM at A) ----
  const data = [];
  for (const f of screen.fontSubs || []) {
    if (f.reason === 'override-failed') data.push({ id: screen.tree.id, kind: 'font', expected: f.to, actual: `${f.from} (override-failed)` });
  }
  const dom = proxy.A && proxy.A.dom;
  if (!dom) skipped.push('data');
  const missing = new Set([...(proxy.A?.fontsMissing || []), ...(proxy.B?.fontsMissing || [])]);
  for (const { n } of dom ? list : []) {
    const d = dom[n.id];
    if (!d) continue; // no proxy node: already unchecked
    const s = specById.get(n.id);
    if (isTextSrc(n)) {
      const expected = normWs(runsText(n.runs)), actual = normWs(d.text);
      if (expected !== actual) data.push({ id: n.id, kind: 'text', expected, actual });
      if (n.font) {
        const expected = normColor(n.font.c), actual = normColor(d.color);
        if (expected !== actual) data.push({ id: n.id, kind: 'color', expected, actual });
      }
    } else {
      const expected = normColor(n.paint && n.paint.bg), actual = normColor(d.bg);
      if (expected !== actual) data.push({ id: n.id, kind: 'color', expected, actual });
    }
    if (n.kind === 'icon') {
      const expected = iconKey(n.icon), actual = domIcon(d);
      if (expected !== actual) data.push({ id: n.id, kind: 'icon', expected, actual });
    }
    if ((isTextSrc(n) || (n.kind === 'icon' && n.font)) && s && s.font && s.font.ff != null) {
      const expected = firstFamily(s.font.ff), actual = d.ff != null ? firstFamily(d.ff) : null;
      if (expected !== actual) data.push({ id: n.id, kind: 'font', expected, actual });
      else if (missing.has(actual)) data.push({ id: n.id, kind: 'font', expected, actual: `${actual} (did not render)` });
    }
  }

  // ---- layer 3: crops (A and B) ----
  const crop = [], cropExplained = [];
  const hasFlag = (id, kind) => (flagsById.get(id) || []).includes(kind);
  const rasterIn = (e) => { for (let a = e; a; a = a.parent) if (hasFlag(a.n.id, 'raster')) return true; return false; };
  if (!Array.isArray(crops)) skipped.push('crop');
  else {
    for (const c of crops) {
      if (!(c.ratio > cropRatio || (c.peak ?? 0) >= cropPeak)) continue;
      const e = byId.get(c.id);
      if (e && rasterIn(e)) cropExplained.push({ ...c, explainedBy: 'raster' });
      else crop.push(c);
    }
  }

  const checked = list.length - unchecked.length;
  const nodes = list.map(({ n }) => {
    const [dA, dB] = W.map((M) => MD[M].get(n.id) || null), [lA, lB] = W.map((M) => LD[M].get(n.id) || null);
    return { id: n.id, dA, dB, lA, lB, ok: within(n, dA) && within(n, dB) };
  });
  const strict = W.map((M) => {
    const ids = list.filter(({ n }) => !uncheckedReasons[n.id]);
    return ids.length ? r3(ids.filter(({ n }) => within(n, MD[M].get(n.id))).length / ids.length) : 0;
  });
  const pass = unchecked.length === 0 && roots.every((r) => r.explainedBy) && skipped.length === 0 &&
    crop.length === 0 && data.length === 0;
  return {
    id: screen.id, checked, total: list.length, unchecked, uncheckedReasons, nodes, roots, modelDeltas,
    crop, cropExplained, cropChecked: Array.isArray(crops) ? crops.length : 0, cropWidths: Array.isArray(crops) ? [...new Set(crops.map((c) => c.width))] : [],
    data, pixel, strict, skipped, pass, flags, tol: { frame: tolFrame, text: tolText },
  };
}

// Crops at A and B for every source node with a box in both images at that width and area <= maxArea (CSS px²): the
// source rect in the source PNG against the same-size window at the node's box in the given proxy's PNG.
export async function measureCrops(browser, screen, proxy, opts = {}) {
  const maxArea = opts.maxArea ?? CROP_MAX_AREA;
  if (!screen.png || !screen.png[0] || !screen.png[1]) throw new Error('measureCrops: screen.png is missing (captureScreens with { png: true })');
  const out = [];
  for (const [i, M] of W.entries()) {
    const P = proxy[M];
    if (!P || !P.png) throw new Error(`measureCrops: proxy PNG at ${M} is missing`);
    const pairs = [];
    for (const { n } of flatten(screen.tree)) {
      const s = M === 'A' ? n.rA : n.rB, b = P.boxes[n.id];
      if (!s || !b) continue;
      const area = s[2] * s[3];
      if (!(area > 0) || area > maxArea) continue;
      pairs.push({ id: n.id, rectA: s, rectB: b });
    }
    const res = await cropDiffMany(browser, screen.png[i], P.png, pairs, opts);
    pairs.forEach((p, k) => out.push({ id: p.id, width: M, ratio: res[k].ratio, diff: res[k].diff, peak: res[k].peak }));
  }
  return out;
}

// Layers 1-3 with the image parts measured: input = { screen (with png), spec, layout: {A, B}, proxy: {A, B} (with
// png and dom), flags }.
export async function verifyScreenWithImages(browser, input, opts = {}) {
  // crops against the layout proxy: same content as the modelled one (the model only resizes text boxes; fonts are
  // substituted in capture), without the model's sub-pixel glyph shifts, which modelDeltas already report
  const crops = await measureCrops(browser, input.screen, input.layout, opts);
  const pixel = [
    await pixelDiff(browser, input.screen.png[0], input.proxy.A.png),
    await pixelDiff(browser, input.screen.png[1], input.proxy.B.png),
  ];
  return verifyScreen({ ...input, crops, pixel }, opts);
}
