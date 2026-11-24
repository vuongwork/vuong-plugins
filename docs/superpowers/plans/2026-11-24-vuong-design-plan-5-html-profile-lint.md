# vuong-design kế hoạch 5: chuẩn HTML đầu vào (vd-html v1) và lint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến "HTML tình cờ hợp với Figma" thành hợp đồng có kiểm tra. (1) Một profile ngắn `vd-html v1`, mỗi luật kiểm được bằng máy. (2) `core/lint.mjs`: kiểm một file HTML trong vài giây, 0 token, ra kết quả gọn, chặn trước `layout`/`ds`. (3) Template khởi đầu đúng profile. (4) Skill `spec-to-html` cho bước model duy nhất: sinh HTML từ spec, vòng lặp lint ≤ 3 lần.

**Vì sao:** sửa lỗi ở lúc sinh HTML rẻ nhất. Planora: 76 câu hỏi chuẩn hoá mở (giá trị viết cứng), s3 dựa vào flex-shrink, phải truyền `--root/--widen` riêng. Các lỗi đó lint bắt được trong vài giây.

**Architecture:** `lint.mjs` mở trang một lần bằng Chromium của `browser.mjs` (không qua `capture.mjs`, vốn nặng), chạy một hàm `page.evaluate` trả về danh sách vi phạm; đổi bề rộng khung nới một lần (A → A + 120) để kiểm co giãn. Không có model. `layout.mjs`/`ds.mjs` gọi `lintFile` trước pipeline (cổng), mặc định `--root '[data-vd-screen]'` khi file theo profile.

**Tech Stack:** như kế hoạch 1–3 (Node ≥ 18, ESM `.mjs`, `node:test`, Playwright bên ngoài qua `VD_PLAYWRIGHT_FROM`, không thêm thư viện).

**Thứ tự:** lint là định nghĩa hợp đồng và là bộ kiểm cho generator, nên làm trước. Template và skill làm sau, dùng lint để chứng minh.

## Global Constraints

- Mã ở `plugins/vuong-design/core/`, test ở `plugins/vuong-design/test/`, nhánh `feat/vuong-design-lint` (tách từ `feat/vuong-design-figma` = `fda9607`). Không có phụ thuộc npm.
- Lint **không bao giờ sửa file nguồn**, không ghi gì ngoài `--out` (nếu có) và `--log`.
- **Nhanh:** một file 18 màn ≤ 10 s (gồm khởi động Chromium). Một lần tải trang, nhiều nhất 2 lần đổi bề rộng. Không tải Google Fonts thêm (chỉ những gì trang tự tải).
- **Gọn (nguyên tắc chi phí 3):** stdout ≤ 15 dòng: dòng tổng (số màn, lỗi, cảnh báo, tỉ lệ token), tối đa 10 vi phạm nặng nhất (gộp theo mã + màn, kèm số lần), dòng cuối chỉ đường tới `lint.json`. Bản đầy đủ chỉ ở `lint.json`.
- Mỗi vi phạm: `{ code, level: 'error'|'warn', screen, sel, msg, n }`. `sel` là selector ngắn tìm lại được (tag + class + `:nth-of-type` tới màn), `n` số lần sau khi gộp.
- Mã luật ổn định (`E1…`, `W1…`), mỗi mã có một mục trong `PROFILE.md` cùng số. Đổi nghĩa một mã = tăng phiên bản profile.
- Danh sách thuộc tính Figma không có (W5) phải giữ đồng bộ với `unsupported()` trong `capture.mjs` (R46). Ghi chú điều này ở cả hai chỗ.
- Danh sách font lấy từ `font-map.mjs` (`defaultFontMap`, `isSystemFont`), không viết danh sách thứ hai.
- Exit code: 0 không có lỗi (cảnh báo không làm hỏng, trừ khi `--strict`), 1 có lỗi, 2 lỗi dùng lệnh / thiếu Playwright.
- Không làm hỏng kế hoạch 1–3: test cũ giữ nguyên. Test nghiệm thu corpus chạy với `--no-lint` (corpus cố ý là HTML ngoài profile).

## Review Focus

