import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { verifyScreen } from '../core/verify.mjs';
import { cropDiff, pixelDiff } from '../core/imgdiff.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

// ---- hand-built data (no browser) ----
// Source tree: n (frame) > n.0 (frame "card") > n.0.0 (text "Inbox"), n.0.1 (icon #ic); n.1 (frame below the card)
const FONT = { ff: 'Inter', fs: '14px', fw: '400', lh: 20 };
function fixture() {
  const screen = {
    id: 's', W: [300, 420], H: [200, 200], excluded: [],
    tree: {
      id: 'n', kind: 'frame', rA: [0, 0, 300, 200], rB: [0, 0, 420, 200], kids: [
        { id: 'n.0', kind: 'frame', rA: [10, 10, 100, 40], rB: [10, 10, 100, 40], kids: [
          { id: 'n.0.0', kind: 'text', rA: [20, 20, 40, 20], rB: [20, 20, 40, 20], font: FONT, runs: [{ t: 'Inbox' }] },
          { id: 'n.0.1', kind: 'icon', rA: [70, 20, 20, 20], rB: [70, 20, 20, 20], icon: { ref: 'ic' } },
        ] },
        { id: 'n.1', kind: 'frame', rA: [10, 60, 100, 30], rB: [10, 60, 100, 30] },
      ],
    },
  };
  const spec = {
    id: 'n', t: 'F', kids: [
      { id: 'n.0', t: 'F', kids: [
        { id: 'n.0.0', t: 'T', font: FONT, runs: [{ t: 'Inbox' }] },
        { id: 'n.0.1', t: 'V', icon: { ref: 'ic' } },
      ] },
      { id: 'n.1', t: 'F' },
    ],
  };
  const boxes = (M) => {
    const out = {};
    const v = (n) => { out[n.id] = [...(M === 'A' ? n.rA : n.rB)]; (n.kids || []).forEach(v); };
    v(screen.tree); return out;
  };
  const proxy = { A: { boxes: boxes('A'), fontsMissing: [] }, B: { boxes: boxes('B'), fontsMissing: [] } };
  return { screen, spec, proxy, flags: [], crops: [] };
}
const shift = (input, id, d, widths = ['A', 'B']) => {
  for (const M of widths) { const b = input.proxy[M].boxes[id]; for (let i = 0; i < 4; i++) b[i] += d[i] || 0; }
};
const rootIds = (r) => [...new Set(r.roots.map((x) => x.id))];

test('verifyScreen: an exact proxy passes with full coverage', () => {
  const r = verifyScreen(fixture());
  assert.equal(r.total, 5);
  assert.equal(r.checked, 5);
  assert.deepEqual(r.unchecked, []);
  assert.deepEqual(r.roots, []);
  assert.deepEqual(r.data, []);
  assert.deepEqual(r.strict, [1, 1]);
  assert.equal(r.pass, true);
});

test('verifyScreen: a child moved 3px with its parent is not a root; only the parent is', () => {
  const inp = fixture();
  for (const id of ['n.0', 'n.0.0', 'n.0.1']) shift(inp, id, [3, 0, 0, 0]);
  const r = verifyScreen(inp);
  assert.deepEqual(rootIds(r), ['n.0']);
  assert.equal(r.roots.length, 2, 'one root per width');
  assert.deepEqual(r.roots.map((x) => x.width).sort(), ['A', 'B']);
  assert.deepEqual(r.roots[0].delta, [3, 0, 0, 0]);
  assert.equal(r.pass, false);
  const n00 = r.nodes.find((x) => x.id === 'n.0.0');
  assert.equal(n00.ok, false, 'the child itself is still outside tolerance');
});

test('verifyScreen: a sibling pushed down by the previous sibling growing is not a root', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 0, 3]); // card grows 3px for no reason
  shift(inp, 'n.1', [0, 3, 0, 0]); // the next sibling follows
  const r = verifyScreen(inp);
  assert.deepEqual(rootIds(r), ['n.0']);
});

