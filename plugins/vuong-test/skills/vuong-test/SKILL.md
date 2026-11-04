---
name: vuong-test
description: Use when the user wants to test a screen, feature, API, ticket or module at any layer (unit, component mount, integration, API, E2E) in any supported stack (JS/TS Jest/Vitest, Java JUnit/Maven, Playwright, API kit / Newman), including full-stack FE → BE — "test màn X", "viết UT cho", "chạy e2e", "test API", "test BE", "test case cho ticket", "report test", "vuong-test …". Also use to set up the test process in a new project or on a member's machine after cloning ("vuong-test init", `/vuong-test:init`). Drives one fixed flow: clarify spec → list flows from spec + code (flows.md) → cases.md → tester approves → write/run tests → HTML report. Do NOT use for code review or for fixing a known bug without testing.
---

# vuong-test — one test process for every layer and stack

The flow below is the same for every member, project, layer and language. Do not skip or reorder steps.
Each step names its output file; a step is done only when that file exists. Details live in `$PLUGIN/references/`.

Paths: `PLUGIN=${CLAUDE_PLUGIN_ROOT}` (this plugin). Project config: `<repo>/test.config.json`.
Working folder per scope: `<cfg.workDir>/<scope>/` (default `test-work/<scope>/`), called `W` below.

`/vuong-test:vuong-test help` (or `/vuong-test:help [word]`): run `node $PLUGIN/core/help.mjs [word]` and show its output as is; do nothing else.

## 0. Setup (once per project)

If `test.config.json` is missing: run `node $PLUGIN/core/init.mjs <repo>` and fill it with the user
(stacks, test commands, env, accounts by env var name, data rules, uploader). Read `$PLUGIN/references/config.md`.

**Every run, this machine** (also when the config exists — a member who just cloned has no local file):
run `node $PLUGIN/core/config.mjs --check` in the repo. Exit 1 → for each name it lists, ask the user one
question (the description after `—`; "where is it on your machine?"), then
`node $PLUGIN/core/config.mjs --set NAME=<answer>` and check again. If it says the local file is committed,
tell the user the `git rm --cached` line; do not run it yourself. Read stacks, dirs and environments from
`node $PLUGIN/core/config.mjs --print` (the resolved config), not from the raw file.

Spec locations (ask, do not guess): ask the user where the documents live (repo folders, shared drive,
SVN/Git checkout of the design docs). Run `node $PLUGIN/core/scan-specs.mjs <those folders>` and show the
suggested folders per kind. Then ask, one question each, and write the answers into `specPaths`. A folder
outside the repo: write `${NAME}` in `specPaths`, describe it in `vars`, and put the path in this machine's
local file with `--set` (other members answer the same question on their machine):
1. **Screen / feature spec** (detail design, functional spec): which folder, file naming (`match`)?
2. **API spec** (endpoint / interface design, OpenAPI): which folder, naming? How does a screen map to its
   APIs (record in `scopes`, e.g. screen ID → API IDs)?
3. Acceptance / QA test specs, requirements, decisions, tickets (tracker export or online), mock-ups, old UT:
   which exist and where?
4. Which source wins when they disagree (`specPrecedence`)?
A kind the user says does not exist is recorded as such (`"specMissing": ["api"]`), so step 2 does not
search for it again and every case needing it is an assumption. Verify with
`node $PLUGIN/core/find-spec.mjs <one known screen>` that the screen spec AND its API spec are found.

## 1. Scope

Ask/confirm: what (screen / feature / endpoint / ticket), which layers, which stack(s), which environment,
and whether any case may **write data** to a shared environment. Write `W/scope.md`.
**Always ask: "Is there a test case file from the tester for this scope?"** (path; `find-spec.mjs` hits of kind
`acceptance` are candidates — confirm, do not assume). Record the answer in `scope.md` (file + sha256, or "none").

## 2. Clarify spec → `W/spec-sources.md`

