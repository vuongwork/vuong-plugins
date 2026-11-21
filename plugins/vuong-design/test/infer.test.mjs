import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScreens } from '../core/capture.mjs';
import { inferScreen } from '../core/infer.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

const walk = (n, out = []) => { out.push(n); (n.kids || []).forEach((k) => walk(k, out)); return out; };
const hasCls = (n, c) => String(n.cls || '').split(/\s+/).includes(c);
const EPS = 0.75;

// ---- helpers over a captured screen and its spec ----

function ctx(screen) {
  const res = inferScreen(screen);
  const inodes = walk(screen.tree);
  const snodes = walk(res.spec);
  const byId = new Map(snodes.map((s) => [s.id, s]));
  const src = new Map(inodes.map((n) => [n.id, n]));
  const node = (cls) => {
    const i = inodes.find((n) => hasCls(n, cls));
    assert.ok(i, `fixture has an element .${cls}`);
    const s = byId.get(i.id);
    assert.ok(s, `spec has node ${i.id} (.${cls})`);
    return s;
  };
  // box at width A of any spec node: source box, or union of flow kids for a synthetic frame
  const box = (s) => {
    if (!s.syn) return src.get(s.id).rA;
    const rs = s.kids.filter((k) => !k.abs).map(box);
    const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
    const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
    return [x0, y0, x1 - x0, y1 - y0];
  };
  return { ...res, inodes, snodes, byId, node, box };
}

const FIXTURES = ['row-gap', 'push', 'proximity', 'overlap', 'overflow', 'sizing', 'text', 'flags', 'baseline', 'raster', 'noflags'];
const C = {};
before(async () => {
  if (skip) return;
  for (const f of FIXTURES) {
    const { screens } = await captureScreens(join(FIX, `infer-${f}.html`), { root: '.scr' });
    C[f] = { screen: screens[0], ...ctx(screens[0]) };
  }
});

// ---- per-behaviour fixtures ----

test('row-gap: three items 8 apart → horizontal with gap 8', { skip }, () => {
  const row = C['row-gap'].node('row');
  assert.equal(row.lay.d, 'H');
  assert.equal(row.lay.g, 8);
  assert.equal(row.kids.length, 3);
  assert.deepEqual([row.lay.p[0], row.lay.p[2], row.lay.p[3]], [8, 8, 8]);
});

test('push: chip pushed right → space-between, no fixed spacer frames', { skip }, () => {
  const c = C.push;
  const bar = c.node('bar');
  const sbSomewhere = bar.lay.sb === 1 || (bar.kids || []).some((k) => k.syn && k.lay && k.lay.sb === 1);
  assert.ok(sbSomewhere, `bar.lay = ${JSON.stringify(bar.lay)}`);
  const spacers = c.snodes.filter((s) => s.syn && s.sz && s.sz[0] === 'FIXED' && !(s.kids && s.kids.length));
  assert.deepEqual(spacers.map((s) => s.id), []);
});

test('proximity: gaps 0,12,16,8,16,8 → grouped, every container gap uniform', { skip }, () => {
  const c = C.proximity;
  assert.ok(c.snodes.some((s) => s.syn), 'at least one synthetic group');
  for (const s of c.snodes) {
    if (!s.lay || s.lay.wrap || s.lay.g === undefined) continue;
    const P = s.lay.d === 'H' ? 0 : 1;
    const flow = s.kids.filter((k) => !k.abs).map(c.box).sort((a, b) => a[P] - b[P]);
    for (let i = 1; i < flow.length; i++) {
      const g = flow[i][P] - (flow[i - 1][P] + flow[i - 1][P + 2]);
      assert.ok(Math.abs(g - s.lay.g) <= EPS, `${s.id}: gap ${g} vs lay.g ${s.lay.g}`);
    }
  }
});

test('overlap: badge over icon → absolute with a Figma constraint', { skip }, () => {
  const badge = C.overlap.node('badge');
  assert.ok(badge.abs, 'badge is absolute');
  assert.ok(['L', 'R', 'LR', 'C'].includes(badge.abs.c), `c = ${badge.abs.c}`);
  assert.equal(C.overlap.node('icon').abs, undefined);
});

test('overflow: button sticking 4px above the bar → absolute at y = -4', { skip }, () => {
  const fab = C.overflow.node('fab');
  assert.ok(fab.abs, 'fab is absolute');
  assert.equal(fab.abs.y, -4);
  assert.equal(fab.abs.c, 'C');
});

test('sizing: flex:1 cell FILL, short label HUG, 40px avatar FIXED', { skip }, () => {
  const c = C.sizing;
  assert.equal(c.node('cell').sz[0], 'FILL');
  assert.equal(c.node('lbl').sz[0], 'HUG');
  assert.equal(c.node('av').sz[0], 'FIXED');
  assert.equal(c.node('av').w, 40);
});

