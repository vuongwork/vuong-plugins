#!/usr/bin/env node
// Layout CLI (Task 8): HTML -> inferred auto-layout spec, verified node by node (spec §14), with a report to approve.
//
//   node core/layout.mjs --html <file> [--root <selector>] --out <dir> [--widen <selector>] [--name <selector>]
//        [--no-lint] [--widen-by <px>] [--viewport <px>] [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--tol-text-round <px>] [--no-webfonts] [--no-cache]
//        [--allowlist <json>] [--mutate [--mutate-sample <n>]]
//   node core/layout.mjs --corpus <corpus.json> [--corpus-dir <dir>] --out <dir> [same options]
//   node core/layout.mjs --project <vd-project.json> [any option above, overriding the project file]
//     R91: the project file (project-file.mjs) gives html, root, widen, name, viewport, widen-by, out, allowlist (when
//     the file exists), no-webfonts (webFonts: false) and, for ds.mjs, rules and names (when the files exist).
//     corpus mode: every file of the corpus (paths relative to --corpus-dir, default $VD_CORPUS_DIR) with its own
//     root / widen; the corpus's `allowlist` is used unless --allowlist is given.
//
// Without --root the file follows the vd-html profile (PROFILE.md): screens are [data-vd-screen], widened through
//   [data-vd-widen] when the file has one. --html mode first runs lint.mjs (the gate): its summary goes to the log,
//   lint.json to --out; errors stop the run (exit 1, no ir.json) unless --no-lint. --corpus mode never lints.
// Pipeline: pipeline.mjs runFile (capture with png, font override R10, line-height R14 -> infer -> layout proxy +
// modelled proxy at A and B with the source pixel origin -> verifyScreenWithImages).
// Writes: ir.json (captured screens without PNGs), spec-<id>.json (modelled spec, compact JSON: specBytes is its
//   size), report.json (summary + verify report + gate + allowlistDraft (R51: an entry with magnitude and fingerprint,
//   approved false, per open root / approval / crop) + mutations per screen), report.html (self-contained).
//   In corpus mode ir.json and spec-<id>.json go to <out>/<file stem>/; report.json and report.html cover all files.
// Exit codes: 0 every screen passes (after the allowlist: only `approved: true` entries count) and, with --mutate, every
//   mutation that ran was caught (R53: one missed planted error fails the run), 1 otherwise, 2 usage
//   or setup error (bad arguments, file or selector not found, no Playwright / Chromium).
// --no-webfonts: no Google Fonts are fetched (R9 opt-out); families that do not render are then reported.
// --mutate: also runs the mutation check (spec §14 layer 4, ≈30 s per screen); --mutate-sample n: n screens per file.
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFile, summarize as lintSummary, DEFAULT_ROOT, DEFAULT_WIDEN } from './lint.mjs';
import { runFile, gate, summarize, loadCorpus, specJson, allowlistEntry } from './pipeline.mjs';
import { readProject, projectDefaults } from './project-file.mjs';

export class UsageError extends Error {}

export const USAGE = `usage: node core/layout.mjs --html <file> [--root <selector>] --out <dir> [options]
       node core/layout.mjs --corpus <corpus.json> [--corpus-dir <dir>] --out <dir> [options]
       node core/layout.mjs --project <vd-project.json> [options]
options: --no-cache --no-lint --widen <sel> --name <sel> --widen-by <px> --viewport <px> --tol-frame <px> --tol-text <px> --tol-model <px> --tol-text-round <px>
         --no-webfonts --allowlist <json> --mutate --mutate-sample <n>`;

const OPTIONS = {
  html: { type: 'string' }, root: { type: 'string' }, widen: { type: 'string' }, name: { type: 'string' },
  'widen-by': { type: 'string' }, viewport: { type: 'string' },
  'tol-frame': { type: 'string' }, 'tol-text': { type: 'string' }, 'tol-model': { type: 'string' }, 'tol-text-round': { type: 'string' },
  'no-webfonts': { type: 'boolean' }, 'no-lint': { type: 'boolean' }, 'no-cache': { type: 'boolean' }, out: { type: 'string' }, allowlist: { type: 'string' },
  mutate: { type: 'boolean' }, 'mutate-sample': { type: 'string' },
  corpus: { type: 'string' }, 'corpus-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' }, project: { type: 'string' },
};

const number = (name, v, { positive = false, int = false } = {}) => {
  if (v == null) return undefined;
  const n = Number(v);
  if (v === '' || !Number.isFinite(n) || (positive ? n <= 0 : n < 0) || (int && !Number.isInteger(n))) {
    throw new UsageError(`--${name} needs a ${int ? 'whole ' : ''}number ${positive ? '> 0' : '>= 0'} (got "${v}")`);
  }
  return n;
};

