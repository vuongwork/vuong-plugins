#!/usr/bin/env node
// Run one bench case: copy the fixture into a temp workspace, run `claude -p` with (arm "plugin") or without
// (arm "baseline") the plugin, stamp the stream-json trace, grade the workspace, append one row per run to
// bench/results/<suite>/runs.jsonl.
//
//   node bench/run.mjs <case dir> [--arm plugin|baseline|both] [--runs N] [--budget USD] [--model M] [--effort E]
//                      [--keep] [--claude <exe>] [--regrade <run dir>]
//   node bench/run.mjs --rebuild <suite>     recompute every row from its trace (after a parser change)
//
// case.json (in the case dir):
//   plugin       plugin folder, relative to the repo root (arm "plugin" loads it with --plugin-dir)
//   fixture      folder name under bench/fixtures/ copied into the workspace (optional)
//   inputs       folder in the case dir copied over the fixture (default "inputs", if it exists)
//   prompt       prompt file (default prompt.md); {{WS}} is replaced by the workspace path
//   answers      appended to the system prompt (default answers.md, if it exists): the answers a person would give
//   key          answer key JSON passed to grade.mjs (default key.json, if it exists)
//   steps        steps.json for the per-step split (default <suite>/steps.json)
//   budgetUsd    --max-budget-usd (default 1)      timeoutSec   wall clock limit (default 1800)
//   model, effort, permissionMode (default auto, like a person working in auto mode), allowedTools [..], disallowedTools [..] (AskUserQuestion is
//   always removed: nobody answers in a bench run), arms (default ["plugin"]; add "baseline" when the comparison
//   means something), setup [shell commands run in the workspace before claude], copy [[from (repo-relative), to
//   (workspace-relative)], ...], env { NAME: value } added to the child's environment
// Exit 0 when every run finished (whatever the score), 1 when a run failed to start or grade, 2 on usage errors.
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTrace, readTrace, totals } from './lib/transcript.mjs';
import { byStep, docsAndRework } from './lib/steps.mjs';
import { exists, read, sh } from './lib/grade.mjs';
import { childEnvFor } from './lib/env.mjs';

const BENCH = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(BENCH);
const RESULTS = () => process.env.BENCH_RESULTS || join(BENCH, 'results');
const jsonOr = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

export const childEnv = childEnvFor;

export function loadCase(caseDir) {
  const dir = resolve(caseDir);
  const c = jsonOr(join(dir, 'case.json'), null);
  if (!c) throw new Error(`no case.json in ${dir}`);
  const suiteDir = dirname(dirname(dir)); // suites/<suite>/cases/<case>
  const opt = (name, def) => (c[name] ? join(dir, c[name]) : existsSync(join(dir, def)) ? join(dir, def) : null);
  return {
    ...c,
    name: basename(dir), dir, suite: basename(suiteDir), suiteDir,
    promptFile: opt('prompt', 'prompt.md'), answersFile: opt('answers', 'answers.md'), keyFile: opt('key', 'key.json'),
    inputsDir: opt('inputs', 'inputs'), stepsFile: c.steps ? join(dir, c.steps) : join(suiteDir, 'steps.json'),
    gradeFile: existsSync(join(dir, 'grade.mjs')) ? join(dir, 'grade.mjs') : null,
    arms: c.arms || ['plugin'], budgetUsd: c.budgetUsd ?? 1, timeoutSec: c.timeoutSec ?? 1800,
  };
}

function git(args, cwd) { return spawnSync('git', args, { cwd, encoding: 'utf8' }); }

export function pluginInfo(pluginDir) {
  if (!pluginDir) return null;
  const pj = jsonOr(join(pluginDir, '.claude-plugin', 'plugin.json'), {});
  const sha = git(['rev-parse', '--short', 'HEAD'], pluginDir).stdout?.trim() || null;
  const dirty = !!git(['status', '--porcelain', '--', '.'], pluginDir).stdout?.trim();
  return { name: pj.name || basename(pluginDir), version: pj.version || null, sha, dirty };
}

export function makeWorkspace(c) {
  const ws = mkdtempSync(join(tmpdir(), `bench-${c.name}-`));
  if (c.fixture) cpSync(join(BENCH, 'fixtures', c.fixture), ws, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)$/.test(s) });
  if (c.inputsDir) cpSync(c.inputsDir, ws, { recursive: true });
  for (const [from, to] of c.copy || []) cpSync(resolve(REPO, from), join(ws, to), { recursive: true });
  for (const cmd of c.setup || []) {
    const r = sh(cmd, ws);
    if (r.code !== 0) throw new Error(`setup "${cmd}" failed: ${r.out.slice(-500)}`);
  }
  const g = (a) => git(a, ws);
  g(['init', '-q']);
  g(['add', '-A']);
  g(['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-q', '-m', 'fixture', '--allow-empty']);
  return ws;
}

