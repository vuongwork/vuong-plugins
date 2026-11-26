#!/usr/bin/env node
// Check the citations in step files: every `file:line` must point to an existing line, every `Sheet!Cell` to a
// labelled cell of a converted spec (test-work/_spec/*.md from read-spec.mjs). Read-only, 0 tokens: the writer runs
// it after steps 2–3 / 4 instead of anyone re-reading the code or the spec to spot-check.
//
//   node check-refs.mjs <file.md>... [--root <repo>] [--spec <dir with read-spec .md>] [--config test.config.json]
//
// A bare file name ("app.js:179") resolves when exactly one file of the repo has that name (node_modules, .git,
// test-work, build output skipped); two or more → ambiguous (write the path). Ranges ("A9-A18", "92-96") check
// both ends. Exit 0 = all found · 1 = bad refs (listed) · 2 = usage.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = { root: ".", spec: null, config: "test.config.json", files: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--root") opt.root = argv[++i];
  else if (a === "--spec") opt.spec = argv[++i];
  else if (a === "--config") opt.config = argv[++i];
  else if (a.startsWith("--")) {
    console.error(`[vuong-test] check-refs: unknown argument ${a}`);
    process.exit(2);
  } else opt.files.push(a);
}
if (!opt.files.length) {
  console.error("usage: check-refs.mjs <file.md>... [--root <repo>] [--spec <dir>]");
  process.exit(2);
}
const ROOT = path.resolve(opt.root);
let workDir = "test-work";
try {
  const cfgPath = path.resolve(ROOT, opt.config);
  if (existsSync(cfgPath)) workDir = JSON.parse(readFileSync(cfgPath, "utf8")).workDir || workDir;
} catch {
  /* unreadable config: default */
}
const SPEC = path.resolve(ROOT, opt.spec || path.join(workDir, "_spec"));

// ── repo files by name ──────────────────────────────────────────────────────
const SKIP = new Set(["node_modules", ".git", "dist", "build", "target", "coverage", ".next", "out", path.basename(workDir)]);
const byName = new Map();
(function walk(d, depth) {
  if (depth > 12) return;
  let names;
  try {
    names = readdirSync(d);
  } catch {
    return;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = path.join(d, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else (byName.get(n) || byName.set(n, []).get(n)).push(p);
  }
})(ROOT, 0);
const lineCount = new Map();
const linesOf = (p) => {
  if (!lineCount.has(p)) lineCount.set(p, readFileSync(p, "utf8").replace(/\r?\n$/, "").split("\n").length); // final newline ends the last line
  return lineCount.get(p);
};

// ── spec cells (bold labels of read-spec output) ────────────────────────────
const cells = new Set();
const sheets = new Set();
if (existsSync(SPEC)) {
  for (const f of readdirSync(SPEC).filter((x) => x.endsWith(".md"))) {
    const text = readFileSync(path.join(SPEC, f), "utf8");
    for (const m of text.matchAll(/^## Sheet: (.+)$/gm)) sheets.add(m[1].trim());
    for (const m of text.matchAll(/\*\*([^*!\n]+)!([A-Z]+\d+)\*\*([^\n]*)/g)) {
      cells.add(`${m[1]}!${m[2]}`.toLowerCase());
      // a row label "**Item!A4** … | **B4** …" also covers the other cells of that row
      const row = m[2].replace(/^[A-Z]+/, "");
      for (const c of m[3].matchAll(/\*\*([A-Z]+)(\d+)\*\*/g)) if (c[2] === row) cells.add(`${m[1]}!${c[1]}${c[2]}`.toLowerCase());
    }
  }
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sheetRe = sheets.size
  ? new RegExp(`(?<![\\w])(${[...sheets].sort((a, b) => b.length - a.length).map(esc).join("|")})!([A-Z]+\\d+)(?:\\s*[-–]\\s*([A-Z]+\\d+))?`, "g")
  : null;

// ── scan ────────────────────────────────────────────────────────────────────
const EXT = "js|mjs|cjs|ts|tsx|jsx|vue|svelte|html|css|scss|less|java|kt|py|go|cs|rb|php|xml|sql|json|yml|yaml|properties|sh";
const fileRe = new RegExp(`(?<![\\w/.-])((?:[\\w.-]+/)*[\\w.-]+\\.(?:${EXT})):(\\d+)(?:\\s*-\\s*(\\d+))?`, "g");
const bad = [];
const ambiguous = [];
const seen = new Set();
let nFile = 0;
let nCell = 0;
for (const f of opt.files) {
  if (!existsSync(f)) {
    bad.push(`${f}: file not found`);
    continue;
  }
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((text, i) => {
    const at = `${path.basename(f)}:${i + 1}`;
    for (const m of text.matchAll(fileRe)) {
      const [, file, a, b] = m;
      const key = `${file}:${a}${b ? `-${b}` : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nFile++;
      let p = path.resolve(ROOT, file);
      if (!existsSync(p)) {
        const hits = file.includes("/") ? [] : byName.get(file) || [];
        if (hits.length > 1) {
          ambiguous.push(`${at} ${key}: ${hits.length} files named ${file} — write the path`);
          continue;
        }
        if (!hits.length) {
          bad.push(`${at} ${key}: no such file`);
          continue;
        }
        p = hits[0];
      }
      const n = linesOf(p);
      for (const x of [a, b].filter(Boolean).map(Number)) if (x < 1 || x > n) bad.push(`${at} ${key}: ${file} has ${n} lines`);
    }
    if (!sheetRe) return;
    for (const m of text.matchAll(sheetRe)) {
      const [, sheet, c1, c2] = m;
      for (const c of [c1, c2].filter(Boolean)) {
        const key = `${sheet}!${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nCell++;
        if (!cells.has(key.toLowerCase())) bad.push(`${at} ${key}: no such cell label in ${path.relative(ROOT, SPEC) || SPEC}`);
      }
    }
  });
}
console.log(
  `[vuong-test] refs: ${nFile} file:line, ${nCell} spec cells${sheets.size ? "" : ` (no read-spec output in ${path.relative(ROOT, SPEC) || SPEC}: cells not checked)`} — ${bad.length} bad${ambiguous.length ? `, ${ambiguous.length} ambiguous` : ""}`,
);
for (const x of [...bad, ...ambiguous].slice(0, 40)) console.log(`  ${x}`);
if (bad.length + ambiguous.length > 40) console.log(`  … +${bad.length + ambiguous.length - 40}`);
process.exit(bad.length ? 1 : 0);
