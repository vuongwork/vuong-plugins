# vuong-design kế hoạch 3: ghi màn vào Figma và kiểm tra trên Figma thật

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ kết quả của kế hoạch 2 (spec đích từng màn, `tokens.json`, `normalisation.json`), dựng file Figma thật: biến, text style, effect style, màn auto layout gắn biến, mỗi node mang ID. Sau đó đọc ngược Figma để kiểm tra lớp 1–5 trên **Figma thật** (không chỉ bản mô phỏng). Trước tiên thử bốn giả định còn treo trên Figma thật và sửa bản mô phỏng theo kết quả.

**Architecture:** Script không gọi được Figma; chỉ AI gọi `use_figma` qua MCP. Vì vậy chia thành: `figma.mjs plan` sinh các lô `batch-NN.js` (bộ dựng cố định + dữ liệu gọn, mỗi lô ≤ 50 KB) → AI gửi từng lô bằng `use_figma`, lưu kết quả trả về thành `result-NN.json`, tải ảnh `get_screenshot` thành `shot-<màn>.png` → `figma.mjs check` đọc kết quả (hộp ở hai độ rộng, nội dung từng node, ảnh) và chạy lại `verifyScreen` của kế hoạch 1 với Figma thật đóng vai bản mô phỏng (mark `figma-real`), kèm lỗi cài trên dữ liệu đọc ngược (lớp 4). Tiến độ nằm trong `state.json` nên chạy tiếp được khi bị ngắt.

