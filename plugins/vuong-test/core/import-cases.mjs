#!/usr/bin/env node
// Step 4 input: the tester's own test case file (xlsx / xlsm) → a draft W/cases.md.
//
//   node import-cases.mjs <file> --scope <screen> --out W/cases.md [--template <name>] [--config test.config.json] [--force]
//
// How the file is read comes from test.config.json `caseTemplates` (one per file layout a project uses):
//   { "name": "acceptance", "match": "*Acceptance*", "sheet": "Test cases", "headerRow": 1,
//     "columns": { "no": "B", "flow": "C", "steps": "D", "expected": "E", "result": "F", "evidence": "G" },
//     "groupMarker": "*", "idFormat": "{scope}-{no}", "vagueExpected": ["^TBD"], "dataRef": "Data sheet" }
// A row whose `no` cell equals groupMarker is a group heading: its flow / steps text carries to the cases
// below. A row whose `no` is a number (or any other value) is a case. Rows without `no` are skipped.
// Each case keeps its origin (`Sheet!row`) so export-cases.mjs can write the result back into the same row.
// Layer and Writes are left "?" (decided in step 4); an Expected that is not concrete is marked
// "⚠ not concrete" (lint-cases fails until it is replaced by a value with a spec source, or set to assumption).
// Never writes next to the source.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { readZip, sheetList, sheetCells, sharedStrings } from "./ooxml.mjs";
import { pickTemplate } from "./parsers.mjs";

const argv = process.argv.slice(2);
const opt = { config: "test.config.json" };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--scope") opt.scope = argv[++i];
  else if (a === "--out") opt.out = argv[++i];
  else if (a === "--template") opt.template = argv[++i];
  else if (a === "--config") opt.config = argv[++i];
  else if (a === "--force") opt.force = true;
  else pos.push(a);
}
const file = pos[0];
const usage = "usage: import-cases.mjs <file.xlsx|xlsm> --scope <screen> --out W/cases.md [--template <name>] [--config test.config.json] [--force]";
if (!file || !opt.scope || !opt.out) {
  console.error(usage);
  process.exit(2);
}
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

const cfg = existsSync(opt.config) ? JSON.parse(readFileSync(opt.config, "utf8")) : {};
const tpl = pickTemplate(cfg, path.basename(file), opt.template);
if (!tpl) {
  console.error(
    `[vuong-test] no caseTemplates entry for ${path.basename(file)}${opt.template ? ` (name ${opt.template})` : ""} in ${opt.config}.\n` +
      "Add one (sheet, headerRow, columns.no / flow / steps / expected / result / evidence) — see references/config.md."
  );
  process.exit(2);
}
const col = tpl.columns || {};
for (const k of ["no", "steps", "expected"])
  if (!col[k]) {
    console.error(`[vuong-test] template ${tpl.name}: columns.${k} is required`);
    process.exit(2);
  }
if (existsSync(opt.out) && !opt.force) {
  console.error(`[vuong-test] ${opt.out} exists — use --force to overwrite (or import into another file and merge)`);
  process.exit(2);
}
const src = path.resolve(file);
if (path.dirname(path.resolve(opt.out)) === path.dirname(src)) {
  console.error("[vuong-test] --out is the source folder; import-cases never writes next to the source");
  process.exit(2);
}

