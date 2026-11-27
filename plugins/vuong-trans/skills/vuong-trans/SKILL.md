---
name: vuong-trans
description: Translate PowerPoint (.pptx), Excel (.xlsx) and PDF documents between Japanese, Vietnamese and English in ANY direction (JA→VI/EN, VI→JA/EN, EN→JA/VI) while keeping the original layout — slide text, table cells, shapes, comments, formula results, sheet names, AND text baked inside images (OCR + overlay / chart redraw). Uses deduplicated phrase-level translation by parallel subagents and deterministic scripts for extraction/write-back, so it is cheap on tokens. Use this skill whenever the user wants to translate/dịch/convert a pptx/xlsx/slide deck/RFP/要件定義書/見積書/báo giá/spec into another of these languages ("dịch file ppt sang tiếng Việt", "dịch excel sang en", "convert file này sang tiếng Nhật", "dịch báo giá sang JP", "bản tiếng Nhật/tiếng Việt/tiếng Anh của file này", "dịch file pdf", "translate this deck", "OCR ảnh rồi dịch đè lên"), even if they don't name the skill.
---

# vuong-trans — PPTX/XLSX/PDF translation between Japanese / Vietnamese / English

```
source file
 ├─ A. text:  extract.py --project (dedupe + translation memory + chunks) → N translator subagents → apply_pptx.py / apply_xlsx.py → tm.py save
 └─ B. images (pptx): extract_images.py (dedupe) → ocr.py (→ todo.json) → overlay subagents (todo only) → overlay.py → apply_pptx.py --images
 PDF → references/pdf.md          then: C. verify → report (runlog.py)
```

Scripts do everything mechanical at no token cost; the model only translates and places overlay regions, split across
subagents so the main session never holds slide contents or full images (only one thumbnail sheet of the images OCR left out). Strings are deduplicated (100 slides ≈ 1,400 unique
strings) and strings translated before in the same project come from the translation memory (next version of a deck:
84–89 % of characters re-used on a sample deck).

`$SK` = this skill's folder. Work files in `$W=<scratchpad>/vtrans/<docname>` — never in the user's folder. Outputs go next
to the source in `VN/`, `EN/` or `JP/` with that suffix (`<name>_VN.pptx`); `<SUF>` below = `VN|EN|JP`.
`python3` = system Python 3 (Windows: `python` / `py -3`). Fonts come from the OS font folders (Noto Sans / DejaVu / Noto Sans
CJK JP, fallbacks Segoe UI / Arial / Yu Gothic / Meiryo / Hiragino); on "no font found" tell the user which font to install
or to set `VTRANS_FONT_DIR`.

## 0. Decide
- **Project**: `python3 $SK/scripts/tm.py project <file>` prints the default name (nearest parent folder that is not a date /
  VN / EN / input… folder); same name for every file of one customer; tell the user. Data: `$VTRANS_DATA` (default
  `~/.vuong-trans/projects/<project>/`: `tm/<target>.json`, `glossary_<target>.md`, `keep.txt`, `runs/`) — writing there may
  need the user's approval outside a sandbox.
- **Target** `vi` | `en` | `ja`; the source may be any of them or mixed. Always pass `--target` (without it the scripts fall back
  to Japanese-only mode and silently skip vi/en source text). pptx → A+B; xlsx → A, then view every image listed from
  `xl/media/`; pdf → `references/pdf.md` (ask first whether the original pptx/xlsx exists — it keeps the layout editable).
- Several files → one pass: extract all, translate all unique strings together (one map keeps terminology consistent).
- **Glossary** before spawning translators: copy `references/glossary-logistics.md` for warehouse/HT/estimation, else write
  20–40 key terms after skimming the strings. Consistent terms across agents are the main quality lever.