1. Lỗi E (chặn) chỉ dành cho thứ làm pipeline ra kết quả sai hoặc không chạy. Cái chỉ làm giảm độ chính xác là W. Không được chặn nhầm file Planora vì cảnh báo.
2. W3 (flex-shrink) phải bắt được s3 Planora (hàng `.say`) và không báo trên hàng flex bình thường không bị co (test cả hai).
3. Ảnh / stylesheet ngoài: Google Fonts CSS được phép (không tính E5); `data:` được phép; mọi `src` khác là E4.
4. Màn không giãn khi nới (W2) không được báo nhầm khi chỉ màn con giãn còn màn cha cố định theo ý (đo phần tử con FILL, không chỉ khung màn).
5. stdout không vượt 15 dòng dù file có hàng trăm vi phạm.

---

### Task 1: Profile `vd-html v1`

**Files:** Create `plugins/vuong-design/PROFILE.md`.

Nội dung (tiếng Anh như README, ngắn, mỗi luật một mục có mã):

- **Cấu trúc:** mỗi màn là phần tử có `data-vd-screen="<id>"` (id duy nhất, ví dụ `A1`), tên hiển thị ở `data-vd-name` (không bắt buộc). Khung để nới bề rộng: `data-vd-widen` trên màn hoặc tổ tiên của nó (không có thì nới chính màn). Không cần `--root/--widen` khi theo profile.
- **Tự chứa, tĩnh:** một file, mở thẳng bằng `file://`; không có `<script>` chạy được (cho phép `type="application/json"` và `type="text/template"`), không `iframe`/`srcdoc`/`canvas`/`video`/`object`/`embed`. Mỗi trạng thái (tab, modal, sheet, bước) là một màn riêng.
- **Tài nguyên:** ảnh là `data:` URI; stylesheet cùng file (chỉ Google Fonts CSS được trỏ ra ngoài); font thuộc danh sách Figma có (`font-map.mjs`).
- **Token:** khai báo ở `:root` với tiền tố `--color-*`, `--space-*`, `--radius-*`, `--font-*`, `--size-*`, `--shadow-*`. Phần tử dùng `var(--…)`, không viết giá trị cứng cho màu, khoảng cách, bo góc, cỡ chữ. Không dùng `var()` lồng trong hàm hay fallback (capture không gắn token được, `varsComplex`).
- **Layout:** flex. Phần tử giãn dùng `flex: 1` / `align-self: stretch` / `width: 100%`; phần tử ôm nội dung để tự nhiên. Không dựa vào flex-shrink (đặt `min-width: 0` + `flex: 1` cho khối chữ thay vì để nó co). `position: absolute` chỉ cho lớp phủ (FAB, badge, thanh dưới), không dùng làm layout chính. Không grid, float, table cho bố cục màn.
- **Không có trong Figma (tránh):** outline, filter, backdrop-filter, mix/background-blend-mode, mask, border-image, text-shadow, text-overflow/line-clamp, viền khác màu hoặc khác kiểu từng cạnh, gạch chữ ngoài underline/line-through, transform (trừ khi chỉ để xoay icon), đơn vị `vw/vh` trong màn.
- **Icon:** SVG inline hoặc `<symbol>` + `<use href="#id">` cùng file. Không icon font, không ảnh PNG/JPG làm icon.
- Bảng mã luật (đồng bộ với Task 2):

| Mã | Mức | Luật |
|---|---|---|
| E1 | error | không tìm thấy màn nào theo selector |
| E2 | error | id màn trùng hoặc rỗng (chỉ khi dùng `data-vd-screen`) |
| E3 | error | có `<script>` chạy được |
| E4 | error | ảnh không phải `data:` (img src, srcset, background-image url, svg `<image>`) |
| E5 | error | stylesheet không đọc được `cssRules` (khác nguồn), trừ Google Fonts |
| E6 | error | font không có trong Figma và không phải font hệ thống (Figma thay bằng Inter) |
| E7 | error | `<use>` trỏ tới id không có |
| E8 | error | `iframe`, `canvas`, `video`, `object`, `embed` trong màn |
| W1 | warn | layout grid / float / table trong màn |
| W2 | warn | màn không giãn khi nới, hoặc giãn mà không có phần tử con nào giãn |
| W3 | warn | phần tử flex bị co (flex-shrink) ở bề rộng A hoặc B |
| W4 | warn | viền khác màu hoặc khác kiểu từng cạnh |
| W5 | warn | thuộc tính Figma không có (danh sách R46 + outline, filter, transform, gạch chữ khác) |
| W6 | warn | icon font, hoặc ảnh raster ≤ 48 px (icon không thành vector) |
| W7 | warn | tỉ lệ khai báo màu / khoảng cách / bo góc / cỡ chữ dùng `var()` dưới 80 % (kèm số theo nhóm) |
| W8 | warn | font hệ thống (Figma thay bằng Inter) |
| W9 | warn | > 25 % phần tử trong màn là absolute/fixed, hoặc dùng `vw/vh` trong màn |
| W10 | warn | `var()` lồng trong hàm hay có fallback |

