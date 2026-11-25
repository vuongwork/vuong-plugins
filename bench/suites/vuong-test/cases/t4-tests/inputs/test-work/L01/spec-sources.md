# Sources — L01 Đăng ký nghỉ phép   (commit c490d55)

Scope: màn L01 (FE `public/app.js`, `public/index.html`, `lib/leave.js`) + API A1–A6 trong `server.js`.
Layer: ut (Jest), api (API kit), e2e (Playwright). Môi trường: local `http://localhost:3210` (`npm start`), được ghi dữ liệu (bộ nhớ, khởi động lại là sạch).
Tester file: none. Người duyệt: Vuong (tester).
Thứ tự ưu tiên khi spec khác nhau (`test.config.json › specPrecedence`): **screen > api** (spec màn thắng spec API).
Không có: acceptance test, ticket, decision ledger (`specMissing`) → mọi expected không có trong 2 file dưới đây là **assumption**.

| # | Source | Kind | Location | Version (modified / sha256) | Covers |
|---|---|---|---|---|---|
| S1 | `L01_DangKyNghiPhep.xlsx` | screen | `docs/spec/L01_DangKyNghiPhep.xlsx` — sheets Giao dien, Che do, Item, Nut, Message (bản đọc: `test-work/_spec/L01_DangKyNghiPhep.xlsx.md`) | Phiên bản 1.2 · 2026-11-20 (Giao dien!A3); file modified 2026-11-25T14:44:26Z; sha256 `fa3d7ab6812af948b6b89b05694c7de236d9f30bd20457692148eb091170d7c4` | chế độ, item, quy tắc, nút, message, giao diện |
| S2 | `API_Leave.xlsx` | api | `docs/spec/API_Leave.xlsx` — sheet API (bản đọc: `test-work/_spec/API_Leave.xlsx.md`) | Phiên bản 1.1 · 2026-11-18 (API!A3); file modified 2026-11-25T14:44:26Z; sha256 `9b63e9704ab537f1e208aa999bb5dc350cac17bef608fc551073ee20ff60c55b` | A1–A6, mã lỗi HTTP, quyền, dữ liệu mẫu |
| S3 | `design/L01.html` | mock-up (không nằm trong `specPaths`) | `design/L01.html` | trong commit c490d55 | hình ảnh các màn L01-N, L01-NE, L01-V, L01-C (S1 › Giao dien!A22–B26). Chỉ dùng tham khảo hiển thị; khớp S1 (bộ đếm "26/200", "210/200", "Lý do tối đa 200 ký tự." ở dòng 148, 172) |

Không phải nguồn (chỉ dùng để tìm flow): code, comment, `tests/leave.test.js` (test có sẵn — có test kỳ vọng thứ Bảy buổi sáng = 0,5 và lý do 250 ký tự hợp lệ, trái S1; cần `/vuong-test:review-tests` trước khi tin).

## Rules

