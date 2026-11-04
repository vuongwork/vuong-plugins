#!/usr/bin/env node
// Collect test results of any stack + cases.md into one results.json (input of render-html.mjs).
//
//   node collect.mjs --cases W/cases.md --out W/results.json \
//     [--junit <file|dir> [--stack java]]... [--jest-json <file>]... [--e2e-json <file>]... \
//     [--api-json <file>]... [--e2e-dir <W>] [--api-dir <W>] [--jest-dir <dir>] [--coverage <file> [--label be]]... [--shots <dir>] \
//     [--notes W/run-notes.md]... [--notes-dir <W>] [--diff W/diff.md] [--data W/data-created.md] [--triage W/triage.md (default: next to cases.md)] [--root <repo>]
//
// Several inputs of the same kind are allowed (FE + BE in one report).
// Parallel agents: --e2e-dir W picks up every W/e2e*/e2e-results.json (and W/e2e-results.json);
// --api-dir W every W/api*/api-results.json (kit/api-kit.mjs); --jest-dir D every *.json Jest output in D; --notes-dir W every W/run-notes*.md.
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { parseCases, parseDiff, parseDataCreated, parseTriage,parseJunit, parseJestJson, parseE2eJson } from "./parsers.mjs";
import { readCoverage, mergeCoverage } from "./coverage.mjs";

const argv = process.argv.slice(2);
const opt = { junit: [], jest: [], e2e: [], cov: [], notes: [] };
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
  inputs: { e2e: opt.e2e, jest: opt.jest, notes: opt.notes },
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
  `[vuong-test] ${spec.cases.length} cases, ${tests.length} tests (${tagged} tagged) from ${opt.e2e.length} e2e / ${opt.jest.length} jest / ${opt.junit.length} junit input(s), ${opt.notes.length} notes file(s) → ${opt.out}`
);
