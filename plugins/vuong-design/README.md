# vuong-design

Static HTML → design system → Figma with variables, components and IDs, verified node by node.

Status: the steps from HTML to a checked Figma file all work (design system, questions, approvals, components, Figma send and check). Not built yet: the ID system and the `design-data.json` export for documentation.

## Quick start

`PLUGIN` below is this folder (`plugins/vuong-design`). Every step reads its arguments from one project file, and `next.mjs` tells you where you are and what to run next, so you never need to remember the order or the flags.

In Claude Code you can also just ask, e.g. "take design/screens.html to Figma" or "what is the next design step?". The `design-pipeline` skill then runs these steps with you: it creates the project file, runs `next.mjs` and the command it prints, and opens the answer and approve pages for you to decide.

1. **Project file.** Create `vd-project.json` in your project (paths are relative to it; see [Project file](#project-file)):
   ```json
   { "version": 1, "html": "design/screens.html", "out": "build/vd-ds",
     "rules": "vd-rules.json", "allowlist": "vd-allowlist.json", "figma": { "out": "build/vd-figma", "file": "My design" } }
   ```
   No HTML yet? Ask Claude to use the `spec-to-html` skill on your spec: it writes a page in the input profile, so `root` and `widen` can be left out.
2. **Where am I?** `node PLUGIN/core/next.mjs --project vd-project.json` lists the steps done and prints the next command. Run it after every step.
3. **Design system.** `node PLUGIN/core/ds.mjs --project vd-project.json` (about 10 s per screen). Its output is `report.html` (does every screen match?) and `design-system.html` (tokens, questions).
4. **Answer the questions** in the browser: `node PLUGIN/core/answer.mjs --project vd-project.json`, Submit, run ds again.
5. **Approve what is fine** in the browser: `node PLUGIN/core/approve.mjs --project vd-project.json`. Tick the findings that are fine, Submit, run ds again. Repeat 4-5 until every screen passes.
6. **Components** (with `"components"` in the project): `node PLUGIN/core/cmp.mjs --project vd-project.json`.
7. **Figma.**
   - Once per machine: `figma.mjs serve` copies the plugin to `~/.vuong-design/figma-plugin/` (`VD_FIGMA_PLUGIN_DIR` overrides it) and prints the manifest path on a line of its own. In Figma Desktop, Plugins → Development → Import plugin from manifest…, paste that path. A plugin update needs no new import: serve copies the new files there and asks to reopen the plugin window (only a changed manifest asks for a new import).
   - Each time: open the file and run the "vuong-design bridge" plugin, leaving its window open.
   - Then run the commands `next.mjs` prints, in order:
     - `figma.mjs plan`
     - `figma.mjs serve … --send pending --shots`
     - `figma.mjs check`
     - `approve.mjs --project … --figma` for what Figma draws differently.

Requirements: Node 18+ and Playwright for the steps that open a browser (`ds`, `layout`, `figma check`); see [Setup](#setup).

## Project file

`vd-project.json` (R91, `core/project-file.mjs`) holds the arguments of every step. `layout.mjs`, `ds.mjs`, `answer.mjs`, `approve.mjs`, `cmp.mjs` and `next.mjs` take `--project <file>`. A flag given on the command line overrides the file. Paths are relative to the folder of the project file. An unknown key is an error, so a typo is never ignored silently.

| key | used by | meaning |
|---|---|---|
| `version` | all | `1` (required) |
| `about` | none | free text |
| `html` | layout, ds | the source page (required) |
| `root`, `widen`, `name` | layout, ds | as `--root`, `--widen`, `--name`; leave them out for a page in the input profile |
| `viewport`, `widenBy` | layout, ds | as `--viewport`, `--widen-by` (px) |
| `webFonts` | layout, ds | `false` = `--no-webfonts` |
| `out` | all | the ds output folder (`--out` of layout / ds / answer / approve, `--ds` of cmp / figma plan) |
| `rules`, `names` | ds, answer, cmp | the rules and names files; used once they exist (answer creates the rules file) |
| `allowlist` | layout, ds, approve, figma check | the allowlist; used once it exists (approve creates it) |
| `components` | cmp | the components file |
| `figma.out`, `figma.file`, `figma.page` | next, approve `--figma` | the `figma.mjs` folder, the Figma file name (`serve --file`) and page (`plan --page`) |

`next.mjs` never runs a step. It reads what the steps wrote and compares file times: a page, rules, names or allowlist file newer than `report.json` means ds must run again, and a ds report newer than the Figma `state.json` means plan must run again. Then it prints the first step not done, with its command. A failing screen with nothing to approve (an unexplained norm root, a data finding, an unchecked node) stops it with the reason: the HTML or the plugin must change.

## Setup

- Node >= 18. No npm dependencies in this plugin.
- Playwright is looked up in `$VD_PLAYWRIGHT_FROM` (a directory containing `node_modules/playwright` or `node_modules/playwright-core`), then in the current project's `node_modules`. Nothing is installed automatically.
- Uses the Chromium already installed by Playwright (`ms-playwright/chromium-*`); it never downloads a browser.

## Tests

```
VD_PLAYWRIGHT_FROM=/path/to/dir node --test plugins/vuong-design/test/
```

## Input profile and lint

Input HTML should follow [PROFILE.md](PROFILE.md) (`vd-html v1`): screens marked `data-vd-screen`, tokens as CSS variables, flex layout, no scripts, `data:` images. Every rule has a code (`E1..E8` break the pipeline, `W1..W20` lower accuracy).

```
node plugins/vuong-design/core/lint.mjs --html <file> [--root <sel>] [--widen <sel>] [--out <dir>] [--strict] [--log <runs.jsonl>] [--json]
```

One page load and one widening (A, A + 120 px), no model, a few seconds. stdout is at most 15 lines (summary, the 10 worst finding groups, a pointer to `lint.json` in `--out`). Exit code 0 no errors, 1 errors (or warnings with `--strict`), 2 usage or setup error. It never modifies the HTML. `--log` appends `{ ts, tool: 'lint', file, ms, screens, error, warn }` to a JSONL file.

Flow for new designs: `skills/spec-to-html` (spec to HTML, lint loop of at most 3 rounds) starting from `templates/starter.html`, then `layout.mjs` / `ds.mjs`, which run the lint gate first and need no `--root` for a profile file.

## Diagnose and session log

```
node plugins/vuong-design/core/diagnose.mjs --out <layout or ds output dir> [--max <n>] [--json]
node plugins/vuong-design/core/session-log.mjs --log <runs.jsonl> [--transcript <session.jsonl>] [--label <text>]
```

- `diagnose.mjs`: a few lines per failing screen (screen id from `data-vd-screen`, then roots, approvals, crops, data,
  unchecked, each with width A/B, delta [dx, dy, dw, dh] px and the node as the last three `tag.class` levels). Lets a
  model act on a failed layout without reading `report.json` / `ir.json`. Exit 0 all pass, 1 a failure, 2 usage.
- `session-log.mjs`: appends the current Claude Code session's cost (models, API calls, output / input / cache tokens,
  minutes) to a runs log, from the newest transcript of the working directory's project folder.

## Layout CLI

```
node plugins/vuong-design/core/layout.mjs --html <file> --out <dir> [--root <selector>] [--no-lint] \
  [--widen <selector>] [--name <selector>] [--widen-by <px>] [--viewport <px>] \
  [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--tol-text-round <px>] [--no-webfonts] [--no-cache] \
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

Speed (R95): screens run in parallel, each worker on its own Chromium process (`VD_JOBS=<n>`, default half the CPU cores, 2 to 6; a run gives the same bytes as `VD_JOBS=1`). Each screen's proxies and verify result are kept in `<out>/.cache` (ds, layout) and `<figma dir>/.cache` (figma check: the local proxies) and reused when the key is unchanged: the captured tree, the content of the local image files it names, the font map, the options, the target spec with its records and the entries they name, the plugin code (every file of `core/`) and the Chromium version. Screenshots are not in the key (GPU raster gives a few different pixels from run to run on the same page); a screen with a canvas, video or iframe is never cached. `--no-cache` renders everything again.

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
| `spec-norm-<id>.json` | the target spec of each screen (the modelled spec with the applied entries; equal to `spec-<id>.json` when nothing applies). R93: the HUG sizes of its frames are the norm proxy's at width A, since an applied padding, gap or size changes them and `apply-norm` does not resize HUG parents |
| `design-system.html` | the visual proposal: verdict, How to read, questions as a form (an option or a free answer per open question, a Submit bar), colours, spacing, radius, type, shadows, changes (source vs norm crops), coverage |

`tokens.json`, `tokens.css`, `token-map.json`, `normalisation.json`, `questions.json`, `vd-rules.draft.json` and `coverage.json` are deterministic (no clock; the order of screens does not matter).

### Answering the questions

R96: values the author wrote as `%` or `calc()` of their box (capture `rel`) are kept (RELATIVE), and the 4 px grid is off by default: an off-grid spacing, size or radius is kept (OFF_GRID) and asked about by no question. `"project.grid4": "ask-each"` in `vd-rules.json` turns on one question per off-grid spacing or size of a frame with children (`grid4|<cat>|<value>`), keeping the value by default; a corner radius or the size of a leaf frame is never asked. `accept-all` for the grid was removed (an error names it).

R97: no size, space or font size changes without an answer, and every question keeps the value by default (the only automatic change left is COLOR_DE1, a colour the eye cannot tell apart).
- **ROLE_MAJORITY** is now the question `major|<cat>|<value>|<majority>`: is the odd value a variant of the component (keep) or a slip (use the majority)?
- **ICON_FRAME** keeps the icon size by default. A larger icon grows the button that hugs it.
- **TYPE_SCALE** is one question per size (`type|<from>|<to>`). It never proposes a size more than 2 px away.
- **`project.iconFrame` and `project.typeScale` are gone.** Their keep answers (`ask-each`, `no`) are still read; `accept-all` / `yes` throw.
- **`project.lineHeightInt` defaults to `no`.**
- **Answers named by failing findings.** After a run, `ds.mjs` lists every applied answer that failing findings name (`normalisation.json` `layoutImpact`, the log, a box at the top of the questions in `design-system.html`), so you change that answer instead of approving the pictures.
- **Line height in the proxy.** The proxy now records each text leaf's computed line height (`dom.lh`). A line height change inside a fixed-height text box moves the glyphs without moving the box, and is no longer taken as "changes nothing".

```
node plugins/vuong-design/core/answer.mjs --out <ds output folder> [--rules <vd-rules.json>] [--port <n>] [--no-open]
```

Serves `design-system.html` of that folder on 127.0.0.1 and opens it. Pick an answer under each question you want to settle (or "Keep the value for the rest"), then Submit: the answers are checked against `questions.json` (an option of the question, or a non-empty free text; one bad answer saves none) and merged into the rules file the run read (or `--rules`). Every other key of the file (`notes`, `states`, earlier answers) is kept, the old file is copied to `<rules>.bak`. Re-run `ds.mjs` to apply them. Opened as a plain file, Submit downloads the merged `vd-rules.json` instead. Choices survive a reload until they are saved.

### Approving findings

```
node plugins/vuong-design/core/approve.mjs --out <run output folder> --allowlist <vd-allowlist.json> [--port <n>] [--no-open]
```

Serves `report.html` of a `layout.mjs`, `ds.mjs` or `figma.mjs check` run on 127.0.0.1 and opens it. Every finding the gate can allowlist (needs-approval entries, crop fails, unexplained roots other than norm roots) has an **approve** box and an optional reason; R96: a crop is shown on the proxy it was measured on (the normalised layout proxy when the screen has normalisation records), and a crop whose subtree holds records names them ("Caused by a normalisation answer: node prop from → to (code)"), so a picture the rules spoiled is fixed by changing that answer, not approved; there is no bulk tick for such items. Submit saves each ticked finding's `allowlistDraft` entry from `report.json` with `approved: true` (an empty reason becomes "approved in report.html <date>"), also for its repeats on other screens. An entry with the same file, screen, node, width and kind is replaced; the others are kept; the old file is copied to `<allowlist>.bak`. One finding that is not open in `report.json`, or cannot be allowlisted, saves none. Re-run the check with `--allowlist` to apply them. Until then the page reads the file when it opens and shows the findings already in it as saved; "show only items left to approve" hides everything else (allowlisted, saved, repeats, findings that cannot be approved, and screens with nothing left). Opened as a plain file, the page shows the boxes but cannot save.

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

"Crop fails" are standalone crop fails; "+ linked" are crop fails on an unexplained size root (R44), which pass only together with that root's allowlist entry. "Needs approval" lists model roots above tolModel plus at most one cumulative model-drift entry per screen (R43), with the largest accumulated model delta as its magnitude. R85: an approval of at most `--tol-text-round` (default 2.5 px) whose scope (the node's parent and its subtree; the whole screen for the drift entry) holds a text and no other model flag (font substitution, line height, mixed run height, stroke overlay) is Figma rounding text widths: it is listed in `modelAccepted` and does not fail the screen. Set `--tol-text-round 0` to approve each one by hand.

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
- planora s4 chip row width round-up (2.28 px at B): Figma rounds text box widths; not a line-height case, so LINE_HEIGHT_INT does not touch it (accepted as text rounding since R85).
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

### Component facts (plan 3b)

`cmpProbePayload()` (9.5 KB, one bridge job) probes the component API on `_vd-probe`. Everything it makes is named `cmp-*` and placed at y 3000 px or below, and its temporary variable collection is `vd-probe-tmp`. A `finally` block removes all of it; the result reports `cleaned`. `readCmpFacts` turns the result into the `cmp` key of `core/figma-facts.json`; each case falls back to the safe side (`no` / `false`) when a value is missing. Measured 2026-11-24 through the bridge: 3.4 s, no errors, `cleaned: true`. Measured again 2026-11-25 with the case `ov` added (16.3 KB): 8.5 s from the plugin's connection, no errors, `cleaned: true`, and the other cases unchanged.

| Case | Measured | Fact |
|---|---|---|
| `data` (shared plugin data on an instance's child) | read through the instance before any set: `main.t` (inherited); set on the instance child: `inst.t`, while the main and another instance still read `main.t`; the child id has the form `I<instance id>;<child id>` | `data: own`, `idPattern: true` |
| `props` (component set `state=default` / `state=selected`) | TEXT, BOOLEAN and INSTANCE_SWAP properties set and read back; variant switched; a direct fill override on the instance kept after `setProperties` | all `true` |
| `layout` (row and chip components, 8 nodes, columns 300 px and 360 px) | largest box difference instance vs plain frames: 0 px at 300 px, 0 px at 360 px (row height 32 px) | `layout: ok`, `layoutMax: 0` |
| `bind` (fill and paddingLeft bound to variables on the main) | both bindings inherited (paddingLeft 12 px); fill rebound on the instance | `bind: ok` |
| `time` (20 rows) | instances 412 ms, plain frame trees 815 ms (2026-11-25: 299 ms, 343 ms) | `timeMs` |
| `ov` (2026-11-25, 30 properties on an instance's child) | see "Instances must rebuild their target" | `ov` |

Every case is favourable, so plan 3b keeps its design: ids on instance children through plugin data, component properties for text, booleans and icons, and instances in screens.

## Components

`core/components.mjs` (plan 3b Task 2) decides which subtrees of the target specs (`spec-norm-<s>.json` with the capture IR) become Figma components, with their variants and properties. It is pure: no browser, no model, and the result does not depend on the order of screens. The full rules are in the file's header comment and in spec §10.

- **No fixed count.** A control (tag `button` / `input` / `select` / `textarea`, or a kind declared for its class), a block with a state class, or a block with a class of its own, its own paint (fill, border, shadow or background image) and at least 2 nodes becomes a component, even if it is used once on one screen. A bare block (no class) repeated with the same structure under the same parent class is only a proposal until the user keeps it.
- **Declarations, not guesses.** The corpus and the vd-html profile have no `role`, `aria-*`, `data-state`, `<button>` or `<input>`; Planora marks controls with short classes (`btn`, `ck`, `tog`, `chip`) and states with `on`, `off`, `done`. So kinds, extra state classes, modifier classes (variant axes) and the choice for classes with several structures come from `vd-components.json`, which the user writes. `componentsDraft()` writes `vd-components.draft.json` with suggestions and notes (counts, screens, shapes); agents never copy it into `vd-components.json`. Until the user answers, undeclared classes keep their old behaviour: a modifier class makes a separate component, and a class with several structures is built as layers.
- **Kept bare blocks.** A bare block has no class to declare, so its `keep` entry carries the declaration: `"b:<hex>": "<name>"`, or `{ "name": "<name>", "kind": "tab", "stateMap": { "<class>": "<state id>" } }`. A kind other than `other` makes it a control with that kind's state table (a tab: `on` is `selected`); without one it stays `other` and keeps its HTML states as they are.
- **Shapes.** Inside each variant the occurrences are clustered by structure. One structure per variant: a component. More than one: `shapes` in the declaration picks `variants` (one component set with a `shape` axis), `split` (one component per shape) or `container` (layers, the default, as plan 3 builds them).

Planora (18 screens, 1155 spec nodes, ds run of 2026-11-24 with `vd-rules.json`; 11-18 ms per run):

| Declaration | Components (by reason) | Variants | Properties | Occurrences | Nodes inside instances | Skipped |
|---|---|---|---|---|---|---|
| none | 20 (class 15, state 5) | 25 | 11 | 125 | 332 / 1155 (28.7 %) | shapes 88 (`card` 32, `li` 32, `set` 15, `nav` 6, `li done` 3), nested 6 |
| the draft as written (a test, not an answer) | 14 (control 5, class 6, state 3) | 28 | 9 | 131 | 339 / 1155 (29.4 %) | shapes 88, nested 6 |
| the draft with `shapes: variants` for `li`, `set`, `nav`, `card` (a test) | 18 (control 5, class 9, state 4) | 64 | 36 | 219 | 800 / 1155 (69.3 %) | nested 6 |

With the draft, `btn` is one button with 4 variants (33 uses on 12 screens), `ck` one checkbox with 6 variants (state x size / form, 18 uses), `chip` one chip with 4 variants (15 uses), `tog` a switch (3 uses), `fab` a button (6 uses). Structures per class: `card` 32 uses in 19 shapes (a generic container: different content each time), `li` 35 in 16, `set` 15 in 2 (13 text rows, 2 switch rows), `nav` 6 in 2. Part of `li`'s count comes from infer wrapping the checkbox in a synthetic frame on some rows and not on others; whether matching may look through synthetic frames is decided in Task 5, where `expandInstance` checks each rebuilt instance. Three bare state groups are components named `cmp-1` to `cmp-3`: two kinds of bottom-nav item (`a` under `.nav`, two structures, so two bare keys) and the segment item (`div` under `.seg`), each with `default` / `on`: a name comes with `keep` in the declaration. The draft also warns that `bottom btn p` carries two declared base classes (`bottom` is used).

### States

`core/states.mjs` (plan 3b Task 3) gives each component the states of its kind and says where each one comes from. Kinds and their states (mobile, so no hover): button: default, pressed, disabled, loading, focus. Input: empty, focus, filled, error, disabled. Checkbox: unchecked, checked, disabled. Radio, chip: unselected, selected, disabled. Switch: off, on, disabled. Tab: unselected, selected. `other` has no table, and its HTML state classes are kept as they are.

- **html:** a variant from the HTML is in that state. The base state is a variant with no state class. State classes map by name: `on`, `checked`, `selected`, `active` and `current` map to the kind's "on" state, `is-disabled` to disabled, and so on. `stateMap` in `vd-components.json` maps a class the names do not cover, for example `done` to `checked`. An unmapped class is kept as an `extra` state, with a warning.
- **proposed:** a rule draws the state on each variant that is in the base state. The rules, with the spec §10 defaults:

  | State | Rule (default) |
  |---|---|
  | pressed | overlay in the content colour at 10 % |
  | disabled | content at 38 % opacity; root fill and stroke at 12 % |
  | focus | 2 px ring in the focus token |
  | error | root stroke in the error token |
  | loading | labels replaced by a spinner of the label's size and colour |

  The values sit in `vd-rules.json` under `states`. `statesDraft()` writes them with `approved` empty. Proposed states go to Figma (`forFigma()`) only after the user sets `"approved": true`. Agents never write that.
- **missing:** no rule exists for the state (checked, selected, on, filled, empty: draw them in the HTML), or the rule needs something the design system lacks: a focus or error token, a label, a content colour. Each entry has its reason and is listed for coverage.

Planora (the same draft declaration, `vd-rules.json` without `states`; 5 ms):

| Component | Kind | States |
|---|---|---|
| `btn` | button | default from HTML; pressed, disabled, loading proposed (12 proposed variants over 4 variants); focus missing (no focus token) |
| `ck` | checkbox | unchecked and checked from HTML (`on`); disabled proposed |
| `chip` | chip | unselected from HTML; disabled proposed; selected missing (no state class on any chip) |
| `tog` | switch | off from HTML; disabled proposed; on missing |
| `fab` | button | default from HTML; pressed, disabled proposed; loading missing (icon only, no label); focus missing |

`cmp-1` to `cmp-3` have kind `other`, so `on` stays an extra state. Planora has no focus or error token, so focus is missing on both buttons.

### Instances must rebuild their target

Plan 3b Task 5 (`components.mjs`, `states.mjs`). Each use of a component must rebuild its own target spec from three things: the variant's template, its property values, and its overrides. `expandInstance()` does what the Figma runtime will do. `instanceDiff()` compares the result with the target, as plan 1 compares:

- frames within 0.5 px, texts within 1 px;
- paint, type and icons equal;
- `w` and `h` only on axes that are FIXED, since HUG and FILL sizes are Figma's result and `check` reads them back.

**Overrides.** A difference without a class becomes an override on that use: `ov: { '<path>': { '<key>': value } }`, where `''` is the root.

- The root's size and sizing belong to the instance.
- Below the root, the probe's case `ov` decides what can be overridden (`cmp.ov` in `core/figma-facts.json`, read by `cmp.mjs` through `overridableFrom`). Without that measurement a safe default applies: structure, layout direction and wrap, absolute placement, clip, transforms, image fills and icon refs are not overridable.
- Icon refs always go through INSTANCE_SWAP.

Measured 2026-11-25 (Figma file "weather"):

| | Properties on an instance's child |
|---|---|
| Overridable | fills, image fills, borders, radius, shadow, opacity, clip; padding, gap, wrap, wrap gap, alignment, sizing mode; every font property; text; icon colours |
| Not overridable | layout direction; position (`x`, `y`) and rotation, both refused by Figma ("cannot be overridden in an instance: relative-transform"); width and height through `resize`; min / max width; adding a child |

`resize` and min / max width read back unchanged without an error, so they count as not overridable. Planora does not need them: no use differs from its template in a FIXED child size.

A use with such a difference is `detached`: it is listed with the reason and built as layers, as plan 3 builds it. Nested uses follow two more rules:

- A use that holds a detached use is detached too, because Figma cannot detach a nested instance alone. A template that holds one takes its whole variant with it.
- A component left with no use is skipped as `detached`.

**Contrast.** Each proposed state gets a WCAG contrast: `contrast` on the proposed entry, and a warning when it is below.

| State | What is measured | Required |
|---|---|---|
| pressed | texts and icons under the overlay | 4.5:1 (large text 3:1), icons 3:1 |
| focus ring, error stroke | against what is behind the component | 3:1 |
| loading spinner | against the root | 3:1 |
| disabled | exempt: WCAG does not apply to inactive controls | none |

Pressed also gives the ratio without the overlay. The preview shows the contrast and the uses built as layers, and `cmp.mjs` prints the counts.

Planora (the user's `vd-components.json` with the three tabs, approved `vd-rules.json`, 2026-11-25):

- 127 instances, 38 of them with overrides. The most common is a root fill, on 17 uses.
- 4 uses are built as layers, all of them `bar`: its absolutely placed marker sits at a different x on each screen.
- 3 pressed states are below WCAG: `btn` at 3.64:1 and 2.83:1, and the `fab` icon at 2.31:1. Their base states are already low: 4.08, 3.13 and 2.53:1.

### Component CLI and preview

```
node core/cmp.mjs --ds <ds output dir> [--components <vd-components.json>] [--rules <vd-rules.json>]
```

This step runs after `ds.mjs`. It uses no browser, no Figma and no model. Defaults: `vd-components.json` and `vd-rules.json` in the current folder, when they exist. Both files are only read.

It writes these files into the ds folder:

- `components.json`, `states.json`, `vd-components.draft.json`.
- A `states` section added to `vd-rules.draft.json`. The section is removed once the rules file has `"approved": true`.
- `components` in `coverage.json`: the missing states with their reasons, and counts.
- `components.html`: the preview.
- A short "Components" section with a link, added to `design-system.html` between `<!--vd:components-->` markers. A rerun replaces it.

The preview has one section per component:

- one cell per HTML variant;
- the proposed states, each with its rule in words;
- the missing states, each with its reason;
- the bare proposals, each with the `keep` line to copy;
- the groups that are not components, with the reason;
- the two drafts.

Each cell is an `<iframe srcdoc>` that holds the proxy page (`proxy.mjs`) of one subtree. It is drawn on the fill behind the component in its screen. `stateSpec()` draws a proposed state's patch on a copy of the template. Planora run: 0.26 s, `components.html` 142 KB.

### Figma components

`figma.mjs plan` reads `components.json` from the ds folder when it exists (`--no-components` turns this off; `--cmp-page`, default `Components`). Without it every batch is the plan 3 batch, byte for byte.

**Batches, in send order:** vars, `runtime`, `runtime-cmp`, `cmp-NN`, then the screen batches.

- `runtime-cmp` installs `core/figma-runtime-cmp.js` once, like the runtime (≤ 16 384 B as installed; 8.5 KB now).
- A batch that uses components gets a loader that inserts it into the screen runtime and patches a few calls there (`CMP_PATCHES`; `isAL` also counts a component root as auto layout, so its state overlays and badges go absolute). The screen runtime itself is unchanged.
- `cmp-NN` batches build, in this order: the icon components (`icon/<ref>`, one per value an INSTANCE_SWAP property can take), then the components, each after the components its templates hold. A component's variants never split between batches.

**A component** is its template built as a screen frame, then turned into a component.

- Its readback goes into `state.json` under `components` (one entry per variant).
- Variants become a component set named after the component. Each variant is named `axis=value, ...`. The set forms once its last variant is built and placed: a variant named anything else breaks the set, and real Figma then refuses `setProperties` on every instance of it.
- Layout of the components page: one row per component (the icon components share one), 64 px apart, below what is already on the page; a set holds its variants in one row, 24 px apart and 24 px in.
- The set (or the single component) gets the properties. TEXT binds `characters`, BOOLEAN binds `visible`, INSTANCE_SWAP binds the main of an icon instance.
- Plugin data `vuongdesign/cmp` holds the name the runtime finds it by: `<name>` or `<name>/<axis=value, ...>`.

**An instance** (an occurrence that Task 5 did not detach) keeps its full plan 3 encoding, plus a few marks (`core/figma-cmp.mjs` header):

- `i`: the component. `p`: the property values. `j`: the layer index when a hidden BOOLEAN layer comes before it. `rc`: an icon whose colours are compared.
- The runtime creates the instance (or swaps a nested one to its variant) and sets the properties. On each layer it then sets only what differs from the encoding. Every such set is an override.
- It never sets layout direction, position or child size on a layer: Figma refuses those (probe case `ov`), and Task 5 detaches any use that would need them.
- A nested main binds its own variables: where the readback shows other variables than the encoding's, each field is bound again to the encoded one.
- The readback is the plan 3 one: every spec node has an entry, by the same id. So `check` reads instances as it reads layers.

**A second build** (the data changed, or `--redo`) builds new components. The instances of each old one move to the new one of the same name (`swapComponent`), and the old one is removed: no duplicates. An unchanged `cmp-NN` is kept, as a vars batch is. A screen's hash covers the component items it uses. A `cmp-NN` batch only replaces the components it builds itself; those of other batches stay. An old component that the batch failed to rebuild also stays. The swap is the build's own change, not a hand edit (R92): a screen or a variant of another batch that holds a swapped instance and was unedited before the swap gets its signature again after it. The instances of each old component are asked for again right before its swaps (R98): a swap inside a main component makes the sublayers of its instances again, so a nested instance found earlier is gone, and a removed one is skipped. A Figma error in a bridge job carries its message as well as the stack. A variable or text style value change is not a hand edit either (R99): it reflows the hug frames and texts that use it, so before its first value change a vars batch checks every root with a signature (screens, variants) with the installed runtime's sig, and after the changes signs the unedited ones again; an edited one keeps its old signature. Only the screen and component pages are loaded (a large page can take Figma past its 10 s limit); a failed check is a warning (`signWarn`), the values still change. The result carries `signed: { roots, edited, again }` only when a value changed. The bridge window ends a run with its total: jobs, seconds in Figma, the slowest job.

**Edited by hand.** A component carries a signature (`vuongdesign/sig`), like a screen frame. The signature is refreshed once its set, properties and swaps are done.

- If you edit any variant of a component, the next build keeps the whole component: every variant and its set.
- Each variant reports `edited` with its old root. `ingest` records it as `skippedEdited`, and the screens' instances keep using it.
- `--force cmp:<name>` rebuilds it. A screen batch never gets the `cmp:` entries, and an unknown name is a usage error.
- A variant that the kept component does not have is not built. It reports an error that names `--force`.

**Instance mains.** The readback also checks which component an instance uses.

- An instance (`i`), or an icon set by an INSTANCE_SWAP value (`mi`), whose main component is not the encoded one reads back `d.mc`, the main's `cmp` name.
- The runtime reads mains with `getMainComponentAsync`. The bridge plugin's `documentAccess: dynamic-page` forbids the sync `mainComponent` getter; the fake throws for it with `dynamicPage: true`.
- `check` reads such an icon by its main (`icon/<ref>`), so its identity is checked as data instead of being unread (`figma-icon`).
- An instance of another component that is not an icon is a `component` data finding.

**Check.** With components, `figma.mjs check` adds a `components` section to `report.json` and a table to `report.html`. The functions are in `core/figma-cmp-check.mjs`.

- A variant has no source page, so it is checked against its encoding. It passes when:
  - every node is read back;
  - no node differs from its encoding, except a text bound to a TEXT property: Figma shows the set's one default in every variant (`propertyTexts`), and the HUG sizes around such a text are not compared;
  - every FIXED size is within 0.5 px, a frame's HUG size within 1 px (Figma rounds the texts it holds; texts 1 px);
  - the build had no errors.
- A HUG text gets its size from Figma's font metrics, so it is checked on the screens, against the source.
- `skippedEdited`: kept and not checked here. It passes, and the log lists the screens that use it.
- A variant without readback (failed, pending) fails. Each of its instances on a screen then reads back as missing (unchecked, with the reason), so that screen fails.
- The run passes only when every screen and every variant passes.

`--mutate` adds two planted errors on batches with components; a batch without them keeps the plan 3 list:

- **`figCmp`:** the main of the screen's first instance is built wrong (its root fill inverted). Every instance of it on the screen shows that fill, and each one must be caught. On the components side, one variant's root fill is changed, and its check must fail.
- **`figSwap`:** the first icon set by a component reads back as another icon component.

Planora on the fake (18 screens, 14 components, fixture `test/fixtures/figma-cmp-planora.json.gz`, 2026-11-25):

| | |
|---|---|
| Component batches | 1 (19.3 KB) |
| Screen batches | 3 (44.0, 46.6 and 19.1 KB) |
| Instance layers on the screens | 147 (127 occurrences, plus their nested and icon instances) |
| Nodes read back as encoded | 1 335 of 1 335 |

**Proposed states.** Once the state rules are approved (`states.approved: true` in `vd-rules.json`, set by you), `figma.mjs plan` also reads `states.json`:

- Each numeric rule value becomes a variable in a collection `State`: `state/pressed/overlay`, `state/disabled/content`, `state/disabled/container` (opacity scope), `state/focus/width`, `state/error/width` (stroke-weight scope). `cmp.mjs` writes the same values to the end of `tokens.css` (`--state-pressed-overlay: 0.1;` …, between `/* vd:states */` markers).
- A component with a proposed state gets the variant axis `state`. Its variants from the HTML become `state=default` unless they already have a state. Each proposed state is one more variant, built from its base variant:

| State | What the variant adds |
|---|---|
| pressed | a top layer at full size, filled with the content colour, its opacity bound to `state/pressed/overlay` |
| disabled | the root's fill and stroke move onto a bottom layer whose opacity is bound to `state/disabled/container`; each child's opacity is bound to `state/disabled/content`. A root without children (an empty checkbox) has no other content: its outline is the content, so the layer is bound to `state/disabled/content` (38 %; at 12 % Planora's checkbox border would drop from 1.61:1 to 1.05:1 on white) |
| loading | the label at opacity 0 (it keeps its size) and a centred spinner in the label's colour |
| focus | a ring layer outside the root, its stroke weight bound to `state/focus/width`, in the focus colour token |
| error | the root's stroke in the error colour token; its width is bound to `state/error/width` when the root had no stroke |

- Figma cannot bind the opacity of a single fill, so a faded fill or an overlay is a layer of its own. Changing one variable then changes every state component that uses it.
- These variants have no instances on the screens. Rules not approved, or `--no-components`: no `State` variables, no state variants, and every batch is the same, byte for byte, as without `states.json`.

Planora with its states (fixture `test/fixtures/figma-cmp-planora-states.json.gz`, 2026-11-26): 22 state variants (btn: pressed, disabled and loading on each of its 4 variants; chip, ck, fab, tog: disabled; fab: pressed). The component batch is 29.5 KB; all 1 398 nodes are read back as encoded.

**Real-Figma behaviour of components (plan 3b, 2026-11-26).** Found on the first real sends and handled (each with a fake-Figma or unit test):
- An SVG `<g>` comes back as a GROUP without fills or strokes: the icon recolour walks the vectors only.
- A component set formed before its last variant is placed has "existing errors", and `setProperties` on its instances throws: the set forms after placement.
- A COMPONENT root is auto layout too: state overlays and badges go ABSOLUTE in it (`isAL` patch), or they push the variant's size.
- A text bound to a TEXT property shows the set's single default in every variant: `check` lists it in `propertyTexts`, and HUG sizes around it (and a state overlay stretched to such a parent) are not compared.
- Figma rounds text widths: HUG frames take the 1 px text tolerance.
- The recolour's scratch SVG is removed even when the recolour throws (otherwise it stays on the page at 0,0).

The mutation `baseline` in `report.json` is the raw report before the allowlist; a mutation counts only failures not in it, so the allowlist does not hide one. The numbers of a project's run belong in that project's own docs, not here.

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
node core/figma.mjs plan   --ds <ds output> --out <dir> [--page Screens] [--max-calls 40] [--force <screen>]... [--redo] [--no-components] [--cmp-page Components]
node core/figma.mjs ingest --out <dir> --result <file> [--batch vars-NN | batch-NN | N]
node core/figma.mjs shots --out <dir>    # then ingest-shots --out <dir> --result <file>, shots-clean --out <dir>
node core/figma.mjs serve  --out <dir> [--file <Figma file name> [--renamed]] [--send <keys>|run|pending]... [--shots] [--port 8787] [--wait <s>]   # Figma bridge, below
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
  - Crops at width A on `shot-<screen>.png`. The screenshot's scale is its width / W_A; it is rescaled to the proxy's device scale 2. Request it at 2x: a 1x image loses too much detail for the crops. No screenshot → `crop` skipped, the screen fails. `state.shots.roots` records the frame each shot is of (`serve --shots`, `ingest-shots`); a shot whose screen has another root since (built again) is not used: check prints "screenshot of an earlier build" and the screen fails until new shots are taken. Shots recorded without roots are used as before.
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
  - `--mutate`: the readback mutations of `mutate.mjs`, each verified again on the same screenshot: `figMove` (box +3 px), `figText` (one character), `figFill` (fill colour), `figDrop` (node removed), and with `D.rd` `figCase` (a text reads back UPPER) and `figDash` (a dashed stroke reads back solid; for a stroke drawn by an overlay, the overlay's entry). `figIconPx` is a pixel fault: the first icon leaf is drawn as another icon of the screen in a proxy of the target spec, and that crop against the screenshot replaces the real one. `figHide` is one too: the plain frame leaf with the largest background contrast against what is behind it (at least 40 on a channel, the crop peak gate) is drawn transparent, as if covered or clipped in Figma while its data reads back right. A missed one fails the run; one without a candidate is skipped.

Exit codes: 0 every screen passes the gate (and no mutation was missed), 1 otherwise, 2 usage, setup or malformed input.

R77 (iii), real Figma only: a norm record explains a crop only when the norm proxy's crop against the Figma screenshot also passes (`cropsRefVsFigma`, measured for the failing crops; icon thresholds on an icon leaf; no measurement explains nothing). Before it, a wrong icon in a norm-resized icon slot was excused by the resize record (t8 s3 `n.0.13.0`, SRC_SQUASH 26 -> 34: source crop 0.47 explained, norm proxy vs shot 0 / 0, a swapped icon 0.83 explained as well).

R81, real Figma only: Figma measures a single-line HUG text -2 .. +1 px from the norm proxy (259 Planora texts: 234 equal, 13 at +1, 11 at -1, 1 at -2). A norm root whose axes are such a text's width, or agree with what its children / parent measured (a HUG chip following its text, the next sibling pushed), with such a text in its subtree or before it, is `explainedBy: 'figmaText'` (t8 s17 -2 px, s4 chip -1 px). 3 px (figMove) stays a root.

R82, real Figma only: a plain frame leaf (`figPlainFrame`: background, radius, border, position, clip only; all read back as data) fails its crop above ratio 0.25, or on ratio > 0.05 and peak >= 40 together. Measured on t8 (118 such crops): noise max ratio 0.172 (2.5 px progress markers at a fractional x, anti-aliasing only), max peak 51 (ratio 0.041); a hidden frame min 0.305 / 32. A pale frame vanishing (0.035 / 11) is under what a crop sees; its fill is data-checked.

Figma text slack (`figma-model.mjs` FIGMA_TEXT_SLACK = 1): a text's natural width in a raised `max` is figmaTextBox + 1 px, since Figma measured texts up to 1 px wider and a text at a max of exactly figmaTextBox wrapped at width B (t8 s3, s8). Acceptance (a) and (b) unchanged with it.

R83, real Figma only (`report.figmaReal`): an unexplained norm root is Figma drawing other than the norm proxy predicts, so an approved allowlist entry may cover it; a record-check root (`recordCheck`, a record whose `to` is wrong) and a norm-layout root (R78, `on: 'normLayout'`: the local norm layout proxy, not Figma) never, and on ds / layout checks R66 stands.

Text width probe (2026-11-24, temporary text nodes created and removed through the bridge): Figma's own width of the 7 Planora texts with a raised `max` is at most that `max` (485 / 487, 287 / 288, 197 / 198, 268 / 268, 268 / 269, 365 / 365, 232 / 233), so FIGMA_TEXT_SLACK = 1 is enough there. t8 s11 `n.0.9.5.0` is not a `max` case: at width B its column is 364 px, Chrome fits the text in 363.63 px and Figma needs 365, so it wraps; the user approved it (Planora `docs/design/vd-allowlist.json`).

Real-Figma run (2026-11-24, Planora 18 screens, bridge, file "Planora Design"): `serve --send pending --shots` 23/23 jobs, 25.8 s in Figma, 167.5 KB sent, 2384 KB back, 0 model tokens (vars: 43 text styles incl. the variant `type/t14-600/strike`, 396 variables, all unchanged on the resend). `check --mutate` (189 s): 13/18 pass, data findings 0 on every screen (decoration, case and dash included). Open: s8 and s11 a text wrapping at width B (+15 px height; s8 4 crops, s11 2), s3 `n.0.13.1.t` at B (17 px), s4 `n.0.11.11.2` (1 px), s17 `n.0.7.5.0` (2 px). Mutations: 104 caught, 0 missed, 22 skipped (no candidate): figMove, figText, figFill, figDrop, figCase 18 each; figDash 6 (12 screens without a dashed stroke); figIconPx 8 (10 without two icon identities).
Rerun and edit guard on real Figma (2026-11-24, copy of t8, `plan --redo`, screens s15-s17 only): resend of `vars-01` + `runtime` + the s15-s17 batch: collections 2, variables 396, text styles 43, effect styles 1 all unchanged (0 created, 0 updated); the three frames rebuilt in place, `extra` empty (no duplicate frame), 4.2 s. The user then changed one text in s16 by hand; resending the same batch: `built s15, s17; edited by hand, kept (skippedEdited): s16` (s16 kept its frame id and the hand edit, `extra` empty), 3 s. `plan --force s16` then sent a one-screen batch that rebuilt s16 (1.1 s). 0 model tokens in all three sends.

After the text slack, R81 and R82 (same day, t8 resent with `ds.mjs` rerun): 16/18 pass; s4 keeps the plan-2 chip row approval (2.28 px); s11 still wraps one long text (about 364 px) at B: Figma's width there exceeds figmaTextBox + 1. Mutations: 117 caught, 0 missed, 27 skipped (figHide 13 caught). With the user-approved allowlist (s4 chip row approval, s11 width-B wrap: 1 root and 4 approvals): **18/18 pass**, mutations unchanged (231 s). Acceptance (b) with the s4 entry in `test/corpus.json`: 25/25 pass, 0 roots, 0 approvals, 0 crops.

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
   A screen with no readback (not sent yet, or failed) fails at once and is not checked (`notBuilt` in `report.json`), so checking one batch costs only its screens.
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
- The bridge refuses (403) any request whose `Origin` header is not `null` (the plugin UI iframe): a web page open in the browser cannot read a job or post a result. A `next()` failure (e.g. an unreadable batch file) ends the run; a job the plugin does not ask for within 300 s (the job timeout; e.g. the plugin was closed between two jobs) ends it too.
- **Target file.** A job goes only to a plugin window open in the Figma file named `--file` (the plugin sends `figma.root.name` and a window id with each poll). Before, a batch went to whichever window polled first, so a plugin left open in a second file could receive it.
  - A window in another file gets no job and shows why; the run logs it once.
  - Two windows in files of the target name (for example two new files both named "Untitled") are ambiguous: no job is sent before the first one goes out (the first job waits 3.5 s after the first matching poll, so a second window can show up), and a second window seen during the run stops it. Give the file a unique name.
  - The plugin also refuses a job addressed to another file.
  - `--file` is required the first time a plan is sent. The first run that reaches the plugin records the name in `state.json` (`figmaFile`); `plan` keeps it. Later runs use it and refuse another name, since the plan's state describes that file: use a new `--out` for another file, or `--renamed` when the same file was renamed.
  - A plugin window opened before this change sends no file name and gets no job: close it and run the plugin again.
- `--shots` then exports every built screen frame (`state.json` `done` with a `root`) as PNG at scale 2 with its own bounds (`exportAsync`, `useAbsoluteBounds`) to `shot-<screen>.png`. No clone page, no `get_screenshot`.
- The first failed job (a Figma error, a result `ingest` refuses, a batch `failed`) stops the queue; later jobs are not served. A job served and not answered is served again (the plugin was reloaded).
- Each run appends a line to `runs.jsonl`: ok, seconds, KB sent and back, and per job its key, ms and bytes.
- Exit 0 every job ok, 1 a job failed, 2 usage or no plugin connected within `--wait` seconds (default 300).

Setup, once per machine (R100): `serve` copies `figma-plugin/` to `~/.vuong-design/figma-plugin/` (or `VD_FIGMA_PLUGIN_DIR`), because Figma remembers a development plugin by its manifest path and the installed plugin folder is named after its version. serve prints the path of that manifest alone on a line: Figma Desktop → Plugins → Development → Import plugin from manifest…, paste it. On an update serve rewrites the files there (Figma reads them each time the plugin runs) and says so; a changed manifest asks for a new import. The copy's `ui.html` carries its version and the window sends it with every request: the bridge gives no job to a window running other plugin code (it says to close and run the plugin again); a window run from a checkout (`__VDV__`) is accepted. Then, in the target file: Plugins → Development → vuong-design bridge. Leave the plugin window open: it polls the bridge, waits between runs and picks up the next `serve` by itself. The manifest only allows `localhost:8787` (`devAllowedDomains`: Figma refuses an IP there), and the bridge listens on the loopback addresses only.

AI workflow with the bridge:
1. `ds.mjs`, then `figma.mjs plan`. Tell the user which batches and screens will be written and wait for a go-ahead.
2. Ask the user to open the plugin in the target file, then run `figma.mjs serve --out <dir> --file <its name> --send <the agreed batches> [--shots]`. It prints one line per job and a summary.
3. `figma.mjs check --out <dir> [--mutate]`.
