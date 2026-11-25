# Flows — L01 Đăng ký nghỉ phép   (commit c490d55)

Nguồn: spec `L01_DangKyNghiPhep.xlsx`, `API_Leave.xlsx` + code `public/app.js`, `public/index.html`, `lib/leave.js`, `server.js`.
Cột "In spec?": `yes (<file> › ô)` / `no` (code có, spec không nói → câu hỏi BA trong spec-sources.md) / `differs` (spec có nhưng code khác → xem diff.md).

## Entry points

| Ref | Kind | Name | Calls (method + path) | file:line | In spec? |
|---|---|---|---|---|---|
| E1 | screen-mode | Tạo mới (URL không có `id`) | GET /api/leave-balance | public/app.js:9, :179 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A4`) |
| E2 | screen-mode | Sửa (`?id=<mã>&mode=edit`) | GET /api/leaves/:id, GET /api/leave-balance | public/app.js:9, :176, :179 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A5`) |
| E3 | screen-mode | Xem (`?id=<mã>`) | GET /api/leaves/:id | public/app.js:9, :168 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A6`) |
| E4 | screen-state | Không mở được đơn (lỗi GET) → thông báo thay thẻ | GET /api/leaves/:id | public/app.js:168-173 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A8`) |
| E5 | button | Lưu nháp | POST /api/leaves (chưa có đơn) hoặc PUT /api/leaves/:id | public/app.js:119-124, :113-117; public/index.html:39 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A4`) |
| E6 | button | Gửi duyệt | POST/PUT như E5, rồi POST /api/leaves/:id/submit | public/app.js:126-140; public/index.html:40 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A5`) |
| E7 | button | Sửa | — | public/app.js:161; public/index.html:41 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A6`) |
| E8 | button | Huỷ đơn | POST /api/leaves/:id/cancel | public/app.js:142-145; public/index.html:42 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A7`) |
| E9 | button | Quay lại (mũi tên app bar + nút đáy) | — (history.back) | public/app.js:147-150, :162; public/index.html:15, :43 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A8`, `Giao dien!A12`) |
| E10 | field | Nhập Loại / Từ ngày / Đến ngày / Lý do (tính lại + đánh dấu thay đổi) | — | public/app.js:153, :49-59 | yes (`L01_DangKyNghiPhep.xlsx › Item!E10`) |
| E11 | field | Chọn Buổi (Cả ngày / Sáng / Chiều) | — | public/app.js:154-157; public/index.html:28 | yes (`L01_DangKyNghiPhep.xlsx › Item!A9`) |
| E12 | dialog | Hộp xác nhận (Huỷ bỏ / Đồng ý) dùng chung cho LV-C01/C02/C03 | — | public/app.js:34-43; public/index.html:45-51 | yes (`L01_DangKyNghiPhep.xlsx › Giao dien!A18`) |
| E13 | param | Người dùng FE: `?user=` → localStorage `user` → mặc định E001, gửi làm header X-User | — | public/app.js:6, :17 | no |
| E14 | endpoint | A1 GET /api/leaves/:id | | server.js:74-77 | yes (`API_Leave.xlsx › API!A16`) |
| E15 | endpoint | A2 POST /api/leaves | | server.js:66-73 | yes (`API_Leave.xlsx › API!A17`) |
| E16 | endpoint | A3 PUT /api/leaves/:id | | server.js:78-84 | yes (`API_Leave.xlsx › API!A18`) |
| E17 | endpoint | A4 POST /api/leaves/:id/submit | | server.js:85-91 | yes (`API_Leave.xlsx › API!A19`) |
| E18 | endpoint | A5 POST /api/leaves/:id/cancel | | server.js:92-96 | yes (`API_Leave.xlsx › API!A20`) |
| E19 | endpoint | A6 GET /api/leave-balance | | server.js:62, :30-34 | yes (`API_Leave.xlsx › API!A21`) |
| E20 | middleware | Xác thực header X-User cho mọi /api/* | | server.js:105-107 | yes (`API_Leave.xlsx › API!A5`) |
| E21 | endpoint | Đường dẫn /api khác (không phải leaves, action lạ, method lạ) | | server.js:63, :97 | no |
| E22 | middleware | Lỗi không bắt được → 500 LV-E500 | | server.js:108 | no |
| E23 | lib (UT) | `workingDays`, `formatDays`, `validate`, `normalizePart`, `message`, `parseDate` | | lib/leave.js:26-78 | yes (`L01_DangKyNghiPhep.xlsx › Item!E6–E12`, `Message!A4–C18`) |
| E24 | startup | Dữ liệu mẫu khi khởi động máy chủ | | server.js:13-21 | yes (`API_Leave.xlsx › API!A26–F33`) |

## Branches / validations / errors

### Màn — chế độ, hiển thị (E1–E4)

| Ref | Under | Condition | Result / error code | file:line | In spec? |
|---|---|---|---|---|---|
| B1 | E1 Tạo mới | không có `id` (kể cả không có `mode=new`) | chế độ Tạo mới, tiêu đề "Tạo đơn nghỉ phép", ẩn Mã đơn + Trạng thái, hiện Số dư | public/app.js:9, :73, :77-78 | yes (`L01_DangKyNghiPhep.xlsx › Che do!B4`, `Item!F4`, `Item!F11`) |
| B2 | E2 Sửa | `mode=edit` và đơn Nháp | chế độ Sửa, tiêu đề "Sửa đơn nghỉ phép", điền dữ liệu đơn | public/app.js:9, :175, :73 | yes (`L01_DangKyNghiPhep.xlsx › Che do!C5`) |
| B3 | E2 Sửa | `mode=edit` và đơn không phải Nháp | mở chế độ Xem | public/app.js:176 | yes (`L01_DangKyNghiPhep.xlsx › Che do!C5`) |
| B4 | E3 Xem | có `id`, `mode` khác `edit` | chế độ Xem, các ô disabled + kiểu `ro`, ẩn Số dư, Buổi khoá | public/app.js:9, :74-78, :53 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A6`, `Item!F6`, `Item!F11`) |
| B5 | E4 | GET trả 404 | ẩn thẻ, hiện "Không tìm thấy đơn nghỉ phép.", ẩn Lưu nháp/Gửi duyệt/Sửa/Huỷ đơn, còn Quay lại | public/app.js:168-173 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A8–A9`) |
| B6 | E4 | GET trả 403 (đơn người khác, vd LV-20261124-003 của E002) | như B5 với "Bạn không có quyền xem đơn này." | public/app.js:168-173 | yes (`L01_DangKyNghiPhep.xlsx › Che do!A8`) |
| B7 | E4 | màn lỗi: tiêu đề app bar | giữ tiêu đề mặc định HTML "Tạo đơn nghỉ phép" (render() không chạy) | public/app.js:173; public/index.html:15 | no (Q6) |
| B8 | E1–E3 | Mã đơn + nhãn trạng thái (text + class màu theo status) | hiện khi mode ≠ new | public/app.js:77, :79-83 | yes (`L01_DangKyNghiPhep.xlsx › Item!A4–A5`, `Giao dien!A11`) |
| B9 | E1–E3 | hiện nút Lưu nháp + Gửi duyệt | khi mode ≠ view | public/app.js:85 | yes (`L01_DangKyNghiPhep.xlsx › Nut!B4–B5`) |
| B10 | E3 | hiện nút Sửa | Xem và status = draft | public/app.js:86 | yes (`L01_DangKyNghiPhep.xlsx › Nut!B6`) |
| B11 | E2/E3 | hiện nút Huỷ đơn | mode ≠ new và status ≠ approved (→ hiện cả khi rejected, cancelled) | public/app.js:87 | differs (`L01_DangKyNghiPhep.xlsx › Nut!B7`: chỉ Nháp hoặc Chờ duyệt) |
| B12 | E1–E3 | nút Quay lại | luôn hiện | public/index.html:15, :43 | yes (`L01_DangKyNghiPhep.xlsx › Nut!B8`) |
| B13 | E1, E2 | Số dư: load A6 thành công | hiện `remaining` 1 chữ số thập phân | public/app.js:110 | yes (`L01_DangKyNghiPhep.xlsx › Item!E11`) |
| B14 | E1, E2 | Số dư: A6 lỗi | hiện "–", `balance` = null | public/app.js:110 | no (Q9) |
| B15 | E7 Sửa từ Xem | vào Sửa bằng nút Sửa | không gọi lại A6 → Số dư vẫn "–", kiểm LV-E04 ở màn bị bỏ qua | public/app.js:161, :99-107, :179 | differs (`L01_DangKyNghiPhep.xlsx › Item!F11`: Số dư hiện ở chế độ Sửa) |

### Màn — nhập liệu, tính toán (E10, E11)

| Ref | Under | Condition | Result / error code | file:line | In spec? |
|---|---|---|---|---|---|
| B16 | E11 | Từ ngày = Đến ngày (và đã chọn), không phải Xem | Buổi bật, chọn được Sáng/Chiều | public/app.js:51-53, :154-157 | yes (`L01_DangKyNghiPhep.xlsx › Item!E9`) |
| B17 | E11 | Từ ngày ≠ Đến ngày hoặc trống | Buổi khoá, ép về Cả ngày | public/app.js:52-53; lib/leave.js:76-78 | yes (`L01_DangKyNghiPhep.xlsx › Item!E9`) |
| B18 | E11 | bấm Buổi khi đang khoá | không làm gì | public/app.js:155 | yes (`L01_DangKyNghiPhep.xlsx › Item!E9`) |
| B19 | E10 | đổi ngày / buổi | tính lại Số ngày nghỉ ngay | public/app.js:153, :55 | yes (`L01_DangKyNghiPhep.xlsx › Item!E10`) |
| B20 | E23 workingDays | khoảng ngày cả ngày | đếm ngày không phải cuối tuần; `isWeekend` chỉ coi Chủ nhật (getDay 0) là cuối tuần → thứ Bảy được đếm | lib/leave.js:43-46, :53-55 | differs (`L01_DangKyNghiPhep.xlsx › Item!E10`: thứ Hai – thứ Sáu) |
| B21 | E23 workingDays | cùng ngày, Sáng/Chiều | 0,5; nếu ngày đó là cuối tuần theo `isWeekend` → 0 (Chủ nhật = 0, thứ Bảy = 0,5) | lib/leave.js:52 | partly (0,5: `L01_DangKyNghiPhep.xlsx › Item!E10`; cuối tuần: no, Q1) |
| B22 | E23 workingDays | ngày thiếu/sai dạng hoặc Đến < Từ | 0 | lib/leave.js:51 | no |
| B23 | E23 formatDays | hiển thị số | `toFixed(1)` → "3.0" (dấu chấm) | lib/leave.js:58-60; public/index.html:30 | differs (`L01_DangKyNghiPhep.xlsx › Giao dien!B23`: "3,0", "12,0") |
| B24 | E10 | bộ đếm Lý do | "n/255", đỏ khi n > 255 | public/app.js:56-58; public/index.html:34; lib/leave.js:6 | differs (`L01_DangKyNghiPhep.xlsx › Item!E12`: "n/200") |
| B25 | E10, E11 | sửa bất kỳ trường / bấm Buổi | `dirty = true` | public/app.js:153, :156 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C8`) |

