# test.config.json

One per project, at the repo root. Created by `node $PLUGIN/core/init.mjs <repo>` from
`templates/test.config.json`. Committed. Contains no secrets.

## Paths that differ per member: `${NAME}` + `test.config.local.json`

Folders outside the repo (shared drive, SVN checkout of the specs, sibling backend repo) are at a different
place on each machine. The shared file names them; each member's machine gives the value:

```jsonc
// test.config.json (committed): what is needed, with a description used as the question
"vars": { "DESIGN_SPECS": "Folder with the shared design specs (xlsx / docx) on your machine" },
"specPaths": [{ "path": "${DESIGN_SPECS}", "kind": "design", "match": ["*{scope}*.xlsx"] }]

// test.config.local.json (next to it, gitignored, one per machine): the values + overrides
{ "vars": { "DESIGN_SPECS": "D:/work/specs-design" },
  "environments": { "local": { "baseUrl": "http://localhost:3001" } } }
```

- `${NAME}` works in any string value. The value comes from the environment variable `NAME` first (CI),
  then `vars` in the local file. `~` at the start means the home folder.
- Any other key in the local file overrides the shared one for this machine only: objects merge key by key,
  arrays and plain values replace.
- Keep conventions (`match`, `kind`, `exclude`, `scopes`) in the shared file; only the location is per machine.
- `node $PLUGIN/core/config.mjs --check` (exit 1) lists every name with no value on this machine, every
  `specPaths` / `stacks[].dir` folder that does not exist, and warns when the local file is committed or not in
  `.gitignore`. `--set NAME=value ...` writes values into the local file; `--print` shows the resolved config.
- `find-spec.mjs` stops when a name has no value. `import-cases`, `export-cases` and the kits read the merged
  config too (the local `environments` override applies to the write guard).
- `init.mjs` adds `test.config.local.json` to `.gitignore` and creates it with the names left empty.
  No passwords in either file; test accounts stay in the account file outside the repo.

| Key | Meaning |
|---|---|
| `vars` | names used as `${NAME}` → description (the question asked to a member who has no value). Values live in `test.config.local.json` |
| `project` | label used in report file names |
| `workDir` | where `W = <workDir>/<scope>/` folders live (default `test-work`) |
| `specPaths` | where step 2 looks for documents. Each entry is a folder (repo-relative or absolute: a shared drive, an SVN checkout) or `{ "path", "kind", "match": ["*{scope}*.xlsx"], "exclude": [] }`; `{scope}` is replaced by the screen / feature keyword. `kind` labels the source type (`decision`, `ticket`, `design`, `acceptance`, `ut-old`, `mock`, …). One folder holding several kinds: add `"kinds": { "<glob>": "<kind>" }` — the first glob matching the file name sets that file's kind, other files keep `kind` (e.g. `{ "path": ".../specs/design", "kind": "screen", "match": ["*{scope}*", "api-{scope}-*"], "kinds": { "api-*": "api" } }` → the screen file is `screen`, `api-SCR001-...` is `api`). `exclude`: a glob without `/` matches the file name (`~$*`); with `/` it matches the path relative to `path` (`**/old/**`, `mobile/**`). `scopeMatch` (optional): the entry is used only when the scope matches one of its globs — one shared folder split by screen family, e.g. two entries on the same folder: `{ "exclude": ["mobile/**"], "scopeMatch": ["WEB*"] }` and `{ "exclude": ["web-api/**"], "scopeMatch": ["APP*"] }`. List with `node $PLUGIN/core/find-spec.mjs <keyword>` |
| `scopes` | other names of a scope used by `find-spec.mjs`: `{ "<screen-id>": ["<feature name>", "<API id>", ...] }` — the screen spec and its API specs are often named differently |
| `specPrecedence` | order of `kind`s used when two sources disagree, strongest first (e.g. `["decision","ticket","design","acceptance","ut-old","mock"]`). The stronger source sets the expected result; the conflict is still listed in `spec-sources.md` and `diff.md` |
| `caseTemplates` | layouts of the tester's own test case files (one entry per layout a project uses; nothing is built in). `name`, `match` (file-name glob that selects the entry), `sheet` (name or glob), `headerRow` / `firstRow` / `lastRow`, `columns` (letters): `no` (case number; required), `flow` (operation / screen area), `steps` (check; required), `expected` (required), `result`, `evidence`, `tester`, `date`; `groupMarker` (value in `no` marking a group heading row whose flow / steps carry to the rows below, default `*`), `idFormat` (default `{scope}-{no}`; add `{sheet}` when numbers repeat per sheet), `vagueExpected` (regexes: expected texts that are not values → marked `⚠ not concrete`), `dataRef` (regex: steps pointing to a data sheet), `results` (labels written back: `passed` / `failed` / `blocked` / `notrun`). Used by `import-cases.mjs` and `export-cases.mjs` |
| `stacks[]` | one entry per runnable test suite: `id`, `stack` (see `stacks/README.md`), `dir` (relative to repo; may point to a sibling repo), `run` (command), `results` (`jest-json` / `junit` / `e2e-json` / `api-json` path), `coverage` (istanbul json or jacoco xml) |
| `environments` | name → `baseUrl`, `writesAllowed` (`true` / `false` / `"ask"`: may the agent propose write cases here), `writable` (`true` only where the E2E kit may run `writes:true` cases; anything else BLOCKS them), optional `match` (string the detected environment must contain; default `baseUrl`), optional `apiBase` (backend URL for `kit/api-kit.mjs`; an API run matches the environment by `apiBase` as well). An array `[{ "name", "baseUrl"/"match", "writable" }]` is also accepted |
| `accounts.env` | NAMES of env vars holding test accounts |
| `dataRules` | how test data is named, where it may be created, how it is cleaned |
| `uploader` | `null`, or `{ "command": "...{report}..." }` to publish the HTML report (run only on user request) |

Step 7 reads `stacks[].results` and `coverage` to build the `collect.mjs` arguments.

The E2E kit (`kit/e2e-kit.mjs`) reads `environments` at run time: a case declared `{ writes: true }` runs only
when the detected environment (page URL, or the project's `envCheck`) matches an entry with
`"writable": true`. Default for every entry is not writable.
