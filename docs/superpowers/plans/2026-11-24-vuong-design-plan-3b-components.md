# vuong-design kế hoạch 3b: component, biến thể, trạng thái, instance swap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ kết quả của kế hoạch 2–3 (spec đích từng màn, `tokens.json`, `token-map.json`, Figma có biến, style và màn), tìm các cấu trúc lặp lại thành component có biến thể, thuộc tính (text, boolean, instance swap cho icon) và đủ trạng thái; dựng chúng trên trang Component của Figma; dựng lại màn bằng instance. Kiểm tra trên Figma thật bằng bộ kiểm tra hiện có: màn dựng bằng instance phải đạt như màn dựng bằng layer rời (Planora 18/18 với allowlist hiện có), lỗi cài vẫn bị bắt hết.

**Architecture:** Không thêm bộ kiểm tra thứ hai. Thêm một bước thuần (không trình duyệt, không model) `components.mjs` sau `ds.mjs`: đọc spec đích của mọi màn → `components.json` (component, biến thể, thuộc tính, trạng thái, instance ở đâu). Encoder thay cây con của mỗi instance bằng tham chiếu component + giá trị thuộc tính + phần ghi đè còn lại. Figma có thêm một module runtime riêng (`figma-runtime-cmp.js`, cài một lần như runtime hiện tại) dựng component và component set; runtime màn chỉ thêm phần tạo instance. Readback giữ nguyên định dạng: mỗi node của spec vẫn có một mục (node trong instance đọc theo ID), nên `figma.mjs check` và `--mutate` chạy như cũ.

**Tech Stack:** như kế hoạch 1–3 (Node ≥ 18, ESM `.mjs`, `node:test`, không thêm thư viện). Gửi qua bridge (`figma.mjs serve`), courier là đường dự phòng.

**Spec:** `docs/superpowers/specs/2026-11-21-vuong-design-plugin-design.md` mục 10 (component, trạng thái, duyệt một lượt, instance swap), 13 (chạy lại không trùng, trang Component), 16, 18 (giả định 6), 20. Kế hoạch 3 và README plugin (mục Figma encoding / runtime / CLI / bridge).

**Tách phạm vi.** Kế hoạch 3b (bản này) lo component. Để sang **kế hoạch 3c**: sổ ID theo quy ước dự án (mục 11), cập nhật theo phần khác chỉ gửi thuộc tính đổi (mục 13), `design-data.json` và hình màn đánh số (mục 12), các trang Bìa / Mẫu / Tham chiếu. 3c dùng lại ID component của 3b. Kế hoạch 4 (đóng gói) giữ nguyên.

## Global Constraints

- Mã ở `plugins/vuong-design/core/`, test ở `plugins/vuong-design/test/`, nhánh `feat/vuong-design-components` tách từ `main` sau khi kế hoạch 3 đã merge. Không có phụ thuộc npm.
- **Ghi Figma chỉ trong phạm vi người dùng nêu.** Mỗi lần gửi: báo file, trang, lô, ước tính thời gian (tính tổng thời gian, không chỉ bước cuối) và chờ duyệt. Probe chỉ ghi trang `_vd-probe` và xoá node tạm sau khi đo.
- **Mỗi lần gọi ≤ 50 000 byte** (`PAYLOAD_LIMIT`). Runtime màn giữ ≤ 16 384 B như đã cài (hiện 16 330 B): mọi phần component nằm ở `figma-runtime-cmp.js` (≤ 16 384 B, test như runtime màn); runtime màn chỉ được thêm phần tạo instance, nếu vượt thì chuyển code ít dùng sang module mới, không nới giới hạn.
- **Không đổi kết quả khi tắt component** (`--no-components`, cũng là mặc định khi `components.json` không có): lô, readback và kết quả `check` giống từng byte với kế hoạch 3. Test so với fixture hiện có.
- **Tất định:** `components.json` không phụ thuộc thứ tự màn hay thứ tự con; không đồng hồ.
- **Không có model trong pipeline.** Tên component lấy theo luật (lớp CSS của gốc cây con, xem Task 2). Chỗ luật không đặt được tên, loại hay trạng thái thì công cụ ghi gợi ý vào `vd-components.draft.json`; người dùng chép phần đồng ý sang `vd-components.json`. AI chỉ được điền bản nháp; script kiểm tra (định dạng, không trùng, không đổi tên đã duyệt). Agent không bao giờ tự ghi `approved: true`.
- **Trạng thái sinh theo luật là đề xuất.** Chỉ dựng lên Figma sau khi người dùng duyệt bộ luật (Task 5). Luật không áp được → ghi vào báo cáo độ phủ, không tự vẽ.
- **Không đè phần sửa tay**, mở rộng cho component: component có `vuongdesign/sig` như frame màn; component đã sửa tay → giữ, báo `skippedEdited`, màn dùng nó vẫn dựng bằng instance của bản đang có. `--force cmp:<tên>` mới ghi đè.
- **Chạy lại không tạo trùng:** component và component set tìm theo `vuongdesign/cmp` trước khi tạo.
- Không làm hỏng kế hoạch 1–3: `layout.mjs`, `ds.mjs`, `figma.mjs` chạy như cũ; test cũ giữ nguyên; số nghiệm thu chỉ đổi ở Task 8 và phải ghi lý do.

