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
// Pipeline per run (as Task 6/8): mutated inferred spec -> layout proxy (unmodelled, mark 'none') and
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
// No candidate -> { kind, target: null, caught: null, by: [], skipped: 'no candidate' }; runMutations never throws for
// that.
//
// caught: the mutated report has a failure that the unmutated baseline report does not have (same key), on a node
// the mutation touched: the target, its ancestors and descendants, or a node whose layout or modelled proxy box
// changed (moved, resized, gone). Failures and `by`: 'root' (unexplained root, key id+width), 'crop' (crop fail,
// id+width), 'data' (id+kind), 'approval' (needsApproval, id+width), 'coverage' (unchecked node, id). A mutation that
// only shows up as an explained root is NOT caught (listed in `explainedOnly`). allCaught = null when no kind ran (R34), else every result that was run
// is caught (skipped ones do not count).
import { applyFigmaModel } from './figma-model.mjs';
import { buildProxyHtml, renderProxy } from './proxy.mjs';
import { verifyScreenWithImages, normColor } from './verify.mjs';

export const KINDS = ['moveShape', 'moveText', 'swapIcon', 'deleteLeaf', 'hideLeaf', 'thinStrokeSmall', 'thinStroke4000', 'drift', 'gap'];
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
  }
}

// ---------------- pipeline and comparison ----------------

async function pipeline(browser, screen, spec, flags, fontMap, opts) {
  const mod = applyFigmaModel(spec, fontMap, { rendered: screen.fontsRendered });
  const fc = screen.fontCss || {};
  const po = { fontLinks: fc.links || [], fontFaces: fc.faces || [], ...(opts.proxy || {}) };
  const at = (sp, i) => renderProxy(browser, buildProxyHtml(sp, screen.svgDefs || {}, fontMap, po), screen.W[i], { origin: screen.origin[i] });
  const proxy = { A: await at(mod.spec, 0), B: await at(mod.spec, 1) };
  const layout = { A: await at(spec, 0), B: await at(spec, 1) };
  const report = await verifyScreenWithImages(browser, { screen, spec: mod.spec, proxy, layout, flags: [...flags, ...mod.flags] }, opts.verify || {});
  return { report, proxy, layout };
}

function failures(r) {
  return [
    ...r.roots.filter((x) => !x.explainedBy).map((x) => ({ check: 'root', key: `root|${x.id}|${x.width}`, id: x.id, why: x.why })),
    ...r.crop.map((c) => ({ check: 'crop', key: `crop|${c.id}|${c.width}`, id: c.id })),
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
  for (const P of ['layout', 'proxy']) {
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
  const base = await pipeline(browser, screen, inferred.spec, flags, fontMap, opts);
  const before = new Set(failures(base.report).map((f) => f.key));
  const results = [];
  for (const kind of kinds) {
    const pick = opts.targets && opts.targets[kind] ? pickId(kind, inferred.spec, opts.targets[kind]) : choose(kind, inferred.spec, src);
    if (!pick) { results.push({ kind, target: null, caught: null, by: [], skipped: 'no candidate' }); continue; }
    const spec = clone(inferred.spec);
    mutate(kind, spec, pick, base.layout);
    const run = await pipeline(browser, screen, spec, flags, fontMap, opts);
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
    allCaught: ran.length ? ran.every((r) => r.caught === true) : null, // R34 (M3): null when no kind ran
  };
}
