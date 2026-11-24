import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { encodeScreen, planBatches, newTables, OversizeError, figmaVarName } from '../core/figma-encode.mjs';

const RUNTIME = `/* stub runtime ${'x'.repeat(8000)} */\nconst D = __DATA__;\nreturn D.screens.length;\n`;
const SVG = { 'i-plus': '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></symbol>' };

// Data of a batch: the JSON that replaced __DATA__ in its code.
const dataOf = (b) => {
  const [pre, post] = RUNTIME.split('__DATA__');
  assert.ok(b.code.startsWith(pre) && b.code.endsWith(post));
  return JSON.parse(b.code.slice(pre.length, b.code.length - post.length));
};

// ---- test-only decoder: batch data -> canonical SNode-like trees (the reading Task 5's runtime must implement) ----
const SZ = { F: 'FILL', H: 'HUG', X: 'FIXED' };
function decodeForTest(D) {
  const col = (i) => (i === -1 ? 'none' : D.C[i]);
  const font = (i) => { const [ff, fw, it] = D.F[i]; return { ff, fw, it: !!it }; };
  const binds = (v) => Object.fromEntries(Object.entries(v).map(([k, i]) => [k, D.V[i]]));
  const node = (e) => {
    const n = { id: e.o, t: e.t || 'F', w: e.w, h: e.h, sz: [...(e.s || 'XX')].map((c) => SZ[c]) };
    if (e.y) n.syn = e.y;
    if (e.mn !== undefined) n.min = e.mn;
    if (e.mx !== undefined) n.max = e.mx;
    if (e.l) {
      const l = e.l;
      n.lay = { d: l.d, p: l.p || [0, 0, 0, 0], g: l.g || 0, pa: l.pa || 'S', ca: l.ca || 'S' };
      if (l.sb) n.lay.sb = true;
      if (l.wr) { n.lay.wrap = true; n.lay.cg = l.cg || 0; }
    }
    if (e.a) n.abs = { x: e.a[0], y: e.a[1], c: e.a[2] || 'L', cy: e.a[3] || 'T' };
    const p = {};
    if (e.bg !== undefined) p.bg = col(e.bg);
    if (e.gr) p.gr = e.gr.map((g) => ({ k: g.k, p: g.p, s: g.s.map(([pos, c]) => [pos, col(c)]) }));
    if (e.rd !== undefined) p.radius = typeof e.rd === 'number' ? [e.rd, e.rd, e.rd, e.rd] : e.rd;
    if (e.bd) p.border = { w: typeof e.bd.w === 'number' ? [e.bd.w, e.bd.w, e.bd.w, e.bd.w] : e.bd.w, c: col(e.bd.c), d: e.bd.d || 'solid', o: !!e.bd.o };
    if (e.sh) p.shadow = e.sh.map(([c, x, y, b, s, i]) => ({ c: col(c), x, y, b, s, inset: !!i }));
    if (e.op !== undefined) p.op = e.op;
    if (e.cl) p.clip = true;
    if (e.tf) p.tf = e.tf;
    if (Object.keys(p).length) n.paint = p;
    if (e.f !== undefined) {
      n.font = { ...font(e.f), fs: e.fs ?? 12, lh: e.lh ?? 'AUTO', ls: e.ls || 0, c: e.c !== undefined ? col(e.c) : '#000000',
        td: e.td || '', tt: e.tt || '', ta: e.ta || 'L', ar: e.ar || 'WH' };
    }
    if (e.tx !== undefined) {
      n.text = e.tx;
      if (e.rn) {
        let i = 0;
        n.runs = e.rn.map((r) => {
          const [len, o] = Array.isArray(r) ? r : [r, null];
          const run = { t: e.tx.slice(i, i + len) }; i += len;
          if (o) {
            const s = { ...o };
            if (o.f !== undefined) Object.assign(s, font(o.f)), delete s.f;
            if (o.c !== undefined) s.c = col(o.c);
            if (o.ts !== undefined) s.ts = D.S[o.ts];
            if (o.v) s.v = binds(o.v);
            run.s = s;
          }
          return run;
        });
        assert.equal(i, e.tx.length, 'run lengths add up to the characters');
      }
    }
    if (e.ic) {
      const ic = {};
      if (e.ic.g !== undefined) ic.glyph = e.ic.g;
      if (e.ic.i !== undefined) { const [vb, mk] = D.I[e.ic.i]; ic.viewBox = vb; ic.markup = mk; }
      for (const k of ['c', 'f', 's']) if (e.ic[k] !== undefined) ic[k] = col(e.ic[k]);
      if (e.ic.w !== undefined) ic.w = e.ic.w;
      n.icon = ic;
    }
    if (e.im) n.img = { src: D.M[e.im.m], fit: e.im.f, pos: e.im.p };
    if (e.ts !== undefined) n.textStyle = D.S[e.ts];
    if (e.es !== undefined) n.effectStyle = D.S[e.es];
    if (e.v) n.vars = binds(e.v);
    if (e.raw) n.raw = e.raw;
    if (e.k) n.kids = e.k.map(node);
    return n;
  };
  return D.screens.map((s) => ({ screen: s.screen, file: s.file, W: s.W, tree: node(s.T) }));
}

