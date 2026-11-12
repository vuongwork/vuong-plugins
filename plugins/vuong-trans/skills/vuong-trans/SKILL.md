---
name: vuong-trans
description: Translate PowerPoint (.pptx), Excel (.xlsx) and PDF documents between Japanese, Vietnamese and English in ANY direction (JA→VI/EN, VI→JA/EN, EN→JA/VI) while keeping the original layout — slide text, table cells, shapes, comments, formula results, sheet names, AND text baked inside images (OCR + overlay / chart redraw). Uses deduplicated phrase-level translation by parallel subagents and deterministic scripts for extraction/write-back, so it is cheap on tokens. Use this skill whenever the user wants to translate/dịch/convert a pptx/xlsx/slide deck/RFP/要件定義書/見積書/báo giá/spec into another of these languages ("dịch file ppt sang tiếng Việt", "dịch excel sang en", "convert file này sang tiếng Nhật", "dịch báo giá sang JP", "bản tiếng Nhật/tiếng Việt/tiếng Anh của file này", "dịch file pdf", "translate this deck", "OCR ảnh rồi dịch đè lên"), even if they don't name the skill.
---

# vuong-trans — PPTX/XLSX/PDF translation between Japanese / Vietnamese / English

Produces a translated copy of the document with the same layout. Two parallel tracks:

```
source file
 ├─ A. text track:  extract.py → (dedupe, chunk) → N translation subagents → apply_pptx.py / apply_xlsx.py
 └─ B. image track (pptx only): extract_images.py → ocr.py (easyocr) → M overlay subagents → overlay.py → apply_pptx.py --images
                                                                              ↓
                                                        render to PDF → look at sample slides → fix
```

Why it is cheap: everything mechanical (extract, write back, font shrink, OCR, drawing, image swap) is a script and costs no model tokens. The model only does what needs understanding — translating and deciding overlay regions — and that work is split across subagents so the main session never holds slide contents or images. Strings are deduplicated before translation (100 slides ≈ 1,400 unique strings).

Scripts live in `scripts/` next to this file (call it `$SK`). Put all intermediate files in a work dir under the session scratchpad / `$TMPDIR`, e.g. `$W=$TMPDIR/vtrans/<docname>` — never in the user's folder. Final outputs go next to the source in a sub-folder `VN/` or `EN/` (ask only if the user specified otherwise).

## 0. Decide
- Target language: `vi`, `en` or `ja` (from the request); the source may be any of ja / vi / en or mixed. Always pass `--target` to extract.py and apply_pptx.py — without it the scripts fall back to the old Japanese-only mode and silently skip Vietnamese/English source text. File types: pptx → tracks A+B; xlsx → track A, then VIEW every image the scripts list from `xl/media/` (logos can stay; charts/diagrams with text must be redrawn or overlaid at the same pixel size and written back under the same filename); pdf → section D (draws over the PDF itself).
- PDF exported from PowerPoint/Excel: ask the sender for the original pptx/xlsx first if possible — tracks A/B keep the layout editable; the PDF track only paints over.
- If several files are requested, run them in the same pass: extract all, translate all unique strings together (one shared map keeps terminology consistent).
- Build a short **glossary** for the domain before spawning translators: copy `references/glossary-logistics.md` if the domain is warehouse/HT/estimation, otherwise write 20–40 key terms yourself after skimming the extracted strings. Consistent terms across agents are the main quality lever.
- **Proper-noun glossary (mandatory).** Translators see deduplicated strings with no slide context, so a
  company name like `ABC金属` gets translated literally ("ABC Kim loại") instead of as the entity ("ABC Metals").
  After extract, run `python3 $SK/scripts/find_entities.py $W/src.json > $W/entities.txt` and resolve every
  candidate yourself into a `## Proper nouns` table in `$W/glossary.md`:
  `| 原文 | Dùng trong VI/EN | Loại | Nguồn |` — company/org → official romanized name (ABC金属 → ABC Metals),
  people → romanized, factory/site → "Nhà máy <địa danh>" / "<Place> Plant", product/model → keep as is.
  If the official name is not certain, keep the original + romanization and mark it `[chưa xác minh]` —
  never translate the meaning of a name. Show the table to the user in 1 short block if it has any `[chưa xác minh]` rows.
- **Document context (2–3 lines)** for every brief: what the document is, who proposes/sends to whom
  (e.g. "Đề xuất của công ty X gửi công ty Y về kho tự động"), and the end-user. Take it from the
  title/cover strings; it fixes `Aの提案` / `Aへのご提案` → "Đề xuất … cho A", not "Đề xuất … A".

