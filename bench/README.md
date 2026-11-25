# bench — measure a plugin: cost, speed, accuracy

Runs a case with `claude -p` in a temp workspace, with the plugin (`--plugin-dir`) and optionally without it
(baseline), then grades the workspace with the case's own script. Not shipped with any plugin (lives outside `plugins/`).
Design: `docs/superpowers/specs/2026-11-25-vuong-test-measurement.md`.

```
node bench/run.mjs bench/suites/<plugin>/cases/<case> [--arm plugin|baseline|both] [--runs N] [--budget USD] [--model M] [--keep]
node bench/report.mjs <plugin> [--case <name>] [--last N] [--steps] [--out file.md]
node bench/test/selftest.mjs        # no model, no network
```

Each run appends one row to `bench/results/<suite>/runs.jsonl` (gitignored) and keeps `trace.jsonl`, `grade.json`,
`command.json` in `bench/results/<suite>/<case>/<run>/`; the workspace is kept on error or with `--keep`.

## Adding a plugin

```
bench/suites/<plugin>/
  steps.json            { skill, docs, checks, steps: [{ name, bash: [re], write: [re], read: [re] }] }
  cases/<case>/
    case.json           plugin, fixture, budgetUsd, arms, allowedTools, ... (see run.mjs header)
    prompt.md           the request, plugin-neutral so the baseline arm gets the same task ({{WS}} = workspace)
    answers.md          what a person would answer (appended to the system prompt; AskUserQuestion is removed)
    inputs/             files copied over the fixture (outputs of earlier steps)
    key.json            answer key
    grade.mjs           export default async ({ ws, key, read, exists, sh, events }) => [{ name, score 0..1, detail, by }]
```

Shared fixtures live in `bench/fixtures/<name>/`. Grader helpers: `lib/grade.mjs` (`mdTables`, `matchKey`,
`badRefs`, `fileLines`, `sh`, `check`).

## Notes

- Runs use the claude.ai login: `ANTHROPIC_API_KEY` and the parent session's `CLAUDE_CODE_*` variables are removed
  from the child's environment. `--setting-sources ""` and `--strict-mcp-config` keep personal plugins, settings and
  MCP servers out, so both arms start from the same base (~25k cached tokens of built-in prompt and tools).
- Costs are Claude Code's list-price estimates; a subscription is not billed in USD. Use them to compare runs.
- Per-step split: a message counts toward the step of the next step signal after it. It is an approximation.
