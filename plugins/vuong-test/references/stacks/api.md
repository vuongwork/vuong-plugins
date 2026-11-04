# API — plugin kit (`kit/api-kit.mjs`), Newman optional

Tests the backend through HTTP, the same way the FE calls it. Use the `api` layer when the expected result
is backend truth: status code, error code, validation and permission enforced by the BE, saved data read
back, numbering, locks (`references/layers.md`). Runs on Node ≥ 18 with no dependency; results go into
the same report as UT / mount / E2E.

## Step 2–3 — where to look

1. API spec first: the `api` kind in `specPaths` (`find-spec.mjs <screen>` lists the screen spec AND its
   API specs through `scopes`). Per endpoint record in `flows.md`: method + path, request fields (required,
   type, length, format), response fields, every error code with its condition, permission/role, side
   effects (which tables/records change, numbering).
2. Then the BE code to find what the spec misses: controller → service branches → exceptions → error
   codes, validation annotations, transaction boundaries, `file:line` for each.
3. Then the FE code: which screen action calls which endpoint with which payload (this links E2E cases to
   API cases and shows endpoints nothing calls).
No API spec (`specMissing: ["api"]`) → every expected result from the BE is an **assumption**; the code is
used only to list flows, never as the expected result.

## Step 4 — cases

One case per rule, not per endpoint: `API-<endpoint>-<rule>`. Typical set per endpoint:
- happy path: status + response shape (`expectShape`) + key values;
- each required field missing / too long / wrong format → status + error code;
- each business error code in the spec (state not allowed, duplicate, not found, locked);
- permission: allowed role / denied role (needs a second account — data-plan row);
- for writes: read back with a GET (persistence), numbering format, record appears in the list.
Writes = Y for every case that sends a non-GET (except POSTs that only search, listed in `readOnlyPosts`).

## Step 6 — script shape

```js
import { createApiRun } from "<plugin>/kit/api-kit.mjs";
const run = await createApiRun({
  out: "W/api",                                   // own out dir per parallel agent: W/api-<group>
  baseUrl: process.env.API_BASE,                  // from env, never hard-coded
  dataCreated: "W/data-created.md",               // created() appends rows here
  writes: { readOnlyPosts: [/\/search$/, /\/list$/] },
  // env: { expect: /staging/ }                   // optional extra check on baseUrl
});
await run.login(async ({ api }) => {
  const r = await api.post("/auth/login", { body: { user: process.env.E2E_USER, password: process.env.E2E_PW } });
  return { Authorization: `Bearer ${r.data.token}` };
});
await run.tc("API-TASK-001", "GET /tasks returns the page", async ({ api, expectStatus, expectShape }) => {
  const r = await api.get("/tasks", { query: { page: 1, size: 20 } });
  expectStatus(r, 200);
  expectShape(r.data, { items: [{ id: "number", taskNo: /^T\d+/, note: "string?" }], total: "number" });
});
await run.tc("API-TASK-010", "POST /tasks creates and can be read back", async ({ api, expectStatus, expect, created }) => {
  const r = await api.post("/tasks", { body: { /* from data-plan */ } });
  expectStatus(r, 201);
  await created({ record: r.data.taskNo, action: "created", cleanup: "Delete in screen SCR001" });
  const back = await api.get(`/tasks/${r.data.id}`);
  expect(back.data.taskNo === r.data.taskNo, "not persisted");
}, { writes: true });
await run.finish();                               // W/api/api-results.json
```

- `api.get/post/put/patch/delete(path, { query, body, form, raw, headers })` → `{ status, ok, data, text,
  headers, ms }`. 4xx/5xx are returned, not thrown; a network error or timeout (`timeout`, default
  15000 ms) throws.
- `expectStatus(r, 200)` (several codes allowed), `expectShape(value, schema)`, `shape()` returns the
  mismatch list. Schema: `"string" | "number" | "boolean" | "object" | "array" | "null" | "any"`, `"x?"` =
  may be null/missing, `RegExp` = string format, `[schema]` = every item, `{ k: schema }` = object (extra
  keys allowed), literal = equal. Build the schema from the API spec, never from a captured response.
- Write guard: in a case without `{ writes: true }` a non-GET is **not sent** and the case fails with
  "write guard" (search via POST → `readOnlyPosts`; login → `auth`, default `/login|auth|token|session/`).
- Environment guard: a `writes: true` case is BLOCKED unless `baseUrl` matches a `test.config.json`
  `environments` entry with `writable: true`.
- `created({ record, action, cleanup, status })` appends to `data-created.md` (only in writes cases).
- Evidence: every request/response of a case is stored (`exchanges`, bodies clipped to 2 KB, password /
  token / authorization redacted) and shown under "API calls" in the report.
- Rerun a subset: `API_MERGE=1`.
- Project helpers (login variants, common headers, ID lookups) live in the project repo, not here.

## FE → BE in one run (full-stack)

Prefer one case per behaviour at the lowest layer, then link the layers:
- **E2E case** drives the screen; `e2e-kit` records every API call the screen made in that case
  (method, URL, status, time; body for writes and errors) → the report shows the FE→BE trace under
  "API calls". A FAIL can then be placed: wrong payload from FE (look at `→`) or wrong answer from BE (`←`).
- **API case** pins the BE rule the E2E relies on (error code, persistence), so a BE regression fails
  in seconds without a browser.
- In `flows.md` give each flow item its endpoint; in `cases.md` the same flow ref links the E2E and the
  API case. `collect.mjs --e2e-dir W --api-dir W` puts both in one report.

## Step 7 — collect

`node $PLUGIN/core/collect.mjs --cases W/cases.md --out W/results.json --api-dir W [--e2e-dir W] --data W/data-created.md`
(`--api-dir` reads `W/api-results.json` and every `W/api*/api-results.json`; single file: `--api-json`).

## Newman / Postman (optional)

A team that already keeps Postman collections can run them with
`newman run <collection> -e <env> -r junit --reporter-junit-export W/newman.xml` and pass
`--junit W/newman.xml --stack newman`. Request names must start with `[<ID>]`. The plugin's write and
environment guards do NOT apply to Newman — read-only collections only, unless the user approves the
writes. Status: supported through JUnit, not yet verified.
