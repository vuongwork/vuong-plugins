# vuong-design: HTML/spec → design system → Figma (tài liệu thiết kế)

Tên `vuong-design` là tên tạm. Ngày: 2026-11-21. Trạng thái: chờ duyệt.

## 1. Mục đích và lý do

HTML làm nhanh, tiện để review, nhưng đi đường dài trong một dự án thì không ổn: không có nguồn chuẩn cho giao diện, mỗi lần vibe ra một kiểu, không gắn được với tài liệu thiết kế. Plugin này biến Figma thành **chốt chặn về thiết kế UI** của dự án:

- Figma là nguồn chuẩn để code theo và cập nhật về sau.
- Mỗi phần tử trong Figma có ID, nối với tài liệu basic/detail design (Excel, Word, Markdown) và với code. Figma không chỉ là hình vẽ.
- Đầu ra phải **đủ, đúng, chuẩn, đẹp**: đủ (không sót phần tử), đúng (khớp nguồn, có kiểm chứng), chuẩn (biến, component, auto layout theo chuẩn thiết kế), đẹp (giữ cái đẹp của nguồn và sửa các chỗ lệch vụn).

Người dùng: mọi vai trò trong team (BA, designer, dev, tester), tất cả đều dùng Claude Code. Biết hay không biết Figma không quan trọng. Plugin cài từ marketplace `vuong-plugins`.

## 2. Mục tiêu, không phải mục tiêu, phản mục tiêu

**Mục tiêu (bản 1):** HTML → design system → file Figma có biến, text style, component, màn ghép từ instance, ID đầy đủ, kèm báo cáo chuẩn hoá và báo cáo kiểm tra.

**Không phải mục tiêu của bản 1:** tạo design system từ spec (bản 2), đồng bộ hai chiều (bản 3), luồng prototype có điều kiện, dark mode tự sinh, plugin chạy trong Figma (chỉ chuẩn bị chỗ cắm).

**Phản mục tiêu** (nếu xảy ra thì coi là thất bại dù chạy được):
- Đổ layer phẳng nhìn giống nhưng không sửa tiếp được.
- Áp con số cứng cho những gì vốn co giãn (ví dụ khoảng cách giữa các item flex), làm hỏng khi đổi kích thước màn hình.
- Âm thầm sửa giá trị mà không báo, hoặc báo "xong" khi còn phần chưa kiểm tra được.
- Mỗi style CSS mới lại cần một luật mới.
- Chi phí token bùng nổ đến mức làm dở dang (công cốc).

## 3. Ràng buộc đã biết (đo trong bản thử)

- Ghi vào Figma qua Figma MCP remote, cần gói Professional trở lên và Full seat. Giới hạn khoảng 200 lượt gọi/ngày/người (gói Pro).
- `use_figma` chạy Plugin API nhưng **không có `fetch`**: toàn bộ mã và dữ liệu phải nằm trong tham số gọi, tối đa 50 KB mỗi lần. Hệ quả: AI phải đọc rồi chép lại dữ liệu, đây là chi phí token lớn nhất.
- Có `setSharedPluginData` (lưu ID vào node), `setReactionsAsync` (prototype), `createNodeFromSvg` (icon vector).
- Ba skill bắt buộc của plugin Figma chính thức (`figma-use`, `figma-generate-library`, `figma-generate-design`) tốn khoảng 25–28 nghìn token mỗi phiên.
- `get_screenshot` trả URL, tải về đĩa bằng curl, không đưa ảnh vào ngữ cảnh.

## 4. Các hướng đã xét

| Hướng | Mô tả | Kết luận |
|---|---|---|
| A. Chỉ skill | AI tự đọc HTML, tự quyết, tự viết mã Figma | Loại: mỗi lần một kiểu, tốn token, không đảm bảo được đúng |
| **B. Skill + script cố định** | Script làm mọi phần đo được hoặc tính được; AI chỉ làm phần cần hiểu ý nghĩa và trao đổi với người dùng | **Chọn** |
| C. B + plugin chạy trong Figma | Script xuất dữ liệu, plugin Figma tự dựng | Để sau, như "cầu nối" khi chi phí thành vấn đề thật |

Người dùng chọn B. Dữ liệu trung gian được thiết kế để cắm được cầu nối C sau này (một plugin Figma nhỏ lấy dữ liệu từ server cục bộ, đưa chi phí chép mã về gần 0 token và bỏ giới hạn 50 KB).

## 5. Tổng thể

```
Đầu vào                     Lõi (script, chạy trên máy)                         Đầu ra
HTML  ─┐                 ┌─ Render + đo (2 độ rộng)                         ┌─ tokens.json (W3C, 3 tầng)
Spec  ─┼─► Đọc nguồn ───►├─ Suy bố cục đệ quy theo hình học + mô phỏng ─────►├─ File Figma (biến, component, màn)
Code  ─┘  (bản 2, 3)     ├─ Rút design system, chuẩn hoá theo luật           ├─ Sổ ID (repo)
                         ├─ Nhận diện component                              ├─ Báo cáo chuẩn hoá
                         ├─ Sinh lô ghi Figma / lô cập nhật theo phần khác   ├─ Báo cáo kiểm tra 5 lớp
                         └─ Kiểm tra 5 lớp                                   └─ ID + hình màn ghi ngược vào tài liệu
AI làm: đặt tên component/token theo vai trò, hỏi người dùng, viết báo cáo, xử lý ca lạ.
```

