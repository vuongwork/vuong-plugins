#!/usr/bin/env node
// What running the pipeline costs (cost principle 5: measure every run). Every step appends one line to a runs log;
// this file writes those lines and adds them up per step for a project.
//
//   node core/runs.mjs --project <vd-project.json> [--since <ISO date>] [--json]
//
// Where the lines go (runsFile): <ds out>/runs.jsonl for ds and cmp; <figma out>/figma/runs.jsonl for the figma.mjs
// commands (serve writes its own line there, with the bytes of every job, so it is not timed twice). answer and approve
// are not logged: they wait for a person, not for the machine. VD_RUNS_LOG
// names one file for every step instead. A line: { at, tool, code, seconds, tokens: 0 } (a script step never calls a
// model); serve lines have no tool and carry via, kbOut, kbIn. Agent tokens come from session-log.mjs --log
// <ds out>/runs.jsonl (tool 'session', the whole session so far: only the newest line of each session counts).
//
// costSummary(rows) -> { steps: [{ tool, runs, failed, seconds, last, kbOut, kbIn }], sessions: { n, output, input,
//   cacheRead, cacheWrite, apiCalls, minutes }, total: { runs, seconds, kbOut, kbIn, tokens } }
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readProject } from './project-file.mjs';

const flag = (argv, name) => { const i = argv.indexOf(`--${name}`); if (i >= 0) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(`--${name}=`)); return eq ? eq.slice(name.length + 3) : undefined; };

// the log a step writes to, from its own arguments (null: nowhere to write, e.g. a usage error before --out).
// ds: --out; cmp: --ds; figma <cmd>: <--out>/figma/; else the project file's out (figma: figma.out).
const DIR_FLAG = { ds: 'out', cmp: 'ds' };
export function runsFile(tool, argv, { env = process.env, cwd = process.cwd() } = {}) {
  if (env.VD_RUNS_LOG) return resolve(cwd, env.VD_RUNS_LOG);
  const figma = tool.startsWith('figma');
  let out = flag(argv, figma ? 'out' : DIR_FLAG[tool] || 'out');
  if (out) out = resolve(cwd, out);
  else {
    const pj = flag(argv, 'project');
    if (!pj) return null;
    let p;
    try { p = readProject(resolve(cwd, pj)); } catch { return null; }
    out = figma ? p.figma && p.figma.out : p.out;
    if (!out) return null;
  }
  return figma ? join(out, 'figma', 'runs.jsonl') : join(out, 'runs.jsonl');
}

