import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findComponents, componentsDraft, readComponentsFile, expandInstance, instanceDiff, instanceOf, diffReason } from '../core/components.mjs';

// Hand-built IR (capture) + modelled spec for each screen; no browser. Source ids follow capture: root 'n', kids
// '<parent>.<k>', pseudo '<parent>.a' / '.b'; synthetic frames '<source parent>.g<k>' whose kids keep source ids.
const BG = 'rgb(255, 255, 255)';
const F = (cls, o = {}, ...kids) => ({ t: 'F', cls, ...o, kids });
const T = (text, cls = 't') => ({ t: 'T', cls, text });
const V = (ref, cls = 'ic') => ({ t: 'V', cls, icon: ref, tag: 'svg' });
const A = (o = {}) => ({ t: 'F', pseudo: 'a', ...o, kids: [] });

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
  const ir = { id, kind: d.pseudo ? 'pseudo' : d.t === 'T' ? 'text' : d.t === 'V' ? 'icon' : 'frame', tag: d.tag || (d.t === 'T' ? 'span' : 'div'), cls: d.cls || '', paint: {} };
  const ctr = { k: 0, g: 0 }, irKids = [];
  const kids = (d.kids || []).map((k) => place(k, id, ctr, irKids));
  if (kids.length) sn.kids = kids;
  if (irKids.length) ir.kids = irKids;
  return { sn, ir };
}
function place(k, srcId, ctr, irKids) {
  if (k.syn) {
    const sn = specOf(k, `${srcId}.g${ctr.g++}`);
    sn.syn = k.syn;
    sn.kids = k.kids.map((x) => place(x, srcId, ctr, irKids));
    return sn;
  }
  const { sn, ir } = srcNode(k, k.pseudo ? `${srcId}.${k.pseudo}` : `${srcId}.${ctr.k++}`);
  irKids.push(ir);
  return sn;
}
const scr = (id, ...kids) => {
  const { sn, ir } = srcNode(F('sc', { bg: BG, d: 'V' }, ...kids), 'n');
  return { screen: { id, name: id, tree: ir }, spec: sn };
};
const row = (text, ...more) => F('row', { bg: BG }, T(text), ...more);
const names = (r) => r.components.map((c) => c.name);
const decl = (classes = {}, o = {}) => ({ version: 1, classes, keep: {}, drop: [], ...o });

test('three rows with a class and a fill, different texts: one component with one TEXT property', () => {
  const r = findComponents([scr('s1', row('A'), row('B')), scr('s2', row('C'))]);
  assert.deepEqual(names(r), ['row']);
  const c = r.components[0];
  assert.equal(c.reason, 'class');
  assert.equal(c.kind, 'other');
  assert.equal(c.count, 3);
  assert.deepEqual(c.screens, ['s1', 's2']);
  assert.deepEqual(c.props, [{ name: 't', type: 'TEXT', default: 'A' }]);
  assert.equal(c.variants.length, 1);
  assert.deepEqual(c.variants[0].template, { screen: 's1', node: 'n.0' });
  assert.deepEqual(c.variants[0].bind, { t: '0' });
  assert.deepEqual(c.variants[0].nodes, [
    { screen: 's1', node: 'n.0', vals: {} },
    { screen: 's1', node: 'n.1', vals: { t: 'B' } },
    { screen: 's2', node: 'n.0', vals: { t: 'C' } },
  ]);
});

test('a state class makes a component set with a state axis', () => {
  const done = F('row is-done', { bg: BG }, T('C'));
  const r = findComponents([scr('s1', row('A'), row('B'), done)]);
  assert.deepEqual(names(r), ['row']);
  const c = r.components[0];
  assert.deepEqual(c.axes, ['state']);
  assert.deepEqual(c.variants.map((v) => v.props), [{ state: 'default' }, { state: 'is-done' }]);
  assert.deepEqual(c.variants[1].nodes.map((n) => n.node), ['n.2']);
});

test('a state class makes a component even without its own fill (reason state)', () => {
  const r = findComponents([scr('s1', F('tab', {}, T('A')), F('tab on', {}, T('B')))]);
  assert.deepEqual(names(r), ['tab']);
  assert.equal(r.components[0].reason, 'state');
});

