import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTokens, parseShadow, roleBase } from '../core/tokens.mjs';
import { readNames, checkPath } from '../core/names-file.mjs';

// Hand-built inventory uses (the shape inventory.mjs produces).
let seq = 0;
const use = (cat, prop, value, role, o = {}) => ({
  screen: o.screen ?? 's1', node: o.node ?? `0.${seq++}`, cat, prop, value, raw: typeof value === 'number' ? `${value}px` : String(value),
  role: `${cat}|${prop}|${role}`, ...o,
});
const type = (size, weight, lineHeight, role, o = {}) => use('type', 'text',
  { family: 'Inter', size, weight, style: 'normal', lineHeight, letterSpacing: 0, transform: 'none' }, role, { run: 0, raw: '"Foo", sans-serif', ...o });

function fixture() {
  seq = 0;
  return {
    uses: [
      // card border: four sides named --line
      ...['T', 'R', 'B', 'L'].map((s) => use('color', 'border' + s, '#dce6e0', 'div.card|div.in', { node: '0.0', token: '--line' })),
      use('color', 'bg', '#dce6e0', 'div.rule|div.in', { node: '0.1', token: '--line' }),
      // chip backgrounds: unnamed role, 3 uses, majority #2563eb
      use('color', 'bg', '#2563eb', 'span.chip|div.row', { node: '0.2.0' }),
      use('color', 'bg', '#2563eb', 'span.chip|div.row', { node: '0.2.1' }),
      use('color', 'bg', '#ff0000', 'span.chip|div.row', { node: '0.2.2' }),
      // a single unnamed use: primitive only
      use('color', 'color', '#111827', 'p.title|div.card', { node: '0.0.0', run: 0 }),
      // paddings: one off-grid value normalised to 12 (auto), one asked (kept)
      use('space', 'paddingT', 12, 'div.card|div.in', { node: '0.0' }),
      use('space', 'paddingT', 13, 'div.card|div.in', { node: '0.3' }),
      use('space', 'paddingT', 14, 'div.box|div.in', { node: '0.4' }),
      use('space', 'gap', undefined, 'div.row|div.in', { node: '0.2', flex: 'sb' }),
      use('radius', 'radiusTL', 8, 'div.card|div.in', { node: '0.0' }),
      use('shadow', 'shadow', 'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgb(191, 208, 198) 0px 16px 0px -6px', 'div.card|div.in', { node: '0.0' }),
      use('shadow', 'shadow', '0 0 4em red', 'div.pop|div.in', { node: '0.5' }),
      use('opacity', 'opacity', 0.5, 'div.dim|div.in', { node: '0.6' }),
      type(16, 500, 24, 'p.title|div.card', { node: '0.0.0' }),
      type(14, 400, 20.5, 'p.body|div.card', { node: '0.0.1' }),
    ],
    vars: {},
  };
}
const entries = [
  { id: 'a', cat: 'space', role: 'space|paddingT|div.card|div.in', prop: 'paddingT', nodes: [{ screen: 's1', node: '0.3' }], from: 13, to: 12, code: 'ROLE_MAJORITY', status: 'auto' },
  { id: 'b', cat: 'space', role: 'space|paddingT|div.box|div.in', prop: 'paddingT', nodes: [{ screen: 's1', node: '0.4' }], from: 14, to: 14, code: 'GRID4', status: 'ask', proposal: 16, question: 'q' },
  { id: 'c', cat: 'type', role: 'type|text|p.body|div.card', prop: 'lineHeight', nodes: [{ screen: 's1', node: '0.0.1' }], from: 20.5, to: 21, code: 'LINE_HEIGHT_INT', status: 'answered', proposal: 21, question: 'project.lineHeightInt' },
];

