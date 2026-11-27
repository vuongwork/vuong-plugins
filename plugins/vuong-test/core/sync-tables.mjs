#!/usr/bin/env node
// Fill the mechanical columns of the step 2–4 files from the files that own the facts, 0 tokens:
//   answers.md rows  → spec-sources.md "Questions for BA" Answer (Q<n>), "Conflicts" Resolved by (X<n>),
//                      diff.md Decision (D<n>)  — as "<answer> — <by>, <date> (answers.md › <Ref>)"
//   cases.md         → diff.md Cases: the IDs of the cases whose row names the diff (D5, "diff D5")
//
//   node sync-tables.mjs W [--dry]
//
// Refs may be ranges or lists: "Q1–Q13", "Q1-Q3", "D2, D5". A cell already holding that answer is left alone;
// an answer never overwrites a different answer already written (reported as a conflict, exit 1).
// Prints what it changed. Exit 0 = done (or nothing to do), 1 = conflicts, 2 = usage.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const W = argv.find((a) => !a.startsWith("--"));
if (!W || !existsSync(W)) {
  console.error("usage: sync-tables.mjs W [--dry]   (W = test-work/<scope>)");
  process.exit(2);
}
const f = (n) => path.join(W, n);
const read = (n) => (existsSync(f(n)) ? readFileSync(f(n), "utf8") : null);

// table cells: split on | not escaped with a backslash
const cells = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
const row = (cs) => `| ${cs.join(" | ")} |`;
const isSep = (l) => /^\|[\s:|-]+\|\s*$/.test(l || "");

// every table: { header: [names], start (header line index), rows: [line indexes] }
function tables(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("|") || !isSep(lines[i + 1])) continue;
    const t = { header: cells(lines[i]).map((h) => h.toLowerCase()), start: i, rows: [] };
    let j = i + 2;
    for (; j < lines.length && lines[j].trimStart().startsWith("|"); j++) t.rows.push(j);
    out.push(t);
    i = j - 1;
  }
  return out;
}

