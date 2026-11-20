# vuong-design kế hoạch 1: lõi bố cục (HTML → spec Figma, kiểm tra trên máy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ một file HTML tĩnh, đo mọi thứ hiển thị ở hai độ rộng, suy ra cây bố cục chỉ dùng khái niệm auto layout của Figma, mô phỏng lại trên máy theo đúng cách Figma tính, và kiểm tra từng node (lớp 1–4 của mục 14) mà không gọi Figma.

**Architecture:** Chuỗi script Node: `capture` (Playwright đo HTML) → `infer` (đệ quy hình học) → `figma-model` (các khác biệt của Figma đã đo) → `proxy` (dựng lại thành flexbox, render) → `verify` (so từng node, nguyên nhân gốc, so nội dung) → `mutate` (cài lỗi để kiểm tra bộ kiểm tra). CLI `layout.mjs` nối tất cả. Kế hoạch 2–4 (design system, ghi Figma, đóng gói) dùng spec và báo cáo ra từ đây.

**Tech Stack:** Node ≥ 18, ESM `.mjs`, `node:test`. Playwright lấy từ bên ngoài (không đóng gói), Chromium của Playwright. So ảnh làm trong trình duyệt (canvas), không thêm thư viện.

**Spec:** `docs/superpowers/specs/2026-11-21-vuong-design-plugin-design.md` (mục 6, 7, 14, 18 và phụ lục). Mã tham khảo (code bỏ đi, chỉ để đọc): bản thử 2 `…\scratchpad\spike2\` (`extract.js`, `infer.js`, `proxy.js`, `compare.js`, `mutate.js`) và bản thử 3 `…\scratchpad\spike3\` (`prep2.js` cho làm tròn chữ, `runtime.js`). Đường dẫn đầy đủ: `C:\Users\admin\AppData\Local\Temp\claude\113c57f678c9597b\d81955cf-2c6f-4da6-980c-6c8ed017fe13\scratchpad\`.

Các kế hoạch tiếp theo: 2 design system + chuẩn hoá, 3 ghi Figma (biến, component có trạng thái, cập nhật theo phần khác, bảo vệ phần sửa tay, sổ ID, `design-data.json`), 4 đóng gói plugin (skill, lệnh, hai chế độ, ngân sách, chạy tiếp).

## Global Constraints

- Thư mục plugin: `plugins/vuong-design/` trong repo `vuong-plugins`. Mã lõi ở `plugins/vuong-design/core/`, test ở `plugins/vuong-design/test/`.
- Không có `package.json` phụ thuộc trong plugin (theo `vuong-test`). Playwright tìm theo thứ tự: biến môi trường `VD_PLAYWRIGHT_FROM` (thư mục có `node_modules/playwright` hoặc `playwright-core`), rồi `node_modules` của dự án hiện tại. Không tìm thấy thì báo lỗi kèm cách cài, không tự cài.
- Chromium: dùng bản Playwright đã cài (`%LOCALAPPDATA%\ms-playwright\chromium-*`), không tải mới.
- Hai độ rộng: gốc và gốc + 120px.
- Ngưỡng vị trí: khung ≤ 0,5px, chữ ≤ 1px.
- Spec chỉ chứa khái niệm Figma: chiều xếp H/V, wrap, padding[4], gap hoặc spaceBetween, căn trục chính/phụ (S/C/E/stretch), FILL/HUG/FIXED cho từng trục, min/max width, absolute + ràng buộc (L, R, LR, C; không bao giờ SCALE), chữ, vector, ảnh, sơn. Không có margin.
- Không ghi file ngoài thư mục `--out` người dùng chỉ định; không sửa HTML nguồn.
- Không gửi dữ liệu dự án ra mạng (font Google vẫn được tải khi HTML tự tham chiếu).

## Review Focus

1. Selector gốc màn không khớp phần tử nào → lỗi rõ ràng "không tìm thấy màn" kèm selector, không ra báo cáo rỗng báo đạt. (Task 2)
2. Phần tử ẩn (`display:none`, `visibility:hidden`, kích thước 0, nằm ngoài khung bị cắt) → không thành node nhưng được đếm vào danh sách loại trừ có lý do; không bao giờ biến mất không dấu vết. (Task 2)
3. Font không tải được hoặc không có trong Figma → báo cáo ghi font thay thế; bản mô phỏng render bằng font thay thế. (Task 4)
4. Chữ tiếng Việt có dấu, chữ xuống dòng khác nhau ở hai độ rộng, chữ nhiều kiểu lồng nhau → đo đúng từng đoạn, nội dung so bằng dữ liệu. (Task 2, Task 6)
5. Màn dày làm spec vượt 50 KB → báo cáo ghi kích thước và đánh cờ `payloadOver50k` (kế hoạch 3 lo chia lô). (Task 8)

---

### Task 1: Khung plugin và tìm trình duyệt

**Files:**
- Create: `plugins/vuong-design/.claude-plugin/plugin.json`, `plugins/vuong-design/README.md`, `plugins/vuong-design/LICENSE` (copy từ `vuong-test`), `plugins/vuong-design/core/browser.mjs`
- Modify: `.claude-plugin/marketplace.json` (thêm mục `vuong-design`, mô tả: "HTML tĩnh → design system → Figma có biến, component, ID; kiểm tra từng node")
- Test: `plugins/vuong-design/test/browser.test.mjs`

**Interfaces:**
- Produces: `findPlaywright(): string` (đường dẫn module), `launchBrowser(): Promise<Browser>` (headless Chromium, `deviceScaleFactor` do người gọi đặt khi tạo page), `class SetupError extends Error` với `hint: string`.

- [ ] **Step 1: Viết test**: `findPlaywright()` với `VD_PLAYWRIGHT_FROM` trỏ tới thư mục rỗng tạm → ném `SetupError`, `hint` chứa `"VD_PLAYWRIGHT_FROM"`; với biến trỏ tới thư mục có `node_modules/playwright-core` của spike → trả đường dẫn tồn tại; `launchBrowser()` mở được trang `data:text/html,<p>x</p>` và đóng.
- [ ] **Step 2: Chạy** `node --test plugins/vuong-design/test/` → FAIL (chưa có module).
- [ ] **Step 3: Viết** `browser.mjs` theo thứ tự tìm ở Global Constraints; `plugin.json` theo mẫu `vuong-test` (name `vuong-design`, version `0.1.0`).
- [ ] **Step 4: Chạy lại** (với `VD_PLAYWRIGHT_FROM` trỏ tới `…\scratchpad\spike2`) → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): plugin skeleton and browser locator`.

