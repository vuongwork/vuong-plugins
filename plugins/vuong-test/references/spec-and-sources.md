# Spec and sources (step 2)

Goal: every expected result in `cases.md` can be traced to something a person decided — not to what the code
happens to do today.

## Valid sources (cite exactly)

| Kind | How to cite |
|---|---|
| Spec document | file + section/line or sheet + row (`SRS_v3.xlsx / <screen> / row 42`) |
| Ticket | ticket ID + field or comment date (`PRJ-123, description`) |
| Decisions ledger | `docs/.../decisions.md` row date |
| Behavior matrix | matrix file + row ID (`behavior-matrix-<screen>.md A4`) |
| QA test case | QA sheet + case ID (`QA 1.2.3`) |
| Person | name + date + channel (`<BA name>, 2026-01-31, chat`) |

## Not sources

Code, code comments, commit messages, variable names, "it has always worked this way", another screen's
behavior, the AI's opinion. Code is used in step 3 to FIND flows, never to DECIDE what is correct.

## When there is no source

- Write the expected result you believe is right, mark the case `assumption`, and add a question to
  `spec-sources.md` → "Questions for BA" (who, what, which cases depend on it).
- An `assumption` case cannot be approved (step 5). It becomes BLOCKED until answered, or the tester
  removes it.
- When code behavior contradicts a source, that is a candidate bug: record it as "unverified" until a
  test reproduces it.

## Finding and reading documents

- `node $PLUGIN/core/find-spec.mjs <keyword>...` lists the files in `test.config.json` `specPaths`, ordered by
  `specPrecedence`, with modified date. Search with every name the scope has (screen ID, program ID,
  feature name in each language). Open every hit; do not stop at the first.
- xlsx / xlsm / docx: run `node $PLUGIN/core/read-spec.mjs <file>... [--sheets <glob>] [--max-rows N]` first. It
  writes `test-work/_spec/<name>.md` (gitignored; never next to the source) with a citation label on every
  cell (`**Sheet!A12**`), paragraph (`**¶12**`) and table cell (`**Table 3 r2c4**`), merged ranges, image
  anchors and hidden sheets, and a header with modified date + sha256 — copy those into `spec-sources.md`.
  Cite exactly the labels it prints.
- Other office files (pptx/pdf/doc/xls, exit 3 from read-spec) or when images must be seen: use a document reader (e.g. the
  `doc-to-md` / `read-excel-spec` skills, or openpyxl / python-docx run with `python3 -I`); copy to a temp
  folder first and never write to the source location. Keep images/mock-ups referenced by the sheet.
- Cite to the cell or row: `file / sheet / cell` (xlsx), `file / §section / page` (docx, pdf), ticket ID +
  comment date. "the DD says" without a location is not a citation.
- Record the version: file modified date or revision, and ticket last-updated date. When a document
  changes later, the cases citing it are reviewed again.
- Exported trackers (Backlog/Jira CSV/xlsx) are sources too: cite issue key + row; prefer the latest export
  and the latest comment.

## Every citation names the file

A citation is `<file name> › <Sheet>!<Cell>` (xlsx), `<file name> › ¶N` / `Table T rRcC` (docx), `<file> p.N` (pdf).
A sheet or cell alone (`Cases!E28`, `Sheet1!B4`) is not a citation: several files share sheet names, and the
reader cannot find it. Use the short name from the Sources table `#` column when the file name is long:
`S2 › Items!C14`, with `S2` = the full file name + path in the Sources table. This applies to Rules,
Conflicts (both sides), Questions, cases.md `Source`, flows.md `In spec?` and diff.md.

## Conflicting sources

List every conflict (`X1`, `X2`, …) with both citations. The `kind` that comes first in
`specPrecedence` sets the expected result unless a named person decided otherwise (that decision is
recorded and becomes the strongest source). Without `specPrecedence`, each conflict is a question for the
user. A conflict where the code follows the weaker source also goes to `diff.md`.

## spec-sources.md layout

```
# Sources — <scope>
| # | Source | Kind | Location (file / sheet / cell) | Version (modified / rev) | Covers |
## Rules
| R | Rule | Source (exact citation) |
## Conflicts
| X | Topic | Source A (file › Sheet!Cell) says | Source B (file › Sheet!Cell) says | Resolved by (precedence / person + date / open) |
## Questions for BA
| Q | Question | Cases blocked | Asked to | Date | Answer |
```
