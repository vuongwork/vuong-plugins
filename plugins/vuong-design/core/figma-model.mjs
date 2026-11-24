// Figma's measured differences from Chrome (spec §7), applied to a spec before the flexbox proxy renders it.
//  - text box: w = ceil(chromeW - trailing letter-spacing), h = ceil(chromeH)
//  - FILL node with a border: Figma adds the stroke to the box, so the border becomes an absolute overlay
//    (paint.strokeOverlay = true; plan 3 draws it) and the size is unchanged
//  - several font sizes on one line: Figma keeps a fixed line height, Chrome grows it -> flag mixedRunHeight
//  - max width (T8 items C / D): infer takes `max` from Chrome widths (shrinkFill: the unshrunk size flex.n; a single
//    FILL child that grows less: its width at B), and a text's Chrome natural width is up to 1 px narrower than its
//    Figma box (figmaTextBox), so Figma wrapped the last word. `max` is raised (never lowered) to the node's natural
//    width in Figma terms (figmaNaturalW): a text -> figmaTextBox(max).w; an H frame -> paddings + gaps + its HUG /
//    FIXED children at their modelled widths + its one FILL child at the rest (two or more FILL children, wrap or
//    space-between: unchanged); a V frame -> paddings + the widest child (FILL children at the inner width).
//    A text's natural width there is figmaTextBox + FIGMA_TEXT_SLACK (1 px): on real Figma (Planora t8, 259
//    single-line HUG texts, 2026-11-24) Figma's own width was figmaTextBox -2..+1 px (234 equal, 13 at +1), and a
//    text at a max of exactly figmaTextBox wrapped its last word at width B (s3, s8, s11: +1 line). The slack is a
//    model delta of about 1 px at B, under tolModel.
//  - fonts Figma lacks are replaced (node.font.ff / run ff) so the proxy renders with the real font; reported.
//    Each family list is first resolved to the family Chrome actually rendered (opts.rendered = screen.fontsRendered,
//    falling back to the first family). A rendered family that Figma has is kept; otherwise it is substituted by
//    Inter with reason 'system' | 'not-in-figma' | 'not-loaded' (a Figma font that Chrome failed to load).
//  The returned spec root carries `model: 'figma'`; buildProxyHtml marks the page with it and renderProxy applies
//  the Figma text rounding (figmaTextBox) only on such a page. An inferred spec without it renders unmodelled (R21).
//  CONTRACT for the proxy (Task 5): a text node with `font.sub === true` was substituted, so its Chrome w/h are for
//  another font. Its HUG axes are NOT corrected here (w/h are left as Chrome measured); the proxy must let those axes
//  hug naturally in the substitute font, then round the result with figmaTextBox. Such nodes carry a
//  `fontSubstitution` flag. Nodes without font.sub keep the pinned, already-rounded HUG sizes.
//  opts.facts (plan 3 Task 2) = the Figma facts measured on real Figma (figma-probe.mjs; default loadFacts()). Only the
//  facts on how Figma draws a given spec are applied here; the layout facts (shrinkFill, scaleBasis, zeroWidthAnchor,
//  scaleInHug) are applied by inferScreen, so both proxies render them.
//  - lineHeightFrac 'round' | 'floor': a fractional px line height (font.lh, run s.lh) is rounded that way; the text
//    gets font.remeasure (its box was measured at the old line height; the proxy re-measures, then pins) and a
//    `figmaLineHeight` flag. 'keep': unchanged.
//  - strokeOverlay 'off': a bordered FILL node gets no overlay; its border widths are taken off its size on each FILL
//    axis (left + right, top + bottom), flag `strokeOverlay`. 'ok': the overlay above.
import { firstFamily, isSystemFont, isAvailable } from './font-map.mjs';
import { loadFacts } from './figma-probe.mjs';

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

const r2 = (v) => Math.round(v * 100) / 100 + 0;
// Figma's text width can exceed figmaTextBox by 1 px (see the header); a max must leave room for it
export const FIGMA_TEXT_SLACK = 1;
// the Figma natural width of a node whose Chrome natural width is W (src: the node before the model, mod: after)
export function figmaNaturalW(src, mod, W) {
  if (src.t === 'T' && src.font) return figmaTextBox(W, 0, parseFloat(src.font.ls) || 0).w + FIGMA_TEXT_SLACK;
  const L = src.lay;
  if (!L || L.wrap || L.sb || !src.kids || !mod.kids) return W;
  const flow = src.kids.map((k, i) => [k, mod.kids[i]]).filter(([k]) => !k.abs);
  const pad = ((L.p && L.p[1]) || 0) + ((L.p && L.p[3]) || 0);
  const fill = ([k]) => !!(k.sz && k.sz[0] === 'FILL');
  if (L.d === 'H') {
    const el = flow.filter(fill);
    if (el.length > 1) return W;
    const gaps = (L.g || 0) * Math.max(0, flow.length - 1), rest = flow.filter((x) => !fill(x));
    const sum = (f) => rest.reduce((s, x) => s + f(x), 0);
    return pad + gaps + sum(([, m]) => m.w) + (el.length ? figmaNaturalW(el[0][0], el[0][1], W - pad - gaps - sum(([k]) => k.w)) : 0);
  }
  return pad + Math.max(0, ...flow.map((x) => (fill(x) ? figmaNaturalW(x[0], x[1], W - pad) : x[1].w)));
}

export function applyFigmaModel(spec, fontMap, opts = {}) {
  const rendered = opts.rendered || {};
  const facts = opts.facts || loadFacts();
  const lhMode = facts.lineHeightFrac === 'round' || facts.lineHeightFrac === 'floor' ? facts.lineHeightFrac : null;
  const roundLh = (v) => {
    const x = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+(\.\d+)?(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
    if (!Number.isFinite(x) || Math.abs(x - Math.round(x)) <= EPS) return null;
    const r = lhMode === 'round' ? Math.round(x) : Math.floor(x);
    return typeof v === 'number' ? r : `${r}px`;
  };
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
    if (n.t === 'T' && n.font && lhMode) {
      let changed = false;
      const lh = roundLh(n.font.lh);
      if (lh != null) { o.font.lh = lh; changed = true; }
      if (o.runs) {
        o.runs = o.runs.map((r) => {
          const v = r.s ? roundLh(r.s.lh) : null;
          if (v == null) return r;
          changed = true;
          return { ...r, s: { ...r.s, lh: v } };
        });
      }
      if (changed) { o.font.remeasure = true; flags.push({ id: n.id, kind: 'figmaLineHeight', detail: `fractional line height ${lhMode}ed` }); }
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
      if (facts.strokeOverlay === 'off') {
        const bw = (i) => (n.paint.border[i] && n.paint.border[i].w) || 0; // [t, r, b, l]
        if (n.sz[0] === 'FILL') o.w = n.w - bw(1) - bw(3);
        if (n.sz[1] === 'FILL') o.h = n.h - bw(0) - bw(2);
        flags.push({ id: n.id, kind: 'strokeOverlay', detail: 'stroke in layout: border taken off the FILL size' });
      } else o.paint = { ...n.paint, strokeOverlay: true };
    }
    if (n.kids) o.kids = n.kids.map(visit);
    if (typeof n.max === 'number') o.max = r2(Math.max(n.max, figmaNaturalW(n, o, n.max)));
    return o;
  };

  return { spec: { ...visit(spec), model: 'figma' }, flags, substitutions };
}
