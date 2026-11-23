import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordOf, decode, actualNodes, figmaDom, figmaProxy, rgbOf, splitFont, styleWeight, pngSize, proxyVsFigma, effectNodes } from '../core/figma-check.mjs';
import { renderFigma } from '../core/report-html.mjs';
import { chooseFig, mutateFig, FIG_KINDS } from '../core/mutate.mjs';
import { gate } from '../core/pipeline.mjs';

// a batch's data D (figma-encode.mjs format) and a BatchResult screen (figma-runtime.js readback contract), by hand
const T = () => ({
  o: 'n', w: 304, h: 400, bg: 0, l: { d: 'V' },
  k: [
    {
      o: 'n.0', w: 304, h: 60, bg: 1, rd: [14, 14, 0, 0], bd: { w: [1, 0, 1, 0], c: 2, o: 1 },
      k: [
        { o: 'n.0.0', t: 'T', w: 120, h: 18, tx: 'Mua 3\nmón', f: 0, fs: 14, c: 4, rn: [4, [1, { f: 1, fs: 16, c: 3 }], 1, 3] },
        { o: 'n.0.1', t: 'V', w: 24, h: 24, ic: { i: 0, c: 4 } },
      ],
    },
    { o: 'n.2', w: 40, h: 40, bg: 3, rd: 20, op: 0.5, a: [250, 300, 'R', 'B'] },
  ],
});
const Dof = () => ({
  batch: 1, C: ['#fbf8f2', '#26335c80', '#dce6e0', '#c9683f', '#26335c'], F: [['Be Vietnam Pro', 600], ['Be Vietnam Pro', 800]],
  I: [['0 0 24 24', '<path d="M12 5v14"></path>']], V: [], S: [], M: [], screens: [{ screen: 's0', file: 'f.html', W: [304, 424], T: T() }],
});
const screenRes = () => ({
  screen: 's0', root: '7:1', sig: '0badc0de', fontMissing: [], errors: [],
  nodes: [
    [1, [0, 0, 304, 400], [0, 0, 120, 0]],
    [2, [0, 0, 304, 60], [0, 0, 120, 0]],
    [3, [16, 10, 120, 18]],
    ['9:4', [150, 18, 24, 24], [120, 0, 0, 0]],
    [5, [0, 0, 304, 60], [0, 0, 120, 0]],
    [6, [250, 300, 40, 40], [120, 0, 0, 0], { radius: [0, 20, 20, 20] }],
  ],
});
const SPEC = {
  id: 'n', t: 'F', kids: [
    { id: 'n.0', t: 'F', paint: { radius: ['14px', '14px', '0px', '0px'] }, kids: [{ id: 'n.0.0', t: 'T' }, { id: 'n.0.1', t: 'V', icon: { ref: 'i-plus' } }] },
    { id: 'n.2', t: 'F', paint: { radius: ['20px', '20px', '20px', '20px'] } },
  ],
};
const TREE = { id: 'n', kids: [{ id: 'n.0', kids: [{ id: 'n.0.0' }, { id: 'n.0.1' }] }, { id: 'n.2' }] };
const dec = (s = screenRes(), D = Dof()) => decode({ screens: [s] }, D).screens[0];

test('ordOf and decode: readback order, fid prefix, B = A + dB', () => {
  assert.deepEqual(ordOf(T()), ['n', 'n.0', 'n.0.0', 'n.0.1', 'n.0#stroke', 'n.2']);
  const s = dec();
  assert.equal(s.N.n.fid, '7:1');
  assert.equal(s.N['n.0.1'].fid, '9:4', 'a string fid is the full id');
  assert.deepEqual(s.N.n.B, [0, 0, 424, 400]);
  assert.deepEqual(s.N['n.0.0'].B, [16, 10, 120, 18], 'no dB: B equals A');
  assert.deepEqual(s.N['n.2'].B, [370, 300, 40, 40]);
});

