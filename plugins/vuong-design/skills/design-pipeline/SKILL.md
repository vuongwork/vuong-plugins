---
name: design-pipeline
description: Use when the user wants to take a static HTML page (or a vuong-design project) through the vuong-design pipeline - design system, normalisation questions, approvals, components, Figma - or asks what to run next, how to continue, or why a step fails. Drives the steps with core/next.mjs and a vd-project.json; never edits rules or allowlist files by hand. For writing the HTML from a spec, use spec-to-html first.
---

# design-pipeline: HTML -> design system -> Figma, one step at a time

`PLUGIN=${CLAUDE_PLUGIN_ROOT}`. Scripts make every decision about state; your job is to run them, tell the user plainly
what each result means, and hand over the choices that are theirs. Do not read `report.json`, `questions.json`,
`lint.json` or batch files into context: read the scripts' stdout, and open a file only for the one item you need.

## 1. Project file

Find `vd-project.json` in the project (it is usually next to `vd-rules.json`). If there is none, create it with the user:
- `html`: the source page. If the user has only a spec, use the `spec-to-html` skill first.
- `out`: the ds output folder, e.g. `build/vd-ds`.
- `rules` and `allowlist` (e.g. `vd-rules.json`, `vd-allowlist.json`), even before those files exist.
- `root` and `widen`: only when the page does not follow the input profile (no `[data-vd-screen]`). Ask the user which
  element is one screen, or find it in the HTML.
- `figma`: `{ "out": "build/vd-figma", "file": "<Figma file name>" }`, once the user wants Figma.

All keys are listed in `PLUGIN/README.md` under "Project file". Paths are relative to the project file.

## 2. The loop

Run `node PLUGIN/core/next.mjs --project <vd-project.json>`. It lists the steps done (`[x]`) and prints the next one
with its command. Run that command, then run next.mjs again. Stop when it prints `all done`, and say where the user stands
after each step in one or two sentences.

What each step needs from you:

- **ds** (`ds.mjs --project`): about 10 s per screen. Run it in the background when there are many screens. Steps that
  open a browser need Playwright: `VD_PLAYWRIGHT_FROM` names a folder with `node_modules/playwright`, unless the
  project has its own. If the lint gate stops the run, fix the HTML (the errors are in its stdout).
- **questions** (`answer.mjs --project`): the user answers in the browser and presses Submit. Start it in the
  background, tell the user the URL it prints, and wait for them to say they are done. Then stop the server and run ds again.
- **approve** (`approve.mjs --project`): the same, for findings the user judges fine. Explain the page in one line:
  - tick what is fine, then Submit;
  - "show only items left to approve" hides the rest;
  - "Tick every mismatch caused by the rules" covers the expected ones.

  Never approve on the user's behalf and never write the allowlist yourself.
- **Nothing to approve** (next.mjs prints no command): a layout error the plugin cannot explain is a plugin bug, so
  report it with the screen and node. A data finding or an unchecked node means the HTML must change. Read
  `report.html` for that one screen only.
- **components** (`cmp.mjs --project`): no browser, quick.
- **figma-plan**: run it, and give the user the estimate it prints (calls, KB).
- **figma-send / figma-shots**: these write to the user's Figma file.
  - Before the first send, confirm the file and which batches: the user names them; never widen a test into a full run.
  - With Figma Desktop, use the bridge:
    - Once, import `PLUGIN/figma-plugin/manifest.json` (Plugins > Development > Import plugin from manifest).
    - Then open the file and run "vuong-design bridge", leaving it open.
    - Then run the `serve` command next.mjs prints.
  - Without Desktop, use the `vd-figma-courier` agent for the `.js` files and `figma.mjs ingest` for each result. It
    costs model tokens, so say so first. See "Figma bridge" and "Figma CLI" in the README.
- **figma-check**: needs Playwright, like ds.
- **figma-approve** (`approve.mjs --project --figma`): the user approves what Figma draws differently, then check
  runs again.

## Rules

- One step at a time. After answering or approving, the next step is to run ds again; next.mjs says so from the file
  times.
- Flags on the command line override the project file. Fix the project file rather than repeating flags.
- When a step fails with exit 2 (usage or setup), show the error line and fix the cause (path, Playwright, selector).
  Do not retry blindly.
