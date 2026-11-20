// Spike: IR -> compact build spec (short keys) + use_figma payloads. No AI involved.
const fs = require('fs'), path = require('path');
const O = path.join(__dirname, 'out');
const ir = JSON.parse(fs.readFileSync(path.join(O, 'ir.json')));
const px = (v) => (v && v.endsWith('px')) ? +parseFloat(v).toFixed(2) : 0;
const hex = (rgb) => { const m = rgb && rgb.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); if (a === 0) return null;
  return { h: '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase(), a: +a }; };
// token name by hex (from :root), white/black named too
const byHex = { '#FFFFFF': 'white' };
for (const [k, v] of Object.entries(ir.rootVars)) byHex[v.toUpperCase()] = k.slice(2);
const stats = { nodes: 0, untokenColors: {}, spacers: 0, absolute: 0, flattenedInline: 0, comps: 0, instances: 0 };
const col = (rgb) => { const c = hex(rgb); if (!c) return null; const t = byHex[c.h]; if (!t) stats.untokenColors[c.h] = (stats.untokenColors[c.h] || 0) + 1; return [t || c.h, c.a]; };
const INLINE = new Set(['b', 'span', 'i', 'em', 'strong', 'small', 'u']);
const textOnly = (n) => n.k && n.k.every(k => k.t === '#text' || (INLINE.has(k.t) && textOnly(k)));
const flat = (n) => n.k.map(k => k.t === '#text' ? k.text : flat(k)).join(' ').replace(/\s+/g, ' ').trim();
const sig = (n) => n.t === '#text' ? 'T' : n.t + '.' + n.c + '(' + (n.k || []).map(sig).join(',') + ')';

function textSpec(n, s, txt, grow) {
  const lh = s.lineHeight === 'normal' ? null : px(s.lineHeight);
  return { k: 'T', n: n.c || n.t, tx: txt, fs: px(s.fontSize), fw: +s.fontWeight, lh, ls: px(s.letterSpacing) || 0, col: col(s.color), ta: s.textAlign === 'center' ? 'C' : s.textAlign === 'right' ? 'R' : undefined, sw: grow ? 'F' : 'H', op: +s.opacity < 1 ? +s.opacity : undefined, td: s.textDecorationLine === 'line-through' ? 'S' : s.textDecorationLine === 'underline' ? 'U' : undefined };
}

function spec(n, parent, pl) {
  stats.nodes++;
  if (n.t === 'svg') return { _b: [n.x, n.y, n.w, n.h], k: 'S', n: 'icon/' + n.icon, ic: n.icon, w: n.w, h: n.h, cl: hex(n.stroke !== 'none' ? n.stroke : n.color)?.h };
  const s = n.s;
  const abs = s.position === 'absolute' || s.position === 'fixed';
  if (abs) stats.absolute++;
  // whole element is text (possibly with inline children) -> one TEXT node, styled by the element
  const same = (k) => k.t === '#text' || (k.s && k.s.color === s.color && k.s.fontSize === s.fontSize && k.s.fontWeight === s.fontWeight && k.s.display.startsWith('inline') && (!k.k || k.k.every(same)));
  if (textOnly(n) && !/flex|grid/.test(s.display) && n.k.every(same) && s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.borderTopWidth === '0px' && !px(s.paddingTop) && !px(s.paddingLeft)) {
    if (n.k.some(k => k.t !== '#text')) stats.flattenedInline++;
    if (s.lineHeight === 'normal' && n.h < px(s.fontSize) * 1.9) s.lineHeight = n.h + 'px';
    const t = textSpec(n, s, flat(n), n.grow && pl !== 'H' || (pl === 'H' && +s.flexGrow > 0));
    t._b = [n.x, n.y, n.w, n.h]; if (abs) t.ab = [n.x - parent.x, n.y - parent.y];
    if (s.aw || (t.sw !== 'F' && n.h > px(s.fontSize) * 1.9)) { t.sw = 'X'; t.w = n.w; }
    return t;
  }
  const f = { _b: [n.x, n.y, n.w, n.h], k: 'F', n: (n.c || n.t).toString().trim() || n.t };
  const isFlex = s.display.includes('flex');
  const kids = (n.k || []);
  const isGrid = s.display.includes('grid');
  const inl = s.display.startsWith('inline') && !isFlex;
  const elk = kids.filter(k => k.t !== '#text' && k.w !== undefined), rowGeo = !isFlex && elk.length > 1 && kids.every(k => k.t !== '#text' || false) && elk.every((k, i) => i === 0 || (k.x >= elk[i - 1].x + elk[i - 1].w - 1 && Math.abs(k.y + k.h / 2 - (elk[i - 1].y + elk[i - 1].h / 2)) < 4));
  f.l = isGrid || (inl && kids.length) || rowGeo || (!isFlex && kids.some(k => k.t === '#text') && elk.length && n.h < px(s.fontSize) * 2.2) ? 'H' : isFlex ? (s.flexDirection.startsWith('column') ? 'V' : 'H') : (kids.length ? 'V' : null);
  if (f.l) {
    const pad = [px(s.paddingTop), px(s.paddingRight), px(s.paddingBottom), px(s.paddingLeft)];
    if (pad.some(Boolean)) f.p = pad;
    if (isFlex) {
      if (s.justifyContent === 'space-between') f.ja = 'SB'; else if (s.justifyContent === 'center') f.ja = 'C'; else if (s.justifyContent.includes('end')) f.ja = 'E';
      f.ca = s.alignItems === 'center' ? 'C' : s.alignItems.includes('end') ? 'E' : s.alignItems === 'stretch' ? undefined : 'S';
      const g = px(f.l === 'H' ? s.columnGap : s.rowGap) || px(s.gap); if (g && f.ja !== 'SB') f.g = g;
    }
  }
  const bg = col(s.backgroundColor); if (bg) f.fill = bg;
  if (+s.opacity < 1) f.op = +s.opacity;
  const rad = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(v => v.endsWith('%') ? Math.min(n.w, n.h) / 2 : px(v));
  if (rad.some(Boolean)) f.r = rad.every(v => v === rad[0]) ? Math.min(rad[0], Math.min(n.w, n.h) / 2) : rad;
  const bw = [px(s.borderTopWidth), px(s.borderRightWidth), px(s.borderLeftWidth) && px(s.borderBottomWidth), px(s.borderLeftWidth)];
  const bws = [px(s.borderTopWidth), px(s.borderRightWidth), px(s.borderBottomWidth), px(s.borderLeftWidth)];
  if (bws.some(Boolean) && !bws.every(v => v === bws[0])) f.sides = [col(bws[0] ? s.borderTopColor : s.borderBottomColor), bws];
  else if (px(s.borderTopWidth)) f.st = [col(s.borderTopColor), px(s.borderTopWidth), s.borderTopStyle === 'dashed' ? 1 : 0];
  else if (px(s.borderBottomWidth)) f.sb = [col(s.borderBottomColor), px(s.borderBottomWidth)];
  if (s.boxShadow !== 'none') f.sh = s.boxShadow;
  if (s.overflow === 'hidden') f.clip = 1;
  // sizing
  const fixedLeaf = !kids.length || s.aw || s.ah;
  const els = kids.filter(k => k.t !== '#text' && !(k.s && /absolute|fixed/.test(k.s.position)));
  const pw = px(s.paddingLeft) + px(s.paddingRight), ph = px(s.paddingTop) + px(s.paddingBottom);
  const cw = els.length ? (f.l === 'H' ? els.reduce((a, k) => a + k.w, 0) : Math.max(...els.map(k => k.w))) : 0, ch = els.length ? (f.l === 'V' ? els.reduce((a, k) => a + k.h, 0) : Math.max(...els.map(k => k.h))) : 0;
  const bigW = els.length && kids.every(k => k.t !== '#text') && n.w > cw + pw + 2 && f.ja !== 'SB', bigH = els.length && kids.every(k => k.t !== '#text') && n.h > ch + ph + 2 && f.l === 'H';
  f.sw = (pl === 'G' ? n.grow : pl === 'H' ? +s.flexGrow > 0 : n.grow) ? 'F' : (fixedLeaf || bigW ? 'X' : 'H');
  f.sv = (s.ah || !kids.length || bigH) ? 'X' : 'H';
  if (pl === 'V' && s.alignSelf === 'stretch') f.sw = 'F';
  f.w = n.w; f.h = n.h;
  if (abs) f.ab = [n.x - parent.x, n.y - parent.y];
  // children; block flow: margins become spacers when gaps are uneven
  const out = [];
  let prev = null;
  const cx0 = n.x + px(s.paddingLeft) + px(s.borderLeftWidth), cy0 = n.y + px(s.paddingTop) + px(s.borderTopWidth);
  const cx1 = n.x + n.w - px(s.paddingRight) - px(s.borderRightWidth), cy1 = n.y + n.h - px(s.paddingBottom) - px(s.borderBottomWidth);
  const outside = (k) => k.y < n.y - 0.5 || k.y + k.h > n.y + n.h + 0.5 || k.x < n.x - 0.5 || k.x + k.w > n.x + n.w + 0.5;
  const flow = kids.filter(k => k.t !== '#text' && !(k.s && /absolute|fixed/.test(k.s.position)) && !outside(k));
  const Hz = f.l === 'H', geo = f.l && flow.length && kids.every(k => k.t !== '#text');
  let spacerBefore = new Map();
  if (geo) {
    const st = k => Hz ? k.x : k.y, en = k => Hz ? k.x + k.w : k.y + k.h;
    const gaps = flow.slice(1).map((k, i) => +(st(k) - en(flow[i])).toFixed(1));
    const lead = +(st(flow[0]) - (Hz ? cx0 : cy0)).toFixed(1), trail = +((Hz ? cx1 : cy1) - en(flow[flow.length - 1])).toFixed(1);
    if (!['SB', 'C', 'E'].includes(f.ja) && lead > 0.5) { f.p = f.p || [0, 0, 0, 0]; f.p[Hz ? 3 : 0] = +(f.p[Hz ? 3 : 0] + lead).toFixed(1); }
    if (f.ja !== 'SB' && gaps.length) {
      const sorted = [...gaps].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const uniq = [...new Set(gaps.map(g => Math.round(g * 2) / 2))];
      const cssGap = px(Hz ? s.columnGap : s.rowGap) || px(s.gap) || 0;
      if (gaps.length === 1 && trail < 0.5 && gaps[0] > cssGap + 8) { delete f.g; spacerBefore.set(flow[1], { k: 'SP', fill: 1 }); }
      else if (uniq.length === 1 && uniq[0] >= 0) { if (uniq[0]) f.g = uniq[0]; else delete f.g; }
      else { delete f.g; gaps.forEach((g, i) => { const pushed = trail < 0.5 && g > med + 8 && i === gaps.length - 1; if (pushed) spacerBefore.set(flow[i + 1], { k: 'SP', fill: 1 }); else if (g > 0.5) spacerBefore.set(flow[i + 1], Hz ? { k: 'SP', w: g } : { k: 'SP', h: g }); }); }
    }
    const c0 = Hz ? cy0 : cx0, c1 = Hz ? cy1 : cx1, cst = k => Hz ? k.y : k.x, csz = k => Hz ? k.h : k.w;
    const spans = flow.every(k => Math.abs(csz(k) - (c1 - c0)) < 1);
    if (!spans) {
      const dev = (m) => Math.max(...flow.map(k => Math.abs(m === 'S' ? cst(k) - c0 : m === 'E' ? c1 - (cst(k) + csz(k)) : (cst(k) + csz(k) / 2) - (c0 + c1) / 2)));
      const best = ['S', 'C', 'E'].map(m => [m, dev(m)]).sort((a, b) => a[1] - b[1])[0];
      f.ca = best[0]; if (best[1] > 1.5) stats.crossDeviation = (stats.crossDeviation || 0) + 1;
    }
  }
  if (f.l === 'H' && !geo && !isFlex && kids.some(k => k.t === '#text')) { f.ca = 'C'; const m = Math.max(0, ...kids.filter(k => k.s).map(k => px(k.s.marginRight) + px(k.s.marginLeft))); if (m) f.g = m; if (s.lineHeight === 'normal') s.lineHeight = n.h + 'px'; }
  for (const ch of kids) {
    if (ch.t === '#text') { const t = textSpec(n, s, ch.text, f.l === 'V'); t._b = [ch.x, ch.y, ch.w, ch.h]; if (f.sw !== 'F' && f.l === 'V') { t.sw = 'X'; t.w = +(cx1 - cx0).toFixed(1); } out.push(t); continue; }
    const cs = spec(ch, n, isGrid ? 'G' : f.l);
    if (!cs.ab && ch.t !== '#text' && outside(ch)) { cs.ab = [+(ch.x - n.x).toFixed(1), +(ch.y - n.y).toFixed(1)]; stats.outside = (stats.outside || 0) + 1; }
    if (f.l === 'V' && cs.k === 'F' && cs.sw === 'F' && !cs.fill && !cs.st && !cs.sides && ch.w < (cx1 - cx0) - 1) { const ml = +(ch.x - cx0).toFixed(1), mr = +(cx1 - ch.x - ch.w).toFixed(1); cs.p = cs.p || [0, 0, 0, 0]; cs.p[3] += ml; cs.p[1] += mr; cs.w = +(cx1 - cx0).toFixed(1); }
    if (spacerBefore.has(ch)) { out.push(spacerBefore.get(ch)); stats.spacers++; }
    if (!geo && f.l === 'V' && !isFlex && prev && !cs.ab) {
      const gap = +(ch.y - (prev.y + prev.h)).toFixed(1);
      if (gap > 0.5) { out.push({ k: 'SP', h: gap }); stats.spacers++; }
    }
    if (!cs.ab) prev = ch;
    cs.sig = ch.t === '#text' ? undefined : sig(ch);
    out.push(cs);
  }
  if (out.length) f.c = out;
  return f;
}

// components: same structure signature, a class name, at least 3 uses across screens
const counts = {};
const screens = Object.entries(ir.screens).map(([code, sc]) => [code, sc.name, spec(sc.root, sc.root, null)]);
const walk = (f, fn) => { fn(f); (f.c || []).forEach(c => walk(c, fn)); };
screens.forEach(([, , r]) => walk(r, (f) => { if (f.sig && f.k === 'F' && f.n && f.c) counts[f.sig] = (counts[f.sig] || 0) + 1; }));
const compSigs = Object.entries(counts).filter(([s, c]) => c >= 3).map(([s]) => s);
const comps = {};
screens.forEach(([, , r]) => walk(r, (f) => {
  if (!compSigs.includes(f.sig) || f.inComp) return;
  if (!comps[f.sig]) { comps[f.sig] = 'cmp/' + f.n.replace(/\s+/g, '.'); f.def = comps[f.sig]; stats.comps++; } else { f.inst = comps[f.sig]; stats.instances++; }
  walk(f, (d) => { if (d !== f) d.inComp = 1; });
}));
const strip = (f) => { delete f.sig; delete f.inComp; (f.c || []).forEach(strip); };
screens.forEach(([, , r]) => strip(r));

// icons actually used, with svg markup
const used = new Set(); screens.forEach(([, , r]) => walk(r, (f) => { if (f.k === 'S') used.add(f.ic); }));
const icons = Object.fromEntries([...used].map(id => [id, ir.symbols[id]]));
const tokens = Object.fromEntries(Object.entries(ir.rootVars).map(([k, v]) => [k.slice(2), v]).concat([['white', '#FFFFFF']]));

const build = { remove: (process.env.REMOVE || '').split(',').filter(Boolean), tokens, icons, screens: screens.map(([code, name, root]) => ({ code, name, root })) };
const exp = {}; for (const sc of build.screens) { const L = []; const w = (f) => { for (const c of f.c || []) { if (c.k === 'SP') continue; L.push([c.n, ...(c._b || [null, null, null, null])]); if (c.k === 'F') w(c); } }; w(sc.root); exp[sc.name] = L; }
fs.writeFileSync(path.join(O, 'expected.json'), JSON.stringify(exp));
const noPriv = (k, v) => k.startsWith('_') ? undefined : v;
fs.writeFileSync(path.join(O, 'build.json'), JSON.stringify(build, noPriv));
const rt = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
const payload = rt + '\nconst D=' + JSON.stringify(build, noPriv) + ';\nreturn await run(D);';
fs.writeFileSync(path.join(O, 'payload.js'), payload);
console.log(JSON.stringify({ ...stats, compNames: Object.values(comps), runtimeBytes: rt.length, dataBytes: JSON.stringify(build, noPriv).length, payloadBytes: payload.length }, null, 1));
