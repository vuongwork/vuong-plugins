import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { verifyScreen, measureCrops, normColor } from '../core/verify.mjs';
import { cropDiff, cropDiffDetail, cropDiffMany, pixelDiff } from '../core/imgdiff.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

// ---- hand-built data (no browser) ----
// Source tree: n (frame) > n.0 (HUG frame "card") > n.0.0 (text "Inbox"), n.0.1 (icon #ic); n.1 (frame below the card)
// `layout` = the unmodelled proxy, `proxy` = the modelled one; both start exact. DOM observations mirror the source.
// what the proxy DOM reports for a shown node without strokes (R30/R31 observations)
const SHOWN = () => ({ op: 1, vis: 'visible', disp: 'block', stroke: ['none', 'none', 'none', 'none'], shadow: 'none', bgImage: 'none', radius: ['0px', '0px', '0px', '0px'] });
// R50: the per-run font observation of a text as the proxy DOM reports it ([text, size, weight, style, decoration, transform])
const domRuns = (n) => (n.runs || []).filter((r) => !r.br).map((r) => { const f = { ...n.font, ...(r.s || {}) }; return [r.t, f.fs, f.fw, f.fst || 'normal', f.td || 'none', f.tt || 'none']; });
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
    id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], lay: { d: 'V' }, kids: [
      { id: 'n.0', t: 'F', sz: ['HUG', 'HUG'], lay: { d: 'H' }, kids: [
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
    const o = { color: n.font ? n.font.c : 'rgb(0, 0, 0)', bg: (n.paint && n.paint.bg) || 'rgba(0, 0, 0, 0)', ff: n.font ? `"${n.font.ff}"` : 'serif', ...SHOWN() };
    if (n.runs) o.text = n.runs.map((r) => r.t).join('');
    if (n.runs && n.font) o.runs = domRuns(n);
    if (n.icon) o.icon = n.icon.ref;
    dom[n.id] = o; (n.kids || []).forEach(v);
  };
  v(screen.tree);
  const proxy = { A: { boxes: boxes('A'), fontsMissing: [], facesMissing: [], dom, model: 'figma' }, B: { boxes: boxes('B'), fontsMissing: [], facesMissing: [], dom, model: 'figma' } };
  const layout = { A: { boxes: boxes('A'), model: 'none' }, B: { boxes: boxes('B'), model: 'none' } };
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
  // R43: the card is the model root; the pushed frame n.1 follows it and is counted, not listed
  assert.deepEqual(r.modelDeltas.map((m) => [m.id, m.width, m.magnitude, m.explainedBy]).sort(),
    [['n.0', 'A', 0.8, 'figmaModel'], ['n.0', 'B', 0.8, 'figmaModel']]);
  assert.deepEqual(r.modelFollowers, { A: 1, B: 1 });
  assert.equal(r.modelDrift.magnitude, 0.8);
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
  inp.spec.lay.ca = 'E'; // R35: the end anchor must be in the spec (unknown alignment is start)
  shift(inp, 'n.0', [-1.2, 0, 1.2, 0]);
  shift(inp, 'n.0.0', [-1.2, 0, 1.2, 0]); // text 1.2 wider (a root itself), the frame's start moves with it
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0.0']);
});

test('verifyScreen: a parent that grows and drags an end-aligned child is the root (no circular excuse)', () => {
  const inp = fixture();
  inp.spec.kids[0].sz = ['FIXED', 'HUG']; // a FIXED-width card: its far edge can drag an end-aligned child
  inp.spec.kids[0].kids[1].abs = { x: 60, y: 10, c: 'R' }; // R35: the icon is pinned to the right in the spec
  shift(inp, 'n.0', [0, 0, 3, 0]);
  shift(inp, 'n.0.1', [3, 0, 0, 0]); // end-aligned icon follows the parent's far edge
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0']);
});

test('R29: in a HUG row the icon moving 3px is the root; the row only hugs it (no cycle through the far edge)', () => {
  const inp = fixture(); // n.0 HUG x HUG
  shift(inp, 'n.0', [0, 0, 3, 0]);
  shift(inp, 'n.0.1', [3, 0, 0, 0]);
  assert.deepEqual(rootIds(verifyScreen(inp)), ['n.0.1']);
});

// ---- reviewer probes (fix round 1) ----
const flat = (kids) => ({ id: 'n', kind: 'frame', rA: [0, 0, 400, 100], rB: [0, 0, 400, 100], kids });
// R55: a hand-built text gets a spec font family, rendered as such in the DOM (its font is then checked, not unchecked)
const withFonts = (spec, dom, tree) => {
  const sv = (n) => { if (n.t === 'T' && !(n.font && n.font.ff)) n.font = { ...(n.font || {}), ff: 'Inter' }; (n.kids || []).forEach(sv); }; sv(spec);
  const tv = (n) => { if (n.kind === 'text' && dom[n.id]) dom[n.id].ff ??= '"Inter"'; (n.kids || []).forEach(tv); }; tv(tree);
};
function probe(tree, mut, flags = [], spec = { id: 'n', t: 'F', kids: [] }, opts = {}) {
  const boxes = () => { const o = {}; const v = (n) => { o[n.id] = [...n.rA]; (n.kids || []).forEach(v); }; v(tree); return o; };
  const dom = {}; const v = (n) => { dom[n.id] = { color: 'rgb(0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', ...SHOWN(), ...(n.kind === 'icon' ? { icon: 'svg' } : {}) }; (n.kids || []).forEach(v); }; v(tree);
  const proxy = { A: { boxes: boxes(), fontsMissing: [], facesMissing: [], dom, model: 'figma' }, B: { boxes: boxes(), fontsMissing: [], facesMissing: [], dom, model: 'figma' } };
  const layout = { A: { boxes: boxes(), model: 'none' }, B: { boxes: boxes(), model: 'none' } };
  mut(proxy, layout); withFonts(spec, dom, tree);
  return verifyScreen({ screen: { id: 's', tree }, spec, proxy, layout, flags, crops: [] }, opts);
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
  shift(inp, 'n.0', [0, 0, 0, -3]); shift(inp, 'n.1', [0, -3, 0, 0]); // the next sibling follows (R28 adjacency)
  shift(inp, 'n.0.0', [0, 0, 0, -3]);
  shift(inp, 'n.0.1', [0, 0, 0, -3]);
  inp.flags = [{ id: 'n.0', kind: 'shrink', detail: 'x' }];
  // R17: the card hugs its height, so its -3px comes from its children: no excuse for them
  let r = verifyScreen(inp);
  assert.deepEqual(unexplained(r).map((x) => x.id).sort(), ['n.0.0', 'n.0.0', 'n.0.1', 'n.0.1'], JSON.stringify(r.roots));
  // a FIXED-height card squeezed 3px in its column deviates for its own reason: its flag explains it. R22: in its
  // subtree the flag explains a size only through a FILL chain on that axis: the FILL-height text follows the card
  // (no root), while a squeeze cannot change the FIXED icon's height, so that stays an unexplained root
  inp.spec.kids[0].sz = ['HUG', 'FIXED'];
  inp.spec.kids[0].kids[0].sz = ['HUG', 'FILL'];
  r = verifyScreen(inp);
  assert.ok(r.roots.some((x) => x.id === 'n.0' && x.explainedBy === 'shrink'), JSON.stringify(r.roots));
  assert.ok(!rootIds(r).includes('n.0.0'), JSON.stringify(r.roots));
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.1', 'n.0.1'], JSON.stringify(r.roots));
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
    [{ id: 'n.0', kind: 'shrink' }], { id: 'n', t: 'F', lay: { d: 'V' }, kids: [{ id: 'n.0', t: 'F' }, { id: 'n.1', t: 'F' }] });
  assert.deepEqual(unexplained(r), [], JSON.stringify(r.roots));
  assert.deepEqual(r.needsApproval.map((m) => [m.id, m.width, m.magnitude]).sort(), [['n.1', 'A', 40], ['n.1', 'B', 40]]);
  assert.deepEqual(r.needsApproval[0].delta, [0, 40, 0, 0], 'delta = modelled delta minus layout delta');
  assert.equal(r.pass, false);
});

// ---- reviewer probes (fix round 3) ----
const F = (id, sz, kids) => ({ id, t: 'F', sz, ...(kids ? { kids } : {}) });

