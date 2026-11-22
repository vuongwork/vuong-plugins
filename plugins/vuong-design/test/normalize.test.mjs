import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { normalize } from '../core/normalize.mjs';
import { readRules, rulesTemplate } from '../core/rules-file.mjs';
import { inventory } from '../core/inventory.mjs';

const fx = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// Hand-built inventory uses (the shape inventory.mjs produces).
let seq = 0;
const use = (cat, prop, value, role, o = {}) => ({
  screen: o.screen ?? 's1', node: o.node ?? `0.${seq++}`, cat, prop, value, raw: typeof value === 'number' ? `${value}px` : String(value),
  role: `${cat}|${prop}|${role}`, ...o,
});
const pad = (v, o = {}) => use('space', 'paddingT', v, 'div.x|div.p', o);
const type = (size, lineHeight, role, o = {}) => use('type', 'text', { family: 'Inter', size, weight: 400, style: 'normal', lineHeight, letterSpacing: 0, transform: 'none' }, role, { run: 0, ...o });
const inv = (uses) => ({ uses, vars: {} });
const N = (uses, answers = {}) => normalize(inv(uses), { version: 1, answers });
const only = (r, code) => r.entries.filter((e) => e.code === code);

test('ROLE_MAJORITY: padding 13 among five same-role frames at 12 becomes 12, auto', () => {
  const r = N([pad(12), pad(12), pad(12), pad(12), pad(12), pad(13, { node: '0.9' })]);
  assert.equal(r.entries.length, 1);
  const [e] = r.entries;
  assert.deepEqual([e.code, e.status, e.from, e.to, e.cat, e.prop, e.nodes], ['ROLE_MAJORITY', 'auto', 13, 12, 'space', 'paddingT', [{ screen: 's1', node: '0.9' }]]);
  assert.equal(e.proposal, undefined);
  assert.equal(r.counts.IN_SCALE, 5);
  assert.equal(r.questions.length, 0);
});

test('GRID4: padding 13 with no majority asks, proposal 12, the spec keeps 13', () => {
  const r = N([pad(13), pad(13, { node: '1.0' }), pad(14, { node: '1.1' }), pad(10, { node: '1.2' }), pad(11, { node: '1.3' })]);
  const e = only(r, 'GRID4').find((x) => x.from === 13);
  assert.deepEqual([e.status, e.to, e.proposal, e.question], ['ask', 13, 12, 'grid4|space|13|12']);
  assert.equal(e.nodes.length, 2);
  const q = r.questions.find((x) => x.key === e.question);
  assert.deepEqual([q.code, q.options, q.default, q.affects, q.answered, q.roles], ['GRID4', [12, 16, 13], 12, 2, undefined, ['space|paddingT|div.x|div.p']]);
  assert.match(q.text, /^[^\n]+\?$/);
  // 14: tie between 12 and 16 -> the larger
  assert.equal(only(r, 'GRID4').find((x) => x.from === 14).proposal, 16);
  // 10 -> tie 8/12 -> 12; 11 -> 12
  assert.equal(only(r, 'GRID4').find((x) => x.from === 10).proposal, 12);
  assert.equal(only(r, 'GRID4').find((x) => x.from === 11).proposal, 12);
});

test('GRID4 answered from the rules file: "12" applies; keeping 13 is kept; another option applies; invalid throws', () => {
  const uses = () => [pad(13, { node: '0.1' })];
  const rules = readRules(fx('rules-answered.json'));
  let r = normalize(inv(uses()), rules);
  let [e] = only(r, 'GRID4');
  assert.deepEqual([e.status, e.from, e.to, e.proposal, e.question], ['answered', 13, 12, 12, 'grid4|space|13|12']);
  // answered through the per-role key: the group question is resolved, not open
  assert.deepEqual(r.questions.map((q) => [q.key, q.answered, q.resolved]), [['grid4|space|13|12', undefined, true], ['project.grid4', undefined, undefined]]);
  assert.deepEqual(r.stale, ['icon|18', 'project.lineHeightInt']);
  r = N(uses(), { 'grid4|space|paddingT|div.x|div.p|13': 16 });
  [e] = only(r, 'GRID4');
  assert.deepEqual([e.status, e.to, e.proposal], ['answered', 16, 12]);
  r = N(uses(), { 'grid4|space|paddingT|div.x|div.p|13': 13 });
  assert.equal(r.entries.length, 0);
  assert.equal(r.counts.GRID4, 1);
  assert.equal(r.questions[0].resolved, true);
  assert.throws(() => N(uses(), { 'grid4|space|paddingT|div.x|div.p|13': 15 }), /grid4\|space\|paddingT\|div\.x\|div\.p\|13/);
});

