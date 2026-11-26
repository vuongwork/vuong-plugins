// Figma encoding (plan 3, Task 4): a screen's target spec (spec-norm-<s>.json, after applyFigmaModel) -> compact data
// for the builder that runs inside `use_figma` (figma-runtime.js, Task 5), and batches of builder + data under the
// 50 000-byte limit of one call. Pure and deterministic: same input -> same bytes (no clock, no Map/Set order leaks).
//
// encodeScreen(spec, ctx) -> Enc
//   ctx = { screen, file, W: [A, B], map (TokenMap of tokens.mjs: { [screen]: { [node]: { [prop]: token path } } }),
//           svgDefs (screen.svgDefs: { ref: '<symbol id viewBox>..</symbol>' }), tables (newTables(V)), tokens? }
//   Enc = { screen, file, W, T (encoded root), tables (the ctx.tables object), raw (count of nodes' raw entries),
//           unbound: { [reason]: count }, unboundList: [{ o, key, path, reason }] }
//   `tables` is shared by every screen of a run and grows as screens are encoded (first-use order of a pre-order
//   walk, own keys in the order of mapRefs below). V is given (Task 6 varNames) and never grows.
//   tokens (tokens.json, optional): resolves role aliases (text / effect style names) and checks that a token's value
//   equals the spec value before binding (plan Global Constraint: colour same hex + alpha; px <= 0.01; opacity <=
//   0.005). Radius: a corner binds to radius.full (tokens.mjs PILL_PX, 9999) only when it is a pill by the R70 test
//   (inventory.mjs isPillRadius: spec px radius >= half the node's smaller side, spec w / h; 50% is resolved to px
//   first): Figma clamps it to half the smaller side, so it renders as the source. Every other radius needs
//   |spec px - token px| <= 0.01, else 'value-mismatch'.
//   Without it role typography and shadow paths cannot be resolved (reason 'no-style') and values are not checked.
// Names (shared with figma-vars.mjs, Task 6): Figma variable = token path without the `primitive.` tier, '.' -> '/'
//   (primitive.color.c01 -> color/c01; role tokens keep their tier: role.text-muted -> role/text-muted); text style =
//   `type/<name>` of primitive.typography.<name>; effect style = `shadow/<name>` of primitive.shadow.<name> (a role
//   path is resolved through its alias first).
// Style variants: a Figma text style sets the decoration and case of the text it styles (setting the style resets
//   them; setting a decoration / case the style does not carry detaches the style: measured on Figma Desktop
//   2026-11-24). A text run with a style whose case differs from the style's, or with a decoration, is bound to a variant
//   style `<style>/<suffix>` (suffix: strike | underline, then upper | lower | title | original when the case differs,
//   joined by '-'), e.g. type/t14-600/strike; enc.variants lists them as [name, base style, decoration ('' | UNDERLINE
//   | STRIKETHROUGH), case (ORIGINAL | UPPER | LOWER | TITLE)] and figma-vars.mjs creates them as copies of the base
//   style. A run with a decoration / case of its own and a style gets an explicit range style (the runtime sets range
//   decoration before the range style). Styles not in the tokens' typography (ctx.styleTc) are left as they are.
// planBatches(encs, { limit = PAYLOAD_LIMIT, runtime, page?, force? }) -> [{ n, screens, bytes, code, data (= D) }]
//   force (plan 3 Task 7, figma.mjs --force): screen ids the runtime rebuilds even when edited; D.force = the ones in
//   that batch (absent when none).
//   Screens in order, greedily, while UTF-8 bytes of `code` <= limit. code = runtime with its single `__DATA__`
//   replaced by the JSON of the batch data D = { batch: n, page?, force?, C, F, I, V, S, M, screens: [{ screen, file, W, T }] }.
//   Each batch has its own tables, holding only what its screens use (indices remapped, first-use order). A screen
//   that does not fit alone throws OversizeError { screen, bytes } (bytes = runtime + that screen alone); nothing is cut.
//
// ---- the encoded format (what figma-runtime.js decodes) ----
// Tables (per batch): C colours '#rrggbb' or '#rrggbbaa' (alpha only when < 1, lower case); F fonts [family, weight
// (number, CSS 100..900 or between), italic?: 1]; I icons [viewBox | null, markup] (viewBox + inner markup of a
// <symbol>, its own presentation attributes kept as a wrapping <g>; null = markup is a complete <svg> element);
// V Figma variable names; S style names (text styles `type/<name>`, effect styles `shadow/<name>`); M image sources.
// Node (every key optional unless noted; an absent key = the builder's base state, see "defaults"):
//   o   spec id (always)             t   'T' text | 'V' icon | 'I' image (absent = 'F' frame)
//   y   syn kind of a synthetic frame (row, col, prox, push, align, track, anchor)
//   w h size at width A (always; 0.01 px rounding)
//   s   sizing 'XY', each F FILL | H HUG | X FIXED (absent = 'XX'). HUG on what cannot hug in Figma (frame without
//       auto layout, icon, image) is written X, as the proxy does.
//   mn mx  minWidth / maxWidth px
//   l   auto layout { d: 'H'|'V', p?: [t, r, b, l] (absent = 0), g?: itemSpacing (absent = 0; not written with sb),
//       sb?: 1 SPACE_BETWEEN, pa?: 'C'|'E' primary align (absent = 'S' MIN), ca?: 'C'|'E'|'B' counter align (absent =
//       'S' MIN; B = BASELINE), wr?: 1 WRAP, cg?: counterAxisSpacing (absent = 0) }. No l = layoutMode NONE.
//   a   absolute [x, y, c?, cy?] relative to the parent; c horizontal constraint L (MIN, absent) | R (MAX) | LR (STRETCH)
//       | C (CENTER) | SCALE; cy vertical T (MIN, absent) | B (MAX) | TB (STRETCH) | C | SCALE. In an auto-layout
//       parent = layoutPositioning ABSOLUTE. A child of a parent without l and without a is at 0, 0 MIN / MIN.
//   bg  solid fill (C)                gr  gradients above bg, Figma fill order (first = bottom):
//       [{ k: 'L', p: [x0, y0, x1, y1] start / end of the gradient line, k: 'R', p: [cx, cy, rx, ry] centre and radii;
//       all fractions of the node's w / h; s: [[position 0..1, C], ...] }]
//   rd  corner radius px: a number (all equal) or [tl, tr, br, bl]; written as authored (999 stays 999)
//   bd  strokes { w: weight or [t, r, b, l], c: C, d?: 'dashed'|'dotted', o?: 1 } (strokeAlign INSIDE, not in layout;
//       o = paint.strokeOverlay: draw as an absolute overlay frame, figma-facts.json strokeOverlay)
//   sh  drop / inner shadows [[C, x, y, blur, spread, inset?: 1], ...] in CSS order (first = top)
//   op  opacity (absent = 1)          cl  1 = clipsContent (absent = no clip)
//   tf  transform [a, b, c, d, e, f, ox, oy]: CSS matrix(a, b, c, d, e, f) about origin (ox, oy) px of the node box
//   text (t 'T', and glyph icons): tx characters (a run break is '\n'); f F; fs font size (absent = 12); lh line
//       height px (absent = AUTO); ls letter spacing px (absent = 0); c fill C (absent = #000000); td 'U' underline |
//       'S' strikethrough; tt 'U' upper | 'L' lower | 'T' title; ta 'C'|'R'|'J' (absent = LEFT); ar textAutoResize
//       'H' HEIGHT | 'N' NONE (absent = WIDTH_AND_HEIGHT), from s: x HUG -> WIDTH_AND_HEIGHT, else y HUG -> HEIGHT,
//       else NONE. rn runs, one entry per spec run (only when some run differs from the node): a length, or
//       [length, { f?, fs?, lh?, ls?, c?, td?, tt?, ts?, v? }] = range overrides (same codes; ts/v as below).
//   ic  icon: svg { i: I, c?: currentColor C, f?: fill C, s?: stroke C (-1 = none), w?: stroke-width px } or glyph
//       { g: characters } (a text node drawn in the node's font: f, fs, c ... as text).
//   im  image { m: M, f?: CSS object-fit, p?: CSS object-position }
//   ts  text style (S)   es  effect style (S)
//   v   variable bindings { code: V } on the node; codes: bg (fill paint of bg), sc (stroke paint), c (text / glyph
//       fill; on a run: that range), vf / vs (svg icon fill / stroke colour), pt pr pb pl (padding), g (itemSpacing),
//       cg (counterAxisSpacing), w h (width / height, FIXED axes only), r0 r1 r2 r3 (tl, tr, br, bl radius),
//       b0 b1 b2 b3 (stroke weight t, r, b, l), op (opacity), fs (glyph icon font size).
//   raw values the format cannot carry, by spec field (the builder reports them; never dropped silently): bg / colour
//       strings that do not parse, bgImage (url(), conic, repeating, a layer that does not parse), radius (% on a
//       non-square box or elliptical corners: rd holds the nearest px), border (mixed colours or styles, double /
//       groove / ridge / inset / outset: bd holds the nearest), shadow, filter, clipPath, outline, transform (not a 2-D
//       matrix), fs / lh / ls (not px), td / tt (other values), icon (ref missing from svgDefs), unsupported (capture's
//       paint.unsupported list [{ prop, value }] (R46: text-shadow, svg inner transforms, masks, markers ...), on every
//       node type, text included), src (null: an image node with no source, canvas / iframe / video; with fit / pos).
//   k   children in paint order (spec order).
// Not encoded (consumed before Figma): paint.pos / z (paint order, used by infer), paint.textDecoration (the text
// nodes carry font.td), paint on text other than opacity / transform (the proxy does not draw it), font.ws (text wraps
// by sizing, as in the proxy), font.sub / remeasure (proxy hints), model. In rn, td / tt '' = an override back to none.
// Defaults: a key is left out only when its value is Figma's default for that property (padding / gap 0, MIN
// alignment and constraints, FIXED sizing, opacity 1, font size 12, AUTO line height, letter spacing 0, black text,
// LEFT, WIDTH_AND_HEIGHT) or the builder's base state for a new frame (no fills, no strokes, no clip).
import { parseColor, toHex } from './color.mjs';
import { parseShadow, PILL_PX } from './tokens.mjs';
import { isPillRadius } from './inventory.mjs';
import { firstFamily } from './font-map.mjs';
import { PAYLOAD_LIMIT } from './pipeline.mjs';
import { varsPlan } from './figma-vars.mjs';