- [ ] Viết `PROFILE.md` như trên, thêm một đoạn "Checking: `node core/lint.mjs …`" và liên kết từ README.
- [ ] Commit `docs(vuong-design): vd-html v1 input profile`.

### Task 2: `core/lint.mjs`

**Files:** Create `core/lint.mjs`, `test/lint.test.mjs`, fixtures `test/fixtures/lint-*.html`.

**Interfaces:**
- `export async function lintFile(htmlPath, { root, widen, widenBy = 120, browser } = {}): Promise<LintResult>`. `root` mặc định `[data-vd-screen]`; `widen` mặc định `[data-vd-widen]` nếu có trong màn/tổ tiên, không thì chính màn. `browser` truyền vào để dùng chung (layout/ds), không có thì tự mở và đóng.
- `LintResult = { version: 1, profile: 'vd-html/1', file, ms, screens: [{ id, w, h }], findings: Finding[], counts: { error, warn }, tokens: { color, space, radius, fontSize }: { var, literal, ratio } }`.
- `export function summarize(result, { max = 10 } = {}): string[]` (≤ 15 dòng, xem Global Constraints).
- `export async function main(argv)`: `node core/lint.mjs --html <file> [--root <sel>] [--widen <sel>] [--out <dir>] [--strict] [--log <runs.jsonl>] [--json]`. `--out` ghi `lint.json`; `--json` in kết quả đầy đủ ra stdout (cho máy, không cho model); `--log` nối một dòng `{ ts, tool: 'lint', file, ms, screens, error, warn }`.

**Cách đo (trong một `page.evaluate`, viewport 1400 như capture):**
- E3–E5, E7, E8: duyệt DOM / `document.styleSheets` (thử `cssRules`, bắt lỗi; href khớp `fonts.googleapis.com` thì bỏ qua). E4 cả `background-image` đã tính (`getComputedStyle`) có `url(` không phải `data:`.
- E6/W8: họ font đầu tiên trong `font-family` đã tính của mỗi phần tử có chữ (nút văn bản không rỗng); `isAvailable` → bỏ qua, `isSystemFont` → W8, còn lại → E6. Truyền danh sách vào evaluate bằng tham số.
- W1, W4, W5, W6, W9, W10: `getComputedStyle` từng phần tử trong màn. W5: chép danh sách từ `unsupported()` của `capture.mjs`, thêm outline, filter, transform ≠ none (bỏ qua `svg` con và phần tử có `rotate` thuần trên icon), `text-decoration-line` có `overline`, `text-decoration-style` ≠ solid. W10 và W7 duyệt `cssRules` (kể cả trong `@media`): với mỗi khai báo thuộc nhóm màu (`color`, `background(-color)`, `border*-color`, `fill`, `stroke`, `box-shadow` màu), khoảng cách (`padding*`, `margin*`, `gap`, `row-gap`, `column-gap`), bo góc (`border*-radius`), cỡ chữ (`font-size`): có `var(` → var, giá trị khác `0`/`auto`/`inherit`/`initial`/`transparent`/`currentColor`/`none`/`%` → literal. Khai báo nằm trong rule `:root` (định nghĩa biến) không tính.
- W3: ở bề rộng A rồi B: ghi bề rộng (cột: chiều cao) chính của mọi item flex trong màn; đặt tạm `flex-shrink: 0 !important` cho tất cả cùng lúc (một stylesheet tạm), đo lại, gỡ. Item nào lớn hơn > 0,5 px khi không co → W3 (chỉ báo item, không báo con của nó).
- W2: đo khung màn ở A và sau khi đặt `width` khung nới = A + `widenBy` (giữ `min-width/max-width` như capture `chooseWiden` không cần: đặt thẳng `width`, `max-width: none`). Màn không đổi bề rộng → W2 "fixed width". Đổi nhưng không phần tử con (không tính chính màn) nào rộng thêm ≥ 1 px → W2 "nothing stretches".
- `sel`: tag + class đầu tiên + `:nth-of-type(k)` khi trùng anh em, nối bằng ` > ` từ màn, tối đa 4 cấp cuối.
- Gộp: cùng `code + screen + msg` → một finding với `n`. Xếp: error trước, rồi `n` giảm dần.