// ---- a small spec with every field the encoder carries ----
const small = () => ({
  id: 'n', t: 'F', w: 304, h: 400, sz: ['FIXED', 'HUG'], model: 'figma',
  lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' },
  paint: { bg: 'rgb(251, 248, 242)', pos: 'relative' },
  kids: [
    {
      id: 'n.0', t: 'F', w: 304, h: 60, sz: ['FILL', 'HUG'], min: 56, max: 320.5,
      lay: { d: 'H', p: [10, 16, 10, 16], g: 8, pa: 'C', ca: 'B', wrap: 1, cg: 6 },
      paint: {
        bg: 'rgba(38, 51, 92, 0.5)', radius: ['14px', '14px', '0px', '0px'], clip: true, opacity: 0.8,
        border: [{ w: 1, style: 'dashed', color: 'rgb(220, 230, 224)' }, { w: 0, style: 'none', color: 'rgb(0, 0, 0)' },
          { w: 2, style: 'dashed', color: 'rgb(220, 230, 224)' }, { w: 0, style: 'none', color: 'rgb(0, 0, 0)' }],
        strokeOverlay: true,
        shadow: 'rgb(207, 221, 212) 0px 8px 0px -3px, rgba(0, 0, 0, 0.25) 1px 2px 4px 0px inset',
      },
      kids: [
        {
          id: 'n.0.0', t: 'T', w: 120, h: 18, sz: ['HUG', 'HUG'],
          font: { ff: 'Be Vietnam Pro', fs: '14px', fw: '600', fst: 'normal', lh: 18, ls: '-0.44px', c: 'rgb(38, 51, 92)', ta: 'center', td: 'line-through', tt: 'uppercase', ws: 'nowrap' },
          runs: [{ t: 'Mua ' }, { t: '3', s: { fw: '800', c: 'rgb(201, 104, 63)', fs: '16px' } }, { br: 1 }, { t: 'món' }],
        },
        { id: 'n.0.1', t: 'V', w: 24, h: 24, sz: ['FIXED', 'FIXED'], icon: { ref: 'i-plus', color: 'rgb(255, 255, 255)', fill: 'rgb(0, 0, 0)', stroke: 'none', sw: '1.5px' } },
        { id: 'n.0.g0', syn: 'anchor', t: 'F', w: 0.01, h: 10, sz: ['FIXED', 'FIXED'], abs: { x: 158, y: 4, c: 'SCALE', cy: 'B' },
          paint: { transform: { value: 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)', origin: '3.5px 5px' } } },
      ],
    },
    {
      id: 'n.1', t: 'T', w: 304, h: 40, sz: ['FILL', 'HUG'],
      font: { ff: 'Be Vietnam Pro', fs: '12px', fw: '400', fst: 'italic', lh: null, ls: 'normal', c: 'rgb(0, 0, 0)', ta: 'start', td: 'none', tt: 'none' },
      runs: [{ t: 'Plain' }],
      paint: { filter: 'blur(2px)' }, // not drawn on text (the proxy draws only opacity and transform there)
    },
    { id: 'n.2', t: 'F', w: 304, h: 80, sz: ['FIXED', 'FIXED'], paint: { bgImage: 'linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)', radius: ['50%', '50%', '50%', '50%'], filter: 'blur(2px)' } },
  ],
});

const tablesFor = (V = []) => newTables(V);
const ctxFor = (over = {}) => ({ screen: 's0', file: 'f.html', W: [304, 424], map: {}, svgDefs: SVG, tables: tablesFor(), ...over });

test('a small spec encodes and decodes back to the same tree', () => {
  const enc = encodeScreen(small(), ctxFor());
  const [b] = planBatches([enc], { runtime: RUNTIME });
  const [s] = decodeForTest(dataOf(b));
  assert.equal(s.screen, 's0'); assert.equal(s.file, 'f.html'); assert.deepEqual(s.W, [304, 424]);
  const t = s.tree;
  assert.deepEqual({ ...t, kids: undefined }, {
    id: 'n', t: 'F', w: 304, h: 400, sz: ['FIXED', 'HUG'], kids: undefined,
    lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' }, paint: { bg: '#fbf8f2' },
  });
  const row = t.kids[0];
  assert.deepEqual({ ...row, kids: undefined }, {
    id: 'n.0', t: 'F', w: 304, h: 60, sz: ['FILL', 'HUG'], min: 56, max: 320.5, kids: undefined,
    lay: { d: 'H', p: [10, 16, 10, 16], g: 8, pa: 'C', ca: 'B', wrap: true, cg: 6 },
    paint: {
      bg: '#26335c80', radius: [14, 14, 0, 0], clip: true, op: 0.8,
      border: { w: [1, 0, 2, 0], c: '#dce6e0', d: 'dashed', o: true },
      shadow: [{ c: '#cfddd4', x: 0, y: 8, b: 0, s: -3, inset: false }, { c: '#00000040', x: 1, y: 2, b: 4, s: 0, inset: true }],
    },
  });
  const [txt, icon, anchor] = row.kids;
  assert.deepEqual(txt, {
    id: 'n.0.0', t: 'T', w: 120, h: 18, sz: ['HUG', 'HUG'], text: 'Mua 3\nmón',
    font: { ff: 'Be Vietnam Pro', fw: 600, it: false, fs: 14, lh: 18, ls: -0.44, c: '#26335c', td: 'S', tt: 'U', ta: 'C', ar: 'WH' },
    runs: [{ t: 'Mua ' }, { t: '3', s: { ff: 'Be Vietnam Pro', fw: 800, it: false, fs: 16, c: '#c9683f' } }, { t: '\n' }, { t: 'món' }],
  });
  assert.deepEqual(icon, {
    id: 'n.0.1', t: 'V', w: 24, h: 24, sz: ['FIXED', 'FIXED'],
    icon: { viewBox: '0 0 24 24', markup: '<path d="M12 5v14M5 12h14"></path>', c: '#ffffff', f: '#000000', s: 'none', w: 1.5 },
  });
  assert.deepEqual(anchor, {
    id: 'n.0.g0', t: 'F', syn: 'anchor', w: 0.01, h: 10, sz: ['FIXED', 'FIXED'], abs: { x: 158, y: 4, c: 'SCALE', cy: 'B' },
    paint: { tf: [0.707107, 0.707107, -0.707107, 0.707107, 0, 0, 3.5, 5] },
  });
  const [plain, grad] = t.kids.slice(1);
  assert.deepEqual(plain, {
    id: 'n.1', t: 'T', w: 304, h: 40, sz: ['FILL', 'HUG'], text: 'Plain',
    font: { ff: 'Be Vietnam Pro', fw: 400, it: true, fs: 12, lh: 'AUTO', ls: 0, c: '#000000', td: '', tt: '', ta: 'L', ar: 'H' },
  });
  // 90deg linear gradient: left middle to right middle; 50% radius on a 304 x 80 box is elliptical -> raw kept
  assert.deepEqual(grad.paint.gr, [{ k: 'L', p: [0, 0.5, 1, 0.5], s: [[0, '#ff0000'], [1, '#0000ff']] }]);
  assert.deepEqual(grad.paint.radius, [40, 40, 40, 40]);
  assert.deepEqual(grad.raw, { radius: ['50%', '50%', '50%', '50%'], filter: 'blur(2px)' });
  assert.equal(enc.raw, 1);
});

test('default values are left out of the data', () => {
  const enc = encodeScreen(small(), ctxFor());
  const root = enc.T;
  assert.deepEqual(root.l, { d: 'V' }, 'padding 0, gap 0, pa S, ca S are not written');
  assert.equal(root.t, undefined, 'frame type is the default');
  const plain = root.k[1];
  for (const k of ['ls', 'c', 'td', 'tt', 'ta', 'lh', 'fs', 'op']) assert.equal(plain[k], undefined, `text ${k}`);
  assert.equal(root.k[0].k[0].ar, undefined, 'HUG text: WIDTH_AND_HEIGHT is the default');
  const json = JSON.stringify(dataOf(planBatches([enc], { runtime: RUNTIME })[0]));
  assert.ok(!json.includes('"pa":"S"') && !json.includes('"p":[0,0,0,0]'));
});

test('every node carries its spec id as o', () => {
  const enc = encodeScreen(small(), ctxFor());
  const ids = []; (function w(e) { ids.push(e.o); (e.k || []).forEach(w); })(enc.T);
  assert.deepEqual(ids, ['n', 'n.0', 'n.0.0', 'n.0.1', 'n.0.g0', 'n.1', 'n.2']);
});

test('HUG on a node that cannot hug in Figma is FIXED, as in the proxy', () => {
  const spec = { id: 'n', t: 'F', w: 100, h: 50, sz: ['FIXED', 'FIXED'], lay: { d: 'H', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' },
    kids: [{ id: 'n.0', t: 'F', w: 10, h: 10, sz: ['HUG', 'HUG'] }, { id: 'n.1', t: 'V', w: 10, h: 10, sz: ['HUG', 'FILL'], icon: { ref: 'i-plus' } }] };
  const enc = encodeScreen(spec, ctxFor());
  assert.equal(enc.T.k[0].s, undefined);
  assert.equal(enc.T.k[1].s, 'XF');
});

test('variables bind by the token map: plain and run keys, missing variables and value mismatches are counted', () => {
  const V = ['color/c01', 'role/ink', 'space/16', 'role/card-radius', 'border/1', 'size/24', 'opacity/80'];
  const tokens = {
    primitive: {
      color: { c01: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5, hex: '#26335c' } },
        c02: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#26335c' } },
        c03: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#c9683f' } } },
      space: { 16: { $type: 'dimension', $value: { value: 16, unit: 'px' } }, 10: { $type: 'dimension', $value: { value: 10, unit: 'px' } } },
      radius: { full: { $type: 'dimension', $value: { value: 9999, unit: 'px' } } },
      border: { 1: { $type: 'dimension', $value: { value: 1, unit: 'px' } } },
      size: { 24: { $type: 'dimension', $value: { value: 24, unit: 'px' } } },
      opacity: { 80: { $type: 'number', $value: 0.8 } },
      typography: { 't14-600': { $type: 'typography', $value: {} }, 't16-800': { $type: 'typography', $value: {} } },
      shadow: { s01: { $type: 'shadow', $value: [] } },
    },
    role: {
      ink: { $type: 'color', $value: '{primitive.color.c02}' },
      'card-radius': { $type: 'dimension', $value: '{primitive.radius.full}' },
      'title-text': { $type: 'typography', $value: '{primitive.typography.t14-600}' },
    },
  };
  const map = { s0: {
    'n.0': { bg: 'primitive.color.c01', paddingL: 'primitive.space.16', paddingT: 'primitive.space.10', radiusTL: 'role.card-radius',
      'border-width-T': 'primitive.border.1', borderT: 'role.ink', opacity: 'primitive.opacity.80', shadow: 'primitive.shadow.s01' },
    'n.0.0': { 'color|0': 'role.ink', 'color|1': 'primitive.color.c03', 'type|0': 'role.title-text', 'type|1': 'primitive.typography.t16-800' },
    'n.0.1': { 'icon-width': 'primitive.size.24', 'icon-height': 'primitive.size.24' },
    'n.1': { color: 'primitive.color.c09', type: 'role.title-text', width: 'primitive.size.24' },
  } };
  const spec = small();
  spec.kids[0].paint.border[0].color = 'rgb(38, 51, 92)'; spec.kids[0].paint.border[2].color = 'rgb(38, 51, 92)';
  spec.kids[0].paint.radius = ['999px', '999px', '0px', '0px'];
  const enc = encodeScreen(spec, ctxFor({ map, tables: tablesFor(V), tokens }));
  const D = dataOf(planBatches([enc], { runtime: RUNTIME })[0]);
  const [s] = decodeForTest(D);
  const row = s.tree.kids[0];
  // bg #26335c80 = c01 (alpha 0.5); padding T 10 px != space.16? no: paddingT is 10 and maps to space.10 -> no variable
  // the 999px corner on a 304 x 60 row is a pill (R70): it binds to radius.full (9999), Figma clamps both to 30 px
  assert.deepEqual(row.vars, { bg: 'color/c01', b0: 'border/1', sc: 'role/ink', op: 'opacity/80', pl: 'space/16', r0: 'role/card-radius' });
  assert.deepEqual(row.paint.radius, [999, 999, 0, 0]);
  assert.equal(row.effectStyle, 'shadow/s01');
  const txt = row.kids[0];
  // run 0 ('Mua ') and run 3 ('món', same style and colour as run 0) take run 0's bindings; run 2 is the line break
  assert.deepEqual(txt.runs.map((r) => r.s && [r.s.ts, r.s.v]), [
    ['type/t14-600', { c: 'role/ink' }], ['type/t16-800', undefined], undefined, ['type/t14-600', { c: 'role/ink' }]]);
  assert.equal(txt.textStyle, undefined);
  assert.deepEqual(row.kids[1].vars, { h: 'size/24', w: 'size/24' });
  const plain = s.tree.kids[1];
  assert.equal(plain.textStyle, 'type/t14-600');
  assert.equal(plain.vars, undefined);
  // c09 has no variable; c03 has none either; padding 10 has none; width of a FILL text cannot bind
  assert.deepEqual(enc.unbound, { 'no-variable': 3, 'not-fixed': 1 });
  assert.deepEqual(enc.unboundList.map((u) => `${u.o} ${u.key} ${u.reason}`).sort(), [
    'n.0 paddingT no-variable', 'n.0.0 color|1 no-variable', 'n.1 color no-variable', 'n.1 width not-fixed']);
  // mismatch: the token value differs from the spec value -> not bound
  const map2 = { s0: { 'n.0': { paddingL: 'primitive.space.10' } } };
  const enc2 = encodeScreen(small(), ctxFor({ map: map2, tables: tablesFor(['space/10']), tokens }));
  assert.equal(enc2.T.k[0].v, undefined);
  assert.deepEqual(enc2.unbound, { 'value-mismatch': 1 });
});

test('radius binds to radius.full only for a pill corner (R70); other radii need the exact value', () => {
  const tokens = { primitive: { radius: { full: { $type: 'dimension', $value: { value: 9999, unit: 'px' } }, 8: { $type: 'dimension', $value: { value: 8, unit: 'px' } } } } };
  const bindR = (r, path) => {
    const spec = { id: 'n', t: 'F', w: 40, h: 20, sz: ['FIXED', 'FIXED'], paint: { bg: 'rgb(1, 2, 3)', radius: [r, '0px', '0px', '0px'] } };
    const enc = encodeScreen(spec, ctxFor({ map: { s0: { n: { radiusTL: path } } }, tables: tablesFor(['radius/full', 'radius/8']), tokens }));
    return [enc.T.v && enc.T.v.r0, JSON.stringify(enc.unbound)];
  };
  assert.deepEqual(bindR('999px', 'primitive.radius.full'), [0, '{}'], '999px on 40 x 20 is a pill');
  assert.deepEqual(bindR('15px', 'primitive.radius.full'), [0, '{}'], '15 >= 10: a pill');
  assert.deepEqual(bindR('10px', 'primitive.radius.full'), [0, '{}'], 'boundary: exactly half the smaller side');
  assert.deepEqual(bindR('8px', 'primitive.radius.full'), [undefined, '{"value-mismatch":1}'], '8 < 10: not a pill, 8 != 9999');
  assert.deepEqual(bindR('8px', 'primitive.radius.8'), [1, '{}'], 'exact value binds');
  assert.deepEqual(bindR('8.5px', 'primitive.radius.8'), [undefined, '{"value-mismatch":1}']);
});

test('nothing is dropped silently: paint.unsupported and an image without a source go to raw', () => {
  const un = [{ prop: 'text-shadow', value: 'rgb(0, 0, 0) 1px 1px 2px' }];
  const svgUn = [{ prop: 'transform', value: 'rotate(45)' }];
  const spec = { id: 'n', t: 'F', w: 100, h: 100, sz: ['FIXED', 'FIXED'], paint: { unsupported: [{ prop: 'mask-image', value: 'url(m.svg)' }] },
    kids: [
      { id: 'n.0', t: 'T', w: 50, h: 20, sz: ['HUG', 'HUG'], font: { ff: 'Inter', fs: '14px', fw: '400', c: 'rgb(0, 0, 0)' }, runs: [{ t: 'Hi' }], paint: { unsupported: un } },
      { id: 'n.1', t: 'V', w: 24, h: 24, sz: ['FIXED', 'FIXED'], icon: { svg: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>' }, paint: { unsupported: svgUn } },
      { id: 'n.2', t: 'I', w: 80, h: 40, sz: ['FIXED', 'FIXED'], src: null, fit: 'cover', pos: '50% 50%' },
      { id: 'n.3', t: 'I', w: 80, h: 40, sz: ['FIXED', 'FIXED'], src: 'data:image/png;base64,AAAA', fit: 'contain' },
    ] };
  const enc = encodeScreen(spec, ctxFor());
  const [s] = decodeForTest(dataOf(planBatches([enc], { runtime: RUNTIME })[0]));
  assert.deepEqual(s.tree.raw, { unsupported: [{ prop: 'mask-image', value: 'url(m.svg)' }] });
  assert.deepEqual(s.tree.kids[0].raw, { unsupported: un }, 'text nodes too');
  assert.deepEqual(s.tree.kids[1].raw, { unsupported: svgUn });
  assert.equal(s.tree.kids[2].img, undefined);
  assert.deepEqual(s.tree.kids[2].raw, { src: null, fit: 'cover', pos: '50% 50%' });
  assert.deepEqual(s.tree.kids[3].img, { src: 'data:image/png;base64,AAAA', fit: 'contain', pos: undefined });
  assert.equal(s.tree.kids[3].raw, undefined);
  assert.equal(enc.raw, 4);
});

test('figmaVarName drops the primitive tier and writes / for .', () => {
  assert.equal(figmaVarName('primitive.color.c01'), 'color/c01');
  assert.equal(figmaVarName('role.text-muted'), 'role/text-muted');
});

test('encoding is deterministic', () => {
  const once = () => { const t = tablesFor(['color/c01']); const e = encodeScreen(small(), ctxFor({ tables: t })); return JSON.stringify([e.T, t]) + planBatches([e], { runtime: RUNTIME })[0].code; };
  assert.equal(once(), once());
});

test('gradients: CSS angle, side keywords and radial size / position become node-relative geometry', () => {
  const run = (css, w, h) => { const ctx = ctxFor(); const T = encodeScreen({ id: 'n', t: 'F', w: w ?? 100, h: h ?? 50, sz: ['FIXED', 'FIXED'], paint: { bgImage: css } }, ctx).T; return T; };
  // default direction: to bottom
  let T = run('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255) 80%, rgb(0, 255, 0))');
  assert.deepEqual(T.gr[0].p, [0.5, 0, 0.5, 1]);
  assert.deepEqual(T.gr[0].s.map((s) => s[0]), [0, 0.8, 1]);
  // 'to right' = 90deg; 'to top right' points at the corner: its line is perpendicular to the other diagonal
  assert.deepEqual(run('linear-gradient(to right, red, blue)').gr[0].p, [0, 0.5, 1, 0.5]);
  const tr = run('linear-gradient(to top right, red, blue)').gr[0].p;
  const [x0, y0, x1, y1] = tr, dx = (x1 - x0) * 100, dy = (y1 - y0) * 50;
  assert.ok(Math.abs(dx * 100 + dy * 50) < 0.1 && dx > 0 && dy < 0, JSON.stringify(tr));
  // radial: circle at 50% 30%, farthest-corner; stops in % of the radius
  T = run('radial-gradient(circle at 50% 30%, rgb(251, 248, 242) 0%, rgb(227, 238, 231) 70%)', 100, 100);
  assert.deepEqual(T.gr[0], { k: 'R', p: [0.5, 0.3, 0.8602, 0.8602], s: [[0, 0], [0.7, 1]] });
  // two layers: CSS lists the top one first, Figma fills go bottom first
  T = run('linear-gradient(red, blue), radial-gradient(green, white)');
  assert.deepEqual(T.gr.map((x) => x.k), ['R', 'L']);
  // what the format cannot carry is kept raw
  for (const css of ['url("a.png")', 'conic-gradient(red, blue)', 'linear-gradient(red, 40%, blue)']) {
    T = run(css);
    assert.equal(T.gr, undefined, css);
    assert.deepEqual(T.raw, { bgImage: css });
  }
});

test('Planora encoding is deterministic: two runs give the same batches', () => {
  const codes = () => planBatches(encodePlanora(), { runtime: RUNTIME }).map((b) => b.code).join('\n');
  assert.equal(codes(), codes());
});

// ---- 18 Planora screens (fixture: the real spec-norm-s*.json of a ds run, gzipped, with svgDefs, W and token map) ----
const planora = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/figma-encode-planora.json.gz', import.meta.url))).toString('utf8'));

function encodePlanora() {
  const tables = newTables(planora.V);
  return planora.screens.map((s) => encodeScreen(s.spec, { screen: s.id, file: planora.file, W: s.W, map: planora.map, svgDefs: s.svgDefs, tables, tokens: planora.tokens }));
}

test('18 Planora screens: batches stay within 50 000 bytes and hold each screen once', () => {
  assert.equal(planora.screens.length, 18);
  const encs = encodePlanora();
  const batches = planBatches(encs, { runtime: RUNTIME });
  const seen = [];
  batches.forEach((b, i) => {
    assert.equal(b.n, i + 1);
    assert.ok(b.bytes <= 50000, `batch ${b.n}: ${b.bytes} bytes`);
    assert.equal(b.bytes, Buffer.byteLength(b.code, 'utf8'));
    const D = dataOf(b);
    assert.equal(D.batch, b.n);
    assert.deepEqual(D.screens.map((s) => s.screen), b.screens);
    seen.push(...b.screens);
    // the batch tables hold only what the batch uses, and every reference resolves
    const used = { C: new Set(), F: new Set(), I: new Set(), V: new Set(), S: new Set(), M: new Set() };
    const ref = (T, i) => { if (T === 'C' && i === -1) return; assert.ok(Number.isInteger(i) && i >= 0 && i < D[T].length, `${T}[${i}]`); used[T].add(i); };
    const walk = (e) => {
      if (e.f !== undefined) ref('F', e.f);
      for (const k of ['c', 'bg']) if (e[k] !== undefined) ref('C', e[k]);
      if (e.gr) e.gr.forEach((g) => g.s.forEach((x) => ref('C', x[1])));
      if (e.bd) ref('C', e.bd.c);
      if (e.sh) e.sh.forEach((x) => ref('C', x[0]));
      if (e.ic) { if (e.ic.i !== undefined) ref('I', e.ic.i); for (const k of ['c', 'f', 's']) if (e.ic[k] !== undefined) ref('C', e.ic[k]); }
      if (e.im) ref('M', e.im.m);
      for (const k of ['ts', 'es']) if (e[k] !== undefined) ref('S', e[k]);
      if (e.v) Object.values(e.v).forEach((i) => ref('V', i));
      if (e.rn) e.rn.forEach((r) => { if (!Array.isArray(r)) return; const o = r[1]; if (o.f !== undefined) ref('F', o.f); if (o.c !== undefined) ref('C', o.c); if (o.ts !== undefined) ref('S', o.ts); if (o.v) Object.values(o.v).forEach((i) => ref('V', i)); });
      (e.k || []).forEach(walk);
    };
    D.screens.forEach((s) => walk(s.T));
    for (const T of Object.keys(used)) assert.equal(used[T].size, D[T].length, `batch ${b.n} table ${T} has unused entries`);
  });
  assert.deepEqual(seen, planora.screens.map((s) => s.id));
  assert.ok(batches.length >= 2, 'more than one batch');
  // decoding gives back every spec node
  for (const b of batches) for (const s of decodeForTest(dataOf(b))) {
    const spec = planora.screens.find((x) => x.id === s.screen).spec;
    const ids = (n, out = []) => { out.push(n.id); (n.kids || []).forEach((k) => ids(k, out)); return out; };
    assert.deepEqual(ids(s.tree), ids(spec));
  }
});

test('Planora encoded size per screen (data alone, own tables) stays small', (t) => {
  const encs = encodePlanora();
  const sizes = encs.map((e) => planBatches([e], { runtime: '__DATA__' })[0].bytes);
  const spec = planora.screens.map((s) => Buffer.byteLength(JSON.stringify(s.spec), 'utf8'));
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length, avgSpec = spec.reduce((a, b) => a + b, 0) / spec.length;
  const unbound = {}; let raw = 0;
  for (const e of encs) { raw += e.raw; for (const [k, v] of Object.entries(e.unbound)) unbound[k] = (unbound[k] || 0) + v; }
  const batches = planBatches(encs, { runtime: RUNTIME });
  t.diagnostic(`encoded avg ${(avg / 1000).toFixed(2)} KB, min ${Math.min(...sizes)}, max ${Math.max(...sizes)} B; spec-norm avg ${(avgSpec / 1000).toFixed(2)} KB`);
  t.diagnostic(`per screen: ${encs.map((e, i) => `${e.screen} ${sizes[i]}`).join(', ')}`);
  t.diagnostic(`batches (8 KB stub runtime): ${batches.map((b) => `${b.n} [${b.screens.join(' ')}] ${b.bytes}`).join('; ')}`);
  t.diagnostic(`unbound ${JSON.stringify(unbound)}; nodes with raw ${raw}`);
  assert.ok(avg < 12000, `average ${avg}`);
});

test('oversize screen: a screen that does not fit alone throws OversizeError with its name and bytes', () => {
  const kids = [];
  for (let i = 0; i < 600; i++) {
    kids.push({ id: `n.${i}`, t: 'T', w: 300, h: 20, sz: ['FILL', 'HUG'], font: { ff: 'Inter', fs: '14px', fw: '400', fst: 'normal', lh: 20, ls: 'normal', c: 'rgb(1, 2, 3)', ta: 'start', td: 'none', tt: 'none' },
      runs: [{ t: `line ${i} ${'y'.repeat(60)}` }] });
  }
  const big = { id: 'n', t: 'F', w: 300, h: 12000, sz: ['FIXED', 'HUG'], lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' }, kids };
  const tables = tablesFor();
  const encs = [encodeScreen(small(), ctxFor({ tables })), encodeScreen(big, ctxFor({ screen: 'sBig', tables }))];
  let err;
  try { planBatches(encs, { runtime: RUNTIME }); } catch (e) { err = e; }
  assert.ok(err instanceof OversizeError, String(err));
  assert.equal(err.screen, 'sBig');
  assert.ok(err.bytes > 50000, `bytes ${err.bytes}`);
  assert.match(err.message, /sBig/);
});

test('planBatches needs a runtime with __DATA__ exactly once', () => {
  const enc = encodeScreen(small(), ctxFor());
  assert.throws(() => planBatches([enc], { runtime: 'no placeholder' }), /__DATA__/);
  assert.throws(() => planBatches([enc], { runtime: '__DATA__ __DATA__' }), /__DATA__/);
});

test('compactIds: four equal corner / side bindings become v.r / v.b; different ones stay', async () => {
  const { compactIds } = await import('../core/figma-encode.mjs');
  const D = { screens: [{ T: { o: 'n', v: { r0: 1, r1: 1, r2: 1, r3: 1, b0: 2, b1: 2, b2: 3, b3: 2, bg: 4 }, k: [{ o: 'n.0', v: { b0: 5, b1: 5, b2: 5, b3: 5 } }] } }] };
  const C = compactIds(D);
  assert.deepEqual(C.screens[0].T.v, { b0: 2, b1: 2, b2: 3, b3: 2, bg: 4, r: 1 });
  assert.deepEqual(C.screens[0].T.k[0], { v: { b: 5 } });
  assert.equal(D.screens[0].T.v.r0, 1, 'the input is not changed');
});

test('style variants: a styled run with a decoration, or a case other than its style\'s, binds to a variant style', () => {
  const font = (o = {}) => ({ ff: 'Be Vietnam Pro', fs: '14px', fw: '600', fst: 'normal', lh: 18, ls: 'normal', c: 'rgb(0, 0, 0)', ta: 'start', td: 'none', tt: 'none', ...o });
  const T = (id, f, runs = [{ t: 'Giấy ăn' }]) => ({ id, t: 'T', w: 100, h: 18, sz: ['HUG', 'HUG'], font: font(f), runs });
  const spec = { id: 'n', t: 'F', w: 304, h: 400, sz: ['FIXED', 'HUG'], lay: { d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' }, kids: [
    T('n.0', { td: 'line-through' }),
    T('n.1', { tt: 'uppercase' }),
    T('n.2', { tt: 'lowercase', td: 'underline' }),
    T('n.3', {}, [{ t: 'Mua ' }, { t: 'xong', s: { td: 'line-through' } }]),
    T('n.4', { td: 'line-through' }),
    T('n.5', {}),
  ] };
  const ty = 'primitive.typography.';
  const map = { s0: { 'n.0': { type: ty + 't14-600' }, 'n.1': { type: ty + 't10-600' }, 'n.2': { type: ty + 't10-600' }, 'n.3': { type: ty + 't14-600' },
    'n.4': { type: ty + 'other' }, 'n.5': { type: ty + 't14-600' } } };
  const styleTc = new Map([['type/t14-600', ''], ['type/t10-600', 'UPPER']]);
  const enc = encodeScreen(spec, ctxFor({ map, styleTc }));
  const S = enc.tables.S, k = Object.fromEntries(enc.T.k.map((e) => [e.o, e]));
  assert.equal(S[k['n.0'].ts], 'type/t14-600/strike');
  assert.equal(S[k['n.1'].ts], 'type/t10-600', 'the case is the style\'s: no variant');
  assert.equal(S[k['n.2'].ts], 'type/t10-600/underline-lower');
  // a run with its own decoration gets an explicit range style (the runtime sets range decoration before it)
  assert.equal(S[k['n.3'].ts], 'type/t14-600');
  assert.equal(S[k['n.3'].rn[1][1].ts], 'type/t14-600/strike');
  assert.equal(k['n.3'].rn[1][1].td, 'S');
  assert.equal(S[k['n.4'].ts], 'type/other', 'a style not in the tokens is left as it is');
  assert.equal(S[k['n.5'].ts], 'type/t14-600');
  assert.deepEqual(enc.variants, [
    ['type/t10-600/underline-lower', 'type/t10-600', 'UNDERLINE', 'LOWER'],
    ['type/t14-600/strike', 'type/t14-600', 'STRIKETHROUGH', 'ORIGINAL'],
  ]);
});