### Màn — validation khi Lưu nháp / Gửi duyệt (E5, E6, E23 validate)

| Ref | Under | Condition | Result / error code | file:line | In spec? |
|---|---|---|---|---|---|
| B26 | E23 validate | Loại không thuộc annual/sick/personal/other (chưa chọn) | LV-E01 dưới Loại nghỉ | lib/leave.js:66 | yes (`L01_DangKyNghiPhep.xlsx › Item!E6`) |
| B27 | E23 validate | Từ ngày trống / sai dạng | LV-E02 | lib/leave.js:67 | no (Q2: spec chỉ nói bắt buộc) |
| B28 | E23 validate | Từ ngày < hôm nay (màn: ngày trình duyệt; máy chủ: LEAVE_TODAY hoặc ngày máy chủ) | LV-E02, message "Ngày bắt đầu phải từ hôm nay trở đi." | lib/leave.js:10, :67; public/app.js:7; server.js:10 | differs (message: `L01_DangKyNghiPhep.xlsx › Message!C5`; ngày: `API_Leave.xlsx › API!A7`) |
| B29 | E23 validate | Từ ngày = hôm nay | hợp lệ | lib/leave.js:67 | yes (`L01_DangKyNghiPhep.xlsx › Item!E7` "không trước") |
| B30 | E23 validate | Đến ngày trống / sai dạng | LV-E03 | lib/leave.js:68 | no (Q2) |
| B31 | E23 validate | Đến ngày < Từ ngày | LV-E03 | lib/leave.js:68 | yes (`L01_DangKyNghiPhep.xlsx › Item!E8`) |
| B32 | E23 validate | Loại = Khác, Lý do trống hoặc chỉ khoảng trắng | LV-E05 | lib/leave.js:70 | yes / khoảng trắng: no (`L01_DangKyNghiPhep.xlsx › Item!E12`, Q3) |
| B33 | E23 validate | Lý do > 255 ký tự (200 < n ≤ 255 hợp lệ) | LV-E06 "Lý do tối đa 255 ký tự." | lib/leave.js:6, :14, :71 | differs (`L01_DangKyNghiPhep.xlsx › Item!E12`, `Message!C9`: 200) |
| B34 | E23 validate | Lý do trống, Loại ≠ Khác | hợp lệ | lib/leave.js:70 | yes (`L01_DangKyNghiPhep.xlsx › Item!D12`) |
| B35 | E5/E6 | nhiều lỗi cùng lúc | hiện mọi lỗi dưới từng ô, viền đỏ, không gọi API | public/app.js:61-70, :121-122, :131-132 | yes (`L01_DangKyNghiPhep.xlsx › Item!A14`, `Giao dien!A14`) |
| B36 | E5/E6 | lần bấm sau hết lỗi | lỗi cũ ẩn | public/app.js:65 | yes (`L01_DangKyNghiPhep.xlsx › Item!A14`) |
| B37 | E6 | Loại = Phép năm, Số ngày > Số dư còn lại (đã load) | LV-E04 "(còn {n} ngày)" dưới Số ngày nghỉ | public/app.js:129-130 | yes (`L01_DangKyNghiPhep.xlsx › Item!A15`) |
| B38 | E6 | Số ngày = Số dư (biên) | hợp lệ | public/app.js:130 (`>`) | yes (`L01_DangKyNghiPhep.xlsx › Item!A15` "> Số dư") |
| B39 | E6 | Số dư chưa load (null) | bỏ qua LV-E04 ở màn, để máy chủ chặn | public/app.js:130 | no (Q9) |
| B40 | E5 | Lưu nháp không kiểm LV-E04 | lưu được dù vượt số dư | public/app.js:120 | yes (`L01_DangKyNghiPhep.xlsx › Item!A15` chỉ khi Gửi duyệt) |
| B41 | E3 | chế độ Xem không kiểm LV-E02 (đơn ngày đã qua vẫn xem được) | không có nút lưu | public/app.js:85 | yes (`L01_DangKyNghiPhep.xlsx › Item!E7`) |

