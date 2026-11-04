# Triage — <scope>

The user's verdict on each failed test. One row per answer; a later row for the same case replaces the earlier one.
Verdict: `app-correct` (app is right, Expected is wrong → re-approve in step 5) · `test-wrong` (test code wrong → fix, re-run)
· `bug` (real defect, the failing test is the reproduction) · `spec-unclear` (question for BA).

| Case | Test | Verdict | By + date | Reason / source | Action |
|---|---|---|---|---|---|
| X-004 | [X-004] GET 400 → message | app-correct | <name> 2026-11-04 | BE returns the code without message, agreed with BA | Expected → "code only"; re-approve |
