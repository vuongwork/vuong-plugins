import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { verifyScreen, measureCrops, normColor } from '../core/verify.mjs';
import { cropDiff, cropDiffDetail, pixelDiff } from '../core/imgdiff.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

// ---- hand-built data (no browser) ----
// Source tree: n (frame) > n.0 (HUG frame "card") > n.0.0 (text "Inbox"), n.0.1 (icon #ic); n.1 (frame below the card)
// `layout` = the unmodelled proxy, `proxy` = the modelled one; both start exact. DOM observations mirror the source.
const FONT = { ff: 'Inter', fs: '14px', fw: '400', lh: 20, c: 'rgb(34, 34, 34)' };
function fixture() {
  const screen = {
    id: 's', W: [300, 420], H: [200, 200], excluded: [],
    tree: {
      id: 'n', kind: 'frame', rA: [0, 0, 300, 200], rB: [0, 0, 420, 200], paint: { bg: 'rgb(255, 255, 255)' }, kids: [
        { id: 'n.0', kind: 'frame', rA: [10, 10, 100, 40], rB: [10, 10, 100, 40], paint: { bg: 'rgb(238, 238, 238)' }, kids: [
          { id: 'n.0.0', kind: 'text', rA: [20, 20, 40, 20], rB: [20, 20, 40, 20], font: FONT, runs: [{ t: 'Inbox' }] },
          { id: 'n.0.1', kind: 'icon', rA: [70, 20, 20, 20], rB: [70, 20, 20, 20], icon: { ref: 'ic' } },
        ] },
        { id: 'n.1', kind: 'frame', rA: [10, 60, 100, 30], rB: [10, 60, 100, 30] },
      ],
    },
  };
  const spec = {
    id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], kids: [
      { id: 'n.0', t: 'F', sz: ['HUG', 'HUG'], kids: [
        { id: 'n.0.0', t: 'T', sz: ['HUG', 'HUG'], font: FONT, runs: [{ t: 'Inbox' }] },
        { id: 'n.0.1', t: 'V', sz: ['FIXED', 'FIXED'], icon: { ref: 'ic' } },
      ] },
      { id: 'n.1', t: 'F', sz: ['FIXED', 'FIXED'] },
    ],
  };
  const boxes = (M) => {
    const out = {};
    const v = (n) => { out[n.id] = [...(M === 'A' ? n.rA : n.rB)]; (n.kids || []).forEach(v); };
    v(screen.tree); return out;
  };
  const dom = {};
  const v = (n) => {
    const o = { color: n.font ? n.font.c : 'rgb(0, 0, 0)', bg: (n.paint && n.paint.bg) || 'rgba(0, 0, 0, 0)', ff: n.font ? `"${n.font.ff}"` : 'serif' };
    if (n.runs) o.text = n.runs.map((r) => r.t).join('');
    if (n.icon) o.icon = n.icon.ref;
    dom[n.id] = o; (n.kids || []).forEach(v);
  };
  v(screen.tree);
  const proxy = { A: { boxes: boxes('A'), fontsMissing: [], dom }, B: { boxes: boxes('B'), fontsMissing: [], dom } };
  const layout = { A: { boxes: boxes('A') }, B: { boxes: boxes('B') } };
  return { screen, spec, proxy, layout, flags: [], crops: [] };
}
// a layout error shows in both proxies; a Figma-model deviation only in the modelled one
const move = (input, which, id, d, widths = ['A', 'B']) => {
  for (const M of widths) for (const P of which) { const b = input[P][M].boxes[id]; for (let i = 0; i < 4; i++) b[i] += d[i] || 0; }
};
const shift = (input, id, d, widths) => move(input, ['proxy', 'layout'], id, d, widths);
const modelOnly = (input, id, d, widths) => move(input, ['proxy'], id, d, widths);
const rootIds = (r) => [...new Set(r.roots.map((x) => x.id))];
const unexplained = (r) => r.roots.filter((x) => !x.explainedBy);

test('verifyScreen: an exact proxy passes with full coverage', () => {
  const r = verifyScreen(fixture());
  assert.equal(r.total, 5);
  assert.equal(r.checked, 5);
  assert.deepEqual(r.unchecked, []);
  assert.deepEqual(r.roots, []);
  assert.deepEqual(r.modelDeltas, []);
  assert.deepEqual(r.data, []);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.strict, [1, 1]);
  assert.equal(r.pass, true);
});