export function logRun(file, row) {
  if (!file) return;
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify(row)}\n`); } catch { /* a log that cannot be written never fails the step */ }
}

// run main(argv) and log its time and exit code; returns what main returned
export async function timed(tool, argv, run, opts = {}) {
  const t0 = Date.now();
  let res, code = 2;
  try { res = await run(); code = typeof res === 'number' ? res : (res && res.code) || 0; return res; } finally {
    logRun(runsFile(tool, argv, opts), { at: new Date(t0).toISOString(), tool, code, seconds: Math.round((Date.now() - t0) / 100) / 10, tokens: 0 });
  }
}

export function readRuns(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const r1 = (x) => Math.round(x * 10) / 10;

export function costSummary(rows) {
  const steps = new Map(), sessions = new Map();
  for (const r of rows) {
    if (r.tool === 'session') { const k = r.session || r.ts; const prev = sessions.get(k); if (!prev || String(r.ts) >= String(prev.ts)) sessions.set(k, r); continue; }
    const tool = r.tool || (r.via ? `figma serve (${r.via})` : 'other');
    const s = steps.get(tool) || { tool, runs: 0, failed: 0, seconds: 0, last: 0, lastAt: '', kbOut: 0, kbIn: 0 };
    s.runs++;
    if (r.code ? r.code !== 0 : r.ok === false) s.failed++;
    s.seconds += r.seconds || 0;
    const at = r.at || r.ts || '';
    if (at >= s.lastAt) { s.lastAt = at; s.last = r.seconds || 0; }
    s.kbOut += r.kbOut || 0; s.kbIn += r.kbIn || 0;
    steps.set(tool, s);
  }
  const list = [...steps.values()].map(({ lastAt, ...s }) => ({ ...s, seconds: r1(s.seconds), kbOut: r1(s.kbOut), kbIn: r1(s.kbIn) }));
  const sess = { n: sessions.size, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, apiCalls: 0, minutes: 0 };
  for (const s of sessions.values()) for (const k of ['output', 'input', 'cacheRead', 'cacheWrite', 'apiCalls', 'minutes']) sess[k] += s[k] || 0;
  sess.minutes = r1(sess.minutes);
  const sum = (k) => r1(list.reduce((n, s) => n + s[k], 0));
  return { steps: list, sessions: sess, total: { runs: sum('runs'), seconds: sum('seconds'), kbOut: sum('kbOut'), kbIn: sum('kbIn'), tokens: sess.output + sess.input + sess.cacheRead + sess.cacheWrite } };
}

export function projectRuns(p, { since } = {}) {
  const files = [p.out && join(p.out, 'runs.jsonl'), p.figma && p.figma.out && join(p.figma.out, 'figma', 'runs.jsonl')].filter(Boolean);
  const env = process.env.VD_RUNS_LOG ? [resolve(process.env.VD_RUNS_LOG)] : [];
  const all = [...new Set([...files, ...env])].flatMap(readRuns);
  return since ? all.filter((r) => String(r.at || r.ts || '') >= since) : all;
}

const k = (n) => (n >= 1e6 ? `${r1(n / 1e6)}M` : n >= 1e3 ? `${r1(n / 1e3)}k` : String(n));

// one line for next.mjs (null when nothing was logged)
export function costLine(c) {
  if (!c.total.runs && !c.sessions.n) return null;
  const agent = c.sessions.n ? `agent ${k(c.sessions.output)} output tokens / ${k(c.total.tokens)} in all (${c.sessions.n} session${c.sessions.n === 1 ? '' : 's'})` : 'agent tokens not logged';
  return `cost so far: ${c.total.runs} script runs, ${r1(c.total.seconds / 60)} min, 0 model tokens in the scripts, ${c.total.kbOut} KB to Figma; ${agent}`;
}

export function costLines(c) {
  const out = ['step                    runs  failed  total s  last s  KB out  KB in'];
  for (const s of c.steps) out.push(`${s.tool.padEnd(22)} ${String(s.runs).padStart(5)} ${String(s.failed).padStart(7)} ${String(s.seconds).padStart(8)} ${String(s.last).padStart(7)} ${String(s.kbOut).padStart(7)} ${String(s.kbIn).padStart(6)}`);
  out.push(`total: ${c.total.runs} runs, ${c.total.seconds} s (${r1(c.total.seconds / 60)} min), ${c.total.kbOut} KB to Figma, ${c.total.kbIn} KB back; the scripts use 0 model tokens`);
  const s = c.sessions;
  out.push(s.n ? `agent (${s.n} session${s.n === 1 ? '' : 's'}): ${k(s.output)} output, ${k(s.input)} input, ${k(s.cacheRead)} cache read, ${k(s.cacheWrite)} cache write tokens; ${s.apiCalls} API calls; ${s.minutes} min`
    : 'agent tokens: not logged (run session-log.mjs --log <ds out>/runs.jsonl at the end of a task)');
  return out;
}

const USAGE = 'usage: node core/runs.mjs --project <vd-project.json> [--since <ISO date>] [--json]';

export function main(argv, { log = (s) => process.stdout.write(`${s}\n`), cwd = process.cwd() } = {}) {
  let o;
  try { o = parseArgs({ args: argv, options: { project: { type: 'string' }, since: { type: 'string' }, json: { type: 'boolean' } }, strict: true }).values; } catch (e) { log(`${e.message}\n${USAGE}`); return 2; }
  if (!o.project) { log(USAGE); return 2; }
  let p;
  try { p = readProject(resolve(cwd, o.project)); } catch (e) { log(e.message); return 2; }
  const c = costSummary(projectRuns(p, { since: o.since }));
  if (o.json) log(JSON.stringify(c));
  else for (const l of costLines(c)) log(l);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
