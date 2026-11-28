// runs.mjs: where each step logs, the per-step cost summary, the next.mjs line and the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runsFile, logRun, timed, readRuns, costSummary, costLine, main } from '../core/runs.mjs';
import { main as nextMain } from '../core/next.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'vd-runs-'));
const noEnv = { env: {} };

function project(dir) {
  const p = join(dir, 'vd-project.json');
  writeFileSync(p, JSON.stringify({ version: 1, html: 'page.html', out: 'build/ds', figma: { out: 'build/fig' } }));
  return p;
}

test('runsFile: ds --out, cmp --ds, figma <--out>/figma, else the project file; VD_RUNS_LOG wins; null without a folder', () => {
  const d = tmp(), pj = project(d);
  const o = { env: {}, cwd: d };
  assert.equal(runsFile('ds', ['--out', 'x'], o), join(d, 'x', 'runs.jsonl'));
  assert.equal(runsFile('cmp', ['--ds=y'], o), join(d, 'y', 'runs.jsonl'));
  assert.equal(runsFile('figma plan', ['plan', '--out', 'f'], o), join(d, 'f', 'figma', 'runs.jsonl'));
  assert.equal(runsFile('ds', ['--project', pj], o), join(d, 'build', 'ds', 'runs.jsonl'));
  assert.equal(runsFile('figma check', ['check', '--project', pj], o), join(d, 'build', 'fig', 'figma', 'runs.jsonl'));
  assert.equal(runsFile('ds', [], o), null);
  assert.equal(runsFile('ds', ['--project', join(d, 'missing.json')], o), null);
  assert.equal(runsFile('ds', ['--out', 'x'], { env: { VD_RUNS_LOG: 'all.jsonl' }, cwd: d }), join(d, 'all.jsonl'));
});

test('timed: logs tool, exit code and seconds, also when the step throws; an unwritable log never fails the step', async () => {
  const d = tmp();
  const argv = ['--out', d];
  assert.equal(await timed('ds', argv, async () => 1, noEnv), 1);
  assert.deepEqual(await timed('cmp', ['--ds', d], async () => ({ code: 0, x: 1 }), noEnv), { code: 0, x: 1 });
  await assert.rejects(timed('ds', argv, async () => { throw new Error('boom'); }, noEnv), /boom/);
  const rows = readRuns(join(d, 'runs.jsonl'));
  assert.deepEqual(rows.map((r) => [r.tool, r.code, r.tokens]), [['ds', 1, 0], ['cmp', 0, 0], ['ds', 2, 0]]);
  for (const r of rows) { assert.equal(typeof r.seconds, 'number'); assert.ok(!Number.isNaN(Date.parse(r.at))); }
  const file = join(d, 'runs.jsonl');
  mkdirSync(join(d, 'blocked.jsonl'));
  assert.doesNotThrow(() => logRun(join(d, 'blocked.jsonl'), { tool: 'ds' }));
  assert.doesNotThrow(() => logRun(null, { tool: 'ds' }));
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 3);
});

test('costSummary: per step runs / failures / seconds / last run; serve lines by transport with KB; the newest line of each session', () => {
  const c = costSummary([
    { at: '2026-01-01T00:00:00Z', tool: 'ds', code: 0, seconds: 100 },
    { at: '2026-01-02T00:00:00Z', tool: 'ds', code: 1, seconds: 90.5 },
    { at: '2026-01-02T00:01:00Z', via: 'bridge', ok: true, seconds: 20, kbOut: 150.25, kbIn: 2400 },
    { at: '2026-01-02T00:02:00Z', via: 'bridge', ok: false, seconds: 5, kbOut: 10, kbIn: 1 },
    { ts: '2026-01-02T00:03:00Z', tool: 'session', session: 's1', output: 10, input: 5, cacheRead: 100, cacheWrite: 20, apiCalls: 3, minutes: 4 },
    { ts: '2026-01-02T00:09:00Z', tool: 'session', session: 's1', output: 30, input: 6, cacheRead: 200, cacheWrite: 40, apiCalls: 7, minutes: 9.04 },
  ]);
  assert.deepEqual(c.steps, [
    { tool: 'ds', runs: 2, failed: 1, seconds: 190.5, last: 90.5, kbOut: 0, kbIn: 0 },
    { tool: 'figma serve (bridge)', runs: 2, failed: 1, seconds: 25, last: 5, kbOut: 160.3, kbIn: 2401 },
  ]);
  assert.deepEqual(c.sessions, { n: 1, output: 30, input: 6, cacheRead: 200, cacheWrite: 40, apiCalls: 7, minutes: 9 });
  assert.deepEqual(c.total, { runs: 4, seconds: 215.5, kbOut: 160.3, kbIn: 2401, tokens: 276 });
  assert.match(costLine(c), /^cost so far: 4 script runs, 3\.6 min, 0 model tokens in the scripts, 160\.3 KB to Figma; agent 30 output tokens \/ 276 in all \(1 session\)$/);
  assert.equal(costLine(costSummary([])), null);
  assert.match(costLine(costSummary([{ tool: 'ds', seconds: 6 }])), /agent tokens not logged$/);
});

test('CLI: the table for a project, --json, --since; next.mjs prints the cost line only once something was logged', () => {
  const d = tmp(), pj = project(d);
  writeFileSync(join(d, 'page.html'), '<!doctype html>');
  const quiet = () => { const lines = []; return { lines, log: (s) => lines.push(s) }; };
  let q = quiet();
  assert.equal(nextMain(['--project', pj], { log: q.log, cwd: d }), 0);
  assert.ok(!q.lines.some((l) => l.startsWith('cost so far')), q.lines.join('\n'));

  logRun(join(d, 'build', 'ds', 'runs.jsonl'), { at: '2026-01-01T00:00:00Z', tool: 'ds', code: 0, seconds: 30 });
  logRun(join(d, 'build', 'fig', 'figma', 'runs.jsonl'), { at: '2026-02-01T00:00:00Z', tool: 'figma plan', code: 0, seconds: 1.5 });
  q = quiet();
  assert.equal(main(['--project', pj], { log: q.log, cwd: d }), 0);
  assert.match(q.lines[0], /^step\s+runs\s+failed/);
  assert.ok(q.lines.some((l) => /^ds\s+1\s+0\s+30\s+30/.test(l)), q.lines.join('\n'));
  assert.ok(q.lines.some((l) => /^figma plan\s+1/.test(l)));
  assert.match(q.lines.at(-1), /agent tokens: not logged/);
  q = quiet();
  assert.equal(main(['--project', pj, '--json', '--since', '2026-01-15'], { log: q.log, cwd: d }), 0);
  assert.deepEqual(JSON.parse(q.lines[0]).steps.map((s) => s.tool), ['figma plan']);
  q = quiet();
  assert.equal(nextMain(['--project', pj], { log: q.log, cwd: d }), 0);
  const line = q.lines.find((l) => l.startsWith('cost so far'));
  assert.ok(line && /2 script runs/.test(line) && /runs\.mjs/.test(line), q.lines.join('\n'));
  q = quiet();
  assert.equal(main([], { log: q.log }), 2);
  assert.equal(main(['--project', join(d, 'nope.json')], { log: q.log }), 2);
  assert.ok(!existsSync(join(d, 'runs.jsonl')));
});
