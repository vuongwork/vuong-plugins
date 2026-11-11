#!/usr/bin/env node
// Project config = test.config.json (committed, shared) + test.config.local.json (this machine, gitignored).
//
//   node config.mjs [--config test.config.json] --check     exit 1 when a value for this machine is missing
//   node config.mjs [--config test.config.json] --set NAME=value [NAME=value ...]   write into the local file
//   node config.mjs [--config test.config.json] --print     the resolved config as JSON
//
// Shared file: `"vars": { "DESIGN_SPECS": "<what it is, used as the question>" }` and `${DESIGN_SPECS}` anywhere
// in a string value. Local file: `"vars": { "DESIGN_SPECS": "D:/specs" }` plus any key to override for this
// machine (objects merge, arrays and values replace), e.g. `"environments": { "local": { "baseUrl": "..." } }`.
// A value comes from the environment variable of the same name first (CI), then the local file.
// `~` at the start of a value means the home folder. No secrets in either file.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

export const localPathFor = (cfgFile) => cfgFile.replace(/(\.json)?$/i, ".local.json");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`[vuong-test] cannot read ${file}: ${e.message}`);
  }
}

export class ConfigError extends Error {}

function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

const home = (s) => (s === "~" ? os.homedir() : /^~[\\/]/.test(s) ? path.join(os.homedir(), s.slice(2)) : s);

function walk(v, fn) {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, fn));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, fn)]));
  return v;
}

/** The config without "$comment" keys, at any depth. */
function dropComments(v) {
  if (Array.isArray(v)) return v.map(dropComments);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$comment").map(([k, x]) => [k, dropComments(x)]));
  return v;
}

const namesIn = (v) => [...JSON.stringify(v ?? null).matchAll(VAR)].map((m) => m[1]);

/** Everything known about the config, without failing. */
export function inspectConfig(cfgFile = "test.config.json", { env = process.env } = {}) {
  const file = path.resolve(cfgFile);
  const localFile = localPathFor(file);
  const shared = readJson(file);
  const hasLocal = existsSync(localFile);
  const local = hasLocal ? readJson(localFile) : {};
  const desc = isObj(shared.vars) ? shared.vars : {};
  const localVars = isObj(local.vars) ? local.vars : {};
  // "$comment" keys are explanations for people: a `${NAME}` written inside one is not a variable to ask for
  const { vars: _s, ...sharedRest } = shared;
  const { vars: _l, ...localRest } = local;
  const merged = dropComments(merge(sharedRest, localRest));
  // Only the names this project's config declares (folder paths / URLs) are looked up; values stay on this
  // machine, are never sent anywhere, and must not be secrets (accounts use core/account.mjs).
  const used = [...new Set([...Object.keys(desc), ...namesIn(merged)])];
  const values = {};
  const from = {};
  for (const n of used) {
    const v = env[n] != null && env[n] !== "" ? env[n] : localVars[n] != null && localVars[n] !== "" ? String(localVars[n]) : null;
    if (v != null) {
      values[n] = home(v);
      from[n] = env[n] != null && env[n] !== "" ? "env" : "local";
    }
  }
  const missing = used.filter((n) => !(n in values)).map((n) => ({ name: n, desc: typeof desc[n] === "string" ? desc[n] : "" }));
  const config = walk(merged, (s) => home(s.replace(VAR, (m, n) => (n in values ? values[n] : m))));
  // vars used as folders: specPaths[].path and stacks[].dir must exist on this machine
  const root = path.dirname(file);
  const folderVars = new Set([
    ...(merged.specPaths || []).flatMap((e) => namesIn(typeof e === "string" ? e : e?.path)),
    ...(merged.stacks || []).flatMap((s) => namesIn(s?.dir)),
  ]);
  const notFound = [...folderVars]
    .filter((n) => n in values && !existsSync(path.resolve(root, values[n])))
    .map((n) => ({ name: n, value: values[n], desc: typeof desc[n] === "string" ? desc[n] : "" }));
  return { file, localFile, hasLocal, root, config, values, from, missing, notFound, git: gitState(root, localFile) };
}

/**
 * tracked: the local file is committed (it must not be); ignored: .gitignore covers it. null outside git.
 * Read-only git queries (rev-parse, ls-files, check-ignore); nothing is staged, changed or sent.
 */
function gitState(root, localFile) {
  const rel = path.relative(root, localFile);
  const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  const inRepo = git(["rev-parse", "--is-inside-work-tree"]);
  if (inRepo.status !== 0) return null;
  return { tracked: git(["ls-files", "--error-unmatch", rel]).status === 0, ignored: git(["check-ignore", "-q", rel]).status === 0 };
}

