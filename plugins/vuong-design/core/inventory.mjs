// Inventory (plan 2, Task 2): every design value a screen uses, read from the modelled spec (infer + figma-model)
// with the capture IR for what the spec does not carry (tag/class, source font list, CSS-variable use). Pure and
// deterministic: no browser, no clock; the output does not depend on the order of screens or of kids.
//
// inventory(screens: [{ screen: IR screen, spec: modelled SNode root }]) -> { uses: Use[], vars }
//
// Use = { screen, node, cat, prop, value, raw, role, token?, tokenMismatch?, tokens?, flex?, unparsed?, noise?, run?,
//         rawCandidates?, sizes?, fixed?, natural?, img?, box?, pill? }
//  - screen: IR screen id (name when id is missing); node: SNode id (= source INode id unless synthetic).
//  - cat / prop:
//      color   bg | borderT|R|B|L (border colour per side) | color (text: node colour and each distinct run colour)
//              | fill | stroke (svg icon root) | color (glyph icon)
//      space   paddingT|R|B|L (lay.p), gap (lay.g), counterGap (lay.cg, between wrapped rows)
//      size    width | height: FIXED axes of frames (t F) and images (t I)
//      radius  radiusTL|TR|BR|BL
//      border  borderT|R|B|L: stroke width per side (value px, raw 'Wpx style'); its colour is a separate color Use
//      type    text: one Use per distinct run style of a text node (run = index of the first run with that style)
//      shadow  shadow (value = raw box-shadow string; colours inside are not split out here)
//      opacity opacity
//      icon    width | height (svg and glyph icons), fontSize (glyph icons)
//  - value: number in px for space/size/radius/border/icon; '#rrggbb' or '#rrggbbaa' for colours (color.mjs toHex);
//    type = { family, size, weight, style, lineHeight, letterSpacing, transform } with family the Figma family after
//    figma-model's substitution and numbers in px (letter-spacing 'normal' = 0). A value that cannot be read (an
//    unparsable colour such as color-mix() or url(#g), a radius in % or elliptical) keeps value null and
//    `unparsed: true`; it is never dropped and never turned into black.
//  - raw: the CSS string as captured ('12px' for spacing and sizes, which are geometry, not CSS). For type it is the
//    family the source authored (R63): capture's fontOverride already replaced the IR font-family with the Figma
//    family, so when the first family of the IR list equals the `to` of a screen.fontSubs entry whose reason is not
//    'version' / 'version-failed' / 'override-failed' (those kept the page's own font), raw = that entry's `from`.
//    Several such entries with the same `to` (two source fonts both measured in Inter): raw stays the IR list and
//    rawCandidates = the sorted `from`s. No matching entry (no override, or a font Figma has): raw = the IR list.
//  - flex: 'sb' for a space-between primary axis (Figma auto spacing): prop gap, no value.
//  - noise (R67): true on a space, size or radius use whose value is under 0.5 px. Such values are residues of the
//    measured geometry (capture rounds rects to 0.01 px and infer derives padding as differences of them, and the
//    R38 FILL split leaves 0.01-0.03 px on buttons / rows), not authored values: the use is listed for tracing (value
//    and raw kept) but is not a design value: normalize and tokens skip it. Border widths and icons are never noise.
//  - token: the CSS variable name from the IR node's tok[prop] (capture, Task 1), or undefined when the node has
//    none (no tok, synthetic frame, a run with its own colour from a nested element). For type the tokens are per
//    key in `tokens` ({ family, size, weight, lineHeight, letterSpacing }), only for keys the run does not override
//    (type tokens are not value-checked here).
//    R64: a token is attached only when its value is this use's value. space / size / radius / icon: the variable's
//    value on this screen (screen.vars['--x'].value, read at :root) must be a px length ('12px', or '0') within
//    0.25 px of the use's value (the spec value is geometric: inferred padding / gap can differ from the CSS one).
//    colour: toHex of the variable's value must equal the use's hex. Otherwise, and when the variable is missing,
//    not px (rem, %, calc), empty (declared only lower down, a scoped override) or unparsable, there is no token
//    and tokenMismatch = '--x' (the design-system token would not stand for this use). Border widths carry no
//    token (capture's border tokens are colours). Shadow / opacity / type tokens are passed through unchecked.
//  - sizes (R65 input): [wA, hA, wB, hB] measured at widths A and B (IR rA / rB; rB missing = rA) on icon width /
//    height uses and image size uses. Capture records no declared CSS size, so none is carried (normalize derives
//    it, R65). fixed: on icon width / height uses, whether that spec axis is FIXED. img: true on image size uses.
//  - natural (R74): on an icon width / height use whose spec axis is not FIXED (infer made a squashed item FILL)
//    and whose IR node is a flex item on that main axis that cannot grow (flex.g 0) but may shrink (flex.s > 0):
//    capture's flex.n, the item's main size with shrinking disabled (measured at width A), i.e. the size the source
//    declared before flex-shrink squashed it. normalize turns it into a SRC_SQUASH question.
//  - box: [w, h] of the node in the modelled spec (width A) on radius uses (R70) and icon width / height uses (R71:
//    normalize treats an svg whose larger side is over 32 px as an illustration).
//  - pill (R70): true on a radius use whose value is at least half the node's smaller side (−0.01 px): the corner is
//    a full round end, whatever the authored number (999px, 50%-like 14px on a 28px box). normalize keeps it (PILL),
//    tokens put it under radius.full.
//
// role = `${cat}|${prop}|${sig(node)}|${sig(parent)}`, sig = tag + sorted classes joined with '.', state classes
// dropped (is-*, active, selected, disabled, on). The parent is the source (DOM) parent from the IR, never a
// synthetic group, so grouping does not split a role. ::before / ::after nodes sign as '::before' / '::after'.
// A synthetic frame (syn) has no source element: its sig is `syn:<kind>` and its parent sig is the nearest source
// ancestor of its id (`<parentId>.g<k>`, repeated). Two nodes with the same role are "the same role by structure"
// (spec §9 step 4).
//
// Excluded, and why:
//  - zero padding / gap / radius / border width: 0 is the absence of the property, not a value to tokenise.
//  - size of FILL / HUG axes (flexible, Global Constraints), text boxes (follow the text), the screen root (the
//    artboard width is a device size), synthetic frames (their size is inferred, not authored; R47 'anchor'
//    wrappers included), min/max. R80: nor an axis whose abs constraint stretches with the parent (x: abs.c, y:
//    abs.cy LR / TB / SCALE): a `left: 0; right: 0` overlay is as wide as its card at each width, not an authored size.
//  - abs offsets (positions), background images and gradients, outline, text decoration: not tokenised in plan 2.
//  - paints inside icon markup (icon.svg) and the svg root's `color` (only reaches shapes through currentColor in
//    the markup): only the root fill / stroke the proxy and Figma set are listed; 'none' is skipped.
//  - M2-a: the svg root's fill when it is the CSS initial black (#000000) and no painted shape of the icon inherits
//    it: the markup (icon.svg, or for a sprite icon the symbol in screen.svgDefs[icon.ref], R48 / R54) is parsed, and
//    every fillable shape (path, rect, circle, ellipse, polygon, polyline, text), reached through groups and <use>
//    (target in the markup or in svgDefs), has a fill of its own or of an ancestor below the root (attribute or
//    inlined style; 'inherit' does not count; fill="none" does), or there is no fillable shape at all (lines only).
//    Content of defs / clipPath / mask / pattern / marker / gradients is not painted except through <use>. A stroke
//    icon (<g fill="none">) thus gives no black fill use. Markup missing (a sprite whose symbol was not captured), an
//    unresolved <use>, or any other root fill colour: the use is kept.
//  - duplicate run styles / colours inside one text node are listed once (a colour-only span does not add a type).
//
// Output order: uses sorted by screen, node id in tree order (DOM path; ::before and the sole text child first, then
// synthetic groups, then children by index, ::after last), cat, prop, run, then value. vars = the screens' vars merged
// by name, keys sorted: { value (first screen by id), uses (sum), screens, values? ({screen: value}, only when the
// value differs between screens) }.
import { parseColor, toHex } from './color.mjs';
import { firstFamily } from './font-map.mjs';

