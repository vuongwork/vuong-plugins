// Capture: render an HTML file in headless Chromium and measure every visible thing inside each screen root at two
// widths (native W and W + delta). Reads computed style only. Writes nothing to disk, never touches the source file.
// opts.png: also return screen.png = [PNG Buffer at A, at B], each clipped to the screen root (device scale 2), and
//   screen.origin = [[fx, fy] at A, at B]: the fractional part of the root's page position when it was shot (pass it
//   to renderProxy opts.origin so text snaps to the pixel grid the same way).
// opts.fontOverride (default true): families Figma would substitute (figma-model's resolveFamily on the family Chrome
//   renders, with opts.fontMap, default defaultFontMap()) are replaced by the Figma family before measuring, so the
//   source is measured in the font Figma will use. The family is loaded from Google Fonts unless it already renders
//   (opts.webFonts === false: never load). screen.fontSubs = [{from, to, reason}]; a target that does not render keeps
//   the original font and is listed with reason 'override-failed' (cause = original reason). With png,
//   screen.pngOriginal = the root at A in the original fonts and line heights (for the normalisation report).
//   R41: a family Figma has (kept, or a substitution target) that the page renders from a local install, with no
//   @font-face / font link of its own, first gets its Google Fonts face (it shadows the local copy), so source, proxy
//   and Figma use the same binary. Kept families are listed as {from: f, to: f, reason: 'version'} ('version-failed'
//   when the face did not load: rolled back to the local copy). Not with webFonts === false.
// opts.lineHeightOverride (default true, R14): text-bearing elements with line-height 'normal' get an explicit px
//   line-height equal to their measured single-line height before measuring (Figma has no 'normal', and glyphs sit
//   differently under 'normal' than under the same explicit value). screen.norm = { lineHeight: elements changed }.
// R62 (CSS custom properties, read at width A only): screen.vars = { '--name': { value, uses } } for every custom
//   property the page's readable CSS declares (rules, @property, inline style attributes; never the browser's),
//   value = computed at :root (trimmed, '' when only declared lower down), uses = token props in this screen's IR
//   naming it. INode.tok = { [prop]: '--name' }, prop ∈ bg, color, borderT|R|B|L (colour), radius (all four corners),
//   shadow, fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, paddingT|R|B|L, gap (row or column), width,
//   height, opacity, fill, stroke. Set only when a var() declaration (longhand or shorthand; media must match now)
//   applies to the element and the var's value there, normalised on a probe (isolated shadow root, the element's
//   font-size and color) as that computed property, equals the element's computed value; the cascade winner
//   (important, inline, specificity, order) among passing names is used. Inherited props (text, fill, stroke) take
//   the parent's token when the computed value is the parent's. Frames carry box tokens; text nodes also text
//   tokens; icons also color/fill/stroke/fontSize. var() inside a function or a fallback → no token, counted in
//   screen.varsComplex (declarations hit in the screen); unreadable non-font sheets → screen.varsUnreadable.
//   Pseudo-element rules (::before/::after) and nested style rules are not read (a pseudo inherits its host's).
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

// R48: an inline svg (no <use>) is serialised with the paint page CSS gave its elements inlined (icon.svg); page CSS
//   it cannot carry (inner transform, geometry, filter, mask, clip-path, markers ...) → paint.unsupported 'svg ...'.
//   Sprite icons (an svg of exactly one <use>, R54 → svgDefs) are copied as markup only; any other svg with a <use>
//   is serialised whole with the <use> targets inlined as a leading <defs>.
// R47: an INode whose element is position absolute/fixed carries pct = {l, r, t, b, w, h} for the insets and sizes
//   authored in % (computed value, read with the element briefly display:none; px-only nodes have no pct).
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