- **Proper nouns (mandatory)**: translators see strings without slide context, so `ABC金属` becomes "ABC Kim loại". Run
  `python3 $SK/scripts/find_entities.py $W/src.json > $W/entities.txt` and resolve every candidate into a `## Proper nouns`
  table in `$W/glossary.md`: `| 原文 | Dùng trong VI/EN | Loại | Nguồn |` — company → official romanized name, people →
  romanized, site → "Nhà máy <địa danh>" / "<Place> Plant", product/model → as is. Unsure → original + romanization +
  `[chưa xác minh]` (never translate a name's meaning); show those rows to the user. Put them in `$W/keep.txt` (one per line).
- **Document context (2–3 lines)** for every brief: what the document is, who sends it to whom, the end-user (from the
  title/cover). It fixes `Aへのご提案` → "Đề xuất … cho A", not "Đề xuất … A".

## A. Text track
1. Extract:
   ```bash
   python3 $SK/scripts/extract.py <file1> [file2 ...] --out $W --target <lang> --keep $W/keep.txt --chunk 350 --project <P> [--loc]
   ```
   - Writes `$W/src.json` (all unique strings) and `$W/chunk_k.json` (only what the model must translate). Keys are exact
     paragraph / shared-string texts — don't edit them.
   - Extracts every string not yet in the target language (incl. English headings in a JA deck); acronyms, codes, e-mails,
     URLs, file names, numbers and keep.txt terms are kept. Master/layout text only in the deck's main language (the
     company template — addresses, copyright — stays as is).
   - `--project`: TM hits → `$W/<lang>_chunk_0_tm.json` (applied with the other maps). Short (≤ 4 chars) or context-dependent
     strings (> 1 meaning stored) still go to translators with earlier translations in `$W/tm_hints.json` — name it in the
     brief. The project's saved glossary/keep.txt are copied into `$W` if missing: review instead of rebuilding. 0 chunks →
     skip step 2.
   - `--loc` (xlsx): `$W/loc.json` = sheet + cell / shape anchor of every string and image.
2. Spawn one subagent per chunk **in the same turn**, brief = `references/brief-text.md` with paths filled in. `effort: "lower"`
   only for EN (word-by-word is the classic JA→VI failure). Each writes `$W/<lang>_chunk_k.json` = `{source: translation}`.
   After each one returns, record its usage line: `python3 $SK/scripts/runlog.py agent $W --step text --name chunk_k --tokens <total_tokens> --ms <duration_ms>`.
3. Write back:
   ```bash
   python3 $SK/scripts/apply_pptx.py <src.pptx> --maps "$W/<lang>_chunk_*.json" --out <dir>/<SUF>/<name>_<SUF>.pptx \
       --target <lang> --keep $W/keep.txt --report $W/check.json [--images $W/img] [--annotate-vi]
   python3 $SK/scripts/apply_xlsx.py <src.xlsx> --maps "$W/<lang>_chunk_*.json" --out <dir>/<SUF>/<name>_<SUF>.xlsx --target <lang> --keep $W/keep.txt --report $W/check_xlsx.json
   ```
   - pptx overflow is the USER's choice: the default `--fit report` changes nothing and lists `OVER` frames. Show them and ask
     (AskUserQuestion): `--fit shrink` (same scale for every frame of the same kind) or `--fit widen` (keep size, widen frame,
     push right-hand neighbours). Never shorten the translation to fit.
   - xlsx: zip XML is edited in place (sharedStrings, drawings, comments, cached formula results, sheet names); renamed sheets
     are fixed in formulas / defined names / charts / validations; names cut to 31 chars; `fullCalcOnLoad` set. Tell the user:
     formula/validation literals auto-kept (extract.py prints them), rich-text cells merged to the first run's format (list
     them for manual re-bold). Defined names and `externalLinks` caches are left as is. Images: view each `xl/media/*`; redraw
     a chart at the same size and write it back under the same name. Never re-pack an xlsx with `zip -r` (Excel Online refuses
     directory entries) — use Python zipfile in the source order.
   - `LEFT` (source-language script still in the output) must be 0 or approved; `REVIEW` (unchanged paragraphs with non-target
     words) → translate, or add to keep.txt only if the user approves. Not "done" while either is open.
4. After the user accepts: `python3 $SK/scripts/tm.py save --project <P> --target <lang> --maps "$W/<lang>_chunk_*.json" --file <name> --ctx "<document context>" --work $W`
   (also saves glossary/keep.txt). Same `--file` again = correction; another file with a different translation = new meaning
   (never auto-re-used). Term changed in the glossary → `tm.py forget --project <P> --target <lang> --match '<term>'` first.

## B. Image track (pptx)
1. `python3 $SK/scripts/extract_images.py <src.pptx> --out $W/img` — every picture whatever its size on the slide, icons
   < 64 px skipped, identical pictures once (`dup_of` re-uses the overlay). WMF/EMF are cropped from a high-DPI LibreOffice
   render; if soffice fails (sandbox: "no valid pipe path") `meta.json` is still written with those marked `missing` — ask the
   user to approve running that one conversion outside the sandbox; never bypass silently.
