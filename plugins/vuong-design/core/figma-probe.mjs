// Figma probe (plan 3, task 1): measures on real Figma the assumptions the local proxy / figma-model rely on.
//  - probePayload(): plain JS sent as the code of the Figma MCP `use_figma` tool. It is the body of an async function
//    taking `figma` (top-level await, top-level `return`, no fetch). It only creates/removes nodes on the page
//    `_vd-probe`, clears that page's old frames first, and returns { cases: { lh, tb, scale, zero, hug, overlay,
//    shrink, base }, errors: [] }. A failing case is caught and reported in `errors`; the other cases still run.
//  - readFacts(result, measured?): pure and deterministic; turns the measured numbers into Facts. A missing case keeps
//    the default (the model's current assumption) for its fields. `measured` (a date string) is stamped by the caller.
//  - loadFacts(path?): core/figma-facts.json, or DEFAULT_FACTS when the file is missing.
//  Decision thresholds live next to each case in readFacts. Geometry is read from absoluteBoundingBox after building,
//  relative to the case's parent so the case's page position does not matter.
//  Baseline is derived (no baseline getter is used): y + h * asc/(asc+desc) with Inter metrics; the same formula is
//  applied to both texts, so only their difference matters.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaTextBox } from './figma-model.mjs';

export const DEFAULT_FACTS = Object.freeze({
  version: 1,
  measured: null, // null = not measured on real Figma yet
  lineHeightFrac: 'keep', // fractional px line height is kept (not rounded)
  textBox: 'ceil', // HUG text box = figmaTextBox()
  scaleBasis: 'frame', // SCALE child scales against the whole frame, not the padded area
  zeroWidthAnchor: 'ok', // a 0.01-wide SCALE frame still carries its L/R children correctly
  scaleInHug: 'ok', // SCALE child inside a HUG parent follows content resize
  strokeOverlay: 'ok', // strokesIncludedInLayout=false + absolute overlay leaves the cell size unchanged
  shrinkFill: Object.freeze({ maxWidth: 'ok', growText: 'ok' }),
  baseline: 'ok', // counterAxisAlignItems BASELINE aligns text baselines within 0.5 px
  // plan 3b Task 1 (cmpProbePayload / readCmpFacts): the component API. Defaults are the safe side (nothing assumed):
  // plan 3b reads instance children in tree order and sets no property it has not measured.
  cmp: Object.freeze({
    measured: null,
    data: 'no', // 'own': an instance child keeps its own shared plugin data; 'inherit': it only reads the main's; 'no'
    idPattern: false, // instance child id = 'I' + instance id + ';' + main child id
    props: Object.freeze({ text: false, bool: false, swap: false, variant: false, override: false }),
    layout: 'no', // 'ok': instances lay out as the same plain frames (<= 0.01 px); 'near' (<= 0.5 px); 'no'
    layoutMax: null, // the largest box difference measured (px)
    bind: 'no', // 'ok': a variable bound on the main is bound on the instance, and an instance override binds another
    timeMs: null, // { inst, plain }: 20 instances vs 20 plain trees of the same content
    ov: null, // { <spec key>: true | false }: a direct override on an instance's child is kept (components.mjs overridableFrom)
  }),
});