test('border widths, font sizes and hairline radii never become GRID4; radius 6 does', () => {
  const r = N([
    use('border', 'borderT', 1, 'div.c|div.p'), use('border', 'borderT', 3, 'div.d|div.p'),
    use('radius', 'radiusTL', 2, 'div.c|div.p'), use('radius', 'radiusTL', 1.5, 'div.e|div.p'), use('radius', 'radiusTL', 6, 'div.f|div.p'),
    type(15, 20, 'p.t|div.c'), type(13, 20, 'p.u|div.c'),
  ]);
  const g = only(r, 'GRID4');
  assert.deepEqual(g.map((e) => [e.cat, e.from, e.proposal]), [['radius', 6, 8]]);
  assert.ok(!r.entries.some((e) => e.cat === 'border' || e.cat === 'type'));
});

test('flexible and tokened values are kept and only counted', () => {
  const r = N([
    use('space', 'gap', undefined, 'div.r|div.p', { flex: 'sb' }), pad(13, { token: '--pad' }),
    use('icon', 'width', 18, 'svg.i|div.r', { fixed: false }), pad(13, { tokenMismatch: '--pad', node: '2.0' }),
  ]);
  assert.deepEqual(r.counts, { FLEX: 2, TOKEN: 1 });
  assert.deepEqual(r.entries.map((e) => [e.code, e.from]), [['GRID4', 13]]); // a token mismatch is no token
  assert.ok(!r.entries.some((e) => e.from === undefined));
});

const blue = (hex, role, o = {}) => use('color', 'bg', hex, role, o);

test('COLOR_DE1: #1a74e8 merges into the more frequent #1a73e8 of the same role, auto', () => {
  const r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e8', 'a.btn|div.p', { node: '9' })]);
  const [e] = r.entries;
  assert.deepEqual([e.code, e.status, e.from, e.to, e.nodes], ['COLOR_DE1', 'auto', '#1a74e8', '#1a73e8', [{ screen: 's1', node: '9' }]]);
  assert.equal(r.counts.IN_SCALE, 2);
});

