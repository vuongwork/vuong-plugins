#!/usr/bin/env node
// Lint (plan 5): checks one HTML file against the vd-html v1 input profile (PROFILE.md) in a few seconds, with no model.
//
//   node core/lint.mjs --html <file> [--root <sel>] [--widen <sel>] [--out <dir>] [--strict] [--log <runs.jsonl>] [--json]
//
// One page load (Chromium from browser.mjs, not capture.mjs), one in-page pass, one widening (A -> A + widenBy).
// Never modifies the source file; writes only --out/lint.json and the --log line.
// stdout is at most 15 lines (summarize); the full list is in lint.json. Exit: 0 no errors (warnings do not fail unless
// --strict), 1 errors, 2 usage or setup error.
// Finding codes are stable and documented in PROFILE.md (same numbers). Level E only for what makes the pipeline
// wrong or unable to run; W for what only lowers accuracy.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { defaultFontMap, isAvailable, isSystemFont } from './font-map.mjs';

const BROWSER_DEFAULT = /^(times new roman|times|courier new|courier|georgia|verdana|tahoma|trebuchet ms)$/i;

export const PROFILE = 'vd-html/1';
export const DEFAULT_ROOT = '[data-vd-screen]';
export const DEFAULT_WIDEN = '[data-vd-widen]';
const VIEWPORT = { width: 1400, height: 900 };
const FONT_WAIT_MS = 3000;

const LEVEL = (code) => (code.startsWith('E') ? 'error' : 'warn');

// ---------------- in-page pass (serialised into the page: must be self-contained) ----------------

