# PDF track (text layer + images, drawn over the PDF)

Read this only when a source file is a PDF. `$SK`, `$W`, `<SUF>`, `<P>` as in SKILL.md.

Needs PyMuPDF in a private venv: `python3 $SK/scripts/setup_env.py pdf` (once; hosts pypi.org, files.pythonhosted.org) — the LAST line it prints is `$PY`.

1. Extract the **lines** (not blocks) still needing translation, page-ordered chunks, pages without text layer:
   ```bash
   $PY $SK/scripts/pdf_extract.py <a.pdf> [b.pdf ...] --out $W --target <lang> --keep $W/keep.txt --chunk-lines 200 --project <P>
   ```
   → `lines.json`, `docs.json` (tag d1, d2… per file), `pages_k.json` (`{"d1 page 3": [lines in order]}`), `src.json`, `noTextPages.json`.
   With `--project`, pages whose lines are all in the TM are left out (their lines → `<lang>_chunk_0_tm.json`, so use
   `--maps "$W/<lang>_*.json"` as below); a page with any new line is sent whole.
   Run `find_entities.py $W/src.json` for the proper-noun table as usual.
2. Translators: `references/brief-text.md` with these changes — input is `pages_k.json`; output a flat `{exact line: translation}`;
   each line is drawn back into its own box (keep ≤ 1.6× JA length); neighbouring lines are one sentence split across lines →
   read the whole page and split the translation so the lines read in order; a pure sentence tail may map to `""`.
   Same short label needing different words on different pages → key `"<tag>|<page_index0>|<text>"`.
3. Write back: `$PY $SK/scripts/apply_pdf.py $W --maps "$W/<lang>_*.json" --outdir $W/out --suffix _<SUF> --target <lang> --keep $W/keep.txt --report $W/check_pdf.json`
   (redact each translated line → draw Noto Sans / Noto Sans CJK for ja; a line with no translation is left untouched and listed as missing).
   Default `--fit report` draws at the original size and lists too-long lines (`OVER`); show them to the user and ask:
   `--fit shrink` (one common scale per page + original size + bold, so same-kind lines stay uniform)
   or `--fit widen` (original size, line may run on to the page edge). `LEFT` / `REVIEW` lists work as in apply_pptx.py.
4. Images (always, every file): crop from the TEXT-TRANSLATED pdfs, OCR, overlay agents, paste back:
   ```bash
   $PY $SK/scripts/pdf_images.py crop $W --pdfs $W/out/*_<SUF>.pdf       # pictures ≥ 90×50 pt + whole no-text pages
   $OCRPY $SK/scripts/ocr.py $W/img --langs <ja,en | vi,en | en> --target <lang> --keep $W/keep.txt   # run_in_background
   # → overlay agents (brief-image.md) for the images in $W/img/todo.json, then
   python3 $SK/scripts/overlay.py $W/img --lang <lang>
   $PY $SK/scripts/pdf_images.py put $W --map <src.pdf>=$W/out/<name>_<SUF>.pdf ... --outdir <dir>/<SUF> --lang <lang>
   ```
   No-text pages (scans, CAD drawings with outlined text) are cropped as one whole-page image for OCR/overlay agents, but
   `put` draws their regions as VECTOR boxes + text on the original page (never pastes the raster: hairlines went grey).
   Pass `--lang <lang>` to `put` (ja → CJK font).
5. Verify: the LEFT/REVIEW lists of apply_pdf.py (and `pdftotext`) only prove the TEXT layer — "0 Japanese left" says nothing
   about pictures. Also render every page at low DPI (`pdftoppm -r 40`, or PyMuPDF `page.get_pixmap(dpi=40)` with `$PY` where
   poppler is not installed, e.g. Windows) and look at a contact sheet for source-language text left in pictures.

## Pitfalls learned (pdf)
- Redacting a whole text BLOCK deletes table numbers: PowerPoint tables often export one block per column spanning many
  cells. Work per line and redact only the middle 50 % of the line height (apply_pdf.py does this).
- Image names must be unique across files: a crop prefix taken from the first N chars of Japanese file names gave two files
  the same prefix, one overwrote the other, its pictures were never OCR'd and "no Japanese in images" was reported wrongly.
  pdf_images.py uses the d1/d2 tags from docs.json and asserts no duplicate names.
- Fragmented lines translated in isolation read badly; translate page-ordered chunks with neighbour context.
