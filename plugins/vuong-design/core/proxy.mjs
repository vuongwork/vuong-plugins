// Proxy: rebuild an inferred spec (after applyFigmaModel) as plain flexbox that behaves like Figma auto layout, render
// it in Chromium at one width and return per-node boxes plus a PNG. Task 6 compares those boxes with the source HTML,
// so every rule here mirrors what the Figma builder (spike 3 runtime.js) does with the same SNode:
//  - every node: box-sizing:border-box, margin 0, min-width/min-height 0 (n.min / n.max are Figma minWidth/maxWidth)
//  - frame with lay = flex container; padding = lay.p; gap = lay.g on the primary axis, lay.cg between wrapped rows;
//    spaceBetween = justify-content:space-between and the gap is ignored; ca S/C/E/B = align-items start/center/end/baseline
//  - child sizing on the primary axis: FILL = flex:1 1 0px (+ min 0), HUG = flex:none + content size, FIXED = flex:none + px;
//    on the counter axis: FILL = align-self:stretch (a width FILL with max in a ca C/E column: width 100% capped by
//    max, placed by the container's alignment), HUG = content size, FIXED = px. HUG on something that cannot hug in
//    Figma (leaf frame, icon, image) is FIXED, as in the builder.
//  - absolute children (n.abs, or any child of a frame without auto layout) are placed from x/y by their constraints:
//    c L/R/LR/C/SCALE horizontally, cy T(default)/B/TB/C/SCALE vertically, against the parent's spec size. SCALE (R47)
//    = left/width (top/height) in % of that size; a zero-size 'anchor' wrapper (infer) is just a frame like any other.
//  - strokes never take space (strokesIncludedInLayout = false): solid borders are inset box-shadows, other styles an
//    absolutely positioned ::before overlay. paint.strokeOverlay (bordered FILL cells) is drawn the same way.
//  - text: width HUG = nowrap, FIXED/FILL = wraps. HUG sizes already pinned by applyFigmaModel are used as px, except
//    (a) text with font.sub (its Chrome size was measured in another font) or font.remeasure (apply-norm changed its
//    font size / line height, so its spec box is stale) and (b) the HUG height of wrapping text (it
//    depends on the width, so a pin taken at width A is wrong at B): those hug naturally in the proxy. On a modelled
//    page (spec root `model: 'figma'`, set by applyFigmaModel) they are then pinned to figmaTextBox(natural size)
//    before boxes are read (re-measure-then-pin). R21/R26: an unmodelled spec (inferScreen's, verify's layout proxy)
//    applies no Figma model at all: no figmaTextBox and no HUG text pinned to its spec w/h; every HUG text axis keeps
//    Chrome's natural size, so a text styled differently from the source shows as a layout deviation. This is decided
//    by the spec, not by a caller option, so the layout proxy cannot be rendered modelled by mistake; renderProxy
//    returns the page's mark as `model` ('figma' | 'none', R27) and verifyScreen checks it.
//  - fonts: every family goes through fontMap.substitute(firstFamily(ff)), i.e. the font Figma will really use.
// Boxes are [x, y, w, h] relative to the root's top-left, rounded to 0.01, measured with transforms off — the same
// convention as capture's rA/rB. The PNG keeps transforms. `dom` is what the page rendered per node id: { text? (leaf
// text, <br> as a space), icon? (<use> ref or 'svg'), color, bg, ff, op (effective opacity, product up to the page),
// vis, disp, stroke ([t, r, b, l] 'Wpx style colour' | 'none', read back from how the page drew it), outline,
// shadow (box-shadow layers other than the stroke's, or 'none'), bgImage (computed background-image), R50: radius
// ([tl, tr, br, bl] computed), runs? (text leaf: [[text, font-size, font-weight, font-style, text-decoration-line,
// text-transform, font-family]] per text node), svg? (inline svg: { markup = outerHTML without the root style, own = the root's
// declarations other than the proxy's box / paint keys, paint = computed root [color, fill, stroke, stroke-width] }),
// img? (image node: { fit, pos, src } of its <img>, null when none was drawn) } — computed values, for verify's
// content checks. Images also carry object-position (R50); corner radii are set per corner (a computed corner can be
// elliptical, which the border-radius shorthand would misread).
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { figmaTextBox } from './figma-model.mjs';
import { firstFamily } from './font-map.mjs';