// DTCG self-check: every leaf has $value, groups hold only tokens/groups, aliases resolve, no cycles
const TYPES = new Set(['color', 'dimension', 'fontFamily', 'fontWeight', 'number', 'shadow', 'typography', 'duration', 'cubicBezier', 'strokeStyle', 'border', 'transition', 'gradient']);
function checkDtcg(tokens) {
  const leaves = new Map();
  const walk = (g, path) => {
    assert.ok(g && typeof g === 'object' && !Array.isArray(g), `group ${path} is an object`);
    for (const [k, v] of Object.entries(g)) {
      if (k.startsWith('$')) continue;
      assert.equal(checkPath(k), null, `segment ${k}`);
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object' && '$value' in v) {
        if (v.$type !== undefined) assert.ok(TYPES.has(v.$type), `${p} $type ${v.$type}`);
        for (const kk of Object.keys(v)) assert.ok(kk.startsWith('$'), `${p} token has only $ keys (${kk})`);
        leaves.set(p, v);
      } else walk(v, p);
    }
  };
  walk(tokens, '');
  const aliasesIn = (v) => (typeof v === 'string' ? [...v.matchAll(/^\{([^}]+)\}$/g)].map((m) => m[1])
    : v && typeof v === 'object' ? Object.values(v).flatMap(aliasesIn) : []);
  const resolve = (p, seen = new Set()) => {
    assert.ok(leaves.has(p), `alias target ${p} exists`);
    assert.ok(!seen.has(p), `no alias cycle at ${p}`);
    seen.add(p);
    for (const a of aliasesIn(leaves.get(p).$value)) resolve(a, new Set(seen));
  };
  for (const p of leaves.keys()) resolve(p);
  return leaves;
}

test('tokens are valid DTCG: leaves with $value, aliases resolve, three tiers', () => {
  const { tokens, warnings } = buildTokens(fixture(), entries);
  const leaves = checkDtcg(tokens);
  assert.deepEqual(Object.keys(tokens), ['primitive', 'role', 'component']);
  assert.deepEqual(tokens.component, {});
  for (const [p, t] of leaves) {
    assert.match(t.$description, /^used by \d+ nodes? on \d+ screens?: /, p);
    assert.equal(typeof t.$extensions['vuong-design'].uses, 'number', p);
  }
  assert.deepEqual(warnings.map((w) => w.code), ['SHADOW_UNPARSED']);
});

test('--line becomes role.line aliasing its primitive; four border sides and a bg share it', () => {
  const { tokens, map } = buildTokens(fixture(), entries);
  const c = tokens.primitive.color;
  const lineHex = Object.entries(c).find(([, t]) => t.$value.hex === '#dce6e0')[0];
  assert.equal(lineHex, 'c01'); // 5 uses: most used
  assert.deepEqual(c.c01.$value, { colorSpace: 'srgb', components: [0.8627, 0.902, 0.8784], hex: '#dce6e0' });
  assert.equal(c.c01.$type, 'color');
  const r = tokens.role.line;
  assert.equal(r.$value, '{primitive.color.c01}');
  assert.equal(r.$type, 'color');
  assert.equal(r.$extensions['vuong-design'].var, '--line');
  assert.equal(r.$extensions['vuong-design'].uses, 5);
  assert.deepEqual(r.$extensions['vuong-design'].roles, ['color|bg|div.rule|div.in', 'color|borderB|div.card|div.in', 'color|borderL|div.card|div.in',
    'color|borderR|div.card|div.in', 'color|borderT|div.card|div.in']);
  assert.equal(map['s1|0.0|color|borderT'], 'role.line');
  assert.equal(map['s1|0.1|color|bg'], 'role.line');
});