function measurePage({ rootSel, widenSel, extras, nameOf, vars: wantVars }) {
  let roots;
  try { roots = [...document.querySelectorAll(rootSel)]; } catch (e) { return { badSelector: String(e.message || e) }; }
  if (!roots.length) return { count: 0 };

  // 0. media query texts from every readable stylesheet; unreadable ones are reported by href
  const mediaTexts = []; const unreadable = [];
  // web fonts for the proxy (Task 5): font-host stylesheets by href, @font-face rules with absolute urls
  const FONT_HOST = /^https?:\/\/(fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.cdnfonts\.com|api\.fontshare\.com)\//;
  const fontCss = { links: [], faces: [] };
  const fontLink = (href) => { if (href && FONT_HOST.test(href) && !fontCss.links.includes(href)) fontCss.links.push(href); };
  // R62: custom properties declared by the page (varNames) and var() declarations of token props (varRules), read
  // in the same CSSOM walk; style rules under a media query that does not match now are skipped
  const varNames = new Set(); const varRules = []; let varsUnreadable = 0;
  const matchesMedia = (m) => !m || !m.mediaText || matchMedia(m.mediaText).matches;
  const scanRules = (rules, base, live = true) => {
    for (const r of rules) {
      if (r instanceof CSSMediaRule) mediaTexts.push(r.media.mediaText);
      if (r instanceof CSSImportRule) {
        if (r.media) mediaTexts.push(r.media.mediaText);
        fontLink(new URL(r.href, base).href);
        if (r.styleSheet) readSheet(r.styleSheet, live && matchesMedia(r.media));
      }
      if (r instanceof CSSFontFaceRule) {
        fontCss.faces.push(r.cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, u) => `url("${new URL(u, base).href}")`));
      }
      if (wantVars) {
        if (r instanceof CSSStyleRule) varDecls(r.style, r.selectorText, live, varRules.length);
        else if (typeof CSSPropertyRule !== 'undefined' && r instanceof CSSPropertyRule) varNames.add(r.name);
      }
      // nested style rules (relative selectors) are not read for var() uses
      if (r.cssRules) scanRules(r.cssRules, base, live && !(r instanceof CSSStyleRule) && (!(r instanceof CSSMediaRule) || matchesMedia(r.media)));
    }
  };
  const readSheet = (s, live = true) => {
    if (s.media && s.media.mediaText) mediaTexts.push(s.media.mediaText);
    fontLink(s.href);
    try { scanRules(s.cssRules, s.href || document.baseURI, live && !s.disabled && matchesMedia(s.media)); } catch {
      unreadable.push(s.href || '(inline)');
      if (!(s.href && FONT_HOST.test(s.href))) varsUnreadable++;
    }
  };
  // R62 token props: IR key -> [computed longhand(s) compared, declared properties (longhand or shorthand) whose
  // var() can set it]. Physical sides assume horizontal-tb ltr.
  const TOK = {
    bg: [['background-color'], ['background-color', 'background']], color: [['color'], ['color']],
    borderT: [['border-top-color'], ['border-top-color', 'border-color', 'border-top', 'border-block-start', 'border-block', 'border']],
    borderR: [['border-right-color'], ['border-right-color', 'border-color', 'border-right', 'border-inline-end', 'border-inline', 'border']],
    borderB: [['border-bottom-color'], ['border-bottom-color', 'border-color', 'border-bottom', 'border-block-end', 'border-block', 'border']],
    borderL: [['border-left-color'], ['border-left-color', 'border-color', 'border-left', 'border-inline-start', 'border-inline', 'border']],
    radius: [['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'], ['border-radius']],
    shadow: [['box-shadow'], ['box-shadow']],
    fontSize: [['font-size'], ['font-size', 'font']], fontFamily: [['font-family'], ['font-family', 'font']],
    fontWeight: [['font-weight'], ['font-weight', 'font']], lineHeight: [['line-height'], ['line-height', 'font']],
    letterSpacing: [['letter-spacing'], ['letter-spacing']],
    paddingT: [['padding-top'], ['padding-top', 'padding-block-start', 'padding-block', 'padding']],
    paddingR: [['padding-right'], ['padding-right', 'padding-inline-end', 'padding-inline', 'padding']],
    paddingB: [['padding-bottom'], ['padding-bottom', 'padding-block-end', 'padding-block', 'padding']],
    paddingL: [['padding-left'], ['padding-left', 'padding-inline-start', 'padding-inline', 'padding']],
    gap: [['column-gap', 'row-gap'], ['gap', 'column-gap', 'row-gap']],
    width: [['width'], ['width']], height: [['height'], ['height']], opacity: [['opacity'], ['opacity']],
    fill: [['fill'], ['fill']], stroke: [['stroke'], ['stroke']],
  };
  const TOK_DECL = [...new Set(Object.values(TOK).flatMap((t) => t[1]))];
  const ANY_OF = new Set(['gap']); // equal to any one computed longhand (the others: to all of them)
  const TEXT_TOK = ['color', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing'];
  const ICON_TOK = ['color', 'fill', 'stroke', 'fontSize'];
  const INHERITED_TOK = new Set([...TEXT_TOK, 'fill', 'stroke']);
  const BOX_TOK = Object.keys(TOK).filter((k) => !INHERITED_TOK.has(k));
  // var() uses in a declared value: simple names, or complex (a var inside a function, or nested in a fallback)
  const varsIn = (v) => {
    const names = []; let complex = false; const stack = [];
    for (let i = 0; i < v.length; i++) {
      const ch = v[i];
      if (ch === '(') {
        const fn = (/([\w-]*)$/.exec(v.slice(0, i)) || ['', ''])[1].toLowerCase();
        if (fn === 'var' && !stack.length) {
          let d = 1, j = i + 1;
          for (; j < v.length && d; j++) { if (v[j] === '(') d++; else if (v[j] === ')') d--; }
          const inner = v.slice(i + 1, j - 1); const c = inner.indexOf(',');
          if (c >= 0 && /var\(/i.test(inner.slice(c))) complex = true;
          names.push((c >= 0 ? inner.slice(0, c) : inner).trim());
          i = j - 1; continue;
        }
        if (fn === 'var') complex = true;
        stack.push(fn);
      } else if (ch === ')') stack.pop();
    }
    return { names, complex };
  };
  // specificity of a selector (approximate: :is/:not/:has count as one pseudo-class)
  const splitTop = (s) => {
    const out = []; let d = 0, st = 0;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if (c === ',' && !d) { out.push(s.slice(st, i)); st = i + 1; } }
    out.push(s.slice(st)); return out.map((x) => x.trim()).filter(Boolean);
  };
  const specOf = (s) => {
    s = s.replace(/:where\([^)]*\)/g, '');
    const a = (s.match(/#[\w-]+/g) || []).length;
    const b = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
    const c = (s.replace(/\[[^\]]*\]|\([^)]*\)/g, '').match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
    return a * 1e6 + b * 1e3 + c;
  };
  function varDecls(style, sel, live, order, inlineEl = null) {
    for (let i = 0; i < style.length; i++) if (style[i].startsWith('--')) varNames.add(style[i]);
    if (!live) return;
    const decls = [];
    for (const p of TOK_DECL) {
      const v = style.getPropertyValue(p);
      if (!v || !/var\(/i.test(v)) continue;
      decls.push({ p, ...varsIn(v), imp: style.getPropertyPriority(p) === 'important' });
    }
    if (decls.length) varRules.push({ sel, decls, order, inlineEl, parts: sel ? splitTop(sel) : null });
  }

  for (const s of document.styleSheets) readSheet(s);
  if (wantVars) {
    // inline style attributes of the screens and their ancestors (read before any capture edit adds inline styles)
    const seen = new Set();
    for (const r of roots) {
      for (let a = r.parentElement; a; a = a.parentElement) if (!seen.has(a)) { seen.add(a); if (a.getAttribute('style')) varDecls(a.style, null, true, Infinity, a); }
      for (const el of [r, ...r.querySelectorAll('[style]')]) if (!seen.has(el) && el.getAttribute('style')) { seen.add(el); varDecls(el.style, null, true, Infinity, el); }
    }
  }

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
    // R39 paint order: positioned elements (and z-indexed flex/grid items) paint in CSS stacking order, not DOM order
    if (cs.position !== 'static') p.pos = cs.position;
    if (cs.zIndex !== 'auto' && (cs.position !== 'static' || (el && el.parentElement && /flex|grid/.test(getComputedStyle(el.parentElement).display)))) {
      p.z = Number(cs.zIndex);
    }
    if (cs.textDecorationLine && cs.textDecorationLine !== 'none') p.textDecoration = cs.textDecorationLine;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') p.clip = true;
    const tf = el && tfs.get(el);
    if (tf) p.transform = tf;
    if (cs.filter !== 'none') p.filter = cs.filter;
    if (cs.clipPath !== 'none') p.clipPath = cs.clipPath;
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) p.outline = `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`;
    const un = unsupported(cs, el, p);
    if (un.length) p.unsupported = un;
    return p;
  };
  // R46: paint-affecting properties capture does not translate, with their initial values. A non-initial value is
  // listed as {prop, value} (verify: data finding 'unsupported', unless the node is rasterised). Inherited text
  // properties are listed only where they are set (value differs from the parent's), not on every descendant.
  const topComma = (v) => { let d = 0; for (const ch of v) { if (ch === '(') d++; else if (ch === ')') d--; else if (ch === ',' && !d) return true; } return false; };
  const unsupported = (cs, el, p) => {
    const out = [];
    const pcs = el && el.parentElement ? getComputedStyle(el.parentElement) : null;
    const set = (k) => !pcs || pcs[k] !== cs[k];
    const add = (prop, value) => out.push({ prop, value: String(value) });
    // inherited text paint
    if (cs.textShadow && cs.textShadow !== 'none' && set('textShadow')) add('text-shadow', cs.textShadow);
    if (cs.webkitTextStrokeWidth && parseFloat(cs.webkitTextStrokeWidth) > 0 && set('webkitTextStrokeWidth')) add('-webkit-text-stroke', `${cs.webkitTextStrokeWidth} ${cs.webkitTextStrokeColor}`);
    if (cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && (!pcs || pcs.webkitTextFillColor === pcs.color || set('webkitTextFillColor'))) add('-webkit-text-fill-color', cs.webkitTextFillColor);
    if (cs.fontFeatureSettings && cs.fontFeatureSettings !== 'normal' && set('fontFeatureSettings')) add('font-feature-settings', cs.fontFeatureSettings);
    for (const [k, prop] of [['fontVariantCaps', 'font-variant-caps'], ['fontVariantNumeric', 'font-variant-numeric'], ['fontVariantLigatures', 'font-variant-ligatures'],
      ['fontVariantEastAsian', 'font-variant-east-asian'], ['fontVariantAlternates', 'font-variant-alternates'], ['fontVariantPosition', 'font-variant-position']]) {
      if (cs[k] && cs[k] !== 'normal' && set(k)) add(prop, cs[k]);
    }
    // own paint / effects
    if (cs.backdropFilter && cs.backdropFilter !== 'none') add('backdrop-filter', cs.backdropFilter);
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') add('mix-blend-mode', cs.mixBlendMode);
    if (cs.backgroundBlendMode && cs.backgroundBlendMode !== 'normal') add('background-blend-mode', cs.backgroundBlendMode);
    const mask = (cs.maskImage && cs.maskImage !== 'none' && cs.maskImage) || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none' && cs.webkitMaskImage);
    if (mask) add('mask', mask);
    if (cs.borderImageSource && cs.borderImageSource !== 'none') add('border-image', cs.borderImageSource);
    if (p.outline && cs.outlineOffset && parseFloat(cs.outlineOffset) !== 0) add('outline-offset', cs.outlineOffset);
    if (cs.textOverflow && cs.textOverflow !== 'clip') add('text-overflow', cs.textOverflow);
    if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') add('-webkit-line-clamp', cs.webkitLineClamp);
    if (cs.display === 'list-item' && (cs.listStyleType !== 'none' || cs.listStyleImage !== 'none')) add('list-marker', `${cs.listStyleType} ${cs.listStyleImage}`.replace(/ none$/, ''));
    const clip = cs.backgroundClip || cs.webkitBackgroundClip;
    if (clip === 'text') add('background-clip', clip);
    else if ((p.bg || p.bgImage) && clip && clip !== 'border-box') add('background-clip', clip);
    if (p.bgImage) {
      if (topComma(p.bgImage)) add('background-image (layers)', p.bgImage);
      if (!/^auto( auto)?$/.test(cs.backgroundSize)) add('background-size', cs.backgroundSize);
      if (!/^0% 0%$/.test(cs.backgroundPosition)) add('background-position', cs.backgroundPosition);
      if (cs.backgroundRepeat !== 'repeat') add('background-repeat', cs.backgroundRepeat);
    }
    return out;
  };
  // R48: an inline svg is drawn by the proxy (and Figma) from its markup alone, without the page's stylesheet. The
  // markup is cloned into an isolated shadow root (no page CSS; the svg root styled as the proxy styles it: color,
  // fill, stroke, stroke-width from icon), and each element's computed paint is compared with the page's: every
  // carried property that differs is inlined into the clone's style attribute (document order, so children see their
  // parent's inlined values). Then every checked property is compared again: what still differs (a page CSS transform,
  // geometry, filter, mask, clip-path, marker, blend on an inner element ...) is not carried and is returned as
  // unsupported ({prop: 'svg <tag> <property>', value}). Transforms are read with the capture's no-transform sheet off.
  // The serialised root keeps only inlined carried paint in its style (no box styles); the proxy appends it to its own.
  const SVG_CARRY = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity',
    'lighting-color', 'clip-rule', 'paint-order', 'vector-effect', 'shape-rendering', 'visibility', 'display', 'color'];
  const SVG_TEXT = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'letter-spacing', 'word-spacing',
    'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'text-decoration-line', 'white-space', 'writing-mode', 'direction'];
  const SVG_ONLY_CHECK = ['transform', 'transform-origin', 'transform-box', 'filter', 'mask', 'clip-path', 'mix-blend-mode', 'isolation',
    'marker-start', 'marker-mid', 'marker-end', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd'];
  const SVG_ROOT = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'clip-rule', 'paint-order', 'shape-rendering', 'color']);
  const SVG_TEXT_TAGS = /^(text|tspan|textPath)$/;
  const SVG_INHERITED = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'clip-rule', 'paint-order', 'shape-rendering', 'visibility', 'color',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'letter-spacing', 'word-spacing', 'text-anchor',
    'dominant-baseline', 'white-space', 'writing-mode', 'direction']);
  const serialiseSvg = (el, icon) => {
    const notfEl = document.getElementById('__vd_notf');
    if (notfEl) notfEl.disabled = true;
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:absolute;left:-99999px;top:0;width:400px;height:400px';
    document.body.appendChild(host);
    const sh = host.attachShadow({ mode: 'open' });
    const clone = el.cloneNode(true);
    // the root's own inline style is the node's box (proxy: width/height 100%); its paint is in icon
    clone.removeAttribute('style');
    const rootStyle = [['color', icon.color], ['fill', icon.fill], ['stroke', icon.stroke], ['stroke-width', icon.sw]];
    for (const [k, v] of rootStyle) if (v) clone.style.setProperty(k, v);
    sh.appendChild(clone);
    const O = [el, ...el.querySelectorAll('*')], C = [clone, ...clone.querySelectorAll('*')];
    const un = [];
    if (O.length === C.length) {
      const propsOf = (i, check) => {
        const tag = O[i].tagName;
        if (i === 0) return SVG_CARRY.filter((k) => SVG_ROOT.has(k));
        const ps = [...SVG_CARRY, ...(SVG_TEXT_TAGS.test(tag) ? SVG_TEXT : [])];
        return check ? [...ps, ...SVG_ONLY_CHECK] : ps;
      };
      for (let i = 0; i < O.length; i++) {
        const oc = getComputedStyle(O[i]), cc = getComputedStyle(C[i]);
        for (const k of propsOf(i, false)) {
          const v = oc.getPropertyValue(k);
          if (v !== cc.getPropertyValue(k)) C[i].style.setProperty(k, v);
        }
      }
      for (let i = 0; i < O.length; i++) {
        const oc = getComputedStyle(O[i]), cc = getComputedStyle(C[i]);
        for (const k of propsOf(i, true)) {
          const v = oc.getPropertyValue(k);
          if (v !== cc.getPropertyValue(k)) un.push({ prop: `svg ${O[i].tagName} ${k}`, value: v });
        }
      }
    } else un.push({ prop: 'svg markup', value: 'clone differs from the page' });
    for (const [k] of rootStyle) clone.style.removeProperty(k); // the proxy sets these from icon
    if (!clone.getAttribute('style')) clone.removeAttribute('style');
    // R54: <use> targets outside this svg (a page sprite) are inlined as a leading <defs>, transitively, so the markup
    // draws on its own (the proxy, Figma); targets inside the svg are already in it
    const refOf = (x) => (x.getAttribute('href') || x.getAttribute('xlink:href') || '').replace(/^#/, '');
    const defs = [], seen = new Set();
    for (let todo = [...clone.querySelectorAll('use')]; todo.length;) {
      const id = refOf(todo.shift());
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (el.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
      const t = document.getElementById(id);
      if (!t) { un.push({ prop: 'svg use', value: `#${id} not found` }); continue; }
      const c = t.cloneNode(true); defs.push([t, c]); todo.push(...c.querySelectorAll('use'));
    }
    if (defs.length) { const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); defs.forEach(([, x]) => d.appendChild(x)); clone.insertBefore(d, clone.firstChild); }
    // M-e: page CSS on an inlined target is carried / reported like page CSS inside the svg. A <use> instance inherits
    // from the <use>, not from where the target sits in the page, so an inherited property counts only where the page
    // sets it on that element itself (its value differs from its page parent's); otherwise it keeps inheriting
    // a sprite usually sits in a display:none svg, whose elements report no transform: shown offscreen while compared
    const unhid = [];
    for (const [t] of defs) {
      for (let a = t.parentElement; a; a = a.parentElement) {
        if (getComputedStyle(a).display !== 'none') continue;
        unhid.push([a, a.getAttribute('style')]);
        for (const [k, v] of [['display', 'block'], ['position', 'absolute'], ['left', '-99999px'], ['top', '0']]) a.style.setProperty(k, v, 'important');
      }
    }
    for (const [t, c] of defs) {
      const O2 = [t, ...t.querySelectorAll('*')], C2 = [c, ...c.querySelectorAll('*')];
      if (O2.length !== C2.length) { un.push({ prop: 'svg markup', value: `#${t.id}: clone differs from the page` }); continue; }
      const props = (x, check) => [...SVG_CARRY, ...(SVG_TEXT_TAGS.test(x.tagName) ? SVG_TEXT : []), ...(check ? SVG_ONLY_CHECK : [])];
      const own = (x, oc, k) => !SVG_INHERITED.has(k) || !x.parentElement || getComputedStyle(x.parentElement).getPropertyValue(k) !== oc.getPropertyValue(k);
      for (const check of [false, true]) {
        for (let i = 0; i < O2.length; i++) {
          const oc = getComputedStyle(O2[i]), cc = getComputedStyle(C2[i]);
          for (const k of props(O2[i], check)) {
            const v = oc.getPropertyValue(k);
            if (v === cc.getPropertyValue(k) || !own(O2[i], oc, k)) continue;
            if (check) un.push({ prop: `svg ${O2[i].tagName} ${k}`, value: v }); else C2[i].style.setProperty(k, v);
          }
        }
      }
    }
    for (const [a, st] of unhid.reverse()) { if (st === null) a.removeAttribute('style'); else a.setAttribute('style', st); }
    const svg = clone.outerHTML;
    host.remove();
    if (notfEl) notfEl.disabled = false;
    return { svg, un };
  };
  // R47: authored % of an absolutely positioned element's insets and size ({l, r, t, b, w, h}: the computed value,
  // e.g. '52%' or 'calc(50% - 4px)', only where it contains a %). Computed styles report px for a rendered element;
  // with display:none the resolved value is the computed one, so the element is hidden for the read and restored.
  const PCT_PROPS = [['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom'], ['w', 'width'], ['h', 'height']];
  const authoredPct = (el) => {
    if (!el.style || !/^(absolute|fixed)$/.test(getComputedStyle(el).position)) return null;
    const st = el.style, had = st.getPropertyValue('display'), pri = st.getPropertyPriority('display'), attr = el.getAttribute('style');
    st.setProperty('display', 'none', 'important');
    const cs = getComputedStyle(el), out = {};
    for (const [k, prop] of PCT_PROPS) { const v = cs.getPropertyValue(prop); if (v.includes('%')) out[k] = v; }
    if (attr === null) el.removeAttribute('style'); else if (had) st.setProperty('display', had, pri); else st.removeProperty('display');
    return Object.keys(out).length ? out : null;
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

  // R62: which var() declarations apply to which element (screens and their ancestors only), with cascade rank
  // [important, inline, specificity, source order]; complex declarations are only counted
  const tokCands = new Map(); const complexHits = [];
  if (wantVars && varRules.length) {
    const anc = new Set();
    for (const r of roots) for (let a = r.parentElement; a; a = a.parentElement) anc.add(a);
    const inScope = (el) => anc.has(el) || roots.some((r) => r.contains(el));
    for (const vr of varRules) {
      let hits = [];
      if (vr.inlineEl) { if (inScope(vr.inlineEl)) hits = [[vr.inlineEl, 0]]; } else {
        const found = new Set();
        for (const r of roots) {
          try { for (const el of r.querySelectorAll(vr.sel)) found.add(el); if (r.matches(vr.sel)) found.add(r); } catch { /* unsupported selector */ }
        }
        for (const a of anc) { try { if (a.matches(vr.sel)) found.add(a); } catch { /* unsupported selector */ } }
        for (const el of found) {
          let best = -1;
          for (const part of vr.parts) { try { if (el.matches(part)) best = Math.max(best, specOf(part)); } catch { /* skip */ } }
          if (best >= 0) hits.push([el, best]);
        }
      }
      for (const d of vr.decls) {
        if (d.complex) { for (const [el] of hits) complexHits.push([d, el]); continue; }
        const keys = Object.keys(TOK).filter((k) => TOK[k][1].includes(d.p));
        for (const [el, spec] of hits) {
          let m = tokCands.get(el); if (!m) tokCands.set(el, m = {});
          const rank = [d.imp ? 1 : 0, vr.inlineEl ? 1 : 0, spec, vr.order];
          for (const k of keys) for (const name of d.names) (m[k] ||= []).push({ name, rank });
        }
      }
    }
  }
  // a var's value normalised as a computed value of prop: set on a probe in an isolated shadow root (no page CSS)
  // with the element's font-size (em) and color (currentColor), read back computed
  const normCache = new Map();
  const normVal = (prop, value, cs) => {
    const key = `${prop}|${value}|${cs.fontSize}|${cs.color}`;
    if (normCache.has(key)) return normCache.get(key);
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:absolute;left:-99999px;top:0';
    document.documentElement.appendChild(host);
    const pr = document.createElement('div');
    host.attachShadow({ mode: 'open' }).appendChild(pr);
    pr.style.cssText = `position:absolute;font-size:${cs.fontSize};color:${cs.color}`;
    pr.style.setProperty(prop, value);
    const out = pr.style.getPropertyValue(prop) === '' ? null : getComputedStyle(pr).getPropertyValue(prop);
    host.remove();
    normCache.set(key, out);
    return out;
  };
  const tokMatch = (k, name, cs) => {
    const raw = cs.getPropertyValue(name).trim();
    if (!raw) return false;
    const longs = TOK[k][0];
    const nv = normVal(longs[0], raw, cs);
    if (nv == null) return false;
    const vals = longs.map((p) => cs.getPropertyValue(p));
    return ANY_OF.has(k) ? vals.includes(nv) : vals.every((v) => v === nv);
  };
  const cmpRank = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };
  // every token prop of an element: its own winning var() whose value equals the computed value, else (inherited
  // props) the parent's token when the computed value is the parent's
  const tokCache = new Map();
  const tokOf = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (tokCache.has(el)) return tokCache.get(el);
    const cs = getComputedStyle(el); const out = {};
    const m = tokCands.get(el);
    if (m) for (const k of Object.keys(m)) {
      const list = [...m[k]].sort((a, b) => cmpRank(a.rank, b.rank));
      const hit = list.find((c) => tokMatch(k, c.name, cs));
      if (hit) out[k] = hit.name;
    }
    const pt = tokOf(el.parentElement);
    if (pt) {
      const pcs = getComputedStyle(el.parentElement);
      for (const k of INHERITED_TOK) {
        if (!out[k] && pt[k] && TOK[k][0].every((p) => cs.getPropertyValue(p) === pcs.getPropertyValue(p))) out[k] = pt[k];
      }
    }
    const res = Object.keys(out).length ? out : null;
    tokCache.set(el, res);
    return res;
  };
  const pickTok = (t, keys) => {
    if (!t) return null;
    const o = {}; for (const k of keys) if (t[k]) o[k] = t[k];
    return Object.keys(o).length ? o : null;
  };
  // frames carry box tokens, text nodes also text tokens, icons also paint tokens; a frame's own text child ('.t')
  // gets the text tokens
  const attachTok = (n, el) => {
    const t = tokOf(el); if (!t) return;
    const own = pickTok(t, [...BOX_TOK, ...(n.runs ? TEXT_TOK : n.kind === 'icon' ? ICON_TOK : [])]);
    if (own) n.tok = own;
    const k0 = n.kids && n.kids[0];
    if (k0 && k0.id === n.id + '.t') { const tt = pickTok(t, TEXT_TOK); if (tt) k0.tok = tt; }
  };

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
      if (res && !Array.isArray(res)) { const pc = authoredPct(el); if (pc) res.pct = pc; }
      if (wantVars && res && !Array.isArray(res)) attachTok(res, el);
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
        // R54: a sprite reference only when the svg consists of exactly one <use>; any other svg (a <use> next to its own
        // shapes included) is serialised whole, its <use> targets inlined
        const inner = [...el.querySelectorAll('*')];
        const u = inner.length === 1 && inner[0].tagName.toLowerCase() === 'use' ? inner[0] : null;
        const href = u ? (u.getAttribute('href') || u.getAttribute('xlink:href') || '') : '';
        const icon = { ref: href ? href.replace(/^.*#/, '') : null, color: cs.color, fill: cs.fill, stroke: cs.stroke, sw: cs.strokeWidth };
        if (!u) {
          const sv = serialiseSvg(el, icon);
          icon.svg = sv.svg;
          if (sv.un.length) p.unsupported = [...(p.unsupported || []), ...sv.un];
        } else if (icon.ref) iconRefs.add(icon.ref);
        return { ...base(id, 'icon', tag, cls, r, p), icon };
      }
      if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'iframe' || tag === 'picture') {
        if (b.width < 0.5 || b.height < 0.5) { excl(id, 'zero-size'); return null; }
        const img = tag === 'picture' ? el.querySelector('img') : el;
        const ics = img && img !== el ? getComputedStyle(img) : cs; // a <picture> is drawn by its <img>
        // R59: a Figma image fill reproduces object-fit cover / contain / fill (FILL / FIT / stretch) at the centre only
        const off = [!['cover', 'contain', 'fill'].includes(ics.objectFit) && `object-fit ${ics.objectFit}`,
          ics.objectPosition !== '50% 50%' && `object-position ${ics.objectPosition}`].filter(Boolean);
        if (off.length) p.unsupported = [...(p.unsupported || []), { prop: 'image fit/position', value: off.join(', ') }];
        return { ...base(id, 'image', tag, cls, r, p), src: (img && (img.currentSrc || img.src)) || null, fit: ics.objectFit, pos: ics.objectPosition };
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
          const tn = { ...base(cid, 'text', '#text', '', rb.box, {}), font: f, runs: [{ t }], lines: rb.lines, tw: rb.tw };
          const tt = wantVars && pickTok(tokOf(el), TEXT_TOK); if (tt) tn.tok = tt;
          out.push(tn);
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
    const cx = new Set(); for (const [d, el] of complexHits) if (root.contains(el)) cx.add(d);
    return { W: rnd(R.width), H: rnd(R.height), tree, excluded, fonts: [...fonts], fontsRendered, name, svgDefs, varsComplex: cx.size };
  });
  const out = { count: roots.length, screens, mediaTexts, unreadable, fontCss };
  if (wantVars) {
    const rcs = getComputedStyle(document.documentElement);
    out.vars = Object.fromEntries([...varNames].map((k) => [k, rcs.getPropertyValue(k).trim()]));
    out.varsUnreadable = varsUnreadable;
  }
  return out;
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
  // every weight/style the page uses must render in the target, or the target counts as failed
  const probe = (st, fam, fb) => { ctx.font = `${st} 72px "${fam}", ${fb}`; const a = ctx.measureText(probeText).width; ctx.font = `${st} 72px ${fb}`; return a !== ctx.measureText(probeText).width; };
  // a family with @font-face rules needs a loaded face whose weight range and style cover the use (Chrome would
  // otherwise synthesise bold/italic from another face); an installed family needs check + width probe
  const covers = (f, ital, w) => {
    const [lo, hi = lo] = String(f.weight).split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
    return w >= lo && w <= hi && (ital ? /italic|oblique/.test(f.style) : !/italic|oblique/.test(f.style));
  };
  const faceOK = (fam, ital, w) => {
    const own = [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === fam);
    if (own.length) return own.some((f) => f.status === 'loaded' && covers(f, ital, w));
    const st = `${ital ? 'italic ' : ''}${w}`;
    return document.fonts.check(`${st} 16px "${fam}"`) && (probe(st, fam, 'monospace') || probe(st, fam, 'serif'));
  };
  const targets = [...new Set(Object.values(map))];
  const failed = targets.filter((f) => !faces.filter(([fam]) => fam === f).every(([fam, ital, w]) => faceOK(fam, ital, w)));
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

