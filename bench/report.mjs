#!/usr/bin/env node
// Summarize bench/results/<suite>/runs.jsonl as markdown.
//
//   node bench/report.mjs <suite> [--case <name>] [--last N] [--steps] [--out <file.md>]
//
// One row per run (newest last): case, arm, plugin version@sha, model, cost, minutes, turns, tokens, docs read,
// rework, score and the checks. --steps adds the per-step split of the newest run of each case and arm.
// Costs are list-price estimates from Claude Code (a subscription is not billed in USD); compare, do not sum to a bill.
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = dirname(fileURLToPath(import.meta.url));
const RESULTS = process.env.BENCH_RESULTS || join(BENCH, 'results');
const k = (n) => (n == null ? '–' : n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n));
const usd = (n) => (n == null ? '–' : n.toFixed(n < 1 ? 3 : 2));
const min = (ms) => (ms == null ? '–' : (ms / 60000).toFixed(1));

export function render(rows, { steps = false } = {}) {
  const out = [];
  out.push('| Case | Arm | Plugin | Model | USD | Min | Turns | Out tok | In+cache tok | Docs read | Rework | Denied | Score | Checks |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const t = r.totals || {};
    const p = r.plugin ? `${r.plugin.version || '?'}@${r.plugin.sha || '?'}${r.plugin.dirty ? '+' : ''}` : '—';
    const model = r.model || Object.keys(t.models || {}).join(' ') || '?';
    const checks = (r.checks || []).map((c) => `${c.score >= 1 ? '✓' : c.score > 0 ? '◐' : '✗'} ${c.name}${c.score < 1 && c.score > 0 ? ' ' + c.score.toFixed(2) : ''}`).join('<br>');
    out.push(`| ${r.case} | ${r.arm}${r.error ? ' ⚠ ' + r.error : ''} | ${p} | ${model} | ${usd(r.costUsd)} | ${min(r.durationMs ?? r.wallMs)} | ${r.turns ?? '–'} | ${k(t.output)} | ${k((t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0))} | ${r.docs ? `${r.docs.docReads} (${k(r.docs.docBytes)}B)` : '–'} | ${r.docs?.rework ?? '–'} | ${r.denials ?? 0} | ${r.score ?? '–'} | ${checks} |`);
  }
  if (steps) {
    const newest = new Map();
    for (const r of rows) newest.set(r.case + '/' + r.arm, r);
    for (const [name, r] of newest) {
      if (!r.steps?.length) continue;
      out.push('', `### Steps — ${name} (${r.run})`, '', '| Step | USD | Min | API calls | Tool calls | Out tok | In+cache tok |', '|---|---|---|---|---|---|---|');
      for (const s of r.steps) out.push(`| ${s.step} | ${usd(s.costUsd)} | ${s.minutes} | ${s.apiCalls} | ${s.toolCalls} | ${k(s.output)} | ${k(s.input + s.cacheRead + s.cacheWrite)} |`);
      if (r.docs && Object.keys(r.docs.docFiles).length) out.push('', 'Docs read: ' + Object.entries(r.docs.docFiles).map(([f, n]) => `${f}×${n}`).join(', '));
      if (r.docs && Object.keys(r.docs.checkRuns).length) out.push('Checks run: ' + Object.entries(r.docs.checkRuns).map(([f, n]) => `${f}×${n}`).join(', '));
    }
    out.push('', 'Steps: a message is counted in the step of the next step signal after it (approximation).');
  }
  return out.join('\n');
}

export function main(argv) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      case: { type: 'string' }, last: { type: 'string' }, steps: { type: 'boolean' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } } }));
  } catch (e) { console.error(e.message); return 2; }
  if (values.help || positionals.length !== 1) { console.log('usage: node bench/report.mjs <suite> [--case <name>] [--last N] [--steps] [--out <file.md>]'); return values.help ? 0 : 2; }
  const file = join(RESULTS, positionals[0], 'runs.jsonl');
  if (!existsSync(file)) { console.error(`no runs yet: ${file}`); return 2; }
  let rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (values.case) rows = rows.filter((r) => r.case === values.case);
  if (values.last) rows = rows.slice(-+values.last);
  const md = render(rows, { steps: values.steps });
  if (values.out) writeFileSync(values.out, md + '\n');
  console.log(md);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2));
