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
//   allowlist entry that covers a size never covers a position. R60 (replaces the packing-based R57): a FILL item on
//   its flow container's main axis is judged like space-between whatever the packing (a FILL item takes the free
//   space): the first item by its near edge, the last by its far edge, a sole item by both, others near or far. A
//   padding error the FILL item absorbs moves its outer edge.
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
//   size, weight, style, text-decoration line, text-transform, first family and colour (M-b) of every non-blank character, from the source runs
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
//   serialised markup does not carry; R59 'image fit/position': object-fit other than cover / contain / fill or an
//   object-position off the centre, which a Figma image fill cannot reproduce; and any box paint on a text node,
//   which the proxy draws as text only),
//   unless the node is inside a raster node; effect (non-text nodes: source computed box-shadow and background-image
//   vs the proxy DOM's `shadow` / `bgImage`; a DOM without them puts 'effect' in `skipped`). Data findings are never
//   allowlistable (pipeline gate).
//   crops: input.crops = [{id, width, ratio, diff, peak}] from measureCrops at A and B on source nodes whose box has
//   area <= 4000px² and (R50) on leaves that paint content (text, icon, image) of any size, each window with the boxes of its own cropped descendants masked (R45: a container compares its
//   own paint; children are compared in their own crops). Fails when ratio (differing / ink pixels) > 0.05 or peak (differing pixels in the densest
//   8x8 CSS px square) >= 40. A failure on a node that is (inside) a raster node is in `cropExplained`. R44: a failure on a
//   node that is itself a size root at that width (size delta > the 1px crop search) shares the root's status: in
//   `cropExplained` with the root's flag, or in `cropLinked` ({..., root}) for an unexplained root; any other failure,
//   inside a root's subtree included, is in `crop`. R61: a crop fail on an icon/image leaf whose size root is explained
//   stays in `crop` (with sizeExplainedBy): the drawn content does not stretch with the box, so it really moved.
//   R72: a text leaf's window in the proxy image is anchored at the edge its source text-align anchors the glyphs to
//   (right / end: right edge, center: centre, else left), so a right aligned text whose box only grew to the left
//   (Planora s11: CSS flex-shrink sized the source column to its content, Figma FILL splits it equally) compares the
//   glyphs that are really drawn at the same place; a glyph moved inside its box is still a fail.
// pixel (whole screen, modelled proxy; the norm proxy with input.norm) and strict (share of checked nodes within
// tolerance, modelled) are reference.
//
// R66, the normalised spec (plan 2 Task 6). input.norm = { spec (applyNorm's target spec), applied (its records
// { entry, cat, code, node, run?, prop, from, to }), proxy: {A, B} (renderProxy of norm.spec: model 'figma' plus mark
// 'norm'; a missing / wrong mark, or the modelled proxy passed again, throws) }. Without input.norm nothing below runs
// and the report has no `norm` key (plan-1 behaviour byte for byte). With it the chain is source -> layout (roots) ->
// modelled (figmaModel, R18) -> norm, each step explained on its own: the plan's condition (c) "the rest is within
// tolerance or figmaModel" is the plan-1 verdict on the layout and modelled proxies, unchanged.
//  - coverage: a node without a norm box at A or B is unchecked.
//  - layer 2: the norm deltas (norm proxy box minus modelled proxy box, per node) go through the same root / follower
//    attribution as the R18 model deltas (condition (a)); followers are counted (norm.followers). Each norm root is
//    listed in `roots` with layer 'norm'; it is explainedBy 'norm' (entry = the entries of the records used) only when
//    (b) a box record (any category but colour and radius: those never explain a box change) sits in the subtree of
//    the node's nearest source ancestor (through syn frames), i.e. on the node, its layout parent, a sibling or
//    anything inside them (padding / gap move the children and resize a HUG parent, a resized sibling pushes it, a HUG
//    frame follows its children), AND (agreement) on every axis in root.why the measured norm delta equals,
//    within the node's tolerance, what the records predict for that node:
//      own size: a FIXED width / height record -> to - from; a HUG auto-layout frame -> its padding records (near +
//      far) + (flow items - 1) x its gap record + the measured size changes of its flow items (main axis), or the
//      change of their largest measured size (cross axis); a FILL item -> its parent's measured size change minus the
//      parent's padding and gap records minus the non-FILL items' measured changes, shared equally (cross axis: minus
//      the padding records); a HUG text with a line-height record -> lines x (to - from), lines = modelled height /
//      from; with a font-size record -> modelled size x (to / from - 1) (tolerance 25 % of that, at least the node's;
//      height 0 when the line height is in px); anything else 0.
//      position: from the parent's measured box (near / far / middle edge) by the node's alignment there (start, end,
//      centre, stretch; abs constraints L/R/C/LR), plus the parent's padding records, its gap record x the number of
//      flow items before (or after) the node and the measured size changes of those items; space-between distributes
//      the measured free-space change. Wrap, baseline, SCALE and a container without a direction give no prediction.
//    No prediction or a disagreement -> the root stays unexplained, with normMismatch [{ axis, measured, predicted }]:
//    a record whose `to` is wrong predicts another delta (padding 13 -> 12 shifts the children by -1 px and shrinks a
//    HUG parent by 1 px; a record claiming 13 -> 8 predicts -5 px). An unexplained norm root fails the screen and can
//    never be allowlisted (pipeline gate); `norm` roots need no allowlist.
//    Record check: every box record is also checked where it acts, root or not, with the same predictions: its node's
//    own size on the axes it sets (a FIXED width / height, a HUG frame's padding / gap axis, a HUG text's line height
//    or font size axis) and the position of every flow item of a frame whose padding / gap it sets (a lie smaller than
//    a root, e.g. line-height 25.3 -> 25 claimed as 29, still predicts 4 px per line). A disagreement is an unexplained
//    norm root on that node (recordCheck: true, normMismatch); a missing prediction there is not checked.
//  - static audit (data kind 'norm-spec', never allowlistable): every field that differs between the modelled spec and
//    the target spec must be covered by a record on that node with the matching category / prop, from = the old value
//    and to = the new value (numbers within 0.01 px, colours by hex); font.remeasure only with a type record. A record
//    with to != from that no difference uses, a node added / removed and changed children are findings too.
//  - layer 3 reads the norm proxy DOM. An expected value (source computed) that equals a record's `from` on that node
//    (text / run colour, background, border colour and width, icon paint, corner radius, run font size) is replaced by
//    the record's `to`; any other difference stays a data finding (so a wrong `to` is a finding against the record).
//  - crops (measured on the norm layout proxy, pipeline; input.cropsOn 'layout' with input.norm = the norm layout
//    could not be built -> 'norm-crop' skipped): a crop fail may be explained 'norm' only when the node itself has a
//    colour, radius or icon record, an ICON_FRAME / SRC_SQUASH record, or (a text) a TYPE_SCALE / LINE_HEIGHT_INT
//    record (on a norm-explained size root too, else it stays in `crop`, sizeExplainedBy 'norm'); R61 holds: an icon /
//    image leaf on an explained size root needs its own ICON_FRAME / SRC_SQUASH record.
//    R77 (whole-branch review C1: any record excused any crop, an invisible ΔE < 1 colour record a 90 % crop fail):
//    such a record explains the crop only when the change comes from it: (i) the same node's crop of the source
//    against the plain layout proxy passes (input.cropsLayout, measured by verifyScreenWithImages for the failing
//    crops: without the records there is no fault), and (ii) the record is not in norm.unused and its change shows:
//    the node's crop of the norm layout proxy against the layout proxy fails (input.cropsNormVsLayout, measureCrops
//    with opts.base). Missing measurements explain nothing. Otherwise the crop stays open with `normWhy`.
//    An icon / image leaf's own ICON_FRAME / SRC_SQUASH record replaces (i) (the plain layout proxy cannot draw such a
//    leaf as the source does: that is why the record exists) by: the norm layout proxy draws the node at every such
//    record's `to` (within tolFrame) and the source size differs from `to` beyond the crop search on one of them.
//  - R74 (SRC_SQUASH restoring a FIXED size, the Planora `.say` avatar): a size / icon record with szFrom (apply-norm
//    turned a FILL / HUG axis into FIXED at `to`) predicts the node's own size as `to` minus its modelled proxy size
//    (not to - from: the modelled FILL box was never `from` wide); the node no longer counts as a FILL item of its
//    parent, so its FILL siblings absorb the difference (a weightedFill flag blocks the prediction only while two FILL
//    items remain) and positions follow the measured sizes as before. The static audit accepts sz[axis] going from
//    szFrom to FIXED only from such a record. A HUG text whose own width changed beyond tolerance reflows: its height
//    is predicted as a whole number of lines of its line height (record `to`, else the spec's px value; never more
//    lines when wider, never fewer when narrower; a font-size record or a non-px line height gives no prediction),
//    (its scope reaches what resized its parent through R76). Crops: an icon / image leaf with its own
//    ICON_FRAME / SRC_SQUASH record is explained 'norm' whatever explained its size root (a layout flag such as
//    shrink included), since the record is what changes the drawn content (when R77 holds).
//  - R76: scope (b) climbs while the nearest source ancestor itself changed beyond its tolerance in the norm proxy
//    (its norm delta): a node inside a parent that a record moved or resized answers to that record, still predicted
//    from the parent's measured box (a space-between row's last item in a card narrowed by the screen padding).
//  - R75 (plan 2 Task 9: "layers 2-3 run on the norm proxy instead of the figma one"): with a norm layout proxy
//    (input.normLayout, the records replayed on the unmodelled spec), the Figma-model layer (modelDeltas,
//    needsApproval, modelDrift, R18 / R43) compares the norm proxy with the norm layout proxy, i.e. the Figma model
//    of the spec that will be built, instead of the modelled proxy with the layout proxy. A plan-1 approval with no
//    counterpart there (same node and width; a drift entry with a drift entry) is listed in norm.approvalsResolved
//    { id, width, magnitude, drift? } (Planora's text round-up drift once line heights are whole px: Figma no longer
//    rounds the boxes, and what the target layout changes is each text's own record, checked above). One that
//    remains, or a new one, is a needsApproval entry as before. No norm layout proxy: the plan-1 layer stands.
//  - R78 (review I2: the norm layout proxy was trusted unchecked): input.normLayout must be marked 'normLayout' with
//    model 'none' (the layout or the norm proxy passed in its place throws). The R66 layer-2 pass (attribution,
//    agreement, record check, R76 scope) runs a second time on the norm layout proxy against the layout proxy (the
//    same arithmetic, base = layout): every unexplained deviation there is an open norm root (`on: 'normLayout'`, never
//    allowlistable; explained ones are not listed). A node without a norm layout box is unchecked. A plan-1 approval
//    is resolved by R75 only when the node or its record scope carries a box (incl. type) record; otherwise it stays
//    a needsApproval entry (normWhy).
//  - m8: with input.norm.entries (ds.mjs / pipeline pass the normalize entries) every record must name an entry with
//    status auto / answered and the same prop, category, from and to; any other record explains nothing and is a
//    `norm-spec` data finding (path 'record <entry>'). Only a SRC_SQUASH record restores a FIXED size (R74 szFrom).
//  - 'ask' entries have no records (applyNorm skips them) and a record carrying a status other than auto / answered
//    is ignored: nothing a question has not answered explains anything.
//  - report.norm = { applied (records used), explainedRoots, explainedCrops, unexplained (ids of unexplained norm
//    roots), unused (records that change nothing measurable: no norm box change > 0.05 px on the node or its
//    children at A or B and the same DOM observation at A; colour records with ΔE2000 < 1 are exempt; never failing),
//    followers {A, B} }.
import { createHash } from 'node:crypto';
import { firstFamily } from './font-map.mjs';
import { cropDiffMany, pixelDiff } from './imgdiff.mjs';
import { parseColor, toHex, deltaE2000 } from './color.mjs';

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