const ICON_FAMILY = /Material (Symbols|Icons)/i;

// In page: which families have a web face (@font-face rule or font link) in this document
function webFacesIn({ fams }) {
  const clean = (f) => f.replace(/^["']|["']$/g, '');
  const have = new Set([...document.fonts].map((f) => clean(f.family).toLowerCase()));
  return Object.fromEntries(fams.map((f) => [f, have.has(f.toLowerCase())]));
}

// In page (R41): add a Google Fonts link per family and load each used face. A family whose faces do not all load is
// rolled back (link removed) so the local copy renders again. Returns the families rolled back.
async function loadWebFaces({ jobs, timeoutMs }) {
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(r, timeoutMs))]);
  const els = {};
  await within(Promise.all(jobs.map(([fam, href]) => new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = l.onerror = () => res();
    els[fam] = l; document.head.appendChild(l);
  }))));
  await within(Promise.all(jobs.flatMap(([fam, , faces]) => faces.map(([ital, w]) => document.fonts.load(`${ital ? 'italic ' : ''}${w} 16px "${fam}"`).catch(() => null)))));
  const covers = (f, ital, w) => {
    const [lo, hi = lo] = String(f.weight).split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
    return w >= lo && w <= hi && (ital ? /italic|oblique/.test(f.style) : !/italic|oblique/.test(f.style));
  };
  const failed = [];
  for (const [fam, , faces] of jobs) {
    const own = [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === fam);
    if (!faces.every(([ital, w]) => own.some((f) => f.status === 'loaded' && covers(f, ital, w)))) { failed.push(fam); els[fam].remove(); }
  }
  await document.fonts.ready;
  return failed;
}