test('a child missing in one occurrence is a BOOLEAN property', () => {
  const r = findComponents([scr('s1', row('A', F('badge', { bg: BG }, T('1', 'n'))), row('A'))]);
  const c = r.components.find((x) => x.name === 'row');
  assert.deepEqual(c.props, [{ name: 'show-badge', type: 'BOOLEAN', default: true }]);
  assert.deepEqual(c.variants[0].bind, { 'show-badge': '1' });
  assert.deepEqual(c.variants[0].nodes.map((n) => n.vals), [{}, { 'show-badge': false }]);
});

test('a different icon at the same place is an INSTANCE_SWAP property', () => {
  const r = findComponents([scr('s1', row('A', V('home')), row('A', V('cal')))]);
  const c = r.components[0];
  assert.deepEqual(c.props, [{ name: 'ic', type: 'INSTANCE_SWAP', default: 'home' }]);
  assert.deepEqual(c.icons, ['cal', 'home']);
  assert.deepEqual(c.variants[0].nodes.map((n) => n.vals), [{}, { ic: 'cal' }]);
});

test('a different fill without a different class is an override, not a variant', () => {
  const r = findComponents([scr('s1', row('A'), F('row', { bg: 'rgb(1, 2, 3)' }, T('A')))]);
  assert.equal(r.components[0].variants.length, 1);
  assert.deepEqual(r.components[0].axes, []);
});

test('the result does not depend on the order of screens', () => {
  const a = scr('s1', row('A'), F('row is-done', { bg: BG }, T('B'))), b = scr('s2', row('C', V('x')));
  assert.equal(JSON.stringify(findComponents([a, b])), JSON.stringify(findComponents([b, a])));
});

test('a block with a class and its own paint is a component even once; a frame with no paint of its own is not', () => {
  const r = findComponents([scr('s1', F('card', { border: 1 }, T('A')), F('wrap', {}, T('B'), T('C')))]);
  assert.deepEqual(names(r), ['card']);
  assert.equal(r.components[0].count, 1);
});

test('a one-node block is a component only when declared as a control', () => {
  const s = [scr('s1', F('ck', { border: 2 }), F('ck', { border: 2 }))];
  assert.deepEqual(names(findComponents(s)), []);
  const r = findComponents(s, { decl: decl({ ck: { kind: 'checkbox' } }) });
  assert.deepEqual(names(r), ['ck']);
  assert.equal(r.components[0].reason, 'control');
  assert.equal(r.components[0].kind, 'checkbox');
});

test('a <button> tag is a control without a declaration', () => {
  const r = findComponents([scr('s1', { t: 'F', tag: 'button', cls: '', kids: [] })]);
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].kind, 'button');
});

test('an undeclared modifier class makes a separate component; declared, it is a variant axis', () => {
  const s = [scr('s1', F('ck', { border: 2 }, A()), F('ck L', { border: 2 }, A()))];
  assert.equal(findComponents(s).components.length, 2);
  const r = findComponents(s, { decl: decl({ ck: { kind: 'checkbox', variants: { size: ['L', 'S'] } } }) });
  assert.deepEqual(names(r), ['ck']);
  assert.deepEqual(r.components[0].axes, ['size']);
  assert.deepEqual(r.components[0].variants.map((v) => v.props), [{ size: 'L' }, { size: 'default' }]);
});

test('variants may differ in structure: declared modifiers with different kids are not several shapes', () => {
  const s = [scr('s1', F('chip', { bg: BG }, T('A')), F('chip o', { bg: BG }, F('dot', { bg: BG }), T('B')), F('chip', { bg: BG }, T('C')))];
  const r = findComponents(s, { decl: decl({ chip: { kind: 'chip', variants: { tone: ['o'] } } }) });
  assert.deepEqual(names(r), ['chip']);
  assert.deepEqual(r.components[0].axes, ['tone']);
  assert.deepEqual(r.skipped, []);
});

test('a declared state class (done) is a state variant, a declared name is used', () => {
  const s = [scr('s1', F('li', { bg: BG }, T('A')), F('li done', { bg: BG }, T('B')))];
  assert.equal(findComponents(s).components.length, 2);
  const r = findComponents(s, { decl: decl({ li: { states: ['done'], name: 'task-row' } }) });
  assert.deepEqual(names(r), ['task-row']);
  assert.deepEqual(r.components[0].variants.map((v) => v.props), [{ state: 'default' }, { state: 'done' }]);
});