- [ ] **Step 1: Fixtures** (mỗi file 1–3 màn nhỏ): `lint-clean.html` (theo profile hoàn toàn, phải ra 0/0), `lint-errors.html` (script, ảnh https, `<use>` thiếu, font `Comic Neue`, canvas, id trùng), `lint-warns.html` (grid, viền khác màu, outline + filter + text-shadow, ảnh PNG 24 px, màu viết cứng, font `Arial`, `var(--x, #fff)`, absolute dày), `lint-shrink.html` (hàng avatar 32 + khối chữ dài để co → W3; hàng thứ hai cùng cấu trúc với `min-width:0; flex:1` → không báo), `lint-fixed.html` (màn width cố định 300 → W2).
- [ ] **Step 2: Test** `lint.test.mjs` (bỏ qua khi thiếu Playwright, như test cũ): mỗi fixture ra đúng tập mã và mức; `lint-clean` 0 lỗi 0 cảnh báo; `tokens.color.ratio` của `lint-clean` = 1; `summarize` của một kết quả 300 finding ≤ 15 dòng; `main` exit 0/1/2 (2 với `--html` thiếu file); `--strict` đổi exit thành 1 khi chỉ có cảnh báo; `--log` nối đúng một dòng JSON.
- [ ] **Step 3: Chạy test → FAIL**, viết `lint.mjs`, chạy lại → PASS. Chạy cả `node --test plugins/vuong-design/test/` (test cũ không đổi).
- [ ] **Step 4: Đo thật** trên `$VD_CORPUS_DIR/planora-ui-screens.html --root ".cell .sc" --widen ".ph"`: ghi thời gian, số lỗi/cảnh báo, các mã. Kỳ vọng: 0 lỗi; có W3 ở s3; W7 cho thấy tỉ lệ var thấp. Nếu có lỗi E thì xem lại: E chỉ đúng khi pipeline thực sự hỏng vì nó.
- [ ] Commit `feat(vuong-design): lint.mjs checks HTML against vd-html v1`.

### Task 3: Cổng lint trong `layout.mjs` / `ds.mjs`

**Files:** Modify `core/layout.mjs` (parseCli, main), `test/layout.test.mjs` hoặc test CLI tương ứng, `test/acceptance.test.mjs`, README.

- `--root` không bắt buộc nữa: thiếu thì dùng `[data-vd-screen]` (và `--widen` mặc định `[data-vd-widen]` khi phần tử đó tồn tại; xử lý trong pipeline, không trong parseCli). `--name` mặc định đọc `data-vd-name` khi dùng selector mặc định (nếu pipeline hỗ trợ được dễ; không thì để Task sau, ghi vào README).
- Trước pipeline (chế độ `--html`): chạy `lintFile` dùng chung browser nếu có thể; in các dòng `summarize`; ghi `lint.json` vào `--out`. Có lỗi → dừng, exit 1, dòng cuối: `lint: N errors, fix them or pass --no-lint`. Cảnh báo không dừng.
- `--no-lint` bỏ qua cổng. Chế độ `--corpus` không chạy lint (corpus là HTML ngoài).
- `acceptance.test.mjs` không đổi hành vi (corpus mode).
- [ ] Test: file lint-errors qua `layout main` → exit 1, không có `ir.json`; cùng file với `--no-lint` → chạy tiếp; file `lint-clean` không truyền `--root` → chạy được, `report.json` có đúng số màn.
- [ ] Commit `feat(vuong-design): lint gate before layout/ds, default root [data-vd-screen]`.

### Task 4: Template khởi đầu

**Files:** Create `plugins/vuong-design/templates/starter.html`, `templates/README.md`; test thêm trong `lint.test.mjs`.

