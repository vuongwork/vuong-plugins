# Data plan — L01 Đăng ký nghỉ phép

Written in step 4 from the Data column of `cases.md`, shown at the approval gate (step 5).
Môi trường: local `http://localhost:3210`, server chạy bằng `LEAVE_TODAY=2026-11-25 npm start`; dữ liệu trong bộ nhớ, khởi động lại server là về dữ liệu mẫu (`test.config.json › dataRules`). Được ghi dữ liệu (chỉ local).
Người dùng chọn bằng header `X-User` (API) hoặc `?user=` (màn) — server nhận mọi mã nhân viên (không có danh sách nhân viên); người dùng mới chưa có đơn, số dư còn lại 12,0 (`API_Leave.xlsx › API!D21`, annual = 12).

Giả định (ghi lại vì không có ai trả lời trong lần này):
- G1: "Hôm nay" cố định 2026-11-25 bằng `LEAVE_TODAY` cho server và Playwright clock cho trình duyệt, để case chạy lại được vào ngày khác. Hai case L01-E44 / L01-E45 cố ý đặt đồng hồ trình duyệt lệch.
- G2: Mỗi case ghi dữ liệu dùng một mã nhân viên riêng chưa có trong dữ liệu mẫu (E101–E118 cho E2E/manual, E201–E215 cho API) → các case không ảnh hưởng nhau và không đổi số dư 8,0 của E001 mà các case đọc dựa vào. Ngoại lệ có chủ ý: L01-A16, L01-A24, L01-A25 thao tác trên đơn mẫu của E001 — nếu code đúng spec chúng không đổi gì; nếu code sai (D9, D10) chúng sẽ đổi đơn mẫu → chạy các case này cuối lượt API và khởi động lại server trước lượt E2E.
- G3: Tạo dữ liệu tiền đề (đơn Nháp, đơn Chờ duyệt, đơn Đã huỷ) cho case E2E được làm qua API kit trong chính case đó (Writes = Y), không tạo ngoài case.
- G4: Lỗi A6, lỗi mạng, lỗi 500 phía màn được giả bằng Playwright route (chặn / trả lời giả) — không cần dữ liệu trên server.

