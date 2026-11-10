#!/usr/bin/env node
// Step 5 overview: which parts of the scope have cases, and what is left without one.
//
//   node cases-summary.mjs W/cases.md [--flows W/flows.md] [--out W/cases-summary.md]
//
// Shown to the approver BEFORE cases.md, so coverage can be judged without reading every case.
// With flows.md: one row per entry point (E…) with its branches / side effects (rows whose `Under` is that ref):
// how many flow items have a case, which cases, by layer, and the gaps (no case and not in "Not covered").
// Without flows.md: grouped by the cases' Flow column.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseCases, tablesStartingWith } from "./parsers.mjs";

const argv = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--flows") opt.flows = argv[++i];
  else if (argv[i] === "--out") opt.out = argv[++i];
  else pos.push(argv[i]);
}
if (!pos[0]) {
  console.error("usage: cases-summary.mjs W/cases.md [--flows W/flows.md] [--out W/cases-summary.md]");
  process.exit(2);
}
const C = parseCases(pos[0]);
const flowsFile = opt.flows || pos[0].replace(/cases\.md$/, "flows.md");
const strip = (s = "") => s.replace(/`/g, "").replace(/\s+/g, " ").trim();
const short = (s, n = 70) => (strip(s).length > n ? `${strip(s).slice(0, n - 1)}…` : strip(s));
const count = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ");
const ids = (cs) => {
  if (cs.length <= 6) return cs.map((c) => c.id).join(", ");
  return `${cs.slice(0, 5).map((c) => c.id).join(", ")} … +${cs.length - 5}`;
};
const nc = new Map(C.notCovered.map((n) => [strip(n.ref), n.reason]));
const out = [];
const total = C.cases.length;
const layers = count(C.cases.map((c) => c.layer || "?"));
const writes = C.cases.filter((c) => /^y/i.test(c.writes)).length;
const assumption = C.cases.filter((c) => /assumption/i.test(c.source)).length;
out.push(`# Case overview — ${C.scope}`, "");
out.push(`- Cases: **${total}** (${layers}) · writes data: ${writes} · expected from assumption: ${assumption}`);
// optional columns: show the mix so a list of only happy paths, or no high-priority case, is visible
const typed = C.cases.filter((c) => c.type);
const prioritised = C.cases.filter((c) => c.priority);
if (typed.length || prioritised.length)
  out.push(`- By type: ${typed.length ? count(typed.map((c) => c.type.toLowerCase())) : "—"} · by priority: ${prioritised.length ? count(prioritised.map((c) => c.priority.toLowerCase())) : "—"} · with Pre: ${C.cases.filter((c) => c.pre.length).length}`);

if (existsSync(flowsFile)) {
  const md = readFileSync(flowsFile, "utf8");
  const items = new Map(); // ref -> {ref, under, text, kind}
  for (const t of tablesStartingWith(md, "Ref"))
    for (const r of t.rows) {
      const ref = strip(r.ref);
      if (!ref) continue;
      items.set(ref, { ref, under: strip(r.under), kind: strip(r.kind), text: strip(r.name || r.condition || r.effect || ""), result: strip(r["result / error code"] || "") });
    }
  const refRe = new RegExp(`(?<![\\w-])(${[...items.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "g");
  const casesOf = new Map();
  const unmapped = [];
  for (const c of C.cases) {
    const refs = [...new Set([...strip(c.flow).matchAll(refRe)].map((m) => m[1]))];
    if (!refs.length) unmapped.push(c);
    for (const r of refs) (casesOf.get(r) || casesOf.set(r, []).get(r)).push(c);
  }
  // group: entry point + everything (transitively) under it
  const rootOf = (ref, seen = new Set()) => {
    const it = items.get(ref);
    if (!it?.under || seen.has(ref)) return ref;
    seen.add(ref);
    const first = it.under.split(/[\s,/;]+/).find((u) => items.has(u));
    return first ? rootOf(first, seen) : ref;
  };
  const groups = new Map();
  for (const ref of items.keys()) {
    const root = rootOf(ref);
    (groups.get(root) || groups.set(root, []).get(root)).push(ref);
  }
  let covered = 0;
  let excluded = 0;
  const gaps = [];
  const rows = [];
  for (const [root, refs] of groups) {
    const cs = [...new Map(refs.flatMap((r) => casesOf.get(r) || []).map((c) => [c.id, c])).values()];
    const cov = refs.filter((r) => casesOf.has(r));
    const ex = refs.filter((r) => !casesOf.has(r) && nc.has(r));
    const gap = refs.filter((r) => !casesOf.has(r) && !nc.has(r));
    covered += cov.length;
    excluded += ex.length;
    gaps.push(...gap);
    const it = items.get(root);
    const mark = gap.length ? (cov.length ? "◐" : "✗") : "✓";
    rows.push(`| ${mark} | **${root}** ${short(it.text, 60)} | ${cov.length}/${refs.length}${ex.length ? ` (${ex.length} out of scope)` : ""} | ${cs.length ? `${cs.length}: ${ids(cs)}` : "—"} | ${cs.length ? count(cs.map((c) => c.layer || "?")) : ""} | ${gap.join(", ")} |`);
  }
  const n = items.size;
  out.push(`- Flow items (flows.md): **${n}** · with a case: **${covered}** · out of scope (Not covered): ${excluded} · **gaps: ${gaps.length}**`);
  out.push(`- Cases not linked to any flow ref: ${unmapped.length}`, "");
  out.push("✓ every item has a case or is out of scope · ◐ partly · ✗ no case", "");
  out.push("| | Area (entry point + its branches) | Items with case | Cases | Layers | Gaps |", "|---|---|---|---|---|---|", ...rows, "");
  if (gaps.length) {
    out.push("## Gaps — no case and not listed in Not covered", "", "| Ref | Under | What | Result |", "|---|---|---|---|");
    for (const g of gaps) {
      const it = items.get(g);
      out.push(`| ${g} | ${it.under} | ${short(it.text, 90)} | ${short(it.result, 50)} |`);
    }
    out.push("");
  }
  if (nc.size) {
    out.push("## Out of scope (cases.md → Not covered)", "", "| Ref | Reason |", "|---|---|", ...[...nc].map(([r, why]) => `| ${r} | ${short(why, 100)} |`), "");
  }
  if (unmapped.length) out.push("## Cases without a flow ref", "", ...unmapped.map((c) => `- ${c.id} — ${short(c.flow, 40)}: ${short(c.expected, 80)}`), "");
} else {
  const by = new Map();
  for (const c of C.cases) (by.get(strip(c.flow) || "?") || by.set(strip(c.flow) || "?", []).get(strip(c.flow) || "?")).push(c);
  out.push(`- flows.md not found (${flowsFile}): grouped by the Flow column; gaps cannot be shown`, "");
  out.push("| Flow | Cases | Layers |", "|---|---|---|", ...[...by].map(([f, cs]) => `| ${short(f, 60)} | ${cs.length}: ${ids(cs)} | ${count(cs.map((c) => c.layer || "?"))} |`), "");
}
const text = out.join("\n");
if (opt.out) {
  writeFileSync(opt.out, text);
  console.log(`[vuong-test] case overview → ${opt.out}`);
} else console.log(text);
