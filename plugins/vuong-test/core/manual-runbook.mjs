#!/usr/bin/env node
// Step 6 for `manual` cases: the runbook a person fills while running them (xlsx, opens in Excel).
//
//   node manual-runbook.mjs W/cases.md --out W/manual/ [--all] [--lang vi|en]
//
// Writes <out>/runbook-<scope>-<stamp>.xlsx with three sheets:
//   Guide      scope, build, run order, before you start, how to fill, what each status / priority / type means,
//              an example of a Fail row; cells for tester, device, OS version, date
//   Test cases one row per case (only Layer = manual, or every case with --all), in table order: steps, data,
//              expected; yellow cells to type (Actual, Bug / notes), a blue Status cell with a ▼ list
//              (Not run / Pass / Fail / Blocked / Skip), coloured by value; frozen header, filter, landscape print
//   Summary    per group (ID prefix: "BF-03" → BF) counted by formulas: total, pass, fail, blocked, skip, not run,
//              pass rate, high-priority fails; the release rule under it
// Never overwrites an existing file (the person may already have typed results into it).
// When it is filled: node collect.mjs --cases W/cases.md --manual <filled file> ... (same report as automated tests).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCases, RUNBOOK } from "./parsers.mjs";
import { newWorkbook, XS, colName } from "./ooxml.mjs";

const argv = process.argv.slice(2);
const opt = { lang: "en" };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") opt.out = argv[++i];
  else if (argv[i] === "--all") opt.all = true;
  else if (argv[i] === "--lang") opt.lang = argv[++i];
  else pos.push(argv[i]);
}
if (!pos[0] || !opt.out || !RUNBOOK[opt.lang]) {
  console.error("usage: manual-runbook.mjs <cases.md> --out <dir> [--all] [--lang vi|en]");
  process.exit(2);
}
const L = RUNBOOK[opt.lang];
const vi = opt.lang === "vi";
const spec = parseCases(pos[0]);
const cases = spec.cases.filter((c) => opt.all || c.layer.toLowerCase() === "manual");
if (!cases.length) {
  console.error(`[vuong-test] no case with Layer = manual in ${pos[0]} (use --all to put every case in the runbook)`);
  process.exit(1);
}

