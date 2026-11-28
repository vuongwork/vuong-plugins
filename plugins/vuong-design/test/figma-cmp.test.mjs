// plan 3b Task 6: components on the fake Figma: component batches (figma-cmp.mjs + figma-runtime-cmp.js), screens
// that use instances, overrides, nested instances, BOOLEAN / TEXT / INSTANCE_SWAP properties, a second build of the
// same components, and the plan 3 path when components are off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { findComponents } from '../core/components.mjs';
import { encodeScreen, planBatches, newTables, batchData } from '../core/figma-encode.mjs';
import { cmpEncode } from '../core/figma-cmp.mjs';
import { loaderCode, runtimeInstallCode, runtimeCmpInstallCode, CMP_PATCHES } from '../core/figma.mjs';
import { ordOf, decode } from '../core/figma-check.mjs';
import { cmpCheckOne } from '../core/figma-cmp-check.mjs';
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';
import { varsPayload } from '../core/figma-vars.mjs';

const RUNTIME = readFileSync(new URL('../core/figma-runtime.js', import.meta.url), 'utf8');
const RUNTIME_CMP = readFileSync(new URL('../core/figma-runtime-cmp.js', import.meta.url), 'utf8');
const AsyncFunction = (async () => {}).constructor;
const run = (code, figma) => new AsyncFunction('figma', code)(figma);
const installed = (src) => src.replace(/\r\n/g, '\n').replace('const D = __DATA__;\n', '').replace(/^[ \t]*\/\/.*\n/gm, '');

// ---- hand-built screens (capture IR + target spec), as test/components.test.mjs ----
const BG = 'rgb(255, 255, 255)', INK = 'rgb(38, 51, 92)';
const F = (cls, o = {}, ...kids) => ({ t: 'F', cls, ...o, kids });
const T = (text, cls = 't', o = {}) => ({ t: 'T', cls, text, ...o });
const V = (ref, cls = 'ic') => ({ t: 'V', cls, icon: ref, tag: 'svg' });
const SVG = Object.fromEntries(['i-a', 'i-b', 'i-c'].map((r) => [r, `<symbol id="${r}" viewBox="0 0 24 24"><path d="M1 1h${r.length}" stroke="currentColor"></path></symbol>`]));
function specOf(d, id) {
  const sn = { id, t: d.t, w: d.t === 'V' ? 24 : 80, h: d.t === 'V' ? 24 : 20, sz: d.t === 'V' ? ['FIXED', 'FIXED'] : ['HUG', 'HUG'] };
  if (d.t === 'F') sn.lay = { d: d.d || 'H', p: d.p || [4, 8, 4, 8], g: 4, pa: 'S', ca: 'C' };
  if (d.bg) sn.paint = { bg: d.bg };
  if (d.text != null) { sn.runs = [{ t: d.text }]; sn.font = { ff: 'Inter', fs: d.fs || '14px', fw: '400', fst: 'normal', lh: 20, ls: 'normal', c: d.c || INK, ta: 'start', td: 'none', tt: 'none' }; }
  if (d.icon) sn.icon = { ref: d.icon, color: d.c || INK };
  return sn;
}
function srcNode(d, id) {
  const sn = specOf(d, id);
  const ir = { id, kind: d.t === 'T' ? 'text' : d.t === 'V' ? 'icon' : 'frame', tag: d.tag || (d.t === 'T' ? 'span' : 'div'), cls: d.cls || '', paint: {} };
  const irKids = [];
  const kids = (d.kids || []).map((k, i) => { const x = srcNode(k, `${id}.${i}`); irKids.push(x.ir); return x.sn; });
  if (kids.length) sn.kids = kids;
  if (irKids.length) ir.kids = irKids;
  return { sn, ir };
}
const scr = (id, ...kids) => {
  const { sn, ir } = srcNode(F('sc', { bg: BG, d: 'V' }, ...kids), 'n');
  sn.w = 320; sn.h = 600; sn.sz = ['FIXED', 'HUG'];
  return { screen: { id, name: id, tree: ir }, spec: sn };
};
const DECL = { version: 1, classes: { tab: { kind: 'tab' } }, keep: {}, drop: [] };
// s1: rows (one with an icon before its text, one without: BOOLEAN show-ic hides index 0), a row with another fill
// (override), tabs with icons (INSTANCE_SWAP) and a selected tab (variant); s2: two cards holding rows (nested)
const row = (text, o = {}) => F('row', { bg: BG, ...o }, T(text));
const SCREENS = () => [
  scr('s1', F('row', { bg: BG }, V('i-a'), T('Alpha')), row('Beta'), row('Gamma', { bg: 'rgb(250, 240, 230)' }),
    F('tab', { bg: BG }, V('i-a'), T('One')), F('tab', { bg: BG }, V('i-b'), T('Two')), F('tab on', { bg: INK }, V('i-c', 'ic'), T('Three', 't', { c: BG }))),
  scr('s2', F('card', { bg: 'rgb(240, 240, 240)', d: 'V' }, row('C1'), row('C2')), F('card', { bg: 'rgb(240, 240, 240)', d: 'V' }, row('D1'), row('D2'))),
];

