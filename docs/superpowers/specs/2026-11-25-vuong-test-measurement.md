# Đo lường vuong-test (và bộ đo dùng chung cho các plugin)

Ngày: 2026-11-25 · Nhánh: `feat/vuong-test-measure` · Trạng thái: thiết kế, chưa làm

## 1. Mục đích

vuong-test (v0.22.2) mới chạy thật 1–2 lần trên máy công ty, không có số liệu nào trên máy này. Chưa có gì chứng minh
plugin hiệu quả, rẻ hay chính xác. Mục tiêu giống vuong-design: **ít chi phí nhất, nhanh nhất, chuẩn xác nhất** — và
mọi thay đổi tối ưu phải có số đo trước/sau.

Tài liệu này chỉ thiết kế phần **đo**. Đề xuất tối ưu đến sau, khi đã có số đo gốc.

## 2. Phạm vi và quyết định đã chốt

- Chỉ đo trên máy này. Không thu số liệu từ máy khác, không thêm hook gửi dữ liệu vào plugin, `PRIVACY.md` giữ nguyên.
- Bộ đo phải dùng lại được cho plugin khác mà không phải sửa nhiều: phần chung (chạy, đo chi phí, chấm theo đáp án)
  tách khỏi phần riêng của từng plugin (ca, đáp án, bảng chia bước).
- App mẫu vừa phải (tài khoản standard, token có hạn). UI của app mẫu do vuong-design (`spec-to-html`) sinh ra, để
  kiểm chứng luôn vuong-design.
- Đo trước, đề xuất sau.

## 3. Vì sao không dùng `claude plugin eval`

Đã xét (Claude Code 2.1.332, tài liệu `code.claude.com/docs/en/plugin-evals.md`). Không đáp ứng được, vì:

| Cần | `claude plugin eval` |
|---|---|
| Chấm bằng script: so với đáp án, chạy test trên bản app đã sửa bug | **Không có grader bằng code** — chỉ regex, tool_used, file_exists, llm |
| Token / chi phí / thời gian / số lượt **theo từng lần chạy và từng bước** | Chỉ có chi phí tổng của cả bộ và theo ca |
| Chạy Bash (vuong-test gọi `node $PLUGIN/core/*.mjs` ở mọi bước) | Cấp shell cần sandbox OS; Windows thuần không có → bị từ chối, phải cài WSL2 (máy này chưa có distro) |
| Fixture dùng chung giữa các plugin | Fixture phải nằm trong thư mục ca |

Phần dùng được: ý tưởng arm có / không có plugin, chạy lặp N lần, trần chi phí. Các ý này đưa vào bộ đo riêng (mục 5).
Khi `plugin eval` có grader bằng code và chạy được shell trên Windows thì xét lại.

## 4. Chỉ số

Mỗi lần chạy ghi một dòng JSON; mọi chỉ số đều đo được bằng máy, không ước lượng tay.

**Chi phí và tốc độ** (từ `claude -p --output-format stream-json`):
- tổng: `costUsd`, `durationMs`, `turns`, token `input / output / cacheRead / cacheWrite` theo model;
- theo bước của plugin (bảng chia bước, mục 5.3): token, số lượt gọi tool, số phút;
- đọc tài liệu của plugin: số lần đọc `SKILL.md` / `references/*`, tổng byte đã đọc;
- làm lại: số lần chạy lại cùng một script kiểm (ví dụ `lint-cases.mjs`), số lần ghi đè cùng một file đầu ra.

**Độ chính xác** (grader của từng ca, so với đáp án viết tay):
- tìm đủ (recall) và tìm đúng (precision) so với đáp án;
- số khẳng định bịa (trích `file:line` không tồn tại, trích ô spec không tồn tại);
- với bước viết test: số bug cài sẵn bị test bắt, số test fail sai trên bản app đã sửa hết bug (test xanh giả / đỏ giả).

**So với không có plugin** (arm `baseline`): cùng prompt, cùng fixture, không nạp plugin — trả lời câu "plugin có hơn
Claude thường không" về cả độ chính xác lẫn chi phí. Chỉ chạy cho ca nào có ý nghĩa so sánh (mục 7).

## 5. Bộ đo dùng chung: `bench/`

Đặt ở gốc repo, ngoài `plugins/` → không bị cài kèm theo plugin nào.

```
bench/
  run.mjs                 chạy 1 ca × N lần (arm plugin / baseline), ghi runs.jsonl
  report.mjs              gộp runs.jsonl → bảng so sánh theo phiên bản plugin (md + HTML)
  lib/
    transcript.mjs        đọc stream-json: chi phí tổng, theo message, tool calls (tổng quát hoá session-log.mjs của vuong-design)
    steps.mjs             chia chi phí theo bước từ bảng steps.json của plugin
    grade.mjs             helper cho grader: matchKey (recall/precision theo đáp án), readMdTable, run lệnh, áp patch
  fixtures/
    leave-request/        app mẫu (mục 6), dùng chung cho nhiều plugin
  suites/
    vuong-test/
      steps.json          bảng chia bước của vuong-test
      cases/<ca>/         case.json + prompt.md + answers.md + inputs/ + grade.mjs
  results/                runs.jsonl và workspace giữ lại khi lỗi (gitignore, trừ bản tóm tắt đã chốt)
```