## Review Focus

1. Hai cây con giống cấu trúc nhưng khác giá trị đo (gap 12 và 12,01, chữ dài làm cao khác) → cùng một component, khác biệt hình học đi qua sizing của instance, không sinh biến thể giả (Task 2, test `noise is not a variant`).
2. Instance ghi đè một thuộc tính mà component không phơi ra → giữ dạng ghi đè trực tiếp và vẫn đọc ngược được; không lặng lẽ bỏ (Task 6, test `override kept`).
3. Node trong instance phải đọc ngược theo đúng ID spec; thiếu → `unchecked`, màn không đạt (Task 6–7, test `instance readback`).
4. Component bị sửa tay → giữ nguyên, màn dùng nó vẫn đạt hoặc báo rõ khác biệt; không bao giờ xoá component còn instance (Task 7, test `edited component is kept`).
5. Tắt component → lô giống từng byte với kế hoạch 3 (Task 6, test `off is plan 3`).

---

### Task 1: Probe component API trên Figma thật

**Files:** `core/figma-probe.mjs` (thêm ca), `test/figma-probe.test.mjs`, `core/figma-facts.json` (thêm khoá).

Đo trước khi thiết kế định dạng (mỗi ca có số đo, giống probe kế hoạch 3):
- `cmpData`: `setSharedPluginData` trên node con của instance có lưu và đọc lại được không; ID con instance có ổn định qua `createInstance` lần hai không.
- `cmpProps`: `addComponentProperty` TEXT / BOOLEAN / INSTANCE_SWAP trên component trong component set; `setProperties` trên instance; giá trị đặt trực tiếp lên con instance (ghi đè không qua thuộc tính) còn sau khi `setProperties`.
- `cmpLayout`: instance có auto layout trong khung auto layout cha, sizing FILL / HUG trên instance và con của nó cho cùng box như frame rời (so `absoluteBoundingBox`, ngưỡng 0,01 px).
- `cmpBind`: biến gắn trên component còn gắn ở instance; ghi đè màu trên instance bằng biến khác.
- `cmpTime`: thời gian dựng 20 instance so với 20 cây frame rời cùng nội dung.

- [ ] **Step 1: Viết test** `probePayload()` có các ca mới, ≤ 20 000 byte, đúng cú pháp; `readFacts` ra đủ hai nhánh mỗi khoá mới; thiếu file → mặc định an toàn (`cmpData: 'no'`, `cmpLayout: 'no'`: khi đó Task 6 đọc ngược con instance theo thứ tự cây thay vì plugin data).
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Chạy thật qua bridge** (sau khi người dùng duyệt phạm vi `_vd-probe`). Ghi số đo vào `figma-facts.json` và README mục "Figma facts". Một ca cho kết quả bất lợi (ví dụ instance không giữ plugin data) → dừng, báo người dùng, sửa thiết kế Task 6 trước khi làm tiếp.
- [ ] **Step 6: Commit** `feat(vuong-design): probe Figma component API (plugin data, properties, layout, bindings)`.

### Task 2: Tìm ứng viên component

**Files:** tạo `core/components.mjs`, `test/components.test.mjs`.