**Tech Stack:** như kế hoạch 1–2 (Node ≥ 18, ESM `.mjs`, `node:test`, Playwright bên ngoài, không thêm thư viện). Bộ dựng chạy trong `use_figma` (Plugin API, không có `fetch`, top-level `await`, trả về bằng `return`). Test bộ dựng trên máy bằng một Figma giả (`test/fake-figma.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-21-vuong-design-plugin-design.md` mục 3, 7 (các khác biệt Figma, R47), 10 (chỉ phần gắn biến/text style), 11 (ID trong `setSharedPluginData`), 13, 14, 16, 18 (giả định 7, 5 bản nhẹ). Kế hoạch 1–2 và README plugin (R1–R80, m5–m8 trong comment đầu file mã). Mã bộ dựng của bản thử (chỉ để đọc): `docs/superpowers/spikes/vuong-design/spike3/runtime.js`, `probe.js`.

**Tách phạm vi.** Mục "kế hoạch 3" trong plan 2 gồm cả component. Bản này (3) lo phần ghi màn có biến và kiểm tra trên Figma thật, đủ để Planora lên Figma sửa tiếp được. Để sang **kế hoạch 3b**: nhận diện component và biến thể, trạng thái sinh theo luật, instance swap icon, sổ ID theo quy ước dự án, cập nhật theo phần khác, `design-data.json` và hình màn đánh số, các trang Bìa / Component / Mẫu / Tham chiếu của mục 13 (bản 3 chỉ ghi biến, style và trang màn). Kế hoạch 4 (đóng gói) giữ nguyên.

## Global Constraints

- Mã ở `plugins/vuong-design/core/`, test ở `plugins/vuong-design/test/`, nhánh `feat/vuong-design-figma` (tách từ `main` = `112f2d3`). Không có phụ thuộc npm.
- **Mỗi lần gọi `use_figma` ≤ 50 000 byte** (mã + dữ liệu, đếm UTF-8). Dùng `PAYLOAD_LIMIT` của `pipeline.mjs`. Một màn mã hoá xong vẫn vượt giới hạn → lỗi rõ ràng kèm tên màn và số byte, không cắt bớt.
- **Ngân sách lượt gọi:** gói Pro khoảng 200 lượt/ngày. `figma.mjs plan` in ước tính (số lô, số ảnh, tổng KB) trước; mặc định `--max-calls 40` cho một lần chạy; chạm ngưỡng thì dừng ở ranh giới lô, `state.json` ghi chỗ dừng.
- **Không ghi vào file Figma người dùng chưa chỉ định.** AI hỏi file (link hoặc tạo mới) trước lần gọi ghi đầu tiên của dự án; probe chỉ ghi vào trang `_vd-probe`, màn ghi vào trang `Màn hình` (tên trang lấy từ `--page`, mặc định `Screens`). Không ghi song song vào cùng một file.
- **Chạy lại không tạo trùng:** biến, collection, text style, effect style tìm theo tên trước khi tạo; frame màn tìm theo `getSharedPluginData('vd','screen')`.
- **Không đè phần sửa tay:** khi ghi xong một màn, bộ dựng lưu chữ ký nội dung (`vd/sig`) lên frame gốc. Lần ghi sau tính lại chữ ký; khác chữ ký đã lưu → không xoá, trả `edited: true`, màn đó đánh dấu `skippedEdited` trong `state.json` và báo cáo. Chỉ ghi đè khi người dùng bảo (`--force <màn>`).
- **ID:** mọi node dựng ra có `setSharedPluginData('vd','id', <id spec>)`; frame gốc có thêm `vd/screen`, `vd/file`. Sổ ID theo quy ước dự án để kế hoạch 3b.
- **Gắn biến chỉ khi giá trị khớp:** node chỉ được gắn biến khi giá trị trong spec đích bằng giá trị của token (sai khác ≤ 0,01 px hoặc cùng hex + alpha). Không khớp → giữ số cứng, đếm `unbound` theo lý do trong báo cáo.
- **Kiểm tra trên Figma thật dùng lại bộ kiểm tra của kế hoạch 1–2**, không viết bộ thứ hai. Ngưỡng như cũ (khung ≤ 0,5 px, chữ ≤ 1 px). Node không đọc ngược được tính là chưa kiểm tra (lớp 1), màn đó không đạt.
- Không gửi dữ liệu cá nhân của người dùng vào Figma (tên file, tên trang, mô tả biến chỉ lấy từ dự án). Không ghi file ngoài `--out`; `state.json`, lô, kết quả, ảnh đều nằm trong `--out/figma/`.
- Không làm hỏng kế hoạch 1–2: `layout.mjs` và `ds.mjs` chạy như cũ, test cũ giữ nguyên; số nghiệm thu chỉ được đổi ở Task 2 và phải ghi lý do.
- Allowlist và câu trả lời chuẩn hoá: agent không bao giờ tự thêm `approved: true` hay câu trả lời vào `vd-rules.json`.

## Review Focus

1. Một màn mã hoá xong vượt 50 KB (màn dày nhất corpus: spec gốc 39 KB) → `planBatches` ném lỗi có tên màn và byte, không ra lô hỏng (Task 4, test `oversize screen`).
2. Font trong spec không có trong tài khoản Figma (`listAvailableFontsAsync` thiếu họ/kiểu) → bộ dựng dùng font thay thế gần nhất **và** ghi `fontMissing` vào kết quả; `check` báo node đó, không lặng lẽ thành Inter (Task 5, test `missing font is reported`).
3. Chạy lại một lô đã xong hoặc lô bị ngắt giữa chừng → không có frame, biến, style trùng; lô đã `done` bị bỏ qua trừ khi `--redo` (Task 5 test `rerun replaces`, Task 7 test `resume`).
4. Người dùng sửa tay một màn trong Figma rồi chạy lại → màn đó không bị xoá, báo `skippedEdited` (Task 5 test `edited frame is kept`).
5. Thiếu ảnh chụp, thiếu node trong kết quả, hoặc kết quả JSON hỏng → `check` đếm node chưa kiểm tra, màn không đạt, lý do ghi rõ; không bao giờ báo đạt (Task 7 test `missing shot`, `missing node`).

---

### Task 1: Thử bốn giả định trên Figma thật (probe)

**Files:**
- Create: `plugins/vuong-design/core/figma-probe.mjs`, `plugins/vuong-design/core/figma-facts.json` (ghi sau khi chạy thật)
- Test: `plugins/vuong-design/test/figma-probe.test.mjs`

**Interfaces:**
- Produces: `probePayload(): string` (mã JS gửi thẳng vào `use_figma`, ≤ 20 KB, chỉ tạo/xoá node trong trang `_vd-probe`); `readFacts(result: object): Facts`; `loadFacts(): Facts` (đọc `core/figma-facts.json`, thiếu file → `DEFAULT_FACTS` = giả định hiện tại của `figma-model.mjs`).
- `Facts = { version: 1, measured: string (ngày), lineHeightFrac: 'keep'|'round'|'floor', textBox: 'ceil'|'other', scaleBasis: 'frame'|'padding', zeroWidthAnchor: 'ok'|'moves', scaleInHug: 'ok'|'breaks', strokeOverlay: 'ok'|'off', shrinkFill: { maxWidth: 'ok'|'no', growText: 'ok'|'no' }, baseline: 'ok'|'off' }`.
- Các ca trong probe (mỗi ca một frame, đọc `absoluteBoundingBox` / thuộc tính sau khi dựng):
  - `lh`: chữ 15 px, line-height 17,4 px và 21,75 px → đọc `lineHeight.value` và chiều cao khung (1 và 3 dòng).
  - `tb`: chữ HUG có letter-spacing 0,5 px → chiều rộng so với `figmaTextBox`.
  - `scale`: cha có viền 2 px và padding 10, con absolute SCALE 50 % → resize cha từ 200 lên 320, đọc x/w con (tính theo khung hay theo vùng trong padding).
  - `zero`: khung rộng 0,01 mang SCALE, con treo L/R bên trong → resize cha, đọc x con.
  - `hug`: con SCALE trong cha HUG → resize nội dung, đọc con.
  - `overlay`: ô FILL có viền vẽ bằng khung absolute LR/TB phủ trên, `strokesIncludedInLayout=false` → kích thước ô không đổi khi đổi viền 1 → 4 px.
  - `shrink` (cho Planora s3): hàng H rộng 240, avatar 32 FIXED + khối chữ (a) FILL + `maxWidth` 180, (b) `layoutGrow=1` + chữ `textAutoResize='HEIGHT'` → đọc bề rộng khối chữ ở cha 240 và 360.
  - `base`: hàng H `counterAxisAlignItems='BASELINE'` chữ 22 px và 12,5 px → độ lệch chân chữ ≤ 0,5 px.

- [ ] **Step 1: Viết test** `figma-probe.test.mjs`: `probePayload()` dài ≤ 20 000 byte và đúng cú pháp (`new AsyncFunction('figma', src)` không ném lỗi; chạy thật chỉ ở Step 5); `readFacts` với kết quả mẫu (dựng tay trong test, mỗi ca có số đo) ra đúng `Facts` cho cả hai nhánh của từng trường (ví dụ `lh` cao 17 → `round`, 17,4 → `keep`); `loadFacts()` khi không có file → `DEFAULT_FACTS` với `lineHeightFrac: 'keep'`, `scaleBasis: 'frame'`, `zeroWidthAnchor: 'ok'`, `scaleInHug: 'ok'`, `strokeOverlay: 'ok'`.
- [ ] **Step 2: Chạy** `node --test plugins/vuong-design/test/figma-probe.test.mjs` → FAIL (chưa có module).
- [ ] **Step 3: Viết** `figma-probe.mjs`. Payload xoá các frame cũ trong `_vd-probe` trước khi dựng, trả `{ cases: { lh: {...}, tb: {...}, ... }, errors: [] }`.
- [ ] **Step 4: Chạy lại** → PASS.
- [ ] **Step 5: Chạy thật.** Hỏi người dùng file Figma dùng cho thử (link, hoặc tạo file mới "vuong-design probe"). Load skill `figma:figma-use`, `create_session`, gửi `probePayload()` bằng `use_figma` (1 lượt). Lưu kết quả vào `--out`, chạy `readFacts`, ghi `core/figma-facts.json` (định dạng ổn định, có `measured: "2026-11-23"`). Ghi các con số đo vào README mục "Figma facts".
- [ ] **Step 6: Commit** `feat(vuong-design): Figma probe for line-height, SCALE, zero-width anchor, stroke overlay, shrink`.

### Task 2: Đưa kết quả probe vào bản mô phỏng

**Files:**
- Modify: `plugins/vuong-design/core/figma-model.mjs`, `plugins/vuong-design/core/proxy.mjs`, `plugins/vuong-design/core/infer.mjs` (chỉ chỗ gán SCALE/khung neo)
- Test: `plugins/vuong-design/test/figma-model.test.mjs`, `plugins/vuong-design/test/proxy.test.mjs`

**Interfaces:**
- Consumes: `loadFacts()`.
- Produces: `applyFigmaModel(spec, fontMap, { rendered, facts })` (mặc định `facts = loadFacts()`). Hành vi theo từng trường, mỗi nhánh có một cờ trong báo cáo:
  - `lineHeightFrac: 'round'|'floor'` → line-height lẻ của chữ được làm tròn theo cách đó trong spec mô hình, cờ `figmaLineHeight`. `'keep'` → không đổi.
  - `scaleBasis: 'padding'` → SCALE chỉ được giữ khi cha không có viền; nếu cha có viền (khối chứa ≠ khung) → đổi sang ràng buộc cố định như R47 đã nói, cờ `scaleBasis`.
  - `zeroWidthAnchor: 'moves'` → không dùng khung neo rộng 0: node % vị trí + kích thước cố định giữ ràng buộc cố định, cờ `noAnchor`.
  - `scaleInHug: 'breaks'` → không gán SCALE cho con của cha HUG, cờ `scaleInHug`.
  - `strokeOverlay: 'off'` → bỏ cách vẽ viền thành lớp phủ, thay bằng trừ độ dày viền khỏi kích thước ô FILL trong spec mô hình.
  - `shrinkFill`: nếu (a) hoặc (b) `ok`, node có cờ `shrink` (khung bị co nhỏ hơn nội dung, như s3 `n.0.13.0`) được mô hình theo cách đó (ưu tiên (b)), bỏ cờ `shrink`, thêm cờ `shrinkModelled`; cả hai `no` → giữ nguyên như hiện nay.
- [ ] **Step 1: Viết test** cho từng nhánh trên spec dựng tay (một test mỗi trường, gọi `applyFigmaModel` với `facts` truyền vào): ví dụ `lineHeightFrac:'round'` + lh 17,4 → 17 và có cờ `figmaLineHeight`; `facts` mặc định → spec giống hệt trước (so `JSON.stringify` với kết quả cũ).
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết** theo `figma-facts.json` thật. **Step 4: Chạy** cả bộ test → PASS.
- [ ] **Step 5: Chạy nghiệm thu (a) và (b)** như README. Ghi số mới vào README (bảng Acceptance, dòng "after plan 3 Task 2"), so với 20/25 và 23/25; mỗi số đổi phải có lý do theo cờ ở trên. Nếu s3 Planora đạt nhờ `shrinkModelled`, ghi rõ.
- [ ] **Step 6: Commit** `feat(vuong-design): model the measured Figma facts in the proxy`.

### Task 3: Bảng token theo node

**Files:**
- Modify: `plugins/vuong-design/core/tokens.mjs`, `plugins/vuong-design/core/ds.mjs`
- Test: `plugins/vuong-design/test/tokens.test.mjs`, `plugins/vuong-design/test/ds.test.mjs`

**Interfaces:**
- Produces: `tokenMap(inv: Inventory, tokens): TokenMap` trong `tokens.mjs`, `TokenMap = { [screen]: { [nodeId]: { [prop]: tokenPath } } }`, `tokenPath` dạng `role.text-muted` (có token vai trò) hoặc `primitive.color.c03`; `prop` như `Use.prop` của kế hoạch 2 (`bg`, `color`, `borderT`, `p0`…`p3`, `g`, `cg`, `radius0`…, `w`, `h`, `type`, `shadow`, `opacity`). `ds.mjs` ghi thêm `<out>/token-map.json` (tất định, khoá sắp xếp).
- [ ] **Step 1: Viết test**: inventory nhỏ có một màu có vai trò và một màu không vai trò → map trỏ `role.*` và `primitive.color.*`; chữ → `type` trỏ `primitive.typography.*`; giá trị `ask` chưa áp (còn giá trị gốc khác token) → không có trong map; đảo thứ tự màn → `token-map.json` giống hệt từng byte.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): per-node token map for Figma variable binding`.

### Task 4: Mã hoá spec và chia lô

**Files:**
- Create: `plugins/vuong-design/core/figma-encode.mjs`
- Test: `plugins/vuong-design/test/figma-encode.test.mjs`

**Interfaces:**
- Consumes: spec đích từng màn (`spec-norm-<s>.json`, đã qua `applyFigmaModel`), `TokenMap`, `screen.svgDefs`, `screen.W`.
- Produces:
  - `encodeScreen(spec, ctx: { screen, file, W: [A, B], map, svgDefs, tables }): Enc` — dữ liệu gọn theo kiểu bản thử: khoá một chữ, bỏ giá trị mặc định, bảng dùng chung `tables = { C: string[] (hex có alpha), F: array (bộ font), I: array (icon [viewBox, markup]), V: string[] (tên biến) }`; tham chiếu biến bằng chỉ số vào `V`. Mỗi node mang `o` (id spec) để đọc ngược.
  - `planBatches(encs: Enc[], { limit = PAYLOAD_LIMIT, runtime: string }): Batch[]`, `Batch = { n, screens: string[], bytes, code: string }` — gom màn theo thứ tự cho đến khi `runtime + dữ liệu` chạm `limit`; mỗi lô mang bảng chỉ gồm phần nó dùng.
  - `class OversizeError extends Error { screen, bytes }`.
- [ ] **Step 1: Viết test**: spec nhỏ mã hoá rồi giải mã (`decodeForTest`, chỉ trong test) ra lại đúng cây; giá trị mặc định (padding 0, `pa:'S'`) không có trong dữ liệu; 18 màn Planora từ fixture rút gọn chia lô, mọi lô ≤ 50 000 byte, mỗi màn nằm đúng một lô; `oversize screen`: một màn giả 60 KB → `OversizeError` có `screen` và `bytes`; mã hoá tất định (hai lần → cùng chuỗi).
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS. Ghi kích thước trung bình mỗi màn Planora vào README (bản thử: khoảng 8 KB/màn).
- [ ] **Step 5: Commit** `feat(vuong-design): compact Figma encoding and batches under 50 KB`.

### Task 5: Bộ dựng chạy trong Figma

**Files:**
- Create: `plugins/vuong-design/core/figma-runtime.js` (mã thuần đặt vào lô, có chỗ `__DATA__`), `plugins/vuong-design/test/fake-figma.mjs`
- Test: `plugins/vuong-design/test/figma-runtime.test.mjs`

**Interfaces:**
- Consumes: `Enc`, `tables` của Task 4; mã của bản thử spike3 làm điểm xuất phát.
- Produces: kết quả trả về của một lô `BatchResult = { batch, page, screens: [{ screen, root, edited?, sig, nodes: { [o]: { fid, A: [x,y,w,h], B: [x,y,w,h], text?, runs?, fills?, strokes?, radius?, op?, font?, icon?, vars?: { [prop]: name } } }, fontMissing: [{ o, family, style, used }], errors: [{ o, msg }] }] }`. Hộp đọc ở độ rộng A, rồi `resize` frame gốc sang B, đọc lại, trả về A. Đơn vị và gốc toạ độ như `renderProxy` (tương đối với frame gốc).
- Bộ dựng phải: theo đúng thứ tự trong spec mục 7 (bật auto layout → `strokesIncludedInLayout=false`; node tuyệt đối và ràng buộc đặt **sau** khi dựng xong cả cây); gắn biến bằng `setBoundVariable` / `setBoundVariableForPaint`, text style bằng `setTextStyleIdAsync`, effect style bằng `setEffectStyleIdAsync`; vẽ `paint.strokeOverlay` theo `figma-facts.json`; lưu `vd/id`, `vd/screen`, `vd/sig`; lỗi ở một node không dừng cả màn (ghi `errors`, node đó thiếu trong `nodes`).
- `fake-figma.mjs`: `makeFakeFigma({ fonts })` cài đủ API mà bộ dựng dùng (tạo node, thuộc tính, plugin data, biến, style, `listAvailableFontsAsync`, `loadFontAsync`); hộp = toạ độ/kích thước đã gán (không tính auto layout). Chỉ để kiểm cấu trúc, hình học kiểm trên Figma thật ở Task 8.
- [ ] **Step 1: Viết test** trên fake: khung có padding/gap gắn biến → `boundVariables.paddingLeft` trỏ đúng biến; màu nền gắn biến; chữ có text style; con absolute có ràng buộc đặt sau `appendChild` cuối cùng; mọi node có `vd/id`; `missing font is reported` (fake thiếu `Be Vietnam Pro` SemiBold → `fontMissing` có mục, node vẫn dựng); `rerun replaces` (chạy lô hai lần → một frame mỗi màn); `edited frame is kept` (đổi `characters` một node trên fake giữa hai lần → lần hai trả `edited: true`, frame cũ còn nguyên); lỗi ở một node → `errors` có mục, các node khác vẫn có trong `nodes`.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS, và kiểm kích thước `figma-runtime.js` ≤ 10 KB (bản thử 6,5 KB).
- [ ] **Step 5: Commit** `feat(vuong-design): Figma builder runtime with variable binding, IDs, edit guard and readback`.

### Task 6: Biến và style từ tokens.json

**Files:**
- Create: `plugins/vuong-design/core/figma-vars.mjs`
- Test: `plugins/vuong-design/test/figma-vars.test.mjs`

**Interfaces:**
- Consumes: `tokens.json`, `makeFakeFigma`.
- Produces: `varsPayload(tokens, { collection = 'vuong-design' }): string[]` (một hoặc vài lô ≤ 50 KB) tạo/cập nhật: collection `Primitive` (màu, space, size, radius, border, opacity dạng FLOAT/COLOR), collection `Role` (biến alias trỏ `Primitive`), text style từ `primitive.typography` (tên `type/<tên token>`), effect style từ `primitive.shadow`; `varNames(tokens): string[]` (bảng `V` của Task 4, cùng thứ tự). Tên biến trong Figma = đường token với `/` (`color/c01`, `role/text-muted`). Mô tả biến = `$description`.
- [ ] **Step 1: Viết test** trên fake: chạy payload → đủ số biến = số token màu + số; alias của `Role` trỏ đúng biến `Primitive`; chạy lại → không thêm biến hay style (đếm trước/sau bằng nhau), giá trị đổi trong tokens thì biến được cập nhật; token typography → text style đúng font, cỡ, line-height px, letter-spacing; payload Planora (tokens thật 210 KB) chia ≤ 50 KB mỗi lô.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): Figma variables, text and effect styles from tokens.json`.

