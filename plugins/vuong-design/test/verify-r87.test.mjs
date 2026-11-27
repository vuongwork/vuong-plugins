// R87: the norm predictions for wrapping rows, SCALE children, a centre-constrained frame that resizes itself and a
// FILL item held at its max width (Planora with every question answered, 2026-11-27: 28 unexplained norm roots, 4
// after R87 before the max-width case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyScreen } from '../core/verify.mjs';

const SHOWN = () => ({ op: 1, vis: 'visible', disp: 'block', stroke: ['none', 'none', 'none', 'none'], shadow: 'none', bgImage: 'none', radius: ['0px', '0px', '0px', '0px'] });
const rec = (node, cat, code, prop, from, to) => ({ entry: `e-${node}-${prop}`, cat, code, node, prop, from, to });
const normRoots = (r) => r.roots.filter((x) => x.layer === 'norm');
const open = (r) => normRoots(r).filter((x) => !x.explainedBy);

// A frame-only screen: spec (modelled) and nspec (target) trees, boxes per width for the modelled proxy (= layout) and
// the norm proxy; the source tree takes the modelled boxes.
function fixture({ spec, nspec, base, norm, applied }) {
  const ids = [];
  const walk = (s) => { ids.push(s.id); (s.kids || []).forEach(walk); };
  walk(spec);
  const tree = (s) => ({ id: s.id, kind: 'frame', rA: [...base.A[s.id]], rB: [...base.B[s.id]], kids: (s.kids || []).map(tree) });
  const dom = Object.fromEntries(ids.map((id) => [id, { color: 'rgb(0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', ff: 'serif', ...SHOWN() }]));
  const P = (boxes, extra) => ({ A: { boxes: boxes.A, dom, fontsMissing: [], facesMissing: [], ...extra }, B: { boxes: boxes.B, dom, fontsMissing: [], facesMissing: [], ...extra } });
  const screen = { id: 's', W: [base.A.n[2], base.B.n[2]], H: [base.A.n[3], base.B.n[3]], excluded: [], tree: tree(spec) };
  return {
    screen, spec: { ...spec, model: 'figma' }, flags: [], crops: [], proxy: P(base, { model: 'figma' }), layout: P(structuredClone(base), { model: 'none' }),
    norm: { spec: { ...nspec, model: 'figma' }, applied, proxy: P(norm, { model: 'figma', mark: 'norm' }) },
  };
}

// three 90 px chips in a wrapping row (gap and counterGap 6 px); widths 90 -> 100 push the third chip onto a second
// line at A (300 px) and not at B (420 px)
function wrapFixture(third = [0, 26]) {
  const chip = (i, w) => ({ id: `n.0.${i}`, t: 'F', sz: ['FIXED', 'FIXED'], w, h: 20 });
  const row = (w) => ({ id: 'n.0', t: 'F', sz: ['FILL', 'HUG'], lay: { d: 'H', wrap: 1, p: [0, 0, 0, 0], g: 6, cg: 6, pa: 'S', ca: 'S' }, kids: [0, 1, 2].map((i) => chip(i, w)) });
  const root = (w) => ({ id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' }, kids: [row(w)] });
  const base = {}, norm = {};
  for (const [M, W] of [['A', 300], ['B', 420]]) {
    base[M] = { n: [0, 0, W, 400], 'n.0': [0, 0, W, 20], 'n.0.0': [0, 0, 90, 20], 'n.0.1': [96, 0, 90, 20], 'n.0.2': [192, 0, 90, 20] };
    const wraps = M === 'A';
    norm[M] = { n: [0, 0, W, 400], 'n.0': [0, 0, W, wraps ? 46 : 20], 'n.0.0': [0, 0, 100, 20], 'n.0.1': [106, 0, 100, 20], 'n.0.2': wraps ? [...third, 100, 20] : [212, 0, 100, 20] };
  }
  return fixture({ spec: root(90), nspec: root(100), base, norm, applied: [0, 1, 2].map((i) => rec(`n.0.${i}`, 'size', 'GRID4', 'width', 90, 100)) });
}

test('R87: a wrapping row is laid out again from the measured sizes: the chip that moves to a new line is explained', () => {
  const r = verifyScreen(wrapFixture());
  assert.ok(normRoots(r).some((x) => x.id === 'n.0.2' && x.explainedBy === 'norm'), JSON.stringify(normRoots(r)));
  assert.deepEqual(open(r), [], JSON.stringify(open(r)));
  // the third chip on a line 4 px too low stays open
  const o = verifyScreen(wrapFixture([0, 30]));
  assert.ok(open(o).some((x) => x.id === 'n.0.2' && x.normMismatch), JSON.stringify(normRoots(o)));
});

test('R87: a wrapping row the model cannot reproduce (items not where greedy lines put them) predicts nothing', () => {
  const inp = wrapFixture();
  for (const P of [inp.proxy, inp.layout]) for (const M of ['A', 'B']) P[M].boxes['n.0.1'] = [100, 0, 90, 20]; // 10 px gap, the spec says 6
  for (const M of ['A', 'B']) inp.screen.tree.kids[0].kids[1][`r${M}`] = [100, 0, 90, 20];
  const r = verifyScreen(inp);
  assert.ok(open(r).some((x) => x.id === 'n.0.2' && x.normMismatch && x.normMismatch.some((m) => m.predicted === null)), JSON.stringify(normRoots(r)));
});

// a progress bar (FILL in a root with 10 px side padding) holding a SCALE fill of 150 / 280 px; padding 10 -> 12
function scaleFixture(fillW) {
  const root = (p) => ({ id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], lay: { d: 'V', p: [0, p, 0, p], g: 0, pa: 'S', ca: 'S' },
    kids: [{ id: 'n.0', t: 'F', sz: ['FILL', 'FIXED'], h: 8, kids: [{ id: 'n.0.0', t: 'F', sz: ['FIXED', 'FIXED'], w: 150, h: 8, abs: { x: 0, y: 0, c: 'SCALE' } }] }] });
  const base = {}, norm = {};
  for (const [M, W] of [['A', 300], ['B', 420]]) {
    base[M] = { n: [0, 0, W, 400], 'n.0': [10, 0, W - 20, 8], 'n.0.0': [10, 0, (150 * (W - 20)) / 280, 8] };
    norm[M] = { n: [0, 0, W, 400], 'n.0': [12, 0, W - 24, 8], 'n.0.0': [12, 0, fillW ? fillW(W) : (150 * (W - 24)) / 280, 8] };
  }
  return fixture({ spec: root(10), nspec: root(12), base, norm, applied: ['paddingL', 'paddingR'].map((p) => rec('n', 'space', 'GRID4', p, 10, 12)) });
}

test("R87: a SCALE child follows its parent's measured resize; a fill that kept its width stays open", () => {
  const r = verifyScreen(scaleFixture());
  assert.deepEqual(open(r), [], JSON.stringify(normRoots(r)));
  const o = verifyScreen(scaleFixture((W) => (150 * (W - 20)) / 280 + 3));
  assert.ok(open(o).some((x) => x.id === 'n.0.0'), JSON.stringify(normRoots(o)));
});

// a centre-constrained FAB (HUG, 14 px padding) whose icon goes 22 -> 24: it grows from its near edge
function fabFixture(shift = 0) {
  const root = (s) => ({ id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], kids: [{ id: 'n.0', t: 'F', sz: ['HUG', 'HUG'], abs: { x: 125, y: 0, c: 'C' }, lay: { d: 'V', p: [14, 14, 14, 14], g: 0, pa: 'S', ca: 'S' },
    kids: [{ id: 'n.0.0', t: 'F', sz: ['FIXED', 'FIXED'], w: s, h: s }] }] });
  const base = {}, norm = {};
  for (const [M, W] of [['A', 300], ['B', 420]]) {
    const x = 125 + (W - 300) / 2;
    base[M] = { n: [0, 0, W, 400], 'n.0': [x, 0, 50, 50], 'n.0.0': [x + 14, 14, 22, 22] };
    norm[M] = { n: [0, 0, W, 400], 'n.0': [x + shift, 0, 52, 52], 'n.0.0': [x + shift + 14, 14, 24, 24] };
  }
  return fixture({ spec: root(22), nspec: root(24), base, norm, applied: ['width', 'height'].map((p) => rec('n.0.0', 'icon', 'ICON_FRAME', p, 22, 24)) });
}