const text = (s = "") => s.replace(/[ \t]*<br\s*\/?>[ \t]*/gi, "\n").replace(/`/g, "").trim();
const group = (id) => (/^([A-Za-z]+)/.exec(id) || [, "—"])[1].toUpperCase();
const PRIO = { high: "high", cao: "high", medium: "medium", tb: "medium", low: "low", "thấp": "low" };
const prio = (p) => (PRIO[p.toLowerCase()] ? L.priority[PRIO[p.toLowerCase()]] : p);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "");
const S = L.status;

// ── Guide ──
const T = vi
  ? {
      title: `TEST CASE THỦ CÔNG — ${spec.scope}`, scope: "Phạm vi", build: "Bản cần test", env: "Môi trường",
      fill: "Cách điền", order: "Thứ tự nên chạy", before: "Trước khi test", statuses: "Trạng thái", prio: "Ưu tiên", type: "Loại", example: "Ví dụ ghi một ca Fail", back: "Sau khi điền",
      fillText: `Ô nền vàng: gõ chữ (thông tin ở trên, cột "${L.cols[9]}" và "${L.cols[11]}"). Ô nền xanh, cột "${L.cols[10]}": bấm vào ô, mũi tên ▼ hiện ở mép phải ô, bấm để chọn (hoặc Alt + ↓). Sheet ${L.summary} tự đếm. Mở bằng Excel trên máy tính (trình xem trước / điện thoại có thể không hiện danh sách).`,
      statusText: `${S.notrun} · ${S.passed}: đúng như mong đợi · ${S.failed}: đã làm được tới bước đó và kết quả khác mong đợi (kể cả app báo lỗi) · ${S.blocked}: không làm được vì ca ở cột "${L.cols[5]}" bị Fail hoặc thiếu điều kiện chuẩn bị · ${S.skipped}: cố ý bỏ qua (ghi lý do). App hiện lỗi khi đang làm → Fail, không phải Blocked.`,
      prioText: `${L.priority.high}: lỗi chặn dùng hoặc mất dữ liệu · ${L.priority.medium}: sai chức năng nhưng có cách né · ${L.priority.low}: hiển thị, tiện lợi`,
      typeText: "Positive: dùng đúng cách · Negative: thao tác sai / hủy / thứ không được xảy ra · Edge: trường hợp biên · Security: quyền riêng tư, bảo mật · Regression: tính năng cũ không bị hỏng",
      exampleText: `${L.cols[9]}: "Bấm Xuất backup, không thấy thông báo nào" · ${L.cols[10]}: Fail · ${L.cols[11]}: "bước 2, máy Samsung A54 Android 14, ảnh chụp trong album Test"`,
      backText: "Lưu file rồi gửi lại cho người chạy vuong-test (collect.mjs --manual <file>). Đừng đổi tên sheet hoặc dòng tiêu đề.",
      none: "(chưa ghi trong cases.md)",
    }
  : {
      title: `MANUAL TEST CASES — ${spec.scope}`, scope: "Scope", build: "Build under test", env: "Environment",
      fill: "How to fill", order: "Run order", before: "Before you start", statuses: "Status", prio: "Priority", type: "Type", example: "Example of a Fail row", back: "When done",
      fillText: `Yellow cells: type text (the fields above, columns "${L.cols[9]}" and "${L.cols[11]}"). Blue cells, column "${L.cols[10]}": click the cell, a ▼ arrow appears at its right edge, pick a value (or Alt + ↓). The ${L.summary} sheet counts by itself. Open in desktop Excel (previews and phones may not show the list).`,
      statusText: `${S.notrun} · ${S.passed}: as expected · ${S.failed}: the step could be done and the result differs (an error message counts) · ${S.blocked}: could not be done because a case in "${L.cols[5]}" failed or a precondition is missing · ${S.skipped}: skipped on purpose (write why). The app shows an error while you run the case → Fail, not Blocked.`,
      prioText: `${L.priority.high}: blocks use or loses data · ${L.priority.medium}: wrong, but there is a way around · ${L.priority.low}: display, convenience`,
      typeText: "Positive: correct use · Negative: wrong input / cancel / something that must not happen · Edge: limits and unusual states · Security: privacy and protection · Regression: old behaviour still works",
      exampleText: `${L.cols[9]}: "Pressed Export, no message appeared" · ${L.cols[10]}: Fail · ${L.cols[11]}: "step 2, Samsung A54 Android 14, screenshot in album Test"`,
      backText: "Save and send the file back to whoever runs vuong-test (collect.mjs --manual <file>). Do not rename the sheets or the header row.",
      none: "(not written in cases.md)",
    };
const input = (v = "") => ({ v, s: XS.input });
const guideRows = [
  [{ v: T.title, s: XS.title }],
  [],
  [{ v: T.scope, s: XS.label }, { v: `${spec.scope} — ${cases.length} case(s)`, s: XS.plain }],
  [{ v: T.build, s: XS.label }, { v: spec.build || T.none, s: XS.plain }],
  [{ v: T.env, s: XS.label }, { v: spec.environment || T.none, s: XS.plain }],
  [{ v: L.device, s: XS.label }, input()],
  [{ v: L.os, s: XS.label }, input()],
  [{ v: L.tester, s: XS.label }, input()],
  [{ v: L.date, s: XS.label }, input()],
  [],
  [{ v: T.fill, s: XS.label }, { v: T.fillText, s: XS.plain }],
  [{ v: T.order, s: XS.label }, { v: spec.runOrder || T.none, s: XS.plain }],
  [{ v: T.before, s: XS.label }, { v: spec.before || T.none, s: XS.plain }],
  [],
  [{ v: T.statuses, s: XS.label }, { v: T.statusText, s: XS.plain }],
  [{ v: T.prio, s: XS.label }, { v: T.prioText, s: XS.plain }],
  [{ v: T.type, s: XS.label }, { v: T.typeText, s: XS.plain }],
  [],
  [{ v: T.example, s: XS.label }, { v: T.exampleText, s: XS.plain }],
  [{ v: T.back, s: XS.label }, { v: T.backText, s: XS.plain }],
];
const guideHeights = {};
guideRows.forEach((r, i) => {
  const len = String(r[1]?.v || "").length;
  if (len > 90) guideHeights[i + 1] = 13 * Math.ceil(len / 90) + 4;
});

// ── Test cases ──
const rows = [L.cols.map((v) => ({ v, s: XS.head }))];
const heights = { 1: 30 };
for (const c of cases) {
  const steps = text(c.steps);
  const data = text(c.data);
  const exp = text(c.expected);
  rows.push([
    { v: c.id, s: XS.id },
    { v: group(c.id), s: XS.center },
    text(c.flow),
    cap(c.type),
    { v: prio(c.priority), s: XS.center },
    c.pre.join(", "),
    steps,
    data,
    exp,
    input(),
    { v: S.notrun, s: XS.pick },
    input(),
  ]);
  const lines = Math.max(...[steps, data, exp].map((s) => s.split("\n").reduce((n, l) => n + 1 + Math.floor(l.length / 45), 0)));
  heights[rows.length] = Math.max(30, 13 * lines + 4);
}
const last = rows.length;
const statusCol = colName(10);
const statusRange = `${statusCol}2:${statusCol}${last}`;
const caseSheet = {
  name: L.cases,
  rows,
  widths: [9, 8, 12, 11, 9, 12, 48, 30, 48, 32, 14, 26],
  heights,
  freeze: "B2",
  filter: true,
  printTitles: true,
  landscape: true,
  lists: [
    {
      sqref: statusRange,
      values: [S.notrun, S.passed, S.failed, S.blocked, S.skipped],
      promptTitle: vi ? "Chọn trạng thái" : "Pick a status",
      prompt: vi ? "Bấm mũi tên ▼ ở mép phải ô (hoặc Alt + ↓)" : "Click the ▼ arrow at the right edge of the cell (or Alt + ↓)",
      errorTitle: vi ? "Trạng thái không hợp lệ" : "Not a status",
      error: `${S.notrun}, ${S.passed}, ${S.failed}, ${S.blocked}, ${S.skipped}`,
    },
  ],
  fills: [
    { sqref: statusRange, equals: S.passed, rgb: "C6EFCE" },
    { sqref: statusRange, equals: S.failed, rgb: "FFC7CE" },
    { sqref: statusRange, equals: S.blocked, rgb: "FFEB9C" },
    { sqref: statusRange, equals: S.skipped, rgb: "E7E6E6" },
  ],
};

// ── Summary ──
const q = `'${L.cases}'!`;
const G = `${q}$B$2:$B$${last}`;
const ST = `${q}$${statusCol}$2:$${statusCol}$${last}`;
const PR = `${q}$E$2:$E$${last}`;
const sumHead = vi
  ? ["Nhóm", "Tổng", S.passed, S.failed, S.blocked, S.skipped, S.notrun, "Tỉ lệ Pass", `Fail mức ${L.priority.high}`]
  : ["Group", "Total", S.passed, S.failed, S.blocked, S.skipped, S.notrun, "Pass rate", `${L.priority.high} priority fails`];
const groups = [...new Set(cases.map((c) => group(c.id)))];
const sum = [sumHead.map((v) => ({ v, s: XS.head }))];
for (const g of groups) {
  const r = sum.length + 1;
  sum.push([
    { v: g, s: XS.id },
    { f: `COUNTIF(${G},$A${r})`, s: XS.center },
    ...[S.passed, S.failed, S.blocked, S.skipped, S.notrun].map((st) => ({ f: `COUNTIFS(${G},$A${r},${ST},"${st}")`, s: XS.center })),
    { f: `IFERROR(C${r}/(C${r}+D${r}),"")`, s: XS.pct },
    { f: `COUNTIFS(${G},$A${r},${ST},"${S.failed}",${PR},"${L.priority.high}")`, s: XS.center },
  ]);
}
const tr = sum.length + 1;
sum.push([
  { v: vi ? "Tổng cộng" : "Total", s: XS.id },
  ...["B", "C", "D", "E", "F", "G"].map((col) => ({ f: `SUM(${col}2:${col}${tr - 1})`, s: XS.bold })),
  { f: `IFERROR(C${tr}/(C${tr}+D${tr}),"")`, s: XS.pct },
  { f: `SUM(I2:I${tr - 1})`, s: XS.bold },
]);
sum.push([]);
sum.push([{ v: vi ? `Tỉ lệ Pass = Pass / (Pass + Fail); không tính Blocked, Skip, Chưa test.` : "Pass rate = Pass / (Pass + Fail); Blocked, Skip and Not run are left out.", s: XS.note }]);
sum.push([{ v: vi ? `Sẵn sàng phát hành khi: cột "Fail mức ${L.priority.high}" = 0 và mọi ca ${L.priority.high} đã Pass, hoặc Skip có ghi lý do.` : `Ready to release when "${L.priority.high} priority fails" = 0 and every ${L.priority.high} case is Pass, or Skip with a reason.`, s: XS.note }]);

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
mkdirSync(opt.out, { recursive: true });
const name = String(spec.scope || "scope").replace(/[^\w.-]+/g, "_");
const out = path.join(opt.out, `runbook-${name}-${stamp}.xlsx`);
if (existsSync(out)) {
  console.error(`[vuong-test] ${out} exists — it may already hold results; not overwritten. Run again in a minute or use another --out.`);
  process.exit(1);
}
writeFileSync(
  out,
  newWorkbook([
    { name: L.guide, rows: guideRows, widths: [26, 100], heights: guideHeights },
    caseSheet,
    { name: L.summary, rows: sum, widths: [16, 9, 9, 9, 10, 9, 11, 11, 16] },
  ])
);
const skipped = spec.cases.length - cases.length;
console.log(`[vuong-test] ${cases.length} case(s) in ${groups.length} group(s) → ${out}${skipped ? ` (${skipped} automated case(s) left out; --all to include)` : ""}`);
for (const c of cases) for (const p of c.pre) if (!spec.cases.some((x) => x.id === p)) console.log(`  warn ${c.id}: Pre ${p} is not a case — run lint-cases.mjs`);