## 6. Đọc nguồn HTML

- Render bằng trình duyệt chạy ngầm (Playwright). Đọc **style đã tính** (computed style), không đọc mã CSS: mọi cách viết (Tailwind, inline, viết tắt, `var()`) đều quy về một dạng.
- Đo mỗi màn ở **hai độ rộng** để biết ý định co giãn: rộng ra theo khung → fill; giữ nguyên → fixed hoặc hug; khoảng cách thay đổi → khoảng cách tự động.
- **Độ rộng thứ hai = gốc + Δ, mặc định Δ = 120px, chỉnh được.** Căn cứ: đủ lớn để vượt nhiễu làm tròn kể cả khi chia cho nhiều phần tử fill (120/4 = 30px mỗi phần tử), đủ nhỏ để thường chưa đổi bố cục. Đây là số chọn qua bản thử, không phải chuẩn. Rủi ro: nới khung có thể vượt một mốc media query làm HTML đổi sang bố cục khác, khi đó so hai lần đo sẽ sai. Vì vậy trước khi đo, đọc các mốc `min-width`/`max-width` trong CSS và hạ Δ xuống dưới mốc gần nhất. Không còn Δ an toàn (≥ 24px) thì đánh cờ màn đó (`unsafeWiden`) trong báo cáo, không đoán.
- **Chuẩn hoá font và cao dòng trước khi đo (R10, R14, R41).** (1) Trang nguồn được render lại bằng **đúng bản font Figma sẽ dùng**: font có trong Figma thì nạp bản Google Fonts (dù máy có bản cài sẵn, để nguồn và bản mô phỏng cùng một file font), font không có thì thay bằng font thay thế (Inter cho `system-ui`, Times New Roman...). Lý do ghi trong báo cáo: `version` (cùng font, nạp bản Google), `not-in-figma`, `system`. So sánh vì thế luôn cùng điều kiện và mọi kiểm tra vẫn bật; việc đổi font không được dùng làm cớ bỏ qua node. (2) `line-height: normal` được ghi thành px tường minh (đo một dòng) vì Figma không có "normal". Số lượng và chênh lệch so với trang gốc nằm ở mục "Normalisation" của báo cáo.
- Font Google được tải từ mạng kể cả khi HTML không tham chiếu (R9): chỉ tên họ font rời máy, không có dữ liệu dự án; offline thì báo font không render được. Tắt bằng `--no-webfonts`: không nạp thêm font Google, nhưng link font và `@font-face` của chính trang vẫn tải khi đo và được chép sang bản mô phỏng.
- Thu đủ mọi thứ hiển thị: phần tử, **đoạn chữ** (đo bằng Range), icon (`<use>` → `<symbol>`), **phần tử giả `::before`/`::after`**, ảnh. Không có gì bị bỏ qua mà không ghi lại.
- Nguồn đóng gói (iframe `srcdoc`, bundle) được tháo trước khi đo. Chỉ ghi file đã xử lý vào thư mục tạm, không sửa HTML gốc.
- AI không đọc HTML gốc, chỉ đọc bản tóm tắt (đo được: 1,7 KB thay cho 64 KB).

## 7. Suy bố cục: thuật toán đệ quy theo hình học (lõi)

Không viết luật cho từng kiểu CSS. Trình duyệt quy mọi style về các hộp đã đặt vị trí; Figma auto layout chỉ có một bộ khái niệm hữu hạn (chiều xếp, padding, gap, căn lề, fill/hug/fixed, wrap, đặt tuyệt đối). Một thuật toán áp cho mọi node:

```
chuyen(node):
  con = mọi thứ hiển thị bên trong
  không có con → node lá: chữ / vector / hình, lấy màu, viền, bo góc, bóng từ style đã tính
  con chồng lên nhau hoặc tràn ra ngoài khung cha → đặt tuyệt đối (toạ độ đo được)
  phần còn lại:
    hàng ngang / hàng dọc / lưới (theo hình học) → chiều xếp hoặc wrap
    khoảng cách đều → gap; khoảng cách lớn bất thường ở cuối + con chạm mép → spacer co giãn
    khoảng cách không đều → tách nhóm theo độ gần, đệ quy vào từng nhóm
    lề từ mép cha (trừ viền) đến cụm con → padding
    vị trí con trên trục phụ → căn lề (đầu / giữa / cuối / giãn)
    đo ở 2 độ rộng → fill / hug / fixed
  chuyen(từng con)
```

CSS chỉ dùng cho những gì hình học không cho biết: màu, font, viền, bo góc, bóng, độ mờ, gạch chữ, ý định co giãn (`flex-grow`, `margin:auto`).

