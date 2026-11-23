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

Environment: `VD_PLAYWRIGHT_FROM` (see Setup), `VD_CORPUS_DIR` (corpus mode and the acceptance test), `VD_ACCEPT_MUTATE=1` (mutation part of the acceptance test), `VD_ACCEPT_RULES=<rules file>` (the acceptance test normalises each file with that rules file and also requires no unexplained norm root and no norm-spec finding).

Outputs in `<out>` (corpus mode: `ir.json` and `spec-*.json` in `<out>/<file name without .html>/`):

| File | Content |
|---|---|
| `ir.json` | the captured screens (boxes at widths A and B, paint, fonts, font substitutions, normalisation counts), without PNGs |
| `spec-<id>.json` | the modelled spec of a screen (compact JSON; `specBytes` is its size, `payloadOver50k` when above 50 000) |
| `report.json` | per screen: summary row, the gate after the allowlist, the full verify report, flags, mutations |
| `report.html` | self-contained page (images inline, works offline): a "How to read this report" section, the summary table, then per screen a one-line verdict (what failed, whether you must act), every unexplained root, needs-approval entry and crop fail with the source crop and the proxy crop side by side (crops caused by a layout error are shown linked, with that root), data findings, and the "Normalisation" section (font substitutions with their reason, line heights made explicit, original vs measured screen). Every number carries its unit (px, %, 0-255 colour difference); identical findings repeated across screens are grouped |

Exit code: 0 when every screen passes, 1 when one does not (or a mutation was missed), 2 on a usage or setup error.

What is checked (beyond coverage and position per node): position is checked independently of size, per axis (R49), so a size explanation never excuses a wrong position. A stretched (FILL) item on its row or column's main axis is judged like space-between whatever the packing (R60, replacing R57): the first item by its near edge, the last by its far edge, a sole item by both, a middle item by either. A padding error it absorbs is a position error even when a shrink flag explains its size. Data checks run at every size (R50): border radius (per corner), font size, weight, style, decoration, transform, family and colour per text run, inline svg content hash, image fit, object-position and src. An image whose `object-fit` is not cover, contain or fill, or whose `object-position` is not the centre, is `unsupported` (R59: a Figma image fill cannot reproduce it). Text, icon and image leaves are also cropped and compared at any size. The paint data checks (colour, stroke, visibility, radius, run styles, svg, image, effect) read the proxy DOM at width A only; crops of the leaves run at both widths A and B, so a paint difference that appears only at B is caught on a leaf by its crop and not by a data check (M-a). Page CSS on a sprite target that an inline svg inlines is carried or reported like page CSS inside the svg (M-e). `font-face` findings (R55) report a used face (weight/style) that did not load in the proxy. For an installed (system) family, every bold or italic face used is drawn with `font-synthesis: none` next to the same text without that trait; equal width and pixels mean the face does not exist and Chrome would have synthesised it (R58; pixels settle the fonts whose real italic or bold keeps the regular widths, e.g. Arial italic or a monospace font).

Allowlist entries: `{ file, screen, node, width: "A"|"B", kind: "root"|"approval"|"crop", delta + why | ratio + peak, fingerprint, reason, approved }` (`file` relative to the corpus dir). Each entry records what was approved (R51): the magnitude (`delta` [dx, dy, dw, dh] for roots and approvals, `ratio` and `peak` for crops) and the node's `fingerprint` (source tag, class, text or icon ref); it is honoured only while the node keeps that fingerprint and the finding stays within the approved magnitude (+0.25 px per delta component, +0.02 ratio, peak no larger). R56: a root or approval entry also records its axes (`why`); the finding must have no axis the entry lacks, and every delta component must keep the approved direction (a component within 0.25 px may have either), so an approved shrink never covers a growth or a new position error. A container's fingerprint also holds its child count, its parent's child count and a hash of its first text, so a neighbour that shifts into the id after a removal does not inherit the entry. An approved entry with an empty reason shows as allowed by "approved". `report.json` has an `allowlistDraft` per screen with these fields filled in (`approved: false`) to copy from. Only `approved: true` entries count, and only for unexplained roots, needs-approval entries and crop fails (a crop linked to a root counts only with that root's entry); unchecked nodes, skipped layers and data findings (including `unsupported` paint and `effect` mismatches) always fail. Entries are approved by the user, from `report.html`.

