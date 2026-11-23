import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { encodeScreen, planBatches, newTables } from '../core/figma-encode.mjs';
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';

const RUNTIME = readFileSync(new URL('../core/figma-runtime.js', import.meta.url), 'utf8');
const AsyncFunction = (async () => {}).constructor;
const run = (code, figma) => new AsyncFunction('figma', code)(figma);
const dataOf = (b) => { const [pre, post] = RUNTIME.split('__DATA__'); return JSON.parse(b.code.slice(pre.length, b.code.length - post.length)); };
const codeOf = (D) => RUNTIME.replace('__DATA__', () => JSON.stringify(D));

const SVG = { 'i-plus': '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></symbol>' };
const V = ['color/bg', 'color/row', 'color/ink', 'color/line', 'space/16', 'space/8', 'border/1', 'size/24', 'color/gone'];
const STYLES = ['type/t14-600', 'type/t12-400', 'shadow/s01'];
const MAP = { s0: {
  n: { bg: 'primitive.color.bg' },
  'n.0': { bg: 'primitive.color.row', paddingL: 'primitive.space.16', gap: 'primitive.space.8', borderT: 'primitive.color.line',
    'border-width-T': 'primitive.border.1', shadow: 'primitive.shadow.s01' },
  'n.0.0': { 'color|0': 'primitive.color.ink', 'type|0': 'primitive.typography.t14-600' },
  'n.0.1': { 'icon-width': 'primitive.size.24' },
  'n.1': { color: 'primitive.color.gone', type: 'primitive.typography.t12-400' },
} };

const spec = () => ({
  id: 'n', t: 'F', w: 304, h: 400, sz: ['FIXED', 'HUG'],
  lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' },
  paint: { bg: 'rgb(251, 248, 242)' },
  kids: [
    {
      id: 'n.0', t: 'F', w: 304, h: 60, sz: ['FILL', 'HUG'],
      lay: { d: 'H', p: [10, 16, 10, 16], g: 8, pa: 'S', ca: 'C' },
      paint: {
        bg: 'rgba(38, 51, 92, 0.5)', radius: ['14px', '14px', '0px', '0px'], clip: true,
        border: [1, 0, 1, 0].map((w) => ({ w, style: w ? 'solid' : 'none', color: 'rgb(220, 230, 224)' })),
        strokeOverlay: true, shadow: 'rgb(207, 221, 212) 0px 8px 0px -3px',
      },
      kids: [
        {
          id: 'n.0.0', t: 'T', w: 120, h: 18, sz: ['HUG', 'HUG'],
          font: { ff: 'Be Vietnam Pro', fs: '14px', fw: '600', fst: 'normal', lh: 18, ls: '0px', c: 'rgb(38, 51, 92)', ta: 'start', td: 'none', tt: 'none' },
          runs: [{ t: 'Mua ' }, { t: '3', s: { fw: '800', c: 'rgb(201, 104, 63)', fs: '16px' } }, { br: 1 }, { t: 'món' }],
        },
        { id: 'n.0.1', t: 'V', w: 24, h: 24, sz: ['FIXED', 'FIXED'], icon: { ref: 'i-plus', color: 'rgb(38, 51, 92)' } },
        { id: 'n.0.g0', syn: 'anchor', t: 'F', w: 0.01, h: 10, sz: ['FIXED', 'FIXED'], abs: { x: 158, y: 4, c: 'SCALE', cy: 'B' } },
      ],
    },
    {
      id: 'n.1', t: 'T', w: 304, h: 40, sz: ['FILL', 'HUG'],
      font: { ff: 'Be Vietnam Pro', fs: '12px', fw: '400', fst: 'normal', lh: null, ls: 'normal', c: 'rgb(0, 0, 0)', ta: 'start', td: 'none', tt: 'none' },
      runs: [{ t: 'Plain' }], paint: { opacity: 0.8 },
    },
    { id: 'n.2', t: 'F', w: 40, h: 40, sz: ['FIXED', 'FIXED'], abs: { x: 250, y: 300, c: 'R', cy: 'B' }, paint: { bg: 'rgb(201, 104, 63)', radius: ['20px', '20px', '20px', '20px'] } },
  ],
});

const encFor = (screen = 's0', s = spec(), tables = newTables(V)) =>
  encodeScreen(s, { screen, file: 'f.html', W: [304, 424], map: { [screen]: MAP.s0 }, svgDefs: SVG, tables });
