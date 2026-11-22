# vuong-design kế hoạch 2: design system + chuẩn hoá (chạy trên máy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ kết quả của kế hoạch 1 (IR đo được + spec đã mô hình Figma), rút ra mọi giá trị đang dùng, gom theo vai trò, chuẩn hoá theo thứ tự cố định của spec mục 9 (mỗi chỗ sửa có mã lý do), xuất `tokens.json` (W3C DTCG, 3 tầng) + `tokens.css`, trang đề xuất có hình và báo cáo độ phủ. Bộ kiểm tra của kế hoạch 1 chứng minh rằng spec đã chuẩn hoá chỉ khác spec gốc đúng ở những chỗ báo cáo ghi, không hơn. Vẫn không gọi Figma.

**Architecture:** Thêm vào chuỗi của kế hoạch 1: `capture` (thêm biến CSS) → `infer` → `figma-model` → **`inventory`** (thu giá trị + khoá vai trò) → **`normalize`** (luật mục 9 + câu trả lời đã lưu) → **`apply-norm`** (spec đích) → `proxy` (thêm bản mô phỏng thứ ba, mark `norm`) → `verify` (lệch giữa bản `norm` và bản `figma` chỉ được giải thích bởi một mục chuẩn hoá) → **`tokens`** / **`coverage`** / **`ds-report`**. CLI `ds.mjs` nối tất cả. Kế hoạch 3 (ghi Figma) đọc `tokens.json`, spec đích và `normalisation.json`.

**Tech Stack:** như kế hoạch 1 (Node ≥ 18, ESM `.mjs`, `node:test`, Playwright bên ngoài, không thêm thư viện). Toán màu (sRGB/OKLCH/Lab, CIEDE2000, tương phản WCAG) tự viết, có vector test chuẩn.

**Spec:** `docs/superpowers/specs/2026-11-21-vuong-design-plugin-design.md` mục 8, 9, 14 (lớp 5), 15 (hai chế độ), 18. Kế hoạch 1: `docs/superpowers/plans/2026-11-21-vuong-design-plan-1-layout-engine.md` và README của plugin (các quyết định R1–R61 nằm trong comment đầu file mã).

Các kế hoạch tiếp theo: 3 ghi Figma (biến từ `tokens.json`, text style, nhận diện component có trạng thái, cập nhật theo phần khác, bảo vệ phần sửa tay, sổ ID, `design-data.json`; thử line-height số lẻ, SCALE so với padding box, khung neo kích thước 0, SCALE trong cha HUG), 4 đóng gói plugin (skill, lệnh, hai chế độ, ngân sách, chạy tiếp).

## Global Constraints