Bổ sung:
- **Phương án dự phòng:** hiệu ứng Figma không biểu diễn được bằng layer sửa được (gradient phức tạp, `clip-path`, `filter`, `mask`, ảnh nền) → chụp riêng node đó thành ảnh, đánh dấu "không sửa được", đưa vào báo cáo. Kết quả không bao giờ vỡ.
- **Mô phỏng trước trên máy (đã kiểm chứng, thay cho Yoga):** dựng lại spec thành flexbox thuần chỉ dùng khái niệm Figma, render trên cùng trình duyệt ở hai độ rộng, so từng node với HTML. Container nào lệch thì thử cách hiểu khác và chọn cách khớp nhất; chỉ gửi sang Figma khi đã khớp. Bản mô phỏng phải mô hình thêm các khác biệt của Figma đã đo được:
  - Khung chữ: rộng = làm tròn lên (rộng trình duyệt − giãn chữ của ký tự cuối), cao = làm tròn lên.
  - Ô FILL có viền: Figma cộng độ dày viền vào kích thước ô. Cách xử lý: vẽ viền đó thành lớp phủ tuyệt đối (cần kiểm chứng) hoặc mô hình trong bản mô phỏng.
  - Ràng buộc SCALE của Figma co cả kích thước; không có kiểu "co vị trí, giữ kích thước". Quyết định của người dùng (2026-11-22, R47): chỉ dùng SCALE cho node `position:absolute` có vị trí/kích thước viết bằng % trên trục đó (đọc giá trị gốc, không suy từ hình học) và khớp tỉ lệ ở cả hai độ rộng. Vị trí % + kích thước cố định: khung phụ rộng 0 mang SCALE, node treo bên trong (L/R). Khác biệt cần thử ở plan 3: SCALE của Figma tính theo khung cha, CSS % theo padding box của khối chứa (cha có viền hoặc khối chứa không phải cha → không khớp, giữ ràng buộc cố định); Figma có cho khung rộng 0 (tối thiểu 0,01) giữ đúng vị trí không.
  - Chữ nhiều cỡ trong một dòng: Figma giữ cố định cao dòng, trình duyệt nới ra → gắn cờ, không tin chiều cao mô phỏng.
  - Render bản mô phỏng bằng **font Figma sẽ thực sự dùng** (font thay thế nếu font gốc không có trong Figma). Từ R10 trang nguồn cũng được render lại bằng font đó trước khi đo (mục 6), nên chữ ở hai bên cùng font; việc thay font và việc ghi `line-height` tường minh (R14) vào báo cáo chuẩn hoá.
  - Builder: đặt `strokesIncludedInLayout=false` sau khi bật auto layout; đặt node tuyệt đối và ràng buộc **sau khi** dựng xong cả cây.
- **Hành vi CSS mà auto layout không có** (đưa vào báo cáo chuẩn hoá để người dùng quyết, không cố dịch): phần tử bị co nhỏ hơn nội dung (`flex-shrink`), chia theo tỉ lệ (`flex: 2` / `flex: 1`), `space-around` / `space-evenly`.
- **Căn theo đường chân chữ (baseline):** bản thử giả lập bằng khung bọc phụ. Bản 1 dùng căn baseline của Figma (`ca: 'B'`): mỗi hàng chữ cùng đường chân chữ không cần thêm khung bọc cho từng phần tử lệch. (Con số "65 khung trên 25 màn" của bản thử là khung bọc cho margin/inset lệch trục phụ, không phải khung baseline; mã hiện vẫn dùng khung bọc `align` cho margin/inset đó, chỉ bỏ được phần do lệch chân chữ.)
- Bài học từ bản thử: các lỗi lệch còn lại đều đến từ **luật riêng còn sót** (ví dụ "chữ trong cột dọc thì kéo giãn"). Luật hình học chung sửa được cả loạt lỗi cùng lúc.

## 8. Design system

### 8.1 Hai đường vào, một đầu ra
- **Rút từ HTML (bản 1):** thu mọi giá trị đang dùng, gom nhóm, đề xuất, người dùng duyệt.
- **Tạo từ spec (bản 2):** hỏi bộ câu hỏi, sinh design system, sau đó HTML review được sinh ra chỉ dùng token.
- Cả hai ra cùng `tokens.json` (chuẩn W3C Design Tokens) trong repo dự án, 3 tầng: gốc → vai trò → component. Mỗi token có ghi chú cách dùng. Sau khi có design system, các lần vibe HTML sau đưa file token vào prompt.

### 8.2 Lõi chung + lớp chuyển đổi theo nền tảng
Lõi đặt tên trung tính theo vai trò (`text.primary`, `surface.card`, `radius.md`). Lớp chuyển đổi dịch sang Material 3 (Android/Compose), Apple HIG (iOS) hoặc CSS variables/Tailwind (web), và mang giá trị mặc định của chuẩn đó. Dự án nhiều nền tảng: một lõi, bật nhiều lớp.

