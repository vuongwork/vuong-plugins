// Mutation check of the verifier (spec §14 layer 4): plant a known error in the inferred spec, i.e. simulate a wrong
// Figma output, run the real pipeline and see whether verify notices it.
//
// runMutations(browser, screen, inferred, fontMap, opts?) -> { id, baseline, results, allCaught }
//   screen   = captureScreens(..., { png: true }).screens[i] (uses png, origin, W, svgDefs, fontCss, fontsRendered)
//   inferred = inferScreen(screen) ({ spec, flags })
//   fontMap  = the FontMap given to applyFigmaModel / buildProxyHtml
//   opts.kinds  = subset of KINDS, in that order (default all)
//   opts.targets = { kind: node id } overrides the generic choice (tests on purpose-built fixtures); an id that is not
//                  in the spec, or a swapIcon target without another icon, is 'no candidate'
//   opts.proxy  = extra buildProxyHtml options (e.g. { webFonts: false })
//   opts.verify = verifyScreenWithImages options (tolerances; a loose verifier must come out allCaught false)
//   opts.norm   = { spec, applied, entries? } (R66: applyNorm of the modelled spec; m8: the entries verify checks the
//                 records against); used only by the norm kinds, whose baseline is the run with it; the result then
//                 carries normBaseline { pass, failures, norm }
//   opts.screenIndex = the screen's index in its file (normWrongValue rotates its record category by it; default 0)
// Pipeline per run (pipeline.mjs runScreen, as Task 6/8): mutated inferred spec -> layout proxy (unmodelled, mark 'none') and
// applyFigmaModel -> modelled proxy (mark 'figma'), both rendered at A and B with { origin: screen.origin[i] }, then
// verifyScreenWithImages. The mutation is applied to the inferred spec BEFORE both proxies.
//
// Kinds; targets are chosen by node type and size, first eligible in tree order (stable), never by selector:
//  - moveShape: a non-text, non-icon leaf (frame or image) of area <= 4000px² moves 3px right.
//  - moveText: a text leaf with visible text moves 3px right.
//    A flow child is taken out of flow as an absolute child at its layout-proxy place (+3px), with constraints read
//    from how it sat in its parent at A and B (L/R/LR/C, T/B/TB/C); an invisible clone (`<id>~ghost`, syn) keeps its
//    slot so the siblings do not move. An absolute child just gets abs.x + 3.
//  - swapIcon: an icon takes the identity (ref / glyph / svg) of the first icon of the screen with a different one.
//  - deleteLeaf: a leaf is removed; a pseudo-element leaf first, else a leaf of area <= 4000px².
//  - hideLeaf: the first leaf with something visible (text, icon, image, background, border) gets opacity 0; its box
//    stays.
//  - thinStrokeSmall / thinStroke4000: a 1px solid bottom stroke (a divider) in a contrasting colour is added to (or
//    recoloured on) a source frame: the first one of area 16-1000px² (sides >= 4px), resp. the largest one of area
//    2500-4000px² (the crop area limit is 4000px²).
//  - drift: every flow item of the first auto-layout container with >= 4 flow items, none FILL on the main axis, no
//    wrap / space-between, grows by 0.4px on the main axis (below tolerance each, accumulating along the row). FIXED
//    and non-hugging leaves: size + 0.4; HUG frames with auto layout: far padding + 0.4; HUG text: FIXED at its
//    layout-proxy size + 0.4 (only if its source main size is the same at A and B, else the container is not
//    eligible).
//  - gap: the gap of the first auto-layout container with >= 2 flow items (not space-between) grows by 3px.
//  R50, paint on large nodes (source area > 4000px², where no container crop runs):
//  - radiusLarge: the first frame with a corner radius loses it (all corners 0); else the first one with a background
//    gets 12px corners.
//  - fontLarge: the first text leaf with visible text switches weight (>= 600 -> 400, else 700) on all its runs.
//  - svgLarge: the first inline svg icon gets a small magenta square drawn first inside it (markup changed).
//  - imageLarge: the first image switches object-fit (cover -> contain, anything else -> cover).
//  M-f: svgLarge / imageLarge take the first candidate above 4000px², else the largest one of any size.
//  R66, the normalised spec (only with opts.norm = { spec, applied } holding >= 1 applied record, else skipped with
//  'no norm'; the plan-1 kinds above always run without the norm, on their own baseline):
//  - normSilent: the target spec changes a padding no record covers: the first auto-layout frame (no wrap) with a
//    padding array and >= 1 flow item whose main-axis packing is start (or that HUGs on its main axis), preferring
//    one without a padding record; its near main-axis padding grows by 4px.
//  - normWrongValue: one applied record lies about its value while the target spec keeps the real one (its entry,
//    when opts.norm.entries is given, lies the same way, so the measurement has to catch it, m8 aside): m6, the
//    categories the records have, in the order space, size, icon, type, border, radius, colour, rotate by screen
//    index (category k = screenIndex mod their number; the first record of it); a number gets to + 4, a colour each
//    channel moved by 96 (towards the middle).
//  - normCropHide (m6): a real paint fault on a node that carries a paint / type / icon record (cat colour, radius,
//    icon, type; ICON_FRAME / SRC_SQUASH), which that record does not cover: a text with visible text (preferred) gets
//    its text reversed (or its first character replaced), an icon takes another icon's identity. The fault goes into
//    the inferred spec (so the layout, modelled and norm layout proxies draw it) and into the target spec (the norm
//    proxy draws it; no spec difference for the static audit to see). No such record: skipped 'no candidate'.
//  - normLayoutDrift (m6): the norm layout proxy alone draws one frame's children 4 px further along its main axis
//    (its near padding + 4 in the replayed spec, no record says so; normSilent's candidate). R78 must catch it.
//  The baseline for all four is the unmutated run with opts.norm.
// No candidate -> { kind, target: null, caught: null, by: [], skipped: 'no candidate' }; runMutations never throws for
// that.
//
// caught: the mutated report has a failure that the unmutated baseline report does not have (same key), on a node
// the mutation touched: the target, its ancestors and descendants, or a node whose layout or modelled proxy box
// changed (moved, resized, gone). Failures and `by`: 'root' (unexplained root, key id+width), 'crop' (crop fail,
// id+width), 'data' (id+kind), 'approval' (needsApproval, id+width), 'coverage' (unchecked node, id). A mutation that
// only shows up as an explained root is NOT caught (listed in `explainedOnly`). allCaught = null when no kind ran (R34), else every result that was run
// is caught (skipped ones do not count).
import { normColor } from './verify.mjs';
import { runScreen } from './pipeline.mjs';
import { ordOf, decode, actualNodes } from './figma-check.mjs';