test('COLOR_NEAR: the same pair in different roles asks; a named colour is never merged automatically', () => {
  let r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e8', 'span.tag|div.p')]);
  let [e] = r.entries;
  assert.deepEqual([e.code, e.status, e.to, e.proposal, e.question], ['COLOR_NEAR', 'ask', '#1a74e8', '#1a73e8', 'color|#1a74e8|#1a73e8']);
  assert.deepEqual(r.questions[0].options, ['#1a73e8', '#1a74e8']);
  // same role but the more frequent colour is named
  r = N([blue('#1a73e8', 'a.btn|div.p', { token: '--accent' }), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e8', 'a.btn|div.p')]);
  assert.deepEqual(r.entries.map((x) => [x.code, x.status]), [['COLOR_NEAR', 'ask']]);
  // same role but the rarer colour is named: its tokened use stays, its untokened use is asked about
  r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e8', 'a.btn|div.p', { token: '--x' }), blue('#1a74e8', 'a.btn|div.p')]);
  assert.deepEqual(r.entries.map((x) => [x.code, x.status, x.nodes.length]), [['COLOR_NEAR', 'ask', 1]]);
  assert.equal(r.counts.TOKEN, 1);
  assert.ok(!r.entries.some((x) => x.status === 'auto'));
  // answered: merge
  r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e8', 'span.tag|div.p')], { 'color|#1a74e8|#1a73e8': '#1a73e8' });
  assert.deepEqual(r.entries.map((x) => [x.status, x.to]), [['answered', '#1a73e8']]);
});

test('colours: a mixed-role colour merges only its shared-role uses; different alpha never merges; ΔE ≥ 3 stays', () => {
  let r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e8', 'a.btn|div.p'), blue('#1a74e8', 'span.tag|div.p')]);
  assert.deepEqual(r.entries.map((x) => [x.code, x.role]), [['COLOR_DE1', 'color|bg|a.btn|div.p'], ['COLOR_NEAR', 'color|bg|span.tag|div.p']]);
  r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#1a74e880', 'a.btn|div.p')]);
  assert.equal(r.entries.length, 0);
  assert.equal(r.questions.length, 0);
  r = N([blue('#1a73e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p'), blue('#dc2626', 'a.btn|div.p')]);
  assert.equal(r.entries.length, 0);
  // equal counts: the lower hex is the more frequent one
  r = N([blue('#1a74e8', 'a.btn|div.p'), blue('#1a73e8', 'a.btn|div.p')]);
  assert.deepEqual(r.entries.map((x) => [x.from, x.to]), [['#1a74e8', '#1a73e8']]);
});

test('LINE_HEIGHT_INT: 20.8 px asks one project question, proposal 21; "yes" applies to every entry', () => {
  const uses = () => [type(16, 20.8, 'p.a|div.c', { node: '1' }), type(16, 20.8, 'p.a|div.c', { node: '1', run: 2, value: { family: 'Inter', size: 16, weight: 700, style: 'normal', lineHeight: 20.8, letterSpacing: 0, transform: 'none' } }),
    type(16, 18.2, 'p.b|div.c', { node: '2' }), type(16, 18.005, 'p.c|div.c', { node: '3' })];
  let r = N(uses());
  const lh = only(r, 'LINE_HEIGHT_INT');
  assert.deepEqual(lh.map((e) => [e.from, e.proposal, e.status, e.to, e.nodes.length, e.prop]), [[20.8, 21, 'ask', 20.8, 1, 'lineHeight'], [18.2, 18, 'ask', 18.2, 1, 'lineHeight']]);
  assert.deepEqual(r.questions.map((q) => [q.key, q.options, q.default, q.affects]), [['project.lineHeightInt', ['yes', 'no'], 'yes', 2]]);
  r = N(uses(), { 'project.lineHeightInt': 'yes' });
  assert.ok(only(r, 'LINE_HEIGHT_INT').every((e) => e.status === 'answered' && e.to === e.proposal));
  r = N(uses(), { 'project.lineHeightInt': 'no' });
  assert.equal(only(r, 'LINE_HEIGHT_INT').length, 0);
  assert.equal(r.counts.LINE_HEIGHT_INT, 2);
});

test('TYPE_SCALE: odd sizes move to the nearest scale size of their role, else within 2 px; one project question', () => {
  const r = N([
    type(14, 20, 'p.a|div.c'), type(14, 20, 'p.b|div.c'), type(16, 24, 'h2.t|div.c'), type(16, 24, 'h3.t|div.c'),
    type(15, 20, 'p.a|div.c'), type(13, 20, 'span.e|div.c'), type(28, 32, 'h1.big|div.c'),
  ]);
  const ts = only(r, 'TYPE_SCALE');
  assert.deepEqual(ts.map((e) => [e.role, e.from, e.proposal, e.status, e.prop]).sort(),
    [['type|text|p.a|div.c', 15, 14, 'ask', 'fontSize'], ['type|text|span.e|div.c', 13, 14, 'ask', 'fontSize']]);
  assert.ok(ts.every((e) => e.nodes.every((n) => n.run === 0)));
  assert.deepEqual(r.questions.map((q) => q.key), ['project.typeScale']);
  assert.match(r.questions[0].text, /14, 16 px/);
  assert.ok(!r.entries.some((e) => e.from === 28)); // 28 px: no scale size within 2 px, stays
  const a = N([type(14, 20, 'p.a|div.c'), type(14, 20, 'p.b|div.c'), type(15, 20, 'p.c|div.c')], { 'project.typeScale': 'yes' });
  assert.deepEqual(only(a, 'TYPE_SCALE').map((e) => [e.status, e.to]), [['answered', 14]]);
});

test('ICON_FRAME: icon 18 px proposes 20 (tie -> larger), 22 proposes 24, one question per size', () => {
  const ic = (v, o = {}) => [use('icon', 'width', v, 'svg.i|button.b', { fixed: true, ...o }), use('icon', 'height', v, 'svg.i|button.b', { fixed: true, ...o })];
  const r = N([...ic(18, { node: '1' }), ...ic(18, { node: '2', screen: 's2' }), ...ic(22, { node: '3' }), ...ic(20, { node: '4' })]);
  const f = only(r, 'ICON_FRAME');
  assert.deepEqual([...new Set(f.map((e) => `${e.from}->${e.proposal}`))], ['18->20', '22->24']);
  const q = r.questions.find((x) => x.key === 'icon|18');
  assert.deepEqual([q.options, q.default, q.affects], [[16, 20, 24, 18], 20, 2]);
  assert.equal(r.counts.IN_SCALE, 2);
  // answered in the rules fixture: 16
  const a = normalize(inv(ic(18, { node: '1' })), readRules(fx('rules-answered.json')));
  assert.ok(only(a, 'ICON_FRAME').every((e) => e.status === 'answered' && e.to === 16));
});

test('SRC_SQUASH (R65): avatar 40/32 at A/B with a FIXED size asks to keep the larger size at both widths', () => {
  const av = (prop, o = {}) => use('size', prop, 40, 'img.av|div.say', { img: true, sizes: [40, 40, 32, 32], ...o });
  const r = N([av('width', { node: '5' }), av('height', { node: '5' }), av('width', { node: '6', screen: 's4' }), av('height', { node: '6', screen: 's4' }),
    use('size', 'width', 50, 'img.ph|div.p', { img: true, sizes: [50, 30, 50.5, 30] })]);
  const s = only(r, 'SRC_SQUASH');
  assert.deepEqual(s.map((e) => [e.prop, e.from, e.proposal, e.status, e.nodes.length, e.question]),
    [['height', 40, 40, 'ask', 2, 'squash|size|40|40'], ['width', 40, 40, 'ask', 2, 'squash|size|40|40']]);
  assert.deepEqual(r.questions.map((q) => [q.key, q.options, q.default, q.affects]),
    [['project.srcSquash', ['accept-all', 'ask-each'], 'ask-each', 2], ['squash|size|40|40', ['declared', 'keep'], 'declared', 2]]);
  assert.equal(r.counts.IN_SCALE, 1); // a stable 50 px image keeps its size, never GRID4
  // squashed at A (32 at A, 40 at B, spec 32): proposal 40; answered -> applied
  const b = N([use('size', 'width', 32, 'img.av|div.say', { img: true, sizes: [32, 32, 40, 40] })], { 'squash|img.av|div.say': 'declared' });
  assert.deepEqual(b.entries.map((e) => [e.status, e.from, e.to]), [['answered', 32, 40]]);
  // an icon on a 24 px frame squashed to 20 at A
  const c = N([use('icon', 'width', 24, 'svg.i|div.r', { fixed: true, sizes: [20, 20, 24, 24] })]);
  assert.deepEqual(c.entries.map((e) => [e.code, e.proposal]), [['SRC_SQUASH', 24]]);
});

test('unparsed values are counted, never normalised', () => {
  const r = N([use('color', 'bg', null, 'div.a|div.p', { unparsed: true }), use('radius', 'radiusTL', null, 'div.a|div.p', { unparsed: true })]);
  assert.equal(r.unparsed, 2);
  assert.equal(r.entries.length, 0);
});

test('deterministic: two runs and shuffled uses give identical JSON; ids are stable 8-hex', () => {
  const mk = () => [pad(12), pad(12), pad(12), pad(13, { node: 'x' }), pad(14, { node: 'y', screen: 's2' }),
    blue('#1a73e8', 'a.btn|div.p', { node: 'b1' }), blue('#1a73e8', 'a.btn|div.p', { node: 'b2' }), blue('#1a74e8', 'a.btn|div.p', { node: 'b3' }), blue('#1a74e8', 'span.t|div.p', { node: 'b4' }),
    type(16, 20.8, 'p.a|div.c', { node: 't1' }), type(15, 20, 'p.a|div.c', { node: 't2' }), type(16, 24, 'p.b|div.c', { node: 't3' }),
    use('icon', 'width', 18, 'svg.i|div.r', { fixed: true, node: 'i1' }), use('size', 'width', 40, 'img.av|div.say', { img: true, sizes: [40, 40, 32, 32], node: 'a1' })];
  const base = mk();
  const a = JSON.stringify(normalize(inv(base), { version: 1, answers: {} }));
  const b = JSON.stringify(normalize(inv(base), { version: 1, answers: {} }));
  assert.equal(a, b);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 5; k++) {
    const sh = [...base].map((u) => ({ ...u })).sort(() => rnd() - 0.5);
    assert.equal(JSON.stringify(normalize(inv(sh), { version: 1, answers: {} })), a);
  }
  const r = JSON.parse(a);
  assert.ok(r.entries.every((e) => /^[0-9a-f]{8}$/.test(e.id)));
  assert.equal(new Set(r.entries.map((e) => e.id)).size, r.entries.length);
});

test('works on a real inventory: tokened and in-scale values are kept', () => {
  const ir = {
    id: 'a', vars: { '--p': { value: '12px', uses: 1 } },
    tree: { id: '0', kind: 'frame', tag: 'div', cls: 'scr', paint: {}, kids: [
      { id: '0.0', kind: 'frame', tag: 'div', cls: 'card', paint: { radius: ['6px', '6px', '6px', '6px'] }, tok: { paddingT: '--p' } },
    ] },
  };
  const spec = { id: '0', t: 'F', w: 390, h: 800, sz: ['FIXED', 'FIXED'], lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' }, kids: [
    { id: '0.0', t: 'F', w: 358, h: 80, sz: ['FILL', 'FIXED'], paint: ir.tree.kids[0].paint, lay: { d: 'V', p: [12, 12, 12, 12], g: 0, pa: 'S', ca: 'S' } },
  ] };
  const r = normalize(inventory([{ screen: ir, spec }]));
  assert.deepEqual(r.counts, { IN_SCALE: 4, TOKEN: 1 }); // paddingR/B/L 12 + height 80; paddingT has the token
  assert.deepEqual([...new Set(only(r, 'GRID4').map((e) => e.cat))], ['radius']);
  assert.equal(only(r, 'GRID4').length, 4);
  // R68: the four corner roles share one question (radius 6 -> 8) plus the project-wide one
  assert.deepEqual(r.questions.map((q) => [q.key, q.affects, q.roles && q.roles.length]), [['grid4|radius|6|8', 1, 4], ['project.grid4', 1, undefined]]);
});