function setup({ components = true } = {}) {
  const src = SCREENS();
  const found = findComponents(src, { decl: DECL });
  const screens = src.map((s) => ({ id: s.screen.id, W: [320, 420], svgDefs: SVG, spec: s.spec }));
  const tables = newTables([]);
  const encs = screens.map((s) => encodeScreen(s.spec, { screen: s.id, file: 'f.html', W: s.W, map: {}, svgDefs: s.svgDefs, tables }));
  let cmp = null;
  if (components) { cmp = cmpEncode(found, screens, { file: 'f.html', map: {}, tables }); for (const e of encs) cmp.mark(e); }
  const cmpBatches = cmp ? planBatches(cmp.items, { wrap: loaderCode, page: 'Components', extra: { cm: 1 }, unit: (x) => x.cm.n }) : [];
  const batches = planBatches(encs, { wrap: loaderCode, ...(cmp ? { extra: { cp: 'Components' } } : {}) });
  return { found, screens, encs, cmp, cmpBatches, batches };
}
async function build(s, fig = makeFakeFigma()) {
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  const res = { cmp: [], screens: [] };
  for (const b of s.cmpBatches) res.cmp.push(await run(b.code, fig));
  for (const b of s.batches) res.screens.push(await run(b.code, fig));
  return { fig, res };
}
const page = (fig, name) => fig.root.children.find((p) => p.name === name);
const all = (n, out = []) => { out.push(n); for (const k of n.children || []) all(k, out); return out; };
const byVd = (root) => Object.fromEntries(all(root).map((n) => [n.getSharedPluginData('vuongdesign', 'id'), n]).filter(([k]) => k));
const cmpOf = (fig) => all(page(fig, 'Components')).filter((n) => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');

test('component runtime: at most 16 KB as installed, no console / notify; every loader anchor is in the screen runtime once', () => {
  assert.ok(Buffer.byteLength(installed(RUNTIME_CMP), 'utf8') <= 16384);
  assert.ok(!/console\.|figma\.notify/.test(RUNTIME_CMP));
  const rt = installed(RUNTIME);
  for (const [a] of CMP_PATCHES) assert.equal(rt.split(a).length, 2, `anchor ${a}`);
});

test('components found in the fixture: row (BOOLEAN show-ic, TEXT), tab (variants, INSTANCE_SWAP), card holding rows', () => {
  const { found } = setup();
  const c = Object.fromEntries(found.components.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(c).sort(), ['card', 'row', 'tab']);
  assert.deepEqual(c.row.props.map((p) => p.type).sort(), ['BOOLEAN', 'TEXT']);
  assert.ok(c.tab.props.some((p) => p.type === 'INSTANCE_SWAP'));
  assert.deepEqual(c.tab.axes, ['state']);
  assert.ok(Object.values(c.card.variants[0].nested).every((n) => n === 'row'));
});

test('component batch: icon components, then atoms, then the card; sets with their properties; readback without differences', async () => {
  const s = setup();
  const { fig, res } = await build(s);
  for (const r of res.cmp) {
    assert.ok(r.cm, 'cm result');
    assert.deepEqual(r.cm.errors, []);
    for (const x of r.screens) { assert.ok(x.root, `${x.screen} built`); assert.deepEqual(x.errors, [], x.screen); }
    const D = s.cmpBatches.find((b) => b.n === r.batch).data;
    for (const x of decode(r, D).screens) for (const [o, n] of Object.entries(x.N || {})) assert.ok(!n.d, `${x.screen} ${o}: ${JSON.stringify(n.d)}`);
  }
  const order = s.cmp.items.map((x) => x.cm.n);
  assert.ok(order.indexOf('icon/i-a') < order.indexOf('tab') && order.indexOf('row') < order.indexOf('card'), order.join(' '));
  const cs = cmpOf(fig);
  const names = cs.filter((n) => n.parent.type === 'PAGE').map((n) => `${n.type}:${n.name}`).sort();
  // i-c: the selected tab is alone in its variant, so its icon is no INSTANCE_SWAP value
  assert.deepEqual(names, ['COMPONENT:card', 'COMPONENT:icon/i-a', 'COMPONENT:icon/i-b', 'COMPONENT:row', 'COMPONENT_SET:tab']);
  const tab = cs.find((n) => n.name === 'tab');
  assert.deepEqual(tab.children.map((c) => c.name).sort(), ['state=default', 'state=on']);
  const defs = Object.values(tab.componentPropertyDefinitions).map((d) => d.type).sort();
  assert.deepEqual(defs, ['INSTANCE_SWAP', 'TEXT']);
  // the card's rows are instances of row inside the main
  const card = cs.find((n) => n.name === 'card');
  assert.deepEqual(card.children.map((c) => c.type), ['INSTANCE', 'INSTANCE']);
  assert.equal(card.children[0].mainComponent.name, 'row');
});

test('screens use instances: every spec node read back, no differences, texts and the hidden icon as the target', async () => {
  const s = setup();
  const { fig, res } = await build(s);
  for (const r of res.screens) {
    const D = s.batches.find((b) => b.n === r.batch).data;
    for (const x of r.screens) {
      assert.deepEqual(x.errors, [], x.screen);
      const T = D.screens.find((y) => y.screen === x.screen).T;
      assert.equal(x.nodes.length, ordOf(T).length);
      assert.ok(x.nodes.every((n) => n !== 0), `${x.screen}: a node has no readback`);
    }
    for (const x of decode(r, D).screens) for (const [o, n] of Object.entries(x.N || {})) assert.ok(!n.d, `${x.screen} ${o}: ${JSON.stringify(n.d)}`);
  }
  const s1 = byVd(page(fig, 'Screens').children.find((n) => n.name === 's1'));
  assert.equal(s1['n.0'].type, 'INSTANCE');
  assert.equal(s1['n.1'].type, 'INSTANCE');
  assert.equal(s1['n.1.0'].characters, 'Beta');
  // Beta has no icon: its text is the main's second layer, the icon layer is hidden
  assert.equal(s1['n.1'].children[0].visible, false);
  assert.equal(s1['n.1'].children[1], s1['n.1.0']);
  // the selected tab is the 'on' variant; tab Two swapped its icon to i-b
  assert.equal(s1['n.5'].mainComponent.name, 'state=on');
  assert.equal(s1['n.4.0'].mainComponent.name, 'icon/i-b');
  assert.equal(s1['n.5.1'].characters, 'Three');
});

test('icon recolour that throws: its scratch svg is removed, nothing is left on any page', async () => {
  const s = setup();
  const fig = makeFakeFigma();
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  for (const b of s.cmpBatches) await run(b.code, fig);
  // from here (the screens), every svg the runtime parses breaks on its first walk, as a recolour error would
  const make = fig.createNodeFromSvg.bind(fig);
  let calls = 0;
  fig.createNodeFromSvg = (svg) => { const t = make(svg); calls++; t.findAll = () => { throw new Error('recolour broke'); }; return t; };
  for (const b of s.batches) await run(b.code, fig);
  assert.ok(calls > 0, 'the screens recolour at least one icon');
  for (const p of fig.root.children) for (const n of p.children) {
    const vd = n.getSharedPluginData('vuongdesign', 'screen') || n.getSharedPluginData('vuongdesign', 'cmp');
    assert.ok(vd, `${p.name}: ${n.type} ${n.name} left on the page`);
  }
});

test('cmpCheckOne: a state overlay stretched to a parent grown by the property default is not a size failure', () => {
  // an invented tag component: its label is bound to a TEXT property whose default is longer than this variant's text
  const T = { o: 'n', w: 60, h: 30, s: 'HH', k: [{ o: 'n.0', t: 'T', tx: 'Hi', w: 20, h: 16, s: 'HH' }, { o: 'n.~disabled', w: 60, h: 30, s: 'XX' }] };
  const D = { screens: [{ screen: 'cmp:tag/state=disabled', T, cm: { n: 'tag', p: { label: ['TEXT', 'A much longer label'] }, b: { label: '0' } } }] };
  const N = (ov) => ({ n: { A: [0, 0, 110, 30] }, 'n.0': { A: [8, 7, 94, 16], d: { text: 'A much longer label' } }, 'n.~disabled': { A: [0, 0, ov, 30] } });
  const c = cmpCheckOne({ N: N(110) }, D, 'tag/state=disabled');
  assert.deepEqual(c.sizes, []);
  assert.deepEqual(c.diffs, []);
  assert.deepEqual(c.propertyTexts, ['n.0']);
  // the same readback in a variant whose text is the default (nothing grew): the root and the overlay are checked
  const D2 = JSON.parse(JSON.stringify(D)); D2.screens[0].T.k[0].tx = 'A much longer label';
  assert.deepEqual(cmpCheckOne({ N: N(110) }, D2, 'tag/state=disabled').sizes.map((x) => x.o), ['n', 'n.~disabled']);
});

test('override kept: a row with its own fill is an instance whose root fill is overridden; the main keeps its own', async () => {
  const s = setup();
  const { fig } = await build(s);
  const s1 = byVd(page(fig, 'Screens').children.find((n) => n.name === 's1'));
  const g = s1['n.2'];
  assert.equal(g.type, 'INSTANCE');
  const hex = (n) => { const c = n.fills[0].color; return [c.r, c.g, c.b].map((v) => Math.round(v * 255)); };
  assert.deepEqual(hex(g), [250, 240, 230]);
  assert.deepEqual(hex(g.mainComponent), [255, 255, 255]);
  // the plain row overrides nothing on its root
  assert.ok(!s1['n.1']._ov || !s1['n.1']._ov.has('fills'));
});

test('nested instances: the card rows take their own texts', async () => {
  const s = setup();
  const { fig } = await build(s);
  const s2 = byVd(page(fig, 'Screens').children.find((n) => n.name === 's2'));
  assert.equal(s2['n.1'].type, 'INSTANCE');
  assert.equal(s2['n.1.0'].type, 'INSTANCE');
  assert.equal(s2['n.1.0.0'].characters, 'D1');
  assert.equal(s2['n.1.1.0'].characters, 'D2');
});

test('a second build of the same components: no duplicates, the screens\' instances move to the new components', async () => {
  const s = setup();
  const { fig } = await build(s);
  const before = cmpOf(fig).length;
  const again = [];
  for (const b of s.cmpBatches) again.push(await run(b.code, fig));
  assert.equal(cmpOf(fig).length, before);
  assert.ok(again.some((r) => r.cm.swapped > 0), 'instances swapped');
  const s1 = byVd(page(fig, 'Screens').children.find((n) => n.name === 's1'));
  assert.ok(cmpOf(fig).includes(s1['n.1'].mainComponent), 'the instance points to a component on the page');
});

test('R92: the instance swap of a component rebuild is not a hand edit: the screens sent after it are rebuilt; a screen edited before it stays edited', async () => {
  const s = setup();
  const { fig } = await build(s);
  const scr = (name) => page(fig, 'Screens').children.find((n) => n.name === name);
  const root = scr('s1');
  assert.ok(all(root).some((n) => n.type === 'INSTANCE'), 's1 holds instances');
  root.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 1 }]; // the hand edit, outside the instances
  const again = [];
  for (const b of s.cmpBatches) again.push(await run(b.code, fig));
  assert.ok(again.some((r) => r.cm.swapped > 0), 'instances swapped');
  const sent = [];
  for (const b of s.batches) sent.push(await run(b.code, fig));
  const edited = sent.flatMap((r) => r.screens.filter((x) => x.edited).map((x) => x.screen));
  assert.deepEqual(edited, ['s1'], 'only the screen edited by hand is kept');
});

