// Split a run's cost over the plugin's steps, and count reads of the plugin's own docs and rework.
//
// steps.json: { "steps": [ { "name": "3 flows", "bash": ["regex"], "write": ["regex on the path"], "read": ["regex"] } ],
//               "docs": "regex on a Read path that counts as reading the plugin's docs",
//               "checks": "regex on a Bash command whose repeats count as rework (capture group 1 = the check name)" }
// A message belongs to the step of the NEXT signal at or after it (reading code before writing flows.md is part of
// the flows step). Messages after the last signal belong to "end". This is an approximation; reports say so.
import { totals } from './transcript.mjs';

const norm = (p) => String(p || '').replace(/\\/g, '/');

export function signalOf(tool, steps) {
  const cmd = tool.name === 'Bash' || tool.name === 'PowerShell' ? String(tool.input.command || '') : null;
  const path = ['Write', 'Edit', 'NotebookEdit'].includes(tool.name) ? norm(tool.input.file_path) : null;
  const read = tool.name === 'Read' ? norm(tool.input.file_path) : null;
  for (const s of steps) {
    if (cmd != null && (s.bash || []).some((r) => new RegExp(r).test(cmd))) return s.name;
    if (path != null && (s.write || []).some((r) => new RegExp(r).test(path))) return s.name;
    if (read != null && (s.read || []).some((r) => new RegExp(r).test(read))) return s.name;
  }
  return null;
}

export function byStep(messages, def) {
  const steps = def.steps || [];
  const tag = messages.map((m) => {
    for (let i = m.tools.length - 1; i >= 0; i--) { const s = signalOf(m.tools[i], steps); if (s) return s; }
    return null;
  });
  let next = 'end';
  const owner = new Array(messages.length);
  for (let i = messages.length - 1; i >= 0; i--) { if (tag[i]) next = tag[i]; owner[i] = next; }
  const groups = new Map();
  messages.forEach((m, i) => { if (!groups.has(owner[i])) groups.set(owner[i], []); groups.get(owner[i]).push({ m, i }); });
  const out = [];
  for (const [name, list] of groups) {
    const t = totals(list.map((x) => x.m));
    let ms = 0;
    for (const { m, i } of list) {
      const prev = i > 0 ? messages[i - 1] : null;
      const end = m.tEnd ?? m.t;
      const start = prev ? (prev.tEnd ?? prev.t) : 0;
      if (end != null && start != null) ms += Math.max(0, end - start);
    }
    out.push({ step: name, ...t, minutes: Math.round(ms / 6000) / 10 });
  }
  return out;
}

export function docsAndRework(messages, def) {
  const docs = def.docs ? new RegExp(def.docs) : null;
  const checks = def.checks ? new RegExp(def.checks) : null;
  const r = { docReads: 0, docBytes: 0, docFiles: {}, checkRuns: {}, writes: {}, asked: 0 };
  for (const m of messages) for (const tl of m.tools) {
    if (tl.name === 'Read' && docs && docs.test(norm(tl.input.file_path))) {
      r.docReads++;
      r.docBytes += tl.result?.bytes || 0;
      const f = norm(tl.input.file_path).replace(/^.*?(skills\/|references\/|templates\/)/, '$1');
      r.docFiles[f] = (r.docFiles[f] || 0) + 1;
    }
    if ((tl.name === 'Bash' || tl.name === 'PowerShell') && checks) {
      const k = String(tl.input.command || '').match(checks);
      if (k) r.checkRuns[k[1] || k[0]] = (r.checkRuns[k[1] || k[0]] || 0) + 1;
    }
    if (['Write', 'Edit'].includes(tl.name)) {
      const f = norm(tl.input.file_path).split('/').slice(-2).join('/');
      r.writes[f] = (r.writes[f] || 0) + 1;
    }
    if (tl.name === 'AskUserQuestion') r.asked++;
  }
  // rework = runs of a check beyond the first, writes of a file beyond the first
  r.rework = Object.values(r.checkRuns).reduce((a, n) => a + n - 1, 0) + Object.values(r.writes).reduce((a, n) => a + n - 1, 0);
  return r;
}