test('readRules: missing file is empty; bad version, missing version, unknown key throw naming it', () => {
  assert.deepEqual(readRules(fx('no-such-rules.json')), { version: 1, answers: {} });
  assert.deepEqual(readRules(undefined), { version: 1, answers: {} });
  assert.throws(() => readRules(fx('rules-bad-version.json')), /"version" is 2/);
  assert.throws(() => readRules(fx('rules-no-version.json')), /missing "version"/);
  assert.throws(() => readRules(fx('rules-unknown-key.json')), /unknown top-level key "answer"/);
  const r = readRules(fx('rules-answered.json'));
  assert.equal(r.answers['icon|18'], 16);
  assert.equal(r.notes['icon|18'], 'small icons stay at 16 px');
});

test('rulesTemplate drafts the open questions with their defaults and texts', () => {
  const r = N([pad(13, { node: 'a' }), pad(14, { node: 'b', screen: 's2' }), type(16, 20.8, 'p.a|div.c')], { 'grid4|space|paddingT|div.x|div.p|14': 12 });
  const t = rulesTemplate(r.questions);
  assert.deepEqual(Object.keys(t), ['version', 'answers', 'notes']);
  assert.deepEqual(t.answers, { 'grid4|space|13|12': 12, 'project.grid4': 'ask-each', 'project.lineHeightInt': 'yes' });
  assert.deepEqual(Object.keys(t.notes), Object.keys(t.answers));
  assert.equal(t.version, 1);
});

