import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProxyHtml, renderProxy } from '../core/proxy.mjs';
import { defaultFontMap } from '../core/font-map.mjs';
import { applyFigmaModel } from '../core/figma-model.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const CASES = JSON.parse(readFileSync(join(FIX, 'proxy-semantics.json'), 'utf8'));
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';
const fm = defaultFontMap();
const OFFLINE = { webFonts: false };
const html = (c) => buildProxyHtml(c.spec, c.svgDefs || {}, fm, OFFLINE);
const near = (a, b, tol = 0.01) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const assertBox = (got, want, label) => assert.ok(got && near(got, want), `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- pure HTML (no browser) ----

test('buildProxyHtml: every node (syn frames too) gets a data-id; border-box and no margins', () => {
  const h = html(CASES.fill3);
  for (const id of ['n', 'n.0', 'n.g0', 'n.1', 'n.2']) assert.ok(h.includes(`data-id="${id}"`), id);
  assert.ok(h.includes('box-sizing:border-box'));
  assert.ok(!/margin:(?!0)/.test(h), 'no non-zero margin');
  assert.ok(!/fonts\.googleapis/.test(h), 'webFonts:false stays offline');
});

test('buildProxyHtml: FILL primary = flex:1 1 0 + min 0, FILL counter = stretch, HUG/FIXED = flex:none', () => {
  const h = html(CASES.minMax);
  assert.match(h, /data-id="n\.0"[^>]*flex:1 1 0px/);
  assert.match(h, /data-id="n\.0"[^>]*min-width:150px/);
  assert.match(h, /data-id="n\.2"[^>]*max-width:40px/);
  assert.match(h, /data-id="n\.1"[^>]*align-self:stretch/);
  assert.match(html(CASES.spaceBetween), /data-id="n\.0"[^>]*flex:none/);
});

test('buildProxyHtml: spaceBetween drops the gap; solid borders are inset box-shadows', () => {
  const sb = html(CASES.spaceBetween);
  assert.match(sb, /data-id="n"[^>]*justify-content:space-between/);
  assert.ok(!/data-id="n"[^>]*gap:20px/.test(sb), 'gap ignored with spaceBetween');
  const bd = html(CASES.border);
  assert.match(bd, /data-id="n"[^>]*box-shadow:[^"]*inset/);
  assert.ok(!/style="[^"]*(^|[;"])border(-width|-style)?:/.test(bd), 'no CSS border on any node box');
  assert.match(bd, /\.s0::before\{[^}]*position:absolute[^}]*border-style:dashed/); // non-solid: overlay, out of layout
});

test('buildProxyHtml: fonts go through fontMap.substitute; icons reference the symbol table', () => {
  const spec = structuredClone(CASES.baseline.spec);
  spec.kids[0].font.ff = '"Segoe UI", system-ui, sans-serif';
  spec.kids[1].font.ff = '"Be Vietnam Pro", sans-serif';
  const h = buildProxyHtml(spec, {}, fm, OFFLINE);
  assert.match(h, /data-id="n\.0"[^>]*font-family:&quot;Inter&quot;/);
  assert.match(h, /data-id="n\.1"[^>]*font-family:&quot;Be Vietnam Pro&quot;/);
  const ic = html(CASES.icon);
  assert.ok(ic.includes('<symbol id="sym"'));
  assert.match(ic, /<use href="#sym"/);
});

test('buildProxyHtml: source font links are kept; a missing Google family is linked when webFonts is on', () => {
  const link = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;700&display=swap';
  const spec = structuredClone(CASES.baseline.spec);
  spec.kids[1].font.ff = 'Be Vietnam Pro';
  const h = buildProxyHtml(spec, {}, fm, { fontLinks: [link] });
  assert.ok(h.includes(`href="${link.replace(/&/g, '&amp;')}"`));
  assert.match(h, /family=Inter:ital,wght@0,700&amp;display=swap/); // Inter is not in the source links
  assert.ok(!/family=Be\+Vietnam\+Pro:ital/.test(h), 'already linked by the source');
});

// ---- rendered (Chromium) ----

let browser;
before(async () => { if (!skip) { const { launchBrowser } = await import('../core/browser.mjs'); browser = await launchBrowser(); } });
after(async () => { if (browser) await browser.close(); });
const render = (c, W) => renderProxy(browser, html(c), W);

test('three FILL children in 300 with padding 10 share (300 - 20 - 2*gap)/3 each', { skip }, async () => {
  const { boxes } = await render(CASES.fill3, 300);
  for (const [id, b] of Object.entries(CASES.fill3.expect)) assertBox(boxes[id], b, id);
  assertBox(boxes.n, [0, 0, 300, 40], 'root');
});

test('spaceBetween with gap 20 but only 7px free: the real spacing is 7', { skip }, async () => {
  const { boxes } = await render(CASES.spaceBetween, 296);
  for (const [id, b] of Object.entries(CASES.spaceBetween.expect)) assertBox(boxes[id], b, id);
});

test('FILL with minWidth/maxWidth: 150/98/40 at 300, 184/184/40 at 420', { skip }, async () => {
  for (const [M, W] of [['A', 300], ['B', 420]]) {
    const { boxes } = await render(CASES.minMax, W);
    assert.deepEqual(['n.0', 'n.1', 'n.2'].map((id) => boxes[id][2]), CASES.minMax.expect[M], M);
  }
});

test('absolute children follow constraints; LR grows by exactly +120', { skip }, async () => {
  const c = CASES.absolute;
  const A = (await render(c, 320)).boxes, B = (await render(c, 440)).boxes;
  for (const [id, b] of Object.entries(c.expect.A)) assertBox(A[id], b, `A ${id}`);
  for (const [id, b] of Object.entries(c.expect.B)) assertBox(B[id], b, `B ${id}`);
  assert.equal(B['n.1'][2] - A['n.1'][2], 120);
  assertBox(A['n.0'], [0, 0, 10, 10], 'flow child unaffected by absolute siblings');
});

test('a 4px border does not push the child in; a bordered FILL cell keeps its share', { skip }, async () => {
  const { boxes } = await render(CASES.border, 200);
  for (const [id, b] of Object.entries(CASES.border.expect)) assertBox(boxes[id], b, id);
});

test("ca 'B': baselines of two different-size texts coincide (<= 0.5px)", { skip }, async () => {
  const h = html(CASES.baseline);
  const { boxes } = await renderProxy(browser, h, 300);
  assert.ok(boxes['n.1'][1] > boxes['n.0'][1] + 1, `small text is lowered: ${JSON.stringify(boxes)}`);
  // measure the real baselines with a zero-height inline-block probe at the end of each text
  const page = await browser.newPage();
  try {
    await page.setContent(h);
    await page.evaluate(() => document.querySelector('[data-root]').style.setProperty('--W', '300px'));
    const bl = await page.evaluate(() => ['n.0', 'n.1'].map((id) => {
      const el = document.querySelector(`[data-id="${id}"]`);
      const p = document.createElement('span'); p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.appendChild(p); const y = p.getBoundingClientRect().bottom; p.remove(); return y;
    }));
    assert.ok(Math.abs(bl[0] - bl[1]) <= 0.5, `baselines ${bl}`);
  } finally { await page.close(); }
});

test('substituted text hugs in the substitute font, then is pinned by figmaTextBox', { skip }, async () => {
  const { boxes } = await render(CASES.substitutedText, 300);
  const t = boxes['n.0'];
  assert.ok(t[2] < 999 && t[2] > 20 && Number.isInteger(t[2]), `width ${t[2]}`);
  assert.equal(t[3], 20);
  assertBox(boxes['n.1'], [t[2], 0, 300 - t[2], 20], 'FILL sibling takes the rest');
});

test('FILL text with HUG height re-wraps per width; heights are whole pixels', { skip }, async () => {
  const A = (await render(CASES.wrapText, 100)).boxes['n.0'], B = (await render(CASES.wrapText, 400)).boxes['n.0'];
  assert.equal(A[2], 100); assert.equal(B[2], 400);
  assert.ok(A[3] > B[3], `narrow ${A[3]} vs wide ${B[3]}`);
  assert.ok(Number.isInteger(A[3]) && Number.isInteger(B[3]));
  assert.equal(B[3], 16, 'one line at 400');
});

test('R21: an unmodelled spec keeps the natural HUG height of wrapping text; only a modelled one is rounded', { skip }, async () => {
  const spec = structuredClone(CASES.wrapText.spec);
  delete spec.model;
  spec.kids[0].font.lh = 25.3;
  const layout = (await renderProxy(browser, buildProxyHtml(spec, {}, fm, OFFLINE), 400)).boxes['n.0'];
  assert.ok(Math.abs(layout[3] - 25.3) <= 0.02, `layout proxy height ${layout[3]} (Figma round-up leaked)`);
  const { spec: modelled } = applyFigmaModel(spec, fm);
  const proxy = (await renderProxy(browser, buildProxyHtml(modelled, {}, fm, OFFLINE), 400)).boxes['n.0'];
  assert.equal(proxy[3], 26, 'the modelled proxy rounds up like Figma');
});

test('icon renders from the symbol table; png is a PNG of the root', { skip }, async () => {
  const { boxes, png } = await render(CASES.icon, 100);
  assertBox(boxes['n.0'], CASES.icon.expect['n.0'], 'icon');
  assert.ok(Buffer.isBuffer(png));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 200, 'width 100 at device scale 2');
});

test('renderProxy reports families that did not render (fontsMissing)', { skip }, async () => {
  const spec = structuredClone(CASES.baseline.spec);
  spec.kids[0].font.ff = 'NoSuchFontVD';
  const h = buildProxyHtml(spec, {}, defaultFontMap(['NoSuchFontVD']), OFFLINE);
  const { fontsMissing } = await renderProxy(browser, h, 300);
  assert.ok(fontsMissing.includes('NoSuchFontVD'), JSON.stringify(fontsMissing));
});