// R99: a variable value change reflows hug frames on real Figma (sizes and positions of unbound nodes move). The fake
// does not lay out, so the reflow is played by hand inside setValueForMode: one child of every screen and variant moves.
test('R99: a variable value change sent by vars is not a hand edit: every unedited screen and variant is rebuilt; a screen edited before it stays edited', async () => {
  const dim = (value) => ({ $type: 'dimension', $value: { value, unit: 'px' } });
  const toks = (v) => ({ primitive: { space: { gap: dim(v) } } });
  const sendVars = async (fig, v) => { const out = []; for (const c of varsPayload(toks(v))) out.push(await run(c, fig)); return out; };
  const reflow = (fig) => {
    for (const p of fig.root.children) for (const c of p.children) for (const n of c.type === 'COMPONENT_SET' ? c.children : [c]) {
      const k = n.getSharedPluginData('vuongdesign', 'sig') && (n.children || [])[0];
      if (k) k.x += 3;
    }
  };
  const scenario = async (resign) => {
    const s = setup(), fig = makeFakeFigma();
    await sendVars(fig, 8);
    await build(s, fig);
    const scr = (name) => page(fig, 'Screens').children.find((n) => n.name === name);
    scr('s2').fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 1 }]; // the hand edit
    let vr = null;
    if (resign) {
      const v = (await fig.variables.getLocalVariablesAsync())[0], set = v.setValueForMode;
      v.setValueForMode = function (...a) { reflow(fig); return set.apply(this, a); };
      vr = await sendVars(fig, 12);
    } else reflow(fig); // the same reflow without the vars batch: nobody signs again
    const cm = []; for (const b of s.cmpBatches) cm.push(await run(b.code, fig));
    const sc = []; for (const b of s.batches) sc.push(await run(b.code, fig));
    return { vr, cmpEdited: cm.flatMap((r) => r.screens.filter((x) => x.edited).map((x) => x.screen)), edited: sc.flatMap((r) => r.screens.filter((x) => x.edited).map((x) => x.screen)) };
  };
  const bad = await scenario(false);
  assert.deepEqual(bad.edited, ['s1', 's2'], 'without signing again, the reflow reads as a hand edit');
  assert.ok(bad.cmpEdited.length > 0);
  const ok = await scenario(true);
  assert.equal(ok.vr[0].variables.updated, 1);
  assert.deepEqual(ok.vr[0].errors, []);
  assert.ok(ok.vr[0].signed.again > 0 && ok.vr[0].signed.edited === 1, JSON.stringify(ok.vr[0].signed));
  assert.deepEqual(ok.edited, ['s2'], 'only the screen edited by hand is kept');
  assert.deepEqual(ok.cmpEdited, []);
});