- `starter.html`: khung trang theo profile (một lưới các màn 360×800 trong khung `data-vd-widen`), khối `:root` token mẫu đủ các nhóm (màu vai trò, thang khoảng cách 4/8/12/16/20/24/32, bo góc, cỡ chữ + line-height số nguyên, bóng), font `Be Vietnam Pro` qua Google Fonts, sprite `<symbol>` 3 icon mẫu, và 3 màn mẫu dùng các mẫu component có sẵn: thanh trạng thái, app bar, hàng list (icon + khối chữ `flex:1; min-width:0` + trailing), chip row (wrap), thẻ, nút chính, bottom nav (absolute bám đáy), FAB, bottom sheet (một màn riêng). Mỗi mẫu có comment `<!-- vd:component name -->` để generator chép.
- `templates/README.md`: cách dùng (chép file, thay token bằng `tokens.css` của dự án nếu đã có, xoá màn mẫu), danh sách component mẫu.
- [ ] Test: `starter.html` lint 0 lỗi 0 cảnh báo (W7 ratio = 1 cho cả 4 nhóm).
- [ ] Đo: `layout.mjs --html templates/starter.html --out <tmp>` (không truyền root) → mọi màn đạt. Ghi kết quả vào templates/README.md. Màn nào không đạt thì sửa template (template phải là bằng chứng profile đủ).
- [ ] Commit `feat(vuong-design): starter template following vd-html v1`.

### Task 5: Skill `spec-to-html` và nghiệm thu

**Files:** Create `plugins/vuong-design/skills/spec-to-html/SKILL.md`; sửa README (mục "Input profile and lint", luồng mới), `PROFILE.md` (số đo thật).

- SKILL.md (ngắn, dành cho model, ≤ 120 dòng):
  - Đầu vào: spec (đường dẫn), tuỳ chọn `tokens.css` dự án. Đầu ra: một file HTML theo profile.
  - Quy trình: (1) nếu có `tokens.css` thì dùng nguyên, không tự đặt token; nếu không thì định token trước (bảng ngắn) rồi mới dựng màn. (2) chép `templates/starter.html`, dùng mẫu component có sẵn. (3) viết màn: mỗi trạng thái một màn, id theo mã màn trong spec. (4) chạy `node core/lint.mjs --html <file> --log <runs.jsonl>`; chỉ sửa đúng các finding báo; tối đa 3 vòng; còn lỗi sau 3 vòng thì dừng và báo người dùng, không tự hạ luật. (5) xong thì chạy `layout.mjs` (không cần root).
  - Chọn model: bước này cần phán đoán thiết kế khi định token và bố cục; viết HTML từ spec đã rõ có thể dùng Sonnet vì lint kiểm lại. Không đọc `lint.json` vào context, chỉ đọc stdout.
  - Không đưa nội dung HTML lớn qua lại giữa agent; truyền đường dẫn.
- Nghiệm thu (ghi số vào `PROFILE.md` mục "Measured"):
  - Lint cả 5 file corpus (`$VD_CORPUS_DIR`, root/widen theo `test/corpus.json`): thời gian từng file, số lỗi/cảnh báo theo mã.
  - `starter.html`: lint 0/0, layout tất cả đạt.
- [ ] Commit `feat(vuong-design): spec-to-html skill; lint numbers on the corpus`.

## Ngoài phạm vi (ghi lại, chưa làm)

- `normalize` tự sửa HTML ngoài (thay `<use>` bằng symbol, nhúng ảnh, gắn `data-vd-screen`): làm khi có HTML ngoài thật cần đưa vào.
- Sinh lại mockup Planora theo profile: không làm; s3/s4 đã có hướng xử lý ở kế hoạch 3.
- Hợp nhất log đo chạy (`runs.jsonl`) cho cả `ds.mjs`/`figma.mjs`: lint có `--log` trước, các lệnh khác theo sau.

## Kết quả thử thật và việc chuyển sang pipeline (2026-11-24)

Hai lượt `spec-to-html` (Sonnet 5.5, đề trong `$VD_CORPUS_DIR/specs/`):

| Mẫu | Token output | Vòng lint | Layout đầu → sau sửa | Lỗ hổng profile tìm ra |
|---|---|---|---|---|
| Ví Nhỏ (5 màn) | 29,2k | 1 (0/0) | 2/5 → 5/5 | W12: `width:%` trong luồng (thanh tiến độ) |
| Hẹn Khám (5 màn) | 24,8k | 1 (0/0) | 2/5 → 3/5 | W13: lớp phủ tràn khỏi cha bị nội dung sau đè (dropdown) |

Việc cho pipeline, làm **sau khi merge kế hoạch 3** (không thuộc lint):