export const KINDS = ['moveShape', 'moveText', 'swapIcon', 'deleteLeaf', 'hideLeaf', 'thinStrokeSmall', 'thinStroke4000', 'drift', 'gap',
  'radiusLarge', 'fontLarge', 'svgLarge', 'imageLarge', 'normSilent', 'normWrongValue', 'normCropHide', 'normLayoutDrift'];
const NORM_KINDS = new Set(['normSilent', 'normWrongValue', 'normCropHide', 'normLayoutDrift']);
const PAINT_REC = (a) => ['color', 'radius', 'icon', 'type'].includes(a.cat) || a.code === 'ICON_FRAME' || a.code === 'SRC_SQUASH';
const NORM_PAD = 4, NORM_WRONG = 4, NORM_COLOR = 96;
const REC_ORDER = ['space', 'size', 'icon', 'type', 'border', 'radius', 'color'];
const MOVE = 3, DRIFT = 0.4, GAP = 3, SMALL = 4000;
const BOX_EPS = 0.05, AT_EPS = 0.5;
const W = ['A', 'B'];

const clone = (o) => JSON.parse(JSON.stringify(o));
const isLeaf = (n) => !n.kids || n.kids.length === 0;
const textOf = (n) => (n.runs || []).map((r) => r.t || '').join('');
const iconKey = (ic) => (!ic ? null : ic.ref ? `ref:${ic.ref}` : ic.glyph != null ? `glyph:${ic.glyph}` : ic.svg ? `svg:${ic.svg}` : null);
const flowKids = (n) => (n.lay && n.lay.d ? (n.kids || []).filter((k) => !k.abs) : []);
const opaque = (c) => normColor(c) !== 'transparent';

// spec nodes in pre-order with their spec parent
function walk(spec) {
  const out = [];
  const v = (n, parent) => { out.push({ n, parent }); for (const k of n.kids || []) v(k, n); };
  v(spec, null);
  return out;
}
const find = (spec, id) => walk(spec).find((e) => e.n.id === id);

function luminance(c) {
  const m = /rgba?\(([^)]+)\)/.exec(normColor(c));
  if (!m) return 1;
  const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------------- target choice (stable: first eligible in tree order) ----------------

