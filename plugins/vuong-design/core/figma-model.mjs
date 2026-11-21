// Figma's measured differences from Chrome (spec §7), applied to a spec before the flexbox proxy renders it.
//  - text box: w = ceil(chromeW - trailing letter-spacing), h = ceil(chromeH)
//  - FILL node with a border: Figma adds the stroke to the box, so the border becomes an absolute overlay
//    (paint.strokeOverlay = true; plan 3 draws it) and the size is unchanged
//  - several font sizes on one line: Figma keeps a fixed line height, Chrome grows it -> flag mixedRunHeight
//  - fonts Figma lacks are replaced (node.font.ff / run ff) so the proxy renders with the real font; reported.
//    Each family list is first resolved to the family Chrome actually rendered (opts.rendered = screen.fontsRendered,
//    falling back to the first family). A rendered family that Figma has is kept; otherwise it is substituted by
//    Inter with reason 'system' | 'not-in-figma' | 'not-loaded' (a Figma font that Chrome failed to load).
//  CONTRACT for the proxy (Task 5): a text node with `font.sub === true` was substituted, so its Chrome w/h are for
//  another font. Its HUG axes are NOT corrected here (w/h are left as Chrome measured); the proxy must let those axes
//  hug naturally in the substitute font, then round the result with figmaTextBox. Such nodes carry a
//  `fontSubstitution` flag. Nodes without font.sub keep the pinned, already-rounded HUG sizes.
import { firstFamily, isSystemFont, isAvailable } from './font-map.mjs';

const EPS = 0.001;

export function figmaTextBox(wChrome, hChrome, letterSpacingPx) {
  return { w: Math.ceil(wChrome - (letterSpacingPx || 0) - EPS), h: Math.ceil(hChrome - EPS) };
}

// The family Figma will use for a CSS family list, given the family Chrome rendered for it (renderedList, default the
// first family): { ff, sub?: { from, to, reason } }. Shared with capture's font override.
export function resolveFamily(fontMap, list, renderedList) {
  const first = firstFamily(list);
  const r = renderedList != null ? firstFamily(renderedList) : first;
  if (isAvailable(fontMap, r) && !isSystemFont(r)) return { ff: fontMap.substitute(r) };
  const to = fontMap.substitute(r);
  let from = r, reason = isSystemFont(r) ? 'system' : 'not-in-figma';
  if (isAvailable(fontMap, first) && r !== first) { from = first; reason = 'not-loaded'; }
  if (to === from) return { ff: to };
  return { ff: to, sub: { from, to, reason } };
}

export function applyFigmaModel(spec, fontMap, opts = {}) {
  const rendered = opts.rendered || {};
  const flags = [];
  const substitutions = [];
  const seen = new Set();
  const resolve = (list) => {
    const res = resolveFamily(fontMap, list, rendered[list]);
    if (!res.sub) return res;
    const sub = res.sub;
    const { from, reason } = sub;
    const key = `${from}|${reason}`;
    if (!seen.has(key)) { seen.add(key); substitutions.push(sub); }
    return res;
  };

  const visit = (n) => {
    const o = { ...n }; const subs = [];
    if (n.font) {
      o.font = { ...n.font };
      if (n.font.ff != null) { const r = resolve(n.font.ff); o.font.ff = r.ff; if (r.sub) subs.push(r.sub); }
    }
    if (n.runs) {
      o.runs = n.runs.map((r) => {
        if (!r.s || r.s.ff == null) return r;
        const x = resolve(r.s.ff); if (x.sub) subs.push(x.sub);
        return { ...r, s: { ...r.s, ff: x.ff } };
      });
    }
    if (n.t === 'T' && n.font) {
      if (subs.length) {
        o.font.sub = true;
        flags.push({ id: n.id, kind: 'fontSubstitution', detail: [...new Set(subs.map((x) => `${x.from} → ${x.to}`))].join(', ') });
      } else {
        const box = figmaTextBox(n.w, n.h, parseFloat(n.font.ls) || 0);
        if (n.sz && n.sz[0] === 'HUG') o.w = box.w;
        if (n.sz && n.sz[1] === 'HUG') o.h = box.h;
      }
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
