// Proxy: rebuild an inferred spec (after applyFigmaModel) as plain flexbox that behaves like Figma auto layout, render
// it in Chromium at one width and return per-node boxes plus a PNG. Task 6 compares those boxes with the source HTML,
// so every rule here mirrors what the Figma builder (spike 3 runtime.js) does with the same SNode:
//  - every node: box-sizing:border-box, margin 0, min-width/min-height 0 (n.min / n.max are Figma minWidth/maxWidth)
//  - frame with lay = flex container; padding = lay.p; gap = lay.g on the primary axis, lay.cg between wrapped rows;
//    spaceBetween = justify-content:space-between and the gap is ignored; ca S/C/E/B = align-items start/center/end/baseline
//  - child sizing on the primary axis: FILL = flex:1 1 0px (+ min 0), HUG = flex:none + content size, FIXED = flex:none + px;
//    on the counter axis: FILL = align-self:stretch, HUG = content size, FIXED = px. HUG on something that cannot hug in
//    Figma (leaf frame, icon, image) is FIXED, as in the builder.
//  - absolute children (n.abs, or any child of a frame without auto layout) are placed from x/y by their constraints:
//    c L/R/LR/C horizontally, cy T(default)/B/TB/C vertically, against the parent's spec size. No SCALE.
//  - strokes never take space (strokesIncludedInLayout = false): solid borders are inset box-shadows, other styles an
//    absolutely positioned ::before overlay. paint.strokeOverlay (bordered FILL cells) is drawn the same way.
//  - text: width HUG = nowrap, FIXED/FILL = wraps. HUG sizes already pinned by applyFigmaModel are used as px, except
//    (a) text with font.sub (its Chrome size was measured in another font) and (b) the HUG height of wrapping text (it
//    depends on the width, so a pin taken at width A is wrong at B): those hug naturally in the proxy and are then
//    pinned to figmaTextBox(natural size) before boxes are read (re-measure-then-pin).
//  - fonts: every family goes through fontMap.substitute(firstFamily(ff)), i.e. the font Figma will really use.
// Boxes are [x, y, w, h] relative to the root's top-left, rounded to 0.01, measured with transforms off — the same
// convention as capture's rA/rB. The PNG keeps transforms.
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

const canHug = (n) => n.t === 'T' || (n.t === 'F' && !!(n.lay && n.lay.d));
const sizing = (n, ax) => { const s = (n.sz && n.sz[ax]) || 'FIXED'; return s === 'HUG' && !canHug(n) ? 'FIXED' : s; };

const TEXT_ALIGN = (ta) => (/center/.test(ta || '') ? 'center' : /right|end/.test(ta || '') ? 'right' : /justify/.test(ta || '') ? 'justify' : 'left');
const weight = (fw) => Math.min(900, Math.max(100, Math.round((parseFloat(fw) || 400) / 100) * 100));