const fakeFor = (over = {}) => makeFakeFigma({ variables: V.filter((v) => v !== 'color/gone'), textStyles: STYLES.slice(0, 2), effectStyles: [STYLES[2]], ...over });
// ---- the readback contract (Task 7 reconstructs from it) ----
// screen.nodes[i] belongs to ordOf(T)[i]: pre-order of the encoded tree, each `bd.o` node followed (after its subtree)
// by '<o>#stroke'. 0 = not in the result (see errors). Otherwise [fid, A, dB?, d?]: fid = the number after the root
// id's prefix 'P:' (a string when the prefix differs), A = [x, y, w, h] at width A, dB = B - A per value (0 / absent =
// B equals A), d = the fields whose actual value differs from the encoding.
const ordOf = (e, a = []) => { a.push(e.o); (e.k || []).forEach((k) => ordOf(k, a)); if (e.bd && e.bd.o) a.push(e.o + '#stroke'); return a; };
function decode(res, D) {
  for (const s of res.screens) {
    if (!s.nodes) continue;
    const T = D.screens.find((x) => x.screen === s.screen).T, pf = s.root.split(':')[0] + ':';
    s.N = {};
    ordOf(T).forEach((o, i) => {
      const t = s.nodes[i];
      if (!t) return;
      const [f, A, dB, d] = t;
      s.N[o] = { fid: typeof f === 'number' ? pf + f : f, A, B: dB ? A.map((v, j) => Math.round((v + dB[j]) * 100) / 100 + 0) : A, d };
    });
  }
  return res;
}
const runOne = async (fig, encs = [encFor()], D0 = {}) => {
  const [b] = planBatches(encs, { runtime: RUNTIME });
  const D = { ...dataOf(b), ...D0 };
  return decode(await run(codeOf(D), fig), D);
};
const page = (fig, name = 'Screens') => fig.root.children.find((p) => p.name === name);
const byVd = (root) => { const m = {}; const w = (n) => { const id = n.getSharedPluginData('vd', 'id'); if (id) m[id] = n; (n.children || []).forEach(w); }; w(root); return m; };
const allIds = (e, out = []) => { out.push(e.o); (e.k || []).forEach((k) => allIds(k, out)); return out; };

test('runtime source: __DATA__ once, at most 14 KB, no console / notify', () => {
  assert.equal(RUNTIME.split('__DATA__').length, 2);
  assert.ok(RUNTIME.includes('const D = __DATA__;'));
  const bytes = Buffer.byteLength(RUNTIME, 'utf8');
  assert.ok(bytes <= 14336, `runtime is ${bytes} bytes`);
  assert.ok(!/console\.|figma\.notify/.test(RUNTIME));
});

test('variables bind: padding, gap, fill, stroke and text style; result lists the bound names', async () => {
  const fig = fakeFor();
  const res = await runOne(fig);
  const [s] = res.screens;
  assert.deepEqual(s.errors, []);
  const root = fig.root.children.find((p) => p.name === 'Screens').children[0];
  const N = byVd(root);
  const vid = (name) => 'VariableID:' + V.filter((v) => v !== 'color/gone').indexOf(name);
  assert.equal(N['n.0'].boundVariables.paddingLeft.id, vid('space/16'));
  assert.equal(N['n.0'].boundVariables.itemSpacing.id, vid('space/8'));
  assert.equal(N['n.0'].fills[0].boundVariables.color.id, vid('color/row'));
  assert.equal(N.n.fills[0].boundVariables.color.id, vid('color/bg'));
  // the stroke of a strokeOverlay cell is drawn on its overlay, which carries the stroke bindings
  assert.equal(N['n.0'].strokes.length, 0);
  assert.equal(N['n.0#stroke'].strokes[0].boundVariables.color.id, vid('color/line'));
  assert.equal(N['n.0#stroke'].boundVariables.strokeTopWeight.id, vid('border/1'));
  assert.equal(N['n.0.1'].boundVariables.width.id, vid('size/24'));
  assert.equal(N['n.1'].textStyleId, 'S:t1,');
  assert.equal(N['n.0'].effectStyleId, 'S:e0,');
  // run 0 and run 3 ('Mua ', 'món') carry the text style and the bound colour, run 1 its overrides
  const segs = N['n.0.0'].getStyledTextSegments(['textStyleId', 'fills', 'fontName']);
  assert.deepEqual(segs.map((x) => [x.characters, x.textStyleId, x.fontName.style]),
    [['Mua ', 'S:t0,', 'SemiBold'], ['3', '', 'ExtraBold'], ['\n', '', 'SemiBold'], ['món', 'S:t0,', 'SemiBold']]);
  assert.equal(segs[0].fills[0].boundVariables.color.id, vid('color/ink'));
  // readback: everything was applied as encoded, so no node has a d (the diff of actual vs encoded)
  // (n.1 asks for the variable color/gone, which the file lacks: its d is tested below)
  for (const [o, r] of Object.entries(s.N)) if (o !== 'n.1') assert.equal(r.d, undefined, `${o} ${JSON.stringify(r.d)}`);
});