test('actualNodes: the encoded intent unless d says otherwise', () => {
  const act = actualNodes(dec(), Dof());
  const t = act.get('n.0.0');
  assert.equal(t.text, 'Mua 3\nmón');
  // runs 2 and 3 have no override: merged
  assert.deepEqual(t.runs.map((r) => [r.len, r.fs, r.family, r.weight, r.italic, r.fill]),
    [[4, 14, 'Be Vietnam Pro', 600, false, '#26335c'], [1, 16, 'Be Vietnam Pro', 800, false, '#c9683f'], [4, 14, 'Be Vietnam Pro', 600, false, '#26335c']]);
  assert.deepEqual(act.get('n.0').fills, ['#26335c80']);
  assert.equal(act.get('n.0').strokes, null, 'a bd.o cell has no stroke of its own');
  assert.deepEqual(act.get('n.0#stroke').strokes, { c: ['#dce6e0'], w: [1, 0, 1, 0] });
  assert.deepEqual(act.get('n.0#stroke').radius, [14, 14, 0, 0], 'the overlay takes the cell radii');
  assert.deepEqual(act.get('n.2').radius, [0, 20, 20, 20], 'd.radius is the actual value');
  assert.equal(act.get('n.2').op, 0.5);
  // d.runs (Figma used another face) and d.text replace the intent
  const s = screenRes();
  s.nodes[2] = [3, [16, 10, 120, 18], 0, { text: 'Mua 3', runs: [[4, 14, 'Be Vietnam Pro Medium', '#26335c', '', ''], [1, 16, 'Inter Bold Italic', '#c9683f', 'type/x', 'color/a']] }];
  const t2 = actualNodes(dec(s), Dof()).get('n.0.0');
  assert.equal(t2.text, 'Mua 3');
  assert.deepEqual(t2.runs.map((r) => [r.len, r.family, r.weight, r.italic, r.ts, r.fv]), [[4, 'Be Vietnam Pro', 500, false, '', ''], [1, 'Inter', 700, true, 'type/x', 'color/a']]);
});

test('figmaDom: a text node with two styles gives runs in the proxy DOM shape', () => {
  const act = actualNodes(dec(), Dof());
  const d = figmaDom(act.get('n.0.0'), { opEff: 1, spec: SPEC.kids[0].kids[0] });
  assert.equal(d.text, 'Mua 3 món', '<br> / \\n read as a space, as the proxy DOM');
  assert.equal(d.color, 'rgb(38, 51, 92)');
  assert.equal(d.ff, 'Be Vietnam Pro');
  assert.equal(d.bg, 'transparent');
  // [text, font-size, font-weight, font-style, text-decoration, text-transform, font-family, colour]; decoration and case
  // are not read back: undefined (verify does not compare them)
  assert.deepEqual(d.runs, [
    ['Mua ', '14px', '600', 'normal', undefined, undefined, 'Be Vietnam Pro', 'rgb(38, 51, 92)'],
    ['3', '16px', '800', 'normal', undefined, undefined, 'Be Vietnam Pro', 'rgb(201, 104, 63)'],
    ['\nmón', '14px', '600', 'normal', undefined, undefined, 'Be Vietnam Pro', 'rgb(38, 51, 92)'],
  ]);
  assert.deepEqual([d.op, d.vis, d.disp, d.outline], [1, 'visible', 'flex', 'none']);
});

test('figmaDom: frames, overlay strokes, radius units, icons; unknowns stay undefined', () => {
  const act = actualNodes(dec(), Dof());
  const cell = figmaDom(act.get('n.0'), { opEff: 1, spec: SPEC.kids[0], overlay: act.get('n.0#stroke') });
  assert.equal(cell.bg, 'rgba(38, 51, 92, 0.5)', 'alpha 0x80 is the shortest decimal 0.5');
  assert.deepEqual(cell.stroke, ['1px solid rgb(220, 230, 224)', 'none', '1px solid rgb(220, 230, 224)', 'none']);
  assert.deepEqual(cell.radius, ['14px', '14px', '0px', '0px']);
  assert.equal(cell.shadow, undefined);
  assert.equal(cell.bgImage, undefined);
  // the overlay is not in the readback: the cell's stroke is unknown, not 'none'
  assert.equal(figmaDom(act.get('n.0'), { opEff: 1, spec: SPEC.kids[0], overlay: null }).stroke, undefined);
  const sq = figmaDom(act.get('n.2'), { opEff: 0.5, spec: SPEC.kids[1] });
  assert.deepEqual(sq.radius, ['0px', '20px', '20px', '20px'], 'an actual radius that differs from the intent, in px');
  assert.equal(sq.op, 0.5);
  // I1: which sprite icon a vector frame shows is not read back: no icon value is copied from the spec
  const ic = figmaDom(act.get('n.0.1'), { opEff: 1, spec: SPEC.kids[0].kids[1] });
  assert.equal(ic.icon, undefined);
  assert.equal(ic.iconUnread, true);
  assert.equal(figmaDom(act.get('n.0.1'), { opEff: 1, spec: { id: 'n.0.1', icon: { svg: '<svg/>' } } }).icon, 'svg', 'an inline svg: drawn as svg (markup unread)');
  const s = screenRes();
  s.nodes[3] = ['9:4', [150, 18, 24, 24], 0, { icon: 0 }];
  const empty = figmaDom(actualNodes(dec(s), Dof()).get('n.0.1'), { opEff: 1, spec: SPEC.kids[0].kids[1] });
  assert.deepEqual([empty.icon, empty.iconUnread], [undefined, undefined], 'an icon without vectors draws nothing: a real finding, not unread');
});