| Need | Concrete data (key / state / file) | How to get | Found / created by | Cases | Status |
|---|---|---|---|---|---|
| N1 | Server local vừa khởi động, `LEAVE_TODAY=2026-11-25` | exists | `LEAVE_TODAY=2026-11-25 npm start` (server.js:9 đọc `LEAVE_TODAY`); trước mỗi lượt API và E2E | mọi case api, e2e, manual | ready |
| N2 | E001: số dư còn lại 8,0 (annual 12, used 4 = LV-20261110-001 Đã duyệt 2 ngày + LV-20261124-001 Chờ duyệt 2 ngày) | exists | dữ liệu mẫu `API_Leave.xlsx › API!A26–F31`, server.js:13-21; kiểm bằng L01-A02 | L01-A02, L01-A03, L01-A16, L01-A24, L01-E01, L01-E02, L01-E32, L01-M03 | ready |
| N3 | Đơn mẫu LV-20261124-002 — E001, Việc riêng, 2026-12-10, Cả ngày, Nháp | exists | dữ liệu mẫu `API_Leave.xlsx › API!A32–F32` | L01-A01, L01-A04, L01-E02, L01-E05, L01-E31, L01-E32, L01-E33, L01-E39, L01-E40, L01-M01 | ready |
| N4 | Đơn mẫu LV-20261124-001 — E001, Phép năm, 2026-12-01 → 2026-12-02, Chờ duyệt | exists | dữ liệu mẫu `API_Leave.xlsx › API!A31–F31` | L01-A04, L01-A16, L01-A20, L01-E03, L01-E04, L01-M01 | ready |
| N5 | Đơn mẫu LV-20261110-001 — E001, Phép năm, 2026-11-10 → 2026-11-11, Đã duyệt | exists | dữ liệu mẫu `API_Leave.xlsx › API!A29–F29` | L01-A04, L01-A16, L01-A20, L01-A24, L01-E06, L01-M01 | ready |
| N6 | Đơn mẫu LV-20261112-001 — E001, Nghỉ ốm, 2026-11-12 Sáng, Từ chối | exists | dữ liệu mẫu `API_Leave.xlsx › API!A30–F30` | L01-A04, L01-A16, L01-A20, L01-A25, L01-E07, L01-M01 | ready |
| N7 | Đơn mẫu LV-20261124-003 — chủ E002, Phép năm, 2026-12-03, Nháp (đơn "mồi" của người khác) | exists | dữ liệu mẫu `API_Leave.xlsx › API!A33–F33` | L01-A03, L01-A06, L01-A08, L01-A15, L01-A19, L01-A26, L01-E10 | ready |
| N8 | Mã đơn không tồn tại LV-20991231-999 | exists | không có trong dữ liệu mẫu và không thể được tạo (mã mới luôn theo ngày máy chủ 20261125) | L01-A05, L01-A15, L01-A19, L01-A26, L01-E09 | ready |
| N9 | Người dùng API mới (chưa có đơn, số dư 12,0), mỗi case một mã: E201–E215 | create-in-test | chỉ cần gửi header `X-User`; đơn của họ tạo trong case | L01-A07 (E201), L01-A08 (E202), L01-A09 (E203), L01-A10 (E204), L01-A11 (E205), L01-A12 (E206), L01-A13 (E207), L01-A14 (E208), L01-A17 (E209), L01-A18 (E210), L01-A21 (E211), L01-A22 (E212), L01-A23 (E213), L01-A25 (E214), L01-A27 (E215) | ready |
| N10 | Đơn Nháp của người dùng mới (Nghỉ ốm / Việc riêng 2026-12-14) làm tiền đề cho màn Sửa / Xem / Huỷ | create-in-test | POST /api/leaves qua API kit ở bước 1 của case | L01-E22 (E104), L01-E26 (E107), L01-E34 (E110), L01-E36 (E112), L01-E37 (E113), L01-E38 (E114) | ready |
| N11 | Đơn Đã huỷ của E101 | create-in-test | POST /api/leaves rồi POST /cancel qua API kit trong L01-E08; L01-M01 dùng lại (hoặc tạo lại qua màn nếu server đã khởi động lại) | L01-E08, L01-M01 | ready |
| N12 | Người dùng có số dư còn 2,0: 2 đơn Phép năm Chờ duyệt 2026-12-14 → 2026-12-18 và 2026-12-21 → 2026-12-25 (mỗi đơn 5 ngày thứ Hai–thứ Sáu, không có thứ Bảy nên không phụ thuộc D5) | create-in-test | API: E211 trong L01-A21; E2E: E108 trong L01-E27 (tạo + submit qua API kit) | L01-A21, L01-E27, L01-E28 | ready |
| N13 | Người dùng có 1 đơn Phép năm Chờ duyệt 2026-12-14 → 2026-12-16 (số dư 9,0) | create-in-test | API: E213 trong L01-A23; E2E: E111 trong L01-E35; E106 tạo qua màn trong L01-E25 | L01-A23, L01-E25, L01-E35 | ready |
| N14 | Đơn Nháp có Từ ngày đã qua so với "hôm nay" của máy chủ | cannot | A2/A3 chặn ngày quá khứ (LV-E02); `LEAVE_TODAY` cố định theo tiến trình; khởi động lại server thì mất dữ liệu; dữ liệu mẫu không có đơn Nháp ngày đã qua | (flow B77 — ở Not covered, không có case) | BLOCKED |
| N15 | Người dùng màn mới (số dư 12,0) cho case tạo đơn qua màn: E102, E103, E105, E106, E109, E115, E116, E117, E118 | create-in-test | mở màn với `?user=<mã>`; đơn tạo bằng Lưu nháp / Gửi duyệt trong case | L01-E17 (E102), L01-E21 (E103), L01-E23 (E105), L01-E25 (E106), L01-E30 (E109), L01-E40 (E115), L01-E41 (E116), L01-E44 (E117), L01-M02 (E118) | ready |
| N16 | Route giả của Playwright: A6 trả 500; POST /api/leaves bị abort; POST /api/leaves trả 500 `{code:"LV-E500"}` | create-in-test | `page.route(...)` trong case, không ghi server | L01-E29, L01-E30, L01-E42, L01-E43 | ready |
| N17 | Đồng hồ trình duyệt: 2026-11-25 (mặc định), 2026-11-26 (L01-E44), 2026-11-24 (L01-E45) | create-in-test | Playwright clock (`page.clock.setFixedTime` / `install`) | mọi case e2e; L01-E44, L01-E45 | ready |
| N18 | Chuỗi Lý do: 26 ký tự "Về quê thăm gia đình 3 ngày", 200 / 201 / 210 / 255 ký tự 'a', 3 dấu cách | create-in-test | sinh trong code test (`'a'.repeat(n)`) | L01-U11, L01-U13, L01-A09, L01-A10, L01-E14, L01-E16, L01-E19 | ready |
| N19 | Trình duyệt Chrome chế độ thiết bị 360 × 800 cho người chạy case manual | user-provides | người chạy (Vuong) tự mở DevTools device mode | L01-M01, L01-M02, L01-M03 | waiting |
| N20 | Hàm thuần của `lib/leave.js` (không cần server) | exists | `require('../lib/leave.js')` trong Jest | L01-U01 … L01-U18 | ready |

Dọn dữ liệu: mọi bản ghi tạo ra nằm trong bộ nhớ server local — khởi động lại server (`npm start`) là xoá hết. Mỗi case Writes = Y vẫn ghi `data-created.md` khi chạy (bước 7).

## To ask the user before the run
- N19 (user-provides): người chạy case manual L01-M01, L01-M02, L01-M03 cần Chrome ở chế độ thiết bị 360 × 800 — không cần dữ liệu khác.
- N14 (cannot): không có đơn Nháp ngày đã qua → flow B77 (A4 không kiểm lại LV-E02, BA Q10) không test được trên local; đã ở Not covered. Nếu muốn test: cần cách đặt "hôm nay" của máy chủ thay đổi trong lúc chạy (dev thêm cơ chế) — hỏi dev.
