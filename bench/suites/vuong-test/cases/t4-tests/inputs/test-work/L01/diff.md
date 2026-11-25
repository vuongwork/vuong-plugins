# Spec vs code — L01 Đăng ký nghỉ phép   (commit c490d55)

Lập ở bước 3 (phân tích), cập nhật ở bước 7 từ kết quả test. Mỗi dòng: một chỗ spec nói một đằng, code làm một nẻo.
Không phải danh sách bug: cột Decision cho biết bên nào đổi (sửa code / cập nhật spec), do người có tên quyết định.
Spec dùng: `L01_DangKyNghiPhep.xlsx` (v1.2, 2026-11-20) và `API_Leave.xlsx` (v1.1, 2026-11-18); khi hai spec khác nhau, spec màn thắng.
Cột Cases: chưa có case (bước 4 chưa làm) — điền khi viết cases.md.
Chưa có ai quyết định → mọi Decision là `open`; người duyệt test case: Vuong (tester), người quyết định phía spec: BA nhóm Nhân sự.

| Diff | Area | Spec says | Source | Code does | file:line | Cases | Decision |
|---|---|---|---|---|---|---|---|
| D1 | Lý do — giới hạn độ dài | Lý do tối đa **200** ký tự; quá 200 → LV-E06 | `L01_DangKyNghiPhep.xlsx › Item!E12` | giới hạn **255**: 201–255 ký tự được chấp nhận, chỉ 256+ mới báo LV-E06 (cả màn lẫn API A2/A3 vì dùng chung `validate`) | lib/leave.js:6, lib/leave.js:71, server.js:68, server.js:80 | (bước 4) | open — BA nhóm Nhân sự / dev: sửa code theo spec |
| D2 | Lý do — bộ đếm ký tự | bộ đếm dưới ô hiện "n/200" | `L01_DangKyNghiPhep.xlsx › Item!E12` (mock-up `design/L01.html:148` "26/200") | hiện "n/255" (ban đầu "0/255"), chuyển đỏ khi n > 255 | public/app.js:57-58, public/index.html:34 | (bước 4) | open — sửa code theo spec |
| D3 | Message LV-E06 | "Lý do tối đa 200 ký tự." | `L01_DangKyNghiPhep.xlsx › Message!C9` | "Lý do tối đa 255 ký tự." (ghép từ REASON_MAX) | lib/leave.js:14 | (bước 4) | open — sửa code theo spec |
| D4 | Message LV-E02 | "Ngày bắt đầu không được trước hôm nay." | `L01_DangKyNghiPhep.xlsx › Message!C5` | "Ngày bắt đầu phải từ hôm nay trở đi." (màn và `message` của API) | lib/leave.js:10 | (bước 4) | open — sửa code theo spec |
| D5 | Số ngày nghỉ — ngày cuối tuần | chỉ đếm ngày làm việc **thứ Hai – thứ Sáu** | `L01_DangKyNghiPhep.xlsx › Item!E10` | `isWeekend` so `getDay() === 7` (không bao giờ đúng) → **thứ Bảy được đếm** là ngày làm việc; vd 27/11/2026 (T6) → 30/11/2026 (T2) ra 3,0 thay vì 2,0. Ảnh hưởng cả số dư (A6) và LV-E04 (A4) vì `days` lưu theo cách tính này | lib/leave.js:43-46, lib/leave.js:54, server.js:70, server.js:82 | (bước 4) | open — sửa code theo spec |
| D6 | Số ngày nghỉ — nửa ngày vào cuối tuần | Sáng hoặc Chiều = 0,5; chỉ đếm thứ Hai – thứ Sáu (spec không nói rõ nửa ngày cuối tuần — Q1, giả định 0) | `L01_DangKyNghiPhep.xlsx › Item!E10` | Chủ nhật buổi Sáng = 0, nhưng thứ Bảy buổi Sáng = 0,5 (hệ quả D5). `tests/leave.test.js:12-14` còn khẳng định thứ Bảy = 0,5 | lib/leave.js:52 | (bước 4) | open — chờ BA trả lời Q1 |
| D7 | Định dạng số (Số ngày nghỉ, Số dư) | dạng "3,0", "12,0" (dấu phẩy thập phân), 1 chữ số thập phân | `L01_DangKyNghiPhep.xlsx › Giao dien!B23`, `Item!E10`, `Item!E11` | `toFixed(1)` → "3.0", "12.0" (dấu chấm); ô mặc định "0.0"; n trong LV-E04 cũng dấu chấm ("còn 8.0 ngày") | lib/leave.js:58-60, public/index.html:30, server.js:88, public/app.js:130 | (bước 4) | open — BA xác nhận dấu thập phân, rồi sửa code hoặc spec |
| D8 | Nút Huỷ đơn — điều kiện hiện | chỉ hiện ở Sửa, Xem khi trạng thái **Nháp hoặc Chờ duyệt** | `L01_DangKyNghiPhep.xlsx › Nut!B7` | hiện khi chế độ ≠ Tạo mới và trạng thái ≠ approved → **hiện cả với đơn Từ chối và Đã huỷ** (bấm Đồng ý thì nhận snackbar LV-E409) | public/app.js:87 | (bước 4) | open — sửa code theo spec |
| D9 | A5 huỷ đơn — trạng thái cho phép | 409 LV-E409 khi trạng thái không phải draft hoặc pending (spec màn: chỉ Nháp / Chờ duyệt) | `API_Leave.xlsx › API!E20`, `L01_DangKyNghiPhep.xlsx › Nut!B7` | chấp nhận cả **approved** → 200, status = cancelled (và trả lại số dư phép năm) | server.js:93 | (bước 4) | open — sửa code theo spec |
| D10 | A3 sửa đơn — trạng thái cho phép | 409 LV-E409 khi đơn không ở trạng thái draft | `API_Leave.xlsx › API!E18` (spec màn: Sửa chỉ khi Nháp, `L01_DangKyNghiPhep.xlsx › Che do!C5`) | **không kiểm trạng thái**: PUT đơn pending/approved/rejected/cancelled vẫn 200 và ghi đè dữ liệu, tính lại days (đơn approved đổi days → đổi số dư) | server.js:78-84 (`grep -n "LV-E409" server.js` chỉ thấy :86, :93) | (bước 4) | open — sửa code theo spec |
| D11 | Snackbar lỗi LV-E04 từ API | lỗi từ API hiện snackbar đỏ với nội dung của mã ở mục 5: "Số ngày nghỉ vượt quá số dư phép năm (còn {n} ngày)." với n là số dư | `L01_DangKyNghiPhep.xlsx › Nut!A10`, `Message!C7` | màn bỏ `message` máy chủ trả về, gọi `L.message(e.code)` không truyền biến → snackbar hiện nguyên chữ "**(còn {n} ngày)**" | public/app.js:139, public/app.js:20 | (bước 4) | open — sửa code theo spec |
| D12 | Số dư phép năm ở chế độ Sửa (vào từ nút Sửa) | Số dư hiện ở Tạo mới và Sửa, lấy từ A6; Gửi duyệt kiểm LV-E04 | `L01_DangKyNghiPhep.xlsx › Item!F11`, `Item!A15` | chỉ gọi A6 khi trang mở không ở chế độ Xem; vào Sửa bằng nút Sửa (từ Xem) thì Số dư hiện "–" và màn **bỏ qua kiểm LV-E04** (balance = null), lỗi chỉ đến từ máy chủ (kèm D11) | public/app.js:161, public/app.js:179, public/app.js:110, public/app.js:130 | (bước 4) | open — sửa code theo spec |
| D13 | "Hôm nay" khi kiểm LV-E02 trên màn | "Hôm nay" là ngày của máy chủ | `API_Leave.xlsx › API!A7` (spec màn `L01_DangKyNghiPhep.xlsx › Item!E7` không nói ngày của máy nào — Q8) | màn dùng ngày của trình duyệt/điện thoại; máy chủ dùng `LEAVE_TODAY` hoặc ngày máy chủ → hai bên có thể cho kết quả khác nhau | public/app.js:7, server.js:10 | (bước 4) | open — chờ BA trả lời Q8 |

