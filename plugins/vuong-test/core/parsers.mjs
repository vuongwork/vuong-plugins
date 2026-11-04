// Parsers for cases.md and test result formats. No dependencies (Node >= 18).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const unxml = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unxml(m[2]);
  return out;
};

/** All `[ID]` tags in a test name. IDs: letters/digits/.-_ and spaces inside (e.g. "QA 1.2.3"). */
export const tagsOf = (name = "") =>
  [...name.matchAll(/\[([A-Za-z][\w.\- ]*?)\]/g)].map((m) => m[1].trim());

// ── cases.md ───────────────────────────────────────────────────────────────

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** Markdown tables whose first header cell equals `first` (case-insensitive). */
export function tablesStartingWith(md, first) {
  const lines = md.split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const head = splitRow(lines[i]);
    if (head[0].toLowerCase() !== first.toLowerCase()) continue;
    if (!/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) continue;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const cells = splitRow(lines[j]);
      const row = {};
      head.forEach((h, k) => (row[h.toLowerCase()] = cells[k] ?? ""));
      rows.push(row);
    }
    tables.push({ head, rows, line: i + 1 });
    i = j;
  }
  return tables;
}

const headerField = (md, label) => {
  const m = md.match(new RegExp(`${label}\\s*:\\s*([^·\\n]*)`, "i"));
  return m ? m[1].trim() : "";
};