test('bare repeated blocks are proposals until kept; a bare block seen once is nothing', () => {
  const bare = (t) => F('', { bg: BG }, T(t, ''));
  const s = [scr('s1', F('list', {}, bare('A'), bare('B')), F('other', {}, bare('C')))];
  const r = findComponents(s);
  assert.deepEqual(names(r), []);
  assert.equal(r.proposed.length, 1);
  assert.equal(r.proposed[0].count, 2);
  assert.match(r.proposed[0].key, /^b:[0-9a-f]{8}$/);
  assert.deepEqual(r.proposed[0].nodes, [{ screen: 's1', node: 'n.0.0' }, { screen: 's1', node: 'n.0.1' }]);
  const k = findComponents(s, { decl: decl({}, { keep: { [r.proposed[0].key]: 'list-item' } }) });
  assert.deepEqual(names(k), ['list-item']);
  assert.equal(k.components[0].reason, 'bare');
  assert.equal(k.proposed.length, 0);
});

test('a control inside a row is its own nested component; the row does not take its inner differences', () => {
  const ck = (on) => F(on ? 'ck on' : 'ck', { border: 2 }, ...(on ? [A()] : []));
  const s = [scr('s1', F('li', { bg: BG }, ck(true), T('A')), F('li', { bg: BG }, ck(false), T('B')))];
  const r = findComponents(s, { decl: decl({ ck: { kind: 'checkbox' } }) });
  assert.deepEqual(names(r), ['ck', 'li']);
  const li = r.components.find((c) => c.name === 'li');
  assert.deepEqual(li.props, [{ name: 't', type: 'TEXT', default: 'A' }]);
  assert.deepEqual(li.variants[0].nested, { '0': 'ck' });
  const ckC = r.components.find((c) => c.name === 'ck');
  assert.deepEqual(ckC.variants.map((v) => v.props), [{ state: 'default' }, { state: 'on' }]);
});

test('a class block always inside another component with the same count is not split out', () => {
  const s = [scr('s1', F('li', { bg: BG }, F('card', { bg: BG }, T('A'))), F('li', { bg: BG }, F('card', { bg: BG }, T('B'))))];
  const r = findComponents(s);
  assert.deepEqual(names(r), ['li']);
  assert.deepEqual(r.skipped, [{ key: 'c:div.card', count: 2, reason: 'nested' }]);
});

test('a class block inside a bare proposal (not a component) stays a component', () => {
  const blk = (t) => F('', { bg: BG }, F('card', { bg: BG }, T(t)));
  const r = findComponents([scr('s1', blk('A'), blk('B'))]);
  assert.deepEqual(names(r), ['card']);
  assert.equal(r.proposed.length, 1);
  assert.deepEqual(r.skipped, []);
});

test('a block nested in a container (several shapes, no choice) becomes a component again', () => {
  const badge = () => F('badge', { bg: BG }, T('1', 'n'));
  const s = [scr('s1', F('card', { bg: BG }, badge(), T('A')), F('card', { bg: BG }, T('B'), badge(), T('C', 'u')))];
  const r = findComponents(s);
  assert.deepEqual(names(r), ['badge']);
  assert.deepEqual(r.skipped, [{ key: 'c:div.card', count: 2, reason: 'shapes', sizes: [1, 1] }]);
});

test('a dropped component is skipped with reason user', () => {
  const r = findComponents([scr('s1', row('A'))], { decl: decl({}, { drop: ['row'] }) });
  assert.deepEqual(names(r), []);
  assert.deepEqual(r.skipped, [{ key: 'c:div.row', count: 1, reason: 'user' }]);
});

