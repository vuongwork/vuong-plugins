# L01_DangKyNghiPhep.xlsx

- Source: docs/spec/L01_DangKyNghiPhep.xlsx
- Size: 8895 bytes
- Modified: 2026-11-25T14:44:26.342Z
- sha256: fa3d7ab6812af948b6b89b05694c7de236d9f30bd20457692148eb091170d7c4
- Read by: vuong-test read-spec (sheets=5 rows=65)

Cite as `file / Sheet!Cell` (the bold labels).

## Sheet: Giao dien

- **Giao dien!A1** L01 – Đăng ký nghỉ phép (Leave request)
- **Giao dien!A3** Phiên bản 1.2 · 2026-11-20 · Người viết: BA nhóm Nhân sự
- **Giao dien!A5** Màn cho nhân viên tạo, sửa, gửi duyệt và huỷ đơn nghỉ phép của chính mình. Web app chạy trên điện thoại.
- **Giao dien!A7** 1. Giao diện chung (cho thiết kế)
- **Giao dien!A9** - Web mobile, khung màn 360 × 800 px. Giao diện tiếng Việt có dấu đầy đủ. Font: Be Vietnam Pro (400, 500, 600, 700).
- **Giao dien!A10** - Phong cách công sở: nền xám rất nhạt, thẻ trắng bo góc vừa, màu chủ đạo xanh dương đậm; lỗi màu đỏ; trạng thái
- **Giao dien!A11** dùng nhãn tròn (pill) có màu nhạt: Nháp xám, Chờ duyệt cam, Đã duyệt xanh lá, Từ chối đỏ, Đã huỷ xám đậm.
- **Giao dien!A12** - App bar trên cùng: nút quay lại (mũi tên trái) và tiêu đề theo chế độ ("Tạo đơn nghỉ phép" / "Sửa đơn nghỉ phép" /
- **Giao dien!A13** "Chi tiết đơn nghỉ phép").
- **Giao dien!A14** - Nội dung là một thẻ chứa các trường theo thứ tự ở mục 3, nhãn nằm trên ô nhập. Lỗi của một trường hiện ngay dưới ô
- **Giao dien!A15** đó, chữ đỏ, viền ô đổi màu đỏ.
- **Giao dien!A16** - Hàng nút cố định ở đáy màn, theo chế độ (mục 4). Nút chính tô màu chủ đạo, nút phụ viền, nút huỷ đơn chữ đỏ.
- **Giao dien!A17** - Thông báo thành công hiện dạng snackbar tối ở đáy, phía trên hàng nút, tự ẩn sau 3 giây.
- **Giao dien!A18** - Hộp xác nhận: phủ lớp tối mờ, hộp trắng giữa màn, tiêu đề, nội dung, hai nút "Huỷ bỏ" (phụ) và "Đồng ý" (chính).
- **Giao dien!A20** Các màn cần vẽ (mỗi trạng thái một màn):
- **Giao dien!A22** Mã | **B22** Trạng thái
- **Giao dien!A23** L01-N | **B23** Tạo mới, đã nhập: Phép năm, 24/11/2026 → 26/11/2026, Số ngày 3,0, Số dư 12,0
- **Giao dien!A24** L01-NE | **B24** Tạo mới, bấm Gửi duyệt khi chưa chọn loại nghỉ và lý do 210 ký tự: lỗi LV-E01 và LV-E06 dưới hai trường
- **Giao dien!A25** L01-V | **B25** Xem đơn LV-20261124-001, trạng thái Chờ duyệt, các trường chỉ đọc, nút Huỷ đơn và Quay lại
- **Giao dien!A26** L01-C | **B26** Hộp xác nhận LV-C01 phủ trên L01-N

## Sheet: Che do

- **Che do!A1** 2. Chế độ
- **Che do!A3** Chế độ | **B3** Mở bằng | **C3** Điều kiện
- **Che do!A4** Tạo mới (New) | **B4** /?mode=new | **C4** luôn được
- **Che do!A5** Sửa (Edit) | **B5** /?id=<mã>&mode=edit | **C5** chỉ khi đơn ở trạng thái Nháp; trạng thái khác → mở chế độ Xem
- **Che do!A6** Xem (View) | **B6** /?id=<mã> | **C6** mọi trạng thái
- **Che do!A8** Đơn không tồn tại hoặc không phải của người đang đăng nhập → thông báo LV-E404 / LV-E403 thay cho thẻ nội dung,
- **Che do!A9** chỉ còn nút Quay lại.

## Sheet: Item

