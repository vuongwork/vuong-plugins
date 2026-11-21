# vuong-design

Static HTML → design system → Figma with variables, components and IDs, verified node by node.

Work in progress: this is the layout-engine skeleton.

## Setup

- Node >= 18. No npm dependencies in this plugin.
- Playwright is looked up in `$VD_PLAYWRIGHT_FROM` (a directory containing `node_modules/playwright` or `node_modules/playwright-core`), then in the current project's `node_modules`. Nothing is installed automatically.
- Uses the Chromium already installed by Playwright (`ms-playwright/chromium-*`); it never downloads a browser.

## Tests

```
VD_PLAYWRIGHT_FROM=/path/to/dir node --test plugins/vuong-design/test/
```

## Layout CLI

```
node plugins/vuong-design/core/layout.mjs --html <file> --root <selector> --out <dir> \
  [--widen <selector>] [--name <selector>] [--widen-by <px>] [--viewport <px>] \
  [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--no-webfonts] \
  [--allowlist <json>] [--mutate [--mutate-sample <n>]]

node plugins/vuong-design/core/layout.mjs --corpus plugins/vuong-design/test/corpus.json --out <dir> [same options]
```

- `--root`: selector of the screens (one screen per match). `--widen`: the element to widen for width B (the screen or an ancestor). `--name`: selector inside a screen whose text names it.
- Tolerances default to 0.5px (frames), 1px (text), 2px (Figma model deltas before they need approval).
- `--no-webfonts`: never fetch Google Fonts (by default only font family names are sent, to render the font Figma will use); families that do not render are reported.
- `--mutate`: also plants known errors to check the checker (≈30 s per screen); `--mutate-sample <n>` limits it to n screens per file.
- `--corpus`: runs every file of a corpus JSON (`files: [{ file, root, widen? }]`, names relative to `--corpus-dir` or `$VD_CORPUS_DIR`) and uses its `allowlist` unless `--allowlist` is given.

Environment: `VD_PLAYWRIGHT_FROM` (see Setup), `VD_CORPUS_DIR` (corpus mode and the acceptance test), `VD_ACCEPT_MUTATE=1` (mutation part of the acceptance test).

Outputs in `<out>` (corpus mode: `ir.json` and `spec-*.json` in `<out>/<file name without .html>/`):

| File | Content |
|---|---|
| `ir.json` | the captured screens (boxes at widths A and B, paint, fonts, font substitutions, normalisation counts), without PNGs |
| `spec-<id>.json` | the modelled spec of a screen (compact JSON; `specBytes` is its size, `payloadOver50k` when above 50 000) |
| `report.json` | per screen: summary row, the gate after the allowlist, the full verify report, flags, mutations |
| `report.html` | self-contained page (images inline, works offline): summary table, then per screen every unexplained root, needs-approval entry and crop fail with the source crop and the proxy crop side by side, data findings, and the normalisation section (font substitutions, line heights made explicit, original vs measured screen) |

Exit code: 0 when every screen passes, 1 when one does not, 2 on a usage or setup error.