// ---- R66 helpers ----
const NORM_APPLY = new Set(['auto', 'answered']);
const NORM_MOVED = 0.05; // px: a norm box change below this is not a measurable change (unused records)
const pxNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /^\s*(-?\d*\.?\d+)(px)?\s*$/.exec(String(v ?? ''));
  return m ? +m[1] : null;
};
const hexOf = (v) => {
  if (typeof v !== 'string') return null;
  const c = parseColor(v);
  return c.unparsed !== undefined ? null : toHex(c);
};
const recEq = (cat, a, b) => {
  if (cat === 'color') { const x = hexOf(a), y = hexOf(b); return x !== null && x === y; }
  const x = pxNum(a), y = pxNum(b);
  return x !== null && y !== null && Math.abs(x - y) <= 0.01 + EPS;
};
// a record's colour as the proxy DOM computes it
const rgbOf = (hex) => {
  const c = parseColor(String(hex));
  if (c.unparsed !== undefined) return String(hex);
  const ch = [c.r, c.g, c.b].map((x) => Math.round(x * 255)).join(', ');
  return normColor(c.a >= 1 ? `rgb(${ch})` : `rgba(${ch}, ${c.a})`);
};
// a record that can move or resize a box (colour and radius never do)
const isBoxRec = (a) => a.cat !== 'color' && a.cat !== 'radius';
const recDv = (a) => Number(a.to) - Number(a.from);
// spec field path (static audit) -> [categories, record prop]
const AUDIT = [
  [/^lay\.p\.([0-3])$/, (m) => [['space'], ['paddingT', 'paddingR', 'paddingB', 'paddingL'][+m[1]]]],
  [/^lay\.g$/, () => [['space'], 'gap']], [/^lay\.cg$/, () => [['space'], 'counterGap']],
  [/^w$/, () => [['size', 'icon'], 'width']], [/^h$/, () => [['size', 'icon'], 'height']],
  [/^font\.fs$/, () => [['type', 'icon'], 'fontSize']], [/^runs\.\d+\.s\.fs$/, () => [['type'], 'fontSize']],
  [/^font\.lh$/, () => [['type'], 'lineHeight']],
  [/^font\.c$/, () => [['color'], 'color']], [/^runs\.\d+\.s\.c$/, () => [['color'], 'color']],
  [/^icon\.(color|fill|stroke)$/, (m) => [['color'], m[1]]], [/^paint\.bg$/, () => [['color'], 'bg']],
  [/^paint\.radius\.([0-3])$/, (m) => [['radius'], `radius${['TL', 'TR', 'BR', 'BL'][+m[1]]}`]],
  [/^paint\.border\.([0-3])\.w$/, (m) => [['border'], `border${'TRBL'[+m[1]]}`]],
  [/^paint\.border\.([0-3])\.color$/, (m) => [['color'], `border${'TRBL'[+m[1]]}`]],
];
// leaf values of a spec node (its kids excluded) by dotted path
const leafPaths = (s) => {
  const out = new Map();
  const v = (x, p) => {
    if (x !== null && typeof x === 'object') { for (const [k, y] of Object.entries(x)) v(y, p ? `${p}.${k}` : k); return; }
    out.set(p, x);
  };
  for (const [k, y] of Object.entries(s)) if (k !== 'kids') v(y, k);
  return out;
};

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
// M-b: also each run's first font family and colour (a run styled apart from its text node: a coloured <b>, a <code>)
const RUN_PROPS = ['font-size', 'font-weight', 'font-style', 'text-decoration', 'text-transform', 'font-family', 'color'];
const runNorm = [(v) => `${r2(parseFloat(v))}px`, (v) => String(v ?? '400'), (v) => String(v || 'normal'), (v) => String(v || 'none'), (v) => String(v || 'none'),
  (v) => firstFamily(v ?? ''), (v) => normColor(v)];
