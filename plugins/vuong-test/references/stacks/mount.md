# Mount — component tests with a fake API

Mount the real component / page, fake only the edges: router, store (when not under test), i18n, heavy
widgets, and HTTP. Assert on what the user sees **and** on the requests sent.

## Where to fake

| Edge | Fake it at | Never at |
|---|---|---|
| HTTP | the module the app uses: the axios instance's `adapter`, or `globalThis.fetch` | the component's own methods (`wrapper.vm.save = jest.fn()`) — that mocks the subject |
| Router | `mocks: { $route, $router }` (VTU) / `MemoryRouter` (React) | — |
| Store | real store with the module under test, or a stub store with the getters the component reads | — |
| i18n | `mocks: { $t: (k) => k }` / a test provider | — |
| Heavy widget (canvas grid, chart, editor) | the boundary the component calls (component stub, or `moduleNameMapper` to a stateful mock) | — |

What goes through a widget mock is not proven about the widget → that part stays `e2e` (`../layers.md`).

## Fake API (`$PLUGIN/kit/fake-api.mjs`, CommonJS: `kit/fake-api.cjs`)

```js
const api = createFakeApi({
  "GET /api/items": () => itemsFixture,                       // body → 200
  "PUT /api/tasks/:id": (req) => req.body.version === 1 ? { ok: true } : { status: 409, data: { code: "E409" } },
}, { strict: true });                                         // unknown route → throws
http.defaults.adapter = axiosAdapter(api);                    // axios instance the app uses
// or globalThis.fetch = fetchStub(api);
...
api.assertCalled("PUT", "/api/tasks/:id", (c) => c.params.id === "7" && c.body.name === "T1");
api.calls        // [{ method, url, path, params, query, body, headers, route }]
api.reset()
```

Handler `req`: `{ method, url, path, params, query, body, headers }`. Return a body (200) or
`{ status, data, headers }`. axios adapter rejects non-2xx like axios (`err.response.status/data`).

Loading it:
- ESM / Vitest / Jest with ESM: `import { createFakeApi, axiosAdapter } from "<plugin>/kit/fake-api.mjs"`.
- CommonJS Jest (babel-jest): `const { createFakeApi, axiosAdapter } = require("<plugin>/kit/fake-api.cjs")`.
  Dynamic `await import(".../fake-api.mjs")` also works only when Jest runs with
  `--experimental-vm-modules`; prefer the `.cjs`. Pass the plugin path by env var (e.g. `VT_FAKE_API`) so
  the test does not hard-code a machine path.
- `.cjs` is generated: edit `fake-api.mjs`, run `node kit/build-cjs.mjs` (selftest fails when out of sync).

## Fixtures

From the spec (sample data, API design response example) or a recorded real response (the kit's network
log in an E2E run, browser devtools) with personal data stripped. Never invented from reading the code —
a fixture built from the code proves only that the code agrees with itself. Cite the fixture's source
in the test (`// fixture: API spec 4.2 response example`).

## Per stack

**Vue 2 + @vue/test-utils 1 + Jest** (verified)
```js
import { mount } from "@vue/test-utils";
const flush = () => new Promise((r) => setTimeout(r));          // VTU 1 has no flushPromises
const w = mount(Page, { propsData: { id: 7 }, mocks: { $t: (k) => k, $route: { query: {} } },
  stubs: { "heavy-grid": true } });
await flush();
await w.find("[data-t=name]").setValue("T1");
expect(w.find("[data-t=save]").attributes("disabled")).toBeUndefined();
```
Transform `.vue` with vue-jest (or the project's transformer), JS with babel-jest.

**Vue 3 + @vue/test-utils 2 + Vitest / Jest** (unverified): `mount(Page, { props, global: { mocks, stubs, plugins: [router, pinia] } })`,
`flushPromises` from `@vue/test-utils`. Vitest: import `fake-api.mjs` directly.

**React + Testing Library** (unverified): `render(<Page/>, { wrapper: Providers })`, `await screen.findByText(...)`,
`userEvent.type(...)`; `globalThis.fetch = fetchStub(api)` or the axios instance adapter. Query by role/label, not by class.

## Naming, results, coverage

Same as `js.md`: `[ID]` at the start of `it` / `describe`, layer `mount` in `cases.md`, Writes `N`.
```bash
npx jest --json --outputFile=test-work/_out/jest.json --coverage --coverageReporters=json --coverageDirectory=test-work/_out/cov
node $PLUGIN/core/collect.mjs --cases W/cases.md --out W/results.json --jest-json test-work/_out/jest.json \
  --coverage test-work/_out/cov/coverage-final.json --label fe
node $PLUGIN/core/render-html.mjs W/results.json --out W/report/
```

## Pitfalls

- Assert after the async chain settles (flush) — otherwise a test passes before the request is sent.
- `strict: false` hides missing routes; keep strict on and add every route the screen calls.
- Assert on the request payload, not only on screen state: a Save that sends the wrong body passes a
  screen-only check.
