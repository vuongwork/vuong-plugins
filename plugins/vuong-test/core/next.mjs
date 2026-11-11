#!/usr/bin/env node
// "What do I read now?" — prints, for the stage a scope is at, which file to open and which rows / IDs to look at.
// Writes nothing. Run by the skill at the end of each step, and by a dev with /vuong-test:next.
//
//   node next.mjs [<scope> | <work folder>] [--config test.config.json]
//
// <scope> → <cfg.workDir or test-work>/<scope>/. No argument: the only scope folder in test-work/, else the list.
// Stage: no cases → spec & flows (nothing for a dev yet) · cases not approved → approve · approved, no run →
// write / run · results.json → after the run. Reads only files inside the work folder (and test.config.json).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCases, parseDiff, parseTriage, parseDataCreated, tablesStartingWith, casesWithStatus } from "./parsers.mjs";

const argv = process.argv.slice(2);
const ci = argv.indexOf("--config");
const cfgFile = ci >= 0 ? argv[ci + 1] : "test.config.json";
const arg = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--config");
let workDir = "test-work";
try {
  if (existsSync(cfgFile)) workDir = JSON.parse(readFileSync(cfgFile, "utf8")).workDir || workDir;
} catch {
  /* unreadable config: default folder */
}
const isDir = (d) => existsSync(d) && statSync(d).isDirectory();
let W = arg && isDir(arg) ? arg : arg ? path.join(workDir, arg) : null;
if (!W) {
  const scopes = isDir(workDir) ? readdirSync(workDir).filter((d) => !d.startsWith("_") && isDir(path.join(workDir, d))) : [];
  if (scopes.length === 1) W = path.join(workDir, scopes[0]);
  else {
    console.log(scopes.length ? `Có ${scopes.length} scope trong ${workDir}/ — chọn một: ${scopes.join(", ")}\n  /vuong-test:next <scope>` : `Chưa có scope nào trong ${workDir}/ — bắt đầu bằng /vuong-test:vuong-test <màn/feature>`);
    process.exit(scopes.length ? 0 : 1);
  }
}
if (!isDir(W)) {
  console.error(`[vuong-test] không có thư mục ${W}`);
  process.exit(2);
}
const f = (n) => path.join(W, n);
const has = (n) => existsSync(f(n));
const read = (n) => (has(n) ? readFileSync(f(n), "utf8") : "");
// paths as the reader types them: relative to where the command runs, when inside it
const rel = (n) => {
  const abs = path.resolve(W, n);
  const r = path.relative(process.cwd(), abs);
  return (r && !r.startsWith("..") && !path.isAbsolute(r) ? r : abs).replace(/\\/g, "/");
};
const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const list = (xs, n = 8) => (xs.length > n ? `${xs.slice(0, n).join(", ")} … +${xs.length - n}` : xs.join(", "));
const short = (s, n = 60) => {
  const t = String(s || "").replace(/<br>/g, " ").replace(/`/g, "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const C = has("cases.md") ? parseCases(f("cases.md")) : null;
const questions = (tablesStartingWith(read("spec-sources.md"), "Q")[0]?.rows || []).filter((r) => r.q && !/^</.test(r.q) && !(r.answer || "").trim());
const diffs = has("diff.md") ? parseDiff(f("diff.md")).filter((r) => r.id && !/^</.test(r.id)) : [];
const openDiffs = diffs.filter((r) => !r.decision.trim() || /\bopen\b|^</i.test(r.decision));
const needs = (tablesStartingWith(read("data-plan.md"), "Need")[0]?.rows || []).filter((r) => r.need && !/^</.test(r["concrete data (key / state / file)"] || ""));
const notReady = needs.filter((r) => !/^(ready|ok|done|✓)/i.test((r.status || "").trim()));
const approved = C && C.approvedBy && !/^</.test(C.approvedBy);
const out = [];
const step = (n, file, ...what) => out.push(`  ${n}. ${file}${what.filter(Boolean).map((w) => `\n     → ${w}`).join("")}`);
const scope = C?.scope || path.basename(path.resolve(W));

if (!C || !C.cases.length) {
  out.push(`[${scope}] Giai đoạn: làm rõ spec + liệt kê luồng (bước 1–3). Dev chưa cần đọc gì.`);
  if (questions.length) step(1, `${rel("spec-sources.md")} › Questions for BA`, `câu hỏi chưa có trả lời: ${list(questions.map((q) => `${q.q} ${short(q.question, 50)}`), 5)} — chuyển cho BA`);
  if (openDiffs.length) step(questions.length ? 2 : 1, rel("diff.md"), `spec ≠ code, chưa quyết: ${list(openDiffs.map((d) => `${d.id} ${short(d.area, 30)}`), 5)}`);
} else if (!approved) {
  const isAssumption = (c) => /assumption/i.test(c.source);
  const assumption = C.cases.filter(isAssumption);
  const important = C.cases.filter((c) => !isAssumption(c) && (/^(high|cao)$/i.test(c.priority) || /^y$/i.test(c.writes)));
  const rest = C.cases.filter((c) => !isAssumption(c) && !important.includes(c));
  // gaps from cases-summary, with the flow item's name, so flows.md need not be opened
  let gaps = [];
  if (has("flows.md")) {
    const r = spawnSync(process.execPath, [path.join(PLUGIN, "core/cases-summary.mjs"), f("cases.md"), "--flows", f("flows.md")], { encoding: "utf8" });
    const gapPart = ((r.stdout || "").split("## Gaps")[1] || "").split("\n## ")[0];
    gaps = [...gapPart.matchAll(/^\| ([^|\s]+) \| [^|]* \| ([^|]*) \|/gm)].filter((x) => !/^(Ref|-+)$/.test(x[1])).map((x) => `${x[1]} ${short(x[2], 50)}`);
  }
  // assumption cases grouped by the open question that blocks them (Questions › Cases blocked)
  const byQ = questions.map((q) => ({ q, ids: assumption.filter((c) => (q["cases blocked"] || "").split(/[,\s]+/).includes(c.id)).map((c) => c.id) }));
  const asked = new Set(byQ.flatMap((x) => x.ids));
  const unasked = assumption.filter((c) => !asked.has(c.id)).map((c) => c.id);
  out.push(`[${scope}] Giai đoạn: DUYỆT CASE (bước 5) — ${C.cases.length} case, chưa duyệt. Đọc theo thứ tự:`);
  let n = 0;
  if (gaps.length) step(++n, `Luồng chưa có case (${rel("flows.md")})`, `${gaps.join("; ")} — mỗi cái: thêm case, hoặc ghi vào Not covered kèm lý do`);
  step(
    ++n,
    rel("cases.md"),
    `header: Scope, Environment, Writes data${C.runOrder ? ", Run order" : ""}${C.before ? ", Before you start" : ""}`,
    ...byQ.filter((x) => x.ids.length).map((x) => `chờ ${x.q.q} "${short(x.q.question, 80)}": ${x.ids.join(", ")} — chưa duyệt được tới khi có trả lời`),
    unasked.length ? `assumption chưa có câu hỏi cho BA: ${unasked.join(", ")} — thêm câu hỏi vào spec-sources.md` : "",
    important.length ? `xem trước (ưu tiên cao / ghi dữ liệu): ${important.map((c) => c.id).join(", ")}` : "",
    rest.length ? `rồi: ${rest.map((c) => c.id).join(", ")}` : "",
    "mỗi dòng: Expected có phải giá trị kiểm được không, Source có thật sự nói vậy không"
  );
  if (openDiffs.length)
    step(++n, rel("diff.md"), ...openDiffs.map((d) => `${d.id} ${short(d.area, 30)}: spec "${short(d.spec, 70)}" ↔ code "${short(d.code, 70)}" — quyết sửa code hay sửa spec (tên + ngày ở cột Decision)`));
  if (notReady.length)
    step(++n, rel("data-plan.md"), ...notReady.map((r) => `${r.need} ${short(r["concrete data (key / state / file)"], 60)} — ${r.status || "?"}, case ${r.cases}`), "đưa dữ liệu, hoặc chấp nhận các case đó BLOCKED");
  out.push(`  Xong: ghi "Approved by: <tên> · Date: <ngày>" vào header ${rel("cases.md")}.`);
  out.push("  Không cần mở: flows.md, spec-sources.md, _spec/ — phần cần từ đó đã in ở trên.");
} else if (!has("results.json")) {
  const manual = C.cases.filter((c) => c.layer.toLowerCase() === "manual");
  const tests = readdirSync(W).filter((x) => /\.(mjs|js|cjs|ts)$/.test(x));
  const runbooks = has("manual") ? readdirSync(f("manual")).filter((x) => /\.xlsx$/i.test(x)) : [];
  out.push(`[${scope}] Giai đoạn: VIẾT / CHẠY TEST (bước 6–7) — đã duyệt bởi ${C.approvedBy}.`);
  let n = 0;
  step(++n, "Review code test", `${tests.length ? `${list(tests.map((t) => rel(t)), 4)} và ` : ""}test trong repo có tag [ID] — mở ${rel("cases.md")} bên cạnh, so assert với cột Expected của đúng ID`);
  if (has("existing-tests.md")) step(++n, rel("existing-tests.md"), "test có sẵn: cột Decision từng test (keep / tag / rewrite / delete)");
  if (readdirSync(W).some((x) => /^run-notes.*\.md$/.test(x))) step(++n, `${rel("run-notes*.md")}`, "những gì đã đổi ở CÁCH kiểm (selector, data, helper) và lý do");
  if (notReady.length) step(++n, rel("data-plan.md"), `trước khi chạy, còn thiếu: ${list(notReady.map((r) => `${r.need} (case ${r.cases})`), 5)}`);
  step(++n, "Chạy", `node $PLUGIN/core/config.mjs --check, môi trường "${C.environment || "?"}"${/^y/i.test(C.writesData) ? " — có case GHI dữ liệu" : ""}; lệnh: /vuong-test:help report`);
  if (manual.length) step(++n, runbooks.length ? `${rel(`manual/${runbooks.at(-1)}`)} (người test tay)` : `node $PLUGIN/core/manual-runbook.mjs ${rel("cases.md")} --out ${rel("manual/")}`, `${manual.length} case manual: người chạy chỉ cần file Excel này (sheet Hướng dẫn trước)`);
} else {
  const R = JSON.parse(read("results.json"));
  const cs = casesWithStatus(R);
  const triage = has("triage.md") ? parseTriage(f("triage.md")) : [];
  const failed = cs.filter((c) => c.status === "failed");
  const unreviewed = failed.filter((c) => !triage.some((t) => t.case === c.id));
  const blocked = cs.filter((c) => c.status === "blocked");
  const notrun = cs.filter((c) => c.status === "notrun");
  const left = has("data-created.md") ? parseDataCreated(f("data-created.md")).filter((r) => r.case && !/^(deleted|reverted)$/i.test(r.status)) : [];
  const n0 = (k) => cs.filter((c) => c.status === k).length;
  out.push(`[${scope}] Giai đoạn: SAU KHI CHẠY — ${n0("passed")} pass · ${failed.length} fail · ${blocked.length} blocked · ${notrun.length} not run (commit ${R.meta?.commit || "?"}).`);
  let n = 0;
  if (failed.length) {
    step(++n, `${rel("report/index.html")} › Needs attention`, `case fail: ${list(failed.map((c) => `${c.id} ${short(c.expected, 35)}`), 5)} — xem Expected / Actual, API calls`);
    step(++n, rel("cases.md"), `dòng của ${list(failed.map((c) => c.id), 6)}: Source nói gì → app sai hay case sai`);
    if (unreviewed.length) step(++n, rel("triage.md"), `chưa có kết luận: ${list(unreviewed.map((c) => c.id))} — ghi bug / app-correct / test-wrong / spec-unclear + tên + ngày`);
  } else step(++n, rel("report/index.html"), "không có case fail; xem phần Coverage và các case không chạy");
  if (blocked.length) step(++n, `${rel("report/index.html")} › Blocked`, `${list(blocked.map((c) => { const t = c.tests.find((x) => x.status === "blocked"); return `${c.id}${t?.note ? ` (${short(t.note, 40)})` : ""}`; }), 5)}`);
  if (notrun.length) step(++n, rel("cases.md"), `chưa có kết quả: ${list(notrun.map((c) => c.id))} — chưa có test gắn [ID], hoặc case manual chưa điền`);
  const repro = diffs.filter((d) => d.cases.some((id) => failed.some((c) => c.id === id)));
  if (repro.length) step(++n, rel("diff.md"), `khác biệt có case fail tái hiện: ${list(repro.map((d) => d.id))} — ghi Decision`);
  if (left.length) step(++n, `node $PLUGIN/core/cleanup-list.mjs ${rel("data-created.md")}`, `${left.length} bản ghi test còn trong môi trường — dọn`);
}
console.log(out.join("\n"));
