# vuong-test

One test process for every member, project, layer (UT, component mount, integration, API, E2E) and stack.
Claude Code plugin; skill `/vuong-test`.

```
scope → clarify spec → list flows (file:line) + spec≠code diff → cases.md → tester approves → write/run → HTML report → commit
```

Why: tests went green while flows were never listed and expected results were invented from code. Each step
here produces a file, so a missing step is visible: no `flows.md` = flows not listed; `assumption` in
`cases.md` = expected result without a source; untagged tests = results not traced to a case.
`diff.md` lists where the spec document and the code disagree; the report shows which differences a
test reproduced, so the team decides per row whether the code or the document changes.

## Install

```
/plugin marketplace add vuongwork/vuong-plugins
/plugin install vuong-test@vuong-plugins
```

The plugin lives in the [vuong-plugins](https://github.com/vuongwork/vuong-plugins) marketplace repo. Update with
`/plugin marketplace update vuong-plugins`. Requires Node ≥ 18. Stack tools come from the project (Jest,
Maven, Playwright...). The plugin has no npm dependencies.

### Safety hook

Installing the plugin enables `hooks/guard-bash.mjs` (via `hooks/hooks.json`, PreToolUse on Bash) in every
project where the plugin is enabled. It blocks commands that can destroy data or history: SQL
DROP/TRUNCATE/DELETE FROM, DB clients (psql, mysql, sqlcmd, mongo...), `git reset --hard / clean -f /
push --force / stash -u / checkout -- .`, `rm -r` on `/ ~ . ..`, `curl/wget` write calls (-X
DELETE/PUT/POST/PATCH or a body), mkfs/dd/shutdown. A blocked command → Claude asks the user to run it
themselves (`!` prefix).

- Project-specific patterns: env `VUONG_TEST_GUARD_EXTRA=<regex>`.
- Turn it off: env `VUONG_TEST_GUARD=off` (or disable the plugin in that project).
- It matches text, so a command that merely mentions a blocked pattern (e.g. inside `echo`) is blocked too.

## Use

```
/vuong-test init                         # once per project → test.config.json
/vuong-test <screen|feature|ticket|endpoint> [--layer ut|mount|it|api|e2e]
```

Scripts (also usable without Claude, e.g. in CI):

| Script | Purpose |
|---|---|
| `core/init.mjs <repo>` | create `test.config.json`, this machine's `test.config.local.json`, `test-work/`, `.gitignore` entries (idempotent); detect stacks |
| `core/config.mjs --check \| --set NAME=value \| --print` | per-machine paths: `${NAME}` in `test.config.json`, values in the gitignored `test.config.local.json` (or env vars); lists missing names / folders, writes values, prints the merged config |
| `core/scan-specs.mjs <folders>... [--top 6] [--all]` | setup: suggest spec folders per kind (screen, api, acceptance, requirement, decision, ticket, mock, db, old UT) from folder/file names |
| `core/find-spec.mjs <keyword>... [--config test.config.json]` | list spec documents for a scope from `specPaths` (repo or absolute paths), ordered by `specPrecedence`, with modified date |
| `core/read-spec.mjs <file>... [--out dir] [--sheets glob] [--max-rows N]` | xlsx/xlsm/docx → `test-work/_spec/<name>.md` with `**Sheet!Cell**` / `¶N` / `Table T rRcC` citation labels, merged cells, image anchors, hidden sheets; header with size, modified date, sha256; pure Node; exit 3 for unsupported types (pdf/pptx/doc/xls) |
| `core/lint-cases.mjs <cases.md> [--require-approval]` | IDs, layers, sources, checkable expected results, approval |
| `core/lint-tests.mjs <test files/dirs>` | fixed waits (`waitForTimeout`, `sleep`...) and hard-coded secrets in test code |
| `core/collect.mjs --cases ... --out results.json <inputs>` | merge Jest JSON / JUnit XML (any language) / E2E JSON / coverage into one file; `--e2e-dir` / `--jest-dir` / `--notes-dir` pick up the files of parallel agents |
| `core/render-html.mjs results.json --out <dir>` | self-contained HTML report (screenshots embedded) |
| `core/cleanup-list.mjs W/data-created.md` | cleanup checklist (UI / needs BE-DB / done); exit 1 while anything is left |
| `kit/e2e-kit.mjs` | tiny runner for plain Playwright scripts → E2E JSON + screenshots; `settle`, write guard, environment guard, discovery cache |

## What to commit

| Commit (in `test-work/<scope>/`) | Do not commit (gitignored by `init`) |
|---|---|
| `scope.md`, `spec-sources.md`, `flows.md`, `diff.md`, `cases.md`, `data-plan.md`, `data-created.md`, `run-notes*.md`, test code | `report/`, `e2e*/` (screenshots, raw E2E JSON), `results.json`, `.cache/`, `*cache*.json`, `test-work/_out/` |

The HTML report is regenerated from committed files plus a run; share it through `uploader` instead of git.

## Layout

```
skills/vuong-test/SKILL.md   the flow (entry point)
references/                  process details: sources, flows, test self-review, config, stacks/*
templates/                   cases.md, data-plan.md, data-created.md, diff.md, test.config.json
core/                        lint, collect, render, cleanup-list (Node, no deps)
kit/                         E2E helper
test/selftest.mjs            self-test of every script (run before push)
```

## Develop

Run the self-test before every push (pure Node, fixtures in the OS temp dir, exit 1 on any failure):

```
node test/selftest.mjs
VT_PLAYWRIGHT_FROM=<dir with node_modules/playwright> node test/selftest.mjs   # also runs the E2E kit checks
```

Without `VT_PLAYWRIGHT_FROM` the kit checks are skipped with a note.

## Rules for contributors

- Nothing project-specific in this repo (screen names, error codes, people, URLs, helpers for one app's
  widgets). Those live in the project repo.
- A stack is "supported" only after it ran on a real project; see `references/stacks/README.md`.
- Every change to `core/`, `kit/` or `hooks/` comes with a check in `test/selftest.mjs`; run it (with
  `VT_PLAYWRIGHT_FROM` when the kit changed) and push only when it prints `0 failed`. Fixtures with fixed
  waits or secrets are built at run time, so `core/lint-tests.mjs kit hooks test` stays clean.
- Bump `version` in `.claude-plugin/plugin.json` on every change members should receive.