- Mã ở `plugins/vuong-design/core/`, test ở `plugins/vuong-design/test/`, nhánh `feat/vuong-design-ds`. Không có phụ thuộc npm.
- **Không âm thầm sửa giá trị.** Mọi giá trị trong spec đích khác spec gốc phải có đúng một mục trong `normalisation.json` (node, thuộc tính, cũ, mới, mã lý do). Bộ kiểm tra từ chối mọi chỗ lệch không có mục (Task 6).
- **Tất định:** cùng IR + cùng file luật → cùng `normalisation.json`, `tokens.json` từng byte (không phụ thuộc thứ tự node, thứ tự màn, thời gian; không có `Date.now()` trong dữ liệu ra, chỉ trong tiêu đề báo cáo HTML).
- **Màu đã có tên (biến CSS) không bao giờ tự gộp.** Màu chưa có tên chỉ tự gộp khi ΔE2000 < 1 **và** cùng khoá vai trò.
- Lưới 4 áp cho khoảng cách (padding, gap), kích thước FIXED, bo góc. **Không** áp cho cỡ chữ, độ dày viền, hình trong icon, giá trị co giãn (FILL, HUG, space-between, khoảng cách tự động).
- Câu hỏi cho người dùng và câu trả lời nằm trong **file luật của dự án** (`vd-rules.json`, mặc định ở thư mục gốc dự án, `--rules` để đổi). Script không bao giờ tự ghi câu trả lời; chỉ người dùng (hoặc AI theo lời người dùng) ghi. Câu đã trả lời không hỏi lại.
- **Hai chế độ (mục 15):** không có câu trả lời → dùng phương án an toàn (giữ giá trị gốc), mục chuẩn hoá ở trạng thái `ask` kèm `proposal`, không áp vào spec đích. Có câu trả lời → áp, trạng thái `answered`.
- Báo cáo cho người đọc bằng tiếng Anh, **mọi con số có đơn vị** (px, %, ΔE, :1), mỗi mục có một dòng kết luận, có phần "How to read" cố định (memory report-readability).
- Không ghi file ngoài `--out`, không có ngoại lệ: `vd-rules.json` và `vd-names.json` chỉ được đọc. Không sửa HTML nguồn. Không gửi dữ liệu ra mạng ngoài các font Google như kế hoạch 1.
- Không làm hỏng kế hoạch 1: chạy không có `vd-rules.json` và không bật `--ds` thì kết quả `layout.mjs` y như trước (test cũ giữ nguyên, số trên bộ nghiệm thu không đổi).
- Allowlist: agent không bao giờ thêm mục `approved: true` (chỉ người dùng). Tương tự, agent không bao giờ ghi câu trả lời vào `vd-rules.json` của bộ nghiệm thu; test dùng file luật riêng trong `test/fixtures/`.

## Review Focus

1. Một giá trị bị đổi trong spec đích mà không có mục chuẩn hoá, hoặc mục có `new` khác giá trị thật trong spec đích → bộ kiểm tra phải bắt (Task 6, mutation `normSilent`, `normWrongValue`).
2. Màu có tên bị gộp, hoặc hai màu ΔE < 1 nhưng khác vai trò bị gộp → sai (Task 4 test).
3. Giá trị co giãn (FILL/HUG/sb) bị gán con số, hoặc độ dày viền / cỡ chữ bị đưa về lưới 4 → sai (Task 4).
4. Màu viết bằng `oklch()`, `color(srgb …)`, `hsl()`, có alpha, `currentColor` trong SVG → đọc đúng hoặc báo `unparsed`, không bao giờ thành đen (Task 3).
5. Chạy hai lần, đảo thứ tự màn → `tokens.json` và `normalisation.json` giống hệt (Task 9 test).
6. Trang đề xuất: mỗi token có ô mẫu + tên + giá trị có đơn vị + số chỗ dùng; mục `ask` hiện đề xuất và lệnh trả lời (Task 8).

---

### Task 1: Biến CSS trong capture

**Files:**
- Modify: `plugins/vuong-design/core/capture.mjs`
- Create: `plugins/vuong-design/test/fixtures/vars.html`
- Test: `plugins/vuong-design/test/capture-vars.test.mjs`

**Interfaces:**
- Produces: `screen.vars = { '--name': { value: string (giá trị đã tính ở :root), uses: number } }` (chỉ biến được khai báo trong CSS của trang, không lấy biến của trình duyệt); `INode.tok = { [prop]: '--name' }` với prop ∈ `bg`, `color`, `border` (từng cạnh `borderT|R|B|L`), `radius`, `shadow`, `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`, `letterSpacing`, `padding` (từng cạnh), `gap`, `width`, `height`, `opacity`, `fill`, `stroke`.
- Cách gán: duyệt CSSOM (cả `<style>` và stylesheet cùng nguồn; sheet không đọc được thì đếm vào `screen.varsUnreadable`), lấy các khai báo chứa `var(--x)`. Với mỗi phần tử khớp selector, gán `tok[prop] = '--x'` **chỉ khi** giá trị của biến tại phần tử đó (`getComputedStyle(el).getPropertyValue('--x')`, chuẩn hoá cùng cách với giá trị đã tính) bằng giá trị đã tính của thuộc tính. Không bằng (bị luật khác đè) → không gán. Khai báo lồng (`var(--a, var(--b))`, `calc(var(--s) * 2)`) → không gán, đếm `screen.varsComplex`.