test('text: single line HUG, wrapped FIXED at width A, stretched FILL', { skip }, () => {
  const c = C.text;
  const one = c.node('one'), narrow = c.node('narrow'), fill = c.node('fill');
  assert.equal(one.t, 'T');
  assert.equal(one.sz[0], 'HUG');
  assert.equal(narrow.sz[0], 'FIXED');
  assert.equal(narrow.w, 120);
  assert.equal(fill.sz[0], 'FILL');
});

test('flags: shrink, weightedFill and spaceAround on the right nodes', { skip }, () => {
  const c = C.flags;
  const has = (kind, cls) => c.flags.some((f) => f.kind === kind && f.id === c.node(cls).id);
  assert.ok(has('shrink', 'sq'), JSON.stringify(c.flags));
  assert.ok(has('weightedFill', 'w2'), JSON.stringify(c.flags));
  assert.ok(has('weightedFill', 'w1'), JSON.stringify(c.flags));
  assert.ok(has('spaceAround', 'r3'), JSON.stringify(c.flags));
  for (const f of c.flags) assert.equal(typeof f.detail, 'string');
  const got = c.flags.map((f) => `${f.id} ${f.kind}`).sort();
  const want = [['sq', 'shrink'], ['w2', 'weightedFill'], ['w1', 'weightedFill'], ['r3', 'spaceAround']]
    .map(([cls, kind]) => `${c.node(cls).id} ${kind}`).sort();
  assert.deepEqual(got, want);
});

test('no flags on fixtures without unsupported behaviour (scroll row, fixed nowrap text, fitting items)', { skip }, () => {
  for (const f of FIXTURES.filter((x) => x !== 'flags' && x !== 'raster')) {
    assert.deepEqual(C[f].flags, [], `${f}: ${JSON.stringify(C[f].flags)}`);
  }
});

test('baseline: 22px title + 12.5px subtitle on one baseline → ca B, no wrapper', { skip }, () => {
  const c = C.baseline;
  const row = c.node('row');
  assert.equal(row.lay.d, 'H');
  assert.equal(row.lay.ca, 'B');
  assert.deepEqual(c.snodes.filter((s) => s.syn).map((s) => s.id), []);
  assert.equal(c.node('s').abs, undefined);
});

test('raster: filter blur and conic-gradient are flagged, linear-gradient is not', { skip }, () => {
  const c = C.raster;
  const raster = (cls) => c.flags.some((f) => f.kind === 'raster' && f.id === c.node(cls).id);
  assert.ok(raster('blur'));
  assert.ok(raster('cone'));
  assert.ok(!raster('lin'));
  assert.deepEqual(c.flags.map((f) => f.kind), ['raster', 'raster']);
});

// ---- invariants over every fixture ----

test('every source node appears exactly once; syn ids are <parent>.g<k>', { skip }, () => {
  for (const f of FIXTURES) {
    const c = C[f];
    const ids = c.snodes.filter((s) => !s.syn).map((s) => s.id);
    assert.deepEqual([...ids].sort(), c.inodes.map((n) => n.id).sort(), `${f}: source ids`);
    const all = c.snodes.map((s) => s.id);
    assert.equal(new Set(all).size, all.length, `${f}: unique ids`);
    const parentOf = new Map();
    for (const s of c.snodes) for (const k of s.kids || []) parentOf.set(k, s);
    for (const s of c.snodes.filter((x) => x.syn)) {
      assert.match(s.id, /\.g\d+$/, `${f}: ${s.id}`);
      assert.equal(s.id.replace(/\.g\d+$/, ''), parentOf.get(s).id, `${f}: ${s.id} prefix`);
    }
  }
});

test('no SCALE constraint, only Figma sizing values, no margins', { skip }, () => {
  for (const f of FIXTURES) {
    for (const s of C[f].snodes) {
      if (s.abs) assert.ok(['L', 'R', 'LR', 'C'].includes(s.abs.c), `${f} ${s.id}: c = ${s.abs.c}`);
      assert.ok(Array.isArray(s.sz) && s.sz.length === 2, `${f} ${s.id}: sz`);
      for (const v of s.sz) assert.ok(['FILL', 'HUG', 'FIXED'].includes(v), `${f} ${s.id}: sz ${v}`);
      assert.ok(['F', 'T', 'V', 'I'].includes(s.t), `${f} ${s.id}: t ${s.t}`);
      if (s.lay) {
        assert.ok(['H', 'V'].includes(s.lay.d));
        assert.equal(s.lay.p.length, 4);
        assert.ok(s.lay.p.every((v) => v >= 0));
        assert.ok(['S', 'C', 'E'].includes(s.lay.pa));
        assert.ok(['S', 'C', 'E', 'X', 'B'].includes(s.lay.ca));
      }
      assert.ok(!JSON.stringify(s).includes('margin'));
    }
  }
});

// ---- hand-built screens (no browser) ----

