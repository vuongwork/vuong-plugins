Màn L01 (Đăng ký nghỉ phép) đã có sẵn unit test do dev viết trong `tests/leave.test.js`. Trước khi tin các test này, soát lại chúng (spec ở `docs/spec/`): test nào kiểm tra yếu, và test nào assert một giá trị khác với spec.

Ghi kết quả vào `test-work/L01/existing-tests.md`: một bảng markdown, mỗi test một dòng, có tên test, `file:line`, lý do, và cột `Verdict` với đúng một trong ba giá trị:
- `ok` — test kiểm tra đúng giá trị mà spec yêu cầu;
- `weak` — test không thật sự kiểm tra được gì (không assert, assert yếu, chỉ kiểm mock, nuốt lỗi...);
- `wrong` — test assert một giá trị khác với spec (ghi giá trị test assert và giá trị spec yêu cầu, trích file + ô spec).

Không sửa, không xoá test nào. Dừng khi đã có file đó.