Read `$PLUGIN/references/spec-and-sources.md`. Run `node $PLUGIN/core/find-spec.mjs <scope keyword(s)>` to list the
documents in `cfg.specPaths` (no hit → ask the user where the spec is and add it to `specPaths`). Convert each xlsx/xlsm/docx hit with `node $PLUGIN/core/read-spec.mjs <file>...` (→ `test-work/_spec/<name>.md`, read-only on the source; header has modified date + sha256 for `spec-sources.md`) and cite the bold `**Sheet!Cell**` / `**¶N**` / `**Table T rRcC**` labels it prints; exit 3 (pdf/pptx/doc/xls) → use a document reader skill. Collect every
source (spec, ticket, decisions file, named person + date); record each file's modified date / revision.
Every citation names the file: `<file> › Sheet!Cell` (or the `#` from the Sources table: `S2 › Sheet!Cell`) — never a sheet alone.
Conflicting sources: the stronger `kind` in `cfg.specPrecedence` sets the expected result, the conflict is
still listed; no precedence configured → ask the user.
Every expected result must cite a source. No source → mark **assumption** and add a question for BA.
Never derive "expected" from code, comments or commit messages.

## 3. List flows → `W/flows.md`

Read `$PLUGIN/references/flows.md` and the stack guide `$PLUGIN/references/stacks/<stack>.md`.
List ALL entry points, modes, buttons, branches, validations and error codes, each with `file:line`
(FE: screen modes, buttons, grid actions, validations; BE: endpoints, service branches, exceptions → error codes, transactions).
For each FE action record the endpoint it calls (method + path) — that links the FE flow to the API flow;
for each endpoint list request rules, error codes, permission and side effects from the API spec
(`references/stacks/api.md`).
Mark which items are covered by spec and which are not. This step exists so no flow is silently missed.

Then write `W/diff.md` from `$PLUGIN/templates/diff.md`: every place where a mapped rule and the code
disagree (value, limit, message, enable condition, rounding...), every spec rule with no code found, and
grouped code behavior with no spec. Each difference row lists the case IDs that will test it and a
Decision (follow spec → fix code / follow code → update the spec document / open), decided by a named
person. The difference list is a deliverable on its own: spec owners use it to update the document.
"Spec rule without code" / "code missing" rows need a repo-wide search (message ID, field, text — shared
components too) cited in the row; no hit → "not found by `<search>`, unverified" (`references/flows.md`).

## 4. Cases → `W/cases.md`

Tester's file given in step 1 → start from it: `node $PLUGIN/core/import-cases.mjs <file> --scope <scope> --out W/cases.md`
(layout from `cfg.caseTemplates`; no matching entry → read the file with `read-spec.mjs`, ask the user which
sheet / header row / columns hold No., operation, check, expected, result, evidence, and add the entry to
`test.config.json` — never hard-code a layout). Keep the tester's IDs and the `Origin` column. Then: set Layer
and Writes, replace each `⚠ not concrete` Expected with the value from the spec (cite it) or mark assumption,
map Flow to `flows.md` refs, and **add cases for flow items the tester's file misses** (Origin empty). Tester
rows that match no flow item → ask the user. No tester file → copy `$PLUGIN/templates/cases.md`. One row per case: ID, layer, flow (flow ref), steps, expected,
source, data, writes data (Y/N). Layer: read `$PLUGIN/references/layers.md` — the lowest layer that can
observe the expected result; screen logic with no backend truth is `mount` (fake API), not `e2e`. Every flow item is either covered by a case or listed under
"Not covered" with a reason. Run `node $PLUGIN/core/lint-cases.mjs W/cases.md` until it has no errors
and no Data warnings.

Data column: say concretely what the case needs (which record, in which state, which master value with
dependent data, which file/account) — never `-` or `any`. Then write `W/data-plan.md` from
`$PLUGIN/templates/data-plan.md`: one row per distinct need → how to get it (`exists` — checked in the target
environment through the UI, key recorded / `create-in-test` — through the app inside a Writes = Y case /
`user-provides` / `cannot`) → the cases depending on it.

## 5. Approval gate (STOP)