test('verifyScreen: no layout (unmodelled) proxy is never a silent pass', () => {
  const inp = fixture(); delete inp.layout;
  const r = verifyScreen(inp);
  assert.ok(r.skipped.includes('layout'));
  assert.equal(r.pass, false);
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
  assert.equal(r.nodes.find((x) => x.id === 'n.0.0').ok, false, 'the child itself is still outside tolerance');
});

test('verifyScreen: a sibling pushed down by the previous sibling growing is not a root', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 0, 3]); // card grows 3px for no reason
  shift(inp, 'n.1', [0, 3, 0, 0]); // the next sibling follows
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0']);
});

test('verifyScreen (R11): a Figma-model-only deviation (text round-up drift) is a modelDelta, not a root', () => {
  const inp = fixture();
  modelOnly(inp, 'n.0.0', [0, 0, 0, 0.8]); // text box rounded up 0.8px
  modelOnly(inp, 'n.0', [0, 0, 0, 0.8]); // the hugging card grows with it
  modelOnly(inp, 'n.1', [0, 0.8, 0, 0]); // the next frame is pushed
  const r = verifyScreen(inp);
  assert.deepEqual(r.roots, []);
  assert.deepEqual(r.modelDeltas.map((m) => [m.id, m.width, m.magnitude, m.explainedBy]).sort(),
    [['n.0', 'A', 0.8, 'figmaModel'], ['n.0', 'B', 0.8, 'figmaModel'], ['n.1', 'A', 0.8, 'figmaModel'], ['n.1', 'B', 0.8, 'figmaModel']]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.strict, [0.6, 0.6], 'strict per-node share still shows the drift');
});

test('verifyScreen (R15): a model delta above tolModel (2px) needs approval and fails the screen', () => {
  const inp = fixture();
  modelOnly(inp, 'n.1', [0, 2.5, 0, 0]); // the model moves a frame 2.5px (e.g. a row wraps differently)
  modelOnly(inp, 'n.0', [0, 0, 0, 1.5], ['A']); // 1.5px: within tolModel
  let r = verifyScreen(inp);
  assert.deepEqual(r.roots, []);
  assert.deepEqual(r.needsApproval.map((m) => [m.id, m.width, m.magnitude]).sort(), [['n.1', 'A', 2.5], ['n.1', 'B', 2.5]]);
  assert.deepEqual(r.modelDeltas.map((m) => [m.id, m.width, m.magnitude]), [['n.0', 'A', 1.5]]);
  assert.equal(r.pass, false);
  r = verifyScreen(inp, { tolModel: 3 });
  assert.deepEqual(r.needsApproval, []);
  assert.equal(r.pass, true);
});

test('verifyScreen: a frame growing 3px with children that did not grow is a root', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 3, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0']);
});

test('verifyScreen: a HUG frame around a wrong text is not a second root', () => {
  const inp = fixture();
  shift(inp, 'n.0.0', [0, 0, 1.4, 0]);
  shift(inp, 'n.0', [0, 0, 1.4, 0]);
  shift(inp, 'n.0.1', [1.4, 0, 0, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0.0']);
});

test('verifyScreen: an end-anchored frame growing leftwards with its content is not a root', () => {
  const inp = fixture();
  shift(inp, 'n.0', [-1.2, 0, 1.2, 0]);
  shift(inp, 'n.0.0', [-1.2, 0, 1.2, 0]); // text 1.2 wider (a root itself), the frame's start moves with it
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0.0']);
});

test('verifyScreen: a parent that grows and drags an end-aligned child is the root (no circular excuse)', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 3, 0]);
  shift(inp, 'n.0.1', [3, 0, 0, 0]); // end-aligned icon follows the parent's far edge
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0']);
});

// ---- reviewer probes (fix round 1) ----
const flat = (kids) => ({ id: 'n', kind: 'frame', rA: [0, 0, 400, 100], rB: [0, 0, 400, 100], kids });
function probe(tree, mut, flags = [], spec = { id: 'n', t: 'F', kids: [] }) {
  const boxes = () => { const o = {}; const v = (n) => { o[n.id] = [...n.rA]; (n.kids || []).forEach(v); }; v(tree); return o; };
  const dom = {}; const v = (n) => { dom[n.id] = { color: 'rgb(0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', ...(n.kind === 'icon' ? { icon: 'svg' } : {}) }; (n.kids || []).forEach(v); }; v(tree);
  const proxy = { A: { boxes: boxes(), fontsMissing: [], dom }, B: { boxes: boxes(), fontsMissing: [], dom } };
  const layout = { A: { boxes: boxes() }, B: { boxes: boxes() } };
  mut(proxy, layout);
  return verifyScreen({ screen: { id: 's', tree }, spec, proxy, layout, flags, crops: [] });
}
const both = (fn) => (P, L) => { for (const X of [P, L]) for (const M of ['A', 'B']) fn(X[M].boxes, M); };

