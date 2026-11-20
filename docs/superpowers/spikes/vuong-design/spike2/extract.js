// Extract: render each corpus file, materialise pseudo-elements, wrap anonymous flex/grid text, walk every screen root
// and measure every rendered thing at two widths (native, native+120). Output out/ir.json + source screenshots.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const CORPUS = require('./corpus');
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1255/chrome-win64/chrome.exe');
const OUT = path.join(__dirname, 'out');
const EXTRA = 120;

// ---------------- in-page code ----------------
function inPage({ rootSel, widen, extra, nameOf }) {
  const roots = [...document.querySelectorAll(rootSel)];
  // 1. widen
  if (extra) for (const r of roots) {
    const t = widen === 'parent' ? r.parentElement : r;
    const cs = getComputedStyle(t);
    const base = cs.maxWidth !== 'none' && t === r ? Math.min(parseFloat(cs.maxWidth), parseFloat(cs.width)) : parseFloat(cs.width);
    t.style.width = (base + extra) + 'px'; t.style.maxWidth = 'none'; t.style.flex = 'none';
  }
  // 2. materialise ::before/::after as real spans carrying the pseudo's computed style
  const PROPS = [...getComputedStyle(document.documentElement)];
  const pend = []; let pseudoApprox = 0;
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    if (el.closest('svg')) continue;
    for (const which of ['before', 'after']) {
      const cs = getComputedStyle(el, '::' + which);
      const c = cs.content;
      if (!c || c === 'none' || c === 'normal' || cs.display === 'none') continue;
      const sp = document.createElement('span');
      for (const p of PROPS) { if (p === 'content') continue; sp.style.setProperty(p, cs.getPropertyValue(p)); }
      let txt = '';
      const m = c.match(/^"(.*)"$/s);
      if (m) txt = m[1]; else { pseudoApprox++; txt = c.replace(/"/g, ''); }
      sp.textContent = txt; sp.dataset.pseudo = which;
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
  // 3. wrap bare text inside flex/grid containers: an anonymous flex item == a blockified span, so this is layout-neutral
  //    and gives an exact box for the text (measurement technique only).
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    if (el.closest('svg')) continue;
    const d = getComputedStyle(el).display;
    if (!/flex|grid/.test(d)) continue;
    for (const ch of [...el.childNodes]) if (ch.nodeType === 3 && ch.textContent.trim()) {
      const sp = document.createElement('span'); sp.dataset.tw = '1';
      el.insertBefore(sp, ch); sp.appendChild(ch);
    }
  }

  const lhCache = {};
  const lhPx = (cs) => {
    if (cs.lineHeight !== 'normal') return parseFloat(cs.lineHeight);
    const key = cs.fontFamily + '|' + cs.fontSize + '|' + cs.fontWeight;
    if (lhCache[key] == null) {
      const p = document.createElement('div');
      p.style.cssText = `position:absolute;visibility:hidden;font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};line-height:normal;white-space:nowrap`;
      p.textContent = 'Hg'; document.body.appendChild(p); lhCache[key] = p.getBoundingClientRect().height; p.remove();
    }
    return lhCache[key];
  };
  const r2 = (v) => Math.round(v * 100) / 100;
  const isTransparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const bw = (cs, s) => cs[`border${s}Style`] === 'none' || cs[`border${s}Style`] === 'hidden' ? 0 : parseFloat(cs[`border${s}Width`]);
  const hasBox = (cs) => !isTransparent(cs.backgroundColor) || cs.backgroundImage !== 'none' ||
    ['Top', 'Right', 'Bottom', 'Left'].some(s => bw(cs, s) > 0) || cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
  const pad = (cs) => ['Top', 'Right', 'Bottom', 'Left'].map(s => parseFloat(cs['padding' + s]));
  const paint = (cs) => {
    const p = {};
    if (!isTransparent(cs.backgroundColor)) p.bg = cs.backgroundColor;
    if (cs.backgroundImage !== 'none') p.bgi = cs.backgroundImage;
    const b = ['Top', 'Right', 'Bottom', 'Left'].map(s => [bw(cs, s), cs[`border${s}Style`], cs[`border${s}Color`]]);
    if (b.some(x => x[0] > 0)) p.bd = b;
    const rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    if (rad.some(x => x !== '0px')) p.rad = rad;
    if (cs.boxShadow !== 'none') p.sh = cs.boxShadow;
    if (cs.opacity !== '1') p.op = cs.opacity;
    if (cs.overflow !== 'visible' && cs.overflow !== '') p.clip = 1;
    if (cs.transform !== 'none') { p.tf = cs.transform; p.to = cs.transformOrigin; }
    if (cs.filter !== 'none') p.filt = cs.filter;
    if (cs.clipPath !== 'none') p.cpath = cs.clipPath;
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) p.outline = `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`;
    return p;
  };
  const font = (cs) => ({ ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, fst: cs.fontStyle, lh: lhPx(cs), ls: cs.letterSpacing,
    c: cs.color, td: cs.textDecorationLine, tt: cs.textTransform, ta: cs.textAlign, ws: cs.whiteSpace });
  const isIconFont = (cs) => /Material (Symbols|Icons)/i.test(cs.fontFamily);
  const isInlineNoBox = (el) => {
    const cs = getComputedStyle(el);
    return cs.display === 'inline' && !hasBox(cs) && pad(cs).every(v => v === 0) && !el.dataset.pseudo &&
      parseFloat(cs.marginLeft) === 0 && parseFloat(cs.marginRight) === 0 && !isIconFont(cs) && el.tagName !== 'svg' && el.tagName !== 'IMG';
  };
  const pureInline = (el) => {
    let txt = false;
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) { if (ch.textContent.trim() || / /.test(ch.textContent)) txt = true; continue; }
      if (ch.nodeType !== 1) continue;
      if (ch.tagName === 'BR') continue;
      if (getComputedStyle(ch).display === 'none') continue;
      if (!isInlineNoBox(ch)) return false;
      const sub = pureInline(ch); if (sub === false) return false; if (sub) txt = true;
    }
    return txt ? true : null;
  };
  const fkey = ['c', 'ff', 'fs', 'fw', 'fst', 'ls', 'td', 'tt'];
  const runsOf = (el, base) => {
    const runs = []; let spans = 0;
    const rec = (node) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) {
          const cs = getComputedStyle(node); const f = font(cs); const d = {};
          for (const k of fkey) if (f[k] !== base[k]) d[k] = f[k];
          runs.push({ t: ch.textContent, ...(Object.keys(d).length ? { s: d } : {}) });
        } else if (ch.nodeType === 1) {
          if (ch.tagName === 'BR') { runs.push({ br: 1 }); continue; }
          if (getComputedStyle(ch).display === 'none') continue;
          spans++; rec(ch);
        }
      }
    };
    rec(el);
    // whitespace collapse across the whole paragraph (white-space:normal assumption unless pre*)
    if (!/pre/.test(base.ws)) {
      let prevSpace = true;
      for (const r of runs) {
        if (r.br) { prevSpace = true; continue; }
        let t = r.t.replace(/[ \t\n\r\f]+/g, ' ');
        if (prevSpace) t = t.replace(/^ /, '');
        prevSpace = t.endsWith(' ') || (t === '' && prevSpace);
        r.t = t;
      }
      // trim trailing spaces before br / end
      for (let i = runs.length - 1; i >= 0; i--) { const r = runs[i]; if (r.br) continue; r.t = r.t.replace(/ $/, ''); if (r.t) break; }
      for (let i = 0; i < runs.length; i++) if (runs[i + 1]?.br && !runs[i].br) runs[i].t = runs[i].t.replace(/ $/, '');
    }
    return { runs: runs.filter(r => r.br || r.t !== ''), spans };
  };
  const lineClusters = (rects) => {
    const rs = [...rects].filter(r => r.width > 0.01 && r.height > 0.01).sort((a, b) => a.top - b.top);
    const L = [];
    for (const r of rs) {
      const l = L.find(l => r.top < l.bottom - 1 && r.bottom > l.top + 1);
      if (l) { l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); }
      else L.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    return L;
  };

  const screens = [];
  roots.forEach((root, ri) => {
    const R = root.getBoundingClientRect();
    const rel = (b) => [r2(b.left - R.left), r2(b.top - R.top), r2(b.width), r2(b.height)];
    const dropped = []; let merged = 0, mixedInline = 0;
    // text box via Range + half-leading (used for bare text in block containers, and inline elements)
    const rangeBox = (target, cs) => {
      const rg = document.createRange();
      if (target.nodeType === 3) rg.selectNode(target); else rg.selectNodeContents(target);
      const L = lineClusters(rg.getClientRects());
      if (!L.length) return null;
      const LH = lhPx(cs);
      const f = L[0], l = L[L.length - 1];
      const top = f.top - (LH - (f.bottom - f.top)) / 2, bottom = l.bottom + (LH - (l.bottom - l.top)) / 2;
      const left = Math.min(...L.map(x => x.left)), right = Math.max(...L.map(x => x.right));
      return { box: rel({ left, top, width: right - left, height: bottom - top }), lines: L.length, tw: r2(right - left) };
    };
    const textNode = (id, el, cs, kind) => {
      const base = font(cs);
      const { runs, spans } = runsOf(el, base);
      merged += spans;
      return { id, k: 'text', font: base, runs, ...kind };
    };
    const walk = (el, id) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
      const b = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const n = { id, tag };
      const cls = String(el.className?.baseVal ?? el.className ?? '').replace(/__pz[ab]/g, '').trim();
      if (cls) n.cls = cls;
      if (el.dataset?.pseudo) n.pseudo = el.dataset.pseudo;
      n.r = rel(b);
      const p = paint(cs); if (Object.keys(p).length) n.p = p;
      if (tag === 'svg') {
        n.k = 'svg'; const u = el.querySelector('use');
        n.icon = u ? (u.getAttribute('href') || u.getAttribute('xlink:href')) : null;
        n.svg = el.outerHTML; n.sv = { stroke: cs.stroke, fill: cs.fill, sw: cs.strokeWidth, c: cs.color };
        return n;
      }
      if (tag === 'img') { n.k = 'img'; n.src = el.currentSrc || el.src; n.fit = cs.objectFit; return n; }
      if (isIconFont(cs)) { n.k = 'iconfont'; n.name = el.textContent.trim(); n.font = font(cs); return n; }
      const pi = pureInline(el);
      if (pi) {
        const rb = rangeBox(el, cs);
        const LH = lhPx(cs); const pd = pad(cs);
        const bws = ['Top', 'Right', 'Bottom', 'Left'].map(s => bw(cs, s));
        const cH = b.height - pd[0] - pd[2] - bws[0] - bws[2];
        const lines = rb ? rb.lines : 1;
        const tight = Math.abs(cH - lines * LH) < 1.5;
        if (cs.display === 'inline' && rb) { // inline element on its own: range box
          return textNode(id, el, cs, { r: rb.box, lines, tw: rb.tw, tag, ...(cls ? { cls } : {}) });
        }
        if (!hasBox(cs) && pd.every(v => v === 0) && tight) {
          if (cs.lineHeight === 'normal') { const t = textNode(id, el, cs, {}); t.font.lh = r2(b.height / lines); Object.assign(t, { r: n.r, lines, tw: rb ? rb.tw : n.r[2], tag, ...(cls ? { cls } : {}), ...(n.pseudo ? { pseudo: n.pseudo } : {}), ...(p.op ? { p: { op: p.op } } : {}) }); return t; }
          return textNode(id, el, cs, { r: n.r, lines, tw: rb ? rb.tw : n.r[2], tag, ...(cls ? { cls } : {}), ...(n.pseudo ? { pseudo: n.pseudo } : {}), ...(p.op ? { p: { op: p.op } } : {}) });
        }
        // frame + one text child
        let tb;
        const cx = b.left + bws[3] + pd[3], cy = b.top + bws[0] + pd[0], cw = b.width - bws[1] - bws[3] - pd[1] - pd[3];
        if (tight) {
          tb = lines === 1 && rb ? [rb.box[0], r2(cy - R.top), rb.box[2], r2(cH)] : [r2(cx - R.left), r2(cy - R.top), r2(cw), r2(cH)];
        } else tb = rb ? rb.box : n.r;
        n.k = 'frame';
        n.kids = [textNode(id + '.t', el, cs, { r: tb, lines, tw: rb ? rb.tw : tb[2] })];
        return n;
      }
      n.k = 'frame'; n.kids = [];
      let hasText = false, hasEl = false;
      el.childNodes.forEach((ch, i) => {
        if (ch.nodeType === 3) {
          if (!ch.textContent.trim()) return;
          const rb = rangeBox(ch, cs); if (!rb) return;
          hasText = true;
          const base = font(cs);
          n.kids.push({ id: id + '.' + i, k: 'text', font: base, runs: [{ t: ch.textContent.replace(/\s+/g, ' ').trim() }], r: rb.box, lines: rb.lines, tw: rb.tw, bare: 1 });
        } else if (ch.nodeType === 1) {
          if (ch.tagName === 'BR' || ch.tagName === 'STYLE' || ch.tagName === 'SCRIPT') return;
          hasEl = true;
          const k = walk(ch, id + '.' + i); if (k) n.kids.push(k);
        }
      });
      if (hasText && hasEl) mixedInline++;
      if (!n.kids.length) {
        delete n.kids;
        if (b.width < 0.5 || b.height < 0.5) { dropped.push({ id, tag, cls, reason: 'zero-size, nothing rendered' }); return null; }
        n.k = hasBox(cs) ? 'shape' : 'spacer';
      }
      return n;
    };
    const tree = walk(root, 'n');
    let name = '';
    if (nameOf === 'cellname') name = root.closest('.cell')?.querySelector('.name')?.textContent.trim() || '';
    else {
      const prev = root.previousElementSibling; const cap = root.parentElement?.querySelector('.cap, h3');
      name = (cap?.textContent || prev?.textContent || '').trim().slice(0, 60);
    }
    // nearest non-transparent ancestor background (for proxy page backdrop)
    let a = root.parentElement, backdrop = '#ffffff';
    while (a) { const c = getComputedStyle(a).backgroundColor; if (!isTransparent(c)) { backdrop = c; break; } a = a.parentElement; }
    screens.push({ idx: ri, name, w: r2(R.width), h: r2(R.height), tree, dropped, merged, mixedInline, pseudoApprox: ri === 0 ? pseudoApprox : 0, backdrop });
  });
  const symbols = [...document.querySelectorAll('symbol')].map(s => s.outerHTML);
  const links = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href);
  return { screens, symbols, links };
}