const STATE = /^(is-.+|active|selected|disabled|on)$/;
const SIDE = ['T', 'R', 'B', 'L'];
const CORNER = ['TL', 'TR', 'BR', 'BL'];

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function roleSig(tag, cls) {
  const c = String(cls || '').split(/\s+/).filter((x) => x && !STATE.test(x));
  return [tag || '', ...[...new Set(c)].sort(cmpStr)].join('.');
}

// tree order of ids: '0.1.b' < '0.1.t' < '0.1.g0' < '0.1.0' < '0.1.a'; a parent before its descendants
const segKey = (s) => {
  if (s === 'b') return [0, 0, ''];
  if (s === 't') return [0, 1, ''];
  const g = /^g(\d+)$/.exec(s);
  if (g) return [1, +g[1], ''];
  if (/^\d+$/.test(s)) return [2, +s, ''];
  if (s === 'a') return [3, 0, ''];
  return [4, 0, s];
};
export function cmpNodeId(a, b) {
  const A = String(a).split('.'), B = String(b).split('.');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] === undefined) return -1;
    if (B[i] === undefined) return 1;
    if (A[i] === B[i]) continue;
    const x = segKey(A[i]), y = segKey(B[i]);
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[1] !== y[1]) return x[1] - y[1];
    return cmpStr(x[2], y[2]);
  }
  return 0;
};

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const pxRaw = (v) => `${v}px`;
const colorValue = (raw) => {
  const c = parseColor(raw);
  return c.unparsed !== undefined ? { value: null, unparsed: true } : { value: toHex(c) };
};
const lsPx = (ls) => (ls == null || ls === 'normal' ? 0 : num(ls));
const varPx = (v) => { const m = /^\s*(-?\d*\.?\d+)(px)?\s*$/.exec(String(v ?? '')); return m && (m[2] || +m[1] === 0) ? +m[1] : null; };
const LEN_CATS = new Set(['space', 'size', 'radius', 'border', 'icon']);
const NOISE_CATS = new Set(['space', 'size', 'radius']);
const NOISE_PX = 0.5;

