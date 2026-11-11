#!/usr/bin/env node
// Self-test of every script in this plugin. Pure Node (>= 18), no shell, no dependencies, cross-platform.
//
//   node test/selftest.mjs
//   VT_PLAYWRIGHT_FROM=<dir with node_modules/playwright> node test/selftest.mjs   (adds the E2E kit checks)
//
// Fixtures are built in os.tmpdir() at run time. Fixtures that must contain fixed waits or secrets are
// assembled from pieces so this file itself passes core/lint-tests.mjs.
// Prints `ok` / `FAIL` per check; exit 1 when any check fails.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const T = mkdtempSync(path.join(os.tmpdir(), "vt-selftest-"));
let pass = 0;
let fail = 0;

function check(name, cond, info = "") {
  if (cond) {
    pass++;
    console.log(`ok   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${info ? `\n     ${String(info).slice(0, 600).replace(/\n/g, "\n     ")}` : ""}`);
  }
}
const section = (s) => console.log(`\n== ${s}`);
/** run a plugin script: node <PLUGIN>/<script> ...args */
function run(script, args = [], { cwd = T, input, env } = {}) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, script), ...args], {
    cwd,
    input,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 120000,
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}
const w = (rel, text) => {
  const f = path.join(T, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
  return f;
};
const j = (rel, obj) => w(rel, JSON.stringify(obj));
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const CASE_HEAD = ["ID", "Layer", "Flow", "Steps", "Expected", "Source", "Data", "Writes"];
const casesMd = (rows, { approved = true, extra = "" } = {}) =>
  [
    "# Cases — demo",
    "- Flows: flows.md (commit abc)",
    "- Environment: local   ·   Writes data: Y",
    approved ? "- Approved by: Tester   ·   Date: 2026-11-03" : "- Approved by: <name>   ·   Date: <date>",
    "",
    table(CASE_HEAD, rows),
    extra,
    "",
  ].join("\n");

// ── lint-cases ────────────────────────────────────────────────────────────────
section("lint-cases");
{
  const good = w("lc/good.md", casesMd([["A-001", "e2e", "E1", "search", "3 rows", "SRS 1", "record R1 in state open", "N"]]));
  let r = run("core/lint-cases.mjs", [good]);
  check("clean cases.md exits 0", r.code === 0, r.all);
  r = run("core/lint-cases.mjs", [good, "--require-approval"]);
  check("--require-approval passes when approved", r.code === 0, r.all);

  const bad = w(
    "lc/bad.md",
    casesMd(
      [
        ["A-001", "e2e", "E1", "search", "ok", "SRS 1", "record R1", "N"],
        ["A-001", "web", "", "x", "3 rows", "", "record R1", "X"],
        ["B-001", "ut", "B1", "f(1)", "2", "assumption", "any", "N"],
        ["B-002", "ut", "B2", "f(2)", "3", "SRS 2", "", "N"],
      ],
      { approved: false }
    )
  );
  r = run("core/lint-cases.mjs", [bad]);
  check("errors → exit 1", r.code === 1, r.all);
  check("vague expected is an error", /ERROR case A-001: Expected "ok" is not checkable/.test(r.out), r.out);
  check("duplicate ID / bad layer / empty Flow / empty Source / Writes", ["duplicate ID", 'layer "web"', "Flow empty", "Source empty", "Writes must be Y or N"].every((s) => r.out.includes(s)), r.out);
  check("Data warnings (any, empty)", /warn {2}case B-001: Data "any" is vague/.test(r.out) && /warn {2}case B-002: Data "" is vague/.test(r.out), r.out);
  check("assumption source warned", /case B-001: assumption/.test(r.out), r.out);
  const unapproved = w("lc/unapproved.md", casesMd([["A-001", "e2e", "E1", "s", "3 rows", "SRS 1", "record R1", "N"]], { approved: false }));
  r = run("core/lint-cases.mjs", [unapproved, "--require-approval"]);
  check("--require-approval fails when not approved", r.code === 1 && /not approved/.test(r.out), r.all);
  r = run("core/lint-cases.mjs", []);
  check("no args → exit 2", r.code === 2);
}

// ── lint-tests ────────────────────────────────────────────────────────────────
section("lint-tests");
{
  const WAIT = "waitFor" + "Timeout";
  const SLEEP = "Thread." + "sleep";
  const PW = ["pass", "word"].join("");
  w("lt/ok.test.js", `await page.${WAIT}(100);\nexpect(1).toBe(1);\n`);
  w("lt/wait.test.js", `await page.${WAIT}(500);\n`);
  w("lt/Wait.java", `${SLEEP}(1000);\n`);
  w("lt/exempt.test.js", `await page.${WAIT}(800); // lint-${"ok"}: animation has no event\n`);
  w("lt/secret.test.js", `const ${PW} = "hunter2222";\nconst p2 = process.env.E2E_PW;\n`);
  let r = run("core/lint-tests.mjs", [path.join(T, "lt/ok.test.js")]);
  check("wait <= 200 ms passes", r.code === 0, r.all);
  r = run("core/lint-tests.mjs", [path.join(T, "lt/wait.test.js")]);
  check("fixed wait 500 ms → error", r.code === 1 && /fixed wait 500 ms/.test(r.out), r.all);
  r = run("core/lint-tests.mjs", [path.join(T, "lt/Wait.java")]);
  check("Java sleep 1000 ms → error", r.code === 1 && /fixed wait 1000 ms/.test(r.out), r.all);
  r = run("core/lint-tests.mjs", [path.join(T, "lt/exempt.test.js")]);
  check("`lint-ok:` exempts the line", r.code === 0, r.all);
  r = run("core/lint-tests.mjs", [path.join(T, "lt/secret.test.js")]);
  check("hard-coded secret → error", r.code === 1 && /hard-coded secret/.test(r.out) && !/:2 /.test(r.out), r.all);
  r = run("core/lint-tests.mjs", [path.join(T, "lt/wait.test.js"), "--max-wait", "1000"]);
  check("--max-wait raises the limit", r.code === 0, r.all);
  r = run("core/lint-tests.mjs", [path.join(PLUGIN, "kit"), path.join(PLUGIN, "hooks"), path.join(PLUGIN, "test")]);
  check("plugin kit/ hooks/ test/ pass lint-tests", r.code === 0, r.all);
}

// ── collect ───────────────────────────────────────────────────────────────────
section("collect");
let results; // used by render-html
{
  const cases = w(
    "W/cases.md",
    casesMd(
      [
        ["P-001", "ut", "B1", "f(1)", "2", "SRS 1", "none: pure function", "N"],
        ["F-001", "ut", "B2", "g()", "throws E1", "SRS 2", "none: pure function", "N"],
        ["K-001", "e2e", "E1", "search", "3 rows", "SRS 3", "record R1", "N"],
        ["K-002", "e2e", "E2", "save", 'toast "saved"', "SRS 4", "record R2", "Y"],
        ["X-001", "e2e", "E3", "x", "code E9", "assumption", "record R3", "N"],
        ["N-001", "ut", "B3", "h()", "4", "SRS 5", "none: pure function", "N"],
      ],
      { extra: `\n## Not covered\n\n${table(["Flow ref", "Reason"], [["E9", "no UI"]])}` }
    )
  );
  j("W/e2e-a/e2e-results.json", {
    tests: [
      { file: "e2e-a.mjs", name: "[K-001] search", ids: ["K-001"], status: "passed", shots: [], aborted: [{ method: "POST", url: "http://x/api/save" }], writes: [] },
      { file: "e2e-a.mjs", name: "[K-002] save", ids: ["K-002"], status: "passed", shots: [], writesDeclared: true, aborted: [], writes: [{ method: "POST", url: "http://x/api/save", status: 200 }] },
    ],
  });
  j("W/e2e-b/e2e-results.json", { tests: [{ file: "e2e-b.mjs", name: "[X-001] x", status: "blocked", error: "environment test not allowed for writes", shots: [] }] });
  j("W/e2e-results.json", []);
  j("jest/fe.json", { testResults: [{ name: path.join(T, "a.test.js"), assertionResults: [{ title: "[P-001] f", fullName: "[P-001] f", status: "passed", ancestorTitles: [] }] }] });
  w("jest/junk.json", "not json");
  j("jest/other.json", { hello: 1 });
  w("jest/readme.txt", "x");
  const junit = w(
    "junit/TEST-G.xml",
    `<?xml version="1.0"?><testsuite name="G"><testcase classname="GTest" name="[F-001] g throws" time="0.012"><failure message="expected E1">trace</failure></testcase><testcase classname="GTest" name="untagged" time="0.001"/></testsuite>`
  );
  w("W/run-notes-a.md", "note from a");
  w("W/run-notes-b.md", "note from b");
  const notes1 = w("notes1.md", "single note");
  const diff = w(
    "W/diff.md",
    table(
      ["Diff", "Area", "Spec says", "Source", "Code does", "file:line", "Cases", "Decision"],
      [
        ["D1", "g", "throws E1", "SRS 2", "throws E2", "g.js:3", "F-001", ""],
        ["D2", "f", "2", "SRS 1", "2", "f.js:1", "P-001", "keep"],
        ["D3", "h", "4", "SRS 5", "5", "h.js:1", "N-001", ""],
      ]
    )
  );
  const data = w(
    "W/data-created.md",
    table(
      ["Case", "When", "Environment", "Record (key)", "Action", "How to delete / revert", "Status"],
      [
        ["K-002", "10:00", "local", "E2E001", "create", "Screen > Delete", "left"],
        ["K-002", "10:01", "local", "E2E001-H", "history row", "none in UI", "needs-be"],
        ["K-002", "10:02", "local", "E2E000", "create", "Screen > Delete", "deleted"],
      ]
    )
  );
  const ist = j("cov/coverage-final.json", {
    [path.join(T, "src/a.js")]: {
      path: path.join(T, "src/a.js"),
      statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } },
      s: { 0: 1, 1: 0 },
      fnMap: {},
      f: { 0: 1 },
      branchMap: {},
      b: { 0: [1, 0] },
    },
  });
  const jac = w(
    "cov/jacoco.xml",
    `<?xml version="1.0"?><report name="be"><package name="com/a"><sourcefile name="A.java"><line nr="1" mi="0" ci="1"/><counter type="INSTRUCTION" missed="1" covered="3"/><counter type="LINE" missed="0" covered="2"/><counter type="METHOD" missed="1" covered="1"/></sourcefile></package></report>`
  );
  const out = path.join(T, "W/results.json");
  const r = run("core/collect.mjs", [
    "--cases", cases, "--out", out, "--root", T,
    "--junit", path.join(T, "junit"), "--stack", "java",
    "--jest-dir", path.join(T, "jest"),
    "--e2e-dir", path.join(T, "W"),
    "--notes-dir", path.join(T, "W"),
    "--diff", diff, "--data", data,
    "--coverage", ist, "--label", "fe",
    "--coverage", jac, "--label", "be",
  ]);
  check("collect exits 0", r.code === 0, r.all);
  results = existsSync(out) ? readJson(out) : { tests: [], cases: [], inputs: {} };
  const byId = (id) => results.tests.find((t) => t.ids.includes(id));
  check("--junit dir: failed tagged test + untagged test, stack label", byId("F-001")?.status === "failed" && byId("F-001")?.stack === "java" && results.tests.some((t) => t.name === "untagged"), JSON.stringify(results.tests));
  check("--jest-dir picks only Jest JSON (skips junk / non-Jest)", results.inputs.jest?.length === 1 && byId("P-001")?.status === "passed", JSON.stringify(results.inputs.jest));
  check("--e2e-dir picks W/e2e-results.json + W/e2e*/", results.inputs.e2e?.length === 3, JSON.stringify(results.inputs.e2e));
  check("e2e aborted / writes / blocked carried", byId("K-001")?.aborted.length === 1 && byId("K-002")?.writes.length === 1 && byId("X-001")?.status === "blocked");
  check("--notes-dir collects run-notes*.md", /note from a/.test(results.notes) && /note from b/.test(results.notes), results.notes);
  check("--diff parsed", results.diff?.length === 3 && results.diff[0].cases[0] === "F-001", JSON.stringify(results.diff));
  check("--data parsed", results.dataCreated?.length === 3 && results.dataCreated[1].status === "needs-be");
  const tot = results.coverage?.totals || [];
  check("--coverage istanbul (50% statements)", tot[0]?.format === "istanbul" && Math.round(tot[0].statements) === 50, JSON.stringify(tot));
  check("--coverage jacoco (75% instructions, lines 100%)", tot[1]?.format === "jacoco" && tot[1].statements === 75 && tot[1].lines === 100 && tot[1].branches === null, JSON.stringify(tot));
  check("not covered table parsed", results.notCovered?.[0]?.ref === "E9");

  const out2 = path.join(T, "W/results2.json");
  const e2eA = path.join(T, "W/e2e-a/e2e-results.json");
  const jestF = path.join(T, "jest/fe.json");
  const r2 = run("core/collect.mjs", ["--cases", cases, "--out", out2, "--e2e-json", e2eA, "--jest-json", jestF, "--notes", notes1]);
  const res2 = existsSync(out2) ? readJson(out2) : {};
  check("--e2e-json + --jest-json + --notes", r2.code === 0 && res2.tests?.length === 3 && res2.notes === "single note", r2.all);
  const r3 = run("core/collect.mjs", ["--cases", cases, "--out", out2, "--bogus"]);
  check("unknown argument → exit 2", r3.code === 2);
}