### Màn — hành động nút (E5–E9, E12)

| Ref | Under | Condition | Result / error code | file:line | In spec? |
|---|---|---|---|---|---|
| B42 | E5 Lưu nháp | Tạo mới, hợp lệ | POST /api/leaves → snackbar "Đã lưu nháp." → Sửa, URL `?id=<mã>&mode=edit` | public/app.js:115, :123, :99-107 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C4`) |
| B43 | E5 Lưu nháp | Sửa, hợp lệ | PUT /api/leaves/:id → LV-I01 → ở lại Sửa | public/app.js:115, :123 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C4`) |
| B44 | E5 Lưu nháp | API trả lỗi | snackbar đỏ nội dung mã lỗi, dữ liệu giữ nguyên | public/app.js:123 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A10`) |
| B45 | E6 Gửi duyệt | hợp lệ | hộp xác nhận "Gửi đơn cho quản lý duyệt?" | public/app.js:133 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C5`, `Message!C16`) |
| B46 | E6 Gửi duyệt | Huỷ bỏ | đóng hộp, không gọi API | public/app.js:133, :41 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C5`) |
| B47 | E6 Gửi duyệt | Đồng ý | POST hoặc PUT, rồi POST submit → "Đã gửi đơn cho quản lý duyệt." → Xem (Chờ duyệt) | public/app.js:134-138 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C5`) |
| B48 | E6 Gửi duyệt | API lỗi (vd LV-E04 từ máy chủ, LV-E409) | snackbar đỏ `message(code)` không truyền `{n}` → "(còn {n} ngày)" nguyên văn | public/app.js:139, :20 | differs (`L01_DangKyNghiPhep.xlsx › Message!C7`, `Nut!A10`) |
| B49 | E6 Gửi duyệt | Tạo mới: A2 thành công rồi A4 lỗi | đơn Nháp đã tạo, màn vẫn chế độ Tạo mới (không có Mã đơn, URL không đổi); bấm tiếp sẽ PUT đơn đó | public/app.js:115, :135-139 | no (Q7) |
| B50 | E7 Sửa | Xem, đơn Nháp | chuyển Sửa, URL `mode=edit`, xoá lỗi, dirty = false | public/app.js:161, :99-107 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C6`) |
| B51 | E8 Huỷ đơn | bấm | hộp "Bạn chắc chắn muốn huỷ đơn này?" | public/app.js:143 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C7`, `Message!C17`) |
| B52 | E8 Huỷ đơn | Huỷ bỏ | đóng hộp, không gọi API | public/app.js:143 | no (spec chỉ mô tả Đồng ý; hành vi chung của hộp `Giao dien!A18`) |
| B53 | E8 Huỷ đơn | Đồng ý, A5 thành công | "Đã huỷ đơn." → Xem, trạng thái Đã huỷ | public/app.js:144 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C7`) |
| B54 | E8 Huỷ đơn | Đồng ý, A5 lỗi (vd 409 với đơn Từ chối/Đã huỷ vì nút vẫn hiện — B11) | snackbar đỏ "Đơn không còn ở trạng thái cho phép thao tác này." | public/app.js:144 | yes (`L01_DangKyNghiPhep.xlsx › Nut!A10`) |
| B55 | E9 Quay lại | có thay đổi chưa lưu | hộp "Bỏ các thay đổi chưa lưu?"; Đồng ý → về trang trước; Huỷ bỏ → ở lại | public/app.js:148-149 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C8`) |
| B56 | E9 Quay lại | không có thay đổi (kể cả ngay sau Lưu nháp) | history.back() | public/app.js:104, :149 | yes (`L01_DangKyNghiPhep.xlsx › Nut!C8`) |
| B57 | E12 | tiêu đề hộp: "Xác nhận gửi duyệt" / "Xác nhận huỷ đơn" / "Bỏ thay đổi" | | public/app.js:133, :143, :148 | no (Q5) |
| B58 | E5/E6/E8 | snackbar | tự ẩn sau 3 giây; snackbar lỗi thêm class `error` | public/app.js:25-32 | yes (`L01_DangKyNghiPhep.xlsx › Giao dien!A17`, `Nut!A10`) |
| B59 | E5/E6/E8 | lỗi mạng hoặc mã không có trong mục 5 (LV-E401, LV-E500) | snackbar hiện trống (code undefined) hoặc chính mã lỗi | public/app.js:19-20; lib/leave.js:27 | no (Q12) |

