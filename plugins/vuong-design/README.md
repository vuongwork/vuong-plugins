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

## Input profile

Input HTML should follow [PROFILE.md](PROFILE.md) (`vd-html v1`); `core/lint.mjs` checks it.

## Layout CLI

```
node plugins/vuong-design/core/layout.mjs --html <file> --out <dir> [--root <selector>] [--no-lint] \
  [--widen <selector>] [--name <selector>] [--widen-by <px>] [--viewport <px>] \
  [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--no-webfonts] \
  [--allowlist <json>] [--mutate [--mutate-sample <n>]]

node plugins/vuong-design/core/layout.mjs --corpus plugins/vuong-design/test/corpus.json --out <dir> [same options]
```

- `--root`: selector of the screens (one screen per match). Optional: without it the file is taken to follow the input profile, screens are `[data-vd-screen]` and, when the file has a `data-vd-widen` element, `--widen` defaults to `[data-vd-widen]`. `--name` does not read `data-vd-name` yet (screens are named from the `--name` selector, else `s<index>`).
- Lint gate: in `--html` mode the file is linted first (`core/lint.mjs`, one page load on the shared browser): its summary goes to the log and `lint.json` to `<out>`; any error stops the run with exit 1 (`lint: N errors, fix them or pass --no-lint`), warnings do not. `--no-lint` skips the gate. `--corpus` mode never lints. A selector that matches nothing is left to the pipeline (usage error, exit 2). `ds.mjs` shares this CLI and gate.
- `--widen`: the element to widen for width B (the screen or an ancestor). `--name`: selector inside a screen whose text names it.
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
| `token-map.json` | per screen and node, the token path each property uses (`{ screen: { node: { prop: 'role.text-muted' } } }`): the role token when the use has one, else the primitive; uses an unanswered question leaves at the source value are left out; for binding Figma variables |
| `tokens.css` | `:root` custom properties: primitives, then `--role-*` aliases |
| `normalisation.json` | `entries` (node, prop, from, to, reason code, status auto / answered / ask, proposal, question), `counts` of kept decisions per code, `unparsed`, `stale` answers |
| `questions.json` | the normalisation questions (project questions, group questions) and the §8.4 project confirmations, answered or not |
| `vd-rules.draft.json` | a draft rules file with the open questions and their defaults (copy what you accept into `vd-rules.json`) |
| `coverage.json` | checklist items (covered / missing / answered), WCAG contrast failures, touch targets under 44 px |
| `spec-norm-<id>.json` | the target spec of each screen (the modelled spec with the applied entries; equal to `spec-<id>.json` when nothing applies) |
| `design-system.html` | the visual proposal: verdict, How to read, questions with their JSON, colours, spacing, radius, type, shadows, changes (source vs norm crops), coverage |

`tokens.json`, `tokens.css`, `token-map.json`, `normalisation.json`, `questions.json`, `vd-rules.draft.json` and `coverage.json` are deterministic (no clock; the order of screens does not matter).

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
| (a) after plan 3 Task 2 (2026-11-23, measured Figma facts) | 20/25 | 0 | 8 (max 4.25 px) | 2 (+0) | 0 | 0 / 0 | 172 s |
| (b) after plan 3 Task 2 (2026-11-23, measured Figma facts) | 24/25 | 0 | 1 (2.28 px) | 0 (+0) | 0 | 0 / 0 | 242 s |

After plan 3 Task 2 (2026-11-23): the facts in `core/figma-facts.json` match what the model already assumed for every field except shrinkFill (`maxWidth: ok, growText: ok`), so the only behaviour change is in infer.

How shrinkFill is modelled: in a container without space-between, the most squeezed FILL item flagged `shrink` becomes FILL + maxWidth = its unshrunk size `flex.n` and carries the info flag `shrinkModelled` (verify lets it explain nothing). Its other squeezed siblings become FIXED at their width-A size. Width A is the design width: with one FILL item left, Figma gives it exactly the rest of the row there, whereas several FILL items would share equally where CSS shrinks in proportion. Space-between containers are left as they were. `applyFigmaModel` then raises every `max` to the node's natural width in Figma terms (T8 items C / D: Figma's text box is `figmaTextBox` = ceil(Chrome width − trailing letter-spacing), so a max equal to a text's Chrome width wrapped its last word in Figma): a text at `figmaTextBox(max).w`, an H frame at paddings + gaps + its other children's modelled widths + its one FILL child at the rest rounded the same way, a V frame at paddings + its widest child; never lowered. Planora: s3 bubble 302.5 -> 303, s6 286.47 -> 287, s7 196.14 -> 197, s8 266.91 -> 267, s11 267.75 -> 268 and 363.63 -> 364, s17 231.97 -> 232. Acceptance (b) after it (2026-11-24): unchanged, 24/25, 0 roots, 1 approval (2.28 px), 0 crops, 0 data, 186 s. Every `shrink` flag stays, and explains the FIXED siblings' size at B. Eight items are modelled: s3 1, s4 1, s6 2, s7 1, s8 1, s11 2. A re-run of the earlier code reproduced the rows above; against it:
- **Unexplained roots 1 -> 0.** The planora s3 `n.0.13.0` root at B is gone because of `shrinkModelled` on the `.say` bubble (FILL, max 302.5 px). The avatar stays at 26 px, so width A is exact. At B the row centres a 26 px avatar and the 302.5 px bubble; `shrink` explains the avatar being 8 px narrower than the source's 34 px.
- **Crops (a) 3 (+1) -> 2 (+0).** The s3 and s4 avatar crops at A are gone: the avatars are exact at A now. Their crops at B remain under R61 (26 px vs 34 px, 34.5 px vs 40 px): s3 goes 1/0 (+1) -> 0/1 and s4 goes 1/1 -> 0/1. The linked crop of the removed s3 root is gone with it.
- **Crops (b) stay at 0.** Each avatar's own SRC_SQUASH record (26 -> 34, 34.5 -> 40) still explains its crop. **s3 passes in (b)**, so pass goes 23 -> 24; only s4 is left (the chip row approval). Pass in (a) stays at 20: s3 still fails there, on its avatar crop at B.
- **Explained roots drop** because the width-A shrink roots of s3 and s4 are gone: (a) s3 5 -> 1, s4 8 -> 3; (b) s3 17 -> 11, s4 16 -> 8. s17 is unchanged: its shrink item sits in a space-between row.
- **Unchanged:** approvals (8 in (a), 1 in (b), the s4 chip row at 2.28 px) and data. s6, s7 and s11 change only in specBytes. The lineHeightFrac, scaleBasis, zeroWidthAnchor, scaleInHug and strokeOverlay branches are inert with these facts.
- **Mutations on (b)** (`--mutate --mutate-sample 2`) were run after the first version of this change, which added `shrinkModelled` to verify's non-explaining flags: 100 caught, 0 missed, 53 skipped. The four norm mutations are each caught on 7 screens and skipped on 2, as before (1005 s). verify has not changed since.