test('verifyScreen: sub-pixel text rounding that grows a frame and pushes later siblings is not a root', () => {
  const inp = fixture();
  shift(inp, 'n.0.0', [0, 0, 0, 0.8]); // text box rounded up 0.8px (within text tolerance)
  shift(inp, 'n.0', [0, 0, 0, 0.8]); // the hugging card grows with it (beyond the frame tolerance)
  shift(inp, 'n.1', [0, 0.8, 0, 0]); // the next frame is pushed
  const r = verifyScreen(inp);
  assert.deepEqual(r.roots, []);
  assert.equal(r.pass, true);
  assert.deepEqual(r.strict, [0.6, 0.6], 'strict per-node share still shows the drift');
});

test('verifyScreen: a frame growing 3px with children that did not grow is a root', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 3, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0']);
});

test('verifyScreen: a frame hugging a text root is not a second root', () => {
  const inp = fixture();
  shift(inp, 'n.0.0', [0, 0, 1.4, 0]);
  shift(inp, 'n.0', [0, 0, 1.4, 0]);
  shift(inp, 'n.0.1', [1.4, 0, 0, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0.0']);
});

test('verifyScreen: an end-anchored frame growing leftwards with its content is not a root', () => {
  const inp = fixture();
  shift(inp, 'n.0', [-0.8, 0, 0.8, 0]);
  shift(inp, 'n.0.0', [-0.8, 0, 0.8, 0]); // text 0.8 wider (within tolerance), pushed left with the frame's start
  assert.deepEqual(verifyScreen(inp).roots, []);
});

test('verifyScreen: a parent that grows and drags an end-aligned child is still a root (no circular excuse)', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 3, 0]);
  shift(inp, 'n.0.1', [3, 0, 0, 0]); // end-aligned (space-between) icon follows the parent's far edge
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0']);

  const fill = fixture();
  shift(fill, 'n.0', [0, 0, 3, 0]);
  shift(fill, 'n.0.1', [0, 0, 3, 0]); // a FILL child stretched by the parent
  assert.ok(verifyScreen(fill).roots.length > 0);
});

test('verifyScreen: a node with no source box at B or no proxy box is unchecked and fails', () => {
  const inp = fixture();
  inp.screen.tree.kids[1].rB = null;
  const r = verifyScreen(inp);
  assert.deepEqual(r.unchecked, ['n.1']);
  assert.equal(r.checked, 4);
  assert.equal(r.total, 5);
  assert.match(r.uncheckedReasons['n.1'], /source.*B/);
  assert.equal(r.pass, false);

  const inp2 = fixture();
  delete inp2.proxy.A.boxes['n.0.1'];
  const r2 = verifyScreen(inp2);
  assert.deepEqual(r2.unchecked, ['n.0.1']);
  assert.match(r2.uncheckedReasons['n.0.1'], /proxy.*A/);
  assert.equal(r2.pass, false);
});

test('verifyScreen: syn frames and excluded nodes are not counted', () => {
  const inp = fixture();
  inp.spec.kids[0] = { id: 'n.g0', t: 'F', syn: 'align', kids: [inp.spec.kids[0]] };
  inp.proxy.A.boxes['n.g0'] = [0, 0, 1, 1]; inp.proxy.B.boxes['n.g0'] = [0, 0, 1, 1];
  inp.screen.excluded = [{ path: 'n.5', reason: 'display:none' }];
  const r = verifyScreen(inp);
  assert.equal(r.total, 5);
  assert.equal(r.checked, 5);
  assert.ok(!r.nodes.some((x) => x.id === 'n.g0'));
  assert.equal(r.pass, true);
});

test('verifyScreen: a root on a node flagged shrink is explained and the screen can still pass', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, -3, 0]);
  inp.flags = [{ id: 'n.0', kind: 'shrink', detail: 'x' }];
  const r = verifyScreen(inp);
  assert.deepEqual(rootIds(r), ['n.0']);
  assert.ok(r.roots.every((x) => x.explainedBy === 'shrink'));
  assert.equal(r.pass, true);
});