const r2 = (v) => Math.round(v * 100) / 100 + 0; // + 0: no -0
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const TABLES = ['C', 'F', 'I', 'V', 'S', 'M'];

export class OversizeError extends Error {
  constructor(screen, bytes, limit) {
    super(`screen ${screen} does not fit one use_figma call: ${bytes} bytes with the runtime (limit ${limit})`);
    this.name = 'OversizeError'; this.screen = screen; this.bytes = bytes; this.limit = limit;
  }
}

export const newTables = (V = []) => ({ C: [], F: [], I: [], V: [...V], S: [], M: [] });
// Figma variable name of a token path (plan Task 6): the primitive tier is the collection, so it is dropped.
export const figmaVarName = (path) => String(path).replace(/^primitive\./, '').replace(/\./g, '/');

// Interning: a table value -> its index (a hidden index per tables object).
const INDEX = new WeakMap();
function intern(tables, T, value) {
  let idx = INDEX.get(tables);
  if (!idx) { idx = {}; INDEX.set(tables, idx); }
  if (!Array.isArray(tables[T])) tables[T] = []; // K (components) only when used
  if (!idx[T] || idx[T].n !== tables[T].length) idx[T] = { m: new Map(tables[T].map((v, i) => [JSON.stringify(v), i])), n: tables[T].length };
  const k = JSON.stringify(value);
  let i = idx[T].m.get(k);
  if (i === undefined) { i = tables[T].length; tables[T].push(value); idx[T].m.set(k, i); idx[T].n++; }
  return i;
}

// Every table reference of an encoded node, in a fixed order; fn(T, value) -> replacement. Recurses into kids.
function mapRefs(e, fn) {
  const one = (T, o, k) => { if (o && o[k] !== undefined && !(T === 'C' && o[k] === -1)) o[k] = fn(T, o[k]); };
  one('F', e, 'f'); one('C', e, 'c'); one('C', e, 'bg');
  if (e.gr) for (const g of e.gr) for (const st of g.s) one('C', st, 1);
  if (e.bd) one('C', e.bd, 'c');
  if (e.sh) for (const s of e.sh) one('C', s, 0);
  if (e.ic) { one('I', e.ic, 'i'); one('C', e.ic, 'c'); one('C', e.ic, 'f'); one('C', e.ic, 's'); }
  if (e.im) one('M', e.im, 'm');
  one('S', e, 'ts'); one('S', e, 'es');
  if (e.v) for (const k of Object.keys(e.v)) one('V', e.v, k);
  if (e.rn) for (const r of e.rn) {
    if (!Array.isArray(r)) continue;
    const o = r[1];
    one('F', o, 'f'); one('C', o, 'c'); one('S', o, 'ts');
    if (o.v) for (const k of Object.keys(o.v)) one('V', o.v, k);
  }
  // plan 3b components (figma-cmp.mjs): the instance's component, INSTANCE_SWAP values
  one('K', e, 'i'); one('K', e, 'mi'); // mi: the icon an INSTANCE_SWAP value sets (Task 7 readback)
  if (e.p) for (const k of Object.keys(e.p)) if (typeof e.p[k] === 'number') one('K', e.p, k);
  if (e.k) for (const k of e.k) mapRefs(k, fn);
}