// ── render-html ───────────────────────────────────────────────────────────────
section("render-html");
{
  const r = run("core/render-html.mjs", [path.join(T, "W/results.json"), "--out", path.join(T, "W/report")]);
  check("exit 1 when a case failed", r.code === 1, r.all);
  const f = existsSync(path.join(T, "W/report")) ? readdirSync(path.join(T, "W/report")).find((x) => x.endsWith(".html")) : null;
  const html = f ? readFileSync(path.join(T, "W/report", f), "utf8") : "";
  const row = (id) => (html.match(new RegExp(`<tr[^>]*><td><b>${id}</b>[\\s\\S]*?</tr>`)) || [""])[0];
  check("case PASS", row("P-001").includes("✓ PASS"), row("P-001"));
  check("case FAIL", row("F-001").includes("✗ FAIL"), row("F-001"));
  check("case BLOCKED", row("X-001").includes("■ BLOCKED"), row("X-001"));
  check("case NOT RUN", row("N-001").includes("○ NOT RUN"), row("N-001"));
  check("diff reproduced", row("D1").includes("✗ reproduced"), row("D1"));
  check("diff not reproduced", row("D2").includes("✓ not reproduced"), row("D2"));
  check("diff unverified", row("D3").includes("○ unverified"), row("D3"));
  check("data created + needs-be counts", html.includes("1 left in UI, 1 need BE/DB") && html.includes("E2E001-H"));
  check("write guard aborted / writes shown", html.includes("write guard aborted 1") && html.includes("POST http://x/api/save → 200") && html.includes("1 blocked by guard"));
  check("assumption count", html.includes("1 expected = assumption"));
  check("summary rows labelled, chips link to sections", /<div class="stat-row"><div class="stat-label"><b>Cases /.test(html) && /<a href="#failed" class="chip failed">1 fail</.test(html) && /<h2 id="cases">/.test(html), html.slice(html.indexOf('class="stats"'), html.indexOf('class="stats"') + 900));
  check("Needs attention: failed tests grouped, blocked / not-run cases listed", /<div class="group-title failed" id="failed">/.test(html) && /id="blocked"/.test(html) && /id="notrun"/.test(html));
  check("test results as table: error / API / evidence columns", /<th>Error \(expected \/ actual\)<\/th><th>API calls<\/th><th>Evidence<\/th>/.test(html));
  check("summary counts", html.includes("1 pass") || html.includes(">3 pass<"));
  check("untagged warning", html.includes("1 test(s) have no [ID] tag"));
  check("run notes embedded", html.includes("note from b"));

  const ok = { ...results, tests: results.tests.filter((t) => t.status !== "failed") };
  const okFile = w("W2/results.json", JSON.stringify(ok));
  const r2 = run("core/render-html.mjs", [okFile, "--out", path.join(T, "W2/report"), "--name", "fe"]);
  check("exit 0 without failures, --name in file name", r2.code === 0 && /[\\/]fe\.html$/.test(r2.out.trim()), r2.all);
  const r3 = run("core/render-html.mjs", [okFile, "--out", path.join(T, "W2/report"), "--keep"]);
  check("report has a fixed name (index.html), --keep copies to history/", r3.code === 0 && existsSync(path.join(T, "W2/report/index.html")) && readdirSync(path.join(T, "W2/report/history")).some((f) => /^report-\d{8}-\d{6}\.html$/.test(f)), r3.all);
  const r4 = run("core/render-html.mjs", [okFile, "--out", path.join(T, "W2/report")]);
  check("re-render replaces index.html, no new files", r4.code === 0 && readdirSync(path.join(T, "W2/report")).sort().join() === "fe.html,history,index.html", readdirSync(path.join(T, "W2/report")).join());
}

// ── cleanup-list ──────────────────────────────────────────────────────────────
section("cleanup-list");
{
  const data = path.join(T, "W/data-created.md");
  let r = run("core/cleanup-list.mjs", [data]);
  check("records left → exit 1", r.code === 1 && /1 left \(UI\), 1 needs-be, 1 done/.test(r.out), r.all);
  writeFileSync(data, readFileSync(data, "utf8").replace("| left |", "| deleted |").replace("| needs-be |", "| reverted |"));
  r = run("core/cleanup-list.mjs", [data]);
  check("all cleaned → exit 0", r.code === 0, r.all);
  r = run("core/cleanup-list.mjs", [path.join(T, "nope.md")]);
  check("missing file → exit 2", r.code === 2);
}

// ── init ──────────────────────────────────────────────────────────────────────
section("init");
{
  const repo = path.join(T, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ntest-work/_out/");
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ devDependencies: { jest: "1" } }));
  let r = run("core/init.mjs", [repo]);
  check("first run creates config + work dir", r.code === 0 && existsSync(path.join(repo, "test.config.json")) && existsSync(path.join(repo, "test-work")), r.all);
  check("detects jest", /detected stacks: jest/.test(r.out), r.out);
  const chk = run("core/config.mjs", ["--check"], { cwd: repo });
  check("fresh template: ${NAME} inside $comment is not asked for", !/\bNAME\b/.test(chk.out.replace(/NAME=/g, "")) && /DESIGN_SPECS/.test(chk.out), chk.out);
  const gi1 = readFileSync(path.join(repo, ".gitignore"), "utf8");
  check(".gitignore keeps existing lines, no duplicate", gi1.startsWith("node_modules/\ntest-work/_out/\n") && gi1.split(/\r?\n/).filter((l) => l === "test-work/_out/").length === 1 && gi1.includes("test-work/_spec/"), gi1);
  writeFileSync(path.join(repo, "test.config.json"), JSON.stringify({ project: "mine" }));
  r = run("core/init.mjs", [repo]);
  check("second run: .gitignore unchanged", readFileSync(path.join(repo, ".gitignore"), "utf8") === gi1 && /entries present/.test(r.out), r.all);
  check("second run: config not overwritten", readJson(path.join(repo, "test.config.json")).project === "mine" && /exists, kept/.test(r.out), r.all);
  check("init: local file gitignored + created", gi1.split(/\r?\n/).includes("test.config.local.json") && existsSync(path.join(repo, "test.config.local.json")), gi1);
}

// ── config (shared + per-machine local file) ──────────────────────────────────
section("config");
{
  const C = path.join(T, "cfg");
  mkdirSync(path.join(C, "specs"), { recursive: true });
  w("cfg/specs/SCR001 a.xlsx", "x");
  const shared = {
    vars: { DESIGN_SPECS: "Design spec folder", BACKEND_REPO: "Backend repo folder" },
    specPaths: [{ path: "${DESIGN_SPECS}", kind: "design" }],
    stacks: [{ id: "be", dir: "${BACKEND_REPO}" }],
    environments: { local: { baseUrl: "http://localhost:3000", writable: true }, test: { baseUrl: "https://t.example", writable: false } },
  };
  const cf = j("cfg/test.config.json", shared);
  const env = { DESIGN_SPECS: "", BACKEND_REPO: "" };
  let r = run("core/config.mjs", ["--config", cf, "--check"], { env });
  check("no local file → exit 1, lists every name with its description", r.code === 1 && /DESIGN_SPECS — Design spec folder/.test(r.out) && /BACKEND_REPO — Backend repo folder/.test(r.out), r.all);
  r = run("core/find-spec.mjs", ["SCR001", "--config", cf], { env });
  check("find-spec stops when a value is missing (exit 2, names it)", r.code === 2 && /DESIGN_SPECS/.test(r.err), r.all);
  r = run("core/config.mjs", ["--config", cf, "--set", `DESIGN_SPECS=${path.join(C, "specs")}`], { env });
  check("--set creates the local file", r.code === 0 && readJson(path.join(C, "test.config.local.json")).vars.DESIGN_SPECS === path.join(C, "specs"), r.all);
  r = run("core/config.mjs", ["--config", cf, "--check"], { env });
  check("only the still-missing name is asked", r.code === 1 && /BACKEND_REPO/.test(r.out) && !/DESIGN_SPECS/.test(r.out), r.all);
  run("core/config.mjs", ["--config", cf, "--set", "BACKEND_REPO=./nope-backend"], { env });
  r = run("core/config.mjs", ["--config", cf, "--check"], { env });
  check("value set but folder missing → reported", r.code === 1 && /folder does not exist[\s\S]*BACKEND_REPO = \.\/nope-backend/.test(r.out), r.all);
  mkdirSync(path.join(C, "nope-backend"));
  r = run("core/config.mjs", ["--config", cf, "--check"], { env });
  check("all set → exit 0", r.code === 0 && /config ok: 2 var/.test(r.out), r.all);
  r = run("core/find-spec.mjs", ["SCR001", "--config", cf, "--json"], { env });
  check("find-spec uses the local path", r.code === 0 && /SCR001 a\.xlsx/.test(r.out), r.all);
  r = run("core/config.mjs", ["--config", cf, "--check"], { env: { DESIGN_SPECS: path.join(C, "nope-env"), BACKEND_REPO: "" } });
  check("environment variable wins over the local file", r.code === 1 && /DESIGN_SPECS = .*nope-env/.test(r.out), r.all);
  // local overrides: objects merge, values replace
  const loc = readJson(path.join(C, "test.config.local.json"));
  j("cfg/test.config.local.json", { ...loc, environments: { local: { baseUrl: "http://localhost:3001" } } });
  r = run("core/config.mjs", ["--config", cf, "--print"], { env });
  let p = {};
  try { p = JSON.parse(r.out); } catch { /* reported below */ }
  check("--print: local override merged (baseUrl replaced, writable kept, other env kept)",
    p.environments?.local?.baseUrl === "http://localhost:3001" && p.environments.local.writable === true && p.environments.test?.baseUrl === "https://t.example" && !("vars" in p), r.all);
  check("--print: ${VAR} resolved", p.specPaths?.[0]?.path === path.join(C, "specs"), JSON.stringify(p.specPaths));
  const { loadEnvironments } = await import(pathToFileURL(path.join(PLUGIN, "kit/env.mjs")).href);
  const envs = loadEnvironments(cf);
  check("kit environments see the local override", envs.find((e) => e.name === "local")?.match === "http://localhost:3001", JSON.stringify(envs));
  const { loadConfig } = await import(pathToFileURL(path.join(PLUGIN, "core/config.mjs")).href);
  j("cfg/home.json", { vars: { H: "" }, specPaths: ["${H}/specs", "~/x"] });
  j("cfg/home.local.json", { vars: { H: "~/proj" } });
  const hc = loadConfig(path.join(C, "home.json"), { env: {} });
  check("~ expands to the home folder", hc.specPaths[0] === `${path.join(os.homedir(), "proj")}/specs` && hc.specPaths[1] === path.join(os.homedir(), "x"), JSON.stringify(hc.specPaths));
  const git = (args) => spawnSync("git", args, { cwd: C, encoding: "utf8" });
  if (git(["init", "-q"]).status === 0) {
    r = run("core/config.mjs", ["--config", cf, "--check"], { env });
    check("git: local file not ignored → warning", /not in \.gitignore/.test(r.out), r.all);
    git(["add", "-f", "test.config.local.json"]);
    r = run("core/config.mjs", ["--config", cf, "--check"], { env });
    check("git: local file committed → exit 1 with git rm --cached", r.code === 1 && /git rm --cached test\.config\.local\.json/.test(r.out), r.all);
  } else check("git available for the tracked-file check", false, "git init failed");
}

