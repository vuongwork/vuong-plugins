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
    lh: { v1: 17.4, h1: 18, v3: 21.75, h3: 66 },
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

test('readFacts: real Figma result (2026-11-23) gives keep for line height and the default facts', () => {
  const real = {
    cases: {
      lh: { v1: 17.399999618530273, h1: 18, v3: 21.75, h3: 66 },
      tb: { w0: 96, w: 102, chars: 13, ls: 0.5, h: 18 },
      scale: { x: 16, w: 144 },
      zero: { ax: 160, lx: 160, rr: 160.00999450683594, arr: 160.0159999988973 },
      hug: { w0: 100, w: 200, x: 50, cw: 100 },
      overlay: { w1: 300, h1: 30, w4: 300, h4: 30, ow: 300, oh: 30 },
      shrink: { a240: 180, a360: 180, b240: 208, b360: 328, bt240: 208, bt360: 328 },
      base: { b1: 1001.6176288276375, b2: 1002.009793793132 },
    },
    errors: [],
  };
  assert.deepEqual(readFacts(real, '2026-11-23'), { ...DEFAULT_FACTS, measured: '2026-11-23' });
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

// ---- plan 3b Task 1: component API probe ----
const cmpBase = () => ({
  errors: [], cleaned: true,
  cases: {
    data: { inherit: 'main.t', own: 'inst.t', ownErr: '', other: 'main.t', mainAfter: 'main.t', idPattern: true },
    props: { text: true, bool: true, swap: true, variant: true, override: true, keys: ['label#1:0', 'showDot#1:1', 'icon#1:2'] },
    layout: { d300: 0, d360: 0.004, n: 8, h300: 32 },
    bind: { fillInherit: true, padInherit: true, padValue: 12, fillOverride: true },
    time: { inst: 40, plain: 90 },
  },
});

test('cmpProbePayload: <= 20 KB, valid async body, only touches its own cmp-* nodes and removes them', async () => {
  const { cmpProbePayload } = await import('../core/figma-probe.mjs');
  const src = cmpProbePayload();
  assert.ok(Buffer.byteLength(src) <= 20000, 'payload size ' + Buffer.byteLength(src));
  assert.doesNotThrow(() => new AsyncFunction('figma', src));
  assert.match(src, /_vd-probe/);
  assert.match(src, /if \(\/\^cmp-\/\.test\(n\.name\)\) n\.remove\(\)/, 'clears only its own leftovers');
  assert.doesNotMatch(src, /for \(const n of \[\.\.\.page\.children\]\) n\.remove\(\)/, 'never clears the whole page');
  assert.match(src, /finally \{/);
  assert.match(src, /return \{ cases, errors, cleaned/);
});

test('readCmpFacts: a full good result gives own data, every property, ok layout and bindings', async () => {
  const { readCmpFacts } = await import('../core/figma-probe.mjs');
  assert.deepEqual(readCmpFacts(cmpBase(), '2026-11-24'), {
    measured: '2026-11-24', data: 'own', idPattern: true,
    props: { text: true, bool: true, swap: true, variant: true, override: true },
    layout: 'ok', layoutMax: 0.004, bind: 'ok', timeMs: { inst: 40, plain: 90 },
  });
});

test('readCmpFacts: each case falls to the safe side on its own', async () => {
  const { readCmpFacts } = await import('../core/figma-probe.mjs');
  const r = cmpBase();
  r.cases.data = { inherit: 'main.t', own: '', ownErr: 'Cannot set plugin data on instance sublayer', other: 'main.t', mainAfter: 'main.t', idPattern: true };
  assert.equal(readCmpFacts(r).data, 'inherit');
  r.cases.data = { inherit: '', own: 'inst.t', other: 'inst.t', mainAfter: 'inst.t', idPattern: false };
  assert.equal(readCmpFacts(r).data, 'no', 'an instance write that leaks to the main or another instance is not own');
  assert.equal(readCmpFacts(r).idPattern, false);
  const p = cmpBase(); p.cases.props.override = false; p.cases.props.swap = 'yes';
  assert.deepEqual(readCmpFacts(p).props, { text: true, bool: true, swap: false, variant: true, override: false });
  const l = cmpBase(); l.cases.layout = { d300: 0.3, d360: 0.01 };
  assert.equal(readCmpFacts(l).layout, 'near');
  l.cases.layout = { d300: 0, d360: 2 };
  assert.equal(readCmpFacts(l).layout, 'no');
  const b = cmpBase(); b.cases.bind.fillOverride = false;
  assert.equal(readCmpFacts(b).bind, 'no');
});

test('readCmpFacts: missing cases keep the defaults; loadFacts merges a partial cmp over them', async () => {
  const { readCmpFacts } = await import('../core/figma-probe.mjs');
  assert.deepEqual(readCmpFacts({ cases: {}, errors: ['data: boom'] }), { ...DEFAULT_FACTS.cmp, props: { ...DEFAULT_FACTS.cmp.props } });
  const d = mkdtempSync(join(tmpdir(), 'vdfacts-'));
  const p = join(d, 'facts.json');
  writeFileSync(p, JSON.stringify({ version: 1, measured: '2026-11-23', cmp: { data: 'own', props: { text: true } } }));
  const g = loadFacts(p);
  assert.equal(g.cmp.data, 'own');
  assert.equal(g.cmp.layout, 'no');
  assert.deepEqual(g.cmp.props, { text: true, bool: false, swap: false, variant: false, override: false });
  assert.equal(g.lineHeightFrac, 'keep');
});
