#!/usr/bin/env node
// Design-system CLI (plan 2, Task 9): the plan-1 layout run plus inventory -> normalize -> apply-norm -> norm proxy
// verification -> tokens -> coverage -> design-system.html.
//
//   node core/ds.mjs --html <file> --root <selector> --out <dir> [--rules <vd-rules.json>] [--names <vd-names.json>]
//        [every option of layout.mjs]
//   node core/ds.mjs --corpus <corpus.json> [--corpus-dir <dir>] --out <dir> [same options]
//
// Rules file: --rules, else vd-rules.json in the current working directory when it exists, else none (every question
// stays 'ask': the safe mode of spec §15). Names file: --names, else vd-names.json in the current working directory
// when it exists. Both are only read, never written (a draft of the open answers goes to <out>/vd-rules.draft.json).
//
// Per HTML file (normalisation runs over all the screens of the file, since roles and scales are file-wide):
//   capture + infer + figma-model of every screen -> inventory -> normalize(rules) -> applyNorm per screen -> each
//   screen verified by runScreen(..., { norm }) when its target has at least one applied record (else the plan-1 run;
//   with --mutate the mutations get the norm too: normSilent / normWrongValue) -> buildTokens(names) -> coverage.
// Writes into --out (corpus mode: into <out>/<file stem>/, one design system per HTML file; report.json and
// report.html cover all files, as layout.mjs): everything layout.mjs writes (ir.json, spec-<id>.json, report.json,
// report.html), plus tokens.json (DTCG), tokens.css, token-map.json (per screen and node: property -> token path, see
// tokenMap in tokens.mjs), normalisation.json ({ entries, counts, unparsed, stale, rules }),
// questions.json (normalize questions, then the §8.4 project confirmations), vd-rules.draft.json (rulesTemplate of the
// open questions), coverage.json, spec-norm-<id>.json (the target spec of each screen, compact JSON) and
// design-system.html. tokens.json, tokens.css, token-map.json, normalisation.json, questions.json, vd-rules.draft.json and
// coverage.json are deterministic (no clock; the order of screens does not matter).
// screens[i].darkMode (coverage, §8.4) = the page CSS has a prefers-color-scheme media query: the HTML file's text and
// the local stylesheets it links (<link rel="stylesheet" href> relative to the file; remote ones are not read).
// Exit codes (as layout.mjs): 0 every screen passes the plan-1 gate (an unexplained root of layer 'norm', i.e. a
// change of the target spec no report entry explains, fails its screen and is never allowlistable) and no mutation
// was missed; 1 otherwise; 2 usage / setup error (bad rules or names file, an answer that is not an option). Open
// questions never make the run fail ("run everything, review later"); the last line gives their number.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as layoutMain, UsageError } from './layout.mjs';
import { inventory } from './inventory.mjs';
import { normalize } from './normalize.mjs';
import { applyNorm } from './apply-norm.mjs';
import { readRules, rulesTemplate } from './rules-file.mjs';
import { readNames } from './names-file.mjs';
import { buildTokens, tokenMap } from './tokens.mjs';
import { coverage, loadChecklist, projectQuestions } from './coverage.mjs';
import { renderDsReport, typeSamples } from './ds-report.mjs';
import { answerImpact } from './report-html.mjs';
import { specJson } from './pipeline.mjs';
import { timed } from './runs.mjs';

export const DS_USAGE = `usage: node core/ds.mjs --html <file> --root <selector> --out <dir> [--rules <json>] [--names <json>] [layout options]
       node core/ds.mjs --corpus <corpus.json> [--corpus-dir <dir>] --out <dir> [--rules <json>] [--names <json>] [layout options]
       node core/ds.mjs --project <vd-project.json> [any option, overriding the project file]
options: --rules <json> (default ./vd-rules.json when present) --names <json> (default ./vd-names.json when present)
         --widen <sel> --name <sel> --widen-by <px> --viewport <px> --tol-frame <px> --tol-text <px> --tol-model <px>
         --no-webfonts --allowlist <json> --mutate --mutate-sample <n>`;

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const json = (x) => `${JSON.stringify(x, null, 1)}\n`;
const isOpen = (q) => q.answered === undefined && !q.resolved;

