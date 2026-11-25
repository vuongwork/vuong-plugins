Tiếp tục test màn L01 (Đăng ký nghỉ phép). Phần phân tích đã xong và nằm trong `test-work/L01/`: `spec-sources.md` (nguồn spec, câu hỏi BA), `flows.md` (danh sách flow), `diff.md` (chỗ spec ≠ code). Spec gốc ở `docs/spec/`, bản đã chuyển sang markdown ở `test-work/_spec/`.

Lần này viết test case, chưa viết test:
- `test-work/L01/cases.md`: một bảng markdown, mỗi case một dòng, đúng các cột `| ID | Layer | Flow | Type | Priority | Pre | Steps | Expected | Source | Data | Writes |` (Layer là một trong `ut`, `api`, `e2e`, `manual`; Expected là giá trị cụ thể lấy từ spec; Source trích file + ô spec, hoặc `assumption`; Writes là `Y`/`N`). Mục flow nào không có case thì liệt kê ở phần `## Not covered` với lý do.
- `test-work/L01/data-plan.md`: dữ liệu mỗi case cần và cách có được.

Mọi flow trong `flows.md` và mọi khác biệt trong `diff.md` phải có case hoặc nằm ở Not covered. Dừng khi đã có 2 file đó, ở bước chờ duyệt.