test('a variable missing in the file is not bound and is listed per node', async () => {
  const fig = fakeFor();
  const [s] = (await runOne(fig)).screens;
  assert.deepEqual(s.unbound, [{ o: 'n.1', prop: 'c', name: 'color/gone', reason: 'missing-in-file' }]);
  // the actual run has no variable on its fill where the encoding asked for color/gone: d.runs carries the actual runs
  assert.deepEqual(s.N['n.1'].d, { runs: [[5, 12, 'Be Vietnam Pro Regular', '#000000', 'type/t12-400', '']] });
  // a text style missing in the file
  const fig2 = fakeFor({ textStyles: ['type/t14-600'] });
  const [s2] = (await runOne(fig2)).screens;
  assert.deepEqual(s2.unbound.find((u) => u.prop === 'ts'), { o: 'n.1', prop: 'ts', name: 'type/t12-400', reason: 'missing-in-file' });
});

test('base state: frames start without fills and without clipping; encoded paint is applied on top', async () => {
  const fig = fakeFor();
  const [s] = (await runOne(fig)).screens;
  const N = byVd(page(fig).children[0]);
  assert.deepEqual(N['n.0.g0'].fills, []);
  assert.equal(N['n.0.g0'].clipsContent, false);
  assert.equal(N['n.0#stroke'].clipsContent, false);
  assert.deepEqual(N['n.0#stroke'].fills, []);
  assert.equal(N['n.0'].clipsContent, true);
  assert.equal(s.N['n.0'].d, undefined, 'fill, radius and effect style as encoded');
  assert.equal(s.N['n.0#stroke'].d, undefined, 'overlay: the cell stroke and radii, as encoded');
  assert.deepEqual(N['n.0#stroke'].strokes.map((p) => p.color), [{ r: 220 / 255, g: 230 / 255, b: 224 / 255 }]);
  assert.deepEqual([N['n.0#stroke'].strokeTopWeight, N['n.0#stroke'].strokeRightWeight], [1, 0]);
  assert.equal(N['n.0'].strokesIncludedInLayout, false);
});

test('absolute children: layoutPositioning and constraints are set after the last appendChild', async () => {
  const fig = fakeFor();
  await runOne(fig);
  const N = byVd(page(fig).children[0]);
  const log = fig._log;
  const lastAppend = log.map((x) => x[0]).lastIndexOf('append');
  for (const o of ['n.0.g0', 'n.2', 'n.0#stroke']) {
    const id = N[o].id;
    const lp = log.findIndex((x) => x[0] === 'layoutPositioning' && x[1] === id && x[2] === 'ABSOLUTE');
    const c = log.findIndex((x) => x[0] === 'constraints' && x[1] === id);
    assert.ok(lp > lastAppend, `${o} layoutPositioning after the last append`);
    assert.ok(c > lastAppend, `${o} constraints after the last append`);
  }
  assert.deepEqual(N['n.0.g0'].constraints, { horizontal: 'SCALE', vertical: 'MAX' });
  assert.deepEqual(N['n.2'].constraints, { horizontal: 'MAX', vertical: 'MAX' });
  assert.deepEqual(N['n.0#stroke'].constraints, { horizontal: 'STRETCH', vertical: 'STRETCH' });
  assert.deepEqual([N['n.2'].x, N['n.2'].y], [250, 300]);
  assert.deepEqual([N['n.0#stroke'].x, N['n.0#stroke'].y, N['n.0#stroke'].width, N['n.0#stroke'].height], [0, 0, 304, 60]);
  // the overlay is the last child of its cell
  assert.equal(N['n.0'].children.at(-1), N['n.0#stroke']);
});

