# JS / TS — Jest, Vitest (UT and component mount)

## Step 3 — where to look

- Pages / views: every mode (`new`, `edit`, `view`, query params), every button handler, every `v-if` / conditional
  render that hides an action, every validation function and the messages/codes it produces.
- Store (Vuex / Pinia / Redux): actions with branches, API error handling, state reset on logout/route change.
- API layer: request params built from UI state, response status branches.
- Shared utils used by the scope: date/number formatting, permission checks.
- Grep error codes / i18n keys used by the scope; each distinct code is a flow row.

## Step 6 — naming and layers

```js
// source: <citation from cases.md>
it("[ORD-012] Save with empty Ref No shows ERR-001", () => { ... })
describe("[ORD-020] Edit mode", () => { it("loads header from API", ...) })  // tag on describe covers its its
```

- `ut`: pure functions, store actions with mocked API. `mount`: mount the component (vue-test-utils /
  testing-library) and assert on DOM, emitted events, store calls — use when the expected result is
  something the user sees.
- Heavy third-party widgets (grid/canvas libraries) are often mapped to empty mocks in Jest config; a test
  through such a mock does not prove the widget behavior → that case belongs to `e2e`.

## Step 7 — commands

```bash
# Jest: results + istanbul coverage
npx jest --json --outputFile=test-work/_out/jest.json --coverage --coverageReporters=json --coverageDirectory=test-work/_out/cov
node $PLUGIN/core/collect.mjs --cases W/cases.md --out W/results.json \
  --jest-json test-work/_out/jest.json --coverage test-work/_out/cov/coverage-final.json --label fe

# Vitest: junit + istanbul
npx vitest run --reporter=junit --outputFile=test-work/_out/vitest.xml --coverage.enabled --coverage.provider=istanbul --coverage.reporter=json
node $PLUGIN/core/collect.mjs ... --junit test-work/_out/vitest.xml --stack vitest --coverage coverage/coverage-final.json
```

## Pitfalls

- Coverage counts only files imported by some test; an untested file does not lower the %. Use
  `collectCoverageFrom` to include the scope's sources.
- Square brackets used in test names for other purposes (`[Save]`) look like tags; the report only links
  IDs that exist in `cases.md` and warns about the rest.
