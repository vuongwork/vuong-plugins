import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { screenCache, slotOf, keyable, screenKey } from '../core/cache.mjs';
import { pool, jobsOf, runFile } from '../core/pipeline.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM ? false : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

test('R95 pool: at most `jobs` tasks at once, every index once, done per task, worker resource passed', async () => {
  let running = 0, peak = 0;
  const seen = [], res = [];
  await pool(7, 3, async (i, r) => {
    running++; peak = Math.max(peak, running);
    await new Promise((ok) => setTimeout(ok, (7 - i) * 3));
    running--; res.push(r);
    return i * 10;
  }, (i, v) => seen.push([i, v]), ['a', 'b', 'c']);
  assert.equal(peak, 3);
  assert.deepEqual(seen.map(([i]) => i).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(seen.every(([i, v]) => v === i * 10));
  assert.deepEqual([...new Set(res)].sort(), ['a', 'b', 'c']);
  await assert.rejects(pool(3, 2, async (i) => { if (i === 1) throw new Error('boom'); return i; }), /boom/);
});

test('R95 jobsOf: opts.jobs, then VD_JOBS, then a default of 2..6', () => {
  const was = process.env.VD_JOBS;
  try {
    assert.equal(jobsOf({ jobs: 3 }), 3);
    process.env.VD_JOBS = '5';
    assert.equal(jobsOf({}), 5);
    delete process.env.VD_JOBS;
    const d = jobsOf({});
    assert.ok(d >= 2 && d <= 6, String(d));
  } finally { if (was === undefined) delete process.env.VD_JOBS; else process.env.VD_JOBS = was; }
});

test('R95 keys: PNGs are left out, other buffers hashed, a number keys the same however it was computed', () => {
  assert.deepEqual(keyable({ a: [PNG, 1] }), { a: ['png', 1] });
  assert.match(keyable(Buffer.from('xyz')), /^bytes:[0-9a-f]{64}$/);
  const dir = mkdtempSync(join(tmpdir(), 'vd-cache-'));
  try {
    const c = screenCache(dir);
    // 4 / 2 is held as a double, 2 as a small integer: the same key (v8.serialize would differ)
    assert.equal(c.key([{ w: 2 }]), c.key([{ w: 4 / 2 }]));
    assert.notEqual(c.key([{ w: 2 }]), c.key([{ w: 3 }]));
    assert.equal(c.key([{ shot: PNG }]), c.key([{ shot: Buffer.from([...PNG.subarray(0, 8), 9, 9]) }]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R95 screenKey: a local image file is keyed by its content; a canvas makes the screen uncacheable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-cache-'));
  try {
    const img = join(dir, 'pic.bin');
    writeFileSync(img, 'one');
    const url = pathToFileURL(img).href;
    const sc = { tree: { id: 'n', kids: [{ id: 'n.0', tag: 'img', src: url }, { id: 'n.1', paint: { bgImage: `url("${url}")` } }] } };
    const a = screenKey(sc);
    assert.equal(a.length, 1);
    writeFileSync(img, 'two');
    assert.notDeepEqual(screenKey(sc), a);
    assert.deepEqual(screenKey({ tree: { id: 'n', kids: [{ id: 'n.0', tag: 'img', src: 'https://example.invalid/x.png' }] } }), [['https://example.invalid/x.png', null]]);
    assert.equal(screenKey({ tree: { id: 'n', kids: [{ id: 'n.0', tag: 'canvas' }] } }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R95 screenCache: get after put (Buffers kept), one key per slot, unreadable file is a miss, prune keeps listed slots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-cache-'));
  try {
    const c = screenCache(dir);
    const s0 = slotOf('a.html', 's0'), s1 = slotOf('a.html', 's1'), other = slotOf('b.html', 's0');
    const k1 = c.key(['one']), k2 = c.key(['two']);
    c.put(s0, k1, { png: Buffer.from([1, 2]), n: 1 });
    const got = c.get(s0, k1);
    assert.ok(Buffer.isBuffer(got.png));
    assert.deepEqual([...got.png], [1, 2]);
    assert.equal(c.get(s0, k2), null);
    c.put(s0, k2, { n: 2 });
    assert.equal(c.get(s0, k1), null, 'the slot keeps only its latest key');
    c.put(s1, k1, { n: 3 });
    c.put(other, k1, { n: 4 });
    writeFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith(`${s1}--`))), 'not v8');
    assert.equal(c.get(s1, k1), null);
    c.prune([s0]);
    const left = readdirSync(dir);
    assert.ok(left.some((f) => f.startsWith(`${s0}--`)));
    assert.ok(!left.some((f) => f.startsWith(`${s1}--`)), 'a slot of the same file not in this run is removed');
    assert.ok(left.some((f) => f.startsWith(`${other}--`)), 'another file\'s slots are kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R95 runFile with cacheDir: a second run reuses every screen and gives the same reports', { skip }, async () => {
  const { launchBrowser } = await import('../core/browser.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'vd-cache-'));
  const browser = await launchBrowser();
  try {
    const run = () => runFile(browser, join(FIX, 'capture-basic.html'), { root: '.scr', cacheDir: dir, jobs: 2 });
    const a = await run();
    assert.equal(a.cached, 0);
    const b = await run();
    assert.equal(b.cached, b.screens.length);
    assert.deepEqual(b.screens.map((e) => e.report), a.screens.map((e) => e.report));
    assert.ok(Buffer.isBuffer(b.screens[0].proxy.A.png));
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