(a) equals the plan-1 numbers above: without answers only the 13 `auto` entries of Planora apply (ROLE_MAJORITY: 9 gaps and paddings, 4 radius corners), all verified on the norm proxy. Entries without a rules file, per file (auto / ask): planora 13 / 445 (GRID4 386, LINE_HEIGHT_INT 20, COLOR_NEAR 17, ICON_FRAME 10, TYPE_SCALE 10, SRC_SQUASH 2), entry mockup 0 / 86 (GRID4 64, LINE_HEIGHT_INT 9, ICON_FRAME 6, COLOR_NEAR 4, TYPE_SCALE 3), calendar 0 / 3, calendar-v2 0 / 111, calendar-v3 0 / 89. Open questions: 168 in all (R80 removed 3 Planora GRID4 questions on stretching widths).
Mutations on (b) (`--mutate --mutate-sample 2`: planora s0 and s9, every screen of the other files; the full corpus takes about 40 min with the norm renders): 100 caught, 0 missed, 53 skipped (no candidate); normSilent, normWrongValue (categories rotated by screen index, m6), normCropHide and normLayoutDrift each caught on all 7 screens with applied records (2 screens have none: skipped). 848 s.
(b): the 7 text round-up approvals (entry s0, s1, calendar-v2 s1) are resolved by LINE_HEIGHT_INT (R75); the s3 and s4 avatar crops are explained by their own SRC_SQUASH record (R74), now under R77: the norm layout proxy draws each avatar at the record's 34 px. Open questions: 161.

What is left after (b) (1 root, 1 approval):
- planora s3 `n.0.13.0` at B: the `.say` row centres its content at B (`justify-content: center`, both items at their natural width), but the spec keeps the bubble FILL, so in Figma the bubble fills the row and the avatar starts at the left edge, 23.25 px left of the source. Restoring the avatar's 34 px (SRC_SQUASH) fixes its size and its crop, not the centring: that needs the bubble to hug its text at B and shrink at A, which one Figma sizing mode cannot do (no flex-shrink; the nearest is HUG with a max width). Pending the user's approval, or a plan-3 decision.
- planora s4 chip row width round-up (2.28 px at B): Figma rounds text box widths; not a line-height case, so LINE_HEIGHT_INT does not touch it (needs approval).
- Without answers (a), the plan-1 list stands: the s3 root above with its linked crop, the avatar crops of s3 (A) and s4 (A, B) under R61, the 7 text round-up approvals and the s4 chip row.
- To check in real Figma (plan 3): R47 SCALE is relative to the parent frame, CSS % to the containing block's padding box (equal here: no border, parent = containing block; otherwise the fit fails and fixed constraints stand in, visibly); the `left: 52%` badge and `left: 58%` / `55%` markers hang from zero-width SCALE anchor frames (Figma's minimum size is 0.01).

Mutations (`--mutate`, full corpus, after round 10, about 21 min): 221 caught, 0 missed, 104 skipped (no candidate; the corpus has no inline svg or image of any size, so svgLarge and imageLarge skip even with the M-f fallback to the largest one; they are covered by tests).

## Figma facts

`core/figma-probe.mjs` builds a probe (`probePayload()`, plain JS for the Figma MCP `use_figma` tool, 6.7 KB, one call) that runs on the page `_vd-probe`. `readFacts` turns the measured numbers into `core/figma-facts.json`, which `loadFacts()` reads (missing file: the defaults of `figma-model.mjs`). Measured 2026-11-23 on a Figma Pro file, no errors.

They are used (plan 3 Task 2) by `inferScreen(screen, { facts })`, which handles the layout facts shrinkFill, scaleBasis, zeroWidthAnchor and scaleInHug so both proxies render them, and by `applyFigmaModel(spec, fontMap, { facts })`, which handles lineHeightFrac and strokeOverlay. Both default to `loadFacts()`. Each branch flags the nodes it touches (`shrinkModelled` is info only).

| Case | Measured (px unless noted) | Fact |
|---|---|---|
| `lh` (15 px text) | stored line height 17.4 px and 21.75 px (kept, not rounded); box height 18 px (1 line), 66 px (3 lines) = ceil of 17.4 px and of 3 x 21.75 = 65.25 px | `lineHeightFrac: keep` |
| `tb` (13 chars, letter-spacing 0.5 px) | width 96 px at 0 px, 102 px at 0.5 px; figmaTextBox gives ceil(96 + 6.5 - 0.5) = 102 px | `textBox: ceil` |
| `scale` (200 to 320 px, padding 10 px, stroke 2 px) | child x 16 px, width 144 px (frame basis would give 144 px, padded area 150 px) | `scaleBasis: frame` |
| `zero` (0.01 px anchor, 200 to 320 px) | anchor x 160 px; left child x 160 px; right child right edge 160.01 px vs anchor right edge 160.016 px | `zeroWidthAnchor: ok` |
| `hug` (content 100 to 200 px) | parent width 100 px to 200 px; SCALE child x 50 px, width 100 px | `scaleInHug: ok` |
| `overlay` (stroke 1 to 4 px) | cell 300 x 30 px before and after; overlay 300 x 30 px | `strokeOverlay: ok` |
| `shrink` (row 240 to 360 px, avatar 32 px) | FILL block with maxWidth 180 px: 180 px and 180 px; grow block: 208 px and 328 px, its text 208 px and 328 px | `shrinkFill: { maxWidth: ok, growText: ok }` |
| `base` (22 px and 12.5 px text) | derived baselines 1001.62 px and 1002.01 px, offset 0.39 px (<= 0.5 px) | `baseline: ok` |