const buf = readFileSync(src);
const sha = createHash("sha256").update(buf).digest("hex");
const zip = readZip(buf);
const shared = sharedStrings(zip);
const sheets = sheetList(zip).filter((s) => s.part && globRe(tpl.sheet || "*").test(s.name));
if (!sheets.length) {
  console.error(`[vuong-test] no sheet matches "${tpl.sheet}" in ${path.basename(src)}`);
  process.exit(1);
}
const marker = tpl.groupMarker ?? "*";
const vague = [/^$/, ...(tpl.vagueExpected || []).map((r) => new RegExp(r, "i"))];
const dataRef = tpl.dataRef ? new RegExp(tpl.dataRef, "i") : null;
const idFormat = tpl.idFormat || "{scope}-{no}";
const firstRow = tpl.firstRow || (tpl.headerRow ? tpl.headerRow + 1 : 1);
const one = (s) => String(s || "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const cases = [];
let vagueCount = 0;
for (const sh of sheets) {
  const cells = sheetCells(zip, sh.part, shared);
  const rows = [...new Set([...cells.keys()].map((r) => Number(r.match(/\d+$/)[0])))].filter((n) => n >= firstRow && (!tpl.lastRow || n <= tpl.lastRow)).sort((a, b) => a - b);
  let flow = "";
  let context = "";
  for (const n of rows) {
    const get = (k) => (col[k] ? cells.get(`${col[k]}${n}`) || "" : "");
    const no = get("no").trim();
    if (!no) continue;
    if (no === marker) {
      if (get("flow")) {
        flow = get("flow");
        context = "";
      }
      if (get("steps")) context = get("steps");
      continue;
    }
    const steps = get("steps");
    const expected = get("expected");
    const isVague = vague.some((re) => re.test(expected.trim()));
    if (isVague) vagueCount++;
    const ref = (k) => `${sh.name}!${col[k]}${n}`;
    const needsData = dataRef && dataRef.test(`${context} ${steps} ${expected}`);
    cases.push({
      id: idFormat.replaceAll("{scope}", opt.scope).replaceAll("{no}", no).replaceAll("{sheet}", sh.name).replace(/\s+/g, "_"),
      flow: one(flow) || one(context) || "?",
      steps: one([context && context !== flow ? `[${context}]` : "", steps].filter(Boolean).join(" ")),
      expected: isVague ? `⚠ not concrete: "${one(expected)}" — find the value in the spec` : one(expected),
      source: `tester file / ${ref("expected")}`,
      data: needsData ? `see test data (tester file, near ${ref("steps")})` : "?",
      origin: `${sh.name}!${n}`,
    });
  }
}

const head = ["ID", "Layer", "Flow", "Steps", "Expected", "Source", "Data", "Writes", "Origin"];
const md = [
  `# Cases — ${opt.scope}`,
  "",
  "- Flows: `flows.md` (commit <sha>)",
  "- Sources: `spec-sources.md`",
  `- Test case file: ${src} (template ${tpl.name}, sha256 ${sha.slice(0, 12)}, ${cases.length} cases)`,
  "- Environment: <env>   ·   Writes data: <Y/N, what, cleanup>",
  "- Approved by: <name>   ·   Date: <YYYY-MM-DD>",
  "",
  "Imported from the tester's file. Before approval: set Layer and Writes per case (references/layers.md),",
  "replace every `⚠ not concrete` Expected with a value + spec source (or `assumption`), give Data concretely,",
  "map Flow to flows.md refs, and add cases for flows the tester's file does not cover (step 3).",
  "",
  `| ${head.join(" | ")} |`,
  `|${head.map(() => "---").join("|")}|`,
  ...cases.map((c) => `| ${c.id} | ? | ${c.flow} | ${c.steps} | ${c.expected} | ${c.source} | ${c.data} | ? | ${c.origin} |`),
  "",
  "## Not covered",
  "",
  "| Flow ref | Reason |",
  "|---|---|",
  "",
].join("\n");
mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
writeFileSync(opt.out, md);
const dup = cases.length - new Set(cases.map((c) => c.id)).size;
console.log(
  `[vuong-test] ${cases.length} cases from ${sheets.map((s) => s.name).join(", ")} (template ${tpl.name}) → ${opt.out}` +
    `${vagueCount ? `; ${vagueCount} Expected not concrete` : ""}${dup ? `; ${dup} duplicate IDs — add {sheet} to idFormat` : ""}`
);
process.exit(cases.length ? 0 : 1);
