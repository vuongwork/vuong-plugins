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

## "No code" / "code missing" claims must be searched

A row saying "spec rule without code", "code missing" or "not implemented" (here or in `diff.md`) is a
claim about the whole repo, not about the file you read. Before writing it:

1. Search the WHOLE repo (and the sibling BE repo if in scope) for each handle of the rule: message ID /
   error code, field / column name, the message text (or a distinctive part of it), the API path.
   Include shared components, dialogs, mixins, validators, i18n files — checks often live there.
2. Cite the search in the row: the command and scope, e.g. ``grep -rn "MSG-123\|refNo" src/ ../be/src``.
3. A hit → follow it and record `file:line` (the rule may be implemented somewhere shared).
   No hit → write "not found by `<search>`, unverified", never a bare "no code".
