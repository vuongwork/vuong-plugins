// t4-tests: tests for the approved cases, a report, and run.mjs → run-results.json.
// The grader runs run.mjs twice: on the app as shipped (seeded defects) and with fixed.patch applied (no seeded
// defect). A seeded defect is caught when a case written for it FAILs before and PASSes after the fix.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { check, matchKey, mdTables, sh } from '../../../../lib/grade.mjs';

const W = 'test-work/L01';
const REPO = resolve(import.meta.dirname, '../../../../..');
const PATCH = join(REPO, 'bench/fixtures/_meta/leave-request/fixed.patch');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (['node_modules', '.git', 'report', '_spec', '.cache', 'coverage'].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(m?js|cjs|ts)$/.test(f)) out.push(p);
  }
  return out;
}

function runAll(ws) {
  const r = sh(`node ${W}/run.mjs`, ws, { timeoutMs: 15 * 60 * 1000 });
  const file = join(ws, W, 'run-results.json');
  let results = null;
  try { results = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none */ }
  const map = new Map();
  for (const x of Array.isArray(results) ? results : []) if (x && x.id) map.set(String(x.id), String(x.status || '').toUpperCase());
  return { code: r.code, out: r.out, map };
}

export default async function grade({ ws, key, read }) {
  const casesMd = read(`${W}/cases.md`) || '';
  const main = mdTables(casesMd).find((t) => t.headers.includes('Expected') && t.headers.includes('Layer')) || { rows: [] };
  const cases = main.rows.filter((r) => /\S/.test(r.ID || ''));
  const auto = cases.filter((r) => !/manual/i.test(r.Layer || ''));
  const files = [...walk(join(ws, 'tests')), ...walk(join(ws, W))].filter((f) => !/run\.mjs$/.test(f));
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  // a tag is `[ID]` in a test name, or the ID as a string literal (kit style: run.tc("L01-A01", ...))
  const tagged = auto.filter((r) => [`[${r.ID}]`, `"${r.ID}"`, `'${r.ID}'`, '`' + r.ID + '`'].some((t) => src.includes(t)));
  const out = [check('automated cases have a tagged test', auto.length ? tagged.length / auto.length : 0, `${tagged.length}/${auto.length}; untagged: ${auto.filter((r) => !tagged.includes(r)).slice(0, 8).map((r) => r.ID).join(', ') || '-'}`)];

  const rel = files.map((f) => `"${relative(ws, f)}"`).join(' ');
  const lt = files.length ? sh(`node "${join(REPO, 'plugins/vuong-test/core/lint-tests.mjs')}" ${rel}`, ws) : { code: 1, out: 'no test files' };
  out.push(check('lint-tests clean', lt.code === 0 ? 1 : 0, lt.out.trim().split('\n').pop()?.slice(0, 160)));
  const reportDir = join(ws, W, 'report');
  out.push(check('report written', existsSync(reportDir) && readdirSync(reportDir).length ? 1 : 0));

  if (!existsSync(join(ws, W, 'run.mjs'))) return [...out, check('run.mjs works', 0, 'no run.mjs'), check('seeded defects caught', 0, 'no run.mjs')];
  const before = runAll(ws);
  out.push(check('run.mjs works', before.map.size ? Math.min(1, before.map.size / Math.max(1, auto.length)) : 0, `exit ${before.code}, ${before.map.size} results${before.map.size ? '' : ' — ' + before.out.trim().split('\n').pop()?.slice(0, 120)}`));
  const ap = sh(`git apply --whitespace=nowarn "${PATCH}"`, ws);
  if (ap.code !== 0) return [...out, check('seeded defects caught', 0, 'fixed.patch did not apply: ' + ap.out.slice(0, 200))];
  const after = runAll(ws);
  sh(`git apply -R --whitespace=nowarn "${PATCH}"`, ws);

  const caught = [], missed = [];
  for (const k of key.caseExpect) {
    const ids = cases.filter((r) => matchKey([r._text], [k]).found.length).map((r) => r.ID);
    const hit = ids.find((id) => before.map.get(id) === 'FAIL' && after.map.get(id) === 'PASS');
    if (hit) caught.push(`${k.id} (${hit})`); else missed.push(`${k.id} [${ids.map((id) => `${id}:${before.map.get(id) || '?'}→${after.map.get(id) || '?'}`).join(' ') || 'no case'}]`);
  }
  out.push(check('seeded defects caught (FAIL → PASS after fix)', caught.length / key.caseExpect.length, `missed: ${missed.join('; ') || '-'}`));
  const count = (m, s) => [...m.values()].filter((v) => v === s).length;
  const falseFail = [...after.map].filter(([, s]) => s === 'FAIL').map(([id]) => id);
  out.push(check('fails on the fixed app (info: unseeded bug or wrong test)', falseFail.length ? 0 : 1, falseFail.join(', ') || '-', 'code', true));
  out.push(check('results (info)', 1, `before fix: PASS ${count(before.map, 'PASS')} FAIL ${count(before.map, 'FAIL')} BLOCKED ${count(before.map, 'BLOCKED')} · after: PASS ${count(after.map, 'PASS')} FAIL ${count(after.map, 'FAIL')} BLOCKED ${count(after.map, 'BLOCKED')}`, 'code', true));
  return out;
}
