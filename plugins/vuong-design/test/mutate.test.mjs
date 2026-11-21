import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)')
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';
const KINDS = ['moveShape', 'moveText', 'swapIcon', 'deleteLeaf', 'hideLeaf', 'thinStrokeSmall', 'thinStroke4000', 'drift', 'gap'];

// offline stand-in for the Figma families (as in the verify pipeline test): Georgia is installed on Windows
const available = ['Inter', 'Georgia'];
const fm = { available, substitute: (f) => (available.includes(String(f).trim().replace(/^["']|["']$/g, '')) ? f : 'Georgia') };

let browser;
before(async () => { if (!skip) { const { launchBrowser } = await import('../core/browser.mjs'); browser = await launchBrowser(); } });
after(async () => { if (browser) await browser.close(); });

async function prepared(file, root = '.scr') {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const s = (await captureScreens(join(FIX, file), { root, fontMap: fm, webFonts: false, png: true })).screens[0];
  return { screen: s, inferred: inferScreen(s) };
}
const run = async (file, opts = {}) => {
  const { runMutations } = await import('../core/mutate.mjs');
  const { screen, inferred } = await prepared(file);
  return runMutations(browser, screen, inferred, fm, { proxy: { webFonts: false }, ...opts });
};

const KNOWN_HOLES = new Set();
let basic;
const basicRun = async () => (basic ??= await run('capture-basic.html'));

test('runMutations on capture-basic: every kind is reported, each caught or skipped, targets chosen by node type', { skip }, async () => {
  const r = await basicRun();
  assert.equal(r.id, 's0');
  assert.equal(r.baseline.pass, true, JSON.stringify(r.baseline));
  assert.deepEqual(r.results.map((x) => x.kind), KINDS);
  for (const x of r.results) {
    if (x.skipped) { assert.equal(x.skipped, 'no candidate', JSON.stringify(x)); assert.equal(x.caught, null); continue; }
    assert.ok(typeof x.target === 'string' && Array.isArray(x.by), JSON.stringify(x));
    if (KNOWN_HOLES.has(x.kind)) continue;
    assert.equal(x.caught, true, JSON.stringify(x));
    assert.ok(x.by.length > 0 && x.by.every((b) => ['root', 'crop', 'data', 'approval', 'coverage'].includes(b)), JSON.stringify(x));
  }
  const t = Object.fromEntries(r.results.map((x) => [x.kind, x.target]));
  assert.equal(t.deleteLeaf, 'n.7.a', 'a pseudo leaf is preferred');
  assert.equal(t.moveShape, 'n.1.0');
  assert.equal(t.moveText, 'n.3');
  assert.equal(t.thinStrokeSmall, 'n.7');
  assert.equal(t.thinStroke4000, 'n.1.1', 'the largest frame within the 4000px² crop limit');
  assert.equal(t.drift, 'n', 'the first flow container with >= 4 non-FILL items');
  assert.equal(r.results.find((x) => x.kind === 'swapIcon').skipped, 'no candidate', 'one icon only: nothing to swap with');
});

test('R31: runMutations on capture-basic: hideLeaf (opacity 0 on a pale filled box) is caught by the visibility check', { skip }, async () => {
  const r = await basicRun();
  const h = r.results.find((x) => x.kind === 'hideLeaf');
  assert.equal(h.caught, true, JSON.stringify(h));
  assert.ok(h.by.includes('data'), JSON.stringify(h));
  assert.equal(r.allCaught, true);
});

// Task 7 holes on purpose-built targets (mutate-holes.html): n.1 HUG column of three texts (gap 4), n.3 card of five
// HUG rows, n.5 4px bar, n.7 42x18 frame around a text, n.9 244x15 row around a text, n.11 pale 80x40 box
test('R29-R31: the Task 7 holes are caught (HUG column gap, HUG-row card drift, edge strokes, hidden pale box)', { skip }, async () => {
  const targets = { gap: 'n.1', drift: 'n.3', thinStrokeSmall: 'n.5', thinStroke4000: 'n.9', hideLeaf: 'n.11' };
  const r = await run('mutate-holes.html', { kinds: Object.keys(targets), targets });
  assert.equal(r.baseline.pass, true, JSON.stringify(r.baseline));
  assert.deepEqual(r.results.map((x) => x.target), Object.values(targets));
  for (const x of r.results) assert.equal(x.caught, true, JSON.stringify(x));
  const by = Object.fromEntries(r.results.map((x) => [x.kind, x.by]));
  assert.ok(by.gap.includes('root') && by.drift.includes('root'), JSON.stringify(by));
  assert.ok(by.thinStrokeSmall.includes('data') && by.thinStroke4000.includes('data'), JSON.stringify(by));
  assert.ok(by.thinStrokeSmall.includes('crop') && by.thinStroke4000.includes('crop'), JSON.stringify(by));
  const t = await run('mutate-holes.html', { kinds: ['thinStrokeSmall'], targets: { thinStrokeSmall: 'n.7' } });
  assert.equal(t.results[0].caught, true, JSON.stringify(t.results[0]));
  assert.ok(t.results[0].by.includes('crop') && t.results[0].by.includes('data'), JSON.stringify(t.results[0]));
});

// H4 (R32): mutate-mini.html n.1.1 = an end-anchored (margin-left:auto) HUG row of nine FIXED dots (planora `.mini`)
test('R32: drift in an end-anchored HUG row of FIXED dots is caught by a layout root, not only by crop', { skip }, async () => {
  const r = await run('mutate-mini.html', { kinds: ['drift'], targets: { drift: 'n.1.1' } });
  assert.equal(r.baseline.pass, true, JSON.stringify(r.baseline));
  const [d] = r.results;
  assert.equal(d.caught, true, JSON.stringify(d));
  assert.ok(d.by.includes('root'), JSON.stringify(d));
});

test('runMutations: a screen without icons skips swapIcon and does not throw', { skip }, async () => {
  const r = await run('mutate-noicon.html', { kinds: ['swapIcon', 'moveShape'] });
  assert.deepEqual(r.results.map((x) => x.kind), ['swapIcon', 'moveShape']);
  assert.deepEqual(r.results[0], { kind: 'swapIcon', target: null, caught: null, by: [], skipped: 'no candidate' });
  assert.equal(r.results[1].caught, true, JSON.stringify(r.results[1]));
});

test('runMutations on a row of four icons: swapIcon is caught by the data check, drift (0.4px per item) is caught', { skip }, async () => {
  const r = await run('mutate-flow.html', { kinds: ['swapIcon', 'drift'] });
  const [sw, dr] = r.results;
  assert.equal(r.baseline.pass, true, JSON.stringify(r.baseline));
  assert.equal(sw.target, 'n.0');
  assert.equal(sw.caught, true, JSON.stringify(sw));
  assert.ok(sw.by.includes('data'), JSON.stringify(sw));
  assert.equal(dr.target, 'n');
  assert.equal(dr.caught, true, JSON.stringify(dr));
  assert.ok(dr.by.includes('root'), JSON.stringify(dr));
});

test('runMutations: a deliberately loose verifier (huge tolerances) is detected (allCaught false)', { skip }, async () => {
  const loose = { tolFrame: 1e6, tolText: 1e6, tolModel: 1e6, cropRatio: 1e6, cropPeak: 1e9 };
  const r = await run('capture-basic.html', { kinds: ['moveShape', 'moveText', 'gap'], verify: loose });
  assert.equal(r.allCaught, false);
  assert.ok(r.results.some((x) => x.caught === false), JSON.stringify(r.results));
});
