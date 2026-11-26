# Kit API — complete reference (do not read the kit source)

Both kits: cases run in order, one result record per case, results in the format `core/collect.mjs` reads.
A case passes unless its function throws. Status: `passed` · `failed` (throw, `expect`, `verify`) ·
`blocked` (`blocked(msg)`, or a writes:true case outside a writable environment). Returned string = note in the report.
Run through `core/run.mjs` (`--help`): it sets `BASE_URL` / `API_BASE` from `environments.<env>` and starts the server.
Import path: on Windows an absolute path must be a `file:///` URL (`"file:///E:/…/kit/e2e-kit.mjs"`); a bare
`E:/…` fails with ERR_UNSUPPORTED_ESM_URL_SCHEME.

## E2E — `kit/e2e-kit.mjs` (Playwright resolved from the project: cwd or `from`)

```js
import { createRun } from "<plugin>/kit/e2e-kit.mjs";
const BASE = process.env.BASE_URL;                 // set by core/run.mjs from test.config.json (also API_BASE, VT_ENV, VT_SCOPE)
const run = await createRun({ out: "W/e2e", viewport: { width: 360, height: 800 } });
await run.tc("L01-E01", "new form shows today", async ({ page, ctx, expect, verify, blocked, shot, settle }) => {
  await page.goto(BASE + "/?mode=new");
  await settle();                                   // instead of fixed waits
  verify("Từ ngày", "2026-11-25", await page.inputValue("#from"));
  return "note";
}, { writes: true });                               // omit for read-only cases
await run.finish();                                 // → W/e2e/e2e-results.json, exit code 1 if any not passed
```

`createRun` options (all optional): `out` (default `e2e-out`) · `viewport` (default 1600×1000) · `from` (dir to
resolve playwright) · `api` RegExp of requests `settle` waits for (default `/\/api\//`) · `masks` CSS of loading
masks · `writes: { allowed, readOnlyPosts: [RegExp], allowUrls: [RegExp], auth: [RegExp] }` · `env: { expect,
detect, environments }` / `envCheck` · `config` (default `test.config.json`) · `setup({ page, ctx })` run on each new
page · `file` (name in results) · `merge`.

`run`: `page` (getter, current page) · `settle({ timeout = 15000, quiet = 150, ignore: [RegExp] })` · `isolate()` new
context (clean storage), returns the page · `cache(key, fn, { ttlHours = 24 })` · `tc(id, title, fn, { writes })` ·
`finish()`.

Case args: `page`, `ctx` (browser context), `expect(cond, msg)`, `verify(what, expected, actual[, ok])`, `blocked(msg)`,
`shot(suffix)` (a screenshot is taken at the end of every case anyway), `settle`.

## API — `kit/api-kit.mjs` (Node >= 18, no dependencies)

```js
import { createApiRun } from "<plugin>/kit/api-kit.mjs";
const run = await createApiRun({ out: "W/api", baseUrl: process.env.API_BASE, dataCreated: "W/data-created.md" });
await run.login(async ({ api }) => ({ Authorization: `Bearer ${(await api.post("/login", { body })).data.token}` }));
await run.tc("L01-A05", "cancel approved → 409", async ({ api, expect, verify, expectStatus, expectShape, shape, blocked, created }) => {
  const r = await api.post("/api/leaves/LV-1/cancel", { headers: { "X-User": "E001" } });
  expectStatus(r, 409);
  verify("code", "LV-E409", r.data.code);
}, { writes: true });
await run.finish();                                 // → W/api/api-results.json
```

`createApiRun` options: `baseUrl` (required) · `out` (default `api-out`) · `headers` (sent on every request) ·
`timeout` (ms, default 15000) · `dataCreated` (file `created()` appends to) · `writes: { allowed, readOnlyPosts, auth }` ·
`env` · `config` · `file` · `merge`.

`api.get|post|put|patch|delete|head(path, { body, query, headers, form, raw })` → `{ status, ok, data, text, headers,
ms }`; never throws on 4xx/5xx (throws on network error / timeout). `data` is parsed JSON when the body is JSON.
`run.login(fn)` / `run.setHeaders(h)`: headers for every later request.

Case args: `api`, `expect(cond, msg)`, `verify(...)`, `expectStatus(r, ...codes)`, `expectShape(value, schema, label)`,
`shape(value, schema)` → list of problems, `blocked(msg)`, `created({ record, action, cleanup, status, environment })`
(one row in data-created.md; only in a writes:true case).
Schema: `"string"` · `"number"` · `"boolean"` · `"string?"` (optional) · `[item]` (array of) · `{ key: schema }` · a
literal value (must equal).

## Shared rules

- `verify(what, expected, actual[, ok])`: `expected` is a value (JSON-equal) or a RegExp (tested on
  `String(actual)`); `ok(actual)` overrides the comparison. All failed verifies of a case are reported together
  as `✗ <what> / Expected: … / Actual: …` when the case function returns.
- Write guard: in a case without `{ writes: true }` every non-GET/HEAD/OPTIONS request is aborted (E2E) or not
  sent (API: the case fails "write guard"), except `readOnlyPosts` / `allowUrls` / `auth` URLs. A writes:true case
  runs only where the environment matches a `test.config.json` `environments` entry with `writable: true`;
  `writes: { allowed: true }` switches the guard off (throwaway local env only).
- Rerun a subset: `E2E_MERGE=1` / `API_MERGE=1` replaces only those cases in the results file.
- `E2E_HEADED=1`, `E2E_SLOWMO=<ms>`: only to watch a run.
- Results: `collect.mjs --e2e-dir W --api-dir W` (every `W/e2e*/e2e-results.json`, `W/api*/api-results.json`).
  `Pre` (cases.md) is applied by collect: a case with no result whose Pre case failed or is blocked is reported
  BLOCKED. In the script, skip a case whose Pre did not pass (no `tc` call) or call `blocked("Pre <ID> failed")`.