const fontsLink = (fam, tuples) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:ital,wght@` +
  `${[...tuples].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(';')}&display=swap`;

// Plan and apply the override on a loaded page -> per root [{from, to, reason}] (reason 'override-failed', with
// cause = the original reason, when the target did not render; those lists keep their original font).
async function overrideFonts(page, rootSel, fo) {
  const { perRoot, rendered, styles } = await page.evaluate(collectFonts, { rootSel, probeText: PROBE_TEXT });
  const map = {}; const subOf = {}; const keep = {};
  for (const list of Object.keys(rendered)) {
    const r = resolveFamily(fo.fontMap, list, rendered[list]);
    if (r.sub) { map[list] = r.ff; subOf[list] = r.sub; } else if (r.ff && !ICON_FAMILY.test(r.ff)) keep[list] = r.ff;
  }
  const targets = [...new Set(Object.values(map))];
  // R41: a family Figma has must render from its Google Fonts face (the face the proxy and Figma use), not from a
  // local install of possibly another version. Families the page has no @font-face / font link for get the Google
  // face first (same family name, so it shadows the local copy). Kept families are reported as 'version'
  // ('version-failed' when the face did not load: the local copy stays, as in the proxy without network).
  const versionOf = {};
  if (fo.webFonts !== false) {
    const fams = [...new Set([...Object.values(keep), ...targets])];
    const web = await page.evaluate(webFacesIn, { fams });
    const local = fams.filter((f) => !web[f]);
    const already = local.length ? await page.evaluate(rendersInPage, { fams: local, probeText: PROBE_TEXT }) : {};
    const todo = local.filter((f) => already[f]);
    if (todo.length) {
      const tuples = {};
      for (const [list, f] of [...Object.entries(keep), ...Object.entries(map)]) if (todo.includes(f)) for (const t of styles[list] || ['0,400']) (tuples[f] ||= new Set()).add(t);
      const jobs = todo.map((f) => [f, fontsLink(f, tuples[f]), [...tuples[f]].map((t) => [+t.split(',')[0], +t.split(',')[1]])]);
      const vFailed = await page.evaluate(loadWebFaces, { jobs, timeoutMs: fo.timeoutMs ?? 15000 });
      for (const f of todo) if (Object.values(keep).includes(f)) versionOf[f] = vFailed.includes(f) ? 'version-failed' : 'version';
    }
  }
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
      if (keep[l] && versionOf[keep[l]]) {
        const e = { from: keep[l], to: keep[l], reason: versionOf[keep[l]] }, k = `${e.from}|${e.to}|${e.reason}`;
        if (!seen.has(k)) { seen.add(k); out.push(e); }
      }
      const sub = subOf[l]; if (!sub) continue;
      const e = failed.includes(sub.to) ? { ...sub, reason: 'override-failed', cause: sub.reason } : sub;
      const k = `${e.from}|${e.to}|${e.reason}`;
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
    return out;
  });
}

// Screenshot of every root, shot alone (R40: siblings of the root path hidden). Ancestors of the roots paint nothing
// and the page is white (as in the proxy), so what
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
  for (let i = 0; i < n; i++) {
    // R40: shoot the root alone. Every sibling of the root and of each ancestor gets opacity 0 (layout unchanged;
    // opacity hides a whole subtree, unlike visibility), so a neighbour screen that overlaps the widened root, or
    // any other content painted over it, does not end up in its image. Restored right after.
    await page.evaluate(([sel, i]) => {
      const r = document.querySelectorAll(sel)[i]; const hid = [];
      for (let a = r; a && a.parentElement; a = a.parentElement) {
        for (const s of a.parentElement.children) {
          if (s === a) continue;
          hid.push([s, s.style.getPropertyValue('opacity'), s.style.getPropertyPriority('opacity')]);
          s.style.setProperty('opacity', '0', 'important');
        }
      }
      window.__vdHid = hid;
    }, [rootSel, i]);
    out.push(await loc.nth(i).screenshot({ animations: 'disabled' }));
    await page.evaluate(() => {
      for (const [s, v, p] of window.__vdHid || []) { if (v) s.style.setProperty('opacity', v, p); else s.style.removeProperty('opacity'); }
      window.__vdHid = null;
    });
  }
  // fractional part of each root's page position: Chrome snaps glyphs to the pixel grid in page coordinates, so the
  // proxy must put its root at the same fraction to rasterise text the same way (renderProxy opts.origin)
  out.origin = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((r) => {
    const b = r.getBoundingClientRect(); const x = b.left + scrollX, y = b.top + scrollY;
    return [Math.round((x - Math.floor(x)) * 1e4) / 1e4, Math.round((y - Math.floor(y)) * 1e4) / 1e4];
  }), rootSel);
  return out;
}

// In page (R14): every element (and ::before/::after with content) inside a root whose computed line-height is
// 'normal' and that contains text gets an explicit px line-height equal to its measured single-line height (the
// value capture uses for 'normal' anyway, as in spike 2). Figma has no 'normal': with an explicit value the source
// places glyphs the way the proxy and Figma do. Returns the number of elements changed per root.
function normalizeLineHeight({ rootSel }) {
  const cache = {};
  // single-line height under 'normal' for this font and this text (glyphs from fallback fonts, e.g. for
  // diacritics, can make the line box taller than a plain 'Hg' probe)
  const lineH = (cs, text) => {
    const t = ('Hg' + (text || '').replace(/\s+/g, ' ').trim()).slice(0, 80);
    const key = `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.fontStyle}|${t}`;
    if (cache[key] == null) {
      const p = document.createElement('div');
      p.style.cssText = `position:absolute;visibility:hidden;font-family:${cs.fontFamily};font-size:${cs.fontSize};` +
        `font-weight:${cs.fontWeight};font-style:${cs.fontStyle};line-height:normal;white-space:nowrap`;
      p.textContent = t; document.body.appendChild(p); cache[key] = p.getBoundingClientRect().height; p.remove();
    }
    return cache[key];
  };
  const sets = []; const rules = []; const counts = [];
  for (const r of document.querySelectorAll(rootSel)) {
    let n = 0;
    for (const el of [r, ...r.querySelectorAll('*')]) {
      if (el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.lineHeight === 'normal' && el.textContent.trim()) { sets.push([el, lineH(cs, el.textContent)]); n++; }
      for (const w of ['before', 'after']) {
        const ps = getComputedStyle(el, '::' + w);
        if (ps.content && ps.content !== 'none' && ps.content !== 'normal' && ps.lineHeight === 'normal') {
          const k = `vdLh${w[0]}${rules.length}`;
          const txt = (/^"(.*)"$/s.exec(ps.content) || [])[1] || '';
          rules.push([el, k, `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}]::${w}{line-height:${lineH(ps, txt)}px!important}`]); n++;
        }
      }
    }
    counts.push(n);
  }
  // write only after every computed style was read
  for (const [el, h] of sets) el.style.setProperty('line-height', `${h}px`, 'important');
  for (const [el, k] of rules) el.dataset[k] = '1';
  if (rules.length) { const st = document.createElement('style'); st.id = '__vd_lh'; st.textContent = rules.map((x) => x[2]).join('\n'); document.head.appendChild(st); }
  return counts;
}

const validSelector = (page, sel) => page.evaluate((s) => { try { document.querySelectorAll(s); return true; } catch { return false; } }, sel);

// png: also screenshot every root (clipped to the root, device scale 2) after measuring, so the image shows the same
// widened layout and fonts the boxes were measured on. Used by verify (Task 6) for crops and pixel %.
// fo (font override): before measuring, families Figma would substitute are replaced by the Figma family. With
// original and png: the roots are also shot before any override (original fonts and line heights).
// lho (R14): line-height 'normal' made explicit after the font override (the normal height depends on the font).
async function measure(browser, url, args, width, png = false, fo = null, lho = false, original = false) {
  const page = await browser.newPage({ viewport: { width: Math.round(width), height: VIEWPORT_HEIGHT }, deviceScaleFactor: 2 });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => 0));
    let pngOriginal = null, fontSubs = null, lhCounts = null;
    if ((fo || lho) && await validSelector(page, args.rootSel)) {
      if (png && original) pngOriginal = await shootRoots(page, args.rootSel);
      if (fo) fontSubs = await overrideFonts(page, args.rootSel, fo);
      if (lho) lhCounts = await page.evaluate(normalizeLineHeight, { rootSel: args.rootSel });
    }
    const res = await page.evaluate(measurePage, args);
    if (fontSubs) res.fontSubs = fontSubs;
    if (lhCounts) res.lhCounts = lhCounts;
    if (pngOriginal) res.pngOriginal = pngOriginal;
    if (png && res.count && res.screens) { res.png = await shootRoots(page, args.rootSel); res.origin = res.png.origin; }
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
  if (a.src !== undefined) { n.src = a.src; n.fit = a.fit; n.pos = a.pos; }
  if (a.approx) n.approx = true;
  if (a.flex) n.flex = a.flex;
  if (a.pct) n.pct = a.pct;
  if (a.flexBox) n.flexBox = a.flexBox;
  if (a.tok) n.tok = a.tok;
  if (a.kids) n.kids = a.kids.map((k) => mergeNode(k, mapB));
  return n;
}

export async function captureScreens(htmlPath, opts = {}) {
  const { root, widen, widenBy = 120, nameOf, viewport = DEFAULT_VIEWPORT, png = false, fontOverride = true, lineHeightOverride = true } = opts;
  const lho = !!lineHeightOverride;
  const fo = fontOverride ? { fontMap: opts.fontMap || defaultFontMap(), webFonts: opts.webFonts !== false, timeoutMs: opts.fontTimeoutMs } : null;
  if (!root) throw new Error('captureScreens: thiếu opts.root (selector của màn)');
  if (!(widenBy > 0)) throw new Error(`captureScreens: widenBy phải > 0 (nhận ${widenBy})`);
  if (!(viewport > 0)) throw new Error(`captureScreens: viewport phải > 0 (nhận ${viewport})`);
  const abs = resolve(htmlPath);
  if (!existsSync(abs)) throw new Error(`không đọc được file HTML: ${abs}`);
  const url = pathToFileURL(abs).href;
  const args = { rootSel: root, widenSel: widen || null, nameOf: nameOf || null, extras: null, vars: true };

  const browser = await launchBrowser();
  try {
    const A = await measure(browser, url, args, viewport, png, fo, lho, true);
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
      const res = await measure(browser, url, { ...args, vars: false, extras: widens.map((w, i) => (bound[i] === forBound && !forBound ? w.by : 0)) },
        forBound ? viewport + boundWiden.by : viewport, png, fo, lho);
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
      // R62: vars declared by the page, value at :root, uses = token props in this screen's IR naming it
      const tree = mergeNode(sA.tree, mapB);
      const uses = {};
      const countTok = (n) => { for (const v of Object.values(n.tok || {})) uses[v] = (uses[v] || 0) + 1; (n.kids || []).forEach(countTok); };
      countTok(tree);
      const declared = A.vars || {};
      const vars = Object.fromEntries([...new Set([...Object.keys(declared), ...Object.keys(uses)])].sort()
        .map((k) => [k, { value: declared[k] ?? '', uses: uses[k] || 0 }]));
      return {
        id, name: sA.name || id, W: [r2(sA.W), r2(sB.W)], H: [r2(sA.H), r2(sB.H)], widen: widens[i],
        tree, vars, varsComplex: sA.varsComplex || 0, varsUnreadable: A.varsUnreadable || 0, excluded, fonts: [...new Set([...sA.fonts, ...sB.fonts])], fontsRendered: { ...sA.fontsRendered, ...sB.fontsRendered },
        svgDefs: { ...sA.svgDefs, ...sB.svgDefs }, fontCss: A.fontCss,
        ...(png ? { png: [A.png[i], pngB(i)], origin: [A.origin[i], (bound[i] ? Bbound : Bfree).origin[i]] } : {}),
        ...(fo ? { fontSubs: subsOf(i) } : {}),
        ...(png && A.pngOriginal ? { pngOriginal: A.pngOriginal[i] } : {}),
        ...(lho ? { norm: { lineHeight: (A.lhCounts || [])[i] || 0 } } : {}),
      };
    });
    return { screens };
  } finally { await browser.close(); }
}
