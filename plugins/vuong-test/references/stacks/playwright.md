# E2E — Playwright (any web app)

## Step 3 — where to look

Start from the screen, not from code: every menu entry, mode (new / edit / copy / view), button,
grid/table action (add, copy, delete, undo, paste), keyboard path (Enter/Tab), dialog/confirm, toast,
permission variant, and each validation message. Then read the page code to find what the eye misses
(hidden buttons, conditional fields, mode flags) and add `file:line`.

## Step 6 — script shape

Use `$PLUGIN/kit/e2e-kit.mjs` (results JSON + screenshots per case) or `@playwright/test` with the junit
reporter. With the kit:

```js
import { createRun } from "<plugin>/kit/e2e-kit.mjs";
const run = await createRun({ out: "W/e2e" });           // browser, page, results, screenshots
await run.tc("ORD-001", "Save with empty header shows ERR-001", async ({ page, expect }) => {
  ...
  expect(codes.includes("ERR-001"), `got ${codes}`);
  return "note shown in the report";
});
await run.finish();                                      // writes W/e2e/e2e-results.json
```

### Kit helpers (generic, every project)

```js
const run = await createRun({
  out: "W/e2e-<group>",                          // own out dir per parallel agent
  api: /\/api\//,                                 // requests settle() waits for
  masks: ".my-spinner",                            // optional; default = common UI-library masks
  writes: { readOnlyPosts: [/\/search$/], allowUrls: [], auth: [/\/login/] },
  env: { expect: /<host or name of the writable env>/ },   // or envCheck: async ({ page }) => "<env name>"
});
await run.tc("X-001", "search shows rows", async ({ page, settle }) => {
  await page.click("text=Search");
  await settle();                                  // no api request in flight, no mask, + 1 frame
});
await run.tc("X-002", "save creates record", async ({ page, settle }) => { /* ... */ }, { writes: true });
const values = await run.cache("master-values", () => discoverFromUi(run.page), { ttlHours: 24 });
```

- `settle({ timeout = 15000, quiet = 150, ignore: [regex] })` (also `run.settle`) replaces fixed waits after
  an action that loads.
- Write guard: in a case without `{ writes: true }` (and in `setup` / between cases) every non-GET/HEAD/OPTIONS
  request is aborted except `readOnlyPosts`, `allowUrls`, `auth`; each abort is printed, kept in the case
  record (`aborted: [{method,url}]`) and shown in the report. A read-only case that needs a POST search →
  add its URL to `readOnlyPosts`.
- `writes: true` cases record every non-GET request (`writes: [{method,url,status}]`) and run only where the
  detected environment matches a `test.config.json` `environments` entry with `writable: true` (and
  `env.expect` if given) — otherwise BLOCKED. `writes: { allowed: true }` turns the guard off (throwaway
  local env only).
- `run.cache(key, fn, { ttlHours })` stores slow discovery (e.g. which master values have dependent data) in
  `W/.cache/<key>.json` (gitignored). Delete the file to refresh.
- Rerun a subset: `E2E_MERGE=1` replaces only those cases in `e2e-results.json`.

- Project-specific helpers (login, custom grid/combobox widgets, error panels) live in the PROJECT repo
  (e.g. `<project>/test/e2e/lib/`), never in this plugin.
- Accounts come from env vars listed in `test.config.json`; never in the script.
- `E2E_HEADED=1` to watch, `E2E_SLOWMO=300` to slow down.
- Cases with `Writes = Y`: prefix created records (e.g. `E2E<timestamp>`), return their keys in the note,
  so the report lists what to clean up.
- Do not pick "the first option" of a master-data combobox blindly — the first value may have no dependent
  data. Choose data explicitly in `cases.md` (Data column) and make it overridable by env var.

## Step 7

```bash
node W/e2e.mjs                                   # or one W/e2e-<group>.mjs per agent
node $PLUGIN/core/collect.mjs --cases W/cases.md --out W/results.json --e2e-dir W --notes-dir W --data W/data-created.md
```