### Task 2: Đo HTML (capture)

**Files:**
- Create: `plugins/vuong-design/core/capture.mjs`, `plugins/vuong-design/test/fixtures/capture-basic.html`
- Test: `plugins/vuong-design/test/capture.test.mjs`

**Interfaces:**
- Consumes: `launchBrowser()`.
- Produces: `captureScreens(htmlPath: string, opts: { root: string, widen?: string, nameOf?: string }): Promise<IR>`.
  - `IR = { screens: Screen[] }`; `Screen = { id, name, W: [a, b], H: [a, b], tree: INode, excluded: {path, reason}[], fonts: string[] }`.
  - `INode = { id, kind: 'frame'|'text'|'icon'|'image'|'pseudo', tag, cls, rA: [x,y,w,h], rB: [x,y,w,h], paint, font?, runs?, lines?, icon?, kids? }`. `id` là đường dẫn ổn định (`n.0.3.1`). `paint` gồm nền, viền từng cạnh, bo góc, bóng, độ mờ, gạch chữ, clip, transform. `runs` là các đoạn chữ có style riêng; `lines` là số dòng ở mỗi độ rộng. `rA`/`rB` tương đối với gốc màn.
  - `widen`: selector phần tử cần nới rộng 120px (mặc định chính gốc màn).
- Cách đo theo bản thử 2 `extract.js`: chữ đo bằng `Range.getBoundingClientRect`; `::before`/`::after` có nội dung, nền hoặc viền thì biến thành span chép style đã tính rồi đo; hình xoay đo hộp chưa xoay; `<svg><use>` là icon lá, kèm id symbol và màu; line-height `normal` ghi thành số px đo được.

