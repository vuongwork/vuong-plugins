import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probePayload, readFacts, loadFacts, DEFAULT_FACTS } from '../core/figma-probe.mjs';
import { figmaTextBox } from '../core/figma-model.mjs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// A result in which every case matches the current figma-model assumptions.
const base = () => ({
  errors: [],
  cases: {
    lh: { v1: 17.4, h1: 17.4, v3: 21.75, h3: 65.25 },
    tb: { w0: 80.3, w: 87, chars: 13, ls: 0.5, h: 18.15 },
    scale: { x: 16, w: 144 },
    zero: { ax: 160, lx: 160, rr: 160.01, arr: 160.01 },
    hug: { w0: 100, w: 200, x: 50, cw: 100 },
    overlay: { w1: 100, h1: 30, w4: 100, h4: 30, ow: 100, oh: 30 },
    shrink: { a240: 180, a360: 180, b240: 208, b360: 328, bt240: 208, bt360: 328 },
    base: { b1: 20.5, b2: 20.3 },
  },
});
const withCase = (k, v) => { const r = base(); r.cases[k] = v; return r; };

test('probePayload is <= 20 KB and a valid async function body over figma', () => {
  const src = probePayload();
  assert.equal(typeof src, 'string');
  assert.ok(Buffer.byteLength(src) <= 20000, 'payload size ' + Buffer.byteLength(src));
  assert.doesNotThrow(() => new AsyncFunction('figma', src));
  assert.match(src, /_vd-probe/);
  assert.match(src, /return\s*\{\s*cases/);
});

test('readFacts: baseline sample gives the model assumptions', () => {
  const f = readFacts(base(), '2026-11-23');
  assert.deepEqual(f, { ...DEFAULT_FACTS, measured: '2026-11-23' });
});

test('readFacts: lineHeightFrac keep / round / floor', () => {
  assert.equal(readFacts(base()).lineHeightFrac, 'keep');
  assert.equal(readFacts(withCase('lh', { v1: 17, h1: 17, v3: 22, h3: 66 })).lineHeightFrac, 'round');
  assert.equal(readFacts(withCase('lh', { v1: 17, h1: 17, v3: 21, h3: 63 })).lineHeightFrac, 'floor');
});

test('readFacts: textBox ceil iff width equals figmaTextBox of the unrounded width', () => {
  const raw = 80.3 + 13 * 0.5;
  const w = figmaTextBox(raw, 18.15, 0.5).w;
  assert.equal(readFacts(withCase('tb', { w0: 80.3, w, chars: 13, ls: 0.5, h: 19 })).textBox, 'ceil');
  assert.equal(readFacts(withCase('tb', { w0: 80.3, w: raw, chars: 13, ls: 0.5, h: 19 })).textBox, 'other');
});

test('readFacts: scaleBasis frame vs padding', () => {
  assert.equal(readFacts(withCase('scale', { x: 16, w: 144 })).scaleBasis, 'frame');
  assert.equal(readFacts(withCase('scale', { x: 10, w: 150 })).scaleBasis, 'padding');
});

test('readFacts: zeroWidthAnchor ok vs moves', () => {
  assert.equal(readFacts(base()).zeroWidthAnchor, 'ok');
  assert.equal(readFacts(withCase('zero', { ax: 100, lx: 100, rr: 100.01, arr: 100.01 })).zeroWidthAnchor, 'moves');
  assert.equal(readFacts(withCase('zero', { ax: 160, lx: 160, rr: 130, arr: 160.01 })).zeroWidthAnchor, 'moves');
});

test('readFacts: scaleInHug ok vs breaks', () => {
  assert.equal(readFacts(base()).scaleInHug, 'ok');
  assert.equal(readFacts(withCase('hug', { w0: 100, w: 200, x: 25, cw: 50 })).scaleInHug, 'breaks');
});

test('readFacts: strokeOverlay ok vs off', () => {
  assert.equal(readFacts(base()).strokeOverlay, 'ok');
  assert.equal(readFacts(withCase('overlay', { w1: 100, h1: 30, w4: 106, h4: 36, ow: 106, oh: 36 })).strokeOverlay, 'off');
  assert.equal(readFacts(withCase('overlay', { w1: 100, h1: 30, w4: 100, h4: 30, ow: 90, oh: 30 })).strokeOverlay, 'off');
});

test('readFacts: shrinkFill maxWidth and growText independent', () => {
  assert.deepEqual(readFacts(base()).shrinkFill, { maxWidth: 'ok', growText: 'ok' });
  const r = withCase('shrink', { a240: 208, a360: 328, b240: 208, b360: 328, bt240: 208, bt360: 328 });
  assert.deepEqual(readFacts(r).shrinkFill, { maxWidth: 'no', growText: 'ok' });
  const g = withCase('shrink', { a240: 180, a360: 180, b240: 208, b360: 328, bt240: 208, bt360: 208 });
  assert.deepEqual(readFacts(g).shrinkFill, { maxWidth: 'ok', growText: 'no' });
});

test('readFacts: baseline ok at <= 0.5 px, off above', () => {
  assert.equal(readFacts(withCase('base', { b1: 20, b2: 20.5 })).baseline, 'ok');
  assert.equal(readFacts(withCase('base', { b1: 20, b2: 20.8 })).baseline, 'off');
});

test('readFacts: missing or errored case keeps the default for its fields; deterministic', () => {
  const r = base(); delete r.cases.scale; r.errors.push('hug: boom'); delete r.cases.hug;
  const f = readFacts(r);
  assert.equal(f.scaleBasis, 'frame');
  assert.equal(f.scaleInHug, 'ok');
  assert.deepEqual(readFacts(r), f);
});

test('loadFacts: missing file -> DEFAULT_FACTS; present file overrides', () => {
  const d = mkdtempSync(join(tmpdir(), 'vdfacts-'));
  const f = loadFacts(join(d, 'none.json'));
  assert.deepEqual(f, DEFAULT_FACTS);
  assert.equal(f.lineHeightFrac, 'keep');
  assert.equal(f.scaleBasis, 'frame');
  assert.equal(f.measured, null);
  const p = join(d, 'facts.json');
  writeFileSync(p, JSON.stringify({ version: 1, measured: '2026-11-23', lineHeightFrac: 'round' }));
  const g = loadFacts(p);
  assert.equal(g.lineHeightFrac, 'round');
  assert.equal(g.scaleInHug, 'ok');
  assert.deepEqual(g.shrinkFill, { maxWidth: 'ok', growText: 'ok' });
});