test('figmaProxy: boxes and DOM per vd id, effective opacity, unread checks, fonts; a node not read back is absent', () => {
  const s = screenRes();
  s.fontMissing = [{ o: 'n.0.0', family: 'Be Vietnam Pro', style: 'SemiBold', used: 'Be Vietnam Pro Medium' }, { o: 'n.0.0', family: 'Georgia', style: 'Regular', used: 'Inter Regular' }];
  const p = figmaProxy(dec(s), Dof(), SPEC, { png: Buffer.from('png') });
  assert.deepEqual([p.A.model, p.A.mark, p.B.mark], ['figma', 'figma-real', 'figma-real']);
  assert.deepEqual(p.A.boxes['n.2'], [250, 300, 40, 40]);
  assert.deepEqual(p.B.boxes['n.2'], [370, 300, 40, 40]);
  assert.ok(p.A.boxes['n.0#stroke']);
  assert.equal(p.B.png, null, 'no screenshot at width B');
  assert.deepEqual(p.unread, ['crop-B', 'effect', 'text-decoration', 'text-transform', 'icon']);
  assert.deepEqual(p.A.fontsMissing, ['Georgia']);
  assert.deepEqual(p.A.facesMissing, ['Be Vietnam Pro|0|600']);
  // a parent with opacity 0.5 halves its children's effective opacity
  const D = Dof();
  D.screens[0].T.k[0].op = 0.5;
  assert.equal(figmaProxy(dec(screenRes(), D), D, SPEC).A.dom['n.0.0'].op, 0.5);
  // node n.0 not read back: no box, no DOM; its children's effective opacity is unknown
  const s2 = screenRes();
  s2.nodes[1] = 0;
  const p2 = figmaProxy(dec(s2), Dof(), SPEC);
  assert.equal(p2.A.boxes['n.0'], undefined);
  assert.equal(p2.A.dom['n.0.0'].op, undefined);
  // inline svg, image fill and dashed stroke add unread checks
  const D3 = Dof();
  D3.screens[0].T.k[0].bd.d = 'dashed';
  D3.screens[0].T.k[1].im = { m: 0 }; D3.M = ['data:image/png;base64,AAAA'];
  const p3 = figmaProxy(dec(screenRes(), D3), D3, { ...SPEC, kids: [{ ...SPEC.kids[0], kids: [SPEC.kids[0].kids[0], { id: 'n.0.1', t: 'V', icon: { svg: '<svg/>' } }] }, SPEC.kids[1]] });
  assert.deepEqual(p3.unread.slice(4).sort(), ['image', 'stroke-style', 'svg']);
  assert.equal(figmaProxy(dec(screenRes()), Dof(), { ...SPEC, kids: [{ ...SPEC.kids[0], kids: [SPEC.kids[0].kids[0], { id: 'n.0.1', t: 'V' }] }, SPEC.kids[1]] }).unread.includes('icon'), false);
  assert.ok(p3.A.dom['n.0'].stroke[0].includes('dashed'));
  // no readback at all: empty boxes (verify counts every node unchecked)
  assert.deepEqual(figmaProxy(null, null, SPEC).A.boxes, {});
});