First run `node $PLUGIN/core/cases-summary.mjs W/cases.md --flows W/flows.md --out W/cases-summary.md` and show
that overview BEFORE the case list: one row per area (entry point + its branches) with how many flow items have a
case, the cases by layer, and the **gaps** (flow items with no case and not in Not covered). The approver often
judges coverage from this alone; list each gap and ask: add a case, or move it to Not covered with a reason.
Then offer `cases.md` for the detail. **The person who runs the tests approves.**
Approval is allowed only when every expected result has a source; assumption rows must be answered by BA
first or set to BLOCKED. Record approver + date in the `cases.md` header. Do not write test code before this.
Also show the data-plan rows marked `user-provides` or `cannot` with their cases, so the user can supply
the data now; cases whose data is still missing at run time are BLOCKED, not improvised.

## 6. Write and dry-run tests

Follow `$PLUGIN/references/stacks/<stack>.md` and `$PLUGIN/references/review-tests.md`.
- Test names start with the case tag: `[<ID>] ...` (any language) — this links results to cases.
- You may change HOW a result is reached (selector, data, helper) without re-approval; log each change
  in `W/run-notes.md`. You may NOT change an expected result or add/remove cases — go back to step 5.
- Self-review the tests against `$PLUGIN/references/review-tests.md` before the real run, and run
  `node $PLUGIN/core/lint-tests.mjs <test dirs>` (fixed waits, hard-coded secrets) until it passes.
- Parallel work: split the approved cases by area/flow group and **suggest** a number of parallel agents
  to the user before starting — about 1 agent per 15–25 E2E cases (1 per 40–60 UT cases), max 5. Show the
  split and start only after the user agrees. Fixed template, one row per agent `<group>`:
  | Agent | Cases | Test file (own) | Out dir (own) | Notes (own) | Data |
  |---|---|---|---|---|---|
  | `<group>` | IDs | `W/e2e-<group>.mjs` / `W/api-<group>.mjs` | `W/e2e-<group>/` / `W/api-<group>/` (`out`) | `W/run-notes-<group>.md` | data-plan rows it uses |
  Shared helpers are written and dry-run BEFORE the parallel run and are read-only during it; a needed
  helper change goes into the agent's run notes and is made afterwards. Only ONE agent — the one owning all
  Writes = Y cases — may write data and append to `W/data-created.md`; the others run read-only (write guard on).
- Accounts: never ask the user to create the account file by hand. Run
  `node $PLUGIN/core/account.mjs ~/.<project>-test-account.sh --vars <names from cfg.accounts.env>`: it creates
  the file (mode 600, outside the repo) with empty `export NAME=` lines, so the user only types the values; run it
  again to check (it never prints values). Tests run as `source <file> && <command>`. Never read or echo the values.
- Failure messages: check expected values with `verify(what, expected, actual)` (both kits) so a failure reads
  `✗ <what> / Expected: … / Actual: …` — no packed one-line dumps like `missing: x — dialog=[…] codes=… rows=0`.
- Watching a run: `E2E_HEADED=1 E2E_SLOWMO=<ms>` only when the user wants to watch. Default runs (and CI)
  are headless with no slow-motion; never put a fixed delay in a test to make it watchable.

## 7. Run and report → `W/report/*.html`