test('R87: a centre-constrained frame that resizes itself keeps its near edge; re-centring it is a mismatch', () => {
  const r = verifyScreen(fabFixture());
  assert.deepEqual(open(r), [], JSON.stringify(normRoots(r)));
  const o = verifyScreen(fabFixture(-6));
  assert.ok(open(o).some((x) => x.id === 'n.0' && x.normMismatch), JSON.stringify(normRoots(o)));
});

// a space-between row: a FILL column held at max 198 px, then a button 48 -> 52 px; row padding R 14 -> 16
function cappedFixture(btnDx = 0, colW = 198) {
  const root = (pr, bw) => ({ id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], lay: { d: 'H', sb: 1, p: [0, pr, 0, 14], g: 0, pa: 'S', ca: 'S' },
    kids: [{ id: 'n.0', t: 'F', sz: ['FILL', 'FIXED'], h: 30, max: 198 }, { id: 'n.1', t: 'F', sz: ['FIXED', 'FIXED'], w: bw, h: 30 }] });
  const base = {}, norm = {};
  for (const [M, W] of [['A', 300], ['B', 420]]) {
    base[M] = { n: [0, 0, W, 400], 'n.0': [14, 0, colW, 30], 'n.1': [W - 14 - 48, 0, 48, 30] };
    norm[M] = { n: [0, 0, W, 400], 'n.0': [14, 0, colW, 30], 'n.1': [W - 16 - 52 + btnDx, 0, 52, 30] };
  }
  return fixture({ spec: root(14, 48), nspec: root(16, 52), base, norm,
    applied: [rec('n', 'space', 'GRID4', 'paddingR', 14, 16), rec('n.1', 'size', 'GRID4', 'width', 48, 52)] });
}

test('R87: a FILL item held at its max width does not fill: the last item of a space-between row sits at the far edge', () => {
  const r = verifyScreen(cappedFixture());
  assert.deepEqual(open(r), [], JSON.stringify(normRoots(r)));
  const o = verifyScreen(cappedFixture(6));
  assert.ok(open(o).some((x) => x.id === 'n.1' && x.normMismatch), JSON.stringify(normRoots(o)));
  // the plain layout of a capped text column: under its max (196.13 of 198 px) and unchanged, it does not fill either
  const u = verifyScreen(cappedFixture(0, 196.13));
  assert.deepEqual(open(u), [], JSON.stringify(normRoots(u)));
});
