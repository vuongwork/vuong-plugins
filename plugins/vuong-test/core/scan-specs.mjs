#!/usr/bin/env node
// Setup helper: suggest spec folders for test.config.json `specPaths`, grouped by kind
// (screen spec, API spec, acceptance tests, requirements, decisions, mock-ups, old UT...).
//
//   node scan-specs.mjs <folder>... [--depth 6] [--top 6] [--all] [--json]
//
// --top N: folders shown per kind (default 6). Kind "doc" (unclassified) only with --all.
//
// Looks at folder and file names only (read-only, nothing is opened). The user confirms the result;
// it is a suggestion, not a source.
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const depth = argv.includes("--depth") ? Number(argv[argv.indexOf("--depth") + 1]) : 6;
const asJson = argv.includes("--json");
const top = argv.includes("--top") ? Number(argv[argv.indexOf("--top") + 1]) : 6;
const all = argv.includes("--all");
const roots = argv.filter((a, i) => !a.startsWith("--") && !["--depth", "--top"].includes(argv[i - 1]));
if (!roots.length) {
  console.error("usage: scan-specs.mjs <folder>... [--depth 6] [--json]");
  process.exit(2);
}
const DOC = /\.(xlsx|xlsm|xls|docx|doc|pdf|pptx|md|html?|ya?ml|json|csv)$/i;
const SKIP = /^(\.svn|\.git|node_modules|target|dist|build|coverage|\.nuxt|\.next)$/i;
// first match wins; names in EN / JA / VI
const KINDS = [
  ["api", /\b(api|openapi|swagger|endpoint|interface|i\/f)\b|ＡＰＩ|インターフェース|ifs?仕様/i],
  ["decision", /decision|議事録|決定|quyết định|minutes/i],
  ["acceptance", /受入|acceptance|uat|\bqa\b|test ?spec|テスト仕様/i],
  ["ut-old", /単体|unit ?test|\but\b|test ?result|テスト結果/i],
  ["ticket", /backlog|redmine|jira|課題|issues?[ _-]?(list|export|log)|\bissues\b/i],
  ["requirement", /要件|requirement|srs|\brd\b/i],
  ["screen", /画面|screen|detail ?design|詳細設計|基本設計|機能|functional|\bdd\b|\bbd\b|spec/i],
  ["mock", /モック|mock|wireframe|figma|prototype/i],
  ["db", /\bdb\b|er[_ -]?diagram|テーブル|table ?def/i],
];
const kindOf = (s) => (KINDS.find(([, re]) => re.test(s)) || ["doc"])[0];

const folders = new Map(); // folder -> {kind, docs, newest, samples}
function walk(dir, d) {
  if (d > depth) return;
  let list;
  try {
    list = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of list) {
    if (SKIP.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, d + 1);
    else if (DOC.test(e.name) && !e.name.startsWith("~$")) {
      const f = folders.get(dir) || { folder: dir, docs: 0, newest: "", samples: [], kinds: {} };
      const k = kindOf(`${dir}/${e.name}`);
      f.kinds[k] = (f.kinds[k] || 0) + 1;
      f.docs++;
      const m = statSync(p).mtime.toISOString().slice(0, 10);
      if (m > f.newest) f.newest = m;
      if (f.samples.length < 3) f.samples.push(e.name);
      folders.set(dir, f);
    }
  }
}
for (const r of roots) existsSync(r) ? walk(path.resolve(r), 0) : console.error(`not found: ${r}`);

let list = [...folders.values()].map((f) => ({ ...f, subfolders: 0, kind: Object.entries(f.kinds).sort((a, b) => b[1] - a[1])[0][0] }));
// roll up: 3+ sibling folders of one kind (e.g. one folder per screen) become their parent folder
for (let changed = true; changed; ) {
  changed = false;
  const groups = new Map();
  for (const f of list) {
    const key = `${path.dirname(f.folder)}\0${f.kind}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(f);
  }
  for (const [key, fs] of groups) {
    if (fs.length < 3) continue;
    const parent = key.split("\0")[0];
    list = list.filter((f) => !fs.includes(f));
    list.push({
      folder: parent,
      kind: fs[0].kind,
      docs: fs.reduce((s, f) => s + f.docs, 0),
      newest: fs.map((f) => f.newest).sort().pop(),
      samples: fs.slice(0, 3).map((f) => `${path.basename(f.folder)}/`),
      subfolders: fs.reduce((s, f) => s + (f.subfolders || 1), 0),
    });
    changed = true;
  }
}
const out = list.sort((a, b) => a.kind.localeCompare(b.kind) || b.docs - a.docs);
if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  let last = "";
  let n = 0;
  for (const f of out) {
    if (f.kind === "doc" && !all) continue;
    if (f.kind !== last) {
      console.log(`\n## ${(last = f.kind)}`);
      n = 0;
    }
    if (++n > top) continue;
    console.log(`${String(f.docs).padStart(4)} docs  ${f.newest}  ${f.folder}${f.subfolders ? `  (${f.subfolders} subfolders)` : ""}\n            e.g. ${f.samples.join(" | ")}`);
  }
  const need = ["screen", "api"].filter((k) => !out.some((f) => f.kind === k));
  console.log(`\n[vuong-test] ${out.length} folder(s) with documents` + (need.length ? `; none look like: ${need.join(", ")} — ask the user` : ""));
}
