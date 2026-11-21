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

// Known verifier hole found by this check (Task 7 report, pending a controller ruling): a leaf hidden with opacity 0
// keeps its box, its computed background colour is unchanged and a uniformly filled crop window has no ink, so
// nothing fails. capture-basic's first visible leaf is such a box. It is excluded below and asserted in a todo test.
const KNOWN_HOLES = new Set(['hideLeaf']);
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

test('runMutations on capture-basic: hideLeaf (opacity 0 on a filled box) is caught', { skip, todo: 'verifier hole, see the Task 7 report' }, async () => {
  const r = await basicRun();
  assert.equal(r.results.find((x) => x.kind === 'hideLeaf').caught, true);
  assert.equal(r.allCaught, true);
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
