// The one verification pipeline (Task 8), shared by the CLI (layout.mjs), the acceptance test and mutate.mjs:
//   capture (png, font override R10, line-height override R14) -> inferScreen -> layout proxy of the inferred spec
//   (unmodelled, mark 'none') and applyFigmaModel -> modelled proxy (mark 'figma'), both rendered at A and B with
//   { origin: screen.origin[i] } -> verifyScreenWithImages.
//
// runScreen(browser, screen, inferred, fontMap, opts?) -> { report, proxy: {A, B}, layout: {A, B}, modelled }
//   screen   = captureScreens(..., { png: true }).screens[i]; inferred = { spec, flags } (inferScreen's, or a changed copy)
//   opts.proxy  = extra buildProxyHtml options (e.g. { webFonts: false }); opts.verify = verifyScreenWithImages options
//   modelled = applyFigmaModel's { spec, flags } (the modelled spec is what spec-<id>.json holds)
//   opts.norm = { spec, applied } (applyNorm of the modelled spec, R66): also renders the target spec at A and B (mark
//   'norm', returned as `norm`) and the records replayed on the inferred spec (replayApplied, unmodelled, mark
//   'normLayout', returned as `normLayout`; the crops are measured on it; if the replay throws, report.normLayoutError
//   is set and 'norm-crop' is skipped). Without opts.norm: exactly the plan-1 pipeline. opts.norm.entries (m8, the
//   normalize entries) is passed to verify, which cross-checks every record against them. opts.normLayoutTweak(spec)
//   (mutate.mjs normLayoutDrift only) changes the replayed spec in place before it is rendered.
// runFile(browser, htmlPath, opts) -> { file: htmlPath, screens: [{ screen, inferred, modelled, report, proxy, layout,
//   mutations? }] }
//   opts: root (required), widen, nameOf, widenBy, viewport, webFonts (false = no Google Fonts, R9 opt-out), fontMap
//   (default defaultFontMap()), verify ({ tolFrame, tolText, tolModel }), mutate (run runMutations too),
//   mutateSample (with mutate: only n screens of the file, spread evenly: indexes floor(k * N / n)), onScreen(entry)
//   (progress callback), normalize (plan 2, ds.mjs: async ([{ screen, inferred, modelled }] of every screen of the
//   file) -> [{ spec, applied } | null] in the same order: each screen's target spec; a target with at least one
//   applied record runs as opts.norm of runScreen and of runMutations, and the screen entry carries it as `target`;
//   without normalize, or with no applied record: the plan-1 run). R93: a target that ran as opts.norm has its HUG frame
//   sizes settled from the norm proxy at A (settleHug; target.settled lists them). Capture launches its own browser; proxies and
//   verify use `browser`.
// gate(report, allowlist, { file, screen, tree }) -> { pass, open: { roots, approvals, crops }, allowed: { roots, approvals,
//   crops } }: the screen gate after the allowlist (spec §14 layer 5). Allowlist entries are
//   { file, screen, node, width, kind: 'root'|'approval'|'crop', delta + why | ratio + peak, fingerprint, reason, approved };
//   ONLY approved === true entries are honoured, and only for unexplained roots, needsApproval entries and crop fails.
//   R51: an entry also carries what was approved: the magnitude (root / approval: delta [dx, dy, dw, dh]; crop: ratio
//   and peak) and the node's fingerprint (source tag, class, and its text or icon ref; tree = the screen's source
//   tree). It is honoured only if the node at that id still has that fingerprint and the finding is no larger than
//   approved: every |delta component| <= approved + 0.25 px (so a new axis, e.g. a position next to an approved size,
//   is not covered, R49), ratio <= approved + 0.02 and peak <= approved. An entry without them is never honoured.
//   R56: a root / approval entry also stores the finding's axes (why); it is honoured only if the finding's why is a
//   subset of the entry's and every delta component has the approved sign (a component within the 0.25 px slack may
//   have either) and is no larger than approved + 0.25 px: a shrink approval never covers a growth, nor a position on
//   a new axis. A container's fingerprint (no text, no icon) also holds its child count (kids), its parent's child
//   count (sibs: when a sibling is removed the ids shift and another container with the same tag and class takes the
//   id) and the hash of its first text descendant (th). An approved entry with an empty reason is allowed by 'approved'.
//   allowlistEntry(kind, finding, where) drafts one (approved: false) for the user to review. R44: report.cropLinked (crops on
//   an unexplained size root) are allowed only with that root's entry (open.cropsLinked / allowed.cropsLinked). Plan 3 Task 7: a skipped
//   'figma-<name>' (a check the Figma readback cannot observe, figma.mjs check) never fails the gate. Unchecked nodes, skipped layers
//   and data findings can never be allowlisted, nor (R66) an unexplained root of layer 'norm' (a change of the target spec
//   that no report entry explains). `file` is the HTML file's path relative to the corpus dir (R51; with
//   --html its base name).
// summarize(file, entry, g) -> one summary row (report.json, report.html, acceptance table).
// loadCorpus(corpusPath, dir) -> { files: [{ file, path, root, widen?, nameOf?, viewport? }], allowlist }
import { readFileSync } from 'node:fs';
import { basename, join, resolve, posix } from 'node:path';
import { captureScreens } from './capture.mjs';
import { inferScreen } from './infer.mjs';
import { applyFigmaModel } from './figma-model.mjs';
import { buildProxyHtml, renderProxy } from './proxy.mjs';
import { verifyScreenWithImages, figmaSkip } from './verify.mjs';
import { defaultFontMap } from './font-map.mjs';
import { applyNorm } from './apply-norm.mjs';