test('an unnamed role with >= 2 uses gets a generated role token; an off-majority use maps to its primitive', () => {
  const { tokens, map } = buildTokens(fixture(), entries);
  assert.equal(roleBase('color|bg|span.chip|div.row'), 'chip-bg');
  assert.equal(roleBase('color|color|span|div.sb'), 'sb-span-color');
  assert.equal(roleBase('space|paddingL|syn:align|div.in'), 'syn-align-padding');
  const blue = Object.entries(tokens.primitive.color).find(([, t]) => t.$value.hex === '#2563eb')[0];
  assert.equal(tokens.role['chip-bg'].$value, `{primitive.color.${blue}}`);
  assert.equal(map['s1|0.2.0|color|bg'], 'role.chip-bg');
  const red = Object.entries(tokens.primitive.color).find(([, t]) => t.$value.hex === '#ff0000')[0];
  assert.equal(map['s1|0.2.2|color|bg'], `primitive.color.${red}`);
  // single use, no variable: no role token
  assert.equal(map['s1|0.0.0|color|color|0'], Object.keys(tokens.primitive.color).map((k) => `primitive.color.${k}`)
    .find((p) => tokens.primitive.color[p.split('.')[2]].$value.hex === '#111827'));
  assert.equal(Object.keys(tokens.role).some((k) => k.startsWith('title')), false);
});

test('values after normalisation: auto/answered entries apply, ask keeps the source value', () => {
  const { tokens, map } = buildTokens(fixture(), entries);
  assert.deepEqual(Object.keys(tokens.primitive.space), ['12', '14']); // 13 -> 12 (auto), 14 stays (ask)
  assert.deepEqual(tokens.primitive.space['12'].$value, { value: 12, unit: 'px' });
  assert.equal(tokens.primitive.space['12'].$extensions['vuong-design'].uses, 2);
  assert.deepEqual(tokens.primitive.space['12'].$extensions['vuong-design'].merged, [{ from: 13, code: 'ROLE_MAJORITY', uses: 1 }]);
  assert.equal(map['s1|0.3|space|paddingT'], 'role.card-padding');
  assert.equal(map['s1|0.2|space|gap'], undefined); // space-between: no token
  // line height 20.5 answered -> 21
  assert.deepEqual(Object.keys(tokens.primitive.font.lineHeight), ['21', '24']);
  const t = tokens.primitive.typography['t14-400'];
  assert.equal(t.$type, 'typography');
  assert.deepEqual(t.$value, { fontFamily: '{primitive.font.family.inter}', fontSize: '{primitive.font.size.14}', fontWeight: '{primitive.font.weight.400}',
    letterSpacing: '{primitive.font.letterSpacing.0}', lineHeight: 1.5 });
  assert.equal(t.$extensions['vuong-design'].lineHeightPx, 21);
  assert.deepEqual(tokens.primitive.font.family.inter.$extensions['vuong-design'].source, ['"Foo", sans-serif']);
  assert.equal(map['s1|0.0.1|type|text|0'], 'primitive.typography.t14-400');
});

test('box-shadow parses into DTCG shadow objects; an unparseable one stays raw with a warning', () => {
  assert.deepEqual(parseShadow('rgba(0, 0, 0, 0.1) 0px 1px 2px 0px'), {
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1, hex: '#000000' },
    offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 2, unit: 'px' }, spread: { value: 0, unit: 'px' },
  });
  assert.equal(parseShadow('inset 0 2px #fff').inset, true);
  assert.equal(parseShadow('0 0 4em red'), null);
  assert.equal(parseShadow('0px 1px 2px'), null); // no colour
  const { tokens, warnings } = buildTokens(fixture(), entries);
  const sh = Object.values(tokens.primitive.shadow);
  const ok = sh.find((t) => t.$type === 'shadow');
  assert.ok(Array.isArray(ok.$value) && ok.$value.length === 2);
  const bad = sh.find((t) => t.$type === undefined);
  assert.equal(bad.$extensions['vuong-design'].raw, '0 0 4em red');
  assert.equal(warnings[0].path, Object.entries(tokens.primitive.shadow).map(([k, t]) => t === bad && `primitive.shadow.${k}`).find(Boolean));
  assert.deepEqual(tokens.primitive.opacity['50'], { $type: 'number', $value: 0.5, $description: tokens.primitive.opacity['50'].$description,
    $extensions: { 'vuong-design': { uses: 1, nodes: 1, screens: ['s1'] } } });
});

