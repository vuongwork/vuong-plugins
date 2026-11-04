#!/usr/bin/env node
// results.json → one self-contained HTML report (screenshots embedded) (layout of a standard UT report).
//
//   node render-html.mjs W/results.json --out W/report/ [--name <label>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { casesWithStatus } from "./parsers.mjs";

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out" && argv[argv.indexOf(a) - 1] !== "--name");
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : path.dirname(input || ".");
const label = argv.includes("--name") ? argv[argv.indexOf("--name") + 1] : "";
if (!input) {
  console.error("usage: render-html.mjs <results.json> [--out <dir>] [--name <label>]");
  process.exit(2);
}
const R = JSON.parse(readFileSync(input, "utf8"));
const baseDir = path.dirname(path.resolve(input));

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const ms = (n) => `${Number(n || 0).toFixed(0)} ms`;
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(2)}%`);

// ── case status from tagged tests ──
const cases = casesWithStatus(R);
const caseIds = new Set(R.cases.map((c) => c.id));
const untagged = R.tests.filter((t) => !t.ids.length);
const unknownTag = R.tests.filter((t) => t.ids.length && !t.ids.some((id) => caseIds.has(id)));
const count = (arr, k) => arr.filter((x) => x.status === k).length;
const tSum = { passed: count(R.tests, "passed"), failed: count(R.tests, "failed"), skipped: count(R.tests, "skipped") };
const cSum = Object.fromEntries(["passed", "failed", "blocked", "notrun"].map((k) => [k, count(cases, k)]));

// user's verdict on failed tests (W/triage.md); latest row per case wins
const TRIAGE = { "app-correct": "app correct — expected to fix", "test-wrong": "test wrong — test to fix", bug: "bug confirmed", "spec-unclear": "spec unclear — asked BA" };
const triageOf = Object.fromEntries((R.triage || []).map((t) => [t.case, t]));
const LABEL = { passed: "✓ PASS", failed: "✗ FAIL", skipped: "– SKIP", blocked: "■ BLOCKED", notrun: "○ NOT RUN" };

const img = (p) => {
  const f = path.isAbsolute(p) ? p : path.resolve(baseDir, p);
  if (!existsSync(f)) return `<div class="muted">missing screenshot ${esc(p)}</div>`;
  const ext = path.extname(f).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `<a class="shot"><img alt="${esc(path.basename(f))}" src="data:image/${ext};base64,${readFileSync(f).toString("base64")}"><span>${esc(path.basename(f))}</span></a>`;
};

const STYLE = `body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:24px;color:#1f2933;background:#fff}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}.muted{color:#7b8794;font-weight:normal}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.summary .box{padding:8px 14px;border-radius:8px;background:#f5f7fa;font-weight:600}.passed{color:#0a7a3b}.failed{color:#b91c1c}.skipped,.blocked{color:#8a6d00}.notrun{color:#7b8794}table{border-collapse:collapse;width:100%;font-size:13px}th{background:#eef2f7}th,td{border-bottom:1px solid #e4e7eb;padding:6px 8px;text-align:left;vertical-align:top}tr.file td{background:#eef2f7;font-weight:600}td.status{white-space:nowrap;font-weight:600}td.dur{white-space:nowrap;color:#7b8794}.err{color:#b91c1c;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}.err b{color:#52606d;font-weight:600}.note{color:#52606d;margin-top:4px}table.cov tr.total td{font-weight:700;background:#f5f7fa}.meta td:first-child{width:160px;color:#52606d}.warn{background:#fff8e1;border-left:4px solid #f0b400;padding:8px 12px;margin:8px 0}.shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.shot{display:flex;flex-direction:column;font-size:11px;color:#7b8794}.shot img{max-width:220px;border:1px solid #e4e7eb;cursor:zoom-in}.shot img:focus{max-width:none;position:fixed;inset:20px;margin:auto;max-height:calc(100vh - 40px);z-index:9;box-shadow:0 0 0 100vmax rgba(0,0,0,.6)}details summary{cursor:pointer;color:#52606d;margin:8px 0}.guard{color:#8a6d00;margin-top:4px;font-size:12px}.wrote{color:#1e40af;margin-top:4px;font-size:12px}code{font-size:11px;background:#f5f7fa;padding:1px 4px;border-radius:3px;margin-right:4px}pre{white-space:pre-wrap;background:#f5f7fa;padding:12px;border-radius:6px;font-size:12px}.calls table{font-size:12px}.calls td.u{word-break:break-all}.calls pre{margin:2px 0;padding:6px;max-height:160px;overflow:auto}.stats{border:1px solid #e4e7eb;border-radius:8px;margin:12px 0;overflow:hidden}.stat-row{display:flex;align-items:center;gap:16px;padding:10px 14px}.stat-row+.stat-row{border-top:1px solid #e4e7eb}.stat-label{width:230px;flex:none}.stat-label b{font-size:15px}.stat-label small{display:block;color:#7b8794;font-weight:normal;font-size:11px}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{padding:4px 10px;border-radius:999px;background:#f5f7fa;font-weight:600;font-size:13px;text-decoration:none}a.chip:hover{outline:2px solid currentColor}.chip.zero{opacity:.45}table.tests{table-layout:fixed}table.tests td{overflow-wrap:anywhere;word-break:break-word}table.tests pre{white-space:pre-wrap;overflow-wrap:anywhere}table.tests .calls td.u{word-break:break-all}table.tests .shots{display:grid;grid-template-columns:1fr 1fr;gap:6px}table.tests .shot{min-width:0}table.tests .shot img{width:100%;max-width:100%}table.tests .shot span{overflow-wrap:anywhere}.calls summary{margin:0}.triage{margin-top:4px;font-size:12px;font-weight:normal}.group-title{margin:16px 0 6px;font-weight:600}tr:target td,h2:target{background:#fff3c4}@media(max-width:700px){.stat-row{flex-direction:column;align-items:flex-start}.stat-label{width:auto}}`;

