#!/usr/bin/env node
// Step 7 in one command: run every stack of test.config.json for a scope, collect, render the report.
//
//   node run.mjs <scope | W> [--env <name>] [--only ut,api] [--skip e2e] [--manual <filled runbook.xlsx>]...
//                [--merge] [--keep] [--no-report] [--dry] [--config test.config.json]
//   node run.mjs <scope | W> --page-map [.,edit?id=1]   → W/page-map.md (core/page-map.mjs with the server up)
//
// For each `stacks[]` entry (in order): delete its stale `results` files, run `run` in `dir` (`<scope>` /
// `{scope}` replaced), then build the collect.mjs arguments from `results` / `coverage` (result files inside W are
// read with --e2e-dir / --api-dir so parallel groups W/e2e-<g>/, W/api-<g>/ are included), add W/run-notes*.md,
// W/diff.md, W/data-created.md, and render W/report/index.html.
// Server: `environments.<env>.server` = { "start": "npm start", "ready": "<url that answers when up>",
//   "cwd": ".", "env": {…}, "fresh": "per-stack" | "once" } → started before the first stack that needs it and
//   stopped at the end; "per-stack" (default) restarts it before each stack (clean in-memory data). A stack with
//   "server": false (unit tests) runs without it. Something already answering on `ready` → stop, since the data
//   could not be known clean (unless "fresh": "none": use the running server).
// A failing test is a result, not an error: exit 0 when the report was written; 1 = a stack could not run or
// collect failed; 2 = usage / config error. --merge: rerun of a subset (E2E_MERGE=1 / API_MERGE=1, results kept).
// --dry prints the plan (commands + collect arguments) and runs nothing. Runs that need the server take a lock
// (<workDir>/_out/run.lock): a second run waits for the first (server.lockWaitSec, default 1800) — unless
// server.portEnv is set: a run finding the port busy then gets its own server on a free port and does not wait.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ConfigError } from "./config.mjs";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `run.mjs <scope | W> [--env <name>] [--only ids] [--skip ids] [--files f,…] [--merge] [--manual <runbook.xlsx>]... [--keep] [--no-report] [--dry] [--config f]
       run.mjs <scope | W> --page-map [.,x?id=1]   (step 6, paths relative to baseUrl, comma-separated: selectors of each page → W/page-map.md, server started / stopped here)
  Runs every stacks[] entry of test.config.json (in order), with a fresh server from environments.<env>.server for
  the stacks that need it, then collect → W/results.json (cases[].status) and W/report/index.html.
  Each stack gets env BASE_URL (environments.<env>.baseUrl), API_BASE (apiBase, else baseUrl), VT_ENV, VT_SCOPE.
  --only/--skip: stack ids · --merge: rerun a subset, keep other results (E2E_MERGE=1 / API_MERGE=1) · --dry: print the plan.
  A stack with "each": "<glob>" runs once per matching file ({file} in run); --files a,b runs only those (a parallel group's dry run).
  One server run at a time per repo (lock <workDir>/_out/run.lock; others wait), unless server.portEnv: a run finding the port busy gets its own server on a free port. Exit 0 = report written (failing tests are results).`;
const argv = process.argv.slice(2);
const opt = { merge: false, files: null, only: null, skip: [], manual: [], keep: false, report: true, dry: false, env: null, config: "test.config.json", target: null, pageMap: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v == null) die(`${a}: value missing`, 2);
    return v;
  };
  if (a === "--only") opt.only = next().split(",");
  else if (a === "--skip") opt.skip = next().split(",");
  else if (a === "--manual") opt.manual.push(next());
  else if (a === "--files") opt.files = next().split(",");
  else if (a === "--env") opt.env = next();
  else if (a === "--config") opt.config = next();
  else if (a === "--keep") opt.keep = true;
  else if (a === "--merge") opt.merge = true;
  else if (a === "--no-report") opt.report = false;
  else if (a === "--dry") opt.dry = true;
  // paths relative to baseUrl, no leading "/" (Git Bash rewrites /x into a Windows path): "", "edit?id=1"
  else if (a === "--page-map") opt.pageMap = opt.target && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[++i] : ".";
  else if (a === "--help" || a === "-h") {
    console.log(HELP);
    process.exit(0);
  } else if (!a.startsWith("--") && !opt.target) opt.target = a;
  else die(`unknown argument: ${a}`, 2);
}
function die(msg, code = 1) {
  console.error(`[vuong-test run] ${msg}`);
  process.exit(code);
}
if (!opt.target) die("usage: run.mjs <scope | W> [--env <name>] [--only ids] [--skip ids] [--manual f] [--keep] [--no-report] [--dry]", 2);

let cfg;
try {
  cfg = loadConfig(opt.config);
} catch (e) {
  die(e instanceof ConfigError ? e.message : `cannot read ${opt.config}: ${e.message}`, 2);
}
const ROOT = path.dirname(path.resolve(opt.config));
const isDir = (d) => existsSync(d) && statSync(d).isDirectory();
const W = isDir(opt.target) ? path.resolve(opt.target) : path.resolve(ROOT, cfg.workDir || "test-work", opt.target);
if (!isDir(W)) die(`no work folder ${W}`, 2);
const scope = path.basename(W);
const sub = (s) => String(s ?? "").replace(/<scope>|\{scope\}/g, scope);
const inW = (p) => !path.relative(W, p).startsWith("..") && !path.isAbsolute(path.relative(W, p));
const log = (m) => console.log(`[run] ${m}`);

const stacks = (cfg.stacks || []).filter((s) => (!opt.only || opt.only.includes(s.id)) && !opt.skip.includes(s.id));
if (!stacks.length) die(`no stack to run (test.config.json stacks: ${(cfg.stacks || []).map((s) => s.id).join(", ") || "none"})`, 2);

// environment: --env, else the only one, else "local"
const envs = Array.isArray(cfg.environments)
  ? Object.fromEntries(cfg.environments.map((e) => [e.name, e]))
  : cfg.environments || {};
const envName = opt.env || (Object.keys(envs).length === 1 ? Object.keys(envs)[0] : "local");
if (opt.env && !envs[opt.env]) die(`--env ${opt.env}: not in test.config.json environments (${Object.keys(envs).join(", ")})`, 2);
let server = envs[envName]?.server || null;
// what a test file needs to know, so it never reads the config or this script: env vars set for every stack
let E = envs[envName] || {};
const stackEnv = {
  ...process.env,
  VT_ENV: envName,
  VT_SCOPE: scope,
  ...(E.baseUrl ? { BASE_URL: E.baseUrl } : {}),
  ...(E.apiBase || E.baseUrl ? { API_BASE: E.apiBase || E.baseUrl } : {}),
  ...(opt.merge ? { E2E_MERGE: "1", API_MERGE: "1" } : {}),
};
const fresh = server?.fresh || "per-stack";

// ── server ──────────────────────────────────────────────────────────────────
let proc = null;
const answers = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.status < 500;
  } catch {
    return false;
  }
};
const until = async (cond, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout (${ms / 1000}s) waiting for ${what}`);
};
async function startServer() {
  if (fresh === "none" && (await answers(server.ready))) return log(`using the server already on ${server.ready}`);
  if (await answers(server.ready)) throw new Error(`${server.ready} already answers — stop that server first (clean data needed), or set "fresh": "none"`);
  proc = spawn(server.start, {
    cwd: path.resolve(ROOT, server.cwd || "."),
    env: { ...process.env, ...(server.env || {}) },
    shell: true,
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  proc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await until(() => answers(server.ready), (server.timeoutSec || 30) * 1000, `${server.ready}`);
  log(`server up: ${server.start} → ${server.ready}`);
}
async function stopServer() {
  if (!proc) return;
  const p = proc;
  proc = null;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await until(async () => !(await answers(server.ready)), 15000, "server stop").catch((e) => log(e.message));
  log("server stopped");
}
const onExit = () => {
  if (proc && process.platform === "win32") spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else if (proc) try { process.kill(-proc.pid, "SIGTERM"); } catch { /* gone */ }
};
process.on("SIGINT", () => {
  onExit();
  process.exit(130);
});

// ── collect arguments ───────────────────────────────────────────────────────
const KEY = { "jest-json": "--jest-json", junit: "--junit", "e2e-json": "--e2e-json", "api-json": "--api-json" };
function collectArgs() {
  const a = ["--cases", path.join(W, "cases.md"), "--out", path.join(W, "results.json"), "--root", ROOT];
  const dirs = new Set();
  for (const s of stacks) {
    for (const [k, rel] of opt.merge ? [] : Object.entries(s.results || {})) {
      const p = path.resolve(ROOT, sub(rel));
      if (!KEY[k]) die(`stack ${s.id}: unknown results key "${k}" (jest-json / junit / e2e-json / api-json)`, 2);
      if ((k === "e2e-json" || k === "api-json") && inW(p)) dirs.add(k === "e2e-json" ? "--e2e-dir" : "--api-dir");
      else if (opt.dry || existsSync(p)) a.push(KEY[k], p, ...(k === "junit" ? ["--stack", s.stack || s.id] : []));
      else log(`stack ${s.id}: no ${k} at ${path.relative(ROOT, p)} — its cases will be NOT RUN`);
    }
    if (s.coverage) {
      const p = path.resolve(ROOT, sub(s.coverage));
      if (opt.dry || existsSync(p)) a.push("--coverage", p, "--label", s.id);
    }
  }
  for (const d of dirs) a.push(d, W);
  if (readdirSync(W).some((f) => /^run-notes.*\.md$/.test(f))) a.push("--notes-dir", W);
  if (existsSync(path.join(W, "diff.md"))) a.push("--diff", path.join(W, "diff.md"));
  if (existsSync(path.join(W, "data-created.md"))) a.push("--data", path.join(W, "data-created.md"));
  for (const m of opt.manual) a.push("--manual", path.resolve(m));
  return a;
}
const node = (script, args) => spawnSync(process.execPath, [path.join(PLUGIN, "core", script), ...args], { cwd: ROOT, stdio: "inherit" });

// ── "each": one run per matching file (parallel groups W/e2e-a.mjs, W/e2e-b.mjs …), {file} in `run` ──────────
const globFiles = (pattern) => {
  const abs = path.resolve(ROOT, sub(pattern));
  const dir = path.dirname(abs);
  const re = new RegExp(`^${path.basename(abs).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return isDir(dir) ? readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)) : [];
};
// [null] = a plain stack (one run); --files keeps only those files of an "each" stack
const filesOf = (s) => (!s.each ? [null] : globFiles(s.each).filter((f) => !opt.files || opt.files.some((x) => path.resolve(ROOT, x) === f)));
// the kit's `out` for a file: W/e2e-a.mjs → W/e2e-a/ (file name without extension, next to it)
const outDirOf = (f) => path.join(path.dirname(f), path.basename(f).replace(/\.[^.]+$/, ""));

// ── run ─────────────────────────────────────────────────────────────────────
const needs = (s) => !!server && s.server !== false;
const wantServer = opt.pageMap ? !!server : stacks.some(needs);
if (opt.dry) {
  const short = (x) => (path.isAbsolute(x) ? path.relative(ROOT, x) || "." : x);
  log(`scope ${scope} · W ${path.relative(ROOT, W) || "."} · env ${envName}${server ? ` · server "${server.start}" (${fresh})` : ""}`);
  for (const s of stacks)
    for (const f of filesOf(s)) log(`${s.id}: (${sub(s.dir || ".")}) ${f ? sub(s.run).replace(/\{file\}/g, path.relative(path.resolve(ROOT, sub(s.dir || ".")), f).replace(/\\/g, "/")) : sub(s.run)}${needs(s) ? " [server]" : ""}`);
  if (!opt.merge && stacks.some((s) => s.run && Object.keys(s.results || {}).length))
    log(`each stack deletes its old result files before it runs (--merge keeps them) — no cleanup needed`);
  log(`collect ${collectArgs().map(short).map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ")}`);
  if (opt.report) log(`render-html ${short(path.join(W, "results.json"))} --out ${short(path.join(W, "report"))}${opt.keep ? " --keep" : ""}`);
  process.exit(0);
}

// One server run at a time per repo: parallel writers' dry runs queue here (fresh server each, same port)
// instead of starting their own server. Lock = <workDir>/_out/run.lock with the owner's pid; a dead owner's lock is taken over.
const LOCK = path.join(ROOT, cfg.workDir || "test-work", "_out", "run.lock");
const ownLock = () => existsSync(LOCK) && readFileSync(LOCK, "utf8").split(" ")[0] === String(process.pid);
// once = true: one try, false when another live run holds it (dead owner: taken over)
async function takeLock(once = false) {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  const end = Date.now() + (server.lockWaitSec ?? 1800) * 1000;
  let said = false;
  for (;;) {
    try {
      writeFileSync(LOCK, `${process.pid} ${scope} ${new Date().toISOString()}`, { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const pid = Number(readFileSync(LOCK, "utf8").split(" ")[0]);
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (e) {
      alive = e.code === "EPERM";
    }
    if (!alive) {
      rmSync(LOCK, { force: true });
      continue;
    }
    if (once) return false;
    if (!said) log(`another run (pid ${pid}) is using the server — waiting for it to finish`);
    said = true;
    if (Date.now() > end) die(`waited ${(server.lockWaitSec ?? 1800) / 60} min for run pid ${pid} — ${LOCK}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
process.on("exit", () => ownLock() && rmSync(LOCK, { force: true }));
// server.portEnv ("PORT"): a run that finds the configured port taken by another run (a parallel writer's dry run)
// starts its own server on a free port instead of waiting — that env var set, the port in baseUrl / apiBase /
// ready rewritten. A run with nobody else keeps the configured port. Only for a server whose data is its own
// (in memory, per-instance test DB); one sharing a DB leaves portEnv out and queues on the lock.
if (wantServer && !(await takeLock(!!server.portEnv))) {
  const net = await import("node:net");
  const port = await new Promise((ok, ko) => {
    const s = net.createServer().once("error", ko).listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
  const at = (u) => u && String(u).replace(/^(\w+:\/\/[^/:?#]+)(:\d+)?/, `$1:${port}`);
  server = { ...server, ready: at(server.ready), env: { ...(server.env || {}), [server.portEnv]: String(port) } };
  if (E.baseUrl) stackEnv.BASE_URL = at(E.baseUrl);
  if (E.apiBase || E.baseUrl) stackEnv.API_BASE = at(E.apiBase || E.baseUrl);
  log(`port in use by another run — own server on port ${port}`);
}

// --page-map: the server up (own port when busy, as above), core/page-map.mjs → W/page-map.md, nothing else run
if (opt.pageMap) {
  if (!stackEnv.BASE_URL) die("--page-map: no baseUrl in environments." + envName, 2);
  let r = { status: 1 };
  try {
    if (server) await startServer();
    r = spawnSync(process.execPath, [path.join(PLUGIN, "core", "page-map.mjs"), "--base", stackEnv.BASE_URL, "--paths", opt.pageMap, "--out", path.join(W, opt.files?.length === 1 ? `page-map-${path.basename(opt.files[0]).replace(/\.[^.]+$/, "")}.md` : "page-map.md")], { cwd: ROOT, stdio: "inherit", env: stackEnv });
  } catch (e) {
    console.error(`[run] ${e.message}`);
  } finally {
    await stopServer();
  }
  process.exit(r.status ?? 1);
}

let broken = 0;
const status = [];
try {
  for (const s of stacks) {
    if (!s.run) {
      log(`stack ${s.id}: no "run" command — skipped`);
      continue;
    }
    const files = filesOf(s);
    if (s.each && !files.length) {
      log(`stack ${s.id}: no file matches ${sub(s.each)}${opt.files ? ` among --files` : ""} — skipped`);
      continue;
    }
    // stale results must not be reported as this run's (--merge keeps them: the kit merges into them).
    // "each" stack: only the result files of the files run now (W/e2e-a.mjs → W/e2e-a/e2e-results.json), so a
    // parallel group's dry run leaves the other groups' results alone. Otherwise: the configured files, and for
    // results inside W the parallel-group files collect picks up (W/e2e*/e2e-results.json, W/api*/api-results.json).
    for (const [k, rel] of opt.merge ? [] : Object.entries(s.results || {})) {
      const p = path.resolve(ROOT, sub(rel));
      const file = k === "e2e-json" ? "e2e-results.json" : k === "api-json" ? "api-results.json" : null;
      if (s.each) {
        if (file) for (const f of files) rmSync(path.join(outDirOf(f), file), { force: true });
        continue;
      }
      rmSync(p, { force: true });
      if (file && inW(p)) {
        const pre = file.split("-")[0];
        rmSync(path.join(W, file), { force: true });
        for (const d of readdirSync(W)) if (d.startsWith(pre) && isDir(path.join(W, d))) rmSync(path.join(W, d, file), { force: true });
      }
    }
    const cwd = path.resolve(ROOT, sub(s.dir || "."));
    mkdirSync(path.join(ROOT, cfg.workDir || "test-work", "_out"), { recursive: true });
    const t0 = Date.now();
    let r;
    for (const f of files) {
      if (needs(s) && (fresh === "per-stack" || !proc)) {
        await stopServer();
        await startServer();
      } else if (!needs(s)) await stopServer();
      const cmd = f ? sub(s.run).replace(/\{file\}/g, path.relative(cwd, f).replace(/\\/g, "/")) : sub(s.run);
      log(`${s.id}: ${cmd}`);
      r = spawnSync(cmd, { cwd, shell: true, stdio: "inherit", env: stackEnv, windowsHide: true });
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(0);
    const made = s.each
      ? files.every((f) => ["e2e-results.json", "api-results.json"].some((x) => existsSync(path.join(outDirOf(f), x))))
      : Object.values(s.results || {}).some((rel) => existsSync(path.resolve(ROOT, sub(rel))));
    status.push(`${s.id}: exit ${r.status ?? r.error?.message} · ${sec}s${made ? "" : " · NO RESULTS FILE"}`);
    // a non-zero exit with a results file = tests failed (a result); without one = the stack did not run
    if (!made && Object.keys(s.results || {}).length) broken++;
  }
} catch (e) {
  console.error(`[run] ${e.message}`);
  broken++;
} finally {
  await stopServer();
}
for (const l of status) log(l);

const c = node("collect.mjs", collectArgs());
if (c.status !== 0) die(`collect.mjs exit ${c.status}`);
if (opt.report) {
  const h = node("render-html.mjs", [path.join(W, "results.json"), "--out", path.join(W, "report"), ...(opt.keep ? ["--keep"] : [])]);
  if (h.status !== 0 && h.status !== 1) die(`render-html.mjs exit ${h.status}`); // 1 = some case failed: a result
}
process.exit(broken ? 1 : 0);
