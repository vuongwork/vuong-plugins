#!/usr/bin/env node
// Append the cost of the current Claude Code session to a runs log (cost principle 5: measure every run).
//
//   node core/session-log.mjs --log <runs.jsonl> [--transcript <session.jsonl>] [--label <text>] [--print]
//
// Without --transcript it reads the newest *.jsonl in <config>/projects/<slug of the working directory or the nearest
// parent that has one>/ (else the newest transcript of any project written in the last 10 minutes), where
// <config> is $CLAUDE_CONFIG_DIR or ~/.claude and the slug replaces ':', '\', '/' and '.' by '-' (E:\tools\Planora ->
// E--tools-Planora): the session that runs this command is the one writing that file. Appends one JSON line:
//   { ts, tool: 'session', label?, session, models: { id: assistant turns }, apiCalls, output, input, cacheRead,
//     cacheWrite, minutes }
// Token counts are summed once per API message id (a message split over several transcript lines counts once).
// Reads only the transcript; never sends anything anywhere. Exit 0, 2 on a usage error or no transcript.
import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectSlug = (cwd) => cwd.replace(/[:\\/.]/g, '-');

const newestIn = (dir) => {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  if (!files.length) return null;
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
};

// The session was started in the working directory or one of its parents (a skill often cd's into an output folder):
// try the project folder of the cwd, then of each parent. Last resort: the newest transcript of any project, if it was
// written in the last 10 minutes (the running session writes its transcript continuously).
export function newestTranscript(cwd = process.cwd(), env = process.env, now = Date.now()) {
  const projects = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  for (let d = resolve(cwd); ; d = dirname(d)) {
    const hit = newestIn(join(projects, projectSlug(d)));
    if (hit) return hit;
    if (dirname(d) === d) break;
  }
  if (!existsSync(projects)) return null;
  const all = readdirSync(projects).map((p) => newestIn(join(projects, p))).filter(Boolean);
  const best = all.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return best && now - statSync(best).mtimeMs < 10 * 60 * 1000 ? best : null;
}

export function sessionCost(text) {
  const seen = new Set();
  const out = { models: {}, apiCalls: 0, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, minutes: 0 };
  let t0 = null, t1 = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.timestamp) { const t = Date.parse(e.timestamp); if (Number.isFinite(t)) { t0 = t0 ?? t; t1 = t; } }
    if (e.type !== 'assistant' || !e.message) continue;
    const m = e.message;
    if (m.model && !m.model.startsWith('<')) out.models[m.model] = (out.models[m.model] || 0) + 1;
    if (!m.usage || seen.has(m.id)) continue;
    seen.add(m.id);
    out.apiCalls++;
    out.output += m.usage.output_tokens || 0;
    out.input += m.usage.input_tokens || 0;
    out.cacheRead += m.usage.cache_read_input_tokens || 0;
    out.cacheWrite += m.usage.cache_creation_input_tokens || 0;
  }
  if (t0 != null) out.minutes = Math.round((t1 - t0) / 6000) / 10;
  return out;
}

export function main(argv, log = console.log, env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { log: { type: 'string' }, transcript: { type: 'string' }, label: { type: 'string' }, print: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, strict: true }));
  } catch (e) { log(e.message); return 2; }
  if (values.help || !values.log) { log('usage: node core/session-log.mjs --log <runs.jsonl> [--transcript <session.jsonl>] [--label <text>] [--print]'); return values.help ? 0 : 2; }
  const file = values.transcript || newestTranscript(process.cwd(), env);
  if (!file || !existsSync(file)) { log('no session transcript found (pass --transcript)'); return 2; }
  const cost = sessionCost(readFileSync(file, 'utf8'));
  const row = { ts: new Date().toISOString(), tool: 'session', ...(values.label ? { label: values.label } : {}), session: basename(file, '.jsonl'), ...cost };
  appendFileSync(values.log, JSON.stringify(row) + '\n');
  log(`session ${row.session}: ${cost.output} output tokens, ${cost.apiCalls} calls, ${cost.minutes} min (${Object.keys(cost.models).join(', ')})`);
  if (values.print) log(JSON.stringify(row));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
