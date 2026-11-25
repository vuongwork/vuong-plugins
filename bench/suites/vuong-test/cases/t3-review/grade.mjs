// t3-review: verdict per existing test (ok / weak / wrong) vs keys/leave-request.json › reviewTests.
import { check, mdTables } from '../../../../lib/grade.mjs';

export default async function grade({ key, read }) {
  const md = read('test-work/L01/existing-tests.md');
  if (!md) return [check('existing-tests.md written', 0)];
  const rows = mdTables(md).flatMap((t) => t.rows.map((r) => ({ text: r._text, verdict: String(r.Verdict ?? r.verdict ?? '').trim().toLowerCase() })));
  const verdictOf = (name) => {
    const r = rows.find((x) => new RegExp(name, 'i').test(x.text));
    if (!r) return null;
    const v = r.verdict || (r.text.match(/\|\s*`?(ok|weak|wrong)`?\s*\|/i) || [])[1]?.toLowerCase() || '';
    return v.replace(/`/g, '');
  };
  const k = key.reviewTests;
  const weak = k.weak.map((w) => [w.id, verdictOf(w.any[0])]);
  const wrong = k.wrongExpected.map((w) => [w.id, verdictOf(w.any[0])]);
  const good = k.good.map((g) => [g, verdictOf(g)]);
  const hit = (list, ok) => list.filter(([, v]) => ok(v));
  const w1 = hit(weak, (v) => v === 'weak' || v === 'wrong');
  const w2 = hit(wrong, (v) => v === 'wrong');
  const g1 = hit(good, (v) => v === 'ok');
  const miss = (list, got) => list.filter((x) => !got.includes(x)).map(([id, v]) => `${id} (${v ?? 'no row'})`).join('; ') || '-';
  return [
    check('existing-tests.md written', 1),
    check('weak tests flagged', w1.length / weak.length, `missed: ${miss(weak, w1)}`),
    check('wrong-expected tests found', w2.length / wrong.length, `missed: ${miss(wrong, w2)}`),
    check('good tests kept ok', g1.length / good.length, `flagged: ${miss(good, g1)}`),
  ];
}