const firstLargeOrLargest = (cands, areaA) => cands.find((e) => areaA(e.n) > SMALL) || cands.reduce((b, e) => (!b || areaA(e.n) > areaA(b.n) ? e : b), null);
function choose(kind, spec, src) {
  const all = walk(spec).filter((e) => e.parent); // never the root itself as a leaf target
  const srcOf = (n) => src.get(n.id);
  const areaA = (n) => { const s = srcOf(n); return s && s.rA ? s.rA[2] * s.rA[3] : n.w * n.h; };
  const leaves = all.filter((e) => isLeaf(e.n) && !e.n.syn);
  switch (kind) {
    case 'moveShape':
      return leaves.find((e) => (e.n.t === 'F' || e.n.t === 'I') && areaA(e.n) > 0 && areaA(e.n) <= SMALL) || null;
    case 'moveText':
      return leaves.find((e) => e.n.t === 'T' && textOf(e.n).trim() !== '') || null;
    case 'swapIcon': {
      const icons = walk(spec).filter((e) => e.n.t === 'V' && iconKey(e.n.icon));
      for (const e of icons) {
        const other = icons.find((o) => iconKey(o.n.icon) !== iconKey(e.n.icon));
        if (other) return { ...e, other: other.n };
      }
      return null;
    }
    case 'deleteLeaf':
      return leaves.find((e) => srcOf(e.n) && srcOf(e.n).kind === 'pseudo') ||
        leaves.find((e) => areaA(e.n) > 0 && areaA(e.n) <= SMALL) || null;
    case 'hideLeaf':
      return leaves.find(({ n }) => {
        const p = n.paint || {};
        return (n.t === 'T' && textOf(n).trim() !== '') || n.t === 'V' || n.t === 'I' || opaque(p.bg) || !!p.bgImage ||
          (Array.isArray(p.border) && p.border.some((s) => s && s.w > 0));
      }) || null;
    case 'thinStrokeSmall':
      return all.find((e) => e.n.t === 'F' && srcOf(e.n) && areaA(e.n) >= 16 && areaA(e.n) <= 1000 &&
        Math.min(srcOf(e.n).rA[2], srcOf(e.n).rA[3]) >= 4) || null;
    case 'thinStroke4000': {
      let best = null;
      for (const e of all) {
        if (e.n.t !== 'F' || !srcOf(e.n)) continue;
        const a = areaA(e.n);
        if (a >= 2500 && a <= SMALL && (!best || a > areaA(best.n))) best = e;
      }
      return best;
    }
    case 'drift':
      return walk(spec).find(({ n }) => {
        const ks = flowKids(n);
        if (ks.length < 4 || n.lay.wrap || n.lay.sb) return false;
        const ax = n.lay.d === 'H' ? 0 : 1;
        return ks.every((k) => {
          const s = (k.sz && k.sz[ax]) || 'FIXED';
          if (s === 'FILL') return false;
          if (s === 'HUG' && k.t === 'T') {
            const q = srcOf(k);
            return !!q && !!q.rB && Math.abs(q.rA[ax + 2] - q.rB[ax + 2]) <= AT_EPS;
          }
          return true;
        });
      }) || null;
    case 'gap':
      return walk(spec).find(({ n }) => flowKids(n).length >= 2 && !n.lay.sb) || null;
    case 'radiusLarge': {
      const big = all.filter((e) => e.n.t === 'F' && !e.n.syn && areaA(e.n) > SMALL);
      return big.find((e) => e.n.paint && Array.isArray(e.n.paint.radius) && e.n.paint.radius.some((r) => parseFloat(r) > 0)) ||
        big.find((e) => e.n.paint && (opaque(e.n.paint.bg) || e.n.paint.bgImage)) || null;
    }
    case 'fontLarge':
      return leaves.find((e) => e.n.t === 'T' && e.n.font && textOf(e.n).trim() !== '' && areaA(e.n) > SMALL) || null;
    // M-f: the first one above SMALL, else the largest one (a screen with only small svgs / images still tests them)
    case 'svgLarge':
      return firstLargeOrLargest(leaves.filter((e) => e.n.t === 'V' && e.n.icon && e.n.icon.svg), areaA);
    case 'imageLarge':
      return firstLargeOrLargest(leaves.filter((e) => e.n.t === 'I' && e.n.src), areaA);
    default:
      throw new Error(`runMutations: unknown kind ${kind}`);
  }
}

function pickId(kind, spec, id) {
  const e = find(spec, id);
  if (!e || (!e.parent && /^(move|delete|hide|thin)/.test(kind))) return null;
  if (kind !== 'swapIcon') return e;
  const other = walk(spec).find((o) => o.n.t === 'V' && iconKey(o.n.icon) && iconKey(o.n.icon) !== iconKey(e.n.icon));
  return other && iconKey(e.n.icon) ? { ...e, other: other.n } : null;
}

// ---------------- mutations (on a clone of the inferred spec) ----------------

// constraint of a child on one axis from its place in the parent at A and B (layout proxy boxes)
function constraint(tA, pA, tB, pB, ax) {
  const [L, R, LR, C] = ax === 0 ? ['L', 'R', 'LR', 'C'] : ['T', 'B', 'TB', 'C'];
  if (!tB || !pB) return L;
  if (Math.abs(tA[ax + 2] - tB[ax + 2]) > AT_EPS) return LR;
  const near = (t, p) => t[ax] - p[ax], far = (t, p) => p[ax] + p[ax + 2] - (t[ax] + t[ax + 2]);
  if (Math.abs(near(tA, pA) - near(tB, pB)) <= AT_EPS) return L;
  if (Math.abs(far(tA, pA) - far(tB, pB)) <= AT_EPS) return R;
  return C;
}