const m = R.meta;
const metaRows = [
  ["Scope", m.scope],
  ["Commit", m.commit],
  ["Environment", m.environment],
  ["Writes data", m.writesData],
  ["Approved by", [m.approvedBy, m.approvedDate].filter(Boolean).join(" · ")],
  ["Flows", m.flows ?? m.inventory],
  ["Generated", new Date(m.generatedAt).toLocaleString()],
]
  .map(([k, v]) => `<tr><td>${k}</td><td>${esc(v) || '<span class="muted">—</span>'}</td></tr>`)
  .join("");

const warnings = [
  !m.approvedBy || /^</.test(m.approvedBy) ? "cases.md has no approver — step 5 (approval) was not recorded." : "",
  untagged.length ? `${untagged.length} test(s) have no [ID] tag: their expected results are not traced to a case.` : "",
  unknownTag.length ? `${unknownTag.length} test(s) carry tags that are not in cases.md.` : "",
]
  .filter(Boolean)
  .map((w) => `<div class="warn">${esc(w)}</div>`)
  .join("");

const caseTable = cases
  .map(
    (c) =>
      `<tr id="c-${esc(c.id)}"><td><b>${esc(c.id)}</b></td><td>${esc(c.layer)}</td><td>${esc(c.flow)}</td><td>${esc(c.expected)}</td><td>${esc(c.source)}</td>` +
      `<td class="status ${c.status}">${LABEL[c.status]}${c.status === "failed" && triageOf[c.id] ? `<div class=\"triage skipped\">reviewed: ${esc(triageOf[c.id].verdict)}</div>` : ""}</td><td>${c.tests.length}</td></tr>`
  )
  .join("");

const notCovered = R.notCovered.length
  ? `<table><thead><tr><th>Flow ref</th><th>Reason</th></tr></thead><tbody>${R.notCovered
      .map((n) => `<tr><td>${esc(n.ref)}</td><td>${esc(n.reason)}</td></tr>`)
      .join("")}</tbody></table>`
  : '<p class="muted">None listed.</p>';

// spec vs code differences: a test of a listed case decides whether the difference is reproduced
const statusById = Object.fromEntries(cases.map((c) => [c.id, c.status]));
const DIFF_LABEL = { reproduced: "✗ reproduced", "not-reproduced": "✓ not reproduced", unverified: "○ unverified" };
const DIFF_CLS = { reproduced: "failed", "not-reproduced": "passed", unverified: "notrun" };
const diffs = (R.diff || []).map((d) => {
  const st = d.cases.map((id) => statusById[id]).filter(Boolean);
  const state = st.includes("failed") ? "reproduced" : st.length && st.every((s) => s === "passed") ? "not-reproduced" : "unverified";
  return { ...d, state };
});
const dSum = Object.fromEntries(Object.keys(DIFF_LABEL).map((k) => [k, diffs.filter((d) => d.state === k).length]));
const diffHtml = diffs.length
  ? `<p class="muted">Spec says one thing, code another. "reproduced" = a test of a listed case failed on it. Decide per row whether the code or the spec document changes.</p>` +
    `<table><thead><tr><th>Diff</th><th>Area</th><th>Spec says</th><th>Source</th><th>Code does</th><th>file:line</th><th>Cases</th><th>State</th><th>Decision</th></tr></thead><tbody>${diffs
      .map(
        (d) =>
          `<tr><td><b>${esc(d.id)}</b></td><td>${esc(d.area)}</td><td>${esc(d.spec)}</td><td>${esc(d.source)}</td><td>${esc(d.code)}</td><td>${esc(d.where)}</td><td>${esc(d.cases.join(", "))}</td>` +
          `<td class="status ${DIFF_CLS[d.state]}">${DIFF_LABEL[d.state]}</td><td>${esc(d.decision) || '<span class="muted">open</span>'}</td></tr>`
      )
      .join("")}</tbody></table>`
  : '<p class="muted">No diff.md given.</p>';
