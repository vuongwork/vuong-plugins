#!/usr/bin/env node
// Layout CLI (Task 8): HTML -> inferred auto-layout spec, verified node by node (spec §14), with a report to approve.
//
//   node core/layout.mjs --html <file> --root <selector> --out <dir> [--widen <selector>] [--name <selector>]
//        [--widen-by <px>] [--viewport <px>] [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--no-webfonts]
//        [--allowlist <json>] [--mutate [--mutate-sample <n>]]
//   node core/layout.mjs --corpus <corpus.json> [--corpus-dir <dir>] --out <dir> [same options]
//     corpus mode: every file of the corpus (paths relative to --corpus-dir, default $VD_CORPUS_DIR) with its own
//     root / widen; the corpus's `allowlist` is used unless --allowlist is given.
//
// Pipeline: pipeline.mjs runFile (capture with png, font override R10, line-height R14 -> infer -> layout proxy +
// modelled proxy at A and B with the source pixel origin -> verifyScreenWithImages).
// Writes: ir.json (captured screens without PNGs), spec-<id>.json (modelled spec, compact JSON: specBytes is its
//   size), report.json (summary + verify report + gate + allowlistDraft (R51: an entry with magnitude and fingerprint,
//   approved false, per open root / approval / crop) + mutations per screen), report.html (self-contained).
//   In corpus mode ir.json and spec-<id>.json go to <out>/<file stem>/; report.json and report.html cover all files.
// Exit codes: 0 every screen passes (after the allowlist: only `approved: true` entries count), 1 otherwise, 2 usage
//   or setup error (bad arguments, file or selector not found, no Playwright / Chromium).
// --no-webfonts: no Google Fonts are fetched (R9 opt-out); families that do not render are then reported.
// --mutate: also runs the mutation check (spec §14 layer 4, ≈30 s per screen); --mutate-sample n: n screens per file.
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFile, gate, summarize, loadCorpus, specJson, allowlistEntry } from './pipeline.mjs';

export class UsageError extends Error {}

export const USAGE = `usage: node core/layout.mjs --html <file> --root <selector> --out <dir> [options]
       node core/layout.mjs --corpus <corpus.json> [--corpus-dir <dir>] --out <dir> [options]
options: --widen <sel> --name <sel> --widen-by <px> --viewport <px> --tol-frame <px> --tol-text <px> --tol-model <px>
         --no-webfonts --allowlist <json> --mutate --mutate-sample <n>`;

const OPTIONS = {
  html: { type: 'string' }, root: { type: 'string' }, widen: { type: 'string' }, name: { type: 'string' },
  'widen-by': { type: 'string' }, viewport: { type: 'string' },
  'tol-frame': { type: 'string' }, 'tol-text': { type: 'string' }, 'tol-model': { type: 'string' },
  'no-webfonts': { type: 'boolean' }, out: { type: 'string' }, allowlist: { type: 'string' },
  mutate: { type: 'boolean' }, 'mutate-sample': { type: 'string' },
  corpus: { type: 'string' }, 'corpus-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
};

const number = (name, v, { positive = false, int = false } = {}) => {
  if (v == null) return undefined;
  const n = Number(v);
  if (v === '' || !Number.isFinite(n) || (positive ? n <= 0 : n < 0) || (int && !Number.isInteger(n))) {
    throw new UsageError(`--${name} needs a ${int ? 'whole ' : ''}number ${positive ? '> 0' : '>= 0'} (got "${v}")`);
  }
  return n;
};

export function parseCli(argv, env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (e) { throw new UsageError(e.message); }
  if (values.help) return { help: true };
  if (!values.out) throw new UsageError('--out <dir> is required');
  if (values.html && values.corpus) throw new UsageError('use either --html or --corpus, not both');
  if (!values.html && !values.corpus) throw new UsageError('--html <file> (with --root) or --corpus <corpus.json> is required');
  if (values.html && !values.root) throw new UsageError('--root <selector> is required with --html');
  if (values.corpus && (values.root || values.widen || values.name)) throw new UsageError('--root / --widen / --name come from the corpus file in --corpus mode');
  if (values['mutate-sample'] != null && !values.mutate) throw new UsageError('--mutate-sample needs --mutate');
  const verify = {};
  const tf = number('tol-frame', values['tol-frame']), tt = number('tol-text', values['tol-text']), tm = number('tol-model', values['tol-model']);
  if (tf != null) verify.tolFrame = tf;
  if (tt != null) verify.tolText = tt;
  if (tm != null) verify.tolModel = tm;
  const corpusDir = values.corpus ? (values['corpus-dir'] || env.VD_CORPUS_DIR) : undefined;
  if (values.corpus && !corpusDir) throw new UsageError('--corpus needs --corpus-dir <dir> or VD_CORPUS_DIR');
  return {
    html: values.html, root: values.root, widen: values.widen, nameOf: values.name,
    widenBy: number('widen-by', values['widen-by'], { positive: true }),
    viewport: number('viewport', values.viewport, { positive: true }),
    verify, webFonts: !values['no-webfonts'], out: values.out, allowlist: values.allowlist,
    mutate: !!values.mutate, mutateSample: number('mutate-sample', values['mutate-sample'], { positive: true, int: true }),
    corpus: values.corpus, corpusDir,
  };
}