2. OCR, in the background right away (CPU, sample deck: 48 images in 100 s — ≈ 5 s per large image, 1 s per small one):
   ```bash
   python3 $SK/scripts/setup_env.py ocr     # once; LAST line printed = $OCRPY. Hosts: pypi.org, files.pythonhosted.org,
                                            # download.pytorch.org, download-r2.pytorch.org, github.com, *.githubusercontent.com
   $OCRPY $SK/scripts/ocr.py $W/img --langs <ja,en | vi,en | en> --target <lang> --keep $W/keep.txt   # run_in_background
   ```
   `--langs` = language of the SOURCE images. `$W/img/todo.json` = images with ≥ 2 boxes to translate or one real label —
   ONLY these go to overlay agents (sample deck: 13 of 48). Boxes are reliable, recognized text is not (agents read the image).
   Check progress by counting `ocr_*.json` (`pgrep -f ocr.py` matches itself).
3. **Pilot one diagram yourself**: write `$W/img/<lang>_<name>.json` (format in `references/brief-image.md`), run
   `python3 $SK/scripts/overlay.py $W/img --lang <lang> <name>`, view `$W/img/out/check_<name>.png`. Catches box/colour/font
   issues before fanning out.
4. Overlay subagents for `todo.json` (≈ 7–8 images each, OCR order) with `references/brief-image.md`; give each its own
   scratch sub-folder. **Always view `$W/img/skipped_k.png` once** (thumbnails of every image OCR left out, ≈ 1,600 tokens
   per 36 images): catches clearly visible text OCR did not recognise (vertical, stylised) — add every image showing text to
   `todo.json`. Tiny text is not the sheet's job: ocr.py already re-reads at full detail every left-out image > 1600 px.
   Record each agent: `runlog.py agent $W --step image --name <group> --tokens … --ms …`.
5. Re-render all once with the final script, then apply_pptx.py `--images $W/img`: `python3 $SK/scripts/overlay.py $W/img --lang <lang>`.

## Content rules (all directions)
- Never change, shorten or drop source meaning — not even to fit a box.
- A reference document in the target language (e.g. an earlier proposal) → use its wording for recurring items and add them
  to the glossary before spawning translators.
- English headings/labels are NOT exempt: in a ja/vi target every phrase is translated unless it is on the keep-list.
- (vi) Katakana loanwords of English industry/IT terms stay English; English WMS terms carry the Vietnamese meaning in brackets
  (`Putaway (cất hàng)`), never nested — rules and lists are in the briefs/glossary. Slides: translators write the terms
  without brackets and `apply_pptx.py --annotate-vi` adds them at the first occurrence per slide; md/xlsx reading docs:
  `scripts/annotate_vi.py`, then re-read every changed line.
- Terminology change on an existing translation: give agents the `{source: old_translation}` map and change only the terms
  (much cheaper than re-translating); for images edit `<lang>_<name>.json` and re-render.

## C. Verify (do not skip)
- Render to PDF (`soffice --headless --convert-to pdf`) and view 4–6 slides: text-heavy, a table, a flow diagram, a long title,
  and one showing master text. Look for overflow, overlaps, leftover source language. Images: overlay agents viewed every
  check sheet; text inside images is no longer editable — say so.
- xlsx: spot-check a few sheets with `pdftotext` or openpyxl; formulas still compute; no sheet name > 31 chars.
- Report to the user — paste `python3 $SK/scripts/runlog.py report $W` (time per step and end to end, subagent tokens,
  strings/characters sent vs re-used from TM, images total / duplicate / given to agents, LEFT / REVIEW / OVER counts;
  add `--usd-per-mtok <price>` only when the user gives a price), plus output paths, project name, what could not be done
  well, and terms the agents flagged as uncertain.

## Pitfalls learned
- Large output: overlays are saved at 2×; a 100-slide deck can reach ~50 MB.
- Japanese file names inside text (「RFP.pdf 6ページ」より抜粋) get translated; if real names matter, put them in keep.txt.
- Agents running in parallel overwrote each other's helper scripts in a shared folder: one scratch sub-folder per agent.