const assumptionCases = cases.filter((c) => /assumption/i.test(c.source)).length;

const anchor = (t) => `t-${(R.tests.indexOf(t) + 1)}`;
const errHtml = (e) =>
  esc(e)
    .split("\n")
    .map((l) => l.replace(/^(\s*)(Expected|Actual|Mong đợi|Thực tế|Check|Kiểm tra)\s*:/i, "$1<b>$2:</b>"))
    .join("\n");
const isErr = (x) => x.status >= 400 || x.status === 0;
const apiCell = (t) => {
  const xs = t.exchanges || [];
  if (!xs.length) return '<span class="muted">—</span>';
  const bad = xs.filter(isErr);
  return (
    (bad.length ? `<div class="err">${bad.slice(0, 3).map((x) => `${esc(x.method)} ${esc(String(x.url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, ""))} → ${esc(x.status || x.error)}`).join("\n")}${bad.length > 3 ? `\n… +${bad.length - 3}` : ""}</div>` : "") +
    `<details class="calls"><summary>${xs.length} call(s)${bad.length ? ` · <b class="failed">${bad.length} error</b>` : ""}</summary><table>${xs
      .map((x) => `<tr><td><code>${esc(x.method)}</code></td><td class="u">${esc(x.url)}</td><td class="status ${isErr(x) ? "failed" : "passed"}">${esc(x.status || x.error)}</td><td class="dur">${esc(x.ms)} ms</td></tr>` +
        (x.req || x.res ? `<tr><td></td><td colspan="3">${x.req ? `<pre>→ ${esc(x.req)}</pre>` : ""}${x.res ? `<pre>← ${esc(x.res)}</pre>` : ""}</td></tr>` : ""))
      .join("")}</table></details>`
  );
};
// evidence: the end shot and failure shots first (2 per row), the rest folded
const shotsCell = (t) => {
  if (!t.shots.length) return '<span class="muted">—</span>';
  const key = (p) => (/(fail|error|end)\.[a-z]+$/i.test(p) ? 0 : 1);
  const sorted = [...t.shots].sort((a, b) => key(a) - key(b));
  const head = sorted.slice(0, 2);
  const rest = sorted.slice(2);
  return `<div class="shots">${head.map(img).join("")}</div>` + (rest.length ? `<details><summary>+${rest.length} screenshot(s)</summary><div class="shots">${rest.map(img).join("")}</div></details>` : "");
};
const testCells = (t) =>
  `<td>${esc(t.name)}` +
  (t.note ? (String(t.note).length > 160 ? `<details class="note"><summary>${esc(String(t.note).slice(0, 120))}…</summary><pre>${esc(t.note)}</pre></details>` : `<div class="note">${esc(t.note)}</div>`) : "") +
  ((t.aborted || []).length ? `<div class="guard">write guard aborted ${t.aborted.length}: ${t.aborted.map((a) => `<code>${esc(a.method)} ${esc(a.url)}</code>`).join(" ")}</div>` : "") +
  ((t.writes || []).length
    ? `<div class="wrote">writes ${t.writes.length}: ${t.writes.map((w) => `<code>${esc(w.method)} ${esc(w.url)} → ${esc(w.status)}</code>`).join(" ")}</div>`
    : t.writesDeclared ? `<div class="wrote muted">declared writes:true, no write request sent</div>` : "") +
  (t.status === "failed" ? triageHtml(t.ids) : "") +
  `</td><td>${t.error ? `<div class="err">${errHtml(t.error)}</div>` : '<span class="muted">—</span>'}</td>` +
  `<td class="api">${apiCell(t)}</td>` +
  `<td class="ev">${shotsCell(t)}</td>`;