// ---------------- M2-a: does the svg root's fill reach a painted shape? ----------------
const SVG_TAG = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const SVG_ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const SVG_VOID_HTML = /^(img|br|hr|input|meta|link)$/;
function parseSvg(markup) {
  const root = { tag: '#root', attrs: {}, kids: [] }, stack = [root];
  for (const m of String(markup).matchAll(SVG_TAG)) {
    if (!m[2]) continue; // comment
    const tag = m[2].replace(/^.*:/, '').toLowerCase();
    if (m[1]) { // closing tag: pop to the matching open element
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(SVG_ATTR)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4];
    const el = { tag, attrs, kids: [] };
    stack[stack.length - 1].kids.push(el);
    if (!m[4] && !SVG_VOID_HTML.test(tag)) stack.push(el);
  }
  return root;
}
const SVG_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan', 'textpath']);
const SVG_HIDDEN = new Set(['defs', 'clippath', 'mask', 'pattern', 'marker', 'symbol', 'lineargradient', 'radialgradient', 'filter',
  'title', 'desc', 'metadata', 'style', 'script']);
const ownFill = (el) => {
  const st = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(el.attrs.style || '');
  const v = st ? st[1] : el.attrs.fill;
  return v !== undefined && !/^\s*(inherit)?\s*$/i.test(String(v).replace(/!important/i, ''));
};
// true when some fillable shape inherits the root fill, or when that cannot be told (unresolved <use>)
function rootFillReaches(markup, defs) {
  const ids = new Map();
  const index = (el) => { if (el.attrs && el.attrs.id && !ids.has(el.attrs.id)) ids.set(el.attrs.id, el); el.kids.forEach(index); };
  const top = parseSvg(markup);
  index(top);
  for (const k of Object.keys(defs || {}).sort(cmpStr)) index(parseSvg(defs[k]));
  const active = new Set();
  const walk = (el, inherits, instanced) => {
    if (!instanced && SVG_HIDDEN.has(el.tag)) return false;
    const inh = inherits && !ownFill(el);
    if (SVG_SHAPES.has(el.tag) && inh) return true;
    if (el.tag === 'use') {
      const ref = String(el.attrs.href ?? el.attrs['xlink:href'] ?? '').replace(/^.*#/, '');
      const t = ids.get(ref);
      if (!t || active.has(t)) return true; // cannot tell: keep the use
      active.add(t);
      const r = walk(t, inh, true);
      active.delete(t);
      return r;
    }
    return el.kids.some((k) => walk(k, inh, false));
  };
  // the root (svg, or the instanced symbol of a sprite) carries the icon's own fill: start below it
  return top.kids.some((r) => r.kids.some((k) => walk(k, !ownFill(r) || r.tag === 'svg', false)));
}
function svgFillUnused(ic, screen) {
  const c = parseColor(String(ic.fill));
  if (c.unparsed !== undefined || toHex(c) !== '#000000') return false;
  const defs = screen.svgDefs || {};
  const markup = ic.svg !== undefined ? ic.svg : ic.ref != null ? defs[ic.ref] : undefined;
  if (markup === undefined || markup === null) return false;
  return !rootFillReaches(markup, defs);
}
const KEEP_FONT = new Set(['version', 'version-failed', 'override-failed']);

function indexIR(tree) {
  const node = new Map(), parent = new Map();
  const rec = (n, p) => { node.set(n.id, n); parent.set(n.id, p); (n.kids || []).forEach((k) => rec(k, n)); };
  if (tree) rec(tree, null);
  return { node, parent };
}

function sigOf(n) {
  if (!n) return '';
  if (n.kind === 'pseudo' || /\.(b|a)$/.test(n.id)) {
    if (/\.b$/.test(n.id)) return '::before';
    if (/\.a$/.test(n.id)) return '::after';
  }
  return roleSig(n.tag, n.cls);
}

function screenUses(screen, spec) {
  const sid = screen.id ?? screen.name;
  const { node: irNode, parent: irParent } = indexIR(screen.tree);
  const uses = [];
  const vars = screen.vars || {};
  // R64: attach a token only when the variable's value is the use's value
  const lenTok = (token, v) => {
    if (!token) return {};
    const px = varPx(vars[token] && vars[token].value);
    return px != null && typeof v === 'number' && Math.abs(px - v) <= 0.25 ? { token } : { tokenMismatch: token };
  };
  const colTok = (token, hex) => {
    if (!token) return {};
    const c = parseColor(String((vars[token] && vars[token].value) ?? ''));
    return hex && c.unparsed === undefined && toHex(c) === hex ? { token } : { tokenMismatch: token };
  };
  // R63: the family the source authored, from capture's font substitutions
  const subs = (screen.fontSubs || []).filter((x) => x && !KEEP_FONT.has(x.reason));
  const rawFamily = (list) => {
    const fam = firstFamily(list);
    const from = [...new Set(subs.filter((x) => x.to === fam).map((x) => x.from))].sort(cmpStr);
    return from.length === 1 ? { raw: from[0] } : from.length > 1 ? { raw: list, rawCandidates: from } : { raw: list };
  };

  // nearest source ancestor of a synthetic id: strip '.g<k>' segments
  const sourceOf = (id) => {
    let s = String(id);
    while (!irNode.has(s) && /\.g\d+$/.test(s)) s = s.replace(/\.g\d+$/, '');
    return irNode.get(s) || null;
  };

  const visit = (sn, isRoot) => {
    const ir = sn.syn ? null : irNode.get(sn.id) || null;
    const tok = (ir && ir.tok) || {};
    const sig = sn.syn ? `syn:${sn.syn}` : sigOf(ir);
    const parentSig = sn.syn ? sigOf(sourceOf(sn.id)) : sigOf(ir ? irParent.get(ir.id) : null);
    const add = (cat, prop, v, extra = {}) => {
      const u = { screen: sid, node: sn.id, cat, prop, ...v, role: `${cat}|${prop}|${sig}|${parentSig}` };
      if (NOISE_CATS.has(cat) && typeof v.value === 'number' && Math.abs(v.value) < NOISE_PX) u.noise = true; // R67
      const { token, ...rest } = extra;
      const t = token === undefined ? {} : cat === 'color' ? colTok(token, v.value) : LEN_CATS.has(cat) ? lenTok(token, v.value) : { token };
      for (const [k, x] of Object.entries({ ...t, ...rest })) if (x !== undefined) u[k] = x;
      uses.push(u);
    };
    const addColor = (prop, raw, token, extra = {}) => add('color', prop, { ...colorValue(raw), raw }, { token, ...extra });
    const addLen = (cat, prop, v, token, extra = {}) => { if (typeof v === 'number' && v !== 0) add(cat, prop, { value: v, raw: pxRaw(v) }, { token, ...extra }); };
    const rA = ir && Array.isArray(ir.rA) ? ir.rA : null, rB = ir && Array.isArray(ir.rB) ? ir.rB : rA;
    const sizes = rA ? [rA[2], rA[3], rB[2], rB[3]] : undefined;

    // ---- paint ----
    const p = sn.paint || {};
    if (p.bg) addColor('bg', p.bg, tok.bg);
    if (Array.isArray(p.border)) p.border.forEach((b, i) => {
      if (!b || !(b.w > 0)) return;
      add('border', 'border' + SIDE[i], { value: b.w, raw: `${b.w}px ${b.style}` });
      addColor('border' + SIDE[i], b.color, tok['border' + SIDE[i]]);
    });
    if (Array.isArray(p.radius)) p.radius.forEach((r, i) => {
      if (r === '0px' || r == null) return;
      const ok = /^-?[\d.]+px$/.test(String(r).trim());
      if (ok && num(r) === 0) return;
      const box = typeof sn.w === 'number' && typeof sn.h === 'number' ? [sn.w, sn.h] : undefined;
      const pill = ok && box && num(r) >= Math.min(box[0], box[1]) / 2 - 0.01 ? true : undefined;
      add('radius', 'radius' + CORNER[i], ok ? { value: num(r), raw: r } : { value: null, raw: r }, { token: tok.radius, unparsed: ok ? undefined : true, box, pill });
    });
    if (p.shadow) add('shadow', 'shadow', { value: p.shadow, raw: p.shadow }, { token: tok.shadow });
    if (typeof p.opacity === 'number') add('opacity', 'opacity', { value: p.opacity, raw: String(p.opacity) }, { token: tok.opacity });

    // ---- spacing (authored by the layout) ----
    const l = sn.lay;
    if (l) {
      (l.p || []).forEach((v, i) => addLen('space', 'padding' + SIDE[i], v, tok['padding' + SIDE[i]]));
      if (l.sb) add('space', 'gap', {}, { flex: 'sb', token: tok.gap });
      else addLen('space', 'gap', l.g, tok.gap);
      if (l.cg != null) addLen('space', 'counterGap', l.cg, tok.gap);
    }

    // ---- size: FIXED axes of frames and images ----
    if ((sn.t === 'F' || sn.t === 'I') && !sn.syn && !isRoot && Array.isArray(sn.sz)) {
      const im = sn.t === 'I' ? { sizes, img: true } : {};
      // R80: an axis pinned to stretch with its parent (abs LR / TB / SCALE) has no authored size
      const stretch = (c) => c === 'LR' || c === 'TB' || c === 'SCALE';
      if (sn.sz[0] === 'FIXED' && !(sn.abs && stretch(sn.abs.c))) addLen('size', 'width', sn.w, tok.width, im);
      if (sn.sz[1] === 'FIXED' && !(sn.abs && stretch(sn.abs.cy))) addLen('size', 'height', sn.h, tok.height, im);
    }

    // ---- icons ----
    if (sn.t === 'V') {
      const sz = Array.isArray(sn.sz) ? sn.sz : ['FIXED', 'FIXED'];
      const box = [sn.w, sn.h];
      // R74: on an axis the spec did not keep FIXED, the flex item's natural size (it may only shrink)
      const fl = ir && ir.flex;
      const natural = (ax) => (sz[ax === 'x' ? 0 : 1] !== 'FIXED' && fl && fl.ax === ax && fl.g === 0 && fl.s > 0 && typeof fl.n === 'number' && fl.n > 0 ? fl.n : undefined);
      addLen('icon', 'width', sn.w, tok.width, { sizes, fixed: sz[0] === 'FIXED', box, natural: natural('x') });
      addLen('icon', 'height', sn.h, tok.height, { sizes, fixed: sz[1] === 'FIXED', box, natural: natural('y') });
      const ic = sn.icon || {};
      if (ic.svg !== undefined || ic.ref !== undefined || ic.fill !== undefined || ic.stroke !== undefined) {
        if (ic.fill && ic.fill !== 'none' && !svgFillUnused(ic, screen)) addColor('fill', ic.fill, tok.fill);
        if (ic.stroke && ic.stroke !== 'none') addColor('stroke', ic.stroke, tok.stroke);
      } else if (ic.color) addColor('color', ic.color, tok.color);
      if (ic.glyph !== undefined && sn.font && num(sn.font.fs) != null) {
        add('icon', 'fontSize', { value: num(sn.font.fs), raw: sn.font.fs }, { token: tok.fontSize });
      }
    }

    // ---- text ----
    if (sn.t === 'T' && sn.font) {
      const f = sn.font, irFont = (ir && ir.font) || {}, irRuns = (ir && ir.runs) || [];
      const runs = (sn.runs && sn.runs.length ? sn.runs : [{ t: '' }]);
      const seenType = new Set(), seenColor = new Set();
      runs.forEach((r, i) => {
        if (r.br) return;
        const s = r.s || {}, irS = (irRuns[i] && irRuns[i].s) || {};
        const value = {
          family: s.ff ?? f.ff, size: num(s.fs ?? f.fs), weight: num(s.fw ?? f.fw), style: s.fst ?? f.fst ?? 'normal',
          lineHeight: typeof f.lh === 'number' ? f.lh : num(f.lh), letterSpacing: lsPx(s.ls ?? f.ls), transform: s.tt ?? f.tt ?? 'none',
        };
        const rf = rawFamily(irS.ff ?? irFont.ff ?? (s.ff ?? f.ff)), raw = rf.raw;
        const key = JSON.stringify([value, raw]);
        if (!seenType.has(key)) {
          seenType.add(key);
          const tk = {};
          for (const [k, prop, own] of [['family', 'fontFamily', 'ff'], ['size', 'fontSize', 'fs'], ['weight', 'fontWeight', 'fw'],
            ['lineHeight', 'lineHeight', null], ['letterSpacing', 'letterSpacing', 'ls']]) {
            if (tok[prop] && !(own && s[own] !== undefined)) tk[k] = tok[prop];
          }
          add('type', 'text', { value, raw }, { tokens: Object.keys(tk).length ? tk : undefined, run: i, rawCandidates: rf.rawCandidates });
        }
        const c = s.c ?? f.c;
        if (c && !seenColor.has(c)) {
          seenColor.add(c);
          addColor('color', c, s.c === undefined ? tok.color : undefined, { run: i });
        }
      });
    }

    (sn.kids || []).forEach((k) => visit(k, false));
  };
  if (spec) visit(spec, true);
  return uses;
}

const cmpVal = (a, b) => cmpStr(JSON.stringify(a.value ?? null) + '|' + a.raw, JSON.stringify(b.value ?? null) + '|' + b.raw);
const cmpUse = (a, b) => cmpStr(String(a.screen), String(b.screen)) || cmpNodeId(a.node, b.node) || cmpStr(a.cat, b.cat) ||
  cmpStr(a.prop, b.prop) || (a.run ?? -1) - (b.run ?? -1) || cmpVal(a, b);

export function inventory(screens) {
  const list = [...(screens || [])].sort((a, b) => cmpStr(String(a.screen.id ?? a.screen.name), String(b.screen.id ?? b.screen.name)));
  const uses = list.flatMap(({ screen, spec }) => screenUses(screen, spec)).sort(cmpUse);
  const acc = {};
  for (const { screen } of list) {
    const sid = String(screen.id ?? screen.name);
    for (const name of Object.keys(screen.vars || {}).sort(cmpStr)) {
      const v = screen.vars[name];
      const e = acc[name] ||= { value: v.value, uses: 0, screens: [], per: {} };
      e.uses += v.uses || 0;
      e.screens.push(sid);
      e.per[sid] = v.value;
    }
  }
  const vars = {};
  for (const name of Object.keys(acc).sort(cmpStr)) {
    const { per, ...e } = acc[name];
    if (new Set(Object.values(per)).size > 1) e.values = per;
    vars[name] = e;
  }
  return { uses, vars };
}