test('verifyScreen: an ancestor flag explains a descendant root; a text flag does not explain its ancestors', () => {
  const inp = fixture();
  shift(inp, 'n.0.1', [0, 0, 3, 0]);
  inp.flags = [{ id: 'n.0', kind: 'weightedFill', detail: 'x' }];
  let r = verifyScreen(inp);
  assert.ok(r.roots.length && r.roots.every((x) => x.id === 'n.0.1' && x.explainedBy === 'weightedFill'));

  const inp2 = fixture();
  shift(inp2, 'n.0', [0, 0, 3, 0]);
  inp2.flags = [{ id: 'n.0.0', kind: 'mixedRunHeight', detail: 'font sizes 14/20px in one line' }];
  r = verifyScreen(inp2);
  assert.deepEqual(rootIds(r), ['n.0']);
  assert.ok(r.roots.every((x) => x.explainedBy === undefined));
  assert.equal(r.pass, false);

  const inp3 = fixture();
  shift(inp3, 'n.0.0', [0, 0, 4, 0]);
  inp3.flags = [{ id: 'n.0.0', kind: 'mixedRunHeight', detail: 'font sizes 14/20px in one line' }];
  r = verifyScreen(inp3);
  assert.ok(r.roots.length && r.roots.every((x) => x.id === 'n.0.0' && x.explainedBy === 'mixedRunHeight'));
});

test('verifyScreen (R10): fontSubstitution explains nothing; it is kept in the report as info', () => {
  const inp = fixture();
  shift(inp, 'n.0.0', [0, 0, 4, 0]);
  inp.flags = [{ id: 'n.0.0', kind: 'fontSubstitution', detail: 'Segoe UI → Inter' }];
  inp.crops = [{ id: 'n.0.0', ratio: 0.3 }];
  const r = verifyScreen(inp);
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === undefined));
  assert.deepEqual(r.crop, [{ id: 'n.0.0', ratio: 0.3 }]);
  assert.deepEqual(r.cropExplained, []);
  assert.deepEqual(r.flags, inp.flags);
  assert.equal(r.pass, false);
});

test('verifyScreen (R10): a font override that failed in capture is a font data mismatch', () => {
  const inp = fixture();
  inp.screen.fontSubs = [{ from: 'Segoe UI', to: 'Inter', reason: 'override-failed', cause: 'system' },
    { from: 'system-ui', to: 'Inter', reason: 'system' }];
  const r = verifyScreen(inp);
  assert.deepEqual(r.data, [{ id: 'n', kind: 'font', expected: 'Inter', actual: 'Segoe UI (override-failed)' }]);
  assert.equal(r.pass, false);
});

test('verifyScreen: unsafeWiden explains roots at width B only', () => {
  const inp = fixture();
  shift(inp, 'n.1', [5, 0, 0, 0]);
  inp.flags = [{ id: 'n', kind: 'unsafeWiden', detail: 'x' }];
  const r = verifyScreen(inp);
  assert.equal(r.roots.find((x) => x.width === 'A').explainedBy, undefined);
  assert.equal(r.roots.find((x) => x.width === 'B').explainedBy, 'unsafeWiden');
});