`findComponents(screens: [{ screen, spec }], { bareMin = 2, decl })`; `decl` = `readComponentsFile('vd-components.json')` (người dùng ghi; thiếu file = {}):

```
{ "version": 1,
  "classes": { "ck": { "kind": "checkbox", "states": ["on"], "variants": { "size": ["L", "S"], "shape": ["sq"] }, "name": "checkbox" } },
  "keep": { "<khoá thẻ trần>": "tên" },
  "drop": ["<tên component>"] }
```

Bối cảnh (đo 2026-11-24): corpus và profile vd-html không có `role`, `aria-*`, `data-state`, `<button>`, `<input>`; capture chỉ giữ thẻ và class. Planora đánh dấu control bằng class viết tắt (`btn`, `ck`, `tog`, `chip`, `seg`, `fab`) và trạng thái bằng `on`, `off`, `done`. Vì vậy loại, trạng thái ngoài `STATE` và class bổ nghĩa đến từ khai báo theo class gốc, không đoán. `STATE` của inventory.mjs không đổi (dùng chung với ds). Thuộc tính `role` / `aria` / `data-state`: chưa capture; đề nghị plan 5 thêm quy ước vào profile (ví dụ `data-vd-kind`, `data-state`).

- **Danh tính** của một gốc: thẻ + class không phải trạng thái (`STATE` hoặc `states` khai báo cho class gốc) và không phải class bổ nghĩa khai báo (`variants`). Class gốc = class có khai báo trong `decl.classes` (nhiều class có khai báo: lấy class đầu theo thứ tự, cảnh báo). Class chưa khai báo thuộc danh tính: `ck L` và `ck` là hai component cho đến khi người dùng khai báo `L` (an toàn: mỗi component vẫn đúng).
- **Nhóm:** gốc có class (sau khi bỏ trạng thái / bổ nghĩa) → khoá `c:<danh tính>`; thẻ trần → khoá `b:<chữ ký cấu trúc>`. Chữ ký cấu trúc: loại node (`t`), `lay.d`, danh tính, kiểu syn, chữ ký con theo thứ tự, đệ quy; không gồm chữ, icon cụ thể, kích thước, màu.
- **Loại:** thẻ `button` → `button`; `input` / `select` / `textarea` → `input`; còn lại `decl.classes[gốc].kind`, không có → `other`.
- **Chọn** (spec mục 10), mỗi nhóm ghi `reason`:
  - `control`: loại khác `other` → component, kể cả 1 lần, kể cả 1 node.
  - `state`: có lần xuất hiện mang class trạng thái → component set.
  - `class`: gốc có class, có hình riêng (`paint.bg` không trong suốt, viền > 0, bóng, `bgImage`) và cây ≥ 2 node → component, kể cả 1 lần.
  - `bare`: thẻ trần cùng chữ ký ≥ `bareMin` lần, ≥ 2 node, có hình riêng → `proposed`, không dựng; thành component khi `decl.keep` có khoá đó (tên = giá trị).
  - Không bao giờ: gốc màn, node syn, pseudo (`::before` / `::after`), khung không có hình riêng (trừ `control` / `state`), khối 1 node (trừ `control`).
  - Lồng nhau: `control` / `state` luôn là component riêng (instance lồng). Nhóm `class` / `bare` mà mọi lần xuất hiện nằm trong lần xuất hiện của một component khác có cùng số lần → `skipped` lý do `nested`.
  - `decl.drop` có tên → `skipped` lý do `user`.
