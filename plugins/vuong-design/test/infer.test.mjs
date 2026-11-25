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

const FIXTURES = ['row-gap', 'push', 'proximity', 'overlap', 'overflow', 'sizing', 'text', 'flags', 'baseline', 'raster', 'noflags', 'zorder', 'percent'];
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
  // equal grow, non-zero basis, different final sizes: Figma FILL behaves like basis 0
  const a1 = c.flags.find((f) => f.kind === 'weightedFill' && f.id === c.node('a1').id);
  assert.ok(a1, JSON.stringify(c.flags));
  assert.match(a1.detail, /basis/);
  for (const f of c.flags) assert.equal(typeof f.detail, 'string');
  const got = c.flags.map((f) => `${f.id} ${f.kind}`).sort();
  // plan 3 Task 2: with the measured facts (shrinkFill ok/ok) the squeezed FILL item is also modelled (info flag)
  const want = [['sq', 'shrink'], ['sq', 'shrinkModelled'], ['w2', 'weightedFill'], ['w1', 'weightedFill'], ['r3', 'spaceAround'],
    ['a1', 'weightedFill'], ['a2', 'weightedFill']]
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

test('R39: children are ordered by CSS paint order (positioned above flow, negative z below)', { skip }, () => {
  const c = C.zorder;
  const badge = c.node('badge'), icon = c.node('icon'), under = c.node('under'), icon2 = c.node('icon2');
  assert.equal(badge.paint.pos, 'absolute', 'capture records the position of the badge');
  assert.equal(badge.paint.z, undefined);
  assert.equal(under.paint.z, -1);
  const order = (id) => c.snodes.find((s) => (s.kids || []).some((k) => k.id === id)).kids.map((k) => k.id);
  const o1 = order(badge.id), o2 = order(under.id);
  assert.ok(o1.indexOf(icon.id) < o1.indexOf(badge.id), JSON.stringify(o1));
  assert.ok(o2.indexOf(under.id) < o2.indexOf(icon2.id), JSON.stringify(o2));
});

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