### 8.3 Checklist độ phủ (gộp từ M3, Apple HIG, W3C DTCG, Figma SDS, template Design System của Claude)
1. Token thị giác: màu (vai trò, trạng thái, theme), chữ, khoảng cách, kích thước, bo góc, đổ bóng, viền, độ mờ, chuyển động, lớp chồng.
2. Bố cục: kích thước màn và mốc chuyển, lưới cột, lề, mật độ, xoay ngang.
3. Tài sản: logo (biến thể, khoảng trống, cỡ tối thiểu), icon app, bộ icon (kiểu, lưới, cỡ), minh hoạ/linh vật, ảnh.
4. Component: danh sách, cấu tạo, biến thể, cỡ, trạng thái (thường, nhấn, focus, tắt, lỗi, đang tải, rỗng), hướng dẫn dùng.
5. Mẫu: điều hướng, form và validate, rỗng/lỗi/đang tải, phản hồi, danh sách và bảng, tìm kiếm và lọc, onboarding.
6. Nội dung: giọng văn, thuật ngữ, mẫu câu message, định dạng ngày/số/tiền, đa ngôn ngữ, chữ dài ra khi dịch.
7. Truy cập: tương phản WCAG 2.2 AA, vùng chạm (48dp/44pt), thứ tự focus, nhãn trình đọc màn hình, phóng to chữ, giảm chuyển động, an toàn cho người mù màu.
8. Quản trị: quy ước đặt tên, quy ước ID, phiên bản, quy trình thay đổi, map sang code, bỏ dùng.

Mỗi mục gắn một nhãn: **hỏi** / **mặc định theo chuẩn** / **suy ra từ nguồn**. Plugin tự kiểm tra độ phủ và báo mục còn thiếu. Checklist là file có phiên bản trong plugin: thiếu mục nào thì thêm một lần, mọi dự án sau đều được kiểm tra.

### 8.4 Câu hỏi cho người dùng (khoảng 11, câu nào cũng có mặc định)
Nền tảng; 3 tính từ tả cảm giác; màu chủ đạo hoặc logo; font (chỉ liệt kê font hỗ trợ ngôn ngữ cần dùng); mật độ; dark mode; đa ngôn ngữ; kích thước màn mục tiêu; kiểu icon; đổ bóng; tài sản thương hiệu có sẵn. Với HTML có sẵn, plugin điền sẵn câu trả lời rút ra từ HTML và chỉ hỏi xác nhận.

### 8.5 Trang đề xuất có hình
Kết quả rút design system được trình bày thành một trang xem được (ô màu kèm tên, thang khoảng cách vẽ thành thanh, mẫu chữ từng cỡ). Người dùng duyệt bằng mắt, không cần đọc thông số. Có thể xuất sang artifact Design System của claude.ai để cả team xem.

## 9. Chuẩn hoá

Nguyên tắc: **cùng vai trò thì cùng giá trị, khác vai trò thì giữ khác nhau.** Không áp một bộ số cho cả file, không dùng ngưỡng số tương đối.

Mỗi giá trị đi qua thứ tự cố định:
1. Là token/biến có tên → giữ nguyên.
2. Là kết quả co giãn (flex, fill, space-between, margin:auto) → không có con số.
3. Là số nằm trong thang của luật thiết kế → giữ nguyên.
4. Số ngoài thang → tìm các phần tử cùng vai trò **theo cấu trúc** (cùng class, cùng khung, cùng là instance của một component). Có giá trị chiếm đa số thì lấy giá trị đó.
5. Vẫn không xác định được → hỏi người dùng.

Luật cụ thể đã chốt:
- Khoảng cách, kích thước, bo góc: đưa về lưới 4. Không áp cho cỡ chữ (dùng thang chữ riêng), độ dày viền, hình vẽ bên trong icon.
- Cỡ chữ: hỏi người dùng riêng có chuẩn hoá về thang chữ hay không.
- Màu: màu đã có tên không bao giờ tự gộp. Chỉ tự gộp khi ΔE (CIEDE2000) < 1 **và** cùng vai trò. Mọi trường hợp khác thì hỏi.
- Icon: không chuẩn hoá hình bên trong, chỉ đặt vào khung chuẩn 16/20/24.
- Mỗi chỗ sửa có mã lý do trong **báo cáo chuẩn hoá** (cũ, mới, lý do). Người dùng duyệt trước khi ghi Figma. Câu trả lời được lưu thành luật, câu đã hỏi không hỏi lại. Cùng đầu vào luôn ra cùng kết quả.
- Hai bước chuẩn hoá làm trước khi đo (mục 6) cũng ghi vào báo cáo chuẩn hoá, mục "Normalisation": thay font (cũ → mới, lý do `version` / `not-in-figma` / `system`) và `line-height: normal` ghi thành px (số lượng), kèm hình trang gốc đặt cạnh hình đã đo.
- Chuẩn hoá theo lưới 4 cũng xoá luôn loại lệch nhỏ do Figma làm tròn chiều cao chữ (41,3 → 42), vì sau chuẩn hoá không còn số lẻ.

## 10. Component

- Ứng viên: phần tử có cùng chữ ký cấu trúc lặp lại (bản thử dùng ngưỡng ≥ 3 lần). Khác cấu trúc nhỏ → biến thể của cùng component set, không tạo component mới.
- AI đặt tên theo vai trò (bản thử ra `cmp/div`, `cmp/a`: không dùng được).
- **Trạng thái** (Figma là nguồn để dev code theo nên không được thiếu). Thứ tự ưu tiên:
  1. HTML vẽ sẵn (nhận qua class như `is-disabled` hoặc `data-state="error"`) → lấy từ HTML.
  2. HTML không có → sinh theo luật của design system (nhấn: lớp phủ cùng màu chữ 10%; tắt: nội dung 38%, nền 12%; focus: viền 2px token focus; lỗi: token lỗi; đang tải: thay nhãn bằng vòng quay). Đánh dấu *đề xuất*.
  3. Luật không áp được → ghi vào báo cáo độ phủ, không tự vẽ.
