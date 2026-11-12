# Privacy

vuong-trans chạy hoàn toàn trên máy người dùng. Nội dung tài liệu chỉ được xử lý bởi các script cục bộ và bởi chính phiên Claude Code của người dùng; skill không gửi tài liệu tới dịch vụ dịch hay API bên ngoài nào.
Kết nối mạng duy nhất là lúc cài đặt một lần (`scripts/setup_env.py pdf` / `scripts/setup_env.py ocr`) để tải thư viện và model OCR từ pypi.org, files.pythonhosted.org, download.pytorch.org và github.com. Model OCR cho cả tiếng Nhật, tiếng Việt và tiếng Anh được tải ngay lúc cài, nên khi dịch không có tải xuống nào nữa.
Venv, model và file trung gian nằm trong thư mục tạm của hệ thống (hoặc thư mục đặt bằng `VTRANS_HOME`). File kết quả được ghi cạnh file gốc, trong thư mục `VN/`, `EN/` hoặc `JP/`.
