// Verify layers 1-3 (spec §14). Two proxies are compared with the source HTML, node by node, at widths A and B:
//  - layout: renderProxy of the inferred spec WITHOUT applyFigmaModel (pure auto-layout semantics, R21: no Figma
//    text rounding; the proxy derives this from the spec, which has no `model: 'figma'`). Its deviations are layout
//    errors and give the roots.
//  - proxy: renderProxy of the modelled spec (after applyFigmaModel), i.e. what Figma will produce. A node outside
//    tolerance relative to the layout proxy (modelled delta minus layout delta, R18, whatever the node's layout state)
//    deviates because of the Figma model: it is listed in `modelDeltas` (explainedBy 'figmaModel', delta = that
//    difference, with magnitude) for the normalisation report, never as a root. A model
//    delta larger than opts.tolModel (default 2px, R15) goes to `needsApproval` instead, and fails the screen until
//    approved (Task 8: allowlist).
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
//   ancestor or an earlier sibling, and a reference counts only if that reference node is itself outside tolerance
//   (R16; an edge delta of a node within tolerance is never a reference); otherwise the node is a root. Per axis:
//    - size is inherited when |dw| <= tol, or the node is FILL (spec sizing) and its nearest source ancestor's size
//      moved the same way by at least as much, or the node is FILL and it absorbs exactly its equal share of the
//      non-FILL siblings' size changes (dz = -sum / number of FILL items, within tol, R28), or the node is HUG and its size change equals the extent change of its grounded children
//      (non-FILL, not positioned only from this node's far/middle edge; a child whose position and size deltas on that
//      axis are within tolerance counts as unchanged, R19/R25). So a wrongly sized parent whose FILL children
//      absorb the change is the root, not its children; and a hugging frame around a wrong child is not a second root.
//    - position is inherited when one of its edges (near, far, middle) is within tol of 0, or matches a moved edge of
//      the nearest source ancestor (near, far, middle) or of the previous source sibling (near, far), that reference
//      node being outside tolerance. R29: on an axis where that ancestor HUGs, only its near edge is a reference (its
//      far and middle edges move because of its children, so following them would be a cycle with hugAccounts).
//   Small offsets cannot add up unseen: the first node whose offset exceeds tol while its references stayed within
//   tol is a root. root.why lists the axes: x/y position, w/h size.
//   Flags (R12, R17, R20, R22-R24): a flag explains only deviations it can cause, axis by axis (every axis in root.why
//   must be covered). shrink: the item's own size on its container's main axis. weightedFill: main-axis SIZE of the
//   FILL items of that container (never a position), only when the container's main size is ok or it is an explained
//   root, and only if the items' main sizes add up to the container's change (conserved, R24). spaceAround: main-axis
//   position of the container's direct children, whether or not the container is off, only within tol of the
//   computed difference between the source's space-around/evenly and the proxy's spacing for the change in free space
//   since width A (R23). Other flags explain their own node. An ancestor's shrink/weightedFill explains a descendant's
//   size only (never a position), only if that ancestor is a root by size on the flag's axis, and only through an
//   unbroken FILL chain on that axis, or for a height under a width flag through a chain that can wrap (FILL width,
//   FILL or text-hugging height) where the excused node is a text (R22, R28). When shrink/weightedFill excuses an
//   item's main-axis size, the next flow sibling's near edge must follow the item's far edge within tol (the gap is
//   kept), else that sibling is an unexplained root (`adjacency`: the item's id); not checked in space-between or
//   wrapping containers (R28). Another ancestor flag (not spaceAround, not text-only mixedRunHeight) explains
//   a descendant root only if that ancestor is itself a root at that width on the same axis, or its width is off and
//   the deviation is a height (wrap; never the reverse) (R17, M1). A container without a known direction (spec lay.d)
//   gives shrink and weightedFill no axis.
//   R27/R28: the layout proxy must carry model 'none' and the model proxy model 'figma' (renderProxy's mark); a
//   missing or wrong mark makes verifyScreen throw.
//   fontSubstitution explains nothing (R10: capture measures the source in the Figma font). On a screen flagged
//   unsafeWiden, roots at width B are `unchecked` (reason unsafeWiden), never explained.
// Layer 3, content (modelled proxy):
//   data: text (proxy DOM text vs source runs, whitespace normalised), icon (proxy <use> ref / glyph / inline svg),
//   font (expected = the Figma family of the modelled spec, actual = the family the proxy DOM computed; a family in
//   fontsMissing did not render; a screen.fontSubs entry 'override-failed' is a mismatch on the root), color (text:
//   source computed colour vs proxy computed colour; other nodes: source computed background colour, transparent if
//   none, vs proxy computed background colour), visibility (R31: source effective opacity, the product of paint.opacity
//   over source ancestors, vs proxy DOM `op`, the same product over the rendered page; and the proxy node must be
//   visibility visible, display not none), stroke (R30a: per side top/right/bottom/left and outline, width, style and
//   colour of the source computed border / outline vs the proxy DOM `stroke` / `outline` as rendered). A proxy DOM
//   without these observations puts 'visibility' / 'stroke' in `skipped`.
//   crops: input.crops = [{id, width, ratio, diff, peak}] from measureCrops at A and B on source nodes whose box has
//   area <= 4000px². Fails when ratio (differing / ink pixels) > 0.05 or peak (differing pixels in the densest
//   8x8 CSS px square) >= 40. A failure on a node that is (inside) a raster node is in `cropExplained`.
// pixel (whole screen, modelled proxy) and strict (share of checked nodes within tolerance, modelled) are reference.
import { firstFamily } from './font-map.mjs';
import { cropDiffMany, pixelDiff } from './imgdiff.mjs';

