// Minimal E2E runner for plain Playwright scripts: one browser, cases run in order, a screenshot per case,
// results written in the format `core/collect.mjs --e2e-json` reads. Project-agnostic.
//
//   import { createRun } from "<plugin>/kit/e2e-kit.mjs";
//   const run = await createRun({ out: "test-work/<scope>/e2e", viewport: { width: 1920, height: 1000 } });
//   await run.tc("ID-1", "title", async ({ page, expect, shot, settle }) => { ...; return "note"; });
//   await run.tc("ID-2", "saves", async ({ page }) => { ... }, { writes: true });   // may write data
//   await run.finish();
//
// Playwright is resolved from the project (cwd or opts.from), so the plugin itself has no dependencies.
// Env: E2E_HEADED=1 (show browser), E2E_SLOWMO=<ms> (only to watch), E2E_MERGE=1 (rerun of a subset:
// replace those cases in e2e-results.json, keep the rest).
//
// Options (all optional):
//   api:      RegExp of requests `settle` waits for (default /\/api\//)
//   masks:    CSS selector of loading masks `settle` waits to disappear (default: common UI-library masks)
//   writes:   { allowed: false, readOnlyPosts: [RegExp], allowUrls: [RegExp], auth: [RegExp] }
//             In a case not declared { writes: true } (and in setup / between cases) every non-GET/HEAD/OPTIONS
//             request is aborted, except URLs matching readOnlyPosts (searches sent as POST), allowUrls or
//             auth (default: login/logout/auth/oauth/token/session). allowed: true switches the guard off.
//   env:      { expect?: RegExp, detect?: "url" | async ({page, ctx}) => string, environments?: [{name, match, writable}] }
//   envCheck: async ({page, ctx}) => string   (shortcut for env.detect)
//             A writes:true case is BLOCKED unless the detected environment (default: page URL) matches
//             env.expect (if given) AND an environments[] entry with writable === true. environments defaults to
//             test.config.json in cwd (or opts.config): array [{name, match|baseUrl, writable}] or object
//             { name: { baseUrl, writable } }; an entry matches when the detected string contains match/baseUrl/name.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadEnvironments, writeBlockReason as envBlock, clip, redact, makeVerify } from "./env.mjs";
export { redact };

export class Blocked extends Error {}

export const DEFAULT_MASKS = [
  ".el-loading-mask",
  ".v-overlay--active",
  ".ant-spin-spinning",
  ".MuiBackdrop-root",
  ".loading-mask",
  ".loading-overlay",
  "[aria-busy='true']",
].join(", ");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_AUTH = [/\/(login|logout|auth|oauth2?|token|session)\b/i];

