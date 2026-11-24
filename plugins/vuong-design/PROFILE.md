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
- A wrapping row (`flex-wrap`) must break at the same items at the checked widths (A and A + 120 px); a row that gains or loses a line when widened is not reproduced by the Figma model. Keep chip rows to one line, or few enough chips.
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
| E6 | error | font that is neither in Figma nor a system font (Figma substitutes Inter) |
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

## Checking

```
node core/lint.mjs --html <file> [--root <sel>] [--widen <sel>] [--out <dir>] [--strict] [--log <runs.jsonl>] [--json]
```

stdout is at most 15 lines (summary, the 10 worst findings, a pointer to `lint.json`). Exit code: 0 no errors,
1 errors (or warnings with `--strict`), 2 usage or setup error. `layout.mjs` / `ds.mjs` run the same check first and stop
on errors unless `--no-lint` is passed.
