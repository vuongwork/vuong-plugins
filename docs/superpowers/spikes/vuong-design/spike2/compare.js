// Render a proxy page at both widths, measure by data-id, compare per node with the source (box + content + crop) and whole-screen pixels.
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const DSF = 2;
const TOL = { frame: 0.5, text: 1 };
const CROP_RATIO = 0.05, CROP_MIN = 24; // device px

async function renderProxy(browser, html, W, outPng, mutate) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: DSF });
  const f = outPng.replace(/\.png$/, '.html');
  fs.writeFileSync(f, html);
  await page.goto('file:///' + f.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate((w) => document.querySelector('[data-id="n"]').style.setProperty('--W', w + 'px'), W);
  await page.evaluate(() => document.fonts.ready);
  if (mutate) await page.evaluate(mutate.fn, mutate.arg);
  await page.waitForTimeout(50);
  const m = await page.evaluate(() => {
    const root = document.querySelector('[data-id="n"]'); const R = root.getBoundingClientRect();
    const r2 = (v) => Math.round(v * 100) / 100; const out = {};
    for (const el of document.querySelectorAll('[data-id]')) {
      const b = el.getBoundingClientRect();
      const o = { r: [r2(b.left - R.left), r2(b.top - R.top), r2(b.width), r2(b.height)] };
      const u = el.querySelector(':scope > svg use'); if (u) o.icon = u.getAttribute('href') || u.getAttribute('xlink:href');
      let txt = ''; const rec = (x) => { for (const c of x.childNodes) { if (c.nodeType === 3) txt += c.textContent; else if (c.tagName === 'BR') txt += '\n'; else if (c.tagName === 'SPAN') rec(c); } };
      rec(el); o.txt = txt;
      out[el.dataset.id] = o;
    }
    return { nodes: out, W: R.width, H: R.height };
  });
  await page.locator('[data-id="n"]').screenshot({ path: outPng, animations: 'disabled' });
  await page.close();
  return m;
}

const readPng = (f) => PNG.sync.read(fs.readFileSync(f));
function crop(png, r, pad = 1) {
  const x0 = Math.max(0, Math.floor((r[0] - pad) * DSF)), y0 = Math.max(0, Math.floor((r[1] - pad) * DSF));
  const x1 = Math.min(png.width, Math.ceil((r[0] + r[2] + pad) * DSF)), y1 = Math.min(png.height, Math.ceil((r[1] + r[3] + pad) * DSF));
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0); const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) png.data.copy(out.data, y * w * 4, ((y0 + y) * png.width + x0) * 4, ((y0 + y) * png.width + x0 + w) * 4);
  return out;
}
function pixDiff(a, b) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  if (!w || !h) return { diff: 0, area: 0, ratio: 0 };
  const A = crop(a, [0, 0, w / DSF, h / DSF], 0), B = crop(b, [0, 0, w / DSF, h / DSF], 0);
  const diff = pixelmatch(A.data, B.data, null, w, h, { threshold: 0.1 });
  const area = Math.max(a.width, b.width) * Math.max(a.height, b.height);
  const extra = area - w * h;
  return { diff: diff + extra, area, ratio: (diff + extra) / area };
}

function flatten(tree) { const out = []; const v = (n, parent, prev) => { out.push({ n, parent, prev }); (n.kids || []).forEach((k, i) => v(k, n, n.kids[i - 1])); }; v(tree, null, null); return out; }
const srcText = (n) => (n.runs || []).map(r => r.br ? '\n' : r.t).join('');