// ── find-spec ─────────────────────────────────────────────────────────────────
section("find-spec");
{
  const S = path.join(T, "fs");
  const touch = (rel, d) => {
    const f = w(path.join("fs", rel), "x");
    return f;
  };
  touch("docs/SCR001 overview.md");
  touch("docs/unrelated.md");
  touch("shared/design/SCR001 search screen.xlsx");
  touch("shared/design/api-SCR001-list.xlsx");
  touch("shared/design/api-OTHER-list.xlsx");
  touch("shared/design/~$SCR001 search screen.xlsx");
  touch("shared/design/SCR001/notes.md");
  touch("acc/Sample Screen acceptance.xlsx");
  touch("dec/SCR001-decisions.md");
  const cfg = {
    specPaths: [
      "docs",
      { path: path.join(S, "shared/design"), kind: "screen", match: ["{scope} *", "api-{scope}-*"], exclude: ["~$*"], kinds: { "api-*": "api" } },
      { path: "acc", kind: "acceptance", match: ["*{scope}*.xls*"] },
      { path: "dec", kind: "decision" },
      { path: "missing-folder", kind: "x" },
    ],
    scopes: { SCR001: ["Sample Screen"] },
    specPrecedence: ["decision", "api", "screen", "acceptance"],
  };
  writeFileSync(path.join(S, "test.config.json"), JSON.stringify(cfg));
  const r = run("core/find-spec.mjs", ["SCR001", "--config", path.join(S, "test.config.json"), "--json"]);
  check("exit 0 with hits", r.code === 0, r.all);
  let hits = [];
  try {
    hits = JSON.parse(r.out).hits;
  } catch {
    /* reported below */
  }
  const names = hits.map((h) => path.basename(h.path));
  const kindOf = (n) => hits.find((h) => path.basename(h.path) === n)?.kind;
  check("string entry → kind doc, match by scope", kindOf("SCR001 overview.md") === "doc" && !names.includes("unrelated.md"), names);
  check("object entry match + exclude", names.includes("SCR001 search screen.xlsx") && !names.some((n) => n.startsWith("~$")) && !names.includes("api-OTHER-list.xlsx"), names);
  check("folder named by scope is a hit", names.includes("notes.md"), names);
  check("`kinds`: screen file keeps entry kind", kindOf("SCR001 search screen.xlsx") === "screen", JSON.stringify(hits));
  check("`kinds`: api-* file gets kind api", kindOf("api-SCR001-list.xlsx") === "api", JSON.stringify(hits));
  check("`scopes` alias finds the feature name", kindOf("Sample Screen acceptance.xlsx") === "acceptance", names);
  const order = [...new Set(hits.map((h) => h.kind))];
  check("`specPrecedence` order", JSON.stringify(order) === JSON.stringify(["decision", "api", "screen", "acceptance", "doc"]), order);
  check("missing specPaths folder reported", /specPaths not found: .*missing-folder/.test(r.err), r.err);
  const r2 = run("core/find-spec.mjs", ["NOPE999", "--config", path.join(S, "test.config.json")]);
  check("no hits → exit 1", r2.code === 1, r2.all);
  const r3 = run("core/find-spec.mjs", ["SCR001", "--config", path.join(S, "none.json")]);
  check("missing config → exit 2", r3.code === 2);
  // path excludes + scopeMatch: one shared folder split by screen family
  for (const f of ["specs/web-api/api-W01-list.xlsx", "specs/mobile/api-W01-list.xlsx", "specs/mobile/api-A01-list.xlsx", "specs/web-api/api-A01-list.xlsx",
    "specs/web-legacy/A01 x.xlsx", "specs/archive/API/api-W01-list.xlsx", "specs/web-api/old/api-W01-list.xlsx"]) touch(f);
  const fn = path.join(S, "specs");
  writeFileSync(path.join(S, "sm.json"), JSON.stringify({
    scopes: { WEB01: ["W01"], APP01: ["A01"] },
    specPaths: [
      { path: fn, kind: "api", match: ["api-{scope}-*", "{scope} *"], exclude: ["mobile/**", "**/archive/**", "**/old/**"], scopeMatch: ["WEB*"] },
      { path: fn, kind: "api", match: ["api-{scope}-*", "{scope} *"], exclude: ["web-api/**", "web-legacy/**", "**/archive/**"], scopeMatch: ["APP*"] },
    ],
  }));
  const rel = (o) => { try { return JSON.parse(o).hits.map((h) => path.relative(fn, h.path).split(path.sep).join("/")).sort(); } catch { return []; } };
  const pc = rel(run("core/find-spec.mjs", ["WEB01", "--config", path.join(S, "sm.json"), "--json"]).out);
  check("exclude with / matches the relative path; scopeMatch picks the WEB entry", JSON.stringify(pc) === JSON.stringify(["web-api/api-W01-list.xlsx"]), pc);
  const mb = rel(run("core/find-spec.mjs", ["APP01", "--config", path.join(S, "sm.json"), "--json"]).out);
  check("scopeMatch picks the APP entry (web-api/** and web-legacy/** excluded)", JSON.stringify(mb) === JSON.stringify(["mobile/api-A01-list.xlsx"]), mb);
}

// ── scan-specs ────────────────────────────────────────────────────────────────
section("scan-specs");
{
  for (const s of ["S001", "S002", "S003"]) w(`sc/画面設計/${s}/design.xlsx`, "x");
  w("sc/API/list.xlsx", "x");
  w("sc/受入/at.xlsx", "x");
  w("sc/node_modules/x/readme.md", "x");
  const r = run("core/scan-specs.mjs", [path.join(T, "sc"), "--json"]);
  let out = [];
  try {
    out = JSON.parse(r.out);
  } catch {
    /* reported below */
  }
  const by = (k) => out.filter((f) => f.kind === k);
  check("kinds api / acceptance / screen found", by("api").length === 1 && by("acceptance").length === 1 && by("screen").length === 1, r.out);
  check("3 sibling folders roll up to the parent", by("screen")[0]?.folder.endsWith("画面設計") && by("screen")[0]?.subfolders === 3 && by("screen")[0]?.docs === 3, JSON.stringify(by("screen")));
  check("node_modules skipped", !out.some((f) => f.folder.includes("node_modules")));
  const r2 = run("core/scan-specs.mjs", [path.join(T, "sc", "API")]);
  check("text mode asks for missing kinds", /none look like: screen/.test(r2.out), r2.out);
}

