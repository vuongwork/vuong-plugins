// plan 3b Task 6 part 2: proposed states as variants of their component, drawn as layers bound to the variables of
// the State collection (the approved state rules as number tokens), and the paths that stay as they were while the
// rules are not approved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findComponents } from '../core/components.mjs';
import { componentStates, stateTokens, stateCss, STATE_CSS_MARK } from '../core/states.mjs';
import { applyState, withStates } from '../core/figma-cmp.mjs';
import { planAll, withStateTokens, runtimeInstallCode, runtimeCmpInstallCode, loaderCode } from '../core/figma.mjs';
import { varsPlan, varsPayload, varNames } from '../core/figma-vars.mjs';
import { encodeScreen, planBatches, newTables } from '../core/figma-encode.mjs';
import { cmpEncode } from '../core/figma-cmp.mjs';
import { ordOf, decode } from '../core/figma-check.mjs';
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';

const AsyncFunction = (async () => {}).constructor;
const run = (code, figma) => new AsyncFunction('figma', code)(figma);
const gz = (f) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${f}`, import.meta.url))).toString('utf8'));
const all = (n, out = []) => { out.push(n); for (const k of n.children || []) all(k, out); return out; };
const page = (fig, name) => fig.root.children.find((p) => p.name === name);
const RULES = { pressed: { overlay: 0.1 }, disabled: { content: 0.38, container: 0.12 }, focus: { width: 2, token: null }, error: { width: 1, token: null }, loading: { spinner: true } };

// ---- hand-built screens (as figma-cmp.test.mjs): rows declared as buttons, tabs ----
const BG = 'rgb(255, 255, 255)', INK = 'rgb(38, 51, 92)';
const F = (cls, o = {}, ...kids) => ({ t: 'F', cls, ...o, kids });
const T = (text, cls = 't') => ({ t: 'T', cls, text });
const V = (ref, cls = 'ic') => ({ t: 'V', cls, icon: ref, tag: 'svg' });
const SVG = Object.fromEntries(['i-a', 'i-b'].map((r) => [r, `<symbol id="${r}" viewBox="0 0 24 24"><path d="M1 1h${r.length}" stroke="currentColor"></path></symbol>`]));
function srcNode(d, id) {
  const sn = { id, t: d.t, w: d.t === 'V' ? 24 : 80, h: d.t === 'V' ? 24 : 20, sz: d.t === 'V' ? ['FIXED', 'FIXED'] : ['HUG', 'HUG'] };
  if (d.t === 'F') sn.lay = { d: d.d || 'H', p: [4, 8, 4, 8], g: 4, pa: 'S', ca: 'C' };
  if (d.bg) sn.paint = { bg: d.bg, radius: ['6px', '6px', '6px', '6px'] };
  if (d.text != null) { sn.runs = [{ t: d.text }]; sn.font = { ff: 'Inter', fs: '14px', fw: '400', fst: 'normal', lh: 20, ls: 'normal', c: INK, ta: 'start', td: 'none', tt: 'none' }; }
  if (d.icon) sn.icon = { ref: d.icon, color: INK };
  const ir = { id, kind: d.t === 'T' ? 'text' : d.t === 'V' ? 'icon' : 'frame', tag: d.t === 'T' ? 'span' : 'div', cls: d.cls || '', paint: {} };
  const kids = (d.kids || []).map((k, i) => srcNode(k, `${id}.${i}`));
  if (kids.length) { sn.kids = kids.map((k) => k.sn); ir.kids = kids.map((k) => k.ir); }
  return { sn, ir };
}
const scr = (id, ...kids) => {
  const { sn, ir } = srcNode(F('sc', { bg: BG, d: 'V' }, ...kids), 'n');
  sn.w = 320; sn.h = 600; sn.sz = ['FIXED', 'HUG'];
  return { screen: { id, name: id, tree: ir }, spec: sn };
};
const DECL = { version: 1, classes: { row: { kind: 'button' }, tab: { kind: 'tab' } }, keep: {}, drop: [] };
const SCREENS = () => [
  scr('s1', F('row', { bg: 'rgb(230, 240, 250)' }, T('Alpha')), F('row', { bg: 'rgb(230, 240, 250)' }, T('Beta')),
    F('tab', { bg: BG }, V('i-a'), T('One')), F('tab', { bg: BG }, V('i-b'), T('Two'))),
  scr('s2', F('card', { bg: 'rgb(240, 240, 240)', d: 'V' }, F('row', { bg: 'rgb(230, 240, 250)' }, T('C1'))), F('card', { bg: 'rgb(240, 240, 240)', d: 'V' }, F('row', { bg: 'rgb(230, 240, 250)' }, T('D1')))),
];
const col = (hex, c) => ({ $type: 'color', $value: { colorSpace: 'srgb', components: c, hex } });
const TOKENS = () => ({ primitive: { color: { c01: col('#ffffff', [1, 1, 1]), c02: col('#0000ff', [0, 0, 1]) } }, role: { focus: { $type: 'color', $value: '{primitive.color.c02}' } } });

function dsData({ approved = true, states = true } = {}) {
  const src = SCREENS();
  const components = findComponents(src, { decl: DECL });
  const specs = Object.fromEntries(src.map((s) => [s.screen.id, s.spec]));
  const st = componentStates(components, { specs, tokens: TOKENS(), rules: { states: { approved } }, decl: DECL });
  const screens = src.map((s) => ({ id: s.screen.id, W: [320, 420], svgDefs: SVG, spec: s.spec }));
  const d = { ds: 'x', ir: { file: 'f.html' }, tokens: TOKENS(), map: {}, screens, components };
  return { d: states ? withStateTokens(d, st) : d, st };
}
async function buildAll(items, fig) {
  const res = [];
  for (const b of items) {
    const r = await run(b.code, fig);
    res.push(b.data ? decode(r, b.data) : r);
  }
  return res;
}
async function varsOf(fig) {
  const vs = await fig.variables.getLocalVariablesAsync();
  const byId = new Map(vs.map((v) => [v.id, v]));
  return { vs, byId, value: (alias) => { const v = byId.get(alias.id); return Object.values(v.valuesByMode)[0]; } };
}

test('state tokens: approved rules -> number tokens (width in px) and a tokens.css block; not approved -> none', () => {
  const st = { approved: true, rules: RULES };
  const t = stateTokens(st);
  assert.deepEqual(Object.keys(t.state), ['pressed', 'disabled', 'focus', 'error']);
  assert.equal(t.state.disabled.content.$value, 0.38);
  assert.deepEqual(t.state.focus.width.$value, { value: 2, unit: 'px' });
  const css = stateCss(st);
  assert.match(css, /^\/\* vd:states \*\/\n:root \{\n {2}--state-pressed-overlay: 0\.1;\n {2}--state-disabled-content: 0\.38;\n {2}--state-disabled-container: 0\.12;\n {2}--state-focus-width: 2px;\n {2}--state-error-width: 1px;\n\}\n\/\* \/vd:states \*\/\n$/);
  assert.equal(('a{}\n' + css).replace(STATE_CSS_MARK, ''), 'a{}\n');
  assert.deepEqual(stateTokens({ approved: false, rules: RULES }), {});
  assert.equal(stateCss({ ...st, approved: '' }), '');
  assert.deepEqual(stateTokens(null), {});
});

test('State collection: only with state tokens (else the vars batches are byte for byte as before); opacity x 100, width a stroke weight', () => {
  const tokens = TOKENS();
  const before = varsPayload(tokens);
  assert.deepEqual(varsPayload({ ...tokens }), before);
  const withState = { ...tokens, ...stateTokens({ approved: true, rules: RULES }) };
  const p = varsPlan(withState).vars.filter((v) => v.coll === 2);
  assert.deepEqual(p.map((v) => [v.name, v.val, v.sc]), [['state/pressed/overlay', 10, 5], ['state/disabled/content', 38, 5], ['state/disabled/container', 12, 5], ['state/focus/width', 2, 4], ['state/error/width', 1, 4]]);
  assert.match(varsPayload(withState)[0], /"cn":\["Primitive","Role","State"\]/);
  assert.match(before[0], /"cn":\["Primitive","Role"\]/);
});

test('applyState draws each patch as layers on a copy of the template, with the token-map entries they bind', () => {
  const root = { id: 'r', t: 'F', w: 40, h: 20, sz: ['HUG', 'HUG'], lay: { d: 'H' }, paint: { bg: '#ff0000', radius: ['4px', '4px', '4px', '4px'], border: [0, 1, 2, 3].map(() => ({ w: 1, style: 'solid', color: '#000000' })) },
    kids: [{ id: 'r.0', t: 'T', w: 30, h: 16, font: { fs: '14px', c: '#111111' }, runs: [{ t: 'OK' }] }, { id: 'r.1', t: 'V', w: 8, h: 8, icon: { ref: 'x' }, paint: { opacity: 0.5 } }] };
  const nm = { r: { bg: 'role.red', borderT: 'role.ink', 'border-width-T': 'border.1', radiusTL: 'radius.4', paddingL: 'space.4' }, 'r.0': { color: 'role.ink2' } };
  const before = JSON.stringify(root);
  const p = applyState(root, { state: 'pressed', patch: { overlay: { color: '#111111', opacity: 0.1 } } }, nm);
  assert.deepEqual(p.spec.kids.map((k) => k.id), ['r.0', 'r.1', 'r.~pressed']);
  assert.deepEqual(p.spec.kids[2].abs, { x: 0, y: 0, c: 'LR', cy: 'TB' });
  assert.deepEqual(p.map['r.~pressed'], { radiusTL: 'radius.4', bg: 'role.ink2', opacity: 'state.pressed.overlay' });
  const d = applyState(root, { state: 'disabled', patch: { contentOpacity: 0.38, fillOpacity: 0.12, strokeOpacity: 0.12 } }, nm);
  assert.deepEqual(d.spec.kids.map((k) => [k.id, k.paint.opacity]), [['r.~disabled', 0.12], ['r.0', 0.38], ['r.1', 0.19]]);
  assert.equal(d.spec.paint.bg, undefined);
  assert.equal(d.spec.paint.border, undefined);
  assert.equal(d.spec.kids[0].paint.bg, '#ff0000');
  assert.deepEqual(d.map.r, { radiusTL: 'radius.4', paddingL: 'space.4' });
  assert.deepEqual(d.map['r.~disabled'], { radiusTL: 'radius.4', bg: 'role.red', borderT: 'role.ink', 'border-width-T': 'border.1', opacity: 'state.disabled.container' });
  assert.deepEqual(d.map['r.0'], { color: 'role.ink2', opacity: 'state.disabled.content' });
  assert.equal(d.map['r.1'], undefined, 'a child with its own opacity is faded, not bound');
  const b = applyState({ ...root, kids: [] }, { state: 'disabled', patch: { strokeOpacity: 0.38 } }, nm);
  assert.deepEqual(b.spec.kids.map((k) => [k.id, k.paint.opacity, !!k.paint.border]), [['r.~disabled', 0.38, true]]);
  assert.equal(b.map['r.~disabled'].opacity, 'state.disabled.content', 'no kids: the outline is the content');
  const l = applyState(root, { state: 'loading', patch: { spinner: { replace: ['0'], size: 14, color: '#111111' } } }, nm);
  assert.equal(l.spec.kids[0].paint.opacity, 0);
  assert.deepEqual([l.spec.kids[2].t, l.spec.kids[2].w, l.spec.kids[2].abs], ['V', 14, { x: 13, y: 3, c: 'C', cy: 'C' }]);
  assert.deepEqual(l.map['r.~loading'], { stroke: 'role.ink2' });
  const f = applyState(root, { state: 'focus', patch: { ring: { width: 2, color: '#0000ff', token: 'role.focus' } } }, nm);
  assert.deepEqual([f.spec.kids[2].w, f.spec.kids[2].h, f.spec.kids[2].abs.x, f.spec.kids[2].paint.radius[0]], [44, 24, -2, '6px']);
  assert.equal(f.map['r.~focus']['border-width-L'], 'state.focus.width');
  const e = applyState({ ...root, paint: { bg: '#ffffff' } }, { state: 'error', patch: { stroke: { width: 1, color: '#ff0000', token: 'role.error' } } }, {});
  assert.deepEqual(e.spec.paint.border[1], { w: 1, style: 'solid', color: '#ff0000' });
  assert.deepEqual(e.map.r, { borderT: 'role.error', 'border-width-T': 'state.error.width', borderR: 'role.error', 'border-width-R': 'state.error.width', borderB: 'role.error', 'border-width-B': 'state.error.width', borderL: 'role.error', 'border-width-L': 'state.error.width' });
  assert.equal(JSON.stringify(root), before);
});

test('state variants: the row (a button) gets pressed / disabled / loading / focus, bound to the State variables; a variable change reaches every state component', async () => {
  const { d, st } = dsData();
  const row = st.components.find((c) => c.name === 'row');
  assert.deepEqual(row.proposed.map((p) => p.state), ['pressed', 'disabled', 'loading', 'focus']);
  const items = planAll(d, {});
  assert.deepEqual(items.map((b) => b.key), ['vars-01', 'runtime', 'runtime-cmp', 'cmp-01', 'batch-01']);
  const fig = makeFakeFigma();
  const res = await buildAll(items, fig);
  for (const [i, r] of res.entries()) {
    if (!r.screens) continue;
    if (r.cm) assert.deepEqual(r.cm.errors || [], [], items[i].key);
    for (const s of r.screens) {
      assert.deepEqual(s.errors, [], s.screen);
      for (const o of ordOf(items[i].data.screens.find((x) => x.screen === s.screen).T)) assert.ok(s.N[o], `${s.screen} ${o}`);
      for (const [o, x] of Object.entries(s.N)) assert.equal(x.d, undefined, `${s.screen} ${o}: ${JSON.stringify(x.d)}`);
    }
  }
  const cp = page(fig, 'Components');
  const set = cp.children.find((c) => c.name === 'row');
  assert.equal(set.type, 'COMPONENT_SET');
  assert.deepEqual(set.children.map((c) => c.name), ['state=default', 'state=pressed', 'state=disabled', 'state=loading', 'state=focus']);
  // the card's rows and the screens' rows are instances of state=default
  const inst = all(page(fig, 'Screens')).filter((n) => n.type === 'INSTANCE' && n.mainComponent && n.mainComponent.parent === set);
  assert.ok(inst.length >= 2 && inst.every((n) => n.mainComponent.name === 'state=default'));
  const V = await varsOf(fig);
  const bound = (name) => all(cp).filter((n) => n.boundVariables.opacity && V.byId.get(n.boundVariables.opacity.id).name === name);
  assert.equal(bound('state/pressed/overlay').length, 1);
  assert.equal(bound('state/disabled/container').length, 1);
  assert.equal(bound('state/disabled/content').length, 1);
  const ring = all(cp).find((n) => n.name.endsWith('.~focus'));
  assert.equal(V.byId.get(ring.boundVariables.strokeTopWeight.id).name, 'state/focus/width');
  // Figma resolves a bound field from its variable: one new value reaches every layer bound to it
  const content = V.vs.find((v) => v.name === 'state/disabled/content');
  assert.equal(V.value(bound('state/disabled/content')[0].boundVariables.opacity), 38);
  content.setValueForMode(Object.keys(content.valuesByMode)[0], 50);
  assert.ok(bound('state/disabled/content').every((n) => V.value(n.boundVariables.opacity) === 50));
});

test('rules not approved: no State variables, no state variants, every batch byte for byte as without states.json', () => {
  const a = planAll(dsData({ approved: false }).d, {});
  const b = planAll(dsData({ states: false }).d, {});
  assert.deepEqual(a.map((x) => x.key), b.map((x) => x.key));
  for (let i = 0; i < a.length; i++) assert.equal(a[i].code, b[i].code, a[i].key);
  assert.ok(!/state\//.test(a[0].code));
});

test('withStates: a component that has the state axis already keeps it; two variants with one name are an error', () => {
  const c = { name: 'chip', axes: ['state', 'variant'], props: [], variants: [{ props: { state: 'default', variant: 'a' }, template: {}, bind: {}, nodes: [] }] };
  const st = { approved: true, components: [{ name: 'chip', proposed: [{ state: 'disabled', base: 0, props: { state: 'disabled', variant: 'a' }, patch: { contentOpacity: 0.38 } }] }] };
  const [x] = withStates([c], st);
  assert.deepEqual(x.axes, ['state', 'variant']);
  assert.deepEqual(x.variants.map((v) => v.props), [{ state: 'default', variant: 'a' }, { state: 'disabled', variant: 'a' }]);
  assert.equal(withStates([c], { ...st, approved: false })[0], c);
  const dup = { approved: true, components: [{ name: 'chip', proposed: [{ state: 'default', base: 0, props: { state: 'default', variant: 'a' }, patch: {} }] }] };
  assert.throws(() => withStates([c], dup), /two variants named state=default, variant=a/);
});

test('Planora with approved states: 4 btn states, chip / ck / fab / tog disabled; batches under 50 000 bytes; every node read back as encoded', async (t) => {
  const planora = gz('figma-encode-planora.json.gz'), comps = gz('figma-cmp-planora.json.gz'), states = { ...gz('figma-cmp-planora-states.json.gz'), approved: true };
  const tokens = { ...planora.tokens, ...stateTokens(states) };
  const V = varNames(tokens);
  assert.deepEqual(V.filter((n) => n.startsWith('state/')), ['state/pressed/overlay', 'state/disabled/content', 'state/disabled/container', 'state/focus/width', 'state/error/width']);
  const tables = newTables(V);
  const ctx = { file: planora.file, map: planora.map, tables, tokens };
  const encs = planora.screens.map((s) => encodeScreen(s.spec, { ...ctx, screen: s.id, W: s.W, svgDefs: s.svgDefs }));
  const cmp = cmpEncode(comps, planora.screens, { ...ctx, states });
  for (const e of encs) cmp.mark(e);
  const stateItems = cmp.items.filter((x) => /state=(pressed|disabled|loading)/.test(x.cm.v));
  assert.equal(stateItems.length, states.components.reduce((n, c) => n + c.proposed.length, 0));
  for (const x of stateItems) assert.deepEqual(x.unboundList.filter((u) => /^state\./.test(u.path)), [], x.screen);
  const cb = planBatches(cmp.items, { wrap: loaderCode, page: 'Components', extra: { cm: 1 }, unit: (x) => x.cm.n });
  const sb = planBatches(encs, { wrap: loaderCode, extra: { cp: 'Components' } });
  for (const b of [...cb, ...sb]) assert.ok(b.bytes <= 50000, `${b.n} ${b.bytes} B`);
  const plan = varsPlan(tokens, encs.flatMap((e) => e.variants));
  const fig = makeFakeFigma({ variables: V, textStyles: plan.textStyles.map((x) => ({ name: x.name, textDecoration: x.td || 'NONE', textCase: x.tc || 'ORIGINAL' })),
    effectStyles: (plan.effectStyles || []).map((x) => x.name), fonts: [...DEFAULT_FONTS, 'Be Vietnam Pro|Light'] });
  await run(runtimeInstallCode(), fig);
  await run(runtimeCmpInstallCode(), fig);
  let nodes = 0;
  for (const b of [...cb, ...sb]) {
    const r = decode(await run(b.code, fig), b.data);
    if (r.cm) assert.deepEqual(r.cm.errors, [], `cmp ${b.n}`);
    for (const s of r.screens) {
      assert.deepEqual(s.errors, [], s.screen);
      for (const [o, x] of Object.entries(s.N)) assert.equal(x.d, undefined, `${s.screen} ${o}: ${JSON.stringify(x.d)}`);
      nodes += Object.keys(s.N).length;
    }
  }
  const btn = page(fig, 'Components').children.find((c) => c.name === 'btn');
  assert.equal(btn.children.length, 16);
  t.diagnostic(`state variants: ${stateItems.length}; component batches ${cb.map((b) => b.bytes).join(' / ')} B; screen batches ${sb.map((b) => b.bytes).join(' / ')} B; ${nodes} nodes read back`);
});