- **Biến thể:** trong một nhóm, khoá biến thể = trục `state` (class trạng thái, nối `+`, không có = `default`) + mỗi trục `variants` khai báo (không có = `default`). Khác paint / chữ không có class khác → ghi đè (Task 5), không phải biến thể. Cấu trúc giữa các biến thể được khác nhau.
- **Khuôn của biến thể:** lần xuất hiện nhiều node nhất (hoà: lần đầu theo màn rồi `cmpNodeId`). Mỗi lần xuất hiện khác phải nhúng được vào khuôn: cùng `t` và `lay.d` ở gốc, con khớp theo thứ tự với một dãy con của khuôn (khoá nông: `t`, `lay.d`, danh tính, syn), đệ quy. Không nhúng được → lần đó `skipped` lý do `structure` (dựng layer rời).
- **Thuộc tính** (trên khuôn, bỏ qua cây con là instance lồng): chữ khác nhau → TEXT; con của khuôn vắng ở một lần → BOOLEAN; `icon.ref` khác nhau → INSTANCE_SWAP (bộ icon vào `icons`). Tên: class đầu của node (hoặc `text` / `icon` / `show`), trùng thì thêm số. Thuộc tính gộp theo tên trên mọi biến thể; mỗi biến thể có `bind` (tên → đường dẫn trong khuôn).
- **Tên:** `decl.classes[gốc].name`, không có → danh tính bỏ thẻ (`div.task-row` → `task-row`), thẻ trần giữ → `decl.keep`, còn lại `cmp-<n>`.
- **Nháp** `componentsDraft(result)` → `vd-components.draft.json` (công cụ ghi, agent không chép sang `vd-components.json`): mỗi class gốc có hình riêng hoặc kèm class trạng thái, gợi ý `kind` theo bảng tên (`btn`/`button`/`fab` → button, `ck`/`check`/`checkbox` → checkbox, `tog`/`toggle`/`switch` → switch, `radio`, `chip`, `tab`, `input`/`field` → input) và `states` / `variants` từ class đi kèm class gốc ở một số lần (từ quen thuộc như `done`, `off`, `checked`, `open`, `error` → `states`; còn lại → `variants.variant`); mỗi thẻ trần đề xuất một khoá `keep`; `notes` ghi số lần và màn.
- Ra `components.json`: `{ v: 1, components: [{ name, kind, reason, key, count, screens, axes, variants: [{ props, template: { screen, node }, bind, nodes: [{ screen, node, vals }] }], props: [{ name, type, default }], icons? }], proposed: [{ key, count, screens, nodes }], skipped: [{ key, count, reason, nodes? }], warnings }`.

- [ ] **Step 1: Viết test** trên spec dựng tay: 3 hàng có class và nền khác chữ → 1 component, 1 TEXT; 2 hàng thường + 1 hàng `is-done` → 1 set, 2 biến thể; con thiếu ở 1 lần → BOOLEAN; icon khác → INSTANCE_SWAP; khác màu nền không có class khác → không biến thể; đảo thứ tự màn → giống từng byte; khối có class và nền, 1 lần → `class`; khung có class không có hình riêng → không chọn; `ck` 1 node không khai báo → không chọn, khai báo `kind: checkbox` → `control`; `ck L` không khai báo → component riêng, khai báo `variants.size: [L]` → biến thể; `li done` khai báo `states: [done]` → biến thể state; thẻ trần 2 lần → `proposed`, `keep` → component; thẻ trần 1 lần → không chọn; ck trong li → component riêng lồng, TEXT của li không tính chữ trong ck; card có class lồng trong li cùng số lần → `nested`; `drop` → `user`; không nhúng được → `structure`; nháp gợi ý `ck` → checkbox, `done` → states.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Viết.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Đo trên Planora và corpus** (không ghi Figma): số component theo `reason` và `kind`, số `proposed`, biến thể, thuộc tính, tỉ lệ node của màn nằm trong instance, các ứng viên bị bỏ và lý do, tỉ lệ khối có class / thẻ trần trong HTML Planora (nếu phần lớn là thẻ trần thì báo người dùng: dấu hiệu `class` ít tác dụng). Ghi vào README mục mới "Components". Đối chiếu danh sách component của `figma-plan.md` Planora (task row, checkbox, hũ 1-3-5, nút, chip, nav, sheet): mục nào không được tìm ra → ghi lý do; người dùng quyết có cần luật bổ sung không trước Task 3.
- [ ] **Step 6: Commit** `feat(vuong-design): component candidates, variants and properties from repeated structures`.

### Task 3: Loại component và bảng trạng thái

**Files:** `core/components.mjs`, `core/states.mjs` (mới), test tương ứng.

