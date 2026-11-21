// Capture: render an HTML file in headless Chromium and measure every visible thing inside each screen root at two
// widths (native W and W + delta). Reads computed style only. Writes nothing to disk, never touches the source file.
// opts.png: also return screen.png = [PNG Buffer at A, at B], each clipped to the screen root (device scale 2).
// opts.fontOverride (default true): families Figma would substitute (figma-model's resolveFamily on the family Chrome
//   renders, with opts.fontMap, default defaultFontMap()) are replaced by the Figma family before measuring, so the
//   source is measured in the font Figma will use. The family is loaded from Google Fonts unless it already renders
//   (opts.webFonts === false: never load). screen.fontSubs = [{from, to, reason}]; a target that does not render keeps
//   the original font and is listed with reason 'override-failed' (cause = original reason). With png,
//   screen.pngOriginal = the root at A in the original fonts (for the normalisation report).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';
import { defaultFontMap } from './font-map.mjs';
import { resolveFamily } from './figma-model.mjs';

const MIN_SAFE_DELTA = 24;
const DEFAULT_VIEWPORT = 1400;
const VIEWPORT_HEIGHT = 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------- breakpoints ----------------

// Extract width breakpoints from a media query text: (min-width: Npx|em|rem), (max-width: ...), and range syntax.
export function parseMedia(text) {
  const out = [];
  const px = (v, u) => (u === 'px' ? Number(v) : Number(v) * 16);
  for (const m of text.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/gi)) {
    out.push({ type: m[1].toLowerCase(), px: px(m[2], m[3].toLowerCase()) });
  }
  for (const m of text.matchAll(/\(\s*width\s*(>=|>|<=|<)\s*([\d.]+)(px|em|rem)\s*\)/gi)) {
    out.push({ type: m[1].startsWith('>') ? 'min' : 'max', px: px(m[2], m[3].toLowerCase()) });
  }
  return out;
}

// Media texts from raw CSS source (fallback for file:// sheets Chromium refuses to expose through cssRules).
function mediaTextsFromCss(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...noComments.matchAll(/@media([^{;]+)\{/g), ...noComments.matchAll(/@import[^;]*?\)([^;]*);/g)]
    .map((m) => m[1]);
}

// Pick the widening delta. A breakpoint b is crossed when W < b <= W + d (min-width) or W <= b < W + d (max-width).
// If crossed, d = nearest - W - 1 (min) or nearest - W (max). If that leaves < 24px, keep the requested d, unsafe.
export function chooseWiden(W, bps, requested = 120) {
  const breakpoints = [...new Set(bps.map((b) => b.px))].sort((a, b) => a - b);
  const crossed = bps.filter((b) => (b.type === 'min' ? W < b.px && b.px <= W + requested : W <= b.px && b.px < W + requested));
  const res = { by: requested, requested, breakpoints, unsafe: false };
  if (!crossed.length) return res;
  const cands = crossed.map((b) => ({ b, d: r2(b.type === 'min' ? b.px - W - 1 : b.px - W) }));
  const best = cands.reduce((m, c) => (c.d < m.d ? c : m));
  const list = [...new Set(crossed.map((b) => `${b.type}-width ${b.px}px`))].join(', ');
  if (best.d < MIN_SAFE_DELTA) {
    res.unsafe = true;
    res.reason = `mốc ${list} bị vượt khi nới ${requested}px; Δ an toàn chỉ còn ${best.d}px < ${MIN_SAFE_DELTA}px, giữ Δ yêu cầu`;
  } else {
    res.by = best.d;
  }
  return res;
}

// ---------------- in-page measurement (serialised into the page; must be self-contained) ----------------

