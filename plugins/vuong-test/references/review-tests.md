# Self-review of tests before the real run (step 6)

Check every test against this list; fix before running. AI-written tests fail these most often.

1. **Tautology** — the assertion re-computes the expected value with the same code under test, or asserts
   on a value the test itself set. Expected values come from `cases.md`, typed as literals.
2. **Mocked the subject** — the unit under test (or the branch being tested) is mocked away.
3. **Hallucinated API** — a method, selector, endpoint or field that does not exist. Grep for it.
4. **No assertion / weak assertion** — `toBeTruthy`, "no exception", "status 200" when the case expects a
   specific value, code or message.
5. **Wrong layer** — an E2E test for pure logic, or a unit test with everything mocked claiming to cover
   a flow. Pick the lowest layer that can observe the expected result (`layers.md`); an `e2e` whose
   expected result needs no backend truth → move to `mount`.
5b. **Unreadable failure** — a failure message that does not say what was checked, the expected value and the
   actual value (e.g. `missing: message "…" — dialog=[…] codes=… grid=false`). Use `verify(what, expected, actual)`;
   one `verify` per expected item of the case, in the words of the case's Expected column.
6. **Tag mismatch** — test name `[ID]` not in `cases.md`, or one case's expected split across tests that
   do not all carry its tag.
7. **Order / data dependence** — tests rely on another test's data or on shared env data that may change.
   Create or select data inside the test; record created data.
8. **Silent pass** — `try/catch` swallowing failures, `passWithNoTests`, skipped tests counted as pass.
9. **Secrets** — accounts, tokens or passwords in the test file. Use env vars named in `test.config.json`.
10. **Fixed waits** — `waitForTimeout(n)`, `sleep(n)`, `Thread.sleep`, `time.sleep`, `setTimeout` used to
    "give the app time". They make runs slow and still flaky (too short on a slow day, wasted time on a
    fast one). Wait for the condition the step causes: the API response, the dialog/dropdown/mask
    appearing or going away, the cell value or enabled state changing. Allowed only ≤ 200 ms for a pure
    animation, with a comment. `node $PLUGIN/core/lint-tests.mjs <test files/dirs>` finds them.