/**
 * The resolved config. strict (default): throws ConfigError when a ${VAR} has no value on this machine.
 * Not strict: unresolved ${VAR} are left as they are.
 */
export function loadConfig(cfgFile = "test.config.json", { strict = true, env } = {}) {
  const r = inspectConfig(cfgFile, { env });
  if (strict && r.missing.length) throw new ConfigError(missingMessage(r));
  return r.config;
}

function missingMessage(r) {
  return (
    `[vuong-test] ${r.missing.length} value(s) for this machine missing in ${path.basename(r.localFile)}:\n` +
    r.missing.map((m) => `  ${m.name}${m.desc ? ` — ${m.desc}` : ""}`).join("\n") +
    `\nRun: node <plugin>/core/config.mjs --check   (then --set NAME=<value>)`
  );
}

/** Write NAME=value pairs into the local file's vars (creates the file). */
export function setVars(cfgFile, pairs) {
  const localFile = localPathFor(path.resolve(cfgFile));
  const local = existsSync(localFile) ? readJson(localFile) : { $comment: LOCAL_COMMENT };
  local.vars = { ...(isObj(local.vars) ? local.vars : {}), ...pairs };
  writeFileSync(localFile, `${JSON.stringify(local, null, 2)}\n`);
  return localFile;
}

export const LOCAL_COMMENT =
  "vuong-test: values for THIS machine only (gitignored, never commit). vars: values for ${NAME} in test.config.json; other keys override it. No passwords.";

// ── CLI ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cfg = argv.includes("--config") ? argv[argv.indexOf("--config") + 1] : "test.config.json";
  const usage = "usage: config.mjs [--config test.config.json] --check | --print | --set NAME=value [NAME=value ...]";
  if (!existsSync(cfg)) {
    console.error(`[vuong-test] ${cfg} not found (run core/init.mjs <repo> first)\n${usage}`);
    process.exit(2);
  }
  try {
    if (argv.includes("--set")) {
      const pairs = {};
      for (const a of argv.slice(argv.indexOf("--set") + 1)) {
        if (a.startsWith("--")) break;
        const i = a.indexOf("=");
        if (i < 1) {
          console.error(`[vuong-test] --set expects NAME=value, got: ${a}`);
          process.exit(2);
        }
        pairs[a.slice(0, i)] = a.slice(i + 1);
      }
      console.log(`[vuong-test] set ${Object.keys(pairs).join(", ")} in ${setVars(cfg, pairs)}`);
      process.exit(0);
    }
    const r = inspectConfig(cfg);
    if (argv.includes("--print")) {
      console.log(JSON.stringify(r.config, null, 2));
      process.exit(0);
    }
    if (!argv.includes("--check")) {
      console.error(usage);
      process.exit(2);
    }
    const name = path.basename(r.localFile);
    let bad = false;
    if (r.git?.tracked) {
      bad = true;
      console.log(`✗ ${name} is committed to git. It holds this machine's paths only. Run: git rm --cached ${name}  (and keep it in .gitignore)`);
    } else if (r.git && !r.git.ignored) console.log(`⚠ ${name} is not in .gitignore. Run core/init.mjs <repo> or add the line: ${name}`);
    if (r.missing.length) {
      bad = true;
      console.log(`✗ missing on this machine (${r.hasLocal ? name : `${name} does not exist yet`}):`);
      for (const m of r.missing) console.log(`  ${m.name}${m.desc ? ` — ${m.desc}` : " — (no description in test.config.json vars)"}`);
    }
    if (r.notFound.length) {
      bad = true;
      console.log("✗ folder does not exist on this machine:");
      for (const m of r.notFound) console.log(`  ${m.name} = ${m.value}${m.desc ? ` — ${m.desc}` : ""}`);
    }
    if (bad) {
      console.log(`Ask the user one question per name above (the text after — is what it is), then:\n  node <plugin>/core/config.mjs --set NAME=<value> ...`);
      process.exit(1);
    }
    const n = Object.keys(r.values).length;
    const env = Object.values(r.from).filter((f) => f === "env").length;
    console.log(`[vuong-test] config ok: ${n} var(s)${n ? ` (${n - env} from ${name}, ${env} from environment)` : ""}`);
  } catch (e) {
    console.error(e instanceof ConfigError ? e.message : e.stack);
    process.exit(2);
  }
}