test('a class with two structures is layers until the user chooses variants or split', () => {
  const s = [scr('s1', F('row', { bg: BG }, T('A'), F('x', {}, T('1', 'n'))), F('row', { bg: BG }, F('x', {}, T('1', 'n')), T('A')), row('B', F('x', {}, T('2', 'n'))))];
  const r = findComponents(s);
  assert.deepEqual(names(r), []);
  assert.deepEqual(r.skipped, [{ key: 'c:div.row', count: 3, reason: 'shapes', sizes: [2, 1] }]);
  const v = findComponents(s, { decl: decl({ row: { shapes: 'variants' } }) });
  assert.deepEqual(names(v), ['row']);
  assert.deepEqual(v.components[0].axes, ['shape']);
  assert.deepEqual(v.components[0].variants.map((x) => [x.props.shape, x.nodes.map((n) => n.node)]), [['1', ['n.0', 'n.2']], ['2', ['n.1']]]);
  const sp = findComponents(s, { decl: decl({ row: { shapes: 'split' } }) });
  assert.deepEqual(names(sp), ['row-1', 'row-2']);
  assert.deepEqual(sp.components.map((c) => [c.key, c.count, c.axes]), [['c:div.row#1', 2, []], ['c:div.row#2', 1, []]]);
  const d = componentsDraft(s);
  assert.equal(d.classes.row.shapes, 'container');
  assert.match(d.notes['cls:row'], /2 shapes \(occurrences per shape: 2, 1\)/);
});

test('synthetic frames and pseudo elements are never roots; their kids are matched by kind', () => {
  const s = [scr('s1', F('row', { bg: BG }, { t: 'F', syn: 'row', kids: [T('A'), T('B', 'u')] }), F('row', { bg: BG }, { t: 'F', syn: 'row', kids: [T('C'), T('D', 'u')] }))];
  const r = findComponents(s);
  assert.deepEqual(names(r), ['row']);
  assert.deepEqual(r.components[0].props.map((p) => p.name), ['t', 'u']);
  assert.deepEqual(r.components[0].variants[0].bind, { t: '0', u: '1' });
});

test('the draft suggests kinds by class name and states / variants from classes seen with the base class', () => {
  const s = [scr('s1', F('ck', { border: 2 }), F('ck on', { border: 2 }, A()), F('ck L', { border: 2 }),
    F('li', { bg: BG }, T('A')), F('li done', { bg: BG }, T('B')), F('', { bg: BG }, T('x', '')), F('', { bg: BG }, T('y', '')))];
  const d = componentsDraft(s);
  assert.equal(d.version, 1);
  assert.deepEqual(d.classes.ck, { kind: 'checkbox', variants: { variant: ['L'] } });
  assert.deepEqual(d.classes.li, { kind: 'other', states: ['done'] });
  assert.deepEqual(d.keep, {});
  assert.deepEqual(d.drop, []);
  assert.match(d.notes['cls:ck'], /3 roots on 1 screen/);
  const bareKey = Object.keys(d.notes).find((k) => k.startsWith('b:'));
  assert.ok(bareKey, 'a note for the bare proposal');
});

test('readComponentsFile: missing file gives the empty declaration; bad content throws with the key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vdc-'));
  assert.deepEqual(readComponentsFile(join(dir, 'none.json')), { version: 1, classes: {}, keep: {}, drop: [] });
  const p = join(dir, 'c.json');
  writeFileSync(p, JSON.stringify({ version: 1, classes: { ck: { kind: 'checkbox', states: ['on'], variants: { size: ['L'] } } }, notes: { x: 'y' } }));
  assert.deepEqual(readComponentsFile(p), { version: 1, classes: { ck: { kind: 'checkbox', states: ['on'], variants: { size: ['L'] } } }, keep: {}, drop: [] });
  writeFileSync(p, JSON.stringify({ version: 1, classes: { ck: { kind: 'knob' } } }));
  assert.throws(() => readComponentsFile(p), /ck.*kind/);
  writeFileSync(p, JSON.stringify({ version: 1, classes: { li: { shapes: 'many' } } }));
  assert.throws(() => readComponentsFile(p), /li.shapes/);
  writeFileSync(p, JSON.stringify({ version: 2 }));
  assert.throws(() => readComponentsFile(p), /version/);
  writeFileSync(p, JSON.stringify({ version: 1, approved: true }));
  assert.throws(() => readComponentsFile(p), /unknown top-level key "approved"/);
});

// ---- Task 5: every occurrence must rebuild its target spec from the component, else it is detached ----
const nodeAt = (spec, id) => { if (spec.id === id) return spec; for (const k of spec.kids || []) { const x = nodeAt(k, id); if (x) return x; } return null; };
const allNodes = (c) => c.variants.flatMap((v) => v.nodes);