test('probe (R19): a HUG row 1.5px wider whose children moved only within tolerance is a root', () => {
  const row = { id: 'n.r', kind: 'frame', rA: [0, 0, 100, 40], rB: [0, 0, 100, 40], kids: [
    { id: 'n.r.0', kind: 'frame', rA: [10, 10, 30, 20], rB: [10, 10, 30, 20] }, { id: 'n.r.1', kind: 'frame', rA: [60, 10, 30, 20], rB: [60, 10, 30, 20] }] };
  const spec = F('n', ['FIXED', 'FIXED'], [F('n.r', ['HUG', 'HUG'], [F('n.r.0', ['FIXED', 'FIXED']), F('n.r.1', ['FIXED', 'FIXED'])])]);
  const r = probe(flat([row]), both((b) => { b['n.r.0'][0] -= 0.5; b['n.r.1'][0] += 0.5; b['n.r'][2] += 1.5; }), [], spec);
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.r', 'n.r'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('probe (R19): four nested HUG frames each 0.5px wider around an exact leaf (outer 2px) are not a silent pass', () => {
  const ids = ['n.a', 'n.a.b', 'n.a.b.c', 'n.a.b.c.d'];
  let node = { id: 'n.a.b.c.d.0', kind: 'frame', rA: [50, 10, 20, 20], rB: [50, 10, 20, 20] }, sp = F(node.id, ['FIXED', 'FIXED']);
  for (const id of ids.slice().reverse()) { node = { id, kind: 'frame', rA: [0, 0, 120, 40], rB: [0, 0, 120, 40], kids: [node] }; sp = F(id, ['HUG', 'FIXED'], [sp]); }
  const r = probe(flat([node]), both((b) => ids.slice().reverse().forEach((id, i) => { b[id][2] += 0.5 * (i + 1); })), [], F('n', ['FIXED', 'FIXED'], [sp]));
  assert.ok(unexplained(r).some((x) => x.id === 'n.a.b.c'), JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('probe (R17 amended): a card only pushed by an explained sibling does not excuse its child with its flag', () => {
  const a = { id: 'n.0', kind: 'frame', rA: [0, 0, 100, 40], rB: [0, 0, 100, 40] };
  const c = { id: 'n.1', kind: 'frame', rA: [0, 40, 100, 60], rB: [0, 40, 100, 60], kids: [{ id: 'n.1.0', kind: 'frame', rA: [10, 50, 40, 20], rB: [10, 50, 40, 20] }] };
  const spec = { ...F('n', ['FIXED', 'FIXED'], [F('n.0', ['FIXED', 'FIXED']), F('n.1', ['FIXED', 'FIXED'], [F('n.1.0', ['FIXED', 'FIXED'])])]), lay: { d: 'V' } };
  const r = probe(flat([a, c]), both((b) => { b['n.0'][3] += 10; b['n.1'][1] += 10; b['n.1.0'][1] += 10; b['n.1.0'][2] += 8; }),
    [{ id: 'n.0', kind: 'shrink' }, { id: 'n.1', kind: 'weightedFill' }], spec);
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.1.0', 'n.1.0'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('probe (R17 amended): a FILL child growing with its flagged parent does not excuse a grandchild with its flag', () => {
  const g = { id: 'n.0', kind: 'frame', rA: [0, 0, 200, 60], rB: [0, 0, 200, 60], kids: [{ id: 'n.0.0', kind: 'frame', rA: [0, 0, 200, 60], rB: [0, 0, 200, 60], kids: [
    { id: 'n.0.0.0', kind: 'frame', rA: [10, 10, 40, 20], rB: [10, 10, 40, 20] }] }] };
  const spec = F('n', ['FIXED', 'FIXED'], [F('n.0', ['FIXED', 'FIXED'], [F('n.0.0', ['FILL', 'FIXED'], [F('n.0.0.0', ['FIXED', 'FIXED'])])])]);
  const mut = both((b) => { b['n.0'][2] += 10; b['n.0.0'][2] += 10; b['n.0.0.0'][3] += 6; });
  let r = probe(flat([g]), mut, [{ id: 'n.0.0', kind: 'weightedFill' }], spec);
  assert.deepEqual(unexplained(r).map((x) => x.id).sort(), ['n.0', 'n.0', 'n.0.0.0', 'n.0.0.0'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
  // the parent's flag is not the excuse; a flagged root grandparent still explains it (R17 as amended)
  r = probe(flat([g]), mut, [{ id: 'n.0', kind: 'shrink' }, { id: 'n.0.0', kind: 'weightedFill' }], spec);
  assert.ok(!r.roots.some((x) => x.explainedBy === 'weightedFill'), JSON.stringify(r.roots));
});

// ---- R20: a flag explains only deviations it can cause ----
const Fd = (id, sz, d, kids) => ({ ...F(id, sz, kids), lay: { d } });
const row3 = () => flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [0, 1, 2].map((i) =>
  ({ id: `n.0.${i}`, kind: 'frame', rA: [30 + i * 100, 10, 40, 20], rB: [30 + i * 100, 10, 40, 20] })) }]);
const row3Spec = (sz = ['FIXED', 'FIXED']) => Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [0, 1, 2].map((i) => F(`n.0.${i}`, sz)))]);

test('R20/R23: spaceAround explains the computed main-axis offsets of its children (row 36px wider at B)', () => {
  // A exact (infer: padding 30 + space-between). B: free space +36; source space-around 36 | 148 | 260, proxy
  // 30 | 148 | 266: the children move -6 / 0 / +6 exactly as computed
  const tree = row3(); tree.kids[0].rB = [0, 0, 336, 40]; [36, 148, 260].forEach((x, i) => { tree.kids[0].kids[i].rB = [x, 10, 40, 20]; });
  const spec = row3Spec(); spec.kids[0].lay = { d: 'H', p: [0, 30, 0, 30], sb: 1 };
  const r = probeAB(tree, (P, L) => { for (const X of [P, L]) { X.B.boxes['n.0.0'][0] -= 6; X.B.boxes['n.0.2'][0] += 6; } }, [{ id: 'n.0', kind: 'spaceAround' }], spec);
  assert.deepEqual(rootIds(r).sort(), ['n.0.0', 'n.0.2']);
  assert.ok(r.roots.every((x) => x.explainedBy === 'spaceAround'), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
});

test('R20: spaceAround never explains a child size or cross-axis offset', () => {
  const r = probe(row3(), both((b) => { b['n.0.1'][2] += 4; b['n.0.0'][1] += 3; }), [{ id: 'n.0', kind: 'spaceAround' }], row3Spec());
  assert.deepEqual(unexplained(r).map((x) => x.id).sort(), ['n.0.0', 'n.0.0', 'n.0.1', 'n.0.1'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R20: weightedFill explains FILL siblings only when the container main size is ok or explained', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 200, 40], rB: [0, 0, 200, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 120, 40], rB: [0, 0, 120, 40] }, { id: 'n.0.1', kind: 'frame', rA: [120, 0, 80, 40], rB: [120, 0, 80, 40] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FILL', 'FILL']), F('n.0.1', ['FILL', 'FILL'])])]);
  const flags = [{ id: 'n.0.0', kind: 'weightedFill' }, { id: 'n.0.1', kind: 'weightedFill' }];
  // container exact: the FILL split differs (weights), explained
  let r = probe(tree, both((b) => { b['n.0.0'][2] += 10; b['n.0.1'][0] += 10; b['n.0.1'][2] -= 10; }), flags, spec);
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === 'weightedFill'), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
  // container 30px wider, unexplained: the FILL split is no excuse
  r = probe(tree, both((b) => { b['n.0'][2] += 30; b['n.0.0'][2] += 40; b['n.0.1'][0] += 40; b['n.0.1'][2] -= 10; }), flags, spec);
  assert.ok(unexplained(r).some((x) => x.id === 'n.0'), JSON.stringify(r.roots));
  assert.ok(unexplained(r).some((x) => x.id === 'n.0.0'), JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R20: shrink on an item drives width to height (wrap) but never height to width in its descendants', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 200, 80], rB: [0, 0, 200, 80], kids: [{ id: 'n.0.0', kind: 'frame', rA: [10, 10, 100, 40], rB: [10, 10, 100, 40], kids: [
    { id: 'n.0.0.0', kind: 'frame', rA: [20, 20, 40, 20], rB: [20, 20, 40, 20] }] }] }]);
  const spec = (d) => Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], d, [Fd('n.0.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0.0', ['FIXED', 'FIXED'])])])]);
  const flags = [{ id: 'n.0.0', kind: 'shrink' }];
  // squeezed 10px in height in a column; the grandchild 6px wider: not caused by it
  let r = probe(tree, both((b) => { b['n.0.0'][3] -= 10; b['n.0.0.0'][2] += 6; }), flags, spec('V'));
  assert.ok(r.roots.some((x) => x.id === 'n.0.0' && x.explainedBy === 'shrink'), JSON.stringify(r.roots));
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.0.0', 'n.0.0.0'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
  // squeezed 10px in width in a row; a wrapping text inside (FILL width, HUG height) 6px taller: explained (R22)
  const tt = structuredClone(tree); tt.kids[0].kids[0].kids[0].kind = 'text';
  const ts = spec('H'); Object.assign(ts.kids[0].kids[0].kids[0], { t: 'T', sz: ['FILL', 'HUG'] });
  r = probe(tt, both((b) => { b['n.0.0'][2] -= 10; b['n.0.0.0'][2] -= 10; b['n.0.0.0'][3] += 6; }), flags, ts);
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === 'shrink'), JSON.stringify(r.roots));
  // ... but a FIXED frame there cannot wrap: its 6px are not the shrink's (R22)
  r = probe(tree, both((b) => { b['n.0.0'][2] -= 10; b['n.0.0.0'][3] += 6; }), flags, spec('H'));
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.0.0', 'n.0.0.0'], JSON.stringify(r.roots));
  // a cross-axis size change of the item itself is not the shrink's
  r = probe(tree, both((b) => { b['n.0.0'][2] -= 10; }), flags, spec('V'));
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.0', 'n.0.0'], JSON.stringify(r.roots));
});

// ---- fix round 6 (R22-R27) ----
// boxes from rA at A and rB at B (probe() uses rA at both widths)
function probeAB(tree, mut, flags = [], spec = { id: 'n', t: 'F', kids: [] }) {
  const boxes = (M) => { const o = {}; const v = (n) => { o[n.id] = [...(M === 'A' ? n.rA : n.rB)]; (n.kids || []).forEach(v); }; v(tree); return o; };
  const dom = {}; const v = (n) => { dom[n.id] = { color: 'rgb(0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', ...SHOWN() }; (n.kids || []).forEach(v); }; v(tree);
  const proxy = { A: { boxes: boxes('A'), fontsMissing: [], facesMissing: [], dom, model: 'figma' }, B: { boxes: boxes('B'), fontsMissing: [], facesMissing: [], dom, model: 'figma' } };
  const layout = { A: { boxes: boxes('A'), model: 'none' }, B: { boxes: boxes('B'), model: 'none' } };
  mut(proxy, layout); withFonts(spec, dom, tree);
  return verifyScreen({ screen: { id: 's', tree }, spec, proxy, layout, flags, crops: [] });
}
// n.0 (FIXED row 200) > n.0.0 (FILL, row, holds a FIXED 40x20 frame), n.0.1 (FILL); both FILL items flagged weightedFill
const wfTree = () => flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 200, 60], rB: [0, 0, 200, 60], kids: [
  { id: 'n.0.0', kind: 'frame', rA: [0, 0, 120, 60], rB: [0, 0, 120, 60], kids: [{ id: 'n.0.0.0', kind: 'frame', rA: [10, 10, 40, 20], rB: [10, 10, 40, 20] }] },
  { id: 'n.0.1', kind: 'frame', rA: [120, 0, 80, 60], rB: [120, 0, 80, 60] }] }]);
const wfSpec = () => Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [
  Fd('n.0.0', ['FILL', 'FILL'], 'H', [F('n.0.0.0', ['FIXED', 'FIXED'])]), F('n.0.1', ['FILL', 'FILL'])])]);
const wfFlags = [{ id: 'n.0.0', kind: 'weightedFill' }, { id: 'n.0.1', kind: 'weightedFill' }];
const wfSplit = (b) => { b['n.0.0'][2] += 10; b['n.0.1'][0] += 10; b['n.0.1'][2] -= 10; };

test('R22: an explained weightedFill item does not excuse a FIXED descendant (size, wrap height or position)', () => {
  for (const [what, d] of [['w+6', [0, 0, 6, 0]], ['h+6', [0, 0, 0, 6]], ['x+30', [30, 0, 0, 0]]]) {
    const r = probe(wfTree(), both((b) => { wfSplit(b); for (let i = 0; i < 4; i++) b['n.0.0.0'][i] += d[i]; }), wfFlags, wfSpec());
    assert.ok(r.roots.some((x) => x.id === 'n.0.0' && x.explainedBy === 'weightedFill'), `${what}: ${JSON.stringify(r.roots)}`);
    assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.0.0', 'n.0.0.0'], `${what}: ${JSON.stringify(r.roots)}`);
    assert.equal(r.pass, false, what);
  }
});