test('every built node has vd/id; the root has vd/screen, vd/file and vd/sig; every encoded node is in nodes', async () => {
  const fig = fakeFor();
  const enc = encFor();
  const res = await runOne(fig, [enc]);
  const [s] = res.screens;
  const root = page(fig).children[0];
  assert.equal(res.batch, 1);
  assert.equal(res.page, 'Screens');
  assert.equal(root.name, 's0');
  assert.equal(root.getSharedPluginData('vd', 'screen'), 's0');
  assert.equal(root.getSharedPluginData('vd', 'file'), 'f.html');
  assert.match(root.getSharedPluginData('vd', 'sig'), /^[0-9a-f]{8}$/);
  assert.equal(s.sig, root.getSharedPluginData('vd', 'sig'));
  assert.equal(s.root, root.id);
  const w = (n) => { if (n.type !== 'VECTOR') assert.ok(n.getSharedPluginData('vd', 'id'), `${n.type} ${n.name} has vd/id`); (n.children || []).forEach(w); };
  w(root);
  assert.deepEqual(Object.keys(s.N).sort(), [...allIds(enc.T), 'n.0#stroke'].sort());
  for (const [o, r] of Object.entries(s.N)) {
    assert.ok(r.fid && r.A.length === 4 && r.B.length === 4, o);
    assert.equal(byVd(root)[o].id, r.fid);
  }
  assert.deepEqual(s.fontMissing, []);
  assert.equal(fig._pageSets, 1, 'setCurrentPageAsync once');
  assert.equal(fig._loads['Be Vietnam Pro|SemiBold'], 1, 'each font is loaded once');
});

test('readback: B is read at width B, the root goes back to width A and keeps its vertical HUG', async () => {
  const fig = fakeFor();
  const [s] = (await runOne(fig)).screens;
  assert.deepEqual(s.N.n.A, [0, 0, 304, 400]);
  assert.deepEqual(s.N.n.B.slice(0, 3), [0, 0, 424]);
  const root = page(fig).children[0];
  assert.equal(root.width, 304);
  assert.equal(root.layoutSizingVertical, 'HUG');
  assert.deepEqual(s.N['n.2'].A, [250, 300, 40, 40]);
  assert.equal(s.N['n.0.0'].d, undefined, 'characters and runs as encoded');
  assert.equal(root.children[0].children[0].characters, 'Mua 3\nmón');
});

test('missing font is reported: the nearest weight of the family is used and the node is still built', async () => {
  const fig = fakeFor({ fonts: DEFAULT_FONTS.filter((f) => f !== 'Be Vietnam Pro|SemiBold') });
  const [s] = (await runOne(fig)).screens;
  assert.deepEqual(s.errors, []);
  assert.ok(s.N['n.0.0'], 'node built');
  const m = s.fontMissing.find((x) => x.o === 'n.0.0');
  assert.equal(m.family, 'Be Vietnam Pro');
  assert.equal(m.style, 'SemiBold');
  assert.match(m.used, /^Be Vietnam Pro (Medium|Bold)$/);
  assert.equal(s.fontMissing.filter((x) => x.o === 'n.0.0').length, 1);
  // a family that is missing altogether falls back to Inter, also reported
  const fig2 = fakeFor({ fonts: DEFAULT_FONTS.filter((f) => !f.startsWith('Be Vietnam Pro')) });
  const [s2] = (await runOne(fig2)).screens;
  assert.deepEqual(s2.errors, []);
  assert.deepEqual(s2.fontMissing.find((x) => x.o === 'n.1'), { o: 'n.1', family: 'Be Vietnam Pro', style: 'Regular', used: 'Inter Regular' });
});

test('rerun replaces: running the batch twice leaves one frame per screen, at the same place', async () => {
  const fig = fakeFor();
  const tables = newTables(V);
  const encs = [encFor('s0', spec(), tables), encFor('s1', spec(), tables)];
  const r1 = await runOne(fig, encs);
  const xs = page(fig).children.map((c) => c.x);
  assert.deepEqual(xs, [0, 304 + 80], 'screens in a row, 80 px apart');
  const r2 = await runOne(fig, encs);
  assert.equal(page(fig).children.length, 2);
  assert.deepEqual(page(fig).children.map((c) => c.x).sort((a, b) => a - b), xs);
  assert.equal(r2.screens[0].edited, undefined);
  assert.equal(r2.screens[0].sig, r1.screens[0].sig, 'same content, same signature');
  assert.equal(fig.root.children.filter((p) => p.name === 'Screens').length, 1);
});

