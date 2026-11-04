// GENERATED from fake-api.mjs by kit/build-cjs.mjs — do not edit.
"use strict";
// Fake HTTP backend for component ("mount") tests. Framework-agnostic, no dependencies.
// Fake the API at the module the app uses for HTTP (axios instance adapter / global fetch), never at the
// component's own methods — the component under test must run its real code.
//
//   import { createFakeApi, axiosAdapter, fetchStub } from "<plugin>/kit/fake-api.mjs";       // ESM / Vitest
//   const { createFakeApi, axiosAdapter } = require("<plugin>/kit/fake-api.cjs");             // CommonJS Jest
//
//   const api = createFakeApi({
//     "GET /items": () => fixture,                                   // plain value → 200 with that body
//     "PUT /tasks/:id": (req) => req.body.version === 1 ? { ok: true } : { status: 409, data: { code: "E409" } },
//   });
//   http.defaults.adapter = axiosAdapter(api);   // or: globalThis.fetch = fetchStub(api)
//   ...
//   api.assertCalled("PUT", "/tasks/:id", (c) => c.params.id === "7" && c.body.name === "A");
//
// Route key: "<METHOD> <path>", path segments ":name" capture params, "*" matches the rest. The query string
// is parsed into req.query and does not take part in matching. Handler gets
// { method, url, path, params, query, body, headers } and returns either a body (→ 200) or
// { status, data, headers } (detected by a numeric `status` key). A thrown error propagates.
// strict (default true): a request with no matching route throws, so a test never silently hits nothing.
// Every request is recorded in `calls` (also unmatched ones, with route: null).
//
// fake-api.cjs is generated from this file by kit/build-cjs.mjs — edit only this file, then rebuild.

function compile(key) {
  const m = /^([A-Za-z]+)\s+(\S+)$/.exec(String(key).trim());
  if (!m) throw new Error(`fake-api: bad route key "${key}" (want "METHOD /path")`);
  const names = [];
  const src = m[2]
    .replace(/\?.*$/, "")
    .split("/")
    .map((seg) => {
      if (seg === "*") return ".*";
      if (seg.startsWith(":")) {
        names.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { key, method: m[1].toUpperCase(), re: new RegExp(`^${src}/?$`), names };
}

function splitUrl(url) {
  let s = String(url || "");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const qi = s.indexOf("?");
  const path = (qi < 0 ? s : s.slice(0, qi)) || "/";
  const query = {};
  if (qi >= 0) {
    for (const [k, v] of new URLSearchParams(s.slice(qi + 1))) {
      if (k in query) query[k] = [].concat(query[k], v);
      else query[k] = v;
    }
  }
  return { path: path.startsWith("/") ? path : `/${path}`, query };
}

function parseBody(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

const isResponse = (r) => r && typeof r === "object" && !Array.isArray(r) && typeof r.status === "number";

function createFakeApi(routes = {}, { strict = true } = {}) {
  const table = Object.entries(routes).map(([k, fn]) => ({ ...compile(k), fn }));
  const calls = [];

  function match(method, path) {
    for (const r of table) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) {
        const params = {};
        r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
        return { r, params };
      }
    }
    return null;
  }

  async function handle(method, url, body, headers = {}) {
    const M = String(method || "GET").toUpperCase();
    const { path, query } = splitUrl(url);
    const hit = match(M, path);
    const req = { method: M, url: String(url), path, query, params: hit ? hit.params : {}, body: parseBody(body), headers };
    calls.push({ ...req, route: hit ? hit.r.key : null });
    if (!hit) {
      if (strict) throw new Error(`fake-api: no route for ${M} ${path} (strict). Known: ${table.map((t) => t.key).join(", ") || "none"}`);
      return { status: 404, data: { message: "fake-api: no route" }, headers: {} };
    }
    const out = typeof hit.r.fn === "function" ? await hit.r.fn(req) : hit.r.fn;
    if (isResponse(out)) return { status: out.status, data: out.data, headers: out.headers || {} };
    return { status: 200, data: out, headers: {} };
  }

  function assertCalled(method, pathPattern, matcher) {
    const p = compile(`${method} ${pathPattern}`);
    const same = calls.filter((c) => c.method === p.method && p.re.test(c.path));
    const withParams = same.map((c) => {
      const m = p.re.exec(c.path);
      const params = {};
      p.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      return { ...c, params };
    });
    const ok = matcher ? withParams.filter((c) => matcher(c)) : withParams;
    if (!ok.length) {
      const seen = calls.map((c) => `${c.method} ${c.path}`).join(", ") || "none";
      throw new Error(`fake-api: expected ${p.method} ${pathPattern}${matcher ? " matching" : ""} to be called; calls: ${seen}`);
    }
    return ok;
  }

  return {
    handle,
    calls,
    reset() {
      calls.length = 0;
    },
    assertCalled,
  };
}

// axios `adapter`: http.defaults.adapter = axiosAdapter(api). Status outside 2xx rejects the way axios does
// (error.response = { status, data, headers, config }) unless config.validateStatus says otherwise.
function axiosAdapter(fake) {
  return async function fakeAxiosAdapter(config) {
    let url = config.url || "";
    if (config.baseURL && !/^[a-z]+:\/\//i.test(url)) url = config.baseURL.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
    if (config.params && Object.keys(config.params).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(config.params)) if (v !== undefined && v !== null) [].concat(v).forEach((x) => qs.append(k, x));
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    const r = await fake.handle(config.method || "get", url, config.data, config.headers || {});
    const response = { data: r.data, status: r.status, statusText: String(r.status), headers: r.headers, config, request: {} };
    const valid = config.validateStatus || ((s) => s >= 200 && s < 300);
    if (valid(r.status)) return response;
    const err = new Error(`Request failed with status code ${r.status}`);
    err.config = config;
    err.response = response;
    err.isAxiosError = true;
    throw err;
  };
}

// fetch replacement: globalThis.fetch = fetchStub(api). Returns a Response-like object
// ({ ok, status, headers, json(), text() }); does not need a global Response class.
function fetchStub(fake) {
  return async function fakeFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input && input.url;
    const method = init.method || (input && typeof input === "object" && input.method) || "GET";
    const r = await fake.handle(method, url, init.body, init.headers || {});
    const text = typeof r.data === "string" ? r.data : r.data === undefined ? "" : JSON.stringify(r.data);
    const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      url,
      headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
}

module.exports = { createFakeApi, axiosAdapter, fetchStub };