const TOL_FRAME = 0.5;
const TOL_TEXT = 1;
const CROP_RATIO = 0.05;
const TOL_MODEL = 2;
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
const OP_EPS = 0.01;
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];
// 'Wpx style colour' (computed CSS) -> canonical 'W.WWpx style rgb(...)', or 'none' (no width, style none / hidden)
const strokeKey = (s) => {
  if (s == null || s === 'none') return 'none';
  const m = /^\s*([\d.]+)px\s+(\w+)\s+(.+?)\s*$/.exec(String(s));
  if (!m) return String(s);
  const w = Math.round(parseFloat(m[1]) * 100) / 100;
  if (!(w > 0) || m[2] === 'none' || m[2] === 'hidden') return 'none';
  return `${w}px ${m[2]} ${normColor(m[3])}`;
};
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
  const tolModel = opts.tolModel ?? TOL_MODEL;
  const { screen, spec, proxy, layout, flags = [], crops, pixel = null } = input;
  const skipped = [];
  if (!layout) skipped.push('layout');
  // R27/R28: renderProxy marks what it rendered (model 'figma' | 'none'); the mark is required on both proxies, and a
  // swapped, wrongly built or unmarked proxy is an error
  for (const M of W) {
    if (layout && layout[M] && layout[M].model === 'figma') {
      throw new Error(`verifyScreen: the layout proxy at ${M} is modelled (rendered from a spec with model 'figma'); render it from the inferred spec`);
    }
    if (layout && layout[M] && layout[M].model !== 'none') {
      throw new Error(`verifyScreen: the layout proxy at ${M} has no model mark (model ${JSON.stringify(layout[M].model)}); pass renderProxy's result`);
    }
    if (proxy && proxy[M] && proxy[M].model !== 'figma') {
      throw new Error(`verifyScreen: the model proxy at ${M} is not modelled (model ${JSON.stringify(proxy[M].model)}); render it from applyFigmaModel's spec`);
    }
  }

  const specById = new Map();
  const specParent = new Map(); // spec id -> its spec parent (syn frames included: they are the real containers)
  const indexSpec = (s) => {
    if (!s.syn) specById.set(s.id, s);
    for (const k of s.kids || []) { specParent.set(k.id, s); indexSpec(k); }
  };
  if (spec) indexSpec(spec);
  const flagsById = new Map();
  for (const f of flags) { if (!flagsById.has(f.id)) flagsById.set(f.id, []); flagsById.get(f.id).push(f.kind); }
  const evenly = new Set(flags.filter((f) => f.kind === 'spaceAround' && /evenly/.test(f.detail || '')).map((f) => f.id));
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
    const outside = (id) => !within(byId.get(id).n, D.get(id));
    // R16: a reference (parent edge, previous sibling edge) counts only if that reference node is outside tolerance;
    // an edge delta of a node within tolerance is never a reference, so sub-tolerance offsets cannot add up unseen.
    // R29: on an axis where the ancestor HUGs, its far and middle edges are no reference: its size derives from its
    // children, so a child following them would explain the ancestor's growth and be explained by it (a cycle)
    const posOK = (e, ax, withParentFar) => {
      const t = tolOf(e.n), mine = edges(D.get(e.n.id), ax);
      if (mine.some((v) => Math.abs(v) <= t + EPS)) return true;
      const refs = [];
      const a = ancestor(e);
      if (a && outside(a.n.id)) {
        const pe = edges(D.get(a.n.id), ax); refs.push(pe[0]);
        if (withParentFar && sz(a.n.id, ax) !== 'HUG') refs.push(pe[1], pe[2]);
      }
      const p = prevOf(e);
      if (p && outside(p.n.id)) { const se = edges(D.get(p.n.id), ax); refs.push(se[0], se[1]); }
      return refs.filter((r) => Math.abs(r) > t + EPS).some((r) => mine.some((v) => Math.abs(v - r) <= t + EPS));
    };
    // HUG on axis ax: does the size change equal the extent change of the grounded children? Grounded = non-FILL and
    // not positioned from this node's far/middle edge (a child that only follows those edges would be circular).
    // R19: a child within tolerance counts as unchanged (its source box), so nested HUG levels cannot each hide tol.
    // R25: decided per axis (that axis's position and size deltas both within tol), so a deviation on the other axis
    // does not make the child's sub-tolerance drift on this one count.
    const changedOn = (k, ax) => { const d = D.get(k.id), t = tolOf(k); return Math.abs(d[ax]) > t + EPS || Math.abs(d[ax + 2]) > t + EPS; };
    const hugAccounts = (e, ax) => {
      const d = D.get(e.n.id), t = tolOf(e.n);
      const ks = (e.n.kids || []).filter((k) => D.has(k.id) && sz(k.id, ax) !== 'FILL' &&
        (posOK(byId.get(k.id), ax, false) || !posOK(byId.get(k.id), ax, true)));
      if (!ks.length) return false;
      const ext = (boxes) => Math.max(...boxes.map((b) => b[ax] + b[ax + 2])) - Math.min(...boxes.map((b) => b[ax]));
      const now = (k) => (changedOn(k, ax) ? layout[M].boxes[k.id] : src(k, M));
      const dU = ext(ks.map(now)) - ext(ks.map((k) => src(k, M)));
      return Math.abs(d[ax + 2] - dU) <= t + EPS;
    };
    const sizeOK = (e, ax) => {
      const d = D.get(e.n.id), t = tolOf(e.n), dz = d[ax + 2];
      if (Math.abs(dz) <= t + EPS) return true;
      const me = sz(e.n.id, ax);
      const a = ancestor(e);
      if (me === 'FILL' && a) {
        const pz = D.get(a.n.id)[ax + 2];
        if (Math.abs(pz) > tolOf(a.n) + EPS && Math.sign(pz) === Math.sign(dz) && Math.abs(dz) <= Math.abs(pz) + t + EPS) return true;
        // absorbs size changes of non-FILL siblings (the sibling is attributed on its own). R28: an equality, the FILL
        // items (flex 1 1 0) sharing the change equally: dz = -sum / (number of FILL items), within tol
        const sib = (a.n.kids || []).filter((k) => k.id !== e.n.id && D.has(k.id) && sz(k.id, ax) !== 'FILL');
        const moved = sib.map((k) => D.get(k.id)[ax + 2]).filter((v) => Math.abs(v) > t + EPS);
        const sum = moved.reduce((x, y) => x + y, 0);
        const nFill = (a.n.kids || []).filter((k) => D.has(k.id) && sz(k.id, ax) === 'FILL').length;
        if (moved.length && Math.abs(dz + sum / nFill) <= t + EPS) return true;
      }
      if (me === 'HUG' && hugAccounts(e, ax)) return true;
      return false;
    };
    // R17 (amended): an ancestor deviates for its own reason only when it is itself a root at this width; a size or
    // position it inherited (pushed by a sibling, FILL growing with its parent, HUG growing with a child) is no excuse.
    // Kept per axis (M1): the axes on which the ancestor is a root.
    const rootAxes = (a) => [0, 1].filter((ax) => !sizeOK(a, ax) || !posOK(a, ax, true));
    // R20: a flag explains only deviations it can cause. Every axis in root.why must be covered:
    //  - shrink (own): the item's size on the main axis of its container;
    //  - weightedFill (own or on a sibling): main-axis SIZE of a FILL item when the container's main size is ok or the
    //    container is an explained root, and only if the sizes are conserved (R24); never a position;
    //  - spaceAround (on the direct container): the item's main-axis position, only within tol of the computed
    //    space-around vs space-between difference (R23), whether or not the container is off;
    //  - other flags (own): anything; fontSubstitution / unsafeWiden: nothing;
    //  - an ancestor's shrink / weightedFill (R22): a descendant's SIZE only, only if the ancestor is a root by size on
    //    the flag axis, and only through an unbroken FILL chain on that axis (or, for height under a width flag, a
    //    chain that can wrap: FILL width and FILL or text-hugging height). Never a descendant's position.
    //  - an ancestor's other flag (not spaceAround, not text-only): only if that ancestor is a root on the same axis,
    //    or its width is off and the deviation is a height (wrap) (R17, M1).
    const explained = new Set();
    const mainOf = (s) => (!s || !s.lay ? null : s.lay.d === 'H' ? 0 : s.lay.d === 'V' ? 1 : null);
    const mainIn = (id) => mainOf(specParent.get(id));
    const flagged = (id, k) => (flagsById.get(id) || []).includes(k);
    const flowKids = (s) => (s.kids || []).filter((k) => !k.abs);
    // R24: the FILL split is an excuse only if the main-axis sizes of the container's items add up to the container's
    // own change (a gap or padding error absorbed by FILL items is not conserved)
    const wfOK = (e, ax) => {
      const cont = specParent.get(e.n.id);
      if (mainOf(cont) !== ax || sz(e.n.id, ax) !== 'FILL' || cont.syn || !D.has(cont.id)) return false;
      if (!flagged(e.n.id, 'weightedFill') && !(cont.kids || []).some((k) => k.id !== e.n.id && flagged(k.id, 'weightedFill'))) return false;
      const a = byId.get(cont.id), dc = D.get(cont.id)[ax + 2];
      if (!(Math.abs(dc) <= tolOf(a.n) + EPS || explained.has(a.n.id))) return false;
      const ks = flowKids(cont);
      if (ks.some((k) => !D.has(k.id))) return false;
      const sum = ks.reduce((s, k) => s + D.get(k.id)[ax + 2], 0);
      return Math.abs(sum - dc) <= tolOf(e.n) + EPS;
    };
    // R23: expected main-axis delta of child e under a spaceAround container c at this width. infer reproduces the
    // source spacing at A (padding + space-between or a gap), so the legitimate difference comes only from the change
    // df of the source free space between A and this width: the source distributes df space-around
    // (df/2n + i·df/n) or space-evenly (df(i+1)/(n+1)); the proxy distributes df plus its own container size delta
    // per its spec (space-between i·df/(n-1); gap with start/centre/end alignment 0, df/2, df). This is the ruling's
    // Δ_i = (p − f/2n) + i((f − 2p)/(n−1) − f/n) with p, f taken relative to A, so it does not trust the spec padding.
    const saOK = (e, c, ax) => {
      const lay = c.lay;
      if (!lay || lay.wrap || !D.has(c.id) || !byId.has(c.id)) return false;
      const ks = flowKids(c), n = ks.length, i = ks.findIndex((k) => k.id === e.n.id);
      if (n < 2 || i < 0 || ks.some((k) => !byId.has(k.id) || !D.has(k.id))) return false;
      const cn = byId.get(c.id).n, I = ax + 2;
      const free = (Mx) => (Mx === 'A' ? cn.rA : cn.rB)[I] - ks.reduce((s, k) => s + (Mx === 'A' ? byId.get(k.id).n.rA : byId.get(k.id).n.rB)[I], 0);
      const df = free(M) - free('A'), dc = D.get(c.id), dfP = df + dc[I];
      const srcCh = evenly.has(c.id) ? (df * (i + 1)) / (n + 1) : df / (2 * n) + (i * df) / n;
      const pxCh = lay.sb ? (i * dfP) / (n - 1) : lay.pa === 'E' ? dfP : lay.pa === 'C' ? dfP / 2 : 0;
      return Math.abs(D.get(e.n.id)[ax] - dc[ax] - (pxCh - srcCh)) <= tolOf(e.n) + EPS;
    };
    // R22: the spec nodes from e up to (not including) ancestor a can pass a size change of a on axis m to e's axis ax
    const hasText = (s) => s.t === 'T' || (s.kids || []).some(hasText);
    const chainOK = (e, a, ax, m) => {
      const nodes = [];
      let s = specById.get(e.n.id);
      while (s && s.id !== a.n.id) { nodes.push(s); s = specParent.get(s.id); }
      if (!s || !nodes.length) return false;
      const z = (x, k) => (x.sz ? x.sz[k] : null);
      if (ax === m) return nodes.every((x) => z(x, ax) === 'FILL');
      // R28: on the wrap path only a text is excused (a HUG frame's own height error is never the flag's)
      if (m === 0 && ax === 1) return nodes[0].t === 'T' && nodes.every((x) => z(x, 0) === 'FILL' && (z(x, 1) === 'FILL' || (z(x, 1) === 'HUG' && hasText(x))));
      return false;
    };
    const AX = { x: [0, false], y: [1, false], w: [0, true], h: [1, true] };
    const flexSized = []; // [entry, main axis] whose main-axis size a shrink / weightedFill flag excused (R28 adjacency)
    const explain = (e, why) => {
      const kinds = [];
      for (const w of why) {
        const [ax, size] = AX[w];
        let by = null;
        for (const k of flagsById.get(e.n.id) || []) {
          if (NEVER_EXPLAINS.has(k) || k === 'spaceAround' || k === 'weightedFill') continue;
          if (k === 'shrink' ? size && mainIn(e.n.id) === ax : true) { by = k; break; }
        }
        if (!by && size && wfOK(e, ax)) by = 'weightedFill';
        if (!by && !size) {
          const c = specParent.get(e.n.id);
          if (c && !c.syn && flagged(c.id, 'spaceAround') && mainOf(c) === ax && saOK(e, c, ax)) by = 'spaceAround';
        }
        for (let a = e.parent; !by && a; a = a.parent) {
          if (!D.has(a.n.id)) continue;
          const ra = rootAxes(a);
          if (!ra.length) continue;
          for (const k of flagsById.get(a.n.id) || []) {
            if (NEVER_EXPLAINS.has(k) || SELF_ONLY.has(k) || k === 'spaceAround') continue;
            if (k === 'shrink' || k === 'weightedFill') {
              const m = mainIn(a.n.id);
              if (m === null || !size || sizeOK(a, m) || !chainOK(e, a, ax, m)) continue;
            } else if (!ra.includes(ax) && !(ax === 1 && !sizeOK(a, 0))) continue;
            by = k; break;
          }
        }
        if (!by) return null;
        if (!kinds.includes(by)) kinds.push(by);
        if (size && (by === 'shrink' || by === 'weightedFill') && mainIn(e.n.id) === ax) flexSized.push([e, ax]);
      }
      return kinds.join('+') || null;
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
      const n0 = flexSized.length;
      const by = explain(e, why);
      if (by) { root.explainedBy = by; explained.add(e.n.id); } else flexSized.length = n0;
      roots.push(root);
    }
    // R28 adjacency: a flag that excuses item i's main-axis size change does not move the gap after it, so the next
    // flow sibling's near edge must follow i's far edge within tol (FIXED followers pushed along, a FILL neighbour
    // absorbing it). Otherwise that sibling is an unexplained root on that axis. Not checked in space-between or
    // wrapping containers, where the gap legitimately changes.
    for (const [e, ax] of flexSized) {
      const c = specParent.get(e.n.id);
      if (!c || !c.lay || c.lay.sb || c.lay.wrap) continue;
      const ks = flowKids(c), i = ks.findIndex((k) => k.id === e.n.id), k = ks[i + 1];
      if (!k || !D.has(k.id) || !byId.has(k.id)) continue;
      const de = D.get(e.n.id), dk = D.get(k.id), kn = byId.get(k.id).n;
      if (Math.abs(dk[ax] - (de[ax] + de[ax + 2])) <= tolOf(kn) + EPS) continue;
      const w = ax ? 'y' : 'x';
      const prev = roots.find((r) => r.id === k.id && r.width === M);
      if (prev) { if (!prev.why.includes(w)) prev.why.push(w); delete prev.explainedBy; explained.delete(k.id); prev.adjacency = e.n.id; }
      else roots.push({ id: k.id, width: M, delta: dk, why: [w], adjacency: e.n.id });
    }
  }

  // ---- Figma-model deltas (R18): modelled-proxy delta minus layout-proxy delta, whatever the layout state ----
  const modelDeltas = [], needsApproval = [];
  for (const M of layout ? W : []) {
    for (const { n } of list) {
      const md = MD[M].get(n.id), ld = LD[M].get(n.id);
      const dd = md && ld ? sub(md, ld) : null;
      if (dd && !within(n, dd)) {
        const e = { id: n.id, width: M, delta: dd, magnitude: r2(Math.max(...dd.map(Math.abs))), explainedBy: 'figmaModel' };
        (e.magnitude > tolModel + EPS ? needsApproval : modelDeltas).push(e);
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
  const eop = new Map(); // source effective opacity: own opacity times the parent's
  for (const e of list) eop.set(e.n.id, (e.parent ? eop.get(e.parent.n.id) : 1) * (e.n.paint && e.n.paint.opacity != null ? e.n.paint.opacity : 1));
  let noVis = false, noStroke = false;
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
    // R31 visibility: effective opacity (product over ancestors) and the node itself shown
    if (d.op == null || d.vis == null) noVis = true;
    else {
      const expected = eop.get(n.id), shown = d.vis === 'visible' && d.disp !== 'none';
      if (Math.abs(expected - d.op) > OP_EPS || !shown) {
        data.push({ id: n.id, kind: 'visibility', expected: `opacity ${r3(expected)}, visible`, actual: `opacity ${r3(d.op)}, visibility ${d.vis}, display ${d.disp}` });
      }
    }
    // R30a stroke: per side (and outline) width, style and colour, source computed vs proxy rendered
    if (!Array.isArray(d.stroke)) noStroke = true;
    else {
      const b = n.paint && Array.isArray(n.paint.border) ? n.paint.border : [];
      SIDE_NAMES.forEach((side, i) => {
        const x = b[i], expected = x && x.w > 0 ? strokeKey(`${x.w}px ${x.style} ${x.color}`) : 'none', actual = strokeKey(d.stroke[i]);
        if (expected !== actual) data.push({ id: n.id, kind: 'stroke', side, expected, actual });
      });
      const expected = strokeKey(n.paint && n.paint.outline), actual = strokeKey(d.outline);
      if (expected !== actual) data.push({ id: n.id, kind: 'stroke', side: 'outline', expected, actual });
    }
  }
  if (noVis) skipped.push('visibility');
  if (noStroke) skipped.push('stroke');

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
    crop.length === 0 && data.length === 0 && needsApproval.length === 0;
  return {
    id: screen.id, checked, total: list.length, unchecked, uncheckedReasons, nodes, roots, modelDeltas, needsApproval,
    crop, cropExplained, cropChecked: Array.isArray(crops) ? crops.length : 0, cropWidths: Array.isArray(crops) ? [...new Set(crops.map((c) => c.width))] : [],
    data, pixel, strict, skipped, pass, flags, tol: { frame: tolFrame, text: tolText, model: tolModel },
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
