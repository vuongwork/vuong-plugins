// Bench self-test: no model, no network. `node bench/test/selftest.mjs` → exit 1 on any failure.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrace, readTrace, totals } from '../lib/transcript.mjs';
import { byStep, docsAndRework } from '../lib/steps.mjs';
import { badRefs, matchKey, mdTables } from '../lib/grade.mjs';
import { childEnv, claudeArgs, loadCase, main as runMain } from '../run.mjs';
import { render } from '../report.mjs';
import processChecks from '../suites/vuong-test/process.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
const ok = (cond, name, extra = '') => { if (cond) passed++; else { failed++; console.log(`✗ ${name} ${extra}`); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `\n   got  ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`);

// --- grade helpers
{
  const t = mdTables('# A\n\n| Ref | Name |\n|---|---|\n| E1 | New \\| copy |\n| E2 | Save |\n\ntext\n\n## B\n| x |\n|:--|\n| 1 |\n');
  eq(t.length, 2, 'mdTables: two tables');
  eq([t[0].heading, t[0].rows.length, t[0].rows[1].Name, t[1].heading], ['A', 2, 'Save', 'B'], 'mdTables: heading, rows, cells');
  const m = matchKey(['E1 New mode', 'E2 Save', 'Ghost row', 'Copy button'], [{ id: 'new', any: ['new'] }, { id: 'save', any: ['save'] }, { id: 'view', any: ['view'] }], { ok: ['ghost'] });
  eq([m.found, m.missed, m.extra], [['new', 'save'], ['view'], ['Copy button']], 'matchKey: found / missed / extra');
  ok(Math.abs(m.recall - 2 / 3) < 1e-9 && Math.abs(m.precision - 2 / 3) < 1e-9, 'matchKey: recall and precision', `${m.recall} ${m.precision}`);
  const lines = matchKey([{ text: 'Save', file: 'src/a.js', line: 40 }], [{ id: 's', any: ['save'], file: 'a\\.js', lines: [10, 12] }]);
  eq(lines.found, [], 'matchKey: wrong line range is not a match');
  const ws = mkdtempSync(join(tmpdir(), 'bench-st-'));
  mkdirSync(join(ws, 'src'));
  writeFileSync(join(ws, 'src', 'a.js'), '1\n2\n3\n');
  const r = badRefs(ws, 'see src/a.js:2 and src/a.js:9 and src/b.js:1 and src/a.js:2');
  eq([r.total, r.bad.length], [3, 2], 'badRefs: missing file and line past end');
  rmSync(ws, { recursive: true, force: true });
}

// --- environment and arguments
{
  const env = childEnv({ PATH: 'p', ANTHROPIC_API_KEY: 'x', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CONFIG_DIR: 'c', CLAUDE_EFFORT: 'high' });
  eq(Object.keys(env).sort(), ['CLAUDE_CONFIG_DIR', 'PATH'], 'childEnv: drops the parent session variables, keeps config dir');
  const c = loadCase(join(HERE, 'suites', 'selftest', 'cases', 'fake'));
  eq([c.suite, c.name, !!c.keyFile, !!c.answersFile, !!c.inputsDir, !!c.gradeFile], ['selftest', 'fake', true, true, true, true], 'loadCase: suite, name, optional files');
  const a = claudeArgs(c, 'plugin', 'ws', {});
  const b = claudeArgs(c, 'baseline', 'ws', {});
  ok(a.includes('--plugin-dir') && !b.includes('--plugin-dir'), 'claudeArgs: plugin only in the plugin arm');
  ok(a[a.indexOf('--setting-sources') + 1] === '' && a.includes('--strict-mcp-config'), 'claudeArgs: isolated from user settings and MCP');
  ok(a[a.indexOf('--disallowed-tools') + 1].startsWith('AskUserQuestion'), 'claudeArgs: AskUserQuestion removed');
  ok(a.includes('--append-system-prompt-file'), 'claudeArgs: answers appended');
}

// --- full run through the fake claude, both arms
{
  const results = mkdtempSync(join(tmpdir(), 'bench-res-'));
  process.env.BENCH_RESULTS = results;
  const log = console.log;
  console.log = () => {};
  const code = await runMain([join(HERE, 'suites', 'selftest', 'cases', 'fake'), '--arm', 'both', '--claude', join(HERE, 'fake-claude.mjs')]);
  console.log = log;
  eq(code, 0, 'run: exit 0');
  const rows = readFileSync(join(results, 'selftest', 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq(rows.map((r) => r.arm), ['plugin', 'baseline'], 'run: one row per arm');
  const [p, b] = rows;
  eq([p.costUsd, p.turns, typeof p.durationMs, p.denials, p.error], [0.5, 6, 'number', 1, null], 'run: result fields (durationMs = stamped wall clock)');
  eq([p.totals.apiCalls, p.totals.output, p.totals.cacheRead], [6, 690, 14800], 'run: usage once per message id');
  ok(Math.abs(p.totals.costUsd - 0.5) < 0.001, 'run: per-message cost adds up to the reported cost', p.totals.costUsd);
  eq(p.steps.map((s) => [s.step, s.apiCalls]), [['3 flows', 3], ['4 cases', 2], ['end', 1]], 'steps: next-signal attribution');
  eq([p.docs.docReads, p.docs.docBytes, p.docs.checkRuns, p.docs.rework], [1, 2048, { 'lint-cases': 2 }, 1], 'steps: docs read and rework');
  eq([p.skillLoaded, b.skillLoaded], [true, false], 'run: skill loaded only with the plugin');
  eq(p.plugin?.name, 'fake-plugin', 'run: plugin info recorded');
  eq(b.plugin, null, 'run: no plugin info for baseline');
  eq(p.checks.map((c) => [c.name, Math.round(c.score * 100) / 100]), [['flows.md written', 1], ['flow recall', 1], ['no invented file:line', 0.75]], 'grade: plugin arm');
  eq(b.checks.map((c) => Math.round(c.score * 100) / 100), [1, 0.67, 0.67], 'grade: baseline arm');
  const md = render(rows, { steps: true });
  ok(md.includes('| fake | plugin | 0.0.1@') && md.includes('### Steps — fake/plugin') && md.includes('| 3 flows |'), 'report: table and steps', '\n' + md);
  rmSync(results, { recursive: true, force: true });
}

// --- trace parsing on raw (unstamped) lines
{
  const ev = readTrace('{"type":"assistant","message":{"id":"a","model":"m","content":[],"usage":{"output_tokens":3}}}\nnot json\n{"type":"result","total_cost_usd":0.1,"modelUsage":{"m":{"costUSD":0.1}}}\n');
  const t = parseTrace(ev);
  eq([t.messages.length, totals(t.messages).output, t.result.costUsd], [1, 3, 0.1], 'readTrace: raw lines, junk skipped');
  eq(byStep(t.messages, { steps: [] }).map((s) => s.step), ['end'], 'byStep: no signals → end');
  eq(docsAndRework(t.messages, {}).rework, 0, 'docsAndRework: empty');
}

// --- output tokens: placeholder per message, real total in modelUsage → split by thinking + visible output
{
  const ev = [
    { type: 'system', subtype: 'thinking_tokens', estimated_tokens_delta: 300 },
    { type: 'assistant', message: { id: 'a', model: 'm', content: [{ type: 'text', text: 'x' }], usage: { output_tokens: 1 } } },
    { type: 'assistant', message: { id: 'b', model: 'm', content: [{ type: 'tool_use', id: 't', name: 'Write', input: { content: 'y'.repeat(340) } }], usage: { output_tokens: 1 } } },
    { type: 'result', total_cost_usd: 1, modelUsage: { m: { outputTokens: 400, costUSD: 1 } } },
  ];
  const t = parseTrace(ev);
  eq(totals(t.messages).output, 400, 'output: per-message split adds up to modelUsage');
  ok(t.messages[0].usage.output > t.messages[1].usage.output && t.messages[1].usage.output > 50, 'output: thinking-heavy message gets more', JSON.stringify(t.messages.map((m) => m.usage.output)));
}

{ // vuong-test process checks (trace only)
  const tu = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const res = (id, text) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const ev = [
    { type: 'system', subtype: 'init', plugins: [{ name: 'vuong-test' }] },
    { type: 'assistant', message: { id: 'm1', model: 'o', content: [tu('a', 'Agent', { subagent_type: 'vuong-test:writer', prompt: 'p' })], usage: {} } },
    { type: 'assistant', parent_tool_use_id: 'a', message: { id: 's1', model: 's', content: [tu('b', 'Read', { file_path: 'P/skills/vuong-test/SKILL.md' }), tu('c', 'Read', { file_path: 'P/kit/e2e-kit.mjs' })], usage: {} } },
    { type: 'assistant', parent_tool_use_id: 'a', message: { id: 's2', model: 's', content: [tu('d', 'Bash', { command: "cat > W/api.mjs <<'EOF'\nimport x from 'P/kit/api-kit.mjs';\n" + 'x'.repeat(1600) + '\nEOF' })], usage: {} } },
    res('d', 'Exit code 2\nunexpected EOF'),
    { type: 'assistant', message: { id: 'm2', model: 'o', content: [tu('e', 'Edit', { file_path: 'W/cases.md', old_string: 'a', new_string: 'b' }), tu('f', 'Write', { file_path: 'W/run.mjs', content: 'spawn collect.mjs' })], usage: {} } },
    { type: 'result', total_cost_usd: 1, modelUsage: {} },
  ];
  const by = Object.fromEntries(processChecks(ev).map((k) => [k.name.replace('process: ', ''), k]));
  ok(by['writer agents spawned'].detail === '1', 'process: writer spawn counted');
  ok(!by['main session does not write writer-owned files after delegating'].pass, 'process: main edit of cases.md after delegating flagged');
  ok(by['no kit source read'].detail.startsWith('1×'), 'process: kit source Read flagged, kit import inside a heredoc not', by['no kit source read'].detail);
  ok(!by['no whole SKILL.md read by the writer'].pass, 'process: whole SKILL.md read flagged');
  ok(/1× 2KB \(failed\)/.test(by['no file written through a shell heredoc'].detail), 'process: failed heredoc flagged', by['no file written through a shell heredoc'].detail);
  ok(!by['collect arguments not built by hand (core/run.mjs)'].pass, 'process: own run script flagged');
  ok(Object.values(by).every((k) => k.info), 'process: all info (not in the score)');
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
