#!/usr/bin/env node
// Step 2 helper: list the spec documents for a scope from test.config.json `specPaths`.
//
//   node find-spec.mjs <scope keyword>... [--config test.config.json] [--json]
//
// specPaths entries: a folder (relative to the repo or absolute, e.g. a shared drive / SVN checkout) or
// { "path", "kind", "match": ["*{scope}*.xlsx", ...], "exclude": [...], "kinds": { "API_*": "api" }, "scopeMatch": ["WEB*"] }
// (`exclude`: glob on the file name, or with "/" on the path relative to `path`: "**/old/**", "mobile/**";
//  `scopeMatch`: entry used only when a given scope matches one of the globs)
// (`kinds`: first glob matching the file name sets that file's kind, else `kind`). `{scope}` is replaced by each
// keyword; `scopes` in the config adds the scope's other names (feature name, API IDs). Prints kind, modified date, size and path per hit, ordered by `specPrecedence` (kinds), so
// spec-sources.md can cite exact files and their version. Read-only.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const cfgPath = argv.includes("--config") ? argv[argv.indexOf("--config") + 1] : "test.config.json";
const asJson = argv.includes("--json");
const given = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--config");
if (!given.length || !existsSync(cfgPath)) {
  console.error("usage: find-spec.mjs <scope keyword>... [--config test.config.json] [--json]");
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
// `scopes` maps a scope to its other names (feature name, API IDs...): { "SCR-101": ["Sample Form", "API-001"] }
const keywords = [...new Set(given.flatMap((k) => [k, ...((cfg.scopes || {})[k] || [])]))];
const root = path.dirname(path.resolve(cfgPath));
const precedence = cfg.specPrecedence || [];
const DOC = /\.(xlsx|xlsm|xls|docx|doc|pdf|pptx|md|txt|csv|html?)$/i;
const SKIP = /(^|[\\/])(\.svn|\.git|node_modules)([\\/]|$)/;

// path glob (pattern contains "/"): ** = any folders, * = within one folder; matched against the path relative to the entry
const pathGlobRe = (g) =>
  new RegExp(
    `^${g
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")
      .replace(/\*\*/g, "\u0001")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*")}$`,
    "i"
  );
// glob with * and ? only, case-insensitive, matched against the file name
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

const entries = (cfg.specPaths || []).map((e) => (typeof e === "string" ? { path: e } : e));
const hits = [];
for (const e of entries) {
  const base = path.isAbsolute(e.path) ? e.path : path.join(root, e.path);
  if (!existsSync(base)) {
    console.error(`[vuong-test] specPaths not found: ${base}`);
    continue;
  }
  const kw = keywords.map((k) => k.toLowerCase());
  const pats = (e.match || ["*{scope}*"]).flatMap((m) => keywords.map((k) => globRe(m.replaceAll("{scope}", k))));
  // scopeMatch: this entry is used only for scopes matching one of the globs (e.g. ["WEB*"])
  if (e.scopeMatch && !given.some((g) => [].concat(e.scopeMatch).some((m) => globRe(m).test(g)))) continue;
  // exclude: a pattern with "/" matches the relative path (e.g. "**/old/**"), otherwise the file name
  const excl = (e.exclude || []).map((g) => (g.includes("/") ? { path: pathGlobRe(g) } : { name: globRe(g) }));
  const excluded = (name, relPosix) => excl.some((x) => (x.path ? x.path.test(relPosix) : x.name.test(name)));
  // per-file kind: first glob (file name) in `kinds` that matches wins, else the entry's kind
  const kindRules = Object.entries(e.kinds || {}).map(([g, k]) => [keywords.map((kw) => globRe(g.replaceAll("{scope}", kw))), k]);
  const kindFor = (name) => (kindRules.find(([res]) => res.some((r) => r.test(name))) || [, e.kind || "doc"])[1];
  for (const rel of readdirSync(base, { recursive: true })) {
    const f = path.join(base, String(rel));
    if (SKIP.test(f) || !DOC.test(f)) continue;
    const name = path.basename(f);
    const relLow = String(rel).toLowerCase();
    // a hit: the file name matches a pattern, or a folder on its path names the scope
    const inFolder = kw.some((k) => path.dirname(relLow).includes(k));
    if (!(pats.some((p) => p.test(name)) || inFolder) || excluded(name, String(rel).split(path.sep).join("/"))) continue;
    const st = statSync(f);
    if (st.isFile()) hits.push({ kind: kindFor(name), path: f, modified: st.mtime.toISOString().slice(0, 10), size: st.size });
  }
}
const rank = (k) => (precedence.includes(k) ? precedence.indexOf(k) : precedence.length);
hits.sort((a, b) => rank(a.kind) - rank(b.kind) || b.modified.localeCompare(a.modified));

if (asJson) console.log(JSON.stringify({ precedence, hits }, null, 2));
else {
  if (precedence.length) console.log(`precedence: ${precedence.join(" > ")}`);
  for (const h of hits) console.log(`${h.kind.padEnd(12)} ${h.modified}  ${String(Math.round(h.size / 1024)).padStart(6)} KB  ${h.path}`);
  console.log(`[vuong-test] ${hits.length} spec file(s) for ${keywords.join(", ")}`);
}
process.exit(hits.length ? 0 : 1);