- **Item!A1** 3. Danh sách item
- **Item!A3** # | **B3** Item | **C3** Kiểu | **D3** Bắt buộc | **E3** Quy tắc | **F3** Chế độ hiện
- **Item!A4** 1 | **B4** Mã đơn | **C4** chữ, chỉ đọc | **D4** – | **E4** dạng LV-yyyymmdd-nnn, do hệ thống cấp khi lưu lần đầu | **F4** Sửa, Xem
- **Item!A5** 2 | **B5** Trạng thái | **C5** nhãn tròn | **D5** – | **E5** Nháp / Chờ duyệt / Đã duyệt / Từ chối / Đã huỷ | **F5** Sửa, Xem
- **Item!A6** 3 | **B6** Loại nghỉ | **C6** danh sách chọn | **D6** có | **E6** Phép năm, Nghỉ ốm, Việc riêng, Khác. Chưa chọn → LV-E01 | **F6** tất cả (Xem: chỉ đọc)
- **Item!A7** 4 | **B7** Từ ngày | **C7** ngày | **D7** có | **E7** không trước hôm nay (chỉ kiểm khi Tạo mới và Sửa) → LV-E02 | **F7** tất cả
- **Item!A8** 5 | **B8** Đến ngày | **C8** ngày | **D8** có | **E8** không trước Từ ngày → LV-E03 | **F8** tất cả
- **Item!A9** 6 | **B9** Buổi | **C9** chọn 1: Cả ngày / Sáng / Chiều | **D9** có | **E9** chỉ bật khi Từ ngày = Đến ngày; khác ngày → khoá ở Cả ngày | **F9** tất cả
- **Item!A10** 7 | **B10** Số ngày nghỉ | **C10** số, chỉ đọc | **D10** – | **E10** số ngày làm việc (thứ Hai – thứ Sáu) từ Từ ngày đến Đến ngày, tính cả hai đầu; Buổi Sáng hoặc Chiều = 0,5. Hiển thị 1 chữ số thập phân. Tính lại ngay khi đổi ngày / buổi | **F10** tất cả
- **Item!A11** 8 | **B11** Số dư phép năm | **C11** số, chỉ đọc | **D11** – | **E11** lấy từ API số dư (API_Leave › A6), 1 chữ số thập phân | **F11** Tạo mới, Sửa
- **Item!A12** 9 | **B12** Lý do | **C12** ô nhiều dòng | **D12** khi Loại = Khác | **E12** tối đa 200 ký tự (đếm ký tự hiện "n/200" dưới ô). Loại = Khác mà để trống → LV-E05; quá 200 → LV-E06 | **F12** tất cả
- **Item!A14** Kiểm tra khi bấm Lưu nháp hoặc Gửi duyệt: tất cả quy tắc của mục 3 đến 9; có lỗi thì không gọi API, hiện mọi lỗi cùng lúc.
- **Item!A15** Thêm khi Gửi duyệt: Loại = Phép năm và Số ngày nghỉ > Số dư phép năm → LV-E04 (dưới Số ngày nghỉ).

## Sheet: Nut

- **Nut!A1** 4. Nút
- **Nut!A3** Nút | **B3** Hiện khi | **C3** Hành động
- **Nut!A4** Lưu nháp | **B4** Tạo mới; Sửa | **C4** kiểm tra → tạo đơn (A2) hoặc cập nhật (A3) → snackbar LV-I01 → chuyển sang chế độ Sửa của đơn đó
- **Nut!A5** Gửi duyệt | **B5** Tạo mới; Sửa | **C5** kiểm tra (gồm LV-E04) → hộp xác nhận LV-C01 → Đồng ý: lưu (A2/A3) rồi gửi (A4) → snackbar LV-I02 → chế độ Xem. Huỷ bỏ: đóng hộp, không làm gì
- **Nut!A6** Sửa | **B6** Xem, khi trạng thái Nháp | **C6** chuyển sang chế độ Sửa
- **Nut!A7** Huỷ đơn | **B7** Sửa, Xem; chỉ khi trạng thái Nháp hoặc Chờ duyệt | **C7** hộp xác nhận LV-C02 → Đồng ý: A5 → snackbar LV-I03 → chế độ Xem (trạng thái Đã huỷ)
- **Nut!A8** Quay lại | **B8** luôn | **C8** có thay đổi chưa lưu → hộp xác nhận LV-C03; không có → về trang trước
- **Nut!A10** Lỗi từ API (mã trong thân trả về) hiện dạng snackbar đỏ với nội dung của mã đó ở mục 5; dữ liệu trên màn giữ nguyên.

## Sheet: Message

- **Message!A1** 5. Message
- **Message!A3** Mã | **B3** Loại | **C3** Nội dung
- **Message!A4** LV-E01 | **B4** lỗi | **C4** Vui lòng chọn loại nghỉ.
- **Message!A5** LV-E02 | **B5** lỗi | **C5** Ngày bắt đầu không được trước hôm nay.
- **Message!A6** LV-E03 | **B6** lỗi | **C6** Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.
- **Message!A7** LV-E04 | **B7** lỗi | **C7** Số ngày nghỉ vượt quá số dư phép năm (còn {n} ngày).
- **Message!A8** LV-E05 | **B8** lỗi | **C8** Vui lòng nhập lý do.
- **Message!A9** LV-E06 | **B9** lỗi | **C9** Lý do tối đa 200 ký tự.
- **Message!A10** LV-E403 | **B10** lỗi | **C10** Bạn không có quyền xem đơn này.
- **Message!A11** LV-E404 | **B11** lỗi | **C11** Không tìm thấy đơn nghỉ phép.
- **Message!A12** LV-E409 | **B12** lỗi | **C12** Đơn không còn ở trạng thái cho phép thao tác này.
- **Message!A13** LV-I01 | **B13** thông báo | **C13** Đã lưu nháp.
- **Message!A14** LV-I02 | **B14** thông báo | **C14** Đã gửi đơn cho quản lý duyệt.
- **Message!A15** LV-I03 | **B15** thông báo | **C15** Đã huỷ đơn.
- **Message!A16** LV-C01 | **B16** xác nhận | **C16** Gửi đơn cho quản lý duyệt?
- **Message!A17** LV-C02 | **B17** xác nhận | **C17** Bạn chắc chắn muốn huỷ đơn này?
- **Message!A18** LV-C03 | **B18** xác nhận | **C18** Bỏ các thay đổi chưa lưu?
