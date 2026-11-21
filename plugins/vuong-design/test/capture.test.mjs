import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScreens, chooseWiden } from '../core/capture.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

const walk = (n, out = []) => { out.push(n); (n.kids || []).forEach((k) => walk(k, out)); return out; };

// ---- pure widen rule (no browser) ----

test('chooseWiden keeps the requested delta when no breakpoint is crossed', () => {
  const w = chooseWiden(300, [{ type: 'min', px: 600 }, { type: 'max', px: 200 }], 120);
  assert.deepEqual({ by: w.by, unsafe: w.unsafe }, { by: 120, unsafe: false });
  assert.deepEqual(w.breakpoints, [200, 600]);
});

test('chooseWiden lowers delta below a crossed min-width', () => {
  const w = chooseWiden(300, [{ type: 'min', px: 380 }, { type: 'min', px: 410 }], 120);
  assert.equal(w.by, 79);
  assert.equal(w.unsafe, false);
});

test('chooseWiden lowers delta to a crossed max-width', () => {
  const w = chooseWiden(300, [{ type: 'max', px: 360 }], 120);
  assert.equal(w.by, 60);
  assert.equal(w.unsafe, false);
});

test('chooseWiden flags unsafe and keeps requested delta when the safe delta is < 24', () => {
  const w = chooseWiden(300, [{ type: 'min', px: 310 }], 120);
  assert.equal(w.by, 120);
  assert.equal(w.unsafe, true);
  assert.match(w.reason, /310/);
});

// ---- browser capture ----

let basic;
before(async () => { if (!skip) basic = await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr' }); });

test('basic: one screen measured at native and native + 120', { skip }, () => {
  assert.equal(basic.screens.length, 1);
  const s = basic.screens[0];
  assert.deepEqual(s.W, [300, 420]);
  assert.deepEqual(s.H, [600, 600]);
  assert.equal(s.id, 's0');
  assert.equal(s.name, 's0');
  assert.equal(s.widen.by, 120);
  assert.equal(s.widen.requested, 120);
  assert.equal(s.tree.id, 'n');
  assert.deepEqual(s.tree.rA, [0, 0, 300, 600]);
  assert.deepEqual(s.tree.rB, [0, 0, 420, 600]);
});

test('basic: ::after becomes an 8x8 pseudo node', { skip }, () => {
  const ps = walk(basic.screens[0].tree).filter((n) => n.kind === 'pseudo');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].rA.slice(2), [8, 8]);
  assert.deepEqual(ps[0].rB.slice(2), [8, 8]);
  assert.ok(ps[0].paint.bg, 'pseudo keeps its background');
});

test('basic: <svg><use href="#i"> is an icon leaf with symbol id and color', { skip }, () => {
  const ic = walk(basic.screens[0].tree).filter((n) => n.kind === 'icon');
  assert.equal(ic.length, 1);
  assert.equal(ic[0].icon.ref, 'i');
  assert.equal(ic[0].icon.color, 'rgb(51, 51, 51)');
  assert.equal(ic[0].kids, undefined);
});

test('basic: Vietnamese text wraps at 300 but not at 420', { skip }, () => {
  const t = walk(basic.screens[0].tree).find((n) => n.kind === 'text' && n.runs?.[0]?.t?.startsWith('Xin chào'));
  assert.ok(t, 'text node found');
  assert.deepEqual(t.lines, [2, 1]);
  assert.equal(t.runs[0].t, 'Xin chào thế giới');
  assert.equal(t.font.lh, 40);
  assert.ok(t.rA[2] <= 300 && t.rB[2] > 300, `widths ${t.rA[2]} / ${t.rB[2]}`);
  assert.equal(t.rA[3], 80);
  assert.equal(t.rB[3], 40);
});

test('basic: nested mixed-style text keeps one run per style', { skip }, () => {
  const t = walk(basic.screens[0].tree).find((n) => n.kind === 'text' && n.runs?.[0]?.t?.startsWith('Chữ'));
  assert.ok(t, 'mixed text node found');
  assert.deepEqual(t.runs.map((r) => r.t), ['Chữ ', 'đậm', ' và ', 'nghiêng', ' lồng nhau']);
  assert.equal(t.runs[1].s.fw, '700');
  assert.equal(t.runs[3].s.fst, 'italic');
  assert.equal(t.runs[0].s, undefined);
  assert.equal(typeof t.font.lh, 'number', 'line-height normal recorded as measured px');
  assert.deepEqual(t.lines, [1, 1]);
});

test('basic: hidden elements are excluded with a reason, never nodes', { skip }, () => {
  const s = basic.screens[0];
  assert.equal(s.excluded.length, 2);
  assert.deepEqual(s.excluded.map((e) => e.reason).sort(), ['display:none', 'visibility:hidden']);
  const ids = new Set(walk(s.tree).map((n) => n.id));
  for (const e of s.excluded) assert.ok(!ids.has(e.path), `${e.path} must not be a node`);
  const texts = walk(s.tree).flatMap((n) => (n.runs || []).map((r) => r.t || ''));
  assert.ok(!texts.some((t) => t.includes('Ẩn')), 'hidden text is not in any run');
});

test('basic: node ids are stable paths, unique, and fonts are listed', { skip }, () => {
  const s = basic.screens[0];
  const nodes = walk(s.tree);
  const ids = nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^n(\.[0-9a-z]+)*$/);
  for (const n of nodes) {
    assert.ok(['frame', 'text', 'icon', 'image', 'pseudo'].includes(n.kind), n.kind);
    assert.equal(n.rA.length, 4); assert.equal(n.rB.length, 4);
    assert.equal(typeof n.paint, 'object');
  }
  assert.ok(s.fonts.includes('Courier New'), s.fonts.join(','));
});

