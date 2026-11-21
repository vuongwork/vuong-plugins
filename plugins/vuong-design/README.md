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

Allowlist entries: `{ file, screen, node, width: "A"|"B", kind: "root"|"approval"|"crop", reason, approved }`. Only `approved: true` entries count, and only for unexplained roots, needs-approval entries and crop fails; unchecked nodes, skipped layers and data findings always fail. Entries are approved by the user, from `report.html`.

## Acceptance

```
VD_PLAYWRIGHT_FROM=... VD_CORPUS_DIR=... node --test plugins/vuong-design/test/acceptance.test.mjs
```

Runs the 25 screens of `test/corpus.json` (skipped without `VD_CORPUS_DIR`). It requires full coverage, no unexplained root, no needs-approval entry and no crop fail outside the approved allowlist, no data finding, and (with `VD_ACCEPT_MUTATE=1`) every mutation caught or skipped.

Current numbers (2026-11-22, base 9f2c0c9, empty allowlist; not passing yet — root-causing and allowlist proposals are the next step). CLI on the whole corpus: 111 s.

| File | Screen | Checked | Unexplained roots | Explained roots | Needs approval (max px) | Crop fails A/B | Data | specBytes | Pass |
|---|---|---|---|---|---|---|---|---|---|
| planora-ui-screens.html | s0 | 81/81 | 1 | 0 | 0 | 6/7 | 0 | 20241 | fail |
| planora-ui-screens.html | s1 | 59/59 | 1 | 0 | 0 | 6/7 | 0 | 14122 | fail |
| planora-ui-screens.html | s2 | 64/64 | 2 | 0 | 4 (202.55) | 0/0 | 0 | 13004 | fail |
| planora-ui-screens.html | s3 | 56/56 | 1 | 6 | 0 | 7/8 | 0 | 13090 | fail |
| planora-ui-screens.html | s4 | 62/62 | 0 | 6 | 6 (184.66) | 1/3 | 0 | 15590 | fail |
| planora-ui-screens.html | s5 | 56/56 | 0 | 0 | 0 | 0/0 | 0 | 12756 | pass |
| planora-ui-screens.html | s6 | 22/22 | 0 | 0 | 0 | 0/0 | 0 | 5445 | pass |
| planora-ui-screens.html | s7 | 111/111 | 1 | 1 | 0 | 4/5 | 0 | 29678 | fail |
| planora-ui-screens.html | s8 | 91/91 | 7 | 0 | 0 | 4/15 | 0 | 20296 | fail |
| planora-ui-screens.html | s9 | 45/45 | 0 | 4 | 29 (110.88) | 1/0 | 0 | 12902 | fail |
| planora-ui-screens.html | s10 | 40/40 | 0 | 0 | 0 | 0/0 | 0 | 11582 | pass |
| planora-ui-screens.html | s11 | 73/73 | 3 | 15 | 6 (145.17) | 9/15 | 0 | 15997 | fail |
| planora-ui-screens.html | s12 | 51/51 | 0 | 0 | 0 | 0/2 | 0 | 11657 | fail |
| planora-ui-screens.html | s13 | 22/22 | 0 | 0 | 0 | 0/0 | 0 | 4646 | pass |
| planora-ui-screens.html | s14 | 27/27 | 0 | 0 | 0 | 0/0 | 0 | 6551 | pass |
| planora-ui-screens.html | s15 | 32/32 | 7 | 0 | 0 | 0/0 | 0 | 7950 | fail |
| planora-ui-screens.html | s16 | 36/36 | 0 | 0 | 0 | 0/0 | 0 | 8928 | pass |
| planora-ui-screens.html | s17 | 49/49 | 0 | 1 | 0 | 0/0 | 0 | 12773 | pass |
| 2026-11-05-ui-redesign-entry-mockup.html | s0 | 75/75 | 8 | 0 | 78 (3.25) | 2/2 | 0 | 22085 | fail |
| 2026-11-05-ui-redesign-entry-mockup.html | s1 | 78/78 | 8 | 0 | 84 (4.25) | 2/2 | 0 | 20049 | fail |
| calendar-layout.html | s0 | 9/9 | 0 | 0 | 0 | 0/0 | 0 | 2551 | pass |
| calendar-layout.html | s1 | 7/7 | 0 | 0 | 0 | 0/0 | 0 | 2010 | pass |
| calendar-layout-v2.html | s0 | 112/112 | 0 | 4 | 0 | 1/0 | 0 | 25375 | fail |
| calendar-layout-v2.html | s1 | 112/112 | 4 | 4 | 12 (2.19) | 1/0 | 0 | 26066 | fail |
| calendar-layout-v3.html | s0 | 165/165 | 2 | 4 | 0 | 3/0 | 0 | 36021 | fail |
| **Total** | 25 | | **45** | 45 | **219** | **113** | 0 | max 36021 | **9/25** |

Mutations: not run in this table (run with `--mutate` or `VD_ACCEPT_MUTATE=1`).
