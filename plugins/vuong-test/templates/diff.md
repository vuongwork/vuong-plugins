# Spec vs code — <scope>   (commit <sha>)

Filled in step 3 while mapping flow rows to spec rules; updated in step 7 from the test results.
One row per place where a source says one thing and the code does another. Not a bug list: the
Decision column says which side changes (code fix, or spec/DD update), decided by a named person.

Every row reads on its own: the rule in words, the document by its file name, the code by `file:line`.
Codes from other files (rule `R12`, source `S2`, flow `B3`) may follow in brackets, never replace the text.
Re-run: update rows in place and keep their D numbers; a difference that is gone gets Decision
`resolved @<sha>` instead of being deleted; new rows continue the numbering.

| Diff | Area | Spec says | Source | Code does | file:line | Cases | Decision |
|---|---|---|---|---|---|---|---|
| D1 | Save — Ref No | Ref No is mandatory on Save, error ERR-001 | `SRS_v3.xlsx › Screen!E28` (R12) | saves with an empty Ref No | src/x.vue:120 (found by `grep -rn "ERR-001\|refNo" src/`) | X-001 | open — <name> to decide: fix code / update the SRS |

## Spec rules without code
Only after a repo-wide search for the rule's message ID, field name and message text (shared components,
dialogs, mixins, BE validators too). Cite the exact search. Nothing found → "not found by <search>, unverified".
| Rule | Source | Searched (command + scope) | Result | Note |
|---|---|---|---|---|
| Amount over 1,000,000 needs approval (MSG-123) | `SRS_v3.xlsx › Rules!C7` (R7) | `grep -rn "MSG-123\|approvalLimit" src/ ../backend/src` | not found by that search, unverified | |

## Code without spec
Grouped themes of business behavior no source describes; each points to a BA question in spec-sources.md
(write the question text here too, not only its Q number).