test('R99: only the screen and component pages are loaded; a signature pass that fails is a warning, the values still change', async () => {
  const tok = (v) => ({ primitive: { space: { gap: { $type: 'dimension', $value: { value: v, unit: 'px' } } } } });
  const s = setup(), fig = makeFakeFigma();
  await run(varsPayload(tok(8))[0], fig);
  await build(s, fig);
  const big = fig.createPage(); big.name = 'Big';
  big.loadAsync = async () => { throw new Error('Unable to establish connection to Figma after 10 seconds'); };
  let r = await run(varsPayload(tok(12))[0], fig);
  assert.deepEqual([r.errors, r.signWarn, r.variables.updated], [[], undefined, 1]);
  assert.ok(r.signed.roots > 0);
  page(fig, 'Screens').loadAsync = big.loadAsync;
  r = await run(varsPayload(tok(16))[0], fig);
  assert.deepEqual([r.errors, r.variables.updated, r.signed], [[], 1, undefined]);
  assert.match(r.signWarn, /10 seconds/);
});

test('R99: a vars batch that changes no value runs no signature pass and adds no result field', async () => {
  const s = setup(), fig = makeFakeFigma();
  const codes = varsPayload({ primitive: { space: { gap: { $type: 'dimension', $value: { value: 8, unit: 'px' } } } } });
  await run(codes[0], fig);
  await build(s, fig);
  const r = await run(codes[0], fig);
  assert.equal(r.signed, undefined);
  assert.equal(r.variables.unchanged, 1);
});

// ---- plan 3b Task 7: edit guard, several component batches ----
const cmpBatchesOf = (s, o = {}) => planBatches(s.cmp.items, { wrap: loaderCode, page: 'Components', extra: { cm: 1 }, unit: (x) => x.cm.n, ...o });
test('components page layout: one row per component, the icons share one; variants in one row inside their set, nothing overlaps', async () => {
  const s = setup();
  const { fig } = await build(s);
  const top = page(fig, 'Components').children;
  const box = (n) => [n.x, n.y, n.x + n.width, n.y + n.height];
  const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) assert.ok(apart(box(top[i]), box(top[j])), `${top[i].name} / ${top[j].name} overlap`);
  for (const set of top.filter((n) => n.type === 'COMPONENT_SET')) {
    const v = set.children;
    assert.ok(v.length > 1 && v.every((x) => x.y === 24 && x.x >= 24 && x.x + x.width <= set.width - 24 + 1e-6 && x.y + x.height <= set.height), set.name);
    for (let i = 1; i < v.length; i++) assert.ok(v[i].x >= v[i - 1].x + v[i - 1].width + 24 - 1e-6, `${set.name}: ${v[i].name}`);
  }
  const icons = top.filter((n) => n.name.startsWith('icon/'));
  assert.equal(new Set(icons.map((n) => n.y)).size, 1, 'icons in one row');
  const rows = [...new Set(top.filter((n) => !n.name.startsWith('icon/')).map((n) => n.y))];
  assert.equal(rows.length, top.length - icons.length, 'every other component on its own row');
});