test('probe: ten chips each 0.5px further (last 5px off) is not a silent pass', () => {
  const chips = Array.from({ length: 10 }, (_, i) => ({ id: `n.${i}`, kind: 'frame', rA: [i * 30, 10, 20, 20], rB: [i * 30, 10, 20, 20] }));
  const r = probe(flat(chips), both((b) => { for (let i = 0; i < 10; i++) b[`n.${i}`][0] += 0.5 * (i + 1); }));
  assert.equal(r.pass, false);
  assert.deepEqual(rootIds(r), ['n.1'], 'the first chip beyond tolerance whose neighbour stayed within it');
});

test('probe: six nested frames each 0.5px further (leaf 3px off) is not a silent pass', () => {
  let cur = { id: 'n.0', kind: 'frame', rA: [0, 0, 100, 50], rB: [0, 0, 100, 50], kids: [] }; const chain = [cur];
  const tree = flat([cur]);
  for (let d = 2; d <= 6; d++) { const k = { id: 'n' + '.0'.repeat(d), kind: 'frame', rA: [0, 0, 100, 50], rB: [0, 0, 100, 50], kids: [] }; cur.kids.push(k); cur = k; chain.push(k); }
  const r = probe(tree, both((b) => chain.forEach((c, i) => { b[c.id][0] += 0.5 * (i + 1); })));
  assert.equal(r.pass, false);
  assert.deepEqual(rootIds(r), ['n.0.0']);
});

test('probe (R12): a parent +30px whose FILL children absorb it is the root; children flags do not excuse it', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 200, 40], rB: [0, 0, 200, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 120, 40], rB: [0, 0, 120, 40] }, { id: 'n.0.1', kind: 'frame', rA: [120, 0, 80, 40], rB: [120, 0, 80, 40] }] }]);
  const mut = (P, L) => { for (const X of [P, L]) { const b = X.A.boxes; b['n.0'][2] += 30; b['n.0.0'][2] += 20; b['n.0.1'][0] += 20; b['n.0.1'][2] += 10; } };
  const flags = [{ id: 'n.0.0', kind: 'weightedFill' }, { id: 'n.0.1', kind: 'weightedFill' }];
  // without sizing information every deviating node is a root; the parent's stays unexplained
  let r = probe(tree, mut, flags);
  assert.equal(r.pass, false);
  assert.ok(unexplained(r).some((x) => x.id === 'n.0'), JSON.stringify(r.roots));
  // with FILL children (spec sizing) the parent is the only root
  const spec = { id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], kids: [{ id: 'n.0', t: 'F', sz: ['FIXED', 'FIXED'], kids: [
    { id: 'n.0.0', t: 'F', sz: ['FILL', 'FILL'] }, { id: 'n.0.1', t: 'F', sz: ['FILL', 'FILL'] }] }] };
  r = probe(tree, mut, flags, spec);
  assert.deepEqual(rootIds(r), ['n.0']);
  assert.equal(r.roots[0].explainedBy, undefined);
  assert.equal(r.pass, false);
});

test('probe (R12): a flag on an exact ancestor does not excuse a descendant (icon grew 6x6 under spaceAround)', () => {
  const nav = { id: 'n.0', kind: 'frame', rA: [0, 0, 400, 40], rB: [0, 0, 400, 40], kids: [{ id: 'n.0.0', kind: 'frame', rA: [10, 5, 80, 30], rB: [10, 5, 80, 30], kids: [
    { id: 'n.0.0.0', kind: 'icon', rA: [15, 10, 20, 20], rB: [15, 10, 20, 20] }] }] };
  const r = probe(flat([nav]), both((b) => { b['n.0.0.0'][2] += 6; b['n.0.0.0'][3] += 6; }), [{ id: 'n.0', kind: 'spaceAround' }]);
  assert.deepEqual(rootIds(r), ['n.0.0.0']);
  assert.ok(r.roots.every((x) => x.explainedBy === undefined));
  assert.equal(r.pass, false);
});

