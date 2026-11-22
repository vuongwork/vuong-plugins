// Verify layers 1-3 (spec §14). Two proxies are compared with the source HTML, node by node, at widths A and B:
//  - layout: renderProxy of the inferred spec WITHOUT applyFigmaModel (pure auto-layout semantics, R21: no Figma
//    text rounding; the proxy derives this from the spec, which has no `model: 'figma'`). Its deviations are layout
//    errors and give the roots.
//  - proxy: renderProxy of the modelled spec (after applyFigmaModel), i.e. what Figma will produce. A node outside
//    tolerance relative to the layout proxy (modelled delta minus layout delta, R18, whatever the node's layout state)
//    deviates because of the Figma model, never a root. R43: those model deltas go through the same root / follower
//    attribution as the layout deltas (no flag explains them): each model root is listed in `modelDeltas`
//    (explainedBy 'figmaModel', delta = that difference, why, magnitude) for the normalisation report; followers are
//    counted in `modelFollowers` {A, B}. A model root larger than opts.tolModel (default 2px, R15) goes to
//    `needsApproval` instead and fails the screen until approved (Task 8: allowlist). `modelDrift` = the largest
//    accumulated model delta on any node (followers included); above tolModel it is a needsApproval entry
//    ({..., drift: true}) unless a listed model root already has that magnitude.
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
//      non-FILL siblings' size changes (dz = -sum / number of FILL items, within tol, R28), or the node is HUG and its size change equals the change of its
//      children's extent. On the main axis of a flow row / column (no wrap, no space-between) that change is the sum
//      of the items' size changes and the gaps' changes, each term within tolerance counting as 0 (R19, R34). Otherwise
//      the extent of the non-FILL children: a child counts at its layout box only if it changed relative to this
//      node's near-edge delta n0 AND is outside tolerance absolutely, and it is grounded (not positioned only from this
//      node's far/middle edge) or its size changed; else it is held at its source box + n0 (unchanged relative to n0)
//      or at its source box (within tolerance absolutely) (R19/R25/R32/R34). So a wrongly sized parent whose FILL
//      children absorb the change is the root, not its children; and a hugging frame around a wrong child is not a
//      second root.
//    - position: alignment (R34) = how the node is placed on that axis in its spec container: start / end / centre
//      (align-items on the cross axis, justify on the main axis, abs constraints), stretched (FILL, pinned both
//      sides) or unknown. Position is inherited when its aligned edge (start: near, end: far, centre: middle;
//      stretched or unknown: near or far) is within tol of 0 while the ancestor's same edge did not move beyond tol,
//      or when it follows a moved reference node (outside tolerance): the nearest source ancestor by the aligned edge
//      (near or far, edge for edge being free, when stretched or unknown), or the previous source sibling's near or
//      far edge (by the node's near, far, or for a centred node any, edge). The middle edges count only for a centred
//      node. R29: on an axis where that ancestor HUGs, only its near edge is a reference (its far and middle edges
//      move because of its children, so following them would be a cycle with hugAccounts).
//      R32: in a HUG ancestor the previous sibling counts only if it changed relative to the ancestor's near-edge delta
//      (a child that only moved with an end-anchored HUG row is no reference). R33: the HUG ancestor's far / middle
//      edge is a reference after all when its size change on that axis equals the extent change of its non-FILL
//      children counting only their own changes: at the layout box when the child's position is a root without R33,
//      by its size alone (layout size at its source aligned edge + n0, R34) when only its size changed, never a
//      position change of this node or of a sibling depending on it (later flow siblings on the main axis; on the
//      cross axis, only with unknown alignment, a later sibling without a size change there that sits only on the
//      previous one's edges). The node's own size change counts the same way (by size, never by position).
//   Small offsets cannot add up unseen: the first node whose offset exceeds tol while its references stayed within
//   tol is a root. root.why lists the axes: x/y position, w/h size. R49: position and size are judged separately
//   on each axis (a node off in size is still examined for position by its aligned edge), and a flag or an
//   allowlist entry that covers a size never covers a position. R57: a FILL item on its flow container's main axis
//   is aligned by that container's packing (start, space-between or none: near edge; end: far edge; centre:
//   middle), not "stretched" (near or far): a padding error the FILL item absorbs moves its packed edge.
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
//   R50, any node size, always source computed style (capture) vs what the proxy page rendered (never the spec, so a
//   spec or proxy error is caught): radius (non-text nodes, per corner), font-style (text with a source font: font
//   size, weight, style, text-decoration line and text-transform of every non-blank character, from the source runs
//   vs the proxy DOM `runs`; skipped when the texts differ, which the text check reports), svg (inline svg: sha1 of the
//   serialised markup without the root style attribute, the root's inlined declarations, and the root color / fill /
//   stroke / stroke-width), image (object-fit, object-position, src; `img: null` = the proxy drew no image). A DOM
//   without the observation puts 'radius' / 'font-style' / 'svg' / 'image' in `skipped`.
//   R55: a text whose spec has no font family is `unchecked` (its font cannot be checked); font-face: every face a
//   text run renders (first family, italic or not, weight rounded to 100) must not be in the proxy's `facesMissing`
//   (no loaded face covers it: Chrome synthesised it or fell back); a proxy without facesMissing puts 'font-face' in
//   `skipped`.
//   R46, any node size: unsupported (capture's paint.unsupported, i.e. paint it does not translate: text-shadow,
//   blend modes, masks, list markers, ..., R48 'svg <tag> <property>' for page CSS inside an inline svg that the
//   serialised markup does not carry; and any box paint on a text node, which the proxy draws as text only),
//   unless the node is inside a raster node; effect (non-text nodes: source computed box-shadow and background-image
//   vs the proxy DOM's `shadow` / `bgImage`; a DOM without them puts 'effect' in `skipped`). Data findings are never
//   allowlistable (pipeline gate).
//   crops: input.crops = [{id, width, ratio, diff, peak}] from measureCrops at A and B on source nodes whose box has
//   area <= 4000px² and (R50) on leaves that paint content (text, icon, image) of any size, each window with the boxes of its own cropped descendants masked (R45: a container compares its
//   own paint; children are compared in their own crops). Fails when ratio (differing / ink pixels) > 0.05 or peak (differing pixels in the densest
//   8x8 CSS px square) >= 40. A failure on a node that is (inside) a raster node is in `cropExplained`. R44: a failure on a
//   node that is itself a size root at that width (size delta > the 1px crop search) shares the root's status: in
//   `cropExplained` with the root's flag, or in `cropLinked` ({..., root}) for an unexplained root; any other failure,
//   inside a root's subtree included, is in `crop`.
// pixel (whole screen, modelled proxy) and strict (share of checked nodes within tolerance, modelled) are reference.
import { createHash } from 'node:crypto';
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