export function parseCases(file) {
  const md = readFileSync(file, "utf8");
  const title = (md.match(/^#\s+(.+)$/m) || [, ""])[1].replace(/^Cases\s*[—-]\s*/i, "");
  const caseTable = tablesStartingWith(md, "ID")[0];
  const cases = (caseTable?.rows || []).map((r) => ({
    id: r.id,
    layer: r.layer || "",
    flow: r.flow || "",
    steps: r.steps || "",
    expected: r.expected || "",
    source: r.source || "",
    data: r.data || "",
    writes: r.writes || "",
    origin: r.origin || "",
  }));
  // "Inventory ref" / "Inventory:" = names before v0.6.0, still read
  const ncTable = tablesStartingWith(md, "Flow ref")[0] || tablesStartingWith(md, "Inventory ref")[0];
  const notCovered = (ncTable?.rows || []).map((r) => ({
    ref: r["flow ref"] ?? r["inventory ref"],
    reason: r.reason || "",
  }));
  return {
    scope: title,
    approvedBy: headerField(md, "Approved by"),
    approvedDate: headerField(md, "Date"),
    environment: headerField(md, "Environment"),
    writesData: headerField(md, "Writes data"),
    flows: headerField(md, "Flows") || headerField(md, "Inventory"),
    cases,
    notCovered,
    caseTableLine: caseTable?.line ?? null,
  };
}

/** triage.md → [{case, test, verdict, by, reason, action}] — the user's verdict on a failed test. Later rows win. */
export const VERDICTS = ["app-correct", "test-wrong", "bug", "spec-unclear"];
export function parseTriage(file) {
  const t = tablesStartingWith(readFileSync(file, "utf8"), "Case")[0];
  return (t?.rows || [])
    .map((r) => ({ case: r.case, test: r.test || "", verdict: (r.verdict || "").toLowerCase().replace(/`/g, "").trim(), by: r["by + date"] || r.by || "", reason: r["reason / source"] || r.reason || "", action: r.action || "" }))
    .filter((r) => r.case);
}

/** diff.md → [{id, area, spec, source, code, where, cases:[ids], decision}] (spec vs code differences). */
export function parseDiff(file) {
  const md = readFileSync(file, "utf8");
  return (tablesStartingWith(md, "Diff")[0]?.rows || []).map((r) => ({
    id: r.diff,
    area: r.area || "",
    spec: r["spec says"] || "",
    source: r.source || "",
    code: r["code does"] || "",
    where: r["file:line"] || "",
    cases: (r.cases || "").split(/[,\s]+/).filter(Boolean),
    decision: r.decision || "",
  }));
}

/** data-created.md → [{case, when, environment, record, action, cleanup, status}] (test data to clean up). */
export function parseDataCreated(file) {
  const md = readFileSync(file, "utf8");
  return (tablesStartingWith(md, "Case")[0]?.rows || []).map((r) => ({
    case: r.case,
    when: r.when || "",
    environment: r.environment || "",
    record: r["record (key)"] || r.record || "",
    action: r.action || "",
    cleanup: r["how to delete / revert"] || "",
    status: r.status || "left",
  }));
}

// ── test results → [{file, name, ids, status, duration(ms), error, stack, shots}] ──

const listFiles = (p, ext) => {
  if (!existsSync(p)) throw new Error(`not found: ${p}`);
  if (statSync(p).isFile()) return [p];
  return readdirSync(p, { recursive: true })
    .map((f) => path.join(p, String(f)))
    .filter((f) => f.endsWith(ext) && statSync(f).isFile());
};

/** JUnit XML (Surefire, Gradle, jest-junit, vitest, pytest, go-junit-report, Playwright, Newman...). */
export function parseJunit(p, stack = "junit") {
  const tests = [];
  for (const f of listFiles(p, ".xml")) {
    const xml = readFileSync(f, "utf8");
    if (!/<testsuites?[\s>]/.test(xml)) continue;
    const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
    for (const m of xml.matchAll(re)) {
      const a = attrs(m[1]);
      const body = m[3] || "";
      const fail = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
      const skipped = /<skipped\b/.test(body);
      const name = a.name || "";
      tests.push({
        file: a.classname || a.file || path.basename(f),
        name,
        ids: tagsOf(name),
        status: fail ? "failed" : skipped ? "skipped" : "passed",
        duration: Math.round(Number(a.time || 0) * 1000),
        error: fail ? unxml([attrs(fail[2]).message, fail[3]].filter(Boolean).join("\n")).trim() : null,
        stack,
        shots: [],
      });
    }
  }
  return tests;
}

/** Jest `--json` output. Uses fullName (describe + it) so tags on describe count too. */
export function parseJestJson(file, root = process.cwd()) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const tests = [];
  for (const suite of j.testResults ?? []) {
    for (const a of suite.assertionResults ?? []) {
      const status = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped";
      const name = a.fullName ?? a.title;
      tests.push({
        file: path.relative(root, suite.name) || suite.name,
        name,
        ids: tagsOf([...(a.ancestorTitles || []), a.title].join(" ")),
        status,
        duration: a.duration ?? 0,
        error: status === "failed" ? a.failureMessages?.[0] ?? "Unknown error" : null,
        stack: "jest",
        shots: [],
      });
    }
  }
  return tests;
}

/** Plugin E2E kit output: {tests:[{file,name,status,duration,error,shots}]} or a bare array. */
export function parseE2eJson(file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  return (Array.isArray(j) ? j : j.tests || []).map((t) => ({
    file: t.file || path.basename(file),
    name: t.name,
    ids: t.ids || tagsOf(t.name),
    status: ["passed", "failed", "skipped", "blocked"].includes(t.status) ? t.status : "failed",
    duration: t.duration ?? 0,
    error: t.error ?? null,
    note: t.note ?? null,
    writesDeclared: !!t.writesDeclared,
    aborted: t.aborted || [],
    writes: t.writes || [],
    stack: t.stack || "playwright",
    shots: t.shots || [],
    exchanges: t.exchanges || [],
    dataCreated: t.dataCreated || [],
  }));
}

/** results.json → cases with status (passed / failed / blocked / notrun) and their tests. */
export function casesWithStatus(R) {
  const testsById = {};
  for (const t of R.tests) for (const id of t.ids) (testsById[id] ||= []).push(t);
  const status = (ts) => {
    // not run is not blocked: an assumption case is only blocked when its test says so
    if (!ts.length) return "notrun";
    if (ts.some((t) => t.status === "failed")) return "failed";
    if (ts.some((t) => t.status === "blocked")) return "blocked";
    if (ts.every((t) => t.status === "skipped")) return "notrun";
    return "passed";
  };
  return R.cases.map((c) => {
    const tests = testsById[c.id] || [];
    return { ...c, status: status(tests), tests };
  });
}

/** test.config.json caseTemplates entry for a tester's file: by --template name, else by `match` glob on the file name, else the only one. */
export function pickTemplate(cfg, fileName, wanted) {
  const list = cfg.caseTemplates || [];
  const glob = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
  if (wanted) return list.find((t) => t.name === wanted) || null;
  return list.find((t) => t.match && glob(t.match).test(fileName)) || (list.length === 1 ? list[0] : null);
}