export function readAllowlist(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(j) ? j : j.allowlist;
  if (!Array.isArray(list)) throw new UsageError(`${path}: expected an array of allowlist entries or { "allowlist": [...] }`);
  return list;
}

const stem = (f) => basename(f, extname(f));
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const irOf = (screens) => screens.map(({ png, pngOriginal, ...rest }) => rest);

// Runs the whole job; deps.fontMap / deps.browser / deps.log are for tests. Returns the exit code.
export async function main(argv, deps = {}) {
  const log = deps.log || ((m) => process.stderr.write(`${m}\n`));
  let o;
  try { o = parseCli(argv, deps.env || process.env); } catch (e) {
    if (e instanceof UsageError) { log(`error: ${e.message}\n${USAGE}`); return 2; }
    throw e;
  }
  if (o.help) { log(USAGE); return 0; }
  let jobs, allowlist = [];
  try {
    if (o.corpus) {
      const c = loadCorpus(resolve(o.corpus), o.corpusDir);
      jobs = c.files.map((f) => ({ path: f.path, file: f.file, root: f.root, widen: f.widen, nameOf: f.nameOf, viewport: f.viewport ?? o.viewport, dir: stem(f.file) }));
      allowlist = c.allowlist;
    } else {
      jobs = [{ path: resolve(o.html), file: basename(o.html), root: o.root, widen: o.widen, nameOf: o.nameOf, viewport: o.viewport, dir: '' }];
    }
    if (o.allowlist) allowlist = readAllowlist(o.allowlist);
    for (const j of jobs) if (!existsSync(j.path)) throw new UsageError(`HTML file not found: ${j.path}`);
  } catch (e) { log(`error: ${e.message}`); return 2; }

  const t0 = Date.now();
  let browser = deps.browser, own = false;
  const results = [];
  try {
    if (!browser) { const { launchBrowser } = await import('./browser.mjs'); browser = await launchBrowser(); own = true; }
    for (const j of jobs) {
      log(`${j.file}: capturing ${j.root}`);
      const res = await runFile(browser, j.path, {
        root: j.root, widen: j.widen, nameOf: j.nameOf, widenBy: o.widenBy, viewport: j.viewport, webFonts: o.webFonts,
        fontMap: deps.fontMap, verify: o.verify, mutate: o.mutate, mutateSample: o.mutateSample,
        onScreen: (e) => log(`  ${e.report.id}: ${e.report.pass ? 'pass' : 'fail'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`),
      });
      results.push({ job: j, res });
    }
  } catch (e) {
    log(`error: ${e.message}`);
    if (own && browser) await browser.close();
    return 2;
  }

  try {
    mkdirSync(o.out, { recursive: true });
    const screensOut = [], views = [];
    const { screenView, renderReportHtml } = await import('./report-html.mjs');
    for (const { job, res } of results) {
      const dir = join(o.out, job.dir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ir.json'), JSON.stringify({ file: job.file, root: job.root, widen: job.widen ?? null, screens: irOf(res.screens.map((e) => e.screen)) }, null, 1));
      for (const e of res.screens) {
        writeFileSync(join(dir, `spec-${safe(e.report.id)}.json`), specJson(e.modelled.spec));
        const where = { file: job.file, screen: e.report.id, tree: e.screen.tree };
        const g = gate(e.report, allowlist, where);
        const summary = summarize(job.file, e, g);
        // R51: a draft allowlist entry (magnitude + fingerprint, approved: false) for every open root, approval and crop
        const allowlistDraft = [...g.open.roots.map((x) => allowlistEntry('root', x, where)), ...g.open.approvals.map((x) => allowlistEntry('approval', x, where)),
          ...g.open.crops.map((x) => allowlistEntry('crop', x, where))];
        screensOut.push({ summary, gate: g, report: e.report, flags: e.report.flags, allowlistDraft, ...(e.mutations ? { mutations: e.mutations } : {}) });
        views.push(await screenView(browser, job.file, e, g, summary));
      }
    }
    const pass = screensOut.every((s) => s.summary.pass);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const args = { ...(o.corpus ? { corpus: o.corpus } : { html: o.html, root: o.root }), ...(o.widen ? { widen: o.widen } : {}), webFonts: o.webFonts, tol: o.verify, mutate: o.mutate, allowlistApproved: allowlist.filter((e) => e && e.approved === true).length };
    writeFileSync(join(o.out, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), seconds, args, pass, screens: screensOut }, null, 1));
    writeFileSync(join(o.out, 'report.html'), renderReportHtml({ generated: `${new Date().toISOString()} · ${seconds} s`, args, screens: views }));
    const failed = screensOut.filter((s) => !s.summary.pass).length;
    log(`${screensOut.length - failed}/${screensOut.length} screens pass in ${seconds} s; report: ${join(o.out, 'report.html')}`);
    return pass ? 0 : 1;
  } finally {
    if (own && browser) await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