const triageHtml = (ids) =>
  ids
    .map((id) => triageOf[id])
    .filter(Boolean)
    .map((t) => `<div class="triage ${t.verdict === "bug" ? "failed" : "skipped"}">reviewed: <b>${esc(TRIAGE[t.verdict] || t.verdict)}</b> · ${esc(t.by)}${t.reason ? ` · ${esc(t.reason)}` : ""}${t.action ? ` → ${esc(t.action)}` : ""}</div>`)
    .join("");
const testHead = `<colgroup><col style="width:80px"><col style="width:24%"><col style="width:26%"><col style="width:22%"><col style="width:320px"><col style="width:80px"></colgroup><thead><tr><th>Status</th><th>Test</th><th>Error (expected / actual)</th><th>API calls</th><th>Evidence</th><th>Time</th></tr></thead>`;
const byFile = {};
for (const t of R.tests) (byFile[`${t.stack} · ${t.file}`] ||= []).push(t);
const testRows = Object.entries(byFile)
  .map(
    ([f, ts]) =>
      `<tr class="file"><td colspan="6">${esc(f)}</td></tr>` +
      ts.map((t) => `<tr id="${anchor(t)}"><td class="status ${t.status}">${LABEL[t.status]}</td>${testCells(t)}<td class="dur">${ms(t.duration)}</td></tr>`).join("")
  )
  .join("");
// "Needs attention": failed tests first, then blocked / not-run cases, one place to start from
const failedTests = R.tests.filter((t) => t.status === "failed");
const reviewed = cases.filter((c) => c.status === "failed" && triageOf[c.id]).length;
const attention =
  (failedTests.length
    ? `<div class="group-title failed" id="failed">✗ Failed — ${failedTests.length} test(s), ${cSum.failed} case(s) · reviewed ${reviewed} / not reviewed ${cSum.failed - reviewed}</div><table class="tests">${testHead}<tbody>${failedTests
        .map((t) => `<tr><td class="status failed"><a href="#${anchor(t)}">${LABEL.failed}</a></td>${testCells(t)}<td class="dur">${ms(t.duration)}</td></tr>`)
        .join("")}</tbody></table>`
    : "") +
  ["blocked", "notrun"]
    .map((k) => {
      const cs = cases.filter((c) => c.status === k);
      if (!cs.length) return "";
      return `<div class="group-title ${k}" id="${k}">${LABEL[k]} — ${cs.length} case(s)</div><table><thead><tr><th>ID</th><th>Flow</th><th>Expected</th><th>Reason / note</th></tr></thead><tbody>${cs
        .map((c) => `<tr><td><a href="#c-${esc(c.id)}"><b>${esc(c.id)}</b></a></td><td>${esc(c.flow)}</td><td>${esc(c.expected)}</td><td>${esc(c.tests.map((t) => t.note || t.error).filter(Boolean).join(" · ")) || '<span class="muted">no test with this tag</span>'}</td></tr>`)
        .join("")}</tbody></table>`;
    })
    .join("");

const cov = R.coverage;
const covRow = (name, c, cls = "") =>
  `<tr class="${cls}"><td>${esc(name)}</td><td>${pct(c.statements)}</td><td>${pct(c.branches)}</td><td>${pct(c.functions)}</td><td>${pct(c.lines)}</td></tr>`;
const covHead = `<thead><tr><th>File</th><th>Stmts / Instr</th><th>Branch</th><th>Funcs</th><th>Lines</th></tr></thead>`;
// totals first; the per-file list can be thousands of rows, so it is collapsed
const covHtml = cov
  ? `<table class="cov">${covHead}<tbody>${cov.totals
      .map((t) => covRow(`All files${t.label ? ` — ${t.label}` : ""} (${t.format})`, t, "total"))
      .join("")}</tbody></table>` +
    `<details><summary>${cov.files.length} files</summary><table class="cov">${covHead}<tbody>${cov.files
      .map((f) => covRow(f.path, f))
      .join("")}</tbody></table></details>`
  : '<p class="muted">No coverage data.</p>';

