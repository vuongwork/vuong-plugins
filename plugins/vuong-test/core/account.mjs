#!/usr/bin/env node
// Test account file: create it for the user, then check it — never prints a value.
//
//   node account.mjs <file> --vars E2E_USER,E2E_PW
//
// File missing → created with one empty `export NAME=` line per variable, mode 600; the user only fills the values.
// File present → reports which variables are missing or empty (values are never printed). Exit 0 = all set, 1 = not yet.
// Refuses a path inside the current folder (it could be committed). Tests read it with `source <file>` before running.
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const vi = argv.indexOf("--vars");
const vars = vi >= 0 ? String(argv[vi + 1] || "").split(",").map((v) => v.trim()).filter(Boolean) : [];
const raw = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--vars");
if (!raw || !vars.length) {
  console.error("usage: account.mjs <file> --vars NAME1,NAME2,...");
  process.exit(2);
}
const file = path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
const cwd = path.resolve(process.cwd());
if (file === cwd || file.startsWith(cwd + path.sep)) {
  console.error(`[vuong-test] ${file} is inside the current folder — keep accounts outside the repo (e.g. ~/.${path.basename(cwd)}-test-account.sh)`);
  process.exit(2);
}
const bad = vars.filter((v) => !/^[A-Za-z_]\w*$/.test(v));
if (bad.length) {
  console.error(`[vuong-test] not a variable name: ${bad.join(", ")}`);
  process.exit(2);
}
if (!existsSync(file)) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# test account — fill the values, keep this file out of git\n${vars.map((v) => `export ${v}=`).join("\n")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`[vuong-test] created ${file} (mode 600) with empty ${vars.join(", ")}.\nFill the values after "=" (quote values with spaces), save, then tell Claude "done".`);
  process.exit(1);
}
const text = readFileSync(file, "utf8");
const val = {};
for (const line of text.split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)=(.*)$/.exec(line);
  if (m) val[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
}
const missing = vars.filter((v) => !(v in val));
const empty = vars.filter((v) => v in val && !val[v]);
const mode = statSync(file).mode & 0o777;
if (mode & 0o077) console.log(`[vuong-test] warning: ${file} is readable by others (mode ${mode.toString(8)}) — chmod 600`);
if (!missing.length && !empty.length) {
  console.log(`[vuong-test] ${file}: ${vars.join(", ")} set. Run tests with: source ${file} && <test command>`);
  process.exit(0);
}
console.log(
  `[vuong-test] ${file}: ` +
    [empty.length ? `empty: ${empty.join(", ")}` : "", missing.length ? `missing: ${missing.join(", ")} (add a line \`export NAME=value\`)` : ""].filter(Boolean).join("; ")
);
process.exit(1);
