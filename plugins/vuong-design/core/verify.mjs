// Verify layers 1-3 (spec §14): compare the modelled proxy (renderProxy of the spec after applyFigmaModel, i.e. what
// Figma will produce) with the source HTML, node by node, at widths A and B. Nothing is skipped silently: a node that
// cannot be compared is `unchecked` (with a reason) and fails the screen; a layer that was not run is in `skipped` and
// fails the screen.
//
// Layer 1, coverage: total = source INodes in the screen tree (syn frames `<id>.g<k>` are not source nodes; nodes
//   capture excluded are listed by capture with reasons and are not in the tree). checked = nodes with a source box and
//   a proxy box at both widths.
// Layer 2, position: d = proxy box - source box ([dx, dy, dw, dh], CSS px, both relative to the root). A node is `ok`
//   when |d| <= tol at both widths (tolText for text, i.e. kind 'text' and pseudo text that infer turns into a text
//   node; tolFrame for everything else). A node outside tolerance is a ROOT unless, on each axis, its deviation is
//   inherited:
//    - size: |dw| (|dh|) <= tol, or it equals the change of its children's extent (a hugging frame grows with its
//      content). Only children positioned without this node's far or middle edge count (grounding), so an end-aligned
//      child dragged by a wrongly sized parent cannot excuse that parent;
//    - position: its near, far or middle edge delta (start / end / centre anchoring) matches, within tol, 0, an edge
//      of the nearest source ancestor (near, far or middle) or of the previous source sibling (near or far: pushed).
//   Deltas are absolute, so offsets compose: a sibling pushed by an earlier sibling inside a shifted parent matches the
//   earlier sibling's far edge. Sub-pixel text rounding (within tolText) that grows a frame and pushes later siblings
//   is never a root, while a shift or resize beyond tolerance leaves at least one root (for a FILL child stretched by
//   a wrongly sized parent the root is reported on the child). root.why lists the axes: x/y position, w/h size.
//   A root is explained by a flag of that node or of a source ancestor, nearest first. fontSubstitution and
//   mixedRunHeight explain the flagged text node only; unsafeWiden explains roots at width B only.
// Layer 3, content: data (text normalised for whitespace only, icon ref / glyph / inline svg, font family: expected =
//   the Figma family of the modelled spec, actual = what the proxy declares for it; a family in fontsMissing does not
//   render, which is a mismatch) and crops (input.crops: [{id, ratio}] measured by measureCrops on source nodes whose
//   box at A has area <= 4000px²; ratio > 0.05 fails). A crop failure on a node that has (or contains) substituted text
//   or that is (inside) a raster node is listed in `cropExplained`, not in `crop`.
// pixel (whole screen at A and B) and strict (share of checked nodes within tolerance) are reference only.
import { defaultFontMap, firstFamily } from './font-map.mjs';
import { cropDiffMany, pixelDiff } from './imgdiff.mjs';

const TOL_FRAME = 0.5;
const TOL_TEXT = 1;
const CROP_RATIO = 0.05;
const CROP_MAX_AREA = 4000;
const EPS = 1e-6;
const W = ['A', 'B'];
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const SELF_ONLY = new Set(['fontSubstitution', 'mixedRunHeight']);

