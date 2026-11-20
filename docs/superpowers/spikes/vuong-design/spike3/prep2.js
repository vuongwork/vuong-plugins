// Corrected proxies: re-render the proxy with text boxes pinned to (a) Figma's own text sizes -> isolates layout semantics,
// (b) the "ceil model" (w = ceil(chromeW - trailing letter-spacing), h = ceil(chromeH)) -> a correction usable before writing to Figma.
const path = require('path'), fs = require('fs');
const S2 = path.join(__dirname, '../spike2');
const { chromium } = require(S2 + '/node_modules/playwright-core');
const { buildHtml } = require(S2 + '/proxy');
const { renderProxy } = require(S2 + '/compare');
const probe = require('./probe');
const OUT = path.join(__dirname, 'out');
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1255/chrome-win64/chrome.exe');
const ir = JSON.parse(fs.readFileSync(S2 + '/out/ir.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync(OUT + '/meta.json', 'utf8'));
const wide = JSON.parse(fs.readFileSync(OUT + '/fig-wide.json', 'utf8'));
const BVLINK = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap';

function figBoxes(id) {
  const F = { A: {}, B: {} };
  if (id === 'pr') { for (const [k, ...b] of wide.prA) F.A[k] = b; for (const [k, ...b] of wide['spike3-pr']) F.B[k] = b; return F; }
  const fa = JSON.parse(fs.readFileSync(`${OUT}/fig-${id}-A.json`, 'utf8'));
  meta[id].order.forEach((nid, i) => { if (fa.B[i]) F.A[nid] = fa.B[i]; });
  for (const [k, ...b] of wide['spike3-' + id]) F.B[k] = b;
  return F;
}
function patch(spec, size) { // size(n) -> [w|null, h|null]
  const s = JSON.parse(JSON.stringify(spec));
  (function v(n) {
    if (n.t === 'T') { const [w, h] = size(n); if (w != null && n.sz[0] === 'H') { n.sz[0] = 'X'; n.w = w; } if (h != null && n.sz[1] === 'H') { n.sz[1] = 'X'; n.h = h; } }
    (n.kids || []).forEach(v);
  })(s);
  return s;
}
async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  for (const id of ['pl0', 'c20', 'fe0', 'pr']) {
    const scr = id === 'pr' ? { W: probe.W, symbols: [], links: [BVLINK], backdrop: '#fff' } : ir[id];
    const spec = id === 'pr' ? probe.spec : JSON.parse(fs.readFileSync(`${S2}/out/spec-${id}.json`, 'utf8'));
    const svgs = {}; (function idx(n) { if (n.k === 'svg') svgs[n.id] = n.svg; (n.kids || []).forEach(idx); })(scr.tree || {});
    const prox = JSON.parse(fs.readFileSync(`${OUT}/prox-${id}.json`, 'utf8'));
    const F = figBoxes(id);
    const out = { fig: {}, ceil: {} };
    for (const [M, i] of [['A', 0], ['B', 1]]) {
      const sFig = patch(spec, n => { const b = F[M][n.id]; return b ? [b[2], b[3]] : [null, null]; });
      const sCeil = patch(spec, n => { const p = prox[M].nodes[n.id]; if (!p) return [null, null]; const ls = parseFloat(n.font.ls) || 0; return [Math.ceil(p.r[2] - ls - 0.001), Math.ceil(p.r[3] - 0.001)]; });
      out.fig[M] = await renderProxy(browser, buildHtml(scr, sFig, r => svgs[r]), scr.W[i], path.join(OUT, `p2fig-${id}-${M}.png`));
      out.ceil[M] = await renderProxy(browser, buildHtml(scr, sCeil, r => svgs[r]), scr.W[i], path.join(OUT, `p2ceil-${id}-${M}.png`));
    }
    fs.writeFileSync(`${OUT}/prox2-${id}.json`, JSON.stringify(out));
    console.log('ok', id);
  }
  const page = await browser.newPage(); await page.setContent('<p>x</p>');
  const wd = f => page.evaluate(f => { const c = document.createElement('canvas').getContext('2d'); c.font = '20px ' + f; return c.measureText('Thêm giao dịch 0123').width; }, f);
  console.log('local font check (width vs monospace):', 'Roboto', await wd('Roboto, monospace'), 'Segoe', await wd('"Segoe UI", monospace'), 'mono', await wd('monospace'));
  await browser.close();
}
main();