### 5.1 Một lần chạy (`run.mjs`)

1. Tạo workspace tạm, chép fixture, phủ thêm `inputs/` của ca (đầu ra mẫu của bước trước), `git init` + commit
   (vuong-test ghi sha vào `flows.md`).
2. Chạy:
   `claude -p <prompt> --plugin-dir <plugin> --output-format stream-json --verbose --max-budget-usd <trần>`
   `--disallowed-tools AskUserQuestion --append-system-prompt-file answers.md` và quyền đủ cho workspace tạm.
   - Câu hỏi gửi người dùng không chạy được khi không có người → câu trả lời viết sẵn trong `answers.md` của ca
     (scope, môi trường, có được ghi dữ liệu, người duyệt...). Số câu plugin *định* hỏi vẫn đếm được qua trace.
   - Arm `baseline`: bỏ `--plugin-dir`.
   - Cô lập khỏi cấu hình cá nhân (plugin khác, CLAUDE.md, MCP) — cờ cụ thể kiểm lại khi làm (`--setting-sources`,
     `--strict-mcp-config`).
3. Đọc stream-json → chỉ số mục 4; chạy `grade.mjs` của ca trên workspace → điểm từng tiêu chí.
4. Ghi một dòng vào `results/<plugin>/runs.jsonl`: plugin + version + git sha, ca, arm, model, chỉ số, điểm.
   Lỗi / chạm trần → vẫn ghi, kèm lý do; workspace được giữ lại để xem.

### 5.2 Grader

`grade.mjs` của ca là một module Node: nhận đường dẫn workspace + đáp án, trả về danh sách
`{ name, score 0..1, pass, detail }`. Ưu tiên chấm bằng code; chỉ dùng model chấm cho phần không chấm được bằng
code, và ghi rõ là model chấm.

`matchKey` (dùng chung): đáp án là danh sách mục `{ id, any: [regex…], file?, lines? }`; đầu ra là các hàng của một
bảng markdown hoặc các dòng văn bản. Một mục được tính là tìm thấy khi có hàng khớp một regex (và trỏ đúng file,
dòng ±3 nếu đáp án có). Trả về recall, precision, danh sách sót, danh sách thừa.

### 5.3 Chia chi phí theo bước

`steps.json` của plugin: mỗi bước là một tập dấu hiệu — lệnh Bash khớp regex, file được ghi khớp glob. Mỗi message
của assistant được gán cho bước của dấu hiệu **kế tiếp** xuất hiện sau nó (đọc code rồi mới ghi `flows.md` → phần đọc
tính cho bước liệt kê flow). Đây là xấp xỉ, ghi rõ trong báo cáo.

vuong-test: `0 setup` (init, config) · `2 spec` (find-spec, read-spec, `spec-sources.md`) · `3 flows`
(`flows.md`, `diff.md`) · `4 cases` (import-cases, lint-cases, `cases.md`, `data-plan.md`) · `5 gate`
(cases-summary) · `6 tests` (lint-tests, file test, manual-runbook) · `7 report` (collect, render-html, export) ·
`review` (review-tests).

## 6. App mẫu: `leave-request` (Đăng ký nghỉ phép)

Chọn loại màn hay gặp ở dự án công ty: form có chế độ New / Edit / View, validation, mã lỗi, API, spec Excel.

- **Spec** (nguồn viết tay ở markdown → sinh xlsx bằng `core/ooxml.mjs` của vuong-test):
  - `L01_DangKyNghiPhep.xlsx`: màn (item, kiểu, bắt buộc, giới hạn, điều kiện hiện / bật nút), message (mã `LV-001`…), luồng;
  - `API_Leave.xlsx`: khoảng 5 endpoint (lấy đơn, tạo, sửa, gửi duyệt, huỷ, số dư phép) với rule, mã lỗi, quyền.
- **UI**: chạy `spec-to-html` của vuong-design (bản `preview/vuong-design`, nạp bằng `--plugin-dir`) **một lần**, ghi
  chi phí và kết quả lint/layout vào log của vuong-design. HTML đó giữ cố định; mọi lần đo vuong-test dùng lại.
  Profile `vd-html v1` cấm script → hành vi nằm ở `app.js` riêng, HTML sinh ra không bị sửa tay (chênh lệch nào cần
  để chạy được thì ghi lại — đó cũng là số liệu về vuong-design).
- **Code**: `server.mjs` (Node `http` thuần, dữ liệu trong bộ nhớ, không cần cài gì), `app.js`, `lib/leave.mjs`
  (hàm thuần: tính số ngày bỏ cuối tuần, kiểm tra số dư...). Tổng khoảng 400–500 dòng.