## A. Text track
1. Extract unique strings and split into chunks (~350 strings per chunk works well):
   ```bash
   python3 $SK/scripts/extract.py <file1> [file2 ...] --out $W --target <vi|en|ja> --keep $W/keep.txt --chunk 350
   ```
   `--target` extracts EVERY string that is not yet in the target language (Japanese, Vietnamese, English headings like
   "Proposal", "Our Understanding", "Thank you"…), whatever the source language. Kept automatically: acronyms (WCS, AMR),
   codes (M-01, P-0123), e-mails, URLs, file names, numbers. `$W/keep.txt` = one term per line that must stay as written
   (proper nouns from the glossary, vendor/product names); build it from the proper-noun table before extracting.
   Writes `$W/src.json` (all unique strings) and `$W/chunk_1.json …`. Keys are exact paragraph texts (pptx) / shared-string texts incl. phonetic runs (xlsx) — don't edit them.
2. Spawn one subagent per chunk **in the same turn** (they run in parallel). Give each the brief in `references/brief-text.md` with the paths filled in. Use `effort: "lower"` only for EN; VI benefits from more reasoning (word-by-word is the classic JA→VI failure).
   Each writes `$W/<lang>_chunk_k.json` = `{source: translation}`.
3. Write back:
   ```bash
   python3 $SK/scripts/apply_pptx.py <src.pptx> --maps "$W/<lang>_chunk_*.json" --out <dir>/<name>_<VN|EN|JP>.pptx \
       --target <lang> --keep $W/keep.txt --report $W/check.json [--images $W/img]      # --fit report (default)
   python3 $SK/scripts/apply_xlsx.py <src.xlsx> --maps "$W/<lang>_chunk_*.json" --out <dir>/<name>_<VN|EN|JP>.xlsx --target <lang> --keep $W/keep.txt --report $W/check_xlsx.json
   ```
   - pptx: replaces each paragraph's text into its first run (keeps that run's formatting). Overflow handling is the USER's choice:
     the first run uses `--fit report` (changes nothing) and prints every overflowing frame (`OVER slide … shrink x0.85 or +24pt width`).
     Show that list to the user and ask (AskUserQuestion) which option to use, then re-run with it:
       1. `--fit shrink` — smaller font; every frame of the same kind (same base shape name + same original size) gets the SAME scale, so siblings stay uniform.
       2. `--fit widen` — keep the original size; widen the frame (up to the slide edge) and push right-hand neighbours on the same row; reports frames that now touch other shapes and table cells that cannot be widened.
     Never fix overflow by shortening the translation.
   - xlsx: edits the zip XML directly (sharedStrings, drawings, comments, cached formula text results, sheet names) so shapes, images, formulas and formatting survive; renamed sheets are fixed inside formulas/defined names/charts. Sheet names are cut to 31 chars. `fullCalcOnLoad` is set so Excel recalculates on open.
     - String literals that formulas or validation lists compare against (e.g. `IF(X="YES")`, list `"YES, NO"`) are auto-added to keep.txt by extract.py and never translated — translating them breaks the formula. Mention them to the user.
     - Rich-text cells (several formatted runs) are merged into the first run's format → list those cells for the user to re-bold manually.
     - Defined names and `externalLinks` caches are hidden and are left as is (renaming breaks references).
     - Images: apply_xlsx.py prints `xl/media/*`; view each. A chart image is redrawn (e.g. matplotlib, Noto Sans CJK JP for ja, same size) and written back into the zip under the same name.
   - Leftover check (with `--target`): `LEFT` = output still contains source-language script (Japanese when target ≠ ja, Vietnamese diacritics when target ≠ vi) — must be 0 or explicitly approved;
     `REVIEW` = paragraphs left unchanged that still contain non-target words (e.g. "Our Understanding", "Thank you" in a JA deck). Translate them, or add the term to keep.txt
     only if the user approves keeping it. Do not report "done" while LEFT/REVIEW items are unresolved.

## B. Image track (pptx)
1. Extract images (pictures wider than 15 % of the slide). PNG/JPEG are taken as-is; WMF/EMF (typical for pasted Excel tables) are cropped from a high-DPI slide render so they stay sharp:
   ```bash
   python3 $SK/scripts/extract_images.py <src.pptx> --out $W/img
   ```
   Needs LibreOffice for WMF. In a sandbox, soffice may fail with "no valid pipe path" — tell the user and ask them to approve running that one conversion outside the sandbox (it only reads their own file); never bypass the sandbox silently.
