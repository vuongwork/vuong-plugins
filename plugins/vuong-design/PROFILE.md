# vd-html v1: input HTML profile

The profile is the contract between the HTML a generator (or a person) writes and the vuong-design pipeline
(`layout`, `ds`). Every rule below can be checked by a machine: `node core/lint.mjs --html <file>` reports violations
by code in a few seconds, with no model involved. Changing the meaning of a code means a new profile version.

Errors (`E`) are reserved for what makes the pipeline produce a wrong result or not run at all. Everything that only
lowers accuracy is a warning (`W`).

## Structure

- Every screen is an element with `data-vd-screen="<id>"` (unique, for example `A1`). The display name goes in
  `data-vd-name` (optional).
- The element widened to test stretching is marked `data-vd-widen`, on the screen or one of its ancestors. Without it
  the screen itself is widened. With this structure `--root` / `--widen` are not needed.
- Each state (tab, modal, sheet, step) is a screen of its own.

## Self-contained and static

- One file, opened directly with `file://`. No runnable `<script>` (`type="application/json"` and
  `type="text/template"` are fine). No `iframe`, `srcdoc`, `canvas`, `video`, `object`, `embed`.

## Resources

- Images are `data:` URIs. Stylesheets live in the same file; only a Google Fonts stylesheet may be linked.
- Fonts must be ones Figma has (`core/font-map.mjs`). System fonts are replaced by Inter.

## Tokens

- Declared on `:root` with the prefixes `--color-*`, `--space-*`, `--radius-*`, `--font-*`, `--size-*`, `--shadow-*`.
- Elements use `var(--...)`; no hard-coded color, spacing, radius or font size. No `var()` nested in a function or with a
  fallback (capture cannot bind a token to it: `varsComplex`).

## Layout

- Flex. A stretching element uses `flex: 1` / `align-self: stretch` / `width: 100%`; a hugging element stays natural.
  Do not rely on flex-shrink: give a text block `min-width: 0; flex: 1` instead of letting it shrink.
- A wrapping row (`flex-wrap`) must break at the same items at the checked widths (A and A + 120 px); a row that gains or loses a line when widened is not reproduced by the Figma model. Keep chip rows to one line, or few enough chips. Checked by W11.
- Size containers by padding on the token scale, not by a fixed `height` with centred content: the pipeline turns
  `height` + centring into derived paddings (a 56 px bar around a 36 px avatar becomes 10 px), which land off the 4 px
  grid and become normalisation questions. Keep a fixed height only where the height itself is the design (app bar,
  bottom nav, button, input), and then pick a content size that leaves an on-grid remainder (56 - 32 = 2 x 12).
- No `%` width or height on an in-flow element other than `100%`: Figma auto layout has no % sizes, so it keeps the px
  size when widened. A proportional part (progress fill, chart bar) is `position: absolute` with % insets/size inside a
  `position: relative` parent (it becomes a scale constraint). Checked by W12.
- Figma has no `z-index`: a later layer always draws on top. An overlay that spills out of its parent (dropdown menu,
  popover, tooltip, snackbar) goes after the content it covers, normally as the last child of the screen with explicit
  offsets; nesting it inside the field it belongs to puts it under the following rows in Figma. Checked by W13.
- Truncated text (a spec asks for "…"): write the shortened text with the ellipsis in the content, short enough to fit
  on one line at width A ("Nguyễn Hoàng Phương…"). No `text-overflow`, no `white-space: nowrap` + clipping. The text
  stays as written when widened, which Figma reproduces.
- Proportions: Figma fills share the free space equally (grow is 0 or 1), so `flex: 2` / `flex: 1` splits and
  segments sized by `flex-grow` are not reproduced. Use fixed px widths, or absolute % parts in a relative track (W12).
  Checked by W16.
- No `max-width` on an element that fills: when widened it stops at the cap in CSS but keeps filling in Figma. Give it a
  fixed width (a dialog 312 px wide), or let it fill. Checked by W17. Use `box-sizing: border-box` with `width: 100%`.
- No icon inside a line of text (Figma text cannot hold one): make a flex row of text, icon, text, or drop the icon.
  Checked by W18. Also avoid `text-align: justify` and `<sub>`/`<sup>` (write O₃ with the Unicode subscript), both W5.
- Wrapped text fills its column: a paragraph in a column flex with `align-items: center` hugs its content and widens
  with the screen in CSS, while Figma keeps the width of a wrapped text box. Stretch it (`align-self: stretch`) and
  centre with `text-align: center`. Checked by W19.
- No `space-evenly` / `space-around`, not even imitated with empty `flex: 1` spacers (dropped: nothing to draw). Use
  `justify-content: space-between`; one empty spacer between two groups is fine. Checked by W20.
- Proportional parts: anchor them at an edge (`left: 0; width: NN%`, proven). A % offset from the edge (`left: 20%`,
  a range bar, a marker) is not modelled reliably by the pipeline yet (plan 5 follow-up); no lint code until the cause
  is known.
- No height tied to width: `aspect-ratio` or vertical padding in % on a stretching element keeps its ratio in CSS but
  not in Figma auto layout, and everything below it moves. Give a stretching image a fixed height (or a fixed width, if
  the ratio matters more than stretching). Checked by W14.
