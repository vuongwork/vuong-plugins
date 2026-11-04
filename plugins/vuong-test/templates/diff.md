# Spec vs code — <scope>   (commit <sha>)

Filled in step 3 while mapping flow rows to spec rules; updated in step 7 from the test results.
One row per place where a source says one thing and the code does another. Not a bug list: the
Decision column says which side changes (code fix, or spec/DD update), decided by a named person.

| Diff | Area | Spec says | Source | Code does | file:line | Cases | Decision |
|---|---|---|---|---|---|---|---|
| D1 | <area> | <rule text> | R12 (<doc / sheet / cell>) | <observed in code> | src/x.vue:120 (found by `grep -rn "<id or text>" src/`) | <case IDs that test it> | <follow spec → fix code / follow code → update DD, by whom + date / open> |

## Spec rules without code
Only after a repo-wide search for the rule's message ID, field name and message text (shared components,
dialogs, mixins, BE validators too). Cite the exact search. Nothing found → "not found by <search>, unverified".
| Rule | Source | Searched (command + scope) | Result | Note |
|---|---|---|---|---|
| <rule> | R7 | `grep -rn "MSG-123\|fieldName" src/ ../backend/src` | not found by that search, unverified | |

## Code without spec
Grouped themes of business behavior no source describes; each points to a BA question in spec-sources.md.