export function claudeArgs(c, arm, ws, opts) {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--setting-sources', '', '--strict-mcp-config',
    '--max-budget-usd', String(opts.budget ?? c.budgetUsd),
    '--permission-mode', c.permissionMode || 'auto',
    '--disallowed-tools', ['AskUserQuestion', ...(c.disallowedTools || [])].join(',')];
  if (c.allowedTools?.length) a.push('--allowed-tools', c.allowedTools.join(','));
  const model = opts.model || c.model;
  if (model) a.push('--model', model);
  const effort = opts.effort || c.effort;
  if (effort) a.push('--effort', effort);
  if (c.answersFile) a.push('--append-system-prompt-file', c.answersFile);
  if (arm === 'plugin') a.push('--plugin-dir', resolve(REPO, c.plugin));
  for (const d of c.addDirs || []) a.push('--add-dir', resolve(REPO, d));
  return a;
}

function runClaude(exe, args, prompt, ws, traceFile, timeoutSec, env) {
  return new Promise((done) => {
    const t0 = Date.now();
    const [cmd, pre] = /\.m?js$/.test(exe) ? [process.execPath, [exe]] : [exe, []];
    const p = spawn(cmd, [...pre, ...args], { cwd: ws, env: { ...childEnv(), ...(env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', killed = false;
    const timer = setTimeout(() => { killed = true; p.kill(); }, timeoutSec * 1000);
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { e = { type: 'raw', text: line }; }
        appendFileSync(traceFile, JSON.stringify({ t: Date.now() - t0, e }) + '\n');
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); done({ code: -1, err: String(e), ms: Date.now() - t0, killed }); });
    p.on('close', (code) => { clearTimeout(timer); done({ code, err, ms: Date.now() - t0, killed }); });
    p.stdin.end(prompt);
  });
}

export async function grade(c, ws, events) {
  if (!c.gradeFile) return [];
  const mod = await import(pathToFileURL(c.gradeFile).href);
  const key = c.keyFile ? JSON.parse(readFileSync(c.keyFile, 'utf8')) : null;
  try {
    const checks = await mod.default({ ws, caseDir: c.dir, key, events, sh: (cmd, o) => sh(cmd, ws, o), read: (r) => read(ws, r), exists: (r) => exists(ws, r) });
    // suite-level process checks from the trace (info only): suites/<suite>/process.mjs
    const proc = join(c.suiteDir, 'process.mjs');
    if (existsSync(proc)) checks.push(...(await import(pathToFileURL(proc).href)).default(events));
    return checks;
  } catch (e) {
    return [{ name: 'grader crashed', score: 0, pass: false, detail: String(e?.stack || e).slice(0, 800), by: 'code' }];
  }
}

export function summarize(c, events) {
  const parsed = parseTrace(events);
  const def = jsonOr(c.stepsFile, { steps: [] });
  const tot = totals(parsed.messages);
  return {
    result: parsed.result,
    totals: tot,
    steps: byStep(parsed.messages, def),
    docs: docsAndRework(parsed.messages, def),
    skillLoaded: def.skill ? parsed.init.skills.includes(def.skill) : null,
    usedSkill: parsed.messages.some((m) => m.tools.some((t) => t.name === 'Skill' && (!def.skill || String(t.input.skill || '').includes(def.skill.split(':').pop())))),
  };
}

const score = (all) => { const checks = all.filter((k) => !k.info); return checks.length ? Math.round((checks.reduce((a, k) => a + k.score, 0) / checks.length) * 1000) / 1000 : null; };

async function runOnce(c, arm, i, opts) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${arm}-${i}`;
  const runDir = join(RESULTS(), c.suite, c.name, runId);
  mkdirSync(runDir, { recursive: true });
  const ws = makeWorkspace(c);
  const prompt = readFileSync(c.promptFile, 'utf8').replaceAll('{{WS}}', ws.replace(/\\/g, '/'));
  const args = claudeArgs(c, arm, ws, opts);
  writeFileSync(join(runDir, 'command.json'), JSON.stringify({ exe: opts.claude, args, ws }, null, 2));
  const traceFile = join(runDir, 'trace.jsonl');
  writeFileSync(traceFile, '');
  console.log(`[${c.suite}/${c.name}] ${arm} #${i}: running in ${ws}`);
  const proc = await runClaude(opts.claude, args, prompt, ws, traceFile, opts.timeoutSec ?? c.timeoutSec, c.env);
  if (proc.err) writeFileSync(join(runDir, 'stderr.txt'), proc.err);
  const events = readTrace(readFileSync(traceFile, 'utf8'));
  const sum = summarize(c, events);
  const checks = await grade(c, ws, events);
  writeFileSync(join(runDir, 'grade.json'), JSON.stringify(checks, null, 2));
  const row = {
    ts: new Date().toISOString(), suite: c.suite, case: c.name, arm, run: runId,
    plugin: arm === 'plugin' ? pluginInfo(resolve(REPO, c.plugin)) : null,
    model: opts.model || c.model || null, effort: opts.effort || c.effort || null, budgetUsd: opts.budget ?? c.budgetUsd, permissionMode: c.permissionMode || 'auto',
    exit: proc.code, killed: proc.killed, wallMs: proc.ms,
    error: !sum.result ? 'no result event' : sum.result.isError ? sum.result.terminalReason || 'error' : null,
    costUsd: sum.result?.costUsd ?? null, durationMs: sum.result?.durationMs ?? null, turns: sum.result?.turns ?? null,
    denials: sum.result?.denials?.length || 0, skillLoaded: sum.skillLoaded, usedSkill: sum.usedSkill,
    totals: sum.totals, steps: sum.steps, docs: sum.docs,
    score: score(checks), checks: checks.map(({ name, score: s, by, info }) => ({ name, score: s, by, ...(info ? { info } : {}) })),
  };
  appendFileSync(join(RESULTS(), c.suite, 'runs.jsonl'), JSON.stringify(row) + '\n');
  const keep = opts.keep || row.error || proc.code !== 0;
  if (keep) writeFileSync(join(runDir, 'workspace.txt'), ws + '\n');
  else rmSync(ws, { recursive: true, force: true });
  console.log(`  cost ${row.costUsd ?? '?'} USD · ${Math.round((row.durationMs ?? proc.ms) / 1000)} s · ${row.turns ?? '?'} turns · score ${row.score ?? '-'}${row.error ? ' · ERROR ' + row.error : ''}${keep ? ' · kept ' + ws : ''}`);
  for (const k of checks) console.log(`    ${k.info ? 'ℹ' : k.score >= 1 ? '✓' : '✗'} ${k.name}: ${k.score}${k.detail ? ' — ' + String(k.detail).split('\n')[0].slice(0, 160) : ''}`);
  return row;
}