const PROBE_SRC = `
const page = figma.root.children.find((p) => p.name === '_vd-probe') || figma.createPage();
page.name = '_vd-probe';
await figma.setCurrentPageAsync(page);
for (const n of [...page.children]) n.remove();
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const FONT = { family: 'Inter', style: 'Regular' };
const BLACK = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
const cases = {};
const errors = [];
let cy = 0;
const frame = (name, w, h) => {
  const f = figma.createFrame();
  f.name = name; f.fills = []; f.clipsContent = false;
  page.appendChild(f);
  f.resize(w, h); f.x = 0; f.y = cy; cy += h + 60;
  return f;
};
const fixed = (f, w, h) => { f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'FIXED'; f.resize(w, h); };
const txt = (s, fs, parent) => {
  const t = figma.createText();
  t.fontName = FONT; t.fontSize = fs;
  parent.appendChild(t);
  t.characters = s;
  return t;
};
const box = (n) => n.absoluteBoundingBox;
const rel = (n, p) => ({ x: box(n).x - box(p).x, w: box(n).width, h: box(n).height, r: box(n).x - box(p).x + box(n).width });
const run = async (k, fn) => { try { cases[k] = await fn(); } catch (e) { errors.push(k + ': ' + ((e && e.message) || e)); } };

await run('lh', async () => {
  const f = frame('lh', 200, 100);
  f.layoutMode = 'VERTICAL'; f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'HUG';
  const a = txt('One line', 15, f);
  a.lineHeight = { unit: 'PIXELS', value: 17.4 };
  a.layoutSizingHorizontal = 'FILL'; a.textAutoResize = 'HEIGHT';
  const b = txt('A\\nB\\nC', 15, f);
  b.lineHeight = { unit: 'PIXELS', value: 21.75 };
  b.layoutSizingHorizontal = 'FILL'; b.textAutoResize = 'HEIGHT';
  return { v1: a.lineHeight.value, h1: box(a).height, v3: b.lineHeight.value, h3: box(b).height };
});

await run('tb', async () => {
  const f = frame('tb', 300, 60);
  const S = 'Planora tasks';
  const a = txt(S, 15, f); a.textAutoResize = 'WIDTH_AND_HEIGHT';
  const b = txt(S, 15, f); b.textAutoResize = 'WIDTH_AND_HEIGHT';
  b.letterSpacing = { unit: 'PIXELS', value: 0.5 };
  return { w0: box(a).width, w: box(b).width, chars: S.length, ls: 0.5, h: box(b).height };
});

await run('scale', async () => {
  const p = frame('scale', 200, 100);
  p.layoutMode = 'HORIZONTAL';
  p.paddingLeft = p.paddingRight = p.paddingTop = p.paddingBottom = 10;
  p.strokes = BLACK; p.strokeWeight = 2;
  fixed(p, 200, 100);
  const c = figma.createFrame();
  c.fills = BLACK; p.appendChild(c);
  c.layoutPositioning = 'ABSOLUTE';
  c.constraints = { horizontal: 'SCALE', vertical: 'MIN' };
  c.resize(90, 20); c.x = 10; c.y = 10;
  p.resize(320, 100);
  const r = rel(c, p);
  return { x: r.x, w: r.w };
});

await run('zero', async () => {
  const p = frame('zero', 200, 100);
  const a = figma.createFrame();
  a.fills = []; a.clipsContent = false; p.appendChild(a);
  a.constraints = { horizontal: 'SCALE', vertical: 'MIN' };
  a.resize(0.01, 0.01); a.x = 100; a.y = 10;
  const l = figma.createFrame(); l.fills = BLACK; a.appendChild(l);
  l.constraints = { horizontal: 'MIN', vertical: 'MIN' }; l.resize(30, 10); l.x = 0; l.y = 0;
  const r = figma.createFrame(); r.fills = BLACK; a.appendChild(r);
  r.constraints = { horizontal: 'MAX', vertical: 'MIN' }; r.resize(30, 10); r.x = 0.01 - 30; r.y = 0;
  p.resize(320, 100);
  return { ax: rel(a, p).x, lx: rel(l, p).x, rr: rel(r, p).r, arr: rel(a, p).r };
});

await run('hug', async () => {
  const p = frame('hug', 100, 20);
  p.layoutMode = 'HORIZONTAL'; p.layoutSizingHorizontal = 'HUG'; p.layoutSizingVertical = 'HUG';
  const k = figma.createFrame(); k.fills = []; p.appendChild(k);
  k.layoutSizingHorizontal = 'FIXED'; k.layoutSizingVertical = 'FIXED'; k.resize(100, 20);
  const s = figma.createFrame(); s.fills = BLACK; p.appendChild(s);
  s.layoutPositioning = 'ABSOLUTE';
  s.constraints = { horizontal: 'SCALE', vertical: 'MIN' };
  s.resize(50, 10); s.x = 25; s.y = 0;
  const w0 = box(p).width;
  k.resize(200, 20);
  const r = rel(s, p);
  return { w0, w: box(p).width, x: r.x, cw: r.w };
});

await run('overlay', async () => {
  const row = frame('overlay', 300, 40);
  row.layoutMode = 'HORIZONTAL'; fixed(row, 300, 40);
  const cell = figma.createFrame(); cell.fills = []; row.appendChild(cell);
  cell.layoutMode = 'HORIZONTAL'; cell.layoutSizingHorizontal = 'FILL'; cell.layoutSizingVertical = 'HUG';
  const inner = figma.createFrame(); inner.fills = BLACK; cell.appendChild(inner);
  inner.layoutSizingHorizontal = 'FIXED'; inner.layoutSizingVertical = 'FIXED'; inner.resize(50, 30);
  cell.strokes = BLACK; cell.strokeWeight = 1; cell.strokesIncludedInLayout = false;
  const ov = figma.createFrame(); ov.fills = []; cell.appendChild(ov);
  ov.layoutPositioning = 'ABSOLUTE';
  ov.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
  ov.strokes = BLACK; ov.strokeWeight = 1;
  ov.x = 0; ov.y = 0; ov.resize(box(cell).width, box(cell).height);
  const w1 = box(cell).width, h1 = box(cell).height;
  cell.strokeWeight = 4; ov.strokeWeight = 4;
  return { w1, h1, w4: box(cell).width, h4: box(cell).height, ow: box(ov).width, oh: box(ov).height };
});

await run('shrink', async () => {
  const LONG = 'A long line of task text that is certain to wrap over several lines in a narrow column';
  const mk = (name) => {
    const row = frame(name, 240, 40);
    row.layoutMode = 'HORIZONTAL'; row.layoutSizingHorizontal = 'FIXED'; row.layoutSizingVertical = 'HUG';
    const av = figma.createFrame(); av.fills = BLACK; row.appendChild(av);
    av.layoutSizingHorizontal = 'FIXED'; av.layoutSizingVertical = 'FIXED'; av.resize(32, 32);
    const blk = figma.createFrame(); blk.fills = []; row.appendChild(blk);
    blk.layoutMode = 'VERTICAL'; blk.layoutSizingVertical = 'HUG';
    const t = txt(LONG, 13, blk);
    t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT';
    return { row, blk, t };
  };
  const A = mk('shrink-a'); A.blk.layoutSizingHorizontal = 'FILL'; A.blk.maxWidth = 180;
  const B = mk('shrink-b'); B.blk.layoutGrow = 1;
  const a240 = box(A.blk).width, b240 = box(B.blk).width, bt240 = box(B.t).width;
  A.row.resize(360, A.row.height); B.row.resize(360, B.row.height);
  return { a240, a360: box(A.blk).width, b240, b360: box(B.blk).width, bt240, bt360: box(B.t).width };
});

await run('base', async () => {
  const row = frame('base', 200, 40);
  row.layoutMode = 'HORIZONTAL'; row.counterAxisAlignItems = 'BASELINE';
  row.layoutSizingHorizontal = 'HUG'; row.layoutSizingVertical = 'HUG';
  const big = txt('Big', 22, row), small = txt('small', 12.5, row);
  const bl = (n) => box(n).y + box(n).height * 0.96875 / (0.96875 + 0.2412);
  return { b1: bl(big), b2: bl(small) };
});

return { cases, errors };
`;

