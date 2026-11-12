<p align="center"><img src="../../assets/vuong-logo.svg" alt="logo" width="120"></p>

# vuong-trans

Dịch tài liệu tiếng Nhật (PowerPoint `.pptx`, Excel `.xlsx`, PDF) sang tiếng Việt hoặc tiếng Anh mà vẫn giữ nguyên layout: text trong slide, ô bảng, shape, tên sheet, và cả chữ tiếng Nhật nằm trong ảnh (OCR + vẽ đè).

## Cài đặt
```
/plugin marketplace add vuongwork/vuong-plugins
/plugin install vuong-trans@vuong-plugins
```

## Cách dùng
Nói với Claude: "dịch file này sang tiếng Việt", "translate this deck to English", "dịch file pdf"… Skill `vuong-trans` tự kích hoạt.

Quy trình: trích chuỗi (khử trùng) → dựng glossary + bảng tên riêng → subagent dịch song song → ghi ngược vào file → render và kiểm tra. Output nằm ở thư mục `VN/` hoặc `EN/` cạnh file gốc.

## Yêu cầu
- Python 3 với `python-pptx`, `lxml`, `Pillow` (pptx/xlsx); PyMuPDF trong venv riêng (pdf).
- LibreOffice + poppler (`pdftoppm`) để render kiểm tra và cắt ảnh WMF/EMF.
- Font Noto Sans và DejaVu Sans (`/usr/share/fonts/truetype/...`).
- OCR ảnh: `scripts/setup_ocr.sh` tạo venv riêng và tải easyocr + model (~100 MB) từ pypi.org, download.pytorch.org, github.com.

## Giới hạn
Chữ trong ảnh sau khi dịch không còn chỉnh sửa được. Trang PDF chỉ được vẽ đè, không dựng lại layout.
