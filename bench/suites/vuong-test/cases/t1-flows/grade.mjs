// t1-flows: spec-sources.md, flows.md, diff.md for L01. Scored against keys/leave-request.json.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { badRefs, check, matchKey, mdTables, sh } from '../../../../lib/grade.mjs';

const W = 'test-work/L01';
const REPO = resolve(import.meta.dirname, '../../../../..');

// Every Sheet!Cell label the spec files really have (via vuong-test's own reader, run outside the workspace).
function specCells(ws) {
  const out = mkdtempSync(join(tmpdir(), 'grade-spec-'));
  const files = readdirSync(join(ws, 'docs/spec')).filter((f) => f.endsWith('.xlsx')).map((f) => `"${join(ws, 'docs/spec', f)}"`);
  sh(`node "${join(REPO, 'plugins/vuong-test/core/read-spec.mjs')}" ${files.join(' ')} --out "${out}"`, out);
  const cells = new Set();
  for (const f of readdirSync(out)) {
    const text = readFileSync(join(out, f), 'utf8');
    for (const m of text.matchAll(/\*\*(\w[\w ]*)!([A-Z]+)(\d+)\*\*/g)) cells.add(`${m[1]}!${m[2]}${m[3]}`.toLowerCase());
    // a row label "**Item!A4** … | **B4** …" also covers the other cells of that row
    for (const m of text.matchAll(/\*\*(\w[\w ]*)!A(\d+)\*\*([^\n]*)/g)) for (const c of m[3].matchAll(/\*\*([A-Z]+)\d+\*\*/g)) cells.add(`${m[1]}!${c[1]}${m[2]}`.toLowerCase());
  }
  return cells;
}

const rowsOf = (md) => mdTables(md).flatMap((t) => t.rows.map((r) => r._text));

export default async function grade({ ws, key, read }) {
  const files = ['spec-sources.md', 'flows.md', 'diff.md'].map((f) => read(`${W}/${f}`));
  const [sources, flows, diff] = files;
  const out = [check('3 files written', files.filter(Boolean).length / 3, ['spec-sources.md', 'flows.md', 'diff.md'].filter((_, i) => !files[i]).join(', ') || '')];
  if (flows) {
    const m = matchKey(rowsOf(flows), key.flows);
    out.push(check('flow recall', m.recall, `${m.found.length}/${key.flows.length}; missed: ${m.missed.join('; ') || '-'}`));
  } else out.push(check('flow recall', 0, 'no flows.md'));
  if (diff) {
    const m = matchKey(rowsOf(diff), key.diff, { ok: key.diffOk });
    out.push(check('diff recall', m.recall, `${m.found.length}/${key.diff.length}; missed: ${m.missed.join('; ') || '-'}`));
    out.push(check('diff precision', m.precision, `rows not in the key: ${m.extra.length}${m.extra.length ? ' — ' + m.extra.slice(0, 4).map((x) => x.slice(0, 90)).join(' ‖ ') : ''}`));
  } else out.push(check('diff recall', 0, 'no diff.md'), check('diff precision', 0, 'no diff.md'));
  const refs = badRefs(ws, (flows || '') + '\n' + (diff || ''));
  out.push(check('file:line refs exist', refs.total ? 1 - refs.bad.length / refs.total : 0, `${refs.total} refs, ${refs.bad.length} bad${refs.bad.length ? ': ' + refs.bad.slice(0, 5).join(', ') : ''}`));
  const cited = [...((flows || '') + (diff || '') + (sources || '')).matchAll(/\b(Giao dien|Che do|Item|Nut|Message|API)!([A-Z]+\d+)/gi)].map((m) => `${m[1]}!${m[2]}`.toLowerCase());
  const valid = specCells(ws);
  const okCites = cited.filter((c) => valid.has(c));
  out.push(check('spec cells cited exist', cited.length ? okCites.length / cited.length : 0, cited.length ? `${cited.length} cell refs, ${cited.length - okCites.length} not in the spec` : 'no Sheet!Cell citations'));
  return out;
}