test('a rebuild without edits: no component reported edited, the same components on the page', async () => {
  const s = setup();
  const { fig } = await build(s);
  for (const b of s.cmpBatches) {
    const r = await run(b.code, fig);
    assert.deepEqual(r.screens.filter((x) => x.edited).map((x) => x.screen), []);
    assert.deepEqual(r.cm.errors, []);
  }
});

test('edited component is kept: its variants are not rebuilt (edited, the old root), its instances keep it; --force cmp:<name> rebuilds it', async () => {
  const s = setup();
  const { fig } = await build(s);
  const row = cmpOf(fig).find((n) => n.name === 'row');
  row.children[0].resize(row.children[0].width + 7, row.children[0].height); // a hand edit inside the main
  const ids = Object.fromEntries(cmpOf(fig).map((n) => [n.name, n.id]));
  const res = [];
  for (const b of s.cmpBatches) res.push(await run(b.code, fig));
  const x = res.flatMap((r) => r.screens).find((y) => y.screen === 'cmp:row');
  assert.deepEqual([x.edited, x.root], [true, ids.row]);
  assert.equal(typeof x.sig, 'string');
  assert.equal(cmpOf(fig).find((n) => n.name === 'row'), row, 'the edited main stays');
  // the card (built in this batch) nests the kept row; the screens' rows are still its instances
  const card = cmpOf(fig).find((n) => n.name === 'card');
  assert.notEqual(card.id, ids.card, 'the card is rebuilt');
  assert.ok(card.children.every((c) => c.mainComponent === row));
  const s1 = byVd(page(fig, 'Screens').children.find((n) => n.name === 's1'));
  assert.equal(s1['n.1'].mainComponent, row);
  assert.equal(cmpOf(fig).filter((n) => n.name === 'row').length, 1);
  // forced: rebuilt, the instances move to the new main, the edited one goes
  const forced = cmpBatchesOf(s, { force: ['cmp:row'] });
  const r2 = [];
  for (const b of forced) r2.push(await run(b.code, fig));
  const y = r2.flatMap((r) => r.screens).find((z) => z.screen === 'cmp:row');
  assert.ok(y.root && !y.edited && y.root !== ids.row);
  assert.equal(row.removed, true);
  assert.equal(byVd(page(fig, 'Screens').children.find((n) => n.name === 's1'))['n.1'].mainComponent.id, y.root);
});

test('components in several batches: a later batch keeps the components an earlier one built', async () => {
  const s = setup();
  // the largest limit that splits the components into two batches or more
  let small = [];
  for (let L = s.cmpBatches[0].bytes - 1; small.length < 2; L -= 50) small = cmpBatchesOf(s, { limit: L });
  assert.ok(small.length > 1, `${small.length} batches`);
  const fig = makeFakeFigma();
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  for (const b of small) { const r = await run(b.code, fig); assert.deepEqual(r.cm.errors, [], `batch ${b.n}`); }
  const names = cmpOf(fig).filter((n) => n.parent.type === 'PAGE').map((n) => n.name).sort();
  assert.deepEqual(names, ['card', 'icon/i-a', 'icon/i-b', 'row', 'tab']);
  for (const b of s.batches) { const r = await run(b.code, fig); for (const x of r.screens) assert.deepEqual(x.errors, [], x.screen); }
  // R92: the same batches again: a later batch swaps instances inside the variants an earlier batch built (and inside
  // the screens); none of that reads as a hand edit
  const edited = [];
  for (const b of [...small, ...s.batches]) { const r = await run(b.code, fig); edited.push(...r.screens.filter((x) => x.edited).map((x) => x.screen)); }
  assert.deepEqual(edited, []);
});

test('documentAccess dynamic-page: everything builds without the sync mainComponent getter', async () => {
  const s = setup();
  const { res } = await build(s, makeFakeFigma({ dynamicPage: true }));
  for (const r of [...res.cmp, ...res.screens]) for (const x of r.screens) assert.deepEqual(x.errors, [], x.screen);
  for (const r of res.cmp) assert.deepEqual(r.cm.errors, []);
});

test('an instance whose main component is not the encoded one reads back d.mc (the main it has)', async () => {
  const s = setup();
  const fig = makeFakeFigma();
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  for (const b of s.cmpBatches) await run(b.code, fig);
  // swapComponent does nothing from here on: INSTANCE_SWAP values and variant changes are lost
  let sw = Object.getPrototypeOf(cmpOf(fig).find((n) => n.type === 'COMPONENT'));
  while (!Object.getOwnPropertyDescriptor(sw, 'swapComponent')) sw = Object.getPrototypeOf(sw);
  const orig = sw.swapComponent;
  sw.swapComponent = function () {};
  try {
    const r = decode(await run(s.batches[0].code, fig), s.batches[0].data);
    const s1 = r.screens.find((x) => x.screen === 's1');
    const mc = Object.entries(s1.N).filter(([, n]) => n.d && n.d.mc !== undefined).map(([o, n]) => `${o}=${n.d.mc}`);
    // tab 'Two' keeps the default icon i-a where its INSTANCE_SWAP value says i-b
    assert.deepEqual(mc, ['n.4.0=icon/i-a'], JSON.stringify(mc));
  } finally { sw.swapComponent = orig; }
});