export function probePayload() { return PROBE_SRC.trim() + '\n'; }

// ---- plan 3b Task 1: component API probe ----
// cmpProbePayload(): like probePayload, on page `_vd-probe`, but it only touches what it creates: it first removes
// its own leftovers (top-level nodes named `cmp-*`, variable collections named `vd-probe-tmp`), and removes every node
// and the variable collection it made before it returns (`cleaned: true`). It returns
// { cases: { data, props, layout, bind, time, ov }, errors, cleaned }.
const CMP_PROBE_SRC = `
const page = figma.root.children.find((p) => p.name === '_vd-probe') || figma.createPage();
page.name = '_vd-probe';
await figma.setCurrentPageAsync(page);
for (const n of [...page.children]) if (/^cmp-/.test(n.name)) n.remove();
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) if (c.name === 'vd-probe-tmp') c.remove();
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const FONT = { family: 'Inter', style: 'Regular' };
const solid = (r, g, b) => ({ type: 'SOLID', color: { r, g, b } });
const cases = {}, errors = [], made = [], cols = [];
let cy = 3000;
const top = (n, name, h) => { n.name = name; page.appendChild(n); n.x = 0; n.y = cy; cy += (h || 200) + 60; made.push(n); return n; };
const txt = (s, parent) => { const t = figma.createText(); t.fontName = FONT; t.fontSize = 13; parent.appendChild(t); t.characters = s; return t; };
const box = (n) => n.absoluteBoundingBox;
const run = async (k, fn) => { try { cases[k] = await fn(); } catch (e) { errors.push(k + ': ' + ((e && e.message) || e)); } };
const LONG = 'A task title long enough to wrap onto a second line in this row';

// a row: auto layout H, padding 8, gap 6, centred; a 16 x 16 icon frame and a FILL text (HEIGHT autosize)
const row = (n) => {
  n.layoutMode = 'HORIZONTAL'; n.counterAxisAlignItems = 'CENTER';
  n.paddingLeft = n.paddingRight = n.paddingTop = n.paddingBottom = 8; n.itemSpacing = 6;
  n.fills = [solid(0.93, 0.93, 0.93)]; n.clipsContent = false;
  const ic = figma.createFrame(); ic.fills = [solid(0, 0, 0)]; n.appendChild(ic);
  ic.layoutSizingHorizontal = 'FIXED'; ic.layoutSizingVertical = 'FIXED'; ic.resize(16, 16);
  const t = txt('Task title', n); t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT';
  n.layoutSizingHorizontal = 'FIXED'; n.layoutSizingVertical = 'HUG'; n.resize(200, n.height);
  return n;
};
// a chip: auto layout H, HUG both, padding 4 / 10, a WIDTH_AND_HEIGHT text
const chip = (n) => {
  n.layoutMode = 'HORIZONTAL'; n.paddingLeft = n.paddingRight = 10; n.paddingTop = n.paddingBottom = 4;
  n.fills = [solid(0.85, 0.9, 1)]; n.clipsContent = false;
  const t = txt('Chip', n); t.textAutoResize = 'WIDTH_AND_HEIGHT';
  n.layoutSizingHorizontal = 'HUG'; n.layoutSizingVertical = 'HUG';
  return n;
};
const column = (name, w) => {
  const f = figma.createFrame(); top(f, name, 400);
  f.layoutMode = 'VERTICAL'; f.itemSpacing = 4; f.fills = []; f.clipsContent = false;
  f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'HUG'; f.resize(w, f.height);
  return f;
};

try {
  await run('data', async () => {
    const c = chip(figma.createComponent()); top(c, 'cmp-data', 40);
    c.children[0].setSharedPluginData('vuongdesign', 'id', 'main.t');
    const i1 = c.createInstance(); top(i1, 'cmp-data-i1', 40);
    const i2 = c.createInstance(); top(i2, 'cmp-data-i2', 40);
    const inherit = i1.children[0].getSharedPluginData('vuongdesign', 'id');
    let own = '', ownErr = '';
    try { i1.children[0].setSharedPluginData('vuongdesign', 'id', 'inst.t'); own = i1.children[0].getSharedPluginData('vuongdesign', 'id'); } catch (e) { ownErr = String((e && e.message) || e); }
    const other = i2.children[0].getSharedPluginData('vuongdesign', 'id');
    const pat = (i) => i.children[0].id === 'I' + i.id + ';' + c.children[0].id;
    return { inherit, own, ownErr, other, mainAfter: c.children[0].getSharedPluginData('vuongdesign', 'id'), idPattern: pat(i1) && pat(i2) };
  });

  await run('props', async () => {
    const ic1 = figma.createComponent(); top(ic1, 'cmp-icon-a', 16); ic1.resize(16, 16); ic1.fills = [solid(1, 0, 0)];
    const ic2 = figma.createComponent(); top(ic2, 'cmp-icon-b', 16); ic2.resize(16, 16); ic2.fills = [solid(0, 0, 1)];
    const mk = (name) => {
      const c = chip(figma.createComponent()); c.name = name; page.appendChild(c);
      const dot = figma.createFrame(); dot.name = 'dot'; dot.fills = [solid(0, 0.6, 0)]; c.appendChild(dot); dot.resize(6, 6);
      const ii = ic1.createInstance(); ii.name = 'icon'; c.insertChild(0, ii);
      return c;
    };
    const c1 = mk('state=default'), c2 = mk('state=selected');
    c2.fills = [solid(0.2, 0.4, 1)];
    const set = figma.combineAsVariants([c1, c2], page); top(set, 'cmp-set', 80);
    const kT = set.addComponentProperty('label', 'TEXT', 'Chip');
    const kB = set.addComponentProperty('showDot', 'BOOLEAN', true);
    const kS = set.addComponentProperty('icon', 'INSTANCE_SWAP', ic1.id);
    for (const c of [c1, c2]) {
      c.findChild((n) => n.type === 'TEXT').componentPropertyReferences = { characters: kT };
      c.findChild((n) => n.name === 'dot').componentPropertyReferences = { visible: kB };
      c.findChild((n) => n.name === 'icon').componentPropertyReferences = { mainComponent: kS };
    }
    const inst = c1.createInstance(); top(inst, 'cmp-props-i', 40);
    const tx = () => inst.findChild((n) => n.type === 'TEXT');
    tx().fills = [solid(1, 0, 0)]; // a direct override, not through a property
    inst.setProperties({ [kT]: 'Hello', [kB]: false, [kS]: ic2.id });
    const r = {
      text: tx().characters === 'Hello',
      bool: inst.findChild((n) => n.name === 'dot').visible === false,
      swap: !!inst.findChild((n) => n.name === 'icon') && (await inst.findChild((n) => n.name === 'icon').getMainComponentAsync()).id === ic2.id,
    };
    inst.setProperties({ state: 'selected' });
    r.variant = (await inst.getMainComponentAsync()).id === c2.id;
    inst.setProperties({ [kT]: 'Again' });
    const f = tx().fills[0];
    r.override = !!f && f.type === 'SOLID' && f.color.r === 1 && f.color.g === 0 && f.color.b === 0 && tx().characters === 'Again';
    r.keys = [kT, kB, kS];
    return r;
  });

  await run('layout', async () => {
    const rc = row(figma.createComponent()); top(rc, 'cmp-row', 40);
    const cc = chip(figma.createComponent()); top(cc, 'cmp-chip', 40);
    const P1 = column('cmp-col-inst', 300), P2 = column('cmp-col-plain', 300);
    const add = (P, inst) => {
      const a = inst ? rc.createInstance() : row(figma.createFrame()); P.appendChild(a); a.layoutSizingHorizontal = 'FILL';
      const b = inst ? rc.createInstance() : row(figma.createFrame()); P.appendChild(b); b.layoutSizingHorizontal = 'FILL';
      b.children[1].characters = LONG;
      const c = inst ? cc.createInstance() : chip(figma.createFrame()); P.appendChild(c);
      c.children[0].characters = 'A longer chip label';
      return [a, a.children[0], a.children[1], b, b.children[0], b.children[1], c, c.children[0]];
    };
    const A = add(P1, true), B = add(P2, false);
    const diff = () => {
      let m = 0;
      A.forEach((n, i) => {
        const a = box(n), b = box(B[i]), pa = box(P1), pb = box(P2);
        m = Math.max(m, Math.abs((a.x - pa.x) - (b.x - pb.x)), Math.abs((a.y - pa.y) - (b.y - pb.y)), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
      });
      return Math.round(m * 1000) / 1000;
    };
    const d300 = diff();
    P1.resize(360, P1.height); P2.resize(360, P2.height);
    return { d300, d360: diff(), n: A.length, h300: box(A[5]).height };
  });

  await run('bind', async () => {
    const col = figma.variables.createVariableCollection('vd-probe-tmp'); cols.push(col);
    const m = col.modes[0].modeId;
    const v1 = figma.variables.createVariable('probe/c1', col, 'COLOR'); v1.setValueForMode(m, { r: 1, g: 0, b: 0, a: 1 });
    const v2 = figma.variables.createVariable('probe/c2', col, 'COLOR'); v2.setValueForMode(m, { r: 0, g: 0, b: 1, a: 1 });
    const vp = figma.variables.createVariable('probe/p', col, 'FLOAT'); vp.setValueForMode(m, 12);
    const c = chip(figma.createComponent()); top(c, 'cmp-bind', 40);
    c.fills = [figma.variables.setBoundVariableForPaint(solid(0, 0, 0), 'color', v1)];
    c.setBoundVariable('paddingLeft', vp);
    const inst = c.createInstance(); top(inst, 'cmp-bind-i', 40);
    const fv = (n) => (n.fills[0] && n.fills[0].boundVariables && n.fills[0].boundVariables.color ? n.fills[0].boundVariables.color.id : '');
    const pv = (n) => (n.boundVariables && n.boundVariables.paddingLeft ? n.boundVariables.paddingLeft.id : '');
    const r = { fillInherit: fv(inst) === v1.id, padInherit: pv(inst) === vp.id, padValue: inst.paddingLeft };
    inst.fills = [figma.variables.setBoundVariableForPaint(solid(0, 0, 0), 'color', v2)];
    r.fillOverride = fv(inst) === v2.id && fv(c) === v1.id;
    return r;
  });

  await run('time', async () => {
    const rc = row(figma.createComponent()); top(rc, 'cmp-time-row', 40);
    const P3 = column('cmp-time-inst', 300), P4 = column('cmp-time-plain', 300);
    let t0 = Date.now();
    for (let i = 0; i < 20; i++) { const a = rc.createInstance(); P3.appendChild(a); a.layoutSizingHorizontal = 'FILL'; a.children[1].characters = 'Task ' + i; }
    const inst = Date.now() - t0;
    t0 = Date.now();
    for (let i = 0; i < 20; i++) { const a = row(figma.createFrame()); P4.appendChild(a); a.layoutSizingHorizontal = 'FILL'; a.children[1].characters = 'Task ' + i; }
    return { inst, plain: Date.now() - t0 };
  });
  // ov: which properties of an instance's child take a direct override (set on the instance, read back, main unchanged)
  await run('ov', async () => {
    await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
    const c = figma.createComponent(); top(c, 'cmp-ov', 120);
    c.layoutMode = 'HORIZONTAL'; c.fills = [solid(0.9, 0.9, 0.9)]; c.clipsContent = false;
    c.layoutSizingHorizontal = 'FIXED'; c.layoutSizingVertical = 'FIXED'; c.resize(240, 80);
    const k = figma.createFrame(); k.name = 'k'; c.appendChild(k);
    k.layoutMode = 'HORIZONTAL'; k.paddingLeft = 4; k.itemSpacing = 2; k.fills = [solid(1, 1, 1)]; k.clipsContent = false;
    k.layoutSizingHorizontal = 'FIXED'; k.layoutSizingVertical = 'FIXED'; k.resize(80, 40);
    const kt = txt('Ab', k); kt.name = 'kt';
    const w = figma.createFrame(); w.name = 'w'; c.appendChild(w);
    w.layoutMode = 'HORIZONTAL'; w.layoutWrap = 'WRAP'; w.counterAxisSpacing = 2; w.fills = []; w.resize(60, 40);
    const ab = figma.createFrame(); ab.name = 'ab'; c.appendChild(ab); ab.layoutPositioning = 'ABSOLUTE'; ab.resize(10, 10); ab.x = 5; ab.y = 5;
    const icm = figma.createComponent(); top(icm, 'cmp-ov-icon', 16); icm.resize(16, 16);
    const vec = figma.createRectangle(); vec.name = 'vec'; icm.appendChild(vec); vec.resize(16, 16); vec.fills = [solid(0, 0, 0)];
    const ii = icm.createInstance(); ii.name = 'ic'; k.appendChild(ii);
    const inst = c.createInstance(); top(inst, 'cmp-ov-i', 120);
    const I = (name) => inst.findOne((n) => n.name === name);
    const M = (name) => c.findOne((n) => n.name === name);
    const out = {};
    // key: set on the instance child, ok: read back on it, same: the main still has its own value
    const t = (key, set, ok, same) => {
      try { set(); out[key] = !!ok() && !!same(); } catch (e) { out[key] = String((e && e.message) || e).slice(0, 80); }
    };
    const red = [solid(1, 0, 0)];
    const isRed = (n) => n.fills[0] && n.fills[0].type === 'SOLID' && n.fills[0].color.r === 1 && n.fills[0].color.g === 0;
    t('lay.d', () => { I('k').layoutMode = 'VERTICAL'; }, () => I('k').layoutMode === 'VERTICAL', () => M('k').layoutMode === 'HORIZONTAL');
    I('k').layoutMode = 'HORIZONTAL';
    t('lay.wrap', () => { I('k').layoutWrap = 'WRAP'; }, () => I('k').layoutWrap === 'WRAP', () => M('k').layoutWrap === 'NO_WRAP');
    t('lay.p', () => { I('k').paddingLeft = 9; }, () => I('k').paddingLeft === 9, () => M('k').paddingLeft === 4);
    t('lay.g', () => { I('k').itemSpacing = 7; }, () => I('k').itemSpacing === 7, () => M('k').itemSpacing === 2);
    t('lay.cg', () => { I('w').counterAxisSpacing = 9; }, () => I('w').counterAxisSpacing === 9, () => M('w').counterAxisSpacing === 2);
    t('lay.pa', () => { I('k').primaryAxisAlignItems = 'SPACE_BETWEEN'; }, () => I('k').primaryAxisAlignItems === 'SPACE_BETWEEN', () => M('k').primaryAxisAlignItems === 'MIN');
    t('lay.ca', () => { I('k').counterAxisAlignItems = 'CENTER'; }, () => I('k').counterAxisAlignItems === 'CENTER', () => M('k').counterAxisAlignItems === 'MIN');
    t('abs.x', () => { I('ab').x = 30; I('ab').y = 20; }, () => I('ab').x === 30 && I('ab').y === 20, () => M('ab').x === 5 && M('ab').y === 5);
    t('paint.clip', () => { I('k').clipsContent = true; }, () => I('k').clipsContent === true, () => M('k').clipsContent === false);
    t('paint.transform', () => { I('ab').rotation = 15; }, () => Math.abs(I('ab').rotation - 15) < 0.01, () => M('ab').rotation === 0);
    t('paint.bg', () => { I('k').fills = red; }, () => isRed(I('k')), () => !isRed(M('k')));
    t('paint.bgImage', () => {
      const img = figma.createImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
      I('w').fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    }, () => I('w').fills[0] && I('w').fills[0].type === 'IMAGE', () => M('w').fills.length === 0);
    t('paint.radius', () => { I('k').cornerRadius = 6; }, () => I('k').cornerRadius === 6, () => M('k').cornerRadius === 0);
    t('paint.border', () => { I('k').strokes = red; I('k').strokeWeight = 2; }, () => I('k').strokes.length === 1 && I('k').strokeWeight === 2, () => M('k').strokes.length === 0);
    t('paint.shadow', () => { I('k').effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true, blendMode: 'NORMAL' }]; },
      () => I('k').effects.length === 1, () => M('k').effects.length === 0);
    t('paint.opacity', () => { I('k').opacity = 0.5; }, () => Math.abs(I('k').opacity - 0.5) < 0.01, () => M('k').opacity === 1);
    t('w', () => { I('k').resize(100, 44); }, () => I('k').width === 100 && I('k').height === 44, () => M('k').width === 80);
    t('sz', () => { I('k').layoutSizingHorizontal = 'HUG'; }, () => I('k').layoutSizingHorizontal === 'HUG', () => M('k').layoutSizingHorizontal === 'FIXED');
    t('min', () => { I('w').minWidth = 50; I('w').maxWidth = 200; }, () => I('w').minWidth === 50 && I('w').maxWidth === 200, () => M('w').minWidth == null);
    const T1 = () => inst.findOne((n) => n.type === 'TEXT'), T0 = () => kt;
    t('font.fs', () => { T1().fontSize = 20; }, () => T1().fontSize === 20, () => T0().fontSize === 13);
    t('font.ff', () => { T1().fontName = { family: 'Inter', style: 'Bold' }; }, () => T1().fontName.style === 'Bold', () => T0().fontName.style === 'Regular');
    t('font.lh', () => { T1().lineHeight = { unit: 'PIXELS', value: 22 }; }, () => T1().lineHeight.value === 22, () => T0().lineHeight.unit === 'AUTO');
    t('font.ls', () => { T1().letterSpacing = { unit: 'PIXELS', value: 1 }; }, () => T1().letterSpacing.value === 1, () => T0().letterSpacing.value === 0);
    t('font.tt', () => { T1().textCase = 'UPPER'; }, () => T1().textCase === 'UPPER', () => T0().textCase === 'ORIGINAL');
    t('font.td', () => { T1().textDecoration = 'UNDERLINE'; }, () => T1().textDecoration === 'UNDERLINE', () => T0().textDecoration === 'NONE');
    t('font.ta', () => { T1().textAlignHorizontal = 'CENTER'; }, () => T1().textAlignHorizontal === 'CENTER', () => T0().textAlignHorizontal === 'LEFT');
    t('font.c', () => { T1().fills = red; }, () => isRed(T1()), () => !isRed(T0()));
    t('runs', () => { T1().characters = 'Xy'; }, () => T1().characters === 'Xy', () => T0().characters === 'Ab');
    t('icon.color', () => { inst.findOne((n) => n.name === 'vec').fills = red; }, () => isRed(inst.findOne((n) => n.name === 'vec')), () => !isRed(vec));
    t('kids', () => { const x = figma.createFrame(); made.push(x); I('k').appendChild(x); }, () => I('k').children.length > 2, () => M('k').children.length === 2);
    return out;
  });
} finally {
  for (const n of made.reverse()) { try { if (!n.removed) n.remove(); } catch (e) { errors.push('cleanup: ' + ((e && e.message) || e)); } }
  for (const c of cols) { try { c.remove(); } catch (e) { errors.push('cleanup: ' + ((e && e.message) || e)); } }
}
const left = page.children.filter((n) => /^cmp-|^state=/.test(n.name)).length;
return { cases, errors, cleaned: left === 0 };
`;