test('a new screen goes right of the existing page content', async () => {
  const fig = fakeFor();
  const p = fig.createPage(); p.name = 'Screens';
  await fig.setCurrentPageAsync(p);
  const other = fig.createFrame(); other.x = 100; other.resize(500, 50);
  fig._pageSets = 0;
  await runOne(fig);
  const root = p.children.find((c) => c.getSharedPluginData('vd', 'screen') === 's0');
  assert.deepEqual([root.x, root.y], [680, 0]);
});

test('edited frame is kept: a hand edit changes the signature, the rerun keeps the frame and reports edited', async () => {
  const fig = fakeFor();
  await runOne(fig);
  const root = page(fig).children[0];
  const N = byVd(root);
  N['n.1'].characters = 'Edited by hand';
  const r2 = await runOne(fig);
  assert.equal(r2.screens[0].edited, true);
  assert.equal(r2.screens[0].root, root.id);
  assert.equal(page(fig).children.length, 1);
  assert.equal(page(fig).children[0], root);
  assert.equal(byVd(root)['n.1'].characters, 'Edited by hand');
  assert.equal(r2.screens[0].nodes, undefined);
  // force rebuilds it
  const r3 = await runOne(fig, [encFor()], { force: ['s0'] });
  assert.equal(r3.screens[0].edited, undefined);
  assert.equal(page(fig).children.length, 1);
  assert.notEqual(page(fig).children[0], root);
  assert.equal(byVd(page(fig).children[0])['n.1'].characters, 'Plain');
});

test('a frame without a signature (interrupted run) is replaced, not kept', async () => {
  const fig = fakeFor();
  await runOne(fig);
  page(fig).children[0].setSharedPluginData('vd', 'sig', '');
  const r2 = await runOne(fig);
  assert.equal(r2.screens[0].edited, undefined);
  assert.equal(page(fig).children.length, 1);
});

test('an error in one node is reported; the node and its children are missing, the other nodes are built', async () => {
  const fig = fakeFor({ throwIf: (op, n) => op === 'resize' && n.getSharedPluginData('vd', 'id') === 'n.0' });
  const [s] = (await runOne(fig)).screens;
  assert.deepEqual(s.errors.map((e) => e.o), ['n.0', 'n.0.0', 'n.0.1', 'n.0.g0']);
  assert.match(s.errors[0].msg, /fake failure/);
  assert.equal(s.errors[1].msg, 'parent failed');
  for (const o of ['n.0', 'n.0.0', 'n.0.1', 'n.0.g0', 'n.0#stroke']) assert.equal(s.N[o], undefined, o);
  for (const o of ['n', 'n.1', 'n.2']) assert.ok(s.N[o], o);
  assert.equal(byVd(page(fig).children[0])['n.0'], undefined, 'the half-built node is removed');
  // a broken svg is a node error too
  const sp = spec();
  const fig2 = fakeFor();
  const enc = encodeScreen(sp, { screen: 's0', file: 'f.html', W: [304, 424], map: {}, svgDefs: { 'i-plus': '<symbol id="i-plus" viewBox="0 0 24 24"><invalid></symbol>' }, tables: newTables(V) });
  const [s2] = (await runOne(fig2, [enc])).screens;
  assert.deepEqual(s2.errors.map((e) => e.o), ['n.0.1']);
  assert.ok(s2.N['n.0.0'] && s2.N['n.0.g0']);
});

test('raw values the format cannot carry come back as unsupported on the node', async () => {
  const sp = spec();
  sp.kids[2].paint.unsupported = [{ prop: 'mask-image', value: 'url(m.svg)' }];
  sp.kids.push({ id: 'n.3', t: 'I', w: 80, h: 40, sz: ['FIXED', 'FIXED'], src: 'https://example.com/a.png', fit: 'cover' });
  sp.kids.push({ id: 'n.4', t: 'I', w: 80, h: 40, sz: ['FIXED', 'FIXED'], src: 'data:image/png;base64,AAAA', fit: 'contain' });
  const fig = fakeFor();
  const [s] = (await runOne(fig, [encFor('s0', sp)])).screens;
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.unsupported['n.2'], { unsupported: [{ prop: 'mask-image', value: 'url(m.svg)' }] });
  assert.deepEqual(s.unsupported['n.3'], { im: 'https://example.com/a.png' });
  assert.equal(s.unsupported['n.4'], undefined);
  assert.equal(byVd(page(fig).children[0])['n.4'].fills[0].scaleMode, 'FIT');
});