- [ ] **Step 1: Viết fixture** `capture-basic.html`: một gốc `.scr` 300×600 chứa hàng flex 3 item, đoạn chữ "Xin chào thế giới" xuống dòng ở 300 nhưng không xuống ở 420, phần tử `::after` 8×8, `<svg><use href="#i">`, một `div` `display:none`, một `span` `visibility:hidden`.
- [ ] **Step 2: Viết test**:
  - `screens.length === 1`, `W` = `[300, 420]`.
  - Có node kind `pseudo` kích thước 8×8.
  - Có node `icon` với `icon.ref === 'i'`.
  - Node chữ có `lines` = `[2, 1]` và `runs[0].t` bắt đầu bằng `"Xin chào"`.
  - `excluded` có đúng 2 mục với lý do `display:none` và `visibility:hidden`.
  - Selector không khớp → reject với thông điệp chứa `"không tìm thấy màn"` và selector.
- [ ] **Step 3: Chạy** → FAIL.
- [ ] **Step 4: Viết** `captureScreens` (chuyển từ spike2 `extract.js`, đổi sang ESM, trả IR như trên).
- [ ] **Step 5: Chạy** → PASS. **Commit** `feat(vuong-design): capture rendered HTML at two widths`.

### Task 3: Suy bố cục đệ quy theo hình học (infer)

**Files:**
- Create: `plugins/vuong-design/core/infer.mjs`, `plugins/vuong-design/test/fixtures/infer-*.html` (một file cho mỗi hành vi dưới đây)
- Test: `plugins/vuong-design/test/infer.test.mjs`

**Interfaces:**
- Consumes: `Screen` từ Task 2.
- Produces: `inferScreen(screen: Screen): { spec: SNode, stats: Stats, flags: Flag[] }`.
  - `SNode = { id, t: 'F'|'T'|'V'|'I', w, h, lay?: { d: 'H'|'V', wrap?, p: [t,r,b,l], g?, sb?, pa: 'S'|'C'|'E', ca: 'S'|'C'|'E'|'X'|'B' }, sz: [ 'FILL'|'HUG'|'FIXED', 'FILL'|'HUG'|'FIXED' ], min?, max?, abs?: { x, y, c: 'L'|'R'|'LR'|'C' }, paint?, font?, runs?, icon?, syn?, kids? }`. `syn` đánh dấu khung nhóm sinh ra khi tách nhóm.
  - `Flag = { id, kind: 'shrink'|'weightedFill'|'spaceAround'|'mixedRunHeight'|'raster', detail }`.
  - `Stats = { grouping, pushSplit, spaceBetween, absOverlap, absOverflow, absTransform, wrappers, wrapRows }`.
- Thuật toán: mục 7 của spec. Không rẽ nhánh theo `display`/`flex`/`grid`/`margin` khi quyết định bố cục. Chỉ đọc CSS để biết sơn, font và ý định co giãn. Mã tham khảo: spike2 `infer.js`, gồm cả các sửa đã làm trong bản thử: HUG khi "kích thước = nội dung + padding ở cả hai độ rộng", khoảng trống thừa đưa vào căn lề, minWidth cho lưới `1fr` có sàn nội dung, FILL + maxWidth, con duy nhất rộng theo % thì đặt tuyệt đối. Ràng buộc SCALE thì thay bằng C hoặc LR, chọn cái khớp hơn ở độ rộng B.

