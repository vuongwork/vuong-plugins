// The one verification pipeline (Task 8), shared by the CLI (layout.mjs), the acceptance test and mutate.mjs:
//   capture (png, font override R10, line-height override R14) -> inferScreen -> layout proxy of the inferred spec
//   (unmodelled, mark 'none') and applyFigmaModel -> modelled proxy (mark 'figma'), both rendered at A and B with
//   { origin: screen.origin[i] } -> verifyScreenWithImages.
//
// runScreen(browser, screen, inferred, fontMap, opts?) -> { report, proxy: {A, B}, layout: {A, B}, modelled }
//   screen   = captureScreens(..., { png: true }).screens[i]; inferred = { spec, flags } (inferScreen's, or a changed copy)
//   opts.proxy  = extra buildProxyHtml options (e.g. { webFonts: false }); opts.verify = verifyScreenWithImages options
//   modelled = applyFigmaModel's { spec, flags } (the modelled spec is what spec-<id>.json holds)
// runFile(browser, htmlPath, opts) -> { file: htmlPath, screens: [{ screen, inferred, modelled, report, proxy, layout,
//   mutations? }] }
//   opts: root (required), widen, nameOf, widenBy, viewport, webFonts (false = no Google Fonts, R9 opt-out), fontMap
//   (default defaultFontMap()), verify ({ tolFrame, tolText, tolModel }), mutate (run runMutations too),
//   mutateSample (with mutate: only n screens of the file, spread evenly: indexes floor(k * N / n)), onScreen(entry)
//   (progress callback). Capture launches its own browser; proxies and verify use `browser`.
// gate(report, allowlist, { file, screen }) -> { pass, open: { roots, approvals, crops }, allowed: { roots, approvals,
//   crops } }: the screen gate after the allowlist (spec §14 layer 5). Allowlist entries are
//   { file, screen, node, width, kind: 'root'|'approval'|'crop', reason, approved }; ONLY approved === true entries
//   are honoured, and only for unexplained roots, needsApproval entries and crop fails. Unchecked nodes, skipped layers
//   and data findings can never be allowlisted. `file` is the HTML file's base name.
// summarize(file, entry, g) -> one summary row (report.json, report.html, acceptance table).
// loadCorpus(corpusPath, dir) -> { files: [{ file, path, root, widen?, nameOf?, viewport? }], allowlist }
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { captureScreens } from './capture.mjs';
import { inferScreen } from './infer.mjs';
import { applyFigmaModel } from './figma-model.mjs';
import { buildProxyHtml, renderProxy } from './proxy.mjs';
import { verifyScreenWithImages } from './verify.mjs';
import { defaultFontMap } from './font-map.mjs';

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
  const report = await verifyScreenWithImages(browser, { screen, spec: modelled.spec, proxy, layout, flags }, opts.verify || {});
  return { report, proxy, layout, modelled };
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
  for (const [i, screen] of screens.entries()) {
    const inferred = inferScreen(screen);
    const r = await runScreen(browser, screen, inferred, fontMap, { proxy: proxyOpts, verify: opts.verify });
    const entry = { screen, inferred, ...r };
    if (mutateAt.has(i)) {
      const { runMutations } = await import('./mutate.mjs');
      entry.mutations = await runMutations(browser, screen, inferred, fontMap, { proxy: proxyOpts, verify: opts.verify });
    }
    out.push(entry);
    if (opts.onScreen) opts.onScreen(entry);
  }
  return { file: htmlPath, screens: out };
}

export function gate(report, allowlist = [], where = {}) {
  const ok = (allowlist || []).filter((e) => e && e.approved === true && e.file === where.file && e.screen === where.screen);
  const find = (kind, id, width) => ok.find((e) => e.kind === kind && e.node === id && e.width === width);
  const split = (kind, items) => {
    const open = [], allowed = [];
    for (const x of items) {
      const e = find(kind, x.id, x.width);
      if (e) allowed.push({ ...x, allowedBy: e.reason }); else open.push(x);
    }
    return { open, allowed };
  };
  const roots = split('root', report.roots.filter((r) => !r.explainedBy));
  const approvals = split('approval', report.needsApproval);
  const crops = split('crop', report.crop);
  const pass = report.unchecked.length === 0 && report.skipped.length === 0 && report.data.length === 0 &&
    roots.open.length === 0 && approvals.open.length === 0 && crops.open.length === 0;
  return {
    pass,
    open: { roots: roots.open, approvals: approvals.open, crops: crops.open },
    allowed: { roots: roots.allowed, approvals: approvals.allowed, crops: crops.allowed },
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
    needsApproval: g.open.approvals.length, approvalMax: Math.max(0, ...r.needsApproval.map((x) => x.magnitude)),
    crop: g.open.crops.length, cropA: g.open.crops.filter((c) => c.width === 'A').length, cropB: g.open.crops.filter((c) => c.width === 'B').length,
    data: countBy(r.data, 'kind'), flags: countBy(r.flags, 'kind'), skipped: r.skipped,
    allowed: g.allowed.roots.length + g.allowed.approvals.length + g.allowed.crops.length,
    specBytes, payloadOver50k: specBytes > PAYLOAD_LIMIT, pixel: r.pixel, pass: g.pass,
    ...(m ? { mutation: { allCaught: m.allCaught, caught: m.results.filter((x) => x.caught === true).length, missed: m.results.filter((x) => x.caught === false).map((x) => x.kind), skipped: m.results.filter((x) => x.caught === null).length } } : {}),
  };
}

export function loadCorpus(corpusPath, dir) {
  const c = JSON.parse(readFileSync(corpusPath, 'utf8'));
  if (!Array.isArray(c.files)) throw new Error(`corpus ${corpusPath}: "files" must be an array`);
  return {
    files: c.files.map((f) => ({ ...f, path: resolve(join(dir, f.file)), file: basename(f.file) })),
    allowlist: Array.isArray(c.allowlist) ? c.allowlist : [],
  };
}