test('every occurrence of the fixture rebuilds: texts by property, a colour without a class by override', () => {
  const s = [scr('s1', row('A'), row('B')), scr('s2', row('C'))];
  nodeAt(s[1].spec, 'n.0').paint.bg = 'rgb(240, 240, 240)';
  const r = findComponents(s);
  const c = r.components[0];
  assert.equal(c.detached, undefined);
  assert.equal(c.count, 3);
  const n = allNodes(c);
  assert.deepEqual(n.map((x) => x.ov), [undefined, undefined, { '': { 'paint.bg': 'rgb(240, 240, 240)' } }]);
  assert.equal(c.variants.length, 1);
});

test('noise is not a variant: gap 12 and 12.01, a FIXED width 0.3 px apart -> one component, no override', () => {
  const s = [scr('s1', row('A'), row('B'))];
  nodeAt(s[0].spec, 'n.0').lay.g = 12;
  nodeAt(s[0].spec, 'n.1').lay.g = 12.01;
  for (const [id, w] of [['n.0', 100], ['n.1', 100.3]]) Object.assign(nodeAt(s[0].spec, id), { w, sz: ['FIXED', 'HUG'] });
  const c = findComponents(s).components[0];
  assert.equal(c.variants.length, 1);
  assert.deepEqual(allNodes(c).map((x) => x.ov), [undefined, undefined]);
  // 2 px is a real difference: the instance's own width
  nodeAt(s[0].spec, 'n.1').w = 102;
  assert.deepEqual(allNodes(findComponents(s).components[0])[1].ov, { '': { w: 102 } });
});

test('a difference no override can make (an absolute child moved) detaches that occurrence, with the reason', () => {
  const s = [scr('s1', row('A', F('dot', { bg: 'rgb(0, 0, 0)' })), row('B', F('dot', { bg: 'rgb(0, 0, 0)' }))), scr('s2', row('C', F('dot', { bg: 'rgb(0, 0, 0)' })))];
  for (const [sc, id, x] of [[0, 'n.0.1', 4], [0, 'n.1.1', 4], [1, 'n.0.1', 30]]) nodeAt(s[sc].spec, id).abs = { x, y: 0, c: 'L' };
  const r = findComponents(s);
  const c = r.components.find((x) => x.name === 'row');
  assert.equal(c.count, 2);
  assert.deepEqual(allNodes(c).map((x) => `${x.screen} ${x.node}`), ['s1 n.0', 's1 n.1']);
  assert.equal(c.detached.length, 1);
  assert.deepEqual([c.detached[0].screen, c.detached[0].node], ['s2', 'n.0']);
  assert.match(c.detached[0].reason, /^1 abs\.x: 4 in the component, 30 here \(not overridable\)/);
});

test('an override left out is caught: the instance would differ, so it is detached, never a wrong instance', () => {
  const s = [scr('s1', row('A'), row('B'))];
  nodeAt(s[0].spec, 'n.1.0').font.c = 'rgb(200, 0, 0)';
  const tpl = nodeAt(s[0].spec, 'n.0'), occ = nodeAt(s[0].spec, 'n.1');
  const props = { text: { type: 'TEXT', default: 'A' } }, bind = { text: '0' };
  const { ov, diff } = instanceOf(tpl, occ, { bind, props, vals: { text: 'B' } });
  assert.deepEqual(diff, []);
  assert.deepEqual(ov, { 0: { 'font.c': 'rgb(200, 0, 0)' } });
  // the same check with the colour override missing
  const lost = instanceDiff(expandInstance(tpl, { bind, props, vals: { text: 'B' }, ov: {} }), occ);
  assert.deepEqual(lost, [{ path: '0', key: 'font.c', a: 'rgb(0, 0, 0)', b: 'rgb(200, 0, 0)' }]);
  assert.match(diffReason(lost), /^0 font\.c: "rgb\(0, 0, 0\)" in the component, "rgb\(200, 0, 0\)" here$/);
  // and through findComponents the colour is an override
  const c = findComponents(s).components[0];
  assert.deepEqual(allNodes(c)[1].ov, { 0: { 'font.c': 'rgb(200, 0, 0)' } });
});

