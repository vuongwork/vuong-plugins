// Inventory (plan 2, Task 2): every design value a screen uses, read from the modelled spec (infer + figma-model)
// with the capture IR for what the spec does not carry (tag/class, source font list, CSS-variable use). Pure and
// deterministic: no browser, no clock; the output does not depend on the order of screens or of kids.
//
// inventory(screens: [{ screen: IR screen, spec: modelled SNode root }]) -> { uses: Use[], vars }
//
// Use = { screen, node, cat, prop, value, raw, role, token?, tokens?, flex?, unparsed?, run? }
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
//    IR font-family list (with capture's fontOverride on, that list is already the overridden one; the original
//    families are in screen.fontSubs).
//  - flex: 'sb' for a space-between primary axis (Figma auto spacing): prop gap, no value.
//  - token: the CSS variable name from the IR node's tok[prop] (capture, Task 1), or undefined when the node has
//    none (no tok, synthetic frame, a run with its own colour from a nested element). For type the tokens are per
//    key in `tokens` ({ family, size, weight, lineHeight, letterSpacing }), only for keys the run does not override.
//    Space tokens come from the CSS padding/gap declaration; the spec value is geometric and is not compared here.
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
//    artboard width is a device size), synthetic frames (their size is inferred, not authored), min/max.
//  - abs offsets (positions), background images and gradients, outline, text decoration: not tokenised in plan 2.
//  - paints inside icon markup (icon.svg) and the svg root's `color` (only reaches shapes through currentColor in
//    the markup): only the root fill / stroke the proxy and Figma set are listed; 'none' is skipped.
//  - duplicate run styles / colours inside one text node are listed once (a colour-only span does not add a type).
//
// Output order: uses sorted by screen, node id in tree order (DOM path; ::before and the sole text child first, then
// synthetic groups, then children by index, ::after last), cat, prop, run, then value. vars = the screens' vars merged
// by name, keys sorted: { value (first screen by id), uses (sum), screens, values? ({screen: value}, only when the
// value differs between screens) }.
import { parseColor, toHex } from './color.mjs';

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
      for (const [k, x] of Object.entries(extra)) if (x !== undefined) u[k] = x;
      uses.push(u);
    };
    const addColor = (prop, raw, token, extra = {}) => add('color', prop, { ...colorValue(raw), raw }, { token, ...extra });
    const addLen = (cat, prop, v, token) => { if (typeof v === 'number' && v !== 0) add(cat, prop, { value: v, raw: pxRaw(v) }, { token }); };

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
      add('radius', 'radius' + CORNER[i], ok ? { value: num(r), raw: r } : { value: null, raw: r }, { token: tok.radius, unparsed: ok ? undefined : true });
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
      if (sn.sz[0] === 'FIXED') addLen('size', 'width', sn.w, tok.width);
      if (sn.sz[1] === 'FIXED') addLen('size', 'height', sn.h, tok.height);
    }

    // ---- icons ----
    if (sn.t === 'V') {
      addLen('icon', 'width', sn.w, tok.width);
      addLen('icon', 'height', sn.h, tok.height);
      const ic = sn.icon || {};
      if (ic.svg !== undefined || ic.ref !== undefined || ic.fill !== undefined || ic.stroke !== undefined) {
        if (ic.fill && ic.fill !== 'none') addColor('fill', ic.fill, tok.fill);
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
        const raw = irS.ff ?? irFont.ff ?? (s.ff ?? f.ff);
        const key = JSON.stringify([value, raw]);
        if (!seenType.has(key)) {
          seenType.add(key);
          const tk = {};
          for (const [k, prop, own] of [['family', 'fontFamily', 'ff'], ['size', 'fontSize', 'fs'], ['weight', 'fontWeight', 'fw'],
            ['lineHeight', 'lineHeight', null], ['letterSpacing', 'letterSpacing', 'ls']]) {
            if (tok[prop] && !(own && s[own] !== undefined)) tk[k] = tok[prop];
          }
          add('type', 'text', { value, raw }, { tokens: Object.keys(tk).length ? tk : undefined, run: i });
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
