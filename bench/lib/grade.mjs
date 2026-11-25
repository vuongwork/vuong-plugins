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
// Assignment is a maximum bipartite matching (one item per key entry, one key entry per item), so an item that fits
// two entries cannot starve the other one. Items that match some entry but are not assigned (the same finding split
// over several rows) are `dup`, neither right nor wrong; items matching no entry and no `ok` regex are `extra`.
export function matchKey(items, key, { ok = [], slack = 3 } = {}) {
  const its = items.map((x) => (typeof x === 'string' ? { text: x } : x));
  const fits = key.map((k) => {
    const res = (k.any || []).map((r) => new RegExp(r, 'i'));
    const fileRe = k.file ? new RegExp(k.file, 'i') : null;
    return its.map((it, i) => (res.some((r) => r.test(it.text))
      && (!fileRe || (it.file && fileRe.test(it.file)) || fileRe.test(it.text))
      && (!k.lines || (it.line != null && it.line >= k.lines[0] - slack && it.line <= k.lines[1] + slack)) ? i : -1)).filter((i) => i >= 0);
  });
  const owner = new Array(its.length).fill(-1); // item -> key index
  const augment = (k, seen) => {
    for (const i of fits[k]) {
      if (seen.has(i)) continue;
      seen.add(i);
      if (owner[i] < 0 || augment(owner[i], seen)) { owner[i] = k; return true; }
    }
    return false;
  };
  key.forEach((_, k) => augment(k, new Set()));
  const assigned = new Set(owner.filter((k) => k >= 0));
  const found = key.filter((_, k) => assigned.has(k)).map((k) => k.id);
  const missed = key.filter((_, k) => !assigned.has(k)).map((k) => k.id);
  const anyFit = new Set(fits.flat());
  const okRes = ok.map((r) => new RegExp(r, 'i'));
  const dup = [], extra = [];
  its.forEach((it, i) => {
    if (owner[i] >= 0) return;
    if (anyFit.has(i)) dup.push(it.text);
    else if (!okRes.some((r) => r.test(it.text))) extra.push(it.text);
  });
  const judged = assigned.size + extra.length;
  return { recall: key.length ? found.length / key.length : 1, precision: judged ? assigned.size / judged : 1, found, missed, dup, extra };
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

// info: shown in reports, left out of the case score (a measurement that is not right / wrong by itself)
export const check = (name, score, detail, by = 'code', info = false) => ({ name, score: Math.max(0, Math.min(1, Number(score) || 0)), pass: score >= 1, detail, by, ...(info ? { info: true } : {}) });
