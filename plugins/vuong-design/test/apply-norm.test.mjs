import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNorm } from '../core/apply-norm.mjs';
import { buildProxyHtml } from '../core/proxy.mjs';
import { defaultFontMap } from '../core/font-map.mjs';
import { inventory } from '../core/inventory.mjs';
import { normalize } from '../core/normalize.mjs';

const lay = (o = {}) => ({ d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S', ...o });
const font = (o = {}) => ({ ff: 'Inter', fs: '15px', fw: '400', fst: 'normal', lh: 20.8, ls: 'normal', c: 'rgb(17, 17, 17)', ...o });

// A modelled spec (infer + figma-model) for screen s1, built by hand.
function spec() {
  return {
    id: '0', t: 'F', w: 390, h: 800, sz: ['FIXED', 'FIXED'], model: 'figma', paint: { bg: 'rgb(255, 255, 255)' }, lay: lay({ p: [16, 16, 16, 16], g: 12 }),
    kids: [
      {
        id: '0.0', t: 'F', w: 358, h: 80, sz: ['FILL', 'HUG'], lay: lay({ p: [13, 12, 13, 12], g: 6 }),
        paint: { bg: 'rgb(26, 116, 232)', radius: ['10px', '10px', '10px', '10px'], border: [{ w: 1, style: 'solid', color: 'rgb(26, 116, 232)' }, null, null, null] },
        kids: [{
          id: '0.0.0', t: 'T', w: 120, h: 21, sz: ['HUG', 'HUG'], font: font(),
          runs: [{ t: 'Hello ' }, { t: 'big', s: { fs: '17px', c: 'rgb(26, 116, 232)' } }, { br: 1 }, { t: 'again', s: { c: 'rgb(26, 116, 232)' } }],
        }],
      },
      {
        id: '0.1', t: 'F', w: 358, h: 40, sz: ['FILL', 'FIXED'], lay: lay({ d: 'H', g: 10 }),
        kids: [
          { id: '0.1.0', t: 'F', w: 62, h: 30, sz: ['FIXED', 'HUG'], paint: { bg: '#1A74E8' }, lay: lay() },
          { id: '0.1.1', t: 'V', w: 18, h: 18, sz: ['FIXED', 'FIXED'], icon: { ref: 'i', fill: 'rgb(26, 116, 232)' } },
          { id: '0.1.2', t: 'I', w: 32, h: 40, sz: ['FIXED', 'FIXED'], src: 'a.png' },
        ],
      },
    ],
  };
}

let seq = 0;
const E = (cat, prop, from, to, nodes, o = {}) => ({
  id: o.id ?? `e${seq++}`, cat, role: `${cat}|${prop}|x|y`, prop, from, to, code: o.code ?? 'ROLE_MAJORITY', status: o.status ?? 'auto',
  nodes: nodes.map((n) => (typeof n === 'string' ? { screen: 's1', node: n } : { screen: 's1', ...n })),
});
const find = (s, id) => { const rec = (n) => (n.id === id ? n : (n.kids || []).map(rec).find(Boolean)); return rec(s); };

test('padding 13 -> 12 changes exactly lay.p on the node; applied records it', () => {
  const s = spec();
  const e = E('space', 'paddingT', 13, 12, ['0.0']);
  const r = applyNorm(s, [e], 's1');
  assert.deepEqual(find(r.spec, '0.0').lay.p, [12, 12, 13, 12]);
  assert.equal(r.applied.length, 1);
  assert.deepEqual(r.applied[0], { entry: e.id, cat: 'space', code: 'ROLE_MAJORITY', node: '0.0', prop: 'paddingT', from: 13, to: 12 });
  // nothing else moved
  const want = spec(); want.kids[0].lay.p = [12, 12, 13, 12];
  assert.deepEqual(r.spec, want);
});

test('gap, frame size on a FIXED axis, radius corner and icon size map to their SNode fields', () => {
  const r = applyNorm(spec(), [
    E('space', 'gap', 10, 8, ['0.1']), E('space', 'gap', 6, 4, ['0.0']),
    E('size', 'width', 62, 64, ['0.1.0']),
    E('radius', 'radiusTR', 10, 12, ['0.0']),
    E('icon', 'width', 18, 20, ['0.1.1'], { code: 'ICON_FRAME', status: 'answered' }),
    E('icon', 'height', 18, 20, ['0.1.1'], { code: 'ICON_FRAME', status: 'answered' }),
  ], 's1');
  assert.equal(find(r.spec, '0.1').lay.g, 8);
  assert.equal(find(r.spec, '0.0').lay.g, 4);
  assert.equal(find(r.spec, '0.1.0').w, 64);
  assert.deepEqual(find(r.spec, '0.0').paint.radius, ['10px', '12px', '10px', '10px']);
  assert.deepEqual([find(r.spec, '0.1.1').w, find(r.spec, '0.1.1').h], [20, 20]);
  assert.equal(r.applied.length, 6);
});

test('colour: paint.bg, border colour, icon fill and a text run change; rgb() == hex, written in the spec notation', () => {
  const r = applyNorm(spec(), [
    E('color', 'bg', '#1a74e8', '#1a73e8', ['0.0', '0.1.0'], { code: 'COLOR_DE1' }),
    E('color', 'borderT', '#1a74e8', '#1a73e8', ['0.0'], { code: 'COLOR_DE1' }),
    E('color', 'fill', '#1a74e8', '#1a73e8', ['0.1.1'], { code: 'COLOR_DE1' }),
    E('color', 'color', '#1a74e8', '#1a73e8', [{ node: '0.0.0', run: 1 }], { code: 'COLOR_DE1' }),
  ], 's1');
  const card = find(r.spec, '0.0');
  assert.equal(card.paint.bg, 'rgb(26, 115, 232)', 'rgb() stays rgb()');
  assert.equal(find(r.spec, '0.1.0').paint.bg, '#1a73e8', 'hex stays hex');
  assert.equal(card.paint.border[0].color, 'rgb(26, 115, 232)');
  assert.equal(card.paint.border[0].w, 1);
  assert.equal(find(r.spec, '0.1.1').icon.fill, 'rgb(26, 115, 232)');
  const t = find(r.spec, '0.0.0');
  assert.equal(t.runs[1].s.c, 'rgb(26, 115, 232)');
  // run 3 has the same colour string: inventory listed it once (run 1), so it moves with it
  assert.equal(t.runs[3].s.c, 'rgb(26, 115, 232)');
  assert.equal(t.font.c, 'rgb(17, 17, 17)', 'node colour untouched');
  assert.equal(r.applied.length, 5);
});

test('colour with alpha keeps alpha in rgba(); a run inheriting the node colour changes font.c', () => {
  const s = spec();
  s.kids[0].paint.bg = 'rgba(26, 116, 232, 0.5)';
  const r = applyNorm(s, [
    E('color', 'bg', '#1a74e880', '#1a73e880', ['0.0'], { code: 'COLOR_DE1' }),
    E('color', 'color', '#111111', '#121212', [{ node: '0.0.0', run: 0 }], { code: 'COLOR_NEAR', status: 'answered' }),
  ], 's1');
  assert.equal(find(r.spec, '0.0').paint.bg, 'rgba(26, 115, 232, 0.502)');
  const t = find(r.spec, '0.0.0');
  assert.equal(t.font.c, 'rgb(18, 18, 18)');
  assert.equal(t.runs[1].s.c, 'rgb(26, 116, 232)', 'a run with its own colour is not touched');
});

test('font size per run when the entry has run; node-level otherwise; text marked for re-measure', () => {
  const r = applyNorm(spec(), [E('type', 'fontSize', 17, 16, [{ node: '0.0.0', run: 1 }], { code: 'TYPE_SCALE', status: 'answered' })], 's1');
  const t = find(r.spec, '0.0.0');
  assert.equal(t.runs[1].s.fs, '16px');
  assert.equal(t.font.fs, '15px', 'node font size untouched');
  assert.equal(t.font.remeasure, true);
  assert.deepEqual([t.w, t.h], [120, 21], 'box left as measured; the proxy re-measures HUG axes');

  const r2 = applyNorm(spec(), [E('type', 'fontSize', 15, 16, [{ node: '0.0.0', run: 0 }], { code: 'TYPE_SCALE', status: 'answered' })], 's1');
  const t2 = find(r2.spec, '0.0.0');
  assert.equal(t2.font.fs, '16px', 'run 0 has no own size: the node size changes');
  assert.equal(t2.runs[1].s.fs, '17px');
});

test('line height is node-level; number stays number; text marked for re-measure', () => {
  const r = applyNorm(spec(), [E('type', 'lineHeight', 20.8, 21, ['0.0.0'], { code: 'LINE_HEIGHT_INT', status: 'answered' })], 's1');
  const t = find(r.spec, '0.0.0');
  assert.equal(t.font.lh, 21);
  assert.equal(t.font.remeasure, true);
});

test('proxy: a re-measured text lets its HUG axes hug (not pinned to the stale spec box)', () => {
  const fm = defaultFontMap();
  const before = buildProxyHtml(spec(), {}, fm, { webFonts: false });
  const after = buildProxyHtml(applyNorm(spec(), [E('type', 'lineHeight', 20.8, 21, ['0.0.0'], { code: 'LINE_HEIGHT_INT', status: 'answered' })], 's1').spec, {}, fm, { webFonts: false });
  const tag = (h) => /<div data-id="0\.0\.0"[^>]*>/.exec(h)[0];
  assert.ok(!/data-pin/.test(tag(before)) && /width:120px/.test(tag(before)), 'unchanged text stays pinned');
  assert.ok(/data-pin-w/.test(tag(after)) && /data-pin-h/.test(tag(after)), tag(after));
  assert.ok(!/width:120px/.test(tag(after)));
});

test('from does not match -> Error naming entry, node, prop and the value found', () => {
  assert.throws(() => applyNorm(spec(), [E('space', 'paddingT', 14, 12, ['0.0'], { id: 'abcd1234' })], 's1'),
    (err) => /abcd1234/.test(err.message) && /0\.0/.test(err.message) && /paddingT/.test(err.message) && /13/.test(err.message));
  assert.throws(() => applyNorm(spec(), [E('color', 'bg', '#000000', '#111111', ['0.0'], { id: 'c0' })], 's1'), /c0.*0\.0.*bg.*rgb\(26, 116, 232\)/);
  assert.throws(() => applyNorm(spec(), [E('space', 'gap', 10, 8, ['9.9'], { id: 'g0' })], 's1'), /g0.*9\.9.*not found/);
  assert.throws(() => applyNorm(spec(), [E('color', 'color', '#1a74e8', '#1a73e8', [{ node: '0.0.0', run: 7 }], { id: 'r7' })], 's1'), /r7.*run 7/);
});

test('numbers compare within 0.01 px', () => {
  const r = applyNorm(spec(), [E('space', 'paddingT', 13.005, 12, ['0.0'])], 's1');
  assert.equal(find(r.spec, '0.0').lay.p[0], 12);
});

test('size on a non-FIXED axis throws', () => {
  assert.throws(() => applyNorm(spec(), [E('size', 'height', 30, 32, ['0.1.0'], { id: 'h1' })], 's1'), /h1.*0\.1\.0.*height.*HUG/);
});

test('SRC_SQUASH with to === from: an applied record, nothing changes', () => {
  const e = E('size', 'width', 32, 32, ['0.1.2'], { code: 'SRC_SQUASH', status: 'answered' });
  const r = applyNorm(spec(), [e], 's1');
  assert.deepEqual(r.spec, spec());
  assert.deepEqual(r.applied, [{ entry: e.id, cat: 'size', code: 'SRC_SQUASH', node: '0.1.2', prop: 'width', from: 32, to: 32 }]);
});

test('ask / kept entries and nodes of another screen change nothing', () => {
  const r = applyNorm(spec(), [
    E('space', 'paddingT', 13, 12, ['0.0'], { code: 'GRID4', status: 'ask' }),
    E('space', 'paddingB', 13, 12, ['0.0'], { status: 'kept' }),
    { ...E('space', 'gap', 99, 8, []), nodes: [{ screen: 's2', node: '0.1' }] },
  ], 's1');
  assert.deepEqual(r.spec, spec());
  assert.deepEqual(r.applied, []);
  // an entry with nodes on both screens applies only this screen's
  const both = { ...E('space', 'gap', 10, 8, ['0.1']), nodes: [{ screen: 's1', node: '0.1' }, { screen: 's2', node: '0.7' }] };
  const r2 = applyNorm(spec(), [both], 's1');
  assert.deepEqual(r2.applied.map((a) => a.node), ['0.1']);
});

test('the input spec and entries are not mutated', () => {
  const s = spec();
  const entries = [E('space', 'paddingT', 13, 12, ['0.0']), E('color', 'color', '#1a74e8', '#1a73e8', [{ node: '0.0.0', run: 1 }]),
    E('type', 'lineHeight', 20.8, 21, ['0.0.0'], { status: 'answered' })];
  const s0 = structuredClone(s), e0 = structuredClone(entries);
  applyNorm(s, entries, 's1');
  assert.deepEqual(s, s0);
  assert.deepEqual(entries, e0);
});

test('end to end: inventory -> normalize -> applyNorm; the inventory of the result shows the new values', () => {
  const ir = (sid) => ({
    id: sid, vars: {},
    tree: {
      id: '0', kind: 'frame', tag: 'main', cls: '', rA: [0, 0, 390, 800],
      kids: [0, 1, 2, 3, 4].map((i) => ({ id: `0.${i}`, kind: 'frame', tag: 'div', cls: 'card', rA: [0, 0, 100, 40] })),
    },
  });
  const sp = () => ({
    id: '0', t: 'F', w: 390, h: 800, sz: ['FIXED', 'FIXED'], model: 'figma', lay: lay(),
    kids: [12, 12, 12, 12, 13].map((p, i) => ({ id: `0.${i}`, t: 'F', w: 100, h: 40, sz: ['FILL', 'HUG'], lay: lay({ p: [p, 0, 0, 0] }) })),
  });
  const inv = inventory([{ screen: ir('s1'), spec: sp() }]);
  const { entries } = normalize(inv, { version: 1, answers: { 'major|space|13|12': 12 } }); // R97: the majority is a question
  assert.equal(entries.length, 1);
  const r = applyNorm(sp(), entries, 's1');
  assert.equal(r.applied.length, 1);
  const after = inventory([{ screen: ir('s1'), spec: r.spec }]).uses.filter((u) => u.prop === 'paddingT').map((u) => u.value);
  assert.deepEqual(after, [12, 12, 12, 12, 12]);
});

test('R74: SRC_SQUASH on a FILL icon axis restores FIXED at `to`; the record carries szFrom; other codes still throw', () => {
  const s = spec();
  find(s, '0.1.1').sz = ['FILL', 'FIXED'];
  const e = E('icon', 'width', 18, 24, ['0.1.1'], { code: 'SRC_SQUASH', status: 'answered' });
  const r = applyNorm(s, [e], 's1');
  const n = find(r.spec, '0.1.1');
  assert.deepEqual([n.sz, n.w, n.h], [['FIXED', 'FIXED'], 24, 18]);
  assert.deepEqual(r.applied, [{ entry: e.id, cat: 'icon', code: 'SRC_SQUASH', node: '0.1.1', prop: 'width', from: 18, to: 24, szFrom: 'FILL' }]);
  assert.deepEqual(find(s, '0.1.1').sz, ['FILL', 'FIXED']); // input untouched
  assert.throws(() => applyNorm(s, [E('icon', 'width', 18, 20, ['0.1.1'], { id: 'if', code: 'ICON_FRAME', status: 'answered' })], 's1'), /if.*0\.1\.1.*width.*FILL/);
  // replayed on another spec (pipeline replayApplied): the record's szFrom comes from that spec, the change is the same
  const again = applyNorm(s, [{ ...e, status: 'auto' }], 's1');
  assert.equal(find(again.spec, '0.1.1').sz[0], 'FIXED');
});