export const PAYLOAD_LIMIT = 50000;

export async function runScreen(browser, screen, inferred, fontMap, opts = {}) {
  if (!screen.png || !screen.origin) throw new Error('runScreen: screen needs png and origin (captureScreens with { png: true })');
  const modelled = applyFigmaModel(inferred.spec, fontMap, { rendered: screen.fontsRendered });
  const fc = screen.fontCss || {};
  const po = { fontLinks: fc.links || [], fontFaces: fc.faces || [], ...(opts.proxy || {}) };
  const at = (sp, i) => renderProxy(browser, buildProxyHtml(sp, screen.svgDefs || {}, fontMap, po), screen.W[i], { origin: screen.origin[i] });
  const proxy = { A: await at(modelled.spec, 0), B: await at(modelled.spec, 1) };
  const layout = { A: await at(inferred.spec, 0), B: await at(inferred.spec, 1) };
  const flags = [...(inferred.flags || []), ...modelled.flags];
  if (!opts.norm) {
    const report = await verifyScreenWithImages(browser, { screen, spec: modelled.spec, proxy, layout, flags }, opts.verify || {});
    return { report, proxy, layout, modelled };
  }
  // R66: the target spec rendered as the third proxy (mark 'norm'), and its records replayed on the inferred spec,
  // rendered unmodelled (mark 'normLayout'), for the crops
  const applied = opts.norm.applied || [];
  const mark = (r, m) => ({ ...r, mark: m });
  const norm = { A: mark(await at(opts.norm.spec, 0), 'norm'), B: mark(await at(opts.norm.spec, 1), 'norm') };
  let normLayout = null, normLayoutError = null;
  try {
    const ls = replayApplied(inferred.spec, applied);
    if (opts.normLayoutTweak) opts.normLayoutTweak(ls);
    normLayout = { A: mark(await at(ls, 0), 'normLayout'), B: mark(await at(ls, 1), 'normLayout') };
  } catch (err) { normLayoutError = err.message; }
  const report = await verifyScreenWithImages(browser, {
    screen, spec: modelled.spec, proxy, layout, flags, norm: { spec: opts.norm.spec, applied, proxy: norm, ...(Array.isArray(opts.norm.entries) ? { entries: opts.norm.entries } : {}) }, normLayout,
  }, opts.verify || {});
  if (normLayoutError) report.normLayoutError = normLayoutError;
  return { report, proxy, layout, modelled, norm, normLayout };
}

// R66: apply-norm records written again (as auto entries) on another spec of the same screen (the inferred one): the
// norm layout proxy. Throws like applyNorm when a record's `from` is not found.
export function replayApplied(spec, applied) {
  const byEntry = new Map();
  for (const a of applied || []) {
    const k = `${a.entry}|${a.cat}|${a.prop}|${JSON.stringify(a.from)}|${JSON.stringify(a.to)}`;
    if (!byEntry.has(k)) byEntry.set(k, { id: a.entry, cat: a.cat, code: a.code, prop: a.prop, from: a.from, to: a.to, status: 'auto', nodes: [] });
    byEntry.get(k).nodes.push({ screen: '_', node: a.node, ...(a.run !== undefined ? { run: a.run } : {}) });
  }
  return applyNorm(spec, [...byEntry.values()], '_').spec;
}

