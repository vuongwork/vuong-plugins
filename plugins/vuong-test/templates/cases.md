# Cases — <scope>

- Scope: <screen / feature / endpoint / ticket> · layers <ut, mount, e2e…> · stacks <js, java…>   (step 1)
- Tester file: <path + sha256, or none>   (step 1)
- Flows: `flows.md` (commit <sha>)
- Sources: `spec-sources.md`
- Environment: <env>   ·   Writes data: <Y/N, what, cleanup>
- Approved by: <name>   ·   Date: <YYYY-MM-DD>
- Build: <build / version under test>   (manual cases only; the next two lines too)
- Run order: <which group runs first / last and why, e.g. "wipe cases last, after the backup case passed">
- Before you start: <what to back up, which test record to create, which account / password is needed>

| ID | Layer | Flow | Type | Priority | Pre | Steps | Expected | Source | Data | Writes |
|---|---|---|---|---|---|---|---|---|---|---|
| X-001 | e2e | E1 New / B1 Ref No empty | negative | high | | New → Save with empty header | error ERR-001 "mandatory" for Ref No | SRS_v3.xlsx › Screen!E28 (R4) | none: empty form | N |
| X-002 | ut | B7 total = price × qty | positive | medium | | `calcTotal(price=2, qty=25)` | 50 | assumption | — | N |
| X-003 | manual | E4 install over | regression | high | | 1. Install build N over build N-1 <br>2. Open, unlock with the old password | update accepted, data from step 0 unchanged | decision D3 | device with N-1 and real data, backup copied off the device | N |

Layer: `ut` · `mount` · `it` (integration) · `api` · `e2e` · `manual` (run by a person from the runbook).
Type, Priority, Pre: optional columns. Type `positive` · `negative` · `edge` · `security` · `regression`.
Priority `high` (blocks use or loses data) · `medium` (wrong but there is a way around) · `low` (display, convenience).
Pre: IDs that must pass first (comma separated, earlier in the table); a case whose Pre failed is reported BLOCKED.
Origin (optional column): `Sheet!row` of the case in the tester's file (`import-cases.mjs`); export writes the result back there.
Flow: the flow ref with its name (`E1 New / B1 Ref No empty`). Source: the file name + cell / section, the code from
`spec-sources.md` may follow in brackets — or `assumption` (blocks approval). Each row must read without other files open.
Re-run: keep IDs; new cases continue the numbering; a dropped case moves to Not covered with `dropped @<sha>: <why>`.

## Not covered

| Flow ref | Reason |
|---|---|
| E5 | Help popup — out of scope for this ticket |