2. OCR (start in background right away; ~40 s/image on CPU):
   ```bash
   bash $SK/scripts/setup_ocr.sh            # once: venv + easyocr models under $TMPDIR/vtrans_ocr
   $TMPDIR/vtrans_ocr/venv/bin/python $SK/scripts/ocr.py $W/img --langs <ja,en | vi,en | en> --target <lang> --keep $W/keep.txt   # run_in_background
   # --langs = language of the SOURCE images (easyocr cannot mix ja with vi). Boxes flagged "src": true still need translation.
   # target ja: overlay.py / pdf_images.py switch to Noto Sans CJK automatically (Noto Sans has no Japanese glyphs).
   ```
   setup needs network to pypi.org, files.pythonhosted.org, download.pytorch.org, download-r2.pytorch.org, github.com, objects/release-assets.githubusercontent.com. OCR gives reliable **box positions**; its recognized text is often wrong (vertical text, small fonts) — the overlay agents read the image themselves.
3. **Pilot one image yourself first** (a diagram, not a table): write `$W/img/<lang>_<name>.json` in the region format described in `references/brief-image.md`, run `overlay.py $W/img --lang <lang> <name>`, view `$W/img/out/<name>.png`. This catches box/colour/font issues before fanning out, which is far cheaper than redoing 60 images.
4. Spawn overlay subagents (≈7–8 images each, grouped in OCR order so the first group can start immediately) with `references/brief-image.md`. Each writes `$W/img/<lang>_<name>.json`, renders, views and fixes its own output.
5. Re-render everything once with the final script (keeps fonts consistent), then build the pptx with `--images`:
   ```bash
   python3 $SK/scripts/overlay.py $W/img --lang vi
   ```

## D. PDF track (text layer + images, drawn over the PDF)
Needs PyMuPDF in a venv: `python3 -m venv $TMPDIR/pdfenv && $TMPDIR/pdfenv/bin/pip install pymupdf` (hosts pypi.org, files.pythonhosted.org). `$PY=$TMPDIR/pdfenv/bin/python`.
1. Extract Japanese **lines** (not blocks), page-ordered chunks, pages without text layer:
   ```bash
   $PY $SK/scripts/pdf_extract.py <a.pdf> [b.pdf ...] --out $W --target <lang> --keep $W/keep.txt --chunk-lines 200
   ```
   → `lines.json`, `docs.json` (tag d1, d2… per file), `pages_k.json` (`{"d1 page 3": [lines in order]}`), `src.json`, `noTextPages.json`.
   Run `find_entities.py $W/src.json` for the proper-noun table as usual.
2. Translators: `references/brief-text.md` with these changes — input is `pages_k.json`; output a flat `{exact line: translation}`;
   each line is drawn back into its own box (keep ≤ 1.6× JA length); neighbouring lines are one sentence split across lines →
   read the whole page and split the Vietnamese so the lines read in order; a pure sentence tail may map to `""`.
   Same short label needing different words on different pages → key `"<tag>|<page_index0>|<text>"`.
3. Write back: `$PY $SK/scripts/apply_pdf.py $W --maps "$W/<lang>_*.json" --outdir $W/out --suffix _<VN|EN|JP> --target <lang> --keep $W/keep.txt --report $W/check_pdf.json`
   (redact line → draw Noto Sans / Noto Sans CJK for ja). Default `--fit report` draws at the original size and lists too-long lines (`OVER`);
   show them to the user and ask: `--fit shrink` (one common scale per page + original size + bold, so same-kind lines stay uniform)
   or `--fit widen` (original size, line may run on to the page edge). `LEFT` / `REVIEW` lists work as in apply_pptx.py.
4. Images (always, every file): crop from the TEXT-TRANSLATED pdfs, OCR, overlay agents, paste back:
   ```bash
   $PY $SK/scripts/pdf_images.py crop $W --pdfs $W/out/*_VN.pdf          # pictures ≥ 90×50 pt + whole no-text pages
   $TMPDIR/vtrans_ocr/venv/bin/python $SK/scripts/ocr.py $W/img            # run_in_background
   # → overlay agents (brief-image.md) for every image whose OCR has ≥ 2 jp boxes, then overlay.py $W/img --lang vi
   $PY $SK/scripts/pdf_images.py put $W --map <src.pdf>=$W/out/<name>_VN.pdf ... --outdir <dir>/VN
   ```
   No-text pages (scans, CAD drawings with outlined text) are cropped as one whole-page image for OCR/overlay agents, but
   `put` draws their regions as VECTOR boxes + text on the original page (never pastes the raster: hairlines went grey).
   Pass `--lang <lang>` to `put` (ja → CJK font).
5. Verify: the LEFT/REVIEW lists of apply_pdf.py (and `pdftotext` for the target-language check) only prove the TEXT layer —
   also render every page at low DPI (`pdftoppm -r 40`) and look at a contact sheet / thumbnails for Japanese left in pictures.

## Content rules (all directions)
- Never change, shorten or drop source meaning — not even to fit a box. Overflow is solved by font size or frame size (see `--fit`).
- If the user points to a reference document in the target language (e.g. a previous proposal deck), use its wording for recurring
  items (cover labels, closing line, section names, office list) and add those terms to the glossary before spawning translators.