// ---------------- value parsing ----------------
const hexOf = (css) => { const c = parseColor(css); return c.unparsed !== undefined ? null : toHex(c); };
const pxOf = (v) => {
  if (typeof v === 'number') return v;
  const m = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)(px)?\s*$/.exec(String(v));
  return m && (m[2] || +m[1] === 0) ? +m[1] : null;
};
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const angleDeg = (t) => {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)$/.exec(t);
  if (!m) return null;
  const v = +m[1];
  return m[2] === 'deg' ? v : m[2] === 'turn' ? v * 360 : m[2] === 'rad' ? v * 180 / Math.PI : v * 0.9;
};
// colour stops -> [[pos 0..1, hex]] (len = gradient ray length in px, for px positions), or null
function stops(args, len) {
  const out = [];
  for (const a of args) {
    const parts = splitTop(a, ' ');
    const pos = [];
    while (parts.length > 1 && /(%|px)$|^0$/.test(parts[parts.length - 1])) pos.unshift(parts.pop());
    const hex = hexOf(parts.join(' '));
    if (!hex) return null; // a colour hint or a colour that does not parse
    const ps = pos.map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : len > 0 ? parseFloat(p) / len : 0));
    if (!ps.length) out.push([null, hex]); else for (const p of ps) out.push([p, hex]);
  }
  if (out.length < 2) return null;
  // CSS: missing first / last = 0 / 1, others spread evenly between their neighbours; positions never go back
  if (out[0][0] === null) out[0][0] = 0;
  if (out[out.length - 1][0] === null) out[out.length - 1][0] = Math.max(1, ...out.filter((s) => s[0] !== null).map((s) => s[0]));
  for (let i = 1; i < out.length; i++) if (out[i][0] !== null && out[i][0] < out[i - 1][0]) out[i][0] = out[i - 1][0];
  for (let i = 1; i < out.length; i++) {
    if (out[i][0] !== null) continue;
    let j = i; while (out[j][0] === null) j++;
    const a = out[i - 1][0], b = out[j][0];
    for (let k = i; k < j; k++) out[k][0] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  if (out.some(([p]) => p < 0 || p > 1)) return null; // Figma stops are 0..1
  return out.map(([p, h]) => [r4(p), h]);
}
function linear(args, w, h) {
  let ang = 180;
  const a0 = args[0];
  const deg = angleDeg(a0);
  if (deg !== null) { ang = deg; args = args.slice(1); }
  else if (/^to\s/.test(a0)) {
    const k = a0.slice(3).trim().split(/\s+/).sort().join(' ');
    const t = (Math.atan2(h, w) * 180) / Math.PI;
    const A = { top: 0, right: 90, bottom: 180, left: 270, 'right top': t, 'bottom right': 180 - t, 'bottom left': 180 + t, 'left top': 360 - t }[k];
    if (A === undefined) return null;
    ang = A; args = args.slice(1);
  }
  const th = (ang * Math.PI) / 180, dx = Math.sin(th), dy = -Math.cos(th);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  const s = stops(args, L);
  if (!s || !(w > 0) || !(h > 0)) return null;
  const cx = w / 2, cy = h / 2;
  return { k: 'L', p: [r4((cx - (dx * L) / 2) / w), r4((cy - (dy * L) / 2) / h), r4((cx + (dx * L) / 2) / w), r4((cy + (dy * L) / 2) / h)], s };
}
function radial(args, w, h) {
  if (!(w > 0) || !(h > 0)) return null;
  let shape = 'ellipse', size = 'farthest-corner', lens = [], at = ['50%', '50%'];
  if (!hexOf(splitTop(args[0], ' ')[0])) {
    const t = splitTop(args[0], ' '); args = args.slice(1);
    const i = t.indexOf('at');
    const head = i < 0 ? t : t.slice(0, i), pos = i < 0 ? [] : t.slice(i + 1);
    for (const x of head) {
      if (x === 'circle' || x === 'ellipse') shape = x;
      else if (/^(closest|farthest)-(side|corner)$/.test(x)) size = x;
      else if (/(px|%)$|^0$/.test(x)) lens.push(x);
      else return null;
    }
    if (lens.length === 1 && shape === 'ellipse' && !head.includes('ellipse')) shape = 'circle';
    if (pos.length) {
      const kw = { left: '0%', center: '50%', right: '100%', top: '0%', bottom: '100%' };
      let [px, py] = pos.length === 1 ? [pos[0], 'center'] : pos;
      if (pos.length > 2) return null;
      if (px === 'top' || px === 'bottom' || py === 'left' || py === 'right') [px, py] = [py, px];
      at = [kw[px] || px, kw[py] || py];
    }
  }
  const coord = (v, L) => (/%$/.test(v) ? (parseFloat(v) / 100) * L : pxOf(v));
  const cx = coord(at[0], w), cy = coord(at[1], h);
  if (cx === null || cy === null || Number.isNaN(cx) || Number.isNaN(cy)) return null;
  const sx = [cx, w - cx].map(Math.abs), sy = [cy, h - cy].map(Math.abs);
  let rx, ry;
  if (lens.length) {
    const v = lens.map((x, i) => coord(x, i === 0 ? w : h));
    if (v.some((x) => x === null || Number.isNaN(x))) return null;
    [rx, ry] = shape === 'circle' ? [v[0], v[0]] : [v[0], v[1] ?? v[0]];
  } else {
    const near = size.startsWith('closest'), pick = near ? Math.min : Math.max;
    if (shape === 'circle') {
      const r = size.endsWith('side') ? pick(...sx, ...sy)
        : pick(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      rx = ry = r;
    } else {
      rx = pick(...sx); ry = pick(...sy);
      if (size.endsWith('corner')) { rx *= Math.SQRT2; ry *= Math.SQRT2; }
    }
  }
  const s = stops(args, rx);
  if (!s) return null;
  return { k: 'R', p: [r4(cx / w), r4(cy / h), r4(rx / w), r4(ry / h)], s };
}
// background-image -> gradient list in Figma fill order (bottom first), or null when any layer cannot be carried
function gradients(css, w, h) {
  const out = [];
  for (const layer of splitTop(css, ',')) {
    const m = /^(linear|radial)-gradient\((.*)\)$/s.exec(layer.trim());
    if (!m) return null;
    const g = (m[1] === 'linear' ? linear : radial)(splitTop(m[2], ','), w, h);
    if (!g) return null;
    out.unshift(g);
  }
  return out;
}

const SIZING = { FILL: 'F', HUG: 'H', FIXED: 'X' };
const canHug = (n) => n.t === 'T' || (n.t === 'F' && !!(n.lay && n.lay.d));
const fontTuple = (ff, fw, fst) => {
  const t = [firstFamily(ff), Math.round(parseFloat(fw) || 400)];
  if (/italic|oblique/.test(fst || '')) t.push(1);
  return t;
};
const TD = { underline: 'U', 'line-through': 'S' };
const TT = { uppercase: 'U', lowercase: 'L', capitalize: 'T' };
const TCASE = { U: 'UPPER', L: 'LOWER', T: 'TITLE' }, TDECO = { U: 'UNDERLINE', S: 'STRIKETHROUGH' }, VSUF = { UNDERLINE: 'underline', STRIKETHROUGH: 'strike' };
const TA = (ta) => (/center/.test(ta || '') ? 'C' : /right|end/.test(ta || '') ? 'R' : /justify/.test(ta || '') ? 'J' : null);
const VCODE = {
  bg: 'bg', paddingT: 'pt', paddingR: 'pr', paddingB: 'pb', paddingL: 'pl', gap: 'g', counterGap: 'cg', width: 'w', height: 'h',
  radiusTL: 'r0', radiusTR: 'r1', radiusBR: 'r2', radiusBL: 'r3', 'border-width-T': 'b0', 'border-width-R': 'b1',
  'border-width-B': 'b2', 'border-width-L': 'b3', opacity: 'op', 'icon-width': 'w', 'icon-height': 'h', 'icon-fontSize': 'fs',
  fill: 'vf', stroke: 'vs',
};
const SIDES = ['T', 'R', 'B', 'L'];

// ---------------- tokens ----------------
function tokenAt(tokens, path) {
  let o = tokens;
  for (const k of String(path).split('.')) { if (!o || typeof o !== 'object') return null; o = o[k]; }
  return o && typeof o === 'object' && '$value' in o ? o : null;
}
// follow aliases '{a.b.c}' -> { path, token } of the final token, or null
function resolveToken(tokens, path) {
  for (let i = 0; i < 10; i++) {
    const t = tokenAt(tokens, path);
    if (!t) return null;
    const m = typeof t.$value === 'string' && /^\{(.+)\}$/.exec(t.$value);
    if (!m) return { path, token: t };
    path = m[1];
  }
  return null;
}
const tokenHex = (v) => {
  if (!v || typeof v.hex !== 'string') return null;
  const a = v.alpha ?? 1;
  return a >= 1 ? v.hex.toLowerCase() : v.hex.toLowerCase() + Math.round(a * 255).toString(16).padStart(2, '0');
};

export function encodeScreen(spec, ctx = {}) {
  const tables = ctx.tables || newTables();
  for (const T of TABLES) if (!Array.isArray(tables[T])) tables[T] = [];
  const svgDefs = ctx.svgDefs || {};
  const nodeMap = (ctx.map && ctx.map[ctx.screen]) || {};
  const tokens = ctx.tokens || null;
  // text style name -> its case ('' = ORIGINAL), for the style variants
  const styleTc = ctx.styleTc || new Map(tokens ? varsPlan(tokens).textStyles.map((t) => [t.name, t.tc]) : []);
  const variants = new Map();
  const vIndex = new Map(tables.V.map((n, i) => [n, i]));
  const unbound = {}, unboundList = [];
  let raw = 0;
  const miss = (o, key, path, reason) => { unbound[reason] = (unbound[reason] || 0) + 1; unboundList.push({ o, key, path, reason }); };

  const icons = (ref) => {
    const def = svgDefs[ref];
    const m = def && /^\s*<symbol\b([^>]*)>([\s\S]*)<\/symbol>\s*$/.exec(def);
    if (!m) return null;
    const attrs = [...m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)];
    const vb = (attrs.find((a) => a[1] === 'viewBox') || [])[2] || null;
    const rest = attrs.filter((a) => !['id', 'viewBox', 'preserveAspectRatio'].includes(a[1])).map((a) => `${a[1]}="${a[2]}"`);
    return [vb, rest.length ? `<g ${rest.join(' ')}>${m[2]}</g>` : m[2]];
  };

  // text properties shared by text nodes and glyph icons
  const textProps = (e, f, rawOut) => {
    e.f = fontTuple(f.ff, f.fw, f.fst);
    const fs = pxOf(f.fs);
    if (fs === null) { if (f.fs != null) rawOut.fs = f.fs; } else if (fs !== 12) e.fs = r2(fs);
    if (f.lh != null && f.lh !== '' && f.lh !== 'normal') { const lh = pxOf(f.lh); if (lh === null) rawOut.lh = f.lh; else e.lh = r2(lh); }
    if (f.ls != null && f.ls !== 'normal') { const ls = pxOf(f.ls); if (ls === null) rawOut.ls = f.ls; else if (ls !== 0) e.ls = r2(ls); }
    if (f.c != null) { const hx = hexOf(f.c); if (!hx) rawOut.color = f.c; else if (hx !== '#000000') e.c = hx; }
    if (f.td && f.td !== 'none') { if (TD[f.td]) e.td = TD[f.td]; else rawOut.td = f.td; }
    if (f.tt && f.tt !== 'none') { if (TT[f.tt]) e.tt = TT[f.tt]; else rawOut.tt = f.tt; }
  };

  // effective spec value of a token-map key, for the value check
  const specValue = (n, base, run) => {
    const p = n.paint || {}, l = n.lay || {};
    const side = (k) => SIDES.indexOf(k.slice(-1));
    if (base === 'bg') return { c: p.bg };
    if (/^border[TRBL]$/.test(base)) return { c: p.border && p.border[side(base)] && p.border[side(base)].color };
    if (base === 'color') {
      if (n.t === 'V') return { c: (n.icon && n.icon.color) ?? (n.font && n.font.c) };
      const r = run !== undefined && n.runs ? n.runs[run] : undefined;
      return { c: (r && r.s ? r.s.c : undefined) ?? (n.font && n.font.c) };
    }
    if (base === 'fill') return { c: n.icon && n.icon.fill };
    if (base === 'stroke') return { c: n.icon && n.icon.stroke };
    if (/^padding[TRBL]$/.test(base)) return { px: (l.p || [])[side(base)] };
    if (base === 'gap') return { px: l.g };
    if (base === 'counterGap') return { px: l.cg };
    if (base === 'width' || base === 'icon-width') return { px: n.w };
    if (base === 'height' || base === 'icon-height') return { px: n.h };
    if (base === 'icon-fontSize') return { px: pxOf(n.font && n.font.fs) };
    if (/^radius/.test(base)) return { radius: radiusPx(n)[['TL', 'TR', 'BR', 'BL'].indexOf(base.slice(6))] };
    if (/^border-width-/.test(base)) return { px: p.border && p.border[side(base)] && p.border[side(base)].w };
    if (base === 'opacity') return { num: p.opacity };
    return {};
  };
  const valueOk = (n, base, run, tok) => {
    const sv = specValue(n, base, run), v = tok.$value;
    if ('c' in sv) { const a = sv.c != null ? hexOf(sv.c) : null; return a !== null && a === tokenHex(v); }
    const tv = v && typeof v === 'object' && typeof v.value === 'number' ? v.value : typeof v === 'number' ? v : null;
    if (tv === null) return true; // typography, shadow: tokenMap already matched them
    if ('radius' in sv) {
      if (sv.radius == null) return false;
      // R70: radius.full (PILL_PX) stands for every pill corner; Figma clamps it to half the smaller side, as CSS does
      if (tv === PILL_PX && isPillRadius(sv.radius, n.w, n.h)) return true;
      return Math.abs(sv.radius - tv) <= 0.01;
    }
    if ('num' in sv) return sv.num != null && Math.abs(sv.num - tv) <= 0.005;
    if ('px' in sv) return sv.px != null && Math.abs(sv.px - tv) <= 0.01;
    return true;
  };
  const varFor = (n, key, base, run, path) => {
    const name = figmaVarName(path);
    let vi = vIndex.has(name) ? name : vIndex.has(path.replace(/\./g, '/')) ? path.replace(/\./g, '/') : null;
    if (vi === null) return { reason: 'no-variable' };
    if (tokens) {
      const r = resolveToken(tokens, path);
      if (!r) return { reason: 'no-token' };
      if (!valueOk(n, base, run, r.token)) return { reason: 'value-mismatch' };
    }
    return { name: vi };
  };
  const styleFor = (path, kind) => {
    const prefix = kind === 'type' ? 'primitive.typography.' : 'primitive.shadow.';
    let p = path;
    if (!p.startsWith(prefix)) { const r = tokens && resolveToken(tokens, path); p = r ? r.path : null; }
    if (!p || !p.startsWith(prefix)) return null;
    return `${kind === 'type' ? 'type' : 'shadow'}/${p.slice(prefix.length)}`;
  };

  function radiusPx(n) {
    const rd = (n.paint && n.paint.radius) || [];
    return [0, 1, 2, 3].map((i) => {
      const v = rd[i];
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      const parts = String(v).trim().split(/\s+/).map((x) => (/%$/.test(x) ? (parseFloat(x) / 100) * Math.min(n.w, n.h) : pxOf(x)));
      return parts.some((x) => x === null || Number.isNaN(x)) ? null : Math.min(...parts);
    });
  }

  function enc(n) {
    const e = { o: n.id };
    const rawOut = {};
    if (n.t && n.t !== 'F') e.t = n.t;
    if (n.syn) e.y = n.syn;
    e.w = r2(n.w); e.h = r2(n.h);
    const sz = [0, 1].map((ax) => { const s = (n.sz && n.sz[ax]) || 'FIXED'; return SIZING[s === 'HUG' && !canHug(n) ? 'FIXED' : s] || 'X'; }).join('');
    if (sz !== 'XX') e.s = sz;
    if (n.min) e.mn = r2(n.min);
    if (n.max) e.mx = r2(n.max);
    if (n.lay && n.lay.d) {
      const L = n.lay, l = { d: L.d };
      if (L.p && L.p.some((v) => v)) l.p = L.p.map(r2);
      if (L.sb) l.sb = 1; else if (L.g) l.g = r2(L.g);
      if (L.pa && L.pa !== 'S') l.pa = L.pa;
      if (L.ca && L.ca !== 'S') l.ca = L.ca;
      if (L.wrap) { l.wr = 1; if (L.cg) l.cg = r2(L.cg); }
      e.l = l;
    }
    if (n.abs) {
      const a = [r2(n.abs.x || 0), r2(n.abs.y || 0)];
      const c = n.abs.c || 'L', cy = n.abs.cy || 'T';
      if (c !== 'L' || cy !== 'T') a.push(c);
      if (cy !== 'T') a.push(cy);
      e.a = a;
    }
    const p = n.paint || {};
    if (n.t !== 'T') {
      if (p.bg != null) { const hx = hexOf(p.bg); if (hx) e.bg = hx; else rawOut.bg = p.bg; }
      if (p.bgImage && p.bgImage !== 'none') { const g = gradients(p.bgImage, n.w, n.h); if (g) e.gr = g; else rawOut.bgImage = p.bgImage; }
      if (p.radius) {
        const px = radiusPx(n), raw0 = p.radius.map(String);
        const exactPx = raw0.every((v) => pxOf(v) !== null);
        const squarePct = raw0.every((v) => pxOf(v) !== null || (/^\d*\.?\d+%$/.test(v.trim()) && Math.abs(n.w - n.h) <= 0.5));
        const ok = px.map((v) => (v === null ? 0 : r2(v)));
        if (!exactPx && !squarePct) rawOut.radius = p.radius;
        if (ok.some((v) => v)) e.rd = ok.every((v) => v === ok[0]) ? ok[0] : ok;
      }
      if (Array.isArray(p.border) && p.border.some((s) => s && s.w > 0 && s.style !== 'none' && s.style !== 'hidden')) {
        const vis = p.border.map((s) => (s && s.w > 0 && s.style !== 'none' && s.style !== 'hidden' ? s : null));
        const ws = vis.map((s) => (s ? r2(s.w) : 0));
        const shown = vis.filter(Boolean);
        const colours = [...new Set(shown.map((s) => hexOf(s.color)))], styles = [...new Set(shown.map((s) => s.style))];
        const bd = { w: ws.every((v) => v === ws[0]) ? ws[0] : ws };
        const main = shown.reduce((a, b) => (b.w > a.w ? b : a));
        const hx = hexOf(main.color);
        bd.c = hx || '#000000';
        if (main.style === 'dashed' || main.style === 'dotted') bd.d = main.style;
        if (colours.length > 1 || styles.length > 1 || !hx || !['solid', 'dashed', 'dotted'].includes(main.style)) rawOut.border = p.border;
        if (p.strokeOverlay) bd.o = 1;
        e.bd = bd;
      }
      if (p.shadow && p.shadow !== 'none') {
        const sh = parseShadow(p.shadow);
        if (!sh) rawOut.shadow = p.shadow;
        else e.sh = [].concat(sh).map((s) => {
          const x = [tokenHex(s.color), r2(s.offsetX.value), r2(s.offsetY.value), r2(s.blur.value), r2(s.spread.value)];
          if (s.inset) x.push(1);
          return x;
        });
      }
      if (p.clip) e.cl = 1;
      for (const k of ['filter', 'clipPath', 'outline']) if (p[k] != null && p[k] !== 'none') rawOut[k] = p[k];
    }
    // R46: paint capture did not translate (text-shadow, svg inner transforms, masks, markers ...), every node type
    if (Array.isArray(p.unsupported) && p.unsupported.length) rawOut.unsupported = p.unsupported;
    if (p.opacity != null && p.opacity !== 1) e.op = r4(p.opacity);
    if (p.transform) {
      const tv = p.transform.value || p.transform;
      const m = /^matrix\(([^)]*)\)$/.exec(String(tv).trim());
      const nums = m ? m[1].split(',').map((x) => +x) : null;
      const o = p.transform.origin ? String(p.transform.origin).trim().split(/\s+/).map(pxOf) : [n.w / 2, n.h / 2];
      if (nums && nums.length === 6 && nums.every(Number.isFinite) && o.length >= 2 && o.slice(0, 2).every((v) => v !== null)) e.tf = [...nums.map(r6), r2(o[0]), r2(o[1])];
      else if (tv !== 'none') rawOut.transform = p.transform;
    }

    if (n.t === 'T') {
      const f = n.font || {};
      const runs = n.runs || [];
      e.tx = runs.map((r) => (r.br ? '\n' : r.t || '')).join('');
      textProps(e, f, rawOut);
      const ta = TA(f.ta); if (ta) e.ta = ta;
      const [sx, sy] = sz;
      if (sx !== 'H') e.ar = sy === 'H' ? 'H' : 'N';
      const base = { f: e.f, fs: e.fs ?? 12, lh: e.lh, ls: e.ls ?? 0, c: e.c ?? '#000000', td: e.td, tt: e.tt };
      e.rn = runs.map((r) => {
        const len = r.br ? 1 : (r.t || '').length;
        if (r.br || !r.s) return len;
        const s = r.s, o = {}, ro = {};
        const ft = fontTuple(s.ff ?? f.ff, s.fw ?? f.fw, s.fst ?? f.fst);
        if (JSON.stringify(ft) !== JSON.stringify(base.f)) o.f = ft;
        if (s.fs != null) { const v = pxOf(s.fs); if (v === null) ro.fs = s.fs; else if (r2(v) !== base.fs) o.fs = r2(v); }
        if (s.lh != null && s.lh !== 'normal') { const v = pxOf(s.lh); if (v === null) ro.lh = s.lh; else if (r2(v) !== base.lh) o.lh = r2(v); }
        if (s.ls != null) { const v = s.ls === 'normal' ? 0 : pxOf(s.ls); if (v === null) ro.ls = s.ls; else if (r2(v) !== base.ls) o.ls = r2(v); }
        if (s.c != null) { const v = hexOf(s.c); if (!v) ro.color = s.c; else if (v !== base.c) o.c = v; }
        if (s.td != null) { const v = s.td === 'none' ? undefined : TD[s.td]; if (s.td !== 'none' && !v) ro.td = s.td; else if (v !== base.td) o.td = v || ''; }
        if (s.tt != null) { const v = s.tt === 'none' ? undefined : TT[s.tt]; if (s.tt !== 'none' && !v) ro.tt = s.tt; else if (v !== base.tt) o.tt = v || ''; }
        if (Object.keys(ro).length) (rawOut.runs ||= []).push({ run: runs.indexOf(r), ...ro });
        return Object.keys(o).length ? [len, o] : len;
      });
    } else if (n.t === 'V') {
      const ic = n.icon || {};
      if (ic.glyph != null) {
        e.ic = { g: String(ic.glyph) };
        if (n.font) textProps(e, n.font, rawOut);
        if (ic.color != null) { const hx = hexOf(ic.color); if (!hx) rawOut.color = ic.color; else if (hx !== '#000000') e.c = hx; else delete e.c; }
      } else {
        const x = {};
        const def = ic.svg ? [null, String(ic.svg)] : ic.ref ? icons(ic.ref) : null;
        if (def) x.i = def; else rawOut.icon = ic.ref ?? ic;
        for (const [k, sk] of [['c', 'color'], ['f', 'fill'], ['s', 'stroke']]) {
          if (ic[sk] == null) continue;
          if (ic[sk] === 'none') { x[k] = -1; continue; }
          const hx = hexOf(ic[sk]); if (hx) x[k] = hx; else rawOut[`icon.${sk}`] = ic[sk];
        }
        if (ic.sw != null) { const v = pxOf(ic.sw); if (v === null) rawOut['icon.sw'] = ic.sw; else x.w = r2(v); }
        e.ic = x;
      }
    } else if (n.t === 'I') {
      if (n.src) { e.im = { m: String(n.src) }; if (n.fit) e.im.f = n.fit; if (n.pos) e.im.p = n.pos; }
      else { rawOut.src = n.src ?? null; if (n.fit) rawOut.fit = n.fit; if (n.pos) rawOut.pos = n.pos; } // canvas / iframe / video without a source
    }

    bind(n, e);
    if (n.t === 'T') styleVariants(e);
    if (rawOut.runs && rawOut.runs.length === 0) delete rawOut.runs;
    if (Object.keys(rawOut).length) { e.raw = rawOut; raw++; }
    if (e.rn && !e.rn.some(Array.isArray)) delete e.rn;
    if (n.kids && n.kids.length) e.k = n.kids.map(enc);
    return e;
  }

  // variable / style bindings of one node from its token-map entry
  function bind(n, e) {
    const entry = nodeMap[n.id];
    if (!entry) return;
    const v = {};
    const runV = new Map(); // run index -> { v, ts }
    const keys = Object.keys(entry).sort(cmpStr);
    const runs = n.runs || [];
    // runs that share the style / colour of a keyed run get its binding (inventory keys the first run of each)
    const typeOf = (i) => { const s = runs[i].s || {}, f = n.font || {}; return JSON.stringify([s.ff ?? f.ff, s.fs ?? f.fs, s.fw ?? f.fw, s.fst ?? f.fst, s.ls ?? f.ls, s.tt ?? f.tt]); };
    const colourOf = (i) => hexOf((runs[i].s && runs[i].s.c) ?? (n.font && n.font.c));
    const keyed = { ts: new Map(), c: new Map() }; // run index -> binding of a run key that bound
    const own = { ts: new Set(), c: new Set() }; // runs with a key of their own (bound or not)
    for (const key of keys) {
      const [b, rs] = key.split('|');
      if (rs !== undefined) own[b === 'type' ? 'ts' : 'c'].add(+rs);
    }
    const onRun = (i, k, val) => { const r = runV.get(i) || {}; if (k === 'ts') r.ts = val; else (r.v ||= {})[k] = val; runV.set(i, r); };
    let scPath = null;
    for (const key of keys) {
      const path = entry[key];
      const [base, rs] = key.split('|');
      const run = rs !== undefined ? +rs : undefined;
      if (run !== undefined && (!runs[run] || runs[run].br || n.t !== 'T')) { miss(n.id, key, path, 'no-target'); continue; }
      if (base === 'type' || base === 'shadow') {
        if (base === 'type' && n.t !== 'T') { miss(n.id, key, path, 'no-target'); continue; }
        if (base === 'shadow' && !e.sh) { miss(n.id, key, path, 'no-target'); continue; }
        const name = styleFor(path, base);
        if (!name) { miss(n.id, key, path, 'no-style'); continue; }
        if (base === 'shadow') e.es = name;
        else if (run === undefined) e.ts = name;
        else keyed.ts.set(run, name);
        continue;
      }
      let code;
      if (base === 'color') code = n.t === 'T' || (n.t === 'V' && e.ic && e.ic.g !== undefined) ? 'c' : null;
      else if (/^border[TRBL]$/.test(base)) code = 'sc';
      else code = VCODE[base] || null;
      if (code === null) { miss(n.id, key, path, VCODE[base] || base === 'color' || /^border[TRBL]$/.test(base) ? 'no-target' : 'unknown-prop'); continue; }
      // the encoded node must carry the property the variable binds to
      const has = {
        bg: e.bg !== undefined, sc: !!e.bd, vf: !!(e.ic && e.ic.f !== undefined && e.ic.f !== -1), vs: !!(e.ic && e.ic.s !== undefined && e.ic.s !== -1),
        pt: !!e.l, pr: !!e.l, pb: !!e.l, pl: !!e.l, g: !!(e.l && !e.l.sb), cg: !!(e.l && e.l.wr), r0: e.rd !== undefined, r1: e.rd !== undefined,
        r2: e.rd !== undefined, r3: e.rd !== undefined, b0: !!e.bd, b1: !!e.bd, b2: !!e.bd, b3: !!e.bd, op: e.op !== undefined, c: true, fs: true, w: true, h: true,
      }[code];
      if (!has) { miss(n.id, key, path, 'no-target'); continue; }
      if ((code === 'w' && (e.s || 'XX')[0] !== 'X') || (code === 'h' && (e.s || 'XX')[1] !== 'X')) { miss(n.id, key, path, 'not-fixed'); continue; }
      if (code === 'sc') {
        // one stroke paint: the side's colour must be the stroke colour, and all sides one variable
        const side = p0(n.paint.border[SIDES.indexOf(base.slice(-1))]);
        if (!side || hexOf(side.color) !== e.bd.c) { miss(n.id, key, path, 'no-target'); continue; }
        if (scPath !== null && scPath !== path) { miss(n.id, key, path, 'conflict'); continue; }
      }
      const r = varFor(n, key, base, run, path);
      if (!r.name) { miss(n.id, key, path, r.reason); continue; }
      if (code === 'sc') { if (scPath !== null) continue; scPath = path; }
      if (run === undefined) v[code] = r.name;
      else keyed.c.set(run, r.name);
    }
    if (Object.keys(v).length) e.v = v;
    // a run without a key of its own takes the binding of the first keyed run with the same style / colour (inventory
    // keys only the first run of each distinct style and colour)
    for (const [k, same] of [['ts', typeOf], ['c', colourOf]]) {
      if (!keyed[k].size) continue;
      runs.forEach((r, j) => {
        if (r.br) return;
        let i = own[k].has(j) ? (keyed[k].has(j) ? j : -2) : -1;
        for (let x = 0; i === -1 && x < j; x++) if (own[k].has(x) && same(x) === same(j)) i = keyed[k].has(x) ? x : -2;
        if (i >= 0) onRun(j, k, keyed[k].get(i));
      });
    }
    if (runV.size) {
      if (!e.rn) e.rn = runs.map((r) => (r.br ? 1 : (r.t || '').length));
      e.rn = e.rn.map((r, i) => {
        const b = runV.get(i);
        if (!b) return r;
        const [len, o] = Array.isArray(r) ? r : [r, {}];
        const o2 = { ...o };
        if (b.ts) o2.ts = b.ts;
        if (b.v) o2.v = { ...(o2.v || {}), ...b.v };
        return [len, o2];
      });
    }
  }
  // see "Style variants" in the header
  function variantOf(ts, td, tt) {
    if (!ts || !styleTc.has(ts)) return ts;
    const tc = TCASE[tt] || 'ORIGINAL', deco = TDECO[td] || '';
    const parts = [deco ? VSUF[deco] : null, tc !== (styleTc.get(ts) || 'ORIGINAL') ? tc.toLowerCase() : null].filter(Boolean);
    if (!parts.length) return ts;
    const name = `${ts}/${parts.join('-')}`;
    variants.set(name, [name, ts, deco, tc]);
    return name;
  }
  function styleVariants(e) {
    if (Array.isArray(e.rn)) {
      e.rn = e.rn.map((r) => {
        if (!Array.isArray(r)) return r;
        const [len, o] = r;
        if (o.ts === undefined && o.td === undefined && o.tt === undefined) return r;
        const ts = o.ts !== undefined ? o.ts : e.ts;
        if (!ts) return r;
        return [len, { ...o, ts: variantOf(ts, o.td !== undefined ? o.td : e.td, o.tt !== undefined ? o.tt : e.tt) }];
      });
    }
    if (e.ts) e.ts = variantOf(e.ts, e.td, e.tt);
  }
  const p0 = (s) => (s && s.w > 0 && s.style !== 'none' && s.style !== 'hidden' ? s : null);

  const T = enc(spec);
  mapRefs(T, (Tn, val) => {
    if (Tn === 'V') return vIndex.get(val);
    return intern(tables, Tn, val);
  });
  return { screen: ctx.screen, file: ctx.file, W: ctx.W, T, tables, raw, unbound, unboundList, variants: [...variants.values()].sort((a, b) => cmpStr(a[0], b[0])) };
}