| R | Rule | Source |
|---|---|---|
| R1 | Chế độ Tạo mới mở bằng `/?mode=new`, luôn được | `L01_DangKyNghiPhep.xlsx › Che do!A4–C4` |
| R2 | Chế độ Sửa mở bằng `/?id=<mã>&mode=edit`, chỉ khi đơn Nháp; trạng thái khác → mở chế độ Xem | `L01_DangKyNghiPhep.xlsx › Che do!A5–C5` |
| R3 | Chế độ Xem mở bằng `/?id=<mã>`, mọi trạng thái | `L01_DangKyNghiPhep.xlsx › Che do!A6–C6` |
| R4 | Đơn không tồn tại / không phải của người đăng nhập → thông báo LV-E404 / LV-E403 thay cho thẻ nội dung, chỉ còn nút Quay lại | `L01_DangKyNghiPhep.xlsx › Che do!A8–A9` |
| R5 | Tiêu đề app bar theo chế độ: "Tạo đơn nghỉ phép" / "Sửa đơn nghỉ phép" / "Chi tiết đơn nghỉ phép" | `L01_DangKyNghiPhep.xlsx › Giao dien!A12–A13` |
| R6 | Mã đơn: chỉ đọc, dạng LV-yyyymmdd-nnn, hệ thống cấp khi lưu lần đầu; hiện ở Sửa, Xem | `L01_DangKyNghiPhep.xlsx › Item!A4–F4` |
| R7 | Trạng thái: nhãn tròn Nháp / Chờ duyệt / Đã duyệt / Từ chối / Đã huỷ; hiện ở Sửa, Xem; màu Nháp xám, Chờ duyệt cam, Đã duyệt xanh lá, Từ chối đỏ, Đã huỷ xám đậm | `L01_DangKyNghiPhep.xlsx › Item!A5–F5`, `Giao dien!A10–A11` |
| R8 | Loại nghỉ: bắt buộc, Phép năm / Nghỉ ốm / Việc riêng / Khác; chưa chọn → LV-E01; Xem: chỉ đọc | `L01_DangKyNghiPhep.xlsx › Item!A6–F6` |
| R9 | Từ ngày: bắt buộc, không trước hôm nay (chỉ kiểm khi Tạo mới và Sửa) → LV-E02 | `L01_DangKyNghiPhep.xlsx › Item!A7–F7` |
| R10 | Đến ngày: bắt buộc, không trước Từ ngày → LV-E03 | `L01_DangKyNghiPhep.xlsx › Item!A8–F8` |
| R11 | Buổi: Cả ngày / Sáng / Chiều; chỉ bật khi Từ ngày = Đến ngày; khác ngày → khoá ở Cả ngày | `L01_DangKyNghiPhep.xlsx › Item!A9–F9` |
| R12 | Số ngày nghỉ: số ngày làm việc thứ Hai–thứ Sáu từ Từ ngày đến Đến ngày, tính cả hai đầu; Sáng/Chiều = 0,5; 1 chữ số thập phân; tính lại ngay khi đổi ngày / buổi | `L01_DangKyNghiPhep.xlsx › Item!A10–F10` |
| R13 | Hiển thị số dạng "3,0", "12,0" (dấu phẩy thập phân) | `L01_DangKyNghiPhep.xlsx › Giao dien!B23` |
| R14 | Số dư phép năm: chỉ đọc, lấy từ A6, 1 chữ số thập phân; hiện ở Tạo mới, Sửa | `L01_DangKyNghiPhep.xlsx › Item!A11–F11` |
| R15 | Lý do: bắt buộc khi Loại = Khác (trống → LV-E05); tối đa 200 ký tự (quá → LV-E06); bộ đếm "n/200" dưới ô | `L01_DangKyNghiPhep.xlsx › Item!A12–F12` |
| R16 | Lưu nháp / Gửi duyệt: kiểm tất cả quy tắc mục 3–9; có lỗi thì không gọi API, hiện mọi lỗi cùng lúc; lỗi dưới ô, chữ đỏ, viền đỏ | `L01_DangKyNghiPhep.xlsx › Item!A14`, `Giao dien!A14–A15` |
| R17 | Gửi duyệt thêm: Loại = Phép năm và Số ngày nghỉ > Số dư → LV-E04 dưới Số ngày nghỉ | `L01_DangKyNghiPhep.xlsx › Item!A15` |
| R18 | Lưu nháp (hiện ở Tạo mới, Sửa): kiểm tra → A2 hoặc A3 → snackbar LV-I01 → chế độ Sửa của đơn | `L01_DangKyNghiPhep.xlsx › Nut!A4–C4` |
| R19 | Gửi duyệt (hiện ở Tạo mới, Sửa): kiểm tra (gồm LV-E04) → hộp LV-C01 → Đồng ý: lưu (A2/A3) rồi A4 → LV-I02 → chế độ Xem; Huỷ bỏ: đóng hộp, không làm gì | `L01_DangKyNghiPhep.xlsx › Nut!A5–C5` |
| R20 | Nút Sửa: hiện ở Xem khi trạng thái Nháp → chế độ Sửa | `L01_DangKyNghiPhep.xlsx › Nut!A6–C6` |
| R21 | Nút Huỷ đơn: hiện ở Sửa, Xem, chỉ khi Nháp hoặc Chờ duyệt → hộp LV-C02 → Đồng ý: A5 → LV-I03 → Xem (Đã huỷ) | `L01_DangKyNghiPhep.xlsx › Nut!A7–C7` |
| R22 | Nút Quay lại: luôn hiện; có thay đổi chưa lưu → hộp LV-C03; không → về trang trước | `L01_DangKyNghiPhep.xlsx › Nut!A8–C8` |
| R23 | Lỗi từ API: snackbar đỏ với nội dung của mã ở mục 5; dữ liệu trên màn giữ nguyên | `L01_DangKyNghiPhep.xlsx › Nut!A10` |
| R24 | Snackbar thành công: tối, ở đáy trên hàng nút, tự ẩn sau 3 giây | `L01_DangKyNghiPhep.xlsx › Giao dien!A17` |
| R25 | Hộp xác nhận: lớp tối mờ, hộp trắng giữa màn, tiêu đề, nội dung, nút "Huỷ bỏ" và "Đồng ý" | `L01_DangKyNghiPhep.xlsx › Giao dien!A18` |
| R26 | Nội dung message LV-E01…LV-C03 (bảng mục 5) | `L01_DangKyNghiPhep.xlsx › Message!A4–C18` |
| R27 | API: thiếu header X-User → 401; lỗi trả `{code, message}` với mã/nội dung từ L01 mục 5; ngày YYYY-MM-DD | `API_Leave.xlsx › API!A5–A6` |
| R28 | "Hôm nay" là ngày của máy chủ | `API_Leave.xlsx › API!A7` |
| R29 | Đối tượng đơn {id, owner, type, from, to, part, days, reason, status, createdAt, updatedAt}; type/part/status như liệt kê; days do máy chủ tính (không nhận từ client) | `API_Leave.xlsx › API!A9–A13` |
| R30 | A1 GET /api/leaves/:id → 200; 404 LV-E404; 403 LV-E403 khi không phải chủ đơn | `API_Leave.xlsx › API!A16–E16` |
| R31 | A2 POST /api/leaves → 201 draft có id; 400 với mã lỗi đầu tiên theo thứ tự LV-E01, E02, E03, E05, E06 | `API_Leave.xlsx › API!A17–E17` |
| R32 | A3 PUT /api/leaves/:id → 200; 404; 403; 409 LV-E409 khi không ở draft; 400 như A2 | `API_Leave.xlsx › API!A18–E18` |
| R33 | A4 POST /:id/submit → 200 pending; 404; 403; 409 khi không phải draft; 400 LV-E04 khi annual và days > số dư | `API_Leave.xlsx › API!A19–E19` |
| R34 | A5 POST /:id/cancel → 200 cancelled; 404; 403; 409 khi không phải draft hoặc pending | `API_Leave.xlsx › API!A20–E20` |
| R35 | A6 GET /api/leave-balance → 200 {annual, used, remaining}, used = tổng days đơn annual pending/approved; 401 | `API_Leave.xlsx › API!A21–E21` |
| R36 | Quyền: mọi API chỉ thao tác trên đơn của chính người gọi; không có API duyệt/từ chối | `API_Leave.xlsx › API!A23–A24` |
| R37 | Dữ liệu mẫu khi khởi động: E001 số dư năm 12,0; 5 đơn LV-20261110-001 … LV-20261124-003 (bảng) | `API_Leave.xlsx › API!A26–F33` |