// lbox pass: same walk order, transforms disabled → untransformed layout boxes keyed by id
function lboxPass({ rootSel }) {
  const st = document.createElement('style'); st.id = '__notf'; st.textContent = '*{transform:none!important}';
  document.head.appendChild(st);
  const out = [];
  for (const root of document.querySelectorAll(rootSel)) {
    const R = root.getBoundingClientRect(); const m = {};
    const r2 = (v) => Math.round(v * 100) / 100;
    const walk = (el, id) => {
      const b = el.getBoundingClientRect(); m[id] = [r2(b.left - R.left), r2(b.top - R.top), r2(b.width), r2(b.height)];
      if (el.tagName.toLowerCase() === 'svg') return;
      el.childNodes.forEach((ch, i) => { if (ch.nodeType === 1) walk(ch, id + '.' + i); });
    };
    walk(root, 'n'); out.push(m);
  }
  st.remove();
  return out;
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXE });
  const all = {};
  for (const c of CORPUS) {
    const res = {};
    for (const [mode, extra] of [['A', 0], ['B', EXTRA]]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
      await page.goto('file:///' + c.file.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const r = await page.evaluate(inPage, { rootSel: c.rootSel, widen: c.widen, extra, nameOf: c.nameOf });
      const lb = await page.evaluate(lboxPass, { rootSel: c.rootSel });
      await page.evaluate(() => document.fonts.ready);
      const n = await page.locator(c.rootSel).count();
      for (let i = 0; i < n; i++) {
        await page.locator(c.rootSel).nth(i).screenshot({ path: path.join(OUT, `src-${c.key}${i}-${mode}.png`), animations: 'disabled' });
      }
      res[mode] = { ...r, lb };
      await page.close();
    }
    // merge B into A by id
    res.A.screens.forEach((sA, i) => {
      const sB = res.B.screens[i];
      const mapB = {}; const idx = (n) => { mapB[n.id] = n; (n.kids || []).forEach(idx); }; idx(sB.tree);
      const lbA = res.A.lb[i], lbB = res.B.lb[i];
      let missing = 0;
      const merge = (n) => {
        const b = mapB[n.id];
        if (!b) { missing++; n.rB = n.r; } else { n.rB = b.r; if (n.k === 'text') { n.linesB = b.lines; n.twB = b.tw; } }
        // untransformed layout boxes for elements (text children of frames have no element → use r)
        n.l = lbA[n.id] && n.k !== 'text' ? lbA[n.id] : n.r; n.lB = lbB[n.id] && n.k !== 'text' ? lbB[n.id] : n.rB;
        (n.kids || []).forEach(merge);
      };
      merge(sA.tree);
      const id = c.key + i;
      all[id] = { id, file: c.file, rootSel: c.rootSel, idx: i, name: sA.name, W: [sA.w, sB.w], H: [sA.h, sB.h], tree: sA.tree,
        dropped: sA.dropped, merged: sA.merged, mixedInline: sA.mixedInline, pseudoApprox: sA.pseudoApprox, idMismatchB: missing,
        symbols: res.A.symbols, links: res.A.links, backdrop: sA.backdrop };
    });
    console.log(c.key, res.A.screens.length, 'screens');
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'ir.json'), JSON.stringify(all));
  console.log('ir bytes', fs.statSync(path.join(OUT, 'ir.json')).size);
}
if (require.main === module) run();