- [ ] **Step 1: Viết test** trên `vars.html`: màu nền qua biến → `tok.bg`; `border: 1px solid var(--line)` → `tok.borderT…L`; biến bị đè trong một khối con (`.dark { --fg: … }`) → tok trỏ đúng tên, giá trị khớp; khai báo `var()` bị một luật cụ thể hơn không dùng biến đè → không có tok; `calc(var(--s)*2)` → không có tok, `varsComplex` ≥ 1; trang không có biến → `vars` rỗng, không lỗi.
- [ ] **Step 2: Chạy** `node --test plugins/vuong-design/test/` → FAIL.
- [ ] **Step 3: Viết** phần đọc biến trong trang (một lượt duyệt CSSOM, `el.matches(selector)` cho từng luật có biến; giới hạn chi phí: chỉ phần tử trong gốc màn).
- [ ] **Step 4: Chạy lại** cả bộ test → PASS; chạy bộ nghiệm thu, số của kế hoạch 1 không đổi (19/25, 1 root, 8 approvals, 6 crops + 1 linked).
- [ ] **Step 5: Commit** `feat(vuong-design): capture CSS custom properties and per-node token use`.

### Task 2: Thu giá trị và khoá vai trò (inventory)

**Files:**
- Create: `plugins/vuong-design/core/inventory.mjs`
- Test: `plugins/vuong-design/test/inventory.test.mjs`

**Interfaces:**
- Consumes: `screen` (IR, có `vars`, `tok`), `modelled.spec` (SNode của kế hoạch 1).
- Produces: `inventory(screens: [{ screen, spec }]): Inventory` với `Inventory = { uses: Use[], vars }`, `Use = { screen, node, cat, prop, value, raw, role, token?, flex? }`.
  - `cat`: `color` | `space` | `size` | `radius` | `border` | `type` | `shadow` | `opacity` | `icon`.
  - `space` lấy từ spec: `lay.p[i]`, `lay.g`, `lay.cg` (chỉ khi có số; `sb` hoặc khoảng cách tự động → `flex: 'sb'`, không có value). `size` chỉ trục `FIXED` của khung (không lấy chữ, icon lấy riêng `cat: 'icon'`). `type` là bộ `{ family, size, weight, style, lineHeight, letterSpacing, transform }` của từng đoạn chữ (runs) trong spec đã mô hình (family là font Figma sau thay thế; `raw` giữ font gốc).
  - `role`: khoá cấu trúc tất định = `cat` + `prop` + chữ ký phần tử (`tag` + danh sách class đã sắp xếp, bỏ class trạng thái `is-*`, `active`, `selected`, `disabled`, `on`) + chữ ký cha (cùng cách). Hai phần tử cùng khoá = "cùng vai trò theo cấu trúc" của mục 9 bước 4.
  - `token`: tên biến nếu `tok[prop]` có (Task 1).

- [ ] **Step 1: Viết test** trên spec dựng tay: khung padding 12 → 4 `Use` space; khung `sb` → `flex: 'sb'`, không value; FILL/HUG → không có `Use` size; viền 1px → `cat: 'border'`, không vào `space`; hai `.chip.is-on` và `.chip` cùng cha → cùng `role`; chữ hai kiểu lồng nhau → 2 `Use` type; inventory tất định khi đảo thứ tự màn và node.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết** `inventory.mjs`. **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): value inventory with structural role keys`.

### Task 3: Toán màu

**Files:**
- Create: `plugins/vuong-design/core/color.mjs`
- Test: `plugins/vuong-design/test/color.test.mjs`

**Interfaces:**
- Produces: `parseColor(css): { r, g, b, a } (sRGB 0–1) | { unparsed: css }` (đọc `#rgb[a]`, `#rrggbb[aa]`, `rgb[a]()` cả cú pháp dấu cách và `/ a`, `hsl[a]()`, `hwb()`, `color(srgb|display-p3 …)` (p3 chuyển về sRGB, ngoài gam thì kẹp và ghi `clamped: true`), `oklch()`, `oklab()`, `lab()`, `lch()`, từ khoá tên màu, `transparent`; `currentColor` và mọi thứ khác → `unparsed`); `toHex(c)` (`#rrggbb` hoặc `#rrggbbaa`); `deltaE2000(c1, c2)`; `contrast(fg, bg)` (WCAG 2.x, fg có alpha thì trộn lên bg trước); `oklchOf(c)`.