test('R22 (M1): an ancestor shrink explains nothing below it unless the ancestor is a root on the shrink axis', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 200, 60], rB: [0, 0, 200, 60], kids: [{ id: 'n.0.0', kind: 'frame', rA: [10, 10, 40, 20], rB: [10, 10, 40, 20] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'H', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FILL', 'FIXED'])])]);
  // n.0 is off only on y (explained by its own raster flag); its FILL child 6px wider is not the shrink's (width exact)
  const r = probe(tree, both((b) => { b['n.0'][1] += 5; b['n.0.0'][1] += 5; b['n.0.0'][2] += 6; }), [{ id: 'n.0', kind: 'shrink' }, { id: 'n.0', kind: 'raster' }], spec);
  assert.ok(r.roots.some((x) => x.id === 'n.0' && x.explainedBy === 'raster'), JSON.stringify(r.roots));
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.0', 'n.0.0'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R22: shrink in a row explains a wrapping text through a HUG frame, not through a FIXED-width one', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 100], rB: [0, 0, 300, 100], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 200, 60], rB: [0, 0, 200, 60], kids: [
      { id: 'n.0.0.0', kind: 'frame', rA: [10, 10, 180, 20], rB: [10, 10, 180, 20], kids: [{ id: 'n.0.0.0.0', kind: 'text', rA: [10, 10, 180, 20], rB: [10, 10, 180, 20] }] }] }] }]);
  const spec = (innerW) => Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [Fd('n.0.0', ['FIXED', 'FIXED'], 'V', [
    Fd('n.0.0.0', [innerW, 'HUG'], 'V', [{ id: 'n.0.0.0.0', t: 'T', sz: ['FILL', 'HUG'] }])])])]);
  // the item is squeezed 20px; the inner HUG-height frame and its text get 20px narrower and wrap one more line
  const mut = both((b) => { b['n.0.0'][2] -= 20; for (const id of ['n.0.0.0', 'n.0.0.0.0']) { b[id][2] -= 20; b[id][3] += 20; } });
  let r = probe(tree, mut, [{ id: 'n.0.0', kind: 'shrink' }], spec('FILL'));
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === 'shrink'), JSON.stringify(r.roots));
  assert.ok(rootIds(r).includes('n.0.0.0.0'), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
  // the inner frame FIXED in width cannot pass the squeeze on: no excuse for the text
  r = probe(tree, mut, [{ id: 'n.0.0', kind: 'shrink' }], spec('FIXED'));
  assert.ok(unexplained(r).some((x) => x.id === 'n.0.0.0.0'), JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R23: spaceAround does not excuse an offset that is not the computed space-around difference', () => {
  // middle child 50px off where infer reproduced the spacing exactly (expected difference 0)
  const spec = row3Spec(); spec.kids[0].lay = { d: 'H', p: [0, 30, 0, 30], sb: 1 };
  let r = probe(row3(), both((b) => { b['n.0.1'][0] += 50; }), [{ id: 'n.0', kind: 'spaceAround' }], spec);
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.1', 'n.0.1'], JSON.stringify(r.roots));
  // all children 20px further (a padding error)
  r = probe(row3(), both((b) => { for (const i of [0, 1, 2]) b[`n.0.${i}`][0] += 20; }), [{ id: 'n.0', kind: 'spaceAround' }], spec);
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R23: a correct space-around row widened at B is explained; 5px beyond the computed offset is not', () => {
  // A: 300 wide, 3x40 children, space-around: free 180 -> 30 | 130 | 230 (infer: padding 30 + space-between, exact)
  // B: 420 wide: free 300 -> 50 | 190 | 330; the proxy (padding 30, space-between) gives 30 | 190 | 350 (-20, 0, +20)
  const xs = { A: [30, 130, 230], B: [50, 190, 330] };
  const tree = { id: 'n', kind: 'frame', rA: [0, 0, 300, 100], rB: [0, 0, 420, 100], kids: [{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 420, 40],
    kids: [0, 1, 2].map((i) => ({ id: `n.0.${i}`, kind: 'frame', rA: [xs.A[i], 10, 40, 20], rB: [xs.B[i], 10, 40, 20] })) }] };
  const spec = Fd('n', ['FILL', 'FIXED'], 'V', [{ ...F('n.0', ['FILL', 'FIXED'], [0, 1, 2].map((i) => F(`n.0.${i}`, ['FIXED', 'FIXED']))), lay: { d: 'H', p: [0, 30, 0, 30], sb: 1 } }]);
  const flags = [{ id: 'n.0', kind: 'spaceAround' }];
  const atB = (dx) => (P, L) => { for (const X of [P, L]) { X.B.boxes['n.0.0'][0] += -20 + dx; X.B.boxes['n.0.2'][0] += 20 + dx; } };
  let r = probeAB(tree, atB(0), flags, spec);
  assert.deepEqual(rootIds(r).sort(), ['n.0.0', 'n.0.2'], JSON.stringify(r.roots));
  assert.ok(r.roots.every((x) => x.width === 'B' && x.explainedBy === 'spaceAround'), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
  r = probeAB(tree, atB(5), flags, spec);
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R24: weightedFill does not excuse a gap error absorbed by FILL items, nor a position-only move', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 210, 40], rB: [0, 0, 210, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 120, 40], rB: [0, 0, 120, 40] }, { id: 'n.0.1', kind: 'frame', rA: [130, 0, 80, 40], rB: [130, 0, 80, 40] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FILL', 'FILL']), F('n.0.1', ['FILL', 'FILL'])])]);
  // gap 30 instead of 10: each FILL item 10px narrower (sizes not conserved)
  let r = probe(tree, both((b) => { b['n.0.0'][2] -= 10; b['n.0.1'][0] += 10; b['n.0.1'][2] -= 10; }), wfFlags, spec);
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
  assert.equal(r.pass, false);
  // the second item 40px further, sizes unchanged
  r = probe(tree, both((b) => { b['n.0.1'][0] += 40; }), wfFlags, spec);
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.1', 'n.0.1'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
  // a different split that conserves the container's width stays explained
  r = probe(wfTree(), both(wfSplit), wfFlags, wfSpec());
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === 'weightedFill'), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
});

test('R25: a child counts as unchanged per axis in a HUG extent (its height deviation does not unlock width drift)', () => {
  const ids = ['n.a', 'n.a.b', 'n.a.b.c', 'n.a.b.c.d'];
  let node = { id: 'n.a.b.c.d.0', kind: 'frame', rA: [50, 10, 20, 20], rB: [50, 10, 20, 20] }, sp = F(node.id, ['FIXED', 'FIXED']);
  for (const id of ids.slice().reverse()) { node = { id, kind: 'frame', rA: [0, 0, 120, 40], rB: [0, 0, 120, 40], kids: [node] }; sp = F(id, ['HUG', 'HUG'], [sp]); }
  // leaf 5px taller (its own raster flag explains it); each HUG level 0.5px wider than its child (outer 2px)
  const mut = both((b) => { b['n.a.b.c.d.0'][3] += 5; ids.slice().reverse().forEach((id, i) => { b[id][2] += 0.5 * (i + 1); b[id][3] += 5; }); });
  const r = probe(flat([node]), mut, [{ id: 'n.a.b.c.d.0', kind: 'raster' }], F('n', ['FIXED', 'FIXED'], [sp]));
  assert.ok(unexplained(r).some((x) => x.id === 'n.a.b.c' && x.why.includes('w')), JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R27/R28: verifyScreen refuses a modelled layout proxy, an unmodelled model proxy and a missing mark', () => {
  let inp = fixture(); inp.layout.A.model = 'figma';
  assert.throws(() => verifyScreen(inp), /layout proxy.*modelled/i);
  inp = fixture(); inp.proxy.B.model = 'none';
  assert.throws(() => verifyScreen(inp), /model proxy.*not modelled/i);
  inp = fixture(); delete inp.layout.B.model;
  assert.throws(() => verifyScreen(inp), /layout proxy at B/i);
  inp = fixture(); delete inp.proxy.A.model;
  assert.throws(() => verifyScreen(inp), /model proxy at A/i);
  assert.equal(verifyScreen(fixture()).pass, true);
});

// ---- fix round 7 (R28) ----
test('R28: shrink never excuses a HUG frame whose own height is off (only a wrapping text)', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 100], rB: [0, 0, 300, 100], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 200, 60], rB: [0, 0, 200, 60], kids: [
      { id: 'n.0.0.0', kind: 'frame', rA: [10, 10, 180, 30], rB: [10, 10, 180, 30], kids: [{ id: 'n.0.0.0.0', kind: 'text', rA: [10, 10, 180, 20], rB: [10, 10, 180, 20] }] }] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [Fd('n.0.0', ['FIXED', 'FIXED'], 'V', [
    Fd('n.0.0.0', ['FILL', 'HUG'], 'V', [{ id: 'n.0.0.0.0', t: 'T', sz: ['FILL', 'HUG'] }])])])]);
  // squeezed 10px: the text only gets narrower, but its HUG frame is 10px taller (a padding error)
  const r = probe(tree, both((b) => { b['n.0.0'][2] -= 10; b['n.0.0.0'][2] -= 10; b['n.0.0.0.0'][2] -= 10; b['n.0.0.0'][3] += 10; }), [{ id: 'n.0.0', kind: 'shrink' }], spec);
  assert.deepEqual(unexplained(r).map((x) => x.id), ['n.0.0.0', 'n.0.0.0'], JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R28: a FILL item absorbs exactly its share of its siblings\' size change; a flagged size change keeps the next item adjacent', () => {
  // row 300: FIXED 100 (shrink, 10px narrower in the proxy) | gap 10 | FILL 190
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 100, 40], rB: [0, 0, 100, 40] }, { id: 'n.0.1', kind: 'frame', rA: [110, 0, 190, 40], rB: [110, 0, 190, 40] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FIXED', 'FIXED']), F('n.0.1', ['FILL', 'FILL'])])]);
  const m = (g) => both((b) => { b['n.0.0'][2] -= 10; b['n.0.1'][0] += -10 + g; b['n.0.1'][2] += 10 - g; });
  const flags = [{ id: 'n.0.0', kind: 'shrink' }];
  let r = probe(tree, m(0), flags, spec); // legit: the FILL item takes the 10px
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy === 'shrink'), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
  for (const g of [5, 10]) { // gap 5 / 10 larger as well
    r = probe(tree, m(g), flags, spec);
    assert.ok(unexplained(r).some((x) => x.id === 'n.0.1'), `gap +${g}: ${JSON.stringify(r.roots)}`);
    assert.equal(r.pass, false, `gap +${g}`);
  }
  // two FILL items share a FIXED sibling's +10 equally (-5 each): no root on them
  const t3 = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 60, 40], rB: [0, 0, 60, 40] }, { id: 'n.0.1', kind: 'frame', rA: [60, 0, 120, 40], rB: [60, 0, 120, 40] }, { id: 'n.0.2', kind: 'frame', rA: [180, 0, 120, 40], rB: [180, 0, 120, 40] }] }]);
  const s3 = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FIXED', 'FIXED']), F('n.0.1', ['FILL', 'FILL']), F('n.0.2', ['FILL', 'FILL'])])]);
  r = probe(t3, both((b) => { b['n.0.0'][2] += 10; b['n.0.1'][0] += 10; b['n.0.1'][2] -= 5; b['n.0.2'][0] += 5; b['n.0.2'][2] -= 5; }), [{ id: 'n.0.0', kind: 'shrink' }], s3);
  assert.deepEqual(rootIds(r), ['n.0.0'], JSON.stringify(r.roots));
});

