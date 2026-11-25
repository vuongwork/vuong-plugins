# Templates

## starter.html

A page that follows the `vd-html v1` profile (see `../PROFILE.md`): the proof that the profile is enough. It lints with
0 errors and 0 warnings (every token group is 100 % `var()`), and `layout.mjs` passes all its screens.

Use it:

1. Copy `starter.html` next to the new design. Keep the structure: one `.frame[data-vd-widen]` per screen, one
   `[data-vd-screen="<id>"]` inside it (id from the spec's screen code).
2. If the project already has a `tokens.css`, replace the `:root` block with it and keep using `var(--...)` only; otherwise
   decide the tokens first and edit the block.
3. Delete the sample screens (S1 to S5), keep the sprite and add the icons you need as `<symbol>` + `<use href="#id">`.
4. Check: `node core/lint.mjs --html <file>`, then `node core/layout.mjs --html <file> --out <dir>` (no `--root` needed).

Components (each is marked with a `<!-- vd:component name -->` comment, in the CSS and in a screen, for a generator to copy):

| Name | Notes |
|---|---|
| `status-bar` | fixed height row, time and battery |
| `app-bar` | title `flex: 1; min-width: 0`, trailing icon |
| `list-row` | icon + text block `flex: 1; min-width: 0` + trailing text, rows inside a `.list` card |
| `chip-row` | wrapping row; keep it to the same line breaks at every width (see PROFILE.md, Layout) |
| `card` | surface with radius and shadow tokens |
| `primary-button` | `align-self: stretch`, fixed height |
| `bottom-nav` | `position: absolute` to the bottom, items `flex: 1` |
| `fab` | `position: absolute` overlay |
| `bottom-sheet` | its own screen (S3): scrim + sheet, both absolute |
| `progress-bar` | track `position: relative`, fill absolute `left: 0` with a % width (W12); never a % left offset |
| `hero-text` | wrapped centred text: column `align-items: stretch` + `text-align: center` (W19) |
| `meta-row` | icon next to text as a flex row, never inside a line of text (W18) |
| `stat-row` | equal columns `flex: 1 1 0` with 1 px divider elements (W16) |
| `segmented` | equal segments `flex: 1 1 0` |
| `switch-row` | label `flex: 1` + a flex switch whose knob is placed by `justify-content` |
| `text-field` | label above a 48 px box; states change colour, not border width |
| `dropdown-menu` | overlay that spills out of its field: last child of the screen, px offsets (W13) |
| `dialog` | fixed width 312 px (never `max-width`, W17), centred by a full-screen overlay, actions end-aligned |

## Measured

`layout.mjs --html templates/starter.html` (no `--root`): 5 of 5 screens pass, lint 0 errors 0 warnings.

- S1-S3: chips are kept to one line (a wrap that breaks differently at the two widths is not reproduced by the Figma
  model; a long row of hugging chips also drifts by a couple of px).
- S4-S5 (added after five spec-to-html runs): every component there is a pattern that passed layout in those runs.
  The dialog actions are end-aligned: a lone left button with `space-between` drifted 2.04 px in the Figma model
  (pipeline follow-up in plan 5).
