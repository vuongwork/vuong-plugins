# leave-request — seeded defects (answer key source; never copied into a workspace)

Spec sources: `spec/L01.md`, `spec/API_Leave.md` → `leave-request/docs/spec/*.xlsx` (`build-spec.mjs`).
UI: `leave-request/design/L01.html` made by vuong-design `spec-to-html` (bench case `vuong-design/spec-to-html-leave`,
2026-11-25: 0.63 USD, 2.6 min, lint 0 errors / 0 warnings, layout 4/4 screens pass on the first run).
`fixed.patch` removes all six defects (applies to the fixture as committed).

| ID | Kind | Spec says | Code does | Where | Seen by |
|---|---|---|---|---|---|
| D1 | spec≠code | reason max 200 (L01 Item!E12), counter n/200, LV-E06 "tối đa 200" | max 255, counter n/255, message "tối đa 255" | `lib/leave.js` REASON_MAX; `public/index.html` counter | UT validate 201..255 chars; E2E counter |
| D2 | spec≠code | LV-E02 "Ngày bắt đầu không được trước hôm nay." (Message!C5) | "Ngày bắt đầu phải từ hôm nay trở đi." | `lib/leave.js` MESSAGES | UT message / E2E error text |
| D3 | spec≠code | cancel only from draft / pending, else 409 LV-E409 (API A5) | approved can be cancelled | `server.js` cancel action | API test cancel approved → 409 |
| B1 | bug | working days Mon–Fri (Item!E10) | Saturday counted (`day === 7` never true) | `lib/leave.js` isWeekend | UT Fri→Mon = 2, Saturday half day = 0 |
| B2 | bug | PUT only for draft, else 409 LV-E409 (API A3) | PUT on pending / approved succeeds | `server.js` PUT | API test PUT pending → 409 |
| B3 | bug | Huỷ đơn shown only for draft / pending (L01 Nut) | shown for rejected and cancelled too | `public/app.js` render | E2E view rejected: no Huỷ đơn |

Real defects nobody seeded, found by the bench runs (2026-11-25). `make-fixed.mjs` fixes U1–U5 as well, so a test
that fails on the fixed app is a wrong test or U6/U7:

| ID | Spec / BA answer | Code does | Fixed in fixed.patch |
|---|---|---|---|
| U1 | balance shown in Edit (Item!F11) | entering Edit from View (Sửa button) does not load A6 → "–", LV-E04 not checked | yes |
| U2 | API error snackbar shows the message of the code (Nut!A10) | LV-E04 from the API shows a literal "{n}" | yes (uses the API message) |
| U3 | title on the 403/404 notice "Chi tiết đơn nghỉ phép" (Q6) | stays "Tạo đơn nghỉ phép" | yes |
| U4 | network / unknown error: readable red snackbar (Q12) | empty snackbar | yes |
| U5 | numbers like "3,0", "12,0" (Giao dien!B23 example, design) | "3.0" | yes |
| U6 | "today" is the server date (API!A7, Q8) | FE uses the browser date | no (needs an API change) |
| U7 | New → Gửi duyệt: A2 ok, A4 fails → screen moves to Edit of the new draft (Q7) | stays in New, next click PUTs | no |

Existing tests (`tests/leave.test.js`, 9 tests):

| Test | Problem | Found by |
|---|---|---|
| counts Monday to Friday as 5 days | ok | – |
| counts a morning off as half a day | ok | – |
| counts a Saturday morning as half a day | asserts the bug B1 (spec: weekend = 0) | spec check only |
| handles a range over the weekend | no assertion | script |
| shows one decimal | tautology | script |
| requires a reason when the type is Other | ok | – |
| accepts a reason of 250 characters | asserts D1 (spec: > 200 → LV-E06) | spec check only |
| is called with the form values | mock calls only | script |
| accepts a valid annual leave | swallowed failure (and past dates) | script |