- Bảng trạng thái theo loại có sẵn trong plugin (nút: thường, nhấn, tắt, đang tải, focus; ô nhập: trống, focus, đã nhập, lỗi, tắt; ô tích: chưa tích, đã tích, tắt; tab: chọn, chưa chọn). Mobile bỏ hover.
- Duyệt một lượt: plugin dựng trang HTML xem trước mọi component với đủ trạng thái (chạy trên máy, không tốn lượt gọi Figma). Người dùng duyệt bộ luật, sau đó mới ghi Figma. Sửa luật một chỗ thì mọi component đổi theo.
- Nội dung khác nhau giữa các instance: text property, boolean property, **instance swap cho icon** (bản thử thiếu bước này nên tab "Tiến độ" hiện sai icon).
- Thứ tự dựng: nguyên tử → ghép. Auto layout bắt buộc, gắn biến cho màu, padding, gap, bo góc; chữ dùng text style.

## 11. Hệ ID

- Một **sổ ID** cho mỗi dự án trong repo, mỗi màn một file để nhiều người cùng thêm ID không đụng nhau.
- Định dạng **theo quy ước của dự án**, khai báo trong file cấu hình (mã màn, mã chức năng, số item, ID phần tử trong code). Mặc định khi dự án chưa có: `loại.khu-vực.tên` (`scr.A1`, `cmp.task-row`, `el.A1.jar-card`).
- Số thứ tự có thể đánh lại theo nhóm (ví dụ nhóm Header và Detail) → ID gồm màn + nhóm + số.
- Hai chiều: spec → UI hoặc UI → spec. Phần tử chưa có ID thì plugin sinh theo định dạng, trạng thái *đề xuất*; người dùng duyệt xong thành *chính thức* và được ghi ngược vào tài liệu.
- Đổi tên hiển thị không đổi ID. ID đã xoá không dùng lại.
- Lưu trong Figma bằng `setSharedPluginData`. ID cho control và message có ngay từ bản 1 để bản sau nối luồng màn được.

## 12. Tài liệu design: hợp đồng dữ liệu với plugin tài liệu

Quyết định: `vuong-design` **không đọc, không ghi** Excel/Word/Markdown. Việc đó thuộc một plugin tài liệu riêng. Hai plugin trao đổi qua hai file JSON trong repo dự án:

```
Plugin tài liệu ──► spec-data.json    (màn, item, nhóm, loại item, ID đã có)
                          ▼
                    vuong-design ──► design-data.json (ID mới/đã duyệt, map item ↔ node Figma,
                                                       đường dẫn hình màn có đánh số ①②③)
                          ▼
Plugin tài liệu ghi ngược vào tài liệu (gồm chèn hình màn)
```

- Hai file có **schema đánh số phiên bản**, lưu ở một chỗ (thư mục `schemas/` của marketplace), cả hai plugin kiểm tra theo schema. Bản 1 của `vuong-design` định nghĩa schema; plugin tài liệu làm sau.
- `vuong-design` xuất hình màn có đánh số thành file ảnh (từ Figma), không tự chèn vào tài liệu.
- Ghi chú cho plugin tài liệu (không thuộc phạm vi ở đây): tìm mục theo tiêu đề chứ không theo toạ độ ô; mỗi dự án khai báo cấu trúc tài liệu một lần; cột loại item (TextBox, Label, Button...) dùng để map sang component; chỉ xử lý lại mục đã đổi.
- Chưa có `spec-data.json` thì `vuong-design` vẫn chạy được: tự sinh ID theo quy ước, trạng thái *đề xuất*.

## 13. Ghi vào Figma

- Bộ dựng (runtime) cố định + dữ liệu gọn (khoá ngắn, bỏ giá trị mặc định). Bản thử: bộ dựng 6,5 KB, dữ liệu khoảng 8 KB/màn, khoảng 5 màn mỗi lần gọi.
- Mỗi lần gọi trả về ID node và toạ độ từng node (dùng luôn cho kiểm tra, không cần thêm lượt gọi).
- **Cập nhật theo phần khác:** script so bản cũ và bản mới, chỉ gửi thay đổi thuộc tính vào đúng node. Bản thử: 19 thay đổi = 343 byte, so với 22 KB khi dựng lại cả màn (rẻ hơn khoảng 60 lần).
- Chạy lại không tạo trùng (biến, component tìm theo tên trước khi tạo).
- Bố cục file Figma: Bìa · Nền tảng (Màu, Chữ, Khoảng cách, Bo góc, Đổ bóng, Icon) · Component · Mẫu · Màn hình (xếp theo luồng) · Tham chiếu.
- Không ghi song song vào cùng một file. Việc chép dữ liệu có thể giao agent con chạy model rẻ.

## 14. Kiểm tra 5 lớp (cổng hoàn thành)

Bài học từ bản thử: % lệch pixel cả màn đã che mất lỗi đè chữ, và bộ kiểm tra đầu tiên lặng lẽ bỏ qua chữ nằm trực tiếp trong thẻ cha. Một bộ kiểm tra bỏ qua mà không báo còn nguy hiểm hơn không có.

