// Build: proxy boxes (A/B) for pl0,c20,fe0 + probe, Chrome line-height:normal table, and the use_figma code per screen.
const path = require('path'), fs = require('fs');
const S2 = path.join(__dirname, '../spike2');
const { chromium } = require(S2 + '/node_modules/playwright-core');
const { buildHtml } = require(S2 + '/proxy');
const { renderProxy, flatten } = require(S2 + '/compare');
const probe = require('./probe');
const OUT = path.join(__dirname, 'out');
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1255/chrome-win64/chrome.exe');
const ir = JSON.parse(fs.readFileSync(S2 + '/out/ir.json', 'utf8'));
const IDS = ['pl0', 'c20', 'fe0'];
const XPOS = { pl0: 0, c20: 500, fe0: 1000, pr: 1500 };
const BVLINK = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap';

const r2 = v => Math.round(v * 100) / 100;
function famList(ff) {
  if (/Be Vietnam Pro/.test(ff)) return ['Be Vietnam Pro'];
  if (/Material Symbols Outlined/.test(ff)) return ['Material Symbols Outlined', 'Material Symbols Rounded'];
  if (/^Roboto/.test(ff)) return ['Roboto'];
  if (/^"?Inter/.test(ff)) return ['Inter'];
  if (/^"?Segoe UI/.test(ff)) return ['Segoe UI'];
  if (/system-ui/.test(ff)) return ['Segoe UI', 'Inter'];
  return ['Inter'];
}
function color(s) {
  if (!s || s === 'none' || s === 'transparent') return s === 'none' ? 'none' : '#00000000';
  if (s[0] === '#') return s.length === 4 ? '#' + [...s.slice(1)].map(c => c + c).join('') : s.toLowerCase();
  const m = s.match(/rgba?\(([^)]+)\)/); const v = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  const h = v.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  return '#' + h + (v.length > 3 && v[3] < 1 ? Math.round(v[3] * 255).toString(16).padStart(2, '0') : '');
}
function encode(spec, scr, order, name, X, extraData) {
  const C = [], Ci = new Map(), F = [], Fi = new Map(), FM = {}, FMi = new Map(), I = [], Ii = new Map();
  const col = s => { const c = color(s); if (!Ci.has(c)) { Ci.set(c, C.length); C.push(c); } return Ci.get(c); };
  const fam = ff => { if (!FMi.has(ff)) { const k = String.fromCharCode(97 + FMi.size); FMi.set(ff, k); FM[k] = famList(ff); } return FMi.get(ff); };
  const px = v => (v === 'normal' || v == null ? 0 : parseFloat(v));
  const fontIdx = f => {
    const e = [fam(f.ff), +f.fw, parseFloat(f.fs), f.lh, px(f.ls), col(f.c), f.td === 'line-through' ? 'l' : f.td === 'underline' ? 'u' : 0,
      { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' }[f.tt] || 0, /center/.test(f.ta) ? 'CENTER' : /right|end/.test(f.ta) ? 'RIGHT' : 0, f.fst === 'italic' ? 1 : 0];
    const k = JSON.stringify(e); if (!Fi.has(k)) { Fi.set(k, F.length); F.push(e); } return Fi.get(k);
  };
  const svgById = {}; (function idx(n) { if (n.k === 'svg') svgById[n.id] = n; (n.kids || []).forEach(idx); })(scr.tree || {});
  const icon = (id) => {
    if (!Ii.has(id)) {
      const sym = scr.symbols.find(x => x.includes(`id="${id.slice(1)}"`));
      const vb = sym.match(/viewBox="([^"]+)"/)[1]; const body = sym.replace(/^\s*<symbol[^>]*>/, '').replace(/<\/symbol>\s*$/, '').replace(/\s+/g, ' ').trim();
      Ii.set(id, I.length); I.push([vb, body]);
    } return Ii.get(id);
  };
  const minWH = (n) => Math.min(n.w, n.h);
  const node = (n) => {
    const o = { n: n.syn ? undefined : n.id, t: n.t, w: r2(n.w), h: r2(n.h), s: n.sz.join('') };
    if (!n.syn && order.has(n.id)) o.o = order.get(n.id);
    if (n.lay && n.lay.d) { const l = n.lay; o.l = [l.d, ...l.p, l.g || 0, l.pa || 'S', l.ca || 'S', l.sb ? 1 : 0, l.wrap ? 1 : 0, l.cg || 0]; if (o.l[5] === undefined) o.l[5] = 0; }
    if (n.abs) { o.a = [n.abs.x, n.abs.y, n.abs.cx.replace('?', ''), n.abs.cy.replace('?', '')]; }
    if (n.minW || n.maxW || n.minH || n.maxH) o.m = [n.minW || 0, n.maxW || 0, n.minH || 0, n.maxH || 0];
    const p = n.p || {};
    if (p.bg) o.bg = col(p.bg);
    if (p.rad) { const rd = p.rad.map(v => /%/.test(v) ? r2(parseFloat(v) / 100 * minWH(n)) : parseFloat(v)); if (rd.some(Boolean)) o.rd = rd; }
    if (p.bd) { const b = p.bd.map(x => x || [0, 'none', 'transparent']); const nz = b.find(x => x[0] && x[1] !== 'none');
      if (nz) o.bd = [b.map(x => (x[1] === 'none' ? 0 : x[0])), col(nz[2]), b.some(x => /dash|dot/.test(x[1])) ? 1 : 0]; }
    if (p.sh) { o.sh = p.sh.split(/,(?![^(]*\))/).filter(x => !/inset/.test(x)).map(x => { const m = x.trim().match(/^(rgba?\([^)]+\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?/); return m ? [col(m[1]), +m[2], +m[3], +m[4], +(m[5] || 0)] : null; }).filter(Boolean); }
    if (p.op != null && p.op !== 1) o.op = +p.op;
    if (p.clip) o.c = 1;
    if (p.tf) { const m = p.tf.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number); const to = (p.to || '0px 0px').split(' ').map(parseFloat);
      o.tf = [m[0], m[1], m[2], m[3], to[0], to[1]]; if (o.a && (m[4] || m[5])) { o.a[0] += m[4]; o.a[1] += m[5]; } }
    if (n.t === 'T') {
      o.f = fontIdx(n.font);
      const plain = n.runs.every(r => !r.s);
      o.x = plain ? n.runs.map(r => (r.br ? '\n' : r.t)).join('') : n.runs.map(r => {
        if (r.br) return ['\n']; if (!r.s) return [r.t]; const s = {}, st = r.s;
        if (st.fs) s.fs = parseFloat(st.fs); if (st.fw) s.fw = +st.fw; if (st.ff) s.fk = fam(st.ff); if (st.c) s.c = col(st.c); if (st.ls) s.ls = px(st.ls); if (st.fst === 'italic') s.it = 1;
        return [r.t, s];
      });
    }
    if (n.t === 'R') { o.f = fontIdx(n.font); o.x = n.name; }
    if (n.t === 'V') { const sv = n.sv || {}; o.v = [icon(n.icon), col(sv.stroke), col(sv.fill), parseFloat(sv.sw) || 1, col(sv.c)]; }
    if (n.kids && n.kids.length) o.k = n.kids.map(node);
    return o;
  };
  const T = node(spec);
  return { name, X, FM, F, C, I, T, ...extraData };
}

async function main() {
  const runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
  const browser = await chromium.launch({ executablePath: EXE });
  const meta = {};
  const screens = IDS.map(id => ({ id, scr: ir[id], spec: JSON.parse(fs.readFileSync(`${S2}/out/spec-${id}.json`, 'utf8')) }));
  screens.push({ id: 'pr', scr: { W: probe.W, symbols: [], links: [BVLINK], backdrop: '#fff' }, spec: probe.spec });
  for (const { id, scr, spec } of screens) {
    const svgs = {}; (function idx(n) { if (n.k === 'svg') svgs[n.id] = n.svg; (n.kids || []).forEach(idx); })(scr.tree || {});
    const html = buildHtml(scr, spec, ref => svgs[ref]);
    const prox = {};
    for (const [M, i] of [['A', 0], ['B', 1]]) prox[M] = await renderProxy(browser, html, scr.W[i], path.join(OUT, `prox-${id}-${M}.png`));
    fs.writeFileSync(path.join(OUT, `prox-${id}.json`), JSON.stringify(prox));
    // comparer order: flatten(source tree) for real screens, spec DFS (non-synthetic) for the probe
    const order = new Map();
    if (scr.tree) flatten(scr.tree).forEach(({ n }, i) => order.set(n.id, i));
    else { let i = 0; (function v(n) { if (!n.syn) order.set(n.id, i++); (n.kids || []).forEach(v); })(spec); }
    const extra = id === 'pr' ? { LN: probe.LN.map(([k, w, s]) => [{ bv: 'Be Vietnam Pro', rb: 'Roboto', in: 'Inter', su: 'Segoe UI' }[k], w, s]) } : {};
    const D = encode(spec, scr, order, 'spike3-' + id, XPOS[id], extra);
    const data = JSON.stringify(D);
    let ex = '';
    if (id === 'pr') ex = fs.readFileSync(path.join(__dirname, 'probe-extra.js'), 'utf8');
    if (id === 'pl0') ex = fs.readFileSync(path.join(__dirname, 'pl0-extra.js'), 'utf8');
    const code = runtime.replace('__DATA__', () => data).replace('__EXTRA__', () => ex);
    fs.writeFileSync(path.join(OUT, `code-${id}.js`), code);
    meta[id] = { order: [...order.keys()], data: data.length, code: code.length };
    console.log(id, 'nodes', order.size, 'data', data.length, 'code', code.length);
  }
  // Chrome line-height:normal table
  const page = await browser.newPage();
  await page.setContent(`<html><head><link rel="stylesheet" href="${BVLINK}"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Inter:wght@400;700&display=swap"></head><body>` +
    probe.LN.map(([k, w, s], i) => `<div id="l${i}" style="display:block;font-family:${probe.LNF[k]};font-weight:${w};font-size:${s}px;line-height:normal;white-space:nowrap">Hg Ăn ơ</div>`).join('') + '</body></html>', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const ln = await page.evaluate((n) => Array.from({ length: n }, (_, i) => Math.round(document.getElementById('l' + i).getBoundingClientRect().height * 100) / 100), probe.LN.length);
  meta.lnChrome = probe.LN.map((x, i) => [...x, ln[i]]);
  console.log('chrome normal lh', JSON.stringify(meta.lnChrome));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  await browser.close();
}
main();