test('R28: weightedFill with a gap error hidden by a padding error is not excused (adjacency)', () => {
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 210, 40], rB: [0, 0, 210, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [0, 0, 120, 40], rB: [0, 0, 120, 40] }, { id: 'n.0.1', kind: 'frame', rA: [130, 0, 80, 40], rB: [130, 0, 80, 40] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FILL', 'FILL']), F('n.0.1', ['FILL', 'FILL'])])]);
  const r = probe(tree, both((b) => { b['n.0.0'][2] += 10; b['n.0.1'][0] += 20; b['n.0.1'][2] -= 10; }), wfFlags, spec);
  assert.ok(unexplained(r).some((x) => x.id === 'n.0.1'), JSON.stringify(r.roots));
  assert.equal(r.pass, false);
});

test('R28: a shrunk item in an overflowing row pushes its FIXED followers along: explained', () => {
  const kids = [0, 1, 2].map((i) => ({ id: `n.0.${i}`, kind: 'frame', rA: [i * 110, 0, 100, 40], rB: [i * 110, 0, 100, 40] }));
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [Fd('n.0', ['FIXED', 'FIXED'], 'H', [0, 1, 2].map((i) => F(`n.0.${i}`, ['FIXED', 'FIXED'])))]);
  const r = probe(tree, both((b) => { b['n.0.0'][2] -= 10; b['n.0.1'][0] -= 10; b['n.0.2'][0] -= 10; }), [{ id: 'n.0.0', kind: 'shrink' }], spec);
  assert.deepEqual(rootIds(r), ['n.0.0'], JSON.stringify(r.roots));
  assert.equal(r.pass, true);
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
  shift(inp, 'n.0', [0, 0, 0, -3]); // squeezed on the main axis of its column (R20)
  shift(inp, 'n.1', [0, -3, 0, 0]); // the next sibling follows (R28 adjacency)
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
  // R44: the crop on that size root is attached to the unexplained root, not explained
  assert.deepEqual(r.cropLinked.map((c) => c.root), ['n.0.0']);
  assert.equal(r.cropExplained.length, 0);
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
    // R21: the layout proxy renders the inferred spec unmodelled (no figmaTextBox), the proxy the modelled one
    assert.equal(inf.spec.model, undefined); assert.equal(mod.spec.model, 'figma');
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

// ---- Task 7 fix round (R29-R31) ----
// a HUG column n.c (spec FIXED x, HUG y) of `n` FIXED items of height h, gap g, in a FIXED root
function hugColumn(n, h = 16, g = 4) {
  const kids = Array.from({ length: n }, (_, i) => ({ id: `n.c.${i}`, kind: 'frame', rA: [0, i * (h + g), 200, h], rB: [0, i * (h + g), 200, h] }));
  const tree = flat([{ id: 'n.c', kind: 'frame', rA: [0, 0, 200, n * h + (n - 1) * g], rB: [0, 0, 200, n * h + (n - 1) * g], kids }]);
  const spec = { id: 'n', t: 'F', sz: ['FIXED', 'FIXED'], lay: { d: 'V' }, kids: [
    { id: 'n.c', t: 'F', sz: ['FIXED', 'HUG'], lay: { d: 'V', g }, kids: kids.map((k) => ({ id: k.id, t: 'F', sz: ['FIXED', 'FIXED'] })) }] };
  return { tree, spec };
}

test('R29: gap 4 -> 7 in a HUG column of three is a root (the column\'s middle / far edge is no reference for its items)', () => {
  const { tree, spec } = hugColumn(3);
  const r = probe(tree, both((b) => { b['n.c'][3] += 6; b['n.c.1'][1] += 3; b['n.c.2'][1] += 6; }), [], spec);
  assert.equal(r.pass, false);
  assert.ok(unexplained(r).some((x) => x.id === 'n.c.1' && x.why.includes('y')), JSON.stringify(r.roots));
});

test('R29: five HUG rows each 0.4px taller in a HUG card (card 2px taller) is a root', () => {
  const { tree, spec } = hugColumn(5, 36, 0);
  spec.kids[0].kids.forEach((k) => { k.sz = ['FIXED', 'HUG']; k.lay = { d: 'H' }; });
  const r = probe(tree, both((b) => { b['n.c'][3] += 2; for (let i = 0; i < 5; i++) { b[`n.c.${i}`][1] += 0.4 * i; b[`n.c.${i}`][3] += 0.4; } }), [], spec);
  assert.equal(r.pass, false);
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
});

test('R29: an end-aligned item of a FIXED column still follows the column\'s far edge', () => {
  const { tree, spec } = hugColumn(2);
  spec.kids[0].sz = ['FIXED', 'FIXED'];
  spec.kids[0].kids[1].abs = { x: 0, y: 20, cy: 'B' }; // R35: pinned to the bottom in the spec
  const r = probe(tree, both((b) => { b['n.c'][3] += 6; b['n.c.1'][1] += 6; }), [], spec);
  assert.deepEqual(rootIds(r), ['n.c'], JSON.stringify(r.roots));
});

test('R30: a source stroke the proxy did not draw, or drew differently, is a stroke mismatch (per side and outline)', () => {
  const inp = fixture();
  const solid = { w: 1, style: 'solid', color: 'rgb(0, 0, 0)' }, none = { w: 0, style: 'none', color: 'rgb(0, 0, 0)' };
  inp.screen.tree.kids[1].paint = { border: [none, none, solid, none] };
  const d = (s) => { for (const P of [inp.proxy.A, inp.proxy.B]) P.dom['n.1'] = { ...P.dom['n.1'], stroke: s }; };
  d(['none', 'none', '1px solid rgb(0, 0, 0)', 'none']);
  assert.deepEqual(verifyScreen(inp).data, []);
  d(['none', 'none', 'none', 'none']);
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind, x.side]), [['n.1', 'stroke', 'bottom']]);
  d(['none', 'none', '1px solid rgb(255, 0, 0)', 'none']);
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind, x.side]), [['n.1', 'stroke', 'bottom']]);
  // a stroke the source does not have
  d(['none', 'none', '1px solid rgb(0, 0, 0)', '1px solid rgb(0, 0, 0)']);
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind, x.side]), [['n.1', 'stroke', 'left']]);
  d(['none', 'none', '1px solid rgb(0, 0, 0)', 'none']);
  inp.screen.tree.kids[1].paint.outline = '2px solid rgb(0, 0, 255)';
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind, x.side]), [['n.1', 'stroke', 'outline']]);
});

test('R31: effective opacity, visibility and display of the proxy DOM are compared with the source (visibility)', () => {
  const inp = fixture();
  assert.deepEqual(verifyScreen(inp).data, []);
  inp.proxy.A.dom['n.0.1'] = { ...inp.proxy.A.dom['n.0.1'], op: 0 };
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind]), [['n.0.1', 'visibility']]);
  inp.proxy.A.dom['n.0.1'] = { ...inp.proxy.A.dom['n.0.1'], op: 1, vis: 'hidden' };
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind]), [['n.0.1', 'visibility']]);
  // effective opacity is the product over ancestors: a source card at 0.5 makes its children 0.5
  inp.proxy.A.dom['n.0.1'] = { ...inp.proxy.A.dom['n.0.1'], vis: 'visible', op: 0.5 };
  inp.proxy.A.dom['n.0'] = { ...inp.proxy.A.dom['n.0'], op: 0.5 }; inp.proxy.A.dom['n.0.0'] = { ...inp.proxy.A.dom['n.0.0'], op: 0.5 };
  inp.screen.tree.kids[0].paint = { ...inp.screen.tree.kids[0].paint, opacity: 0.5 };
  assert.deepEqual(verifyScreen(inp).data, []);
  // a proxy DOM without these observations is never a silent pass
  delete inp.proxy.A.dom['n.1'].op;
  assert.ok(verifyScreen(inp).skipped.includes('visibility'));
});

test('R30b/R31: a 1px line on the edge of a text box and a removed solid box fail their own crop', { skip }, async () => {
  const txt = '<div style="position:absolute;left:20px;top:40px;width:42px;height:18px;font:12px/18px sans-serif">Th 2</div>';
  const line = '<div style="position:absolute;left:20px;top:57px;width:42px;height:1px;background:#000"></div>';
  const R = [20, 40, 42, 18];
  const d = await cropDiffDetail(browser, await shot(txt), R, await shot(txt + line), R);
  assert.ok(fails(d), `bottom edge line: ${JSON.stringify(d)}`);
  const bar = (extra = '') => `<div style="position:absolute;left:20px;top:20px;width:51px;height:4px;background:#3d7a60${extra}"></div>`;
  const e = await cropDiffDetail(browser, await shot(bar()), [20, 20, 51, 4], await shot(bar(';box-shadow:inset 0 -1px 0 0 #fff')), [20, 20, 51, 4]);
  assert.ok(fails(e), `white bottom stroke on a 4px bar: ${JSON.stringify(e)}`);
  const box = '<div style="position:absolute;left:20px;top:20px;width:40px;height:20px;background:#333"></div>';
  const g = await cropDiffDetail(browser, await shot(box), [20, 20, 40, 20], await shot(''), [20, 20, 40, 20]);
  assert.ok(fails(g), `removed solid box: ${JSON.stringify(g)}`);
});

// ---- Task 7 fix round 2 (R32, R33) ----
// n.m: an end-anchored HUG row (lay H, gap 4) of nine FIXED 8x8 dots whose right edge sits at x 300 (planora `.mini`)
function miniRow() {
  const kids = Array.from({ length: 9 }, (_, i) => ({ id: `n.m.${i}`, kind: 'frame', rA: [196 + i * 12, 4, 8, 8], rB: [196 + i * 12, 4, 8, 8] }));
  const tree = { id: 'n', kind: 'frame', rA: [0, 0, 300, 20], rB: [0, 0, 300, 20], kids: [{ id: 'n.m', kind: 'frame', rA: [196, 4, 104, 8], rB: [196, 4, 104, 8], kids }] };
  const spec = { ...Fd('n', ['FIXED', 'FIXED'], 'H', [Fd('n.m', ['HUG', 'HUG'], 'H', kids.map((k) => F(k.id, ['FIXED', 'FIXED'])))]), lay: { d: 'H', pa: 'E' } };
  return { tree, spec };
}