// ---------------- batches ----------------
export function batchData(encs, n, page, force, prof, extra) {
  const tb = newTables();
  const screens = encs.map((enc) => {
    const T = structuredClone(enc.T);
    mapRefs(T, (Tn, i) => intern(tb, Tn, enc.tables[Tn][i]));
    if (!enc.cm) return { screen: enc.screen, file: enc.file, W: enc.W, T };
    // a component batch item (figma-cmp.mjs): its K index and INSTANCE_SWAP defaults remapped too
    const cm = structuredClone(enc.cm), K = (i) => intern(tb, 'K', enc.tables.K[i]);
    cm.k = K(cm.k);
    for (const p of Object.values(cm.p || {})) if (p[0] === 'INSTANCE_SWAP') p[1] = K(p[1]);
    return { screen: enc.screen, file: enc.file, W: enc.W, T, cm };
  });
  const D = { batch: n, rd: 1 }; // rd: the runtime reads text decoration / case and the dash pattern back (figma-check)
  if (page !== undefined) D.page = page;
  // a component item (figma-cmp.mjs) is forced by its name: 'cmp:<name>' (its screen is 'cmp:<K name>')
  const f = (force || []).filter((x) => encs.some((enc) => enc.screen === x || (enc.cm && `cmp:${enc.cm.n}` === x)));
  if (f.length) D.force = f;
  if (prof) D.prof = 1; // runtime phase timings (figma.mjs plan --prof); not in the per-screen hash
  // extra (plan 3b): cm = 1 on a component batch, cp = the components page when the batch uses components
  if (extra) for (const [k, v] of Object.entries(extra)) if (k !== 'cp' || tb.K) D[k] = v;
  Object.assign(D, tb, { screens });
  return D;
}