const DSF = 2;
const AL = { S: 'flex-start', C: 'center', E: 'flex-end', B: 'baseline' };
const ICON_FONT = /^Material (Symbols|Icons)/i;
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const px = (v) => `${r2(v)}px`;
const pct = (v) => `${Math.round(v * 1e8) / 1e6}%`;

const canHug = (n) => n.t === 'T' || (n.t === 'F' && !!(n.lay && n.lay.d));
const sizing = (n, ax) => { const s = (n.sz && n.sz[ax]) || 'FIXED'; return s === 'HUG' && !canHug(n) ? 'FIXED' : s; };

const TEXT_ALIGN = (ta) => (/center/.test(ta || '') ? 'center' : /right|end/.test(ta || '') ? 'right' : /justify/.test(ta || '') ? 'justify' : 'left');
const weight = (fw) => Math.min(900, Math.max(100, Math.round((parseFloat(fw) || 400) / 100) * 100));

export function buildProxyHtml(spec, svgDefs = {}, fontMap, opts = {}) {
  const { fontLinks = [], fontFaces = [], webFonts = true } = opts;
  const modelled = spec.model === 'figma';
  const family = (ff) => fontMap.substitute(firstFamily(ff));
  const used = new Map(); // family -> Set('ital,wght')
  const use = (fam, fw, fst) => {
    if (!used.has(fam)) used.set(fam, new Set());
    used.get(fam).add(`${/italic|oblique/.test(fst || '') ? 1 : 0},${weight(fw)}`);
  };
  const rules = [];

  const fontCss = (f) => {
    const fam = family(f.ff); use(fam, f.fw, f.fst);
    const st = [`font-family:"${fam}"`, `font-size:${f.fs}`, `font-weight:${f.fw}`, `font-style:${f.fst || 'normal'}`,
      `line-height:${f.lh != null && f.lh !== '' ? px(Number(f.lh)) : 'normal'}`, `letter-spacing:${f.ls || 'normal'}`, `color:${f.c}`];
    if (f.td && f.td !== 'none') st.push(`text-decoration-line:${f.td}`);
    if (f.tt && f.tt !== 'none') st.push(`text-transform:${f.tt}`);
    return st;
  };
  const RUN = { c: 'color', fs: 'font-size', fw: 'font-weight', fst: 'font-style', ls: 'letter-spacing', td: 'text-decoration-line', tt: 'text-transform' };
  const runHtml = (base, r) => {
    if (r.br) return '<br>';
    if (!r.s) return esc(r.t);
    const st = [];
    for (const [k, v] of Object.entries(r.s)) {
      if (k === 'ff') st.push(`font-family:"${family(v)}"`);
      else if (RUN[k]) st.push(`${RUN[k]}:${v}`);
    }
    use(family(r.s.ff ?? base.ff), r.s.fw ?? base.fw, r.s.fst ?? base.fst);
    return `<span style="${attr(st.join(';'))}">${esc(r.t)}</span>`;
  };

  // strokes: never in layout. Solid sides -> inset box-shadows, anything else -> ::before overlay with a real border.
  // The page records how it drew them (data-ss: sides drawn as the last inset shadows, in t r b l order; data-sb: a
  // ::before overlay) so renderProxy can read the rendered stroke back for verify (R30).
  const strokeCss = (p, st, cls, data) => {
    const b = p.border;
    const shadows = p.shadow ? [p.shadow] : [];
    if (Array.isArray(b) && b.some((s) => s && s.w > 0)) {
      const sides = b.map((s) => (s && s.w > 0 && s.style !== 'none' && s.style !== 'hidden' ? s : null));
      if (sides.every((s) => !s || s.style === 'solid')) {
        const [t, r, bt, l] = sides;
        // the same stroke on all four sides: one spread shadow, whose inner edge follows the radius as a border's does
        // (four one-side shadows draw crescents on a rounded box: a ring differed from the source in 6-8 % of its pixels)
        if (sides.every((x) => x && x.w === t.w && x.color === t.color)) {
          shadows.push(`inset 0 0 0 ${px(t.w)} ${t.color}`);
          data.push('data-ss="a"');
        } else {
          if (t) shadows.push(`inset 0 ${px(t.w)} 0 0 ${t.color}`);
          if (r) shadows.push(`inset ${px(-r.w)} 0 0 0 ${r.color}`);
          if (bt) shadows.push(`inset 0 ${px(-bt.w)} 0 0 ${bt.color}`);
          if (l) shadows.push(`inset ${px(l.w)} 0 0 0 ${l.color}`);
          data.push(`data-ss="${['t', 'r', 'b', 'l'].filter((x, i) => sides[i]).join('')}"`);
        }
      } else {
        const k = `s${rules.length}`; cls.push(k); data.push('data-sb');
        st.push('isolation:isolate');
        rules.push(`.${k}::before{content:"";position:absolute;inset:0;pointer-events:none;box-sizing:border-box;border-radius:inherit;z-index:-1;` +
          `border-width:${sides.map((s) => (s ? px(s.w) : '0')).join(' ')};border-style:${sides.map((s) => (s ? s.style : 'none')).join(' ')};` +
          `border-color:${sides.map((s) => (s ? s.color : 'transparent')).join(' ')}}`);
      }
    }
    if (shadows.length) st.push(`box-shadow:${shadows.join(', ')}`);
  };

  const node = (n, parent) => {
    const st = ['box-sizing:border-box', 'margin:0', `min-width:${px(n.min || 0)}`, 'min-height:0'];
    if (n.max) st.push(`max-width:${px(n.max)}`);
    const data = [`data-id="${attr(n.id)}"`];
    const isText = n.t === 'T';
    // font.remeasure (apply-norm): font size / line height changed after measuring, so the spec box is stale too
    const sub = isText && n.font && (n.font.sub || n.font.remeasure);
    const [sx, sy] = [sizing(n, 0), sizing(n, 1)];
    const textWrap = isText && sx !== 'HUG';
    // size of one axis that is not decided by the parent (HUG or FIXED); FILL is handled by the caller
    const ownSize = (ax) => {
      const dim = ax === 0 ? 'width' : 'height', s = ax === 0 ? sx : sy, v = ax === 0 ? n.w : n.h;
      if (s === 'FIXED') return [`${dim}:${px(v)}`];
      if (s !== 'HUG') return [];
      if (isText) {
        // R26: only a modelled page pins HUG text; an unmodelled one keeps Chrome's natural size, so a text whose spec
        // style differs from the source shows as a layout deviation instead of being forced into the source box
        const pinned = modelled && !sub && (ax === 0 || !textWrap);
        if (pinned) return [`${dim}:${px(v)}`];
        if (modelled) data.push(ax === 0 ? 'data-pin-w' : 'data-pin-h');
        return [`${dim}:${ax === 0 ? 'max-content' : 'auto'}`];
      }
      return [`${dim}:${ax === 0 ? 'max-content' : 'auto'}`];
    };

    if (!parent) {
      data.push('data-root');
      if (n.model === 'figma') data.push('data-model="figma"');
      st.push('position:relative', `width:var(--W, ${px(n.w)})`, ...(sy === 'HUG' ? ownSize(1) : [`height:${px(n.h)}`]));
    } else if (n.abs || !(parent.lay && parent.lay.d)) {
      const a = n.abs || { x: 0, y: 0, c: 'L' };
      st.push('position:absolute');
      const axis = (con, off, size, P, L, R, ax) => {
        const end = px(P - off - size);
        if (con === 'LR' || con === 'TB') return [`${L}:${px(off)}`, `${R}:${end}`];
        // R47 SCALE: inset and size keep their share of the parent's spec size. CSS % is relative to the padding box;
        // proxy frames draw strokes as shadows (no border), so that box is the frame's box, as in Figma.
        if (con === 'SCALE' && P > 0) return [`${L}:${pct(off / P)}`, `${ax ? 'height' : 'width'}:${pct(size / P)}`];
        const sz = ownSize(ax);
        if (con === 'R' || con === 'B') return [`${R}:${end}`, ...sz];
        if (con === 'C') return [`${L}:calc(50% + ${px(off - P / 2)})`, ...sz];
        return [`${L}:${px(off)}`, ...sz];
      };
      st.push(...axis(a.c || 'L', a.x, n.w, parent.w, 'left', 'right', 0), ...axis(a.cy || 'T', a.y, n.h, parent.h, 'top', 'bottom', 1));
    } else {
      st.push('position:relative');
      const P = parent.lay.d === 'H' ? 0 : 1, C = 1 - P;
      const prim = P === 0 ? sx : sy, cnt = C === 0 ? sx : sy;
      if (prim === 'FILL') st.push('flex:1 1 0px'); else st.push('flex:none', ...ownSize(P));
      // a counter-axis FILL capped by maxWidth (infer textCap) fills up to the cap and is then placed by the
      // container's counter alignment, as Figma does; CSS stretch would pin it to the start
      if (cnt === 'FILL' && C === 0 && n.max && /^[CE]$/.test(parent.lay.ca || '')) st.push(`align-self:${parent.lay.ca === 'C' ? 'center' : 'flex-end'}`, 'width:100%');
      else if (cnt === 'FILL') st.push('align-self:stretch'); else st.push(...ownSize(C));
    }

    const p = n.paint || {};
    const cls = [];
    if (!isText) {
      if (p.bg) st.push(`background-color:${p.bg}`);
      if (p.bgImage) st.push(`background-image:${p.bgImage}`, 'background-size:cover', 'background-position:center');
      // per corner: a computed corner can be elliptical ('10px 20px'), which the border-radius shorthand would misread
      if (p.radius) ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((c, i) => st.push(`border-${c}-radius:${p.radius[i]}`));
      strokeCss(p, st, cls, data);
      if (p.clip) st.push('overflow:hidden');
      if (p.filter) st.push(`filter:${p.filter}`);
      if (p.clipPath) st.push(`clip-path:${p.clipPath}`);
      if (p.outline) st.push(`outline:${p.outline}`);
    }
    if (p.opacity != null) st.push(`opacity:${p.opacity}`);
    if (p.transform) st.push(`transform:${p.transform.value || p.transform}`, ...(p.transform.origin ? [`transform-origin:${p.transform.origin}`] : []));

    let inner = '';
    if (n.t === 'F' && n.lay && n.lay.d) {
      const l = n.lay, row = l.d === 'H';
      st.push('display:flex', `flex-direction:${row ? 'row' : 'column'}`, `padding:${(l.p || [0, 0, 0, 0]).map(px).join(' ')}`);
      const g = l.sb ? 0 : Math.max(0, l.g || 0);
      if (l.wrap) st.push('flex-wrap:wrap', 'align-content:flex-start', `${row ? 'row-gap' : 'column-gap'}:${px(Math.max(0, l.cg || 0))}`);
      st.push(`${row ? 'column-gap' : 'row-gap'}:${px(g)}`);
      st.push(`justify-content:${l.sb ? 'space-between' : AL[l.pa] || 'flex-start'}`, `align-items:${AL[l.ca] || 'flex-start'}`);
    } else if (n.t === 'F') st.push('display:block');

    if (isText) {
      const f = n.font || {};
      st.push(...fontCss(f), `text-align:${TEXT_ALIGN(f.ta)}`, 'overflow-wrap:normal');
      const pre = /pre/.test(f.ws || '');
      st.push(`white-space:${textWrap ? (pre ? (f.ws === 'pre' ? 'pre-wrap' : f.ws) : 'normal') : (pre ? 'pre' : 'nowrap')}`);
      if (sub) data.push(`data-ls="${parseFloat(f.ls) || 0}"`);
      inner = (n.runs || []).map((r) => runHtml(f, r)).join('');
    } else if (n.t === 'V') {
      const ic = n.icon || {};
      if (ic.glyph != null) {
        if (n.font) st.push(...fontCss(n.font));
        st.push('display:flex', 'align-items:center', 'justify-content:center', 'white-space:nowrap', 'overflow:visible');
        if (ic.color) st.push(`color:${ic.color}`);
        inner = esc(ic.glyph);
      } else {
        const sv = ['display:block', 'width:100%', 'height:100%', 'overflow:visible'];
        if (ic.color) sv.push(`color:${ic.color}`);
        if (ic.fill) sv.push(`fill:${ic.fill}`);
        if (ic.stroke) sv.push(`stroke:${ic.stroke}`);
        if (ic.sw) sv.push(`stroke-width:${ic.sw}`);
        const style = `style="${attr(sv.join(';'))}"`;
        if (ic.svg) {
          data.push('data-svg');
          // R48: capture leaves only inlined paint (page CSS on the root) in the root's style: it goes after ours
          let own = '';
          const m = String(ic.svg).replace(/^(<svg\b[^>]*?)\sstyle="([^"]*)"/, (_, a, v) => { own = v; return a; });
          inner = m.replace(/^<svg\b/, `<svg style="${attr(sv.join(';'))}${own ? `;${own}` : ''}"`);
        }
        else if (ic.ref) inner = `<svg ${style}><use href="#${attr(ic.ref)}"></use></svg>`;
      }
    } else if (n.t === 'I') {
      data.push('data-img');
      if (n.src) inner = `<img alt="" src="${attr(n.src)}" style="display:block;width:100%;height:100%;object-fit:${attr(n.fit || 'fill')};object-position:${attr(n.pos || '50% 50%')}">`;
    }
    if (n.kids) inner += n.kids.map((k) => node(k, n)).join('');
    if (cls.length) data.push(`class="${cls.join(' ')}"`);
    return `<div ${data.join(' ')} style="${attr(st.join(';'))}">${inner}</div>`;
  };

  const body = node(spec, null);

  // web fonts: the source's font links and @font-face rules, plus (webFonts) a Google Fonts link for each family
  // the proxy uses that those do not cover (e.g. Inter standing in for a system font)
  const covered = new Set();
  for (const href of fontLinks) {
    for (const m of String(href).matchAll(/[?&]family=([^&:]+)/g)) covered.add(decodeURIComponent(m[1].replace(/\+/g, ' ')).toLowerCase());
  }
  for (const face of fontFaces) { const m = /font-family:\s*["']?([^;"']+)/.exec(face); if (m) covered.add(m[1].trim().toLowerCase()); }
  const links = [...fontLinks];
  if (webFonts) {
    for (const [fam, set] of used) {
      if (covered.has(fam.toLowerCase()) || ICON_FONT.test(fam)) continue;
      const tuples = [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(';');
      links.push(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:ital,wght@${tuples}&display=swap`);
    }
  }
  const defs = Object.values(svgDefs).join('');
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta name="vd-fonts" content="${attr([...used.keys()].join('|'))}">` +
    // R55: every face used, 'family|italic|weight', ';'-separated
    `<meta name="vd-faces" content="${attr([...used].flatMap(([f, set]) => [...set].map((t) => `${f}|${t.replace(',', '|')}`)).join(';'))}">` +
    links.map((h) => `<link rel="stylesheet" href="${attr(h)}">`).join('') +
    `<style>html,body{margin:0;padding:0;background:#fff}${fontFaces.join('\n')}\n${rules.join('\n')}</style></head><body>` +
    (defs ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>` : '') +
    body + '</body></html>';
}

// ---------------- rendering ----------------

const NO_TRANSFORM = '[data-id]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';

// R58: an installed family answers document.fonts.check and the width probe for any style, and Chrome synthesises a
// missing bold / italic face. Each bold (>= 600) or italic face used is drawn with font-synthesis: none next to the
// same text without that trait (italic: upright at the same weight; bold: weight 400 in the same style). A real face
// changes the advance widths, or else (Arial italic, monospace bold / italic keep the regular widths) the pixels;
// identical width and pixels mean Chrome fell back to the face without the trait: the face is missing. Runs after the
// page screenshot, on a probe box that is removed again.
async function synthesisedFaces(page, installed) {
  if (!installed || !installed.length) return [];
  const tests = await page.evaluate((list) => {
    const box = document.createElement('div');
    box.id = '__vd_fp';
    box.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;background:#fff;padding:4px;white-space:nowrap';
    document.body.appendChild(box);
    const out = [];
    let k = 0;
    const mk = (fam, st, wt) => {
      const s = document.createElement('div');
      s.id = `__vd_fp${k++}`;
      s.style.cssText = `display:block;width:max-content;font-family:"${fam.replace(/["\\]/g, '\\$&')}",monospace;font-size:40px;line-height:56px;` +
        `font-style:${st};font-weight:${wt};font-synthesis:none;font-kerning:none;color:#000;background:#fff`;
      s.textContent = 'HamburgefonstivQ 0123';
      box.appendChild(s);
      return [s.id, s.getBoundingClientRect().width];
    };
    for (const [key, fam, ital, wt] of list) {
      const req = mk(fam, ital ? 'italic' : 'normal', wt);
      const without = [];
      if (ital) without.push(mk(fam, 'normal', wt));
      if (wt >= 600) without.push(mk(fam, ital ? 'italic' : 'normal', 400));
      out.push([key, req, without]);
    }
    return out;
  }, installed);
  const shot = (id) => page.locator(`#${id}`).screenshot({ animations: 'disabled' });
  const missing = [];
  try {
    for (const [key, [rid, rw], without] of tests) {
      for (const [id, w] of without) {
        if (Math.abs(rw - w) > 0.01) continue;
        if (Buffer.compare(await shot(rid), await shot(id)) === 0) { missing.push(key); break; }
      }
    }
  } finally {
    await page.evaluate(() => document.getElementById('__vd_fp').remove());
  }
  return missing;
}

