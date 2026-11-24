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

test('R47: SCALE constraints and anchor wrappers pass through unchanged', () => {
  const kid = { id: 'k', t: 'F', w: 2.5, h: 16, sz: ['FIXED', 'FIXED'], abs: { x: 0, y: 0, c: 'L' } };
  const spec = root(
    { id: 's', t: 'F', w: 60, h: 8, sz: ['FIXED', 'FIXED'], abs: { x: 30, y: 4, c: 'SCALE', cy: 'SCALE' } },
    { id: 'r.g0', t: 'F', syn: 'anchor', w: 0, h: 16, sz: ['FIXED', 'FIXED'], abs: { x: 174, y: 20, c: 'SCALE' }, kids: [kid] },
  );
  const { spec: out } = applyFigmaModel(spec, defaultFontMap());
  assert.deepEqual(out.kids[0].abs, { x: 30, y: 4, c: 'SCALE', cy: 'SCALE' });
  assert.equal(out.kids[1].syn, 'anchor');
  assert.deepEqual([out.kids[1].w, out.kids[1].abs], [0, { x: 174, y: 20, c: 'SCALE' }]);
  assert.deepEqual(out.kids[1].kids[0].abs, { x: 0, y: 0, c: 'L' });
});

// ---- plan 3 Task 2: measured Figma facts (core/figma-facts.json); every test passes `facts` explicitly ----
const FACTS = { version: 1, measured: null, lineHeightFrac: 'keep', textBox: 'ceil', scaleBasis: 'frame', zeroWidthAnchor: 'ok',
  scaleInHug: 'ok', strokeOverlay: 'ok', shrinkFill: { maxWidth: 'ok', growText: 'ok' }, baseline: 'ok' };
const facts = (o = {}) => ({ ...FACTS, ...o });
const factSpec = () => root(
  text('a', { w: 40.3, h: 17.4, font: font({ lh: 17.4 }), runs: [{ t: 'x' }, { t: 'y', s: { lh: 21.6 } }] }),
  { id: 'b', t: 'F', w: 100, h: 50, sz: ['FILL', 'HUG'], paint: { border: [{ w: 2 }, { w: 2 }, { w: 2 }, { w: 2 }] }, kids: [] },
);
// applyFigmaModel's output for factSpec() before the facts existed (recorded from the plan-1 code)
const PLAN1_OUT = '{"spec":{"id":"r","t":"F","w":300,"h":100,"sz":["FIXED","FIXED"],"lay":{"d":"V","p":[0,0,0,0],"pa":"S","ca":"S"},"kids":[{"id":"a","t":"T","w":41,"h":18,"sz":["HUG","HUG"],"font":{"ff":"Inter","fs":"14px","fw":"400","lh":17.4,"ls":"normal"},"runs":[{"t":"x"},{"t":"y","s":{"lh":21.6}}]},{"id":"b","t":"F","w":100,"h":50,"sz":["FILL","HUG"],"paint":{"border":[{"w":2},{"w":2},{"w":2},{"w":2}],"strokeOverlay":true},"kids":[]}],"model":"figma"},"flags":[],"substitutions":[]}';

test('facts: the measured defaults (keep / ok) leave the model output byte for byte as before', () => {
  assert.equal(JSON.stringify(applyFigmaModel(factSpec(), defaultFontMap(), { facts: facts() })), PLAN1_OUT);
});

test("facts lineHeightFrac 'round' / 'floor': a fractional line height is rounded that way, flagged figmaLineHeight, re-measured", () => {
  const r = applyFigmaModel(factSpec(), defaultFontMap(), { facts: facts({ lineHeightFrac: 'round' }) });
  const a = r.spec.kids[0];
  assert.equal(a.font.lh, 17);
  assert.equal(a.runs[1].s.lh, 22);
  assert.equal(a.font.remeasure, true, 'the box measured at 17.4 px is stale');
  assert.deepEqual(r.flags.filter((f) => f.kind === 'figmaLineHeight').map((f) => f.id), ['a']);
  const f = applyFigmaModel(factSpec(), defaultFontMap(), { facts: facts({ lineHeightFrac: 'floor' }) });
  assert.equal(f.spec.kids[0].font.lh, 17);
  assert.equal(f.spec.kids[0].runs[1].s.lh, 21);
  // a whole line height is not touched
  const w = applyFigmaModel(root(text('w')), defaultFontMap(), { facts: facts({ lineHeightFrac: 'round' }) });
  assert.equal(w.spec.kids[0].font.lh, 20);
  assert.equal(w.spec.kids[0].font.remeasure, undefined);
  assert.equal(w.flags.length, 0);
});