test('verifyScreen (R12): an ancestor flag explains a descendant root when that ancestor deviates too', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 3, 0]);
  shift(inp, 'n.0.1', [0, 0, 3, 0]);
  inp.flags = [{ id: 'n.0', kind: 'weightedFill', detail: 'x' }];
  // R17: the card hugs its width, so its +3px comes from the icon: no excuse for the icon
  let r = verifyScreen(inp);
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.1', 'n.0.1'], JSON.stringify(r.roots));
  // a FIXED-width card off by 3px deviates for its own reason: its flag explains it and the icon
  inp.spec.kids[0].sz = ['FIXED', 'HUG'];
  r = verifyScreen(inp);
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === 'weightedFill'), JSON.stringify(r.roots));
});

test('probe (R12): on an unsafeWiden screen a B-only deviation is unchecked, never explained', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 100, 40], rB: [0, 0, 100, 40] }]);
  let r = probe(tree, () => {}, [{ id: 'n', kind: 'unsafeWiden' }]);
  assert.equal(r.pass, true, 'nothing deviates');
  r = probe(tree, (P, L) => { P.B.boxes['n.0'][2] += 40; L.B.boxes['n.0'][2] += 40; }, [{ id: 'n', kind: 'unsafeWiden' }]);
  assert.deepEqual(r.roots, []);
  assert.deepEqual(r.unchecked, ['n.0']);
  assert.match(r.uncheckedReasons['n.0'], /unsafeWiden/);
  assert.equal(r.pass, false);
});

// ---- reviewer probes (fix round 2) ----
const chipRow = () => Array.from({ length: 10 }, (_, i) => ({ id: `n.${i}`, kind: 'frame', rA: [i * 30, 10, 20, 20], rB: [i * 30, 10, 20, 20] }));
const widen = (b, pre = 'n') => { for (let i = 0; i < 10; i++) { b[`${pre}.${i}`][0] += 0.5 * i; b[`${pre}.${i}`][2] += 0.5; } };

test('probe (R16): ten chips each 0.5px wider, pushed by the earlier ones (last 4.5px off), is not a silent pass', () => {
  const r = probe(flat(chipRow()), both((b) => widen(b)));
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('probe (R16): the same widening chips inside a HUG row are not a silent pass', () => {
  const chips = chipRow().map((c) => ({ ...c, id: `n.r.${c.id.slice(2)}` }));
  const row = { id: 'n.r', kind: 'frame', rA: [0, 10, 290, 20], rB: [0, 10, 290, 20], kids: chips };
  const spec = { id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], kids: [{ id: 'n.r', t: 'F', sz: ['HUG', 'HUG'],
    kids: chips.map((k) => ({ id: k.id, t: 'F', sz: ['FIXED', 'FIXED'] })) }] };
  const r = probe(flat([row]), both((b) => { b['n.r'][2] += 5; widen(b, 'n.r'); }), [], spec);
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
  assert.ok(!rootIds(r).includes('n.r'), 'the hugging row is not a second root');
  assert.equal(r.pass, false);
});

test('probe (R16): ten rows each 0.5px taller (last 4.5px off) is not a silent pass', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `n.${i}`, kind: 'frame', rA: [0, i * 30, 200, 20], rB: [0, i * 30, 200, 20] }));
  const r = probe({ ...flat(rows), rA: [0, 0, 400, 400], rB: [0, 0, 400, 400] },
    both((b) => { for (let i = 0; i < 10; i++) { b[`n.${i}`][1] += 0.5 * i; b[`n.${i}`][3] += 0.5; } }));
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('probe (R17): a HUG nav that grows only because its icon grew does not excuse the icon with its flag', () => {
  const nav = { id: 'n.0', kind: 'frame', rA: [0, 0, 400, 40], rB: [0, 0, 400, 40], kids: [{ id: 'n.0.0', kind: 'icon', icon: { svg: 1 }, rA: [10, 10, 20, 20], rB: [10, 10, 20, 20] }] };
  const spec = { id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], kids: [{ id: 'n.0', t: 'F', sz: ['FIXED', 'HUG'], kids: [{ id: 'n.0.0', t: 'V', sz: ['FIXED', 'FIXED'] }] }] };
  const r = probe(flat([nav]), both((b) => { b['n.0.0'][2] += 6; b['n.0.0'][3] += 6; b['n.0'][3] += 6; }), [{ id: 'n.0', kind: 'spaceAround' }], spec);
  assert.ok(unexplained(r).some((x) => x.id === 'n.0.0'), JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('probe (R18): a model delta on a node outside tolerance in the layout proxy still needs approval', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 100, 40], rB: [0, 0, 100, 40] }, { id: 'n.1', kind: 'frame', rA: [0, 40, 100, 40], rB: [0, 40, 100, 40] }]);
  const r = probe(tree, (P, L) => { for (const M of ['A', 'B']) { L[M].boxes['n.0'][3] += 3; L[M].boxes['n.1'][1] += 3; P[M].boxes['n.0'][3] += 3; P[M].boxes['n.1'][1] += 43; } },
    [{ id: 'n.0', kind: 'shrink' }]);
  assert.deepEqual(unexplained(r), [], JSON.stringify(r.roots));
  assert.deepEqual(r.needsApproval.map((m) => [m.id, m.width, m.magnitude]).sort(), [['n.1', 'A', 40], ['n.1', 'B', 40]]);
  assert.equal(r.pass, false);
});