- [ ] **Step 1: Viết test**: 34 cặp vector của Sharma, Wu, Dalal (2005) cho CIEDE2000 (sai số ≤ 1e-4); `contrast('#000', '#fff') = 21`, `contrast('#777', '#fff') ≈ 4.48`; `oklch(0.7 0.1 200)` khớp giá trị tham chiếu (tính bằng chính Chrome trong test: render ô màu, đọc `getComputedStyle` sau khi ép `color-mix(in srgb, …)`, hoặc dùng giá trị cứng đã kiểm tra) sai số ≤ 1/255; `currentColor` → `unparsed`, không bao giờ `{0,0,0}`.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): color parsing, CIEDE2000 and WCAG contrast`.

### Task 4: Bộ chuẩn hoá (normalize)

**Files:**
- Create: `plugins/vuong-design/core/normalize.mjs`, `plugins/vuong-design/core/rules-file.mjs`, `plugins/vuong-design/test/fixtures/rules-*.json`
- Test: `plugins/vuong-design/test/normalize.test.mjs`

**Interfaces:**
- Consumes: `Inventory`, `rules = readRules(path)` (không có file → luật rỗng).
- Produces: `normalize(inv, rules, opts): { entries: Entry[], questions: Question[] }`.
  - `Entry = { id, cat, role, prop, nodes: [{ screen, node }], from, to, code, status: 'auto'|'answered'|'ask'|'kept', proposal?, question? }`. `status: 'ask'` không áp (spec đích giữ `from`). `id` tất định (băm của `cat|role|prop|from`).
  - Mã lý do, theo đúng thứ tự mục 9 (dừng ở bước đầu tiên áp được): `TOKEN` (có tên → giữ, `kept`), `FLEX` (giá trị co giãn → không số, `kept`), `IN_SCALE` (đã trên lưới 4 / trong thang → giữ, `kept`; mục `kept` không ghi vào `entries` mà chỉ đếm theo mã), `ROLE_MAJORITY` (số ngoài thang, các `Use` cùng `role` có một giá trị chiếm đa số tuyệt đối và giá trị đó trong thang → lấy giá trị đó, `auto`), `GRID4` (không có đa số → hỏi; `proposal` = bội số của 4 gần nhất, hoà thì lấy số lớn hơn; `ask` hoặc `answered`), `COLOR_DE1` (màu chưa có tên, ΔE2000 < 1 với màu phổ biến hơn cùng `role` → gộp, `auto`), `COLOR_NEAR` (ΔE < 3 khác vai trò, hoặc một trong hai có tên → hỏi, `proposal` = màu phổ biến hơn), `TYPE_SCALE` (một câu hỏi cấp dự án: có đưa cỡ chữ về thang không; thang đề xuất = các cỡ đang dùng nhiều nhất, cỡ lẻ ghép vào cỡ gần nhất cùng vai trò), `LINE_HEIGHT_INT` (line-height lẻ px → làm tròn số nguyên; một câu hỏi cấp dự án, đề xuất "có"; đây là lời giải cho 8 mục chữ làm tròn của kế hoạch 1), `ICON_FRAME` (khung icon không phải 16/20/24 → đề xuất cỡ chuẩn gần nhất, hỏi), `SRC_SQUASH` (icon/ảnh FIXED bị co ở một độ rộng do flex-shrink: kích thước ở A khác B và khác kích thước khai báo → đề xuất giữ kích thước khai báo ở cả hai, hỏi; đây là trường hợp avatar `.say` của Planora s3/s4).
  - `Question = { key, cat, text (tiếng Anh, một câu), options, default, affects: số node }`. `key` tất định; `rules.answers[key]` là câu trả lời.
  - `rules-file.mjs`: `readRules(path)` (kiểm tra `version`, khoá lạ → lỗi rõ ràng kèm tên khoá), `rulesTemplate(questions)` (bản nháp để người dùng điền; script chỉ ghi nó vào `--out`, không bao giờ vào đường dẫn `--rules`).

- [ ] **Step 1: Viết test** cho từng mã: padding 13 với 5 khung cùng vai trò padding 12 → `ROLE_MAJORITY` 13→12; padding 13 không có đa số → `GRID4` `ask`, `proposal` 12, spec giữ 13; cùng câu đó có câu trả lời "12" trong file luật → `answered`; 14 → hoà 12/16 → `proposal` 16; viền 1px và cỡ chữ 15 không bao giờ thành mục `GRID4`; màu `#1a73e8` và `#1a74e8` (ΔE < 1) cùng vai trò → `COLOR_DE1`; cùng cặp khác vai trò → `COLOR_NEAR` `ask`; một trong hai có `token` → không bao giờ `auto`; line-height 20.8 → `LINE_HEIGHT_INT` `ask` 21; icon 18px → `ICON_FRAME` `proposal` 20; avatar 40/32 ở A/B có `width: 40px` khai báo → `SRC_SQUASH`; chạy hai lần và đảo thứ tự → `entries` giống hệt (so JSON).
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): ordered normalisation rules with reason codes and a project rules file`.

### Task 5: Áp chuẩn hoá vào spec (apply-norm)

**Files:**
- Create: `plugins/vuong-design/core/apply-norm.mjs`
- Test: `plugins/vuong-design/test/apply-norm.test.mjs`

**Interfaces:**
- Consumes: `modelled.spec` một màn, `entries` (chỉ `auto` và `answered`).
- Produces: `applyNorm(spec, entries, screenId): { spec: SNode (bản sao, spec gốc không đổi), applied: [{ entry, node, prop, from, to }] }`. Mỗi `applied` phải tìm thấy node và giá trị cũ đúng bằng `from`; không thấy hoặc khác → ném lỗi (không bỏ qua im lặng). Khung HUG có con bị đổi kích thước: không tự tính lại kích thước (bản mô phỏng tính); ghi `w`/`h` đích chỉ cho trục FIXED.

- [ ] **Step 1: Viết test**: padding 13→12 đổi đúng `lay.p`; màu đổi đúng `paint.bg` và đoạn chữ; `from` không khớp → lỗi có tên node; mục `ask` không đổi gì; spec vào không bị sửa (so `structuredClone` trước và sau).
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): apply approved normalisation to the modelled spec`.

