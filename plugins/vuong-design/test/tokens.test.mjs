import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTokens, tokenMap, parseShadow, roleBase } from '../core/tokens.mjs';
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

test('R67: geometry noise (inventory noise: true) gets no primitive and no map entry', () => {
  const inv = { vars: {}, uses: [use('space', 'paddingR', 0.02, 'div.btn|div.in', { node: 'n1', noise: true }), use('space', 'paddingT', 12, 'div.btn|div.in', { node: 'n1' }),
    use('radius', 'radiusTL', 0.3, 'div.btn|div.in', { node: 'n1', noise: true })] };
  const { tokens, map } = buildTokens(inv, []);
  assert.deepEqual(Object.keys(tokens.primitive.space), ['12']);
  assert.equal(tokens.primitive.radius, undefined);
  assert.equal(map['s1|n1|space|paddingR'], undefined);
});

test('R70: pill radii share one primitive radius.full (9999 px) with a note', () => {
  const inv = { vars: {}, uses: [use('radius', 'radiusTL', 99, 'span.chip|div.p', { node: 'p1', pill: true }), use('radius', 'radiusTL', 14, 'div.c|div.p', { node: 'p2', pill: true }),
    use('radius', 'radiusTL', 8, 'div.d|div.p', { node: 'p3' })] };
  const { tokens, map, css } = buildTokens(inv, []);
  assert.deepEqual(Object.keys(tokens.primitive.radius), ['8', 'full']);
  const f = tokens.primitive.radius.full;
  assert.deepEqual(f.$value, { value: 9999, unit: 'px' });
  assert.equal(f.$extensions['vuong-design'].uses, 2);
  assert.equal(f.$extensions['vuong-design'].note, 'pill: ≥ half the smaller side');
  assert.equal(map['s1|p1|radius|radiusTL'], 'primitive.radius.full');
  assert.match(css, /--radius-full: 9999px;/);
});

test('m5: distinct values always get distinct primitive names (12 vs 12.004, float residue); deterministic', () => {
  seq = 0;
  const u = (node, v) => use('space', 'paddingL', v, `div.c${node}|div`, { node });
  const b = buildTokens({ uses: [u('0.1', 12), u('0.2', 12.004), u('0.3', 12.02), u('0.4', 22.03 - 10.01), u('0.5', 16)], vars: {} }, []);
  const names = Object.keys(b.tokens.primitive.space).sort();
  assert.equal(names.length, 5, JSON.stringify(names));
  // values that are unique at 2 decimals keep their short name
  assert.ok(names.includes('16'), JSON.stringify(names));
  assert.ok(names.includes('12'), JSON.stringify(names));
  assert.ok(names.includes('12_004'), JSON.stringify(names));
  const again = buildTokens({ uses: [u('0.5', 16), u('0.4', 22.03 - 10.01), u('0.3', 12.02), u('0.2', 12.004), u('0.1', 12)], vars: {} }, []);
  assert.deepEqual(Object.keys(again.tokens.primitive.space).sort(), names);
});

test('tokenMap: per screen and node, role path when the role has a token, else primitive; type keyed `type`; ask uses left out', () => {
  const inv = fixture();
  const { tokens, map } = buildTokens(inv, entries);
  const tm = tokenMap(inv, tokens, entries);
  assert.equal(tm.s1['0.0'].borderT, 'role.line');
  assert.equal(tm.s1['0.1'].bg, 'role.line');
  assert.equal(tm.s1['0.2.0'].bg, 'role.chip-bg');
  assert.match(tm.s1['0.2.2'].bg, /^primitive\.color\.c\d+$/); // role has a token, but the use is off-majority
  assert.match(tm.s1['0.0.0'].color, /^primitive\.color\.c\d+$/); // single run: no run suffix on colour
  assert.equal(tm.s1['0.0.0'].type, 'primitive.typography.t16-500');
  assert.equal(tm.s1['0.0.1'].type, 'primitive.typography.t14-400');
  assert.equal(tm.s1['0.3'].paddingT, 'role.card-padding'); // 13 -> 12 auto: applied
  assert.equal(tm.s1['0.4'], undefined); // 14 asked, not applied: left out
  assert.equal(tm.s1['0.2'], undefined); // space-between gap: no token
  assert.equal(tm.s1['0.6'].opacity, 'primitive.opacity.50');
  // every entry resolves to a token that exists
  const has = (p) => p.split('.').reduce((g, k) => g && g[k], tokens);
  for (const n of Object.values(tm.s1)) for (const p of Object.values(n)) assert.ok(has(p) && has(p).$value !== undefined, p);
  // agrees with buildTokens' own map for every use it keeps
  for (const [k, v] of Object.entries(map)) if (!k.startsWith('s1|0.4|')) assert.ok(Object.values(tm.s1).some((n) => Object.values(n).includes(v)), k);
});

test('tokenMap: several runs of a node get a run index; renames are followed; byte-identical for reversed uses; tokens unchanged', () => {
  seq = 0;
  const inv = { uses: [
    type(16, 500, 24, 'p.a|d', { node: '1', run: 0 }), type(14, 400, 20, 'p.a|d', { node: '1', run: 2 }),
    use('color', 'color', '#111111', 'p.a|d', { node: '1', run: 0 }), use('color', 'color', '#222222', 'p.a|d', { node: '1', run: 2 }),
    use('color', 'bg', '#333333', 'p.a|d', { node: '2' }),
  ], vars: {} };
  const names = { 'primitive.color.c03': 'primitive.color.ink' };
  const before = JSON.stringify(buildTokens(inv, [], names).tokens);
  const tm = tokenMap(inv, buildTokens(inv, [], names).tokens, [], names);
  assert.deepEqual(Object.keys(tm['s1']['1']).sort(), ['color|0', 'color|2', 'type|0', 'type|2']);
  assert.equal(tm.s1['1']['type|2'], 'role.a-text'); // role majority (tie: first path)
  assert.equal(tm.s1['1']['type|0'], 'primitive.typography.t16-500');
  assert.ok(Object.values(tm.s1).flatMap((n) => Object.values(n)).includes('primitive.color.ink'));
  const rev = { uses: [...inv.uses].reverse(), vars: {} };
  assert.equal(JSON.stringify(tokenMap(rev, buildTokens(rev, [], names).tokens, [], names)), JSON.stringify(tm));
  assert.equal(JSON.stringify(buildTokens(inv, [], names).tokens), before);
});