test('off is plan 3: without components the batch data has no K / cp / cm and the loader has no component runtime', () => {
  const on = setup(), off = setup({ components: false });
  for (const b of off.batches) {
    assert.ok(!('K' in b.data) && !('cp' in b.data) && !('cm' in b.data));
    assert.ok(!/rtc/.test(b.code));
    // the same screens without marks give the same data as plan 3's batchData
    assert.deepEqual(b.data, batchData(off.encs.filter((e) => b.screens.includes(e.screen)), b.n));
  }
  assert.ok(on.batches.some((b) => Array.isArray(b.data.K) && b.data.cp === 'Components'));
});

test('a component missing in the file: the instance fails with a clear error, the screen still builds', async () => {
  const s = setup();
  const fig = makeFakeFigma();
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  const r = await run(s.batches[0].code, fig);
  const x = r.screens.find((y) => y.screen === 's1');
  assert.ok(x.root);
  assert.ok(x.errors.some((e) => /component missing in the file: row/.test(e.msg)), JSON.stringify(x.errors).slice(0, 300));
});

test('loader: a batch with components needs the component runtime installed', async () => {
  const s = setup();
  const fig = makeFakeFigma();
  await run(runtimeInstallCode(), fig);
  const r = await run(s.cmpBatches[0].code, fig);
  assert.equal(r.rtc, 1);
  assert.ok(r.stale);
});

// ---- figma.mjs plan / ingest with a components.json in the ds folder ----
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../core/figma.mjs';

function cmpDs() {
  const d = mkdtempSync(join(tmpdir(), 'vd-cmp-')), ds = join(d, 'ds');
  mkdirSync(ds);
  const src = SCREENS();
  writeFileSync(join(ds, 'ir.json'), JSON.stringify({ file: 'f.html', root: '.sc', widen: null, screens: src.map((s) => ({ id: s.screen.id, W: [320, 420], svgDefs: SVG })) }));
  for (const s of src) writeFileSync(join(ds, `spec-norm-${s.screen.id}.json`), JSON.stringify(s.spec));
  writeFileSync(join(ds, 'tokens.json'), JSON.stringify({ primitive: { color: { c01: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' } } } } }));
  writeFileSync(join(ds, 'token-map.json'), '{}');
  writeFileSync(join(ds, 'components.json'), JSON.stringify(findComponents(src, { decl: DECL })));
  return { ds, out: join(d, 'out'), F: join(d, 'out', 'figma'), d };
}
const rj = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

test('plan with components.json: runtime-cmp and cmp batches before the screens; ingest records the components; a second plan keeps them', async () => {
  const h = cmpDs(), lines = [];
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out], { log: (m) => lines.push(m) }), 0);
  const st = rj(h.F, 'state.json');
  assert.deepEqual(st.order.filter((k) => !k.startsWith('vars')), ['runtime', 'runtime-cmp', 'cmp-01', 'batch-01']);
  assert.equal(st.batches['cmp-01'].kind, 'cmp');
  assert.ok(lines.some((l) => /^components: 4 variants of 3 components, 2 icon components, \d+ instances/.test(l)), lines.join('\n'));
  const fig = makeFakeFigma();
  for (const k of st.order) {
    const r = await run(readFileSync(join(h.F, st.batches[k].file), 'utf8'), fig);
    const p = join(h.d, `${k}.json`);
    writeFileSync(p, JSON.stringify(r));
    assert.equal(await main(['ingest', '--out', h.out, '--result', p], { log: () => {} }), 0, k);
  }
  const st2 = rj(h.F, 'state.json');
  assert.equal(st2.batches['cmp-01'].status, 'done');
  assert.deepEqual(Object.keys(st2.components).sort(), ['card', 'icon/i-a', 'icon/i-b', 'row', 'tab/state=default', 'tab/state=on']);
  assert.ok(Object.values(st2.components).every((c) => c.status === 'done'));
  assert.ok(Object.values(st2.screens).every((s) => s.status === 'done' && s.errors === 0));
  // nothing changed: every batch kept, nothing to send
  const l2 = [];
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out], { log: (m) => l2.push(m) }), 0);
  assert.ok(l2.some((l) => /this run .*send nothing/.test(l)), l2.join('\n'));
});

test('plan --no-components: the plan 3 batches, byte for byte', async () => {
  const h = cmpDs();
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out, '--no-components'], { log: () => {} }), 0);
  const a = rj(h.F, 'state.json');
  rmSync(join(h.ds, 'components.json'));
  const out2 = join(h.d, 'out2');
  assert.equal(await main(['plan', '--ds', h.ds, '--out', out2], { log: () => {} }), 0);
  const b = rj(out2, 'figma', 'state.json');
  assert.deepEqual(a.order, b.order);
  for (const k of a.order) assert.equal(readFileSync(join(h.F, a.batches[k].file), 'utf8'), readFileSync(join(out2, 'figma', b.batches[k].file), 'utf8'), k);
  assert.ok(!a.order.some((k) => /cmp/.test(k)));
});

