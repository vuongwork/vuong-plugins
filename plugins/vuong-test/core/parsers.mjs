// Parsers for cases.md and test result formats. No dependencies (Node >= 18).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    // optional columns: Type (positive/negative/edge/security/regression), Priority (high/medium/low),
    // Pre (IDs that must pass first; a case whose Pre failed is reported BLOCKED)
    type: r.type || "",
    priority: r.priority || "",
    pre: (r.pre ?? r["depends on"] ?? "").split(/[,;\s]+/).map((x) => x.replace(/`/g, "").trim()).filter((x) => x && x !== "—" && x !== "-"),
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
    // optional header lines used by the manual runbook (manual-runbook.mjs)
    build: headerField(md, "Build"),
    runOrder: headerField(md, "Run order"),
    before: headerField(md, "Before you start"),
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

// ── manual runbook (manual-runbook.mjs writes it, a person fills it, collect.mjs --manual reads it) ──
export const RUNBOOK = {
  en: {
    guide: "Guide", cases: "Test cases", summary: "Summary",
    cols: ["ID", "Group", "Flow", "Type", "Priority", "Pre", "Steps", "Data / before", "Expected", "Actual result", "Status ▼", "Bug / notes"],
    status: { notrun: "Not run", passed: "Pass", failed: "Fail", blocked: "Blocked", skipped: "Skip" },
    priority: { high: "High", medium: "Medium", low: "Low" },
    tester: "Tester", date: "Date", device: "Device", os: "OS version",
  },
  vi: {
    guide: "Hướng dẫn", cases: "Test cases", summary: "Tổng hợp",
    cols: ["ID", "Nhóm", "Luồng", "Loại", "Ưu tiên", "Cần pass trước", "Các bước thực hiện", "Dữ liệu / chuẩn bị", "Kết quả mong đợi", "Kết quả thực tế", "Trạng thái ▼", "Mã lỗi / Ghi chú"],
    status: { notrun: "Chưa test", passed: "Pass", failed: "Fail", blocked: "Blocked", skipped: "Skip" },
    priority: { high: "Cao", medium: "TB", low: "Thấp" },
    tester: "Người test", date: "Ngày test", device: "Thiết bị", os: "Phiên bản hệ điều hành",
  },
};

/**
 * A filled runbook xlsx → { tester, date, device, os, rows: [{ id, status (passed/failed/blocked/skipped/notrun), actual, notes, sheetRow }] }.
 * Finds the sheet whose row 1 starts with "ID" and has a Status column (English or Vietnamese labels).
 * `readZip`, `sheetList`, `sheetCells` come from ooxml.mjs (passed in to keep this file free of the zip code).
 */
export function parseRunbook(buf, { readZip, sheetList, sheetCells, sharedStrings }) {
  const zip = readZip(buf);
  const shared = sharedStrings(zip);
  const sheets = sheetList(zip).map((s) => ({ ...s, cells: sheetCells(zip, s.part, shared) }));
  const labels = Object.values(RUNBOOK);
  const statusOf = new Map();
  for (const L of labels) for (const [k, v] of Object.entries(L.status)) statusOf.set(v.toLowerCase(), k);
  const isStatusHead = (t) => labels.some((L) => t === L.cols[10] || t === L.cols[10].replace(/\s*▼$/, ""));
  const tab = sheets.find((s) => s.cells.get("A1") === "ID" && [...s.cells].some(([ref, t]) => /^[A-Z]+1$/.test(ref) && isStatusHead(t)));
  if (!tab) throw new Error("no runbook sheet found (row 1 must start with ID and have a Status column)");
  const head = new Map([...tab.cells].filter(([ref]) => /^[A-Z]+1$/.test(ref)).map(([ref, t]) => [t, ref.replace(/1$/, "")]));
  const colOf = (i) => labels.map((L) => head.get(L.cols[i]) || head.get(L.cols[i].replace(/\s*▼$/, ""))).find(Boolean);
  const C = { status: colOf(10), actual: colOf(9), notes: colOf(11) };
  const rows = [];
  const maxRow = Math.max(1, ...[...tab.cells.keys()].map((r) => Number(r.replace(/^[A-Z]+/, ""))));
  for (let n = 2; n <= maxRow; n++) {
    const id = tab.cells.get(`A${n}`);
    if (!id) continue;
    const raw = (tab.cells.get(`${C.status}${n}`) || "").trim();
    rows.push({ id, status: statusOf.get(raw.toLowerCase()) || (raw ? "unknown:" + raw : "notrun"), actual: C.actual ? tab.cells.get(`${C.actual}${n}`) || "" : "", notes: C.notes ? tab.cells.get(`${C.notes}${n}`) || "" : "", sheetRow: n });
  }
  // tester / date / device from the guide sheet (label in column A, value in B)
  const info = {};
  for (const s of sheets) {
    if (s === tab) continue;
    for (const [ref, t] of s.cells) {
      const m = /^A(\d+)$/.exec(ref);
      if (!m) continue;
      for (const key of ["tester", "date", "device", "os"]) if (labels.some((L) => L[key] === t)) info[key] = s.cells.get(`B${m[1]}`) || "";
    }
  }
  return { ...info, rows };
}

/**
 * Print "what to read now" (next.mjs) for the work folder W, at the end of a step's script (lint-cases, render-html).
 * Only when W holds a cases.md; `--no-next` in argv turns it off (CI logs, scripted use).
 */
export function printNext(W, argv = []) {
  if (argv.includes("--no-next") || !existsSync(path.join(W, "cases.md"))) return;
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "next.mjs");
  const r = spawnSync(process.execPath, [script, W], { encoding: "utf8" });
  if (r.stdout?.trim()) console.log(`\n── Cần đọc tiếp (/vuong-test:next) ──\n${r.stdout.trimEnd()}`);
}