function move(spec, id, base) {
  const { n, parent } = find(spec, id);
  if (n.abs) { n.abs = { ...n.abs, x: n.abs.x + MOVE }; return; }
  const tA = base.A.boxes[n.id], pA = base.A.boxes[parent.id], tB = base.B.boxes[n.id], pB = base.B.boxes[parent.id];
  if (!(parent.lay && parent.lay.d)) { n.abs = { x: tA[0] - pA[0] + MOVE, y: tA[1] - pA[1], c: 'L' }; return; }
  // keep the slot with an invisible clone, then place the node absolutely where it was, 3px further right
  const ghost = { ...clone(n), id: `${n.id}~ghost`, syn: true, paint: { ...(n.paint || {}), opacity: 0 } };
  parent.kids.splice(parent.kids.indexOf(n), 0, ghost);
  const c = constraint(tA, pA, tB, pB, 0), cy = constraint(tA, pA, tB, pB, 1);
  n.w = tA[2]; n.h = tA[3];
  n.abs = { x: tA[0] - pA[0] + MOVE, y: tA[1] - pA[1], c };
  if (cy !== 'T') n.abs.cy = cy;
}

function contrast(spec, id) {
  const path = [];
  for (let e = find(spec, id); e; e = e.parent ? find(spec, e.parent.id) : null) path.push(e.n);
  const bg = path.map((n) => n.paint && n.paint.bg).find(opaque) || 'rgb(255, 255, 255)';
  return luminance(bg) > 0.5 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
}

function mutate(kind, spec, pick, base) {
  const id = pick.n.id;
  switch (kind) {
    case 'moveShape': case 'moveText': move(spec, id, base); break;
    case 'swapIcon': {
      const { n } = find(spec, id), ic = pick.other.icon;
      const icon = { ...n.icon }; delete icon.ref; delete icon.glyph; delete icon.svg;
      for (const k of ['ref', 'glyph', 'svg']) if (ic[k] != null) icon[k] = ic[k];
      n.icon = icon;
      if (ic.glyph != null && pick.other.font) n.font = clone(pick.other.font);
      break;
    }
    case 'deleteLeaf': { const { n, parent } = find(spec, id); parent.kids.splice(parent.kids.indexOf(n), 1); break; }
    case 'hideLeaf': { const { n } = find(spec, id); n.paint = { ...(n.paint || {}), opacity: 0 }; break; }
    case 'thinStrokeSmall': case 'thinStroke4000': {
      const { n } = find(spec, id);
      const p = n.paint = { ...(n.paint || {}) };
      const border = Array.isArray(p.border) ? clone(p.border) : [0, 1, 2, 3].map(() => ({ w: 0, style: 'none', color: 'rgb(0, 0, 0)' }));
      let color = contrast(spec, id);
      if (border[2] && border[2].w > 0 && normColor(border[2].color) === color) color = 'rgb(255, 0, 0)';
      border[2] = { w: 1, style: 'solid', color };
      p.border = border;
      break;
    }
    case 'drift': {
      const { n } = find(spec, id);
      const ax = n.lay.d === 'H' ? 0 : 1, dim = ax === 0 ? 'w' : 'h';
      for (const k of flowKids(n)) {
        const s = (k.sz && k.sz[ax]) || 'FIXED';
        if (s === 'HUG' && k.t === 'T') {
          k.sz = [...k.sz]; k.sz[ax] = 'FIXED';
          k[dim] = base.A.boxes[k.id][ax + 2] + DRIFT;
        } else if (s === 'HUG' && k.t === 'F' && k.lay && k.lay.d) {
          const pd = [...(k.lay.p || [0, 0, 0, 0])]; pd[ax === 0 ? 1 : 2] += DRIFT; k.lay = { ...k.lay, p: pd };
        } else k[dim] += DRIFT;
      }
      break;
    }
    case 'gap': { const { n } = find(spec, id); n.lay = { ...n.lay, g: (n.lay.g || 0) + GAP }; break; }
    case 'radiusLarge': {
      const { n } = find(spec, id), p = n.paint = { ...(n.paint || {}) };
      const had = Array.isArray(p.radius) && p.radius.some((r) => parseFloat(r) > 0);
      p.radius = [0, 1, 2, 3].map(() => (had ? '0px' : '12px'));
      break;
    }
    case 'fontLarge': {
      const { n } = find(spec, id);
      n.font = { ...n.font, fw: (parseFloat(n.font.fw) || 400) >= 600 ? '400' : '700' };
      n.runs = (n.runs || []).map((r) => { if (!r.s || r.s.fw == null) return r; const s = { ...r.s }; delete s.fw; return Object.keys(s).length ? { ...r, s } : { t: r.t }; });
      break;
    }
    case 'svgLarge': {
      const { n } = find(spec, id);
      n.icon = { ...n.icon, svg: String(n.icon.svg).replace(/^(<svg\b[^>]*>)/, '$1<rect x="0" y="0" width="25%" height="25%" fill="rgb(255, 0, 255)"></rect>') };
      break;
    }
    case 'imageLarge': { const { n } = find(spec, id); n.fit = n.fit === 'cover' ? 'contain' : 'cover'; break; }
  }
}

// ---------------- R66: norm mutations (on the target spec / the applied records) ----------------