const isTextSrc = (n) => !n.icon && (n.kind === 'text' || (n.kind === 'pseudo' && !!n.runs));
const runsText = (runs) => (runs || []).map((r) => (r.br ? '\n' : r.t ?? '')).join('');
const normWs = (s) => String(s).replace(/\s+/g, ' ').trim();
const iconKey = (ic) => {
  if (!ic) return null;
  if (ic.ref) return ic.ref;
  if (ic.glyph != null) return `glyph:${ic.glyph}`;
  if (ic.svg) return `svg:${ic.svg}`;
  return null;
};
const fontFamilies = (n) => {
  const out = [];
  if (n.font && n.font.ff != null) out.push(n.font.ff);
  for (const r of n.runs || []) if (r.s && r.s.ff != null) out.push(r.s.ff);
  return [...new Set(out.map(firstFamily))];
};

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
  const cropRatio = opts.cropRatio ?? CROP_RATIO;
  const { screen, spec, proxy, flags = [], crops, pixel = null } = input;
  const fontMap = input.fontMap || defaultFontMap();

  const specById = new Map();
  const indexSpec = (s) => { if (!s.syn) specById.set(s.id, s); (s.kids || []).forEach(indexSpec); };
  if (spec) indexSpec(spec);
  const flagsById = new Map();
  for (const f of flags) { if (!flagsById.has(f.id)) flagsById.set(f.id, []); flagsById.get(f.id).push(f.kind); }

  const list = flatten(screen.tree);
  const byId = new Map(list.map((e) => [e.n.id, e]));
  const tolOf = (n) => (isTextSrc(n) ? tolText : tolFrame);

  // ---- layer 1 + deltas ----
  const delta = { A: new Map(), B: new Map() };
  const unchecked = []; const uncheckedReasons = {};
  for (const { n } of list) {
    const why = [];
    for (const M of W) {
      const s = M === 'A' ? n.rA : n.rB;
      const p = proxy[M] && proxy[M].boxes ? proxy[M].boxes[n.id] : null;
      if (!s) why.push(`no source box at ${M}`);
      if (!p) why.push(`no proxy box at ${M}`);
      if (s && p) delta[M].set(n.id, [0, 1, 2, 3].map((i) => r2(p[i] - s[i])));
    }
    if (why.length) { unchecked.push(n.id); uncheckedReasons[n.id] = why.join('; '); }
  }

  // ---- layer 2 ----
  const nodes = list.map(({ n }) => {
    const t = tolOf(n);
    const [dA, dB] = W.map((M) => delta[M].get(n.id) || null);
    const within = (d) => !!d && d.every((v) => Math.abs(v) <= t + EPS);
    return { id: n.id, dA, dB, ok: within(dA) && within(dB) };
  });
  const okAt = (M, id) => { const d = delta[M].get(id); const t = tolOf(byId.get(id).n); return d.every((v) => Math.abs(v) <= t + EPS); };

  const roots = [];
  for (const M of W) {
    const D = delta[M];
    const ancestor = (e) => { let a = e.parent; while (a && !D.has(a.n.id)) a = a.parent; return a; };
    const prevOf = (e) => { let p = e.prev; while (p && !D.has(p.n.id)) p = p.prev; return p; };
    const src = (n) => (M === 'A' ? n.rA : n.rB);
    // reference deltas an edge may inherit: unchanged, the nearest source ancestor (near edge; far and middle too
    // unless grounding), the previous source sibling (near and far edge)
    const refs = (e, ax, withParentFar) => {
      const out = [0];
      const a = ancestor(e);
      if (a) { const d = D.get(a.n.id); out.push(d[ax]); if (withParentFar) out.push(d[ax] + d[ax + 2], d[ax] + d[ax + 2] / 2); }
      const p = prevOf(e);
      if (p) { const d = D.get(p.n.id); out.push(d[ax], d[ax] + d[ax + 2]); }
      return out;
    };
    // near, far and middle edge deltas: a node may be anchored at its start, end or centre
    const anchors = (d, ax) => [d[ax], d[ax] + d[ax + 2], d[ax] + d[ax + 2] / 2];
    const anchored = (e, ax, withParentFar) => {
      const t = tolOf(e.n), R = refs(e, ax, withParentFar);
      return anchors(D.get(e.n.id), ax).some((v) => R.some((r) => Math.abs(v - r) <= t + EPS));
    };
    // size follows content: the node's size change equals the change of its children's extent. Only children whose
    // position does not come from this node's far or middle edge count (grounding).
    const sizeOK = (e, ax) => {
      const d = D.get(e.n.id), t = tolOf(e.n);
      if (Math.abs(d[ax + 2]) <= t + EPS) return true;
      const ks = (e.n.kids || []).filter((k) => D.has(k.id) && anchored(byId.get(k.id), ax, false));
      if (!ks.length) return false;
      const ext = (boxes) => Math.max(...boxes.map((b) => b[ax] + b[ax + 2])) - Math.min(...boxes.map((b) => b[ax]));
      const dU = ext(ks.map((k) => proxy[M].boxes[k.id])) - ext(ks.map(src));
      return Math.abs(d[ax + 2] - dU) <= t + EPS;
    };
    for (const e of list) {
      if (!D.has(e.n.id) || okAt(M, e.n.id)) continue;
      const why = [];
      for (const ax of [0, 1]) {
        if (!sizeOK(e, ax)) why.push(ax ? 'h' : 'w');
        else if (!anchored(e, ax, true)) why.push(ax ? 'y' : 'x');
      }
      if (!why.length) continue;
      const root = { id: e.n.id, width: M, delta: D.get(e.n.id), why };
      const by = explain(e, M);
      if (by) root.explainedBy = by;
      roots.push(root);
    }
  }
  function explain(e, M) {
    for (let a = e, self = true; a; a = a.parent, self = false) {
      for (const k of flagsById.get(a.n.id) || []) {
        if (!self && SELF_ONLY.has(k)) continue;
        if (k === 'unsafeWiden' && M !== 'B') continue;
        return k;
      }
    }
    return null;
  }

  // ---- layer 3: data ----
  const data = [];
  const missing = new Set([...(proxy.A?.fontsMissing || []), ...(proxy.B?.fontsMissing || [])]);
  for (const { n } of list) {
    const s = specById.get(n.id);
    if (!s) continue; // no proxy node: already unchecked
    if (isTextSrc(n)) {
      const expected = normWs(runsText(n.runs)), actual = normWs(runsText(s.runs));
      if (expected !== actual) data.push({ id: n.id, kind: 'text', expected, actual });
    }
    if (n.kind === 'icon') {
      const expected = iconKey(n.icon), actual = iconKey(s.icon);
      if (expected !== actual) data.push({ id: n.id, kind: 'icon', expected, actual });
    }
    if (isTextSrc(n) || (n.kind === 'icon' && n.font)) {
      for (const fam of fontFamilies(s)) {
        const declared = fontMap.substitute(fam);
        if (declared !== fam) data.push({ id: n.id, kind: 'font', expected: fam, actual: declared });
        else if (missing.has(declared)) data.push({ id: n.id, kind: 'font', expected: fam, actual: `${declared} (did not render)` });
      }
    }
  }

  // ---- layer 3: crops ----
  const skipped = [];
  const crop = [], cropExplained = [];
  const hasFlag = (id, kind) => (flagsById.get(id) || []).includes(kind);
  const cropReason = (e) => {
    const sub = (x) => hasFlag(x.id, 'fontSubstitution') || (x.kids || []).some(sub);
    if (sub(e.n)) return 'fontSubstitution';
    for (let a = e; a; a = a.parent) if (hasFlag(a.n.id, 'raster')) return 'raster';
    return null;
  };
  if (!Array.isArray(crops)) skipped.push('crop');
  else {
    for (const c of crops) {
      if (!(c.ratio > cropRatio)) continue;
      const e = byId.get(c.id);
      const by = e && cropReason(e);
      if (by) cropExplained.push({ id: c.id, ratio: c.ratio, explainedBy: by });
      else crop.push({ id: c.id, ratio: c.ratio });
    }
  }

  const checked = list.length - unchecked.length;
  const strict = W.map((M) => {
    const ids = list.filter(({ n }) => !uncheckedReasons[n.id]).map(({ n }) => n.id);
    return ids.length ? r3(ids.filter((id) => okAt(M, id)).length / ids.length) : 0;
  });
  const pass = unchecked.length === 0 && roots.every((r) => r.explainedBy) && skipped.length === 0 &&
    crop.length === 0 && data.length === 0;
  return {
    id: screen.id, checked, total: list.length, unchecked, uncheckedReasons, nodes, roots,
    crop, cropExplained, cropChecked: Array.isArray(crops) ? crops.length : 0, data, pixel, strict, skipped, pass,
    tol: { frame: tolFrame, text: tolText },
  };
}