- [ ] **Step 1: Viết fixture và test**. Mỗi fixture một hành vi, mỗi test assert đúng các trường sau:
  - `infer-row-gap`: 3 item cách đều 8 → `lay.d === 'H'`, `lay.g === 8`.
  - `infer-push`: tiêu đề trái + chip bị đẩy sang phải (`margin-left:auto`) → container có `lay.sb === 1` (hoặc nhóm con có `sb`). Không có khung đệm cố định nào, tức không node `syn` nào có `sz[0] === 'FIXED'` mà không có con.
  - `infer-proximity`: các khoảng 0, 12, 16, 8, 16, 8 → có ít nhất 1 node `syn` và mọi container `lay.g` đều đều.
  - `infer-overlap`: badge đè lên icon → badge có `abs`, `abs.c` thuộc `L|R|LR|C`.
  - `infer-overflow`: nút nhô 4px lên khỏi thanh dưới → nút có `abs.y === -4`.
  - `infer-sizing`: ô `flex:1` → `sz[0] === 'FILL'`; nhãn ngắn → `'HUG'`; avatar 40px → `'FIXED'`.
  - `infer-text`: chữ một dòng không giãn → `HUG`; chữ xuống dòng → `FIXED` với `w` bằng độ rộng đo ở A; chữ giãn theo khung → `FILL`.
  - `infer-flags`: `flex-shrink` ép item, `flex:2/flex:1`, `space-evenly` → `flags` có lần lượt `shrink`, `weightedFill`, `spaceAround` với `id` đúng node.
  - `infer-baseline`: tiêu đề 22px và chữ phụ 12,5px căn theo chân chữ trong một hàng → `lay.ca === 'B'` và không có node `syn` bọc chữ phụ (thay cho 65 khung bọc ở bản thử 2).
  - `infer-raster`: phần tử có `filter: blur(2px)` và phần tử có `background: conic-gradient(...)` → `flags` có `raster` cho cả hai.
  - Không node nào có `abs.c === 'SCALE'`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Viết** `inferScreen` (chuyển từ spike2 `infer.js`; thêm phát hiện `flags`; bỏ SCALE).
- [ ] **Step 4: Chạy** → PASS. **Commit** `feat(vuong-design): recursive geometric layout inference`.

### Task 4: Mô hình khác biệt của Figma (figma-model)

**Files:**
- Create: `plugins/vuong-design/core/figma-model.mjs`, `plugins/vuong-design/core/font-map.mjs`
- Test: `plugins/vuong-design/test/figma-model.test.mjs`

**Interfaces:**
- Consumes: `SNode`, `Flag`.
- Produces:
  - `figmaTextBox(wChrome: number, hChrome: number, letterSpacingPx: number): { w: number, h: number }`.
  - `applyFigmaModel(spec: SNode, fontMap: FontMap): { spec: SNode, flags: Flag[], substitutions: {from, to}[] }`. Hàm này chỉnh `w/h` của chữ HUG, thêm cờ `mixedRunHeight` cho chữ có nhiều cỡ trong một dòng, và chuyển viền của node FILL sang `paint.strokeOverlay = true` (kế hoạch 3 vẽ viền này thành lớp phủ tuyệt đối).
  - `FontMap = { available: string[], substitute(family: string): string }`; `defaultFontMap()` gồm Be Vietnam Pro, Roboto, Inter, Material Symbols Rounded và các font Google phổ biến; font hệ thống (Segoe UI, system-ui, -apple-system) thay bằng Inter.

- [ ] **Step 1: Viết test** (số đo từ bản thử 3):
  - `figmaTextBox(33.2, 18.89, 0)` → `{ w: 34, h: 19 }`.
  - `figmaTextBox(132.83, 15.75, 1)` → `{ w: 132, h: 16 }`.
  - `figmaTextBox(40, 25.3, 0)` → `{ w: 40, h: 26 }`.
  - Spec có node FILL với viền 4px → sau `applyFigmaModel` có `paint.strokeOverlay === true` và kích thước không đổi.
  - Chữ có hai đoạn 22px và 10px → `flags` có `mixedRunHeight`.
  - Font `"Segoe UI"` → `substitutions` có `{ from: 'Segoe UI', to: 'Inter' }`.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): model Figma text rounding, stroke and font differences`.

### Task 5: Bản mô phỏng flexbox (proxy)

**Files:**
- Create: `plugins/vuong-design/core/proxy.mjs`, `plugins/vuong-design/test/fixtures/proxy-semantics.json`
- Test: `plugins/vuong-design/test/proxy.test.mjs`

**Interfaces:**
- Consumes: `SNode` đã qua `applyFigmaModel`, `FontMap`, bảng SVG symbol của màn.
- Produces: `buildProxyHtml(spec: SNode, svgDefs: Record<string,string>, fontMap: FontMap): string`; `renderProxy(browser, html: string, width: number): Promise<{ boxes: Record<id,[x,y,w,h]>, png: Buffer }>`.
- Ngữ nghĩa phải giống Figma (spike2 `proxy.js` cộng các điều chỉnh của bản thử 3):
  - `box-sizing:border-box`, khung là flex, không có margin.
  - FILL trên trục chính = `flex:1 1 0; min-width:0`; FILL trên trục phụ = `align-self:stretch`; HUG = `flex:none`; FIXED = px.
  - spaceBetween bỏ qua gap.
  - Absolute đặt theo ràng buộc; viền không ảnh hưởng bố cục (`box-shadow: inset`).
  - Chữ HUG `nowrap`; chữ FIXED hoặc FILL xuống dòng; chữ HUG có kích thước ghim theo `figmaTextBox`.
  - Font dùng `fontMap.substitute`.

- [ ] **Step 1: Viết spec fixture và test** (đúng các ca đã đo trên Figma thật ở bản thử 3):
  - Ba con FILL trong khung 300 có padding 10 → mỗi con rộng `(300 − 20 − 2×gap)/3`.
  - spaceBetween với gap 20 nhưng khoảng trống chỉ 7 → khoảng cách thực là 7.
  - FILL có `min:150` và `max:98`: ở 300 ra `150/98/40`, ở 420 ra `184/184/40`.
  - Absolute `LR` ở độ rộng +120 → rộng thêm đúng 120.
  - Khung viền 4px → con bên trong không bị đẩy vào.
  - Hàng `ca: 'B'` → đường chân chữ của hai đoạn chữ khác cỡ trùng nhau (lệch ≤ 0,5px).
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): flexbox proxy with Figma auto-layout semantics`.

