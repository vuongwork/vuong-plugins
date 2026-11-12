<p align="center"><img src="../../assets/vuong-logo.svg" alt="logo" width="120"></p>

<p align="center">
  Made by <b>Vuong Pham</b> · <a href="https://github.com/vuongwork">@vuongwork</a><br>
</p>

# vuong-trans

Dịch tài liệu PowerPoint `.pptx`, Excel `.xlsx` và PDF qua lại giữa tiếng Nhật, tiếng Việt và tiếng Anh (mọi chiều) mà vẫn giữ nguyên layout: text trong slide, ô bảng, shape, comment, tên sheet, và cả chữ nằm trong ảnh (OCR + vẽ đè).

## Cài đặt
```
/plugin marketplace add vuongwork/vuong-plugins
/plugin install vuong-trans@vuong-plugins
```
Hoặc cài một lệnh từ shell (cần Claude Code v2.1.292 trở lên): `claude plugin install vuong-trans --marketplace vuongwork/vuong-plugins`.
Cập nhật: `/plugin marketplace update vuong-plugins`.

## Cách dùng
Nói với Claude: "dịch file này sang tiếng Việt", "translate this deck to English", "convert file này sang tiếng Nhật", "dịch file pdf"… Skill `vuong-trans` tự kích hoạt.

Quy trình: trích chuỗi (khử trùng) → dựng glossary + bảng tên riêng → subagent dịch song song → ghi ngược vào file → báo các khung bị tràn chữ để bạn chọn thu nhỏ chữ hay nới khung → render và kiểm tra. Output nằm ở thư mục `VN/`, `EN/` hoặc `JP/` cạnh file gốc.

## Yêu cầu
Viết để chạy trên Linux, macOS và Windows. **Mới kiểm thử trên Windows** (pptx, xlsx, pdf, overlay ảnh); Linux/macOS và bước OCR chưa kiểm thử, nếu gặp lỗi xin báo ở [Issues](https://github.com/vuongwork/vuong-plugins/issues).
- Python 3 với `python-pptx`, `lxml`, `Pillow` (pptx/xlsx); `fontTools` (tuỳ chọn).
- PDF: `scripts/setup_env.py pdf` tạo venv riêng và cài PyMuPDF từ pypi.org.
- LibreOffice để render kiểm tra và cắt ảnh WMF/EMF; poppler (`pdftoppm`) nếu có, không có thì dùng PyMuPDF.
- Font: Noto Sans + DejaVu Sans; Noto Sans CJK JP khi dịch sang tiếng Nhật. Thiếu thì dùng font hệ điều hành (Segoe UI / Arial, Yu Gothic / Meiryo, Hiragino), hoặc đặt `VTRANS_FONT_DIR` trỏ tới thư mục chứa font.
- OCR ảnh: `scripts/setup_env.py ocr` tạo venv riêng, tải easyocr và model tiếng Nhật, tiếng Việt, tiếng Anh (khoảng 100 MB mỗi bộ) từ pypi.org, download.pytorch.org, github.com.

## Giới hạn
Chữ trong ảnh sau khi dịch không còn chỉnh sửa được. Trang PDF chỉ được vẽ đè, không dựng lại layout.
