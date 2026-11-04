// Generates kit/fake-api.cjs from kit/fake-api.mjs (single source of truth).
//   node kit/build-cjs.mjs           write fake-api.cjs
//   node kit/build-cjs.mjs --check   exit 1 if fake-api.cjs is out of date
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "fake-api.mjs"), "utf8");
const names = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
if (/^export\s+(?!function)/m.test(src)) {
  console.error("build-cjs: only `export function` is supported in fake-api.mjs");
  process.exit(2);
}
const out = `// GENERATED from fake-api.mjs by kit/build-cjs.mjs — do not edit.\n"use strict";\n` +
  src.replace(/^export function /gm, "function ") + `\nmodule.exports = { ${names.join(", ")} };\n`;
const target = path.join(dir, "fake-api.cjs");
if (process.argv.includes("--check")) {
  const ok = existsSync(target) && readFileSync(target, "utf8") === out;
  console.log(ok ? "fake-api.cjs in sync" : "fake-api.cjs OUT OF SYNC: run node kit/build-cjs.mjs");
  process.exit(ok ? 0 : 1);
}
writeFileSync(target, out);
console.log(`wrote ${target} (${names.join(", ")})`);
