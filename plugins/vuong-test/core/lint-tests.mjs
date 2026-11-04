#!/usr/bin/env node
// Static checks on test files (any language): fixed waits and hard-coded secrets.
//
//   node lint-tests.mjs <file|dir>... [--max-wait 200]
//
// A fixed wait above --max-wait ms (default 200) is an error unless the same line carries `lint-ok:`
// with a reason. Exit 1 on errors.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const maxWait = argv.includes("--max-wait") ? Number(argv[argv.indexOf("--max-wait") + 1]) : 200;
const inputs = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--max-wait");
if (!inputs.length) {
  console.error("usage: lint-tests.mjs <file|dir>... [--max-wait 200]");
  process.exit(2);
}
const EXT = /\.(m?[jt]sx?|java|py|cs|go|php|kt)$/;
const files = inputs.flatMap((p) =>
  statSync(p).isFile()
    ? [p]
    : readdirSync(p, { recursive: true })
        .map((f) => path.join(p, String(f)))
        .filter((f) => EXT.test(f) && !f.includes("node_modules") && statSync(f).isFile())
);

// [regex, unit multiplier to ms]
const WAITS = [
  [/waitForTimeout\(\s*(\d+)/g, 1],
  [/\bsleep\(\s*(\d+)/g, 1],
  [/Thread\.sleep\(\s*(\d+)/g, 1],
  [/time\.sleep\(\s*([\d.]+)/g, 1000],
  [/setTimeout\([^,]+,\s*(\d+)\s*\)/g, 1],
];
const SECRET = /\b(password|passwd|pwd|secret|token)\b\s*[:=]\s*["'][^"'${}]{4,}["']/i;

const errors = [];
let waits = 0;
for (const f of files) {
  readFileSync(f, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/lint-ok:/.test(line)) return;
      for (const [re, mul] of WAITS)
        for (const m of line.matchAll(re)) {
          const ms = Number(m[1]) * mul;
          if (ms > maxWait) {
            waits++;
            errors.push(`${f}:${i + 1}  fixed wait ${ms} ms — wait for a condition instead`);
          }
        }
      if (SECRET.test(line)) errors.push(`${f}:${i + 1}  hard-coded secret — use an env var`);
    });
}
for (const e of errors) console.log(`error ${e}`);
console.log(`[vuong-test] ${files.length} files, ${waits} fixed waits > ${maxWait} ms, ${errors.length} errors`);
process.exit(errors.length ? 1 : 0);
