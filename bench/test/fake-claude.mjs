// Stand-in for `claude -p ... --output-format stream-json` used by the bench self-test: no model, no network.
// Reads the prompt from stdin, writes test-work/flows.md in the working directory, prints a fixed event stream.
// Records its argv in fake-argv.json so the test can check the flags run.mjs passed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const prompt = readFileSync(0, 'utf8');
const args = process.argv.slice(2);
writeFileSync('fake-argv.json', JSON.stringify({ args, prompt }));
const withPlugin = args.includes('--plugin-dir');
mkdirSync('test-work', { recursive: true });
writeFileSync('test-work/flows.md', [
  '# Flows', '', '| Ref | Name | file:line |', '|---|---|---|',
  '| E1 | New mode | src/app.js:2 |', '| E2 | Save button | src/app.js:3 |', '| E3 | Ghost | src/nope.js:9 |',
  withPlugin ? '| B1 | Reason too long LV-003 | src/app.js:4 |' : '', '',
].join('\n'));

const M = 'claude-test-1';
const say = (e) => process.stdout.write(JSON.stringify(e) + '\n');
const asst = (id, content, usage) => say({ type: 'assistant', message: { id, model: M, content, usage } });
const u = (i, o, cr, cw) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
say({ type: 'system', subtype: 'init', model: M, plugins: withPlugin ? [{ name: 'p' }] : [], skills: withPlugin ? ['p:p'] : [], tools: ['Read'] });
asst('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\x\\plugin\\skills\\p\\SKILL.md' } }], u(10, 100, 1000, 500));
say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(2048) }] } });
asst('m2', [{ type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'save' } }], u(5, 50, 2000, 100));
say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'src/app.js:3' }] } });
asst('m3', [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: 'test-work/flows.md' } }], u(5, 400, 2500, 100));
asst('m3', [{ type: 'text', text: 'split event of the same message' }], u(5, 400, 2500, 100)); // counted once
asst('m4', [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'node $PLUGIN/core/lint-cases.mjs W/cases.md' } }], u(5, 60, 3000, 50));
asst('m5', [{ type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'node $PLUGIN/core/lint-cases.mjs W/cases.md' } }], u(5, 60, 3100, 50));
asst('m6', [{ type: 'text', text: 'done' }], u(5, 20, 3200, 0));
say({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.5, duration_ms: 4200, num_turns: 6,
  permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }], modelUsage: { [M]: { costUSD: 0.5 } } });