### Task 6: Kiểm tra lớp 1–3 (verify)

**Files:**
- Create: `plugins/vuong-design/core/verify.mjs`, `plugins/vuong-design/core/imgdiff.mjs`
- Test: `plugins/vuong-design/test/verify.test.mjs`

**Interfaces:**
- Consumes: `Screen` (hộp nguồn ở A và B, ảnh nguồn), kết quả `renderProxy` ở A và B, `flags`.
- Produces: `verifyScreen(input): Report`. `imgdiff.mjs` so ảnh bằng canvas trong trình duyệt, gồm `cropDiff(browser, pngA, rectA, pngB, rectB): Promise<number>` (cắt theo vùng, chịu lệch tối đa 1px) và `pixelDiff(...)`.
- `Report = { id, checked, total, unchecked: string[], nodes: {id, dA:[dx,dy,dw,dh], dB, ok}[], roots: {id, width:'A'|'B', delta, explainedBy?: Flag['kind']}[], crop: {id, ratio}[], data: {id, kind:'text'|'icon'|'font', expected, actual}[], pixel: [a, b], pass: boolean }`.
- Luật:
  - Nguyên nhân gốc là node lệch quá ngưỡng mà phần lệch khác với node cha và node anh liền trước. Node chỉ lệch theo thì bỏ qua.
  - Root nào khớp một `flag` của node đó hoặc tổ tiên của nó thì gắn `explainedBy`.
  - `pass` khi đủ cả 4 điều kiện: `unchecked` rỗng, mọi root đều có `explainedBy`, `crop` rỗng (ngưỡng tỉ lệ 0,05, chỉ xét node có diện tích nhỏ hơn hoặc bằng 4000px²), `data` rỗng.
  - `pixel` chỉ để tham khảo, không ảnh hưởng `pass`.