test('expandInstance: properties at their default when no value is given, BOOLEAN false hides, null override deletes', () => {
  const tpl = { id: 'n.4', t: 'F', w: 10, h: 10, paint: { bg: 'red', radius: ['2px'] }, kids: [
    { id: 'n.4.0', t: 'T', w: 10, h: 10, runs: [{ t: 'tpl text' }] }, { id: 'n.4.1', t: 'V', w: 10, h: 10, icon: { ref: 'a', color: 'blue' } }] };
  const props = { text: { type: 'TEXT', default: 'Def' }, icon: { type: 'INSTANCE_SWAP', default: 'a' }, 'show-icon': { type: 'BOOLEAN', default: true } };
  const bind = { text: '0', icon: '1', 'show-icon': '1' };
  let e = expandInstance(tpl, { bind, props });
  assert.deepEqual(e.kids[0].runs, [{ t: 'Def' }]);
  e = expandInstance(tpl, { bind, props, vals: { text: 'a\nb', icon: 'b' }, ov: { '': { 'paint.radius': null } } });
  assert.deepEqual(e.kids[0].runs, [{ t: 'a' }, { br: true }, { t: 'b' }]);
  assert.equal(e.kids[1].icon.ref, 'b');
  assert.deepEqual(e.paint, { bg: 'red' });
  e = expandInstance(tpl, { bind, props, vals: { 'show-icon': false } });
  assert.equal(e.kids.length, 1);
  assert.deepEqual(tpl.kids.length, 2, 'the template is not changed');
});

test('an occurrence holding a detached occurrence is detached too; a template holding one takes its variant', () => {
  const tag = (x) => F('tag', { bg: 'rgb(0, 0, 0)' }, T(x));
  const card = (x) => F('card', { bg: BG }, T(x, 'h'), tag('t'));
  const D = decl({ tag: { kind: 'chip' } });
  // a lone tag on s0 is the tag template
  const s = [scr('s0', tag('t')), scr('s1', card('A'), card('B')), scr('s2', card('C'))];
  nodeAt(s[0].spec, 'n.0.0').abs = { x: 0, y: 0, c: 'L' };
  for (const [sc, id, x] of [[1, 'n.0.1.0', 0], [1, 'n.1.1.0', 0], [2, 'n.0.1.0', 9]]) nodeAt(s[sc].spec, id).abs = { x, y: 0, c: 'L' };
  let r = findComponents(s, { decl: D });
  const by = (n) => r.components.find((c) => c.name === n);
  assert.deepEqual(by('tag').detached.map((d) => `${d.screen} ${d.node}`), ['s2 n.0.1']);
  assert.deepEqual(by('card').detached.map((d) => `${d.screen} ${d.node} ${d.reason}`), ['s2 n.0 holds detached s2 n.0.1']);
  assert.equal(by('card').count, 2);
  // the moved tag inside the card template (s1 n.0): that card variant goes; no card is left -> skipped 'detached'
  for (const [sc, id, x] of [[1, 'n.0.1.0', 9], [2, 'n.0.1.0', 0]]) nodeAt(s[sc].spec, id).abs = { x, y: 0, c: 'L' };
  r = findComponents(s, { decl: D });
  assert.equal(r.components.find((c) => c.name === 'card'), undefined);
  assert.deepEqual(r.skipped.filter((x) => x.reason === 'detached').map((x) => [x.key, x.count]), [['c:div.card', 3]]);
});

test('a measured override (opts.overridable) keeps a use that the safe default detaches', () => {
  const s = [scr('s1', row('A', F('dot', { bg: 'rgb(0, 0, 0)' })), row('B', F('dot', { bg: 'rgb(0, 0, 0)' })))];
  for (const [id, x] of [['n.0.1', 4], ['n.1.1', 30]]) nodeAt(s[0].spec, id).abs = { x, y: 0, c: 'L' };
  assert.equal(findComponents(s).components[0].detached.length, 1);
  const c = findComponents(s, { overridable: new Set(['abs.x']) }).components[0];
  assert.equal(c.detached, undefined);
  assert.deepEqual(allNodes(c)[1].ov, { 1: { 'abs.x': 30 } });
});
