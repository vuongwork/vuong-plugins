# Data plan — <scope>

Written in step 4 from the Data column of `cases.md`, shown at the approval gate (step 5).
One row per DISTINCT data need (a record in a given state, a master value with dependent data, a file,
an account with a role). The run starts only when every need is `exists`, `create-in-test`, or supplied.

How to get it:
- `exists` — found in the target environment; say where/how it was found (screen + search, key)
- `create-in-test` — created through the app UI/API inside a case with Writes = Y (name that case)
- `user-provides` — the tester/BA must supply it before the run (key, file, account)
- `cannot` — no way to get it in this environment; dependent cases become BLOCKED

| Need | Concrete data (key / state / file) | How to get | Found / created by | Cases | Status |
|---|---|---|---|---|---|
| N1 | <record in state X with Y lines> | exists | <screen + search used, key found> | X-001, X-004 | ready |
| N2 | <account with role R> | user-provides | — | X-010 | waiting |
| N3 | <record with status S that only the backend can set> | cannot | — | X-020 | BLOCKED |

## To ask the user before the run
Every row with `user-provides` or `cannot`, with the cases that depend on it.
