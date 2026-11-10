#!/usr/bin/env node
// Collect test results of any stack + cases.md into one results.json (input of render-html.mjs).
//
//   node collect.mjs --cases W/cases.md --out W/results.json \
//     [--junit <file|dir> [--stack java]]... [--jest-json <file>]... [--e2e-json <file>]... \
//     [--api-json <file>]... [--e2e-dir <W>] [--api-dir <W>] [--jest-dir <dir>] [--coverage <file> [--label be]]... [--shots <dir>] \
//     [--notes W/run-notes.md]... [--notes-dir <W>] [--diff W/diff.md] [--data W/data-created.md] [--triage W/triage.md (default: next to cases.md)] [--root <repo>] \
//     [--manual <filled runbook.xlsx>]...
//
// Several inputs of the same kind are allowed (FE + BE in one report).
// Parallel agents: --e2e-dir W picks up every W/e2e*/e2e-results.json (and W/e2e-results.json);
// --api-dir W every W/api*/api-results.json (kit/api-kit.mjs); --jest-dir D every *.json Jest output in D; --notes-dir W every W/run-notes*.md.
// --manual: a runbook from manual-runbook.mjs filled by a person; each row with a status becomes a test (stack "manual").
// Pre (cases.md): a case with no result whose Pre case failed or is blocked is reported BLOCKED, along the whole chain.
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { parseCases, parseDiff, parseDataCreated, parseTriage, parseJunit, parseJestJson, parseE2eJson, parseRunbook, casesWithStatus } from "./parsers.mjs";
import { readZip, sheetList, sheetCells, sharedStrings } from "./ooxml.mjs";
import { readCoverage, mergeCoverage } from "./coverage.mjs";

const argv = process.argv.slice(2);
const opt = { junit: [], jest: [], e2e: [], cov: [], notes: [], manual: [] };
const isDir = (d) => existsSync(d) && statSync(d).isDirectory();
const die = (m) => (console.error(m), process.exit(2));
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  // a --stack / --label right after an input applies to that input
  const tail = (key) => (argv[i + 1] === key ? (i++, argv[++i]) : undefined);
  if (a === "--cases") opt.cases = next();
  else if (a === "--out") opt.out = next();
  else if (a === "--root") opt.root = next();
  else if (a === "--shots") opt.shots = next();
  else if (a === "--notes") opt.notes.push(next());
  else if (a === "--notes-dir") {
    const d = next();
    if (!isDir(d)) die(`--notes-dir: not a directory: ${d}`);
    for (const f of readdirSync(d).sort()) if (/^run-notes.*\.md$/.test(f)) opt.notes.push(path.join(d, f));
  } else if (a === "--e2e-dir") {
    const d = next();
    if (!isDir(d)) die(`--e2e-dir: not a directory: ${d}`);
    if (existsSync(path.join(d, "e2e-results.json"))) opt.e2e.push(path.join(d, "e2e-results.json"));
    for (const f of readdirSync(d).sort())
      if (/^e2e/.test(f) && isDir(path.join(d, f)) && existsSync(path.join(d, f, "e2e-results.json"))) opt.e2e.push(path.join(d, f, "e2e-results.json"));
  } else if (a === "--api-dir") {
    const d = next();
    if (!isDir(d)) die(`--api-dir: not a directory: ${d}`);
    if (existsSync(path.join(d, "api-results.json"))) opt.e2e.push(path.join(d, "api-results.json"));
    for (const f of readdirSync(d).sort())
      if (/^api/.test(f) && isDir(path.join(d, f)) && existsSync(path.join(d, f, "api-results.json"))) opt.e2e.push(path.join(d, f, "api-results.json"));
  } else if (a === "--jest-dir") {
    const d = next();
    if (!isDir(d)) die(`--jest-dir: not a directory: ${d}`);
    for (const f of readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (!f.endsWith(".json") || !statSync(p).isFile()) continue;
      try {
        if (Array.isArray(JSON.parse(readFileSync(p, "utf8")).testResults)) opt.jest.push(p);
      } catch {
        /* not JSON */
      }
    }
  }
  else if (a === "--diff") opt.diff = next();
  else if (a === "--data") opt.data = next();
  else if (a === "--triage") opt.triage = next();
  else if (a === "--junit") opt.junit.push({ p: next(), stack: tail("--stack") });
  else if (a === "--jest-json") opt.jest.push(next());
  else if (a === "--e2e-json" || a === "--api-json") opt.e2e.push(next());
  else if (a === "--manual") opt.manual.push(next());
  else if (a === "--coverage") opt.cov.push({ p: next(), label: tail("--label") });
  else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}
if (!opt.cases || !opt.out) {
  console.error("usage: collect.mjs --cases <cases.md> --out <results.json> [inputs...]");
  process.exit(2);
}
const root = path.resolve(opt.root || process.cwd());

