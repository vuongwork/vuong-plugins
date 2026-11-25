import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findComponents, readComponentsFile } from '../core/components.mjs';
import { componentStates, forFigma, stateRules, statesDraft, STATE_TABLE } from '../core/states.mjs';
import { readRules } from '../core/rules-file.mjs';

// Same hand-built IR + spec builder as components.test.mjs (no browser).
const BG = 'rgb(255, 255, 255)';
const F = (cls, o = {}, ...kids) => ({ t: 'F', cls, ...o, kids });
const T = (text, cls = 't') => ({ t: 'T', cls, text });
const V = (ref, cls = 'ic') => ({ t: 'V', cls, icon: ref, tag: 'svg' });

function specOf(d, id) {
  const sn = { id, t: d.t, w: 10, h: 10, sz: ['HUG', 'HUG'] };
  if (d.t === 'F') sn.lay = { d: d.d || 'H', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' };
  const paint = {};
  if (d.bg) paint.bg = d.bg;
  if (d.border) paint.border = [0, 1, 2, 3].map(() => ({ w: d.border, style: 'solid', color: 'rgb(0, 0, 0)' }));
  if (Object.keys(paint).length) sn.paint = paint;
  if (d.text != null) { sn.runs = [{ t: d.text }]; sn.font = { ff: 'Inter', fs: '14px', fw: '400', lh: 20, c: 'rgb(0, 0, 0)' }; }
  if (d.icon) sn.icon = { ref: d.icon };
  return sn;
}
function srcNode(d, id) {
  const sn = specOf(d, id);
  const ir = { id, kind: d.t === 'T' ? 'text' : d.t === 'V' ? 'icon' : 'frame', tag: d.tag || (d.t === 'T' ? 'span' : 'div'), cls: d.cls || '', paint: {} };
  let k = 0;
  const irKids = [];
  const kids = (d.kids || []).map((x) => { const r = srcNode(x, `${id}.${k++}`); irKids.push(r.ir); return r.sn; });
  if (kids.length) sn.kids = kids;
  if (irKids.length) ir.kids = irKids;
  return { sn, ir };
}
const scr = (id, ...kids) => {
  const { sn, ir } = srcNode(F('sc', { bg: BG, d: 'V' }, ...kids), 'n');
  return { screen: { id, name: id, tree: ir }, spec: sn };
};
const decl = (classes = {}) => ({ version: 1, classes, keep: {}, drop: [] });
const specsOf = (screens) => Object.fromEntries(screens.map((s) => [s.screen.id, s.spec]));
const run = (screens, d, o = {}) => componentStates(findComponents(screens, { decl: d }), { specs: specsOf(screens), decl: d, ...o });
const cmp = (st, name) => st.components.find((c) => c.name === name);
const src = (c) => Object.fromEntries(c.states.map((s) => [s.state, s.source]));
const tokens = (role) => ({
  primitive: { color: { c01: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 1], hex: '#0000ff' } },
    c02: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000' } } } },
  role: Object.fromEntries(Object.entries(role).map(([n, p]) => [n, { $type: 'color', $value: `{${p}}` }])),
});
const btn = (text, ...cls) => F(['btn', ...cls].join(' '), { bg: 'rgb(255, 0, 0)' }, T(text, 'lbl'));
const BTN = decl({ btn: { kind: 'button' } });
const ck = (...cls) => F(['ck', ...cls].join(' '), { border: 2 }, F('m', { bg: 'rgb(0, 0, 0)' }));
const rules = (states) => ({ version: 1, answers: {}, states });

test('a button with only its normal state in the HTML: pressed, disabled, loading proposed with values; focus missing without a token', () => {
  const st = run([scr('s1', btn('OK'), btn('Go'))], BTN);
  const c = cmp(st, 'btn');
  assert.equal(c.kind, 'button');
  assert.deepEqual(c.states.map((s) => s.state), STATE_TABLE.button);
  assert.deepEqual(src(c), { default: 'html', pressed: 'proposed', disabled: 'proposed', loading: 'proposed', focus: 'missing' });
  const p = Object.fromEntries(c.proposed.map((x) => [x.state, x]));
  assert.deepEqual(p.pressed.patch, { overlay: { color: '#000000', opacity: 0.1 } });
  assert.deepEqual(p.disabled.patch, { contentOpacity: 0.38, fillOpacity: 0.12 });
  assert.deepEqual(p.loading.patch, { spinner: { replace: ['0'], size: 14, color: '#000000' } });
  assert.equal(p.pressed.base, 0);
  assert.equal(p.pressed.props.state, 'pressed');
  const focus = c.states.find((s) => s.state === 'focus');
  assert.match(focus.reason, /no focus colour token/);
  assert.deepEqual(st.missing, [{ component: 'btn', kind: 'button', state: 'focus', reason: focus.reason }]);
});

