// Build the fixture's Excel specs from the markdown sources (one sheet per `##` section, tables kept as tables).
//   node bench/fixtures/_meta/leave-request/build-spec.mjs   → bench/fixtures/leave-request/docs/spec/*.xlsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newWorkbook, XS } from '../../../../plugins/vuong-test/core/ooxml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'leave-request', 'docs', 'spec');
const SPECS = [
  ['L01.md', 'L01_DangKyNghiPhep.xlsx', ['Giao dien', 'Che do', 'Item', 'Nut', 'Message']],
  ['API_Leave.md', 'API_Leave.xlsx', ['API']],
];

const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/`/g, '').replace(/\*\*/g, ''));
const plain = (l) => l.replace(/`/g, '').replace(/\*\*/g, '');

function sheets(md, names) {
  const lines = md.split(/\r?\n/);
  const head = [];
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^# /.test(l)) { head.push([{ v: l.slice(2), s: XS.title }]); continue; }
    if (/^## /.test(l)) {
      cur = { name: names[out.length] || `S${out.length + 1}`, rows: [...(out.length ? [] : head), [{ v: l.slice(3), s: XS.bold }]], widths: [] };
      out.push(cur);
      continue;
    }
    const target = cur ? cur.rows : head;
    if (/^\s*\|/.test(l)) {
      if (/^\s*\|?\s*:?-{2,}/.test(l)) continue;
      const isHead = /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '');
      target.push(cells(l).map((v) => ({ v, s: isHead ? XS.head : XS.body })));
    } else if (l.trim()) target.push([{ v: plain(l), s: XS.plain }]);
    else target.push([]);
  }
  if (!out.length) out.push({ name: names[0], rows: head, widths: [] });
  for (const s of out) {
    const n = Math.max(...s.rows.map((r) => r.length));
    s.widths = Array.from({ length: n }, (_, j) => (n === 1 ? 120 : Math.min(60, Math.max(8, ...s.rows.filter((r) => r.length > 1).map((r) => String(r[j]?.v ?? '').length + 2)))));
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
for (const [src, dst, names] of SPECS) {
  const wb = newWorkbook(sheets(readFileSync(join(HERE, 'spec', src), 'utf8'), names));
  writeFileSync(join(OUT, dst), wb);
  console.log(`${dst}: ${wb.length} bytes`);
}