// dark mode in the page CSS: the HTML text and its local linked stylesheets
export function hasDarkMode(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const re = /prefers-color-scheme\s*:\s*dark/i;
  if (re.test(html)) return true;
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!href || /^[a-z]+:|^\/\//i.test(href[1])) continue;
    const p = resolve(dirname(htmlPath), href[1].split(/[?#]/)[0]);
    if (existsSync(p) && re.test(readFileSync(p, 'utf8'))) return true;
  }
  return false;
}

// The design system of one HTML file. items = [{ screen, spec (modelled) }] in any order; rules = readRules(),
// names = readNames(). Pure and deterministic. Returns { inv, norm, targets: { [screen id]: { spec, applied } },
// built (buildTokens), cov, questions, draft, stale }.
export function designSystem(items, { rules = { version: 1, answers: {} }, names = {}, checklist = loadChecklist() } = {}) {
  const pairs = items.map(({ screen, spec }) => ({ screen, spec }));
  const inv = inventory(pairs);
  const norm = normalize(inv, rules);
  const targets = {};
  for (const { screen, spec } of pairs) targets[String(screen.id ?? screen.name)] = applyNorm(spec, norm.entries, String(screen.id ?? screen.name));
  const built = buildTokens(inv, norm.entries, names);
  const screens = pairs.map((p) => p.screen);
  const cov = coverage(checklist, { inv, tokens: built.tokens, screens, rules });
  const pq = projectQuestions({ inv, screens, tokens: built.tokens, rules });
  const questions = [...norm.questions, ...pq];
  const draft = rulesTemplate(questions);
  // answers to the §8.4 confirmations are no normalize question: not stale
  const stale = norm.stale.filter((k) => !pq.some((q) => q.key === k));
  return { inv, norm, targets, built, cov, questions, draft, stale };
}

// before / after crops for design-system.html: the first node of each applied entry, source page vs norm proxy at A
async function changeCrops(browser, entries, res, limit = 60) {
  const { cutImages } = await import('./report-html.mjs');
  const byScreen = new Map(res.screens.map((e) => [String(e.screen.id ?? e.screen.name), e]));
  const jobs = [], refs = [];
  const PAD = 8;
  for (const en of entries) {
    if (refs.length >= limit) break;
    if (en.status !== 'auto' && en.status !== 'answered') continue;
    const at = en.nodes.find((n) => byScreen.get(String(n.screen))?.norm);
    if (!at) continue;
    const e = byScreen.get(String(at.screen));
    const find = (t) => { if (!t) return null; if (t.id === at.node) return t; for (const k of t.kids || []) { const r = find(k); if (r) return r; } return null; };
    const src = find(e.screen.tree)?.rA, box = e.norm.A.boxes[at.node];
    if (!src || !box || !e.norm.A.png) continue;
    const x0 = Math.min(src[0], box[0]) - PAD, y0 = Math.min(src[1], box[1]) - PAD;
    const win = [x0, y0, Math.max(src[0] + src[2], box[0] + box[2]) + PAD - x0, Math.max(src[1] + src[3], box[1] + box[3]) + PAD - y0];
    refs.push({ entry: en.id, s: jobs.push({ png: e.screen.png[0], win, mark: src, minOut: 64 }) - 1, n: jobs.push({ png: e.norm.A.png, win, mark: box, minOut: 64 }) - 1 });
  }
  const urls = await cutImages(browser, jobs);
  return refs.map((r) => ({ entry: r.entry, src: urls[r.s], norm: urls[r.n] }));
}

export const DS_EXT = {
  usage: DS_USAGE,
  options: { rules: { type: 'string' }, names: { type: 'string' } },
  async setup(o, deps = {}) {
    const cwd = deps.cwd || process.cwd();
    const pick = (given, file) => (given ? resolve(cwd, given) : existsSync(join(cwd, file)) ? join(cwd, file) : null);
    const rulesPath = pick(o.rules, 'vd-rules.json'), namesPath = pick(o.names, 'vd-names.json');
    if (o.rules && !existsSync(rulesPath)) throw new UsageError(`rules file not found: ${rulesPath}`);
    if (o.names && !existsSync(namesPath)) throw new UsageError(`names file not found: ${namesPath}`);
    const rules = readRules(rulesPath), names = readNames(namesPath), checklist = loadChecklist();
    return { rules, names, checklist, rulesPath, namesPath, project: o.project ? resolve(o.project) : null, files: new Map(), open: 0, args: { rules: rulesPath, names: namesPath } };
  },
  normalize(job, items, state) {
    const dark = hasDarkMode(job.path);
    for (const it of items) it.screen.darkMode = dark;
    const ds = designSystem(items.map((it) => ({ screen: it.screen, spec: it.modelled.spec })), state);
    state.files.set(job.path, ds);
    // m8: verify cross-checks every applied record against the entries
    return items.map((it) => ({ ...ds.targets[String(it.screen.id ?? it.screen.name)], entries: ds.norm.entries }));
  },
  async afterFile({ job, res, dir, browser, state, views = [] }) {
    const ds = state.files.get(job.path);
    const { norm, built, cov, questions, draft } = ds;
    // R97: an applied answer that a failing finding names spoils the UI: listed per answer (question key, or the rule of
    // an automatic change), set on its question (breaks) and logged, so the answer is changed instead of the picture approved
    const byId = new Map(norm.entries.map((e) => [e.id, e]));
    const impact = new Map();
    for (const r of answerImpact(views)) {
      const e = byId.get(r.entry); if (!e) continue;
      const key = e.question || `${e.code} (automatic)`;
      const x = impact.get(key) || { answer: key, code: e.code, changes: new Set(), screens: new Set(), findings: 0 };
      x.changes.add(`${e.prop} ${e.from} → ${e.to}`); for (const sc of r.screens) x.screens.add(sc); x.findings += r.findings;
      impact.set(key, x);
    }
    const nat = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
    const layoutImpact = [...impact.values()].map((x) => ({ ...x, changes: [...x.changes].sort(nat), screens: [...x.screens].sort(nat) }))
      .sort((a, b) => b.screens.length - a.screens.length || nat(a.answer, b.answer));
    for (const q of questions) { const x = impact.get(q.key); if (x) q.breaks = { screens: [...x.screens].sort(nat), findings: x.findings }; }
    for (const e of res.screens) writeFileSync(join(dir, `spec-norm-${safe(e.report.id)}.json`), specJson(e.target ? e.target.spec : e.modelled.spec));
    writeFileSync(join(dir, 'tokens.json'), json(built.tokens));
    writeFileSync(join(dir, 'tokens.css'), built.css);
    writeFileSync(join(dir, 'token-map.json'), json(tokenMap(ds.inv, built.tokens, norm.entries, state.names)));
    writeFileSync(join(dir, 'normalisation.json'), json({ entries: norm.entries, counts: norm.counts, unparsed: norm.unparsed, stale: ds.stale, ...(layoutImpact.length ? { layoutImpact } : {}), ...(built.warnings && built.warnings.length ? { warnings: built.warnings } : {}) }));
    writeFileSync(join(dir, 'questions.json'), json(questions));
    writeFileSync(join(dir, 'vd-rules.draft.json'), json(draft));
    writeFileSync(join(dir, 'coverage.json'), json(cov));
    const samples = typeSamples({ inv: ds.inv, tokens: built.tokens, map: built.map, screens: res.screens.map((e) => ({ screen: e.screen, spec: e.modelled.spec })) });
    const crops = await changeCrops(browser, norm.entries, res);
    writeFileSync(join(dir, 'design-system.html'), renderDsReport({
      tokens: built.tokens, entries: norm.entries, questions, coverage: cov, counts: norm.counts, samples, crops,
      title: `Design system proposal: ${job.file}`, generated: new Date().toISOString(),
      answer: { rulesPath: state.rulesPath, rules: state.rules },
    }));
    const open = norm.questions.filter(isOpen).length;
    state.open += open;
    const n = (k) => norm.entries.filter((e) => e.status === k).length;
    const normScreens = res.screens.filter((e) => e.report.norm);
    const unexplained = normScreens.reduce((x, e) => x + e.report.norm.unexplained.length, 0);
    state.summary = [...(state.summary || []), { file: job.file, auto: n('auto'), answered: n('answered'), ask: n('ask'), open, unexplained, layoutImpact }];
  },
  finish({ state, log, pass }) {
    for (const s of state.summary || []) {
      log(`${s.file}: ${s.auto} auto, ${s.answered} answered, ${s.ask} asked; ${s.unexplained} unexplained norm root(s)`);
      for (const x of s.layoutImpact || []) log(`  answer ${x.answer} (${x.changes.slice(0, 3).join(', ')}${x.changes.length > 3 ? ', ...' : ''}) is named by ${x.findings} failing finding(s) on ${x.screens.join(', ')}: change that answer rather than approve the pictures`);
    }
    const tool = (f) => `node ${join(dirname(fileURLToPath(import.meta.url)), f)}`;
    if (pass === false) log(`approve findings in the browser: ${tool('approve.mjs')} ${state.project ? `--project ${state.project}` : '--out <output folder> --allowlist <vd-allowlist.json>'}`);
    if (state.open) log(`answer them in the browser: ${tool('answer.mjs')} ${state.project ? `--project ${state.project}` : `--out <output folder>${state.rulesPath ? '' : ' --rules <vd-rules.json>'}`}`);
    log(`${state.open} open question${state.open === 1 ? '' : 's'}${state.rulesPath ? ` (rules: ${state.rulesPath})` : ' (no rules file)'}; draft answers: vd-rules.draft.json in the output folder`);
  },
};

export const main = (argv, deps = {}) => layoutMain(argv, deps, DS_EXT);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  timed('ds', argv, () => main(argv)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