export function planBatches(encs, opts = {}) {
  const { limit = PAYLOAD_LIMIT, runtime, page, force, wrap, first = 1, prof, extra } = opts;
  let pre = '', post = '';
  if (!wrap) {
    if (typeof runtime !== 'string' || runtime.split('__DATA__').length !== 2) throw new Error('planBatches: runtime must contain __DATA__ exactly once');
    [pre, post] = runtime.split('__DATA__');
  }
  const build = (group, n) => {
    const data = batchData(group, n, page, force, prof, extra);
    const code = wrap ? wrap(data) : pre + JSON.stringify(data) + post;
    return { n, screens: group.map((e) => e.screen), bytes: Buffer.byteLength(code, 'utf8'), code, data };
  };
  const out = [];
  let group = [], cur = null;
  // unit (plan 3b): consecutive encodings with the same unit(enc) go into one batch together (a component's variants)
  const units = [];
  for (const enc of encs) {
    const u = opts.unit ? opts.unit(enc) : units.length;
    if (units.length && units[units.length - 1].u === u) units[units.length - 1].encs.push(enc); else units.push({ u, encs: [enc] });
  }
  for (const { encs: us } of units) {
    const n = out.length + first;
    const tryB = build([...group, ...us], n);
    if (tryB.bytes <= limit) { group.push(...us); cur = tryB; continue; }
    if (!group.length) throw new OversizeError(us[0].screen, tryB.bytes, limit);
    out.push(cur);
    const alone = build(us, n + 1);
    if (alone.bytes > limit) throw new OversizeError(us[0].screen, alone.bytes, limit);
    group = [...us]; cur = alone;
  }
  if (group.length) out.push(cur);
  return out;
}