test('a focus token found by name (or named in the rules) makes focus proposed', () => {
  const screens = [scr('s1', btn('OK'))];
  let c = cmp(run(screens, BTN, { tokens: tokens({ 'focus-ring': 'primitive.color.c01' }) }), 'btn');
  assert.equal(src(c).focus, 'proposed');
  assert.deepEqual(c.proposed.find((x) => x.state === 'focus').patch, { ring: { width: 2, color: '#0000ff', token: 'role.focus-ring' } });
  c = cmp(run(screens, BTN, { tokens: tokens({ ring: 'primitive.color.c01' }), rules: rules({ focus: { token: 'role.ring', width: 3 } }) }), 'btn');
  assert.deepEqual(c.proposed.find((x) => x.state === 'focus').patch.ring, { width: 3, color: '#0000ff', token: 'role.ring' });
  c = cmp(run(screens, BTN, { tokens: tokens({}), rules: rules({ focus: { token: 'role.nope' } }) }), 'btn');
  assert.match(c.states.find((s) => s.state === 'focus').reason, /role\.nope .*not a colour/);
});

test('a button drawn disabled in the HTML (is-disabled): disabled comes from the HTML, not generated', () => {
  const c = cmp(run([scr('s1', btn('OK'), btn('No', 'is-disabled'))], BTN), 'btn');
  assert.equal(src(c).disabled, 'html');
  const iDis = c.states.find((s) => s.state === 'disabled').variants;
  assert.equal(iDis.length, 1);
  assert.deepEqual(c.proposed.map((x) => x.state).sort(), ['loading', 'pressed']);
  assert.ok(c.proposed.every((x) => !iDis.includes(x.base)));
});

test('an input without an error token: error missing and listed for coverage; a danger token makes it proposed', () => {
  const inp = (t) => F('in', { bg: 'rgb(255, 255, 255)', border: 1 }, T(t));
  const D = decl({ in: { kind: 'input' } });
  let st = run([scr('s1', inp('a'))], D);
  let c = cmp(st, 'in');
  assert.deepEqual(src(c), { empty: 'html', focus: 'missing', filled: 'missing', error: 'missing', disabled: 'proposed' });
  assert.deepEqual(st.missing.map((m) => m.state), ['focus', 'filled', 'error']);
  assert.match(st.missing.find((m) => m.state === 'filled').reason, /no rule draws this state/);
  assert.deepEqual(c.proposed[0].patch, { contentOpacity: 0.38, fillOpacity: 0.12, strokeOpacity: 0.12 });
  st = run([scr('s1', inp('a'))], D, { tokens: tokens({ danger: 'primitive.color.c02' }) });
  c = cmp(st, 'in');
  assert.equal(src(c).error, 'proposed');
  assert.deepEqual(c.proposed.find((x) => x.state === 'error').patch, { stroke: { width: 1, color: '#ff0000', token: 'role.danger' } });
});

test('rules not approved: nothing proposed goes to Figma; approved by the user: it does', () => {
  const screens = [scr('s1', btn('OK'))];
  const st = run(screens, BTN);
  assert.equal(st.approved, false);
  assert.ok(cmp(st, 'btn').proposed.length > 0);
  assert.deepEqual(forFigma(st).components.flatMap((c) => c.proposed), []);
  for (const a of ['', false]) assert.equal(run(screens, BTN, { rules: rules({ approved: a }) }).approved, false);
  const ok = run(screens, BTN, { rules: rules({ approved: true }) });
  assert.equal(forFigma(ok).components[0].proposed.length, cmp(ok, 'btn').proposed.length);
});

test('a checkbox: on maps to checked from the HTML, disabled proposed; with only the normal state, checked is missing', () => {
  const D = decl({ ck: { kind: 'checkbox' } });
  let c = cmp(run([scr('s1', ck(), ck('on'))], D), 'ck');
  assert.deepEqual(src(c), { unchecked: 'html', checked: 'html', disabled: 'proposed' });
  assert.deepEqual(c.proposed[0].patch, { contentOpacity: 0.38, strokeOpacity: 0.12 });
  c = cmp(run([scr('s1', ck(), ck())], D), 'ck');
  assert.equal(src(c).checked, 'missing');
});