test('R32: drift in an end-anchored HUG row (nine dots each 0.4 wider, row x -3.6) is a layout root', () => {
  const { tree, spec } = miniRow();
  const r = probe(tree, both((b) => {
    b['n.m'][0] -= 3.6; b['n.m'][2] += 3.6;
    for (let i = 0; i < 9; i++) { b[`n.m.${i}`][0] += -3.6 + 0.4 * i; b[`n.m.${i}`][2] += 0.4; }
  }), [], spec);
  assert.equal(r.pass, false);
  assert.ok(unexplained(r).some((x) => x.id === 'n.m.2' && x.why.includes('x')), JSON.stringify(r.roots));
});

test('R32: the same row with one dot 3.6 wider is rooted at that dot only (the row and the others follow)', () => {
  const { tree, spec } = miniRow();
  const r = probe(tree, both((b) => {
    b['n.m'][0] -= 3.6; b['n.m'][2] += 3.6;
    for (let i = 0; i < 9; i++) b[`n.m.${i}`][0] -= 3.6;
    b['n.m.4'][2] += 3.6; for (let i = 5; i < 9; i++) b[`n.m.${i}`][0] += 3.6;
  }), [], spec);
  assert.deepEqual(rootIds(r), ['n.m.4'], JSON.stringify(r.roots));
});