test('R67: noise uses (< 0.5 px) are skipped and counted, never asked about, never in a role majority', () => {
  const r = N([pad(0.01, { noise: true }), pad(0.02, { noise: true, node: 'n2' }), use('radius', 'radiusTL', 0.3, 'div.x|div.p', { noise: true }),
    pad(13, { node: 'a' }), pad(14, { node: 'b' })]);
  assert.equal(r.counts.NOISE, 3);
  assert.ok(!r.entries.some((e) => e.from < 0.5));
  assert.ok(!r.questions.some((q) => /\|0\.0[12]\||\|0\.3\|/.test(q.key)));
  // noise does not make a majority: 13 among three noise uses and one 12 has none
  const m = N([pad(0.01, { noise: true }), pad(0.01, { noise: true, node: 'n2' }), pad(0.01, { noise: true, node: 'n3' }), pad(12, { node: 'a' }), pad(13, { node: 'b' })]);
  assert.deepEqual(only(m, 'GRID4').map((e) => e.from), [13]);
});

test('R68: one question per (code, cat, family, from, proposal) across roles; answer order per-role > group > project', () => {
  const sp = (prop, v, role, node, o = {}) => use('space', prop, v, role, { node, ...o });
  const mk = () => [
    sp('paddingT', 13, 'div.a|div.p', 'a1'), sp('paddingL', 13, 'div.b|div.p', 'b1'), sp('gap', 13, 'div.c|div.p', 'c1', { screen: 's2' }),
    sp('counterGap', 13, 'div.d|div.p', 'd1'), sp('paddingT', 10, 'div.a|div.p', 'a2'),
    use('radius', 'radiusTL', 13, 'div.a|div.p', { node: 'a1' }), use('radius', 'radiusBR', 13, 'div.a|div.p', { node: 'a1' }),
    use('size', 'width', 13, 'div.e|div.p', { node: 'e1' }), use('size', 'height', 13, 'div.e|div.p', { node: 'e1' }),
    blue('#1a73e8', 'a.btn|div.p', { node: 'k1' }), blue('#1a73e8', 'a.btn|div.p', { node: 'k2' }),
    blue('#1a74e8', 'span.t|div.p', { node: 'k3' }), use('color', 'color', '#1a74e8', 'span.u|div.p', { node: 'k4', run: 0 }),
  ];
  let r = N(mk());
  assert.deepEqual(r.questions.map((q) => [q.key, q.affects, q.roles]), [
    ['color|#1a74e8|#1a73e8', 2, ['color|bg|span.t|div.p', 'color|color|span.u|div.p']],
    ['grid4|radius|13|12', 1, ['radius|radiusBR|div.a|div.p', 'radius|radiusTL|div.a|div.p']],
    ['grid4|size|13|12', 1, ['size|height|div.e|div.p', 'size|width|div.e|div.p']],
    ['grid4|space|10|12', 1, ['space|paddingT|div.a|div.p']],
    ['grid4|space|13|12', 4, ['space|counterGap|div.d|div.p', 'space|gap|div.c|div.p', 'space|paddingL|div.b|div.p', 'space|paddingT|div.a|div.p']],
    ['project.colorNear', 2, undefined],
    ['project.grid4', 6, undefined],
  ]);
  assert.deepEqual(r.questions.find((q) => q.key === 'project.grid4').options, ['accept-all', 'ask-each']);
  assert.ok(r.entries.every((e) => e.status === 'ask'));
  // a group answer applies to every role of the group; a per-role answer wins over it
  r = N(mk(), { 'grid4|space|13|12': 16, 'grid4|space|gap|div.c|div.p|13': 12 });
  const sp13 = only(r, 'GRID4').filter((e) => e.cat === 'space' && e.from === 13);
  assert.deepEqual(sp13.map((e) => [e.prop, e.status, e.to, e.question]), [
    ['counterGap', 'answered', 16, 'grid4|space|13|12'], ['gap', 'answered', 12, 'grid4|space|13|12'],
    ['paddingL', 'answered', 16, 'grid4|space|13|12'], ['paddingT', 'answered', 16, 'grid4|space|13|12']]);
  assert.equal(r.questions.find((q) => q.key === 'grid4|space|13|12').answered, 16);
  assert.deepEqual(r.stale, []);
  // project accept-all applies each proposal where nothing more specific answered; a group 'keep' wins over it
  r = N(mk(), { 'project.grid4': 'accept-all', 'grid4|size|13|12': 13, 'project.colorNear': 'accept-all' });
  assert.deepEqual(only(r, 'GRID4').map((e) => [e.cat, e.prop, e.from, e.status, e.to]), [
    ['radius', 'radiusBR', 13, 'answered', 12], ['radius', 'radiusTL', 13, 'answered', 12],
    ['space', 'counterGap', 13, 'answered', 12], ['space', 'gap', 13, 'answered', 12], ['space', 'paddingL', 13, 'answered', 12],
    ['space', 'paddingT', 10, 'answered', 12], ['space', 'paddingT', 13, 'answered', 12]]);
  assert.deepEqual(only(r, 'COLOR_NEAR').map((e) => [e.status, e.to]), [['answered', '#1a73e8'], ['answered', '#1a73e8']]);
  assert.equal(r.counts.GRID4, 2); // the two size uses kept by the group answer
  assert.ok(r.questions.filter((q) => q.key.startsWith('grid4|') && q.key !== 'grid4|size|13|12').every((q) => q.resolved === true && q.answered === undefined));
  assert.deepEqual(rulesTemplate(r.questions).answers, {});
  // ask-each changes nothing; an invalid project answer throws naming the key
  assert.equal(JSON.stringify(N(mk(), { 'project.grid4': 'ask-each' }).entries), JSON.stringify(N(mk()).entries));
  assert.throws(() => N(mk(), { 'project.grid4': 'yes' }), /project\.grid4/);
  // the template lists group and project keys only, never per-role keys
  assert.deepEqual(Object.keys(rulesTemplate(N(mk()).questions).answers), ['color|#1a74e8|#1a73e8', 'grid4|radius|13|12', 'grid4|size|13|12',
    'grid4|space|10|12', 'grid4|space|13|12', 'project.colorNear', 'project.grid4']);
});