### Task 6: Kiểm tra chuẩn hoá (bản mô phỏng thứ ba, verify, mutate)

**Files:**
- Modify: `plugins/vuong-design/core/pipeline.mjs`, `plugins/vuong-design/core/verify.mjs`, `plugins/vuong-design/core/mutate.mjs`
- Test: `plugins/vuong-design/test/verify.test.mjs`, `plugins/vuong-design/test/mutate.test.mjs` (thêm test)

**Interfaces:**
- `runScreen(..., opts.norm = { spec, applied })`: dựng và render thêm bản mô phỏng `norm` (mark `norm`) ở A và B. Không có `opts.norm` → y như cũ.
- `verify`: lớp 2–3 chạy trên bản `norm` thay cho bản `figma` khi có. Một root lệch so với nguồn được giải thích `explainedBy: 'norm'` (kèm `entry` id) **chỉ khi**: (a) phần lệch của node đó giữa bản `norm` và bản `figma` lớn hơn ngưỡng và tự nó là root của phần lệch đó (theo cách R18 tính root cho figmaModel), (b) node đó hoặc khung cha bố cục trực tiếp của nó có một `applied`, và (c) phần lệch còn lại sau khi trừ phần chuẩn hoá vẫn nằm trong ngưỡng hoặc đã được figmaModel giải thích. Ảnh cắt lệch: giải thích bằng `norm` chỉ khi chính node đó có `applied` loại màu / bo góc / icon (R61 vẫn áp: kích thước khung được giải thích không tha ảnh cắt của icon/ảnh, trừ mục `ICON_FRAME` / `SRC_SQUASH` của chính icon đó). Root `norm` không cần duyệt allowlist; mục `ask` không bao giờ giải thích gì.
- Báo cáo thêm `report.norm = { applied: n, explainedRoots: n, unexplained: [...] }`; `normUnused`: `applied` không làm đổi gì có thể đo (màu ΔE < 1 được miễn) → ghi vào báo cáo, không làm trượt.
- Mutation mới: `normSilent` (đổi một padding trong spec đích mà không có `applied`) và `normWrongValue` (`applied.to` khác giá trị thật trong spec đích 4px). Cả hai phải bị bắt.