1. **Đủ phạm vi:** mọi thứ hiển thị trong HTML phải ứng với một node Figma. Báo cáo luôn ghi "đã kiểm tra X/Y"; node chưa kiểm tra được tính là chưa đạt.
2. **Vị trí từng node:** so hộp HTML và hộp Figma theo ID. Tìm nguyên nhân gốc (node lệch đầu tiên trong cây, bỏ các node chỉ lệch theo). Ngưỡng theo loại: khung ≤ 0,5px, chữ ≤ 1px (mặc định, chỉnh được theo dự án). Phần đã chuẩn hoá so với giá trị đích.
   - Căn cứ khung 0,5px: nửa điểm ảnh ở màn 1x, lệch dưới mức này bị làm tròn về cùng điểm ảnh khi hiển thị. Bản thử 3 dựng thật trong Figma cho thấy phần bố cục khớp tuyệt đối khi mô hình đúng, nên ngưỡng này không gây báo lỗi giả. Đây là quy ước; ở màn 2x/3x nó tương ứng 1–1,5 điểm ảnh thật.
   - Căn cứ chữ 1px: đo được. Figma làm tròn lên kích thước khung chữ (33,2 → 34) và vẽ chữ hơi khác Chrome, nên lệch dưới 1px luôn có và không sửa được.
   - Vị trí được kiểm **độc lập với kích thước** (R49), theo từng trục và theo cạnh đã căn (đầu / giữa / cuối): node đổi cỡ vẫn phải đúng vị trí; một lời giải thích cho kích thước (cờ, allowlist) không bao giờ bỏ qua lệch vị trí. Lệch cả hai thì báo cả `x` lẫn `w` (hoặc `y` lẫn `h`).
   - Ngưỡng chỉ áp cho sai số vị trí. Chỗ vượt ngưỡng phải có nguyên nhân gốc được giải thích; lớp 4 chứng minh ngưỡng không quá lỏng.
3. **Nội dung từng node:** so ảnh cắt theo vùng node, và so dữ liệu (đúng chữ, đúng icon theo ID, đúng token màu, đúng font).
   - Dữ liệu so ở mọi kích thước, không phụ thuộc ngưỡng ảnh (R50): bo góc (từng góc), cỡ chữ, độ đậm, kiểu nghiêng, gạch chữ, chuyển hoa/thường theo từng đoạn chữ, mã băm nội dung `<svg>` nội tuyến (gồm màu đã nhúng), cách vừa khung và `object-position` của ảnh, nguồn ảnh. Node lá (chữ, icon, ảnh) luôn được so ảnh cắt dù lớn cỡ nào; node chứa dựa vào các kiểm tra dữ liệu và ảnh cắt của con.
   - `font-face` (R55): chữ không có `font.ff` thì tính là chưa kiểm tra được; bản mô phỏng kiểm từng mặt font (đậm / nghiêng) đã nạp, thiếu thì báo `font-face`. Không đưa vào allowlist được.
4. **Kiểm tra bộ kiểm tra:** cố tình cài lỗi (dịch node 3px, đổi icon, xoá dấu tích). Không bắt được lỗi cài thì bộ kiểm tra có điểm mù, sửa trước khi tin kết quả. (Bản thử: dấu tích mảnh lọt qua ngưỡng 12%.) Chạy bằng `--mutate`: bắt hụt bất kỳ lỗi cài nào (`caught === false`) thì lệnh thoát mã 1 (R53); kiểu lỗi không có node ứng viên thì ghi `skipped`, không tính là hụt.
5. **Cổng:** chỉ báo "xong" khi lớp 1–3 đạt hoặc chỗ lệch nằm trong báo cáo chuẩn hoá đã duyệt. Mục duyệt (allowlist, R51) ghi **mức đã duyệt** chứ không duyệt mù: `{ file, screen, node, width: "A"|"B", kind: "root"|"approval"|"crop", delta [dx,dy,dw,dh] + why (root, approval) hoặc ratio + peak (crop), fingerprint (tag, class, chữ hoặc ref icon; node chứa thêm số con, số con của cha và hash chữ đầu tiên, R56), reason, approved }`. Mục chỉ có hiệu lực khi `approved: true`, node vẫn có đúng `fingerprint` và chỗ lệch không vượt mức đã duyệt (cộng dung sai 0,25px mỗi thành phần delta, 0,02 ratio, peak không lớn hơn), `why` của lỗi nằm trong `why` đã duyệt và mỗi thành phần delta giữ đúng chiều đã duyệt (thành phần trong 0,25px được tự do) (R56); sai một điều kiện thì node quay lại thành lỗi. Mục duyệt có reason rỗng hiện là "approved". `report.json` có `allowlistDraft` cho từng màn: mục nháp điền sẵn (`approved: false`) để người dùng xem, viết lý do rồi duyệt. Chỉ root không giải thích được, mục cần duyệt và crop lỗi mới duyệt được; node chưa kiểm tra, lớp bị bỏ qua và lỗi dữ liệu luôn là lỗi. Người dùng chỉ xem bằng mắt các node bị đánh dấu, có ảnh cắt HTML và Figma đặt cạnh nhau.