function chooseNorm(kind, norm, screenIndex = 0) {
  if (kind === 'normCropHide') {
    const icons = walk(norm.spec).filter((e) => e.n.t === 'V' && iconKey(e.n.icon) && !e.n.icon.glyph);
    let best = null;
    for (const a of norm.applied.filter(PAINT_REC)) {
      const e = find(norm.spec, String(a.node));
      if (!e) continue;
      if (e.n.t === 'T' && textOf(e.n).trim() !== '') return { n: { id: e.n.id }, rec: a, how: 'text' };
      if (!best && e.n.t === 'V' && iconKey(e.n.icon) && e.n.icon.glyph == null) {
        const other = icons.find((o) => iconKey(o.n.icon) !== iconKey(e.n.icon));
        if (other) best = { n: { id: e.n.id }, rec: a, how: 'icon', other: other.n };
      }
    }
    return best;
  }
  if (kind === 'normSilent' || kind === 'normLayoutDrift') {
    const padded = new Set(norm.applied.filter((a) => /^padding/.test(a.prop)).map((a) => String(a.node)));
    const cands = walk(norm.spec).filter(({ n }) => {
      if (!n.lay || !n.lay.d || n.lay.wrap || !Array.isArray(n.lay.p) || !flowKids(n).length) return false;
      const ax = n.lay.d === 'H' ? 0 : 1;
      return (n.sz && n.sz[ax] === 'HUG') || (!n.lay.sb && (n.lay.pa ?? 'S') === 'S');
    });
    const e = cands.find(({ n }) => !padded.has(String(n.id))) || cands[0];
    return e ? { n: e.n } : null;
  }
  const rank = (a) => { const i = REC_ORDER.indexOf(a.cat); return i < 0 ? REC_ORDER.length : i; };
  const ok = norm.applied.filter((a) => (a.cat === 'color' ? typeof a.to === 'string' : typeof a.to === 'number'));
  const cats = [...new Set(ok.map(rank))].sort((a, b) => a - b);
  if (!cats.length) return null;
  const cat = cats[((screenIndex % cats.length) + cats.length) % cats.length];
  const r = ok.find((a) => rank(a) === cat);
  return { n: { id: String(r.node) }, rec: r };
}

// the near main-axis padding of frame id grows by NORM_PAD (in place)
const padNear = (spec, id) => {
  const e = find(spec, id);
  if (!e || !e.n.lay || !Array.isArray(e.n.lay.p)) return;
  const p = [...e.n.lay.p];
  p[e.n.lay.d === 'H' ? 3 : 0] += NORM_PAD;
  e.n.lay = { ...e.n.lay, p };
};
// m6 normCropHide: the paint fault on node id (in place)
function hidePaint(spec, pick) {
  const e = find(spec, pick.n.id);
  if (!e) return;
  const n = e.n;
  if (pick.how === 'text') {
    const i = (n.runs || []).findIndex((r) => !r.br && String(r.t || '').trim() !== '');
    const t = String(n.runs[i].t), rev = [...t].reverse().join('');
    const j = t.search(/\S/);
    n.runs = n.runs.map((r, k) => (k === i ? { ...r, t: rev !== t ? rev : t.slice(0, j) + (t[j] === 'X' ? 'Y' : 'X') + t.slice(j + 1) } : r));
    return;
  }
  const icon = { ...n.icon }; delete icon.ref; delete icon.glyph; delete icon.svg;
  for (const k of ['ref', 'svg']) if (pick.other.icon[k] != null) icon[k] = pick.other.icon[k];
  n.icon = icon;
}

function mutateNorm(kind, norm, pick) {
  if (kind === 'normSilent') {
    const spec = clone(norm.spec);
    padNear(spec, pick.n.id);
    return { ...norm, spec };
  }
  if (kind === 'normCropHide') {
    const spec = clone(norm.spec);
    hidePaint(spec, pick);
    return { ...norm, spec };
  }
  if (kind === 'normLayoutDrift') return norm;
  const i = norm.applied.indexOf(pick.rec), r = { ...pick.rec };
  if (r.cat === 'color') {
    const m = /^#?([0-9a-f]{6})/i.exec(r.to);
    const ch = m ? [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)) : [0, 0, 0];
    r.to = '#' + ch.map((c) => (c > 127 ? c - NORM_COLOR : c + NORM_COLOR).toString(16).padStart(2, '0')).join('');
  } else r.to += NORM_WRONG;
  const applied = [...norm.applied]; applied[i] = r;
  // the entry (m8) lies the same way, so only the measurement can catch the lie
  const entries = Array.isArray(norm.entries) ? norm.entries.map((x) => (String(x.id) === String(r.entry) ? { ...x, to: r.to } : x)) : norm.entries;
  return { ...norm, applied, ...(entries ? { entries } : {}) };
}

// ---------------- pipeline and comparison ----------------

// the shared pipeline (pipeline.mjs runScreen); flags = the inferred flags (runScreen adds the model's)
const pipeline = (browser, screen, spec, flags, fontMap, opts) => runScreen(browser, screen, { spec, flags }, fontMap, opts);

