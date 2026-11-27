# Privacy

vuong-trans chạy hoàn toàn trên máy người dùng. Nội dung tài liệu chỉ được xử lý bởi các script cục bộ và bởi chính phiên Claude Code của người dùng; skill không gửi tài liệu tới dịch vụ dịch hay API bên ngoài nào.
Kết nối mạng duy nhất là lúc cài đặt một lần (`scripts/setup_env.py pdf` / `scripts/setup_env.py ocr`) để tải thư viện và model OCR từ pypi.org, files.pythonhosted.org, download.pytorch.org và github.com. Model OCR cho cả tiếng Nhật, tiếng Việt và tiếng Anh được tải ngay lúc cài, nên khi dịch không có tải xuống nào nữa.
Venv, model và file trung gian nằm trong thư mục tạm của hệ thống (hoặc thư mục đặt bằng `VTRANS_HOME`). Bộ nhớ dịch (các cặp câu gốc → bản dịch), glossary và kết quả chạy thử của từng dự án được lưu lâu dài trên máy người dùng tại `~/.vuong-trans/projects/<dự án>/` (đổi bằng `VTRANS_DATA`), không gửi đi đâu; xoá thư mục dự án đó để xoá dữ liệu của dự án. File kết quả được ghi cạnh file gốc, trong thư mục `VN/`, `EN/` hoặc `JP/`.

Ảnh trong tài liệu được gửi lên model Claude trong phiên làm việc: ảnh có chữ cần dịch được agent xem ở kích thước đầy đủ; mọi ảnh còn lại (kể cả ảnh chụp người) được gửi một lần dưới dạng thumbnail nhỏ ghép chung (`skipped_k.png`) để kiểm tra không sót ảnh có chữ. OCR chạy hoàn toàn trên máy.
