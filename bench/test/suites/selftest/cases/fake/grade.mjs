import { mdTables, matchKey, badRefs, check } from '../../../../../lib/grade.mjs';
export default async function grade({ ws, key, read }) {
  const md = read('test-work/flows.md');
  if (!md) return [check('flows.md written', 0)];
  const t = mdTables(md)[0];
  if (!t) return [check('flows.md written', 1), check('flows as a table', 0, 'no markdown table')];
  const rows = t.rows.map((r) => r._text);
  const m = matchKey(rows, key.flows, { ok: key.ok });
  const refs = badRefs(ws, md);
  return [check('flows.md written', 1), check('flow recall', m.recall, 'missed: ' + m.missed.join(', ')),
    check('no invented file:line', 1 - refs.bad.length / Math.max(1, refs.total), refs.bad.join(', '))];
}