// n.r: HUG row (lay H) of S (n.r.0, FIXED width flagged shrink, HUG column around a wrapping FILL text n.r.0.0) and a
// centred FIXED item C (n.r.1); the row's height comes from S
function centredRow() {
  const tree = flat([{ id: 'n.r', kind: 'frame', rA: [0, 0, 200, 40], rB: [0, 0, 200, 40], kids: [
    { id: 'n.r.0', kind: 'frame', rA: [0, 0, 150, 40], rB: [0, 0, 150, 40], kids: [{ id: 'n.r.0.0', kind: 'text', rA: [0, 10, 150, 20], rB: [0, 10, 150, 20] }] },
    { id: 'n.r.1', kind: 'frame', rA: [160, 10, 20, 20], rB: [160, 10, 20, 20] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [{ ...Fd('n.r', ['HUG', 'HUG'], 'H', [
    Fd('n.r.0', ['FIXED', 'HUG'], 'V', [{ id: 'n.r.0.0', t: 'T', sz: ['FILL', 'HUG'] }]), F('n.r.1', ['FIXED', 'FIXED'])]), lay: { d: 'H', ca: 'C' } }]);
  return { tree, spec };
}

test('R33: a centred item follows its HUG row\'s middle edge when the row grew because of another child (shrink wrap)', () => {
  const { tree, spec } = centredRow();
  const r = probe(tree, both((b) => {
    b['n.r'][2] -= 20; b['n.r'][3] += 30;
    b['n.r.0'][2] -= 20; b['n.r.0'][3] += 30; b['n.r.0.0'][2] -= 20; b['n.r.0.0'][3] += 30;
    b['n.r.1'][0] -= 20; b['n.r.1'][1] += 15;
  }), [{ id: 'n.r.0', kind: 'shrink' }], spec);
  assert.ok(!r.roots.some((x) => x.id === 'n.r.1'), JSON.stringify(r.roots));
  assert.ok(r.roots.length && r.roots.every((x) => x.explainedBy), JSON.stringify(r.roots));
  assert.equal(r.pass, true);
});

test('R33: two centred items do not explain each other through the row\'s middle edge (row padding +30)', () => {
  const { tree, spec } = centredRow();
  tree.kids[0].kids[0].kids = []; spec.kids[0].kids[0].kids = [];
  const r = probe(tree, both((b) => { b['n.r'][3] += 30; b['n.r.0'][1] += 15; b['n.r.1'][1] += 15; }), [], spec);
  assert.equal(r.pass, false);
  assert.ok(unexplained(r).length > 0, JSON.stringify(r.roots));
});

test('R33: an end-aligned first item follows its HUG row\'s far edge when the next item grew (its far edge matching is no dependency)', () => {
  const tree = flat([{ id: 'n.r', kind: 'frame', rA: [0, 0, 200, 40], rB: [0, 0, 200, 40], kids: [
    { id: 'n.r.0', kind: 'frame', rA: [0, 20, 20, 20], rB: [0, 20, 20, 20] },
    { id: 'n.r.1', kind: 'frame', rA: [30, 0, 170, 40], rB: [30, 0, 170, 40], kids: [{ id: 'n.r.1.0', kind: 'text', rA: [30, 10, 170, 20], rB: [30, 10, 170, 20] }] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [{ ...Fd('n.r', ['HUG', 'HUG'], 'H', [F('n.r.0', ['FIXED', 'FIXED']),
    Fd('n.r.1', ['FIXED', 'HUG'], 'V', [{ id: 'n.r.1.0', t: 'T', sz: ['FILL', 'HUG'] }])]), lay: { d: 'H', ca: 'E' } }]);
  const r = probe(tree, both((b) => {
    b['n.r'][2] -= 20; b['n.r'][3] += 30; b['n.r.0'][1] += 30;
    b['n.r.1'][2] -= 20; b['n.r.1'][3] += 30; b['n.r.1.0'][2] -= 20; b['n.r.1.0'][3] += 30;
  }), [{ id: 'n.r.1', kind: 'shrink' }], spec);
  assert.ok(!r.roots.some((x) => x.id === 'n.r.0'), JSON.stringify(r.roots));
  assert.equal(r.pass, true, JSON.stringify(r.roots));
});

test('R33: the growth is judged with the referencing item held at its source box (it was the tallest before)', () => {
  const tree = flat([{ id: 'n.r', kind: 'frame', rA: [0, 0, 200, 40], rB: [0, 0, 200, 40], kids: [
    { id: 'n.r.0', kind: 'frame', rA: [0, 0, 40, 40], rB: [0, 0, 40, 40] },
    { id: 'n.r.1', kind: 'frame', rA: [50, 4, 150, 36], rB: [50, 4, 150, 36], kids: [{ id: 'n.r.1.0', kind: 'text', rA: [50, 13, 150, 18], rB: [50, 13, 150, 18] }] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [{ ...Fd('n.r', ['HUG', 'HUG'], 'H', [F('n.r.0', ['FIXED', 'FIXED']),
    Fd('n.r.1', ['FIXED', 'HUG'], 'V', [{ id: 'n.r.1.0', t: 'T', sz: ['FILL', 'HUG'] }])]), lay: { d: 'H', ca: 'E' } }]);
  // bubble 18 taller (36 -> 54, now the tallest), row 14 taller, the bottom-aligned avatar 14 lower
  const r = probe(tree, both((b) => {
    b['n.r'][3] += 14; b['n.r.0'][1] += 14;
    b['n.r.1'][1] -= 4; b['n.r.1'][3] += 18; b['n.r.1.0'][1] -= 4; b['n.r.1.0'][3] += 18;
  }), [{ id: 'n.r.1.0', kind: 'raster' }], spec);
  assert.ok(!r.roots.some((x) => x.id === 'n.r.0'), JSON.stringify(r.roots));
  // ... but the same 14px with nothing grown is a root
  const r2 = probe(tree, both((b) => { b['n.r'][3] += 14; b['n.r.0'][1] += 14; b['n.r.1'][1] += 14; }), [], spec);
  assert.equal(r2.pass, false, JSON.stringify(r2.roots));
});

// ---- Task 7 fix round 3 (R34) ----
// generated sweep (reviewer shape rv33d): a HUG row n.0 (lay H, gap 10, cross align ca) of three FIXED kids of heights
// hs; optionally kid wi is a shrink-flagged HUG column around a wrapping FILL text that loses 20px of width (the next
// kids follow, gap kept) and grows `grow` px in height. Error: the row's padding top / bottom changes by (pt, pb).
function rowSweep(ca, hs, wi, grow, pt, pb, specCa = ca) {
  const geo = (hz, narrow, padT, padB) => {
    const inner = Math.max(...hz); let x = 10;
    const kids = hz.map((h, i) => { const w = i === wi && narrow ? 30 : 50; const y = 10 + padT + (ca === 'S' ? 0 : ca === 'C' ? (inner - h) / 2 : inner - h); const b = [x, y, w, h]; x += w + 10; return b; });
    return { row: [10, 10, x - 20, inner + padT + padB], kids };
  };
  const s = geo(hs, false, 0, 0), p = geo(hs.map((h, i) => (i === wi ? h + grow : h)), true, pt, pb);
  const tree = { id: 'n', kind: 'frame', rA: [0, 0, 400, 300], rB: [0, 0, 400, 300], kids: [{ id: 'n.0', kind: 'frame', rA: s.row, rB: s.row,
    kids: s.kids.map((b, i) => ({ id: `n.0.${i}`, kind: 'frame', rA: b, rB: b, ...(i === wi ? { kids: [{ id: `n.0.${i}.t`, kind: 'text', rA: b, rB: b }] } : {}) })) }] };
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [{ ...F('n.0', ['HUG', 'HUG'], s.kids.map((b, i) => (i === wi
    ? Fd(`n.0.${i}`, ['FIXED', 'HUG'], 'V', [{ id: `n.0.${i}.t`, t: 'T', sz: ['FILL', 'HUG'] }]) : F(`n.0.${i}`, ['FIXED', 'FIXED'])))), lay: { d: 'H', g: 10, pa: 'S', ...(specCa ? { ca: specCa } : {}) } }]);
  return probe(tree, both((b) => {
    b['n.0'] = [...p.row]; p.kids.forEach((k, i) => { b[`n.0.${i}`] = [...k]; if (i === wi) b[`n.0.${i}.t`] = [...k]; });
  }), wi >= 0 ? [{ id: `n.0.${wi}`, kind: 'shrink' }] : [], spec);
}

test('R34 sweep: a HUG row padding error never hides behind a wrapping or centred / end-aligned child; legit rows pass', () => {
  const silent = [], ctrlFail = [];
  for (const ca of ['S', 'C', 'E']) for (const hs of [[20, 40, 30], [40, 20, 30], [30, 30, 30], [20, 20, 40], [40, 40, 20], [30, 20, 20]]) {
    for (const wi of [-1, 0, 1, 2]) for (const grow of wi < 0 ? [0] : [20, 10]) {
      const tag = JSON.stringify({ ca, hs, wi, grow });
      const c0 = rowSweep(ca, hs, wi, grow, 0, 0);
      if (!c0.pass) ctrlFail.push(`${tag} ${JSON.stringify(c0.roots.filter((x) => x.width === 'A').map((x) => [x.id, x.why.join(','), x.explainedBy || '-']))}`);
      for (const [pt, pb] of [[0, 6], [6, 0], [3, 3], [0, 20], [20, 0], [10, 10], [-6, 0], [0, -6], [-10, 10], [10, -10]]) {
        if (rowSweep(ca, hs, wi, grow, pt, pb).pass) silent.push(`${tag} pt ${pt} pb ${pb}`);
      }
    }
  }
  assert.deepEqual(silent, [], `silent: ${silent.length}\n${silent.slice(0, 10).join('\n')}`);
  assert.deepEqual(ctrlFail, [], `controls failing: ${ctrlFail.length}\n${ctrlFail.slice(0, 10).join('\n')}`);
});

// generated sweep (reviewer shape rv32): a HUG row of N FIXED kids (w 20, gap 10) placed at the start, centre or end of a
// FIXED root; each kid d wider (below tolerance). Growth N·d > 1 must not pass; one kid N·d wider is legit.
function driftRow(N, d, anchor, one) {
  const geo = (ws) => { const w = ws.reduce((a, b) => a + b, 0) + 10 * (N - 1); const x = anchor === 'C' ? (400 - w) / 2 : anchor === 'E' ? 390 - w : 10;
    let cx = x; return { row: [x, 50, w, 20], kids: ws.map((kw) => { const b = [cx, 50, kw, 20]; cx += kw + 10; return b; }) }; };
  const s = geo(Array(N).fill(20)), p = geo(Array.from({ length: N }, (_, i) => (one ? (i === 1 ? 20 + N * d : 20) : 20 + d)));
  const tree = { id: 'n', kind: 'frame', rA: [0, 0, 400, 300], rB: [0, 0, 400, 300], kids: [{ id: 'n.0', kind: 'frame', rA: s.row, rB: s.row,
    kids: s.kids.map((b, i) => ({ id: `n.0.${i}`, kind: 'frame', rA: b, rB: b })) }] };
  const spec = { ...Fd('n', ['FIXED', 'FIXED'], 'V', [{ ...F('n.0', ['HUG', 'HUG'], s.kids.map((b, i) => F(`n.0.${i}`, ['FIXED', 'FIXED']))), lay: { d: 'H', g: 10, pa: 'S', ca: 'S' } }]),
    lay: { d: 'V', pa: 'S', ca: anchor === 'C' ? 'C' : anchor === 'E' ? 'E' : 'S' } };
  return probe(tree, both((b) => { b['n.0'] = [...p.row]; p.kids.forEach((k, i) => { b[`n.0.${i}`] = [...k]; }); }), [], spec);
}

test('R34 sweep: sub-tolerance drift adding up in a start / centre / end-anchored HUG row is never a silent pass', () => {
  const silent = [], ctrlFail = [];
  for (const anchor of ['S', 'C', 'E']) for (const [N, d] of [[6, 0.2], [4, 0.3], [5, 0.3], [8, 0.15], [3, 0.4], [10, 0.12], [9, 0.4]]) {
    if (driftRow(N, d, anchor, false).pass) silent.push(`${anchor} N ${N} d ${d}`);
    const one = driftRow(N, d, anchor, true);
    if (JSON.stringify(rootIds(one)) !== '["n.0.1"]') ctrlFail.push(`${anchor} N ${N} d ${d}: ${JSON.stringify(one.roots)}`);
  }
  assert.deepEqual(silent, []);
  assert.deepEqual(ctrlFail, [], 'one kid N·d wider (a root itself) is the only root: the screen fails only because of it');
});

test('R34 (M1): a HUG frame that grew symmetrically (top -10, bottom +10) is a root unless it is centre-aligned', () => {
  // n.0.0 hugs a FIXED child that is 20px taller (its own raster flag explains it); the frame's size follows, its
  // middle stays: that is its place only when it is centred in n.0
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 200, 100], rB: [0, 0, 200, 100], kids: [{ id: 'n.0.0', kind: 'frame', rA: [10, 40, 50, 20], rB: [10, 40, 50, 20],
    kids: [{ id: 'n.0.0.0', kind: 'frame', rA: [10, 40, 50, 20], rB: [10, 40, 50, 20] }] }] }]);
  for (const [ca, root] of [['S', true], ['E', true], [undefined, true], ['C', false]]) {
    const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [{ ...F('n.0', ['FIXED', 'FIXED'], [Fd('n.0.0', ['HUG', 'HUG'], 'V', [F('n.0.0.0', ['FIXED', 'FIXED'])])]), lay: { d: 'H', pa: 'S', ...(ca ? { ca } : {}) } }]);
    const r = probe(tree, both((b) => { for (const id of ['n.0.0', 'n.0.0.0']) { b[id][1] -= 10; b[id][3] += 20; } }), [{ id: 'n.0.0.0', kind: 'raster' }], spec);
    assert.equal(unexplained(r).some((x) => x.id === 'n.0.0' && x.why.includes('y')), root, `ca ${ca}: ${JSON.stringify(r.roots)}`);
  }
});

test('R34 (C1): a row padding-top error does not ride on the size change of a wrapping child (chat row)', () => {
  // avatar (end-aligned) + bubble (shrink, wraps 20px taller); the row's padding top is 6px too large
  for (const pt of [6, 20]) {
    const r = rowSweep('E', [30, 30, 30], 1, 20, pt, 0);
    assert.equal(r.pass, false, `pt ${pt}: ${JSON.stringify(r.roots)}`);
  }
  assert.equal(rowSweep('E', [30, 30, 30], 1, 20, 0, 0).pass, true);
});

test('R35: with no cross alignment in the spec, end-aligned kids shifted by a padding swap (top -10, bottom +10) are not a silent pass', () => {
  for (const [hs, grow] of [[[30, 30, 30], 10], [[20, 40, 30], 20], [[20, 20, 40], 10], [[30, 20, 20], 20]]) {
    const r = rowSweep('E', hs, 2, grow, -10, 10, null);
    assert.equal(r.pass, false, `${JSON.stringify(hs)} grow ${grow}: ${JSON.stringify(r.roots)}`);
  }
});

// ---- R46: unsupported paint and effect data ----
test('R46: unsupported paint is a data finding on a node of any size (text-shadow on 60000px²), unless rasterised', () => {
  const inp = fixture();
  inp.screen.tree.paint = { ...inp.screen.tree.paint, unsupported: [{ prop: 'text-shadow', value: 'rgb(229, 57, 53) 3px 3px 0px' }] };
  const r = verifyScreen(inp);
  assert.ok(300 * 200 > 4000);
  assert.deepEqual(r.data.map((x) => [x.id, x.kind, x.prop]), [['n', 'unsupported', 'text-shadow']]);
  assert.equal(r.pass, false);
  inp.flags = [{ id: 'n', kind: 'raster', detail: 'test' }];
  assert.deepEqual(verifyScreen(inp).data, []);
});

test('R46: paint on a text node (inline box background / shadow / border) is unsupported: the proxy draws none', () => {
  const inp = fixture();
  inp.screen.tree.kids[0].kids[0].paint = { bg: 'rgb(255, 235, 59)' };
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind, x.prop]), [['n.0.0', 'unsupported', 'inline-box']]);
});

test('R46: box-shadow and background-image are compared with the proxy DOM at any size (effect)', () => {
  const inp = fixture();
  const sh = 'rgba(0, 0, 0, 0.2) 0px 2px 4px 0px', gr = 'linear-gradient(rgb(255, 255, 255), rgb(0, 0, 0))';
  inp.screen.tree.paint = { ...inp.screen.tree.paint, shadow: sh, bgImage: gr };
  assert.deepEqual(verifyScreen(inp).data.map((x) => [x.id, x.kind, x.prop]), [['n', 'effect', 'box-shadow'], ['n', 'effect', 'background-image']]);
  inp.proxy.A.dom.n = { ...inp.proxy.A.dom.n, shadow: sh, bgImage: gr };
  assert.deepEqual(verifyScreen(inp).data, []);
  delete inp.proxy.A.dom['n.1'].shadow;
  assert.ok(verifyScreen(inp).skipped.includes('effect'));
});

// ---- R45: a container crop compares the container's own paint, children masked ----
test('R45: children shifted differently inside a container window: masked, the container passes; its own paint still fails', { skip }, async () => {
  const box = (extra = '') => `<div style="position:absolute;left:10px;top:10px;width:60px;height:30px;background:#e8f0ee;border-radius:6px${extra}"></div>`;
  const kids = (ix, dx) => `<div style="position:absolute;left:${ix}px;top:14px;width:16px;height:16px;background:#234"></div>` +
    `<div style="position:absolute;left:${dx}px;top:20px;width:6px;height:6px;background:#c33;border-radius:3px"></div>`;
  const src = await shot(box() + kids(14, 40)), prx = await shot(box() + kids(15, 39)), bad = await shot(box(';box-shadow:inset 0 -2px 0 0 #234') + kids(15, 39));
  const C = [10, 10, 60, 30];
  const plain = await cropDiffDetail(browser, src, C, prx, C);
  assert.ok(fails(plain), `unmasked container window fails: ${JSON.stringify(plain)}`);
  const masks = { masksA: [[14, 14, 16, 16], [40, 20, 6, 6]], masksB: [[15, 14, 16, 16], [39, 20, 6, 6]] };
  const [own] = await cropDiffMany(browser, src, prx, [{ rectA: C, rectB: C, ...masks }]);
  assert.ok(!fails(own), `own paint matches: ${JSON.stringify(own)}`);
  const [changed] = await cropDiffMany(browser, src, bad, [{ rectA: C, rectB: C, ...masks }]);
  assert.ok(fails(changed), `own paint changed (bottom stroke): ${JSON.stringify(changed)}`);
});

test('R45: measureCrops masks the cropped descendants of a container (each is compared on its own)', { skip }, async () => {
  const box = `<div style="position:absolute;left:10px;top:10px;width:60px;height:30px;background:#e8f0ee;border-radius:6px"></div>`;
  const kids = (ix, dx) => `<div style="position:absolute;left:${ix}px;top:14px;width:16px;height:16px;background:#234"></div>` +
    `<div style="position:absolute;left:${dx}px;top:20px;width:6px;height:6px;background:#c33;border-radius:3px"></div>`;
  const src = await shot(box + kids(14, 40)), prx = await shot(box + kids(15, 39));
  const tree = { id: 'n', kind: 'frame', rA: [0, 0, 100, 100], rB: [0, 0, 100, 100], kids: [
    { id: 'n.0', kind: 'frame', rA: [10, 10, 60, 30], rB: [10, 10, 60, 30], kids: [
      { id: 'n.0.0', kind: 'frame', rA: [14, 14, 16, 16], rB: [14, 14, 16, 16] },
      { id: 'n.0.1', kind: 'frame', rA: [40, 20, 6, 6], rB: [40, 20, 6, 6] }] }] };
  const boxes = { n: [0, 0, 100, 100], 'n.0': [10, 10, 60, 30], 'n.0.0': [15, 14, 16, 16], 'n.0.1': [39, 20, 6, 6] };
  const crops = await measureCrops(browser, { tree, png: [src, src] }, { A: { png: prx, boxes }, B: { png: prx, boxes } });
  const bad = crops.filter(fails).map((c) => [c.id, c.width]);
  assert.deepEqual(bad, []);
  assert.equal(crops.filter((c) => c.id === 'n.0').length, 2);
});

// ---- R44: crop fails attached to size roots ----
test('R44: a crop fail on a size root is attached to that root (and its status); one inside its subtree stands alone', () => {
  const bad = (id, width) => ({ id, width, ratio: 0.3, diff: 90, peak: 50 });
  const run = (flags = []) => {
    const inp = fixture();
    shift(inp, 'n.0', [0, 0, 5, 0]); // the HUG card 5px wider while its children did not move: a size root
    inp.flags = flags;
    inp.crops = [bad('n.0', 'A'), bad('n.0.0', 'A'), bad('n.1', 'B')];
    return verifyScreen(inp);
  };
  const r = run();
  assert.deepEqual(unexplained(r).map((x) => [x.id, x.width, x.why.join()]), [['n.0', 'A', 'w'], ['n.0', 'B', 'w']]);
  assert.deepEqual(r.cropLinked.map((c) => [c.id, c.width, c.root]), [['n.0', 'A', 'n.0']]);
  assert.deepEqual(r.crop.map((c) => [c.id, c.width]), [['n.0.0', 'A'], ['n.1', 'B']]);
  assert.equal(r.pass, false);
  // explained root: its crop is explained by the same flag; the child's crop still stands alone
  const e = run([{ id: 'n.0', kind: 'testFlag', detail: 't' }]);
  assert.deepEqual(e.cropExplained.map((c) => [c.id, c.width, c.explainedBy]), [['n.0', 'A', 'testFlag']]);
  assert.deepEqual(e.crop.map((c) => [c.id, c.width]), [['n.0.0', 'A'], ['n.1', 'B']]);
  // a size change within the crop search (1px) does not explain a crop
  const inp = fixture(); shift(inp, 'n.0', [0, 0, 0.8, 0]); inp.crops = [bad('n.0', 'A')];
  const s = verifyScreen(inp);
  assert.ok(s.roots.some((x) => x.id === 'n.0'));
  assert.deepEqual(s.crop.map((c) => c.id), ['n.0']);
});

// ---- R43: model deltas attributed like layout roots, with a per-screen drift entry ----
test('R43: many sub-tolModel model steps that add up beyond tolModel need approval (drift entry with the max)', () => {
  // a column of ten 20px frames; the model makes each 0.4px taller (within tolerance), so frame i sits 0.4·i lower
  const kids = Array.from({ length: 10 }, (_, i) => ({ id: `n.${i}`, kind: 'frame', rA: [0, i * 20, 100, 20], rB: [0, i * 20, 100, 20] }));
  const tree = flat(kids);
  tree.rA = [0, 0, 400, 200]; tree.rB = [0, 0, 400, 200];
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', kids.map((k) => F(k.id, ['FIXED', 'FIXED'])));
  const r = probe(tree, (P) => { for (const M of ['A', 'B']) for (let i = 0; i < 10; i++) { P[M].boxes[`n.${i}`][1] += 0.4 * i; P[M].boxes[`n.${i}`][3] += 0.4; } }, [], spec);
  assert.deepEqual(unexplained(r), []);
  assert.ok(r.modelDeltas.every((m) => m.magnitude <= 2), JSON.stringify(r.modelDeltas));
  assert.ok(r.modelFollowers.A > 0 && r.modelFollowers.B > 0);
  assert.deepEqual(r.needsApproval.map((m) => [m.id, m.magnitude, m.drift]), [['n.9', 3.6, true]]);
  assert.equal(r.pass, false);
  // within tolModel 4 the same drift passes
  assert.deepEqual(probe(tree, (P) => { for (const M of ['A', 'B']) for (let i = 0; i < 10; i++) { P[M].boxes[`n.${i}`][1] += 0.4 * i; P[M].boxes[`n.${i}`][3] += 0.4; } }, [], spec, { tolModel: 4 }).needsApproval, []);
});

// ---- fix round 9: R49 (position is checked per axis independently of size) ----
test('R49: a size-explained item also displaced on that axis is a position root (a size excuse never covers position)', () => {
  // row 300 at x 0, padding-left 10: a FIXED 100 (shrink: source squeezed to 100, proxy 120) | gap 10 | b FIXED 60
  const Fl = (id, sz, d, kids) => ({ id, t: 'F', sz, lay: { d, pa: 'S', ca: 'S', p: [0, 0, 0, 10], g: 10 }, kids });
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [10, 0, 100, 40], rB: [10, 0, 100, 40] }, { id: 'n.0.1', kind: 'frame', rA: [120, 0, 60, 40], rB: [120, 0, 60, 40] }] }]);
  const spec = Fl('n', ['FIXED', 'FIXED'], 'V', [Fl('n.0', ['FIXED', 'FIXED'], 'H', [F('n.0.0', ['FIXED', 'FIXED']), F('n.0.1', ['FIXED', 'FIXED'])])]);
  const fl = [{ id: 'n.0.0', kind: 'shrink' }];
  // legit: +20 wide, the next item pushed along
  let r = probe(tree, both((b) => { b['n.0.0'][2] += 20; b['n.0.1'][0] += 20; }), fl, spec);
  assert.equal(r.pass, true, JSON.stringify(r.roots));
  // the same plus a padding-left error +10: the item's x is off on its own (start edge), not covered by shrink
  r = probe(tree, both((b) => { b['n.0.0'][0] += 10; b['n.0.0'][2] += 20; b['n.0.1'][0] += 30; }), fl, spec);
  const a = r.roots.find((x) => x.id === 'n.0.0' && x.width === 'A');
  assert.ok(a && a.why.includes('w') && a.why.includes('x'), JSON.stringify(r.roots));
  assert.ok(!a.explainedBy, JSON.stringify(a));
  assert.equal(r.pass, false);
  // control: the padding error alone
  r = probe(tree, both((b) => { b['n.0.0'][0] += 10; b['n.0.1'][0] += 10; }), fl, spec);
  assert.equal(r.pass, false);
});

