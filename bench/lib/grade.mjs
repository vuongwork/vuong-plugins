// Helpers for a case's grade.mjs. A grade.mjs exports `default async function grade(ctx)` and returns
// `[{ name, score: 0..1, pass?, detail?, by?: 'code' | 'model' }]`; ctx = { ws, caseDir, key, trace, sh, read, exists }.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const read = (ws, rel) => { const p = join(ws, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
export const exists = (ws, rel) => existsSync(join(ws, rel));

// Run a shell command in a folder; never throws. Output truncated to the last 20 kB.
export function sh(cmd, cwd, { timeoutMs = 300000, env = process.env } = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, env, maxBuffer: 64 * 1024 * 1024 });
  const out = ((r.stdout || '') + (r.stderr || '')).slice(-20000);
  return { code: r.status ?? (r.error ? -1 : 0), out, timedOut: r.error?.code === 'ETIMEDOUT' };
}

// All markdown tables in a text: [{ heading, headers: [..], rows: [{ col: value, _line }] }].
export function mdTables(text) {
  const lines = String(text || '').split(/\r?\n/);
  const tables = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) heading = l.replace(/^#+\s*/, '').trim();
    if (!/^\s*\|/.test(l) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) continue;
    const cells = (s) => s.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
    const headers = cells(l);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      const row = { _line: j + 1, _text: lines[j] };
      headers.forEach((h, k) => { row[h] = c[k] ?? ''; });
      rows.push(row);
    }
    tables.push({ heading, headers, rows });
    i = j - 1;
  }
  return tables;
}

// Match produced items against an answer key.
// key: [{ id, any: ['regex', ...], file?: 'regex on a path', lines?: [from, to] }], ok?: ['regex'] (valid extras).
// items: strings, or { text, file?, line? }.
// Found: an item's text matches one of `any` (case-insensitive) and, when the key has file/lines, the item points
// there (line within ±slack). Each item counts for at most one key entry (first match), each key entry once.
export function matchKey(items, key, { ok = [], slack = 3 } = {}) {
  const its = items.map((x) => (typeof x === 'string' ? { text: x } : x));
  const used = new Set();
  const found = [], missed = [];
  for (const k of key) {
    const res = (k.any || []).map((r) => new RegExp(r, 'i'));
    const idx = its.findIndex((it, i) => !used.has(i) && res.some((r) => r.test(it.text))
      && (!k.file || (it.file && new RegExp(k.file, 'i').test(it.file)) || new RegExp(k.file, 'i').test(it.text))
      && (!k.lines || (it.line != null && it.line >= k.lines[0] - slack && it.line <= k.lines[1] + slack)));
    if (idx >= 0) { used.add(idx); found.push(k.id); } else missed.push(k.id);
  }
  const okRes = ok.map((r) => new RegExp(r, 'i'));
  const extra = its.map((it, i) => ({ it, i })).filter(({ it, i }) => !used.has(i) && !okRes.some((r) => r.test(it.text))).map(({ it }) => it.text);
  const judged = used.size + extra.length; // valid extras (`ok`) are neither right nor wrong
  return {
    recall: key.length ? found.length / key.length : 1,
    precision: judged ? used.size / judged : 1,
    found, missed, extra,
  };
}

// `path:line` references in a text, e.g. src/app.js:120 → [{ file, line }].
export const fileLines = (text) => [...String(text || '').matchAll(/([\w./\\-]+\.\w{1,5}):(\d+)/g)].map((m) => ({ file: m[1].replace(/\\/g, '/'), line: +m[2] }));

// How many `file:line` references point at a file that does not exist or past its end.
export function badRefs(ws, text) {
  const bad = [];
  const seen = new Set();
  for (const { file, line } of fileLines(text)) {
    const k = file + ':' + line;
    if (seen.has(k)) continue;
    seen.add(k);
    const p = join(ws, file);
    if (!existsSync(p)) { bad.push(k + ' (no file)'); continue; }
    const n = readFileSync(p, 'utf8').split('\n').length;
    if (line < 1 || line > n) bad.push(k + ` (file has ${n} lines)`);
  }
  return { total: seen.size, bad };
}

export const check = (name, score, detail, by = 'code') => ({ name, score: Math.max(0, Math.min(1, Number(score) || 0)), pass: score >= 1, detail, by });