// ── hooks/guard-bash.mjs ──────────────────────────────────────────────────────
section("hooks/guard-bash.mjs");
{
  // 2 = denied (one PreToolUse JSON answer with permissionDecision "deny"), 0 = allowed (no output), else the exit code
  const guard = (command) => {
    const r = run("hooks/guard-bash.mjs", [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) });
    if (r.code !== 0) return r.code;
    if (!r.out) return 0;
    try { return JSON.parse(r.out).hookSpecificOutput?.permissionDecision === "deny" ? 2 : -1; } catch { return -1; }
  };
  const BLOCK = [
    "rm -rf /",
    "rm -rf ~",
    "git reset --hard HEAD~1",
    "git stash -u",
    "git clean -fd",
    "git push --force origin main",
    "psql -h db -c 'select 1'",
    "echo 'DROP TABLE users' | x",
    "curl -X DELETE http://localhost:3000/api/x/1",
    "curl -d '{}' http://localhost:3000/api/x",
  ];
  const ALLOW = ["node test/selftest.mjs", "curl http://localhost:3000/api/list", "rm -f file.txt", "git status", "git push", "git stash list"];
  for (const c of BLOCK) check(`blocks: ${c}`, guard(c) === 2);
  for (const c of ALLOW) check(`allows: ${c}`, guard(c) === 0);
  check("other tools pass", run("hooks/guard-bash.mjs", [], { input: JSON.stringify({ tool_name: "Write", tool_input: {} }) }).code === 0);
  check("non-JSON input passes", run("hooks/guard-bash.mjs", [], { input: "garbage" }).code === 0);
  const off = run("hooks/guard-bash.mjs", [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git clean -fd" } }), env: { VUONG_TEST_GUARD: "off" } });
  check("VUONG_TEST_GUARD=off disables it", off.code === 0 && !off.out);
  const hj = JSON.parse(readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  const h0 = hj.hooks?.PreToolUse?.find((h) => h.matcher === "Bash")?.hooks?.[0] || {};
  check("hooks.json registers guard-bash on Bash (command + args)", h0.command === "node" && (h0.args || []).includes("${CLAUDE_PLUGIN_ROOT}/hooks/guard-bash.mjs"), JSON.stringify(h0));
}

// ── parsers backward compat ───────────────────────────────────────────────────
section("parsers backward compat");
{
  const old = w(
    "old/cases.md",
    [
      "# Cases — old",
      "- Inventory: inventory.md (commit 123)",
      "- Approved by: Tester   ·   Date: 2026-01-01",
      "",
      table(CASE_HEAD, [["A-001", "ut", "I1", "s", "1", "SRS", "none: pure", "N"]]),
      "",
      table(["Inventory ref", "Reason"], [["I9", "out of scope"]]),
      "",
    ].join("\n")
  );
  const { parseCases, tagsOf } = await import(pathToFileURL(path.join(PLUGIN, "core/parsers.mjs")).href);
  const p = parseCases(old);
  check('"Inventory:" header read as flows', p.flows.startsWith("inventory.md"), p.flows);
  check('"Inventory ref" table read as not covered', p.notCovered[0]?.ref === "I9" && p.notCovered[0]?.reason === "out of scope", JSON.stringify(p.notCovered));
  check("tagsOf: several tags, spaces inside", JSON.stringify(tagsOf("[A-1] and [QA 1.2] x")) === JSON.stringify(["A-1", "QA 1.2"]));
}

// ── kit/e2e-kit.mjs (optional, needs Playwright) ─────────────────────────────
section("kit/e2e-kit.mjs");
{
  const from = process.env.VT_PLAYWRIGHT_FROM;
  let resolvable = false;
  if (from) {
    try {
      createRequire(path.join(path.resolve(from), "noop.js")).resolve("playwright");
      resolvable = true;
    } catch {
      /* not resolvable */
    }
  }
  if (!resolvable) {
    console.log(`skip kit checks: set VT_PLAYWRIGHT_FROM=<dir with node_modules/playwright>${from ? ` (not resolvable from ${from})` : ""}`);
  } else {
    // the fixture page and server are generated so their delays are not literal lines here
    const ST = "setTime" + "out";
    const script = `import http from "node:http";
import { createRun } from ${JSON.stringify(pathToFileURL(path.join(PLUGIN, "kit/e2e-kit.mjs")).href)};
const html = \`<!doctype html><body><div id="mask" class="loading-mask">loading</div><div id="out"></div><script>
async function go(){ const r = await fetch('/api/list'); document.getElementById('out').textContent = await r.text();
  ${ST}(()=>document.getElementById('mask').remove(), 300); }
async function save(){ try { const r = await fetch('/api/save',{method:'POST',body:'{}'}); document.getElementById('out').textContent='saved '+r.status }
  catch(e){ document.getElementById('out').textContent='save failed' } }
async function search(){ const r = await fetch('/api/search',{method:'POST',body:'{}'}); document.getElementById('out').textContent='search '+r.status }
go();</script></body>\`;
const srv = http.createServer((q, s) => {
  if (q.url === "/api/list") return ${ST}(() => s.end("rows:3"), 400);
  if (q.url.startsWith("/api/")) return s.end("ok");
  s.setHeader("content-type", "text/html"); s.end(html);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = \`http://127.0.0.1:\${srv.address().port}/\`;
const run = await createRun({
  out: process.env.OUT, from: process.env.VT_PLAYWRIGHT_FROM,
  writes: { readOnlyPosts: [/\\/api\\/search$/] },
  env: { environments: [{ name: "local", match: "127.0.0.1", writable: process.env.WRITABLE === "1" }] },
});
await run.tc("K-001", "settle", async ({ page, settle, expect }) => {
  await page.goto(base); await settle();
  const txt = await page.textContent("#out"); const mask = await page.locator("#mask").count();
  expect(txt === "rows:3" && mask === 0, \`out=\${txt} mask=\${mask}\`);
});
await run.tc("K-002", "read-only case", async ({ page, settle, expect }) => {
  await page.evaluate(() => save()); await settle();
  expect((await page.textContent("#out")) === "save failed", "save not aborted");
  await page.evaluate(() => search()); await settle();
  expect((await page.textContent("#out")) === "search 200", "search blocked");
});
await run.tc("K-003", "writes:true", async ({ page, settle }) => {
  await page.evaluate(() => save()); await settle(); return await page.textContent("#out");
}, { writes: true });
const v1 = await run.cache("probe", async () => ({ n: Math.random() }));
const v2 = await run.cache("probe", async () => ({ n: -1 }));
console.log("cache hit:", v1.n === v2.n);
await run.finish();
srv.close();
`;
    const kitScript = w("kit/kit-run.mjs", script);
    const runKit = (writable) => {
      const out = path.join(T, "kit", writable ? "w" : "ro", "e2e");
      const r = spawnSync(process.execPath, [kitScript], {
        cwd: T,
        encoding: "utf8",
        timeout: 120000,
        env: { ...process.env, OUT: out, WRITABLE: writable ? "1" : "0", VT_PLAYWRIGHT_FROM: path.resolve(from) },
      });
      const f = path.join(out, "e2e-results.json");
      const res = existsSync(f) ? readJson(f) : { tests: [] };
      const by = (id) => (res.tests || []).find((t) => (t.ids || []).includes(id) || (t.name || "").includes(id)) || {};
      return { r, by, all: `${r.stdout}${r.stderr}` };
    };
    const ro = runKit(false);
    check("kit: settle waits for GET + mask", ro.by("K-001").status === "passed", ro.all + JSON.stringify(ro.by("K-001")));
    check("kit: write guard aborts POST, readOnlyPosts pass", ro.by("K-002").status === "passed" && (ro.by("K-002").aborted || []).some((a) => /\/api\/save/.test(a.url)), JSON.stringify(ro.by("K-002")));
    check("kit: env guard BLOCKED when not writable", ro.by("K-003").status === "blocked", JSON.stringify(ro.by("K-003")));
    check("kit: FE→BE trace — API calls recorded per case", (ro.by("K-001").exchanges || []).some((x) => /\/api\/list$/.test(x.url) && x.status === 200 && x.ms >= 300), JSON.stringify(ro.by("K-001").exchanges));
    check("kit: cache returns the stored value", /cache hit: true/.test(ro.r.stdout), ro.all);
    const wr = runKit(true);
    check("kit: writable env → writes:true case PASS with writes logged", wr.by("K-003").status === "passed" && (wr.by("K-003").writes || []).length >= 1, wr.all + JSON.stringify(wr.by("K-003")));
  }
}

// ── kit/api-kit.mjs (local HTTP server, always runs) ──────────────────────────
section("kit/api-kit.mjs");
{
  const { shape } = await import(pathToFileURL(path.join(PLUGIN, "kit/api-kit.mjs")).href);
  check("shape: ok", shape({ a: 1, b: "x", c: null, d: [{ e: true }] }, { a: "number", b: /^x$/, c: "string?", d: [{ e: "boolean" }] }).length === 0);
  const bad = shape({ a: "1", d: [{ e: 1 }] }, { a: "number", b: "string", d: [{ e: "boolean" }] });
  check("shape: mismatches listed with paths", bad.length === 3 && bad.some((m) => m.startsWith("$.d[0].e")) && bad.some((m) => /\$\.b: expected string, got missing/.test(m)), JSON.stringify(bad));
  const ENV = "process" + ".env";
  const PW = "pw-" + "secret";
  const script = `import http from "node:http";
import { createApiRun } from ${JSON.stringify(pathToFileURL(path.join(PLUGIN, "kit/api-kit.mjs")).href)};
const E = ${ENV};
const PWV = ${JSON.stringify(PW)};
const got = [];
const srv = http.createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
  got.push(q.method + " " + q.url + " " + (q.headers.authorization || ""));
  s.setHeader("content-type", "application/json");
  if (q.url === "/auth/login") return s.end(JSON.stringify({ ["tok" + "en"]: "T0KEN" }));
  if (q.url.startsWith("/tasks?")) return s.end(JSON.stringify({ items: [{ id: 1, code: "T1" }], total: 1 }));
  if (q.url === "/tasks/search") return s.end(JSON.stringify({ items: [] }));
  if (q.url === "/tasks" && q.method === "POST") { s.statusCode = 201; return s.end(JSON.stringify({ code: "E2E-1" })); }
  s.statusCode = 404; s.end(JSON.stringify({ code: "E404" }));
}); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const run = await createApiRun({ out: E.OUT, baseUrl: "http://127.0.0.1:" + srv.address().port, dataCreated: E.DATA,
  writes: { readOnlyPosts: [/\\/tasks\\/search$/] },
  env: { environments: [{ name: "local", match: "127.0.0.1", writable: E.WRITABLE === "1" }] } });
await run.login(async ({ api }) => { const r = await api.post("/auth/login", { body: { user: "u", password: PWV } }); return { Authorization: "Bearer " + r.data.token }; });
await run.tc("A-001", "list shape", async ({ api, expectStatus, expectShape }) => {
  const r = await api.get("/tasks", { query: { page: 1 } }); expectStatus(r, 200);
  expectShape(r.data, { items: [{ id: "number", code: "string" }], total: "number" }); });
await run.tc("A-002", "shape mismatch fails", async ({ api, expectShape }) => { expectShape((await api.get("/tasks", { query: { p: 1 } })).data, { total: "string" }); });
await run.tc("A-003", "read-only case POST not sent", async ({ api }) => { await api.post("/tasks", { body: {} }); });
await run.tc("A-004", "search POST allowed", async ({ api, expectStatus }) => { expectStatus(await api.post("/tasks/search", { body: {} }), 200); });
await run.tc("A-005", "create", async ({ api, expectStatus, created }) => {
  const r = await api.post("/tasks", { body: { name: "x" } }); expectStatus(r, 201);
  await created({ record: r.data.code, cleanup: "delete in task list" }); }, { writes: true });
await run.tc("A-006", "404 error code", async ({ api, expectStatus, expect }) => { const r = await api.get("/nope"); expectStatus(r, 404); expect(r.data.code === "E404"); });
await run.tc("A-007", "login body redacted", async ({ api }) => { await api.post("/auth/login", { body: { user: "u", password: PWV } }); });
await run.tc("A-008", "verify mismatch readable", async ({ api, verify }) => { const r = await api.get("/nope"); verify("status", 200, r.status); verify("error code", /^E4/, r.data.code); verify("message", "Not found", r.data.message); });
await run.finish();
console.log("SERVER " + JSON.stringify(got));
srv.close();
`;
  const sc = w("apikit/run.mjs", script);
  const runApi = (writable) => {
    const out = path.join(T, "apikit", writable ? "w" : "ro", "api");
    const data = path.join(T, "apikit", writable ? "w" : "ro", "data-created.md");
    const r = spawnSync(process.execPath, [sc], { cwd: T, encoding: "utf8", timeout: 60000, env: { ...process.env, OUT: out, DATA: data, WRITABLE: writable ? "1" : "0" } });
    const f = path.join(out, "api-results.json");
    const res = existsSync(f) ? readJson(f) : { tests: [] };
    const by = (id) => res.tests.find((t) => t.ids.includes(id)) || {};
    return { r, by, all: `${r.stdout}${r.stderr}`, data, out };
  };
  const ro = runApi(false);
  check("api-kit: GET + query + shape PASS, token header sent", ro.by("A-001").status === "passed" && /GET \/tasks\?page=1 Bearer T0KEN/.test(ro.r.stdout), ro.all);
  check("api-kit: shape mismatch FAIL with path", ro.by("A-002").status === "failed" && /\$\.total: expected string/.test(ro.by("A-002").error), JSON.stringify(ro.by("A-002")));
  check("api-kit: write guard — POST not sent in read-only case", ro.by("A-003").status === "failed" && /write guard/.test(ro.by("A-003").error) && !/"POST \/tasks "/.test(ro.r.stdout) && ro.by("A-003").aborted.length === 1, ro.all);
  check("api-kit: readOnlyPosts POST passes", ro.by("A-004").status === "passed");
  check("api-kit: env not writable → writes:true BLOCKED, nothing sent", ro.by("A-005").status === "blocked" && !existsSync(ro.data), JSON.stringify(ro.by("A-005")));
  check("api-kit: 4xx returned, not thrown", ro.by("A-006").status === "passed");
  check("api-kit: exchanges recorded per case", (ro.by("A-001").exchanges || []).length === 1 && ro.by("A-001").exchanges[0].status === 200);
  const a8 = ro.by("A-008").error || "";
  check("api-kit verify(): all mismatches, Expected / Actual lines, matches not listed", ro.by("A-008").status === "failed" && /✗ status\n  Expected: 200\n  Actual:   404/.test(a8) && /✗ message/.test(a8) && !/error code/.test(a8), a8);
  const wr = runApi(true);
  const a5 = wr.by("A-005");
  check("api-kit: writable env → writes logged + data-created row", a5.status === "passed" && a5.writes.length === 1 && existsSync(wr.data) && /\| A-005 \|.*\| E2E-1 \| created \| delete in task list \| left \|/.test(readFileSync(wr.data, "utf8")), wr.all + (existsSync(wr.data) ? readFileSync(wr.data, "utf8") : ""));
  const stored = readFileSync(path.join(wr.out, "api-results.json"), "utf8");
  check("api-kit: password and token redacted in stored results", !stored.includes(PW) && !stored.includes("T0KEN"), stored.slice(0, 600));
  const W2 = path.join(T, "apikit", "w");
  w("apikit/w/cases.md", casesMd([["A-001", "api", "E1", "GET /tasks", "200 + shape", "API spec 1", "tasks exist", "N"], ["A-005", "api", "E2", "POST /tasks", "201", "API spec 2", "none: creates", "Y"]]));
  const c = run("core/collect.mjs", ["--cases", path.join(W2, "cases.md"), "--out", path.join(W2, "results.json"), "--api-dir", W2, "--data", wr.data]);
  const cr = existsSync(path.join(W2, "results.json")) ? readJson(path.join(W2, "results.json")) : { tests: [] };
  check("collect --api-dir picks up api/api-results.json", c.code === 0 && cr.tests.length === 8 && cr.tests.every((t) => t.stack === "api") && cr.dataCreated.length === 1, c.all);
  const h = run("core/render-html.mjs", [path.join(W2, "results.json"), "--out", path.join(W2, "report")]);
  const html = existsSync(path.join(W2, "report")) ? readdirSync(path.join(W2, "report")).map((f) => readFileSync(path.join(W2, "report", f), "utf8")).join("") : "";
  check("render-html shows API calls per test", /1 call\(s\)/.test(html) && /E2E-1/.test(html), h.all);
}

// ── read-spec ─────────────────────────────────────────────────────────────────
section("read-spec");
{
  const crc32 = (b) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  // minimal ZIP writer: deflate for even entries, stored for odd, to exercise both methods
  const zipOf = (files) => {
    const locals = [];
    const cen = [];
    let off = 0;
    Object.entries(files).forEach(([name, text], i) => {
      const raw = Buffer.from(text, "utf8");
      const method = i % 2 ? 0 : 8;
      const data = method ? deflateRawSync(raw) : raw;
      const nm = Buffer.from(name, "utf8");
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(method, 8);
      h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10);
      c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
      locals.push(h, nm, data);
      cen.push(c, nm);
      off += 30 + nm.length + data.length;
    });
    const cd = Buffer.concat(cen);
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cen.length / 2, 8); e.writeUInt16LE(cen.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, e]);
  };
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const rel = (id, target) => `<Relationships><Relationship Id="${id}" Type="x" Target="${target}"/></Relationships>`;
  const docs = path.join(T, "rs-src");
  mkdirSync(docs, { recursive: true });
  const xlsxF = path.join(docs, "demo.xlsx");
  writeFileSync(xlsxF, zipOf({
    "xl/workbook.xml": `<workbook ${R}><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="秘密" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Tên khách hàng</t></si><si><r><t>必須</t></r><r><t>項目</t></r><rPh><t>ヒッス</t></rPh></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${R}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><v>42</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="inlineStr"><is><t>inline &amp; text</t></is></c><c r="D2" t="b"><v>1</v></c></row><row r="3"/></sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells><drawing r:id="rId9"/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": rel("rId9", "../drawings/drawing1.xml"),
    "xl/drawings/drawing1.xml": `<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row></xdr:from><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Mock 1"/></xdr:nvPicPr></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden cell</t></is></c></row></sheetData></worksheet>`,
  }));
  const docxF = path.join(docs, "demo.docx");
  writeFileSync(docxF, zipOf({
    "word/styles.xml": `<w:styles><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    "word/document.xml": `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p><w:p/><w:p><w:r><w:t xml:space="preserve">Max length </w:t></w:r><w:r><w:t>20 chars</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rule</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Code</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>必須入力</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  }));
  const pdfF = path.join(docs, "x.pdf");
  writeFileSync(pdfF, "%PDF-1.4");
  const out = path.join(T, "rs-out");
  const r = run("core/read-spec.mjs", [xlsxF, docxF, pdfF, "--out", out]);
  check("read-spec: exit 3 when one file is unsupported (pdf), others still written", r.code === 3 && /x\.pdf: unsupported by read-spec/.test(r.out) && /demo\.xlsx\.md .*sheets=2 rows=3/.test(r.out), r.all);
  const xm = existsSync(path.join(out, "demo.xlsx.md")) ? readFileSync(path.join(out, "demo.xlsx.md"), "utf8") : "";
  const sha = createHash("sha256").update(readFileSync(xlsxF)).digest("hex");
  check("read-spec xlsx: header with sha256 + size", xm.includes(`- sha256: ${sha}`) && /- Size: \d+ bytes/.test(xm) && /- Modified: /.test(xm), xm);
  check("read-spec xlsx: sheet name + Sheet1!A2-style citations", xm.includes("## Sheet: Sheet1") && xm.includes("- **Sheet1!A2** 42 | **B2** 必須項目 | **C2** inline & text | **D2** TRUE"), xm);
  check("read-spec xlsx: shared string (Vietnamese) kept, phonetic dropped", xm.includes("**Sheet1!A1** Tên khách hàng") && !xm.includes("ヒッス"), xm);
  check("read-spec xlsx: merged note, image anchor, hidden sheet", xm.includes("merged Sheet1!A1:C1") && xm.includes("image in sheet Sheet1 near cell Sheet1!D5 (Mock 1)") && xm.includes("## Sheet: 秘密 (hidden)") && xm.includes("**秘密!A1** hidden cell"), xm);
  const dm = existsSync(path.join(out, "demo.docx.md")) ? readFileSync(path.join(out, "demo.docx.md"), "utf8") : "";
  check("read-spec docx: heading, paragraph ¶ number, table cell citation", dm.includes("## Overview ¶1") && dm.includes("**¶3** Max length 20 chars") && dm.includes("**Table 1 r2c2** 必須入力"), dm);
  const r2 = run("core/read-spec.mjs", [xlsxF, "--out", path.join(T, "rs-out2"), "--sheets", "Sheet*", "--max-rows", "1"]);
  const xm2 = readFileSync(path.join(T, "rs-out2", "demo.xlsx.md"), "utf8");
  check("read-spec: --sheets filters, --max-rows truncates", r2.code === 0 && !xm2.includes("秘密") && xm2.includes("truncated at --max-rows 1") && !xm2.includes("Sheet1!A2"), xm2);
  const r3 = run("core/read-spec.mjs", [xlsxF, "--out", docs]);
  check("read-spec: refuses to write next to the source", r3.code === 1 && !existsSync(path.join(docs, "demo.xlsx.md")), r3.all);
  const r4 = run("core/read-spec.mjs", [xlsxF], { cwd: path.join(T, "repo") });
  check("read-spec: default out is <cwd>/test-work/_spec/", r4.code === 0 && existsSync(path.join(T, "repo", "test-work", "_spec", "demo.xlsx.md")), r4.all);
}