// ---------------- compact data (figma.mjs loader batches) ----------------
// compactIds(D): a copy of D where a child's o is left out when it is <parent o>.<index in k>, and written '.<rest>'
// when it is <parent o>.<rest>, and the four corner (r0..r3) / stroke side (b0..b3) bindings of a node written once as
// v.r / v.b when they are the same variable; figma-runtime.js expands all of it back before building.
export function compactIds(D) {
  const C = structuredClone(D);
  const four = (e) => {
    const v = e.v;
    if (v) for (const p of 'rb') if (v[`${p}0`] != null && [1, 2, 3].every((i) => v[`${p}${i}`] === v[`${p}0`])) { v[p] = v[`${p}0`]; for (let i = 0; i < 4; i++) delete v[`${p}${i}`]; }
    (e.k || []).forEach(four);
  };
  for (const s of C.screens || []) four(s.T);
  const walk = (e) => (e.k || []).forEach((k, i) => {
    const o = k.o;
    walk(k);
    if (o === `${e.o}.${i}`) delete k.o;
    else if (o.startsWith(`${e.o}.`)) k.o = o.slice(e.o.length);
  });
  for (const s of C.screens || []) walk(s.T);
  return C;
}
// jsLiteral(x): x as a JavaScript expression with identifier keys unquoted and strings in single quotes (fewer
// characters to escape when the code travels inside a JSON tool call). eval(jsLiteral(x)) deep-equals x.
const IDENT = /^[A-Za-z_$][\w$]*$/;
const sq = (s) => `'${JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
export function jsLiteral(x) {
  if (x === null || typeof x !== 'object') return typeof x === 'string' ? sq(x) : JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? 'null' : jsLiteral(v))).join(',')}]`;
  return `{${Object.entries(x).filter(([, v]) => v !== undefined).map(([k, v]) => `${IDENT.test(k) ? k : sq(k)}:${jsLiteral(v)}`).join(',')}}`;
}
// fnv(s): 32-bit FNV-1a of the UTF-16 code units, base 36; the loader computes the same in Figma.
export const fnv = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 0).toString(36); };