- Loại lấy từ Task 2 (thẻ, hoặc khai báo `vd-components.json`).
- Bảng trạng thái theo loại (mục 10; mobile không có hover): nút: thường, nhấn, tắt, đang tải, focus; ô nhập: trống, focus, đã nhập, lỗi, tắt; ô tích: chưa tích, đã tích, tắt; radio: chọn, chưa chọn, tắt; công tắc: bật, không bật, tắt; chip: chọn, chưa chọn, tắt; tab: chọn, chưa chọn. "Tắt" = disabled.
- Nguồn từng trạng thái, theo thứ tự: biến thể đã có từ HTML (Task 2) → `html`; không có → sinh theo luật trong `vd-rules.json` mục `states` (mặc định của spec: nhấn = lớp phủ màu chữ 10%; tắt = nội dung 38%, nền 12%; focus = viền 2 px token focus; lỗi = token lỗi; đang tải = thay nhãn bằng vòng quay) → `proposed`; luật cần token chưa có (không có token focus / lỗi) → `missing`, ghi vào `coverage.json`, không vẽ.
- Mặc định của luật vào `vd-rules.draft.json` mục `states` với `approved` trống.

- [ ] **Step 1: Viết test**: nút chỉ có trạng thái thường trong HTML → 4 trạng thái `proposed` đúng giá trị; nút có `is-disabled` trong HTML → trạng thái tắt là `html`, không sinh; không có token lỗi → ô nhập lỗi `missing` và có trong coverage; luật chưa duyệt → không có trạng thái `proposed` nào trong dữ liệu gửi Figma.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): component kinds and state table (html, proposed by rules, missing)`.

### Task 4: Trang xem trước component (trên máy)

**Files:** `core/components-report.mjs` (mới), thêm mục vào `design-system.html`.

Dựng trang HTML từ spec component (dùng renderer của norm proxy, `proxy.mjs`, không viết renderer thứ hai): mỗi component một hàng, mỗi biến thể / trạng thái một ô, nhãn nguồn (`html` / `proposed` / `missing`), số instance và màn dùng. Không tốn lượt gọi Figma. Mục "Component" trong báo cáo dùng tiếng Anh, có đơn vị (theo quy ước báo cáo hiện có).

- [ ] **Step 1: Viết test**: trang có đủ ô cho mọi biến thể và trạng thái; ô `proposed` có nhãn; ô `missing` có lý do; trang tất định.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Chạy trên Planora**, đưa người dùng duyệt bộ luật trạng thái và tên `ask`. Người dùng tự ghi câu trả lời vào `vd-rules.json` / `vd-components.json`.
- [ ] **Step 6: Commit** `feat(vuong-design): component preview page with states and sources`.

### Task 5: Kiểm tra component trước khi ghi Figma

**Files:** `core/components.mjs`, `core/verify.mjs` (chỉ thêm, không đổi luật cũ), test.

Component được dựng từ spec của lần xuất hiện đầu tiên (theo thứ tự màn rồi `cmpNodeId`). Mỗi lần xuất hiện khác phải tái tạo đúng từ component + thuộc tính + ghi đè: `expandInstance(cmp, inst)` dựng lại spec của cây con, so với spec đích bằng phép so của kế hoạch 1 (khung ≤ 0,5 px, chữ ≤ 1 px, paint / type đúng). Lệch → lần xuất hiện đó không thành instance (ghi `detached` + lý do), màn vẫn dựng bằng layer rời. Trạng thái `proposed` kiểm tra tương phản WCAG như coverage.

- [ ] **Step 1: Viết test**: mọi lần xuất hiện của fixture tái tạo đúng; ghi đè thiếu một màu → `detached` có lý do, không phải instance sai; trạng thái tắt có tương phản thấp vẫn được (WCAG miễn cho control tắt), trạng thái lỗi tương phản thấp → cảnh báo.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): instances must rebuild the target spec, else detached`.

### Task 6: Mã hoá và runtime component

**Files:** `core/figma-encode.mjs`, `core/figma-runtime.js` (chỉ phần tạo instance), `core/figma-runtime-cmp.js` (mới), `core/figma.mjs` (`plan`: lô `cmp-NN` sau `vars`, trước màn), `test/fake-figma.mjs` (thêm component, component set, instance, property), test.