## Design system CLI

```
node plugins/vuong-design/core/ds.mjs --html <file> --root <selector> --out <dir>   [--rules <vd-rules.json>] [--names <vd-names.json>] [every layout.mjs option]

node plugins/vuong-design/core/ds.mjs --corpus plugins/vuong-design/test/corpus.json --out <dir> [same options]
```

Runs the layout pipeline, then per HTML file (all its screens together, since roles and scales are file-wide): inventory -> normalize (with the rules file) -> apply-norm per screen -> verification of the target spec (a third render, the norm proxy, R66) -> tokens -> coverage -> `design-system.html`.

- Rules file: `--rules`, else `vd-rules.json` in the current directory when it exists, else none (every question stays `ask`, nothing but `auto` entries is applied). Names file: `--names`, else `vd-names.json` in the current directory when it exists. Both are only read; open answers are drafted into `<out>/vd-rules.draft.json`.
- Corpus mode writes one design system per HTML file, in `<out>/<file name without .html>/`; `report.json` and `report.html` cover all files.
- Exit code as `layout.mjs`: 0 when every screen passes the gate (an unexplained root of layer `norm`, i.e. a change of the target spec no entry explains, fails its screen and cannot be allowlisted) and no mutation is missed; 1 otherwise; 2 on a usage or setup error (bad rules / names file, an answer that is not one of its options). Open questions never fail the run; the last line gives their number.
- With a target spec, the Figma-model layer judges the spec that will be built (R75): the norm proxy against the same records on the unmodelled spec. A plan-1 approval with no counterpart there is listed in `norm.approvalsResolved`, but only when the node or its record scope carries a box or type record (R78).
- The norm layout proxy (the records replayed on the unmodelled spec) must be marked `normLayout` and is checked like the norm proxy (R78): every deviation from the layout proxy that the records do not predict is an open norm root.
- A crop failure is explained by the norm only when the records caused it (R77): the same crop against the plain layout proxy passes, and the node's own paint / type / icon record changes something (not in `norm.unused`) and its change shows in the norm layout proxy against the layout proxy. For an icon's own ICON_FRAME / SRC_SQUASH record, the plain layout proxy cannot pass (that is why the record exists): the norm layout proxy must draw the icon at the record's size instead.
- Every applied record must name an `auto` / `answered` entry with the same prop, from and to (m8); otherwise it explains nothing and is a `norm-spec` data finding.
- A colour behind a scoped CSS variable (it resolves to the use's colour lower down, not at `:root`) counts as named and is never merged without an answer (R79); `coverage.json` (`vars`) and the Coverage section give the number of CSS variable uses capture could not attribute. A width or height that stretches with its parent (absolute left + right, top + bottom or scale constraint) is not a size token candidate (R80).

Outputs in `<out>` (or `<out>/<file stem>/`), in addition to everything `layout.mjs` writes:

| File | Content |
|---|---|
| `tokens.json` | W3C DTCG tokens, three tiers (primitive, role, component: empty until plan 3), values after normalisation |
| `tokens.css` | `:root` custom properties: primitives, then `--role-*` aliases |
| `normalisation.json` | `entries` (node, prop, from, to, reason code, status auto / answered / ask, proposal, question), `counts` of kept decisions per code, `unparsed`, `stale` answers |
| `questions.json` | the normalisation questions (project questions, group questions) and the §8.4 project confirmations, answered or not |
| `vd-rules.draft.json` | a draft rules file with the open questions and their defaults (copy what you accept into `vd-rules.json`) |
| `coverage.json` | checklist items (covered / missing / answered), WCAG contrast failures, touch targets under 44 px |
| `spec-norm-<id>.json` | the target spec of each screen (the modelled spec with the applied entries; equal to `spec-<id>.json` when nothing applies) |
| `design-system.html` | the visual proposal: verdict, How to read, questions with their JSON, colours, spacing, radius, type, shadows, changes (source vs norm crops), coverage |

`tokens.json`, `tokens.css`, `normalisation.json`, `questions.json`, `vd-rules.draft.json` and `coverage.json` are deterministic (no clock; the order of screens does not matter).

## Acceptance

```
VD_PLAYWRIGHT_FROM=... VD_CORPUS_DIR=... node --test plugins/vuong-design/test/acceptance.test.mjs
```

Runs the 25 screens of `test/corpus.json` (skipped without `VD_CORPUS_DIR`). It requires full coverage, no unexplained root, no needs-approval entry and no crop fail outside the approved allowlist, no data finding, and (with `VD_ACCEPT_MUTATE=1`) every mutation caught or skipped.

Current numbers (2026-11-22, after round 10, R60 and R72 (s11 crops): R56-R60 and the rr9 minors, empty allowlist; not passing yet: what is left needs the user's approval, see below). CLI on the whole corpus: about 137-215 s. Table and totals from that run.

| File | Screen | Checked | Unexplained roots | Explained roots | Needs approval (max px) | Crop fails A/B (+ linked) | Data | specBytes | Pass |
|---|---|---|---|---|---|---|---|---|---|
| planora-ui-screens.html | s0 | 81/81 | 0 | 0 | 0 | 0/0 | 0 | 20618 | pass |
| planora-ui-screens.html | s1 | 59/59 | 0 | 0 | 0 | 0/0 | 0 | 14450 | pass |
| planora-ui-screens.html | s2 | 64/64 | 0 | 0 | 0 | 0/0 | 0 | 13071 | pass |
| planora-ui-screens.html | s3 | 56/56 | 1 | 5 | 0 | 1/0 (+1) | 0 | 13384 | fail |
| planora-ui-screens.html | s4 | 62/62 | 0 | 6 | 1 (2.28) | 1/1 | 0 | 15623 | fail |
| planora-ui-screens.html | s5 | 56/56 | 0 | 0 | 0 | 0/0 | 0 | 12790 | pass |
| planora-ui-screens.html | s6 | 22/22 | 0 | 0 | 0 | 0/0 | 0 | 5540 | pass |
| planora-ui-screens.html | s7 | 111/111 | 0 | 1 | 0 | 0/0 | 0 | 29972 | pass |
| planora-ui-screens.html | s8 | 91/91 | 0 | 0 | 0 | 0/0 | 0 | 21134 | pass |
| planora-ui-screens.html | s9 | 45/45 | 0 | 4 | 0 | 0/0 | 0 | 13048 | pass |
| planora-ui-screens.html | s10 | 40/40 | 0 | 0 | 0 | 0/0 | 0 | 11718 | pass |
| planora-ui-screens.html | s11 | 73/73 | 0 | 15 | 0 | 0/0 | 0 | 16507 | pass |
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
| **Total** | 25 | | **1** | 44 | **8** (max 4.25) | **3** (+1 linked) | 0 | max 36024 | **20/25** |

"Crop fails" are standalone crop fails; "+ linked" are crop fails on an unexplained size root (R44), which pass only together with that root's allowlist entry. "Needs approval" lists model roots above tolModel plus at most one cumulative model-drift entry per screen (R43), with the largest accumulated model delta as its magnitude.

Plan-1 list (layout.mjs, still the state of run (a) below): 1 root, 8 approvals, 3 crops + 1 linked (planora s3 `.say` avatar at B; avatar crops of s3 and s4 under R61; text round-up drift on entry s0, s1 and calendar-v2 s1; planora s4 chip row width round-up).

Design system run (`ds.mjs`, 2026-11-23, after R73-R80, m5, m6, m8, empty allowlist):

| Run | Pass | Unexplained roots | Needs approval | Crop fails (+ linked) | Data | Norm: unexplained roots / norm-spec findings | Time |
|---|---|---|---|---|---|---|---|
| (a) no rules file | 20/25 | 1 | 8 (max 4.25 px) | 3 (+1) | 0 | 0 / 0 | 165 s |
| (b) `test/fixtures/rules-accept.json` (`project.lineHeightInt: yes`, `project.srcSquash: accept-all`) | 23/25 | 1 | 1 (2.28 px) | 0 (+0) | 0 | 0 / 0 | 207 s |

(a) equals the plan-1 numbers above: without answers only the 13 `auto` entries of Planora apply (ROLE_MAJORITY: 9 gaps and paddings, 4 radius corners), all verified on the norm proxy. Entries without a rules file, per file (auto / ask): planora 13 / 445 (GRID4 386, LINE_HEIGHT_INT 20, COLOR_NEAR 17, ICON_FRAME 10, TYPE_SCALE 10, SRC_SQUASH 2), entry mockup 0 / 86 (GRID4 64, LINE_HEIGHT_INT 9, ICON_FRAME 6, COLOR_NEAR 4, TYPE_SCALE 3), calendar 0 / 3, calendar-v2 0 / 111, calendar-v3 0 / 89. Open questions: 168 in all (R80 removed 3 Planora GRID4 questions on stretching widths).
Mutations on (b) (`--mutate --mutate-sample 2`: planora s0 and s9, every screen of the other files; the full corpus takes about 40 min with the norm renders): 100 caught, 0 missed, 53 skipped (no candidate); normSilent, normWrongValue (categories rotated by screen index, m6), normCropHide and normLayoutDrift each caught on all 7 screens with applied records (2 screens have none: skipped). 848 s.
(b): the 7 text round-up approvals (entry s0, s1, calendar-v2 s1) are resolved by LINE_HEIGHT_INT (R75); the s3 and s4 avatar crops are explained by their own SRC_SQUASH record (R74), now under R77: the norm layout proxy draws each avatar at the record's 34 px. Open questions: 161.

What is left after (b) (1 root, 1 approval):
- planora s3 `n.0.13.0` at B: the `.say` row centres its content at B (`justify-content: center`, both items at their natural width), but the spec keeps the bubble FILL, so in Figma the bubble fills the row and the avatar starts at the left edge, 23.25 px left of the source. Restoring the avatar's 34 px (SRC_SQUASH) fixes its size and its crop, not the centring: that needs the bubble to hug its text at B and shrink at A, which one Figma sizing mode cannot do (no flex-shrink; the nearest is HUG with a max width). Pending the user's approval, or a plan-3 decision.
- planora s4 chip row width round-up (2.28 px at B): Figma rounds text box widths; not a line-height case, so LINE_HEIGHT_INT does not touch it (needs approval).
- Without answers (a), the plan-1 list stands: the s3 root above with its linked crop, the avatar crops of s3 (A) and s4 (A, B) under R61, the 7 text round-up approvals and the s4 chip row.
- To check in real Figma (plan 3): R47 SCALE is relative to the parent frame, CSS % to the containing block's padding box (equal here: no border, parent = containing block; otherwise the fit fails and fixed constraints stand in, visibly); the `left: 52%` badge and `left: 58%` / `55%` markers hang from zero-width SCALE anchor frames (Figma's minimum size is 0.01).

Mutations (`--mutate`, full corpus, after round 10, about 21 min): 221 caught, 0 missed, 104 skipped (no candidate; the corpus has no inline svg or image of any size, so svgLarge and imageLarge skip even with the M-f fallback to the largest one; they are covered by tests).
