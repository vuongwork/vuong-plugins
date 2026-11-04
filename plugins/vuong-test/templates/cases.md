# Cases — <scope>

- Flows: `flows.md` (commit <sha>)
- Sources: `spec-sources.md`
- Environment: <env>   ·   Writes data: <Y/N, what, cleanup>
- Approved by: <name>   ·   Date: <YYYY-MM-DD>

| ID | Layer | Flow | Steps | Expected | Source | Data | Writes |
|---|---|---|---|---|---|---|---|
| X-001 | e2e | E1/B1 | New → Save with empty header | error ERR-001 "mandatory" for Ref No | SRS 3.2 row 4 | none | N |
| X-002 | ut | B7 | `calcTotal(price=2, qty=25)` | 50 | assumption | — | N |

Layer: `ut` · `mount` · `it` (integration) · `api` · `e2e`.
Origin (optional column): `Sheet!row` of the case in the tester's file (`import-cases.mjs`); export writes the result back there.
Source: a citation from `spec-sources.md`, or `assumption` (blocks approval).

## Not covered

| Flow ref | Reason |
|---|---|
| E5 | Help popup — out of scope for this ticket |
