// Layer-4 check of the comparer: inject defects into a proxy that otherwise passes, confirm each is flagged.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { inferScreen } = require('./infer');
const { buildHtml } = require('./proxy');
const { renderProxy, compareScreen, flatten } = require('./compare');
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1255/chrome-win64/chrome.exe');
const OUT = path.join(__dirname, 'out');

(async () => {
  const id = process.argv[2] || 'pl0';
  const scr = JSON.parse(fs.readFileSync(path.join(OUT, 'ir.json'), 'utf8'))[id];
  const { spec } = inferScreen(scr);
  const svgs = {}; const idx = (n) => { if (n.k === 'svg') svgs[n.id] = n.svg; (n.kids || []).forEach(idx); }; idx(scr.tree);
  const html = buildHtml(scr, spec, (r) => svgs[r]);
  const nodes = flatten(scr.tree).map(x => x.n);
  const tick = nodes.find(n => n.pseudo);                      // thin check-mark (::after) — smallest leaf
  const shape = nodes.find(n => n.k === 'shape' && n.r[2] <= 14); // small shape to shift
  const text = nodes.find(n => n.k === 'text' && n.r[2] > 60);     // a text label to shift (text tolerance 1px)
  const icon = nodes.find(n => n.k === 'svg' && n.icon);
  const other = [...new Set(nodes.filter(n => n.k === 'svg').map(n => n.icon))].find(i => i && i !== icon.icon) || '#nope';
  const muts = [
    { name: `shift shape ${shape.id} by 3px`, target: shape.id, fn: ({ id }) => { document.querySelector(`[data-id="${id}"]`).style.left = '3px'; } },
    { name: `shift text ${text.id} by 3px`, target: text.id, fn: ({ id }) => { document.querySelector(`[data-id="${id}"]`).style.left = '3px'; } },
    { name: `swap icon ${icon.id} ${icon.icon} → ${other}`, target: icon.id, fn: ({ id, other }) => { document.querySelector(`[data-id="${id}"] use`).setAttribute('href', other); } },
    { name: `delete tick ${tick.id} (${tick.r[2]}x${tick.r[3]})`, target: tick.id, fn: ({ id }) => { document.querySelector(`[data-id="${id}"]`).remove(); } },
    { name: `hide tick ${tick.id} (keep box, visibility:hidden)`, target: tick.id, fn: ({ id }) => { document.querySelector(`[data-id="${id}"]`).style.visibility = 'hidden'; } },
  ];
  const browser = await chromium.launch({ executablePath: EXE });
  const base = {};
  for (const [M, i] of [['A', 0], ['B', 1]]) base[M] = await renderProxy(browser, html, scr.W[i], path.join(OUT, `mut-${id}-base-${M}.png`));
  const b = compareScreen(scr, base, { srcA: path.join(OUT, `src-${id}-A.png`), srcB: path.join(OUT, `src-${id}-B.png`), proxA: path.join(OUT, `mut-${id}-base-A.png`), proxB: path.join(OUT, `mut-${id}-base-B.png`) });
  console.log(`baseline ${id}: roots ${b.A.roots.length}/${b.B.roots.length}, missing ${b.missing.length}, content ${b.content.length}, crop ${b.crop.length}, pix ${(100 * b.pix.A).toFixed(2)}%`);
  const results = [];
  for (const [mi, m] of muts.entries()) {
    const prox = {};
    for (const [M, i] of [['A', 0], ['B', 1]]) prox[M] = await renderProxy(browser, html, scr.W[i], path.join(OUT, `mut-${id}-${mi}-${M}.png`), { fn: m.fn, arg: { id: m.target, other } });
    const c = compareScreen(scr, prox, { srcA: path.join(OUT, `src-${id}-A.png`), srcB: path.join(OUT, `src-${id}-B.png`), proxA: path.join(OUT, `mut-${id}-${mi}-A.png`), proxB: path.join(OUT, `mut-${id}-${mi}-B.png`) });
    const det = {
      box: c.A.roots.some(r => r.id === m.target),
      coverage: c.missing.some(x => x.id === m.target),
      data: c.content.some(x => x.id === m.target),
      crop: c.crop.some(x => x.id === m.target),
    };
    const pixDelta = (c.pix.A - b.pix.A) * 100;
    const r = { mutation: m.name, caught: Object.values(det).some(Boolean), ...det, pixDeltaPct: +pixDelta.toFixed(4), cropDetail: c.crop.filter(x => x.id === m.target) };
    results.push(r); console.log(JSON.stringify(r));
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `mutation-${id}.json`), JSON.stringify(results, null, 1));
})();