test('R68: icon frames group by size across roles; project.iconFrame accept-all applies the proposals', () => {
  const ic = (v, role, node) => [use('icon', 'width', v, role, { fixed: true, node }), use('icon', 'height', v, role, { fixed: true, node })];
  const uses = () => [...ic(18, 'svg.a|div.r', '1'), ...ic(18, 'svg.b|div.s', '2'), ...ic(22, 'svg.a|div.r', '3')];
  let r = N(uses());
  assert.deepEqual(r.questions.map((q) => [q.key, q.affects, q.roles && q.roles.length]), [['icon|18', 2, 4], ['icon|22', 1, 2], ['project.iconFrame', 3, undefined]]);
  r = N(uses(), { 'project.iconFrame': 'accept-all', 'icon|22': 22 });
  assert.deepEqual([...new Set(only(r, 'ICON_FRAME').map((e) => `${e.from}->${e.to}:${e.status}`))], ['18->20:answered']);
  assert.equal(r.counts.ICON_FRAME, 2);
});

test('R69: a value within 0.05 px of an integer counts as that integer for scale, majority and grouping; from stays exact', () => {
  const r = N([pad(11.01, { node: 'a' }), pad(11, { node: 'b' }), use('space', 'gap', 10.98, 'div.y|div.p', { node: 'c' }), pad(12.02, { node: 'd' }),
    pad(131.14, { node: 'e' }), pad(13.03, { node: 'f', role: 'space|paddingT|div.z|div.p' })]);
  assert.equal(r.counts.IN_SCALE, 1); // 12.02
  const q11 = r.questions.find((q) => q.key === 'grid4|space|11|12');
  assert.deepEqual([q11.affects, q11.options], [3, [8, 12, 11]]);
  assert.ok(r.questions.some((q) => q.key === 'grid4|space|131.14|132'));
  assert.ok(r.questions.some((q) => q.key === 'grid4|space|13|12'));
  assert.deepEqual(only(r, 'GRID4').filter((e) => e.question === 'grid4|space|11|12').map((e) => e.from).sort(), [10.98, 11, 11.01]);
  // answered: the exact from is kept, to is the grid value; answering the integer itself keeps
  let a = N([pad(11.01, { node: 'a' })], { 'grid4|space|11|12': 12 });
  assert.deepEqual(a.entries.map((e) => [e.from, e.to, e.status]), [[11.01, 12, 'answered']]);
  a = N([pad(11.01, { node: 'a' })], { 'grid4|space|11|12': 11 });
  assert.deepEqual([a.entries.length, a.counts.GRID4], [0, 1]);
  // majority: 12, 12.01, 11.99 and 13 in one role -> 13 moves to 12; the near-integers are in scale
  const m = N([pad(12, { node: 'a' }), pad(12.01, { node: 'b' }), pad(11.99, { node: 'c' }), pad(13, { node: 'd' })]);
  assert.deepEqual(m.entries.map((e) => [e.code, e.from, e.to]), [['ROLE_MAJORITY', 13, 12]]);
  assert.equal(m.counts.IN_SCALE, 3);
});