function lintPage({ rootSel, widenSel, widenBy, defaultRoot }) {
  let roots;
  try { roots = [...document.querySelectorAll(rootSel)]; } catch (e) { return { badSelector: String(e.message || e) }; }
  const found = new Map(); // code|screen|msg -> { code, si, sel, msg, n }
  const add = (code, si, msg, el, root) => {
    const key = `${code}|${si}|${msg}`;
    const f = found.get(key);
    if (f) { f.n++; return; }
    found.set(key, { code, si, msg, n: 1, sel: el ? selOf(el, root) : '' });
  };
  const selOf = (el, root) => {
    const parts = [];
    let n = el;
    while (n && n !== root && n.nodeType === 1) {
      const tag = n.localName;
      let s = tag;
      const c = n.classList && n.classList[0];
      if (c) s += '.' + CSS.escape(c);
      const sibs = n.parentElement ? [...n.parentElement.children].filter((x) => x.localName === tag) : [];
      if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.slice(-4).join(' > ') || '(screen)';
  };
  const out = { count: roots.length, screens: [], findings: [], families: [], tokens: {} };
  if (!roots.length) return out;

  const attrMode = rootSel === defaultRoot;
  const ids = roots.map((r, i) => r.getAttribute('data-vd-screen') || (attrMode ? '' : `s${i}`));
  out.ids = ids;
  if (attrMode) {
    const seen = new Map();
    ids.forEach((id, i) => {
      if (!id) add('E2', i, 'empty screen id', roots[i], roots[i]);
      else if (seen.has(id)) add('E2', i, `duplicate screen id "${id}"`, roots[i], roots[i]);
      else seen.set(id, i);
    });
  }

  // ---- page level: scripts, stylesheets ----
  const okScript = /^(application\/(ld\+)?json|text\/template|text\/x-template|importmap)$/i;
  for (const s of document.querySelectorAll('script')) {
    const t = (s.getAttribute('type') || '').trim();
    if (!okScript.test(t)) add('E3', -1, `runnable script${s.src ? ' (src)' : ''}`, s, document.body);
  }
  const GFONTS = /^https?:\/\/fonts\.googleapis\.com\//;
  const sheetRules = [];
  for (const sh of document.styleSheets) {
    let rules;
    try { rules = sh.cssRules; } catch { rules = null; }
    if (!rules) {
      if (!(sh.href && GFONTS.test(sh.href))) add('E5', -1, `stylesheet cannot be read: ${sh.href || 'inline'}`, null, null);
      continue;
    }
    sheetRules.push(rules);
  }

  // ---- per-screen element pass (no DOM change) ----
  const isSvgInner = (el) => el instanceof SVGElement && el.localName !== 'svg';
  const hasOwnText = (el) => [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
  const familyMap = new Map(); // `${si}|${family}` -> { si, family, n, sel }
  const BAD_TAGS = new Set(['iframe', 'canvas', 'video', 'object', 'embed']);
  const ICONFONT = /material (icons|symbols)|font ?awesome|icomoon|glyphicons|ionicons|remixicon|bootstrap-icons|lucide|feather/i;
  const RASTER = /^data:image\/(png|jpe?g|gif|webp|bmp)/i;
  const topComma = (v) => { let d = 0; for (const ch of v) { if (ch === '(') d++; else if (ch === ')') d--; else if (ch === ',' && !d) return true; } return false; };
  const px = (v) => parseFloat(v) || 0;
  // R46 mirror: keep this list in sync with unsupported() in capture.mjs (and PROFILE.md W5)
  const unsupported = (cs, el, pcs) => {
    const o = [];
    const set = (k) => !pcs || pcs[k] !== cs[k];
    if (cs.textShadow && cs.textShadow !== 'none' && set('textShadow')) o.push('text-shadow');
    if (cs.webkitTextStrokeWidth && parseFloat(cs.webkitTextStrokeWidth) > 0 && set('webkitTextStrokeWidth')) o.push('-webkit-text-stroke');
    if (cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && (!pcs || pcs.webkitTextFillColor === pcs.color || set('webkitTextFillColor'))) o.push('-webkit-text-fill-color');
    if (cs.fontFeatureSettings && cs.fontFeatureSettings !== 'normal' && set('fontFeatureSettings')) o.push('font-feature-settings');
    for (const [k, prop] of [['fontVariantCaps', 'font-variant-caps'], ['fontVariantNumeric', 'font-variant-numeric'], ['fontVariantLigatures', 'font-variant-ligatures'],
      ['fontVariantEastAsian', 'font-variant-east-asian'], ['fontVariantAlternates', 'font-variant-alternates'], ['fontVariantPosition', 'font-variant-position']]) {
      if (cs[k] && cs[k] !== 'normal' && set(k)) o.push(prop);
    }
    if (cs.backdropFilter && cs.backdropFilter !== 'none') o.push('backdrop-filter');
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') o.push('mix-blend-mode');
    if (cs.backgroundBlendMode && cs.backgroundBlendMode !== 'normal') o.push('background-blend-mode');
    if ((cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none')) o.push('mask');
    if (cs.borderImageSource && cs.borderImageSource !== 'none') o.push('border-image');
    if (cs.textOverflow && cs.textOverflow !== 'clip') o.push('text-overflow');
    if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') o.push('-webkit-line-clamp');
    if (cs.display === 'list-item' && (cs.listStyleType !== 'none' || cs.listStyleImage !== 'none')) o.push('list-marker');
    const bgImage = cs.backgroundImage !== 'none';
    const bg = !/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor);
    const clip = cs.backgroundClip || cs.webkitBackgroundClip;
    if (clip === 'text') o.push('background-clip');
    else if ((bg || bgImage) && clip && clip !== 'border-box') o.push('background-clip');
    if (bgImage) {
      if (topComma(cs.backgroundImage)) o.push('background-image (layers)');
      if (!/^auto( auto)?$/.test(cs.backgroundSize)) o.push('background-size');
      if (!/^0% 0%$/.test(cs.backgroundPosition)) o.push('background-position');
      if (cs.backgroundRepeat !== 'repeat') o.push('background-repeat');
    }
    // beyond R46 (vd-html W5): not drawn by the layout proxy either
    if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0) o.push('outline');
    if (cs.filter !== 'none') o.push('filter');
    if (cs.transform && cs.transform !== 'none') {
      const m = cs.transform.match(/^matrix\(([^)]+)\)$/);
      const v = m ? m[1].split(',').map(Number) : null;
      const pureRotate = v && Math.abs(v[0] - v[3]) < 1e-4 && Math.abs(v[1] + v[2]) < 1e-4 && Math.abs(v[0] * v[0] + v[1] * v[1] - 1) < 1e-3 && Math.abs(v[4]) < 0.01 && Math.abs(v[5]) < 0.01;
      if (!pureRotate) o.push('transform');
    }
    if (/overline/.test(cs.textDecorationLine || '')) o.push('text-decoration overline');
    if (cs.textDecorationLine && cs.textDecorationLine !== 'none' && cs.textDecorationStyle !== 'solid') o.push('text-decoration style');
    return o;
  };
  const visible = (el) => el.getClientRects().length > 0;

  roots.forEach((root, si) => {
    const els = [root, ...root.querySelectorAll('*')];
    let abs = 0, total = 0;
    for (const el of els) {
      const tag = el.localName;
      if (BAD_TAGS.has(tag)) add('E8', si, `<${tag}> in a screen`, el, root);
      if (tag === 'use') {
        const h = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        if (h.startsWith('#')) { if (h.length < 2 || !document.getElementById(h.slice(1))) add('E7', si, `<use> to missing id ${h}`, el, root); }
        else if (h && !h.startsWith('data:')) add('E4', si, '<use> to another file', el, root);
      }
      if (tag === 'img') {
        const src = el.getAttribute('src');
        if (src && !src.startsWith('data:')) add('E4', si, 'img src is not a data: URI', el, root);
        const ss = el.getAttribute('srcset');
        if (ss && ss.split(',').some((c) => !c.trim().startsWith('data:'))) add('E4', si, 'img srcset is not a data: URI', el, root);
      }
      if (tag === 'image') {
        const h = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        if (h && !h.startsWith('data:')) add('E4', si, 'svg <image> is not a data: URI', el, root);
      }
      if (isSvgInner(el) || !visible(el)) continue;
      const cs = getComputedStyle(el);
      total++;
      if (cs.position === 'absolute' || cs.position === 'fixed') abs++;
      for (const m of cs.backgroundImage.matchAll(/url\(\s*["']?([^"')]+)/g)) {
        if (!m[1].startsWith('data:')) add('E4', si, 'background-image url is not a data: URI', el, root);
      }
      if (/grid|table/.test(cs.display)) add('W1', si, `display: ${cs.display}`, el, root);
      if (cs.float !== 'none') add('W1', si, `float: ${cs.float}`, el, root);
      // per-side borders
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((s) => cs[`border${s}Style`] !== 'none' && cs[`border${s}Style`] !== 'hidden' && px(cs[`border${s}Width`]) > 0);
      if (sides.length > 1 && (new Set(sides.map((s) => cs[`border${s}Color`])).size > 1 || new Set(sides.map((s) => cs[`border${s}Style`])).size > 1)) {
        add('W4', si, 'border differs in color or style per side', el, root);
      }
      const pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
      for (const prop of unsupported(cs, el, pcs)) add('W5', si, `not in Figma: ${prop}`, el, root);
      if (el instanceof HTMLImageElement && RASTER.test(el.getAttribute('src') || '')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 48 && r.height <= 48) add('W6', si, 'raster image <= 48 px (icon)', el, root);
      }
      const bgm = cs.backgroundImage.match(/url\(\s*["']?(data:image\/(?:png|jpe?g|gif|webp|bmp))/i);
      if (bgm) { const r = el.getBoundingClientRect(); if (r.width <= 48 && r.height <= 48) add('W6', si, 'raster image <= 48 px (icon)', el, root); }
      if (hasOwnText(el)) {
        const fam = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
        if (ICONFONT.test(fam)) add('W6', si, `icon font: ${fam}`, el, root);
        const k = `${si}|${fam}`;
        const f = familyMap.get(k);
        if (f) f.n++; else familyMap.set(k, { si, family: fam, n: 1, sel: selOf(el, root) });
      }
    }
    if (total >= 8 && abs / total > 0.25) add('W9', si, `${abs} of ${total} elements are absolute/fixed`, root, root);
  });
  out.families = [...familyMap.values()];

  // ---- stylesheets: tokens (W7), nested var / fallback (W10), viewport units (W9) ----
  const GROUPS = { color: 0, space: 0, radius: 0, fontSize: 0 };
  const cnt = { color: { v: 0, l: 0 }, space: { v: 0, l: 0 }, radius: { v: 0, l: 0 }, fontSize: { v: 0, l: 0 } };
  const groupOf = (p) => {
    if (p === 'color' || p === 'background' || p === 'background-color' || /^border(-(top|right|bottom|left))?-color$/.test(p) || p === 'fill' || p === 'stroke' || p === 'box-shadow') return 'color';
    if (/^(padding|margin)(-|$)/.test(p) || p === 'gap' || p === 'row-gap' || p === 'column-gap') return 'space';
    if (/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(p)) return 'radius';
    if (p === 'font-size') return 'fontSize';
    return null;
  };
  const SHORT_BORDER = /^(border|border-top|border-right|border-bottom|border-left|outline)$/;
  const COLOR_LIT = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
  const EXEMPT = /^(0|0px|auto|inherit|initial|unset|revert|transparent|currentcolor|none|normal)$/i;
  const classify = (prop, value) => {
    if (SHORT_BORDER.test(prop)) { if (/var\(/.test(value)) return ['color', 'v']; return COLOR_LIT.test(value) ? ['color', 'l'] : null; }
    const g = groupOf(prop);
    if (!g) return null;
    if (/var\(/.test(value)) return [g, 'v'];
    const v = value.replace(/\s*!important\s*$/i, '').trim();
    if (g === 'color' && prop === 'box-shadow') return v === 'none' ? null : [g, 'l'];
    if (!v) return null;
    const parts = v.split(/\s+/);
    if (parts.every((t) => EXEMPT.test(t) || /%$/.test(t))) return null;
    return [g, 'l'];
  };
  const splitDecls = (text) => {
    const o = []; let d = 0, q = '', cur = '';
    for (const ch of text) {
      if (q) { cur += ch; if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '(') d++; else if (ch === ')') d--;
      if (ch === ';' && !d) { o.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) o.push(cur);
    return o.map((s) => { const i = s.indexOf(':'); return i < 0 ? null : [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()]; }).filter(Boolean);
  };
  const varIssue = (v) => {
    for (const m of v.matchAll(/var\(/g)) {
      const stack = [];
      for (let i = 0; i < m.index; i++) {
        if (v[i] === '(') stack.push((/[\w-]*$/.exec(v.slice(0, i)) || [''])[0]);
        else if (v[i] === ')') stack.pop();
      }
      if (stack.some((n) => n !== 'var')) return 'var() nested in a function';
      let d = 1;
      for (let i = m.index + 4; i < v.length && d; i++) {
        if (v[i] === '(') d++; else if (v[i] === ')') d--; else if (v[i] === ',' && d === 1) return 'var() with a fallback';
      }
    }
    return null;
  };
  const VIEWPORT_UNIT = /[\d.](vw|vh|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw)\b/i;
  const declare = (si, el, root, decls) => {
    for (const [prop, value] of decls) {
      if (prop.startsWith('--')) continue;
      const c = classify(prop, value);
      if (c) cnt[c[0]][c[1]]++;
      const issue = varIssue(value);
      if (issue) add('W10', si, issue, el, root);
      if (VIEWPORT_UNIT.test(value)) add('W9', si, `viewport unit in ${prop}`, el, root);
    }
  };
  const stripSel = (s) => s.split(',').map((p) => {
    const t = p.replace(/::?(before|after|first-line|first-letter|placeholder|selection|marker|backdrop|-webkit-[\w-]+|hover|focus-visible|focus-within|focus|active|visited|target)/g, '').trim();
    return !t || /[>+~]$/.test(t) ? `${t} *`.trim() : t;
  }).join(',');
  const screenOf = (selectorText) => {
    const s = stripSel(selectorText);
    try {
      for (let i = 0; i < roots.length; i++) if (roots[i].matches(s) || roots[i].querySelector(s)) return i;
      return -2; // matches nothing inside a screen
    } catch { return -1; }
  };
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !(r instanceof CSSStyleRule) && !(r instanceof CSSKeyframesRule) && !(r instanceof CSSFontFaceRule)) { walk(r.cssRules); continue; }
      if (!(r instanceof CSSStyleRule)) continue;
      const parts = r.selectorText.split(',').map((x) => x.trim());
      if (parts.every((x) => x === ':root' || x === 'html')) continue; // token definitions
      const si = screenOf(r.selectorText);
      if (si === -2) continue;
      declare(si, null, null, splitDecls(r.style.cssText));
    }
  };
  for (const rules of sheetRules) walk(rules);
  roots.forEach((root, si) => {
    for (const el of [root, ...root.querySelectorAll('[style]')]) {
      const st = el.getAttribute('style');
      if (st) declare(si, el, root, splitDecls(st));
    }
  });
  for (const g of Object.keys(GROUPS)) {
    const { v, l } = cnt[g];
    out.tokens[g] = { var: v, literal: l, ratio: v + l ? Math.round((v / (v + l)) * 1000) / 1000 : 1 };
  }

  // ---- layout: W3 (flex-shrink) at A, widen once (W2, W11), W3 at B ----
  const items = []; // flex items (not out of flow), per screen
  roots.forEach((root, si) => {
    for (const el of root.querySelectorAll('*')) {
      const p = el.parentElement;
      if (!p || isSvgInner(el) || !visible(el)) continue;
      const pcs = getComputedStyle(p);
      if (!/flex/.test(pcs.display)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;
      items.push({ el, si, root, col: /column/.test(pcs.flexDirection) });
    }
  });
  const size = (it) => { const r = it.el.getBoundingClientRect(); return it.col ? r.height : r.width; };
  const shrunk = new Set();
  const w3 = () => {
    const before = items.map(size);
    const st = document.createElement('style');
    st.textContent = '*,*::before,*::after{flex-shrink:0 !important}';
    document.head.appendChild(st);
    const after = items.map(size);
    st.remove();
    const hit = items.filter((it, i) => after[i] > before[i] + 0.5);
    const set = new Set(hit.map((h) => h.el));
    for (const h of hit) {
      // report the item that shrinks, not an ancestor whose size only follows it
      let anc = false;
      for (const o of hit) if (o !== h && h.el.contains(o.el)) { anc = true; break; }
      if (anc || shrunk.has(h.el)) continue;
      shrunk.add(h.el);
      add('W3', h.si, h.col ? 'flex item shrinks (height, column)' : 'flex item shrinks (flex-shrink)', h.el, h.root);
    }
    return set;
  };
  const snap = () => roots.map((root) => ({ w: root.getBoundingClientRect().width, kids: [...root.querySelectorAll('*')].map((e) => (isSvgInner(e) ? 0 : e.getBoundingClientRect().width)) }));
  out.screens = roots.map((root) => { const r = root.getBoundingClientRect(); return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; });
  // W11: a wrapping flex container must break at the same items at A and B (the Figma model cannot re-wrap)
  const wraps = [];
  roots.forEach((root, si) => {
    for (const el of root.querySelectorAll('*')) {
      if (isSvgInner(el) || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (/flex/.test(cs.display) && cs.flexWrap !== 'nowrap') wraps.push({ el, si, root, col: /column/.test(cs.flexDirection) });
    }
  });
  const lines = (w) => {
    // children in flow, grouped into lines by their cross-axis start; signature = item count per line
    const starts = [];
    for (const k of w.el.children) {
      const kcs = getComputedStyle(k);
      if (kcs.position === 'absolute' || kcs.position === 'fixed' || !visible(k)) continue;
      const r = k.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      starts.push(w.col ? r.left : r.top);
    }
    const counts = [];
    let last = null;
    for (const v of starts) {
      if (last === null || Math.abs(v - last) > 1) { counts.push(1); last = v; } else counts[counts.length - 1]++;
    }
    return counts.join('+');
  };
  // W12: an in-flow element sized in % (other than 100 %) keeps its px size in Figma auto layout (no % sizes there), so
  // it does not follow its parent when widened. Authored values are read with every element display:none (computed
  // width/height then give the specified value, as capture does for R47), in one pass.
  const flow = [];
  roots.forEach((root, si) => {
    for (const el of root.querySelectorAll('*')) {
      if (isSvgInner(el) || el.tagName.toLowerCase() === 'svg' || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;
      flow.push({ el, si, root });
    }
  });
  {
    const st = document.createElement('style');
    st.textContent = '*{display:none !important}';
    document.head.appendChild(st);
    const vals = flow.map((f) => { const cs = getComputedStyle(f.el); return [cs.width, cs.height]; });
    st.remove();
    flow.forEach((f, i) => {
      const bad = [['width', vals[i][0]], ['height', vals[i][1]]].filter(([, v]) => /%$/.test(v) && parseFloat(v) !== 100);
      for (const [k, v] of bad) add('W12', f.si, `${k}: ${v} on an in-flow element (Figma has no % size; use position:absolute inside a relative parent)`, f.el, f.root);
    });
  }
  // W13: Figma has no z-index; a later layer always draws on top. CSS paints an absolute/fixed element above later
  // in-flow siblings, Figma below them. Report an overlay whose box overlaps a later, non-positioned element that paints.
  {
    const paints = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      if (el.tagName.toLowerCase() === 'svg' || el.tagName.toLowerCase() === 'img') return true;
      if (!/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
      if (['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(cs['border' + k + 'Width']) > 0 && cs['border' + k + 'Style'] !== 'none')) return true;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
      return false;
    };
    const positioned = (el) => { const p = getComputedStyle(el).position; return p === 'absolute' || p === 'fixed'; };
    roots.forEach((root, si) => {
      const all = [...root.querySelectorAll('*')].filter((e) => !isSvgInner(e) && visible(e));
      all.forEach((ov, i) => {
        if (!positioned(ov)) return;
        const r = ov.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        for (let j = i + 1; j < all.length; j++) {
          const e = all[j];
          // only content outside the overlay's parent: an overlay inside its own box (badge on an icon, ring around a
          // label) rarely overlaps ink; one that escapes its parent (dropdown, popover) covers the next rows
          if (ov.contains(e) || e.contains(ov) || (ov.parentElement && ov.parentElement.contains(e))) continue;
          // e or one of its ancestors below the overlay's parent is positioned: it is an overlay itself, drawn in order
          let p = e, pos = false;
          while (p && p !== root && !p.contains(ov)) { if (positioned(p)) { pos = true; break; } p = p.parentElement; }
          if (pos || !paints(e)) continue;
          const q = e.getBoundingClientRect();
          const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left), iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
          if (ix > 2 && iy > 2) {
            add('W13', si, 'overlay is covered in Figma by later content (no z-index: layer order = document order); move it after that content, e.g. last in the screen', ov, root);
            break;
          }
        }
      });
    });
  }
  w3();
  const wrapA = wraps.map(lines);
  const A = snap();
  const targets = roots.map((r) => r.closest(widenSel || '[data-vd-widen]') || r);
  const done = new Set();
  targets.forEach((t) => {
    if (done.has(t)) return;
    done.add(t);
    const cw = parseFloat(getComputedStyle(t).width);
    const base = Number.isFinite(cw) ? cw : t.getBoundingClientRect().width;
    t.style.setProperty('width', (base + widenBy) + 'px', 'important');
    t.style.setProperty('max-width', 'none', 'important');
    t.style.setProperty('flex', 'none', 'important');
  });
  const B = snap();
  roots.forEach((root, si) => {
    if (B[si].w - A[si].w < 1) add('W2', si, 'screen does not stretch when widened (fixed width)', root, root);
    else if (!B[si].kids.some((w, i) => w - A[si].kids[i] >= 1)) add('W2', si, 'screen stretches but nothing inside it does', root, root);
  });
  wraps.forEach((w, i) => {
    const b = lines(w);
    if (b !== wrapA[i]) add('W11', w.si, `wrapping ${w.col ? 'column' : 'row'} breaks differently when widened (items per line ${wrapA[i] || '0'} -> ${b || '0'})`, w.el, w.root);
  });
  w3();
  out.findings = [...found.values()];
  return out;
}

// ---------------- lintFile ----------------

export async function lintFile(htmlPath, { root, widen, widenBy = 120, browser, fontMap } = {}) {
  const t0 = Date.now();
  const abs = resolve(htmlPath);
  if (!existsSync(abs)) throw new Error(`HTML file not found: ${abs}`);
  const fm = fontMap || defaultFontMap();
  let own = false;
  if (!browser) { const { launchBrowser } = await import('./browser.mjs'); browser = await launchBrowser(); own = true; }
  let raw;
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(pathToFileURL(abs).href, { waitUntil: 'load' });
      await page.evaluate((ms) => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, ms))]), FONT_WAIT_MS);
      raw = await page.evaluate(lintPage, { rootSel: root || DEFAULT_ROOT, widenSel: widen || null, widenBy, defaultRoot: DEFAULT_ROOT });
    } finally { await page.close(); }
  } finally { if (own) await browser.close(); }

  const result = { version: 1, profile: PROFILE, file: abs, ms: 0, screens: [], findings: [], counts: { error: 0, warn: 0 }, tokens: {} };
  const sel = root || DEFAULT_ROOT;
  if (raw.badSelector) {
    result.findings.push({ code: 'E1', level: 'error', screen: '-', sel, msg: `invalid selector "${sel}": ${raw.badSelector}`, n: 1 });
  } else if (!raw.count) {
    result.findings.push({ code: 'E1', level: 'error', screen: '-', sel, msg: `no screen found for "${sel}"`, n: 1 });
  } else {
    const ids = raw.ids;
    result.screens = raw.screens.map((s, i) => ({ id: ids[i] || `#${i + 1}`, ...s }));
    const screenName = (si) => (si >= 0 ? (ids[si] || `#${si + 1}`) : '-');
    result.tokens = raw.tokens;
    const fs = [...raw.findings];
    for (const f of raw.families) {
      if (isAvailable(fm, f.family)) continue;
      // browser default faces (no font-family set, or a core web font) are substituted by the pipeline like system fonts
      const system = isSystemFont(f.family) || BROWSER_DEFAULT.test(f.family.trim());
      fs.push({ code: system ? 'W8' : 'E6', si: f.si, sel: f.sel, n: f.n,
        msg: system ? `system font "${f.family}" (Figma substitutes Inter)` : `font "${f.family}" is not in Figma and not a system font (Figma substitutes Inter)` });
    }
    for (const [g, name] of [['color', 'color'], ['space', 'spacing'], ['radius', 'radius'], ['fontSize', 'font-size']]) {
      const t = raw.tokens[g];
      if (t && t.var + t.literal && t.ratio < 0.8) {
        fs.push({ code: 'W7', si: -1, sel: '', n: t.literal, msg: `${name}: ${t.var} of ${t.var + t.literal} declarations use var() (${Math.round(t.ratio * 100)}%)` });
      }
    }
    // merge: same code + screen + msg -> one finding with n
    const merged = new Map();
    for (const f of fs) {
      const key = `${f.code}|${f.si}|${f.msg}`;
      const m = merged.get(key);
      if (m) m.n += f.n; else merged.set(key, { code: f.code, level: LEVEL(f.code), screen: screenName(f.si), sel: f.sel, msg: f.msg, n: f.n });
    }
    result.findings = [...merged.values()];
  }
  const num = (c) => Number(c.replace(/\D/g, ''));
  result.findings.sort((a, b) => (a.level === b.level ? b.n - a.n || num(a.code) - num(b.code) : a.level === 'error' ? -1 : 1));
  for (const f of result.findings) result.counts[f.level]++;
  result.ms = Date.now() - t0;
  return result;
}

// ---------------- summary (<= 15 lines) ----------------

export function summarize(result, { max = 10, outPath } = {}) {
  const lines = [];
  const t = result.tokens || {};
  const pct = (g) => (t[g] ? `${Math.round(t[g].ratio * 100)}%` : '-');
  lines.push(`lint ${basename(result.file)}: ${result.screens.length} screens, ${result.counts.error} errors, ${result.counts.warn} warnings, ` +
    `var share color ${pct('color')} space ${pct('space')} radius ${pct('radius')} font-size ${pct('fontSize')} (${(result.ms / 1000).toFixed(1)} s)`);
  const shown = result.findings.slice(0, Math.min(max, 10));
  for (const f of shown) lines.push(`${f.code} ${f.screen}${f.n > 1 ? ` x${f.n}` : ''}${f.sel ? ` ${f.sel}` : ''}: ${f.msg}`.slice(0, 200));
  if (result.findings.length > shown.length) lines.push(`... and ${result.findings.length - shown.length} more finding groups`);
  lines.push(outPath ? `full list: ${outPath}` : 'full list: pass --out <dir> to write lint.json');
  return lines.slice(0, 15);
}

// ---------------- CLI ----------------

export const USAGE = 'usage: node core/lint.mjs --html <file> [--root <selector>] [--widen <selector>] [--out <dir>] [--strict] [--log <runs.jsonl>] [--json]';

export async function main(argv, deps = {}) {
  const out = deps.out || ((m) => process.stdout.write(`${m}\n`));
  const err = deps.log || ((m) => process.stderr.write(`${m}\n`));
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      html: { type: 'string' }, root: { type: 'string' }, widen: { type: 'string' }, out: { type: 'string' },
      strict: { type: 'boolean' }, log: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } }));
  } catch (e) { err(`error: ${e.message}\n${USAGE}`); return 2; }
  if (values.help) { err(USAGE); return 0; }
  if (!values.html) { err(`error: --html <file> is required\n${USAGE}`); return 2; }
  if (!existsSync(values.html)) { err(`error: HTML file not found: ${values.html}`); return 2; }
  let result;
  try {
    result = await lintFile(values.html, { root: values.root, widen: values.widen, browser: deps.browser, fontMap: deps.fontMap });
  } catch (e) { err(`error: ${e.message}${e.hint ? `\n${e.hint}` : ''}`); return 2; }
  let outPath;
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    outPath = join(values.out, 'lint.json');
    writeFileSync(outPath, JSON.stringify(result, null, 1));
  }
  if (values.log) {
    appendFileSync(values.log, `${JSON.stringify({ ts: new Date().toISOString(), tool: 'lint', file: result.file, ms: result.ms, screens: result.screens.length, error: result.counts.error, warn: result.counts.warn })}\n`);
  }
  if (values.json) out(JSON.stringify(result, null, 1));
  else for (const l of summarize(result, { outPath })) out(l);
  return result.counts.error || (values.strict && result.counts.warn) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