// extra = { options } (ds.mjs): more string options, returned under their own names
export function parseCli(argv, env = process.env, extra = null) {
  let values;
  const options = { ...OPTIONS, ...((extra && extra.options) || {}) };
  try {
    ({ values } = parseArgs({ args: argv, options, strict: true, allowPositionals: false }));
  } catch (e) { throw new UsageError(e.message); }
  if (values.help) return { help: true };
  if (values.project) {
    if (values.corpus) throw new UsageError('use either --project or --corpus, not both');
    let p;
    try { p = readProject(values.project); } catch (e) { throw new UsageError(e.message); }
    Object.assign(values, projectDefaults(p, values, Object.keys(options)));
  }
  if (!values.out) throw new UsageError('--out <dir> is required');
  if (values.html && values.corpus) throw new UsageError('use either --html or --corpus, not both');
  if (!values.html && !values.corpus) throw new UsageError('--html <file> or --corpus <corpus.json> is required');
  if (values.corpus && (values.root || values.widen || values.name)) throw new UsageError('--root / --widen / --name come from the corpus file in --corpus mode');
  if (values['mutate-sample'] != null && !values.mutate) throw new UsageError('--mutate-sample needs --mutate');
  const verify = {};
  const tf = number('tol-frame', values['tol-frame']), tt = number('tol-text', values['tol-text']), tm = number('tol-model', values['tol-model']);
  if (tf != null) verify.tolFrame = tf;
  if (tt != null) verify.tolText = tt;
  if (tm != null) verify.tolModel = tm;
  const tr = number('tol-text-round', values['tol-text-round']);
  if (tr != null) verify.tolTextRound = tr;
  const corpusDir = values.corpus ? (values['corpus-dir'] || env.VD_CORPUS_DIR) : undefined;
  if (values.corpus && !corpusDir) throw new UsageError('--corpus needs --corpus-dir <dir> or VD_CORPUS_DIR');
  return {
    html: values.html, root: values.root, widen: values.widen, nameOf: values.name,
    widenBy: number('widen-by', values['widen-by'], { positive: true }),
    viewport: number('viewport', values.viewport, { positive: true }),
    verify, webFonts: !values['no-webfonts'], noLint: !!values['no-lint'], noCache: !!values['no-cache'], out: values.out, allowlist: values.allowlist,
    mutate: !!values.mutate, mutateSample: number('mutate-sample', values['mutate-sample'], { positive: true, int: true }),
    corpus: values.corpus, corpusDir,
    ...(extra ? Object.fromEntries(Object.keys(extra.options || {}).map((k) => [k, values[k]])) : {}),
  };
}

export function readAllowlist(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(j) ? j : j.allowlist;
  if (!Array.isArray(list)) throw new UsageError(`${path}: expected an array of allowlist entries or { "allowlist": [...] }`);
  return list;
}

// R53: the run passes only if every screen passes and no mutation that ran went uncaught (a verifier that misses a
// planted error cannot vouch for the screens it passed)
export function runVerdict(screensOut) {
  const missed = screensOut.flatMap((s) => (s.mutations ? s.mutations.results.filter((r) => r.caught === false).map((r) => r.kind) : []));
  return { pass: screensOut.every((s) => s.summary.pass) && missed.length === 0, missed };
}

const stem = (f) => basename(f, extname(f));
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const irOf = (screens) => screens.map(({ png, pngOriginal, ...rest }) => rest);