// opts.origin = [fx, fy] (screen.origin[i] from capture): the root is placed at that fractional page offset, as in
// the source screenshot. Glyphs snap to the pixel grid in page coordinates, so without it text lands up to ~1.5px
// off in the PNG. Boxes stay relative to the root and are unaffected.
export async function renderProxy(browser, html, width, opts = {}) {
  const origin = opts.origin || [0, 0];
  // M7: the temp dir is made only once the page exists, and removed in the same finally
  const page = await browser.newPage({ viewport: { width: Math.ceil(width) + 40, height: 1000 }, deviceScaleFactor: DSF });
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'vd-proxy-'));
    const file = join(dir, 'proxy.html');
    writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(async ([w, css, o]) => {
      document.querySelector('[data-root]').style.setProperty('--W', `${w}px`);
      document.body.style.setProperty('padding', `${o[1]}px 0 0 ${o[0]}px`, 'important');
      const s = document.createElement('style'); s.id = '__vd_nt'; s.textContent = css; document.head.appendChild(s);
      await document.fonts.ready;
    }, [width, NO_TRANSFORM, origin]);
    // re-measure-then-pin: HUG widths first (they feed FILL siblings), then HUG heights of wrapping/substituted text
    const natural = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => {
      const b = el.getBoundingClientRect(); return [el.dataset.id, b.width, b.height, Number(el.dataset.ls || 0)];
    }), sel);
    const pin = (dim, vals) => page.evaluate(([d, v]) => {
      for (const [id, x] of v) document.querySelector(`[data-id="${CSS.escape(id)}"]`).style.setProperty(d, `${x}px`);
    }, [dim, vals]);
    // R21: Figma's text rounding only on a modelled page; an unmodelled one keeps Chrome's natural sizes
    const model = (await page.evaluate(() => document.querySelector('[data-root]').dataset.model === 'figma')) ? 'figma' : 'none';
    if (model === 'figma') {
      await pin('width', (await natural('[data-pin-w]')).map(([id, w, h, ls]) => [id, figmaTextBox(w, h, ls).w]));
      await pin('height', (await natural('[data-pin-h]')).map(([id, w, h]) => [id, figmaTextBox(w, h, 0).h]));
    }
    const res = await page.evaluate(() => {
      const PROXY_SVG_KEYS = ['display', 'width', 'height', 'overflow', 'overflow-x', 'overflow-y', 'color', 'fill', 'stroke', 'stroke-width']; // R50: set by buildProxyHtml
      const root = document.querySelector('[data-root]'); const R = root.getBoundingClientRect();
      const r = (v) => Math.round(v * 100) / 100;
      const boxes = {};
      for (const el of document.querySelectorAll('[data-id]')) {
        const b = el.getBoundingClientRect();
        boxes[el.dataset.id] = [r(b.left - R.left), r(b.top - R.top), r(b.width), r(b.height)];
      }
      // families that did not render (offline, unknown to Google Fonts, ...): a web font counts when one of its faces
      // loaded (unused subsets/weights stay unloaded); a family without @font-face must be installed (width probe)
      const ctx = document.createElement('canvas').getContext('2d');
      const probe = (fam, fb) => { ctx.font = `72px "${fam}", ${fb}`; const a = ctx.measureText('mmmmmmmmmmlli1WÀỆ').width; ctx.font = `72px ${fb}`; return a !== ctx.measureText('mmmmmmmmmmlli1WÀỆ').width; };
      const fams = (document.querySelector('meta[name="vd-fonts"]').content || '').split('|').filter(Boolean);
      const faces = [...document.fonts];
      const fontsMissing = fams.filter((f) => {
        const own = faces.filter((x) => x.family.replace(/^["']|["']$/g, '') === f);
        return own.length ? !own.some((x) => x.status === 'loaded') : !(probe(f, 'monospace') || probe(f, 'serif'));
      });
      // R55: per face (family, style, weight): a web font needs a loaded face whose weight range and style cover the use
      // (else Chrome synthesises bold / italic or falls back); an installed family needs check + width probe in that
      // style. Families missing altogether are already in fontsMissing.
      const covers = (f, ital, w) => {
        const [lo, hi = lo] = String(f.weight).split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
        return w >= lo && w <= hi && (ital ? /italic|oblique/.test(f.style) : !/italic|oblique/.test(f.style));
      };
      const probeSt = (st, fam, fb) => { ctx.font = `${st} 72px "${fam}", ${fb}`; const a = ctx.measureText('mmmmmmmmmmlli1WÀỆ').width; ctx.font = `${st} 72px ${fb}`; return a !== ctx.measureText('mmmmmmmmmmlli1WÀỆ').width; };
      const installed = []; // R58: installed-family bold / italic faces to test for synthesis after the screenshot
      const facesMissing = (document.querySelector('meta[name="vd-faces"]').content || '').split(';').filter(Boolean).filter((key) => {
        const [fam, i, w] = key.split('|'), ital = i === '1', wt = Number(w);
        if (fontsMissing.includes(fam)) return false;
        const own = faces.filter((x) => x.family.replace(/^["']|["']$/g, '') === fam);
        if (own.length) return !own.some((x) => x.status === 'loaded' && covers(x, ital, wt));
        const st = `${ital ? 'italic ' : ''}${wt}`;
        const miss = !(document.fonts.check(`${st} 16px "${fam}"`) && (probeSt(st, fam, 'monospace') || probeSt(st, fam, 'serif')));
        if (!miss && (ital || wt >= 600)) installed.push([key, fam, ital, wt]);
        return miss;
      });
      // what the page really rendered, per node (verify layer 3): text of leaves (runs, <br> = space), icon reference,
      // computed colour / background colour / first font family
      const dom = {};
      for (const el of document.querySelectorAll('[data-id]')) {
        const cs = getComputedStyle(el); const o = { color: cs.color, bg: cs.backgroundColor, ff: cs.fontFamily };
        // an inline svg (data-svg; R54: it may contain a <use> itself) or a sprite <use>
        const use = el.dataset.svg == null && el.querySelector(':scope > svg use');
        if (use) o.icon = (use.getAttribute('href') || '').replace(/^#/, '');
        else if (el.querySelector(':scope > svg')) o.icon = 'svg';
        if (!el.querySelector('[data-id]') && !el.querySelector(':scope > svg')) {
          let t = '';
          const rec = (x) => { for (const c of x.childNodes) { if (c.nodeType === 3) t += c.textContent; else if (c.tagName === 'BR') t += ' '; else if (c.nodeType === 1) rec(c); } };
          rec(el); if (t) o.text = t;
        }
        // R31: effective opacity (product up to the page), visibility, display
        let op = 1; for (let x = el; x && x !== document.body; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
        o.op = Math.round(op * 1000) / 1000; o.vis = cs.visibility; o.disp = cs.display;
        // R30: the stroke as rendered, per side t r b l: the last inset shadows (data-ss) or the ::before border
        // (data-sb); 'Wpx style colour' or 'none'
        const stroke = ['none', 'none', 'none', 'none'];
        if (el.dataset.ss != null) {
          const layers = cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((x) => x.trim());
          // 'a': one spread shadow draws all four sides
          const all = el.dataset.ss === 'a', sides = all ? ['t', 'r', 'b', 'l'] : [...el.dataset.ss];
          const mine = all ? sides.map(() => layers[layers.length - 1]) : layers.slice(layers.length - sides.length);
          sides.forEach((sd, k) => {
            const L = mine[k] || '', color = (/rgba?\([^)]*\)/.exec(L) || ['transparent'])[0];
            const nums = (L.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
            stroke['trbl'.indexOf(sd)] = `${Math.abs(all ? nums[3] || 0 : sd === 't' || sd === 'b' ? nums[1] || 0 : nums[0] || 0)}px solid ${color}`;
          });
        } else if (el.dataset.sb != null) {
          const b = getComputedStyle(el, '::before');
          ['Top', 'Right', 'Bottom', 'Left'].forEach((S, i) => { stroke[i] = `${parseFloat(b[`border${S}Width`]) || 0}px ${b[`border${S}Style`]} ${b[`border${S}Color`]}`; });
        }
        o.stroke = stroke;
        // R46 effect data: the box-shadow layers that are not the stroke (data-ss inset layers come last) and the
        // background image, as computed
        {
          const layers = cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((x) => x.trim());
          const own = el.dataset.ss != null ? layers.slice(0, layers.length - (el.dataset.ss === 'a' ? 1 : el.dataset.ss.length)) : layers;
          o.shadow = own.length ? own.join(', ') : 'none';
          o.bgImage = cs.backgroundImage;
        }
        o.outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : 'none';
        // R50: corner radii; per-run font styles of a text leaf; an inline svg as serialised (root style without the
        // proxy's own box / paint keys, which are compared as computed root paint); an image's fit, position, source
        o.radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
        const svg = el.querySelector(':scope > svg');
        if (!el.querySelector('[data-id]') && !svg) {
          const runs = [];
          const rec = (x) => {
            for (const c of x.childNodes) {
              if (c.nodeType === 3) { const s = getComputedStyle(c.parentElement); runs.push([c.textContent, s.fontSize, s.fontWeight, s.fontStyle, s.textDecorationLine, s.textTransform, s.fontFamily, s.color]); }
              else if (c.nodeType === 1 && c.tagName !== 'BR') rec(c);
            }
          };
          rec(el); o.runs = runs;
        }
        if (svg && !use) {
          const c = svg.cloneNode(true), own = [];
          for (let i = 0; i < svg.style.length; i++) { const k = svg.style[i]; if (!PROXY_SVG_KEYS.includes(k)) own.push(`${k}: ${svg.style.getPropertyValue(k)}`); }
          c.removeAttribute('style');
          const ss = getComputedStyle(svg);
          o.svg = { markup: c.outerHTML, own: own.sort().join('; '), paint: [ss.color, ss.fill, ss.stroke, ss.strokeWidth] };
        }
        if (el.dataset.img != null) {
          const img = el.querySelector(':scope > img'), s = img && getComputedStyle(img);
          o.img = img ? { fit: s.objectFit, pos: s.objectPosition, src: img.currentSrc || img.src } : null;
        }
        dom[el.dataset.id] = o;
      }
      document.getElementById('__vd_nt').remove();
      return { boxes, fontsMissing, facesMissing, dom, installed };
    });
    const png = await page.locator('[data-root]').screenshot({ animations: 'disabled' });
    const facesMissing = [...res.facesMissing, ...(await synthesisedFaces(page, res.installed))];
    return { boxes: res.boxes, png, fontsMissing: res.fontsMissing, facesMissing, dom: res.dom, model };
  } finally {
    await page.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