// ---- Planora: the 18 screens with their 14 components (components.json of cmp.mjs on the same spec-norm files) ----
import { gunzipSync } from 'node:zlib';
import { varsPlan } from '../core/figma-vars.mjs';
const gz = (f) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${f}`, import.meta.url))).toString('utf8'));

test('Planora with components: batches under 50 000 bytes, everything builds on the fake, every node read back as encoded', async (t) => {
  const planora = gz('figma-encode-planora.json.gz'), comps = gz('figma-cmp-planora.json.gz');
  const tables = newTables(planora.V);
  const ctx = { file: planora.file, map: planora.map, tables, tokens: planora.tokens };
  const encs = planora.screens.map((s) => encodeScreen(s.spec, { ...ctx, screen: s.id, W: s.W, svgDefs: s.svgDefs }));
  const cmp = cmpEncode(comps, planora.screens, ctx);
  for (const e of encs) cmp.mark(e);
  const cb = planBatches(cmp.items, { wrap: loaderCode, page: 'Components', extra: { cm: 1 }, unit: (x) => x.cm.n });
  const sb = planBatches(encs, { wrap: loaderCode, extra: { cp: 'Components' } });
  for (const b of [...cb, ...sb]) assert.ok(b.bytes <= 50000, `${b.n} ${b.bytes} B`);
  const plan = varsPlan(planora.tokens, encs.flatMap((e) => e.variants));
  const fig = makeFakeFigma({ idPrefix: '2077', idStart: 31000, variables: planora.V,
    textStyles: plan.textStyles.map((x) => ({ name: x.name, textDecoration: x.td || 'NONE', textCase: x.tc || 'ORIGINAL' })),
    effectStyles: (plan.effectStyles || []).map((x) => x.name), fonts: [...DEFAULT_FONTS, 'Be Vietnam Pro|Light'] });
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  let inst = 0, nodes = 0, propTexts = 0;
  for (const b of [...cb, ...sb]) {
    const r = decode(await run(b.code, fig), b.data);
    if (r.cm) assert.deepEqual(r.cm.errors, [], `cmp ${b.n}`);
    for (const s of r.screens) {
      assert.deepEqual(s.errors, [], s.screen);
      const ids = ordOf(b.data.screens.find((x) => x.screen === s.screen).T);
      for (const o of ids) assert.ok(s.N[o], `${s.screen} ${o}`);
      // a variant's property texts show the set's default (real Figma): cmpCheckOne allows exactly those
      if (s.screen.startsWith('cmp:')) { const c = cmpCheckOne(s, b.data, s.screen.slice(4)); assert.deepEqual(c.diffs, [], s.screen); propTexts += c.propertyTexts.length; }
      else for (const [o, x] of Object.entries(s.N)) assert.equal(x.d, undefined, `${s.screen} ${o}: ${JSON.stringify(x.d)}`);
      nodes += ids.length;
    }
  }
  assert.ok(propTexts >= 2, `variants whose property text shows the default: ${propTexts}`);
  const w = (n) => { if (n.type === 'INSTANCE') inst++; (n.children || []).forEach(w); };
  w(page(fig, 'Screens'));
  t.diagnostic(`components: ${cb.length} batches (${cb.map((b) => b.bytes).join(' / ')} B), screens: ${sb.length} batches (${sb.map((b) => b.bytes).join(' / ')} B); ${inst} instance layers on the screens, ${nodes} nodes read back`);
  assert.ok(inst >= 120, `instances ${inst}`);
});

// ---- plan 3b Task 7: check of components, edit guard through plan / ingest, figCmp / figSwap ----
import { cmpVariants, blockInstances, cmpMutation, usesOf } from '../core/figma-cmp-check.mjs';
import { figmaProxy } from '../core/figma-check.mjs';
import { runFigMutations, FIG_KINDS } from '../core/mutate.mjs';

async function sendAll(h, fig, keys) {
  const st = rj(h.F, 'state.json');
  for (const k of keys || st.order) {
    const r = await run(readFileSync(join(h.F, st.batches[k].file), 'utf8'), fig);
    const p = join(h.d, `${k}.json`);
    writeFileSync(p, JSON.stringify(r));
    assert.equal(await main(['ingest', '--out', h.out, '--result', p], { log: () => {} }), 0, k);
  }
  return rj(h.F, 'state.json');
}
async function builtDs() {
  const h = cmpDs(), fig = makeFakeFigma();
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} }), 0);
  await sendAll(h, fig);
  return { h, fig };
}
const screenData = (h, st) => Object.fromEntries(Object.entries(st.screens).map(([id, s]) => [id, rj(h.F, st.batches[s.batch].data)]));
const readF = (h) => (f) => rj(h.F, f);

test('check components: every variant passes against its encoding, usedBy lists the screens; a planted root fill is caught', async () => {
  const { h } = await builtDs();
  const st = rj(h.F, 'state.json');
  const v = cmpVariants(st, h.F, screenData(h, st), readF(h));
  assert.deepEqual(v.map((x) => [x.key, x.status, x.pass]), [['card', 'done', true], ['icon/i-a', 'done', true], ['icon/i-b', 'done', true], ['row', 'done', true], ['tab/state=default', 'done', true], ['tab/state=on', 'done', true]], JSON.stringify(v.filter((x) => !x.pass)));
  assert.deepEqual(v.find((x) => x.key === 'row').usedBy, ['s1', 's2']);
  assert.deepEqual(v.find((x) => x.key === 'icon/i-b').usedBy, ['s1']);
  assert.ok(v.every((x) => x.readback.missing === 0));
  assert.deepEqual(cmpMutation(v, st, readF(h)), { kind: 'figCmp', target: 'card', caught: true });
});

test('edited component through plan / ingest: skippedEdited, kept, its screens listed; --force cmp:row rebuilds it; --force of an unknown component is a usage error', async () => {
  const { h, fig } = await builtDs();
  const row = cmpOf(fig).find((n) => n.name === 'row');
  row.children[0].resize(row.children[0].width + 7, row.children[0].height);
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out, '--redo'], { log: () => {} }), 0);
  let st = rj(h.F, 'state.json');
  const r = await run(readFileSync(join(h.F, st.batches['cmp-01'].file), 'utf8'), fig);
  const p = join(h.d, 'cmp-again.json');
  writeFileSync(p, JSON.stringify(r));
  const lines = [];
  assert.equal(await main(['ingest', '--out', h.out, '--result', p], { log: (m) => lines.push(m) }), 0);
  assert.ok(lines.some((l) => /edited by hand, kept \(skippedEdited; --force cmp:<name> rebuilds\): row/.test(l)), lines.join('\n'));
  st = rj(h.F, 'state.json');
  assert.deepEqual([st.components.row.status, st.components.row.root], ['skippedEdited', row.id]);
  const v = cmpVariants(st, h.F, screenData(h, st), readF(h)).find((x) => x.key === 'row');
  assert.deepEqual([v.edited, v.pass, v.usedBy], [true, true, ['s1', 's2']]);
  // forced: the component batch carries it, the screen batches do not
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out, '--force', 'cmp:row'], { log: () => {} }), 0);
  st = rj(h.F, 'state.json');
  assert.deepEqual(rj(h.F, st.batches['cmp-01'].data).force, ['cmp:row']);
  assert.ok(st.order.filter((k) => k.startsWith('batch')).every((k) => rj(h.F, st.batches[k].data).force === undefined), 'screen batches without cmp: entries');
  st = await sendAll(h, fig, ['cmp-01']);
  assert.equal(st.components.row.status, 'done');
  assert.notEqual(st.components.row.root, row.id);
  const e2 = [];
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out, '--force', 'cmp:nope'], { log: (m) => e2.push(m) }), 2);
  assert.match(e2.join(' '), /--force cmp:nope: no such component \(components: /);
});

test('a component without readback: it fails, and its instances on the screens read back as missing (unchecked) with the reason', async () => {
  const { h } = await builtDs();
  const st = rj(h.F, 'state.json');
  st.components.row.status = 'failed';
  const v = cmpVariants(st, h.F, screenData(h, st), readF(h));
  assert.equal(v.find((x) => x.key === 'row').pass, false);
  const D = rj(h.F, st.batches[st.screens.s1.batch].data);
  const sres = rj(h.F, st.screens.s1.result).screens.find((x) => x.screen === 's1');
  const { sres: b, blocked } = blockInstances(sres, D, new Map([['row', 'instance of component row, which has no readback (failed)']]));
  assert.deepEqual(Object.keys(blocked).sort(), ['n.0', 'n.0.0', 'n.0.1', 'n.1', 'n.1.0', 'n.2', 'n.2.0']);
  assert.match(blocked['n.1'], /no readback \(failed\)/);
  const P = figmaProxy(decode({ screens: [b] }, D).screens[0], D, SCREENS()[0].spec);
  assert.ok(!P.A.boxes['n.1'] && P.A.boxes['n.3'], 'rows unchecked, tabs read');
  assert.ok(usesOf(D, 's1').has('row') && usesOf(D, 's1').has('icon/i-b') && !usesOf(D, 's2').has('tab/state=default'));
});

test('figCmp and figSwap on the fixture: every instance of the component shows the planted fill, the swapped icon reads as the other icon; a batch without components runs the plan 3 kinds', async () => {
  const { h } = await builtDs();
  const st = rj(h.F, 'state.json');
  const D = rj(h.F, st.batches[st.screens.s1.batch].data);
  const sres = rj(h.F, st.screens.s1.result).screens.find((x) => x.screen === 's1');
  const spec = SCREENS()[0].spec;
  const dom = (s) => figmaProxy(decode({ screens: [JSON.parse(JSON.stringify(s))] }, D).screens[0], D, spec).A.dom;
  const ref = dom(sres);
  // icons set by INSTANCE_SWAP values are read (their main names them): no iconUnread
  assert.deepEqual([ref['n.3.0'].icon, ref['n.4.0'].icon, ref['n.4.0'].iconUnread], ['i-a', 'i-b', undefined]);
  // a stand-in for verifyScreen: a finding wherever the background or the icon differs from the real readback
  const judge = (s) => {
    const d = dom(s), data = [];
    for (const [o, x] of Object.entries(ref)) for (const k of ['bg', 'icon']) if (d[o] && d[o][k] !== x[k]) data.push({ id: o, kind: k });
    return { roots: [], crop: [], data, needsApproval: [], unchecked: Object.keys(ref).filter((o) => !d[o]), pass: !data.length };
  };
  const m = await runFigMutations({ id: 's1', base: judge(sres), screen: sres, D, tree: SCREENS()[0].screen.tree, spec, run: async (x) => judge(x) });
  const by = Object.fromEntries(m.results.map((r) => [r.kind, r]));
  assert.deepEqual([by.figCmp.target, by.figCmp.targets, by.figCmp.caught], ['row', ['n.0', 'n.1', 'n.2'], true]);
  assert.deepEqual([by.figSwap.target, by.figSwap.caught, by.figSwap.found], ['n.3.0', true, ['data|n.3.0|icon']]);
  const plain = await runFigMutations({ id: 's1', base: judge(sres), screen: null, D: { ...D, K: undefined }, tree: null, spec, run: async () => null });
  assert.deepEqual(plain.results.map((r) => r.kind), FIG_KINDS);
});