## Spec rules without code

Đã tìm trên toàn repo (`server.js`, `lib/`, `public/`) cho từng quy tắc bên dưới.

| Rule | Source | Searched (command + scope) | Result | Note |
|---|---|---|---|---|
| A3 trả 409 LV-E409 khi đơn không ở draft | `API_Leave.xlsx › API!E18` | `grep -rn "LV-E409\|status !== 'draft'" server.js lib public` | không có kiểm trong nhánh PUT (chỉ thấy server.js:86 submit, server.js:93 cancel, public/app.js:176 chọn chế độ) | đã ghi D10 |
| Bộ đếm "n/200" và giới hạn 200 | `L01_DangKyNghiPhep.xlsx › Item!E12` | `grep -rn "200\|REASON_MAX" server.js lib public` | chỉ có REASON_MAX = 255 (lib/leave.js:6); "200" chỉ là HTTP status | đã ghi D1–D3 |
| Dấu phẩy thập phân "3,0" | `L01_DangKyNghiPhep.xlsx › Giao dien!B23` | `grep -rn "toLocaleString\|replace('.'\|toFixed" server.js lib public` | chỉ có `toFixed(1)` (lib/leave.js:59) | đã ghi D7 |

Mọi quy tắc khác trong `L01_DangKyNghiPhep.xlsx` (Che do, Item, Nut, Message) và `API_Leave.xlsx › API!A16–E21` đều tìm thấy code tương ứng (xem cột file:line trong flows.md).