test('a declared state class outside the table is an extra state with a warning until stateMap maps it', () => {
  const screens = [scr('s1', ck(), ck('done'))];
  let st = run(screens, decl({ ck: { kind: 'checkbox', states: ['done'] } }));
  let c = cmp(st, 'ck');
  assert.equal(c.extra.length, 1);
  assert.equal(c.extra[0].state, 'done');
  assert.equal(src(c).checked, 'missing');
  assert.equal(st.warnings.length, 1);
  assert.match(st.warnings[0], /done not in the checkbox table/);
  st = run(screens, decl({ ck: { kind: 'checkbox', states: ['done'], stateMap: { done: 'checked' } } }));
  c = cmp(st, 'ck');
  assert.deepEqual(c.extra, []);
  assert.equal(src(c).checked, 'html');
  assert.deepEqual(st.warnings, []);
  assert.throws(() => run(screens, decl({ ck: { kind: 'checkbox', states: ['done'], stateMap: { done: 'on' } } })), /stateMap\.done: "on" is not a state of kind checkbox/);
});

test('kind other has no table: its HTML states are kept as extra, nothing proposed or missing', () => {
  const st = run([scr('s1', F('li', { bg: BG }, T('a')), F('li on', { bg: BG }, T('b')))]);
  const c = cmp(st, 'li');
  assert.deepEqual(c.states, []);
  assert.deepEqual(c.proposed, []);
  assert.equal(c.extra.length, 1);
  assert.equal(c.extra[0].state, 'on');
  assert.deepEqual(st.missing, []);
  assert.deepEqual(st.warnings, []);
});

test('an icon-only button with no icon colour: pressed and loading are missing with the reason', () => {
  const st = run([scr('s1', F('fab', { bg: 'rgb(255, 0, 0)' }, V('i-plus')))], decl({ fab: { kind: 'button' } }));
  const c = cmp(st, 'fab');
  assert.match(c.states.find((s) => s.state === 'pressed').reason, /no text or icon colour/);
  assert.match(c.states.find((s) => s.state === 'loading').reason, /no label/);
});

test('the result does not depend on the order of screens', () => {
  const a = scr('s1', btn('OK'), btn('No', 'is-disabled'));
  const b = scr('s2', btn('Go'));
  assert.equal(JSON.stringify(run([a, b], BTN)), JSON.stringify(run([b, a], BTN)));
});

test('stateRules: defaults, user values, and errors that name the key; the draft leaves approved empty', () => {
  const d = stateRules(undefined);
  assert.equal(d.approved, false);
  assert.deepEqual(d.rules.disabled, { content: 0.38, container: 0.12 });
  assert.equal(stateRules({ states: { pressed: { overlay: 0.08 } } }).rules.pressed.overlay, 0.08);
  assert.throws(() => stateRules({ states: { hover: {} } }), /unknown rule "hover"/);
  assert.throws(() => stateRules({ states: { pressed: { overlay: 10 } } }), /states\.pressed\.overlay: 10 is not allowed/);
  assert.throws(() => stateRules({ states: { focus: { colour: 'x' } } }), /states\.focus: unknown key "colour"/);
  assert.throws(() => stateRules({ states: { approved: 'yes' } }), /approved must be true, false or ""/);
  const dr = statesDraft(undefined);
  assert.equal(dr.approved, '');
  assert.deepEqual(dr.loading, { spinner: true });
  assert.equal(stateRules({ states: dr }).approved, false);
});

test('readRules keeps a states section and rejects one that is not an object; stateMap is checked on read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-states-'));
  const p = join(dir, 'r.json');
  writeFileSync(p, JSON.stringify({ version: 1, answers: {}, states: { approved: true, pressed: { overlay: 0.12 } } }));
  assert.deepEqual(readRules(p).states, { approved: true, pressed: { overlay: 0.12 } });
  writeFileSync(p, JSON.stringify({ version: 1, answers: {}, states: [] }));
  assert.throws(() => readRules(p), /"states" must be an object/);
  writeFileSync(p, JSON.stringify({ version: 1, classes: { ck: { stateMap: { done: 1 } } } }));
  assert.throws(() => readComponentsFile(p), /classes\.ck\.stateMap must map a class to a state id/);
});