function measurePage({ rootSel, widenSel, extras, nameOf }) {
  let roots;
  try { roots = [...document.querySelectorAll(rootSel)]; } catch (e) { return { badSelector: String(e.message || e) }; }
  if (!roots.length) return { count: 0 };

  // 0. media query texts from every readable stylesheet; unreadable ones are reported by href
  const mediaTexts = []; const unreadable = [];
  // web fonts for the proxy (Task 5): font-host stylesheets by href, @font-face rules with absolute urls
  const FONT_HOST = /^https?:\/\/(fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.cdnfonts\.com|api\.fontshare\.com)\//;
  const fontCss = { links: [], faces: [] };
  const fontLink = (href) => { if (href && FONT_HOST.test(href) && !fontCss.links.includes(href)) fontCss.links.push(href); };
  const scanRules = (rules, base) => {
    for (const r of rules) {
      if (r instanceof CSSMediaRule) mediaTexts.push(r.media.mediaText);
      if (r instanceof CSSImportRule) {
        if (r.media) mediaTexts.push(r.media.mediaText);
        fontLink(new URL(r.href, base).href);
        if (r.styleSheet) readSheet(r.styleSheet);
      }
      if (r instanceof CSSFontFaceRule) {
        fontCss.faces.push(r.cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, u) => `url("${new URL(u, base).href}")`));
      }
      if (r.cssRules) scanRules(r.cssRules, base);
    }
  };
  const readSheet = (s) => {
    if (s.media && s.media.mediaText) mediaTexts.push(s.media.mediaText);
    fontLink(s.href);
    try { scanRules(s.cssRules, s.href || document.baseURI); } catch { unreadable.push(s.href || '(inline)'); }
  };
  for (const s of document.styleSheets) readSheet(s);

  // 1. widen (second pass only)
  const targets = roots.map((r) => (widenSel ? r.closest(widenSel) : r));
  const widenMissing = targets.findIndex((t) => !t);
  if (widenMissing >= 0) return { widenMissing, count: roots.length };
  if (extras) {
    const done = new Set();
    targets.forEach((t, i) => {
      if (done.has(t) || !extras[i]) return;
      done.add(t);
      const cw = parseFloat(getComputedStyle(t).width); // resolved px, honours box-sizing
      const base = Number.isFinite(cw) ? cw : t.getBoundingClientRect().width;
      t.style.setProperty('width', (base + extras[i]) + 'px', 'important');
      t.style.setProperty('max-width', 'none', 'important');
      t.style.setProperty('flex', 'none', 'important');
    });
  }

  const isTransparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const bw = (cs, s) => (cs[`border${s}Style`] === 'none' || cs[`border${s}Style`] === 'hidden' ? 0 : parseFloat(cs[`border${s}Width`]));
  const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
  const hasBox = (cs) => !isTransparent(cs.backgroundColor) || cs.backgroundImage !== 'none' ||
    SIDES.some((s) => bw(cs, s) > 0) || cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
  const pad = (cs) => SIDES.map((s) => parseFloat(cs['padding' + s]));

  // Original-DOM child index of every node, recorded before any DOM edit so ids do not depend on inserted spans.
  const origIdx = new WeakMap();
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) el.childNodes.forEach((ch, i) => origIdx.set(ch, i));

  // 2. materialise ::before/::after (with content, background or border) as spans carrying the pseudo's computed style
  const PROPS = [...getComputedStyle(document.documentElement)];
  const pend = [];
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    if (el.closest('svg')) continue;
    for (const which of ['before', 'after']) {
      const cs = getComputedStyle(el, '::' + which);
      const c = cs.content;
      if (!c || c === 'none' || c === 'normal' || cs.display === 'none') continue;
      const m = c.match(/^"(.*)"$/s);
      const txt = m ? m[1] : c.replace(/"/g, '');
      if (!txt && !hasBox(cs)) continue;
      const sp = document.createElement('span');
      for (const p of PROPS) if (p !== 'content') sp.style.setProperty(p, cs.getPropertyValue(p));
      sp.textContent = txt; sp.dataset.pseudo = which;
      if (!m) sp.dataset.approx = '1';
      pend.push([el, which, sp]);
    }
  }
  const st = document.createElement('style');
  st.textContent = '.__pzb::before{content:none!important}.__pza::after{content:none!important}';
  document.head.appendChild(st);
  for (const [el, which, sp] of pend) {
    el.classList.add(which === 'before' ? '__pzb' : '__pza');
    if (which === 'before') el.insertBefore(sp, el.firstChild); else el.appendChild(sp);
  }

  // 3. wrap bare text inside flex/grid containers (an anonymous flex/grid item == a blockified span: layout-neutral)
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    if (el.closest('svg')) continue;
    if (!/flex|grid/.test(getComputedStyle(el).display)) continue;
    for (const ch of [...el.childNodes]) if (ch.nodeType === 3 && ch.textContent.trim()) {
      const sp = document.createElement('span'); sp.dataset.tw = '1';
      origIdx.set(sp, origIdx.get(ch));
      el.insertBefore(sp, ch); sp.appendChild(ch);
    }
  }

  // 4. record transforms, then disable them so every box is measured un-transformed
  const tfs = new Map();
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    const parts = [];
    if (cs.transform !== 'none') parts.push(cs.transform);
    for (const p of ['translate', 'rotate', 'scale']) if (cs[p] && cs[p] !== 'none') parts.push(`${p}(${cs[p]})`);
    if (parts.length) tfs.set(el, { value: parts.join(' '), origin: cs.transformOrigin });
  }
  const notf = document.createElement('style'); notf.id = '__vd_notf';
  notf.textContent = '*,*::before,*::after{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
  document.head.appendChild(notf);

  const lhCache = {};
  const lhPx = (cs) => {
    if (cs.lineHeight !== 'normal') return parseFloat(cs.lineHeight);
    const key = cs.fontFamily + '|' + cs.fontSize + '|' + cs.fontWeight + '|' + cs.fontStyle;
    if (lhCache[key] == null) {
      const p = document.createElement('div');
      p.style.cssText = `position:absolute;visibility:hidden;font-family:${cs.fontFamily};font-size:${cs.fontSize};` +
        `font-weight:${cs.fontWeight};font-style:${cs.fontStyle};line-height:normal;white-space:nowrap`;
      p.textContent = 'Hg'; document.body.appendChild(p); lhCache[key] = p.getBoundingClientRect().height; p.remove();
    }
    return lhCache[key];
  };
  const rnd = (v) => Math.round(v * 100) / 100;
  const paint = (cs, el) => {
    const p = {};
    if (!isTransparent(cs.backgroundColor)) p.bg = cs.backgroundColor;
    if (cs.backgroundImage !== 'none') p.bgImage = cs.backgroundImage;
    const b = SIDES.map((s) => ({ w: bw(cs, s), style: cs[`border${s}Style`], color: cs[`border${s}Color`] }));
    if (b.some((x) => x.w > 0)) p.border = b;
    const rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    if (rad.some((x) => x !== '0px')) p.radius = rad;
    if (cs.boxShadow !== 'none') p.shadow = cs.boxShadow;
    if (cs.opacity !== '1') p.opacity = Number(cs.opacity);
    if (cs.textDecorationLine && cs.textDecorationLine !== 'none') p.textDecoration = cs.textDecorationLine;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') p.clip = true;
    const tf = el && tfs.get(el);
    if (tf) p.transform = tf;
    if (cs.filter !== 'none') p.filter = cs.filter;
    if (cs.clipPath !== 'none') p.clipPath = cs.clipPath;
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) p.outline = `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`;
    return p;
  };
  const font = (cs) => ({ ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, fst: cs.fontStyle, lh: lhPx(cs), ls: cs.letterSpacing,
    c: cs.color, td: cs.textDecorationLine, tt: cs.textTransform, ta: cs.textAlign, ws: cs.whiteSpace });
  const isIconFont = (cs) => /Material (Symbols|Icons)/i.test(cs.fontFamily);
  const isInlineNoBox = (el) => {
    const cs = getComputedStyle(el);
    return cs.display === 'inline' && cs.visibility === 'visible' && !hasBox(cs) && pad(cs).every((v) => v === 0) && !el.dataset.pseudo &&
      parseFloat(cs.marginLeft) === 0 && parseFloat(cs.marginRight) === 0 && !isIconFont(cs) && !tfs.has(el) &&
      el.tagName !== 'svg' && el.tagName !== 'IMG';
  };
  // true: only text and box-less inline elements below; null: nothing at all; false: has real boxes
  const pureInline = (el) => {
    let txt = false;
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) { if (ch.textContent.trim() || / /.test(ch.textContent)) txt = true; continue; }
      if (ch.nodeType !== 1) continue;
      if (ch.tagName === 'BR') continue;
      if (getComputedStyle(ch).display === 'none') continue;
      if (!isInlineNoBox(ch)) return false;
      const sub = pureInline(ch); if (sub === false) return false; if (sub) txt = true;
    }
    return txt ? true : null;
  };
  const primary = (ff) => ff.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const FKEY = ['c', 'ff', 'fs', 'fw', 'fst', 'ls', 'td', 'tt'];
  const lineClusters = (rects) => {
    const rs = [...rects].filter((r) => r.width > 0.01 && r.height > 0.01).sort((a, b) => a.top - b.top);
    const L = [];
    for (const r of rs) {
      const l = L.find((x) => r.top < x.bottom - 1 && r.bottom > x.top + 1);
      if (l) { l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); }
      else L.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    return L;
  };
  // path segment of a child: pseudo spans are '.b' / '.a', everything else keeps its original-DOM index
  const seg = (ch, i) => (ch.dataset?.pseudo ? (ch.dataset.pseudo === 'before' ? 'b' : 'a') : (origIdx.get(ch) ?? i));
  const clsOf = (el) => String(el.className?.baseVal ?? el.className ?? '').replace(/__pz[ab]/g, '').trim();

  const screens = roots.map((root) => {
    const R = root.getBoundingClientRect();
    const rel = (b) => [rnd(b.left - R.left), rnd(b.top - R.top), rnd(b.width), rnd(b.height)];
    const excluded = []; const fonts = new Set(); const fontLists = new Set(); const iconRefs = new Set();
    const excl = (path, reason) => excluded.push({ path, reason });
    const useFont = (f) => { fonts.add(primary(f.ff)); fontLists.add(f.ff); return f; };

    // text box via Range + half-leading
    const rangeBox = (target, cs) => {
      const rg = document.createRange();
      if (target.nodeType === 3) rg.selectNode(target); else rg.selectNodeContents(target);
      const L = lineClusters(rg.getClientRects());
      if (!L.length) return null;
      const LH = lhPx(cs);
      const f = L[0], l = L[L.length - 1];
      const top = f.top - (LH - (f.bottom - f.top)) / 2, bottom = l.bottom + (LH - (l.bottom - l.top)) / 2;
      const left = Math.min(...L.map((x) => x.left)), right = Math.max(...L.map((x) => x.right));
      return { box: rel({ left, top, width: right - left, height: bottom - top }), lines: L.length, tw: rnd(right - left) };
    };
    // styled runs of a pure-inline element; display:none descendants are listed as excluded under elPath
    const runsOf = (el, base, elPath) => {
      const runs = [];
      const rec = (node, path) => {
        node.childNodes.forEach((ch, i) => {
          if (ch.nodeType === 3) {
            const f = useFont(font(getComputedStyle(node))); const d = {};
            for (const k of FKEY) if (f[k] !== base[k]) d[k] = f[k];
            runs.push({ t: ch.textContent, ...(Object.keys(d).length ? { s: d } : {}) });
          } else if (ch.nodeType === 1) {
            if (ch.tagName === 'BR') { runs.push({ br: 1 }); return; }
            if (getComputedStyle(ch).display === 'none') { excl(path + '.' + seg(ch, i), 'display:none'); return; }
            rec(ch, path + '.' + seg(ch, i));
          }
        });
      };
      rec(el, elPath);
      if (!/pre/.test(base.ws)) { // collapse whitespace across the whole paragraph
        let prevSpace = true;
        for (const r of runs) {
          if (r.br) { prevSpace = true; continue; }
          let t = r.t.replace(/[ \t\n\r\f]+/g, ' ');
          if (prevSpace) t = t.replace(/^ /, '');
          prevSpace = t.endsWith(' ') || (t === '' && prevSpace);
          r.t = t;
        }
        for (let i = runs.length - 1; i >= 0; i--) { const r = runs[i]; if (r.br) continue; r.t = r.t.replace(/ $/, ''); if (r.t) break; }
        for (let i = 0; i < runs.length; i++) if (runs[i + 1]?.br && !runs[i].br) runs[i].t = runs[i].t.replace(/ $/, '');
      }
      return runs.filter((r) => r.br || r.t !== '');
    };
    const base = (id, kind, tag, cls, r, p) => ({ id, kind, tag, cls, r, paint: p });
    const textNode = (id, kind, tag, cls, el, cs, r, p, lines, tw, elPath) => {
      const f = useFont(font(cs));
      return { ...base(id, kind, tag, cls, r, p), font: f, runs: runsOf(el, f, elPath), lines, tw };
    };
    const outside = (b, clip) => b.width > 0 && b.height > 0 &&
      (b.right <= clip.left || b.left >= clip.right || b.bottom <= clip.top || b.top >= clip.bottom);
    const clipFor = (el, cs, b, clip) => {
      const c = { ...clip };
      const bws = SIDES.map((s) => bw(cs, s));
      if (cs.overflowX !== 'visible') { c.left = Math.max(c.left, b.left + bws[3]); c.right = Math.min(c.right, b.right - bws[1]); }
      if (cs.overflowY !== 'visible') { c.top = Math.max(c.top, b.top + bws[0]); c.bottom = Math.min(c.bottom, b.bottom - bws[2]); }
      return c;
    };

    // Flex intent (read for flags only, never for layout). Items: {g, s, b, ax, n?}; n = main size with shrinking
    // disabled, measured only when some item may shrink. Containers: {jc, fd, ov}; ov = items overflow the main axis.
    const flexItem = new WeakMap();
    const flexItemsOf = (el) => [...el.children].flatMap((c) => {
      const s = getComputedStyle(c);
      if (s.display === 'contents') return flexItemsOf(c);
      return s.display === 'none' || s.position === 'absolute' || s.position === 'fixed' ? [] : [c];
    });
    const flexContainer = (el, cs) => {
      const ax = /column/.test(cs.flexDirection) ? 'y' : 'x';
      const dim = ax === 'x' ? 'width' : 'height';
      const items = flexItemsOf(el).map((c) => {
        const s = getComputedStyle(c);
        return { c, g: Number(s.flexGrow), s: Number(s.flexShrink), b: s.flexBasis, ax };
      });
      const B = el.getBoundingClientRect(); const pd = pad(cs);
      const end = ax === 'x' ? B.right - bw(cs, 'Right') - pd[1] : B.bottom - bw(cs, 'Bottom') - pd[2];
      const ov = items.some((i) => { const r = i.c.getBoundingClientRect(); return (ax === 'x' ? r.right : r.bottom) > end + 1; });
      if (items.some((i) => i.s > 0)) {
        const prev = items.map((i) => [i.c.style.getPropertyValue('flex-shrink'), i.c.style.getPropertyPriority('flex-shrink')]);
        items.forEach((i) => i.c.style.setProperty('flex-shrink', '0', 'important'));
        items.forEach((i) => { i.n = rnd(i.c.getBoundingClientRect()[dim]); });
        items.forEach((i, k) => { if (prev[k][0]) i.c.style.setProperty('flex-shrink', prev[k][0], prev[k][1]); else i.c.style.removeProperty('flex-shrink'); });
      }
      for (const { c, ...f } of items) flexItem.set(c, f);
      return { jc: cs.justifyContent, fd: cs.flexDirection, ov };
    };

    // Returns a node, null, or (for a visibility:hidden element) an array of its visible descendants' nodes.
    const walk = (el, id, clip, inHidden = false) => {
      const res = walkEl(el, id, clip, inHidden);
      if (res && !Array.isArray(res) && flexItem.has(el)) res.flex = flexItem.get(el);
      return res;
    };
    const walkEl = (el, id, clip, inHidden) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') { excl(id, 'display:none'); return null; }
      const b = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
        // Only the element that turns visibility off is listed; descendants that inherit it are covered by that entry.
        if (!inHidden) excl(id, 'visibility:hidden');
        if (el.tagName.toLowerCase() === 'svg') return null;
        const out = [];
        kidsInto(out, el, cs, id, clipFor(el, cs, b, clip), true);
        return out;
      }
      if (outside(b, clip)) { excl(id, 'clipped'); return null; }
      const tag = el.tagName.toLowerCase();
      const cls = clsOf(el);
      const pseudo = !!el.dataset?.pseudo;
      const r = rel(b);
      const p = paint(cs, el);
      if (tag === 'svg') {
        if (b.width < 0.5 || b.height < 0.5) { excl(id, 'zero-size'); return null; }
        const u = el.querySelector('use');
        const href = u ? (u.getAttribute('href') || u.getAttribute('xlink:href') || '') : '';
        const icon = { ref: href ? href.replace(/^.*#/, '') : null, color: cs.color, fill: cs.fill, stroke: cs.stroke, sw: cs.strokeWidth };
        if (!u) icon.svg = el.outerHTML; else if (icon.ref) iconRefs.add(icon.ref);
        return { ...base(id, 'icon', tag, cls, r, p), icon };
      }
      if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'iframe' || tag === 'picture') {
        if (b.width < 0.5 || b.height < 0.5) { excl(id, 'zero-size'); return null; }
        const img = tag === 'picture' ? el.querySelector('img') : el;
        return { ...base(id, 'image', tag, cls, r, p), src: (img && (img.currentSrc || img.src)) || null, fit: cs.objectFit };
      }
      if (isIconFont(cs)) {
        return { ...base(id, 'icon', tag, cls, r, p), font: useFont(font(cs)), icon: { glyph: el.textContent.trim(), color: cs.color } };
      }
      const kind = pseudo ? 'pseudo' : 'frame';
      const pi = pureInline(el);
      if (pi) {
        const rb = rangeBox(el, cs);
        const LH = lhPx(cs); const pd = pad(cs);
        const bws = SIDES.map((s) => bw(cs, s));
        const cH = b.height - pd[0] - pd[2] - bws[0] - bws[2];
        const lines = rb ? rb.lines : 1;
        const tight = Math.abs(cH - lines * LH) < 1.5;
        const tk = pseudo ? 'pseudo' : 'text';
        if (cs.display === 'inline' && rb) return textNode(id, tk, tag, cls, el, cs, rb.box, p, lines, rb.tw, id);
        if (!hasBox(cs) && pd.every((v) => v === 0) && tight) {
          const t = textNode(id, tk, tag, cls, el, cs, r, p, lines, rb ? rb.tw : r[2], id);
          if (cs.lineHeight === 'normal') t.font.lh = rnd(b.height / lines);
          return t;
        }
        // frame + one text child
        const cx = b.left + bws[3] + pd[3], cy = b.top + bws[0] + pd[0], cw = b.width - bws[1] - bws[3] - pd[1] - pd[3];
        let tb;
        if (tight) tb = lines === 1 && rb ? [rb.box[0], rnd(cy - R.top), rb.box[2], rnd(cH)] : [rnd(cx - R.left), rnd(cy - R.top), rnd(cw), rnd(cH)];
        else tb = rb ? rb.box : r;
        return { ...base(id, kind, tag, cls, r, p), kids: [textNode(id + '.t', 'text', '#text', '', el, cs, tb, {}, lines, rb ? rb.tw : tb[2], id)] };
      }
      const n = base(id, kind, tag, cls, r, p);
      if (/flex/.test(cs.display)) n.flexBox = flexContainer(el, cs);
      n.kids = [];
      kidsInto(n.kids, el, cs, id, clipFor(el, cs, b, clip));
      if (!n.kids.length) {
        delete n.kids;
        if ((b.width < 0.5 || b.height < 0.5) && !hasBox(cs)) { excl(id, 'zero-size'); return null; }
      }
      if (el.dataset?.approx) n.approx = true;
      return n;
    };
    // children of el; display:contents children are flattened into the parent with their own path segment
    const kidsInto = (out, el, cs, id, clip, inHidden = false) => {
      el.childNodes.forEach((ch, i) => {
        const cid = id + '.' + seg(ch, i);
        if (ch.nodeType === 3) {
          if (!ch.textContent.trim() || cs.visibility !== 'visible') return; // hidden text is covered by its element's entry
          const rb = rangeBox(ch, cs); if (!rb) return;
          const f = useFont(font(cs));
          const t = /pre/.test(cs.whiteSpace) ? ch.textContent : ch.textContent.replace(/\s+/g, ' ').trim();
          out.push({ ...base(cid, 'text', '#text', '', rb.box, {}), font: f, runs: [{ t }], lines: rb.lines, tw: rb.tw });
        } else if (ch.nodeType === 1) {
          if (ch.tagName === 'BR' || ch.tagName === 'STYLE' || ch.tagName === 'SCRIPT' || ch.tagName === 'TEMPLATE' || ch.tagName === 'HEAD') return;
          const ccs = getComputedStyle(ch);
          if (ccs.display === 'contents') { kidsInto(out, ch, ccs, cid, clip, inHidden); return; }
          const k = walk(ch, cid, clip, inHidden);
          if (Array.isArray(k)) out.push(...k); else if (k) out.push(k);
        }
      });
    };

    const INF = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    let tree = walk(root, 'n', INF);
    if (Array.isArray(tree)) tree = null; // a hidden root is reported as an error on the node side

    let name = '';
    if (nameOf) {
      for (let a = root; a && !name; a = a.parentElement) {
        const ms = [...a.querySelectorAll(nameOf)];
        if (!ms.length) continue;
        const before = ms.filter((m) => m.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING);
        const pick = ms.find((m) => root.contains(m)) || before[before.length - 1] || ms[0];
        name = (pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
    }
    // Family Chrome really renders for each family list: first family that is a generic, or that is loaded/installed
    // (document.fonts.check covers @font-face; a width probe against two different fallbacks covers installed fonts).
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|BlinkMacSystemFont|emoji|math|fangsong)$/i;
    const ctx = document.createElement('canvas').getContext('2d');
    const probe = (fam, fb) => { ctx.font = `72px "${fam}", ${fb}`; const a = ctx.measureText('mmmmmmmmmmlli1WÀỆ').width; ctx.font = `72px ${fb}`; return a !== ctx.measureText('mmmmmmmmmmlli1WÀỆ').width; };
    const renders = (fam) => document.fonts.check(`16px "${fam}"`) && (probe(fam, 'monospace') || probe(fam, 'serif'));
    const fontsRendered = {};
    for (const list of fontLists) {
      const fams = list.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      fontsRendered[list] = fams.find((f) => GENERIC.test(f) || renders(f)) || fams[fams.length - 1] || '';
    }
    // markup of every <symbol> (or other element) an icon of this screen references, for the proxy's sprite
    const svgDefs = {};
    for (const ref of iconRefs) { const d = document.getElementById(ref); if (d) svgDefs[ref] = d.outerHTML; }
    return { W: rnd(R.width), H: rnd(R.height), tree, excluded, fonts: [...fonts], fontsRendered, name, svgDefs };
  });
  return { count: roots.length, screens, mediaTexts, unreadable, fontCss };
}