function failures(r) {
  return [
    ...r.roots.filter((x) => !x.explainedBy).map((x) => ({ check: 'root', key: `root|${x.id}|${x.width}`, id: x.id, why: x.why })),
    ...[...r.crop, ...(r.cropLinked || [])].map((c) => ({ check: 'crop', key: `crop|${c.id}|${c.width}`, id: c.id })),
    ...r.data.map((d) => ({ check: 'data', key: `data|${d.id}|${d.kind}`, id: d.id })),
    ...r.needsApproval.map((m) => ({ check: 'approval', key: `approval|${m.id}|${m.width}`, id: m.id })),
    ...r.unchecked.map((id) => ({ check: 'coverage', key: `coverage|${id}`, id })),
  ];
}

// ids the mutation touched: target, its spec ancestors and descendants, and nodes whose proxy boxes changed
function touched(spec, id, base, run) {
  const out = new Set([id]);
  const e = find(spec, id);
  if (e) {
    for (const x of walk(e.n)) out.add(x.n.id);
    for (const a of walk(spec)) if (a.n.kids && walk(a.n).some((x) => x.n.id === id)) out.add(a.n.id);
  }
  for (const P of ['layout', 'proxy', 'norm', 'normLayout']) {
    if (!base[P] || !run[P]) continue;
    for (const M of W) {
      const b0 = base[P][M].boxes, b1 = run[P][M].boxes;
      for (const k of Object.keys(b0)) {
        if (!b1[k] || b0[k].some((v, i) => Math.abs(v - b1[k][i]) > BOX_EPS)) out.add(k);
      }
    }
  }
  return out;
}

export async function runMutations(browser, screen, inferred, fontMap, opts = {}) {
  const kinds = opts.kinds || KINDS;
  for (const k of kinds) if (!KINDS.includes(k)) throw new Error(`runMutations: unknown kind ${k}`);
  const src = new Map();
  const idx = (n) => { src.set(n.id, n); (n.kids || []).forEach(idx); };
  idx(screen.tree);
  const flags = inferred.flags || [];
  const { norm, screenIndex, ...plain } = opts;
  const hasNorm = !!norm && Array.isArray(norm.applied) && norm.applied.length > 0;
  const base = await pipeline(browser, screen, inferred.spec, flags, fontMap, plain);
  const before = new Set(failures(base.report).map((f) => f.key));
  const results = [];
  let normBase = null;
  for (const kind of kinds) {
    if (NORM_KINDS.has(kind)) {
      if (!hasNorm) { results.push({ kind, target: null, caught: null, by: [], skipped: 'no norm' }); continue; }
      const pick = chooseNorm(kind, norm, opts.screenIndex ?? 0);
      if (!pick) { results.push({ kind, target: null, caught: null, by: [], skipped: 'no candidate' }); continue; }
      normBase ??= await pipeline(browser, screen, inferred.spec, flags, fontMap, { ...plain, norm });
      const nBefore = new Set(failures(normBase.report).map((f) => f.key));
      let spec = inferred.spec;
      if (kind === 'normCropHide') { spec = clone(inferred.spec); hidePaint(spec, pick); }
      const extra = kind === 'normLayoutDrift' ? { normLayoutTweak: (ls) => padNear(ls, pick.n.id) } : {};
      const run = await pipeline(browser, screen, spec, flags, fontMap, { ...plain, ...extra, norm: mutateNorm(kind, norm, pick) });
      const hit = touched(norm.spec, pick.n.id, normBase, run);
      const fresh = failures(run.report).filter((f) => !nBefore.has(f.key));
      const caughtBy = fresh.filter((f) => hit.has(f.id));
      const by = [...new Set(caughtBy.map((f) => f.check))];
      results.push({
        kind, target: pick.n.id, ...(pick.rec ? { record: { entry: pick.rec.entry, prop: pick.rec.prop, from: pick.rec.from, to: pick.rec.to } } : {}),
        caught: by.length > 0, by, found: caughtBy.map((f) => f.key),
        ...(fresh.length > caughtBy.length ? { elsewhere: fresh.filter((f) => !hit.has(f.id)).map((f) => f.key) } : {}),
      });
      continue;
    }
    const pick = opts.targets && opts.targets[kind] ? pickId(kind, inferred.spec, opts.targets[kind]) : choose(kind, inferred.spec, src);
    if (!pick) { results.push({ kind, target: null, caught: null, by: [], skipped: 'no candidate' }); continue; }
    const spec = clone(inferred.spec);
    mutate(kind, spec, pick, base.layout);
    const run = await pipeline(browser, screen, spec, flags, fontMap, plain);
    const hit = touched(inferred.spec, pick.n.id, base, run);
    const fresh = failures(run.report).filter((f) => !before.has(f.key));
    const caughtBy = fresh.filter((f) => hit.has(f.id));
    const baseExplained = new Set(base.report.roots.filter((x) => x.explainedBy).map((x) => `${x.id}|${x.width}`));
    const explainedOnly = run.report.roots.filter((x) => x.explainedBy && hit.has(x.id) && !baseExplained.has(`${x.id}|${x.width}`))
      .map((x) => ({ id: x.id, width: x.width, why: x.why, explainedBy: x.explainedBy }));
    const by = [...new Set(caughtBy.map((f) => f.check))];
    results.push({
      kind, target: pick.n.id, caught: by.length > 0, by,
      found: caughtBy.map((f) => f.key), ...(explainedOnly.length ? { explainedOnly } : {}),
      ...(fresh.length > caughtBy.length ? { elsewhere: fresh.filter((f) => !hit.has(f.id)).map((f) => f.key) } : {}),
    });
  }
  const ran = results.filter((r) => r.caught !== null);
  const b = base.report;
  return {
    id: screen.id,
    baseline: { pass: b.pass, failures: before.size, roots: b.roots.filter((x) => !x.explainedBy).length, crop: b.crop.length, data: b.data.length, needsApproval: b.needsApproval.length, unchecked: b.unchecked.length },
    results,
    ...(normBase ? { normBaseline: { pass: normBase.report.pass, failures: failures(normBase.report).length, norm: normBase.report.norm } } : {}),
    allCaught: ran.length ? ran.every((r) => r.caught === true) : null, // R34 (M3): null when no kind ran
  };
}