// Runs the whole job; deps.fontMap / deps.browser / deps.log are for tests. Returns the exit code.
// ext (ds.mjs, plan 2): { usage, options, setup(o, deps, jobs) -> state (throws: exit 2), normalize(job, items, state)
// -> targets (runFile opts.normalize), afterFile({ job, res, dir, browser, state, views }) (more outputs per file; views = report-html screenView of each screen),
// finish({ state, log, pass }) (the last lines) }; state.args is merged into report.json args. Without ext: the
// plan-1 CLI, unchanged.
export async function main(argv, deps = {}, ext = null) {
  const log = deps.log || ((m) => process.stderr.write(`${m}\n`));
  const usage = ext ? ext.usage : USAGE;
  let o;
  try { o = parseCli(argv, deps.env || process.env, ext); } catch (e) {
    if (e instanceof UsageError) { log(`error: ${e.message}\n${usage}`); return 2; }
    throw e;
  }
  if (o.help) { log(usage); return 0; }
  let jobs, allowlist = [], state = null;
  try {
    if (o.corpus) {
      const c = loadCorpus(resolve(o.corpus), o.corpusDir);
      jobs = c.files.map((f) => ({ path: f.path, file: f.file, root: f.root, widen: f.widen, nameOf: f.nameOf, viewport: f.viewport ?? o.viewport, dir: stem(f.file) }));
      allowlist = c.allowlist;
    } else {
      jobs = [{ path: resolve(o.html), file: basename(o.html), root: o.root, widen: o.widen, nameOf: o.nameOf, viewport: o.viewport, dir: '' }];
    }
    if (!jobs.length) throw new UsageError(`corpus ${o.corpus} has no files`);
    if (o.allowlist) allowlist = readAllowlist(o.allowlist);
    for (const j of jobs) if (!existsSync(j.path)) throw new UsageError(`HTML file not found: ${j.path}`);
    if (ext) state = await ext.setup(o, deps, jobs);
  } catch (e) { log(`error: ${e.message}`); return 2; }

  const t0 = Date.now();
  let browser = deps.browser, own = false;
  const results = [];
  try {
    if (!browser) { const { launchBrowser } = await import('./browser.mjs'); browser = await launchBrowser(); own = true; }
    if (!o.corpus && !o.noLint) {
      // lint gate: one page load on the shared browser; errors stop the run before any output but lint.json
      const j = jobs[0];
      const lr = await lintFile(j.path, { root: j.root, widen: j.widen, browser, fontMap: deps.fontMap });
      mkdirSync(o.out, { recursive: true });
      writeFileSync(join(o.out, 'lint.json'), JSON.stringify(lr, null, 1));
      for (const l of lintSummary(lr, { outPath: join(o.out, 'lint.json') })) log(l);
      // E1 (no screen for the selector) is left to the pipeline, which reports it as a usage error (exit 2)
      if (lr.findings.some((f) => f.level === 'error' && f.code !== 'E1')) {
        log(`lint: ${lr.counts.error} error${lr.counts.error === 1 ? '' : 's'}, fix them or pass --no-lint`);
        if (own) await browser.close();
        return 1;
      }
    }
    if (!o.corpus) {
      // profile defaults (PROFILE.md): screens [data-vd-screen], widened through [data-vd-widen] when the file has one
      const j = jobs[0];
      if (!j.root) {
        j.root = DEFAULT_ROOT;
        if (!j.widen && /data-vd-widen/.test(readFileSync(j.path, 'utf8'))) j.widen = DEFAULT_WIDEN;
      }
    }
    for (const j of jobs) {
      log(`${j.file}: capturing ${j.root}`);
      const res = await runFile(browser, j.path, {
        root: j.root, widen: j.widen, nameOf: j.nameOf, widenBy: o.widenBy, viewport: j.viewport, webFonts: o.webFonts,
        fontMap: deps.fontMap, verify: o.verify, mutate: o.mutate, mutateSample: o.mutateSample,
        // R95: each screen's proxies and verify are reused from <out>/.cache when nothing they depend on changed
        ...(o.out && !o.noCache ? { cacheDir: join(o.out, '.cache') } : {}),
        // R90: the progress line gives the gate after the allowlist, as the summary does (report.pass is before it)
        onScreen: (e) => log(`  ${e.report.id}: ${gate(e.report, allowlist, { file: j.file, screen: e.report.id, tree: e.screen.tree }).pass ? 'pass' : 'fail'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`),
        ...(ext ? { normalize: (items) => ext.normalize(j, items, state) } : {}),
      });
      if (res.cached) log(`  ${res.cached}/${res.screens.length} screens unchanged, reused from the cache (--no-cache to render them again)`);
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
      const fileViews = [];
      for (const e of res.screens) {
        writeFileSync(join(dir, `spec-${safe(e.report.id)}.json`), specJson(e.modelled.spec));
        const where = { file: job.file, screen: e.report.id, tree: e.screen.tree };
        const g = gate(e.report, allowlist, where);
        const summary = summarize(job.file, e, g);
        // R51: a draft allowlist entry (magnitude + fingerprint, approved: false) for every open root, approval and crop
        const allowlistDraft = [...g.open.roots.map((x) => allowlistEntry('root', x, where)), ...g.open.approvals.map((x) => allowlistEntry('approval', x, where)),
          ...g.open.crops.map((x) => allowlistEntry('crop', x, where))];
        screensOut.push({ summary, gate: g, report: e.report, flags: e.report.flags, allowlistDraft, ...(e.mutations ? { mutations: e.mutations } : {}) });
        const v = await screenView(browser, job.file, e, g, summary);
        views.push(v); fileViews.push(v);
      }
      if (ext) await ext.afterFile({ job, res, dir, browser, state, views: fileViews });
    }
    const { pass, missed } = runVerdict(screensOut);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const args = { ...(o.corpus ? { corpus: o.corpus } : { html: o.html, root: jobs[0].root }), ...(state && state.args ? state.args : {}), ...(!o.corpus && jobs[0].widen ? { widen: jobs[0].widen } : {}), webFonts: o.webFonts, tol: o.verify, mutate: o.mutate, allowlistApproved: allowlist.filter((e) => e && e.approved === true).length };
    writeFileSync(join(o.out, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), seconds, args, pass, ...(o.mutate ? { mutationsMissed: missed } : {}), screens: screensOut }, null, 1));
    writeFileSync(join(o.out, 'report.html'), renderReportHtml({ generated: `${new Date().toISOString()} · ${seconds} s`, args, screens: views }));
    const failed = screensOut.filter((s) => !s.summary.pass).length;
    log(`${screensOut.length - failed}/${screensOut.length} screens pass in ${seconds} s; report: ${join(o.out, 'report.html')}`);
    if (missed.length) log(`the mutation check missed ${missed.length} planted error${missed.length === 1 ? '' : 's'} (${missed.join(', ')}): the verifier cannot be trusted; exit 1`);
    if (ext) ext.finish({ state, log, pass });
    return pass ? 0 : 1;
  } finally {
    if (own && browser) await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