// ---------------- node side ----------------

// ---- font override (resolved before inference: the source is measured in the font Figma will use) ----

const PROBE_TEXT = 'mmmmmmmmmmlli1WÀỆ';

// In page: every family list used by elements (and their ::before/::after) of each root, the family Chrome renders
// for each list, and the weights/styles used per list.
function collectFonts({ rootSel, probeText }) {
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|BlinkMacSystemFont|emoji|math|fangsong)$/i;
  const ctx = document.createElement('canvas').getContext('2d');
  const probe = (fam, fb) => { ctx.font = `72px "${fam}", ${fb}`; const a = ctx.measureText(probeText).width; ctx.font = `72px ${fb}`; return a !== ctx.measureText(probeText).width; };
  const renders = (fam) => document.fonts.check(`16px "${fam}"`) && (probe(fam, 'monospace') || probe(fam, 'serif'));
  const perRoot = []; const styles = {};
  const add = (set, cs) => {
    set.add(cs.fontFamily);
    const w = Math.min(900, Math.max(100, Math.round((parseFloat(cs.fontWeight) || 400) / 100) * 100));
    (styles[cs.fontFamily] ||= new Set()).add(`${/italic|oblique/.test(cs.fontStyle) ? 1 : 0},${w}`);
  };
  for (const r of document.querySelectorAll(rootSel)) {
    const set = new Set();
    for (const el of [r, ...r.querySelectorAll('*')]) {
      add(set, getComputedStyle(el));
      for (const w of ['::before', '::after']) {
        const cs = getComputedStyle(el, w);
        if (cs.content && cs.content !== 'none' && cs.content !== 'normal') add(set, cs);
      }
    }
    perRoot.push([...set]);
  }
  const rendered = {};
  for (const list of new Set(perRoot.flat())) {
    const fams = list.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    rendered[list] = fams.find((f) => GENERIC.test(f) || renders(f)) || fams[fams.length - 1] || '';
  }
  return { perRoot, rendered, styles: Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, [...v]])) };
}