// ---- plan 3 Task 7: planted errors on the Figma readback (figma.mjs check --mutate) ----
// The readback (a BatchResult screen of figma-runtime.js) is changed as if Figma had built the node wrong, and the
// screen is verified again on it; the screenshot and its crops stay as measured. Targets, first eligible in readback
// order (ordOf: pre-order of the encoded tree), source nodes only, never the screen root:
//  - figMove: the first source leaf's box moves 3px right (at A, and at B with it: B = A + dB).
//  - figText: the first text node with visible text gets its first non-blank character replaced ('x', 'y' for an x).
//  - figFill: the first frame / image source node with a solid fill gets that colour inverted (each channel 255 - c;
//    magenta when that is too close); no such node: the root gets a magenta fill.
//  - figDrop: the last source leaf is removed from `nodes` (entry 0, as a node the runtime could not read back).
//  - figCase (batch data D.rd only, else 'not read back'): the first text node with a lower-case letter reads back
//    with textCase UPPER on every run (text-transform is not otherwise visible: its crop is reference only on Figma).
//  - figDash (D.rd only): the first node with a dashed / dotted stroke reads back without a dash pattern (solid); for a
//    stroke drawn by an overlay (bd.o) the overlay's entry `<o>#stroke` is the one changed (the node itself has no stroke).
//  - figIconPx: a pixel fault, the readback unchanged: the first icon leaf (another icon identity on the screen) is
//    drawn as that other icon in a proxy of the target spec, and its crop is measured against the Figma screenshot in
//    place of the real one (run(screen, { kind, o }) does the measuring; the icon identity itself is not read back).
// runFigMutations({ id, base (report on the real readback), screen (the screen result), D (batch data), tree (source
//   tree), spec (spec-norm tree), run: async (screen result) -> report }) -> { id, baseline, results, allCaught } as
//   runMutations: caught = a failure the baseline does not have (same keys) on the target, its spec ancestors or
//   descendants.
export const FIG_KINDS = ['figMove', 'figText', 'figFill', 'figDrop', 'figCase', 'figDash', 'figIconPx'];
const FIG_WN = ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'];
const invertHex = (h) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(h);
  if (!m) return '#ff00ff';
  const v = parseInt(m[1], 16), ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const inv = ch.map((c) => 255 - c);
  if (inv.every((c, i) => Math.abs(c - ch[i]) < 64)) return `#ff00ff${m[2] || ''}`;
  return `#${inv.map((c) => c.toString(16).padStart(2, '0')).join('')}${m[2] || ''}`;
};
const figActual = (sres, D) => actualNodes(decode({ screens: [clone(sres)] }, D).screens[0], D);

// swapIconSpec(spec, id) -> a copy of spec whose icon leaf id shows the first other icon identity of the spec, or null
export function swapIconSpec(spec, id) {
  const sp = clone(spec), e = find(sp, id);
  if (!e || e.n.t !== 'V' || !iconKey(e.n.icon) || e.n.icon.glyph != null) return null;
  const o = walk(sp).find((x) => x.n.t === 'V' && iconKey(x.n.icon) && x.n.icon.glyph == null && iconKey(x.n.icon) !== iconKey(e.n.icon));
  if (!o) return null;
  const icon = { ...e.n.icon }; delete icon.ref; delete icon.glyph; delete icon.svg;
  for (const k of ['ref', 'svg']) if (o.n.icon[k] != null) icon[k] = o.n.icon[k];
  e.n.icon = icon;
  return sp;
}