### Task 7: CLI `figma.mjs` (plan, ingest, check) và kiểm tra trên Figma thật

**Files:**
- Create: `plugins/vuong-design/core/figma.mjs`, `plugins/vuong-design/core/figma-check.mjs`
- Modify: `plugins/vuong-design/core/mutate.mjs` (thêm lỗi cài trên kết quả đọc ngược), `plugins/vuong-design/core/report-html.mjs` (mục "Figma")
- Test: `plugins/vuong-design/test/figma-cli.test.mjs`, `plugins/vuong-design/test/figma-check.test.mjs`

**Interfaces:**
- Consumes: thư mục ra của `ds.mjs` (`ir.json`, `spec-norm-*.json`, `tokens.json`, `token-map.json`, `report.json`), `planBatches`, `varsPayload`, `verifyScreen` / `measureCrops` của kế hoạch 1.
- Produces:
  - `node core/figma.mjs plan --ds <thư mục ds> --out <dir> [--page Screens] [--max-calls 40] [--force <màn>]` → ghi `<out>/figma/vars-NN.js`, `batch-NN.js`, `state.json`; in ước tính: số lượt `use_figma`, số lượt `get_screenshot`, tổng KB, và cảnh báo nếu vượt `--max-calls`.
  - `node core/figma.mjs ingest --out <dir> --result <file> [--batch N]` → kiểm JSON theo `BatchResult`, gộp vào `state.json` (`batches[n].status: 'done'|'failed'`, `screens[s] = { root, edited?, skippedEdited? }`). Kết quả hỏng → exit 2, không gộp.
  - `node core/figma.mjs check --out <dir> [--mutate]` → với mỗi màn: dựng `figmaProxy = { A: { boxes, dom, png, mark: 'figma-real' }, B: { boxes, dom, mark: 'figma-real' } }` từ `state` + `shot-<màn>.png` (ảnh ở độ rộng A; crop ở B ghi `skipped: 'figma-crop-B'`), gọi `verifyScreen` như kế hoạch 1 với `proxy = figmaProxy` (crop A đo bằng `measureCrops` trên ảnh Figma, nên `check` cần Playwright như `layout.mjs`), thêm một bảng "proxy vs Figma" (lệch lớn nhất giữa hộp bản mô phỏng `norm` và hộp Figma, theo node) vào `report.json` / `report.html`. Exit 0 khi mọi màn qua cổng, 1 nếu không, 2 khi lỗi dùng lệnh.
  - `figmaDom(node): DomRecord` trong `figma-check.mjs`: chuyển một mục `nodes[o]` sang đúng dạng `dom` của `renderProxy` (`text`, `runs`, `color`, `bg`, `ff`, `op`, `stroke`, `radius`, `icon`) để lớp 3 dùng lại nguyên.
  - Lỗi cài trên dữ liệu đọc ngược (`--mutate`): `figMove` (dời hộp 3 px), `figText` (đổi một ký tự), `figFill` (đổi màu nền), `figDrop` (xoá một node khỏi `nodes`). Mỗi loại phải bị bắt; lỗi bị bỏ sót → exit 1.