- Lô `cmp-NN`: trang `--cmp-page` (mặc định `Components`), component icon trước, rồi component theo thứ tự phụ thuộc (nguyên tử → ghép), rồi `combineAsVariants`, rồi thuộc tính. Mỗi component có `vuongdesign/cmp` (tên), `vuongdesign/id` của node, `vuongdesign/sig`. Readback như màn (hộp, `d`), để kiểm tra component trên Figma thật như một màn.
- Màn: node instance mã hoá `{ i: <chỉ số bảng K>, p: { thuộc tính }, ov: [ghi đè theo đường dẫn con] }`; bảng `K` mang tên component như `V`, `S`. Runtime màn: `importComponent` theo `vuongdesign/cmp` (tìm một lần mỗi lô), `createInstance`, `setProperties`, ghi đè, đặt ID cho con instance (theo `figma-facts.cmpData`; nếu `no` thì readback theo thứ tự cây và encoder ghi thứ tự đó).
- `--no-components` (và không có `components.json`) → không có lô `cmp`, encoder không thay cây con.

- [ ] **Step 1: Viết test** trên fake: lô cmp dựng đủ component / set / thuộc tính, chạy lại → không trùng; màn dùng instance có readback đủ mục theo ID spec (`instance readback`); `override kept`; component có node lỗi → instance của nó `detached` và màn vẫn dựng; `off is plan 3`: tắt → mọi lô Planora giống từng byte fixture kế hoạch 3; kích thước hai runtime ≤ 16 384 B mỗi file.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): Figma components, variants, properties and screen instances`.

### Task 7: Sửa tay component, `check` và lỗi cài

**Files:** `core/figma.mjs`, `core/figma-check.mjs`, `core/mutate.mjs`, test.

- `check` kiểm tra component như màn (trang Component) và màn dùng instance như cũ. Lỗi cài thêm: `figCmp` (đổi một thuộc tính trong component chính → mọi instance phải lệch và bị bắt), `figSwap` (đổi icon instance sang icon khác). Kind không có ứng viên → `skipped` như hiện tại.
- Component bị sửa tay (`sig` khác) → `skippedEdited`, không ghi đè, báo cáo liệt kê màn dùng nó. `--force cmp:<tên>` ghi đè.

- [ ] **Step 1: Viết test**: `edited component is kept`; `figCmp` và `figSwap` bị bắt trên fixture; component thiếu readback → mọi instance của nó `unchecked`, màn không đạt.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** `feat(vuong-design): check components on Figma, edit guard and component mutations`.

### Task 8: Nghiệm thu trên Figma thật (Planora)

- [ ] **Step 1: Hỏi người dùng** phạm vi ghi (file "Planora Design", trang Components, các màn dựng lại bằng instance) và báo ước tính tổng thời gian từ `figma.mjs plan` (lô cmp, lô màn, ảnh, check). Chỉ làm tiếp khi được duyệt.
- [ ] **Step 2: Chạy** `ds.mjs` → `components.mjs` → `figma.mjs plan` → `serve --send pending --shots` → `check --mutate`.
- [ ] **Step 3: Ghi số** vào README: số component / biến thể / thuộc tính / instance, tỉ lệ node trong instance, số `detached` theo lý do, màn đạt (mục tiêu 18/18 với allowlist hiện có, không thêm mục allowlist mới nếu người dùng chưa duyệt), lỗi cài bắt / sót (mục tiêu 0 sót), thời gian trong Figma và KB gửi so với kế hoạch 3 (25,8 s, 167,5 KB).
- [ ] **Step 4: Chạy lại không đổi gì** → không component, frame, biến trùng; sửa tay một component → `skippedEdited`, rồi `--force` đưa về.
- [ ] **Step 5: Cập nhật** `figma-plan.md` của Planora (dòng kế hoạch 3b, danh sách component thật so với danh sách dự kiến). Không ghi thông tin cá nhân.
- [ ] **Step 6: Commit** plugin `docs(vuong-design): plan 3b acceptance on real Figma` và Planora `docs(design): Planora components on Figma (plan 3b)`.

## Quyết định của người dùng (2026-11-24)

1. Không có ngưỡng số lần cố định: control, lớp trạng thái và class riêng có hình riêng tự thành component bất kể số lần; thẻ trần lặp từ 2 lần chỉ là đề xuất, người dùng chọn (Task 2, spec mục 10).
2. Không xét số màn: component dùng trong một màn vẫn tách ra nếu có dấu hiệu trên.
3. Giá trị luật trạng thái mặc định của mục 10 giữ tạm cho Planora; bảng loại thêm radio, công tắc, chip. Người dùng sẽ duyệt lại ở trang xem trước (Task 4).