- [ ] **Step 1: Viết test** với dữ liệu dựng tay (không cần trình duyệt, trừ `cropDiff`):
  - Con lệch 3px do cha lệch 3px → chỉ cha là root.
  - Node thiếu hộp nguồn → nằm trong `unchecked` và `pass === false`.
  - Root trên node có flag `shrink` → `explainedBy === 'shrink'`, và `pass` vẫn có thể true.
  - Chữ khác nội dung ("Inbox" với "Inbx") → `data` có mục `text`.
  - `cropDiff` hai ảnh giống nhau lệch 1px → nhỏ hơn 0,05; đổi icon → lớn hơn 0,05.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): per-node verification with root causes and content checks`.

### Task 7: Kiểm tra bộ kiểm tra (mutate, lớp 4)

**Files:**
- Create: `plugins/vuong-design/core/mutate.mjs`
- Test: `plugins/vuong-design/test/mutate.test.mjs`

**Interfaces:**
- Consumes: `buildProxyHtml`, `renderProxy`, `verifyScreen`.
- Produces: `runMutations(browser, screen, spec, svgDefs, fontMap): Promise<{ id, results: { kind, target, caught: boolean, by: string[] }[], allCaught: boolean }>`.
- Năm loại lỗi cài: dịch một hình nhỏ 3px, dịch một nhãn chữ 3px, đổi icon sang icon khác của cùng màn, xoá một node lá nhỏ (ưu tiên node `pseudo`), ẩn một node lá nhưng giữ hộp.
- Chọn mục tiêu **tổng quát theo loại node** (không theo selector). Màn không có ứng viên cho một loại thì ghi `{ caught: null, skipped: 'no candidate' }`; không ném lỗi (bản thử 2 crash ở pl17 vì việc này).

- [ ] **Step 1: Viết test** trên fixture `capture-basic.html`:
  - Đủ 5 kết quả.
  - Mỗi kết quả có `caught === true`, hoặc `skipped === 'no candidate'`.
  - Màn không có icon → loại đổi icon có `skipped`, và hàm không ném lỗi.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): mutation check of the verifier`.

### Task 8: CLI và nghiệm thu trên bộ màn thật

**Files:**
- Create: `plugins/vuong-design/core/layout.mjs`, `plugins/vuong-design/core/report-html.mjs`, `plugins/vuong-design/test/acceptance.test.mjs`, `plugins/vuong-design/test/corpus.json`
- Modify: `plugins/vuong-design/README.md` (cách chạy)

**Interfaces:**
- Consumes: mọi module trên.
- Produces:
  - CLI: `node core/layout.mjs --html <file> --root <selector> [--widen <selector>] [--name <selector>] --out <dir> [--mutate]`.
  - File ghi ra: `<out>/ir.json`, `<out>/spec-<id>.json`, `<out>/report.json`, `<out>/report.html`. Trang HTML liệt kê từng màn với các cột: checked/total, root chưa giải thích, ảnh cắt nguồn và mô phỏng đặt cạnh nhau cho từng node lỗi, các flag, `specBytes`, `payloadOver50k`.
  - Mã thoát 0 khi mọi màn `pass`, 1 khi không đạt.
- `corpus.json` liệt kê bộ nghiệm thu (đường dẫn lấy từ biến `VD_CORPUS_DIR`):
  - Planora: `planora-ui-screens.html`, lấy bằng `git show a4a0967:docs/design/planora-ui-screens.html` trong repo Planora, root `.cell .sc`, widen `.ph`.
  - finance-controller: `2026-11-05-ui-redesign-entry-mockup.html` root `.ph`; các `calendar-layout*.html` root `.ph` hoặc `.mockup` với `width: 420`. Chọn root như báo cáo bản thử 2.

- [ ] **Step 1: Viết test nghiệm thu** (bỏ qua có thông báo khi thiếu `VD_CORPUS_DIR`):
  - Chạy cả 25 màn.
  - Mọi màn có `unchecked.length === 0`.
  - Tổng số root **chưa giải thích** bằng 0. Root nào còn lại thì phải có `explainedBy`, hoặc nằm trong danh sách cho phép ghi ở `corpus.json` kèm lý do (ví dụ lệch đo đạc ≤ 1,5px ở `c21 .card .t`).
  - `--mutate` trên mọi màn → mọi kết quả có `caught === true` hoặc `skipped`.
  - Màn có `specBytes > 50000` → `payloadOver50k === true`.
- [ ] **Step 2: Chạy** `VD_CORPUS_DIR=<dir> node --test plugins/vuong-design/test/acceptance.test.mjs` → FAIL (chưa có CLI).
- [ ] **Step 3: Viết** `layout.mjs` và `report-html.mjs`.
- [ ] **Step 4: Chạy** → PASS. Ghi số liệu nghiệm thu (bảng per-màn như báo cáo bản thử 2) vào cuối README.
- [ ] **Step 5: Chạy toàn bộ** `node --test plugins/vuong-design/test/` → PASS. **Commit** `feat(vuong-design): layout CLI, HTML report and acceptance corpus`.