Run the stack command(s), then:
`node $PLUGIN/core/collect.mjs --cases W/cases.md --out W/results.json <inputs>` and
`node $PLUGIN/core/render-html.mjs W/results.json --out W/report/` and
`node $PLUGIN/core/export-cases.mjs W/results.json --out W/report/ [--file <tester file> --tester <name>]`
(Excel: default layout always; with the tester's file also a copy with result / evidence written into their
rows — the original is never touched, rows of cases that did not run keep the tester's values).
E2E scripts use `$PLUGIN/kit/e2e-kit.mjs` (it also records each case's API calls: FE→BE trace); API scripts use `$PLUGIN/kit/api-kit.mjs` (results `--api-dir W`). Inputs: `--junit <file|dir>` (any stack), `--jest-json <file>`, `--e2e-json <file>`, `--coverage <file>`
(istanbul `coverage-final.json` or JaCoCo `jacoco.xml`), `--shots <dir>`, `--notes W/run-notes.md` (repeatable), `--diff W/diff.md` (the report marks each difference
reproduced / not reproduced / unverified from its cases' results).
Parallel / split runs: `--e2e-dir W`, `--api-dir W` (every `W/api*/api-results.json`) (every `W/e2e*/e2e-results.json`), `--jest-dir <dir>`, `--notes-dir W`
(every `W/run-notes*.md`).
Report statuses: PASS / FAIL / BLOCKED / NOT RUN per case. Also list data created and unverified bugs.
Data created: every case with Writes = Y appends one row per record it created/changed to `W/data-created.md`
(from `$PLUGIN/templates/data-created.md`) right after the write succeeds — case ID, environment, record key,
action, how to delete/revert. Pass `--data W/data-created.md` to collect; the report lists it so the tester
can clean up. Records that cannot be removed in the UI get Status `needs-be`.
Cleanup: run `node $PLUGIN/core/cleanup-list.mjs W/data-created.md` and show the list to the user (UI
deletions / needs BE-DB / done; exit 1 = something left). Never delete beyond what the cases themselves do
unless the user asks.
A bug is "confirmed" only with a reproduction (failing test, log, or trace with file:line); otherwise "unverified".
If `cfg.uploader` is set, tell the user the upload command; upload only when the user says so.

### Failed tests: the user's verdict → `W/triage.md`
When the user answers about a failed test ("this is correct", "test is wrong", "real bug", "ask BA"), append one row to
`W/triage.md` (`$PLUGIN/templates/triage.md`) at once, in their words, with their name + date:
`app-correct` (app is right, Expected is wrong) · `test-wrong` (Expected right, test code wrong) · `bug` (needs the
failing test as reproduction) · `spec-unclear` (question for BA in spec-sources.md). Never decide a verdict yourself.
- `app-correct`: the user's statement (name + date) becomes the Source; change Expected in `cases.md` only through
  step 5 (re-approval) and, when the spec says otherwise, add a `diff.md` row.
- `test-wrong`: fix HOW (no re-approval), log in run notes, re-run.
Re-run and collect again (collect reads `W/triage.md` by default); the report shows the verdict next to each failure
and counts "fail not reviewed". Rows stay after a later PASS (history).

## 8. Commit

Commit per the project's commit rules: `spec-sources.md`, `flows.md`, `diff.md`, `cases.md`, `triage.md`, `data-plan.md`,
(the exported Excel goes to the tester / uploader, not into git),
`data-created.md`, `run-notes*.md`, test code. Not: `report/`, screenshots, `e2e*/`, `results.json`,
caches (gitignored by `init`). Run `cleanup-list.mjs` once more and tell the user what is still left.
Never commit credentials.

## Hard rules
- Never report "feature tested" from a PASS count; report coverage of the flow list (cases / flow items).
- Never run a case that writes shared data without the "writes data" consent from step 1, and never
  without recording what it wrote in `W/data-created.md`.
- Stack not listed as supported in `$PLUGIN/references/stacks/README.md` → say so and stop; do not improvise a runner.
- No direct DB connection, SQL or DB client (psql, mysql, sqlcmd, mongo, GUI clients...) — not in tests and
  not by the agent. Test data is read/created only through the app's own UI/API flows covered by a case.
- No direct API write call (POST/PUT/PATCH/DELETE via curl, fetch, request...) outside a case declared
  `writes: true`; E2E and API read-only cases run with the kit's write guard on. API tests go through
  `kit/api-kit.mjs` (guards, evidence, data-created), never ad-hoc curl.
- Never run destructive shell commands: `rm -rf`, `git reset` / `git clean` / `git push` / `git stash -u`,
  `DROP` / `TRUNCATE` / `DELETE FROM`, `curl -X DELETE|PUT|POST|PATCH`. Need one → ask the user to run it.
