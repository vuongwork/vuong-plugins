# Brief for an image-overlay subagent (copy, fill the <…>, send as the Agent prompt)

Translate the Japanese text inside slide images into <Vietnamese | English> and paint it over the original.
Context: <one line about the document>. Glossary (mandatory terms + style): <WORKDIR>/glossary.md
Your images: <s008_1 s009_1 …>        Scripts: <SKILL_DIR>/scripts/

For each image NAME:
- Source: <IMGDIR>/NAME.png   OCR: <IMGDIR>/ocr_NAME.json (list of {box:[x1,y1,x2,y2], text, conf, jp}).
  OCR boxes are good LOCATION hints; OCR text is often wrong (vertical/small text) — trust what you see.
  If the OCR file isn't there yet (OCR runs in order in the background), start a background Bash
  `until [ -f <IMGDIR>/ocr_NAME.json ]; do sleep 10; done` and wait for its notification; do ready images first.
  You may also place boxes yourself from zoomed crops if OCR is slow.

1. View NAME.png and read the OCR JSON. Image size: `python3 -c "from PIL import Image;print(Image.open('<IMGDIR>/NAME.png').size)"`.
2. Write <IMGDIR>/<lang>_NAME.json — list of regions in source-image pixels:
   `{"box":[x1,y1,x2,y2], "text":"…", "bg":"#rrggbb"?, "fg":"#rrggbb"?, "align":"center"?, "bold":true?}`
   - Cover EVERY piece of Japanese; leave pure English/numbers/codes alone.
   - (vi) Katakana loanwords of English industry/IT terms and warehouse PROCESS names (receiving inspection, putaway, replenishment, staging, loading, stocktaking…) stay in English — see the glossary; other kanji terms are translated.
   - (vi) English WMS process terms get the Vietnamese meaning in brackets at their first occurrence in the string/slide: "Putaway (cất hàng)", "Staging (tập kết hàng)", "Receiving inspection (kiểm hàng nhập)". If a bracket already follows, merge: "(出荷検品 – kiểm hàng tập kết)"; no nested brackets.
   - Merge OCR boxes of the same sentence / cell / label into ONE region and translate the phrase as a whole (not word by word).
   - Keep the box to the area the Japanese occupies; you may extend it inside the same cell/shape to give the translation room. Never cover lines, arrows, borders, icons or other text. Vertical Japanese in a narrow shape → use the shape's inner area (inset 2–3 px).
   - The renderer picks the largest font that fits the box, so a short label in a tall box gets huge: size boxes to the text, or add a blank cover region (`"text": " "`) over the Japanese plus a smaller text box on top.
   - Set "bg" to the real background of that cell/shape and "fg" when text isn't plain black/white (e.g. white on a dark header). Table header cells: "align":"center","bold":true. Tables: one region per cell.
   - Status words in tables: 要/不要/採用/対象外/保留 → (vi) Cần / Không cần / Áp dụng / Ngoài phạm vi / Tạm hoãn; (en) Required / Not required / Adopted / Out of scope / On hold.
   - Glyphs: use "•" not 「・」; → ① ▲ ○ are fine (fallback font).
3. Render: `python3 <SKILL_DIR>/scripts/overlay.py <IMGDIR> --lang <lang> NAME` → <IMGDIR>/out/NAME.png (2× scale).
4. View the output. Check: no Japanese left, readable, nothing important covered, no overflow. Fix and re-render (≤ 3 rounds).

Don't modify the scripts or other agents' files; keep scratch files in your own sub-folder.
Final report (short): per image — number of regions and any spot you couldn't handle well; uncertain terms.
- Proper nouns: use the `## Proper nouns` table in <WORKDIR>/glossary.md verbatim; never translate a company/site name by meaning.
