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
- Fonts: before measuring, the source page is re-rendered with the face Figma will use: a Google Fonts face when Figma has the family (reason `version`), otherwise a substitute such as Inter for system-ui or Times New Roman (reasons `not-in-figma`, `system`); `line-height: normal` is written as explicit px (Figma has no "normal"). Google Fonts are fetched even when the page does not reference them; only the family name is sent. `--no-webfonts` stops that extra fetching only: the page's own font links and `@font-face` rules still load during capture and are copied into the proxy. Families that do not render are reported (`font-face` data finding when a used face is missing in the proxy).
- `--mutate`: also plants known errors to check the checker (≈30 s per screen); `--mutate-sample <n>` limits it to n screens per file. A missed mutation makes the run exit 1 (R53); a kind with no candidate node is `skipped`, not missed.
- `--corpus`: runs every file of a corpus JSON (`files: [{ file, root, widen? }]`, names relative to `--corpus-dir` or `$VD_CORPUS_DIR`) and uses its `allowlist` unless `--allowlist` is given.

Environment: `VD_PLAYWRIGHT_FROM` (see Setup), `VD_CORPUS_DIR` (corpus mode and the acceptance test), `VD_ACCEPT_MUTATE=1` (mutation part of the acceptance test).

Outputs in `<out>` (corpus mode: `ir.json` and `spec-*.json` in `<out>/<file name without .html>/`):

| File | Content |
|---|---|
| `ir.json` | the captured screens (boxes at widths A and B, paint, fonts, font substitutions, normalisation counts), without PNGs |
| `spec-<id>.json` | the modelled spec of a screen (compact JSON; `specBytes` is its size, `payloadOver50k` when above 50 000) |
| `report.json` | per screen: summary row, the gate after the allowlist, the full verify report, flags, mutations |
| `report.html` | self-contained page (images inline, works offline): a "How to read this report" section, the summary table, then per screen a one-line verdict (what failed, whether you must act), every unexplained root, needs-approval entry and crop fail with the source crop and the proxy crop side by side (crops caused by a layout error are shown linked, with that root), data findings, and the "Normalisation" section (font substitutions with their reason, line heights made explicit, original vs measured screen). Every number carries its unit (px, %, 0-255 colour difference); identical findings repeated across screens are grouped |

Exit code: 0 when every screen passes, 1 when one does not (or a mutation was missed), 2 on a usage or setup error.

What is checked (beyond coverage and position per node): position is checked independently of size, per axis (R49), so a size explanation never excuses a wrong position. A stretched (FILL) item on its row or column's main axis is judged by the edge the row packs from (start: near edge, end: far edge, centre: middle, space-between: first item near, last item far; R57), so a padding error it absorbs is a position error even when a shrink flag explains its size. Data checks run at every size (R50): border radius (per corner), font size, weight, style, decoration, transform, family and colour per text run, inline svg content hash, image fit, object-position and src. An image whose `object-fit` is not cover, contain or fill, or whose `object-position` is not the centre, is `unsupported` (R59: a Figma image fill cannot reproduce it). Text, icon and image leaves are also cropped and compared at any size. The paint data checks (colour, stroke, visibility, radius, run styles, svg, image, effect) read the proxy DOM at width A only; crops of the leaves run at both widths A and B, so a paint difference that appears only at B is caught on a leaf by its crop and not by a data check (M-a). Page CSS on a sprite target that an inline svg inlines is carried or reported like page CSS inside the svg (M-e). `font-face` findings (R55) report a used face (weight/style) that did not load in the proxy. For an installed (system) family, every bold or italic face used is drawn with `font-synthesis: none` next to the same text without that trait; equal width and pixels mean the face does not exist and Chrome would have synthesised it (R58; pixels settle the fonts whose real italic or bold keeps the regular widths, e.g. Arial italic or a monospace font).

Allowlist entries: `{ file, screen, node, width: "A"|"B", kind: "root"|"approval"|"crop", delta + why | ratio + peak, fingerprint, reason, approved }` (`file` relative to the corpus dir). Each entry records what was approved (R51): the magnitude (`delta` [dx, dy, dw, dh] for roots and approvals, `ratio` and `peak` for crops) and the node's `fingerprint` (source tag, class, text or icon ref); it is honoured only while the node keeps that fingerprint and the finding stays within the approved magnitude (+0.25 px per delta component, +0.02 ratio, peak no larger). R56: a root or approval entry also records its axes (`why`); the finding must have no axis the entry lacks, and every delta component must keep the approved direction (a component within 0.25 px may have either), so an approved shrink never covers a growth or a new position error. A container's fingerprint also holds its child count, its parent's child count and a hash of its first text, so a neighbour that shifts into the id after a removal does not inherit the entry. An approved entry with an empty reason shows as allowed by "approved". `report.json` has an `allowlistDraft` per screen with these fields filled in (`approved: false`) to copy from. Only `approved: true` entries count, and only for unexplained roots, needs-approval entries and crop fails (a crop linked to a root counts only with that root's entry); unchecked nodes, skipped layers and data findings (including `unsupported` paint and `effect` mismatches) always fail. Entries are approved by the user, from `report.html`.

