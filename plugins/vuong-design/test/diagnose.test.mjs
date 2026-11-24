import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose, formatDiagnosis, nodeLabels, main as diagMain } from '../core/diagnose.mjs';
import { sessionCost, projectSlug, main as logMain } from '../core/session-log.mjs';

const ir = { screens: [
  { id: 's0', tree: { id: 'n', tag: 'div', cls: 'screen', kids: [{ id: 'n.1', tag: 'div', cls: 'hero', kids: [{ id: 'n.1.0', tag: 'p', cls: 'body center', text: 'Nắng nhẹ, có mây rải rác suốt ngày' }] }] } },
  { id: 's1', tree: { id: 'n', tag: 'div', cls: 'screen', kids: [] } },
] };
const report = { screens: [
  { summary: { screen: 's0', pass: false, unexplainedRoots: 1, needsApproval: 1, cropA: 0, cropB: 6, data: {} },
    report: { roots: [{ id: 'n.1.0', width: 'B', delta: [36.5, 0, -72.981, 20] }, { id: 'n.1', width: 'B', delta: [0, 0, 0, 1], explained: true }],
      needsApproval: [{ id: 'n.1', width: 'A', delta: [-1, 0, 2.04, 0], explainedBy: 'figmaModel' }],
      crop: [...Array(6)].map((_, i) => ({ id: 'n.1.0', width: 'B', ratio: 0.2 + i / 100, peak: 50 })).concat([{ id: 'n.1', width: 'A', ratio: 0.01, peak: 2 }]) } },
  { summary: { screen: 's1', pass: true }, report: {} },
] };
const lint = { screens: [{ id: 'W1' }, { id: 'W2' }] };

test('nodeLabels: last three levels and the start of the text', () => {
  const label = nodeLabels(ir.screens[0]).get('n.1.0');
  assert.match(label, /^div\.screen > div\.hero > p\.body "Nắng nhẹ/);
  assert.ok(label.length < 'div.screen > div.hero > p.body "'.length + 26, label); // text cut to 24 characters
});

test('diagnose: failing screens only, lint ids, roots first, explained roots and passing crops left out, capped', () => {
  const d = diagnose({ report, ir, lint }, { max: 3 });
  assert.equal(d.total, 2);
  assert.equal(d.failed, 1);
  const s = d.screens[0];
  assert.equal(s.screen, 'W1');
  assert.equal(s.capture, 's0');
  assert.deepEqual(s.items.map((i) => i.kind), ['root', 'approval', 'crop']);
  assert.deepEqual(s.items[0].delta, [36.5, 0, -72.98, 20]);
  assert.equal(s.more, 5); // 6 failing crops, 1 shown
  const lines = formatDiagnosis(d);
  assert.ok(lines.length <= 8, lines.join('\n'));
  assert.match(lines[0], /1\/2 screens pass/);
  assert.match(lines[1], /^W1 \(s0\): 1 root, 1 approval, 6 crop/);
  assert.match(lines[2], /root @B d\[36\.5,0,-72\.98,20\]: div\.screen > div\.hero > p\.body/);
});

test('diagnose main: exit 1 on a failure, 2 without a report, 0 when all pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-diag-'));
  const out = [];
  assert.equal(diagMain(['--out', dir], (l) => out.push(l)), 2);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  writeFileSync(join(dir, 'ir.json'), JSON.stringify(ir));
  assert.equal(diagMain(['--out', dir], (l) => out.push(l)), 1);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ screens: [report.screens[1]] }));
  assert.equal(diagMain(['--out', dir], () => {}), 0);
});

const transcript = [
  { timestamp: '2026-11-24T10:00:00Z', type: 'user' },
  { timestamp: '2026-11-24T10:00:30Z', type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { output_tokens: 100, input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } } },
  { timestamp: '2026-11-24T10:00:31Z', type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { output_tokens: 100, input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } } },
  { timestamp: '2026-11-24T10:03:00Z', type: 'assistant', message: { id: 'm2', model: 'claude-sonnet-5-5', usage: { output_tokens: 40, input_tokens: 1, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } } },
  { timestamp: '2026-11-24T10:03:01Z', type: 'assistant', message: { id: 'm3', model: '<synthetic>' } },
].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n';

test('sessionCost: one count per message id, minutes from first to last line, synthetic model left out', () => {
  const c = sessionCost(transcript);
  assert.deepEqual(c, { models: { 'claude-sonnet-5-5': 3 }, apiCalls: 2, output: 140, input: 3, cacheRead: 3000, cacheWrite: 50, minutes: 3 });
});

test('projectSlug matches the Claude Code project folder name', () => {
  assert.equal(projectSlug('E:\\tools\\Planora'), 'E--tools-Planora');
  assert.equal(projectSlug('/home/u/my.app'), '-home-u-my-app');
});

test('session-log main appends one line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-slog-'));
  const t = join(dir, 'abc.jsonl'), log = join(dir, 'runs.jsonl');
  writeFileSync(t, transcript);
  assert.equal(logMain(['--log', log, '--transcript', t, '--label', 'x'], () => {}), 0);
  const rows = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session, 'abc');
  assert.equal(rows[0].label, 'x');
  assert.equal(rows[0].output, 140);
  assert.equal(logMain(['--log', log], () => {}, { CLAUDE_CONFIG_DIR: join(dir, 'none') }), 2);
});