export function cmpProbePayload() { return CMP_PROBE_SRC.trim() + '\n'; }

// readCmpFacts(result, measured?) -> the `cmp` object of figma-facts.json. A missing case keeps the safe default.
//  data: 'own' when an instance child stored its own id (and neither the main nor the other instance changed),
//        'inherit' when it only reads the main's, else 'no'
//  props: each of text, bool, swap, variant, override must read back exactly
//  layout: the largest difference of 8 boxes (instance vs plain frames, relative to their column, at 300 and 360 px):
//        <= 0.01 'ok', <= 0.5 'near', else 'no'
//  bind: the main's fill and padding variables are bound on the instance, and an instance fill override binds another
//  ov: per spec key, true when the value set on the instance's child reads back and the main keeps its own (an error
//      message or false -> false); keys measured together share the result (OV_SHARED)
export function readCmpFacts(result, measured = null) {
  const c = (result && result.cases) || {};
  const f = { ...DEFAULT_FACTS.cmp, props: { ...DEFAULT_FACTS.cmp.props }, measured };
  const d = c.data;
  if (d && typeof d === 'object') {
    if (d.own === 'inst.t' && d.mainAfter === 'main.t' && d.other === 'main.t') f.data = 'own';
    else if (d.inherit === 'main.t') f.data = 'inherit';
    f.idPattern = d.idPattern === true;
  }
  if (c.props && typeof c.props === 'object') for (const k of Object.keys(f.props)) f.props[k] = c.props[k] === true;
  if (has(c.layout, 'd300', 'd360')) {
    const m = Math.max(c.layout.d300, c.layout.d360);
    f.layoutMax = m;
    f.layout = m <= 0.01 ? 'ok' : m <= 0.5 ? 'near' : 'no';
  }
  if (c.bind && typeof c.bind === 'object') f.bind = c.bind.fillInherit === true && c.bind.padInherit === true && c.bind.fillOverride === true ? 'ok' : 'no';
  if (has(c.time, 'inst', 'plain')) f.timeMs = { inst: c.time.inst, plain: c.time.plain };
  if (c.ov && typeof c.ov === 'object') {
    f.ov = {};
    for (const k of Object.keys(c.ov).sort()) {
      if (k === 'kids') continue;
      for (const x of [k, ...(OV_SHARED[k] || [])]) f.ov[x] = c.ov[k] === true;
    }
  }
  return f;
}
// one measured property stands for these spec keys too
const OV_SHARED = { 'lay.pa': ['lay.sb'], 'abs.x': ['abs.y'], w: ['h'], min: ['max'], 'font.ff': ['font.fw', 'font.fst'], 'icon.color': ['icon.fill', 'icon.stroke', 'icon.sw'] };

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const has = (o, ...ks) => !!o && ks.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));