// ---- coverage, flags, tolerances ----

test('verifyScreen: a node with no source box at B, no proxy box or no layout box is unchecked and fails', () => {
  const inp = fixture();
  inp.screen.tree.kids[1].rB = null;
  const r = verifyScreen(inp);
  assert.deepEqual(r.unchecked, ['n.1']);
  assert.equal(r.checked, 4);
  assert.match(r.uncheckedReasons['n.1'], /source.*B/);
  assert.equal(r.pass, false);

  const inp2 = fixture();
  delete inp2.proxy.A.boxes['n.0.1'];
  const r2 = verifyScreen(inp2);
  assert.deepEqual(r2.unchecked, ['n.0.1']);
  assert.match(r2.uncheckedReasons['n.0.1'], /proxy.*A/);

  const inp3 = fixture();
  delete inp3.layout.B.boxes['n.0.1'];
  const r3 = verifyScreen(inp3);
  assert.deepEqual(r3.unchecked, ['n.0.1']);
  assert.match(r3.uncheckedReasons['n.0.1'], /layout.*B/);
  assert.equal(r3.pass, false);
});

test('verifyScreen: syn frames and excluded nodes are not counted', () => {
  const inp = fixture();
  inp.spec.kids[0] = { id: 'n.g0', t: 'F', syn: 'align', kids: [inp.spec.kids[0]] };
  for (const P of ['proxy', 'layout']) for (const M of ['A', 'B']) inp[P][M].boxes['n.g0'] = [0, 0, 1, 1];
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

test('verifyScreen: a text-only flag explains its own text, never its ancestors', () => {
  const inp = fixture();
  shift(inp, 'n.0', [0, 0, 3, 0]);
  inp.flags = [{ id: 'n.0.0', kind: 'mixedRunHeight', detail: 'font sizes 14/20px in one line' }];
  let r = verifyScreen(inp);
  assert.deepEqual(rootIds(r), ['n.0']);
  assert.ok(r.roots.every((x) => x.explainedBy === undefined));

  const inp2 = fixture();
  shift(inp2, 'n.0.0', [0, 0, 4, 0]);
  inp2.flags = [{ id: 'n.0.0', kind: 'mixedRunHeight', detail: 'x' }];
  r = verifyScreen(inp2);
  assert.ok(r.roots.length && r.roots.every((x) => x.id === 'n.0.0' && x.explainedBy === 'mixedRunHeight'));
});

test('verifyScreen (R10): fontSubstitution explains nothing; it is kept in the report as info', () => {
  const inp = fixture();
  shift(inp, 'n.0.0', [0, 0, 4, 0]);
  inp.flags = [{ id: 'n.0.0', kind: 'fontSubstitution', detail: 'Segoe UI → Inter' }];
  inp.crops = [{ id: 'n.0.0', width: 'A', ratio: 0.3, diff: 50, peak: 30 }];
  const r = verifyScreen(inp);
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === undefined));
  assert.equal(r.crop.length, 1);
  assert.deepEqual(r.flags, inp.flags);
  assert.equal(r.pass, false);
});

