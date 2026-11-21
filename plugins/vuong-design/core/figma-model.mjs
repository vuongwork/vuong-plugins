// Figma's measured differences from Chrome (spec §7), applied to a spec before the flexbox proxy renders it.
//  - text box: w = ceil(chromeW - trailing letter-spacing), h = ceil(chromeH)
//  - FILL node with a border: Figma adds the stroke to the box, so the border becomes an absolute overlay
//    (paint.strokeOverlay = true; plan 3 draws it) and the size is unchanged
//  - several font sizes on one line: Figma keeps a fixed line height, Chrome grows it -> flag mixedRunHeight
//  - fonts Figma lacks are replaced (node.font.ff / run ff) so the proxy renders with the real font; reported
import { firstFamily } from './font-map.mjs';

const EPS = 0.001;

export function figmaTextBox(wChrome, hChrome, letterSpacingPx) {
  return { w: Math.ceil(wChrome - (letterSpacingPx || 0) - EPS), h: Math.ceil(hChrome - EPS) };
}

export function applyFigmaModel(spec, fontMap) {
  const flags = [];
  const substitutions = [];
  const seen = new Set();
  const subst = (list) => {
    const from = firstFamily(list);
    const to = fontMap.substitute(from);
    if (to !== from && !seen.has(from)) { seen.add(from); substitutions.push({ from, to }); }
    return to;
  };

  const visit = (n) => {
    const o = { ...n };
    if (n.font) {
      o.font = { ...n.font };
      if (n.font.ff != null) o.font.ff = subst(n.font.ff);
    }
    if (n.runs) {
      o.runs = n.runs.map((r) => (r.s && r.s.ff != null ? { ...r, s: { ...r.s, ff: subst(r.s.ff) } } : r));
    }
    if (n.t === 'T' && n.font) {
      const ls = parseFloat(n.font.ls) || 0;
      const box = figmaTextBox(n.w, n.h, ls);
      if (n.sz && n.sz[0] === 'HUG') o.w = box.w;
      if (n.sz && n.sz[1] === 'HUG') o.h = box.h;
      const sizes = new Set((n.runs || []).filter((r) => !r.br).map((r) => parseFloat((r.s && r.s.fs) ?? n.font.fs)));
      if (sizes.size > 1) flags.push({ id: n.id, kind: 'mixedRunHeight', detail: `font sizes ${[...sizes].join('/')}px in one line` });
    }
    if (n.sz && n.sz.includes('FILL') && n.paint && Array.isArray(n.paint.border) && n.paint.border.some((b) => b.w > 0)) {
      o.paint = { ...n.paint, strokeOverlay: true };
    }
    if (n.kids) o.kids = n.kids.map(visit);
    return o;
  };

  return { spec: visit(spec), flags, substitutions };
}
