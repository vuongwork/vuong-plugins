// Second pass for answer-key matching: regexes are cheap but miss findings worded another way or split over table
// cells. For the key entries a regex pass missed, ask a small model which numbered row covers each one. The model
// must answer with row numbers; a number outside the list is ignored, so it cannot invent coverage.
//
//   const r = await rescue(rows, matchKey(rows, key), key)  → { ...r, recall, found, missed, rescued: [{ id, row }] }
// Off when BENCH_JUDGE=off (then only the regex result counts). Runs `claude -p --model haiku`, isolated like a bench run.
import { spawnSync } from 'node:child_process';
import { childEnvFor } from './env.mjs';

const MAX_ROW = 400; // chars per row sent to the judge

export function judge(rows, items, { model = 'haiku', exe = process.env.BENCH_CLAUDE_JUDGE || 'claude' } = {}) {
  const list = rows.map((r, i) => `${i + 1}. ${String(r).replace(/\s+/g, ' ').slice(0, MAX_ROW)}`).join('\n');
  const want = items.map((k) => `- ${k.id}${k.desc ? ': ' + k.desc : ''}`).join('\n');
  const prompt = `You check whether a test-analysis document covers given items. Below are numbered rows of the document, then the items.
For each item, give the number of ONE row that clearly covers it (the row is about that behavior or difference), or null when no row does.
Answer with JSON only, no prose: {"<item id>": <row number or null>, ...}

ROWS
${list}

ITEMS
${want}`;
  const r = spawnSync(exe, ['-p', '--model', model, '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--max-budget-usd', '0.5'], { input: prompt, encoding: 'utf8', env: childEnvFor(), maxBuffer: 32 * 1024 * 1024, timeout: 300000 });
  let res;
  try { res = JSON.parse(r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch { return { map: {}, costUsd: 0, error: (r.stderr || r.stdout || '').slice(0, 300) }; }
  const text = String(res.result || '');
  let map = {};
  try { map = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* unparseable → nothing rescued */ }
  return { map, costUsd: res.total_cost_usd || 0 };
}

export async function rescue(rows, m, key) {
  if (process.env.BENCH_JUDGE === 'off' || !m.missed.length || !rows.length) return { ...m, rescued: [], judgeUsd: 0 };
  const items = key.filter((k) => m.missed.includes(k.id));
  const j = judge(rows, items);
  const rescued = [];
  for (const k of items) {
    const n = Number(j.map[k.id]);
    if (Number.isInteger(n) && n >= 1 && n <= rows.length) rescued.push({ id: k.id, row: n });
  }
  const ids = new Set(rescued.map((x) => x.id));
  const found = [...m.found, ...ids];
  const missed = m.missed.filter((id) => !ids.has(id));
  return { ...m, found, missed, recall: key.length ? found.length / key.length : 1, rescued, judgeUsd: j.costUsd, judgeError: j.error };
}