test('R49: an absolute text whose width is off and that also moved 2px is a root on both w and x', () => {
  // abs child L-constrained at x 50: width +5 (a text-size error) and x +2 (a constraint error)
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [
    { id: 'n.0.0', kind: 'text', rA: [50, 10, 20, 12], rB: [50, 10, 20, 12] }] }]);
  const spec = Fd('n', ['FIXED', 'FIXED'], 'V', [{ id: 'n.0', t: 'F', sz: ['FIXED', 'FIXED'], kids: [
    { id: 'n.0.0', t: 'T', sz: ['HUG', 'HUG'], abs: { x: 50, y: 10, c: 'L' } }] }]);
  let r = probe(tree, both((b) => { b['n.0.0'][2] += 5; }), [], spec);
  assert.deepEqual(r.roots.map((x) => x.why.join(',')), ['w', 'w'], JSON.stringify(r.roots));
  r = probe(tree, both((b) => { b['n.0.0'][0] += 2; b['n.0.0'][2] += 5; }), [], spec);
  assert.deepEqual(r.roots.map((x) => x.why.join(',')), ['w,x', 'w,x'], JSON.stringify(r.roots));
  // an R-constrained one keeps its far edge: growing leftwards is no position error
  spec.kids[0].kids[0].abs.c = 'R';
  r = probe(tree, both((b) => { b['n.0.0'][0] -= 5; b['n.0.0'][2] += 5; }), [], spec);
  assert.deepEqual(r.roots.map((x) => x.why.join(',')), ['w', 'w'], JSON.stringify(r.roots));
});

// ---- fix round 9: R50 (data checks on paint the crops cannot see on large nodes: source computed vs proxy DOM) ----
const dataOf = (r, kind) => r.data.filter((d) => d.kind === kind);
test('R50: border-radius is compared per corner (source computed vs proxy DOM), at any size', () => {
  const inp = fixture();
  inp.screen.tree.kids[0].paint.radius = ['16px', '16px', '4px', '10px 20px'];
  inp.proxy.A.dom['n.0'].radius = ['16px', '16px', '4px', '10px 20px'];
  let r = verifyScreen(inp);
  assert.deepEqual(dataOf(r, 'radius'), [], JSON.stringify(r.data));
  assert.equal(r.pass, true);
  inp.proxy.A.dom['n.0'].radius = ['16px', '16px', '4px', '10px'];
  r = verifyScreen(inp);
  assert.deepEqual(dataOf(r, 'radius').map((d) => [d.id, d.side, d.expected, d.actual]), [['n.0', 'bottom-left', '10px 20px', '10px']]);
  assert.equal(r.pass, false);
  // a radius the proxy drew that the source does not have
  const j = fixture(); j.proxy.A.dom['n.1'].radius = ['8px', '8px', '8px', '8px'];
  assert.equal(dataOf(verifyScreen(j), 'radius').length, 4);
  // no radius observation in the proxy DOM: never a silent pass
  const k = fixture(); delete k.proxy.A.dom['n.1'].radius;
  r = verifyScreen(k);
  assert.ok(r.skipped.includes('radius'));
  assert.equal(r.pass, false);
});

test('R50: font size, weight, style, decoration and transform are compared per run with the proxy DOM', () => {
  const base = () => {
    const inp = fixture();
    const t = inp.screen.tree.kids[0].kids[0];
    t.font = { ...FONT, fst: 'normal', td: 'none', tt: 'none' }; t.runs = [{ t: 'In' }, { t: 'box', s: { fw: '700' } }];
    inp.proxy.A.dom['n.0.0'].runs = domRuns(t);
    return inp;
  };
  let r = verifyScreen(base());
  assert.deepEqual(r.data, []);
  assert.equal(r.pass, true);
  for (const [i, prop, v] of [[2, 'font-weight', '400'], [1, 'font-size', '19px'], [3, 'font-style', 'italic'], [4, 'text-decoration', 'underline'], [5, 'text-transform', 'uppercase']]) {
    const inp = base(); inp.proxy.A.dom['n.0.0'].runs[1][i] = v;
    r = verifyScreen(inp);
    assert.deepEqual(dataOf(r, 'font-style').map((d) => [d.id, d.prop, d.actual]), [['n.0.0', prop, v]], `${prop}: ${JSON.stringify(r.data)}`);
    assert.equal(r.pass, false);
  }
  // the proxy split the text into runs differently but with the same styles per character: fine
  const s = base(); s.proxy.A.dom['n.0.0'].runs = [['I', '14px', '400', 'normal', 'none', 'none'], ['n', '14px', '400', 'normal', 'none', 'none'], ['box', '14px', '700', 'normal', 'none', 'none']];
  assert.deepEqual(verifyScreen(s).data, []);
  // the bold run moved one character to the left: a weight mismatch
  const m = base(); m.proxy.A.dom['n.0.0'].runs = [['I', '14px', '400', 'normal', 'none', 'none'], ['nbox', '14px', '700', 'normal', 'none', 'none']];
  assert.deepEqual(dataOf(verifyScreen(m), 'font-style').map((d) => d.prop), ['font-weight']);
  // no run observation: never a silent pass
  const k = base(); delete k.proxy.A.dom['n.0.0'].runs;
  r = verifyScreen(k);
  assert.ok(r.skipped.includes('font-style'));
  assert.equal(r.pass, false);
});