// ── fake-api (mount layer) ────────────────────────────────────────────────────
section("fake-api");
{
  const { createFakeApi, axiosAdapter, fetchStub } = await import(pathToFileURL(path.join(PLUGIN, "kit/fake-api.mjs")).href);
  const api = createFakeApi({
    "GET /api/items": (q) => ({ items: [1, 2], q: q.query }),
    "PUT /api/tasks/:id": (q) => (q.body.v === 1 ? { saved: q.params.id } : { status: 409, data: { code: "E409" } }),
    "GET /files/*": () => "raw",
  });
  const r1 = await api.handle("GET", "http://h:1/api/items?active=1&t=a&t=b");
  check("fake-api: route match + query parsing", r1.status === 200 && r1.data.q.active === "1" && r1.data.q.t.join() === "a,b", JSON.stringify(r1));
  const r2 = await api.handle("put", "/api/tasks/7", JSON.stringify({ v: 1 }));
  check("fake-api: :param captured, JSON body parsed", r2.status === 200 && r2.data.saved === "7", JSON.stringify(r2));
  const r3 = await api.handle("PUT", "/api/tasks/8", { v: 2 });
  check("fake-api: handler { status, data } response", r3.status === 409 && r3.data.code === "E409");
  check("fake-api: * wildcard", (await api.handle("GET", "/files/a/b.txt")).data === "raw");
  let thrown = "";
  try {
    await api.handle("DELETE", "/api/tasks/7");
  } catch (e) {
    thrown = e.message;
  }
  check("fake-api: strict unknown route throws", /no route for DELETE \/api\/tasks\/7/.test(thrown), thrown);
  const loose = createFakeApi({}, { strict: false });
  check("fake-api: strict:false → 404", (await loose.handle("GET", "/x")).status === 404);
  check("fake-api: calls recorded (incl. unmatched)", api.calls.length === 5 && api.calls[1].params.id === "7" && api.calls[4].route === null, JSON.stringify(api.calls.map((c) => c.route)));
  const hit = api.assertCalled("PUT", "/api/tasks/:id", (c) => c.params.id === "8" && c.body.v === 2);
  check("fake-api: assertCalled passes with matcher", hit.length === 1);
  let miss = "";
  try {
    api.assertCalled("PUT", "/api/tasks/:id", (c) => c.params.id === "99");
  } catch (e) {
    miss = e.message;
  }
  check("fake-api: assertCalled fails with call list", /expected PUT .*calls: GET \/api\/items/.test(miss), miss);
  api.reset();
  check("fake-api: reset clears calls", api.calls.length === 0);
  const ad = axiosAdapter(api);
  const ok = await ad({ method: "put", baseURL: "/api/", url: "/tasks/3", data: JSON.stringify({ v: 1 }), headers: {} });
  check("axiosAdapter: axios response shape", typeof ad === "function" && ok.status === 200 && ok.data.saved === "3" && ok.config.url === "/tasks/3");
  const okq = await ad({ method: "get", url: "/api/items", params: { active: 1, skip: undefined } });
  check("axiosAdapter: params → query", okq.data.q.active === "1" && !("skip" in okq.data.q));
  let ae = null;
  try {
    await ad({ method: "put", url: "/api/tasks/3", data: { v: 2 } });
  } catch (e) {
    ae = e;
  }
  check("axiosAdapter: non-2xx rejects with err.response", ae && ae.response.status === 409 && ae.response.data.code === "E409");
  const f = fetchStub(api);
  const fr = await f("/api/tasks/5", { method: "PUT", body: JSON.stringify({ v: 1 }) });
  const fbad = await f("/api/tasks/5", { method: "PUT", body: JSON.stringify({ v: 0 }) });
  check("fetchStub: Response-like with json()", fr.ok && fr.status === 200 && (await fr.json()).saved === "5" && !fbad.ok && fbad.status === 409 && typeof fr.headers.get === "function");
  const cjs = createRequire(import.meta.url)(path.join(PLUGIN, "kit/fake-api.cjs"));
  check("fake-api.cjs exports the same API", ["createFakeApi", "axiosAdapter", "fetchStub"].every((k) => typeof cjs[k] === "function"));
  const sync = spawnSync(process.execPath, [path.join(PLUGIN, "kit/build-cjs.mjs"), "--check"], { encoding: "utf8" });
  check("fake-api.cjs in sync with fake-api.mjs (build-cjs --check)", sync.status === 0, sync.stdout + sync.stderr);
}