const spec = parseCases(opt.cases);
const tests = [
  ...opt.junit.flatMap((j) => parseJunit(j.p, j.stack || "junit")),
  ...opt.jest.flatMap((f) => parseJestJson(f, root)),
  ...opt.e2e.flatMap((f) => parseE2eJson(f)),
];

// manual runbooks filled by a person
const manualInfo = [];
for (const f of opt.manual) {
  if (!existsSync(f)) die(`--manual: not found: ${f}`);
  let rb;
  try {
    rb = parseRunbook(readFileSync(f), { readZip, sheetList, sheetCells, sharedStrings });
  } catch (e) {
    die(`--manual ${f}: ${e.message}`);
  }
  const who = [rb.tester, rb.device, rb.os, rb.date].filter(Boolean).join(" · ");
  manualInfo.push(`${path.basename(f)}${who ? ` (${who})` : ""}`);
  const known = new Set(spec.cases.map((c) => c.id));
  for (const r of rb.rows) {
    if (r.status.startsWith("unknown:")) console.log(`  warn ${path.basename(f)} row ${r.sheetRow} ${r.id}: status "${r.status.slice(8)}" is not in the list — left as not run`);
    if (r.status === "notrun" || r.status.startsWith("unknown:")) continue;
    if (!known.has(r.id)) console.log(`  warn ${path.basename(f)} row ${r.sheetRow}: ${r.id} is not a case in ${opt.cases}`);
    const said = [r.actual && `Actual: ${r.actual}`, r.notes && `Notes: ${r.notes}`].filter(Boolean).join("\n");
    tests.push({
      file: path.basename(f),
      name: `[${r.id}] manual${rb.tester ? ` — ${rb.tester}` : ""}`,
      ids: [r.id],
      status: r.status,
      duration: 0,
      error: r.status === "failed" ? said || "Fail (no actual result written)" : null,
      note: r.status === "failed" ? null : said || null,
      stack: "manual",
      shots: [],
    });
  }
}

// Pre: a case with no result whose Pre failed / is blocked is blocked too (repeat for chains A → B → C)
for (let changed = true; changed; ) {
  changed = false;
  const st = Object.fromEntries(casesWithStatus({ cases: spec.cases, tests }).map((c) => [c.id, c]));
  for (const c of spec.cases) {
    if (st[c.id].tests.length) continue;
    const bad = c.pre.filter((p) => st[p] && ["failed", "blocked"].includes(st[p].status));
    if (!bad.length) continue;
    tests.push({ file: "cases.md (Pre)", name: `[${c.id}] blocked by Pre`, ids: [c.id], status: "blocked", duration: 0, error: null, note: `Pre ${bad.map((p) => `${p} ${st[p].status === "failed" ? "FAIL" : "BLOCKED"}`).join(", ")} — not run`, stack: "pre", shots: [] });
    changed = true;
  }
}

// screenshots named <ID>*.png attach to the tests carrying that tag
if (opt.shots && existsSync(opt.shots)) {
  const shots = readdirSync(opt.shots).filter((f) => /\.(png|jpe?g)$/i.test(f));
  for (const t of tests)
    for (const id of t.ids)
      for (const s of shots)
        if (s.startsWith(id) && !t.shots.includes(s)) t.shots.push(path.join(opt.shots, s));
}

let commit = "";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  /* not a git repo */
}

const results = {
  meta: {
    scope: spec.scope,
    generatedAt: new Date().toISOString(),
    commit,
    environment: spec.environment,
    writesData: spec.writesData,
    approvedBy: spec.approvedBy,
    approvedDate: spec.approvedDate,
    flows: spec.flows,
  },
  cases: spec.cases,
  notCovered: spec.notCovered,
  diff: opt.diff && existsSync(opt.diff) ? parseDiff(opt.diff) : [],
  tests,
  coverage: mergeCoverage(opt.cov.map(({ p, label }) => ({ label, cov: readCoverage(p, root) }))),
  notes: opt.notes
    .filter((f) => existsSync(f))
    .map((f) => (opt.notes.length > 1 ? `── ${path.basename(f)} ──\n` : "") + readFileSync(f, "utf8"))
    .join("\n\n"),
  inputs: { e2e: opt.e2e, jest: opt.jest, notes: opt.notes, manual: manualInfo },
  dataCreated: opt.data && existsSync(opt.data) ? parseDataCreated(opt.data) : [],
  triage: (() => {
    const f = opt.triage || path.join(path.dirname(opt.cases), "triage.md");
    return existsSync(f) ? parseTriage(f) : [];
  })(),
};

mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
writeFileSync(opt.out, JSON.stringify(results, null, 2));
const tagged = tests.filter((t) => t.ids.length).length;
console.log(
  `[vuong-test] ${spec.cases.length} cases, ${tests.length} tests (${tagged} tagged) from ${opt.e2e.length} e2e / ${opt.jest.length} jest / ${opt.junit.length} junit / ${opt.manual.length} manual input(s), ${opt.notes.length} notes file(s) → ${opt.out}`
);
