# Privacy

vuong-trans chạy hoàn toàn trên máy người dùng. Nội dung tài liệu chỉ được xử lý bởi các script cục bộ và bởi chính phiên Claude Code của người dùng; skill không gửi tài liệu tới dịch vụ dịch hay API bên ngoài nào.
Kết nối mạng duy nhất là lúc cài đặt (`setup_ocr.sh`, `pip install pymupdf`) để tải thư viện và model OCR từ pypi.org, download.pytorch.org và github.com. File trung gian nằm trong `$TMPDIR`.