test('verifyScreen: frame tolerance 0.5 (0.4 ok, 0.6 root), configurable with tolFrame', () => {
  let inp = fixture(); shift(inp, 'n.1', [0.4, 0, 0, 0]);
  assert.deepEqual(verifyScreen(inp).roots, []);
  inp = fixture(); shift(inp, 'n.1', [0.6, 0, 0, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.1']);
  assert.deepEqual(verifyScreen(inp, { tolFrame: 1 }).roots, []);
});

test('verifyScreen: text tolerance 1 (0.9 ok, 1.2 root), configurable with tolText', () => {
  let inp = fixture(); shift(inp, 'n.0.0', [0, 0, 0.9, 0]);
  assert.deepEqual(verifyScreen(inp).roots, []);
  inp = fixture(); shift(inp, 'n.0.0', [0, 0, 1.2, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0.0']);
  assert.deepEqual(verifyScreen(inp, { tolText: 1.5 }).roots, []);
});

test('verifyScreen: different text content ("Inbox" vs "Inbx") is a text data mismatch; whitespace is not', () => {
  const inp = fixture();
  inp.spec.kids[0].kids[0].runs = [{ t: 'Inbx' }];
  const r = verifyScreen(inp);
  assert.deepEqual(r.data, [{ id: 'n.0.0', kind: 'text', expected: 'Inbox', actual: 'Inbx' }]);
  assert.equal(r.pass, false);

  const inp2 = fixture();
  inp2.spec.kids[0].kids[0].runs = [{ t: '  In' }, { t: 'box\n' }];
  assert.deepEqual(verifyScreen(inp2).data, []);
});

test('verifyScreen: icon ref and missing font are data mismatches', () => {
  const inp = fixture();
  inp.spec.kids[0].kids[1].icon = { ref: 'other' };
  inp.proxy.B.fontsMissing = ['Inter'];
  const r = verifyScreen(inp);
  assert.ok(r.data.some((d) => d.id === 'n.0.1' && d.kind === 'icon' && d.expected === 'ic' && d.actual === 'other'));
  assert.ok(r.data.some((d) => d.id === 'n.0.0' && d.kind === 'font' && d.expected === 'Inter'));
  assert.equal(r.pass, false);
});

test('verifyScreen: crop failures fail the screen; crop not run is never a silent pass', () => {
  const inp = fixture();
  inp.crops = [{ id: 'n.0.1', ratio: 0.3 }];
  let r = verifyScreen(inp);
  assert.deepEqual(r.crop, [{ id: 'n.0.1', ratio: 0.3 }]);
  assert.equal(r.pass, false);

  const inp2 = fixture(); delete inp2.crops;
  r = verifyScreen(inp2);
  assert.equal(r.pass, false);
  assert.ok(r.skipped.includes('crop'));
});

test('verifyScreen: a crop failure inside a raster node is listed as explained, not as a failure', () => {
  const inp = fixture();
  inp.flags = [{ id: 'n.0', kind: 'raster', detail: 'filter: blur(2px)' }];
  inp.crops = [{ id: 'n.0.1', ratio: 0.3 }, { id: 'n.0', ratio: 0.1 }];
  const r = verifyScreen(inp);
  assert.deepEqual(r.crop, []);
  assert.deepEqual(r.cropExplained.map((c) => [c.id, c.explainedBy]), [['n.0.1', 'raster'], ['n.0', 'raster']]);
  assert.equal(r.pass, true);
});

test('verifyScreen: pixel is reference only', () => {
  const inp = fixture(); inp.pixel = [0.4, 0.5];
  const r = verifyScreen(inp);
  assert.deepEqual(r.pixel, [0.4, 0.5]);
  assert.equal(r.pass, true);
});

// ---- browser ----

let browser;
before(async () => { if (!skip) { const { launchBrowser } = await import('../core/browser.mjs'); browser = await launchBrowser(); } });
after(async () => { if (browser) await browser.close(); });

// 60x40 CSS px at DSF 2 with a 16px glyph drawn at (x, 12)
// rendered from a temp file with goto, as the proxy does; a tiny viewport (60x40) stalled screenshots under suite load
async function shot(html) {
  const dir = mkdtempSync(join(tmpdir(), 'vd-verify-'));
  const file = join(dir, 'shot.html');
  writeFileSync(file, `<!doctype html><body style="margin:0;background:#fff"><div id="r" style="position:relative;width:60px;height:40px">${html}</div></body>`);
  const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 });
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    return await page.locator('#r').screenshot();
  } finally { await page.close(); rmSync(dir, { recursive: true, force: true }); }
}
const tick = (x, color = '#222') => `<svg style="position:absolute;left:${x}px;top:12px" width="16" height="16" viewBox="0 0 16 16"><path d="M2 8l4 4 8-8" stroke="${color}" stroke-width="2" fill="none"/></svg>`;
const cross = (x) => `<svg style="position:absolute;left:${x}px;top:12px" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="#222" stroke-width="2" fill="none"/></svg>`;

test('cropDiff: the same icon 1px off is a match; a different icon is not', { skip }, async () => {
  const a = await shot(tick(20)), b = await shot(tick(21)), c = await shot(cross(20));
  const same = await cropDiff(browser, a, [20, 12, 16, 16], b, [20, 12, 16, 16]);
  assert.ok(same < 0.05, `shifted: ${same}`);
  const diff = await cropDiff(browser, a, [20, 12, 16, 16], c, [20, 12, 16, 16]);
  assert.ok(diff > 0.05, `changed icon: ${diff}`);
  const gone = await cropDiff(browser, a, [20, 12, 16, 16], await shot(''), [20, 12, 16, 16]);
  assert.ok(gone > 0.05, `missing tick: ${gone}`);
});

test('pixelDiff: identical images are 0, different ones are not', { skip }, async () => {
  const a = await shot(tick(20));
  assert.equal(await pixelDiff(browser, a, await shot(tick(20))), 0);
  assert.ok((await pixelDiff(browser, a, await shot(cross(20)))) > 0);
});

test('captureScreens({ png: true }) returns clipped root PNGs at A and B', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { screens } = await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr', png: true });
  const s = screens[0];
  assert.equal(s.png.length, 2);
  for (const [i, buf] of s.png.entries()) {
    assert.ok(Buffer.isBuffer(buf));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.ok(Math.abs(w - s.W[i] * 2) <= 2, `png ${i} width ${w} vs ${s.W[i]}`);
    assert.ok(Math.abs(h - s.H[i] * 2) <= 2, `png ${i} height ${h} vs ${s.H[i]}`);
  }
  const { screens: noPng } = await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr' });
  assert.equal(noPng[0].png, undefined);
});