const N = (id, rA, rB, extra = {}) => ({ id, kind: 'frame', tag: 'div', cls: '', rA, rB, paint: {}, ...extra });
const screenOf = (tree, widen = { by: 120, requested: 120, breakpoints: [], unsafe: false }) => ({
  id: 's0', name: 's0', W: [tree.rA[2], tree.rB[2]], H: [tree.rA[3], tree.rB[3]], widen, tree, excluded: [], fonts: [],
});

test('unsafe widen → unsafeWiden flag on the root', () => {
  const tree = N('n', [0, 0, 300, 100], [0, 0, 420, 100], { kids: [N('n.0', [0, 0, 40, 40], [0, 0, 40, 40])] });
  const { flags } = inferScreen(screenOf(tree, { by: 120, requested: 120, breakpoints: [310], unsafe: true, reason: 'mốc 310' }));
  const f = flags.find((x) => x.kind === 'unsafeWiden');
  assert.ok(f);
  assert.equal(f.id, 'n');
  assert.match(f.detail, /310/);
});

test('lone child sized in percent → absolute with C or LR, never SCALE', () => {
  // 60% wide, centred: 300 → 180 at x 60; 420 → 252 at x 84
  const tree = N('n', [0, 0, 300, 100], [0, 0, 420, 100], { kids: [N('n.0', [60, 0, 180, 40], [84, 0, 252, 40])] });
  const { spec } = inferScreen(screenOf(tree));
  const k = spec.kids[0];
  assert.ok(k.abs);
  assert.ok(['C', 'LR'].includes(k.abs.c), k.abs.c);
});

test('node missing at width B is kept and treated as unchanged', () => {
  const tree = N('n', [0, 0, 300, 100], [0, 0, 420, 100], {
    kids: [N('n.0', [0, 0, 40, 40], [0, 0, 40, 40]), N('n.1', [48, 0, 40, 40], null)],
  });
  const { spec } = inferScreen(screenOf(tree));
  assert.deepEqual(walk(spec).map((s) => s.id).sort(), ['n', 'n.0', 'n.1']);
});

test('1fr grid with a content floor → FILL with min width on the wider cell', () => {
  // A: 150 / 98 / 40 (content floor on the first), B: 184 / 184 / 40
  const tree = N('n', [0, 0, 300, 40], [0, 0, 420, 40], {
    kids: [
      N('n.0', [0, 0, 150, 40], [0, 0, 184, 40]),
      N('n.1', [158, 0, 98, 40], [192, 0, 184, 40]),
      N('n.2', [264, 0, 36, 40], [384, 0, 36, 40]),
    ],
  });
  const { spec, flags } = inferScreen(screenOf(tree));
  const [a, b] = spec.kids;
  assert.deepEqual([a.sz[0], b.sz[0]], ['FILL', 'FILL']);
  assert.equal(a.min, 150);
  assert.equal(b.min, undefined);
  assert.equal(flags.filter((f) => f.kind === 'weightedFill').length, 0);
});

test('single FILL child that stops growing → FILL with max width', () => {
  // row: FILL grows 60 while the row grows 120, the fixed sibling stays 8 after it
  const tree = N('n', [0, 0, 300, 40], [0, 0, 420, 40], {
    kids: [N('n.0', [0, 0, 250, 40], [0, 0, 310, 40]), N('n.1', [258, 0, 42, 40], [318, 0, 42, 40])],
  });
  const { spec } = inferScreen(screenOf(tree));
  const k = spec.kids.find((s) => s.id === 'n.0');
  assert.equal(spec.lay.d, 'H');
  assert.equal(k.sz[0], 'FILL');
  assert.equal(k.max, 310);
});

test('frame whose size equals content + padding at both widths → HUG', () => {
  const tree = N('n', [0, 0, 300, 100], [0, 0, 420, 100], {
    kids: [N('n.0', [10, 10, 60, 30], [10, 10, 60, 30], {
      paint: { bg: 'rgb(0, 0, 0)' },
      kids: [N('n.0.0', [18, 15, 44, 20], [18, 15, 44, 20])],
    })],
  });
  const { spec } = inferScreen(screenOf(tree));
  const chip = spec.kids[0];
  assert.deepEqual(chip.sz, ['HUG', 'HUG']);
  assert.deepEqual(chip.lay.p, [5, 8, 5, 8]);
});

test('free space on a non-HUG axis goes to alignment, not padding', () => {
  // root V, child pinned at top-left; root is FIXED so the bottom/right space is not padding
  const tree = N('n', [0, 0, 300, 100], [0, 0, 420, 100], {
    kids: [N('n.0', [10, 10, 40, 40], [10, 10, 40, 40])],
  });
  const { spec } = inferScreen(screenOf(tree));
  assert.deepEqual(spec.lay.p, [10, 0, 0, 10]);
  assert.equal(spec.lay.pa, 'S');
  assert.equal(spec.lay.ca, 'S');
});