// keep with a kind (2026-11-25): a bare block has no class to declare, so its kind and stateMap go on its keep entry
test('a kept bare block declared as a tab: on is selected from the HTML; its stateMap maps another class', () => {
  const item = (t, ...cls) => F(cls.join(' '), { bg: BG }, T(t, 'lbl'), F('dot', { bg: 'rgb(0, 0, 0)' }));
  const screens = [scr('s1', F('nav', {}, item('Inbox', 'on'), item('Plan'), item('Done')))];
  const key = findComponents(screens, { decl: decl() }).components.find((c) => c.key.startsWith('b:')).key;
  const d = { ...decl(), keep: { [key]: { name: 'nav-item', kind: 'tab' } } };
  const r = findComponents(screens, { decl: d });
  const c = r.components.find((x) => x.name === 'nav-item');
  assert.equal(c.kind, 'tab');
  assert.equal(c.reason, 'control');
  const st = run(screens, d);
  assert.deepEqual(src(cmp(st, 'nav-item')), { unselected: 'html', selected: 'html' });
  // a class the words do not map: extra until the keep entry's stateMap maps it
  const s2 = [scr('s1', F('nav', {}, item('Inbox', 'is-cur'), item('Plan')))];
  const k2 = findComponents(s2, { decl: decl() }).components.find((x) => x.key.startsWith('b:')).key;
  assert.deepEqual(src(cmp(run(s2, { ...decl(), keep: { [k2]: { name: 'nav-item', kind: 'tab' } } }), 'nav-item')), { unselected: 'html', selected: 'missing' });
  assert.deepEqual(src(cmp(run(s2, { ...decl(), keep: { [k2]: { name: 'nav-item', kind: 'tab', stateMap: { 'is-cur': 'selected' } } } }), 'nav-item')), { unselected: 'html', selected: 'html' });
  assert.throws(() => run(s2, { ...decl(), keep: { [k2]: { name: 'nav-item', kind: 'tab', stateMap: { 'is-cur': 'on' } } } }), /keep\.b:[0-9a-f]{8}\.stateMap.is-cur: "on" is not a state of kind tab/);
});

test('keep entries: a name or { name, kind?, stateMap? }; a bad kind or key is named', () => {
  const screens = [scr('s1', F('nav', {}, F('on', { bg: BG }, T('A', 'lbl'), F('dot', { bg: BG })), F('', { bg: BG }, T('B', 'lbl'), F('dot', { bg: BG }))))];
  assert.throws(() => findComponents(screens, { decl: { ...decl(), keep: { 'b:00000000': { name: 'x', kind: 'menu' } } } }), /keep\.b:00000000\.kind "menu" is not one of/);
  assert.throws(() => findComponents(screens, { decl: { ...decl(), keep: { 'b:00000000': { kind: 'tab' } } } }), /keep\.b:00000000\.name must be a non-empty string/);
  assert.throws(() => findComponents(screens, { decl: { ...decl(), keep: { 'b:00000000': { name: 'x', role: 'tab' } } } }), /keep\.b:00000000: unknown key "role"/);
  assert.throws(() => findComponents(screens, { decl: { ...decl(), keep: { 'b:00000000': 3 } } }), /keep\.b:00000000 must be a name or/);
});

// Task 5: contrast of proposed states
test('contrast: a disabled state with low contrast is exempt (no warning); a low-contrast error stroke is a warning', () => {
  const pale = { primitive: { color: { p: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0.8, 0.8], hex: '#ffcccc' } } } },
    role: { danger: { $type: 'color', $value: '{primitive.color.p}' } } };
  const inp = (t) => F('in', { bg: 'rgb(255, 255, 255)', border: 1 }, T(t));
  const D = decl({ in: { kind: 'input' } });
  const st = run([scr('s1', inp('a'))], D, { tokens: pale });
  const c = cmp(st, 'in');
  const p = Object.fromEntries(c.proposed.map((x) => [x.state, x]));
  assert.match(p.disabled.contrast.exempt, /disabled/);
  assert.equal(p.error.contrast.ok, false);
  assert.equal(p.error.contrast.required, '3:1');
  assert.ok(p.error.contrast.ratio < 3);
  assert.equal(p.error.contrast.what, 'error stroke');
  assert.deepEqual(st.warnings.filter((w) => /WCAG/.test(w)), [`in (input) error: error stroke ${p.error.contrast.ratio}:1, below WCAG 3:1`]);
  // a red error stroke on white passes
  const ok = cmp(run([scr('s1', inp('a'))], D, { tokens: tokens({ danger: 'primitive.color.c02' }) }), 'in');
  assert.equal(ok.proposed.find((x) => x.state === 'error').contrast.ok, true);
});

test('contrast: pressed measures each text under the overlay and gives the ratio without it', () => {
  // black text on red: 5.25:1; a 10 % black overlay lowers it below 4.5:1
  const st = run([scr('s1', btn('OK'), btn('Go'))], BTN);
  const pr = cmp(st, 'btn').proposed.find((x) => x.state === 'pressed');
  assert.equal(pr.contrast.what, 'text 0');
  assert.equal(pr.contrast.base, 5.25);
  assert.ok(pr.contrast.ratio < pr.contrast.base);
  assert.equal(pr.contrast.ok, pr.contrast.ratio >= 4.5);
  assert.equal(cmp(st, 'btn').proposed.find((x) => x.state === 'loading').contrast.required, '3:1');
});
