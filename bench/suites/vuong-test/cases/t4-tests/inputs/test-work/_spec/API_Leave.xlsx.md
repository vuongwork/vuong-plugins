# API_Leave.xlsx

- Source: docs/spec/API_Leave.xlsx
- Size: 4280 bytes
- Modified: 2026-11-25T14:44:26.342Z
- sha256: 9b63e9704ab537f1e208aa999bb5dc350cac17bef608fc551073ee20ff60c55b
- Read by: vuong-test read-spec (sheets=1 rows=26)

Cite as `file / Sheet!Cell` (the bold labels).

## Sheet: API

- **API!A1** API_Leave – API đơn nghỉ phép
- **API!A3** Phiên bản 1.1 · 2026-11-18 · Người viết: BA nhóm Nhân sự
- **API!A5** Chung: JSON, UTF-8. Người dùng xác định bằng header X-User (mã nhân viên); thiếu header → 401. Lỗi trả về
- **API!A6** { "code": "<mã>", "message": "<nội dung>" } với mã và nội dung lấy từ L01 › mục 5. Ngày dạng YYYY-MM-DD.
- **API!A7** "Hôm nay" là ngày của máy chủ.
- **API!A9** Đối tượng đơn: { id, owner, type, from, to, part, days, reason, status, createdAt, updatedAt }
- **API!A10** - type: annual (Phép năm) · sick (Nghỉ ốm) · personal (Việc riêng) · other (Khác)
- **API!A11** - part: full · am · pm
- **API!A12** - status: draft · pending · approved · rejected · cancelled
- **API!A13** - days: do máy chủ tính theo L01 › item 7 (không nhận từ client)
- **API!A15** # | **B15** Method + path | **C15** Mô tả | **D15** Thành công | **E15** Lỗi
- **API!A16** A1 | **B16** GET /api/leaves/:id | **C16** lấy một đơn | **D16** 200 đơn | **E16** 404 LV-E404; 403 LV-E403 khi không phải chủ đơn
- **API!A17** A2 | **B17** POST /api/leaves | **C17** tạo đơn Nháp. Thân: type, from, to, part, reason | **D17** 201 đơn (status = draft, có id) | **E17** 400 với mã lỗi đầu tiên theo thứ tự LV-E01, E02, E03, E05, E06
- **API!A18** A3 | **B18** PUT /api/leaves/:id | **C18** sửa đơn. Thân như A2 | **D18** 200 đơn | **E18** 404; 403; 409 LV-E409 khi đơn không ở trạng thái draft; 400 như A2
- **API!A19** A4 | **B19** POST /api/leaves/:id/submit | **C19** gửi duyệt | **D19** 200 đơn (status = pending) | **E19** 404; 403; 409 LV-E409 khi không phải draft; 400 LV-E04 khi type = annual và days > số dư
- **API!A20** A5 | **B20** POST /api/leaves/:id/cancel | **C20** huỷ đơn | **D20** 200 đơn (status = cancelled) | **E20** 404; 403; 409 LV-E409 khi trạng thái không phải draft hoặc pending
- **API!A21** A6 | **B21** GET /api/leave-balance | **C21** số dư phép năm của người dùng | **D21** 200 { annual, used, remaining } (used = tổng days của đơn annual ở trạng thái pending hoặc approved) | **E21** 401
- **API!A23** Quyền: mọi API chỉ thao tác trên đơn của chính người gọi. Không có API duyệt/từ chối trong phạm vi màn này (quản lý
- **API!A24** duyệt ở màn khác); dữ liệu mẫu có sẵn đơn ở các trạng thái approved, rejected.
- **API!A26** Dữ liệu mẫu khi khởi động (người dùng E001, số dư năm 12,0):
- **API!A28** id | **B28** owner | **C28** type | **D28** from → to | **E28** part | **F28** status
- **API!A29** LV-20261110-001 | **B29** E001 | **C29** annual | **D29** 2026-11-10 → 2026-11-11 | **E29** full | **F29** approved
- **API!A30** LV-20261112-001 | **B30** E001 | **C30** sick | **D30** 2026-11-12 → 2026-11-12 | **E30** am | **F30** rejected
- **API!A31** LV-20261124-001 | **B31** E001 | **C31** annual | **D31** 2026-12-01 → 2026-12-02 | **E31** full | **F31** pending
- **API!A32** LV-20261124-002 | **B32** E001 | **C32** personal | **D32** 2026-12-10 → 2026-12-10 | **E32** full | **F32** draft
- **API!A33** LV-20261124-003 | **B33** E002 | **C33** annual | **D33** 2026-12-03 → 2026-12-03 | **E33** full | **F33** draft