- [ ] **Step 1: Viết test** (RED trước): fixture padding 13→12 có `applied` → root explained `norm`; cùng thay đổi không có `applied` → root mở; đổi màu có `applied` → ảnh cắt explained; icon 18→20 với `ICON_FRAME` → ảnh cắt icon explained, cùng thay đổi chỉ ghi ở khung cha → ảnh cắt icon vẫn mở; hai mutation mới bị bắt trên fixture.
- [ ] **Step 2–4:** FAIL → viết → PASS; chạy mutation trên bộ nghiệm thu (`--mutate`), 0 missed.
- [ ] **Step 5: Commit** `feat(vuong-design): verify the normalised spec; every change must come from a report entry`.

### Task 7: tokens.json, tokens.css và độ phủ

**Files:**
- Create: `plugins/vuong-design/core/tokens.mjs`, `plugins/vuong-design/core/coverage.mjs`, `plugins/vuong-design/checklist.json` (có `version`), `plugins/vuong-design/core/names-file.mjs`
- Test: `plugins/vuong-design/test/tokens.test.mjs`, `plugins/vuong-design/test/coverage.test.mjs`

**Interfaces:**
- `buildTokens(inv, entries, names?): { tokens (DTCG), css: string, map: { [useKey]: tokenPath } }`.
  - 3 tầng: `primitive` (giá trị sau chuẩn hoá: `color.*`, `space.*`, `radius.*`, `size.*`, `border.*`, `shadow.*`, `opacity.*`, `font.family|size|weight|lineHeight|letterSpacing.*`, `typography.*` dạng composite), `role` (alias `{primitive…}` theo khoá vai trò gom nhóm: mỗi vai trò dùng ≥ 2 lần hoặc có tên biến gốc thành một token vai trò), `component` (rỗng, kế hoạch 3 điền). Mỗi token có `$type`, `$value`, `$description` (cách dùng: "used by N nodes on M screens: …").
  - Tên mặc định tất định (`color.c01` theo số lần dùng giảm dần rồi theo hex, `space.12`, `radius.8`, `typography.t16-500`); biến CSS gốc giữ tên của nó (`--text-muted` → `role.text-muted`). AI đặt tên theo vai trò qua `vd-names.json` (`{ path: newName }`); `names-file.mjs` kiểm tra tên theo luật DTCG (không có `{`, `}`, `.` trong một đoạn, không bắt đầu bằng `$`), không trùng, không đổi tên token có tên gốc từ biến CSS khi người dùng không yêu cầu (mã `RENAME_NAMED` → cảnh báo).
  - `css`: `:root { --… }` theo tầng vai trò (lớp chuyển đổi CSS của mục 8.2).