test('root selector matching nothing rejects with "không tìm thấy màn" and the selector', { skip }, async () => {
  await assert.rejects(
    captureScreens(join(FIX, 'capture-basic.html'), { root: '.khong-co' }),
    (e) => e.message.includes('không tìm thấy màn') && e.message.includes('.khong-co'),
  );
});

test('zero-size and clipped elements are excluded with reasons; rotated box is measured un-rotated', { skip }, async () => {
  const ir = await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' });
  const s = ir.screens[0];
  assert.deepEqual(s.excluded.map((e) => e.reason).sort(), ['clipped', 'visibility:hidden', 'zero-size']);
  const rot = walk(s.tree).find((n) => n.cls === 'rot');
  assert.ok(rot, 'rotated node present');
  assert.deepEqual(rot.rA.slice(2), [100, 20]);
  assert.ok(rot.paint.transform, 'transform recorded in paint');
});

// Fixture variant written to a temp dir (cleaned) so the source fixture is never modified.
async function withVariant(edit, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'vd-bp-'));
  try {
    const p = join(dir, 'variant.html');
    writeFileSync(p, edit(readFileSync(join(FIX, 'capture-breakpoint.html'), 'utf8')));
    return await fn(p);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('visible child inside a visibility:hidden parent is kept; only the parent is excluded', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' })).screens[0];
  const hidden = s.excluded.find((e) => e.reason === 'visibility:hidden');
  const seen = walk(s.tree).find((n) => n.cls === 'seen');
  assert.ok(seen, 'visible child is a node');
  assert.ok(seen.id.startsWith(hidden.path + '.'), `${seen.id} under ${hidden.path}`);
  assert.equal(seen.runs[0].t, 'Thấy');
  const texts = walk(s.tree).flatMap((n) => (n.runs || []).map((r) => r.t || ''));
  assert.ok(!texts.some((t) => t.includes('Ẩn')), 'hidden parent text is not a run');
});

test('a childless zero-height box that paints (box-shadow) is kept', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' })).screens[0];
  const line = walk(s.tree).find((n) => n.cls === 'line');
  assert.ok(line, 'divider kept');
  assert.equal(line.rA[3], 0);
  assert.ok(line.paint.shadow);
});

test('bare text under white-space:pre keeps its spaces', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' })).screens[0];
  const pre = walk(s.tree).find((n) => n.cls === 'pre');
  assert.equal(pre.kids[0].runs[0].t, 'a   b');
});

test('pseudo present only at width B does not shift sibling ids', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-pseudo-bp.html'), { root: '.scr', viewport: 300 })).screens[0];
  assert.deepEqual(s.W, [300, 420]);
  const row = walk(s.tree).find((n) => n.cls === 'row');
  const xs = row.kids.filter((n) => n.cls === 'x');
  assert.deepEqual(xs.map((n) => n.id), [`${row.id}.0`, `${row.id}.1`]);
  for (const x of xs) assert.ok(x.rB, `${x.id} matched at B`);
  assert.ok(xs[0].rB[0] > xs[0].rA[0], 'the ::before at B pushes the first item right');
  assert.ok(s.excluded.some((e) => e.path === `${row.id}.b` && e.reason === 'only-at-B'), JSON.stringify(s.excluded));
});

test('breakpoint: viewport-bound root, widen is lowered to stay under min-width 380', { skip }, async () => {
  const ir = await captureScreens(join(FIX, 'capture-breakpoint.html'), { root: '.scr', viewport: 300 });
  const s = ir.screens[0];
  assert.equal(s.widen.by, 79);
  assert.deepEqual(s.W, [300, 379]);
  assert.equal(s.widen.unsafe, false);
  assert.deepEqual(s.widen.breakpoints, [380]);
  // real behaviour: at 379 the min-width:380 rule is still off, so both items stay on one row
  const items = walk(s.tree).filter((n) => n.cls === 'item');
  assert.equal(items.length, 2);
  assert.equal(items[0].rB[1], items[1].rB[1]);
  assert.ok(items[1].rB[0] > items[0].rB[0]);
});

test('breakpoint: a 310 breakpoint leaves no safe delta -> unsafe, by 120', { skip }, async () => {
  await withVariant((src) => src.replace('380px', '310px'), async (p) => {
    const s = (await captureScreens(p, { root: '.scr', viewport: 300 })).screens[0];
    assert.equal(s.widen.unsafe, true);
    assert.equal(s.widen.by, 120);
    assert.match(s.widen.reason, /310/);
  });
});

test('breakpoint: root inside a wider page is not viewport-bound -> full delta, reason given', { skip }, async () => {
  await withVariant((src) => src.replace('.scr {', '.scr { width: 300px;'), async (p) => {
    const s = (await captureScreens(p, { root: '.scr' })).screens[0];
    assert.deepEqual(s.W, [300, 420]);
    assert.equal(s.widen.by, 120);
    assert.equal(s.widen.unsafe, false);
    assert.deepEqual(s.widen.breakpoints, [380]);
    assert.match(s.widen.reason, /viewport/);
  });
});

test('basic: flex intent recorded on flex items and containers', { skip }, () => {
  const nodes = walk(basic.screens[0].tree);
  const row = nodes.find((n) => n.cls === 'row');
  assert.deepEqual(row.flexBox, { jc: 'normal', fd: 'row', ov: false });
  const item = row.kids[0];
  assert.equal(item.flex.g, 1);
  assert.equal(item.flex.s, 1);
  assert.equal(item.flex.b, '0%');
  assert.equal(item.flex.ax, 'x');
  assert.equal(item.flex.n, item.rA[2]);
  assert.equal(nodes.find((n) => n.cls === 'hello').flex, undefined);
});