// R93: apply-norm does not resize HUG parents (a changed padding / gap / size inside them): the norm proxy lays them
// out. settleHug(spec, boxes) -> { spec, settled: [{ node, axis: 'w' | 'h' | 'abs.x' | 'abs.y', from, to }] } writes the proxy's size (boxes
// = the norm proxy's at A) into a copy of the target spec on every HUG axis of a frame with children, when it differs
// by more than 0.01 px, so spec-norm (and the Figma encoding built from it) holds the size Figma's auto layout gives.
// An absolute node pinned right / bottom (abs.c R, abs.cy B) or centred (C) keeps that edge / centre: its abs.x / abs.y
// moves by the growth (all of it, or half), listed with axis 'abs.x' / 'abs.y'.
// Texts, icons, images and leaf frames (HUG there is FIXED, as in the builder) keep their size. The input is not mutated.
export function settleHug(spec, boxes = {}) {
  const out = JSON.parse(JSON.stringify(spec)), settled = [];
  const walk = (n) => {
    const b = boxes[n.id];
    if (n.t === 'F' && Array.isArray(n.sz) && Array.isArray(n.kids) && n.kids.length && b) {
      for (const [i, axis] of [[0, 'w'], [1, 'h']]) {
        if (n.sz[i] !== 'HUG' || typeof n[axis] !== 'number' || Math.abs(b[2 + i] - n[axis]) <= 0.01) continue;
        const grow = b[2 + i] - n[axis];
        settled.push({ node: n.id, axis, from: n[axis], to: b[2 + i] });
        n[axis] = b[2 + i];
        // an absolute node pinned to the far side (R / B) or centred keeps that anchor, as the proxy lays it out; Figma
        // places it at abs.x / abs.y, so the position moves with the size
        const pos = i ? 'y' : 'x', c = n.abs && (i ? n.abs.cy : n.abs.c);
        const k = c === (i ? 'B' : 'R') ? 1 : c === 'C' ? 0.5 : 0;
        if (k && typeof n.abs[pos] === 'number') {
          const to = Math.round((n.abs[pos] - grow * k) * 100) / 100;
          settled.push({ node: n.id, axis: `abs.${pos}`, from: n.abs[pos], to });
          n.abs[pos] = to;
        }
      }
    }
    (n.kids || []).forEach(walk);
  };
  walk(out);
  return { spec: out, settled };
}

export function sampleIndexes(N, n) {
  if (n == null || n >= N) return [...Array(N).keys()];
  if (!(n > 0)) return [];
  return [...new Set([...Array(n).keys()].map((k) => Math.floor((k * N) / n)))];
}

export async function runFile(browser, htmlPath, opts = {}) {
  const fontMap = opts.fontMap || defaultFontMap();
  const webFonts = opts.webFonts !== false;
  const { screens } = await captureScreens(htmlPath, {
    root: opts.root, widen: opts.widen, nameOf: opts.nameOf, widenBy: opts.widenBy, viewport: opts.viewport,
    png: true, fontMap, webFonts,
  });
  const proxyOpts = webFonts ? {} : { webFonts: false };
  const mutateAt = new Set(opts.mutate ? sampleIndexes(screens.length, opts.mutateSample) : []);
  const out = [];
  const inferredAll = screens.map((screen) => inferScreen(screen));
  // plan 2: the target specs of every screen at once (normalisation works on the whole file)
  const targets = opts.normalize
    ? await opts.normalize(screens.map((screen, i) => ({ screen, inferred: inferredAll[i], modelled: applyFigmaModel(inferredAll[i].spec, fontMap, { rendered: screen.fontsRendered }) })))
    : [];
  for (const [i, screen] of screens.entries()) {
    const inferred = inferredAll[i];
    const target = targets[i] || null;
    const norm = target && Array.isArray(target.applied) && target.applied.length ? target : null;
    const r = await runScreen(browser, screen, inferred, fontMap, { proxy: proxyOpts, verify: opts.verify, ...(norm ? { norm } : {}) });
    // R93: the target's HUG frame sizes, measured on the norm proxy (apply-norm leaves them stale on purpose)
    const settled = target && r.norm ? { ...target, ...settleHug(target.spec, r.norm.A.boxes) } : target;
    const entry = { screen, inferred, ...r, ...(settled ? { target: settled } : {}) };
    if (mutateAt.has(i)) {
      const { runMutations } = await import('./mutate.mjs');
      entry.mutations = await runMutations(browser, screen, inferred, fontMap, { proxy: proxyOpts, verify: opts.verify, screenIndex: i, ...(norm ? { norm } : {}) });
    }
    out.push(entry);
    if (opts.onScreen) opts.onScreen(entry);
  }
  return { file: htmlPath, screens: out };
}