## Code without spec

Hành vi nghiệp vụ code có mà không nguồn nào mô tả. Mỗi nhóm kèm câu hỏi BA (chi tiết ở `test-work/L01/spec-sources.md › Questions for BA`).

| Theme | Code does | file:line | Question for BA |
|---|---|---|---|
| Từ ngày / Đến ngày để trống | Từ ngày trống → LV-E02, Đến ngày trống → LV-E03 | lib/leave.js:67-68 | Ngày để trống hiện mã nào? (Q2) |
| Lý do toàn khoảng trắng | Loại = Khác + lý do chỉ khoảng trắng → LV-E05 (dùng `trim`) | lib/leave.js:70 | Khoảng trắng có tính là "để trống"? (Q3) |
| 401 | `{code:"LV-E401", message:"Unauthorized"}` — mã và nội dung không có trong mục 5 | server.js:107 | 401 trả mã/nội dung gì? (Q4) |
| Tiêu đề hộp xác nhận | "Xác nhận gửi duyệt" / "Xác nhận huỷ đơn" / "Bỏ thay đổi" | public/app.js:133, :143, :148 | Tiêu đề của LV-C01/C02/C03? (Q5) |
| Màn lỗi LV-E404/E403 | tiêu đề vẫn là "Tạo đơn nghỉ phép" | public/app.js:168-173, public/index.html:15 | Tiêu đề khi không mở được đơn? (Q6) |
| Gửi duyệt từ Tạo mới, A4 lỗi | đơn Nháp đã được tạo nhưng màn vẫn ở Tạo mới (không mã đơn, URL không đổi); lần bấm sau gọi PUT | public/app.js:115, :135-139 | Màn chuyển chế độ nào? (Q7) |
| Không lấy được số dư | ô Số dư "–", màn bỏ kiểm LV-E04 | public/app.js:110, :130 | Hiển thị / chặn thế nào? (Q9) |
| A4 không kiểm lại dữ liệu | gửi duyệt đơn Nháp có Từ ngày đã qua vẫn 200 | server.js:85-91 | A4 có kiểm lại LV-E02? (Q10) |
| Mất thay đổi ngoài nút Quay lại | tải lại trang / back trình duyệt không hỏi LV-C03 | public/app.js:147-150 | Có cần cảnh báo? (Q11) |
| Lỗi mạng / mã ngoài mục 5 | snackbar đỏ trống (lỗi mạng) hoặc hiện chính mã (LV-E401, LV-E500) | public/app.js:19-20, lib/leave.js:27, server.js:108 | Snackbar hiện gì? (Q12) |
| Người dùng trên màn | lấy từ `?user=` → localStorage → mặc định E001 | public/app.js:6 | (thuộc môi trường test, không hỏi BA) |
| Route API lạ / JSON hỏng | 404 LV-E404 cho đường dẫn/method lạ; thân không phải JSON → 400 LV-E01 | server.js:43, :63, :97 | (ghi nhận, không chặn case) |
| Mã đơn khi > 999 đơn/ngày | sinh `LV-yyyymmdd-1000` (sai dạng nnn) | server.js:23-28 | Giới hạn số đơn/ngày? (ghi nhận, rủi ro thấp) |

Ghi chú (không phải khác biệt code): `API_Leave.xlsx › API!A26` ghi "số dư năm 12,0" của E001 và `L01_DangKyNghiPhep.xlsx › Giao dien!B23` vẽ "Số dư 12,0"; nhưng dữ liệu mẫu (`API!A29`, `A31`) có 4,0 ngày phép năm đã duyệt/chờ duyệt nên A6 trả `remaining` = 8,0 (server.js:30-34 tính đúng theo `API!D21`). Case kiểm Số dư nên dùng 8,0, không lấy 12,0 từ hình vẽ.