Every fact matches the current assumptions, so nothing in the model changes; the numbers are recorded so a later Figma change shows up by re-running the probe.

## Figma encoding

`core/figma-encode.mjs` (plan 3 Task 4) turns each target spec (`spec-norm-<s>.json`) into compact data for the Figma builder: one-letter keys, Figma defaults left out, shared tables (`C` colours, `F` fonts, `I` icons, `V` variable names, `S` style names, `M` image sources), variable bindings as indices into `V` from `token-map.json`, and the spec id `o` on every node. The full format is in the file's header comment. `planBatches` packs screens in order into `use_figma` calls of at most 50 000 bytes (UTF-8, builder + data). Each batch carries only the table entries it uses. A screen too big to fit on its own throws `OversizeError` (screen, bytes); it is never cut.

Planora (18 screens, ds run with `vd-rules.json`, 2026-11-23; fixture `test/fixtures/figma-encode-planora.json.gz`):

| Measure | Value |
|---|---|
| Encoded data per screen, alone with its own tables | 8.96 KB on average (min 4.73 KB s13, max 17.13 KB s7) |
| `spec-norm` JSON per screen, for comparison | 13.47 KB on average |
| Batches with an 8 KB stand-in builder | 4: s0-s3 44.95 KB, s4-s7 47.87 KB, s8-s11 43.46 KB, s12-s17 45.10 KB |
| Token-map entries bound / not bound | 2785 / 1. A variable binds only when its value equals the spec value. The exception is pill corners (R70: radius at least half the smaller side, e.g. 999px or 50%): they bind to `radius.full` (9999 px), which Figma clamps to the same rendered radius. The 1 unbound entry is a `conflict` (two border sides with the same colour but different tokens; Figma has one stroke paint) |
| Nodes with values the format cannot carry (`raw`) | 0 |

The spike's format was about 8 KB per screen. The batch count will change once the real builder (Task 5, at most 15 KB) replaces the stand-in.

## Figma runtime

`core/figma-runtime.js` (plan 3 Task 5) is the builder that runs inside Figma: `planBatches` without `wrap` gives this file with its single `__DATA__` replaced by the batch data (the tests use that form). `figma.mjs` instead installs the runtime once in the file and sends only data plus a small loader (README "Figma CLI", `runtime.js`). Child ids may come compact (`o` absent = `<parent o>.<index>`, `o` starting with `.` = `<parent o><o>`), and so may bindings (`v.r` = the same variable on `r0..r3`, `v.b` on `b0..b3`); the runtime expands them first. It runs as the code of `use_figma` (top-level await, top-level `return`, no fetch, no console, no `figma.notify`). It is tested on `test/fake-figma.mjs`, a fake Plugin API that throws on the misuses real Figma rejects (FILL outside auto layout, HUG on a node that cannot hug, text before its font is loaded, a paint colour with `a` or a channel above 1). The fake does not compute auto layout, so geometry is checked on real Figma (Task 8).

Per batch: variables, text styles and effect styles are looked up once by name (`getLocalVariablesAsync`, `getLocalTextStylesAsync`, `getLocalEffectStylesAsync`). The page `D.page` (default `Screens`) is found or created, and `setCurrentPageAsync` is called once.