const SLACK_PX = 0.25, SLACK_RATIO = 0.02, EPS = 1e-6;
// [node, parent] at id
const findNode = (tree, id, parent = null) => {
  if (!tree) return null;
  if (tree.id === id) return [tree, parent];
  for (const k of tree.kids || []) { const r = findNode(k, id, tree); if (r) return r; }
  return null;
};
const textOf = (n) => (n.runs || []).map((r) => (r.br ? ' ' : r.t || '')).join('').replace(/\s+/g, ' ').trim();
const firstText = (n) => { for (const k of n.kids || []) { const t = textOf(k) || firstText(k); if (t) return t; } return ''; };
// 32-bit FNV-1a, hex
const fnv = (str) => { let h = 0x811c9dc5; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
// R51: what identifies the source node at an id: tag, class, and its text (whitespace collapsed, 60 chars) or icon;
// R56: a container (no text, no icon) adds its child count, its parent's child count and the hash of its first text
// descendant
export function fingerprint(tree, id) {
  const hit = findNode(tree, id);
  if (!hit) return null;
  const [n, parent] = hit;
  const fp = { tag: n.tag || n.kind || '', cls: n.cls || '' };
  const text = textOf(n).slice(0, 60);
  if (text) fp.text = text;
  else if (n.icon) fp.ref = n.icon.ref || (n.icon.glyph != null ? `glyph:${n.icon.glyph}` : n.icon.svg ? 'svg' : '');
  else {
    fp.kids = (n.kids || []).length;
    fp.sibs = parent ? (parent.kids || []).length : 0;
    const t = firstText(n);
    if (t) fp.th = fnv(t);
  }
  return fp;
}
const sameFp = (a, b) => !!a && !!b && ['tag', 'cls', 'text', 'ref', 'kids', 'sibs', 'th'].every((k) => (a[k] ?? null) === (b[k] ?? null));
// R56: the finding's axes are a subset of the approved ones, and every delta component keeps the approved sign (or is
// within the slack) and is no larger than approved + slack
const sameAxes = (e, x) => Array.isArray(e.why) && (x.why || []).every((w) => e.why.includes(w));
const notLarger = (kind, e, x) => (kind === 'crop'
  ? typeof e.ratio === 'number' && typeof e.peak === 'number' && x.ratio <= e.ratio + SLACK_RATIO + EPS && (x.peak ?? 0) <= e.peak + EPS
  : Array.isArray(e.delta) && e.delta.length === 4 && Array.isArray(x.delta) && sameAxes(e, x) && x.delta.every((v, i) => {
    const a = Number(e.delta[i]);
    if (Math.abs(v) <= SLACK_PX + EPS) return true;
    return Math.sign(v) === Math.sign(a) && Math.abs(v) <= Math.abs(a) + SLACK_PX + EPS;
  }));
// a draft allowlist entry for an open finding (the user reviews it, writes the reason and sets approved: true)
export function allowlistEntry(kind, x, where = {}) {
  return {
    file: where.file, screen: where.screen, node: x.id, width: x.width, kind,
    ...(kind === 'crop' ? { ratio: x.ratio, peak: x.peak ?? 0 } : { delta: x.delta, why: [...(x.why || [])] }),
    fingerprint: fingerprint(where.tree, x.id), reason: '', approved: false,
  };
}

export function gate(report, allowlist = [], where = {}) {
  const ok = (allowlist || []).filter((e) => e && e.approved === true && e.file === where.file && e.screen === where.screen);
  const find = (kind, x) => {
    const fp = fingerprint(where.tree, x.id);
    return ok.find((e) => e.kind === kind && e.node === x.id && e.width === x.width && sameFp(e.fingerprint, fp) && notLarger(kind, e, x));
  };
  const split = (kind, items) => {
    const open = [], allowed = [];
    for (const x of items) {
      const e = find(kind, x);
      if (e) allowed.push({ ...x, allowedBy: (typeof e.reason === 'string' && e.reason.trim()) || 'approved' }); else open.push(x);
    }
    return { open, allowed };
  };
  // R66: a norm root is explained by its report entry or not at all: an unexplained one is never allowlisted.
  // R83: on a real-Figma check (report.figmaReal) a norm root is Figma drawing other than the norm proxy predicts (a
  // renderer difference the user may approve: t8 s11, a text Chrome fits with 0.37 px to spare wraps in Figma), so it
  // can be allowlisted; a record-check root (a record whose `to` is wrong) and a norm-layout root (R78, `on`: the local
  // norm layout proxy vs the layout proxy, not Figma) never can.
  const normAllow = (r) => !!report.figmaReal && !r.recordCheck && !r.on;
  const roots = split('root', report.roots.filter((r) => !r.explainedBy && (r.layer !== 'norm' || normAllow(r))));
  roots.open.push(...report.roots.filter((r) => !r.explainedBy && r.layer === 'norm' && !normAllow(r)));
  const approvals = split('approval', report.needsApproval);
  const crops = split('crop', report.crop);
  // R44: a crop attached to an unexplained root passes or fails with that root's allowlist entry, never its own
  const rootAllowed = (x) => roots.allowed.some((r) => r.id === x.root && r.width === x.width);
  const linked = { open: (report.cropLinked || []).filter((x) => !rootAllowed(x)), allowed: (report.cropLinked || []).filter(rootAllowed) };
  // plan 3 Task 7: skipped 'figma-<name>' (a check the Figma readback cannot observe) is reported, never failing
  const pass = report.unchecked.length === 0 && report.skipped.every(figmaSkip) && report.data.length === 0 &&
    roots.open.length === 0 && approvals.open.length === 0 && crops.open.length === 0 && linked.open.length === 0;
  return {
    pass,
    open: { roots: roots.open, approvals: approvals.open, crops: crops.open, cropsLinked: linked.open },
    allowed: { roots: roots.allowed, approvals: approvals.allowed, crops: crops.allowed, cropsLinked: linked.allowed },
  };
}

const countBy = (xs, key) => xs.reduce((o, x) => ((o[x[key]] = (o[x[key]] || 0) + 1), o), {});
export const specJson = (spec) => JSON.stringify(spec);

export function summarize(file, entry, g) {
  const r = entry.report;
  const specBytes = Buffer.byteLength(specJson(entry.modelled.spec));
  const m = entry.mutations;
  return {
    file, screen: r.id, checked: r.checked, total: r.total, unchecked: r.unchecked.length,
    unexplainedRoots: g.open.roots.length, explainedRoots: r.roots.filter((x) => x.explainedBy).length,
    needsApproval: g.open.approvals.length, approvalMax: Math.max(0, ...r.needsApproval.map((x) => x.magnitude)), textRounding: (r.modelAccepted || []).length,
    crop: g.open.crops.length, cropLinked: g.open.cropsLinked.length, cropA: g.open.crops.filter((c) => c.width === 'A').length, cropB: g.open.crops.filter((c) => c.width === 'B').length,
    data: countBy(r.data, 'kind'), flags: countBy(r.flags, 'kind'), skipped: r.skipped,
    allowed: g.allowed.roots.length + g.allowed.approvals.length + g.allowed.crops.length + g.allowed.cropsLinked.length,
    specBytes, payloadOver50k: specBytes > PAYLOAD_LIMIT, pixel: r.pixel, pass: g.pass,
    ...(m ? { mutation: { allCaught: m.allCaught, caught: m.results.filter((x) => x.caught === true).length, missed: m.results.filter((x) => x.caught === false).map((x) => x.kind), skipped: m.results.filter((x) => x.caught === null).length } } : {}),
  };
}

export function loadCorpus(corpusPath, dir) {
  const c = JSON.parse(readFileSync(corpusPath, 'utf8'));
  if (!Array.isArray(c.files)) throw new Error(`corpus ${corpusPath}: "files" must be an array`);
  return {
    // R51: a file is keyed by its path relative to the corpus dir (forward slashes), so two files with the same name in
    // different folders cannot share allowlist entries
    files: c.files.map((f) => ({ ...f, path: resolve(join(dir, f.file)), file: posix.normalize(String(f.file).replace(/\\/g, '/')) })),
    allowlist: Array.isArray(c.allowlist) ? c.allowlist : [],
  };
}
