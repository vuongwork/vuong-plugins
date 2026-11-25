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
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';

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
  let inst = 0, nodes = 0;
  for (const b of [...cb, ...sb]) {
    const r = decode(await run(b.code, fig), b.data);
    if (r.cm) assert.deepEqual(r.cm.errors, [], `cmp ${b.n}`);
    for (const s of r.screens) {
      assert.deepEqual(s.errors, [], s.screen);
      const ids = ordOf(b.data.screens.find((x) => x.screen === s.screen).T);
      for (const o of ids) assert.ok(s.N[o], `${s.screen} ${o}`);
      for (const [o, x] of Object.entries(s.N)) assert.equal(x.d, undefined, `${s.screen} ${o}: ${JSON.stringify(x.d)}`);
      nodes += ids.length;
    }
  }
  const w = (n) => { if (n.type === 'INSTANCE') inst++; (n.children || []).forEach(w); };
  w(page(fig, 'Screens'));
  t.diagnostic(`components: ${cb.length} batches (${cb.map((b) => b.bytes).join(' / ')} B), screens: ${sb.length} batches (${sb.map((b) => b.bytes).join(' / ')} B); ${inst} instance layers on the screens, ${nodes} nodes read back`);
  assert.ok(inst >= 120, `instances ${inst}`);
});