% pixel cả màn chỉ còn là số tham khảo.

## 15. Chế độ chạy và làm việc nhóm

- **Hỏi ngay:** dừng ở từng chỗ chưa chắc.
- **Chạy hết, duyệt sau:** chỗ chưa chắc dùng phương án an toàn (giữ giá trị gốc), gắn nhãn *cần duyệt* lên node, gom vào báo cáo; trả lời xong thì áp lại một lượt.
- Lệnh theo vai trò trong cùng plugin: BA (spec, ID), designer (design system, chuẩn hoá), dev (Figma → code), tester (kiểm tra).
- Có quy trình duyệt: đề xuất thay đổi lên Figma chuẩn, người có quyền duyệt rồi mới áp.
- Cấu hình, sổ ID, luật thiết kế nằm trong repo dự án, dạng dễ merge.
- Luồng màn và message xác nhận: thông tin chưa có trong tài liệu thì phải hỏi để làm rõ, không tự đoán.

## 16. Chi phí và chống công cốc

Số đo bản thử (2 màn Planora): khoảng 13 lượt gọi Figma; mã gửi sang Figma 21–23 KB (khoảng 8 nghìn token, tính hai lần vì AI đọc rồi chép); kiểm tra khoảng 200 token mỗi ảnh. Ngoại suy 18 màn: khoảng 25–30 lượt gọi, 130–150 nghìn token. Chưa đo hướng A nên chưa có con số so sánh.

- Ước tính token và lượt gọi trước khi chạy; người dùng duyệt.
- Lưu tiến độ vào file trạng thái (gồm ID node đã tạo); hết hạn mức hoặc bị ngắt thì chạy tiếp từ chỗ dừng.
- Ngân sách cứng mỗi lần chạy, chạm thì dừng sạch ở điểm chạy tiếp được.
- Chỉ xử lý lại phần đã đổi; ưu tiên cập nhật theo phần khác thay vì dựng lại.
- Skill viết gọn, tài liệu tham khảo chỉ tải khi cần.

## 17. Giai đoạn

| Bản | Nội dung |
|---|---|
| **1** | HTML tĩnh → rút design system (lõi chung + lớp CSS) → chuẩn hoá → Figma (biến, component có đủ trạng thái, màn) một chiều, ID đầy đủ, kiểm tra 5 lớp, cập nhật theo phần khác có bảo vệ phần sửa tay, xuất `design-data.json` và hình màn có đánh số |
| 2 | Spec → design system (bộ câu hỏi) → sinh HTML review theo token; spec → màn Figma qua cột loại item (đọc `spec-data.json`); lớp Material 3 và Apple HIG; lệnh theo vai trò; app web chạy thật (bấm qua từng màn) |
| 3 | Đồng bộ hai chiều (phát hiện thay đổi trong Figma để cập nhật code/spec; cập nhật Figma khi code đổi mà không đè phần sửa tay); luồng prototype từ tài liệu (control dẫn sang màn, message thành overlay); đường vào từ code (dự án migrate) |
| Khi cần | Cầu nối Figma (hướng C tối giản) nếu chi phí chép dữ liệu thành vấn đề khi cả team dùng |

## 18. Giả định cần kiểm chứng sớm nhất trong bản 1

1. ~~Thuật toán đệ quy hình học, kể cả tách nhóm theo độ gần, chạy đúng trên màn có style khác hẳn.~~ **Đã kiểm chứng** (bản thử 2, 25 màn): 1535/1535 node được kiểm tra, 93,2% trong ngưỡng; phần còn lại là hành vi CSS Figma không có, không phải chia nhóm sai.
2. ~~Yoga mô phỏng đủ sát Figma.~~ **Thay bằng bản mô phỏng flexbox, đã kiểm chứng trên Figma thật** (bản thử 3) với các điều chỉnh ở mục 7.
3. ~~Thu được `::before`/`::after`.~~ **Đã làm được**: biến phần tử giả thành span chép style đã tính, đo chính xác.
4. Kiểm tra bằng lỗi cài sẵn phát hiện được điểm mù của lớp 2–3. **Đạt trên 1 màn** (5/5 lỗi cài bị bắt); cần chạy trên toàn bộ bộ nghiệm thu.
7. Dữ liệu màn dày (đến 39 KB) gần giới hạn 50 KB mỗi lần gọi → cần bảng font/màu dùng chung để nén.
5. Phát hiện được node đã bị sửa tay trong Figma (so với trạng thái lần ghi trước) với chi phí lượt gọi chấp nhận được.
6. Instance swap cho icon trong component.

## 19. Để lại cho người làm

- Ngôn ngữ script (Node cho phần trình duyệt và Yoga là lựa chọn tự nhiên).
- Cấu trúc thư mục plugin, tên lệnh cụ thể, định dạng file sổ ID và file cấu hình.
- Ngưỡng cụ thể của lớp 3 (bản thử dùng 12% pixel khác trên vùng node, đã lộ điểm mù).
- Cách trình bày trang đề xuất design system.

## 20. Quyết định bổ sung (sau vòng đọc kiểm tra)

