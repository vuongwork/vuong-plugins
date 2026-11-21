import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figmaTextBox, applyFigmaModel } from '../core/figma-model.mjs';
import { defaultFontMap } from '../core/font-map.mjs';

const font = (o = {}) => ({ ff: 'Inter', fs: '14px', fw: '400', lh: 20, ls: 'normal', ...o });
const text = (id, o = {}) => ({ id, t: 'T', w: 40, h: 20, sz: ['HUG', 'HUG'], font: font(), runs: [{ t: 'x' }], ...o });
const root = (...kids) => ({ id: 'r', t: 'F', w: 300, h: 100, sz: ['FIXED', 'FIXED'], lay: { d: 'V', p: [0, 0, 0, 0], pa: 'S', ca: 'S' }, kids });

test('figmaTextBox rounds up, ignoring trailing letter-spacing on width', () => {
  assert.deepEqual(figmaTextBox(33.2, 18.89, 0), { w: 34, h: 19 });
  assert.deepEqual(figmaTextBox(132.83, 15.75, 1), { w: 132, h: 16 });
  assert.deepEqual(figmaTextBox(40, 25.3, 0), { w: 40, h: 26 });
});

test('HUG text is resized; FIXED/FILL axes and the input are untouched', () => {
  const spec = root(text('a', { w: 33.2, h: 18.89 }), text('b', { w: 33.2, h: 18.89, sz: ['FILL', 'HUG'] }));
  const before = JSON.stringify(spec);
  const { spec: out } = applyFigmaModel(spec, defaultFontMap());
  assert.equal(JSON.stringify(spec), before);
  assert.notEqual(out, spec);
  assert.deepEqual([out.kids[0].w, out.kids[0].h], [34, 19]);
  assert.deepEqual([out.kids[1].w, out.kids[1].h], [33.2, 19]);
  assert.deepEqual(out.kids.map((k) => k.id), ['a', 'b']);
});

test('letter-spacing in px is read from font.ls', () => {
  const { spec: out } = applyFigmaModel(root(text('a', { w: 132.83, h: 15.75, font: font({ ls: '1px' }) })), defaultFontMap());
  assert.deepEqual([out.kids[0].w, out.kids[0].h], [132, 16]);
});

test('FILL node with a border gets strokeOverlay, size unchanged', () => {
  const box = { id: 'b', t: 'F', w: 100, h: 50, sz: ['FILL', 'HUG'], paint: { border: [{ w: 4 }, { w: 4 }, { w: 4 }, { w: 4 }] }, kids: [] };
  const fixed = { id: 'c', t: 'F', w: 100, h: 50, sz: ['FIXED', 'FIXED'], paint: { border: [{ w: 4 }, { w: 4 }, { w: 4 }, { w: 4 }] }, kids: [] };
  const spec = root(box, fixed);
  const { spec: out } = applyFigmaModel(spec, defaultFontMap());
  assert.equal(out.kids[0].paint.strokeOverlay, true);
  assert.deepEqual([out.kids[0].w, out.kids[0].h], [100, 50]);
  assert.equal(out.kids[1].paint.strokeOverlay, undefined);
  assert.equal(box.paint.strokeOverlay, undefined);
});

test('runs of different sizes flag mixedRunHeight', () => {
  const mixed = text('m', { runs: [{ t: 'a', s: { fs: '22px' } }, { t: 'b', s: { fs: '10px' } }] });
  const same = text('s', { runs: [{ t: 'a' }, { t: 'b', s: { fw: '700' } }] });
  const { flags } = applyFigmaModel(root(mixed, same), defaultFontMap());
  assert.equal(flags.length, 1);
  assert.equal(flags[0].id, 'm');
  assert.equal(flags[0].kind, 'mixedRunHeight');
});

test('system fonts are substituted with Inter and the render font is replaced', () => {
  const t = text('a', { font: font({ ff: '"Segoe UI", system-ui, sans-serif' }), runs: [{ t: 'a', s: { ff: 'system-ui' } }] });
  const { spec: out, substitutions } = applyFigmaModel(root(t), defaultFontMap());
  assert.ok(substitutions.some((s) => s.from === 'Segoe UI' && s.to === 'Inter'));
  assert.equal(out.kids[0].font.ff, 'Inter');
  assert.equal(out.kids[0].runs[0].s.ff, 'Inter');
});

test('available fonts are kept, unknown fonts fall to Inter, substitutions deduped', () => {
  const fm = defaultFontMap();
  assert.equal(fm.substitute('Be Vietnam Pro'), 'Be Vietnam Pro');
  assert.equal(fm.substitute("'Material Symbols Rounded'"), 'Material Symbols Rounded');
  assert.equal(fm.substitute('-apple-system'), 'Inter');
  assert.equal(fm.substitute('Comic Foo'), 'Inter');
  const a = text('a', { font: font({ ff: 'Foo' }) }), b = text('b', { font: font({ ff: 'Foo' }) });
  const { substitutions } = applyFigmaModel(root(a, b, text('c')), fm);
  assert.deepEqual(substitutions, [{ from: 'Foo', to: 'Inter', reason: 'not-in-figma' }]);
});

test('whitelisted font that Chrome failed to load is substituted as not-loaded', () => {
  const list = '"Be Vietnam Pro", sans-serif';
  const t = text('a', { font: font({ ff: list }) });
  const { spec: out, substitutions, flags } = applyFigmaModel(root(t), defaultFontMap(), { rendered: { [list]: 'sans-serif' } });
  assert.deepEqual(substitutions, [{ from: 'Be Vietnam Pro', to: 'Inter', reason: 'not-loaded' }]);
  assert.equal(out.kids[0].font.ff, 'Inter');
  assert.ok(flags.some((f) => f.kind === 'fontSubstitution' && f.id === 'a'));
});

test('"Foo", Roboto: rendered Roboto keeps Roboto; rendered Foo -> Inter not-in-figma', () => {
  const list = '"Foo", Roboto';
  const mk = () => root(text('a', { font: font({ ff: list }) }));
  const ok = applyFigmaModel(mk(), defaultFontMap(), { rendered: { [list]: 'Roboto' } });
  assert.deepEqual(ok.substitutions, []);
  assert.equal(ok.spec.kids[0].font.ff, 'Roboto');
  assert.equal(ok.flags.length, 0);
  const bad = applyFigmaModel(mk(), defaultFontMap(), { rendered: { [list]: 'Foo' } });
  assert.deepEqual(bad.substitutions, [{ from: 'Foo', to: 'Inter', reason: 'not-in-figma' }]);
});

test('substituted HUG text is flagged, marked font.sub and not pinned', () => {
  const t = text('a', { w: 33.2, h: 18.89, font: font({ ff: 'Segoe UI' }) });
  const { spec: out, flags, substitutions } = applyFigmaModel(root(t), defaultFontMap());
  assert.equal(substitutions[0].reason, 'system');
  assert.equal(out.kids[0].font.sub, true);
  assert.deepEqual([out.kids[0].w, out.kids[0].h], [33.2, 18.89]);
  assert.equal(flags.find((f) => f.kind === 'fontSubstitution').detail, 'Segoe UI \u2192 Inter');
});
