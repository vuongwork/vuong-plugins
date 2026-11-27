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
    const nWriters = main.filter((t) => /writer/.test(t.input?.subagent_type || '')).length;
    out.push({ name: 'process: writer agents spawned', score: 1, detail: String(nWriters), by: 'code', info: true });
    // more than one writer for step 6 → the split comes from core/split.mjs, not by hand
    const step6 = main.filter((t) => /writer/.test(t.input?.subagent_type || '') && /step:?\s*6|step 6/i.test(t.input.prompt || t.input.description || ''));
    if (step6.length > 1) add('parallel split from core/split.mjs', main.some((t) => t.name === 'Bash' && /split\.mjs/.test(t.input.command || '')) ? [] : [1], () => 'split by hand');
    add('main session does not write writer-owned files after delegating', mainWritesOwned.filter((t) => afterSpawn.includes(t)), (b) => b.map((t) => short(t.input.file_path || t.input.command)).join(', '));
    // user answers go to answers.md in one Write / Edit; the writer copies them into spec-sources.md / diff.md
    add('answers recorded in answers.md, not by editing spec-sources.md / diff.md', mainWritesOwned.filter((t) => /(spec-sources|diff)\.md$/.test(norm(t.input.file_path))), (b) => Object.entries(b.reduce((n, t) => { const f = norm(t.input.file_path).split('/').pop(); n[f] = (n[f] || 0) + 1; return n; }, {})).map(([f, k]) => `${f} ×${k}`).join(', '));
    const rereads = afterSpawn.filter((t) => (t.name === 'Read' && isWriterOwned(norm(t.input.file_path))) || (t.name === 'Bash' && /\bcat(?!\s*>)\b[^|<]*(cases|flows|diff)\.md/.test(t.input.command || '')));
    add('main session does not re-check writer output', rereads, (b) => b.map((t) => short(t.input.file_path || t.input.command)).join(' | '));
  }
  add('no kit source read', tools.filter((t) => (t.name === 'Read' && /\/kit\/[\w-]+\.(mjs|cjs)$/.test(norm(t.input.file_path))) || (t.name === 'Bash' && /\b(cat|head|tail|sed -n \S+|grep(?: -\S+)* \S+)\s+"?[^\s|;<>"]*\/kit\/[\w-]+\.(mjs|cjs)/.test(t.input.command || ''))), (b) => b.map((t) => short(t.input.file_path || t.input.command)).join(', '));
  add('no whole SKILL.md read by the writer', tools.filter((t) => t.sub && t.name === 'Read' && /SKILL\.md$/.test(norm(t.input.file_path)) && !t.input.limit), () => 'Read without offset/limit');
  add('no file written through a shell heredoc', tools.filter((t) => t.name === 'Bash' && /cat\s*>[^<]*<<\s*'?\w+/.test(t.input.command || '') && (t.input.command || '').length > 1500), (b) => b.map((t) => `${(t.input.command.length / 1024).toFixed(0)}KB${t.result?.isError || /Exit code [1-9]/.test(t.result?.text || '') ? ' (failed)' : ''}`).join(', '));
  // any other file change through the shell (the heredoc check above keeps its old meaning so runs stay comparable)
  const SHELL_WRITE = /\bsed\s+(-\w+\s+)*-i|\bperl\s+-\w*i|\b(write|append)FileSync\b|\bpython3?\b[\s\S]*(\.write\(|open\([^)]*['"][wa])|\bSet-Content\b|\bOut-File\b|\becho\b[^|;&]*>\s*[^\s&|]+\.\w+/;
  add('no file changed through the shell (sed -i, node -e / python writes)', tools.filter((t) => ['Bash', 'PowerShell'].includes(t.name) && SHELL_WRITE.test(t.input.command || '') && !/cat\s*>[^<]*<</.test(t.input.command || '')), (b) => b.map((t) => `${t.sub ? 'writer' : 'main'} ${(t.input.command.match(SHELL_WRITE) || [''])[0].slice(0, 20)}`).join(', '));
  add('no background run / sleep / Monitor', tools.filter((t) => t.name === 'Monitor' || (t.input?.run_in_background && !['Agent', 'Task'].includes(t.name)) || (['Bash', 'PowerShell'].includes(t.name) && /(^|[;&|]\s*)(sleep|Start-Sleep)\s+\d/.test(t.input.command || ''))), (b) => b.map((t) => `${t.sub ? 'writer' : 'main'} ${t.name === 'Monitor' ? 'Monitor' : t.input?.run_in_background ? 'background' : 'sleep'}`).join(', '));
  // step-4 writer: cases come from the spec; reading the app (fixture: lib/, server.js, public/) is not its job
  const APP = /(^|[\s"'/])(lib\/[\w.-]+\.js|server\.js|public\/[\w.-]+\.(js|html))\b/;
  const step4 = new Set(main.filter((t) => /writer/.test(t.input?.subagent_type || '') && /step:?\s*4\b/i.test(`${t.input.description || ''} ${t.input.prompt || ''}`)).map((t) => t.id));
  add('step-4 writer does not read app code', messages.filter((m) => m.sub && step4.has(m.sub)).flatMap((m) => m.tools).filter((t) => (t.name === 'Read' && APP.test(norm(t.input.file_path))) || (['Bash', 'PowerShell'].includes(t.name) && /\b(cat|head|tail|sed -n|Get-Content)\b/.test(t.input.command || '') && APP.test(t.input.command || ''))), (b) => b.map((t) => short(t.input.file_path || (t.input.command.match(APP) || [''])[0].trim())).join(', '));
  // step-6 E2E writer: selectors from W/page-map*.md (run.mjs --page-map), not from the page source (fixture: public/)
  const PAGE = /(^|[\s"'/])public\/[\w.-]+\.(js|html)\b/;
  const e2eW = new Set(main.filter((t) => /writer/.test(t.input?.subagent_type || '') && /step:?\s*6\b/i.test(`${t.input.description || ''} ${t.input.prompt || ''}`) && /e2e/i.test(t.input.description || '')).map((t) => t.id));
  if (e2eW.size) add('E2E writer reads page-map, not the page source', messages.filter((m) => m.sub && e2eW.has(m.sub)).flatMap((m) => m.tools).filter((t) => (t.name === 'Read' && PAGE.test(norm(t.input.file_path))) || (['Bash', 'PowerShell'].includes(t.name) && /\b(cat|head|tail|sed -n|Get-Content|grep)\b/.test(t.input.command || '') && PAGE.test(t.input.command || ''))), (b) => `${b.length} source reads`);
  add('collect arguments not built by hand (core/run.mjs)', tools.filter((t) => (['Write', 'Edit'].includes(t.name) && /collect\.mjs/.test(t.input.content || t.input.new_string || '')) || (t.name === 'Bash' && /cat\s*>[\s\S]*collect\.mjs/.test(t.input.command || ''))), (b) => b.map((t) => short(t.input.file_path || 'heredoc')).join(', '));
  const failed = tools.filter((t) => t.result && (t.result.isError || /^Exit code [1-9]/.test(t.result.text || '')));
  out.push({ name: 'process: failed tool calls', score: 1, detail: `${failed.length} (main ${failed.filter((t) => !t.sub).length}, writer ${failed.filter((t) => t.sub).length})`, by: 'code', info: true });
  return out;
}