test('colours, fonts, png size, proxy vs Figma', () => {
  assert.equal(rgbOf('#26335c'), 'rgb(38, 51, 92)');
  assert.equal(rgbOf('#26335c20'), 'rgba(38, 51, 92, 0.125)', '0x20: 0.13 would encode to 0x21, so 0.125');
  assert.equal(rgbOf('#26335c00'), 'transparent');
  assert.equal(rgbOf('GRADIENT_LINEAR'), 'GRADIENT_LINEAR');
  assert.deepEqual(splitFont('Be Vietnam Pro SemiBold', ['Be Vietnam Pro']), ['Be Vietnam Pro', 'SemiBold']);
  assert.deepEqual(splitFont('Open Sans Bold Italic'), ['Open Sans', 'Bold Italic']);
  assert.deepEqual(styleWeight('Semi Bold'), [600, false]);
  assert.deepEqual(styleWeight('Italic'), [400, true]);
  assert.deepEqual(styleWeight('Condensed Bold'), [null, false]);
  const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47, 0); png.write('IHDR', 12, 'ascii'); png.writeUInt32BE(608, 16); png.writeUInt32BE(800, 20);
  assert.deepEqual(pngSize(png), [608, 800]);
  assert.throws(() => pngSize(Buffer.from('nope')), /not a PNG/);
  const ref = { A: { boxes: { a: [0, 0, 10, 10], b: [5, 5, 10, 10] } }, B: { boxes: { a: [0, 0, 20, 10] } } };
  const fig = { A: { boxes: { a: [0, 0, 10, 10], b: [5, 6.5, 10, 9] } }, B: { boxes: { a: [0, 0, 20, 10] } } };
  const pv = proxyVsFigma(ref, fig, ['a', 'b']);
  assert.deepEqual(pv.A, { compared: 2, max: 1.5, worst: [{ id: 'b', delta: [0, 1.5, 0, -1], max: 1.5 }] });
  assert.deepEqual(pv.B, { compared: 1, max: 0, worst: [] });
});

test('readback mutations: deterministic targets and the planted change', () => {
  const D = Dof(), s = screenRes();
  assert.deepEqual(FIG_KINDS.map((k) => chooseFig(k, s, D, TREE)), ['n.0.0', 'n.0.0', 'n.0', 'n.2']);
  const mv = mutateFig('figMove', s, D, 'n.0.0');
  assert.deepEqual(mv.nodes[2], [3, [19, 10, 120, 18]]);
  assert.deepEqual(s.nodes[2], [3, [16, 10, 120, 18]], 'the input is not changed');
  assert.deepEqual(mutateFig('figText', s, D, 'n.0.0').nodes[2][3], { text: 'xua 3\nmón' });
  assert.deepEqual(mutateFig('figFill', s, D, 'n.0').nodes[1][3], { fills: ['#d9cca380'] });
  assert.equal(mutateFig('figDrop', s, D, 'n.2').nodes[5], 0);
  // the planted change reaches the DOM / boxes
  assert.equal(figmaProxy(dec(mutateFig('figFill', s, D, 'n.0')), D, SPEC).A.dom['n.0'].bg, 'rgba(217, 204, 163, 0.5)');
});

test('gate: skipped figma-* checks (readback limits) never fail a screen; other skipped layers do', () => {
  const rep = (skipped) => ({ unchecked: [], skipped, data: [], roots: [], needsApproval: [], crop: [], cropLinked: [] });
  assert.equal(gate(rep(['figma-crop-B', 'figma-effect'])).pass, true);
  assert.equal(gate(rep(['figma-crop-B', 'crop'])).pass, false);
});

test('effects the readback cannot see are listed per node for the report (I2)', () => {
  const tree = { id: 'n', paint: { shadow: 'none', bgImage: 'none' }, kids: [
    { id: 'n.0', paint: { shadow: 'rgb(0, 0, 0) 0px 2px 4px 0px' } },
    { id: 'n.1', paint: { bgImage: 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))' }, kids: [{ id: 'n.1.0', paint: {} }] },
  ] };
  const ns = effectNodes(tree);
  assert.deepEqual(ns, [{ id: 'n.0', what: ['box-shadow rgb(0, 0, 0) 0px 2px 4px 0px'] }, { id: 'n.1', what: ['background-image linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))'] }]);
  const f = { status: 'done', root: '1:2', batch: 'batch-01', role: 'modelled', readback: { nodes: 4, missing: 0 }, shot: null, unread: ['effect'],
    proxyVsFigma: null, effectsNotRead: { count: ns.length, nodes: ns }, fontMissing: [], unbound: [], errors: [], unsupported: [] };
  const html = renderFigma({ figma: f });
  assert.match(html, /2 nodes have effects not read back on Figma — compare the crop \/ screenshot by eye/);
  assert.match(html, /<code>n\.0<\/code> box-shadow rgb\(0, 0, 0\)/);
  assert.doesNotMatch(renderFigma({ figma: { ...f, effectsNotRead: { count: 0, nodes: [] } } }), /not read back on Figma/);
});