- [ ] **Step 1: Viết test**: `plan` trên thư mục ds dựng tay (2 màn) → có `batch-01.js` ≤ 50 000 byte, `state.json` có 2 màn `pending`, ước tính in ra số lượt đúng; `resume`: ingest lô 1 xong rồi `plan` lại → lô 1 không sinh lại; `ingest` JSON hỏng → exit 2, state không đổi; `check` với kết quả khớp HTML → màn đạt; `missing shot` → crop A ghi chưa kiểm tra, màn không đạt; `missing node` → node đếm vào `unchecked`, màn không đạt; `figmaDom` trên một node chữ hai kiểu → `runs` cùng dạng proxy; `--mutate` trên màn mẫu → 4/4 lỗi bị bắt.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** cả bộ test → PASS.
- [ ] **Step 5: README:** mục "Figma CLI": ba lệnh, vòng làm việc của AI (plan → gửi từng lô bằng `use_figma` → lưu kết quả → ingest → `get_screenshot` từng màn, tải bằng curl thành `shot-<màn>.png` → check), bảng file ra.
- [ ] **Step 6: Commit** `feat(vuong-design): figma CLI (plan, ingest, check) with real-Figma verification`.

### Task 8: Nghiệm thu trên Figma thật (Planora)

**Files:**
- Modify: `plugins/vuong-design/README.md` (mục Acceptance: "Figma"), `E:\tools\Planora\docs\design\figma-plan.md` (bảng trạng thái, repo khác: commit riêng ở nhánh hiện tại của Planora, chỉ file này)