test("facts strokeOverlay 'off': no overlay; the border is taken off the FILL cell's size, flagged strokeOverlay", () => {
  const r = applyFigmaModel(factSpec(), defaultFontMap(), { facts: facts({ strokeOverlay: 'off' }) });
  const b = r.spec.kids[1];
  assert.equal(b.paint.strokeOverlay, undefined);
  assert.deepEqual([b.w, b.h], [96, 50], 'only the FILL axis (width) loses left + right border');
  assert.deepEqual(r.flags.filter((f) => f.kind === 'strokeOverlay').map((f) => f.id), ['b']);
});

test("facts lineHeightFrac 'round': a px string line height is rounded too; 'normal' is left alone", () => {
  const r = applyFigmaModel(root(text('p', { font: font({ lh: '17.6px' }) }), text('q', { font: font({ lh: 'normal' }) })), defaultFontMap(), { facts: facts({ lineHeightFrac: 'round' }) });
  assert.equal(r.spec.kids[0].font.lh, '18px');
  assert.equal(r.spec.kids[1].font.lh, 'normal');
  assert.deepEqual(r.flags.map((f) => f.id), ['p']);
});

// T8 items C / D: Figma's text box is figmaTextBox(chromeW) = ceil(chromeW - trailing letter-spacing) wide, so a max
// width equal to a text's Chrome natural width (shrinkFill FILL + max, or a single FILL child capped at its B width)
// wraps the last word in Figma. The model raises max to the content's natural width in Figma terms.
const fillText = (id, o = {}) => text(id, { w: 213, h: 37, sz: ['FILL', 'HUG'], ...o });
const row = (o, ...kids) => ({ id: 'row', t: 'F', w: 237, h: 54, sz: ['FILL', 'HUG'], lay: { d: 'H', p: [9, 12, 9, 12], g: 0, pa: 'S', ca: 'S' }, kids, ...o });

test('max width from a text: a FILL text gets ceil of its Chrome width + 1 px slack (363.625 / 363.63 -> 365), never less than before', () => {
  const { spec: out } = applyFigmaModel(root(fillText('a', { max: 363.625 }), fillText('b', { max: 363.63 }), fillText('c', { max: 286.47 }),
    fillText('d', { max: 100.5, font: font({ ls: '1px' }) }), fillText('e', { max: 120 })), defaultFontMap());
  // FIGMA_TEXT_SLACK: Figma measured a text up to 1 px wider than figmaTextBox (t8); d: ceil(100.5 - 1 px ls) + 1 = 101
  assert.deepEqual(out.kids.map((k) => k.max), [365, 365, 288, 101, 121]);
});

test('max width of a FILL bubble (s3): paddings + its text at the Figma text width + slack, 302.5 -> 304', () => {
  const { spec: out } = applyFigmaModel(root(row({ max: 302.5 }, fillText('t'))), defaultFontMap());
  assert.equal(out.kids[0].max, 304);
  assert.equal(out.kids[0].kids[0].max, undefined);
});

test('max width of a row: HUG texts at their Figma box, gaps, the one FILL text at the rest rounded up; V layout: the widest FILL child', () => {
  const r = row({ max: 200, lay: { d: 'H', p: [0, 10, 0, 10], g: 4, pa: 'S', ca: 'S' } }, text('h', { w: 40.3, h: 18 }), fillText('t'), { id: 'x', t: 'F', w: 4, h: 4, sz: ['FIXED', 'FIXED'], abs: { x: 0, y: 0, c: 'L' } });
  // Chrome: 10 + 40.3 + 4 + 135.7 + 10 = 200 -> Figma: 10 + 41 + 4 + (136 + 1 slack) + 10 = 202 (the absolute child takes no space)
  const v = { id: 'col', t: 'F', w: 100, h: 40, sz: ['FILL', 'HUG'], max: 150.2, lay: { d: 'V', p: [0, 5, 0, 5], g: 2, pa: 'S', ca: 'S' }, kids: [fillText('t2'), text('h2', { w: 60, h: 18 })] };
  const sb = { ...row({ max: 200.2 }, fillText('u'), fillText('w')) };
  const { spec: out } = applyFigmaModel(root(r, v, sb), defaultFontMap());
  assert.equal(out.kids[0].max, 202);
  assert.equal(out.kids[1].max, 152, '5 + (ceil(140.2) + 1) + 5');
  assert.equal(out.kids[2].max, 200.2, 'two FILL items: the natural split is unknown, max unchanged');
});
