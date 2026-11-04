#!/usr/bin/env node
// Step 7 output: test cases + results as Excel.
//
//   node export-cases.mjs W/results.json --out W/report/ [--file <tester file.xlsx|xlsm>] [--template <name>]
//        [--config test.config.json] [--tester <name>] [--date YYYY-MM-DD]
//
// Always writes <out>/test-cases-<scope>-<stamp>.xlsx (default layout: every case, status, evidence).
// With --file (the tester's own test case file, imported by import-cases.mjs): also writes a COPY
// <out>/<name>_result_<stamp>.<ext> with result / evidence / tester / date written into the columns of the
// caseTemplates entry, on the row each case came from (cases.md `Origin` = Sheet!row). Styles, other sheets and
// macros are kept; the original file is never modified. Cases that did not run leave their row as it was. Cases without Origin (added by the plugin) are only
// in the default file — listed on stdout.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { readZip, sheetList, setCells, rewriteZip, newXlsx } from "./ooxml.mjs";
import { casesWithStatus, pickTemplate } from "./parsers.mjs";

const argv = process.argv.slice(2);
const opt = { config: "test.config.json" };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--file") opt.file = argv[++i];
  else if (a === "--template") opt.template = argv[++i];
  else if (a === "--config") opt.config = argv[++i];
  else if (a === "--tester") opt.tester = argv[++i];
  else if (a === "--date") opt.date = argv[++i];
  else pos.push(a);
}
if (!pos[0] || !opt.out) {
  console.error("usage: export-cases.mjs <results.json> --out <dir> [--file <tester file>] [--template <name>] [--config test.config.json] [--tester <name>] [--date YYYY-MM-DD]");
  process.exit(2);
}
const R = JSON.parse(readFileSync(pos[0], "utf8"));
const cases = casesWithStatus(R);
const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const date = opt.date || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const LABEL = { passed: "PASS", failed: "FAIL", blocked: "BLOCKED", notrun: "NOT RUN" };
const triageOf = Object.fromEntries((R.triage || []).map((t) => [t.case, t]));
const evidence = (c) =>
  [c.status === "failed" && triageOf[c.id] ? `reviewed: ${triageOf[c.id].verdict} (${triageOf[c.id].by}) ${triageOf[c.id].reason}`.trim() : "", ...c.tests
    .flatMap((t) => [
      ...(t.shots || []).map((s) => path.basename(s)),
      t.note ? `note: ${t.note}` : "",
      t.error ? `error: ${String(t.error).split("\n")[0]}` : "",
      (t.exchanges || []).filter((x) => x.status >= 400 || x.status === 0).map((x) => `${x.method} ${x.url} → ${x.status || x.error}`).join("; "),
    ])]
    .filter(Boolean)
    .join("\n");
mkdirSync(opt.out, { recursive: true });
const scope = String(R.meta?.scope || "scope").replace(/[^\w.-]+/g, "_");

// ── default layout ──
const head = ["ID", "Layer", "Flow", "Steps", "Expected", "Source", "Data", "Writes", "Status", "Evidence", "Tested", "Origin"];
const rows = [head, ...cases.map((c) => [c.id, c.layer, c.flow, c.steps, c.expected, c.source, c.data, c.writes, LABEL[c.status], evidence(c), c.tests.length ? date : "", c.origin || ""])];
const defOut = path.join(opt.out, `test-cases-${scope}-${stamp}.xlsx`);
writeFileSync(defOut, newXlsx(String(R.meta?.scope || "cases"), rows, [16, 7, 22, 40, 40, 26, 24, 7, 10, 40, 11, 14]));
const sum = Object.fromEntries(Object.keys(LABEL).map((k) => [k, cases.filter((c) => c.status === k).length]));
console.log(`[vuong-test] ${cases.length} cases (${sum.passed} pass, ${sum.failed} fail, ${sum.blocked} blocked, ${sum.notrun} not run) → ${defOut}`);

// ── tester's file copy ──
if (opt.file) {
  const src = path.resolve(opt.file);
  if (!existsSync(src)) {
    console.error(`[vuong-test] --file not found: ${src}`);
    process.exit(2);
  }
  const cfg = existsSync(opt.config) ? JSON.parse(readFileSync(opt.config, "utf8")) : {};
  const tpl = pickTemplate(cfg, path.basename(src), opt.template);
  if (!tpl || !tpl.columns?.result) {
    console.error(`[vuong-test] no caseTemplates entry with columns.result for ${path.basename(src)} in ${opt.config}`);
    process.exit(2);
  }
  const col = tpl.columns;
  const resLabel = { passed: "PASS", failed: "FAIL", blocked: "", notrun: "", ...(tpl.results || {}) };
  const zip = readZip(readFileSync(src));
  const parts = Object.fromEntries(sheetList(zip).map((s) => [s.name, s.part]));
  const perPart = {};
  const noOrigin = [];
  const badOrigin = [];
  for (const c of cases) {
    // a case that did not run leaves the tester's row untouched (keeps their own earlier result)
    if (!c.tests.length) continue;
    const m = /^(.*)!(\d+)$/.exec(c.origin || "");
    if (!m) {
      noOrigin.push(c.id);
      continue;
    }
    const part = parts[m[1]];
    if (!part) {
      badOrigin.push(`${c.id} (${c.origin})`);
      continue;
    }
    const v = (perPart[part] ||= {});
    const row = m[2];
    v[`${col.result}${row}`] = resLabel[c.status] ?? "";
    if (col.evidence) v[`${col.evidence}${row}`] = evidence(c) || "auto test (vuong-test)";
    if (col.tester && opt.tester) v[`${col.tester}${row}`] = opt.tester;
    if (col.date) v[`${col.date}${row}`] = date;
  }
  const replaced = Object.fromEntries(Object.entries(perPart).map(([part, values]) => [part, setCells(zip.get(part), values)]));
  const ext = path.extname(src);
  const out = path.join(opt.out, `${path.basename(src, ext)}_result_${stamp}${ext}`);
  if (path.resolve(out) === src) {
    console.error("[vuong-test] refusing to overwrite the tester's file");
    process.exit(2);
  }
  writeFileSync(out, rewriteZip(zip, replaced));
  const written = Object.values(perPart).reduce((n, v) => n + Object.keys(v).filter((k) => k.startsWith(col.result)).length, 0);
  console.log(`[vuong-test] ${written} result(s) written into a copy of the tester's file (template ${tpl.name}) → ${out}`);
  if (noOrigin.length) console.log(`  not in the tester's file (only in ${path.basename(defOut)}): ${noOrigin.join(", ")}`);
  if (badOrigin.length) console.log(`  origin sheet not found: ${badOrigin.join(", ")}`);
}
