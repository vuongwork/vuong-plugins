// Orchestrate: IR → spec (infer) → proxy HTML → render at both widths → per-node compare. Writes out/report.json, out/spec-*.json.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { inferScreen } = require('./infer');
const { buildHtml } = require('./proxy');
const { renderProxy, compareScreen } = require('./compare');
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1255/chrome-win64/chrome.exe');
const OUT = path.join(__dirname, 'out');

const stripForPayload = (spec) => JSON.stringify(spec, (k, v) => (k === 'svgRef' ? undefined : v));

async function main() {
  const ir = JSON.parse(fs.readFileSync(path.join(OUT, 'ir.json'), 'utf8'));
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const browser = await chromium.launch({ executablePath: EXE });
  const report = {};
  for (const [id, scr] of Object.entries(ir)) {
    if (only && !only.includes(id)) continue;
    const { spec, stats } = inferScreen(scr);
    const svgs = {}; const idx = (n) => { if (n.k === 'svg') svgs[n.id] = n.svg; (n.kids || []).forEach(idx); }; idx(scr.tree);
    const html = buildHtml(scr, spec, (ref) => svgs[ref]);
    fs.writeFileSync(path.join(OUT, `spec-${id}.json`), JSON.stringify(spec, null, 1));
    const prox = {};
    for (const [M, i] of [['A', 0], ['B', 1]]) prox[M] = await renderProxy(browser, html, scr.W[i], path.join(OUT, `prox-${id}-${M}.png`));
    const ci = { srcA: path.join(OUT, `src-${id}-A.png`), srcB: path.join(OUT, `src-${id}-B.png`), proxA: path.join(OUT, `prox-${id}-A.png`), proxB: path.join(OUT, `prox-${id}-B.png`) };
    const cmp = compareScreen(scr, prox, ci);
    delete cmp.A.st; delete cmp.B.st;
    const payload = stripForPayload(spec).length;
    report[id] = { name: scr.name, W: scr.W, nodes: cmp.total, checked: cmp.checked, missing: cmp.missing,
      passA: cmp.A.pass, failA: cmp.A.fail, passB: cmp.B.pass, failB: cmp.B.fail, rootsA: cmp.A.roots, rootsB: cmp.B.roots,
      content: cmp.content, crop: cmp.crop, pix: cmp.pix, stats, payload, dropped: scr.dropped, merged: scr.merged, mixedInline: scr.mixedInline,
      proxH: [prox.A.H, prox.B.H], srcH: scr.H };
    const r = report[id];
    console.log(`${id.padEnd(5)} nodes ${String(r.nodes).padStart(3)} cov ${r.checked}/${r.nodes} A ${(100 * r.passA / r.nodes).toFixed(1)}% B ${(100 * r.passB / r.nodes).toFixed(1)}% roots ${r.rootsA.length}/${r.rootsB.length} pix ${(100 * r.pix.A).toFixed(2)}%/${(100 * r.pix.B).toFixed(2)}% crop ${r.crop.length} content ${r.content.length} spec ${payload}B  ${r.name.slice(0, 28)}`);
  }
  await browser.close();
  const prev = fs.existsSync(path.join(OUT, 'report.json')) && only ? JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')) : {};
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...prev, ...report }, null, 1));
}
if (require.main === module) main();