- [ ] **Step 1: Hỏi người dùng** file Figma cho Planora (file mới "Planora Design" hay file có sẵn) và báo ước tính từ `figma.mjs plan` (dự kiến 2–3 lô biến, 4–6 lô màn, 18 ảnh, tổng khoảng 30 lượt). Chỉ làm tiếp khi người dùng đồng ý.
- [ ] **Step 2: Chạy** `ds.mjs` trên `planora-ui-screens.html` với `--rules E:/tools/Planora/docs/design/vd-rules.json`, rồi `figma.mjs plan`, gửi các lô `vars-*` rồi `batch-*` bằng `use_figma` (skill `figma:figma-use` đã load), ingest từng kết quả, chụp từng màn, `figma.mjs check --mutate`.
- [ ] **Step 3: Ghi số** vào README: số màn đạt trên Figma thật so với bản mô phỏng (bản mô phỏng: 16/18 với file luật Planora), lệch lớn nhất proxy vs Figma (mục tiêu ≤ 0,5 px khung, ≤ 1 px chữ; vượt thì liệt kê node và nguyên nhân), số node `unbound` theo lý do, `fontMissing`, lỗi cài bắt/sót, số lượt gọi thật và KB đã gửi. Nếu proxy và Figma lệch nhau có hệ thống, ghi nguyên nhân và đề xuất sửa `figma-facts.json` / `figma-model.mjs`, chưa sửa trong task này.
- [ ] **Step 4: Chạy lại không đổi gì** (`plan` + gửi lại một lô) → không có frame, biến, style trùng; sửa tay một chữ trong Figma rồi gửi lại lô đó → màn đó `skippedEdited`. Ghi kết quả vào README.
- [ ] **Step 5: Cập nhật** `figma-plan.md` của Planora: dòng kế hoạch 3 (trạng thái, link file Figma, số đạt), ghi kế hoạch 3b. Không ghi thông tin cá nhân.
- [ ] **Step 6: Commit** plugin `docs(vuong-design): plan 3 acceptance on real Figma` và Planora `docs(design): Planora screens written to Figma by vuong-design (plan 3)`.