**Người dùng quyết:**
- **Bên nào thắng khi chạy lại:** sau lần dựng đầu, **Figma là chuẩn**; HTML từ đó chỉ dùng để thêm màn mới. Khi buộc phải cập nhật một màn đã có từ HTML, plugin đọc lại Figma trước (so với ảnh chụp trạng thái lần ghi trước, lưu trong file trạng thái): node đã bị sửa tay thì không đè, đưa vào báo cáo để người dùng quyết. Module này dùng lại cho đồng bộ hai chiều ở bản 3.
- **Tài liệu:** tách sang plugin tài liệu, trao đổi qua hợp đồng dữ liệu (mục 12).
- **Đầu vào bản 1:** HTML tĩnh (một file nhiều màn, như mockup vibe ra). App web chạy thật để bản 2.
- **Trạng thái component:** lấy từ HTML, thiếu thì sinh theo luật và duyệt một lượt (mục 10).
- **Bộ nghiệm thu bản 1:** 18 màn Planora (`git show a4a0967:docs/design/planora-ui-screens.html`) và mockup của finance-controller (`docs/superpowers/specs/2026-11-05-ui-redesign-entry-mockup.html` và các `calendar-layout*.html` trong `.superpowers/brainstorm/`) để kiểm chứng thuật toán trên style khác hẳn. Không có mẫu Excel (không cần, xem mục 12).

**Quyết định của người viết tài liệu (người dùng xem lại):**
- Skill Figma chính thức vẫn tải mỗi phiên vì công cụ bắt buộc; khoảng 25–28 nghìn token đó tính vào ngân sách cố định. Bộ dựng của plugin vẫn tuân theo các luật trong `figma-use`.
- Bản 1 chỉ có lõi chung + lớp CSS (đầu vào là HTML). Material 3 và Apple HIG để bản 2. Lớp chuyển đổi ảnh hưởng tên trong `tokens.json` và giá trị mặc định; trong Figma chỉ có một bộ biến theo lõi.
- Nếu Yoga không mô phỏng đủ sát Figma: bỏ bước mô phỏng, kiểm tra sau khi ghi trong giới hạn ngân sách. Container không khớp được thì giữ auto layout gần đúng nhất và đánh dấu, không đổi sang đặt tuyệt đối. Nếu tách nhóm đệ quy thất bại trên style lạ: dừng lại báo người dùng trước khi làm tiếp, vì đó là lõi của plugin.
- Bản 1 duyệt qua báo cáo trong repo (gói Pro không có branch của Figma). Lệnh theo vai trò để bản 2.

## Phụ lục: bản thử ngày 2026-11-20/21

File Figma: https://www.figma.com/design/GZhIx2XJNiFhwEJXW8fadH (màn A1, A4 của Planora). Mã bản thử nằm ở thư mục tạm, là code bỏ đi.

| Vòng | Thay đổi | Lệch pixel A1/A4 | Node lệch quá ngưỡng A1/A4 |
|---|---|---|---|
| 1 | Bản đầu | 7,2% / 3,2% | chưa đo |
| 2 | Sửa 6 luật riêng (chữ nhiều kiểu, inline, viền từng cạnh, gạch chữ, màu icon, kích thước cố định) | 3,3% / 3,0% | 49 / 25 |
| 3 | Luật hình học chung (padding, gap, căn lề từ hộp đo được; tràn ra ngoài → tuyệt đối; chữ xuống dòng giữ độ rộng) | | 37 / 11 |
| 4 | Cập nhật theo phần khác (343 byte) | 2,3% / 2,1% | 34 / 11 |
| Sau khi vá bộ kiểm tra | Đo cả đoạn chữ, so nội dung từng node | | bắt thêm 4 nhãn lệch trái 7–17px và 2 icon sai |

**Bản thử 2 (thuật toán đệ quy hình học, chỉ chạy trên máy, so với bản mô phỏng flexbox):** 25 màn (18 Planora, 7 finance-controller), 1535/1535 node được kiểm tra, 93,2% trong ngưỡng ở độ rộng gốc và 92,5% ở +120px. 12/18 màn Planora và các màn lịch đạt 99–100%. Tách nhóm theo độ gần dùng 86 lần, không lần nào phải lùi về khung đệm cố định. Kiểm tra bằng lỗi cài: 5/5 lỗi bị bắt; % pixel cả màn chỉ đổi 0,01–0,13%. Dữ liệu 2–39 KB/màn (khoảng 230 byte/node).

**Bản thử 3 (dựng 3 màn lên Figma thật, 11 lượt gọi):** sau khi tách phần chênh do chữ, bố cục khớp 100% (A1), 92,9% (lịch), 90,7% (nhập liệu). Khớp: chia FILL kể cả padding, space-between bỏ qua gap, min/max trên FILL, ràng buộc trái/phải/hai bên/giữa, viền không ảnh hưởng bố cục, hình xoay. Khác: làm tròn khung chữ, viền trên ô FILL, ràng buộc SCALE, chữ nhiều cỡ trong một dòng, font thay thế (chi tiết ở mục 7).

Mã bản thử 2 và 3 ở thư mục tạm (`spike2`, `spike3`), là code bỏ đi nhưng dùng làm tham khảo khi viết bản 1.