// ---- R50 helpers ----
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
// a computed corner radius: '16px', '50%', '10px 20px' (elliptical); '10px 10px' is '10px'
const normRadius = (v) => {
  const p = String(v == null || v === '' ? '0px' : v).trim().split(/\s+/).map((x) => (/px$/.test(x) ? `${r2(parseFloat(x))}px` : x));
  return p.length === 2 && p[0] === p[1] ? p[0] : p.join(' ');
};
const sha = (s) => createHash('sha1').update(String(s ?? '')).digest('hex').slice(0, 12);
const short = (s) => { const t = String(s ?? ''); return t.length > 80 ? `${t.slice(0, 60)}… (${t.length} chars, sha1 ${sha(t)})` : t; };
const unent = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const decls = (s) => s.split(';').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s*:\s*/, ': ')).sort().join('; ');
// capture's serialised inline svg -> { markup without the root style attribute, the root's inlined declarations }
export function splitSvgRoot(svg) {
  let own = '';
  const markup = String(svg).replace(/^(<svg\b[^>]*?)\sstyle="([^"]*)"/, (_, a, v) => { own = decls(unent(v)); return a; });
  return { markup, own };
}
const RUN_PROPS = ['font-size', 'font-weight', 'font-style', 'text-decoration', 'text-transform'];
const runNorm = [(v) => `${r2(parseFloat(v))}px`, (v) => String(v ?? '400'), (v) => String(v || 'normal'), (v) => String(v || 'none'), (v) => String(v || 'none')];
// runs [[text, fs, fw, fst, td, tt]] of the source and of the proxy DOM, compared per non-blank character; one finding
// per property (its first differing character). Texts that differ are not compared here (the text check reports them).
function runStyleDiff(src, dom) {
  const chars = (runs) => {
    const out = [];
    for (const r of runs) for (const ch of String(r[0] ?? '')) if (/\S/.test(ch)) out.push([ch, ...r.slice(1, 6).map((v, i) => runNorm[i](v))]);
    return out;
  };
  const a = chars(src), b = chars(dom);
  if (a.length !== b.length || a.some((x, i) => x[0] !== b[i][0])) return [];
  const out = [];
  RUN_PROPS.forEach((prop, k) => {
    const i = a.findIndex((x, j) => x[k + 1] !== b[j][k + 1]);
    if (i >= 0) out.push({ prop, expected: a[i][k + 1], actual: b[i][k + 1], at: i });
  });
  return out;
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
  // R43: the same attribution runs on the layout deltas (model = false: roots, flags, adjacency) and on the Figma-model
  // deltas (model = true: modelled minus layout delta per node; returns the model roots and counts the followers;
  // no flag explains a model delta). box(k) = the node's box in the compared proxy.
  const attribute = (M, D, model, box) => {
    const mroots = []; let followers = 0;
    const ancestor = (e) => { let a = e.parent; while (a && !D.has(a.n.id)) a = a.parent; return a; };
    const prevOf = (e) => { let p = e.prev; while (p && !D.has(p.n.id)) p = p.prev; return p; };
    const sz = (id, ax) => { const s = specById.get(id); return s && s.sz ? s.sz[ax] : null; };
    const edges = (d, ax) => [d[ax], d[ax] + d[ax + 2], d[ax] + d[ax + 2] / 2]; // near, far, middle
    const outside = (id) => !within(byId.get(id).n, D.get(id));
    const mainOf = (s) => (!s || !s.lay ? null : s.lay.d === 'H' ? 0 : s.lay.d === 'V' ? 1 : null);
    const flowKids = (s) => (s.kids || []).filter((k) => !k.abs);
    // R16: a reference (parent edge, previous sibling edge) counts only if that reference node is outside tolerance;
    // an edge delta of a node within tolerance is never a reference, so sub-tolerance offsets cannot add up unseen.
    // R29: on an axis where the ancestor HUGs, its far and middle edges are no reference: its size derives from its
    // children, so a child following them would explain the ancestor's growth and be explained by it (a cycle)
    // R32: inside a HUG node a child is judged against the HUG node's own near-edge delta on that axis: a child that only
    // moved with that near edge (an end-anchored HUG row moving with its content) is unchanged there, so it is no
    // reference for the next sibling and counts as unchanged in hugAccounts.
    // R33 (strict = false): the far / middle edge of a HUG ancestor is a reference after all when the ancestor's growth
    // on that axis is accounted by its other children's own changes (r33Accounts), not by this node or its dependents.
    const changedRel = (k, ax, a) => {
      const d = D.get(k.id), t = tolOf(k), n0 = a ? D.get(a.n.id)[ax] : 0;
      return Math.abs(d[ax] - n0) > t + EPS || Math.abs(d[ax + 2]) > t + EPS;
    };
    // R34 (M1): how a node is placed on ax in its container: 'S' start, 'E' end, 'C' centre, 'X' stretched (FILL or
    // pinned both sides), null unknown (no spec, space-between, baseline, no layout container)
    const alignOf = (id, ax) => {
      const s = specById.get(id), c = specParent.get(id);
      if (!s) return null;
      if (s.abs) { const con = ax ? s.abs.cy || 'T' : s.abs.c || 'L'; return { L: 'S', T: 'S', R: 'E', B: 'E', C: 'C', LR: 'X', TB: 'X' }[con] || null; } // SCALE (R47): unknown
      if (!c || !c.lay || !c.lay.d) return null;
      if (sz(id, ax) === 'FILL') return 'X';
      const al = ax === mainOf(c) ? (c.lay.sb ? null : c.lay.pa) : c.lay.ca;
      return al === 'S' || al === 'E' || al === 'C' ? al : null;
    };
    // R57: a stretched (FILL) item on its flow container's main axis is placed by the packing of that row / column:
    // start-packed (or space-between, or no packing given) by its near edge, end-packed by its far edge, centred by its
    // middle; never "near or far" (a padding error the FILL item absorbs moves its packed edge). Its own shrink /
    // weightedFill flag still explains only its size. Cross-axis stretch and absolute LR / TB pins stay 'X'.
    const posAlign = (id, ax) => {
      const al = alignOf(id, ax);
      if (al !== 'X') return al;
      const s = specById.get(id), c = specParent.get(id);
      if (!s || s.abs || !c || !c.lay || mainOf(c) !== ax) return al;
      const pa = c.lay.sb ? 'S' : c.lay.pa;
      return pa === 'E' || pa === 'C' ? pa : 'S';
    };
    const posOK = (e, ax, withParentFar, strict = false) => {
      const t = tolOf(e.n), all = edges(D.get(e.n.id), ax), al = posAlign(e.n.id, ax);
      // R34 (M1): a node stays where it is anchored: its own aligned edge (start / end / centre; near or far when
      // stretched or unknown); the middle edges (its own and its ancestor's) count only for a centred node
      // An aligned node whose own edge stayed while its ancestor's same edge moved beyond tolerance is not at its
      // source place relative to its anchor (a centred tallest item with a padding swap keeps its middle): no excuse.
      const a = ancestor(e);
      // R35: unknown alignment is taken as start (only the near edge excuses; no middle / far edge, no R33)
      const ix = al === 'S' || al === null ? 0 : al === 'E' ? 1 : al === 'C' ? 2 : -1;
      const anchorMoved = ix >= 0 && !!a && outside(a.n.id) && Math.abs(edges(D.get(a.n.id), ax)[ix]) > t + EPS;
      const own = ix >= 0 ? [all[ix]] : [all[0], all[1]];
      if (!anchorMoved && own.some((v) => Math.abs(v) <= t + EPS)) return true;
      const mine = al === 'C' ? all : [all[0], all[1]];
      // a reference is [value, the node's edges that may follow it]
      const hit = ([r, es]) => Math.abs(r) > t + EPS && es.some((v) => Math.abs(v - r) <= t + EPS);
      const refs = [];
      const aHug = !!a && sz(a.n.id, ax) === 'HUG';
      let far = null;
      if (a && outside(a.n.id)) {
        // an aligned node follows its ancestor only by its aligned edge (start: near, end: far, centre: middle); a
        // stretched or unknown one by its near or far edge, to the ancestor's near or far edge
        const pe = edges(D.get(a.n.id), ax);
        let fm = [];
        if (ix === 0) refs.push([pe[0], [all[0]]]);
        else if (ix > 0) fm = [[pe[ix], [all[ix]]]];
        else { refs.push([pe[0], mine]); fm = [[pe[1], mine]]; }
        if (withParentFar && !aHug) refs.push(...fm);
        else if (withParentFar && !strict) far = fm;
      }
      const p = prevOf(e);
      if (p && outside(p.n.id) && (!aHug || changedRel(p.n, ax, a))) { const se = edges(D.get(p.n.id), ax); refs.push([se[0], mine], [se[1], mine]); }
      if (refs.some(hit)) return true;
      return !!far && far.some(hit) && r33Accounts(a, e, ax);
    };
    // R33: does the HUG ancestor a's size change on ax equal the extent change of its children, counting no change of e
    // or of the siblings depending on e (later flow siblings on a's main axis or when it is unknown; on the cross axis a later
    // sibling whose edges follow e's, or a dependent's, previous-sibling edges)? Only a child's own change counts: a
    // size change on ax (its own or attributed to its subtree) or a position that is a root without R33 (strict posOK).
    // A child that only follows a reference counts as unchanged, so two centred items cannot explain each other.
    const r33Accounts = (a, e, ax) => {
      const da = D.get(a.n.id), t = tolOf(a.n);
      const sibs = (a.n.kids || []).filter((k) => D.has(k.id));
      const i = sibs.findIndex((k) => k.id === e.n.id);
      if (i < 0) return false;
      const main = mainOf(specById.get(a.n.id));
      const dep = new Set([e.n.id]);
      for (let j = i + 1; j < sibs.length; j++) {
        if (main === null || main === ax) { dep.add(sibs[j].id); continue; }
        const pv = sibs[j - 1];
        if (!dep.has(pv.id)) continue;
        // dependent: placed only from the previous sibling's edges (not at its own source edge, not at a's near edge).
        // A cross-axis size change is never a dependency (flex siblings do not size each other on the cross axis).
        // R34: with a known cross alignment a flow sibling is placed by the container, never by its neighbour
        const tk = tolOf(sibs[j]);
        if (alignOf(sibs[j].id, ax) !== null || Math.abs(D.get(sibs[j].id)[ax + 2]) > tk + EPS) continue;
        const pe = edges(D.get(pv.id), ax), me = edges(D.get(sibs[j].id), ax);
        const match = (r) => me.some((v) => Math.abs(v - r) <= tk + EPS);
        const alone = me.some((v) => Math.abs(v) <= tk + EPS) || (outside(a.n.id) && Math.abs(da[ax]) > tk + EPS && match(da[ax]));
        if (!alone && (match(pe[0]) || match(pe[1]))) dep.add(sibs[j].id);
      }
      // R34 (C1): a child's own change counts: at its layout box only when its position is itself a root without R33;
      // a size change alone counts with the child held at its source anchor (aligned edge) + n0 and its layout size, so
      // an inherited position (a padding error) cannot ride on it. e's own size change counts that way too (its
      // position never); dependents and unchanged children stay at their source box + n0.
      const ks = sibs.filter((k) => sz(k.id, ax) !== 'FILL');
      if (!ks.some((k) => !dep.has(k.id))) return false;
      // R34: a size counted alone needs a known anchor (alignment); with an unknown one it does not count, and an
      // unaligned e follows no far / middle edge (R29 stays strict)
      if (alignOf(e.n.id, ax) === null) return false;
      const sized = (k) => Math.abs(D.get(k.id)[ax + 2]) > tolOf(k) + EPS && alignOf(k.id, ax) !== null;
      const mode = (k) => {
        if (k.id === e.n.id) return sized(k) ? 'size' : 'src';
        if (dep.has(k.id) || !changedRel(k, ax, a)) return 'src';
        if (!posOK(byId.get(k.id), ax, true, true)) return 'box';
        return sized(k) ? 'size' : 'src';
      };
      const dU = extDelta(ks, ax, da[ax], mode);
      return Math.abs(da[ax + 2] - dU) <= t + EPS;
    };
    // extent change of children ks on ax. mode(k): 'box' = its layout box; 'size' = its layout size anchored at its
    // source aligned edge (start, end, centre; start when unknown) moved with the HUG node's near edge n0; 'src' = its
    // source box moved with n0; 'src0' = its source box
    const extDelta = (ks, ax, n0, mode) => {
      const ext = (boxes) => Math.max(...boxes.map((b) => b[ax] + b[ax + 2])) - Math.min(...boxes.map((b) => b[ax]));
      const now = (k) => {
        const m = mode(k), l = box(k);
        if (m === 'box') return l;
        const b = [...src(k, M)];
        if (m === 'src0') return b;
        b[ax] += n0;
        if (m === 'size') {
          const al = alignOf(k.id, ax), dz = l[ax + 2] - b[ax + 2];
          b[ax] -= al === 'E' ? dz : al === 'C' ? dz / 2 : 0; b[ax + 2] = l[ax + 2];
        }
        return b;
      };
      return ext(ks.map(now)) - ext(ks.map((k) => src(k, M)));
    };
    // HUG on axis ax: does the size change equal the extent change of the non-FILL children, counting changes only of
    // grounded ones? Grounded = not positioned only from this node's far/middle edge (following those is circular).
    // R19: a child within tolerance counts as unchanged (its source box), so nested HUG levels cannot each hide tol.
    // R25: decided per axis (that axis's position and size deltas both within tol), so a deviation on the other axis
    // does not make the child's sub-tolerance drift on this one count.
    // R32: "unchanged" is relative to this HUG node's own near-edge delta on ax (an unchanged child sits at its source
    // box moved with that edge).
    const hugAccounts = (e, ax) => {
      const d = D.get(e.n.id), t = tolOf(e.n);
      // R34 (C2) on the main axis of a flow row/column (no wrap, no space-between, every flow item a source node in
      // order, none FILL): the extent change is the sum of the items' size changes and the gap changes between them
      // (next near edge minus previous far edge); a term within tolerance counts as 0 (R19), so sub-tolerance drift
      // cannot add up to the node's growth from either kind
      const sp = specById.get(e.n.id), fk = sp && sp.lay && !sp.lay.wrap && !sp.lay.sb && mainOf(sp) === ax ? flowKids(sp) : null;
      const srcKids = (e.n.kids || []).filter((k) => D.has(k.id) && !(specById.get(k.id) || {}).abs);
      if (fk && fk.length && fk.length === srcKids.length && fk.every((k, i) => k.id === srcKids[i].id && sz(k.id, ax) !== 'FILL')) {
        let dU = 0;
        srcKids.forEach((k, i) => {
          const dk = D.get(k.id), tk = tolOf(k);
          if (Math.abs(dk[ax + 2]) > tk + EPS) dU += dk[ax + 2];
          if (i) { const dp = D.get(srcKids[i - 1].id), g = dk[ax] - (dp[ax] + dp[ax + 2]); if (Math.abs(g) > tk + EPS) dU += g; }
        });
        return Math.abs(d[ax + 2] - dU) <= t + EPS;
      }
      // an ungrounded child stays in the extent, held at its source box (its change does not count, R33)
      const ks = (e.n.kids || []).filter((k) => D.has(k.id) && sz(k.id, ax) !== 'FILL');
      const grounded = (k) => posOK(byId.get(k.id), ax, false) || !posOK(byId.get(k.id), ax, true);
      if (!ks.length) return false;
      // R34 (C2): a child counts as changed only when it changed relative to n0 AND is outside tolerance on ax
      // absolutely (then it is examined as a root candidate itself). Otherwise it is held: at its source box + n0 when
      // unchanged relative to n0, at its source box when within tolerance absolutely (where it is: the far end of an
      // end-anchored row), so sub-tolerance offsets of either kind cannot add up to the node's growth
      const absOut = (k) => { const dk = D.get(k.id), tk = tolOf(k); return Math.abs(dk[ax]) > tk + EPS || Math.abs(dk[ax + 2]) > tk + EPS; };
      // an ungrounded child (it follows this node's far / middle edge) counts only when its size changed (a centred or
      // end-aligned item that became the tallest defines the node's height): R33 already checked, with its position
      // held, that this growth accounts for the node's
      const sized = (k) => Math.abs(D.get(k.id)[ax + 2]) > tolOf(k) + EPS;
      const dU = extDelta(ks, ax, d[ax], (k) => (!changedRel(k, ax, e) ? 'src' : !absOut(k) ? 'src0' : grounded(k) || sized(k) ? 'box' : 'src'));
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
    const mainIn = (id) => mainOf(specParent.get(id));
    const flagged = (id, k) => (flagsById.get(id) || []).includes(k);
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
      // R49: position is checked per axis independently of size (by the aligned edge, R34/R35), so a size change,
      // explained or not, never hides a displacement on that axis; both are listed when both fail
      for (const ax of [0, 1]) {
        if (!sizeOK(e, ax)) why.push(ax ? 'h' : 'w');
        if (!posOK(e, ax, true)) why.push(ax ? 'y' : 'x');
      }
      if (!why.length) { followers++; continue; }
      const root = { id: e.n.id, width: M, delta: D.get(e.n.id), why };
      if (model) { mroots.push(root); continue; }
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
    for (const [e, ax] of model ? [] : flexSized) {
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
    return { mroots, followers };
  };
  for (const M of layout ? W : []) attribute(M, LD[M], false, (k) => layout[M].boxes[k.id]);

  // ---- Figma-model deltas (R18): modelled-proxy delta minus layout-proxy delta, whatever the layout state ----
  // R43: the model deltas go through the same root / follower attribution as the layout deltas. Every model root is
  // listed with its magnitude (modelDeltas, or needsApproval above tolModel); followers are counted (modelFollowers),
  // not listed. modelDrift = the largest accumulated model delta on any node of the screen (followers included); above
  // tolModel it is one needsApproval entry (drift: true) unless a listed model root already carries that magnitude,
  // so many small steps adding up beyond tolModel can never pass unseen.
  const modelDeltas = [], needsApproval = [], modelFollowers = { A: 0, B: 0 };
  let modelDrift = null;
  const mag = (d) => r2(Math.max(...d.map(Math.abs)));
  for (const M of layout ? W : []) {
    const DD = new Map();
    for (const { n } of list) {
      const md = MD[M].get(n.id), ld = LD[M].get(n.id);
      if (md && ld) DD.set(n.id, sub(md, ld));
    }
    for (const { n } of list) {
      const dd = DD.get(n.id);
      if (dd && !within(n, dd) && (!modelDrift || mag(dd) > modelDrift.magnitude)) modelDrift = { id: n.id, width: M, delta: dd, magnitude: mag(dd) };
    }
    const { mroots, followers } = attribute(M, DD, true, (k) => { const b = src(k, M), d = DD.get(k.id); return [0, 1, 2, 3].map((i) => b[i] + d[i]); });
    modelFollowers[M] = followers;
    for (const r of mroots) {
      const e = { id: r.id, width: M, delta: r.delta, why: r.why, magnitude: mag(r.delta), explainedBy: 'figmaModel' };
      (e.magnitude > tolModel + EPS ? needsApproval : modelDeltas).push(e);
    }
  }
  if (modelDrift && modelDrift.magnitude > tolModel + EPS && !needsApproval.some((e) => e.magnitude >= modelDrift.magnitude - EPS)) {
    needsApproval.push({ ...modelDrift, drift: true, explainedBy: 'figmaModel' });
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
    // R55: a text whose spec carries no font family cannot have its font checked: unchecked, never a silent skip
    if (isTextSrc(n) && !(s && s.font && s.font.ff != null)) uncheck(n.id, 'text without a font family in the spec: its font cannot be checked');
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

  // ---- layer 3: R50 paint the crops cannot see on large nodes (any size; source computed vs proxy DOM, never the spec) ----
  const miss = new Set();
  const faceMiss = Array.isArray(proxy.A && proxy.A.facesMissing) ? [...proxy.A.facesMissing, ...((proxy.B && proxy.B.facesMissing) || [])] : null;
  for (const { n } of dom ? list : []) {
    const d = dom[n.id];
    if (!d) continue;
    const id = n.id;
    // corner radii of a box (a text is drawn without its box: R46 inline-box)
    if (!isTextSrc(n)) {
      if (!Array.isArray(d.radius)) miss.add('radius');
      else {
        const s = (n.paint && n.paint.radius) || [];
        CORNERS.forEach((c, i) => {
          const expected = normRadius(s[i]), actual = normRadius(d.radius[i]);
          if (expected !== actual) data.push({ id, kind: 'radius', side: c, expected, actual });
        });
      }
    }
    // font size / weight / style / decoration / transform per run, character by character (the proxy may split runs
    // differently); only when the texts agree (a text mismatch is already a finding)
    if (isTextSrc(n) && n.font) {
      if (!Array.isArray(d.runs)) miss.add('font-style');
      else {
        const src = (n.runs || []).filter((r) => !r.br).map((r) => { const f = { ...n.font, ...(r.s || {}) }; return [r.t, f.fs, f.fw, f.fst, f.td, f.tt]; });
        for (const f of runStyleDiff(src, d.runs)) data.push({ id, kind: 'font-style', ...f });
        // R55: every face a run uses (family, style, weight as rendered) must have loaded in the proxy
        if (!Array.isArray(faceMiss)) miss.add('font-face');
        else {
          const seen = new Set();
          for (const r of d.runs) {
            if (!/\S/.test(String(r[0] ?? ''))) continue;
            const fam = firstFamily(r[6] ?? d.ff ?? ''), ital = /italic|oblique/.test(r[3] || '') ? 1 : 0;
            const w = Math.min(900, Math.max(100, Math.round((parseFloat(r[2]) || 400) / 100) * 100)), key = `${fam}|${ital}|${w}`;
            if (seen.has(key) || !faceMiss.includes(key)) continue;
            seen.add(key);
            const face = `${fam} ${w}${ital ? ' italic' : ''}`;
            data.push({ id, kind: 'font-face', expected: face, actual: `${face} did not load (synthesised or fallback)` });
          }
        }
      }
    }
    // inline svg: the serialised markup (inner paint inlined by capture, R48) by hash, the root's own inlined style, and
    // the root paint the proxy sets from the source computed values
    if (n.kind === 'icon' && n.icon && n.icon.svg) {
      if (d.svg === undefined) miss.add('svg');
      else if (!d.svg) data.push({ id, kind: 'svg', prop: 'markup', expected: 'inline svg', actual: 'none drawn' });
      else {
        const s = splitSvgRoot(n.icon.svg), hs = sha(s.markup), hp = sha(d.svg.markup);
        if (hs !== hp) data.push({ id, kind: 'svg', prop: 'markup', expected: `sha1 ${hs} (${s.markup.length} chars)`, actual: `sha1 ${hp} (${String(d.svg.markup).length} chars)` });
        if (s.own !== (d.svg.own || '')) data.push({ id, kind: 'svg', prop: 'root style', expected: s.own || 'none', actual: d.svg.own || 'none' });
        const ic = n.icon, p = d.svg.paint || [];
        [['color', ic.color], ['fill', ic.fill], ['stroke', ic.stroke], ['stroke-width', ic.sw]].forEach(([prop, v], i) => {
          const norm = prop === 'stroke-width' ? (x) => (x == null ? '1px' : `${r2(parseFloat(x))}px`) : (x) => (x == null ? 'none' : normColor(x));
          if (v != null && norm(v) !== norm(p[i])) data.push({ id, kind: 'svg', prop, expected: norm(v), actual: norm(p[i]) });
        });
      }
    }
    // image: object-fit, object-position and source as rendered
    if (n.kind === 'image') {
      if (d.img === undefined) miss.add('image');
      else if (!d.img) data.push({ id, kind: 'image', prop: 'src', expected: n.src ? short(n.src) : `${n.tag || 'image'} content`, actual: 'no image' });
      else {
        for (const [prop, expected, actual] of [['object-fit', n.fit || 'fill', d.img.fit], ['object-position', n.pos || '50% 50%', d.img.pos], ['src', n.src || '', d.img.src || '']]) {
          if (String(expected).trim() !== String(actual ?? '').trim()) data.push({ id, kind: 'image', prop, expected: short(expected), actual: short(actual) });
        }
      }
    }
  }
  for (const k of miss) skipped.push(k);

  // ---- layer 3: R46 unsupported paint (any size) and effect data (box-shadow, background-image; any size) ----
  const hasFlagD = (id, kind) => (flagsById.get(id) || []).includes(kind);
  const rasterAt = (e) => { for (let a = e; a; a = a.parent) if (hasFlagD(a.n.id, 'raster')) return true; return false; };
  let noEffect = false;
  for (const e of list) {
    const n = e.n, p = n.paint || {};
    if (rasterAt(e)) continue; // drawn as an image (spec §7 raster fallback): the effect is in the pixels
    const un = [...(p.unsupported || [])];
    // a text node is drawn as text only: a box painted behind or around it (inline background, shadow, border) is lost
    if (isTextSrc(n)) {
      const box = [p.bg && `background-color ${p.bg}`, p.bgImage && `background-image ${p.bgImage}`, p.shadow && `box-shadow ${p.shadow}`,
        Array.isArray(p.border) && p.border.some((b) => b && b.w > 0) && 'border'].filter(Boolean);
      if (box.length) un.push({ prop: 'inline-box', value: box.join('; ') });
    }
    for (const u of un) data.push({ id: n.id, kind: 'unsupported', prop: u.prop, expected: u.value, actual: 'not drawn' });
    const d = dom && dom[n.id];
    if (!d || isTextSrc(n)) continue;
    if (d.shadow == null || d.bgImage == null) { noEffect = true; continue; }
    const norm = (v) => (v == null || v === '' || v === 'none' ? 'none' : String(v).replace(/\s+/g, ' ').trim());
    for (const [prop, expected, actual] of [['box-shadow', norm(p.shadow), norm(d.shadow)], ['background-image', norm(p.bgImage), norm(d.bgImage)]]) {
      if (expected !== actual) data.push({ id: n.id, kind: 'effect', prop, expected, actual });
    }
  }
  if (dom && noEffect) skipped.push('effect');

  // ---- layer 3: crops (A and B) ----
  const crop = [], cropExplained = [], cropLinked = [];
  const hasFlag = (id, kind) => (flagsById.get(id) || []).includes(kind);
  const rasterIn = (e) => { for (let a = e; a; a = a.parent) if (hasFlag(a.n.id, 'raster')) return true; return false; };
  // R44: a crop fail on a node that is itself a size root at that width (size delta beyond the crop search, so the
  // box change alone makes the windows differ) is attached to that root and shares its status: explained by the
  // same flag (cropExplained), or linked to the unexplained root (cropLinked: it passes only if that root is
  // approved). A crop fail anywhere else, a descendant of a root included, stands alone.
  const cropShift = opts.shift ?? 1;
  const sizeRoot = new Map();
  for (const r of roots) {
    if (!r.why.some((w) => w === 'w' || w === 'h')) continue;
    if (!r.why.some((w) => (w === 'w' && Math.abs(r.delta[2]) > cropShift + EPS) || (w === 'h' && Math.abs(r.delta[3]) > cropShift + EPS))) continue;
    sizeRoot.set(`${r.id}|${r.width}`, r);
  }
  if (!Array.isArray(crops)) skipped.push('crop');
  else {
    for (const c of crops) {
      if (!(c.ratio > cropRatio || (c.peak ?? 0) >= cropPeak)) continue;
      const e = byId.get(c.id), r = sizeRoot.get(`${c.id}|${c.width}`);
      if (e && rasterIn(e)) cropExplained.push({ ...c, explainedBy: 'raster' });
      else if (r && r.explainedBy) cropExplained.push({ ...c, explainedBy: r.explainedBy, root: r.id });
      else if (r) cropLinked.push({ ...c, root: r.id });
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
    crop.length === 0 && cropLinked.length === 0 && data.length === 0 && needsApproval.length === 0;
  return {
    id: screen.id, checked, total: list.length, unchecked, uncheckedReasons, nodes, roots, modelDeltas, modelFollowers, modelDrift, needsApproval,
    crop, cropExplained, cropLinked, cropChecked: Array.isArray(crops) ? crops.length : 0, cropWidths: Array.isArray(crops) ? [...new Set(crops.map((c) => c.width))] : [],
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
    const flat = flatten(screen.tree);
    // R50: a leaf that paints content (text, icon, image) is cropped at any size; containers above maxArea rely on
    // the data checks (colour, radius, stroke, effect, visibility)
    const paintLeaf = (n) => !(n.kids && n.kids.length) && (isTextSrc(n) || n.kind === 'icon' || n.kind === 'image');
    const rect = (n) => { const s = M === 'A' ? n.rA : n.rB, b = P.boxes[n.id]; return s && b && s[2] * s[3] > 0 && (s[2] * s[3] <= maxArea || paintLeaf(n)) ? [s, b] : null; };
    const cropped = new Map(flat.map(({ n }) => [n.id, rect(n)]).filter(([, r]) => r));
    // R45: a container compares its own paint only: every descendant that has its own crop is masked (in the source
    // image at its source box, in the proxy image at its proxy box); a descendant without a crop stays in the window
    const descMasks = (n, out = [[], []]) => {
      for (const k of n.kids || []) { const r = cropped.get(k.id); if (r) { out[0].push(r[0]); out[1].push(r[1]); } descMasks(k, out); }
      return out;
    };
    for (const { n } of flat) {
      const r = cropped.get(n.id);
      if (!r) continue;
      const [ma, mb] = descMasks(n);
      pairs.push({ id: n.id, rectA: r[0], rectB: r[1], ...(ma.length ? { masksA: ma, masksB: mb } : {}) });
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
