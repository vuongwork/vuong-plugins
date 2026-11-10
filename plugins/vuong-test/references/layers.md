# Choosing the Layer column

Pick the **lowest layer that can observe the expected result**. A case whose expected result can be
observed without the real backend must not be `e2e`: E2E on a shared DB is slow, flaky, needs data and
may write. Use `e2e` / `api` only when the expected result *is* backend truth.

| The expected result is… | Layer | Backend |
|---|---|---|
| Output of a pure function (calc, format, parse, validator returning a code) | `ut` | none |
| Store / service logic with branches, API mocked at the HTTP module | `ut` | fake |
| What the screen shows or allows: validation messages, enable/disable, show/hide, defaults, grid behaviour driven by the component, request payload built from UI state, message for a given HTTP status | `mount` | fake API (`kit/fake-api.mjs`) |
| Several modules wired together in one process (BE service + repository on a test DB, FE page + real store + router) | `it` | test DB / in-process |
| BE contract: status code, error code, validation enforced by BE, permission denied by BE | `api` | real |
| Persistence (saved and read back), numbering / sequences, locks and concurrent edits, permissions enforced by BE as seen in the UI, cross-screen effects, real widget rendering (canvas grid, charts) | `e2e` (or `api` when no UI is needed) | real |
| Something no runner in the project can observe or drive: install / update over the previous build, device restart, OS pickers and permission dialogs, another app (Files, Drive, mail), a notification at a real time, a physical device, whether a message is *visible where the user looks* | `manual` | real |

Hints:
- "Message X appears when the server answers 409" → `mount` (fake the 409). "Two users editing the same
  record get 409" → `api` / `e2e` (the lock itself is the result).
- A heavy widget mapped to an empty mock in the test config proves nothing about the widget → `e2e` for
  what the widget itself does; `mount` for what the component does around it (calls, payloads, state).
- One flow often splits: screen logic as `mount`, one happy-path `e2e` proving persistence.

## manual

A person runs the case from a runbook (`core/manual-runbook.mjs` → xlsx) and fills Status / Actual; `collect.mjs
--manual <filled xlsx>` puts the results into the same report. Use it only when no automated layer can observe
the result — not to save writing a test. Rules for the case text:
- Steps numbered (`1. … <br>2. …`), button and menu names exactly as on screen (OS screens: the English label too).
- Expected says *where* the result shows ("toast at the bottom", "line under the title"), not only the text:
  a message rendered off-screen passes an automated "text exists" check and is still a bug for the user.
- Credentials, backups and waiting times the case costs go in Data ("needs the master password; 5 wrong tries
  lock input for 60 s"), so the person is not stuck half-way.
- `Pre` names the cases that must pass first; destructive cases (wipe, restore, install over) run last, after
  the backup they need — say so in the `Run order` header line.
- Optional environment (adb, a second device, cloud account): say "no <tool> → Skip" in Data.

## Writes

`mount` and `ut` never write data: every HTTP call goes to the fake (strict mode throws on an unknown
route). Writes column is always `N` for them. Only `it` (own test DB), `api` and `e2e` can write, and only
in a case declared Writes = Y (see `data-plan.md`). A `manual` case that changes data (wipe, restore, test
records) is Writes = Y too.

## Full stack (FE → BE)

Testing FE and BE together does not mean everything becomes `e2e`. Per flow:
- the screen behaviour → `mount` (fast, no data);
- the BE rule (status, error code, persistence, numbering, permission) → `api` (seconds, no browser);
- one `e2e` per user journey proving the two are wired: the E2E kit records the API calls of each case
  (FE→BE trace in the report), so a FAIL shows whether the FE sent the wrong request or the BE answered wrong.
Same flow ref in `cases.md` links the three; one `collect` puts them in one report.

Stack how-to: `stacks/mount.md` (mount), `stacks/js.md` / `stacks/java.md` (ut), `stacks/api.md` (api), `stacks/playwright.md` (e2e).