- [ ] **Chuẩn hoá (kế hoạch 2, `normalize.mjs`): GRID4 không hỏi kích thước theo dữ liệu.** Hẹn Khám: 39 câu GRID4, nhiều câu là chiều cao cột biểu đồ (63,59; 104,39 px…) và khoảng lệch avatar chồng nhau (7,2x px). Câu gộp "áp dụng mọi giá trị lưới 4 px" sẽ làm tròn cột và **sai số liệu**. Bỏ qua: phần tử absolute có kích thước/inset %, giá trị suy ra từ căn giữa (padding lẻ do `height` cố định), con của vùng biểu đồ. Test: biểu đồ cột tỉ lệ không sinh GRID4.
- [ ] **Crop (kế hoạch 1/3, `verify.mjs`):** Hẹn Khám F1 vòng radio viền 2 px (ratio 0,063 > 0,05, peak 10) và F3 chữ `line-through` (ratio 0,10, peak 29–30). Tìm nguyên nhân (khử răng cưa vòng tròn, vị trí/độ dày gạch ngang) trước khi nghĩ đến nới ngưỡng.
- [ ] **Mã màn:** `layout`/`ds` đặt `s0…` thay vì giá trị `data-vd-screen` (lint đã dùng `M1`, `F1`…). Capture/pipeline nên lấy id từ thuộc tính khi có.

### Lượt 3: Góc Đọc (ảnh, chữ dài, cài đặt)

Sonnet 5.5, 29,8k token output, 2 vòng lint (vòng 1: 6 cảnh báo, vòng 2 sạch), layout 2/5. Hai lỗ hổng mới:

- **W14** `aspect-ratio` trên phần tử giãn: CSS giữ tỉ lệ khi nới, Figma giữ chiều cao → mọi thứ bên dưới lệch (R1, R2, R4). Chốt chiều cao px → R4 hết lỗi bố cục.
- **W15** nội dung bị cắt ở đáy khung màn và phần nhìn thấy đổi khi nới (bài dài R2, danh sách R1). Cắt nội dung cho vừa → R1, R2 đạt; tổng 4/5. Ca giáp ranh: bản đã cắt vẫn có một chấm đầu dòng 6 px ẩn khác nhau ở A/B → W15 báo nhưng layout qua (chấp nhận, là cảnh báo).
- Còn lại R4: chip lệch 2,02 px do làm tròn bề rộng chữ (`figmaModel`), cùng loại Planora s4 → pipeline.

Ba lượt, mỗi lượt lộ đúng một nhóm lỗ hổng mới mà lint bỏ sót (W12; W13; W14 + W15). Profile chưa thể coi là ổn định: chạy tiếp một mẫu khác loại sau khi merge.

### Lượt 4: Trời Hôm Nay (chia và giãn bề ngang)

Sonnet 5.5, 25,2k token output, 2 vòng lint, layout 1/5. Ba lỗ hổng mới và hai bổ sung W5:

- **W16** `flex-grow` ≠ 0/1 (chia 2 : 1, dải 6 đoạn tỉ lệ): Figma FILL chia đều, lệch ngay ở bề rộng A (W3).
- **W17** `max-width` chặn phần tử đang giãn (hộp thoại 312 px): Figma vẫn giãn ở B (W4).
- **W18** icon nằm trong dòng chữ: chữ bị tách node, lệch ~3 px (W5).
- **W5 thêm** `text-align: justify` (cần duyệt 4 px) và `vertical-align` sub/super (dòng cao thêm 2 px).
- **W3 sửa** chỉ báo phần tử tự co, không báo phần tử chỉ to ra theo cha (ô nhập trong hộp thoại bị báo nhầm).
- Sửa theo luật (ghim px, bề rộng cố định, bỏ icon trong dòng): 3/5; còn lại W3 là sub/justify (nay W5) và W2 là chấm đánh dấu dùng margin âm thò ra ngoài cha (crop 0,078) → **pipeline**, chưa đủ rõ để thành luật.
- Thử nhánh "các FILL anh em có bề rộng khác nhau" cho W16: báo trên 3 màn vẫn qua layout → bỏ.

Bốn lượt, gốc chung của mọi lỗ hổng (W12–W18): một kích thước hay vị trí đổi theo bề rộng theo cách auto layout không có. Lượt sau nên là kiểm tra hồi quy: chạy lại một đề cũ với skill mới, kỳ vọng lint sạch thì layout đạt.
