# Glossary — warehouse / HT (handy terminal) / IT estimation (JA → VI / EN)

General warehouse / WMS / estimation terms. Copy to <WORKDIR>/glossary.md, trim or extend for the document.
VI style rules:
- Translate by meaningful phrase, natural Vietnamese word order.
- KATAKANA loanwords of English industry/IT terms → keep the ENGLISH word (lowercase in running text): the Japanese is only
  transliterating it, and practitioners recognise the English term instantly. KANJI terms → Vietnamese.
- Everyday katakana (エラー, チェック, データ) → natural Vietnamese (lỗi, kiểm tra, dữ liệu).
- WAREHOUSE PROCESS / FUNCTION NAMES (even when written in kanji) → standard English WMS term, because that is how
  practitioners and WMS documents name them: 入荷検品 Receiving inspection, 格納 Putaway, 再格納 Re-putaway,
  補充 Replenishment, 荷揃え Staging, 出荷検品(荷揃え検品) Staging inspection, 積込み Loading, 棚卸 Stocktaking,
  引当 Stock allocation, 移動 Transfer, 総量ピッキング Bulk picking, 摘み取り Pick-by-order, 拡張バラピッキング Extended piece picking.
  Sentences stay Vietnamese with these terms embedded ("sau receiving inspection từng xe → putaway lên các tầng").
  Objects/places that aren't process names stay Vietnamese: ô lấy hàng, kệ dự trữ, xuất kho, thang nâng, phân bổ nhân sự.

## Katakana loanwords — keep English in VI
| JA | VI / EN |
|---|---|
| バッチ / サブバッチ | batch / sub-batch |
| ピッキング / ケースピッキング / リストピッキング | picking / case picking / list picking |
| ロット / ロットNo | lot / lot No. |
| パレット (PL) | pallet (PL) |
| ロケーション | location |
| マスタ / マスター | master |
| ラベル | label |
| ステータス | status |
| オーバーエリア | over area |
| ゲートウェイ | Gateway |
| スケジューラ / スケジューリング | scheduler / scheduling |
| ハイマスト / ローマスト | high-mast / low-mast |
| オリコン | Oricon |
| カート | cart |
| ツール / メニュー | tool / menu |
| モニタリング | monitoring |
| ブロック | block |

## Kanji terms

| JA | VI | EN |
|---|---|---|
| 拠点 | site (trung tâm) | site |
| LC | LC (trung tâm logistics) | LC (logistics center) |
| 定例会 / 分科会 | họp định kỳ / họp nhóm chuyên đề | regular meeting / working-group meeting |
| HT / 制御HT | HT / HT điều khiển | HT (handy terminal) / control HT |
| 間口 | ô lấy hàng (pick face) | pick face |
| バック棚 / BK | kệ dự trữ (BK) | back shelf (BK) |
| 梱 / バラ | thùng / hàng lẻ | case / piece |
| 荷姿 | quy cách đóng gói (packing) | packing form |
| 入荷 / 入荷検品 | nhập hàng / receiving inspection | receiving / receiving inspection |
| 格納 / 再格納 / 間口戻し | putaway / re-putaway / trả về ô | put-away / re-put-away / return to pick face |
| 仮置き | để tạm | temporary storage |
| 出庫 / 出荷 | xuất kho / xuất hàng | retrieval / shipping |
| 総量ピッキング / 品種総量 | bulk picking / tổng theo mặt hàng | bulk picking / total by SKU |
| 摘み取りピッキング / 種まき | pick-by-order / chia hàng theo điểm giao (put-to-store) | pick-by-order / put-to-store |
| 荷揃え / 荷揃えロケ | staging / staging location | staging / staging location |
| 補充 / 緊急補充 / 補充ブロック | replenishment / emergency replenishment / replenishment block | replenishment / emergency replenishment / replenishment block |
| 移動 / 移動指示 | transfer / chỉ thị transfer | transfer / transfer instruction |
| 棚卸 | stocktaking | stocktaking |
| 欠け山 | chồng hàng thiếu | short stack |
| 欠品 / 引当 | thiếu hàng / stock allocation | shortage / allocation |
| 前残 / 後残 | tồn trước khi lấy / tồn sau khi lấy | remaining before / after |
| オリコン / カゴ車 | Oricon / xe lồng (roll cage) | Oricon folding container / roll cage |
| 自動倉庫 / 危険物倉庫 | kho tự động (AS/RS) / kho hàng nguy hiểm | AS/RS / hazmat warehouse |
| 昇降機 / バラ室 | thang nâng / phòng hàng lẻ | lift / piece room |
| 列 / 連 / 段 / 階 / 枝番 | dãy / khoang / bậc / tầng / số phụ | row / bay / level / floor / sub-no. |
| 車No / 号車 | số xe / xe số | vehicle No. / truck No. |
| 入り順 / 動線 | thứ tự picking / tuyến di chuyển | picking sequence / travel path |
| 作業単位 / 作業No | đơn vị công việc / số công việc | work unit / work No. |
| 携帯プリンタ | máy in cầm tay (portable printer) | portable printer |
| ラベル / 格納先ラベル | label / label nơi cất | label / put-away location label |
| 帳票 / リスト | report / list | report / list |
| 上位連携IF | IF kết nối hệ thống cấp trên | upstream interface |
| マスタ / 照会 | master / tra cứu | master / inquiry |
| 要 / 不要 | Cần / Không cần | Required / Not required |
| 採用 / 対象外 / 保留 | Áp dụng / Ngoài phạm vi / Tạm hoãn | Adopted / Out of scope / On hold |
| 現行踏襲 | giữ nguyên như hiện tại | carry over current behavior |
| 要件定義 / 基本設計 / 詳細設計 | định nghĩa yêu cầu / thiết kế cơ bản / thiết kế chi tiết | requirements definition / basic design / detailed design |
| 製造 / 単体テスト / 結合テスト | phát triển / unit test / integration test | development / unit test / integration test |
| 受入テスト / 本稼働 | UAT / go-live | UAT / go-live |
| 人月 / 人日 / 工数 | người-tháng / người-ngày / effort | person-month / person-day / effort |
| 御見積書 / 見積明細書 / 前提条件 | báo giá / chi tiết báo giá / điều kiện tiền đề | Quotation / Detailed estimate / Assumptions |
| 超概算 | ước tính sơ bộ | rough order-of-magnitude |
| 準委任契約 | hợp đồng bán ủy thác (T&M) | quasi-mandate (T&M) contract |
| 別紙 / 抜粋 | tài liệu đính kèm / trích từ | attachment / excerpt from |
| 設計段階で確定 | sẽ chốt ở giai đoạn thiết kế | to be finalized in design |