- Content fits its screen: a long article or list cut by the bottom of the screen shows a different part when widened
  (text re-wraps), which the Figma model cannot follow. Shorten it so the last item ends inside the frame. Checked by W15.
- `position: absolute` only for overlays (FAB, badge, bottom bar), not as the main layout. No grid, float or table for
  screen layout.

## Not in Figma (avoid)

- outline, filter, backdrop-filter, mix/background-blend-mode, mask, border-image, text-shadow,
  text-overflow / line-clamp, borders that differ in color or style per side, text decoration other than
  underline / line-through, transform (unless only rotating an icon), `vw` / `vh` units inside a screen.

## Icons

- Inline SVG, or `<symbol>` + `<use href="#id">` in the same file. No icon font, no PNG/JPG icons.

## Rule codes

The list of properties for W5 mirrors `unsupported()` in `core/capture.mjs` (R46); keep the two in sync.

| Code | Level | Rule |
|---|---|---|
| E1 | error | no screen found for the selector |
| E2 | error | duplicate or empty screen id (only with `data-vd-screen`) |
| E3 | error | runnable `<script>` |
| E4 | error | image that is not `data:` (img src, srcset, background-image url, svg `<image>`, `<use>` to another file) |
| E5 | error | stylesheet whose `cssRules` cannot be read (cross-origin), except Google Fonts |
| E6 | error | font that is neither in Figma nor a system or browser-default font (Figma substitutes Inter) |
| E7 | error | `<use>` pointing at an id that does not exist |
| E8 | error | `iframe`, `canvas`, `video`, `object`, `embed` inside a screen |
| W1 | warn | grid / float / table layout inside a screen |
| W2 | warn | screen does not stretch when widened, or stretches while no child does |
| W3 | warn | flex item shrinks (flex-shrink) at width A or B |
| W4 | warn | border that differs in color or style per side |
| W5 | warn | property Figma does not have (R46 list + outline, filter, transform, other text decoration) |
| W6 | warn | icon font, or raster image <= 48 px (an icon that does not become a vector) |
| W7 | warn | share of color / spacing / radius / font-size declarations that use `var()` below 80 % (per group) |
| W8 | warn | system font (Figma substitutes Inter) |
| W9 | warn | more than 25 % of the elements of a screen are absolute/fixed, or `vw` / `vh` used inside a screen |
| W10 | warn | `var()` nested in a function or with a fallback |
| W11 | warn | wrapping flex row (or column) whose line breaks change between width A and A + 120 px |
| W12 | warn | `%` width or height (other than 100 %) on an in-flow element |
| W13 | warn | absolute/fixed element that escapes its parent and is overlapped by later in-flow content (Figma draws it underneath) |
| W14 | warn | `aspect-ratio` (or vertical padding in %) on an element that stretches when widened |
| W15 | warn | content cut by the bottom of a clipping box, where what is visible changes when widened |
| W16 | warn | `flex-grow` other than 0 or 1 (Figma fills share space equally) |
| W17 | warn | `max-width` that caps a filling element when widened (the Figma model keeps filling) |
| W18 | warn | icon or image inside running text |
| W19 | warn | wrapped text centred (or start/end-aligned) across a column flex, so it hugs and widens with the screen |
| W20 | warn | two or more empty growing spacers in one flex container (space-evenly imitation) |

## Checking

```
node core/lint.mjs --html <file> [--root <sel>] [--widen <sel>] [--out <dir>] [--strict] [--log <runs.jsonl>] [--json]
```

stdout is at most 15 lines (summary, the 10 worst findings, a pointer to `lint.json`). Exit code: 0 no errors,
1 errors (or warnings with `--strict`), 2 usage or setup error. `layout.mjs` / `ds.mjs` run the same check first and stop
on errors unless `--no-lint` is passed.

## Measured

`lint.mjs` on the acceptance corpus (root/widen from `test/corpus.json`; wall time includes starting Chromium; finding
groups per code, merged by code + screen + message):

| File | Screens | Time | E | W |
|---|---|---|---|---|
| planora-ui-screens.html | 18 | 1.5-1.8 s | 0 | 26: W1 x11, W3 x7, W7 x4, W11 x4 |
| 2026-11-05-ui-redesign-entry-mockup.html | 2 | 1.0 s | 0 | 8: W1 x2, W6 x2, W7 x4 |
| calendar-layout.html | 2 | 0.9 s | 0 | 5: W8 x2 (Times New Roman, the browser default), W7 x3 |
| calendar-layout-v2.html | 2 | 0.6 s | 0 | 8: W1 x2, W7 x4, W8 x2 |
| calendar-layout-v3.html | 1 | 0.6 s | 0 | 6: W1 x1, W7 x4, W8 x1 |
| templates/starter.html | 3 | 1.2 s | 0 | 0 |

Planora: no errors; W3 fires on the `.say` rows (the avatar svg and the bubble shrink; s3 and s4 by capture ids), W7 shows
the token gap (color 73 % on `var()`, spacing, radius and font-size 0 %). W11 fires on s2, s4, s9, s11 (rows that re-wrap when widened); s4's is the chip row behind its
2.28 px drift, the other three still pass layout, so W11 is a risk, not a certain failure. `layout.mjs --html templates/starter.html`
(no `--root`): 3 of 3 screens pass.