const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test Report${label ? ` — ${esc(label)}` : ""}</title><style>${STYLE}</style></head><body>
<h1>Test Report <span class="muted">${esc(m.scope)}</span></h1>
<table class="meta">${metaRows}</table>
${warnings}
${(() => {
  const chip = (n, text, cls, href) => `<${href && n ? `a href="#${href}"` : "span"} class="chip ${cls}${n ? "" : " zero"}">${n} ${text}</${href && n ? "a" : "span"}>`;
  const row = (title, n, sub, chips) => `<div class="stat-row"><div class="stat-label"><b>${title} ${n}</b><small>${sub}</small></div><div class="chips">${chips.join("")}</div></div>`;
  const ab = R.tests.reduce((k, t) => k + (t.aborted || []).length, 0);
  const wr = R.tests.reduce((k, t) => k + (t.writes || []).length, 0);
  return `<div class="stats">` +
    row("Cases", cases.length, "approved cases in cases.md, by result", [chip(cSum.passed, "pass", "passed", "cases"), chip(cSum.failed, "fail", "failed", "failed"), ...(cSum.failed ? [chip(cSum.failed - reviewed, "fail not reviewed", "failed", "failed")] : []), chip(cSum.blocked, "blocked", "blocked", "blocked"), chip(cSum.notrun, "not run", "notrun", "notrun"), chip(R.notCovered.length, "flow items out of scope", "notrun", "not-covered"), chip(assumptionCases, "expected = assumption", "skipped", "cases")]) +
    (diffs.length ? row("Spec ≠ code", diffs.length, "differences in diff.md, checked by tests", [chip(dSum.reproduced, "reproduced", "failed", "diff"), chip(dSum["not-reproduced"], "not reproduced", "passed", "diff"), chip(dSum.unverified, "unverified", "notrun", "diff")]) : "") +
    row("Tests", R.tests.length, "test scripts that ran (one case can have several)", [chip(tSum.passed, "passed", "passed", "tests"), chip(tSum.failed, "failed", "failed", "failed"), chip(tSum.skipped, "skipped", "skipped", "tests"), `<span class="chip muted">${(R.tests.reduce((k, t) => k + (t.duration || 0), 0) / 1000).toFixed(0)} s</span>`]) +
    (ab || wr ? row("Write guard", ab + wr, "data-writing requests", [chip(ab, "blocked by guard", "skipped", "tests"), chip(wr, "sent (Writes = Y cases)", "", "data")]) : "") +
    `</div>`;
})()}
${attention ? `<h2 id="attention">Needs attention</h2>${attention}` : ""}
<h2 id="cases">Cases</h2>
<table><thead><tr><th>ID</th><th>Layer</th><th>Flow</th><th>Expected</th><th>Source</th><th>Status</th><th>Tests</th></tr></thead><tbody>${caseTable}</tbody></table>
<h2 id="not-covered">Not covered</h2>${notCovered}
<h2 id="diff">Spec vs code differences</h2>${diffHtml}
<h2 id="data">Data created <span class="muted">(${(R.dataCreated || []).filter((d) => /left/i.test(d.status)).length} left in UI, ${(R.dataCreated || []).filter((d) => /needs-be/i.test(d.status)).length} need BE/DB — see core/cleanup-list.mjs)</span></h2>${
  (R.dataCreated || []).length
    ? `<table><thead><tr><th>Case</th><th>When</th><th>Env</th><th>Record</th><th>Action</th><th>How to delete / revert</th><th>Status</th></tr></thead><tbody>${R.dataCreated
        .map((d) => `<tr><td>${esc(d.case)}</td><td>${esc(d.when)}</td><td>${esc(d.environment)}</td><td><b>${esc(d.record)}</b></td><td>${esc(d.action)}</td><td>${esc(d.cleanup)}</td><td class="status ${/left|needs-be/i.test(d.status) ? (/needs-be/i.test(d.status) ? "failed" : "skipped") : "passed"}">${esc(d.status)}</td></tr>`)
        .join("")}</tbody></table>`
    : '<p class="muted">No data-created.md given, or nothing was written.</p>'
}
<h2 id="tests">Test results</h2><table class="tests">${testHead}<tbody>${testRows}</tbody></table>
<h2>Coverage</h2>${covHtml}
${R.notes ? `<h2>Run notes</h2><pre>${esc(R.notes)}</pre>` : ""}
<script>document.querySelectorAll(".shot img").forEach(i=>{i.tabIndex=0});</script>
</body></html>`;

const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `test-report-${label ? `${label}-` : ""}${stamp}.html`);
writeFileSync(out, html);
console.log(`[vuong-test] cases: ${cSum.passed} pass, ${cSum.failed} fail, ${cSum.blocked} blocked, ${cSum.notrun} not run → ${out}`);
process.exitCode = cSum.failed ? 1 : 0;