test('css: primitives first, then role variables referencing primitive variables', () => {
  const { css } = buildTokens(fixture(), entries);
  assert.match(css, /^:root \{\n/);
  assert.match(css, /\n {2}--color-c01: #dce6e0;\n/);
  assert.match(css, /\n {2}--space-12: 12px;\n/);
  assert.match(css, /\n {2}--font-family-inter: "Inter";\n/);
  assert.match(css, /\n {2}--typography-t16-500: var\(--font-weight-500\) var\(--font-size-16\)\/var\(--font-line-height-24\) var\(--font-family-inter\);\n/);
  assert.match(css, /\n {2}--role-line: var\(--color-c01\);\n/);
  assert.ok(css.indexOf('--color-c01:') < css.indexOf('--role-line:'));
  assert.ok(css.lastIndexOf('--role-') > css.lastIndexOf('--typography-'));
});

test('deterministic: shuffled uses give the same bytes', () => {
  const a = buildTokens(fixture(), entries);
  const f = fixture();
  f.uses.reverse();
  const b = buildTokens(f, [...entries].reverse());
  assert.equal(JSON.stringify(b.tokens), JSON.stringify(a.tokens));
  assert.equal(b.css, a.css);
  assert.equal(JSON.stringify(b.map), JSON.stringify(a.map));
});

test('vd-names.json renames: aliases and map follow; renaming a CSS-variable token warns RENAME_NAMED', () => {
  const { tokens, map, css, warnings } = buildTokens(fixture(), entries, {
    'primitive.color.c01': 'primitive.color.mint-line', 'role.line': 'role.border.subtle', 'role.chip-bg': 'role.surface.chip', 'primitive.nope': 'primitive.x',
  });
  checkDtcg(tokens);
  assert.equal(tokens.role.border.subtle.$value, '{primitive.color.mint-line}');
  assert.equal(tokens.role.line, undefined);
  assert.equal(map['s1|0.0|color|borderT'], 'role.border.subtle');
  assert.match(css, /--role-border-subtle: var\(--color-mint-line\);/);
  assert.deepEqual(warnings.map((w) => [w.code, w.path]), [['NAME_UNKNOWN', 'primitive.nope'], ['RENAME_NAMED', 'role.line'], ['SHADOW_UNPARSED', warnings[2].path]]);
});

test('names that break DTCG rules, clash or change tier are errors', () => {
  const f = fixture();
  assert.throws(() => buildTokens(f, entries, { 'role.line': 'role.a{b}' }), /names: .*'\{' or '\}'/);
  assert.throws(() => buildTokens(f, entries, { 'role.line': 'role.$x' }), /starts with '\$'/);
  assert.throws(() => buildTokens(f, entries, { 'role.line': 'role..x' }), /empty segment/);
  assert.throws(() => buildTokens(f, entries, { 'role.line': 'primitive.color.zz' }), /another tier/);
  assert.throws(() => buildTokens(f, entries, { 'role.line': 'role.chip-bg' }), /would both be named "role.chip-bg"/);
  assert.throws(() => buildTokens(f, entries, { 'role.line': 'role.chip-bg.x' }), /both a token and the group/);
});

test('readNames: missing file is {}, bad JSON and non-string values are errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-names-'));
  assert.deepEqual(readNames(join(dir, 'none.json')), {});
  assert.deepEqual(readNames(undefined), {});
  writeFileSync(join(dir, 'ok.json'), '{ "role.line": "role.border.subtle" }');
  assert.deepEqual(readNames(join(dir, 'ok.json')), { 'role.line': 'role.border.subtle' });
  writeFileSync(join(dir, 'bad.json'), '{ nope');
  assert.throws(() => readNames(join(dir, 'bad.json')), /not valid JSON/);
  writeFileSync(join(dir, 'num.json'), '{ "role.line": 3 }');
  assert.throws(() => readNames(join(dir, 'num.json')), /"role.line" must be a string/);
  writeFileSync(join(dir, 'arr.json'), '[]');
  assert.throws(() => readNames(join(dir, 'arr.json')), /top level must be an object/);
});