test('glyph icons, gradients and transforms build without errors', async () => {
  const sp = spec();
  sp.kids.push({ id: 'n.5', t: 'V', w: 20, h: 20, sz: ['FIXED', 'FIXED'], icon: { glyph: 'add' },
    font: { ff: 'Inter', fs: '20px', fw: '400', fst: 'normal', lh: 20, ls: '0px', c: 'rgb(0, 0, 0)', ta: 'start', td: 'none', tt: 'none' } });
  sp.kids.push({ id: 'n.6', t: 'F', w: 100, h: 50, sz: ['FIXED', 'FIXED'], paint: { bgImage: 'linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%), radial-gradient(circle at 50% 30%, rgb(1, 2, 3) 0%, rgb(4, 5, 6) 70%)' } });
  sp.kids[0].kids[2].paint = { transform: { value: 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)', origin: '0px 0px' } };
  const enc = encFor('s0', sp);
  const fig = fakeFor();
  const [s] = (await runOne(fig, [enc])).screens;
  assert.deepEqual(s.errors, []);
  const N = byVd(page(fig).children[0]);
  const g = N['n.6'].fills;
  // CSS lists the top layer first; Figma fills go bottom first
  assert.deepEqual(g.map((p) => p.type), ['GRADIENT_RADIAL', 'GRADIENT_LINEAR']);
  const ap = (m, x, y) => [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]].map((v) => Math.round(v * 1e4) / 1e4 + 0);
  // linear 90deg: node (0, .5) -> gradient (0, .5); node (1, .5) -> gradient (1, .5); 
  assert.deepEqual(ap(g[1].gradientTransform, 0, 0.5), [0, 0.5]);
  assert.deepEqual(ap(g[1].gradientTransform, 1, 0.5), [1, 0.5]);
  // the normal has the line's length in px (100 px here = 2 heights of 50 px): top middle sits a quarter off the line
  assert.deepEqual(ap(g[1].gradientTransform, 0.5, 0), [0.5, 0.25]);
  // radial circle at 50% 30% of a 100 x 50 box: the centre maps to the gradient centre (.5, .5)
  assert.deepEqual(ap(g[0].gradientTransform, 0.5, 0.3), [0.5, 0.5]);
  assert.deepEqual(N['n.0.g0'].relativeTransform, [[0.707107, -0.707107, 158], [0.707107, 0.707107, 4]]);
  assert.equal(N['n.5'].characters, 'add');
  assert.equal(N['n.5'].textAutoResize, 'NONE');
  for (const o of ['n.5', 'n.6', 'n.0.g0']) assert.equal(s.N[o].d, undefined, o);
});

test('readback diff: a setting the API silently ignores appears in d with the actual value', async () => {
  const fig = fakeFor({ ignore: ['opacity', 'characters', 'topLeftRadius'] });
  const [s] = (await runOne(fig)).screens;
  // the runs of n.0.0 cannot be styled on an empty text: that node fails, the others are built
  assert.deepEqual(s.errors.map((e) => e.o), ['n.0.0']);
  assert.equal(s.N['n.1'].d.op, 1, 'opacity 0.8 was dropped: d.op is the actual 1');
  assert.equal(s.N['n.1'].d.text, '', 'characters were dropped');
  assert.deepEqual(s.N['n.1'].d.runs, [], 'no characters, no runs');
  assert.deepEqual(s.N['n.0'].d, { radius: [0, 14, 0, 0] }, 'only the dropped corner differs');
  assert.deepEqual(s.N['n.2'].d, { radius: [0, 20, 20, 20] });
  assert.equal(s.N['n.0.g0'].d, undefined);
});

test('readback diff: ignored fills show the actual paint, and the lost fill binding shows in vars', async () => {
  const fig = fakeFor({ ignore: ['fills'] });
  const [s] = (await runOne(fig)).screens;
  // createFrame starts white: a frame meant to have no fill, or a bound fill, reports the white it kept
  assert.deepEqual(s.N['n.0.g0'].d, { fills: ['#ffffff'] });
  assert.deepEqual(s.N['n.0'].d, { fills: ['#ffffff'], vars: { paddingLeft: 'space/16', itemSpacing: 'space/8' } });
  assert.deepEqual(s.N['n.0#stroke'].d, { fills: ['#ffffff'] });
});