export async function createRun(opts = {}) {
  const out = path.resolve(opts.out || "e2e-out");
  const shotsDir = path.join(out, "shots");
  mkdirSync(shotsDir, { recursive: true });
  const req = createRequire(path.join(path.resolve(opts.from || process.cwd()), "noop.js"));
  const { chromium } = req("playwright");
  const browser = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    slowMo: Number(process.env.E2E_SLOWMO || 0),
  });
  const apiRe = opts.api || /\/api\//;
  const masks = opts.masks || DEFAULT_MASKS;
  const wg = { allowed: false, readOnlyPosts: [], allowUrls: [], auth: DEFAULT_AUTH, ...(opts.writes || {}) };
  const envOpt = { ...(opts.env || {}) };
  if (opts.envCheck) envOpt.detect = opts.envCheck;
  const environments = envOpt.environments || loadEnvironments(path.resolve(opts.config || "test.config.json"));
  const cacheDir = path.resolve(out, "..", ".cache");

  let cur = null; // current case: { writes, aborted[], writesLog[] }
  const outsideAborted = []; // aborted in setup / between cases
  const inflight = new Set();
  const started = new WeakMap();

  const newContext = () => browser.newContext({ viewport: opts.viewport || { width: 1600, height: 1000 } });
  const wire = async (c) => {
    c.on("request", (r) => {
      if (!apiRe.test(r.url())) return;
      inflight.add(r);
      started.set(r, Date.now());
    });
    c.on("requestfinished", (r) => inflight.delete(r));
    c.on("requestfailed", (r) => inflight.delete(r));
    c.on("response", (res) => {
      const r = res.request();
      // FE → BE trace: every API call the screen made in this case (body kept for writes and errors)
      if (cur && apiRe.test(r.url())) {
        const x = { method: r.method(), url: r.url(), status: res.status(), ms: Date.now() - (started.get(r) || Date.now()) };
        if (!SAFE_METHODS.has(r.method())) x.req = clip(redact(r.postData()));
        cur.exchanges.push(x);
        if (res.status() >= 400 || x.req !== undefined) res.text().then((t) => (x.res = clip(redact(t)))).catch(() => {});
      }
      if (cur?.writes && !SAFE_METHODS.has(r.method())) cur.writesLog.push({ method: r.method(), url: r.url(), status: res.status() });
    });
    await c.route("**/*", (route) => {
      const r = route.request();
      const m = r.method();
      const u = r.url();
      const pass =
        SAFE_METHODS.has(m) || wg.allowed || cur?.writes || [...wg.readOnlyPosts, ...wg.allowUrls, ...wg.auth].some((re) => re.test(u));
      if (pass) return route.fallback();
      (cur ? cur.aborted : outsideAborted).push({ method: m, url: u });
      console.log(`        write guard: aborted ${m} ${u}`);
      return route.abort("blockedbyclient");
    });
  };
  let ctx = await newContext();
  await wire(ctx);
  let page = await ctx.newPage();
  if (opts.setup) await opts.setup({ page, ctx });
  const tests = [];
  const file = opts.file || path.basename(process.argv[1] || "e2e");

  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg || "expectation failed");
  };
  const blocked = (msg) => {
    throw new Blocked(msg);
  };

  /** Wait until no tracked request is in flight and no loading mask is visible for `quiet` ms, then one frame. */
  const settle = async ({ timeout = 15000, quiet = 150, ignore = [] } = {}) => {
    const end = Date.now() + timeout;
    let calmSince = 0;
    for (;;) {
      const pending = [...inflight].filter((r) => !ignore.some((re) => re.test(r.url())));
      const masked = pending.length ? 0 : await page.locator(masks).filter({ visible: true }).count().catch(() => 0);
      const now = Date.now();
      if (!pending.length && !masked) {
        if (!calmSince) calmSince = now;
        if (now - calmSince >= quiet) break;
      } else calmSince = 0;
      if (now > end)
        throw new Error(`settle: still busy after ${timeout} ms (${pending.map((r) => r.url()).slice(0, 3).join(", ") || "loading mask visible"})`);
      // event-driven poll: returns as soon as a request finishes, else after 50 ms
      await page.waitForEvent("requestfinished", { timeout: 50 }).catch(() => {});
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))).catch(() => {});
  };

  const detectEnv = async () =>
    typeof envOpt.detect === "function" ? String(await envOpt.detect({ page, ctx })) : page.url();
  /** null when this case may write here, otherwise the reason it is blocked. */
  const writeBlockReason = async () => (wg.allowed ? null : envBlock(await detectEnv(), environments, envOpt.expect));

  return {
    get page() {
      return page;
    },
    settle,
    /** Fresh browser context (clean cookies/storage) for the next cases. */
    async isolate() {
      await ctx.close();
      ctx = await newContext();
      await wire(ctx);
      page = await ctx.newPage();
      if (opts.setup) await opts.setup({ page, ctx });
      return page;
    },
    /** Discovery cache: fn() result kept in <out>/../.cache/<key>.json for ttlHours (default 24). Gitignored. */
    async cache(key, fn, { ttlHours = 24 } = {}) {
      mkdirSync(cacheDir, { recursive: true });
      const f = path.join(cacheDir, `${String(key).replace(/[^\w.-]+/g, "_")}.json`);
      if (existsSync(f) && Date.now() - statSync(f).mtimeMs < ttlHours * 3600e3) return JSON.parse(readFileSync(f, "utf8")).value;
      const value = await fn();
      writeFileSync(f, JSON.stringify({ key, at: new Date().toISOString(), value }, null, 2));
      return value;
    },
    /** tcOpts.writes: true = this case may send non-GET requests (only in a writable environment). */
    async tc(id, title, fn, tcOpts = {}) {
      const t0 = Date.now();
      const shots = [];
      const shot = async (suffix) => {
        const f = path.join(shotsDir, `${id}${suffix ? `-${suffix}` : ""}.png`);
        await page.screenshot({ path: f }).catch(() => {});
        shots.push(path.relative(out, f));
      };
      const writesDeclared = !!tcOpts.writes;
      const rec = { file, name: `[${id}] ${title}`, ids: [id], status: "passed", error: null, note: null, shots, writesDeclared, aborted: [], writes: [], exchanges: [] };
      cur = { writes: false, aborted: rec.aborted, writesLog: rec.writes, exchanges: rec.exchanges };
      try {
        if (writesDeclared) {
          const why = await writeBlockReason();
          if (why) throw new Blocked(why);
          cur.writes = true;
        }
        const { verify, flush } = makeVerify();
        const note = await fn({ page, ctx, expect, verify, blocked, shot, settle });
        flush();
        if (note) rec.note = String(note);
      } catch (e) {
        rec.status = e instanceof Blocked ? "blocked" : "failed";
        rec.error = e.message;
      }
      await shot("end");
      cur = null;
      rec.duration = Date.now() - t0;
      tests.push(rec);
      const extra = [
        rec.aborted.length ? `aborted ${rec.aborted.length} write(s): ${rec.aborted.map((a) => `${a.method} ${a.url}`).join(", ")}` : "",
        rec.writes.length ? `writes: ${rec.writes.map((w) => `${w.method} ${w.url} ${w.status}`).join(", ")}` : "",
      ].filter(Boolean);
      console.log(
        `${rec.status.toUpperCase().padEnd(7)} ${rec.name}${rec.note ? `\n        ${rec.note}` : ""}` +
          `${rec.error ? `\n        ${rec.error.split("\n")[0]}` : ""}${extra.map((x) => `\n        ${x}`).join("")}`
      );
      return rec;
    },
    async finish() {
      await browser.close();
      const f = path.join(out, "e2e-results.json");
      // shots are relative to `out`; collect.mjs resolves them against the results file location
      let all = tests.map((t) => ({ ...t, shots: t.shots.map((s) => path.join(out, s)) }));
      // rerun of a subset (E2E_MERGE=1 or opts.merge): replace only the cases run now, keep the others
      if ((opts.merge || process.env.E2E_MERGE) && existsSync(f)) {
        const ran = new Set(all.flatMap((t) => t.ids));
        const kept = (JSON.parse(readFileSync(f, "utf8")).tests || []).filter((t) => !t.ids.some((id) => ran.has(id)));
        all = [...kept, ...all];
      }
      writeFileSync(f, JSON.stringify({ tests: all, abortedOutsideCases: outsideAborted }, null, 2));
      const failed = tests.filter((t) => t.status !== "passed").length;
      console.log(`${tests.length - failed}/${tests.length} passed → ${f}`);
      process.exitCode = failed ? 1 : 0;
      return tests;
    },
  };
}