test('R70: a pill radius (inventory pill) is in scale, counted PILL, never GRID4', () => {
  const r = N([use('radius', 'radiusTL', 99, 'span.chip|div.p', { pill: true, box: [60, 24] }), use('radius', 'radiusTL', 14, 'div.c|div.p', { pill: true, box: [28, 28] }),
    use('radius', 'radiusTL', 14, 'div.d|div.p', { box: [100, 40] })]);
  assert.equal(r.counts.PILL, 2);
  assert.deepEqual(r.entries.map((e) => [e.code, e.from, e.role]), [['GRID4', 14, 'radius|radiusTL|div.d|div.p']]);
});

test('R71: svgs larger than 32 px are illustrations: no ICON_FRAME, no majority, counted ILLUSTRATION; SRC_SQUASH still applies', () => {
  const ic = (prop, v, o = {}) => use('icon', prop, v, 'svg.art|div.p', { fixed: true, ...o });
  const r = N([ic('width', 200, { box: [200, 180], node: 'a' }), ic('height', 180, { box: [200, 180], node: 'a' }),
    ic('width', 33, { box: [33, 20], node: 'b' }), ic('height', 20, { box: [33, 20], node: 'b' }),
    ic('width', 21, { box: [21, 21], node: 'c', role: 'icon|width|svg.i|div.p' }),
    ic('width', 90, { box: [90, 90], node: 'd', sizes: [80, 80, 90, 90] })]);
  assert.equal(r.counts.ILLUSTRATION, 4); // 200 x 180 and 33 x 20: the node is an illustration, both axes
  assert.equal(r.counts.IN_SCALE, undefined);
  assert.deepEqual(r.entries.map((e) => [e.code, e.from, e.proposal]).sort(), [['ICON_FRAME', 21, 20], ['SRC_SQUASH', 90, 90]]);
  assert.ok(!r.questions.some((q) => q.key === 'icon|200' || q.key === 'icon|33'));
});
