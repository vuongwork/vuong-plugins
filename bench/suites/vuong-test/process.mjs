// Process checks for the vuong-test suite, read from the trace only (no workspace needed, so old runs can be
// checked too). They show HOW the flow was followed, not the output; reported as info (left out of the score so
// runs stay comparable), each with "ok" or the violations.
//   main  = the session the user talks to (Opus), writer = vuong-test:writer agents (parent_tool_use_id set)
import { parseTrace } from '../../lib/transcript.mjs';

const isWriterOwned = (p) => /(spec-sources|flows|diff|cases|data-plan)\.md$|\.test\.[jt]s$|\/(e2e|api)[\w-]*\.mjs$/.test(p);
const norm = (p) => String(p || '').replace(/\\/g, '/');

export default function processChecks(events) {
  const { messages, init } = parseTrace(events);
  const arm = init.plugins.length ? 'plugin' : 'baseline';
  const tools = messages.flatMap((m) => m.tools.map((t) => ({ ...t, sub: !!m.sub, model: m.model })));
  const main = tools.filter((t) => !t.sub);
  const spawnIdx = main.findIndex((t) => (t.name === 'Agent' || t.name === 'Task') && /writer/.test(t.input.subagent_type || ''));
  const afterSpawn = spawnIdx < 0 ? [] : main.slice(spawnIdx + 1);
  const out = [];
  const add = (name, bad, detail) => out.push({ name: `process: ${name}`, score: bad.length ? 0 : 1, pass: !bad.length, detail: bad.length ? `${bad.length}× ${detail(bad)}` : 'ok', by: 'code', info: true });
  const short = (s, n = 70) => norm(s).replace(/^.*\/(test-work|plugins\/vuong-test)\//, '$1/').slice(0, n);

  if (arm === 'plugin') {
    const writes = main.filter((t) => ['Write', 'Edit'].includes(t.name) || (t.name === 'Bash' && /cat\s*>|sed -i/.test(t.input.command || '')));
    const mainWritesOwned = writes.filter((t) => isWriterOwned(norm(t.input.file_path || (t.input.command || '').match(/(?:cat\s*>|sed -i[^>]*?)\s*"?([^\s"]+\.(?:md|m?js))/)?.[1])));
    out.push({ name: 'process: writer agents spawned', score: 1, detail: String(main.filter((t) => /writer/.test(t.input?.subagent_type || '')).length), by: 'code', info: true });
    add('main session does not write writer-owned files after delegating', mainWritesOwned.filter((t) => afterSpawn.includes(t)), (b) => b.map((t) => short(t.input.file_path || t.input.command)).join(', '));
    // user answers go to answers.md in one Write / Edit; the writer copies them into spec-sources.md / diff.md
    add('answers recorded in answers.md, not by editing spec-sources.md / diff.md', mainWritesOwned.filter((t) => /(spec-sources|diff)\.md$/.test(norm(t.input.file_path))), (b) => Object.entries(b.reduce((n, t) => { const f = norm(t.input.file_path).split('/').pop(); n[f] = (n[f] || 0) + 1; return n; }, {})).map(([f, k]) => `${f} ×${k}`).join(', '));
    const rereads = afterSpawn.filter((t) => (t.name === 'Read' && isWriterOwned(norm(t.input.file_path))) || (t.name === 'Bash' && /\bcat(?!\s*>)\b[^|<]*(cases|flows|diff)\.md/.test(t.input.command || '')));
    add('main session does not re-check writer output', rereads, (b) => b.map((t) => short(t.input.file_path || t.input.command)).join(' | '));
  }
  add('no kit source read', tools.filter((t) => (t.name === 'Read' && /\/kit\/[\w-]+\.(mjs|cjs)$/.test(norm(t.input.file_path))) || (t.name === 'Bash' && /\b(cat|head|tail|sed -n \S+|grep(?: -\S+)* \S+)\s+"?[^\s|;<>"]*\/kit\/[\w-]+\.(mjs|cjs)/.test(t.input.command || ''))), (b) => b.map((t) => short(t.input.file_path || t.input.command)).join(', '));
  add('no whole SKILL.md read by the writer', tools.filter((t) => t.sub && t.name === 'Read' && /SKILL\.md$/.test(norm(t.input.file_path)) && !t.input.limit), () => 'Read without offset/limit');
  add('no file written through a shell heredoc', tools.filter((t) => t.name === 'Bash' && /cat\s*>[^<]*<<\s*'?\w+/.test(t.input.command || '') && (t.input.command || '').length > 1500), (b) => b.map((t) => `${(t.input.command.length / 1024).toFixed(0)}KB${t.result?.isError || /Exit code [1-9]/.test(t.result?.text || '') ? ' (failed)' : ''}`).join(', '));
  add('collect arguments not built by hand (core/run.mjs)', tools.filter((t) => (['Write', 'Edit'].includes(t.name) && /collect\.mjs/.test(t.input.content || t.input.new_string || '')) || (t.name === 'Bash' && /cat\s*>[\s\S]*collect\.mjs/.test(t.input.command || ''))), (b) => b.map((t) => short(t.input.file_path || 'heredoc')).join(', '));
  const failed = tools.filter((t) => t.result && (t.result.isError || /^Exit code [1-9]/.test(t.result.text || '')));
  out.push({ name: 'process: failed tool calls', score: 1, detail: `${failed.length} (main ${failed.filter((t) => !t.sub).length}, writer ${failed.filter((t) => t.sub).length})`, by: 'code', info: true });
  return out;
}