### API (E14–E22)

| Ref | Under | Condition | Result / error code | file:line | In spec? |
|---|---|---|---|---|---|
| B60 | E20 | thiếu header X-User | 401 `{code:"LV-E401", message:"Unauthorized"}` | server.js:106-107 | yes HTTP 401 (`API_Leave.xlsx › API!A5`); mã/nội dung: no (Q4) |
| B61 | E14 A1 | id không tồn tại | 404 LV-E404 | server.js:55, :75 | yes (`API_Leave.xlsx › API!E16`) |
| B62 | E14 A1 | đơn của người khác | 403 LV-E403 | server.js:56, :75 | yes (`API_Leave.xlsx › API!E16`) |
| B63 | E14 A1 | đơn của mình, mọi trạng thái | 200 đơn | server.js:77 | yes (`API_Leave.xlsx › API!D16`) |
| B64 | E15 A2 | hợp lệ | 201, status draft, id `LV-<hôm nay máy chủ>-nnn` (số nhỏ nhất chưa dùng), owner = X-User, days máy chủ tính | server.js:66-72, :23-28 | yes (`API_Leave.xlsx › API!D17`, `API!A13`; `L01_DangKyNghiPhep.xlsx › Item!E4`) |
| B65 | E15 A2 | không hợp lệ | 400 với mã đầu tiên theo thứ tự E01, E02, E03, E05, E06 | server.js:68-69; lib/leave.js:63-72 | yes (`API_Leave.xlsx › API!E17`) |
| B66 | E15/E16 | thân gửi `days`, `status`, `owner`, `id` | bị bỏ qua (chỉ lấy type/from/to/part/reason) | server.js:47-50 | yes days (`API_Leave.xlsx › API!A13`); status/owner/id: no |
| B67 | E15/E16 | `part` gửi am/pm khi from ≠ to hoặc giá trị lạ | ép về `full` | server.js:49; lib/leave.js:76-78 | yes (`L01_DangKyNghiPhep.xlsx › Item!E9`) |
| B68 | E15/E16 | thân không phải JSON | coi như `{}` → 400 LV-E01 | server.js:43, :48 | no |
| B69 | E15 A2 | > 999 đơn cùng ngày | id thành `LV-yyyymmdd-1000` (sai dạng nnn) | server.js:26-27 | no (biên N+1 của `L01_DangKyNghiPhep.xlsx › Item!E4`) |
| B70 | E16 A3 | 404 / 403 | như A1 | server.js:74-75 | yes (`API_Leave.xlsx › API!E18`) |
| B71 | E16 A3 | đơn không ở draft (pending/approved/rejected/cancelled) | **không** chặn: cập nhật và trả 200 | server.js:78-84 | differs (`API_Leave.xlsx › API!E18`: 409 LV-E409) |
| B72 | E16 A3 | hợp lệ / không hợp lệ | 200 đơn đã cập nhật (days tính lại, updatedAt) / 400 như A2 | server.js:79-83 | yes (`API_Leave.xlsx › API!D18`, `E18`) |
| B73 | E17 A4 | 404 / 403 | như A1 | server.js:74-75 | yes (`API_Leave.xlsx › API!E19`) |
| B74 | E17 A4 | không phải draft | 409 LV-E409 | server.js:86 | yes (`API_Leave.xlsx › API!E19`) |
| B75 | E17 A4 | annual và days > remaining | 400 LV-E04, message có n = remaining 1 chữ số thập phân | server.js:87-88 | yes (`API_Leave.xlsx › API!E19`, `L01_DangKyNghiPhep.xlsx › Message!C7`) |
| B76 | E17 A4 | days = remaining; loại khác annual vượt số dư | 200 pending | server.js:88-90 | yes (`API_Leave.xlsx › API!E19`) |
| B77 | E17 A4 | không kiểm lại type/ngày (đơn Nháp có Từ ngày đã qua vẫn gửi được) | 200 | server.js:85-91 | no (Q10) |
| B78 | E18 A5 | 404 / 403 | như A1 | server.js:74-75 | yes (`API_Leave.xlsx › API!E20`) |
| B79 | E18 A5 | draft hoặc pending | 200 cancelled | server.js:93-95 | yes (`API_Leave.xlsx › API!D20`) |
| B80 | E18 A5 | approved | 200 cancelled (cho phép) | server.js:93 | differs (`API_Leave.xlsx › API!E20`, `L01_DangKyNghiPhep.xlsx › Nut!B7`: 409) |
| B81 | E18 A5 | rejected / cancelled | 409 LV-E409 | server.js:93 | yes (`API_Leave.xlsx › API!E20`) |
| B82 | E19 A6 | gọi | 200 {annual: 12, used, remaining = 12 − used}; used = tổng days đơn annual pending/approved của người gọi (không tính draft, đơn người khác) | server.js:30-34, :62 | yes (`API_Leave.xlsx › API!D21`, `A26`) |
| B83 | E21 | /api/xxx, method/action lạ, POST /api/leaves/:id không action | 404 LV-E404 (sau khi đã kiểm chủ đơn: id người khác → 403) | server.js:63, :97 | no |
| B84 | E22 | exception | 500 LV-E500 kèm `e.message` | server.js:108 | no |
| B85 | E24 | khởi động | 5 đơn mẫu như bảng, reason rỗng, days tính bằng workingDays | server.js:13-21 | yes (`API_Leave.xlsx › API!A28–F33`) |
| B86 | E24 | E001 lúc khởi động | used = 2 (LV-20261110-001 approved) + 2 (LV-20261124-001 pending) = 4 → remaining 8,0 | server.js:30-34 | yes (`API_Leave.xlsx › API!A21`, `A26–F31`) — chú ý `API!A26` ghi "số dư năm 12,0" là `annual`, không phải `remaining` |