export function readFacts(result, measured = null) {
  const c = (result && result.cases) || {};
  const f = { ...DEFAULT_FACTS, shrinkFill: { ...DEFAULT_FACTS.shrinkFill }, measured };

  // lh: 15 px text, line-height 17.4 (1 line) and 21.75 (3 lines). The decision uses the stored value (v), because the
  //  text box height is ceil of the line-height total either way (ceil(17.4) = 18, ceil(3 x 21.75) = 66), which
  //  figmaTextBox already models, so h alone cannot tell keep from round.
  //  keep  : v1 ~ 17.4 and v3 ~ 21.75 (+-0.05 each; Figma stores 17.4 as a float32, 17.39999962)
  //  floor : v3 ~ 21 (+-0.05), the stored value was rounded down
  //  round : anything else (stored 17 / 22, per-line rounding)
  if (has(c.lh, 'v1', 'h1', 'v3', 'h3')) {
    const { v1, v3 } = c.lh;
    if (near(v1, 17.4, 0.05) && near(v3, 21.75, 0.05)) f.lineHeightFrac = 'keep';
    else if (near(v3, 21, 0.05)) f.lineHeightFrac = 'floor';
    else f.lineHeightFrac = 'round';
  }

  // tb: same string at letter-spacing 0 (w0) and 0.5 (w). Unrounded Chrome-like width = w0 + chars * ls;
  //  ceil  : measured w equals figmaTextBox(raw, h, ls).w (+-0.01) ; other: anything else
  if (has(c.tb, 'w0', 'w', 'chars', 'ls', 'h')) {
    const raw = c.tb.w0 + c.tb.chars * c.tb.ls;
    f.textBox = near(c.tb.w, figmaTextBox(raw, c.tb.h, c.tb.ls).w, 0.01) ? 'ceil' : 'other';
  }

  // scale: child x=10,w=90 in a 200 parent (padding 10, stroke 2), parent resized to 320.
  //  frame  : scales with the whole frame -> x 16, w 144 ; padding: scales the padded area (inner 180 -> 300) -> w 150
  //  pick whichever expected width the measured w is nearer to
  if (has(c.scale, 'x', 'w')) f.scaleBasis = Math.abs(c.scale.w - 144) <= Math.abs(c.scale.w - 150) ? 'frame' : 'padding';

  // zero: 0.01-wide SCALE anchor at x=100 in a 200 parent resized to 320 (expected anchor x 160, +-0.5);
  //  ok : anchor moved to 160, left child starts at the anchor (+-0.5), right child ends at the anchor's right edge (+-0.5)
  if (has(c.zero, 'ax', 'lx', 'rr', 'arr')) {
    const z = c.zero;
    f.zeroWidthAnchor = near(z.ax, 160, 0.5) && near(z.lx, z.ax, 0.5) && near(z.rr, z.arr, 0.5) ? 'ok' : 'moves';
  }

  // hug: SCALE child (x 25, w 50) in a HUG parent 100 wide; content grows to 200.
  //  ok : child scales with the parent (x = 25 * w/w0, w = 50 * w/w0, +-0.5) ; else breaks
  if (has(c.hug, 'w0', 'w', 'x', 'cw')) {
    const k = c.hug.w / c.hug.w0;
    f.scaleInHug = near(c.hug.x, 25 * k, 0.5) && near(c.hug.cw, 50 * k, 0.5) ? 'ok' : 'breaks';
  }

  // overlay: cell stroke 1 -> 4 with strokesIncludedInLayout=false and an absolute stretch overlay.
  //  ok : cell w/h unchanged (+-0.01) and the overlay matches the cell (+-0.5) ; else off
  if (has(c.overlay, 'w1', 'h1', 'w4', 'h4', 'ow', 'oh')) {
    const o = c.overlay;
    f.strokeOverlay = near(o.w4, o.w1, 0.01) && near(o.h4, o.h1, 0.01) && near(o.ow, o.w4, 0.5) && near(o.oh, o.h4, 0.5) ? 'ok' : 'off';
  }

  // shrink: row 240 -> 360, avatar 32 FIXED.
  //  maxWidth: FILL block with maxWidth 180 stays 180 (+-0.5) at both widths -> ok
  //  growText: grow=1 block follows the row (208 / 328, +-0.5) and its HEIGHT-autosize text fills it (+-0.5) -> ok
  if (has(c.shrink, 'a240', 'a360')) f.shrinkFill.maxWidth = near(c.shrink.a240, 180, 0.5) && near(c.shrink.a360, 180, 0.5) ? 'ok' : 'no';
  if (has(c.shrink, 'b240', 'b360', 'bt240', 'bt360')) {
    const s = c.shrink;
    f.shrinkFill.growText = near(s.b240, 208, 0.5) && near(s.b360, 328, 0.5) && near(s.bt240, s.b240, 0.5) && near(s.bt360, s.b360, 0.5) ? 'ok' : 'no';
  }

  // base: baseline offset between the 22 px and 12.5 px texts <= 0.5 px -> ok
  if (has(c.base, 'b1', 'b2')) f.baseline = Math.abs(c.base.b1 - c.base.b2) <= 0.5 ? 'ok' : 'off';

  return f;
}

const FACTS_PATH = fileURLToPath(new URL('./figma-facts.json', import.meta.url));

const cmpOf = (c) => ({ ...DEFAULT_FACTS.cmp, ...(c || {}), props: { ...DEFAULT_FACTS.cmp.props, ...((c && c.props) || {}) } });

export function loadFacts(path = FACTS_PATH) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ...DEFAULT_FACTS, shrinkFill: { ...DEFAULT_FACTS.shrinkFill }, cmp: cmpOf() }; }
  return { ...DEFAULT_FACTS, ...raw, shrinkFill: { ...DEFAULT_FACTS.shrinkFill, ...(raw.shrinkFill || {}) }, cmp: cmpOf(raw.cmp) };
}
