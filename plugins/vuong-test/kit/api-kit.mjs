// API test runner: plain Node (>= 18, global fetch), no dependencies. Cases run in order against a real
// backend; results are written in the same format as e2e-kit (`collect.mjs --api-dir` / `--e2e-json`).
//
//   import { createApiRun } from "<plugin>/kit/api-kit.mjs";
//   const run = await createApiRun({ out: "test-work/<scope>/api", baseUrl: process.env.API_BASE });
//   await run.login(async ({ api }) => {                       // optional; token taken from env vars
//     const r = await api.post("/auth/login", { body: { user: process.env.E2E_USER, password: process.env.E2E_PW } });
//     return { Authorization: `Bearer ${r.data.token}` };       // headers added to every later request
//   });
//   await run.tc("API-001", "list returns rows", async ({ api, expect, expectStatus, expectShape }) => {
//     const r = await api.get("/tasks", { query: { page: 1 } });
//     expectStatus(r, 200);
//     expectShape(r.data, { items: [{ id: "number", code: "string", note: "string?" }], total: "number" });
//   });
//   await run.tc("API-010", "create task", async ({ api, created }) => {
//     const r = await api.post("/tasks", { body: {...} });
//     await created({ record: r.data.code, action: "created", cleanup: "delete in screen X" });
//   }, { writes: true });
//   await run.finish();                                          // writes <out>/api-results.json
//
// Guards (same rules as e2e-kit):
//   - In a case without { writes: true } a non-GET/HEAD/OPTIONS request is NOT sent: the case fails with
//     "write guard", unless the path matches writes.readOnlyPosts (searches sent as POST) or writes.auth.
//   - A writes:true case is BLOCKED unless baseUrl (or opts.env.detect()) matches a test.config.json
//     environments entry with writable: true (and opts.env.expect if given).
// Every request/response of a case is kept as evidence (`exchanges`), bodies clipped and secrets redacted.
// Env: API_MERGE=1 (or E2E_MERGE=1) — rerun of a subset replaces only those cases in api-results.json.
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { loadEnvironments, writeBlockReason, clip, redact, makeVerify } from "./env.mjs";

export class Blocked extends Error {}
export class GuardError extends Error {}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_AUTH = [/\/(login|logout|auth|oauth2?|token|session)\b/i];
const HIDE_HEADERS = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;

/**
 * Check a value against a small schema. Returns a list of mismatches ([] = ok).
 *   "string" | "number" | "boolean" | "object" | "array" | "null" | "any"; suffix "?" = may be null/missing
 *   RegExp → string matching it; [schema] → array whose every item matches; { k: schema } → object (extra keys ok)
 *   any other literal → must be equal
 */
export function shape(value, schema, at = "$") {
  if (typeof schema === "string" && schema.endsWith("?")) {
    if (value === null || value === undefined) return [];
    schema = schema.slice(0, -1);
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema === "any") return value === undefined ? [`${at}: missing`] : [];
  if (typeof schema === "string" && ["string", "number", "boolean", "object", "array", "null"].includes(schema))
    return type === schema ? [] : [`${at}: expected ${schema}, got ${value === undefined ? "missing" : type}`];
  if (schema instanceof RegExp)
    return typeof value === "string" && schema.test(value) ? [] : [`${at}: expected string matching ${schema}, got ${JSON.stringify(value)}`];
  if (Array.isArray(schema)) {
    if (type !== "array") return [`${at}: expected array, got ${value === undefined ? "missing" : type}`];
    return schema.length ? value.flatMap((v, i) => shape(v, schema[0], `${at}[${i}]`)).slice(0, 20) : [];
  }
  if (schema && typeof schema === "object") {
    if (type !== "object") return [`${at}: expected object, got ${value === undefined ? "missing" : type}`];
    return Object.entries(schema).flatMap(([k, s]) => shape(value[k], s, `${at}.${k}`));
  }
  return value === schema ? [] : [`${at}: expected ${JSON.stringify(schema)}, got ${JSON.stringify(value)}`];
}