test('R10 pipeline: a system-ui fixture captured with font override verifies with no fontSubstitution excuse', { skip: skip || (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)') }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { applyFigmaModel } = await import('../core/figma-model.mjs');
  const { buildProxyHtml, renderProxy } = await import('../core/proxy.mjs');
  const { verifyScreenWithImages } = await import('../core/verify.mjs');
  // offline stand-in for the Figma family: Georgia (installed on Windows)
  const available = ['Inter', 'Georgia'];
  const fm = { available, substitute: (f) => (available.includes(String(f).trim().replace(/^["']|["']$/g, '')) ? f : 'Georgia') };
  const s = (await captureScreens(join(FIX, 'capture-system-font.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  assert.deepEqual(s.fontSubs.map((f) => f.reason), ['system']);
  const inf = inferScreen(s);
  const mod = applyFigmaModel(inf.spec, fm, { rendered: s.fontsRendered });
  const flags = [...inf.flags, ...mod.flags];
  assert.ok(!flags.some((f) => f.kind === 'fontSubstitution'), JSON.stringify(flags));
  const html = buildProxyHtml(mod.spec, s.svgDefs, fm, { webFonts: false });
  const proxy = { A: await renderProxy(browser, html, s.W[0]), B: await renderProxy(browser, html, s.W[1]) };
  const r = await verifyScreenWithImages(browser, { screen: s, spec: mod.spec, proxy, flags, fontMap: fm });
  assert.deepEqual(r.unchecked, []);
  assert.deepEqual(r.data, []);
  assert.ok(!r.roots.some((x) => x.explainedBy === 'fontSubstitution'));
  assert.deepEqual(r.roots.filter((x) => !x.explainedBy), [], JSON.stringify(r.roots));
  assert.deepEqual(r.crop, [], JSON.stringify(r.crop));
});
