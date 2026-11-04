# Supported stacks

| Stack | Guide | Result format | Coverage | Status |
|---|---|---|---|---|
| JS/TS — Jest | `js.md` | `--json` (or jest-junit) | istanbul `coverage-final.json` | verified (Jest 29) |
| JS/TS — Vitest | `js.md` | junit reporter | istanbul | supported, not yet verified |
| Java — JUnit 5 / Spring Boot Test, Maven | `java.md` | Surefire XML | JaCoCo XML | verified (Spring Boot, JUnit 5 + Mockito, multi-module Maven) |
| Mount — Vue 2 + @vue/test-utils 1 + Jest | `mount.md` + `kit/fake-api` | `--json` | istanbul | verified (Jest, vue-jest, VTU 1, axios adapter; demo outside repo) |
| Mount — Vue 3 + VTU 2 + Vitest/Jest | `mount.md` | junit / `--json` | istanbul | unverified |
| Mount — React + Testing Library | `mount.md` | junit / `--json` | istanbul | unverified |
| E2E — Playwright | `playwright.md` | `--e2e-json` (plugin kit) or junit | — | kit verified; `@playwright/test` junit not yet |
| API — plugin kit (Node fetch) | `api.md` + `kit/api-kit` | `--api-dir` / `--api-json` | — | verified by selftest (local server: guards, shape, data-created, report); not yet on a project BE |
| API — Newman / Postman | `api.md` (Newman section) | junit reporter (`--junit --stack newman`) | — | supported via JUnit, unverified; no write guard |

## Planned — add when a project needs it

Python (pytest + coverage.py), .NET (xUnit/NUnit + Coverlet), Go (`go test` + go-junit-report), PHP (PHPUnit).
All of them emit JUnit XML + Cobertura/Clover, so adding one = a guide file here + coverage parser if needed;
`core/collect.mjs --junit` already reads their results.

## Adding a stack

1. Guide `stacks/<stack>.md`: where to look in step 3, how to name tests with `[ID]`, command that writes
   JUnit XML and coverage, known pitfalls.
2. Coverage format not yet parsed → add a parser in `core/coverage.mjs`.
3. Verify on a real project; only then mark "supported".