// runs [[text, fs, fw, fst, td, tt, ff, colour]] of the source and of the proxy DOM, compared per non-blank character;
// one finding per property (its first differing character). Texts that differ are not compared here (the text check
// reports them).
function runStyleDiff(src, dom) {
  const chars = (runs) => {
    const out = [];
    for (const r of runs) for (const ch of String(r[0] ?? '')) if (/\S/.test(ch)) out.push([ch, ...r.slice(1, 8).map((v, i) => runNorm[i](v))]);
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
  // R66: the norm proxy is rendered from the normalised (modelled) spec and marked 'norm'
  const norm = input.norm || null;
  const NP = norm ? norm.proxy || {} : null;
  for (const M of norm ? W : []) {
    const P = NP[M];
    if (!P || P.model !== 'figma' || P.mark !== 'norm' || P === proxy[M]) {
      throw new Error(`verifyScreen: the norm proxy at ${M} must be renderProxy's result for the normalised spec with mark 'norm' (model ${JSON.stringify(P && P.model)}, mark ${JSON.stringify(P && P.mark)})`);
    }
  }

  // R78: the norm layout proxy (the records replayed on the unmodelled spec) is renderProxy's unmodelled result marked
  // 'normLayout'; the norm proxy, the layout proxy or an unmarked one passed in its place is an error
  const NL = norm && input.normLayout ? input.normLayout : null;
  for (const M of NL ? W : []) {
    const P = NL[M];
    if (!P || P.model !== 'none' || P.mark !== 'normLayout' || P === layout?.[M] || P === NP[M] || !P.boxes) {
      throw new Error(`verifyScreen: the norm layout proxy at ${M} must be renderProxy's result for the records replayed on the inferred spec with mark 'normLayout' and model 'none' (model ${JSON.stringify(P && P.model)}, mark ${JSON.stringify(P && P.mark)})`);
    }
  }

  const specById = new Map();
  const specAll = new Map(); // every spec node, syn frames included (R66 predictions and audit)
  const specParent = new Map(); // spec id -> its spec parent (syn frames included: they are the real containers)
  const indexSpec = (s) => {
    specAll.set(s.id, s);
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
  const ND = { A: new Map(), B: new Map() }; // R66: norm proxy - modelled proxy
  const NDL = { A: new Map(), B: new Map() }; // R78: norm layout proxy - layout proxy
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
      if (norm) {
        const nb = NP[M] && NP[M].boxes ? NP[M].boxes[n.id] : null;
        if (!nb) why.push(`no norm box at ${M}`);
        else if (s && p) ND[M].set(n.id, sub(nb, p));
      }
      if (NL) {
        const nl = NL[M].boxes[n.id];
        if (!nl) why.push(`no norm layout box at ${M}`);
        else if (s && l) NDL[M].set(n.id, sub(nl, l));
      }
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
    // R60 (replaces R57): a row / column with a FILL item on its main axis has no free space, so its packing is
    // irrelevant; each FILL item is judged like space-between: the first flow item by its near edge ('S'), the last by
    // its far edge ('E'), a sole item by both ('B'), an item in the middle near-or-far ('X': the spacing around it may
    // legitimately change, R28). A padding error the FILL item absorbs moves its outer edge. Its own shrink /
    // weightedFill flag still explains only its size. Cross-axis stretch and absolute LR / TB pins stay 'X'.
    const posAlign = (id, ax) => {
      const al = alignOf(id, ax);
      if (al !== 'X') return al;
      const s = specById.get(id), c = specParent.get(id);
      if (!s || s.abs || !c || !c.lay || mainOf(c) !== ax) return al;
      const ks = flowKids(c), i = ks.findIndex((k) => k.id === id);
      if (i < 0) return al;
      return ks.length === 1 ? 'B' : i === 0 ? 'S' : i === ks.length - 1 ? 'E' : al;
    };
    const posOK = (e, ax, withParentFar, strict = false, alAs) => {
      const al = alAs || posAlign(e.n.id, ax);
      // R60: a sole FILL item must be in place by its near edge and by its far edge
      if (al === 'B') return posOK(e, ax, withParentFar, strict, 'S') && posOK(e, ax, withParentFar, strict, 'E');
      const t = tolOf(e.n), all = edges(D.get(e.n.id), ax);
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
  const mag = (d) => r2(Math.max(...d.map(Math.abs)));
  // fig(M, id) / lay(M, id): the modelled / unmodelled box minus the source box
  const modelLayer = (fig, lay) => {
    const deltas = [], approvals = [], fol = { A: 0, B: 0 };
    let drift = null;
    for (const M of layout ? W : []) {
      const DD = new Map();
      for (const { n } of list) {
        const md = fig(M, n.id), ld = lay(M, n.id);
        if (md && ld) DD.set(n.id, sub(md, ld));
      }
      for (const { n } of list) {
        const dd = DD.get(n.id);
        if (dd && !within(n, dd) && (!drift || mag(dd) > drift.magnitude)) drift = { id: n.id, width: M, delta: dd, magnitude: mag(dd) };
      }
      const { mroots, followers } = attribute(M, DD, true, (k) => { const b = src(k, M), d = DD.get(k.id); return [0, 1, 2, 3].map((i) => b[i] + d[i]); });
      fol[M] = followers;
      for (const r of mroots) {
        const e = { id: r.id, width: M, delta: r.delta, why: r.why, magnitude: mag(r.delta), explainedBy: 'figmaModel' };
        (e.magnitude > tolModel + EPS ? approvals : deltas).push(e);
      }
    }
    if (drift && drift.magnitude > tolModel + EPS && !approvals.some((e) => e.magnitude >= drift.magnitude - EPS)) {
      approvals.push({ ...drift, drift: true, explainedBy: 'figmaModel' });
    }
    return { deltas, approvals, fol, drift };
  };
  let { deltas: modelDeltas, approvals: needsApproval, fol: modelFollowers, drift: modelDrift } = modelLayer((M, id) => MD[M].get(id), (M, id) => LD[M].get(id));
  // R75: with a target spec, the Figma-model layer is judged on the spec that will be built: the norm proxy (its
  // Figma model) against the norm layout proxy (the same records on the unmodelled spec). A plan-1 approval with no
  // counterpart there (same node and width; the drift entry with a drift entry) is resolved by the records
  // (norm.approvalsResolved); one that remains, or a new one, needs approval as before. Without a norm layout proxy
  // (its replay failed) the plan-1 layer stands.
  // ---- R66 records (m8: cross-checked against the report entries when verify has them) ----
  const recFindings = [];
  let recs = norm ? (norm.applied || []).filter((a) => a && (a.status == null || NORM_APPLY.has(a.status))) : [];
  if (norm && Array.isArray(norm.entries)) {
    const byEntry = new Map(norm.entries.map((x) => [String(x.id), x]));
    recs = recs.filter((a) => {
      const x = byEntry.get(String(a.entry));
      let why = null;
      if (!x) why = 'no such entry';
      else if (!NORM_APPLY.has(x.status)) why = `entry status ${x.status}`;
      else if (x.prop !== a.prop || (x.cat != null && x.cat !== a.cat) || !recEq(a.cat, x.from, a.from) || !recEq(a.cat, x.to, a.to)) why = `entry says ${x.cat} ${x.prop} ${JSON.stringify(x.from)} -> ${JSON.stringify(x.to)}`;
      if (!why) return true;
      recFindings.push({ id: String(a.node), kind: 'norm-spec', path: `record ${a.entry}`, expected: 'an auto / answered entry with the same prop, from and to', actual: `${a.cat} ${a.prop} ${JSON.stringify(a.from)} -> ${JSON.stringify(a.to)}: ${why}` });
      return false;
    });
  }
  const recsBy = new Map();
  for (const a of recs) { const k = String(a.node); if (!recsBy.has(k)) recsBy.set(k, []); recsBy.get(k).push(a); }
  const recsOf = (id) => recsBy.get(String(id)) || [];
  const mainAx = (s) => (!s || !s.lay ? null : s.lay.d === 'H' ? 0 : s.lay.d === 'V' ? 1 : null);
  const flowOf = (s) => (s.kids || []).filter((k) => !k.abs);
  const sumRec = (id, prop, cats = ['space']) => recsOf(id).filter((a) => cats.includes(a.cat) && a.prop === prop).reduce((x, a) => x + recDv(a), 0);
  const padsOf = (id, ax) => [sumRec(id, ax ? 'paddingT' : 'paddingL'), sumRec(id, ax ? 'paddingB' : 'paddingR')];
  const gapOf = (id) => sumRec(id, 'gap');
  // R74 (m8: only a SRC_SQUASH record): a record that restores a FIXED size on an axis the modelled spec had as FILL /
  // HUG (szFrom)
  const restoreOf = (id, ax) => recsOf(id).find((a) => a.code === 'SRC_SQUASH' && (a.cat === 'size' || a.cat === 'icon') && a.prop === (ax ? 'height' : 'width') && a.szFrom && a.szFrom !== 'FIXED');
  const isFillIn = (k, ax) => !!k.sz && k.sz[ax] === 'FILL' && !restoreOf(k.id, ax);
  // (b) the ids whose records can reach a node at width M: the subtree of its nearest source ancestor (through syn
  // frames), its own subtree included; R76: climbing while that ancestor itself changed beyond its tolerance in NDM
  const scopeOf = (M, id, NDM) => {
    const s = specAll.get(id);
    let a = specParent.get(id);
    while (a && a.syn) a = specParent.get(a.id);
    for (;;) {
      const da = a && byId.has(a.id) ? NDM[M].get(a.id) : null;
      if (!da || within(byId.get(a.id).n, da)) break;
      let up = specParent.get(a.id);
      while (up && up.syn) up = specParent.get(up.id);
      if (!up) break;
      a = up;
    }
    const scope = [];
    const inScope = (x) => { scope.push(x.id); (x.kids || []).forEach(inScope); };
    if (a || s) inScope(a || s);
    return scope;
  };

  let approvalsResolved = [];
  if (NL) {
    const rel = (P, M, id) => { const b = P[M] && P[M].boxes ? P[M].boxes[id] : null, e = byId.get(id), s = e && src(e.n, M); return b && s ? sub(b, s) : null; };
    const nw = modelLayer((M, id) => rel(NP, M, id), (M, id) => rel(NL, M, id));
    const kept = (a) => nw.approvals.some((b) => (a.drift ? !!b.drift : !b.drift && b.id === a.id && b.width === a.width));
    // R78: the records resolve an approval only when the node or its record scope carries a box (or type) record;
    // otherwise it stays, whatever the norm layout proxy shows
    const byRecord = (a) => scopeOf(a.width, a.id, ND).some((id) => recsOf(id).some(isBoxRec));
    const gone = needsApproval.filter((a) => !kept(a));
    approvalsResolved = gone.filter(byRecord).map((a) => ({ id: a.id, width: a.width, magnitude: a.magnitude, ...(a.drift ? { drift: true } : {}) }));
    ({ deltas: modelDeltas, approvals: needsApproval, fol: modelFollowers, drift: modelDrift } = nw);
    needsApproval = [...gone.filter((a) => !byRecord(a)).map((a) => ({ ...a, normWhy: 'no box or type record on the node or in its record scope' })), ...needsApproval];
  }

  // ---- R66: norm deltas (norm proxy minus modelled proxy), attributed like the model deltas ----
  // R78: the same pass (attribution, agreement, record check) runs on the norm layout proxy against the layout proxy
  // (BASE = layout, TGT = normLayout, on 'normLayout'): the records must explain every deviation there too
  const normFollowers = { A: 0, B: 0 };
  const dnOf = (BASE, TGT) => (M, id) => {
    const a = TGT && TGT[M] && TGT[M].boxes ? TGT[M].boxes[id] : null, b = BASE && BASE[M] && BASE[M].boxes ? BASE[M].boxes[id] : null;
    return a && b ? sub(a, b) : null;
  };
  const dnP = dnOf(proxy, NP);
  const normPass = (BASE, TGT, NDM, on) => {
  const dn = dnOf(BASE, TGT), out = [];
  // predicted change of s's own size on ax at width M ({ v, tol } or null: no prediction)
  const predSize = (M, s, ax, t) => {
    const own = recsOf(s.id), dim = ax ? 'height' : 'width';
    const szA = s.sz ? s.sz[ax] : s.t === 'V' ? 'FIXED' : null;
    const dimR = own.filter((a) => (a.cat === 'size' || a.cat === 'icon') && a.prop === dim);
    const back = restoreOf(s.id, ax);
    if (back) { // R74: the axis becomes FIXED at `to`, whatever the modelled proxy measured
      const mb = BASE[M].boxes[s.id];
      return mb ? { v: Number(back.to) - mb[ax + 2], tol: t } : null;
    }
    if (dimR.length) return { v: dimR.reduce((x, a) => x + recDv(a), 0), tol: t };
    const c = specParent.get(s.id);
    if (szA === 'FILL' && c && c.lay && c.lay.d) {
      if (c.lay.wrap) return null;
      const dc = dn(M, c.id);
      if (!dc) return null;
      const [N, F] = padsOf(c.id, ax);
      if (ax !== mainAx(c)) return { v: dc[ax + 2] - N - F, tol: t };
      const fk = flowOf(c), fills = fk.filter((k) => isFillIn(k, ax));
      // a weighted split needs two FILL items (R74: a restored item no longer shares the space)
      if (fills.length > 1 && fills.some((k) => (flagsById.get(k.id) || []).includes('weightedFill'))) return null;
      let other = 0;
      for (const k of fk) {
        if (fills.includes(k)) continue;
        const dk = dn(M, k.id);
        if (!dk) return null;
        other += dk[ax + 2];
      }
      return { v: (dc[ax + 2] - N - F - (c.lay.sb ? 0 : (fk.length - 1) * gapOf(c.id)) - other) / fills.length, tol: t };
    }
    if (s.t === 'T') {
      const fs = own.filter((a) => a.cat === 'type' && a.prop === 'fontSize'), lh = own.filter((a) => a.cat === 'type' && a.prop === 'lineHeight');
      // R74: a HUG text whose own width changed (beyond tolerance) reflows: its new height is a whole number of lines
      // (never more lines when wider, never fewer when narrower) of its line height (the record's `to`, else the
      // spec's px value); a font-size record or a non-px line height gives no prediction
      const dw = ax === 1 && szA === 'HUG' ? dn(M, s.id) : null;
      if (dw && Math.abs(dw[2]) > t + EPS) {
        if (fs.length) return null;
        const lhFrom = lh.length ? Number(lh[0].from) : pxNum(s.font && s.font.lh), lhTo = lh.length ? Number(lh[0].to) : lhFrom;
        const mb = BASE[M].boxes[s.id], nb = TGT[M].boxes[s.id];
        if (!(lhFrom > 0) || !(lhTo > 0) || !mb || !nb) return null;
        const before = Math.max(1, Math.round(mb[3] / lhFrom));
        let after = Math.max(1, Math.round(nb[3] / lhTo));
        if ((dw[2] > 0 && after > before) || (dw[2] < 0 && after < before)) after = before;
        return { v: after * lhTo - mb[3], tol: t };
      }
      if (szA !== 'HUG' || (!fs.length && !lh.length)) return { v: 0, tol: t };
      const mb = BASE[M].boxes[s.id];
      if (!mb) return null;
      if (ax === 1 && lh.length) {
        const from = Number(lh[0].from);
        if (!(from > 0)) return null;
        return { v: Math.max(1, Math.round(mb[3] / from)) * lh.reduce((x, a) => x + recDv(a), 0), tol: t };
      }
      if (!fs.length) return { v: 0, tol: t };
      const k = Number(fs[0].to) / Number(fs[0].from);
      if (!(k > 0)) return null;
      if (ax === 1 && pxNum(s.font && s.font.lh) !== null) return { v: 0, tol: t }; // a px line height keeps the line box
      const v = mb[ax + 2] * (k - 1);
      return { v, tol: Math.max(t, 0.25 * Math.abs(v)) };
    }
    if (szA === 'HUG' && s.lay && s.lay.d) {
      if (s.lay.wrap) return null;
      const [N, F] = padsOf(s.id, ax), fk = flowOf(s);
      if (!fk.length) return { v: N + F, tol: t };
      const dks = fk.map((k) => dn(M, k.id));
      if (dks.some((x) => !x)) return null;
      if (ax === mainAx(s)) return { v: N + F + (s.lay.sb ? 0 : (fk.length - 1) * gapOf(s.id)) + dks.reduce((x, dk) => x + dk[ax + 2], 0), tol: t };
      const mx = (P) => Math.max(...fk.map((k) => P[M].boxes[k.id][ax + 2]));
      return { v: N + F + mx(TGT) - mx(BASE), tol: t };
    }
    return { v: 0, tol: t };
  };
  // predicted change of s's near edge on ax at width M, from its parent's measured box and the parent's records
  const predPos = (M, s, ax, t) => {
    const c = specParent.get(s.id);
    if (!c) return { v: 0, tol: t };
    const dc = dn(M, c.id), de = dn(M, s.id);
    if (!dc || !de) return null;
    const n0 = dc[ax], f0 = dc[ax] + dc[ax + 2], dz = de[ax + 2];
    const at = (al, N, F) => (al === 'S' || al === 'X' ? n0 + N : al === 'E' ? f0 - F - dz : al === 'C' ? (n0 + f0) / 2 + (N - F) / 2 - dz / 2 : null);
    if (s.abs) {
      const al = { L: 'S', T: 'S', R: 'E', B: 'E', C: 'C', LR: 'X', TB: 'X' }[ax ? s.abs.cy || 'T' : s.abs.c || 'L'];
      return al ? { v: at(al, 0, 0), tol: t } : null;
    }
    if (!c.lay || !c.lay.d || c.lay.wrap) return null;
    const [N, F] = padsOf(c.id, ax);
    if (ax !== mainAx(c)) {
      const v = at(isFillIn(s, ax) ? 'X' : c.lay.ca ?? 'S', N, F);
      return v === null ? null : { v, tol: t };
    }
    const fk = flowOf(c), i = fk.findIndex((k) => k.id === s.id);
    if (i < 0) return null;
    const dz2 = fk.map((k) => { const d = dn(M, k.id); return d ? d[ax + 2] : null; });
    if (dz2.some((v) => v === null)) return null;
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    const before = sum(dz2.slice(0, i)), after = sum(dz2.slice(i + 1)), all = sum(dz2), n = fk.length, g = gapOf(c.id);
    const fill = fk.some((k) => isFillIn(k, ax));
    if (c.lay.sb && !fill) return { v: n0 + N + before + (n > 1 ? (i * (dc[ax + 2] - N - F - all)) / (n - 1) : 0), tol: t };
    const pa = fill ? 'S' : c.lay.pa ?? 'S';
    if (pa === 'S') return { v: n0 + N + before + i * g, tol: t };
    if (pa === 'E') return { v: f0 - F - after - (n - 1 - i) * g - dz, tol: t };
    if (pa === 'C') return { v: (n0 + f0) / 2 + (N - F) / 2 - (all + (n - 1) * g) / 2 + before + i * g, tol: t };
    return null;
  };
  const AXW = { x: [0, false], y: [1, false], w: [0, true], h: [1, true] };
  const normExplain = (M, root) => {
    const e = byId.get(root.id), s = specAll.get(root.id);
    // (b) the records that can reach this node: in the subtree of its nearest source ancestor (through syn frames),
    // its own subtree included (a HUG frame follows its children); the agreement check below does the arithmetic.
    // R76: while that ancestor itself moved or resized (beyond its tolerance), the node answers to whatever changed it:
    // the scope climbs to the ancestor's own nearest source ancestor (a reflowing text in a widened bubble, R74; the
    // last item of a space-between row in a card that a screen padding narrowed); the agreement check still predicts
    // the node from that ancestor's measured box.
    const scope = scopeOf(M, root.id, NDM);
    const related = scope.flatMap((id) => recsOf(id)).filter(isBoxRec);
    if (!s || !related.length) return { normWhy: 'no applied box record on the node, its layout parent or anything inside them' };
    const d = NDM[M].get(root.id), t = tolOf(e.n), mism = [];
    for (const w of root.why) {
      const [ax, size] = AXW[w], m = d[ax + (size ? 2 : 0)];
      const p = size ? predSize(M, s, ax, t) : predPos(M, s, ax, t);
      if (!p) mism.push({ axis: w, measured: r2(m), predicted: null });
      else if (Math.abs(m - p.v) > p.tol + EPS) mism.push({ axis: w, measured: r2(m), predicted: r2(p.v) });
    }
    if (mism.length) return { normMismatch: mism };
    return { entry: [...new Set(related.map((a) => a.entry))] };
  };
  for (const M of W) {
    const { mroots, followers } = attribute(M, NDM[M], true, (k) => { const b = src(k, M), d = NDM[M].get(k.id); return [0, 1, 2, 3].map((i) => b[i] + d[i]); });
    if (!on) normFollowers[M] = followers;
    for (const r of mroots) {
      const x = normExplain(M, r);
      const root = { id: r.id, width: M, delta: r.delta, why: r.why, layer: 'norm', ...(on ? { on } : {}) };
      if (x.entry) Object.assign(root, { explainedBy: 'norm', entry: x.entry }); else Object.assign(root, x);
      out.push(root);
    }
    // R66 record agreement: every box record is checked against the measured norm delta where it acts, root or not
    // (a record whose `to` is wrong by less than a root shows: line-height 25.3 -> 25 claimed as 29 moves nothing
    // beyond tolerance, yet predicts 4 px per line): its node's own size on the axes it sets (a FIXED width / height, a
    // HUG frame's padding / gap axis, a HUG text's line height / font size axis) and the position of every flow item of
    // a frame whose padding / gap it sets. A disagreement is an unexplained norm root on that node and axis.
    const checks = new Map(); // id -> Set of axis letters
    const want = (id, w) => { if (!checks.has(id)) checks.set(id, new Set()); checks.get(id).add(w); };
    for (const [id, rs] of recsBy) {
      const sp = specAll.get(id);
      if (!sp) continue;
      const hug = (ax) => !!sp.sz && sp.sz[ax] === 'HUG';
      for (const r of rs.filter(isBoxRec)) {
        if ((r.cat === 'size' || r.cat === 'icon') && (r.prop === 'width' || r.prop === 'height')) want(id, r.prop === 'width' ? 'w' : 'h');
        else if (r.cat === 'type' && sp.t === 'T') { if (r.prop === 'lineHeight' && hug(1)) want(id, 'h'); if (r.prop === 'fontSize' && hug(0)) want(id, 'w'); }
        else if (r.cat === 'space' && sp.lay && sp.lay.d && !sp.lay.wrap) {
          const ax = /^padding[LR]$/.test(r.prop) ? 0 : /^padding[TB]$/.test(r.prop) ? 1 : r.prop === 'gap' ? mainAx(sp) : null;
          if (ax === null) continue;
          if (hug(ax)) want(id, ax ? 'h' : 'w');
          for (const k of flowOf(sp)) want(k.id, ax ? 'y' : 'x');
        }
      }
    }
    for (const [id, ws] of checks) {
      const sp = specAll.get(id), d = dn(M, id);
      if (!sp || !d) continue;
      const t = byId.has(id) ? tolOf(byId.get(id).n) : tolFrame;
      const mism = [];
      for (const w of ['x', 'y', 'w', 'h'].filter((x) => ws.has(x))) {
        const [ax, size] = AXW[w], m = d[ax + (size ? 2 : 0)];
        const pr = size ? predSize(M, sp, ax, t) : predPos(M, sp, ax, t);
        if (pr && Math.abs(m - pr.v) > pr.tol + EPS) mism.push({ axis: w, measured: r2(m), predicted: r2(pr.v) });
      }
      if (!mism.length) continue;
      const prev = out.find((r) => r.id === id && r.width === M);
      if (prev) {
        delete prev.explainedBy; delete prev.entry; delete prev.normWhy;
        for (const x of mism) if (!prev.why.includes(x.axis)) prev.why.push(x.axis);
        prev.normMismatch = [...(prev.normMismatch || []), ...mism.filter((x) => !(prev.normMismatch || []).some((y) => y.axis === x.axis))];
        prev.recordCheck = true;
      } else out.push({ id, width: M, delta: d, why: mism.map((x) => x.axis), layer: 'norm', ...(on ? { on } : {}), normMismatch: mism, recordCheck: true });
    }
  }
  return out;
  };
  if (norm && layout) {
    roots.push(...normPass(proxy, NP, ND));
    // R78: on the norm layout proxy only what the records cannot explain is listed (an open norm root)
    if (NL) roots.push(...normPass(layout, NL, NDL, 'normLayout').filter((r) => !r.explainedBy));
  }


  // ---- R66: static audit, every difference between the modelled and the target spec comes from a record ----
  const normSpecFindings = [];
  if (norm) {
    const nAll = new Map();
    const walkN = (s) => { nAll.set(s.id, s); (s.kids || []).forEach(walkN); };
    if (norm.spec) walkN(norm.spec);
    const used = new Set();
    const fmt = (v) => (v === undefined ? 'unset' : typeof v === 'string' ? v : JSON.stringify(v));
    const kidIds = (s) => (s.kids || []).map((k) => k.id).join(',');
    for (const [id, ms] of specAll) {
      const ns = nAll.get(id);
      if (!ns) { normSpecFindings.push({ id, kind: 'norm-spec', path: 'node', expected: 'present', actual: 'missing' }); continue; }
      if (kidIds(ms) !== kidIds(ns)) normSpecFindings.push({ id, kind: 'norm-spec', path: 'kids', expected: kidIds(ms), actual: kidIds(ns) });
      const a = leafPaths(ms), b = leafPaths(ns);
      for (const p of new Set([...a.keys(), ...b.keys()])) {
        const va = a.get(p), vb = b.get(p);
        if (va === vb) continue;
        if (p === 'font.remeasure' && vb === true && va === undefined && recsOf(id).some((r) => r.cat === 'type' && !recEq('type', r.from, r.to))) continue;
        const szm = /^sz\.([01])$/.exec(p);
        if (szm) { // R74: FILL / HUG -> FIXED only from a record that says so
          const r = restoreOf(id, +szm[1]);
          if (r && r.szFrom === va && vb === 'FIXED') { used.add(r); continue; }
          normSpecFindings.push({ id, kind: 'norm-spec', path: p, expected: r ? `FIXED (applied ${r.entry}: ${fmt(r.szFrom)} -> FIXED)` : `${fmt(va)} (no applied record)`, actual: fmt(vb) });
          continue;
        }
        const rule = AUDIT.find(([re]) => re.test(p));
        let ok = false, cand = null;
        if (rule) {
          const [cats, prop] = rule[1](rule[0].exec(p));
          for (const r of recsOf(id)) {
            if (!cats.includes(r.cat) || r.prop !== prop) continue;
            cand = cand || r;
            if (recEq(r.cat, va, r.from) && recEq(r.cat, vb, r.to)) {
              ok = true;
              // the same change listed for several runs of the node: every record of it is used
              for (const q of recsOf(id)) if (q.cat === r.cat && q.prop === r.prop && recEq(r.cat, q.from, r.from) && recEq(r.cat, q.to, r.to)) used.add(q);
              break;
            }
          }
        }
        if (!ok) {
          normSpecFindings.push({ id, kind: 'norm-spec', path: p, expected: cand ? `${fmt(cand.to)} (applied ${cand.entry}: ${fmt(cand.from)} -> ${fmt(cand.to)})` : `${fmt(va)} (no applied record)`, actual: fmt(vb) });
        }
      }
    }
    for (const id of nAll.keys()) if (!specAll.has(id)) normSpecFindings.push({ id, kind: 'norm-spec', path: 'node', expected: 'absent', actual: 'added' });
    for (const r of recs) {
      if (used.has(r) || recEq(r.cat, r.from, r.to)) continue;
      normSpecFindings.push({ id: String(r.node), kind: 'norm-spec', path: r.prop, expected: `${fmt(r.to)} (applied ${r.entry}: ${fmt(r.from)} -> ${fmt(r.to)})`, actual: 'not in the target spec' });
    }
  }
  // R66: the expected value of a node property under its records (source value = a record's from -> its to)
  const tgt = (id, cat, prop, v) => {
    if (!norm) return v;
    for (const r of recsOf(id)) if (r.cat === cat && r.prop === prop && recEq(cat, v, r.from)) return cat === 'color' ? rgbOf(r.to) : r.to;
    return v;
  };

  // ---- layer 3: data (observed in the modelled proxy DOM at A) ----
  const data = [];
  for (const f of screen.fontSubs || []) {
    if (f.reason === 'override-failed') data.push({ id: screen.tree.id, kind: 'font', expected: f.to, actual: `${f.from} (override-failed)` });
  }
  const P3 = norm ? NP : proxy; // R66: layer 3 reads the norm proxy when there is one
  const dom = P3.A && P3.A.dom;
  if (!dom) skipped.push('data');
  const missing = new Set([...(P3.A?.fontsMissing || []), ...(P3.B?.fontsMissing || [])]);
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
        const expected = normColor(tgt(n.id, 'color', 'color', n.font.c)), actual = normColor(d.color);
        if (expected !== actual) data.push({ id: n.id, kind: 'color', expected, actual });
      }
    } else {
      const expected = normColor(tgt(n.id, 'color', 'bg', n.paint && n.paint.bg)), actual = normColor(d.bg);
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
        const x = b[i], xw = x ? tgt(n.id, 'border', `border${'TRBL'[i]}`, x.w) : 0;
        const expected = x && xw > 0 ? strokeKey(`${xw}px ${x.style} ${tgt(n.id, 'color', `border${'TRBL'[i]}`, x.color)}`) : 'none', actual = strokeKey(d.stroke[i]);
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
  const faceMiss = Array.isArray(P3.A && P3.A.facesMissing) ? [...P3.A.facesMissing, ...((P3.B && P3.B.facesMissing) || [])] : null;
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
          const rv = tgt(id, 'radius', `radius${['TL', 'TR', 'BR', 'BL'][i]}`, s[i]);
          const expected = normRadius(typeof rv === 'number' ? `${rv}px` : rv), actual = normRadius(d.radius[i]);
          if (expected !== actual) data.push({ id, kind: 'radius', side: c, expected, actual });
        });
      }
    }
    // font size / weight / style / decoration / transform per run, character by character (the proxy may split runs
    // differently); only when the texts agree (a text mismatch is already a finding)
    if (isTextSrc(n) && n.font) {
      if (!Array.isArray(d.runs)) miss.add('font-style');
      else {
        const src = (n.runs || []).filter((r) => !r.br).map((r) => { const f = { ...n.font, ...(r.s || {}) }; return [r.t, tgt(id, 'type', 'fontSize', f.fs), f.fw, f.fst, f.td, f.tt, f.ff, tgt(id, 'color', 'color', f.c)]; });
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
        [['color', tgt(id, 'color', 'color', ic.color)], ['fill', tgt(id, 'color', 'fill', ic.fill)], ['stroke', tgt(id, 'color', 'stroke', ic.stroke)], ['stroke-width', ic.sw]].forEach(([prop, v], i) => {
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
    if (r.on) continue; // R78: a norm layout root is no box the crops are taken from
    if (!r.why.some((w) => w === 'w' || w === 'h')) continue;
    if (!r.why.some((w) => (w === 'w' && Math.abs(r.delta[2]) > cropShift + EPS) || (w === 'h' && Math.abs(r.delta[3]) > cropShift + EPS))) continue;
    // R66: a node that is a size root in two layers (layout and norm) shares the status of the unexplained one
    const k = `${r.id}|${r.width}`, prev = sizeRoot.get(k);
    if (!prev || (prev.explainedBy && !r.explainedBy)) sizeRoot.set(k, r);
  }
  // R66: records that change nothing measurable (norm.unused)
  const unused = [], unusedRecs = new Set();
  for (const a of norm ? recs : []) {
    if (a.cat === 'color') { try { if (deltaE2000(String(a.from), String(a.to)) < 1) continue; } catch { /* unparsable: judged below */ } }
    const id = String(a.node), s = specAll.get(id);
    const ids = [id, ...((s && s.kids) || []).map((k) => k.id)];
    const moved = W.some((M) => ids.some((k) => { const d = dnP(M, k); return !!d && d.some((v) => Math.abs(v) > NORM_MOVED); }));
    const dA = proxy.A && proxy.A.dom, dN = NP.A && NP.A.dom;
    const painted = !!dA && !!dN && JSON.stringify(dA[id] ?? null) !== JSON.stringify(dN[id] ?? null);
    if (!moved && !painted) { unusedRecs.add(a); unused.push({ entry: a.entry, node: id, ...(a.run !== undefined ? { run: a.run } : {}), prop: a.prop, from: a.from, to: a.to, code: a.code }); }
  }
  // R77: a crop failure (source vs norm layout proxy) is the records' doing only when (i) the same crop of the source
  // against the plain layout proxy passes (input.cropsLayout: without the records there is no fault) and (ii) the
  // record that may change the node's pixels is not in norm.unused and its change shows: the node's crop of the norm
  // layout proxy against the layout proxy fails too (input.cropsNormVsLayout). Missing measurements explain nothing.
  const failing = (c) => !!c && (c.ratio > cropRatio || (c.peak ?? 0) >= cropPeak);
  const cropsL = Array.isArray(input.cropsLayout) ? input.cropsLayout : null, cropsNL = Array.isArray(input.cropsNormVsLayout) ? input.cropsNormVsLayout : null;
  // R77 for a resize record: an icon / image leaf's own ICON_FRAME / SRC_SQUASH record exists because the plain layout
  // proxy cannot draw the leaf as the source does (Planora's squashed avatar is a 135.5 px FILL box there, the R61
  // open crop), so (i) cannot hold. Instead the crop difference must be the declared resize itself: the norm layout
  // proxy draws the node at every such record's `to` on its axis (within tolFrame) and the source size differs from
  // `to` beyond the crop search on at least one of them. Anything else drawn in the leaf is left to the data checks
  // (icon identity, svg markup and paint).
  const resized = (c, rs) => {
    const e = byId.get(c.id), fr = rs.filter((a) => (a.code === 'ICON_FRAME' || a.code === 'SRC_SQUASH') && (a.prop === 'width' || a.prop === 'height'));
    if (!e || !(e.n.kind === 'icon' || e.n.kind === 'image') || !fr.length || !NL) return false;
    const b = NL[c.width] && NL[c.width].boxes[c.id], s = src(e.n, c.width);
    if (!b || !s) return false;
    const ax = (a) => (a.prop === 'width' ? 2 : 3);
    return fr.every((a) => Math.abs(b[ax(a)] - Number(a.to)) <= tolFrame + EPS) && fr.some((a) => Math.abs(s[ax(a)] - Number(a.to)) > cropShift + EPS);
  };
  const normCause = (c, rs) => {
    if (!rs.length) return { rs: [] };
    const live = rs.filter((a) => !unusedRecs.has(a));
    if (!live.length) return { rs: [], why: 'its records change nothing measurable (norm.unused)' };
    if (input.cropsOn === 'layout' || !cropsL || !cropsNL) return { rs: [], why: 'no crops of the layout and norm layout proxies to tell what the records changed' };
    const at = (xs) => xs.find((x) => x.id === c.id && x.width === c.width);
    const l = at(cropsL), d = at(cropsNL);
    if (!l || !d) return { rs: [], why: 'no crops of the layout and norm layout proxies to tell what the records changed' };
    if (failing(l) && !resized(c, live)) return { rs: [], why: 'the crop fails against the plain layout proxy too (the fault is not the records\' doing)' };
    if (!failing(d)) return { rs: [], why: 'the records do not change this crop (norm layout vs layout passes)' };
    return { rs: live };
  };
  if (norm && input.cropsOn === 'layout') skipped.push('norm-crop');
  if (!Array.isArray(crops)) skipped.push('crop');
  else {
    for (const c of crops) {
      if (!failing(c)) continue;
      const e = byId.get(c.id), r = sizeRoot.get(`${c.id}|${c.width}`);
      const leafIcon = !!e && (e.n.kind === 'icon' || e.n.kind === 'image');
      // R66: the node's own records that may change its pixels
      const own = norm ? recsOf(c.id) : [];
      const ownPaint = own.filter((a) => a.cat === 'color' || a.cat === 'radius' || a.cat === 'icon' || a.code === 'ICON_FRAME' || a.code === 'SRC_SQUASH' ||
        (!!e && isTextSrc(e.n) && (a.code === 'TYPE_SCALE' || a.code === 'LINE_HEIGHT_INT')));
      const ownFrame = own.filter((a) => a.code === 'ICON_FRAME' || a.code === 'SRC_SQUASH');
      const byNorm = (rs) => ({ ...c, explainedBy: 'norm', entry: [...new Set(rs.map((a) => a.entry))], ...(r ? { root: r.id } : {}) });
      if (e && rasterIn(e)) cropExplained.push({ ...c, explainedBy: 'raster' });
      // R61: an icon or image does not stretch with its box (it is drawn centred / fitted), so a resized box moves the
      // drawn content: a size explanation never excuses such a leaf's crop; it stands alone (approval via allowlist).
      // R66: unless the norm resized it on purpose (its own ICON_FRAME / SRC_SQUASH record)
      // R77: only through the records that caused it (normCause)
      else if (r && r.explainedBy && leafIcon) {
        const k = normCause(c, ownFrame);
        if (k.rs.length) cropExplained.push(byNorm(k.rs));
        else crop.push({ ...c, sizeExplainedBy: r.explainedBy, root: r.id, ...(k.why ? { normWhy: k.why } : {}) });
      }
      // R66: a norm size root shares its status with its crop only through a record on the node itself (R77: a paint /
      // type / icon record that caused it)
      else if (r && r.explainedBy === 'norm') {
        const k = normCause(c, ownPaint);
        if (k.rs.length) cropExplained.push(byNorm(k.rs)); else crop.push({ ...c, sizeExplainedBy: 'norm', root: r.id, ...(k.why ? { normWhy: k.why } : {}) });
      }
      else if (r && r.explainedBy) cropExplained.push({ ...c, explainedBy: r.explainedBy, root: r.id });
      else if (r) cropLinked.push({ ...c, root: r.id });
      else {
        const k = normCause(c, ownPaint);
        if (k.rs.length) cropExplained.push(byNorm(k.rs)); else crop.push(k.why ? { ...c, normWhy: k.why } : c);
      }
    }
  }

  // ---- R66: the norm section of the report ----
  let normOut;
  if (norm) {
    for (const f of [...recFindings, ...normSpecFindings]) data.push(f);
    const nr = roots.filter((r) => r.layer === 'norm');
    normOut = {
      applied: recs.length, explainedRoots: nr.filter((r) => r.explainedBy).length,
      explainedCrops: cropExplained.filter((c) => c.explainedBy === 'norm').length,
      unexplained: [...new Set(nr.filter((r) => !r.explainedBy).map((r) => r.id))], unused, followers: normFollowers, approvalsResolved,
    };
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
    ...(normOut ? { norm: normOut } : {}),
  };
}

// Crops at A and B for every source node with a box in both images at that width and area <= maxArea (CSS px²): the
// source rect in the source PNG against the same-size window at the node's box in the given proxy's PNG.
// R72: the window in the proxy image starts where the text's alignment anchors its glyphs: a right (end) aligned
// text at the box's right edge, a centred one at its centre, anything else at its left edge. The source alignment
// decides (a proxy that aligns differently then fails). Only the horizontal anchor moves; lines start at the top.
const textAnchor = (n, s, b) => {
  if (!isTextSrc(n) || (n.kids && n.kids.length) || !n.font) return b;
  const ta = String(n.font.ta || '');
  const k = /center/.test(ta) ? 0.5 : /right|end/.test(ta) ? 1 : 0;
  return k ? [b[0] + (b[2] - s[2]) * k, b[1], s[2], b[3]] : b;
};

// R77: opts.base = another proxy ({A, B} with png and boxes) compared instead of the source: the window (source size)
// sits in each proxy image where that proxy's box anchors it (R72), masks at each proxy's boxes; opts.ids = only
// these nodes are compared (masks still cover every cropped descendant).
export async function measureCrops(browser, screen, proxy, opts = {}) {
  const maxArea = opts.maxArea ?? CROP_MAX_AREA;
  const base = opts.base || null, only = opts.ids ? new Set(opts.ids) : null;
  if (!base && (!screen.png || !screen.png[0] || !screen.png[1])) throw new Error('measureCrops: screen.png is missing (captureScreens with { png: true })');
  const out = [];
  for (const [i, M] of W.entries()) {
    const P = proxy[M];
    if (!P || !P.png) throw new Error(`measureCrops: proxy PNG at ${M} is missing`);
    const pairs = [];
    const flat = flatten(screen.tree);
    // R50: a leaf that paints content (text, icon, image) is cropped at any size; containers above maxArea rely on
    // the data checks (colour, radius, stroke, effect, visibility)
    const paintLeaf = (n) => !(n.kids && n.kids.length) && (isTextSrc(n) || n.kind === 'icon' || n.kind === 'image');
    const Bp = base ? base[M] : null;
    if (base && (!Bp || !Bp.png)) throw new Error(`measureCrops: base proxy PNG at ${M} is missing`);
    // [rect in the first image, box in the proxy image]: the source rect, or (R77) the base proxy's window
    const rect = (n) => {
      const s = M === 'A' ? n.rA : n.rB, b = P.boxes[n.id];
      if (!(s && b && s[2] * s[3] > 0 && (s[2] * s[3] <= maxArea || paintLeaf(n)))) return null;
      if (!Bp) return [s, b];
      const bb = Bp.boxes[n.id];
      if (!bb) return null;
      const w = textAnchor(n, s, bb);
      return [[w[0], w[1], s[2], s[3]], b];
    };
    const cropped = new Map(flat.map(({ n }) => [n.id, rect(n)]).filter(([, r]) => r));
    // R45: a container compares its own paint only: every descendant that has its own crop is masked (in the source
    // image at its source box, in the proxy image at its proxy box); a descendant without a crop stays in the window
    const descMasks = (n, out = [[], []]) => {
      for (const k of n.kids || []) { const r = cropped.get(k.id); if (r) { out[0].push(r[0]); out[1].push(r[1]); } descMasks(k, out); }
      return out;
    };
    for (const { n } of flat) {
      const r = cropped.get(n.id);
      if (!r || (only && !only.has(n.id))) continue;
      const [ma, mb] = descMasks(n);
      pairs.push({ id: n.id, rectA: r[0], rectB: textAnchor(n, r[0], r[1]), ...(ma.length ? { masksA: ma, masksB: mb } : {}) });
    }
    if (!pairs.length) continue;
    const res = await cropDiffMany(browser, Bp ? Bp.png : screen.png[i], P.png, pairs, opts);
    pairs.forEach((p, k) => out.push({ id: p.id, width: M, ratio: res[k].ratio, diff: res[k].diff, peak: res[k].peak }));
  }
  return out;
}

// Layers 1-3 with the image parts measured: input = { screen (with png), spec, layout: {A, B}, proxy: {A, B} (with
// png and dom), flags }.
export async function verifyScreenWithImages(browser, input, opts = {}) {
  // crops against the layout proxy: same content as the modelled one (the model only resizes text boxes; fonts are
  // substituted in capture), without the model's sub-pixel glyph shifts, which modelDeltas already report
  if (!input.norm) {
    const crops = await measureCrops(browser, input.screen, input.layout, opts);
    const pixel = [
      await pixelDiff(browser, input.screen.png[0], input.proxy.A.png),
      await pixelDiff(browser, input.screen.png[1], input.proxy.B.png),
    ];
    return verifyScreen({ ...input, crops, pixel }, opts);
  }
  // R66: with a target spec, the crops run on the norm layout proxy (the records on the unmodelled spec: the norm's
  // paint without the model's glyph shifts) and the pixel reference on the norm proxy
  const cropsOn = input.normLayout ? 'normLayout' : 'layout';
  const crops = await measureCrops(browser, input.screen, input.normLayout || input.layout, opts);
  const NPx = input.norm.proxy;
  const pixel = [await pixelDiff(browser, input.screen.png[0], NPx.A.png), await pixelDiff(browser, input.screen.png[1], NPx.B.png)];
  // R77: for each failing crop, the same crop against the plain layout proxy and the norm layout proxy against the
  // layout proxy (what the records changed there)
  const extra = {};
  if (input.normLayout) {
    const ratio = opts.cropRatio ?? CROP_RATIO, peak = opts.cropPeak ?? CROP_PEAK;
    const ids = [...new Set(crops.filter((c) => c.ratio > ratio || (c.peak ?? 0) >= peak).map((c) => c.id))];
    extra.cropsLayout = ids.length ? await measureCrops(browser, input.screen, input.layout, { ...opts, ids }) : [];
    extra.cropsNormVsLayout = ids.length ? await measureCrops(browser, input.screen, input.normLayout, { ...opts, ids, base: input.layout }) : [];
  }
  return verifyScreen({ ...input, crops, pixel, cropsOn, ...extra }, opts);
}