// ── import-cases / export-cases (tester's test case file) ─────────────────────
section("import-cases / export-cases");
{
  const ox = await import(pathToFileURL(path.join(PLUGIN, "core/ooxml.mjs")).href);
  const C = path.join(T, "tcf");
  mkdirSync(path.join(C, "src"), { recursive: true });
  const testerFile = path.join(C, "src", "Acceptance_SCR1.xlsx");
  writeFileSync(
    testerFile,
    ox.newXlsx("Cases", [
      ["Acceptance test SCR1"],
      ["No", "Operation", "Check", "Expected", "Result", "Evidence"],
      ["*", "Open screen", "Display", "", "", ""],
      ["1", "", "list shows rows", "3 rows", "PASS", "old run"],
      ["2", "", "header colour", "please confirm", "PASS", "visual"],
      ["*", "Save", "see data sheet", "", "", ""],
      ["3", "", "save", 'toast "saved"', "", ""],
    ])
  );
  const before = readFileSync(testerFile);
  const cfgFile = path.join(C, "test.config.json");
  writeFileSync(cfgFile, JSON.stringify({ caseTemplates: [
    { name: "acc", match: "Acceptance_*", sheet: "Cases", headerRow: 2, columns: { no: "A", flow: "B", steps: "C", expected: "D", result: "E", evidence: "F" },
      groupMarker: "*", idFormat: "{scope}-{no}", vagueExpected: ["confirm"], dataRef: "data sheet", results: { passed: "PASS", failed: "FAIL", blocked: "SKIP" } },
  ] }));
  const W3 = path.join(C, "W");
  const im = run("core/import-cases.mjs", [testerFile, "--scope", "SCR1", "--out", path.join(W3, "cases.md"), "--config", cfgFile]);
  const md = existsSync(path.join(W3, "cases.md")) ? readFileSync(path.join(W3, "cases.md"), "utf8") : "";
  check("import-cases: one case per numbered row, IDs with scope", im.code === 0 && /\| SCR1-1 \|/.test(md) && /\| SCR1-3 \|/.test(md) && !/\| SCR1-\* /.test(md), im.all + md);
  check("import-cases: group row carries flow + context, origin kept", /\| SCR1-1 \| \? \| Open screen \| \[Display\] list shows rows \| 3 rows \| tester file \/ Cases!D4 \| \? \| \? \| Cases!4 \|/.test(md), md);
  check("import-cases: vague expected marked, data-sheet hint", /\| SCR1-2 \|[^\n]*⚠ not concrete/.test(md) && /\| SCR1-3 \|[^\n]*see test data/.test(md), md);
  const lc = run("core/lint-cases.mjs", [path.join(W3, "cases.md")]);
  check("lint-cases rejects ⚠ not concrete and Layer/Writes ?", lc.code === 1 && /SCR1-2: Expected from the tester's file is not concrete/.test(lc.out) && /SCR1-1: layer "\?"/.test(lc.out), lc.out);
  check("import-cases: refuses to overwrite without --force", run("core/import-cases.mjs", [testerFile, "--scope", "SCR1", "--out", path.join(W3, "cases.md"), "--config", cfgFile]).code === 2);
  check("import-cases: no template → exit 2 with hint", /no caseTemplates entry/.test(run("core/import-cases.mjs", [testerFile, "--scope", "SCR1", "--out", path.join(W3, "c2.md")]).err));
  j("tcf/W/e2e.json", { tests: [{ name: "[SCR1-1] list", status: "passed", shots: ["/x/SCR1-1-end.png"] }, { name: "[SCR1-3] save", status: "failed", error: "no toast" }] });
  run("core/collect.mjs", ["--cases", path.join(W3, "cases.md"), "--out", path.join(W3, "results.json"), "--e2e-json", path.join(W3, "e2e.json")]);
  const ex = run("core/export-cases.mjs", [path.join(W3, "results.json"), "--out", path.join(W3, "report"), "--file", testerFile, "--config", cfgFile, "--date", "2026-11-04"]);
  const outs = existsSync(path.join(W3, "report")) ? readdirSync(path.join(W3, "report")) : [];
  const copy = outs.find((f) => /^Acceptance_SCR1_result_.*\.xlsx$/.test(f));
  const def = outs.find((f) => /^test-cases-SCR1-.*\.xlsx$/.test(f));
  check("export-cases: default file + tester copy written", ex.code === 0 && copy && def, ex.all + outs);
  if (copy && def) {
    const z = ox.readZip(readFileSync(path.join(W3, "report", copy)));
    const cells = ox.sheetCells(z, ox.sheetList(z)[0].part);
    check("export-cases: results + evidence on the origin rows", cells.get("E4") === "PASS" && cells.get("F4") === "SCR1-1-end.png" && cells.get("E7") === "FAIL" && /no toast/.test(cells.get("F7") || ""), JSON.stringify([...cells]));
    check("export-cases: case that did not run keeps the tester's values", cells.get("E5") === "PASS" && cells.get("F5") === "visual");
    check("export-cases: other cells unchanged", cells.get("D7") === 'toast "saved"' && cells.get("A1") === "Acceptance test SCR1");
    const dz = ox.readZip(readFileSync(path.join(W3, "report", def)));
    const dc = ox.sheetCells(dz, ox.sheetList(dz)[0].part);
    check("export-cases: default layout has status per case", dc.get("A1") === "ID" && dc.get("I2") === "PASS" && dc.get("I3") === "NOT RUN" && dc.get("I4") === "FAIL" && dc.get("L2") === "Cases!4", JSON.stringify([...dc].slice(0, 30)));
  }
  check("export-cases: tester's original file untouched", Buffer.compare(before, readFileSync(testerFile)) === 0);
  // setCells: missing cell / missing row are created in order
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" s="3"><v>1</v></c></row><row r="3"><c r="A3"/></row></sheetData></worksheet>';
  const nx = ox.setCells(xml, { B1: "x", C1: "y<&", B2: "new" });
  check("ooxml.setCells: insert in column order, keep style, escape, add row", /<c r="A1"[\s\S]*<c r="B1"[^>]*><is><t[^>]*>x<\/t>[\s\S]*<c r="C1" s="3" t="inlineStr"><is><t xml:space="preserve">y&lt;&amp;<\/t>/.test(nx) && /<row r="1">[\s\S]*<\/row><row r="2"><c r="B2"[\s\S]*<\/row><row r="3">/.test(nx), nx);
}

// ── manual layer: lint, runbook, collect --manual, Pre → BLOCKED ──────────────
section("manual runbook / collect --manual / Pre");
{
  const HEAD = ["ID", "Layer", "Flow", "Type", "Priority", "Pre", "Steps", "Expected", "Source", "Data", "Writes"];
  const md = (rows, header = "- Run order: WP last<br>- Build: 1.1.0") =>
    ["# Cases — rb", "- Environment: phone   ·   Writes data: Y", "- Approved by: Tester   ·   Date: 2026-11-10", ...header.split("<br>"), "", table(HEAD, rows), ""].join("\n");
  const rows = [
    ["BF-01", "manual", "E1", "positive", "high", "", "1. Open Backup <br>2. Read the top", 'title "Backup folder" at the top', "decision D1", "none: fresh install", "N"],
    ["BF-02", "manual", "E1", "positive", "high", "BF-01", "1. Choose folder", 'status line "Saving to: FC"', "decision D1", "folder Download/FC exists", "N"],
    ["BF-03", "manual", "E1", "edge", "medium", "BF-02", "1. Back up twice", 'second file ends with " (1)"', "decision D1", "BF-02 folder", "N"],
    ["WP-01", "manual", "E2", "negative", "low", "", "1. Wipe, cancel", "nothing deleted", "decision D2", "one transaction", "Y"],
    ["UT-01", "ut", "B1", "", "", "", "`keep(11)`", "10 kept", "decision D1", "none: pure", "N"],
  ];
  const good = w("rb/cases.md", md(rows));
  let r = run("core/lint-cases.mjs", [good]);
  check("lint: manual layer, Type/Priority/Pre accepted", r.code === 0 && !/^warn/m.test(r.out), r.all);
  const bad = w(
    "rb/bad.md",
    md(
      [
        ["A-01", "manual", "E1", "happy", "urgent", "A-02", "open it", "title shown at the top", "d", "none: x", "Y"],
        ["A-02", "manual", "E1", "", "", "ZZ-9", "1. x", "line under title", "d", "none: x", "N"],
      ],
      ""
    )
  );
  r = run("core/lint-cases.mjs", [bad]);
  check("lint: Pre to an unknown ID is an error", r.code === 1 && /Pre "ZZ-9" is not a case ID/.test(r.out), r.out);
  check("lint: Pre to a later case warns", /Pre A-02 comes later/.test(r.out), r.out);
  check("lint: unknown Type / Priority warn", /Type "happy"/.test(r.out) && /Priority "urgent"/.test(r.out), r.out);
  check("lint: manual steps not numbered warn", /A-01: manual case — number the steps/.test(r.out), r.out);
  check("lint: manual writes data without Run order warns", /add a `- Run order:`/.test(r.out), r.out);

  const out = path.join(T, "rb/manual");
  r = run("core/manual-runbook.mjs", [good, "--out", out, "--lang", "vi"]);
  const file = (r.out.match(/→ (.+\.xlsx)/) || [])[1];
  check("runbook: written, automated case left out", r.code === 0 && file && existsSync(file) && /1 automated case/.test(r.out), r.all);
  const { readZip, sheetList, sheetCells, sharedStrings, setCells, rewriteZip } = await import(pathToFileURL(path.join(PLUGIN, "core/ooxml.mjs")).href);
  const zip = readZip(readFileSync(file));
  const sheets = sheetList(zip);
  check("runbook: Guide / Test cases / Summary sheets", sheets.map((s) => s.name).join("|") === "Hướng dẫn|Test cases|Tổng hợp", sheets.map((s) => s.name).join("|"));
  const caseXml = zip.get(sheets[1].part);
  check("runbook: Status column is a list with all statuses", /<dataValidation type="list"[^>]*sqref="K2:K5"><formula1>"Chưa test,Pass,Fail,Blocked,Skip"<\/formula1>/.test(caseXml), caseXml.slice(-900));
  check("runbook: Status coloured by value", (caseXml.match(/<conditionalFormatting /g) || []).length === 4);
  const cells = sheetCells(zip, sheets[1].part, sharedStrings(zip));
  check("runbook: rows in table order, steps on lines, priority label, Pre", cells.get("A2") === "BF-01" && cells.get("A5") === "WP-01" && cells.get("G2") === "1. Open Backup\n2. Read the top" && cells.get("E2") === "Cao" && cells.get("F3") === "BF-01" && cells.get("K2") === "Chưa test", [...cells].slice(0, 30).join(" ; "));
  const sumXml = zip.get(sheets[2].part);
  check("runbook: summary counts by formulas, per group", /<f>COUNTIFS\('Test cases'!\$B\$2:\$B\$5,\$A2,'Test cases'!\$K\$2:\$K\$5,&quot;Pass&quot;\)<\/f>/.test(sumXml) && /fullCalcOnLoad="1"/.test(zip.get("xl/workbook.xml")), sumXml.slice(0, 600));
  const guide = sheetCells(zip, sheets[0].part, sharedStrings(zip));
  check("runbook: guide has run order, build, Fail vs Blocked rule", [...guide.values()].some((v) => v === "WP last") && [...guide.values()].some((v) => v === "1.1.0") && [...guide.values()].some((v) => /→ Fail, không phải Blocked/.test(v)));
  r = run("core/manual-runbook.mjs", [w("rb/none.md", md([rows[4]])), "--out", out]);
  check("runbook: no manual case → exit 1", r.code === 1 && /no case with Layer = manual/.test(r.err), r.all);

  // the person fills it: BF-01 Pass, BF-02 Fail, WP-01 Skip; BF-03 left "Chưa test" → blocked by its Pre chain
  const filled = rewriteZip(zip, {
    [sheets[1].part]: setCells(caseXml, { K2: "Pass", K3: "Fail", J3: "no status line", L3: "BUG-1", K5: "Skip", L5: "no second phone" }),
    [sheets[0].part]: setCells(zip.get(sheets[0].part), { B8: "Lan" }),
  });
  const ff = path.join(T, "rb/filled.xlsx");
  writeFileSync(ff, filled);
  r = run("core/collect.mjs", ["--cases", good, "--out", path.join(T, "rb/results.json"), "--manual", ff]);
  const R = r.code === 0 ? readJson(path.join(T, "rb/results.json")) : { tests: [], inputs: {} };
  const t = (id) => R.tests.filter((x) => x.ids.includes(id));
  check("collect --manual: Pass / Fail with Actual + notes / Skip", t("BF-01")[0]?.status === "passed" && t("BF-02")[0]?.status === "failed" && /Actual: no status line\nNotes: BUG-1/.test(t("BF-02")[0]?.error) && t("WP-01")[0]?.status === "skipped" && t("BF-01")[0]?.stack === "manual", r.all + JSON.stringify(R.tests).slice(0, 600));
  check("collect: case with failed Pre is BLOCKED", t("BF-03")[0]?.status === "blocked" && /Pre BF-02 FAIL/.test(t("BF-03")[0]?.note), JSON.stringify(t("BF-03")));
  check("collect: not-run case without Pre stays not run", !t("UT-01").length);
  check("collect --manual: tester recorded", /filled\.xlsx \(Lan\)/.test((R.inputs.manual || []).join()), JSON.stringify(R.inputs));
  // chain: A fails → B (Pre A) blocked → C (Pre B) blocked
  const chain = w("rb/chain.md", md([["C-1", "ut", "B1", "", "", "", "a", "1", "d", "none: x", "N"], ["C-2", "ut", "B1", "", "", "C-1", "b", "2", "d", "none: x", "N"], ["C-3", "ut", "B1", "", "", "C-2", "c", "3", "d", "none: x", "N"]]));
  j("rb/chain.json", { tests: [{ name: "[C-1] a", status: "failed", error: "x" }] });
  r = run("core/collect.mjs", ["--cases", chain, "--out", path.join(T, "rb/chain-results.json"), "--e2e-json", path.join(T, "rb/chain.json")]);
  const C = r.code === 0 ? readJson(path.join(T, "rb/chain-results.json")) : { tests: [] };
  check("collect: Pre blocking follows the chain", ["C-2", "C-3"].every((id) => C.tests.some((x) => x.ids.includes(id) && x.status === "blocked")), r.all);
  r = run("core/render-html.mjs", [path.join(T, "rb/results.json"), "--out", path.join(T, "rb/report")]);
  // render-html exits non-zero when cases failed; the file is still written
  const html = existsSync(path.join(T, "rb/report")) ? readFileSync(path.join(T, "rb/report", readdirSync(path.join(T, "rb/report"))[0]), "utf8") : "";
  check("report: manual run listed", /Manual runs<\/td><td>filled\.xlsx \(Lan\)/.test(html), r.all);
  r = run("core/cases-summary.mjs", [good]);
  check("cases-summary: type / priority / Pre mix", /By type: positive 2, edge 1, negative 1 · by priority: high 2, medium 1, low 1 · with Pre: 2/.test(r.out), r.out);
}

// ── next (what to read now) + self-contained rows ─────────────────────────────
section("next / readable rows");
{
  const lint = run("core/lint-cases.mjs", [w("wi/codes.md", casesMd([["A-001", "e2e", "E1 New", "s", "3 rows", "R12", "record R1 open", "N"], ["A-002", "e2e", "E1 New", "s", "3 rows", "S2 › Items!C14", "record R1 open", "N"], ["A-003", "e2e", "E1 New", "s", "3 rows", "SRS_v3.xlsx › Items!C14 (R12)", "record R1 open", "N"]]))]);
  check("lint: Source that is only a code warns, file name + code in brackets passes", /A-001: Source "R12" is only a code/.test(lint.out) && /A-002: Source "S2 › Items!C14" is only a code/.test(lint.out) && !/A-003: Source/.test(lint.out), lint.out);

  const P = path.join(T, "wi"); // project root: wi/test-work/demo
  const rows = [["A-001", "e2e", "E1 New", "s", "3 rows", "SRS.xlsx › S!A1", "record R1 open", "Y"], ["A-002", "ut", "B1 empty", "s", "error", "assumption", "none: pure", "N"]];
  w("wi/test-work/demo/cases.md", casesMd(rows, { approved: false }));
  w("wi/test-work/demo/diff.md", ["# Spec vs code", "", table(["Diff", "Area", "Spec says", "Source", "Code does", "file:line", "Cases", "Decision"], [["D1", "Save", "x", "SRS.xlsx › S!A1", "y", "a.js:1", "A-001", "open"], ["D2", "a", "x", "SRS.xlsx › S!A2", "z", "a.js:2", "A-002", "fix code — Lan 2026-11-10"]])].join("\n"));
  w("wi/test-work/demo/spec-sources.md", ["# Sources", "## Questions for BA", table(["Q", "Question", "Cases blocked", "Asked to", "Date", "Answer"], [["Q1", "limit?", "A-002", "BA", "2026-11-10", ""], ["Q2", "x?", "", "BA", "2026-11-10", "yes"]])].join("\n"));
  w("wi/test-work/demo/data-plan.md", ["# Data plan", "", table(["Need", "Concrete data (key / state / file)", "How to get", "Found / created by", "Cases", "Status"], [["N1", "order O-1 open", "exists", "search", "A-001", "ready"], ["N2", "admin account", "user-provides", "—", "A-001", "waiting"]])].join("\n"));
  let r = run("core/next.mjs", [], { cwd: P });
  check("next: no argument → the only scope; stage approve", r.code === 0 && /^\[demo\] Giai đoạn: DUYỆT CASE/.test(r.out), r.all);
  check("next: approve — important rows, cases waiting on a question (with its text), data, open diff", /xem trước \(ưu tiên cao \/ ghi dữ liệu\): A-001/.test(r.out) && /chờ Q1 "limit\?": A-002/.test(r.out) && /N2 admin account — waiting, case A-001/.test(r.out) && /D1 Save: spec "x" ↔ code "y"/.test(r.out) && !/Q2/.test(r.out), r.out);
  check("next: paths relative to where it runs, no extra command to run", /^\s+\d\. test-work\/demo\/cases\.md$/m.test(r.out) && !/cases-summary\.mjs/.test(r.out), r.out);
  check("next: writes no file", readdirSync(path.join(P, "test-work/demo")).sort().join() === "cases.md,data-plan.md,diff.md,spec-sources.md");
  w("wi/test-work/demo/cases.md", casesMd(rows));
  r = run("core/next.mjs", ["demo"], { cwd: P });
  check("next: approved, no run → write / run stage with missing data", /VIẾT \/ CHẠY TEST/.test(r.out) && /còn thiếu: N2 \(case A-001\)/.test(r.out), r.out);
  j("wi/e2e.json", { tests: [{ name: "[A-001] x", status: "failed", error: "x" }] });
  run("core/collect.mjs", ["--cases", path.join(P, "test-work/demo/cases.md"), "--out", path.join(P, "test-work/demo/results.json"), "--e2e-json", path.join(P, "e2e.json")]);
  w("wi/test-work/demo/data-created.md", ["# Data created", "", table(["Case", "When", "Environment", "Record (key)", "Action", "How to delete / revert", "Status"], [["A-001", "t", "dev", "O-9", "create", "UI delete", "left"]])].join("\n"));
  r = run("core/next.mjs", [path.join(P, "test-work/demo")]);
  check("next: after run — failed case, row in cases.md, verdict missing, diff reproduced, cleanup", /SAU KHI CHẠY — 0 pass · 1 fail/.test(r.out) && /case fail: A-001/.test(r.out) && /chưa có kết luận: A-001/.test(r.out) && /tái hiện: D1/.test(r.out) && /1 bản ghi test còn/.test(r.out) && /chưa có kết quả: A-002/.test(r.out), r.out);
  r = run("core/lint-cases.mjs", [path.join(P, "test-work/demo/cases.md")]);
  check("lint-cases prints what to read next for its work folder", /── Cần đọc tiếp/.test(r.out) && /\[demo\] Giai đoạn:/.test(r.out), r.out);
  r = run("core/lint-cases.mjs", [path.join(P, "test-work/demo/cases.md"), "--no-next"]);
  check("--no-next turns it off", !/Cần đọc tiếp/.test(r.out), r.out);
  r = run("core/render-html.mjs", [path.join(P, "test-work/demo/results.json"), "--out", path.join(P, "test-work/demo/report")]);
  check("render-html prints what to read after the run", /── Cần đọc tiếp/.test(r.out) && /SAU KHI CHẠY/.test(r.out), r.out);
  w("wi/test-work/other/cases.md", "# Cases — other\n");
  r = run("core/next.mjs", [], { cwd: P });
  check("next: several scopes → asks which", /Có 2 scope/.test(r.out) && /demo, other/.test(r.out), r.out);
  check("next: unknown scope → exit 2", run("core/next.mjs", ["nope"], { cwd: P }).code === 2);
}

// ── triage ────────────────────────────────────────────────────────────────────
section("triage");
{
  const D = path.join(T, "tri");
  mkdirSync(D, { recursive: true });
  writeFileSync(path.join(D, "cases.md"), casesMd([["F-1", "e2e", "E1", "s", "msg A", "SRS 1", "none", "N"], ["F-2", "e2e", "E1", "s", "msg B", "SRS 1", "none", "N"]]));
  writeFileSync(path.join(D, "e2e.json"), JSON.stringify({ tests: [{ name: "[F-1] a", status: "failed", error: "x" }, { name: "[F-2] b", status: "failed", error: "y" }] }));
  writeFileSync(path.join(D, "triage.md"), "| Case | Test | Verdict | By + date | Reason / source | Action |\n|---|---|---|---|---|---|\n| F-1 | [F-1] a | bug | Tester 2026-11-01 | old | |\n| F-1 | [F-1] a | app-correct | Tester 2026-11-04 | BE right per BA | fix Expected |\n");
  const c = run("core/collect.mjs", ["--cases", path.join(D, "cases.md"), "--out", path.join(D, "results.json"), "--e2e-json", path.join(D, "e2e.json")]);
  const res = existsSync(path.join(D, "results.json")) ? readJson(path.join(D, "results.json")) : {};
  check("collect reads triage.md next to cases.md", (res.triage || []).length === 2, c.all);
  run("core/render-html.mjs", [path.join(D, "results.json"), "--out", path.join(D, "report")]);
  const html = existsSync(path.join(D, "report")) ? readdirSync(path.join(D, "report")).map((f) => readFileSync(path.join(D, "report", f), "utf8")).join("") : "";
  check("report: latest verdict next to the failure, not-reviewed count", /reviewed: <b>app correct — expected to fix<\/b> · Tester 2026-11-04 · BE right per BA → fix Expected/.test(html) && !/bug confirmed/.test(html) && /1 fail not reviewed/.test(html) && /reviewed 1 \/ not reviewed 1/.test(html), html.slice(html.indexOf("Needs attention"), html.indexOf("Needs attention") + 1500));
  const ex = run("core/export-cases.mjs", [path.join(D, "results.json"), "--out", path.join(D, "x")]);
  check("export-cases: verdict in evidence", ex.code === 0, ex.all);
}

// ── cases-summary ─────────────────────────────────────────────────────────────
section("cases-summary");
{
  const D = path.join(T, "csum");
  mkdirSync(D, { recursive: true });
  writeFileSync(path.join(D, "flows.md"), ["# Flows — S", "## Entry points", "| Ref | Kind | Name | file:line | In spec? |", "|---|---|---|---|---|",
    "| E1 | button | Search | a.vue:1 | yes |", "| E2 | button | Export | a.vue:9 | yes |", "| E3 | button | Print | a.vue:12 | no |",
    "## Branches", "| Ref | Under | Condition | Result / error code | file:line | In spec? |", "|---|---|---|---|---|---|",
    "| B1 | E1 | date empty | ERR-1 | a.vue:3 | yes |", "| B2 | E1 | > 3 months | ERR-2 | a.vue:4 | yes |", "| B3 | B2 | exactly 3 months | ok | a.vue:5 | no |", ""].join("\n"));
  writeFileSync(path.join(D, "cases.md"), casesMd([["C-1", "e2e", "E1/B1", "s", "ERR-1", "SRS 1", "none", "N"], ["C-2", "api", "B3", "s", "ok", "SRS 2", "none", "N"], ["C-3", "e2e", "setup", "s", "x", "SRS 3", "none", "Y"]], { extra: "\n## Not covered\n\n| Flow ref | Reason |\n|---|---|\n| E3 | print is out of scope |" }));
  const r = run("core/cases-summary.mjs", [path.join(D, "cases.md")]);
  check("cases-summary: groups branches under their entry point (also nested)", /\| ◐ \| \*\*E1\*\* Search \| 3\/4 \| 2: C-1, C-2 \| e2e 1, api 1 \| B2 \|/.test(r.out), r.all);
  check("cases-summary: gaps = no case and not in Not covered", /\| ✗ \| \*\*E2\*\* Export/.test(r.out) && /\| ✓ \| \*\*E3\*\*[^\n]*\(1 out of scope\)/.test(r.out) && /gaps: 2\*\*/.test(r.out), r.out);
  check("cases-summary: cases without a flow ref listed", /- C-3 — setup/.test(r.out) && /Cases: \*\*3\*\* \(e2e 2, api 1\) · writes data: 1/.test(r.out), r.out);
}

// ── account ───────────────────────────────────────────────────────────────────
section("account");
{
  const home = path.join(os.tmpdir(), `vt-acc-${process.pid}`);
  const f = path.join(home, "acc.sh");
  let r = run("core/account.mjs", [f, "--vars", "APP_USER,APP_PW"]);
  check("account: creates file mode 600 with empty exports, exit 1", r.code === 1 && existsSync(f) && (statSync(f).mode & 0o777) === 0o600 && readFileSync(f, "utf8").includes("export APP_PW=\n"), r.all);
  writeFileSync(f, "export APP_USER=alice\nexport APP_PW=\n", { mode: 0o600 });
  r = run("core/account.mjs", [f, "--vars", "APP_USER,APP_PW,APP_X"]);
  check("account: reports empty / missing, never prints values", r.code === 1 && /empty: APP_PW/.test(r.out) && /missing: APP_X/.test(r.out) && !r.all.includes("alice"), r.all);
  writeFileSync(f, "export APP_USER=alice\nexport APP_PW='p w'\n", { mode: 0o600 });
  r = run("core/account.mjs", [f, "--vars", "APP_USER,APP_PW"]);
  check("account: all set → exit 0", r.code === 0 && !r.all.includes("p w"), r.all);
  check("account: refuses a path inside the current folder", run("core/account.mjs", [path.join(T, "acc.sh"), "--vars", "A"]).code === 2);
  rmSync(home, { recursive: true, force: true });
}

// ── help ──────────────────────────────────────────────────────────────────────
section("review-tests");
{
  w("rt/js/fee.test.js", [
    'import { calcFee, total } from "../src/fee";',
    'import { api } from "../src/api";',
    '/* it("in a comment", () => {}) */',
    'describe("[A-004] group", () => {',
    '  it("inner", () => { expect(calcFee(2)).toBe(3000); });',
    "});",
    'it("[A-001] fee for 10 items", () => { expect(calcFee(10)).toBe(15000); });',
    'it("recomputed", () => { expect(calcFee(5)).toBe(calcFee(5)); });',
    'it("via import", () => { const r = total(3); expect(r).toBe(calcFee(3) * 1); });',
    'it("weak", () => { expect(calcFee(1)).toBeDefined(); });',
    'it("calls", () => { expect(api.post).toHaveBeenCalledWith("/x"); });',
    'it("none", () => { calcFee(1); });',
    'it.skip("[A-002] later", () => { expect(calcFee(0)).toBe(0); });',
    'it("swallow", () => { try { expect(calcFee(-1)).toBe(0); } catch (e) { console.log(e); } });',
    'it("[A-003] via helper", () => { assertFee(1, 2); });',
    'test("[X-9] stray", async () => { await expect(page.getByText("ok")).toBeVisible(); });',
    "",
  ].join("\n"));
  w("rt/js/api.test.js", 'jest.mock("../src/api");\nit("[A-005] mocked", () => { expect(get(1)).toBe(2); });\n');
  w("rt/java/FeeServiceTest.java", [
    "class FeeServiceTest {",
    "  @Mock FeeService feeService;",
    '  @Test @DisplayName("[B-001] fee 10") void fee10() { assertEquals(15000, service.calc(10)); }',
    "  @Test void ORD_031_dup() { assertEquals(service.calc(2), service.calc(2)); }",
    "  @Test void notNull() { assertNotNull(service.calc(1)); }",
    "  @Test void calls() { verify(repo).save(any()); }",
    "  @Disabled @Test void off() { assertEquals(1, service.calc(0)); }",
    "  @Test(expected = IllegalArgumentException.class) public void neg() { service.calc(-1); }",
    '  @Test void tryFail() { try { service.calc(-1); fail("x"); } catch (IllegalArgumentException e) { } }',
    "  @Test void ok() throws Exception { mvc.perform(get(\"/x\")).andExpect(status().isOk()); }",
    "}",
    "",
  ].join("\n"));
  w("rt/notes.py", "def test_x(): pass\n");
  const cases = w("rt/cases.md", casesMd([
    ["A-001", "ut", "B1", "fee(10)", "15000", "SRS 1", "none needed", "N"],
    ["A-004", "ut", "B1", "fee(2)", "3000", "SRS 1", "none needed", "N"],
    ["A-007", "ut", "B2", "fee(0)", "0", "SRS 2", "none needed", "N"],
    ["ORD-031 / ORD_031", "ut", "B3", "dup", "ERR-102", "SRS 3", "none needed", "N"],
    ["B-001", "ut", "B4", "fee(10)", "15000", "SRS 4", "none needed", "N"],
  ]));
  const out = path.join(T, "rt/out/existing-tests.md");
  const r = run("core/review-tests.mjs", ["rt/js", "rt/java", "rt/notes.py", "--cases", cases, "--out", out]);
  const md = existsSync(out) ? readFileSync(out, "utf8") : "";
  const row = (name) => md.split("\n").find((l) => l.startsWith("| T") && l.includes(`| ${name} |`)) || "";
  check("review-tests: errors → exit 1, summary line", r.code === 1 && /3 files, 20 tests/.test(r.out), r.all);
  check("review-tests: test inside a comment is not counted, describe tag inherited", !md.includes("in a comment") && /\| \[A-004\] group › inner \|.*\| A-004 \|/.test(md), md);
  check("review-tests: tagged value check has no finding", /\| \[A-001\] fee for 10 items \|[^|]*\| A-001 \| ✓ toBe\(15000\) \| — \| A-001 \|/.test(md), row("[A-001] fee for 10 items"));
  check("review-tests: tautology (same call, imported subject)", /error tautology/.test(row("recomputed")) && /computed by calcFee from the code under test/.test(row("via import")), md);
  check("review-tests: weak / calls-only / no-assert / swallowed / skipped", /warn weak-assert/.test(row("weak")) && /warn calls-only/.test(row("calls")) && /error no-assert/.test(row("none")) && /error swallowed/.test(row("swallow")) && /warn skipped/.test(row("[A-002] later")), md);
  check("review-tests: assertion helper is info, not no-assert", /info via-helper: .*assertFee/.test(row("[A-003] via helper")) && !/no-assert/.test(row("[A-003] via helper")), row("[A-003] via helper"));
  check("review-tests: mocked subject reported once per file", (r.out.match(/mocked-subject/g) || []).length === 2 && /api\.test\.js:1 .*\.\.\/src\/api/.test(r.out) && /FeeServiceTest\.java:2 .*FeeService/.test(r.out) && !/mocked-subject/.test(row("[A-001] fee for 10 items")), r.out);
  check("review-tests: Java weak / calls / tautology / skipped / expected-exception", /weak-assert/.test(row("notNull")) && /FeeServiceTest\.java:\d+ \|.*calls-only/.test(md.split("\n").filter((l) => l.includes("| calls |"))[1] || "") &&/tautology/.test(row("ORD_031_dup")) && /skipped/.test(row("off")) && /\| — \|/.test(row("neg")) && /\| — \|/.test(row("tryFail")) && /weak-assert/.test(row("ok")), md);
  check("review-tests: Java method-name alias maps to case", /\| ORD_031_dup \|.*\| ORD-031 \|/.test(md), row("ORD_031_dup"));
  check("review-tests: cases without a test, tags not in cases.md, unsupported files", /## Cases without a tagged test[\s\S]*\| A-007 \|/.test(md) && /`X-9`/.test(md) && /`A-005`/.test(md) && /notes\.py — language not supported/.test(md), md);
  const clean = w("rt/clean/sum.test.js", 'it("[S-1] sums", () => { expect(sum(1, 2)).toBe(3); });\n');
  const r2 = run("core/review-tests.mjs", [clean]);
  check("review-tests: clean file exits 0 without --out", r2.code === 0 && /1 files, 1 tests, 0 errors/.test(r2.out), r2.all);
  check("review-tests: no args → exit 2", run("core/review-tests.mjs", []).code === 2);
}

section("help");
{
  const h = run("core/help.mjs");
  const missing = ["core", "kit"].flatMap((d) => readdirSync(path.join(PLUGIN, d)).filter((f) => /\.(mjs|cjs)$/.test(f)).map((f) => f.replace(/\.(mjs|cjs)$/, "")))
    .filter((n) => !h.out.includes(n));
  check("help lists every core/ and kit/ script", h.code === 0 && !missing.length, `missing: ${missing.join(", ")}`);
  const f = run("core/help.mjs", ["api"]);
  check("help <word> filters", /api-kit/.test(f.out) && !/read-spec/.test(f.out), f.out);
  check("commands/help.md runs core/help.mjs", /core\/help\.mjs/.test(readFileSync(path.join(PLUGIN, "commands/help.md"), "utf8")));
}

// ── node --check every script ─────────────────────────────────────────────────
section("syntax");
for (const dir of ["core", "kit", "hooks"]) {
  for (const f of readdirSync(path.join(PLUGIN, dir)).filter((x) => x.endsWith(".mjs"))) {
    const r = spawnSync(process.execPath, ["--check", path.join(PLUGIN, dir, f)], { encoding: "utf8" });
    check(`node --check ${dir}/${f}`, r.status === 0, r.stderr);
  }
}
check("templates/test.config.json is valid JSON", (() => {
  try {
    return !!readJson(path.join(PLUGIN, "templates/test.config.json")).specPaths;
  } catch {
    return false;
  }
})());

if (!fail) rmSync(T, { recursive: true, force: true });
else console.log(`\nfixtures kept in ${T}`);
console.log(`\n[vuong-test selftest] ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