- **Cài sẵn, có đáp án**:
  - 3 chỗ spec ≠ code (ví dụ: giới hạn độ dài lý do, cách làm tròn nửa ngày, nội dung message);
  - 3 bug (ví dụ: tính số ngày sai khi khoảng nghỉ qua tháng, API cho sửa đơn đã gửi duyệt, nút Huỷ hiện ở View);
  - 6 test có sẵn, trong đó 2–3 test yếu (không assert, tautology, chỉ kiểm mock);
  - `fixed.patch`: sửa hết 3 bug — dùng để kiểm test có đỏ giả không.
- **Đáp án** (`bench/suites/vuong-test/keys/`): khoảng 25 mục flow, 3 spec≠code, 3 bug, giá trị Expected của các rule
  chính (lấy từ spec), layer hợp lệ của từng mục, test yếu.
- **Stack**: UT Jest (stack đã verified của vuong-test), E2E bằng kit của vuong-test + `playwright-core`, API bằng
  `api-kit`. Jest và playwright-core cài một lần ở `bench/.devdeps/` (gitignore), không cài vào fixture.

## 7. Các ca của vuong-test

Mỗi ca bắt đầu từ đầu ra mẫu của bước trước, để không chạy cả 8 bước trong một lần (tốn, và kẹt ở cổng duyệt).

| Ca | Bước | Đầu vào | Chấm | Baseline |
|---|---|---|---|---|
| `t1-flows` | 2–3 | fixture + `test.config.json` + spec | flow recall/precision, `file:line` bịa, spec≠code tìm được / khẳng định sai, Expected không lấy từ code | có |
| `t2-cases` | 4 | + `spec-sources.md`, `flows.md`, `diff.md` mẫu | `lint-cases` sạch, mọi mục flow có case hoặc ở Not covered, Expected khớp giá trị spec, trích nguồn có thật, layer hợp lệ | không |
| `t3-review` | review | test có sẵn | test yếu tìm được / gắn cờ sai | có |
| `t4-tests` | 6–7 | + `cases.md` đã duyệt, `data-plan.md` | test gắn tag đủ, `lint-tests` sạch, report có; bug cài sẵn bị bắt; 0 test đỏ trên bản đã sửa bug | không |

## 8. Ngân sách

- Vòng đo gốc: mỗi ca 1 lần, arm baseline chỉ cho `t1` và `t3`. Trần tạm tính theo `--max-budget-usd` (giá niêm
  yết, quy đổi từ token — tài khoản standard không trả theo USD, con số chỉ để so sánh): `t1` 4, `t2` 3, `t3` 1,5,
  `t4` 6 → một vòng khoảng 20 USD quy đổi. Chỉnh lại sau lần chạy đầu.
- Chạy lặp 2–3 lần chỉ cho ca có độ dao động lớn.
- Model: model mặc định của phiên, ghi vào mỗi dòng kết quả. So model khác (ví dụ Sonnet cho bước viết test) là một
  thí nghiệm tối ưu, để sau.

## 9. Thứ tự làm

1. `bench/lib` + `run.mjs` + `report.mjs`, có self-test (transcript mẫu, grader mẫu, ca giả chạy rất rẻ).
2. Spec app mẫu → `spec-to-html` (đo vuong-design) → `app.js`, `server.mjs`, `lib/`, test có sẵn, `fixed.patch`, đáp án.
3. 4 ca của vuong-test, đầu vào mẫu của từng ca, `steps.json`.
4. Vòng đo gốc → bảng số (chi phí và thời gian theo bước, độ chính xác theo ca, có / không plugin).
5. Đề xuất tối ưu, mỗi đề xuất kèm số đo trước / sau trên cùng bộ đo.

## 10. Giả định cần kiểm sớm

1. `claude -p` với `--plugin-dir` nạp được skill và hook của plugin giống phiên thường. **Đã kiểm một phần
   (2026-11-25):** `stream-json` có usage theo từng message (`message.id`, model, input / output / cache read / cache
   write); event `result` có `total_cost_usd`, `duration_ms`, `num_turns`, `modelUsage` theo model. Một prompt
   "ok" bằng Haiku: 17,5k token ghi cache + 17,9k đọc cache (system prompt và skill của cấu hình hiện tại), 0,0037 USD,
   1,1 s — phần nền này phải được cô lập (giả định 2) để số đo phản ánh plugin. Lưu ý: chạy từ trong một phiên Claude
   Code thì phải bỏ biến `ANTHROPIC_API_KEY` kế thừa (`env -u ANTHROPIC_API_KEY`), nếu không tiến trình con lỗi 401.
2. Cô lập được khỏi cấu hình cá nhân để arm có / không plugin so được với nhau.
3. Hook `guard-bash.mjs` của vuong-test không chặn lệnh cần thiết trong workspace tạm.
4. `spec-to-html` sinh được màn form có đủ trạng thái (New / Edit / View, lỗi, hộp xác nhận) từ spec mẫu.
5. Bảng chia bước theo dấu hiệu kế tiếp cho kết quả hợp lý (so tay với một transcript).