test('verifyScreen (R10): a font override that failed in capture is a font data mismatch', () => {
  const inp = fixture();
  inp.screen.fontSubs = [{ from: 'Segoe UI', to: 'Inter', reason: 'override-failed', cause: 'system' }, { from: 'system-ui', to: 'Inter', reason: 'system' }];
  const r = verifyScreen(inp);
  assert.deepEqual(r.data, [{ id: 'n', kind: 'font', expected: 'Inter', actual: 'Segoe UI (override-failed)' }]);
  assert.equal(r.pass, false);
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

// ---- data (observed in the proxy DOM) ----

test('verifyScreen: text read from the proxy DOM ("Inbox" vs "Inbx") is a text mismatch; whitespace is not', () => {
  const inp = fixture();
  inp.proxy.A.dom['n.0.0'] = { ...inp.proxy.A.dom['n.0.0'], text: 'Inbx' };
  const r = verifyScreen(inp);
  assert.deepEqual(r.data, [{ id: 'n.0.0', kind: 'text', expected: 'Inbox', actual: 'Inbx' }]);
  assert.equal(r.pass, false);

  const inp2 = fixture();
  inp2.proxy.A.dom['n.0.0'] = { ...inp2.proxy.A.dom['n.0.0'], text: '  In box'.replace(' box', 'box\n') };
  assert.deepEqual(verifyScreen(inp2).data, []);
});

test('verifyScreen: icon ref, rendered font family and a missing font are data mismatches', () => {
  const inp = fixture();
  inp.proxy.A.dom['n.0.1'] = { ...inp.proxy.A.dom['n.0.1'], icon: 'other' };
  inp.proxy.B.fontsMissing = ['Inter'];
  let r = verifyScreen(inp);
  assert.ok(r.data.some((d) => d.id === 'n.0.1' && d.kind === 'icon' && d.expected === 'ic' && d.actual === 'other'));
  assert.ok(r.data.some((d) => d.id === 'n.0.0' && d.kind === 'font' && d.expected === 'Inter' && /did not render/.test(d.actual)));
  assert.equal(r.pass, false);

  const inp2 = fixture();
  inp2.proxy.A.dom['n.0.0'] = { ...inp2.proxy.A.dom['n.0.0'], ff: '"Roboto", sans-serif' };
  r = verifyScreen(inp2);
  assert.deepEqual(r.data, [{ id: 'n.0.0', kind: 'font', expected: 'Inter', actual: 'Roboto' }]);
});

test('verifyScreen (R13): colour changes (text colour, background, background added) are color mismatches', () => {
  const inp = fixture();
  inp.proxy.A.dom['n.0.0'] = { ...inp.proxy.A.dom['n.0.0'], color: 'rgb(204, 51, 51)' };
  inp.proxy.A.dom['n.0'] = { ...inp.proxy.A.dom['n.0'], bg: 'rgb(238, 238, 239)' };
  inp.proxy.A.dom['n.1'] = { ...inp.proxy.A.dom['n.1'], bg: 'rgb(0, 0, 0)' };
  const r = verifyScreen(inp);
  assert.deepEqual(r.data.filter((d) => d.kind === 'color').map((d) => [d.id, d.expected, d.actual]), [
    ['n.0', 'rgb(238, 238, 238)', 'rgb(238, 238, 239)'],
    ['n.0.0', 'rgb(34, 34, 34)', 'rgb(204, 51, 51)'],
    ['n.1', 'transparent', 'rgb(0, 0, 0)'],
  ]);
  assert.equal(r.pass, false);
  assert.equal(normColor('rgba(10, 20, 30, 0)'), 'transparent');
  assert.equal(normColor('rgba(10, 20, 30, 0.5)'), 'rgba(10, 20, 30, 0.5)');
});

test('verifyScreen: proxy DOM missing is never a silent pass', () => {
  const inp = fixture(); delete inp.proxy.A.dom;
  const r = verifyScreen(inp);
  assert.ok(r.skipped.includes('data'));
  assert.equal(r.pass, false);
});

// ---- crops ----

test('verifyScreen: crop failures (ratio or peak, at A or B) fail the screen; crop not run is never a silent pass', () => {
  const inp = fixture();
  inp.crops = [{ id: 'n.0.1', width: 'A', ratio: 0.3, diff: 60, peak: 30 }, { id: 'n.0.0', width: 'B', ratio: 0.02, diff: 90, peak: 56 },
    { id: 'n.1', width: 'B', ratio: 0.02, diff: 30, peak: 12 }];
  let r = verifyScreen(inp);
  assert.deepEqual(r.crop.map((c) => [c.id, c.width]), [['n.0.1', 'A'], ['n.0.0', 'B']]);
  assert.deepEqual(r.cropWidths, ['A', 'B']);
  assert.equal(r.pass, false);

  const inp2 = fixture(); delete inp2.crops;
  r = verifyScreen(inp2);
  assert.equal(r.pass, false);
  assert.ok(r.skipped.includes('crop'));
});

test('verifyScreen: a crop failure inside a raster node is listed as explained, not as a failure', () => {
  const inp = fixture();
  inp.flags = [{ id: 'n.0', kind: 'raster', detail: 'filter: blur(2px)' }];
  inp.crops = [{ id: 'n.0.1', width: 'A', ratio: 0.3, peak: 50 }, { id: 'n.0', width: 'A', ratio: 0.1, peak: 50 }];
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

// 100x100 CSS px at DSF 2, rendered from a temp file with goto, as the proxy does (a tiny viewport stalled
// screenshots under suite load)
async function shot(html) {
  const dir = mkdtempSync(join(tmpdir(), 'vd-verify-'));
  const file = join(dir, 'shot.html');
  writeFileSync(file, `<!doctype html><body style="margin:0;background:#fff"><div id="r" style="position:relative;width:100px;height:100px">${html}</div></body>`);
  const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 });
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    return await page.locator('#r').screenshot();
  } finally { await page.close(); rmSync(dir, { recursive: true, force: true }); }
}
const tick = (x, y = 12, sw = 2) => `<svg style="position:absolute;left:${x}px;top:${y}px" width="16" height="16" viewBox="0 0 16 16"><path d="M2 8l4 4 8-8" stroke="#222" stroke-width="${sw}" fill="none"/></svg>`;
const cross = (x) => `<svg style="position:absolute;left:${x}px;top:12px" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="#222" stroke-width="2" fill="none"/></svg>`;
const para = (x = 2) => `<div style="position:absolute;left:${x}px;top:2px;width:60px;font:11px/13px sans-serif">Hôm nay còn chỗ cho ba việc nữa nhé bạn ơi</div>`;
const fails = (c) => c.ratio > 0.05 || c.peak >= 40;

test('cropDiff: the same icon 1px off is a match; a different icon is not', { skip }, async () => {
  const a = await shot(tick(20)), b = await shot(tick(21)), c = await shot(cross(20));
  const R = [20, 12, 16, 16];
  const same = await cropDiff(browser, a, R, b, R);
  assert.ok(same < 0.05, `shifted: ${same}`);
  const diff = await cropDiff(browser, a, R, c, R);
  assert.ok(diff > 0.05, `changed icon: ${diff}`);
});

test('cropDiff (R13): the search never moves more than 1 CSS px', { skip }, async () => {
  const R = [20, 12, 16, 16];
  const d = await cropDiffDetail(browser, await shot(tick(20)), R, await shot(tick(21.5)), R);
  assert.ok(d.diff > 0, `1.5px apart must not be matched exactly: ${JSON.stringify(d)}`);
});

test('cropDiff (R13): a removed thin tick fails in its own box and in a ~4000px² box with other ink', { skip }, async () => {
  const withTick = await shot(tick(20)), none = await shot('');
  assert.ok(fails(await cropDiffDetail(browser, withTick, [20, 12, 16, 16], none, [20, 12, 16, 16])));
  assert.ok(fails(await cropDiffDetail(browser, withTick, [0, 0, 63, 63], none, [0, 0, 63, 63])), 'diluted in a large empty box');
  for (const sw of [2, 1]) {
    const d = await cropDiffDetail(browser, await shot(para() + tick(40, 45, sw)), [0, 0, 63, 63], await shot(para()), [0, 0, 63, 63]);
    assert.ok(fails(d), `tick (stroke ${sw}) removed next to a paragraph: ${JSON.stringify(d)}`);
  }
  // sub-pixel placement of the same paragraph or text is not a failure
  const p = await cropDiffDetail(browser, await shot(para()), [0, 0, 63, 63], await shot(para(2.3)), [0, 0, 63, 63]);
  assert.ok(!fails(p), `paragraph 0.3px off: ${JSON.stringify(p)}`);
});

test('pixelDiff: identical images are 0, different ones are not', { skip }, async () => {
  const a = await shot(tick(20));
  assert.equal(await pixelDiff(browser, a, await shot(tick(20))), 0);
  assert.ok((await pixelDiff(browser, a, await shot(cross(20)))) > 0);
});

test('measureCrops (R13): crops run at A and B; a B-only defect is caught', { skip }, async () => {
  const good = await shot(tick(20)), bad = await shot(cross(20));
  const tree = { id: 'n', kind: 'frame', rA: [0, 0, 100, 100], rB: [0, 0, 100, 100], kids: [{ id: 'n.0', kind: 'icon', rA: [20, 12, 16, 16], rB: [20, 12, 16, 16] }] };
  const boxes = { n: [0, 0, 100, 100], 'n.0': [20, 12, 16, 16] };
  const crops = await measureCrops(browser, { tree, png: [good, good] }, { A: { boxes, png: good }, B: { boxes, png: bad } });
  assert.deepEqual([...new Set(crops.map((c) => c.width))], ['A', 'B']);
  const icon = (M) => crops.find((c) => c.id === 'n.0' && c.width === M);
  assert.ok(!fails(icon('A')), JSON.stringify(icon('A')));
  assert.ok(fails(icon('B')), JSON.stringify(icon('B')));
});

test('renderProxy origin: the root sits at the source fraction, boxes unchanged, text rasterised like the source', { skip }, async () => {
  const { buildProxyHtml, renderProxy } = await import('../core/proxy.mjs');
  const { defaultFontMap } = await import('../core/font-map.mjs');
  const T = { id: 'n', t: 'F', w: 120, h: 40, sz: ['FIXED', 'FIXED'], kids: [
    { id: 'n.0', t: 'T', w: 60, h: 20, sz: ['HUG', 'HUG'], abs: { x: 10, y: 10.3, c: 'L' }, font: { ff: 'serif', fs: '14px', fw: '400', lh: 20, c: 'rgb(0, 0, 0)' }, runs: [{ t: 'Inbox' }] }] };
  const html = buildProxyHtml(T, {}, defaultFontMap(), { webFonts: false });
  const a = await renderProxy(browser, html, 120), b = await renderProxy(browser, html, 120, { origin: [0, 0.6875] });
  assert.deepEqual(a.boxes, b.boxes);
  assert.notDeepEqual(a.png, b.png, 'glyphs snap differently at another page fraction');
});

test('captureScreens({ png: true }) returns clipped root PNGs at A and B', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { screens } = await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr', png: true, fontOverride: false });
  const s = screens[0];
  assert.equal(s.png.length, 2);
  for (const [i, buf] of s.png.entries()) {
    assert.ok(Buffer.isBuffer(buf));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.ok(Math.abs(w - s.W[i] * 2) <= 2, `png ${i} width ${w} vs ${s.W[i]}`);
    assert.ok(Math.abs(h - s.H[i] * 2) <= 2, `png ${i} height ${h} vs ${s.H[i]}`);
  }
  assert.equal(s.origin.length, 2);
  for (const o of s.origin) assert.ok(o.every((v) => v >= 0 && v < 1), JSON.stringify(s.origin));
  const { screens: noPng } = await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr', fontOverride: false });
  assert.equal(noPng[0].png, undefined);
});

test('pipeline: a system-ui fixture (font override) verifies end to end with both proxies and real DOM data',
  { skip: skip || (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)') }, async () => {
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
    const html = (sp) => buildProxyHtml(sp, s.svgDefs, fm, { webFonts: false });
    const at = (sp, i) => renderProxy(browser, html(sp), s.W[i], { origin: s.origin[i] });
    const proxy = { A: await at(mod.spec, 0), B: await at(mod.spec, 1) };
    const layout = { A: await at(inf.spec, 0), B: await at(inf.spec, 1) };
    const r = await verifyScreenWithImages(browser, { screen: s, spec: mod.spec, proxy, layout, flags });
    assert.deepEqual(r.unchecked, []);
    assert.deepEqual(r.skipped, []);
    assert.deepEqual(r.data, [], JSON.stringify(r.data));
    assert.deepEqual(unexplained(r), [], JSON.stringify(r.roots));
    assert.deepEqual(r.crop, [], JSON.stringify(r.crop));
    assert.deepEqual(r.cropWidths, ['A', 'B']);
    assert.ok(r.modelDeltas.every((m) => m.explainedBy === 'figmaModel'));
  });