export function buildProxyHtml(spec, svgDefs = {}, fontMap, opts = {}) {
  const { fontLinks = [], fontFaces = [], webFonts = true } = opts;
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
  const strokeCss = (p, st, cls) => {
    const b = p.border;
    const shadows = p.shadow ? [p.shadow] : [];
    if (Array.isArray(b) && b.some((s) => s && s.w > 0)) {
      const sides = b.map((s) => (s && s.w > 0 && s.style !== 'none' && s.style !== 'hidden' ? s : null));
      if (sides.every((s) => !s || s.style === 'solid')) {
        const [t, r, bt, l] = sides;
        if (t) shadows.push(`inset 0 ${px(t.w)} 0 0 ${t.color}`);
        if (r) shadows.push(`inset ${px(-r.w)} 0 0 0 ${r.color}`);
        if (bt) shadows.push(`inset 0 ${px(-bt.w)} 0 0 ${bt.color}`);
        if (l) shadows.push(`inset ${px(l.w)} 0 0 0 ${l.color}`);
      } else {
        const k = `s${rules.length}`; cls.push(k);
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
    const sub = isText && n.font && n.font.sub;
    const [sx, sy] = [sizing(n, 0), sizing(n, 1)];
    const textWrap = isText && sx !== 'HUG';
    // size of one axis that is not decided by the parent (HUG or FIXED); FILL is handled by the caller
    const ownSize = (ax) => {
      const dim = ax === 0 ? 'width' : 'height', s = ax === 0 ? sx : sy, v = ax === 0 ? n.w : n.h;
      if (s === 'FIXED') return [`${dim}:${px(v)}`];
      if (s !== 'HUG') return [];
      if (isText) {
        const pinned = !sub && (ax === 0 || !textWrap);
        if (pinned) return [`${dim}:${px(v)}`];
        data.push(ax === 0 ? 'data-pin-w' : 'data-pin-h');
        return [`${dim}:${ax === 0 ? 'max-content' : 'auto'}`];
      }
      return [`${dim}:${ax === 0 ? 'max-content' : 'auto'}`];
    };

    if (!parent) {
      data.push('data-root');
      st.push('position:relative', `width:var(--W, ${px(n.w)})`, ...(sy === 'HUG' ? ownSize(1) : [`height:${px(n.h)}`]));
    } else if (n.abs || !(parent.lay && parent.lay.d)) {
      const a = n.abs || { x: 0, y: 0, c: 'L' };
      st.push('position:absolute');
      const axis = (con, off, size, P, L, R, ax) => {
        const end = px(P - off - size);
        if (con === 'LR' || con === 'TB') return [`${L}:${px(off)}`, `${R}:${end}`];
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
      if (cnt === 'FILL') st.push('align-self:stretch'); else st.push(...ownSize(C));
    }

    const p = n.paint || {};
    const cls = [];
    if (!isText) {
      if (p.bg) st.push(`background-color:${p.bg}`);
      if (p.bgImage) st.push(`background-image:${p.bgImage}`, 'background-size:cover', 'background-position:center');
      if (p.radius) st.push(`border-radius:${p.radius.join(' ')}`);
      strokeCss(p, st, cls);
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
        if (ic.svg) inner = String(ic.svg).replace(/^<svg\b/, `<svg ${style}`);
        else if (ic.ref) inner = `<svg ${style}><use href="#${attr(ic.ref)}"></use></svg>`;
      }
    } else if (n.t === 'I') {
      if (n.src) inner = `<img alt="" src="${attr(n.src)}" style="display:block;width:100%;height:100%;object-fit:${attr(n.fit || 'fill')}">`;
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
    links.map((h) => `<link rel="stylesheet" href="${attr(h)}">`).join('') +
    `<style>html,body{margin:0;padding:0;background:#fff}${fontFaces.join('\n')}\n${rules.join('\n')}</style></head><body>` +
    (defs ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>` : '') +
    body + '</body></html>';
}

// ---------------- rendering ----------------

const NO_TRANSFORM = '[data-id]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';

export async function renderProxy(browser, html, width) {
  const dir = mkdtempSync(join(tmpdir(), 'vd-proxy-'));
  const file = join(dir, 'proxy.html');
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: Math.ceil(width) + 40, height: 1000 }, deviceScaleFactor: DSF });
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(async ([w, css]) => {
      document.querySelector('[data-root]').style.setProperty('--W', `${w}px`);
      const s = document.createElement('style'); s.id = '__vd_nt'; s.textContent = css; document.head.appendChild(s);
      await document.fonts.ready;
    }, [width, NO_TRANSFORM]);
    // re-measure-then-pin: HUG widths first (they feed FILL siblings), then HUG heights of wrapping/substituted text
    const natural = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => {
      const b = el.getBoundingClientRect(); return [el.dataset.id, b.width, b.height, Number(el.dataset.ls || 0)];
    }), sel);
    const pin = (dim, vals) => page.evaluate(([d, v]) => {
      for (const [id, x] of v) document.querySelector(`[data-id="${CSS.escape(id)}"]`).style.setProperty(d, `${x}px`);
    }, [dim, vals]);
    await pin('width', (await natural('[data-pin-w]')).map(([id, w, h, ls]) => [id, figmaTextBox(w, h, ls).w]));
    await pin('height', (await natural('[data-pin-h]')).map(([id, w, h]) => [id, figmaTextBox(w, h, 0).h]));
    const res = await page.evaluate(() => {
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
      document.getElementById('__vd_nt').remove();
      return { boxes, fontsMissing };
    });
    const png = await page.locator('[data-root]').screenshot({ animations: 'disabled' });
    return { boxes: res.boxes, png, fontsMissing: res.fontsMissing };
  } finally {
    await page.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