// Recompute cost / time / turns / totals / steps / docs of every row of a suite from its kept trace (after a parser fix). Grades are kept.
export function rebuild(suite) {
  const file = join(RESULTS(), suite, 'runs.jsonl');
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let n = 0;
  for (const r of rows) {
    const trace = join(RESULTS(), suite, r.case, r.run, 'trace.jsonl');
    const caseDir = [join(BENCH, 'suites', suite, 'cases', r.case), join(BENCH, 'test', 'suites', suite, 'cases', r.case)].find(existsSync);
    if (!existsSync(trace) || !caseDir) continue;
    const sum = summarize(loadCase(caseDir), readTrace(readFileSync(trace, 'utf8')));
    Object.assign(r, { totals: sum.totals, steps: sum.steps, docs: sum.docs, skillLoaded: sum.skillLoaded, usedSkill: sum.usedSkill });
    if (sum.result) Object.assign(r, { costUsd: sum.result.costUsd, durationMs: sum.result.durationMs, turns: sum.result.turns });
    n++;
  }
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`rebuilt ${n}/${rows.length} rows of ${file}`);
  return 0;
}

export async function main(argv) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      arm: { type: 'string' }, runs: { type: 'string' }, budget: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
      keep: { type: 'boolean' }, claude: { type: 'string' }, regrade: { type: 'string' }, rebuild: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } }));
  } catch (e) { console.error(e.message); return 2; }
  if (values.rebuild) return rebuild(values.rebuild);
  if (values.help || positionals.length !== 1) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return values.help ? 0 : 2; }
  const c = loadCase(positionals[0]);
  if (values.regrade) {
    const ws = readFileSync(join(values.regrade, 'workspace.txt'), 'utf8').trim();
    const checks = await grade(c, ws, readTrace(readFileSync(join(values.regrade, 'trace.jsonl'), 'utf8')));
    for (const k of checks) console.log(`${k.info ? 'ℹ' : k.score >= 1 ? '✓' : '✗'} ${k.name}: ${Math.round(k.score * 100) / 100}${k.detail ? ' — ' + k.detail : ''}`);
    writeFileSync(join(values.regrade, 'grade.json'), JSON.stringify(checks, null, 2));
    // update the run's row in runs.jsonl (grader fixed after the run)
    const file = join(RESULTS(), c.suite, 'runs.jsonl');
    const runId = basename(resolve(values.regrade));
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    for (const r of rows) if (r.run === runId && r.case === c.name) Object.assign(r, { score: score(checks), checks: checks.map(({ name, score: s, by, info }) => ({ name, score: s, by, ...(info ? { info } : {}) })), regraded: new Date().toISOString() });
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`score ${score(checks)}`);
    return 0;
  }
  const arms = values.arm === 'both' ? ['plugin', 'baseline'] : values.arm ? [values.arm] : c.arms;
  const opts = { claude: values.claude || process.env.BENCH_CLAUDE || 'claude', budget: values.budget ? +values.budget : undefined,
    model: values.model, effort: values.effort, keep: !!values.keep };
  let failed = 0;
  for (let i = 1; i <= (+values.runs || c.runs || 1); i++) for (const arm of arms) {
    try { const r = await runOnce(c, arm, i, opts); if (r.exit !== 0 && !r.costUsd) failed++; } catch (e) { console.error(`  run failed: ${e.message}`); failed++; }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