export async function createApiRun(opts = {}) {
  const out = path.resolve(opts.out || "api-out");
  mkdirSync(out, { recursive: true });
  const baseUrl = String(opts.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("createApiRun: baseUrl is required (take it from an env var)");
  const wg = { allowed: false, readOnlyPosts: [], auth: DEFAULT_AUTH, ...(opts.writes || {}) };
  const envOpt = opts.env || {};
  const environments = envOpt.environments || loadEnvironments(path.resolve(opts.config || "test.config.json"));
  const timeout = opts.timeout || 15000;
  const dataFile = opts.dataCreated ? path.resolve(opts.dataCreated) : null;
  const file = opts.file || path.basename(process.argv[1] || "api");
  let session = { ...(opts.headers || {}) };
  let cur = null; // { id, writes, rec }
  const tests = [];

  const urlOf = (p, query) => {
    const u = new URL(/^https?:\/\//.test(p) ? p : `${baseUrl}${p.startsWith("/") ? "" : "/"}${p}`);
    for (const [k, v] of Object.entries(query || {}))
      for (const x of [].concat(v)) if (x !== undefined && x !== null) u.searchParams.append(k, String(x));
    return u.toString();
  };

  /** One HTTP call. Returns { status, ok, data, text, headers, ms }. Never throws on 4xx/5xx. */
  async function request(method, p, { body, query, headers, form, raw } = {}) {
    method = method.toUpperCase();
    const url = urlOf(p, query);
    const isAuth = wg.auth.some((re) => re.test(url));
    if (!SAFE.has(method) && !wg.allowed && !isAuth && !cur?.writes && !wg.readOnlyPosts.some((re) => re.test(url))) {
      (cur?.rec.aborted || []).push({ method, url });
      throw new GuardError(`write guard: ${method} ${url} not sent — the case is not declared { writes: true } (search sent as POST → writes.readOnlyPosts)`);
    }
    const h = { accept: "application/json", ...session, ...(headers || {}) };
    let payload;
    if (form) payload = new URLSearchParams(form);
    else if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h["content-type"] ||= "application/json";
    }
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: payload, signal: ac.signal, redirect: "manual" });
    } catch (e) {
      const x = { method, url, status: 0, ms: Date.now() - t0, error: ac.signal.aborted ? `timeout ${timeout} ms` : e.message };
      cur?.rec.exchanges.push(x);
      throw new Error(`${method} ${url}: ${x.error}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const ms = Date.now() - t0;
    let data = text;
    if (/json/i.test(res.headers.get("content-type") || "") || /^\s*[[{]/.test(text))
      try {
        data = JSON.parse(text);
      } catch {
        /* keep text */
      }
    const resHeaders = Object.fromEntries([...res.headers].map(([k, v]) => [k, HIDE_HEADERS.test(k) ? "***" : v]));
    if (cur) {
      const x = { method, url, status: res.status, ms };
      if (payload !== undefined) x.req = clip(redact(typeof payload === "string" ? payload : String(payload)));
      x.res = clip(redact(text));
      cur.rec.exchanges.push(x);
      if (!SAFE.has(method) && cur.writes) cur.rec.writes.push({ method, url, status: res.status });
    }
    return { status: res.status, ok: res.ok, data, text, headers: resHeaders, ms };
  }
  const api = { request };
  for (const m of ["get", "post", "put", "patch", "delete", "head"]) api[m] = (p, o) => request(m, p, o);

  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg || "expectation failed");
  };
  const expectStatus = (r, ...codes) => {
    if (!codes.flat().includes(r.status)) throw new Error(`expected status ${codes.flat().join("/")}, got ${r.status}: ${clip(r.text, 300)}`);
  };
  const expectShape = (value, schema, label = "body") => {
    const bad = shape(value, schema);
    if (bad.length) throw new Error(`${label} shape: ${bad.slice(0, 8).join("; ")}${bad.length > 8 ? ` (+${bad.length - 8})` : ""}`);
  };
  const blocked = (msg) => {
    throw new Blocked(msg);
  };

  /** Append one row to data-created.md (only inside a writes:true case). */
  async function created({ record, action = "created", cleanup = "", status = "left", environment } = {}) {
    if (!cur?.writes) throw new Error("created(): only inside a case declared { writes: true }");
    cur.rec.dataCreated.push({ record, action, cleanup, status });
    if (!dataFile) return;
    if (!existsSync(dataFile))
      writeFileSync(dataFile, "# Data created\n\n| Case | When | Environment | Record (key) | Action | How to delete / revert | Status |\n|---|---|---|---|---|---|---|\n");
    const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    appendFileSync(dataFile, `| ${cur.id} | ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ${cell(environment || envOpt.name || baseUrl)} | ${cell(record)} | ${cell(action)} | ${cell(cleanup)} | ${cell(status)} |\n`);
  }

  const detect = async () => (typeof envOpt.detect === "function" ? String(await envOpt.detect({ api })) : baseUrl);

  return {
    api,
    baseUrl,
    /** fn({ api }) returns headers to send on every later request (e.g. Authorization). */
    async login(fn) {
      const h = await fn({ api });
      if (h && typeof h === "object") session = { ...session, ...h };
      return h;
    },
    setHeaders(h) {
      session = { ...session, ...h };
    },
    async tc(id, title, fn, tcOpts = {}) {
      const t0 = Date.now();
      const rec = { file, name: `[${id}] ${title}`, ids: [id], status: "passed", error: null, note: null, stack: "api", shots: [],
        writesDeclared: !!tcOpts.writes, aborted: [], writes: [], exchanges: [], dataCreated: [] };
      cur = { id, writes: false, rec };
      try {
        if (rec.writesDeclared && !wg.allowed) {
          const why = writeBlockReason(await detect(), environments, envOpt.expect);
          if (why) throw new Blocked(why);
        }
        cur.writes = rec.writesDeclared;
        const { verify, flush } = makeVerify();
        const note = await fn({ api, expect, verify, expectStatus, expectShape, shape, blocked, created });
        flush();
        if (note) rec.note = String(note);
      } catch (e) {
        rec.status = e instanceof Blocked ? "blocked" : "failed";
        rec.error = e.message;
      }
      cur = null;
      rec.duration = Date.now() - t0;
      tests.push(rec);
      const last = rec.exchanges.slice(-3).map((x) => `${x.method} ${x.url.replace(baseUrl, "")} → ${x.status} (${x.ms} ms)`);
      console.log(
        `${rec.status.toUpperCase().padEnd(7)} ${rec.name}${rec.note ? `\n        ${rec.note}` : ""}` +
          `${rec.error ? `\n        ${rec.error.split("\n")[0]}` : ""}${last.map((x) => `\n        ${x}`).join("")}`
      );
      return rec;
    },
    async finish() {
      const f = path.join(out, "api-results.json");
      let all = tests;
      if ((opts.merge || process.env.API_MERGE || process.env.E2E_MERGE) && existsSync(f)) {
        const ran = new Set(all.flatMap((t) => t.ids));
        all = [...(JSON.parse(readFileSync(f, "utf8")).tests || []).filter((t) => !t.ids.some((id) => ran.has(id))), ...all];
      }
      writeFileSync(f, JSON.stringify({ baseUrl, tests: all }, null, 2));
      const failed = tests.filter((t) => t.status !== "passed").length;
      console.log(`${tests.length - failed}/${tests.length} passed → ${f}`);
      process.exitCode = failed ? 1 : 0;
      return tests;
    },
  };
}