// In page: which of these families already render (installed, or loaded by the page)
function rendersInPage({ fams, probeText }) {
  const ctx = document.createElement('canvas').getContext('2d');
  const probe = (fam, fb) => { ctx.font = `72px "${fam}", ${fb}`; const a = ctx.measureText(probeText).width; ctx.font = `72px ${fb}`; return a !== ctx.measureText(probeText).width; };
  return Object.fromEntries(fams.map((f) => [f, document.fonts.check(`16px "${f}"`) && (probe(f, 'monospace') || probe(f, 'serif'))]));
}

// In page: load the target families (links, then each face), then point every element / pseudo whose list maps to a
// target that renders at that target. Returns the targets that do not render (their lists keep the original font).
async function applyOverride({ rootSel, map, links, faces, timeoutMs, probeText }) {
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(r, timeoutMs))]);
  await within(Promise.all(links.map((href) => new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = l.onerror = () => res(); document.head.appendChild(l);
  }))));
  await within(Promise.all(faces.map(([fam, ital, w]) => document.fonts.load(`${ital ? 'italic ' : ''}${w} 16px "${fam}"`).catch(() => null))));
  const ctx = document.createElement('canvas').getContext('2d');
  const probe = (fam, fb) => { ctx.font = `72px "${fam}", ${fb}`; const a = ctx.measureText(probeText).width; ctx.font = `72px ${fb}`; return a !== ctx.measureText(probeText).width; };
  const targets = [...new Set(Object.values(map))];
  const failed = targets.filter((f) => !(document.fonts.check(`16px "${f}"`) && (probe(f, 'monospace') || probe(f, 'serif'))));
  const ok = Object.entries(map).filter(([, to]) => !failed.includes(to));
  const key = new Map(ok.map(([list], i) => [list, String(i)]));
  const rules = [];
  ok.forEach(([, to], i) => {
    const ff = `font-family:"${to}"!important`;
    rules.push(`[data-vd-ff="${i}"]{${ff}}`, `[data-vd-ffb="${i}"]::before{${ff}}`, `[data-vd-ffa="${i}"]::after{${ff}}`);
  });
  const tag = [];
  for (const r of document.querySelectorAll(rootSel)) for (const el of [r, ...r.querySelectorAll('*')]) {
    const k = key.get(getComputedStyle(el).fontFamily); if (k != null) tag.push([el, 'vdFf', k]);
    const kb = key.get(getComputedStyle(el, '::before').fontFamily); if (kb != null) tag.push([el, 'vdFfb', kb]);
    const ka = key.get(getComputedStyle(el, '::after').fontFamily); if (ka != null) tag.push([el, 'vdFfa', ka]);
  }
  for (const [el, d, k] of tag) el.dataset[d] = k; // only after every computed style was read
  const st = document.createElement('style'); st.id = '__vd_ff'; st.textContent = rules.join('\n'); document.head.appendChild(st);
  await document.fonts.ready;
  return failed;
}