// R47: SCALE (per axis) only where the source node authored a % on that axis; a syn anchor wrapper carries the
// SCALE of its single child's % position
const pctAxis = (n, ax) => !!(n && n.pct) && (ax ? ['t', 'b', 'h'] : ['l', 'r', 'w']).some((q) => n.pct[q]);
test('SCALE only for % authored absolute nodes (R47), only Figma sizing values, no margins', { skip }, () => {
  for (const f of FIXTURES) {
    const src = new Map(C[f].inodes.map((n) => [n.id, n]));
    for (const s of C[f].snodes) {
      if (s.abs) {
        assert.ok(['L', 'R', 'LR', 'C', 'SCALE'].includes(s.abs.c), `${f} ${s.id}: c = ${s.abs.c}`);
        assert.ok([undefined, 'B', 'TB', 'C', 'SCALE'].includes(s.abs.cy), `${f} ${s.id}: cy = ${s.abs.cy}`);
        const owner = s.syn === 'anchor' ? src.get(s.kids[0].id) : src.get(s.id);
        if (s.abs.c === 'SCALE') assert.ok(pctAxis(owner, 0), `${f} ${s.id}: SCALE x without a % on x`);
        if (s.abs.cy === 'SCALE') assert.ok(pctAxis(owner, 1), `${f} ${s.id}: SCALE y without a % on y`);
      }
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

test('R36: counter-axis alignment is chosen by smallest residual, not loop order', () => {
  // row with padding 9: text 19.5 tall at y 9, icon 18 tall at y 9.75 → both fit S within EPS, both fit C exactly
  const tree = N('n', [0, 0, 300, 37.5], [0, 0, 420, 37.5], {
    kids: [N('n.0', [10, 9.75, 18, 18], [10, 9.75, 18, 18]), N('n.1', [36, 9, 100, 19.5], [36, 9, 100, 19.5])],
  });
  const { spec } = inferScreen(screenOf(tree));
  assert.equal(spec.lay.d, 'H');
  assert.equal(spec.lay.ca, 'C');
  assert.deepEqual(spec.kids.filter((k) => k.syn).map((k) => k.id), []);
});

test('R37: wrap row end padding sits mid-slack, cross alignment fitted per row', () => {
  // 5 chips 90 wide, gap 8, rows 8 apart; the 27-high chip n.1 centres its 25-high neighbours (y 1)
  // A (300): 3 + 2 per row, fullest line ends at 286 (slack 14); B (420): 4 + 1, fullest line ends at 384
  const chip = (i, A, B, h = 25) => N(`n.${i}`, [A[0], A[1], 90, h], [B[0], B[1], 90, h]);
  const tree = N('n', [0, 0, 300, 60], [0, 0, 420, 60], {
    kids: [
      chip(0, [0, 1], [0, 1]), chip(1, [98, 0], [98, 0], 27), chip(2, [196, 1], [196, 1]),
      chip(3, [0, 35], [294, 1]), chip(4, [98, 35], [0, 35]),
    ],
  });
  const { spec } = inferScreen(screenOf(tree));
  assert.equal(spec.lay.wrap, 1);
  assert.equal(spec.lay.ca, 'C');
  // feasible end padding at both widths: [0, 14] ∩ [0, 36] → midpoint 7, not the exact slack 14
  assert.equal(spec.lay.p[1], 7);
});

test('R38: FILL siblings keep the end padding that equalises their content share', () => {
  // two equal FILL cells (flex 1 1 0): cell 0 has its content 10 in, cell 1 at its left edge. CSS and Figma give each
  // FILL item its own padding plus an equal share, so cell 1 needs end padding 10 or the split becomes 151 / 141.
  const cells = (extra0 = {}, extra1 = {}) => N('n', [0, 0, 300, 40], [0, 0, 420, 40], {
    kids: [
      N('n.0', [0, 0, 146, 40], [0, 0, 206, 40], { ...extra0, kids: [N('n.0.0', [10, 0, 50, 40], [10, 0, 50, 40])] }),
      N('n.1', [154, 0, 146, 40], [214, 0, 206, 40], { ...extra1, kids: [N('n.1.0', [154, 0, 50, 40], [214, 0, 50, 40])] }),
    ],
  });
  const { spec } = inferScreen(screenOf(cells()));
  const [c0, c1] = spec.kids;
  assert.deepEqual([c0.sz[0], c1.sz[0]], ['FILL', 'FILL']);
  assert.equal(c0.lay.p[3] + c0.lay.p[1], 10);
  assert.equal(c1.lay.p[3] + c1.lay.p[1], 10);
  // guard: FILL items flagged weightedFill keep the plain normalisation (their split is already excused)
  const g = inferScreen(screenOf(cells({ flex: { g: 1, s: 1, b: '0%' } }, { flex: { g: 2, s: 1, b: '0%' } })));
  assert.ok(g.flags.some((f) => f.kind === 'weightedFill'));
  assert.equal(g.spec.kids[1].lay.p[1], 0);
});

test('R42: equal tracks with centred items → FILL track wrappers (min = item width), items centred', () => {
  // grid repeat(4, 1fr), gap 18, padding 10, items 56 centred. A (296): tracks hit the 56 floor; B (416): tracks 85.5
  const item = (i) => N(`n.${i}`, [10 + i * 74, 10, 56, 56], [24.75 + i * 103.5, 10, 56, 56]);
  const tree = N('n', [0, 0, 296, 76], [0, 0, 416, 76], { kids: [0, 1, 2, 3].map(item) });
  const { spec } = inferScreen(screenOf(tree));
  assert.equal(spec.lay.d, 'H');
  assert.equal(spec.lay.sb, undefined);
  assert.equal(spec.lay.g, 18);
  assert.equal(spec.kids.length, 4);
  for (const [i, t] of spec.kids.entries()) {
    assert.ok(t.syn, `track ${i} is a synthetic wrapper`);
    assert.equal(t.sz[0], 'FILL');
    assert.equal(t.min, 56);
    assert.equal(t.lay.pa, 'C');
    assert.deepEqual(t.kids.map((k) => k.id), [`n.${i}`]);
  }
  assert.equal(spec.lay.p[3], 10);
});

test('R47: capture reads authored % of absolute nodes (computed values are px)', { skip }, () => {
  const c = C.percent;
  const inode = (cls) => c.inodes.find((n) => hasCls(n, cls));
  assert.deepEqual(inode('fill').pct, { w: '60%' });
  assert.deepEqual(inode('mark').pct, { l: '58%' });
  assert.deepEqual(inode('badge').pct, { l: '52%' });
  assert.equal(inode('full').pct, undefined);
  assert.equal(inode('pin').pct, undefined);
  assert.equal(inode('bar').pct, undefined, 'relative (not absolute) nodes carry no pct');
});

test('R47: % fill → SCALE; % left with a fixed / auto size → zero-width SCALE anchor; px-only absolute never SCALE', { skip }, () => {
  const c = C.percent;
  const fill = c.node('fill');
  assert.equal(fill.abs.c, 'SCALE');
  assert.equal(fill.abs.cy, undefined, 'top:0; bottom:0 in a parent of constant height: T');
  const parentOf = (s) => c.snodes.find((p) => (p.kids || []).includes(s));
  for (const cls of ['mark', 'badge']) {
    const k = c.node(cls), a = parentOf(k);
    assert.equal(a.syn, 'anchor', `${cls} sits in an anchor wrapper`);
    assert.equal(a.kids.length, 1);
    assert.equal(a.w, 0);
    assert.equal(a.abs.c, 'SCALE');
    assert.equal(a.abs.cy, undefined, `${cls}: y is px (top)`);
    assert.equal(a.h, k.h);
    assert.deepEqual([k.abs.x, k.abs.y, k.abs.c, k.abs.cy], [0, 0, 'L', undefined]);
    assert.equal(a.paint, undefined);
  }
  const full = c.node('full');
  assert.ok(full.abs, 'full is absolute');
  assert.equal(full.abs.c, 'LR', 'spans the parent: geometry fits SCALE, but nothing is authored in %');
});

test('R47: the proxy of the inferred spec reproduces the % nodes at A and B', { skip }, async () => {
  const { buildProxyHtml, renderProxy } = await import('../core/proxy.mjs');
  const { defaultFontMap } = await import('../core/font-map.mjs');
  const { launchBrowser } = await import('../core/browser.mjs');
  const c = C.percent, s = c.screen;
  const browser = await launchBrowser();
  try {
    const h = buildProxyHtml(c.spec, s.svgDefs || {}, defaultFontMap(), { webFonts: false });
    for (const [i, M] of [[0, 'rA'], [1, 'rB']]) {
      const { boxes } = await renderProxy(browser, h, s.W[i]);
      for (const cls of ['fill', 'mark', 'badge', 'full']) {
        const n = c.inodes.find((x) => hasCls(x, cls));
        const d = boxes[n.id].map((v, j) => v - n[M][j]);
        // the badge's text renders in the offline fallback font here: its own width is not the point, its place is
        const ds = cls === 'badge' ? d.slice(0, 2) : d;
        assert.ok(ds.every((v) => Math.abs(v) <= 0.5), `${cls} @${'AB'[i]}: ${JSON.stringify(d)}`);
      }
    }
  } finally { await browser.close(); }
});

test('R47: geometry alone never gives SCALE; an authored % does (hand-built)', () => {
  // child spans x 30..90 of 300 at A and 42..126 of 420 at B: x/W and w/W constant
  const kid = (extra) => N('n.1', [30, 50, 60, 10], [42, 50, 84, 10], { paint: { pos: 'absolute' }, ...extra });
  const tree = (extra) => N('n', [0, 0, 300, 100], [0, 0, 420, 100], {
    kids: [N('n.0', [0, 0, 300, 60], [0, 0, 420, 60]), kid(extra)],
  });
  const plain = inferScreen(screenOf(tree({}))).spec.kids.find((k) => k.id === 'n.1');
  assert.ok(plain.abs);
  assert.notEqual(plain.abs.c, 'SCALE');
  const pct = inferScreen(screenOf(tree({ pct: { l: '10%', w: '20%' } }))).spec.kids.find((k) => k.id === 'n.1');
  assert.equal(pct.abs.c, 'SCALE');
  assert.equal(pct.abs.cy, undefined);
  // authored % whose geometry does not scale (containing block is not the parent) → no SCALE, best fixed constraint
  const off = inferScreen(screenOf(N('n', [0, 0, 300, 100], [0, 0, 420, 100], {
    kids: [N('n.0', [0, 0, 300, 60], [0, 0, 420, 60]), N('n.1', [30, 50, 60, 10], [30, 50, 60, 10], { paint: { pos: 'absolute' }, pct: { l: '10%' } })],
  }))).spec.kids.find((k) => k.id === 'n.1');
  assert.equal(off.abs.c, 'L');
});

// ---- plan 3 Task 2: measured Figma facts (core/figma-facts.json); every test passes `facts` explicitly ----
const FACTS = { version: 1, measured: null, lineHeightFrac: 'keep', textBox: 'ceil', scaleBasis: 'frame', zeroWidthAnchor: 'ok',
  scaleInHug: 'ok', strokeOverlay: 'ok', shrinkFill: { maxWidth: 'ok', growText: 'ok' }, baseline: 'ok' };
const facts = (o = {}) => ({ ...FACTS, ...o });
const NO_SHRINK = { shrinkFill: { maxWidth: 'no', growText: 'no' } };
// planora s3 `.say`: a centred row (272 -> 368) of an avatar (natural 34) and a bubble (natural 302.5), gap 9; both
// squeezed at A by flex-shrink, both at their natural width (centred) at B
const sayRow = () => screenOf(N('n', [0, 0, 272, 34], [0, 0, 368, 34], {
  flexBox: { jc: 'center', fd: 'row', ov: false },
  kids: [
    N('n.0', [0, 0, 26, 34], [11.25, 0, 34, 34], { flex: { g: 0, s: 1, b: 'auto', ax: 'x', n: 34 } }),
    N('n.1', [35, 0, 237, 34], [54.25, 0, 302.5, 34], { flex: { g: 0, s: 1, b: 'auto', ax: 'x', n: 302.5 } }),
  ],
}));
// an absolute child authored in % inside a parent p; p hugs its 100 x 20 flow child at both widths when `hug`
const pctScreen = ({ border = false, pct = { l: '10%', w: '20%' }, hug = false } = {}) => {
  const kid = hug
    ? N('n.0.1', [10, 0, 20, 10], [10, 0, 20, 10], { paint: { pos: 'absolute' }, pct })
    : N('n.0.1', [30, 5, 60, 10], [42, 5, pct.w ? 84 : 60, 10], { paint: { pos: 'absolute' }, pct });
  const p = hug
    ? N('n.0', [0, 0, 100, 20], [0, 0, 100, 20], { kids: [N('n.0.0', [0, 0, 100, 20], [0, 0, 100, 20]), kid] })
    : N('n.0', [0, 0, 300, 60], [0, 0, 420, 60], {
      paint: border ? { border: [{ w: 2 }, { w: 2 }, { w: 2 }, { w: 2 }] } : {},
      kids: [N('n.0.0', [0, 0, 300, 20], [0, 0, 420, 20]), kid],
    });
  return screenOf(N('n', [0, 0, 300, 100], [0, 0, 420, 100], { kids: [p] }));
};
const byIdOf = (spec) => new Map(walk(spec).map((s) => [s.id, s]));
// inferScreen's output before the facts existed (recorded from the plan-1/2 code)
const BEFORE = {
  say: '{"spec":{"id":"n","t":"F","w":272,"h":34,"lay":{"d":"H","p":[0,0,0,0],"g":9,"pa":"C","ca":"S"},"kids":[{"id":"n.0","t":"F","w":26,"h":34,"sz":["FILL","FIXED"]},{"id":"n.1","t":"F","w":237,"h":34,"sz":["FILL","FIXED"]}],"sz":["FIXED","FIXED"]},"flags":[{"id":"n.0","kind":"shrink","detail":"flex-shrink 1: 26px instead of 34px"},{"id":"n.1","kind":"shrink","detail":"flex-shrink 1: 237px instead of 302.5px"},{"id":"n.0","kind":"weightedFill","detail":"equal flex-grow 0 on basis auto/auto, sizes 26/237"},{"id":"n.1","kind":"weightedFill","detail":"equal flex-grow 0 on basis auto/auto, sizes 26/237"}]}',
  pct: '{"spec":{"id":"n","t":"F","w":300,"h":100,"lay":{"d":"V","p":[0,0,0,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0","t":"F","w":300,"h":60,"lay":{"d":"V","p":[0,0,40,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0.0","t":"F","w":300,"h":20,"sz":["FILL","FIXED"]},{"id":"n.0.1","t":"F","w":60,"h":10,"paint":{"pos":"absolute"},"abs":{"x":30,"y":5,"c":"SCALE"},"sz":["FIXED","FIXED"]}],"sz":["FILL","HUG"]}],"sz":["FIXED","FIXED"]},"flags":[]}',
  border: '{"spec":{"id":"n","t":"F","w":300,"h":100,"lay":{"d":"V","p":[0,0,0,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0","t":"F","w":300,"h":60,"paint":{"border":[{"w":2},{"w":2},{"w":2},{"w":2}]},"lay":{"d":"V","p":[0,0,40,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0.0","t":"F","w":300,"h":20,"sz":["FILL","FIXED"]},{"id":"n.0.1","t":"F","w":60,"h":10,"paint":{"pos":"absolute"},"abs":{"x":30,"y":5,"c":"SCALE"},"sz":["FIXED","FIXED"]}],"sz":["FILL","HUG"]}],"sz":["FIXED","FIXED"]},"flags":[]}',
  anchor: '{"spec":{"id":"n","t":"F","w":300,"h":100,"lay":{"d":"V","p":[0,0,0,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0","t":"F","w":300,"h":60,"lay":{"d":"V","p":[0,0,40,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0.0","t":"F","w":300,"h":20,"sz":["FILL","FIXED"]},{"id":"n.0.g0","t":"F","syn":"anchor","w":0,"h":10,"sz":["FIXED","FIXED"],"abs":{"x":30,"y":5,"c":"SCALE"},"kids":[{"id":"n.0.1","t":"F","w":60,"h":10,"paint":{"pos":"absolute"},"abs":{"x":0,"y":0,"c":"L"},"sz":["FIXED","FIXED"]}]}],"sz":["FILL","HUG"]}],"sz":["FIXED","FIXED"]},"flags":[]}',
  hug: '{"spec":{"id":"n","t":"F","w":300,"h":100,"lay":{"d":"V","p":[0,0,0,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0","t":"F","w":100,"h":20,"lay":{"d":"V","p":[0,0,0,0],"g":0,"pa":"S","ca":"S"},"kids":[{"id":"n.0.0","t":"F","w":100,"h":20,"sz":["FIXED","FIXED"]},{"id":"n.0.1","t":"F","w":20,"h":10,"paint":{"pos":"absolute"},"abs":{"x":10,"y":0,"c":"SCALE"},"sz":["FIXED","FIXED"]}],"sz":["HUG","HUG"]}],"sz":["FIXED","FIXED"]},"flags":[]}',
};
const out = (r) => JSON.stringify({ spec: r.spec, flags: r.flags });

test('facts: measured defaults change nothing but shrinkFill; shrinkFill no/no gives the earlier spec', () => {
  for (const [k, s] of [['pct', pctScreen()], ['border', pctScreen({ border: true })], ['anchor', pctScreen({ pct: { l: '10%' } })], ['hug', pctScreen({ hug: true })]]) {
    assert.equal(out(inferScreen(s, { facts: facts() })), BEFORE[k], k);
  }
  assert.equal(out(inferScreen(sayRow(), { facts: facts(NO_SHRINK) })), BEFORE.say);
  assert.equal(out(inferScreen(sayRow(), { facts: facts({ shrinkFill: { maxWidth: 'ok', growText: 'no' } }) })), BEFORE.say, 'maxWidth alone: nothing special');
});

test('facts shrinkFill ok/ok: only the most squeezed item is FILL + max; its squeezed siblings are FIXED at A', () => {
  const { spec, flags } = inferScreen(sayRow(), { facts: facts() });
  const by = byIdOf(spec);
  // bubble squeezed 65.5 px, avatar 8 px: the bubble fills the rest of the row at A and stops at 302.5
  assert.deepEqual([by.get('n.1').sz[0], by.get('n.1').max], ['FILL', 302.5]);
  assert.deepEqual([by.get('n.0').sz[0], by.get('n.0').w, by.get('n.0').max], ['FIXED', 26, undefined]);
  const of = (kind) => flags.filter((f) => f.kind === kind).map((f) => f.id).sort();
  assert.deepEqual(of('shrink'), ['n.0', 'n.1'], 'shrink still explains the FIXED avatar at B');
  assert.deepEqual(of('shrinkModelled'), ['n.1']);
  assert.deepEqual(of('weightedFill'), [], 'one FILL item left: no weighted split');
  // growText alone: the same choice, no max from shrinkFill (the single-FILL rule still caps a lone FILL child at its B size)
  const g = inferScreen(sayRow(), { facts: facts({ shrinkFill: { maxWidth: 'no', growText: 'ok' } }) });
  const gb = byIdOf(g.spec);
  assert.deepEqual([gb.get('n.1').sz[0], gb.get('n.0').sz[0]], ['FILL', 'FIXED']);
  assert.deepEqual(g.flags.filter((f) => f.kind === 'shrinkModelled').map((f) => f.id), ['n.1']);
});

test("facts scaleBasis 'padding': SCALE only when the parent has no border; a bordered parent gets the fixed constraint", () => {
  const kid = (r) => byIdOf(r.spec).get('n.0.1');
  const plain = inferScreen(pctScreen(), { facts: facts({ scaleBasis: 'padding' }) });
  assert.equal(kid(plain).abs.c, 'SCALE');
  assert.equal(plain.flags.length, 0);
  const b = inferScreen(pctScreen({ border: true }), { facts: facts({ scaleBasis: 'padding' }) });
  assert.ok(['L', 'R', 'LR', 'C'].includes(kid(b).abs.c), kid(b).abs.c);
  assert.deepEqual(b.flags.map((f) => [f.id, f.kind]), [['n.0.1', 'scaleBasis']]);
});

test("facts zeroWidthAnchor 'moves': a % inset with a fixed size keeps a fixed constraint, no anchor wrapper", () => {
  const r = inferScreen(pctScreen({ pct: { l: '10%' } }), { facts: facts({ zeroWidthAnchor: 'moves' }) });
  const by = byIdOf(r.spec);
  assert.ok(!walk(r.spec).some((s) => s.syn === 'anchor'));
  assert.equal(by.get('n.0.1').abs.c, 'L');
  assert.equal(by.get('n.0.1').abs.x, 30);
  assert.deepEqual(r.flags.map((f) => [f.id, f.kind]), [['n.0.1', 'noAnchor']]);
});

test("facts scaleInHug 'breaks': no SCALE for the child of a hugging parent", () => {
  const r = inferScreen(pctScreen({ hug: true }), { facts: facts({ scaleInHug: 'breaks' }) });
  const by = byIdOf(r.spec);
  assert.equal(by.get('n.0').sz[0], 'HUG');
  assert.notEqual(by.get('n.0.1').abs.c, 'SCALE');
  assert.deepEqual(r.flags.map((f) => [f.id, f.kind]), [['n.0.1', 'scaleInHug']]);
  // not hugging on that axis: SCALE stays
  assert.equal(byIdOf(inferScreen(pctScreen(), { facts: facts({ scaleInHug: 'breaks' }) }).spec).get('n.0.1').abs.c, 'SCALE');
});

test('facts shrinkFill: a space-between container keeps its earlier sizing (no FILL + max, no shrinkModelled)', () => {
  // planora s11 shape: two squeezed items at A (gap 8), at their natural sizes pushed apart at B
  const sbRow = () => screenOf(N('n', [0, 0, 244, 40], [0, 0, 364, 40], {
    flexBox: { jc: 'space-between', fd: 'row', ov: false },
    kids: [
      N('n.0', [0, 0, 164.81, 40], [0, 0, 216.56, 40], { flex: { g: 0, s: 1, b: 'auto', ax: 'x', n: 216.56 } }),
      N('n.1', [172.81, 0, 71.19, 40], [270.47, 0, 93.53, 40], { flex: { g: 0, s: 1, b: 'auto', ax: 'x', n: 93.53 } }),
    ],
  }));
  const r = inferScreen(sbRow(), { facts: facts() });
  assert.equal(r.spec.lay.sb, 1);
  assert.equal(out(r), out(inferScreen(sbRow(), { facts: facts(NO_SHRINK) })));
  assert.equal(r.flags.filter((f) => f.kind === 'shrinkModelled').length, 0);
  assert.equal(r.flags.filter((f) => f.kind === 'shrink').length, 2);
});