### Flows that code reading misses (stateful)

| Ref | Under | Condition | Result (code hiện tại) | file:line | In spec? |
|---|---|---|---|---|---|
| B87 | lifecycle | khởi động lại máy chủ | mọi đơn tạo/sửa mất, về dữ liệu mẫu | server.js:1, :20 | no (`test.config.json › dataRules`) |
| B88 | lifecycle | tải lại trang / nút back trình duyệt khi có thay đổi chưa lưu | mất thay đổi, không có LV-C03 (không có `beforeunload`) | public/app.js:147-150 | no (Q11) |
| B89 | changed from outside | đơn bị huỷ/gửi ở tab khác rồi bấm Lưu nháp ở tab đang Sửa | PUT vẫn 200 (B71) → sửa được đơn không còn Nháp | server.js:78-84 | differs (`API_Leave.xlsx › API!E18`) |
| B90 | changed from outside | đơn bị huỷ ở tab khác rồi Gửi duyệt | PUT 200 rồi submit 409 → snackbar LV-E409 | server.js:86 | yes (`API_Leave.xlsx › API!E19`) |
| B91 | changed from outside | mất mạng khi bấm nút | fetch lỗi → snackbar đỏ trống | public/app.js:15-21, :123 | no (Q12) |
| B92 | limits N+1 | Lý do 200 / 201 ký tự; 255 / 256 | spec: 200 ok, 201 LV-E06; code: 255 ok, 256 LV-E06 | lib/leave.js:6, :71 | differs (`L01_DangKyNghiPhep.xlsx › Item!E12`) |
| B93 | decoy data | đơn LV-20261124-003 của E002 cùng ngày gần đó | E001 không thấy / sửa / gửi / huỷ được (403), không tính vào số dư E001 | server.js:32, :56 | yes (`API_Leave.xlsx › API!A23`) |
| B94 | time | ngày trình duyệt ≠ ngày máy chủ (`LEAVE_TODAY`) | màn kiểm LV-E02 theo trình duyệt, máy chủ theo LEAVE_TODAY → màn cho qua nhưng API trả 400 (hoặc ngược lại) | public/app.js:7; server.js:10 | differs (`API_Leave.xlsx › API!A7`) |

