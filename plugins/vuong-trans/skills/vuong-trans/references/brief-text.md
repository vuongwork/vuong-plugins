# Brief for a text-translation subagent (copy, fill the <…>, send as the Agent prompt)

Translate document strings (Japanese / Vietnamese / English, possibly mixed) into <Vietnamese | English | Japanese>.
Document context (who → whom, what): <2–3 lines from SKILL §0, e.g. "Proposal deck from vendor X to customer Y for an automated warehouse">.

Input: <WORKDIR>/chunk_<k>.json — JSON array of source strings (some mixed with English/numbers/codes).
Glossary (follow it for consistency; the `## Proper nouns` table is BINDING — use those names verbatim): <WORKDIR>/glossary.md
<optional> Reference translation in another language, for meaning only: <WORKDIR>/en_chunk_<k>.json

Output: <WORKDIR>/<lang>_chunk_<k>.json — a JSON object mapping EVERY source string (exact, unchanged key) to its translation.

How to translate:
- Translate by meaningful phrase / sentence, not word by word. Read the whole Japanese sentence, understand it, then write it the way a <Vietnamese | English> IT/business professional would. Japanese puts the verb last and stacks modifiers before nouns — reorder for the target language.
  - (vi) 「現行踏襲を基本としたリプレイス」 → not "thay thế lấy sự kế thừa hiện hành làm cơ bản" but "thay thế hệ thống, về cơ bản giữ nguyên chức năng/vận hành hiện tại".
  - (vi) 「〜の要否を含めて判断待ち」 → "đang chờ quyết định, kể cả việc có làm hay không".
- (vi) **Katakana loanwords of English industry/IT terms stay in English** — the Japanese itself is just transliterating the English term, and practitioners recognise the English word instantly, while a Vietnamese rendering hides it:
  バッチ→batch, サブバッチ→sub-batch, ピッキング→picking, ケースピッキング→case picking, ロット→lot, パレット→pallet (PL),
  ロケーション→location, マスタ→master, ラベル→label, ステータス→status, スケジューラ→scheduler, ゲートウェイ→Gateway, オーバーエリア→over area.
  Write them in lowercase inside running Vietnamese text ("bulk picking theo batch", "case picking tổng theo mặt hàng").
  Warehouse PROCESS / function names use the English WMS term even when written in kanji (格納→putaway, 補充→replenishment, 荷揃え→staging, 入荷検品→receiving inspection, 棚卸→stocktaking, 引当→stock allocation) — see the glossary. Other kanji terms are translated into Vietnamese.
  Everyday katakana (エラー, チェック, データ, メニュー) → the natural Vietnamese/common word (lỗi, kiểm tra, dữ liệu, menu).
- (vi) English WMS process terms get the Vietnamese meaning in brackets at their first occurrence in the string/slide: "Putaway (cất hàng)", "Staging (tập kết hàng)", "Receiving inspection (kiểm hàng nhập)". If a bracket already follows, merge: "(出荷検品 – kiểm hàng tập kết)"; no nested brackets.
- Keep it natural and compact, but NEVER drop or shorten source meaning to fit a box — layout is fixed afterwards by font/frame size.
- Translate EVERY phrase into the target language, including English headings/labels mixed into the source ("Proposal", "Our Understanding",
  "From / To / Date", "Thank you", "Headquarter:"). Keep as written only: acronyms (WCS, AMR, API), codes, e-mails, URLs, file names,
  numbers, and the terms in <WORKDIR>/keep.txt. Mapping a string to itself is allowed only for those.
- (ja) Business Japanese for proposal decks: 体言止め for labels, です/ます for sentences, 敬語 (貴社 / 〇〇様). Use the wording of the
  reference deck named in the glossary for recurring items (e.g. ご提案書, 提出先, 提出日, ご清聴ありがとうございました).
- Preserve line breaks (\n), leading spaces/indentation, numbering and symbols (①②, ※, →, ×, ▲), numbers, dates, document codes (02.01.01), table/field names (e.g. ITEM_MST), file-name codes.
- Convert 「・」 to "•" (bullet) or "/" (separator) — it is a katakana-range character and the font can't draw it. 「」 → “ ”. Full-width （） → ().
- Proper nouns — NEVER translate the meaning of a name:
  - Company/org names follow the glossary (ABC金属 → ABC Metals, not "ABC Kim loại"; 〇〇株式会社 → 〇〇 Co., Ltd. / Công ty 〇〇).
    A Latin prefix glued to kanji/katakana (ABC金属, XYZデータ) is almost always a company name — if it is
    not in the glossary, keep it in the original + romanization and list it under "uncertain".
  - Romanize place names (大阪→Osaka, 横浜→Yokohama, 〇〇工場→Nhà máy 〇〇 / 〇〇 Plant); keep product/brand names as written in Latin letters.
  - Honorifics: 〇〇様 → "〇〇" (VI: "quý công ty 〇〇" only where it reads naturally); 貴社 → "quý công ty".
- `AのB` / `AへのB` where A is a company or project: make the relation explicit —
  (vi) 「ABC金属自動倉庫の提案」 → "Đề xuất kho tự động cho ABC Metals", not "Đề xuất kho tự động ABC Kim loại".
  (en) → "Proposal for an Automated Warehouse for ABC Metals".
- Half-width katakana (ﾋﾟｯｷﾝｸﾞ) is Japanese too — translate it. Trailing katakana readings glued to a string (e.g. "作成者コウシンシャ") are phonetic leftovers — drop them.
- Translate yourself; no external translation APIs/sites.

Finish:
1. Write the file with Python `json.dump(..., ensure_ascii=False)`.
2. Verify with Python: every input string is a key, and no value still needs translation:
   `sys.path.insert(0, '<SKILL_DIR>/scripts'); from langcheck import foreign_words, load_keep` →
   `foreign_words(value, '<vi|en|ja>', load_keep('<WORKDIR>/keep.txt'))` must be empty for every value. Fix gaps.
3. Re-read ~30 random entries; rewrite any that read like a word-by-word translation.
Report back only: count translated + up to 5 uncertain terms (source → your choice) + any proper noun NOT in the glossary.
