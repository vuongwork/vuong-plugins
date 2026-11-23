import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { varsPayload, varsPlan, varNames, SCOPE_SETS } from '../core/figma-vars.mjs';
import { encodeScreen, newTables } from '../core/figma-encode.mjs';
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';

const AsyncFunction = (async () => {}).constructor;
const run = (code, figma) => new AsyncFunction('figma', code)(figma);
const runAll = async (codes, figma) => { const out = []; for (const c of codes) out.push(await run(c, figma)); return out; };
const sum = (rs, k) => rs.reduce((a, r) => ({ created: a.created + r[k].created, updated: a.updated + r[k].updated, unchanged: a.unchanged + r[k].unchanged }), { created: 0, updated: 0, unchanged: 0 });
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));

const col = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((x) => Math.round(x * 10000) / 10000);
  return { $type: 'color', $value: { colorSpace: 'srgb', components: c, ...(alpha === undefined ? {} : { alpha }), hex } };
};
const dim = (value) => ({ $type: 'dimension', $value: { value, unit: 'px' } });
const small = () => ({
  primitive: {
    color: { c01: { ...col('#26335c'), $description: 'ink' }, c02: col('#c9683f', 0.5) },
    space: { 8: dim(8), 12: dim(12) },
    size: { 20: dim(20) },
    radius: { 4: dim(4), full: dim(9999) },
    border: { 1: dim(1) },
    opacity: { 55: { $type: 'number', $value: 0.55 } },
    font: {
      family: { vn: { $type: 'fontFamily', $value: 'Be Vietnam Pro' } },
      size: { 12: dim(12), '10_5': dim(10.5) },
      weight: { 400: { $type: 'fontWeight', $value: 400 }, 600: { $type: 'fontWeight', $value: 600 } },
      lineHeight: { 18: dim(18) },
      letterSpacing: { 0: dim(0), m0_5: dim(-0.5) },
    },
    typography: {
      't12-400': { $type: 'typography', $value: { fontFamily: '{primitive.font.family.vn}', fontSize: '{primitive.font.size.12}', fontWeight: '{primitive.font.weight.400}', letterSpacing: '{primitive.font.letterSpacing.0}', lineHeight: 1.5 },
        $extensions: { 'vuong-design': { lineHeightPx: 18 } }, $description: 'body' },
      't10_5-600': { $type: 'typography', $value: { fontFamily: '{primitive.font.family.vn}', fontSize: '{primitive.font.size.10_5}', fontWeight: '{primitive.font.weight.600}', letterSpacing: '{primitive.font.letterSpacing.m0_5}', lineHeight: 1.3333 },
        $extensions: { 'vuong-design': { textTransform: 'uppercase', fontStyle: 'italic' } } },
    },
    shadow: {
      s01: { $type: 'shadow', $value: [
        { color: { colorSpace: 'srgb', components: [0.8, 0.9, 0.8], hex: '#ccdccc' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 8, unit: 'px' }, blur: { value: 4, unit: 'px' }, spread: { value: -3, unit: 'px' } },
        { color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.25, hex: '#000000' }, offsetX: { value: 1, unit: 'px' }, offsetY: { value: 2, unit: 'px' }, blur: { value: 3, unit: 'px' }, spread: { value: 0, unit: 'px' }, inset: true }] },
      s02: { $value: '0 0 5em red', $extensions: { 'vuong-design': { raw: '0 0 5em red' } } },
    },
  },
  role: {
    'text-muted': { ...{ $type: 'color', $value: '{primitive.color.c01}' }, $description: 'muted text' },
    'card-gap': { $type: 'dimension', $value: '{primitive.space.12}' },
    'card-radius': { $type: 'dimension', $value: '{primitive.radius.full}' },
    'card-opacity': { $type: 'number', $value: '{primitive.opacity.55}' },
    'body-type': { $type: 'typography', $value: '{primitive.typography.t12-400}' },
    'card-shadow': { $type: 'shadow', $value: '{primitive.shadow.s01}' },
    'second': { $type: 'color', $value: '{role.text-muted}' },
  },
  component: {},
});
const fonts = DEFAULT_FONTS;
const byName = (f, n) => f.variables.getLocalVariablesAsync().then((vs) => vs.find((v) => v.name === n));