## Conflicts

| X | Topic | Source A says | Source B says | Resolved by |
|---|---|---|---|---|
| — | Không thấy mâu thuẫn trực tiếp giữa `L01_DangKyNghiPhep.xlsx` và `API_Leave.xlsx`: API dẫn về L01 cho message (API!A6), cách tính days (API!A13); điều kiện huỷ (Nut!B7 ↔ API!E20) và quy tắc Sửa chỉ khi Nháp (Che do!C5 ↔ API!E18) trùng nhau. | | | Nếu phát sinh: screen thắng (`specPrecedence`) |
| X1 | "Hôm nay" dùng để kiểm LV-E02 trên màn | `L01_DangKyNghiPhep.xlsx › Item!E7` chỉ nói "không trước hôm nay", không nói ngày của máy nào | `API_Leave.xlsx › API!A7`: ngày của máy chủ | Không trái nhau; áp dụng API!A7 cho cả màn (assumption, Q8) |

## Questions for BA

Giả định dùng tạm khi chưa có trả lời được ghi ở cột "Giả định tạm". Mọi case dựa trên giả định → assumption, không duyệt được cho tới khi BA trả lời.

| Q | Question | Giả định tạm | Cases blocked | Asked to | Date | Answer |
|---|---|---|---|---|---|---|
| Q1 | Nghỉ nửa ngày (Sáng/Chiều) rơi vào thứ Bảy / Chủ nhật: Số ngày nghỉ = 0 hay 0,5? (Item!E10 chỉ nói "số ngày làm việc thứ Hai – thứ Sáu" và "Sáng hoặc Chiều = 0,5") | 0 (không phải ngày làm việc) | (bước 4) | BA nhóm Nhân sự | 2026-11-25 | |
| Q2 | Từ ngày / Đến ngày để trống (Item!D7, D8 = bắt buộc) hiện mã nào? Spec không có message "bắt buộc" riêng | Từ ngày trống → LV-E02, Đến ngày trống → LV-E03 | | BA | 2026-11-25 | |
| Q3 | Loại = Khác, Lý do chỉ toàn khoảng trắng có tính là "để trống" (LV-E05)? | có | | BA | 2026-11-25 | |
| Q4 | Thiếu X-User → 401 trả mã/nội dung gì? Mục 5 không có mã 401 | chỉ kiểm HTTP 401 | | BA | 2026-11-25 | |
| Q5 | Tiêu đề của các hộp xác nhận LV-C01/C02/C03 là gì? (Giao dien!A18 nói có tiêu đề nhưng không cho nội dung) | không kiểm tiêu đề | | BA | 2026-11-25 | |
| Q6 | Màn báo LV-E404/LV-E403: tiêu đề app bar hiện gì? | "Chi tiết đơn nghỉ phép" (URL có id) | | BA | 2026-11-25 | |
| Q7 | Tạo mới → Gửi duyệt → Đồng ý: A2 thành công nhưng A4 lỗi (vd LV-E04 từ máy chủ). Màn ở chế độ nào, đơn Nháp vừa tạo xử lý thế nào? | chuyển sang Sửa của đơn Nháp đã tạo | | BA | 2026-11-25 | |
| Q8 | Kiểm LV-E02 trên màn dùng ngày của máy chủ (API!A7) hay ngày của điện thoại? | máy chủ | | BA | 2026-11-25 | |
| Q9 | Không lấy được số dư (A6 lỗi): ô Số dư hiện gì, có chặn LV-E04 ở màn không? | hiện "–", để máy chủ chặn bằng LV-E04 | | BA | 2026-11-25 | |
| Q10 | A4 gửi duyệt có kiểm lại LV-E02 (Từ ngày đã qua so với hôm nay) không? | không (API!E19 chỉ liệt kê 409, LV-E04) | | BA | 2026-11-25 | |
| Q11 | Quay lại bằng nút back của trình duyệt / tải lại trang khi có thay đổi chưa lưu có cần LV-C03 không? | không bắt buộc (Nut!A8 chỉ nói nút Quay lại) | | BA | 2026-11-25 | |
| Q12 | Lỗi mạng / lỗi 500 / mã không có trong mục 5: snackbar hiện gì? | snackbar đỏ có nội dung đọc được (không trống) | | BA | 2026-11-25 | |
| Q13 | Đơn đã Từ chối / Đã huỷ: ngoài Quay lại còn nút nào? (Nut!B7 loại Huỷ đơn; Nut!B6 loại Sửa) | chỉ Quay lại | | BA | 2026-11-25 | |