## Acceptance

```
VD_PLAYWRIGHT_FROM=... VD_CORPUS_DIR=... node --test plugins/vuong-design/test/acceptance.test.mjs
```

Runs the 25 screens of `test/corpus.json` (skipped without `VD_CORPUS_DIR`). It requires full coverage, no unexplained root, no needs-approval entry and no crop fail outside the approved allowlist, no data finding, and (with `VD_ACCEPT_MUTATE=1`) every mutation caught or skipped.

Current numbers (2026-11-22, after round 9: R49-R55, empty allowlist; not passing yet: what is left needs the user's approval, see below). CLI on the whole corpus: about 143 s. The per-screen table below is from the earlier run (HEAD 4b7895c); only planora s3 has changed since (1 unexplained root, now failing), and the totals row after it is current.

| File | Screen | Checked | Unexplained roots | Explained roots | Needs approval (max px) | Crop fails A/B (+ linked) | Data | specBytes | Pass |
|---|---|---|---|---|---|---|---|---|---|
| planora-ui-screens.html | s0 | 81/81 | 0 | 0 | 0 | 0/0 | 0 | 20618 | pass |
| planora-ui-screens.html | s1 | 59/59 | 0 | 0 | 0 | 0/0 | 0 | 14450 | pass |
| planora-ui-screens.html | s2 | 64/64 | 0 | 0 | 0 | 0/0 | 0 | 13071 | pass |
| planora-ui-screens.html | s3 | 56/56 | 0 | 6 | 0 | 0/0 | 0 | 13384 | pass |
| planora-ui-screens.html | s4 | 62/62 | 0 | 6 | 1 (2.28) | 0/0 | 0 | 15623 | fail |
| planora-ui-screens.html | s5 | 56/56 | 0 | 0 | 0 | 0/0 | 0 | 12790 | pass |
| planora-ui-screens.html | s6 | 22/22 | 0 | 0 | 0 | 0/0 | 0 | 5540 | pass |
| planora-ui-screens.html | s7 | 111/111 | 0 | 1 | 0 | 0/0 | 0 | 29972 | pass |
| planora-ui-screens.html | s8 | 91/91 | 0 | 0 | 0 | 0/0 | 0 | 21134 | pass |
| planora-ui-screens.html | s9 | 45/45 | 0 | 4 | 0 | 0/0 | 0 | 13048 | pass |
| planora-ui-screens.html | s10 | 40/40 | 0 | 0 | 0 | 0/0 | 0 | 11718 | pass |
| planora-ui-screens.html | s11 | 73/73 | 0 | 15 | 0 | 1/2 | 0 | 16507 | fail |
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
| **Total (current)** | 25 | | **1** | | **8** (max 4.25) | **3** (+1 linked) | 0 | | **19/25** |

"Crop fails" are standalone crop fails; "+ linked" are crop fails on an unexplained size root (R44), which pass only together with that root's allowlist entry. "Needs approval" lists model roots above tolModel plus at most one cumulative model-drift entry per screen (R43), with the largest accumulated model delta as its magnitude.

What is left (1 root, 8 approvals, 3 crops + 1 linked):
- planora s3 `n.0.13.0` (the one unexplained root): the avatar in a row that shrinks at width A and is centred at width B (the FILL icon box is 179.5 px at B, so the avatar sits 23.25 px further left). Classed as a Figma limitation pending the user's approval; its linked crop passes or fails with that root's allowlist entry.
- Figma text-box round-up accumulating down a screen (needs approval, or a real-Figma check of fractional line heights): entry s0 (max 3.25px) and s1 (max 4.25px), calendar-v2 s1 (2.19px); planora s4 chip row width round-up (2.28px).
- planora s11 `n.0.13.1.1.0` (A, B) and `n.0.13.1.1.1` (B): crops inside the shrink-flagged row `n.0.13.1` (the flag explains the row's size, not the children's paint; they stand alone, R44).
- To check in real Figma (plan 3): R47 SCALE is relative to the parent frame, CSS % to the containing block's padding box (equal here: no border, parent = containing block; otherwise the fit fails and fixed constraints stand in, visibly); the `left: 52%` badge and `left: 58%` / `55%` markers hang from zero-width SCALE anchor frames (Figma's minimum size is 0.01).

Mutations (`--mutate`, full corpus, after round 9): 221 caught, 0 missed, 104 skipped (no candidate; the large svg and image kinds have no candidate in this corpus and are covered by tests).
