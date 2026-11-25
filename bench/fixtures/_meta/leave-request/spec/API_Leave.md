# API_Leave – API đơn nghỉ phép

Phiên bản 1.1 · 2026-11-18 · Người viết: BA nhóm Nhân sự

Chung: JSON, UTF-8. Người dùng xác định bằng header `X-User` (mã nhân viên); thiếu header → 401. Lỗi trả về
`{ "code": "<mã>", "message": "<nội dung>" }` với mã và nội dung lấy từ L01 › mục 5. Ngày dạng `YYYY-MM-DD`.
"Hôm nay" là ngày của máy chủ.

Đối tượng đơn: `{ id, owner, type, from, to, part, days, reason, status, createdAt, updatedAt }`
- `type`: `annual` (Phép năm) · `sick` (Nghỉ ốm) · `personal` (Việc riêng) · `other` (Khác)
- `part`: `full` · `am` · `pm`
- `status`: `draft` · `pending` · `approved` · `rejected` · `cancelled`
- `days`: do máy chủ tính theo L01 › item 7 (không nhận từ client)

| # | Method + path | Mô tả | Thành công | Lỗi |
|---|---|---|---|---|
| A1 | `GET /api/leaves/:id` | lấy một đơn | 200 đơn | 404 LV-E404; 403 LV-E403 khi không phải chủ đơn |
| A2 | `POST /api/leaves` | tạo đơn Nháp. Thân: `type, from, to, part, reason` | 201 đơn (`status = draft`, có `id`) | 400 với mã lỗi đầu tiên theo thứ tự LV-E01, E02, E03, E05, E06 |
| A3 | `PUT /api/leaves/:id` | sửa đơn. Thân như A2 | 200 đơn | 404; 403; **409 LV-E409 khi đơn không ở trạng thái `draft`**; 400 như A2 |
| A4 | `POST /api/leaves/:id/submit` | gửi duyệt | 200 đơn (`status = pending`) | 404; 403; 409 LV-E409 khi không phải `draft`; 400 LV-E04 khi `type = annual` và `days` > số dư |
| A5 | `POST /api/leaves/:id/cancel` | huỷ đơn | 200 đơn (`status = cancelled`) | 404; 403; 409 LV-E409 khi trạng thái không phải `draft` hoặc `pending` |
| A6 | `GET /api/leave-balance` | số dư phép năm của người dùng | 200 `{ annual, used, remaining }` (`used` = tổng `days` của đơn `annual` ở trạng thái `pending` hoặc `approved`) | 401 |

Quyền: mọi API chỉ thao tác trên đơn của chính người gọi. Không có API duyệt/từ chối trong phạm vi màn này (quản lý
duyệt ở màn khác); dữ liệu mẫu có sẵn đơn ở các trạng thái `approved`, `rejected`.

Dữ liệu mẫu khi khởi động (người dùng `E001`, số dư năm 12,0):

| id | owner | type | from → to | part | status |
|---|---|---|---|---|---|
| LV-20261110-001 | E001 | annual | 2026-11-10 → 2026-11-11 | full | approved |
| LV-20261112-001 | E001 | sick | 2026-11-12 → 2026-11-12 | am | rejected |
| LV-20261124-001 | E001 | annual | 2026-12-01 → 2026-12-02 | full | pending |
| LV-20261124-002 | E001 | personal | 2026-12-10 → 2026-12-10 | full | draft |
| LV-20261124-003 | E002 | annual | 2026-12-03 → 2026-12-03 | full | draft |