Per node, in this order: create (frames, svg frames and overlays start with `fills = []`, `clipsContent = false`), paint (fills with bound paints, gradients, data-URI images, radius, strokes, shadows, effect style) or text (font, characters, props, text style, fill, then ranges), opacity, `appendChild`, auto layout then `strokesIncludedInLayout = false`, `resize`, sizing (FILL only in an auto-layout parent and not on absolute nodes; HUG only on auto-layout frames and text), min / max width, width / height bindings (FIXED axes), children, and last the stroke overlay. After the whole tree, in two passes: first `layoutPositioning = 'ABSOLUTE'` on every absolute node and overlay, then, deepest first (reverse pre-order), position or `relativeTransform` and constraints. An absolute HUG frame with a MAX or CENTER constraint keeps that edge when its height changes, so nothing below it may still leave the flow or change size once it is placed (T8: a 100 px overlay still in a cell's flow moved a bottom-anchored card up by 79 px). A node that throws is removed and listed in `errors`; its children are listed as `parent failed`; the rest of the screen is still built.

- Fonts: the style weight comes from `listAvailableFontsAsync` style names (`Semi Bold` and `SemiBold` alike). An exact face is used when listed; otherwise the nearest weight of the family (same italic first), otherwise Inter. Every substitution is in `fontMissing`. Each face is loaded once.
- Stroke overlay (`bd.o`, `paint.strokeOverlay`): the cell has no stroke; a last child frame named `stroke`, vd id `<o>#stroke`, carries the stroke (and its bindings) and the cell's radii, created at 0.01 x 0.01 (never at `createFrame`'s 100 x 100 inside the cell's flow), absolute, `STRETCH` / `STRETCH`, sized to the cell after the tree is built (figma-facts `strokeOverlay: ok`).
- Plugin data (namespace `vuongdesign`; Figma requires at least 3 alphanumeric characters, so `vd` and `vuong_design` are not used): `id` on every built node (the spec id; `<o>#stroke` on overlays; svg vectors inside an icon have none), and `screen`, `file`, `sig` on the screen frame. `screen` / `file` are written when the frame is created, `sig` after the readback, so a frame without `sig` is an interrupted build.
- Signature `vuongdesign/sig`: FNV-1a 32-bit (hex, 8 characters) over the UTF-16 units of one JSON array per node in pre-order, children included (svg vectors too): vd id, type, x, y (0 for the screen frame: moving it is not an edit), width, height (all rounded to 0.01), fills and strokes (solid as `#rrggbb[aa]`, other paints by type), font (`family style`, `M` when mixed), cornerRadius (the four corners when mixed), characters, fontSize, opacity, layoutMode, paddings, itemSpacing.
- Rerun: frames with the same `vuongdesign/screen` and `vuongdesign/file` are looked up, in page order. Only the first one is the screen's frame; any further copies are listed in `extra` (ids) and never touched. If the first one has a `sig` that differs from its recomputed signature, it is kept untouched and the screen returns `edited: true` (unless `D.force` lists the screen). Otherwise the new frame is built at its x / y, and the old frame is removed only after the new one is complete (signature stored). A new screen goes at y 0, x = the right edge of the rightmost top-level node on the page + 80 (0 on an empty page).
- Screen-level failure (anything that throws outside a node's own build, e.g. the readback resize): the half-built new frame is removed, the old frame stays, and the screen returns `{ screen, fontMissing, errors: [..., { o: root id, msg }] }`; the next screens of the batch are still built. A failed node lists itself, its descendants (`parent failed`) and every overlay `<o>#stroke` among them in `errors`.
- Readback: boxes from `absoluteBoundingBox`, relative to the screen frame, at width A. A transformed node (`tf`) reports its box before the transform instead, the convention of the proxy (`NO_TRANSFORM`) and of capture: x, y from `absoluteTransform` with `place()`'s formula inverted (x = X − ox − tx + A·ox + C·oy, y likewise), w / h = `width` / `height` (T8: a 45° checkmark read 11.7 x 11.7 against 6.56 x 9.98). Descendants of a transformed node still read their rotated bounding box (none in the corpus); then the frame is resized to width B (its vertical HUG is restored after `resize`), read again, and resized back to A. The result goes back through the AI, so it is compact: values equal to the encoding are not repeated.

The runtime as installed (LF line ends, comment lines removed) must stay at or below 16 KB (16 384 B, tested).

BatchResult:
```
{ batch, page: name, pageId, z: 1, screens: [{               // z: 1 = compact entries, see below
    screen, root: frame id, sig, edited?: true,             // edited: kept frame, nothing else is returned
    extra?: [frame id],                                     // further copies of the screen's frame, left as they are
    nodes: [entry],                                         // one per id of ord(T), see below
    fontMissing: [{ o, family, style, used }], errors: [{ o, msg }],
    unbound?: [{ o, prop: bind code ('rn<i>.c' / 'rn<i>.ts' for runs), name, reason: 'missing-in-file' | 'bind-failed' }],
    unsupported?: { [o]: { ...raw of the encoding, im?: an image source that could not be loaded } } }],
  h?: result hash, added by the figma.mjs loader }
```
- **Order** `ord(T)`: pre-order of the screen's encoded tree `T` (node, then its `k` in order); a node with `bd.o` is followed, after its whole subtree, by `<o>#stroke` (its overlay).
- **entry** = `0` when the node is not in the result (failed, skipped or not read: see `errors`), else `[fid, A, dB?, d?]`:
  - `fid`: a number N = the node id is `P:N` with `P` the prefix of `root` (`root.split(':')[0]`); a string = the full id when the prefix differs.
  - `A = [x, y, w, h]` at width A. `dB` = B − A per value (rounded 0.01); `0` or absent = B equals A (it is written as `0` only when `d` follows).
  - `d`: only the fields whose actual value, read from the node after building, differs from the encoded intent. Absent = all equal. An absent field of `d` = the actual value equals the encoded intent.
  - **Compact entries** (`z: 1`, what the runtime returns): the result is retyped by the courier, so the entries are shortened. The anchor of an entry is its nearest ancestor in `ord(T)` (the parent; the node itself for `<o>#stroke`) whose entry is not `0`. Then `A`'s x, y are relative to the anchor's (absolute) x, y; `dB` = `1` means the anchor's `dB`; `fid` = `0` means the previous numeric `fid` in the list + 1. `expandNodes` (core/figma-check.mjs) gives the plain form above; `decode` calls it, and ingest saves the result expanded (without `z`). On the 6 screens s7–s12 the result went from about 26 KB to about 14 KB.
- **Intent and `d` fields** (actual values are read from the node; the overlay `<o>#stroke` takes its intent from the cell `o`):
  - `text`: characters; intent `tx` (glyph icon: `ic.g`). Text nodes only.
  - `runs`: intent = the encoded runs expanded per character and merged: `[length, fontSize, font, fill, textStyle, variable, decoration, case]` with node values (fs default 12, font `D.F[f]`, fill `D.C[c]` or `#000000`, text style `D.S[ts]`, fill variable `D.V[v.c]`, decoration `td`, case `tt`, '' when none), each `rn` entry overriding fs / f / c / ts / td / tt, and its fill variable = `D.V[rn.v.c]` when the run sets `c` or `v.c`, else the node's. Fonts compare by family + weight + italic (style name parsed as at load). Actual = `getStyledTextSegments(fontSize, fontName, fills, textStyleId, textDecoration, textCase)` (decoration / case as the first letter of the Figma value, NONE / ORIGINAL = ''); on a difference `d.runs` = the actual list with font as `'Family Style'` (covers font, size, fill, text style, fill variables, decoration and case of text).
  - `fills`: non-text. Intent `[D.C[bg]?, 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' per gr, 'IMAGE' if im]` (overlay `[]`); actual solid paints as `#rrggbb[aa]` (alpha = paint opacity), others by type.
  - `strokes`: non-text. Intent `{ c: [D.C[bd.c]], w: [t, r, b, l], d? }` when `bd` without `o` (overlay: the cell's `bd`), else `null`, `d` = the dash pattern drawn for `bd.d` (dashed `[3m, 3m]`, dotted `[m, m]`, m = the largest weight); actual `{ c, w: per-side weights, d?: dashPattern when not empty }` or `null`.
  - `radius`: non-text. Intent `rd` as four corners (absent = `[0, 0, 0, 0]`; overlay = the cell's); actual the four corner radii, except that a corner bound to a variable counts as its intent: its value is the variable's (`radius/full` reads 9999 for `rd` 99) and `vars` checks the binding.
  - `es`: non-text. Intent `D.S[es]` or '' (overlay ''); actual effect style name or ''.
  - `op`: intent `op` or 1 (overlay 1); actual opacity.
  - `vars`: intent = `e.v` mapped to Figma fields (`bg` fills, `sc` strokes, `pt pr pb pl g cg` paddings / itemSpacing / counterAxisSpacing, `w h` width / height, `r0..r3` corners, `b0..b3` per-side stroke weights, `op` opacity, `fs` fontSize, `vf` / `vs` icon vector fill / stroke) with `D.V` names; text `c` is left to `runs`; with `bd.o` the `sc` / `b*` codes belong to the overlay (the overlay also takes `r*`). Actual = `boundVariables` entries with an id, `fills` / `strokes` = the variable of the first bound solid paint (non-text), `vf` / `vs` = the first bound vector paint inside an svg icon. When the intent binds one variable to all four stroke sides and real Figma lists it on some of them only (seen on s7–s12: only `strokeLeftWeight`), with no other variable on a side, the sides count as bound (the weights are still compared in `strokes`). On a difference `d.vars` = the whole actual map.
  - `icon`: `0` when an svg icon has no child at all.
  - Not compared: line height, letter spacing, decoration, case, alignment, autoresize, sizing, layout (geometry is checked through the boxes). Known limit of the check's layer 3 (paint / text style): a decoration, case or alignment that Figma drops is not reported.
  - `boundVariables` values that are arrays (text fields of a TEXT node, e.g. `fontSize`, are a `VariableAlias[]`) are read from their first alias; `fills` / `strokes` are taken from the paints, not from `boundVariables`.

Numbers are rounded to 0.01.

## Figma variables

`core/figma-vars.mjs` (plan 3 Task 6) turns `tokens.json` into `use_figma` code that creates the variables and styles the encoder (`figma-encode.mjs`) and the runtime look up by name. `varsPayload(tokens, { limit })` returns one code string per batch (each at most 50 000 UTF-8 bytes, self-contained: a role alias finds its Primitive variable by name, also when it was made by an earlier batch, so run the batches in order). The builder is about 7 KB of every batch; the Planora tokens (about 210 KB of `tokens.json`, about 400 variables, 42 text styles) come to a few batches, and the test splits a token set of that size and checks each batch. `varNames(tokens)` is the encoder's `V` table (the fixture test asserts equality, same order). No Figma call is made by the plugin: the controller runs the batches.

- **Names**: variable = token path without `primitive.`, `.` -> `/` (`color/c01`, `space/12`, `radius/full`, `font/size/10_5`, `role/text-muted`); text style `type/<name>`; effect style `shadow/<name>`. Font family and weight, shadow and typography have no variable; a role token that aliases a typography or shadow has none either.
- **Style variants**: a Figma text style sets the decoration and case of the text it styles. Applying the style resets them, and setting a decoration or case the style does not carry detaches the style (measured on Figma Desktop 2026-11-24; before this, struck-through done items lost their line in Figma). So the encoder binds a styled run that has a decoration, or a case other than its style's, to a variant `<style>/<suffix>` (`strike` | `underline`, then `upper` | `lower` | `title` | `original` when the case differs, joined by `-`; Planora: `type/t14-600/strike` only). `figma.mjs plan` passes the variants of every screen to `varsPayload(tokens, { variants })`, which makes each one as a copy of its base style with that decoration and case. A run with a decoration or case of its own gets an explicit range style. The fake Figma of the tests mimics both behaviours.
- **Collections**: `Primitive` and `Role`, one mode each (renamed `Value`). Role variables are aliases to the Primitive variable their `$value` reaches (an alias of an alias is followed to the end). Description = `$description`.
- **Scopes** (always explicit, never `ALL_SCOPES`): colour -> `FRAME_FILL SHAPE_FILL TEXT_FILL STROKE_COLOR EFFECT_COLOR`; `space` -> `GAP` (Figma has no padding scope); `size` -> `WIDTH_HEIGHT`; `radius` -> `CORNER_RADIUS`; `border` -> `STROKE_FLOAT`; `opacity` -> `OPACITY` (value = the token x 100: Figma reads a variable bound to opacity as a percentage, so 0.9 is stored as 90; T8 measured a 0.9 variable drawing the node at 0.009. A literal role opacity gets `OPACITY` too. The encoder still matches a binding on the token's 0..1 value against the spec); `font.size` -> `FONT_SIZE`; `font.lineHeight` -> `LINE_HEIGHT`; `font.letterSpacing` -> `LETTER_SPACING`. A role takes the scopes of its primitive.
- **Values**: colours as `{r, g, b, a}` (0..1); dimensions in px. Text styles: nearest face of the family (same rule as the runtime; substitutions in `fontMissing`), line height PIXELS from `$extensions['vuong-design'].lineHeightPx` else PERCENT = ratio x 100, letter spacing PIXELS, case from `textTransform`. Effect styles: one `DROP_SHADOW` / `INNER_SHADOW` per layer.
- **Idempotent**: found by name, created when missing, updated when a value, scope set or description differs, never deleted. Result per batch: `{ batch, collections, variables, textStyles, effectStyles: { created, updated, unchanged }, created: { ...: [{ name, id }] }, fontMissing, errors, skipped? }`; sum the counts over the batches. Tokens the payload cannot express (`skipped`: a shadow that did not parse, a colour space other than srgb) are listed in the first batch's result.

## Figma CLI

`core/figma.mjs` (plan 3 Task 7) turns a `ds.mjs` output folder into `use_figma` calls, takes the results back and checks the real Figma screens with the plan 1-2 verifier. The script never calls Figma itself: the AI sends each batch.

```
node core/figma.mjs plan   --ds <ds output> --out <dir> [--page Screens] [--max-calls 40] [--force <screen>]... [--redo]
node core/figma.mjs ingest --out <dir> --result <file> [--batch vars-NN | batch-NN | N]
node core/figma.mjs shots --out <dir>    # then ingest-shots --out <dir> --result <file>, shots-clean --out <dir>
node core/figma.mjs serve  --out <dir> [--send <keys>|run|pending]... [--shots] [--port 8787] [--wait <s>]   # Figma bridge, below
node core/figma.mjs check  --out <dir> [--mutate] [--allowlist <json>] [--html <file> --root <sel> ...capture options] [--tol-* <px>]
```

- **plan** encodes every screen (`spec-norm-<id>.json`, `token-map.json`, `tokens.json`, `ir.json`), writes the variable batches (`varsPayload`), `runtime.js` and the screen batches (`planBatches`, each at most 50 000 bytes), and prints the estimate: `use_figma` calls (vars + runtime + screen batches still to send), `get_screenshot` calls (one per screen), total KB. It lists the batches for this run, in order, while the calls fit `--max-calls` (default 40). It stops at a batch boundary (`state.run.stopBefore`) and warns when the plan needs more. The same input gives the same numbering.
  - **Runtime once**: `runtime.js` stores the runtime in the file's shared plugin data (`figma.root`, namespace `vuongdesign`: `rt` = the code, `rtv` = `RUNTIME_VERSION`, 12 hex of its SHA-1). It is sent again only when the runtime changes; that does not make the screens pending.
  - **Screen batch** = `const D=<data>;` + a loader of about 500 bytes. The data is a JavaScript literal (identifier keys unquoted, strings in single quotes: fewer characters to escape inside the JSON of the tool call) with compact child ids. The loader returns `{ batch, stale, have }` when the file's runtime version is not the batch's, `{ batch, damaged: 1 }` when the data's FNV-1a hash differs from the one planned (the code was changed on the way), and otherwise runs the installed runtime with D and adds `h`, the FNV-1a of the result's JSON, to the result.
  - **Per screen**: each screen has a hash of its own data (tables resolved, page and force included). A screen `done` or `skippedEdited` with the same hash is not sent again (`screens unchanged ... (not sent again)`); the others are packed into new batches, numbered after the batches kept. Changing one screen sends one screen. `--redo` sends every screen. `--prof` sets `D.prof` in the screen batches: the runtime then returns `prof`, the ms of each phase summed over the batch (`init`, `fontLoad`, `sigOld`, `build` = `create` + `svg` + `text` (with `style`) + `paint` + `layoutProps` (own auto-layout, before the node joins its parent) + `append` + `layout` (size, sizing, min / max after), `late`, `boxA`, `resizeB`, `boxB`, `resizeA`, `read`, `sigNew`, `remove`, `total`); `ingest` prints it and keeps it in `state.batches[key].prof`. It changes nothing else in the result. `--force <screen>` (repeatable or comma-separated) puts the screen in `D.force`: the runtime rebuilds it even when it was edited by hand. `--ds` must be the folder of one HTML file (in corpus mode, `<out>/<file stem>`).
- **ingest** validates a result against the BatchResult shape of its batch (README "Figma runtime"; vars batches: "Figma variables"), copies it to `result-<key>.json` (a compact screen result, `z: 1`, is saved expanded) and merges it into `state.json`.
  - Malformed JSON or a wrong shape → exit 2, state unchanged. Wrong shapes: a wrong batch number, a screen missing or not in the batch, `nodes` not the length of the encoding, an entry that is not `0` or `[fid, A, dB?, d?]`, a screen batch result whose `h` is missing or does not match its content (the result was retyped or cut after Figma returned it: save the tool output verbatim). A `stale` or `damaged` loader answer exits 2 with what to send.
  - `runtime`: the result `{ runtime, bytes }` must carry the planned version.
  - A vars batch with a non-empty `errors` is `failed`, its errors kept (each item must be `{ msg, kind?, name? }` with string values, else exit 2). `plan` warns (and records `state.run.warnings`) while a failed vars batch is unsent and screen batches are scheduled. A screen batch is `failed` when a screen's root failed, else `done`.
  - Per screen: `done`, `skippedEdited` (`edited: true`: the frame was changed by hand and kept), or `failed`. `extra` frames are recorded.
  - The batch is told by the result's `batch` (a vars result counts from 0); `--batch` overrides it.
- **check** captures the source page again. It takes the ds run's `--html`, `--root`, `--widen`, `--no-webfonts` from its `report.json`; flags override them, and `--name`, `--widen-by`, `--viewport` must be given again if the ds run used them. It rebuilds the inferred, modelled and target specs (exit 2 when a target differs from `spec-norm-<id>.json`: the page changed since `ds.mjs` ran) and renders the local proxies as `pipeline.runScreen` does. Then it runs `verifyScreen` with the Figma readback as the proxy of what was built (`figma-check.mjs figmaProxy`, mark `figma-real`):
  - Role: the modelled proxy on a screen without applied norm records (as plan 1); the norm proxy on a screen with them (as plan 2, so the records explain what they change; the R75 Figma-model layer then compares real Figma with the norm layout proxy).
  - Boxes: A from the readback, B = A + dB. DOM per node from the reconstructed actual values (actual = encoded intent unless `d` says otherwise), in the shape of the proxy DOM.
  - Crops at width A on `shot-<screen>.png`. The screenshot's scale is its width / W_A; it is rescaled to the proxy's device scale 2. Request it at 2x: a 1x image loses too much detail for the crops. No screenshot → `crop` skipped, the screen fails.
  - Crop rules on the Figma screenshot only (Chromium source vs Figma raster, measured on the 18 Planora screens: identical text differs by up to ratio 0.77 / peak 220, p90 0.19 / 124; icons by at most 0.076 / 57, while another icon gives at least 0.49 / 122):
    - a text leaf's crop is reference only (`cropReference` in the report, never failing) when every run property is read back: text, size, family, weight, style, fill, decoration and case (a batch with `D.rd`). Its content and style are checked as data instead;
    - a frame with a dashed or dotted border: reference only when the dash pattern is read back (`D.rd`);
    - an icon leaf fails above ratio 0.25 or at peak 100 (`figIconRatio`, `figIconPeak`);
    - every other crop keeps ratio 0.05 / peak 40.
    A batch planned before `D.rd` (older runtime) keeps decoration, case and dash unread, and its text and dashed crops gate as before.
  - What the readback cannot observe is listed as skipped `figma-<name>`, reported and never failing:
    - `figma-crop-B`: the screenshot is at width A;
    - `figma-effect`: shadows, background images;
    - `figma-text-decoration`, `figma-text-transform`, and when present `figma-stroke-style` (dash pattern): only for a batch without `D.rd`. With `D.rd` the runtime reads `textDecoration` / `textCase` per run (`d.runs` entries `[len, fs, font, fill, ts, fv, td, tt]`, codes as encoded: td `U` / `S`, tt `U` / `L` / `T`, `''` = none) and the dash pattern (`d.strokes.d`, absent = solid; `[3m, 3m]` reads as dashed, `[m, m]` as dotted, m = the largest side weight);
    - when present, `figma-icon` (which sprite icon a vector frame shows: only "has vectors" is read back; an icon frame without vectors is still a finding), `figma-svg` (inline svg markup), `figma-image` (fit, position, source).

    The Figma section lists every node whose source has a box-shadow or background-image (`figma.effectsNotRead`: count and nodes) as "effect not read back on Figma: compare the crop / screenshot by eye". Hidden layers (`visible`) are not read back either.

    Outline is `none`: Figma has none, so a source outline is a finding.

    Corner radii in px compare by their effective value min(r, min(w, h) / 2), each on its own box (Figma clamps as CSS does), so a 999px or 99px pill read back as `radius.full` (9999 px) is equal. Only on the Figma readback: plans 1-2 compare radii as before.
  - A node missing from the readback (entry `0`), or a screen not built, failed or `skippedEdited`: no Figma box, the nodes are unchecked and the screen fails.
  - report.json and report.html get a Figma section per screen: build state, proxy vs Figma (the largest |box delta| between the local norm, or modelled, proxy and Figma at A and B, with the worst nodes), unread checks, `fontMissing`, `unbound`, build errors, `unsupported`.
  - `--mutate`: the readback mutations of `mutate.mjs`, each verified again on the same screenshot: `figMove` (box +3 px), `figText` (one character), `figFill` (fill colour), `figDrop` (node removed), and with `D.rd` `figCase` (a text reads back UPPER) and `figDash` (a dashed stroke reads back solid; for a stroke drawn by an overlay, the overlay's entry). `figIconPx` is a pixel fault: the first icon leaf is drawn as another icon of the screen in a proxy of the target spec, and that crop against the screenshot replaces the real one. A missed one fails the run; one without a candidate is skipped.

Exit codes: 0 every screen passes the gate (and no mutation was missed), 1 otherwise, 2 usage, setup or malformed input.

R77 (iii), real Figma only: a norm record explains a crop only when the norm proxy's crop against the Figma screenshot also passes (`cropsRefVsFigma`, measured for the failing crops; icon thresholds on an icon leaf; no measurement explains nothing). Before it, a wrong icon in a norm-resized icon slot was excused by the resize record (t8 s3 `n.0.13.0`, SRC_SQUASH 26 -> 34: source crop 0.47 explained, norm proxy vs shot 0 / 0, a swapped icon 0.83 explained as well).

Real-Figma run (2026-11-24, Planora 18 screens, bridge, file "Planora Design"): `serve --send pending --shots` 23/23 jobs, 25.8 s in Figma, 167.5 KB sent, 2384 KB back, 0 model tokens (vars: 43 text styles incl. the variant `type/t14-600/strike`, 396 variables, all unchanged on the resend). `check --mutate` (189 s): 13/18 pass, data findings 0 on every screen (decoration, case and dash included). Open: s8 and s11 a text wrapping at width B (+15 px height; s8 4 crops, s11 2), s3 `n.0.13.1.t` at B (17 px), s4 `n.0.11.11.2` (1 px), s17 `n.0.7.5.0` (2 px). Mutations: 104 caught, 0 missed, 22 skipped (no candidate): figMove, figText, figFill, figDrop, figCase 18 each; figDash 6 (12 screens without a dashed stroke); figIconPx 8 (10 without two icon identities).

AI workflow (one Figma file the user named; never two writers on the same file). Prefer the Figma bridge (next section): it replaces steps 2 and 3 with one `serve` run and costs no model tokens. The steps below are the fallback without Figma Desktop.
1. Run `ds.mjs`, then `figma.mjs plan --ds <ds out> --out <dir>`. Tell the user the estimate before the first write.
2. For each batch of this run, in order (`vars-*`, then `runtime`, then `batch-*`): send the file's content as the code of `use_figma`, save the returned JSON as a file, run `figma.mjs ingest --out <dir> --result <file>`. For a `failed` batch: read its errors, fix, run `plan` again (done screens are kept), resend.
   Send them through one `vuong-design:vd-figma-courier` agent for the whole run (`agents/vd-figma-courier.md`: tools Read, Write and `use_figma` only, no skill load), given the fileKey, the sessionId and the (script, result path) pairs in order. Its own context is about 10k tokens, against about 64k for a general-purpose agent that also loads `figma-use`; the scripts only need what the controller already checked. The result hash catches a result it did not save verbatim.
3. Screenshots at 2x. `get_screenshot` never goes above a node's native size, so a shot of the screen frame itself is 1x. Instead:
   1. `figma.mjs shots --out <dir>` writes `shots.js`. Send it with `use_figma`. On the page `_vd-shots` (created when missing, its old children removed) it clones every built screen frame (`root` in `state.json`), calls `rescale(2)` on the clone and places the clones in a row. It returns `{ page, clones: { screen: id }, sizes: { screen: [w, h] }, missing, errors }`. The Screens page ends as it was (a clone is created next to its frame and moved at once).
   2. Save the result and run `figma.mjs ingest-shots --out <dir> --result <file>`. It records the clones in `state.shots` and prints one `get_screenshot` per screen: the clone's id, `maxDimension` = the clone's larger side (2 × the frame's).
   3. Save each image as `<dir>/figma/shot-<screen>.png` (curl).
   4. `figma.mjs shots-clean --out <dir>` writes `shots-clean.js`. Send it: it removes the clones and the page.

   check derives the scale from the PNG width / W_A (a 608 px shot of a 304 px frame is scale 2, used as it is). This costs 2 more `use_figma` calls per run than the estimate prints.
4. Run `figma.mjs check --out <dir> [--mutate]` and open `<dir>/figma/report.html`.
5. Over `--max-calls`: after ingesting, run `plan` again; it continues with the batches not yet done.

Files in `<out>/figma/`:

| File | Written by | Content |
|---|---|---|
| `vars-NN.js` | plan | variables and styles, `use_figma` code (run in order) |
| `runtime.js` | plan | installs the runtime in the file (shared plugin data); sent once per runtime version |
| `batch-NN.js`, `batch-NN.data.json` | plan | one screen batch: compact data + loader, and the data D alone with full ids (check decodes the readback with it) |
| `state.json` | plan, ingest | progress (shape below) |
| `result-<key>.json` | ingest | the BatchResult as returned (screen batches: entries expanded, without `z`) |
| `shots.js`, `shots-clean.js` | shots, shots-clean | `use_figma` code: the 2x clones on `_vd-shots`, and their removal |
| `result-shots.json` | ingest-shots | the shots result as returned |
| `shot-<screen>.png` | the AI, or serve --shots | `get_screenshot` of the screen's 2x clone, or the frame exported at 2x by the plugin |
| `inbox/<key>.json` | serve | the result text as the plugin returned it (then ingested) |
| `runs.jsonl` | serve | one line per bridge run: ok, seconds, KB sent and back, per job key / ms / bytes |
| `report.json`, `report.html` | check | as layout.mjs, plus `figma` per screen |

`state.json`:
```
{ version: 2, ds, file, page, source: { html, root, widen, webFonts }, force: [screen], runtime: version, order: [key],
  batches: { [key]: { kind: 'vars' | 'runtime' | 'screens', n?, file, data?, screens, bytes, hash,
                      status: 'pending' | 'done' | 'failed', result?, errors?, fontMissing? } },
  screens: { [id]: { batch, hash, status: 'pending' | 'done' | 'failed' | 'skippedEdited', result?, root?, sig?,
                     edited?, skippedEdited?, extra?, errors?, fontMissing?, unbound?: { [reason]: n } } },
  shots?: { page, clones: { [screen]: clone id }, sizes?: { [screen]: [w, h] }, missing? }   (shots / ingest-shots)
        | { via: 'export', scale: 2, sizes: { [screen]: [w, h] } }                          (serve --shots),
  run: { maxCalls, calls: { useFigma, screenshot, total }, kb, send: [key], sendCalls, stopBefore } }
```

## Figma bridge

Sending a batch through `use_figma` makes a model retype it as the tool's `code`, then retype the result: about 0.8 output tokens per byte (18 Planora screens: about 140 KB, 110k tokens, 14 minutes). The bridge moves the same files with no model in between: `figma.mjs serve` (`core/figma-bridge.mjs`) serves a queue on `http://localhost:8787` (127.0.0.1 and ::1), and the development plugin in `figma-plugin/` (Figma Desktop) runs each job and posts the result back.

- The plugin runs the script text `use_figma` would run (`vars-NN.js`, `runtime.js`, `batch-NN.js`, top-level `await` and `return`) and sends back the JSON of its return value. Nothing else changes: the loader still checks the runtime version and the data hash and adds the result hash, and each result goes through `ingest` as it arrives (saved first as `inbox/<key>.json`).
- `--send` names the batches: comma-separated keys (`runtime,batch-01`, a bare number is `batch-NN`), `run` (the plan's this-run list) or `pending` (every batch not done). They are sent in plan order. Nothing is sent without `--send` or `--shots`.
- `--shots` then exports every built screen frame (`state.json` `done` with a `root`) as PNG at scale 2 with its own bounds (`exportAsync`, `useAbsoluteBounds`) to `shot-<screen>.png`. No clone page, no `get_screenshot`.
- The first failed job (a Figma error, a result `ingest` refuses, a batch `failed`) stops the queue; later jobs are not served. A job served and not answered is served again (the plugin was reloaded).
- Each run appends a line to `runs.jsonl`: ok, seconds, KB sent and back, and per job its key, ms and bytes.
- Exit 0 every job ok, 1 a job failed, 2 usage or no plugin connected within `--wait` seconds (default 300).

Setup, once: Figma Desktop → Plugins → Development → Import plugin from manifest… → `plugins/vuong-design/figma-plugin/manifest.json`. Then, in the target file: Plugins → Development → vuong-design bridge. Leave the plugin window open: it polls the bridge, waits between runs and picks up the next `serve` by itself. The manifest only allows `localhost:8787` (`devAllowedDomains`: Figma refuses an IP there), and the bridge listens on the loopback addresses only.

AI workflow with the bridge:
1. `ds.mjs`, then `figma.mjs plan`. Tell the user which batches and screens will be written and wait for a go-ahead.
2. Ask the user to open the plugin in the target file, then run `figma.mjs serve --out <dir> --send <the agreed batches> [--shots]`. It prints one line per job and a summary.
3. `figma.mjs check --out <dir> [--mutate]`.