- `coverage(checklist, { inv, tokens, screens, rules }): { items: [{ id, group, label, tag: 'ask'|'default'|'derived', state: 'covered'|'missing'|'answered', evidence }] }`. Các mục suy ra được tự kiểm: màu trạng thái (có màu lỗi/đã chọn/tắt không), thang chữ, thang khoảng cách, bo góc, đổ bóng, dark mode (`prefers-color-scheme` trong CSS), **tương phản WCAG AA** của từng đoạn chữ so với nền vẽ gần nhất (chữ < 4.5:1, chữ lớn < 3:1 → danh sách node, không tự sửa), **vùng chạm** (phần tử bấm được `a`, `button`, `[role=button]`, `input` nhỏ hơn 44×44px → danh sách). Mục không suy ra được ở bản 1 → `missing` kèm nhãn của checklist.
- 11 câu hỏi của mục 8.4: `questions` của Task 4 thêm các câu cấp dự án với mặc định rút từ HTML (nền tảng theo độ rộng màn, font chính, màu chủ đạo = màu bão hoà dùng nhiều nhất trên phần tử bấm được, mật độ theo trung vị padding, dark mode, kiểu icon theo font icon, có đổ bóng hay không). Chỉ xác nhận, không chặn chạy.

- [ ] **Step 1: Viết test**: tokens hợp lệ theo DTCG (tự kiểm trong test: mọi node lá có `$value`, alias trỏ tới token tồn tại, không vòng); biến `--line` thành `role.line` alias tới primitive; `vd-names.json` đổi tên → alias đổi theo; tên sai luật → lỗi; tương phản: chữ `#999` trên `#fff` vào danh sách, `#555` thì không; nút 32×32 vào danh sách vùng chạm; checklist thiếu file hoặc sai `version` → lỗi rõ ràng.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): DTCG tokens, CSS layer and coverage checklist`.

### Task 8: Trang đề xuất design system (ds-report)

**Files:**
- Create: `plugins/vuong-design/core/ds-report.mjs`
- Test: `plugins/vuong-design/test/ds-report.test.mjs`

**Interfaces:**
- `renderDsReport({ tokens, entries, questions, coverage, crops?, title, generated }): string` (HTML một file, không tải gì từ mạng).
- Nội dung, theo thứ tự: dòng kết luận đầu trang ("N values → M tokens; K changes applied, Q questions open, coverage X/Y"); **How to read** (cố định); bảng màu (ô màu, tên, hex, OKLCH, số chỗ dùng, màu đã gộp vào nó); thang khoảng cách vẽ thành thanh (px); bo góc vẽ thành ô; mẫu chữ từng kiểu chữ (chữ thật lấy từ màn, font Figma); đổ bóng; **thay đổi** (bảng cũ → mới có đơn vị, mã lý do giải nghĩa bằng một câu, số node, ảnh cắt nguồn và bản `norm` đặt cạnh nhau cho mục thay đổi hình nhìn thấy được); **câu hỏi** (câu hỏi, các lựa chọn, mặc định, số node bị ảnh hưởng, đoạn JSON chép vào `vd-rules.json`); **độ phủ** (mục còn thiếu, tương phản, vùng chạm).
- Ảnh cắt dùng lại `cutImages` của `report-html.mjs`.

- [ ] **Step 1: Viết test** (theo kiểu `report-html.test.mjs`): có dòng kết luận, mọi số trong bảng có đơn vị (regex: không có số trần trong ô giá trị), có "How to read", mục `ask` có đoạn JSON parse được, không có `http` ngoài font của chính nguồn.
- [ ] **Step 2–4:** FAIL → viết → PASS. Mở trang trên Planora bằng Playwright, chụp, xem bằng mắt một lần (ghi ảnh vào thư mục tạm, không commit).
- [ ] **Step 5: Commit** `feat(vuong-design): visual design-system proposal page`.

### Task 9: CLI và nghiệm thu

**Files:**
- Create: `plugins/vuong-design/core/ds.mjs`
- Modify: `plugins/vuong-design/README.md`, `plugins/vuong-design/test/acceptance.test.mjs`
- Test: `plugins/vuong-design/test/ds.test.mjs`

**Interfaces:**
- `node core/ds.mjs --html <file> --root <sel> --out <dir> [--rules vd-rules.json] [--names vd-names.json] [mọi tuỳ chọn của layout.mjs]` và `--corpus` như `layout.mjs`. Gọi pipeline của kế hoạch 1 cho mọi màn, rồi inventory → normalize (trên **toàn bộ màn của file**, vì vai trò và thang tính trên cả bộ) → applyNorm từng màn → `runScreen(..., { norm })` → tokens → coverage → báo cáo.
- Đầu ra trong `--out`: tất cả đầu ra của `layout.mjs`, thêm `tokens.json`, `tokens.css`, `normalisation.json` (`entries`, đếm `kept` theo mã), `questions.json`, `vd-rules.draft.json`, `coverage.json`, `spec-norm-<id>.json`, `design-system.html`.
- Mã thoát: 0 khi mọi màn qua cổng (kế hoạch 1) và không có root lệch chưa giải thích do chuẩn hoá; 1 khi có; câu hỏi còn mở không làm thoát 1 (chế độ "chạy hết, duyệt sau"), dòng cuối in số câu hỏi còn mở.

- [ ] **Step 1: Viết test** (`ds.test.mjs` với deps giả như `layout.test.mjs`): không có `--rules` → mọi mục cần hỏi ở `ask`, spec đích = spec gốc, số của kế hoạch 1 không đổi; file luật fixture trả lời `LINE_HEIGHT_INT: yes` → mục `answered`, spec đích đổi; đảo thứ tự màn → `tokens.json`, `normalisation.json` giống từng byte.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Chạy trên bộ nghiệm thu** hai lần: (a) không có file luật: số kế hoạch 1 không đổi, ghi số mục `auto` / `ask` theo mã; (b) với file luật thử `test/fixtures/rules-accept.json` trả lời "có" cho `LINE_HEIGHT_INT` và `SRC_SQUASH`: ghi số approvals còn lại (kỳ vọng: 8 mục chữ làm tròn và avatar s3/s4 không còn là approval/crop mở mà thành `norm` explained; nếu không đạt, ghi nguyên nhân, không nới bộ kiểm tra), `--mutate` 0 missed. Cập nhật README (phần Design system CLI, bảng đầu ra, số nghiệm thu).
- [ ] **Step 6: Commit** `feat(vuong-design): design-system CLI and acceptance numbers`.

### Task 10: Lỗi so ảnh còn lại ở Planora s11

**Files:** tuỳ nguyên nhân (dự kiến `capture.mjs`, `infer.mjs` hoặc `proxy.mjs`).

- [ ] **Step 1: Điều tra trước, chưa sửa.** Ba ảnh cắt mở ở s11 (`n.0.13.1.1.0`, `n.0.13.1.1.1`: số "5" và dòng "lần dời việc, −2" trong một hàng HUG). Cắt ảnh nguồn / bản mô phỏng phóng to, so style đã tính của đoạn chữ ở hai bên (font, `font-variant-numeric`, `letter-spacing`, baseline, `vertical-align`). Ghi nguyên nhân vào sổ tiến độ.
- [ ] **Step 2:** Nguyên nhân nằm trong khả năng biểu diễn của Figma → viết test RED tái hiện trên fixture nhỏ, sửa, PASS, chạy bộ nghiệm thu (không màn nào xấu đi), commit `fix(vuong-design): …`. Figma không biểu diễn được → không sửa; ghi vào README như avatar ở kế hoạch 1 và báo người dùng. Không nới ngưỡng ảnh cắt.

---

**Sau Task 10:** review cả nhánh (như kế hoạch 1), sửa, cập nhật trạng thái trong `E:\tools\Planora\docs\design\figma-plan.md`, hỏi người dùng trước khi merge.