test('plan: names, order and what has no variable', () => {
  const t = small();
  assert.deepEqual(varNames(t), ['color/c01', 'color/c02', 'space/8', 'space/12', 'size/20', 'radius/4', 'radius/full', 'border/1', 'opacity/55',
    'font/size/12', 'font/size/10_5', 'font/lineHeight/18', 'font/letterSpacing/0', 'font/letterSpacing/m0_5',
    'role/text-muted', 'role/card-gap', 'role/card-radius', 'role/card-opacity', 'role/second']);
  const p = varsPlan(t);
  assert.deepEqual(p.skipped, [{ path: 'primitive.shadow.s02', reason: 'shadow-unparsed' }]);
  assert.deepEqual(p.textStyles.map((s) => s.name), ['type/t12-400', 'type/t10_5-600']);
  assert.deepEqual(p.effectStyles.map((s) => s.name), ['shadow/s01']);
});

test('payload on the fake: collections, variables, aliases, scopes, descriptions', async () => {
  const f = makeFakeFigma({ fonts });
  const codes = varsPayload(small());
  assert.equal(codes.length, 1);
  const [r] = await runAll(codes, f);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.collections, { created: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(r.variables, { created: 19, updated: 0, unchanged: 0 });
  assert.deepEqual(r.textStyles, { created: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(r.effectStyles, { created: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(r.skipped, [{ path: 'primitive.shadow.s02', reason: 'shadow-unparsed' }]);
  assert.deepEqual(f._collections.map((c) => [c.name, c.modes.map((m) => m.name)]), [['Primitive', ['Value']], ['Role', ['Value']]]);
  const vs = await f.variables.getLocalVariablesAsync();
  assert.equal(vs.length, 19);
  assert.ok(vs.every((v) => v.scopes.length > 0 && !v.scopes.includes('ALL_SCOPES')));
  const mode = (v) => f._collections.find((c) => c.id === v.variableCollectionId).modes[0].modeId;
  const val = (n) => { const v = vs.find((x) => x.name === n); return v.valuesByMode[mode(v)]; };
  const c2 = val('color/c02');
  assert.deepEqual(c2, { r: 0.7882, g: 0.4078, b: 0.2471, a: 0.5 });
  assert.equal(val('opacity/55'), 55, 'Figma reads an OPACITY variable as a percentage');
  assert.equal(val('radius/full'), 9999);
  assert.equal(val('font/size/10_5'), 10.5);
  assert.deepEqual((await byName(f, 'color/c01')).scopes, SCOPE_SETS[0]);
  assert.deepEqual((await byName(f, 'space/8')).scopes, ['GAP']);
  assert.deepEqual((await byName(f, 'size/20')).scopes, ['WIDTH_HEIGHT']);
  assert.deepEqual((await byName(f, 'radius/4')).scopes, ['CORNER_RADIUS']);
  assert.deepEqual((await byName(f, 'border/1')).scopes, ['STROKE_FLOAT']);
  assert.deepEqual((await byName(f, 'opacity/55')).scopes, ['OPACITY']);
  assert.deepEqual((await byName(f, 'font/size/12')).scopes, ['FONT_SIZE']);
  assert.deepEqual((await byName(f, 'font/lineHeight/18')).scopes, ['LINE_HEIGHT']);
  assert.deepEqual((await byName(f, 'font/letterSpacing/0')).scopes, ['LETTER_SPACING']);
  assert.equal((await byName(f, 'color/c01')).description, 'ink');
  // role aliases
  const prim = f._collections[0], role = f._collections[1];
  const alias = (n) => { const a = val(n); assert.equal(a.type, 'VARIABLE_ALIAS'); return vs.find((v) => v.id === a.id); };
  assert.equal(alias('role/text-muted').name, 'color/c01');
  assert.equal(alias('role/text-muted').variableCollectionId, prim.id);
  assert.equal((await byName(f, 'role/text-muted')).variableCollectionId, role.id);
  assert.equal((await byName(f, 'role/text-muted')).description, 'muted text');
  assert.equal(alias('role/card-gap').name, 'space/12');
  assert.equal(alias('role/card-radius').name, 'radius/full');
  assert.equal(alias('role/card-opacity').name, 'opacity/55');
  assert.equal(alias('role/second').name, 'color/c01', 'a role aliasing a role ends on the primitive');
  assert.deepEqual((await byName(f, 'role/card-gap')).scopes, ['GAP']);
  assert.deepEqual((await byName(f, 'role/card-radius')).scopes, ['CORNER_RADIUS']);
  assert.deepEqual((await byName(f, 'role/text-muted')).scopes, SCOPE_SETS[0]);
});

test('text styles: font, size, line height px / percent, letter spacing px, case; effect styles', async () => {
  const f = makeFakeFigma({ fonts });
  const [r] = await runAll(varsPayload(small()), f);
  assert.deepEqual(r.errors, []);
  const ts = Object.fromEntries((await f.getLocalTextStylesAsync()).map((s) => [s.name, s]));
  const a = ts['type/t12-400'], b = ts['type/t10_5-600'];
  assert.deepEqual(a.fontName, { family: 'Be Vietnam Pro', style: 'Regular' });
  assert.equal(a.fontSize, 12);
  assert.deepEqual(a.lineHeight, { unit: 'PIXELS', value: 18 });
  assert.deepEqual(a.letterSpacing, { unit: 'PIXELS', value: 0 });
  assert.equal(a.textCase, 'ORIGINAL');
  assert.equal(a.description, 'body');
  // no px line height in the token: ratio -> percent; italic face missing -> nearest weight of the family, reported
  assert.deepEqual(b.fontName, { family: 'Be Vietnam Pro', style: 'Italic' });
  assert.equal(b.fontSize, 10.5);
  assert.deepEqual(b.lineHeight, { unit: 'PERCENT', value: 133.33 });
  assert.deepEqual(b.letterSpacing, { unit: 'PIXELS', value: -0.5 });
  assert.equal(b.textCase, 'UPPER');
  assert.equal(r.fontMissing.length, 1);
  assert.equal(r.fontMissing[0].style, 'type/t10_5-600');
  assert.equal(r.fontMissing[0].fontStyle, 'SemiBold Italic');
  const es = (await f.getLocalEffectStylesAsync())[0];
  assert.equal(es.name, 'shadow/s01');
  assert.deepEqual(es.effects, [
    { type: 'DROP_SHADOW', color: { r: 0.8, g: 0.9, b: 0.8, a: 1 }, offset: { x: 0, y: 8 }, radius: 4, spread: -3, visible: true, blendMode: 'NORMAL' },
    { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 1, y: 2 }, radius: 3, spread: 0, visible: true, blendMode: 'NORMAL' },
  ]);
});

test('a font family that is not available falls back to Inter and is reported', async () => {
  const f = makeFakeFigma({ fonts: ['Inter|Regular', 'Inter|Bold'] });
  const [r] = await runAll(varsPayload(small()), f);
  assert.deepEqual(r.errors, []);
  const ts = Object.fromEntries((await f.getLocalTextStylesAsync()).map((s) => [s.name, s]));
  assert.deepEqual(ts['type/t12-400'].fontName, { family: 'Inter', style: 'Regular' });
  assert.deepEqual(r.fontMissing.map((m) => m.style), ['type/t12-400', 'type/t10_5-600']);
  assert.equal(r.fontMissing[0].used, 'Inter Regular');
});

test('rerun: nothing is added, nothing is updated; a changed value updates in place', async () => {
  const f = makeFakeFigma({ fonts });
  await runAll(varsPayload(small()), f);
  const before = [(await f.variables.getLocalVariablesAsync()).length, (await f.getLocalTextStylesAsync()).length, (await f.getLocalEffectStylesAsync()).length, f._collections.length];
  const r2 = await runAll(varsPayload(small()), f);
  assert.deepEqual([(await f.variables.getLocalVariablesAsync()).length, (await f.getLocalTextStylesAsync()).length, (await f.getLocalEffectStylesAsync()).length, f._collections.length], before);
  assert.deepEqual(sum(r2, 'variables'), { created: 0, updated: 0, unchanged: 19 });
  assert.deepEqual(sum(r2, 'textStyles'), { created: 0, updated: 0, unchanged: 2 });
  assert.deepEqual(sum(r2, 'effectStyles'), { created: 0, updated: 0, unchanged: 1 });
  assert.deepEqual(r2[0].collections, { created: 0, updated: 0, unchanged: 2 });
  assert.deepEqual(r2[0].created, { collections: [], variables: [], textStyles: [], effectStyles: [] });
  // change: a colour, a space, a role target, a description, a text style, a shadow
  const t = small();
  t.primitive.color.c01 = { ...col('#112233'), $description: 'ink 2' };
  t.primitive.space[12] = dim(13);
  t.role['text-muted'].$value = '{primitive.color.c02}';
  t.primitive.typography['t12-400'].$extensions['vuong-design'].lineHeightPx = 20;
  t.primitive.shadow.s01.$value[0].offsetY = { value: 9, unit: 'px' };
  const ids = (await f.variables.getLocalVariablesAsync()).map((v) => v.id).sort();
  const r3 = await runAll(varsPayload(t), f);
  assert.deepEqual(r3[0].errors, []);
  assert.deepEqual(sum(r3, 'variables'), { created: 0, updated: 4, unchanged: 15 }); // color/c01, space/12, role/text-muted and role/second (both now end on c02)
  assert.deepEqual(sum(r3, 'textStyles'), { created: 0, updated: 1, unchanged: 1 });
  assert.deepEqual(sum(r3, 'effectStyles'), { created: 0, updated: 1, unchanged: 0 });
  assert.deepEqual((await f.variables.getLocalVariablesAsync()).map((v) => v.id).sort(), ids, 'same variables, no new ones');
  assert.deepEqual((await byName(f, 'color/c01')).description, 'ink 2');
  assert.equal((await f.getLocalTextStylesAsync()).find((s) => s.name === 'type/t12-400').lineHeight.value, 20);
  assert.equal((await f.getLocalEffectStylesAsync())[0].effects[0].offset.y, 9);
});

test('batches: a small limit splits the data, later batches find earlier variables by name', async () => {
  const codes = varsPayload(small(), { limit: 7300 });
  assert.ok(codes.length > 1, 'split into ' + codes.length);
  assert.ok(codes.every((c) => bytes(c) <= 7300));
  const f = makeFakeFigma({ fonts });
  const rs = await runAll(codes, f);
  assert.deepEqual(rs.flatMap((r) => r.errors), []);
  assert.deepEqual(sum(rs, 'variables'), { created: 19, updated: 0, unchanged: 0 });
  assert.equal(sum(rs, 'collections').created, 2);
  assert.ok(rs.slice(1).every((r) => !r.skipped));
  // each batch alone on a file without the earlier ones: the alias is reported, not thrown
  const last = codes.find((c) => c.includes('"role/text-muted"')), g = makeFakeFigma({ fonts });
  const r = await run(last, g);
  assert.ok(r.errors.some((e) => e.name === 'role/text-muted' && /alias target missing/.test(e.msg)), JSON.stringify(r.errors));
  // the code itself: no ??, ?., ||=, fetch
  for (const c of codes) assert.ok(!/\?\?|\?\.[a-zA-Z_[(]|\|\|=|fetch\(/.test(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')));
  assert.throws(() => varsPayload(small(), { limit: 6900 }), /does not fit/);
});

test('misuse the real API rejects is rejected by the fake', async () => {
  const f = makeFakeFigma({ fonts });
  const c = f.variables.createVariableCollection('X'), m = c.modes[0].modeId;
  const v = f.variables.createVariable('a', c, 'COLOR');
  assert.throws(() => v.setValueForMode(m, { r: 1.2, g: 0, b: 0, a: 1 }), /0\.\.1/);
  assert.throws(() => v.setValueForMode(m, { r: 1, g: 0, b: 0, x: 1 }), /Invalid COLOR/);
  assert.throws(() => v.setValueForMode(m, { type: 'VARIABLE_ALIAS', id: 'VariableID:nope' }), /missing variable/);
  assert.throws(() => { v.scopes = ['CORNER_RADIUS']; }, /not valid for COLOR/);
  assert.throws(() => f.variables.createVariable('a', c, 'COLOR'), /Duplicate/);
  assert.throws(() => f.variables.createVariable('b', 'id', 'COLOR'), /collection/);
  const fl = f.variables.createVariable('f', c, 'FLOAT');
  assert.throws(() => fl.setValueForMode(m, '3'), /FLOAT/);
  assert.throws(() => fl.setValueForMode(m, { type: 'VARIABLE_ALIAS', id: v.id }), /another type/);
  const s = f.createTextStyle();
  assert.throws(() => { s.fontName = { family: 'Inter', style: 'Bold' }; }, /not loaded/);
  assert.throws(() => { s.lineHeight = { unit: 'PX', value: 1 }; }, /unit/);
  const e = f.createEffectStyle();
  assert.throws(() => { e.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0 }, offset: { x: 0, y: 0 }, radius: 1 }]; }, /r, g, b, a/);
});

// ---- Planora (fixture: the tokens of the real ds run the encoder fixture was made from) ----
const planora = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/figma-encode-planora.json.gz', import.meta.url))).toString('utf8'));

test('Planora: varNames equals the encoder table V, same order', () => {
  assert.deepEqual(varNames(planora.tokens), planora.V);
  assert.deepEqual(varsPlan(planora.tokens).skipped, []);
});

test('Planora: payload batches <= 50 000 B, creates every variable and every style the encoder can emit, rerun is a no-op', async () => {
  const codes = varsPayload(planora.tokens);
  assert.ok(codes.every((c) => bytes(c) <= 50000));
  const f = makeFakeFigma({ fonts });
  const rs = await runAll(codes, f);
  assert.deepEqual(rs.flatMap((r) => r.errors), []);
  assert.deepEqual(rs.flatMap((r) => r.fontMissing), [], 'every Planora face exists in the fake font list');
  const names = new Set((await f.variables.getLocalVariablesAsync()).map((v) => v.name));
  assert.equal(names.size, planora.V.length);
  for (const n of planora.V) assert.ok(names.has(n), n);
  assert.ok((await f.variables.getLocalVariablesAsync()).every((v) => v.scopes.length && !v.scopes.includes('ALL_SCOPES')));
  // every style name the encoder emits for the 18 screens
  const tables = newTables(planora.V);
  for (const s of planora.screens) encodeScreen(s.spec, { screen: s.id, file: planora.file, W: s.W, map: planora.map, svgDefs: s.svgDefs, tables, tokens: planora.tokens });
  assert.ok(tables.S.length > 0);
  const styles = new Set([...(await f.getLocalTextStylesAsync()), ...(await f.getLocalEffectStylesAsync())].map((s) => s.name));
  for (const n of tables.S) assert.ok(styles.has(n), n);
  // rerun
  const counts = [(await f.variables.getLocalVariablesAsync()).length, styles.size];
  const r2 = await runAll(codes, f);
  assert.deepEqual(sum(r2, 'variables'), { created: 0, updated: 0, unchanged: planora.V.length });
  assert.equal(sum(r2, 'textStyles').created + sum(r2, 'textStyles').updated + sum(r2, 'effectStyles').created + sum(r2, 'effectStyles').updated, 0);
  assert.deepEqual([(await f.variables.getLocalVariablesAsync()).length, (await f.getLocalTextStylesAsync()).length + (await f.getLocalEffectStylesAsync()).length], counts);
});

test('the full Planora tokens.json (about 210 KB) is split into batches <= 50 000 B', async () => {
  // the fixture is trimmed to what the encoder uses: scale it up with extra tokens of the same kinds
  const t = clone(planora.tokens);
  for (let i = 0; i < 1200; i++) {
    t.primitive.color['x' + i] = col('#' + ((i * 2654435 + 1193046) & 0xffffff).toString(16).padStart(6, '0'));
    t.role['x-role-' + i] = { $type: 'color', $value: `{primitive.color.x${i}}`, $description: 'generated token with a description of average length' };
  }
  const codes = varsPayload(t);
  assert.ok(codes.length >= 3, 'batches: ' + codes.length);
  assert.ok(codes.every((c) => bytes(c) <= 50000));
  const f = makeFakeFigma({ fonts });
  const rs = await runAll(codes, f);
  assert.deepEqual(rs.flatMap((r) => r.errors), []);
  assert.equal(sum(rs, 'variables').created, varNames(t).length);
});

// T8 item E: a FLOAT variable bound to opacity is read by Figma as a percentage (live: opacity/90 holding 0.9 drew the
// node at 0.009), so opacity values are written x 100; a literal role opacity gets the OPACITY scope and x 100 too
test('opacity variables hold percentages (0.9 -> 90), literal role opacities too; an old 0..1 value is updated', async () => {
  const t = { primitive: { opacity: { 90: { $type: 'number', $value: 0.9 }, 8: { $type: 'number', $value: 0.08 } } },
    role: { 'say-opacity': { $type: 'number', $value: '{primitive.opacity.90}' }, 'chip-opacity': { $type: 'number', $value: 0.8 } } };
  const p = varsPlan(t);
  assert.deepEqual(p.vars.map((v) => [v.name, v.val, SCOPE_SETS[v.sc]]), [['opacity/8', 8, ['OPACITY']], ['opacity/90', 90, ['OPACITY']],
    ['role/say-opacity', 'opacity/90', ['OPACITY']], ['role/chip-opacity', 80, ['OPACITY']]]);
  const f = makeFakeFigma({ fonts });
  const coll = f.variables.createVariableCollection('Primitive');
  coll.renameMode(coll.modes[0].modeId, 'Value');
  const old = f.variables.createVariable('opacity/90', coll, 'FLOAT');
  old.setValueForMode(coll.modes[0].modeId, 0.9); old.scopes = ['OPACITY'];
  const [r] = await runAll(varsPayload(t), f);
  assert.deepEqual(r.errors, []);
  assert.equal(r.variables.updated, 1);
  const vs = await f.variables.getLocalVariablesAsync();
  const v = (n) => vs.find((x) => x.name === n);
  assert.equal(v('opacity/90').valuesByMode[coll.modes[0].modeId], 90);
  assert.equal(Object.values(v('role/chip-opacity').valuesByMode)[0], 80);
});