export function chooseFig(kind, sres, D, tree, spec) {
  const T = D.screens.find((x) => x.screen === sres.screen).T;
  const src = new Map();
  const idx = (n) => { src.set(n.id, n); (n.kids || []).forEach(idx); };
  idx(tree);
  const act = figActual(sres, D);
  const cands = ordOf(T).filter((o) => o !== T.o && src.has(o) && act.has(o));
  const leaves = cands.filter((o) => isLeaf(src.get(o)));
  if (kind === 'figMove') return leaves[0] || null;
  if (kind === 'figDrop') return leaves[leaves.length - 1] || null;
  if (kind === 'figText') return cands.find((o) => act.get(o).e.t === 'T' && /\S/.test(act.get(o).text || '')) || null;
  if (kind === 'figFill') {
    const o = cands.find((x) => { const n = act.get(x); return n.fills && n.e.t !== 'V' && n.fills.some((f) => /^#/.test(f)); });
    return o || (act.has(T.o) ? T.o : null);
  }
  if (kind === 'figCase') return cands.find((o) => { const n = act.get(o); return n.e.t === 'T' && n.text !== String(n.text).toUpperCase() && (n.runs || []).length; }) || null;
  if (kind === 'figDash') return cands.find((o) => /^(dashed|dotted)$/.test(act.get(o).dash || '') && (act.get(o).strokes || act.has(`${o}#stroke`))) || null;
  if (kind === 'figIconPx') return spec ? leaves.find((o) => src.get(o).kind === 'icon' && swapIconSpec(spec, o)) || null : null;
  return null;
}

export function mutateFig(kind, sres, D, o0) {
  const T = D.screens.find((x) => x.screen === sres.screen).T;
  const o = kind === 'figDash' && figActual(sres, D).has(`${o0}#stroke`) ? `${o0}#stroke` : o0;
  const i = ordOf(T).indexOf(o);
  const out = clone(sres);
  delete out.N;
  const t = out.nodes[i];
  if (kind === 'figDrop') { out.nodes[i] = 0; return out; }
  const [fid, A, dB, d0] = t;
  if (kind === 'figMove') { out.nodes[i] = [fid, [A[0] + MOVE, ...A.slice(1)], ...t.slice(2)]; return out; }
  const n = figActual(sres, D).get(o);
  const d = { ...(d0 || {}) };
  if (kind === 'figText') {
    const k = n.text.search(/\S/), c = n.text[k];
    d.text = n.text.slice(0, k) + (c === 'x' ? 'y' : 'x') + n.text.slice(k + 1);
  }
  if (kind === 'figFill') {
    const j = n.fills.findIndex((f) => /^#/.test(f));
    d.fills = j >= 0 ? n.fills.map((f, x) => (x === j ? invertHex(f) : f)) : ['#ff00ff', ...n.fills];
  }
  if (kind === 'figCase') {
    d.runs = n.runs.map((r) => {
      const w = Number(r.weight), st = (FIG_WN[w / 100 - 1] || String(r.weight)) + (r.italic ? ' Italic' : '');
      return [r.len, r.fs, `${r.family} ${st}`, r.fill, r.ts, r.fv, r.td || '', 'U'];
    });
  }
  if (kind === 'figDash') { const st = { ...n.strokes }; delete st.d; d.strokes = st; }
  out.nodes[i] = [fid, A, dB || 0, d];
  return out;
}

export async function runFigMutations({ id, base, screen: sres, D, tree, spec, run, kinds = FIG_KINDS }) {
  const before = new Set(failures(base).map((f) => f.key));
  const results = [];
  for (const kind of kinds) {
    if ((kind === 'figCase' || kind === 'figDash') && !(D && D.rd)) { results.push({ kind, target: null, caught: null, by: [], skipped: 'not read back (batch without D.rd)' }); continue; }
    const o = sres && sres.nodes ? chooseFig(kind, sres, D, tree, spec) : null;
    if (!o) { results.push({ kind, target: null, caught: null, by: [], skipped: sres && sres.nodes ? 'no candidate' : 'no readback' }); continue; }
    const rep = kind === 'figIconPx' ? await run(clone(sres), { kind, o }) : await run(mutateFig(kind, sres, D, o));
    if (!rep) { results.push({ kind, target: o, caught: null, by: [], skipped: 'no screenshot crop' }); continue; }
    const hit = new Set([o]);
    const e = find(spec, o);
    if (e) {
      for (const x of walk(e.n)) hit.add(x.n.id);
      for (const a of walk(spec)) if (a.n.kids && walk(a.n).some((x) => x.n.id === o)) hit.add(a.n.id);
    }
    const fresh = failures(rep).filter((f) => !before.has(f.key));
    const caughtBy = fresh.filter((f) => hit.has(f.id));
    const by = [...new Set(caughtBy.map((f) => f.check))];
    results.push({
      kind, target: o, caught: by.length > 0, by, found: caughtBy.map((f) => f.key),
      ...(fresh.length > caughtBy.length ? { elsewhere: fresh.filter((f) => !hit.has(f.id)).map((f) => f.key) } : {}),
    });
  }
  const ran = results.filter((r) => r.caught !== null);
  return { id, baseline: { pass: base.pass, failures: before.size }, results, allCaught: ran.length ? ran.every((r) => r.caught === true) : null };
}