const fontsLink = (fam, tuples) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:ital,wght@` +
  `${[...tuples].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(';')}&display=swap`;

// Plan and apply the override on a loaded page -> per root [{from, to, reason}] (reason 'override-failed', with
// cause = the original reason, when the target did not render; those lists keep their original font).
async function overrideFonts(page, rootSel, fo) {
  const { perRoot, rendered, styles } = await page.evaluate(collectFonts, { rootSel, probeText: PROBE_TEXT });
  const map = {}; const subOf = {};
  for (const list of Object.keys(rendered)) {
    const r = resolveFamily(fo.fontMap, list, rendered[list]);
    if (r.sub) { map[list] = r.ff; subOf[list] = r.sub; }
  }
  const targets = [...new Set(Object.values(map))];
  let failed = [];
  if (targets.length) {
    const already = await page.evaluate(rendersInPage, { fams: targets, probeText: PROBE_TEXT });
    const tuples = {};
    for (const [list, to] of Object.entries(map)) for (const t of styles[list] || ['0,400']) (tuples[to] ||= new Set()).add(t);
    const links = fo.webFonts === false ? [] : targets.filter((t) => !already[t]).map((t) => fontsLink(t, tuples[t]));
    const faces = Object.entries(tuples).flatMap(([fam, set]) => [...set].map((t) => [fam, +t.split(',')[0], +t.split(',')[1]]));
    failed = await page.evaluate(applyOverride, { rootSel, map, links, faces, timeoutMs: fo.timeoutMs ?? 15000, probeText: PROBE_TEXT });
  }
  return perRoot.map((lists) => {
    const out = []; const seen = new Set();
    for (const l of lists) {
      const sub = subOf[l]; if (!sub) continue;
      const e = failed.includes(sub.to) ? { ...sub, reason: 'override-failed', cause: sub.reason } : sub;
      const k = `${e.from}|${e.to}|${e.reason}`;
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
    return out;
  });
}

// Screenshot of every root. Ancestors of the roots paint nothing and the page is white (as in the proxy), so what
// shows through a root's rounded corners or transparent areas is not the surrounding mockup chrome. Transforms on.
async function shootRoots(page, rootSel) {
  const n = await page.evaluate((sel) => {
    const s = document.getElementById('__vd_notf'); if (s) s.remove();
    const anc = new Set();
    for (const r of document.querySelectorAll(sel)) for (let a = r.parentElement; a; a = a.parentElement) anc.add(a);
    for (const a of anc) {
      for (const [k, v] of [['background', 'transparent'], ['box-shadow', 'none'], ['border-color', 'transparent'], ['outline-color', 'transparent']]) a.style.setProperty(k, v, 'important');
    }
    document.documentElement.style.setProperty('background', '#fff', 'important');
    return document.querySelectorAll(sel).length;
  }, rootSel);
  const loc = page.locator(rootSel); const out = [];
  for (let i = 0; i < n; i++) out.push(await loc.nth(i).screenshot({ animations: 'disabled' }));
  return out;
}

const validSelector = (page, sel) => page.evaluate((s) => { try { document.querySelectorAll(s); return true; } catch { return false; } }, sel);

// png: also screenshot every root (clipped to the root, device scale 2) after measuring, so the image shows the same
// widened layout and fonts the boxes were measured on. Used by verify (Task 6) for crops and pixel %.
// fo (font override): before measuring, families Figma would substitute are replaced by the Figma family. With
// fo.original and png, the roots are also shot before the override (original fonts, for the normalisation report).
async function measure(browser, url, args, width, png = false, fo = null) {
  const page = await browser.newPage({ viewport: { width: Math.round(width), height: VIEWPORT_HEIGHT }, deviceScaleFactor: 2 });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => 0));
    let pngOriginal = null, fontSubs = null;
    if (fo && await validSelector(page, args.rootSel)) {
      if (png && fo.original) pngOriginal = await shootRoots(page, args.rootSel);
      fontSubs = await overrideFonts(page, args.rootSel, fo);
    }
    const res = await page.evaluate(measurePage, args);
    if (fontSubs) res.fontSubs = fontSubs;
    if (pngOriginal) res.pngOriginal = pngOriginal;
    if (png && res.count && res.screens) res.png = await shootRoots(page, args.rootSel);
    return res;
  } finally { await page.close(); }
}

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function collectBreakpoints(res) {
  const texts = [...res.mediaTexts]; const unread = [];
  for (const href of res.unreadable) {
    if (href.startsWith('file:')) {
      try { texts.push(...mediaTextsFromCss(readFileSync(fileURLToPath(href), 'utf8'))); continue; } catch { /* fall through */ }
    }
    unread.push(href);
  }
  const seen = new Set(); const bps = [];
  for (const t of texts) for (const b of parseMedia(t)) {
    const k = b.type + b.px; if (!seen.has(k)) { seen.add(k); bps.push(b); }
  }
  return { bps, unread };
}

function mergeNode(a, mapB) {
  const b = mapB.get(a.id);
  const n = { id: a.id, kind: a.kind, tag: a.tag, cls: a.cls, rA: a.r, rB: b ? b.r : null, paint: a.paint };
  if (a.font) n.font = a.font;
  if (a.runs) n.runs = a.runs;
  if (a.lines != null) n.lines = [a.lines, b && b.lines != null ? b.lines : null];
  if (a.tw != null) n.tw = [a.tw, b && b.tw != null ? b.tw : null];
  if (a.icon) n.icon = a.icon;
  if (a.src !== undefined) { n.src = a.src; n.fit = a.fit; }
  if (a.approx) n.approx = true;
  if (a.flex) n.flex = a.flex;
  if (a.flexBox) n.flexBox = a.flexBox;
  if (a.kids) n.kids = a.kids.map((k) => mergeNode(k, mapB));
  return n;
}

export async function captureScreens(htmlPath, opts = {}) {
  const { root, widen, widenBy = 120, nameOf, viewport = DEFAULT_VIEWPORT, png = false, fontOverride = true } = opts;
  const fo = fontOverride ? { fontMap: opts.fontMap || defaultFontMap(), webFonts: opts.webFonts !== false, timeoutMs: opts.fontTimeoutMs } : null;
  if (!root) throw new Error('captureScreens: thiếu opts.root (selector của màn)');
  if (!(widenBy > 0)) throw new Error(`captureScreens: widenBy phải > 0 (nhận ${widenBy})`);
  if (!(viewport > 0)) throw new Error(`captureScreens: viewport phải > 0 (nhận ${viewport})`);
  const abs = resolve(htmlPath);
  if (!existsSync(abs)) throw new Error(`không đọc được file HTML: ${abs}`);
  const url = pathToFileURL(abs).href;
  const args = { rootSel: root, widenSel: widen || null, nameOf: nameOf || null, extras: null };

  const browser = await launchBrowser();
  try {
    const A = await measure(browser, url, args, viewport, png, fo && { ...fo, original: true });
    if (A.badSelector) throw new Error(`không tìm thấy màn: selector "${root}" không hợp lệ (${A.badSelector})`);
    if (!A.count) throw new Error(`không tìm thấy màn: selector "${root}" không khớp phần tử nào trong ${abs}`);
    if (A.widenMissing != null) {
      throw new Error(`selector nới rộng "${widen}" không khớp chính màn hay tổ tiên của màn #${A.widenMissing} ("${root}")`);
    }
    const { bps, unread } = collectBreakpoints(A);
    // Media queries follow the viewport, so breakpoints matter only for viewport-bound screens (root is html/body or
    // spans the whole viewport). Those are widened by widening the viewport; the others by widening the element.
    const bound = A.screens.map((s) => s.tree && (s.tree.tag === 'html' || s.tree.tag === 'body' || Math.abs(s.W - viewport) <= 0.5));
    const unreadMsg = unread.length ? `không đọc được stylesheet (khác nguồn): ${unread.join(', ')}; mốc trong đó không được xét` : '';
    // All bound screens share one viewport and one breakpoint list, so they get the same delta.
    const boundWiden = chooseWiden(viewport, bps, widenBy);
    const widens = A.screens.map((s, i) => {
      let w;
      if (bound[i]) w = { ...boundWiden };
      else {
        w = { by: widenBy, requested: widenBy, breakpoints: chooseWiden(s.W, bps, widenBy).breakpoints, unsafe: false };
        if (w.breakpoints.length) {
          w.reason = `media query theo viewport (${viewport}px); màn rộng ${s.W}px không gắn với viewport nên nới khung không vượt mốc nào`;
        }
      }
      if (unreadMsg) w.reason = w.reason ? `${w.reason}; ${unreadMsg}` : unreadMsg;
      return w;
    });
    const anyBound = bound.some(Boolean), anyFree = bound.some((b) => !b);
    const passB = async (forBound) => {
      const res = await measure(browser, url, { ...args, extras: widens.map((w, i) => (bound[i] === forBound && !forBound ? w.by : 0)) },
        forBound ? viewport + boundWiden.by : viewport, png, fo);
      if (res.count !== A.count) throw new Error(`số màn khác nhau giữa hai lần đo (${A.count} và ${res.count}) với selector "${root}"`);
      return res;
    };
    const Bbound = anyBound ? await passB(true) : null;
    const Bfree = anyFree ? await passB(false) : null;
    const B = { screens: A.screens.map((_, i) => (bound[i] ? Bbound : Bfree).screens[i]) };
    const pngB = (i) => (bound[i] ? Bbound : Bfree).png[i];
    // font substitutions per screen: A's, plus any target that failed only in the B pass
    const subsOf = (i) => {
      const out = [...((A.fontSubs || [])[i] || [])];
      for (const e of (((bound[i] ? Bbound : Bfree).fontSubs || [])[i] || [])) {
        if (!out.some((x) => x.from === e.from && x.to === e.to && x.reason === e.reason)) out.push(e);
      }
      return out;
    };

    const usedIds = new Set();
    const screens = A.screens.map((sA, i) => {
      const sB = B.screens[i];
      if (!sA.tree || !sB.tree) {
        const why = (sA.tree ? sB : sA).excluded.find((e) => e.path === 'n');
        throw new Error(`màn #${i} ("${root}") không hiển thị${why ? ` (${why.reason})` : ''}`);
      }
      const mapB = new Map();
      const index = (n) => { mapB.set(n.id, n); (n.kids || []).forEach(index); };
      index(sB.tree);
      let id = sA.name ? slug(sA.name) : '';
      if (!id || usedIds.has(id)) id = id ? `${id}-${i}` : `s${i}`;
      usedIds.add(id);
      const seen = new Set(sA.excluded.map((e) => e.path));
      const excluded = [...sA.excluded, ...sB.excluded.filter((e) => !seen.has(e.path)).map((e) => ({ ...e, at: 'B' }))];
      // Nodes rendered only at B (the tree is A's) are listed too, top-most only, unless A already excluded them.
      const idsA = new Set(); const indexA = (n) => { idsA.add(n.id); (n.kids || []).forEach(indexA); }; indexA(sA.tree);
      const onlyB = (n) => {
        if (!idsA.has(n.id)) { if (!seen.has(n.id)) excluded.push({ path: n.id, reason: 'only-at-B', at: 'B' }); return; }
        (n.kids || []).forEach(onlyB);
      };
      onlyB(sB.tree);
      return {
        id, name: sA.name || id, W: [r2(sA.W), r2(sB.W)], H: [r2(sA.H), r2(sB.H)], widen: widens[i],
        tree: mergeNode(sA.tree, mapB), excluded, fonts: [...new Set([...sA.fonts, ...sB.fonts])], fontsRendered: { ...sA.fontsRendered, ...sB.fontsRendered },
        svgDefs: { ...sA.svgDefs, ...sB.svgDefs }, fontCss: A.fontCss,
        ...(png ? { png: [A.png[i], pngB(i)] } : {}),
        ...(fo ? { fontSubs: subsOf(i) } : {}),
        ...(fo && png && A.pngOriginal ? { pngOriginal: A.pngOriginal[i] } : {}),
      };
    });
    return { screens };
  } finally { await browser.close(); }
}
