#!/usr/bin/env node
// Set up vuong-test in a project: test.config.json + test.config.local.json (this machine) + work dir +
// .gitignore entries. Never overwrites. Safe to run again by every member after cloning.
//
//   node init.mjs <repo-root>
import { existsSync, mkdirSync, copyFileSync, readFileSync, appendFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectConfig, localPathFor, LOCAL_COMMENT } from "./config.mjs";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] || ".");
const cfg = path.join(root, "test.config.json");

// detect stacks to suggest (the user still edits the config)
const has = (f) => existsSync(path.join(root, f));
const pkg = has("package.json") ? JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) : null;
const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
const found = [];
if (deps.jest || has("jest.config.js")) found.push("jest");
if (deps.vitest) found.push("vitest");
if (deps.playwright || deps["@playwright/test"]) found.push("playwright");
if (has("pom.xml")) found.push("java-maven");
if (has("build.gradle") || has("build.gradle.kts")) found.push("java-gradle (planned)");
for (const d of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [])
  if (d.isDirectory() && existsSync(path.join(root, d.name, "pom.xml"))) found.push(`java-maven in ${d.name}/`);

if (existsSync(cfg)) console.log(`exists, kept: ${cfg}`);
else {
  copyFileSync(path.join(PLUGIN, "templates", "test.config.json"), cfg);
  console.log(`created: ${cfg} (template — edit stacks/run/results for this project)`);
}
mkdirSync(path.join(root, "test-work"), { recursive: true });
const gi = path.join(root, ".gitignore");
// committed: spec-sources, flows, cases, diff, data-plan, data-created, run-notes, test code.
// not committed: reports, screenshots, raw results, caches.
const IGNORE = [
  "test.config.local.json",
  "test-work/_out/",
  "test-work/_spec/",
  "test-work/*/report/",
  "test-work/*/e2e*/",
  "test-work/*/results.json",
  "test-work/*/manual/",
  "test-work/*/cases-summary.md",
  "test-work/*/.cache/",
  "test-work/*/*cache*.json",
];
const have = existsSync(gi) ? readFileSync(gi, "utf8").split(/\r?\n/).map((l) => l.trim()) : [];
const missing = IGNORE.filter((e) => !have.includes(e));
if (missing.length) {
  const lead = have.length && have[have.length - 1] !== "" ? "\n" : "";
  appendFileSync(gi, `${lead}\n# vuong-test: this machine's paths, reports, screenshots, raw results, caches (cases/flows/diff/notes are committed)\n${missing.join("\n")}\n`);
  console.log(`.gitignore += ${missing.join(" ")}`);
} else console.log(".gitignore: vuong-test entries present");
console.log(`detected stacks: ${found.length ? found.join(", ") : "none"}`);
const c = JSON.parse(readFileSync(cfg, "utf8"));
if (!c.specPaths || JSON.stringify(c.specPaths).includes("/abs/path"))
  console.log("specPaths not set: ask where screen and API specs live, then `node <plugin>/core/scan-specs.mjs <folders>`");
// this machine's values for ${VAR} in test.config.json (gitignored above)
const local = localPathFor(cfg);
if (existsSync(local)) console.log(`exists, kept: ${local}`);
else {
  const names = [...new Set([...Object.keys(c.vars && typeof c.vars === "object" ? c.vars : {}), ...[...JSON.stringify(c).matchAll(/\$\{([A-Za-z_]\w*)\}/g)].map((m) => m[1])])];
  writeFileSync(local, `${JSON.stringify({ $comment: LOCAL_COMMENT, vars: Object.fromEntries(names.map((n) => [n, ""])) }, null, 2)}\n`);
  console.log(`created: ${local} (this machine only, not committed)`);
}
const chk = inspectConfig(cfg);
if (chk.missing.length || chk.notFound.length)
  console.log(`this machine needs: ${[...chk.missing, ...chk.notFound].map((m) => m.name).join(", ")} → node <plugin>/core/config.mjs --check`);
