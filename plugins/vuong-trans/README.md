<p align="center"><img src=".claude-plugin/icon.png" alt="vuong-trans logo" width="120"></p>

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

Quy trình: trích chuỗi (khử trùng, lấy lại bản dịch cũ của cùng dự án từ bộ nhớ dịch) → dựng glossary + bảng tên riêng → subagent dịch song song → ghi ngược vào file → báo các khung bị tràn chữ để bạn chọn thu nhỏ chữ hay nới khung → render và kiểm tra. Output nằm ở thư mục `VN/`, `EN/` hoặc `JP/` cạnh file gốc.

Cuối mỗi lần dịch, Claude báo cáo bằng `scripts/runlog.py report`: thời gian từng bước và tổng, token của từng subagent (chi phí), số ký tự gửi model so với số lấy lại từ bộ nhớ dịch, số ảnh (tổng / trùng / giao agent), và số mục LEFT / REVIEW / OVER còn lại. Chi phí quy ra USD chỉ khi bạn cung cấp đơn giá (`--usd-per-mtok`).

## Yêu cầu
Viết để chạy trên Linux, macOS và Windows. **Mới kiểm thử trên Windows** (pptx, xlsx, pdf, overlay ảnh); Linux/macOS và bước OCR chưa kiểm thử, nếu gặp lỗi xin báo ở [Issues](https://github.com/vuongwork/vuong-plugins/issues).
- Python 3 với `python-pptx`, `lxml`, `Pillow` (pptx/xlsx); `fontTools` (tuỳ chọn).
- PDF: `scripts/setup_env.py pdf` tạo venv riêng và cài PyMuPDF từ pypi.org.
- LibreOffice để render kiểm tra và cắt ảnh WMF/EMF; poppler (`pdftoppm`) nếu có, không có thì dùng PyMuPDF.
- Font: Noto Sans + DejaVu Sans; Noto Sans CJK JP khi dịch sang tiếng Nhật. Thiếu thì dùng font hệ điều hành (Segoe UI / Arial, Yu Gothic / Meiryo, Hiragino), hoặc đặt `VTRANS_FONT_DIR` trỏ tới thư mục chứa font.
- OCR ảnh: `scripts/setup_env.py ocr` tạo venv riêng, tải easyocr và model tiếng Nhật, tiếng Việt, tiếng Anh (khoảng 100 MB mỗi bộ) từ pypi.org, download.pytorch.org, github.com.

## Bộ nhớ dịch
Mỗi dự án có bộ nhớ dịch riêng ở `~/.vuong-trans/projects/<dự án>/` (đổi bằng `VTRANS_DATA`). Bản sau của cùng tài liệu chỉ phải dịch phần mới (đo thực tế: giảm 84–98% ký tự gửi model; 89% với deck mẫu (version sau) sau khi bỏ chữ template trên master). Chỉ dùng lại nguyên câu, trong cùng dự án; nhãn ngắn (≤ 4 ký tự) và chuỗi đã có hơn một nghĩa vẫn được dịch lại theo ngữ cảnh, kèm bản dịch cũ làm gợi ý.

## Kiểm thử
`python3 -m unittest discover -s tests` (dữ liệu tự sinh, không dùng tài liệu thật).

## Giới hạn
Chữ trong ảnh sau khi dịch không còn chỉnh sửa được. Trang PDF chỉ được vẽ đè, không dựng lại layout.