Allowlist entries: `{ file, screen, node, width: "A"|"B", kind: "root"|"approval"|"crop", reason, approved }`. Only `approved: true` entries count, and only for unexplained roots, needs-approval entries and crop fails (a crop linked to a root counts only with that root's entry); unchecked nodes, skipped layers and data findings (including `unsupported` paint and `effect` mismatches) always fail. Entries are approved by the user, from `report.html`.

## Acceptance

```
VD_PLAYWRIGHT_FROM=... VD_CORPUS_DIR=... node --test plugins/vuong-design/test/acceptance.test.mjs
```

Runs the 25 screens of `test/corpus.json` (skipped without `VD_CORPUS_DIR`). It requires full coverage, no unexplained root, no needs-approval entry and no crop fail outside the approved allowlist, no data finding, and (with `VD_ACCEPT_MUTATE=1`) every mutation caught or skipped.

Current numbers (2026-11-22, after the 8b-2 root-cause fixes R36–R46, HEAD 6e7621f, empty allowlist; not passing yet: what is left needs the user's approval or the SCALE decision, see below). CLI on the whole corpus: 104 s.

| File | Screen | Checked | Unexplained roots | Explained roots | Needs approval (max px) | Crop fails A/B (+ linked) | Data | specBytes | Pass |
|---|---|---|---|---|---|---|---|---|---|
| planora-ui-screens.html | s0 | 81/81 | 1 | 0 | 0 | 0/2 | 0 | 20500 | fail |
| planora-ui-screens.html | s1 | 59/59 | 1 | 0 | 0 | 0/2 | 0 | 14332 | fail |
| planora-ui-screens.html | s2 | 64/64 | 0 | 0 | 0 | 0/0 | 0 | 13071 | pass |
| planora-ui-screens.html | s3 | 56/56 | 1 | 6 | 0 | 0/2 | 0 | 13266 | fail |
| planora-ui-screens.html | s4 | 62/62 | 0 | 6 | 1 (2.28) | 0/0 | 0 | 15623 | fail |
| planora-ui-screens.html | s5 | 56/56 | 0 | 0 | 0 | 0/0 | 0 | 12790 | pass |
| planora-ui-screens.html | s6 | 22/22 | 0 | 0 | 0 | 0/0 | 0 | 5540 | pass |
| planora-ui-screens.html | s7 | 111/111 | 1 | 1 | 0 | 0/2 | 0 | 29854 | fail |
| planora-ui-screens.html | s8 | 91/91 | 7 | 0 | 0 | 0/5 (+3) | 0 | 20634 | fail |
| planora-ui-screens.html | s9 | 45/45 | 0 | 4 | 0 | 0/0 | 0 | 13048 | pass |
| planora-ui-screens.html | s10 | 40/40 | 0 | 0 | 0 | 0/0 | 0 | 11718 | pass |
| planora-ui-screens.html | s11 | 73/73 | 3 | 15 | 0 | 1/2 (+2) | 0 | 16260 | fail |
| planora-ui-screens.html | s12 | 51/51 | 0 | 0 | 0 | 0/0 | 0 | 11708 | pass |
| planora-ui-screens.html | s13 | 22/22 | 0 | 0 | 0 | 0/0 | 0 | 4707 | pass |
| planora-ui-screens.html | s14 | 27/27 | 0 | 0 | 0 | 0/0 | 0 | 6585 | pass |
| planora-ui-screens.html | s15 | 32/32 | 0 | 0 | 0 | 0/0 | 0 | 8619 | pass |
| planora-ui-screens.html | s16 | 36/36 | 0 | 0 | 0 | 0/0 | 0 | 8989 | pass |
| planora-ui-screens.html | s17 | 49/49 | 0 | 1 | 0 | 0/0 | 0 | 12875 | pass |
| 2026-11-05-ui-redesign-entry-mockup.html | s0 | 75/75 | 0 | 0 | 3 (3.25) | 0/0 | 0 | 22100 | fail |
| 2026-11-05-ui-redesign-entry-mockup.html | s1 | 78/78 | 0 | 0 | 3 (4.25) | 0/0 | 0 | 20084 | fail |
| calendar-layout.html | s0 | 9/9 | 0 | 0 | 0 | 0/0 | 0 | 2551 | pass |
| calendar-layout.html | s1 | 7/7 | 0 | 0 | 0 | 0/0 | 0 | 2010 | pass |
| calendar-layout-v2.html | s0 | 112/112 | 0 | 4 | 0 | 0/0 | 0 | 25375 | pass |
| calendar-layout-v2.html | s1 | 112/112 | 0 | 4 | 1 (2.19) | 0/0 | 0 | 26072 | fail |
| calendar-layout-v3.html | s0 | 165/165 | 0 | 4 | 0 | 0/0 | 0 | 36024 | pass |
| **Total** | 25 | | **14** | 45 | **8** (max 4.25) | **16** (+5 linked) | 0 | max 36024 | **15/25** |

"Crop fails" are standalone crop fails; "+ linked" are crop fails on an unexplained size root (R44), which pass only together with that root's allowlist entry. "Needs approval" lists model roots above tolModel plus at most one cumulative model-drift entry per screen (R43), with the largest accumulated model delta as its magnitude.

What is left (all 14 roots, 8 approvals, 16 + 5 crops):
- Percentage positions/sizes (pending the SCALE decision): planora s8 / s11 bar fills (`width: 60%` etc., 5 roots + their 5 linked crops); bar markers `left: 58%` / `55%` (4 roots, 3 crops); nav badge `left: 52%` at B, −0.61px (5 roots on s0 s1 s3 s7 s8, 10 crops on the badge and its text).
- Figma text-box round-up accumulating down a screen (needs approval, or a real-Figma check of fractional line heights): entry s0 (max 3.25px) and s1 (max 4.25px), calendar-v2 s1 (2.19px); planora s4 chip row width round-up (2.28px).
- planora s11 `n.0.13.1.1.0` (A, B) and `n.0.13.1.1.1` (B): crops inside the shrink-flagged row `n.0.13.1` (the flag explains the row's size, not the children's paint; they stand alone, R44).

Mutations (`--mutate`, full corpus, 807 s): 180 caught, 0 missed, 45 skipped (no candidate).