// Crop ratios at width A for every source node with a box at A in both images and area <= maxArea (CSS px²):
// the source rect in the source PNG against the same-size window at the proxy box in the proxy PNG.
export async function measureCrops(browser, screen, proxyA, opts = {}) {
  const maxArea = opts.maxArea ?? CROP_MAX_AREA;
  if (!screen.png || !screen.png[0]) throw new Error('measureCrops: screen.png is missing (captureScreens with { png: true })');
  if (!proxyA || !proxyA.png) throw new Error('measureCrops: proxy PNG at A is missing');
  const pairs = [];
  for (const { n } of flatten(screen.tree)) {
    const b = proxyA.boxes[n.id];
    if (!n.rA || !b) continue;
    const area = n.rA[2] * n.rA[3];
    if (!(area > 0) || area > maxArea) continue;
    pairs.push({ id: n.id, rectA: n.rA, rectB: b });
  }
  const ratios = await cropDiffMany(browser, screen.png[0], proxyA.png, pairs, opts);
  return pairs.map((p, i) => ({ id: p.id, ratio: ratios[i] }));
}

// Layers 1-3 with the image parts measured: input = { screen (with png), spec, proxy: {A, B} (with png), flags, fontMap? }.
export async function verifyScreenWithImages(browser, input, opts = {}) {
  const crops = await measureCrops(browser, input.screen, input.proxy.A, opts);
  const pixel = [
    await pixelDiff(browser, input.screen.png[0], input.proxy.A.png),
    await pixelDiff(browser, input.screen.png[1], input.proxy.B.png),
  ];
  return verifyScreen({ ...input, crops, pixel }, opts);
}