function compareScreen(scr, prox, pngs) {
  const nodes = flatten(scr.tree);
  const res = { total: nodes.length, checked: 0, missing: [], A: { pass: 0, fail: 0, roots: [] }, B: { pass: 0, fail: 0, roots: [] }, content: [], crop: [], nodeRes: {} };
  for (const M of ['A', 'B']) {
    const P = prox[M].nodes; const st = {};
    for (const { n, parent } of nodes) {
      const s = M === 'A' ? n.r : n.rB; const p = P[n.id];
      if (!p) { st[n.id] = { miss: 1 }; continue; }
      const tol = n.k === 'text' ? TOL.text : TOL.frame;
      const dl = [p.r[0] - s[0], p.r[1] - s[1], p.r[2] - s[2], p.r[3] - s[3]];
      const err = Math.max(...dl.map(Math.abs));
      st[n.id] = { ok: err <= tol, err, dl, tol };
    }
    for (const { n, parent, prev } of nodes) {
      const x = st[n.id]; if (x.miss) continue;
      if (x.ok) { res[M].pass++; continue; }
      res[M].fail++;
      // inherited = own size right, and position offset explained by the parent's offset or by the previous sibling's
      // offset/end-edge offset (a sibling pushed by an earlier sibling's error is not a root cause)
      let inherited = false;
      if (Math.abs(x.dl[2]) <= x.tol && Math.abs(x.dl[3]) <= x.tol) {
        const refs = [];
        const ps = parent && st[parent.id]; if (ps && !ps.miss) refs.push([ps.dl[0], ps.dl[1]]);
        const qs = prev && st[prev.id];
        if (qs && !qs.miss) refs.push([qs.dl[0], qs.dl[1]], [qs.dl[0] + qs.dl[2], qs.dl[1]], [qs.dl[0], qs.dl[1] + qs.dl[3]]);
        const xs = refs.map(r => r[0]), ys = refs.map(r => r[1]);
        inherited = (xs.some(v => Math.abs(x.dl[0] - v) <= x.tol) || Math.abs(x.dl[0]) <= x.tol) && (ys.some(v => Math.abs(x.dl[1] - v) <= x.tol) || Math.abs(x.dl[1]) <= x.tol);
      }
      if (!inherited) res[M].roots.push({ id: n.id, k: n.k, tag: n.tag, cls: n.cls, pseudo: n.pseudo, dl: x.dl.map(v => Math.round(v * 100) / 100), text: n.k === 'text' ? srcText(n).slice(0, 30) : undefined });
    }
    res[M].st = st;
  }
  for (const { n } of nodes) {
    const inBoth = prox.A.nodes[n.id] && prox.B.nodes[n.id];
    if (inBoth) res.checked++; else res.missing.push({ id: n.id, k: n.k, cls: n.cls, pseudo: n.pseudo });
    const p = prox.A.nodes[n.id]; if (!p) continue;
    // content (data) check
    if (n.k === 'text' && p.txt !== srcText(n)) res.content.push({ id: n.id, what: 'text', src: srcText(n).slice(0, 40), prox: p.txt.slice(0, 40) });
    if (n.k === 'svg' && p.icon !== n.icon) res.content.push({ id: n.id, what: 'icon', src: n.icon, prox: p.icon });
    if (n.k === 'iconfont' && p.txt !== n.name) res.content.push({ id: n.id, what: 'iconfont', src: n.name, prox: p.txt });
  }
  // crop compare of leaves at width A (source box in both images)
  if (pngs) {
    const sp = readPng(pngs.srcA), pp = readPng(pngs.proxA);
    for (const { n } of nodes) {
      if (n.kids && n.kids.length) continue;
      if (!prox.A.nodes[n.id]) continue;
      // shift-tolerant: best match over ±2 device px (sub-pixel placement inside the box tolerance is not a content error)
      const a = crop(sp, n.r);
      if (!a.width || !a.height) continue;
      let d = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const b = crop(pp, [n.r[0] + dx / DSF, n.r[1] + dy / DSF, n.r[2], n.r[3]]);
        if (a.width !== b.width || a.height !== b.height) continue;
        d = Math.min(d, pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 }));
      }
      if (d === Infinity) continue;
      const ratio = d / (a.width * a.height);
      if (ratio > CROP_RATIO && d > CROP_MIN) res.crop.push({ id: n.id, k: n.k, cls: n.cls, pseudo: n.pseudo, diffPx: d, ratio: Math.round(ratio * 1000) / 1000 });
    }
    res.pix = { A: pixDiff(sp, pp).ratio, B: pixDiff(readPng(pngs.srcB), readPng(pngs.proxB)).ratio };
  }
  return res;
}
module.exports = { renderProxy, compareScreen, flatten };