// "Q1–Q13" / "Q1-Q3" / "Q2, Q5" → ["Q1", ..., "Q13"]
function expand(ref) {
  const out = [];
  for (const part of ref.replace(/`/g, "").split(/[,;]\s*/)) {
    const m = part.trim().match(/^([A-Za-z]+)(\d+)\s*[–—-]\s*(?:[A-Za-z]+)?(\d+)$/);
    if (m) for (let n = +m[2]; n <= +m[3]; n++) out.push(`${m[1].toUpperCase()}${n}`);
    else if (/^[A-Za-z]+\d+$/.test(part.trim())) out.push(part.trim().toUpperCase());
  }
  return out;
}

const changes = [];
const conflicts = [];
const placeholder = (v) => !v || /^(<.*>|\(?\s*(bước|step)\s*\d.*\)?|—|–|-|tbd|todo|open\b.*)$/i.test(v.trim());

// answers.md
const answers = [];
const A = read("answers.md");
if (A) {
  for (const t of tables(A.split(/\r?\n/))) {
    const iRef = t.header.indexOf("ref");
    const iAns = t.header.indexOf("answer");
    if (iRef < 0 || iAns < 0) continue;
    const iBy = t.header.indexOf("by");
    const iDate = t.header.indexOf("date");
    const lines = A.split(/\r?\n/);
    for (const li of t.rows) {
      const c = cells(lines[li]);
      if (/^</.test(c[iRef] || "")) continue; // template row
      const ids = expand(c[iRef] || "");
      const by = [c[iBy], c[iDate]].filter((x) => x && !/^</.test(x)).join(", ");
      const text = `${c[iAns]}${by ? ` — ${by}` : ""} (answers.md › ${c[iRef]})`;
      for (const id of ids) answers.push({ id, text, ref: c[iRef] });
    }
  }
}
const answerOf = (id) => answers.filter((a) => a.id === id.toUpperCase()).pop();

// set column `col` of the row whose first cell is `id`, in tables having that column
function fill(file, lines, pick, col, value, why) {
  let hit = false;
  for (const t of tables(lines)) {
    const ci = t.header.findIndex((h) => h.startsWith(col));
    if (ci < 0) continue;
    for (const li of t.rows) {
      const c = cells(lines[li]);
      const id = pick(c);
      if (!id) continue;
      const v = value(id, c[ci] || "");
      if (v == null) continue;
      hit = true;
      if ((c[ci] || "") === v) continue;
      while (c.length <= ci) c.push("");
      c[ci] = v;
      lines[li] = row(c);
      changes.push(`${file} ${id}: ${col} ← ${why(id, v)}`);
    }
  }
  return hit;
}
const firstId = (re) => (c) => (re.test(c[0] || "") ? c[0].replace(/`/g, "").trim().toUpperCase() : null);
const fromAnswer = (id, cur) => {
  const a = answerOf(id);
  if (!a) return null;
  if (cur.includes(`answers.md › ${a.ref}`)) return cur; // already copied
  if (!placeholder(cur) && !/^open\b/i.test(cur) && !/assumption/i.test(cur)) {
    conflicts.push(`${id}: "${cur.slice(0, 60)}" already written, answers.md says "${a.text.slice(0, 60)}" — left as is`);
    return null;
  }
  return a.text.replace(/(?<!\\)\|/g, "\\|"); // answers.md cells are already escaped
};
const short = (id, v) => v.slice(0, 70);

const files = {};
const S = read("spec-sources.md");
if (S) {
  const lines = S.split(/\r?\n/);
  fill("spec-sources.md", lines, firstId(/^`?Q\d+`?$/i), "answer", fromAnswer, short);
  fill("spec-sources.md", lines, firstId(/^`?X\d+`?$/i), "resolved by", fromAnswer, short);
  files["spec-sources.md"] = [S, lines.join(S.includes("\r\n") ? "\r\n" : "\n")];
}
const D = read("diff.md");
if (D) {
  const lines = D.split(/\r?\n/);
  fill("diff.md", lines, firstId(/^`?D\d+`?$/i), "decision", fromAnswer, short);
  // Cases: case IDs whose row names the diff (word D5, so D5 ≠ D50)
  const C = read("cases.md");
  if (C) {
    const caseRows = [];
    for (const t of tables(C.split(/\r?\n/))) {
      if (t.header[0] !== "id") continue;
      const cl = C.split(/\r?\n/);
      for (const li of t.rows) caseRows.push({ id: cells(cl[li])[0], text: cl[li] });
    }
    // "(diff D5)", "diff D5, D6", "diff.md › D5" — not a spec cell like Item!D8
    const named = (text) => [...text.matchAll(/diff(?:\.md)?\s*(?:›\s*)?(D\d+(?:\s*(?:,|\/|&|and|và)\s*D\d+)*)/gi)].flatMap((m) => m[1].match(/D\d+/gi).map((x) => x.toUpperCase()));
    fill("diff.md", lines, firstId(/^`?D\d+`?$/i), "cases", (id, cur) => {
      const ids = caseRows.filter((r) => named(r.text).includes(id)).map((r) => r.id);
      if (!ids.length) return placeholder(cur) ? "no case yet" : null;
      return ids.join(", ");
    }, (id, v) => v.slice(0, 70));
  }
  files["diff.md"] = [D, lines.join(D.includes("\r\n") ? "\r\n" : "\n")];
}
// answers with no row to land on
const known = new Set();
for (const [, [, text]] of Object.entries(files)) for (const m of text.matchAll(/^\|\s*`?([QXD]\d+)`?\s*\|/gm)) known.add(m[1].toUpperCase());
const orphans = [...new Set(answers.filter((a) => /^[QXD]\d+$/.test(a.id) && !known.has(a.id)).map((a) => a.id))];

if (!dry) for (const [n, [before, after]] of Object.entries(files)) if (after !== before) writeFileSync(f(n), after);
for (const c of changes) console.log(`${dry ? "would set" : "set"}  ${c}`);
for (const c of conflicts) console.log(`CONFLICT ${c}`);
if (orphans.length) console.log(`warn  answers.md refs with no row in spec-sources.md / diff.md: ${orphans.join(", ")}`);
console.log(`[vuong-test] sync-tables: ${changes.length} cells ${dry ? "to change" : "changed"}, ${conflicts.length} conflicts`);
process.exit(conflicts.length ? 1 : 0);
