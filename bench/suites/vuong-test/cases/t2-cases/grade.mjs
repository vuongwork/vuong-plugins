// t2-cases: cases.md + data-plan.md from the t1 analysis. Scored against keys/leave-request.json.
import { join, resolve } from 'node:path';
import { check, matchKey, mdTables, sh } from '../../../../lib/grade.mjs';

const W = 'test-work/L01';
const REPO = resolve(import.meta.dirname, '../../../../..');

export default async function grade({ ws, key, read }) {
  const md = read(`${W}/cases.md`);
  if (!md) return [check('cases.md written', 0)];
  const tables = mdTables(md);
  const main = tables.find((t) => t.headers.includes('Expected') && t.headers.includes('Layer')) || { rows: [] };
  const cases = main.rows.filter((r) => /\S/.test(r.ID || ''));
  const allRows = tables.flatMap((t) => t.rows.map((r) => r._text));
  const out = [check('cases.md written', 1), check('data-plan.md written', read(`${W}/data-plan.md`) ? 1 : 0)];

  const lint = sh(`node "${join(REPO, 'plugins/vuong-test/core/lint-cases.mjs')}" ${W}/cases.md --no-next`, ws);
  const errLine = lint.out.split('\n').find((l) => /error/i.test(l)) || lint.out.trim().split('\n').pop();
  out.push(check('lint-cases clean', lint.code === 0 ? 1 : 0, errLine?.slice(0, 160)));

  const cov = matchKey(allRows, key.flows);
  out.push(check('flows covered (case or Not covered)', cov.recall, `missed: ${cov.missed.join('; ') || '-'}`));
  const caseRows = cases.map((r) => r._text);
  const seeded = matchKey(caseRows, key.caseExpect);
  out.push(check('seeded defects have a spec-based case', seeded.recall, `missed: ${seeded.missed.join('; ') || '-'}`));
  const fromCode = cases.filter((r) => key.codeExpect.some((k) => k.any.some((re) => new RegExp(re, 'i').test(r.Expected || ''))));
  out.push(check('no Expected taken from code', fromCode.length ? 0 : 1, fromCode.map((r) => `${r.ID}: ${String(r.Expected).slice(0, 80)}`).join(' ‖ ') || '-'));

  const layers = {};
  for (const r of cases) layers[r.Layer] = (layers[r.Layer] || 0) + 1;
  const assumptions = cases.filter((r) => /assumption/i.test(r.Source || '')).length;
  out.push(check('cases (info)', 1, `${cases.length} cases · ${Object.entries(layers).map(([k, v]) => `${k} ${v}`).join(', ')} · assumption ${assumptions}`, 'code', true));
  return out;
}