## Side effects

| Ref | Under | Effect | file:line |
|---|---|---|---|
| F1 | E15 A2 | thêm đơn draft vào bộ nhớ (id mới, createdAt/updatedAt) | server.js:70-71 |
| F2 | E16 A3 | ghi đè type/from/to/part/reason, tính lại days, cập nhật updatedAt | server.js:82 |
| F3 | E17 A4 | status → pending, updatedAt; làm giảm `remaining` của A6 nếu annual | server.js:89, :32 |
| F4 | E18 A5 | status → cancelled, updatedAt; trả lại số dư nếu đơn annual pending/approved | server.js:94, :32 |
| F5 | E5/E6/E7/E8 | URL đổi bằng `history.replaceState` (`?id=…` / `&mode=edit`), không thêm mục lịch sử | public/app.js:101-103 |
| F6 | E5/E6/E8 | snackbar LV-I01 / LV-I02 / LV-I03 (3 giây) | public/app.js:123, :137, :144 |
| F7 | E13 | đọc localStorage `user` (không ghi) | public/app.js:6 |

## Summary

Entry points 24 (E1–E24), branches 94 (B1–B94), side effects 7 (F1–F7).
Trong spec (yes / partly): 62 · khác spec (differs): 13 (B11, B15, B20, B23, B24, B28, B33, B48, B71, B80, B89, B92, B94) · không có trong spec (no): 19 (B7, B14, B22, B27, B30, B39, B49, B52, B57, B59, B68, B69, B77, B83, B84, B87, B88, B91 + B66 một phần).
