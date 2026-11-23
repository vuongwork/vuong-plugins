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

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const has = (o, ...ks) => !!o && ks.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));

export function readFacts(result, measured = null) {
  const c = (result && result.cases) || {};
  const f = { ...DEFAULT_FACTS, shrinkFill: { ...DEFAULT_FACTS.shrinkFill }, measured };

  // lh: 15 px text, line-height 17.4 (1 line) and 21.75 (3 lines).
  //  keep  : lineHeight.value ~ 17.4 (+-0.05) and heights ~ 17.4 / 65.25 (+-0.05 / +-0.15)
  //  floor : h3 ~ 63 (3 x floor(21.75) = 21) ; round (anything else): e.g. h3 ~ 66 (3 x 22)
  if (has(c.lh, 'v1', 'h1', 'v3', 'h3')) {
    const { v1, h1, h3 } = c.lh;
    if (near(v1, 17.4, 0.05) && near(h1, 17.4, 0.05) && near(h3, 65.25, 0.15)) f.lineHeightFrac = 'keep';
    else if (near(h3, 63, 0.15)) f.lineHeightFrac = 'floor';
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

export function loadFacts(path = FACTS_PATH) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ...DEFAULT_FACTS, shrinkFill: { ...DEFAULT_FACTS.shrinkFill } }; }
  return { ...DEFAULT_FACTS, ...raw, shrinkFill: { ...DEFAULT_FACTS.shrinkFill, ...(raw.shrinkFill || {}) } };
}