- English headings/labels are NOT exempt: in a ja/vi target every phrase is translated unless it is on the keep-list.

## C. Verify (do not skip)
- Render the output to PDF (`soffice --headless --convert-to pdf`) and view 4–6 slides: a text-heavy one, a table, a flow diagram, a title with a long name. Look for overflow, overlaps, leftover Japanese.
- For xlsx, open with `pdftotext` or openpyxl and spot-check a few sheets; confirm formulas still compute (cached values present) and no sheet name > 31 chars.
- Report to the user: output paths, counts (strings, images), what could not be done well (tiny boxes, screenshots with unreadable text), and terms the agents flagged as uncertain. Mention that text inside images is no longer editable.

## Pitfalls learned
- (xlsx) Excel tables (`xl/tables/*.xml`): each `tableColumn name` must equal its header cell text. If the header is translated but the column name is not, Excel Desktop silently repairs the file, but Excel Online/SharePoint refuses to open it ("couldn't open the workbook"). apply_xlsx.py now sets every column name to the text actually in its header cell (after translation), so they always match.
- (xlsx) Excel Online is also strict about: (1) sheet-name references inside data validations / conditional formats (`<xm:f>`, `<formula1>`) — apply_xlsx.py renames them too; (2) zip directory entries — never re-pack an xlsx with `zip -r`; let apply_xlsx.py write it, or write entries with Python zipfile in the source order, files only. If you hand-edit parts after apply_xlsx.py (e.g. swapping a chart image), re-pack the same way.
- (vi) English WMS terms must carry the Vietnamese business meaning in brackets so non-specialists can follow: `Putaway (cất hàng)`, `Staging (tập kết hàng)`. Where the term already has a bracket (`Staging inspection (出荷検品)`) merge it: `(出荷検品 – kiểm hàng tập kết)`; never nest brackets.
  - Reading docs (md summaries, xlsx feature lists): run `scripts/annotate_vi.py` — `annotate_markdown()` = first occurrence per `##` section, `annotate(text, set())` = per cell. Then re-read every changed line; fix doubled meanings by rewording the source phrase, not by patching output.
  - Slides (text): translators write the English terms WITHOUT brackets; `apply_pptx.py --annotate-vi` adds the meaning at the first occurrence per slide (skips text inside quotes/file names and existing brackets). Images: overlay agents add the bracket themselves where the box has room.
  - Revising an existing translation (terminology change) is much cheaper than re-translating: give agents the {source: old_translation} map + rules and have them change only the terms; for images edit `<lang>_<name>.json` and re-render. Give each agent its own scratch sub-folder — shared helper-script paths got overwritten when 6 agents ran in parallel.
- (vi) Katakana loanwords of English industry/IT terms (バッチ, ピッキング, ロット, パレット, ロケーション, マスタ, ラベル…) must stay in English — translating them ("lô", "lấy hàng", "vị trí") makes the text harder for practitioners to read. Kanji terms are translated. Put this rule and the loanword list into every brief (both briefs and the glossary already carry it).
- `・` (U+30FB) is inside the katakana range: translators should convert it to `•` / `/`, otherwise the "no Japanese left" check fails and Noto Sans can't draw it.
- Noto Sans lacks `→ ① ▲ ○ ●`: overlay.py falls back to DejaVu per glyph, so agents may use them.
- overlay.py picks the largest font that fits the box: a short label in a tall box becomes huge. Agents should size boxes to the text area, or paint a blank cover region (`"vi": " "`) over the Japanese and a smaller text box on top.
- Japanese file names inside text (e.g. 「RFP.pdf 6ページ」より抜粋) get translated; if the user needs real file names, keep them romanized/original in the brief.
- Large output: images are saved at 2× for sharp text; a 100-slide deck can reach ~50 MB.
- (pdf) Redacting a whole text BLOCK deletes table numbers: PowerPoint tables often export one block per column spanning many cells. Work per line and redact only the middle 50 % of the line height (apply_pdf.py does this).
- (pdf) Image names must be unique across files: an ad-hoc crop that derived the prefix from the first N chars of Japanese file names gave two files the same prefix, one file's crops overwrote the other's, so its pictures were never OCR'd and "no Japanese in images" was reported wrongly. pdf_images.py uses the d1/d2 tags from docs.json and asserts no duplicate names.
- (pdf) "0 Japanese left" from pdftotext says nothing about pictures — look at rendered pages (thumbnails) before reporting done.
- (pdf) Fragmented lines translated in isolation read badly; translate page-ordered chunks with neighbour context.
- `pgrep -f ocr.py` inside a bash command matches the bash command itself — check progress by counting `ocr_*.json`, and run OCR with run_in_background (nohup/& gets killed when the sandboxed command ends).
