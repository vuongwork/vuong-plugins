---
name: spec-to-html
description: Use when a UI spec (screens, states, components) must become one static HTML file for the vuong-design pipeline (layout, ds, Figma). Writes HTML that follows the vd-html v1 profile, checks it with core/lint.mjs (at most 3 rounds, no model in the check), then runs layout.mjs. Not for turning existing outside HTML into the profile (that is a later normalize step).
---

# spec-to-html: spec -> one vd-html v1 file

Input: the spec path, and optionally the project's `tokens.css`. Output: one HTML file that follows `PLUGIN/PROFILE.md`.
`PLUGIN=${CLAUDE_PLUGIN_ROOT}`. Pass paths between steps, never HTML bodies.

## Model

Deciding tokens and the layout of each screen takes design judgement. Writing the HTML of a clear spec can be done by
Sonnet, because lint checks the result mechanically. Do not read `lint.json` into context; read only lint's stdout.

## Steps

1. Tokens.
   - `tokens.css` given: use it as is, in the `:root` block. Do not invent tokens.
   - None: decide the tokens first, as a short table (color roles, space scale 4/8/12/16/20/24/32, radii, font sizes with
     integer line-heights, shadows), then write them as `--color-*`, `--space-*`, `--radius-*`, `--font-*`, `--size-*`,
     `--shadow-*`.
2. Copy `PLUGIN/templates/starter.html` to the target path. Keep its structure (one `.frame[data-vd-widen]` per screen,
   a `[data-vd-screen]` inside) and reuse its components (`<!-- vd:component name -->`) instead of re-inventing them.
3. Write the screens, one per state (tab, modal, sheet, step), with `data-vd-screen` ids taken from the spec's screen
   codes. Remove the sample screens. Hard rules, all from PROFILE.md:
   - every color, space, radius and font size is `var(--...)`; no `var()` inside a function or with a fallback
   - flex only; stretching items use `flex: 1` / `align-self: stretch` / `width: 100%`; text blocks next to icons get
     `min-width: 0; flex: 1`; do not rely on flex-shrink; absolute only for overlays (FAB, badge, bottom bar)
   - images as `data:` URIs, icons as inline SVG or `<symbol>` + `<use href="#id">`, only Figma fonts
   - none of: outline, filter, backdrop-filter, blend modes, mask, text-shadow, line-clamp, per-side border colors,
     transform (except rotating an icon), `vw`/`vh`, scripts, iframes
   - a wrapping row must break at the same items at width A and A + 120 px
   - size containers with token padding, not a fixed `height` + centring; where a fixed height is the design (app bar,
     nav, button, input), make `(height - content) / 2` a multiple of 4
   - an overlay that spills out of its parent (dropdown, popover, snackbar) is the last child of the screen with
     explicit offsets, never nested in the field it belongs to (Figma has no z-index)
   - truncation ("…"): write the shortened text with "…" so it fits one line at width A; never text-overflow, nowrap
     or line-clamp; never silently wrap instead
   - no `flex-grow` other than 1 (proportions = fixed px or absolute %), no `max-width` on a filling element (fixed
     width instead), `box-sizing: border-box` with `width: 100%`
   - no icon inside a line of text, no `text-align: justify`, no `<sub>`/`<sup>` (Unicode ₀₁₂₃ instead)
   - wrapped text in a column flex is stretched (`align-self: stretch`) and centred with `text-align`, never hugging
   - no space-evenly/around and no rows of empty `flex: 1` spacers: use `space-between`
   - proportional bars/markers: `left: 0; width: NN%` only; tell the user when the spec needs a % offset (range bar,
     marker), it is a known pipeline gap
   - no `aspect-ratio` or %-padding on a stretching element: give images a fixed px height
   - content must end inside the screen (trim long text/lists); nothing cut by the screen bottom
   - no `%` width/height except 100% on in-flow elements; a progress fill or chart bar is `position:absolute; left:0;
     top:0; bottom:0; width:NN%` inside a `position:relative` track
4. Lint loop (at most 3 rounds):
   `node PLUGIN/core/lint.mjs --html <file> --out <dir> --log <runs.jsonl>`
   Fix exactly the findings it prints (stdout is at most 15 lines; the code table is in PROFILE.md) and run it again.
   If errors remain after 3 rounds, stop and tell the user which codes are left. Do not weaken a rule, add
   `--no-lint`, or edit lint to get past it. Warnings are fixed if cheap, otherwise reported.
5. When lint reports 0 errors: `node PLUGIN/core/layout.mjs --html <file> --out <dir>` (no `--root`; the lint gate runs
   again). Report the pass count; a failing screen goes back to the user with the report path.

## Done

The file lints with 0 errors (warnings listed), layout ran, and the answer names the HTML path, the lint line, and the
layout line. Nothing else is pasted into the conversation.