test('compact nodes: one entry per node in the fixed order, numeric fids, B as a delta, 0 for a failed node', async () => {
  const fig = fakeFor({ throwIf: (op, n) => op === 'resize' && n.getSharedPluginData('vd', 'id') === 'n.2' });
  const enc = encFor();
  const [s] = (await runOne(fig, [enc])).screens;
  const order = ordOf(enc.T);
  assert.deepEqual(order, ['n', 'n.0', 'n.0.0', 'n.0.1', 'n.0.g0', 'n.0#stroke', 'n.1', 'n.2']);
  assert.equal(s.nodes.length, order.length);
  assert.equal(s.nodes[7], 0, 'n.2 failed');
  assert.deepEqual(s.nodes[0], [+s.root.split(':')[1], [0, 0, 304, 400], [0, 0, 120, 0]], 'root: B is 120 px wider');
  assert.deepEqual(s.nodes[2].length, 2, 'n.0.0: same box at B, nothing differs: [fid, A]');
  assert.equal(typeof s.nodes[2][0], 'number');
  assert.equal(s.N['n.0.0'].fid, byVd(page(fig).children[0])['n.0.0'].id);
  // a d with B equal to A: the dB slot is 0
  const fig2 = fakeFor({ ignore: ['opacity'] });
  const [s2] = (await runOne(fig2)).screens;
  assert.equal(s2.nodes[6].length, 4, 'n.1: [fid, A, 0, d]');
  assert.equal(s2.nodes[6][2], 0);
  assert.equal(s2.nodes[6][3].op, 1);
});

// ---- smoke: one real Planora batch on the fake ----
const planora = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/figma-encode-planora.json.gz', import.meta.url))).toString('utf8'));

test('Planora: the first batch builds on the fake with no errors and every encoded node comes back', async (t) => {
  const tables = newTables(planora.V);
  const encs = planora.screens.map((s) => encodeScreen(s.spec, { screen: s.id, file: planora.file, W: s.W, map: planora.map, svgDefs: s.svgDefs, tables, tokens: planora.tokens }));
  const batches = planBatches(encs, { runtime: RUNTIME });
  for (const b of batches) assert.ok(b.bytes <= 50000, `batch ${b.n} ${b.bytes} B`);
  const D = dataOf(batches[0]);
  const fig = makeFakeFigma({ idPrefix: '2077', idStart: 31000, variables: D.V, textStyles: D.S.filter((x) => x.startsWith('type/')), effectStyles: D.S.filter((x) => x.startsWith('shadow/')),
    fonts: [...DEFAULT_FONTS, 'Be Vietnam Pro|Light'] });
  const res = decode(await run(batches[0].code, fig), D);
  assert.equal(res.screens.length, D.screens.length);
  for (const [i, s] of res.screens.entries()) {
    assert.deepEqual(s.errors, [], s.screen);
    assert.deepEqual(s.fontMissing, [], s.screen);
    assert.equal(s.unbound, undefined, `${s.screen} ${JSON.stringify(s.unbound)}`);
    const ids = allIds(D.screens[i].T);
    for (const o of ids) assert.ok(s.N[o], `${s.screen} ${o}`);
    for (const [o, r] of Object.entries(s.N)) {
      assert.equal(r.d, undefined, `${s.screen} ${o}: the fake applies everything, so actual = encoded (${JSON.stringify(r.d)})`);
    }
  }
  for (const s of res.screens) delete s.N;
  const bytes = Buffer.byteLength(JSON.stringify(res));
  assert.ok(bytes <= 15000, `batch 1 result ${bytes} B`);
  // the fake does no layout, so B = A; worst case on real Figma: every node also carries a dB as long as its A
  const worst = bytes + res.screens.reduce((m, s) => m + s.nodes.reduce((k, t) => k + (t && t.length === 2 ? JSON.stringify(t[1]).length + 1 : 0), 0), 0);
  t.diagnostic(`batch 1 result: ${bytes} B; with a dB on every node (upper bound for real Figma): ${worst} B`);
  t.diagnostic(`Planora: ${batches.length} batches (${batches.map((b) => b.bytes).join(' / ')} B); batch 1 result ${bytes} B for ${res.screens.length} screens`);
});