const SVG_SRC = '<svg viewBox="0 0 100 100" style="fill-opacity: 0.5;"><circle cx="50" cy="50" r="40" style="fill: rgb(229, 57, 53);"></circle></svg>';
const svgFixture = () => {
  const inp = fixture();
  const ic = inp.screen.tree.kids[0].kids[1];
  ic.icon = { ref: null, svg: SVG_SRC, color: 'rgb(0, 0, 0)', fill: 'rgb(0, 0, 0)', stroke: 'none', sw: '1px' };
  inp.spec.kids[0].kids[1].icon = { svg: SVG_SRC };
  Object.assign(inp.proxy.A.dom['n.0.1'], { icon: 'svg', svg: { markup: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" style="fill: rgb(229, 57, 53);"></circle></svg>', own: 'fill-opacity: 0.5', paint: ['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'none', '1px'] } });
  return inp;
};
test('R50: an inline svg is compared by its serialised markup (with inlined paint) and its root paint', () => {
  let r = verifyScreen(svgFixture());
  assert.deepEqual(r.data, [], JSON.stringify(r.data));
  const colour = svgFixture(); colour.proxy.A.dom['n.0.1'].svg.markup = colour.proxy.A.dom['n.0.1'].svg.markup.replace('229, 57, 53', '30, 136, 229');
  assert.deepEqual(dataOf(verifyScreen(colour), 'svg').map((d) => [d.id, d.prop]), [['n.0.1', 'markup']]);
  const own = svgFixture(); own.proxy.A.dom['n.0.1'].svg.own = '';
  assert.deepEqual(dataOf(verifyScreen(own), 'svg').map((d) => d.prop), ['root style']);
  const paint = svgFixture(); paint.proxy.A.dom['n.0.1'].svg.paint[1] = 'rgb(255, 0, 0)';
  assert.deepEqual(dataOf(verifyScreen(paint), 'svg').map((d) => d.prop), ['fill']);
  const k = svgFixture(); delete k.proxy.A.dom['n.0.1'].svg;
  r = verifyScreen(k);
  assert.ok(r.skipped.includes('svg') || dataOf(r, 'svg').length, JSON.stringify(r));
  assert.equal(r.pass, false);
});

test('R50: an image is compared by object-fit, object-position and source with the proxy DOM', () => {
  const mk = () => {
    const inp = fixture();
    inp.screen.tree.kids[1] = { ...inp.screen.tree.kids[1], kind: 'image', tag: 'img', src: 'data:image/png;base64,AAA', fit: 'cover', pos: '0px 0px' };
    inp.spec.kids[1] = { ...inp.spec.kids[1], t: 'I', src: 'data:image/png;base64,AAA', fit: 'cover', pos: '0px 0px' };
    inp.proxy.A.dom['n.1'].img = { fit: 'cover', pos: '0px 0px', src: 'data:image/png;base64,AAA' };
    return inp;
  };
  assert.deepEqual(verifyScreen(mk()).data, []);
  for (const [k, v] of [['fit', 'fill'], ['pos', '50% 50%'], ['src', 'data:image/png;base64,BBB']]) {
    const inp = mk(); inp.proxy.A.dom['n.1'].img[k] = v;
    const r = verifyScreen(inp);
    assert.deepEqual(dataOf(r, 'image').map((d) => [d.id, d.prop, d.actual]), [['n.1', { fit: 'object-fit', pos: 'object-position', src: 'src' }[k], v]], JSON.stringify(r.data));
  }
  const none = mk(); none.proxy.A.dom['n.1'].img = null; // the proxy drew no image
  assert.deepEqual(dataOf(verifyScreen(none), 'image').map((d) => d.actual), ['no image']);
  const k = mk(); delete k.proxy.A.dom['n.1'].img;
  const r = verifyScreen(k);
  assert.ok(r.skipped.includes('image'));
  assert.equal(r.pass, false);
});

// ---- fix round 9: R55 (font: a text without a spec family is unchecked; a face that did not load is a finding) ----
test('R55: a text whose spec has no font family is unchecked, never silently skipped', () => {
  const inp = fixture();
  const sf = inp.spec.kids[0].kids[0]; sf.font = { ...sf.font }; delete sf.font.ff; // FONT is shared: copy before deleting
  let r = verifyScreen(inp);
  assert.ok(r.unchecked.includes('n.0.0'), JSON.stringify(r.unchecked));
  assert.match(r.uncheckedReasons['n.0.0'], /font family/);
  assert.equal(r.pass, false);
  const k = fixture(); delete k.spec.kids[0].kids[0].font;
  r = verifyScreen(k);
  assert.ok(r.unchecked.includes('n.0.0'));
});

test('R55: a run whose face (family, style, weight) did not load in the proxy is a font-face finding', () => {
  const mk = (missing) => {
    const inp = fixture();
    const t = inp.screen.tree.kids[0].kids[0];
    t.runs = [{ t: 'In' }, { t: 'box', s: { fw: '700' } }];
    inp.proxy.A.dom['n.0.0'].runs = domRuns(t);
    inp.proxy.A.facesMissing = missing;
    return inp;
  };
  assert.deepEqual(verifyScreen(mk([])).data, []);
  const r = verifyScreen(mk(['Inter|0|700']));
  assert.deepEqual(r.data.map((d) => [d.id, d.kind, d.expected, d.actual]), [['n.0.0', 'font-face', 'Inter 700', 'Inter 700 did not load (synthesised or fallback)']]);
  assert.equal(r.pass, false);
  assert.deepEqual(verifyScreen(mk(['Inter|1|700'])).data, [], 'an italic face nobody uses');
  // a proxy without the observation is never a silent pass
  const k = mk([]); delete k.proxy.A.facesMissing;
  assert.ok(verifyScreen(k).skipped.includes('font-face'));
});

// ---------------- fix round 10: R57 (a stretched main-axis item is judged by its packed edge) ----------------
test('R57 (probe-r49fill): a FILL item judged by the edge its row packs from; shrink never covers its position', () => {
  // row 300 at x 0, padding-left 10: a FILL 160 | gap 10 | b FIXED 60
  const Fl = (id, sz, d, pa, kids) => ({ id, t: 'F', sz, lay: { d, pa, ca: 'S', p: [0, 0, 0, 10], g: 10 }, kids });
  const tree = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [10, 0, 160, 40], rB: [10, 0, 160, 40] }, { id: 'n.0.1', kind: 'frame', rA: [180, 0, 60, 40], rB: [180, 0, 60, 40] }] }]);
  const spec = (pa) => Fl('n', ['FIXED', 'FIXED'], 'V', 'S', [Fl('n.0', ['FIXED', 'FIXED'], 'H', pa, [F('n.0.0', ['FILL', 'FIXED']), F('n.0.1', ['FIXED', 'FIXED'])])]);
  const fl = [{ id: 'n.0.0', kind: 'shrink' }];
  const xRoot = (r) => r.roots.find((x) => x.id === 'n.0.0' && x.width === 'A' && x.why.includes('x'));
  // planted: padding-left 20 instead of 10, the FILL item absorbs it (near edge +10, far edge stays)
  const pad = both((b) => { b['n.0.0'][0] += 10; b['n.0.0'][2] -= 10; });
  for (const fls of [[], fl]) {
    const r = probe(tree, pad, fls, spec('S'));
    assert.equal(r.pass, false, JSON.stringify(r.roots));
    assert.ok(xRoot(r) && !xRoot(r).explainedBy, JSON.stringify(r.roots));
  }
  // centre-packed: the middle edge moved 5px
  assert.ok(xRoot(probe(tree, pad, fl, spec('C'))), 'centre');
  // legit: the flagged FILL item squeezed 10px at its far edge, b pushed along
  let r = probe(tree, both((b) => { b['n.0.0'][2] -= 10; b['n.0.1'][0] -= 10; }), fl, spec('S'));
  assert.equal(r.pass, true, JSON.stringify(r.roots));
  // end-packed row [b, FILL]: judged by the far edge (padding-right error: far edge -10 is a position root)
  const tree2 = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [
    { id: 'n.0.0', kind: 'frame', rA: [10, 0, 60, 40], rB: [10, 0, 60, 40] }, { id: 'n.0.1', kind: 'frame', rA: [80, 0, 210, 40], rB: [80, 0, 210, 40] }] }]);
  const spec2 = Fl('n', ['FIXED', 'FIXED'], 'V', 'S', [Fl('n.0', ['FIXED', 'FIXED'], 'H', 'E', [F('n.0.0', ['FIXED', 'FIXED']), F('n.0.1', ['FILL', 'FIXED'])])]);
  r = probe(tree2, both((b) => { b['n.0.1'][2] -= 10; }), [{ id: 'n.0.1', kind: 'shrink' }], spec2);
  assert.ok(r.roots.some((x) => x.id === 'n.0.1' && x.why.includes('x') && !x.explainedBy), JSON.stringify(r.roots));
  // stretched on the cross axis (FILL height): still near or far, as before
  const tree3 = flat([{ id: 'n.0', kind: 'frame', rA: [0, 0, 300, 40], rB: [0, 0, 300, 40], kids: [{ id: 'n.0.0', kind: 'frame', rA: [10, 0, 160, 40], rB: [10, 0, 160, 40] }] }]);
  const spec3 = Fl('n', ['FIXED', 'FIXED'], 'V', 'S', [Fl('n.0', ['FIXED', 'FIXED'], 'H', 'S', [F('n.0.0', ['FIXED', 'FILL'])])]);
  r = probe(tree3, both((b) => { b['n.0.0'][1] += 4; b['n.0.0'][3] -= 4; }), [{ id: 'n.0.0', kind: 'mixedRunHeight' }], spec3);
  assert.ok(!r.roots.some((x) => x.why.includes('y')), JSON.stringify(r.roots));
});
