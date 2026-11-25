Tiếp tục test màn L01 (Đăng ký nghỉ phép). Test case trong `test-work/L01/cases.md` đã được duyệt (Vuong, 2026-11-25); phân tích và dữ liệu ở cùng thư mục (`spec-sources.md`, `flows.md`, `diff.md`, `data-plan.md`).

Lần này:
1. Viết test cho mọi case không phải `manual`: UT bằng Jest, API và E2E bằng Playwright / fetch (jest và playwright đã có trong `node_modules`). Tên mỗi test bắt đầu bằng `[<ID của case>]`. Không sửa code của app.
2. Chạy toàn bộ trên server local (`npm start`, cổng 3210) và tạo báo cáo kết quả theo từng case (PASS / FAIL / BLOCKED) trong `test-work/L01/report/`.
3. Thêm script `test-work/L01/run.mjs`: chạy lại toàn bộ test từ đầu (tự bật server ở cổng 3210 trước và tắt sau khi xong, dữ liệu sạch), rồi ghi `test-work/L01/run-results.json` dạng `[{"id": "<ID>", "status": "PASS|FAIL|BLOCKED"}]`, mỗi case một phần tử.

Dừng khi đã có báo cáo và `run.mjs` chạy được.
