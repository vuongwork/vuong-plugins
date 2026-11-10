# Flow list (step 3)

Purpose: list everything that can happen in the scope BEFORE choosing cases, so coverage is measured
against the whole, not against what the tester happened to think of.

Source of the list: spec + code. Every row has `file:line`. Use the stack guide for where to look.

## flows.md layout

```
# Flows — <scope>   (commit <sha>)
## Entry points
| Ref | Kind | Name | file:line | In spec? |
E1   screen-mode  New            src/pages/SampleForm.vue:120   yes (SRS 3.2)
E2   button       Copy           ...                         no
E3   endpoint     POST /orders   Controller.java:88          yes
## Branches / validations / errors
| Ref | Under | Condition | Result / error code | file:line | In spec? |
B1   E1   Ref No empty on Save   ERR-001 (mandatory)   SampleForm.vue:316   yes
## Side effects
| Ref | Under | Effect (DB write, API call, message, file, notification) | file:line |
## Summary
entry points N, branches M, in spec K, not in spec M-K
```

## Rules

- Walk every mode, button, menu item, grid action, keyboard path, permission variant; for BE every
  endpoint, service method branch, thrown exception and its mapping to an error code, transaction boundary.
- Do not stop at the first happy path. A screen with New / Edit / View modes has at least three flows.
- Items not in spec are still listed (they are where undocumented behavior and bugs live); they become
  BA questions or "Not covered" rows, never silently dropped.
- Large scopes: split by entry point and use parallel readers, then merge into one file.
- Record the commit sha: the flow list is only valid for that code version.
- Re-run (new commit, same scope): update the file in place. Keep every existing Ref (E3 stays E3), add new
  items after the last number, mark an item the code no longer has `removed @<sha>` instead of deleting it.
  Never renumber: cases.md, diff.md and earlier reports point at these refs.
- Other files cite a ref with its name (`E2 Copy / B4 Ref No empty`), so a reader does not need flows.md open.

## Flows that code reading misses

Walking entry points finds what the code does when used in one sitting. These come from how the app lives
on a real device or server, so add them as their own flow items (kind `lifecycle`, `upgrade`, `external`…)
whenever the scope is a release or a feature that keeps state:

| Ask | Typical cases |
|---|---|
| **Upgrade** from the previous build (install over, DB / file migration) | data and settings kept, old password / session still works, version shown |
| The new option **not used** | the app behaves exactly as the previous build (regression) |
| **Lifecycle**: kill the app, auto-lock / session timeout, device restart, Home / back in the middle of a long operation | state kept or one clear state after reopening (done or not done), no crash, no half-written data |
| **Changed from outside**: folder or file deleted, permission revoked, account signed out, network lost, disk full | a clear error message, recovery path (choose again), no crash |
| **Limits at N + 1**: "keep 10" → do it 11 times; "max 20" → 21 | exactly N kept, the oldest one removed, nothing else |
| **Decoy data** next to what the feature touches | a file / record that *looks* like the feature's own (same prefix, other suffix) is left alone |
| **Privacy** of what the feature writes (logs, exports, crash reports, notifications) | no amounts, names, tokens or personal data in it |
| **Cost of a negative case** (lockout, rate limit, one-time token) | the wait it causes is in the case Data; cases needing the right credential run before it |
| **Destructive** actions (wipe, restore, reset) | cancel / wrong password do nothing; after it: what is gone, what must stay (external backups), how to come back |

Rows here are often `manual` cases (`layers.md` › manual). A decision made with the owner ("restore always
returns to running") is a `decision` source: write it in Expected and let the person running the case
challenge it.

## "No code" / "code missing" claims must be searched

A row saying "spec rule without code", "code missing" or "not implemented" (here or in `diff.md`) is a
claim about the whole repo, not about the file you read. Before writing it:

1. Search the WHOLE repo (and the sibling BE repo if in scope) for each handle of the rule: message ID /
   error code, field / column name, the message text (or a distinctive part of it), the API path.
   Include shared components, dialogs, mixins, validators, i18n files — checks often live there.
2. Cite the search in the row: the command and scope, e.g. ``grep -rn "MSG-123\|refNo" src/ ../be/src``.
3. A hit → follow it and record `file:line` (the rule may be implemented somewhere shared).
   No hit → write "not found by `<search>`, unverified", never a bare "no code".
