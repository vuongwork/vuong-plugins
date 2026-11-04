#!/usr/bin/env node
// List every command of the plugin with a short description.
//   node help.mjs            all
//   node help.mjs <word>     only lines containing <word> (e.g. "api", "spec", "report")
// selftest checks that every core/ and kit/ script is listed here.
const P = "$PLUGIN"; // = ${CLAUDE_PLUGIN_ROOT}

const GROUPS = [
  ["Trong Claude Code", [
    ["/vuong-test:vuong-test <màn/feature/ticket>", "Chạy quy trình test 8 bước: scope → spec → flows + diff → cases → duyệt → viết/chạy test → report (hoặc gõ câu thường: \"vuong-test màn X\")"],
    ["/vuong-test:init [repo]", "Cài cho project lần đầu, hoặc cho máy mình sau khi clone: test.config.json, đường dẫn riêng máy, spec màn hình / API, môi trường, tài khoản"],
    ["/vuong-test:help [từ khoá]", "Danh sách lệnh này"],
  ]],
  ["Setup & spec (bước 0–2)", [
    [`node ${P}/core/init.mjs <repo>`, "Tạo test.config.json + test.config.local.json (máy này) + thư mục test-work + .gitignore (không ghi đè)"],
    [`node ${P}/core/config.mjs --check | --set NAME=giá trị | --print`, "Đường dẫn riêng từng máy (${NAME} → test.config.local.json, không commit): báo biến còn thiếu / thư mục không có, ghi giá trị, in config đã ghép"],
    [`node ${P}/core/scan-specs.mjs <folder>...`, "Gợi ý thư mục spec theo loại (screen, api, acceptance, decision…) để điền specPaths"],
    [`node ${P}/core/find-spec.mjs <scope>`, "Liệt kê tài liệu spec của một màn/feature theo specPaths + scopes"],
    [`node ${P}/core/read-spec.mjs <file>...`, "xlsx/xlsm/docx → Markdown có nhãn trích dẫn Sheet!Cell / ¶N (→ test-work/_spec/)"],
  ]],
  ["Cases (bước 4–5)", [
    [`node ${P}/core/import-cases.mjs <file tester> --scope <màn> --out W/cases.md`, "File test case của tester (xlsx/xlsm) → cases.md nháp, theo caseTemplates của project; giữ số + dòng gốc"],
    [`node ${P}/core/cases-summary.mjs W/cases.md --flows W/flows.md`, "Tổng quan trước khi duyệt: mỗi vùng (entry point + nhánh) có bao nhiêu case, layer nào, flow nào còn thiếu case"],
    [`node ${P}/core/lint-cases.mjs W/cases.md [--require-approval]`, "Kiểm tra cases.md: thiếu nguồn, thiếu data, layer, ID trùng, chưa duyệt"],
  ]],
  ["Viết test (bước 6)", [
    [`import { createRun } from "${P}/kit/e2e-kit.mjs"`, "E2E Playwright: settle (không chờ cứng), chặn ghi, chặn theo môi trường, ảnh, trace API FE→BE"],
    [`import { createApiRun, shape } from "${P}/kit/api-kit.mjs"`, "Test API: login, expectStatus / expectShape, chặn ghi, created() → data-created.md, lưu request/response"],
    [`require("${P}/kit/fake-api.cjs")  /  kit/fake-api.mjs`, "API giả cho tầng mount/ut: route strict, ghi lời gọi, assertCalled, adapter axios / fetch"],
    [`node ${P}/core/account.mjs ~/.<project>-test-account.sh --vars A,B`, "Tạo sẵn file tài khoản test (mode 600, ngoài repo) để user chỉ điền giá trị; chạy lại để kiểm tra (không in giá trị)"],
    [`node ${P}/core/lint-tests.mjs <dir>...`, "Quét test: chờ cố định (sleep/waitForTimeout), mật khẩu/token viết cứng"],
  ]],
  ["Chạy & report (bước 7–8)", [
    [`node ${P}/core/collect.mjs --cases W/cases.md --out W/results.json ...`, "Gom kết quả: --jest-json/--jest-dir, --junit, --e2e-dir, --api-dir, --coverage, --diff, --data, --notes-dir"],
    ["W/triage.md (templates/triage.md)", "Ghi kết luận của user cho test fail: app-correct / test-wrong / bug / spec-unclear; report hiện cạnh lỗi"],
    [`node ${P}/core/render-html.mjs W/results.json --out W/report/`, "Report HTML: PASS/FAIL/BLOCKED/NOT RUN theo case, spec≠code, data đã tạo, API calls, coverage"],
    [`node ${P}/core/export-cases.mjs W/results.json --out W/report/ [--file <file tester>]`, "Xuất Excel: mẫu mặc định + bản copy file tester có kết quả/bằng chứng ghi đúng dòng (file gốc không đổi)"],
    [`node ${P}/core/cleanup-list.mjs W/data-created.md`, "Danh sách dữ liệu test cần dọn: xoá trên UI / cần BE-DB / đã xong (exit 1 = còn sót)"],
  ]],
  ["Biến môi trường", [
    ["E2E_HEADED=1  E2E_SLOWMO=<ms>", "Mở browser để xem (slow-mo chỉ khi muốn xem)"],
    ["E2E_MERGE=1  /  API_MERGE=1", "Chạy lại một phần case, giữ kết quả các case khác"],
    ["VUONG_TEST_GUARD=off  /  VUONG_TEST_GUARD_EXTRA=<regex>", "Tắt hook chặn lệnh nguy hiểm / thêm mẫu chặn riêng của project"],
  ]],
  ["Bảo trì plugin", [
    [`node ${P}/test/selftest.mjs`, "Tự kiểm tra mọi script (VT_PLAYWRIGHT_FROM=<dir> để chạy thêm check E2E)"],
    [`node ${P}/kit/build-cjs.mjs [--check]`, "Sinh fake-api.cjs từ fake-api.mjs"],
    ["hooks/guard-bash.mjs (tự bật)", "Chặn DROP/DELETE FROM, DB client, git reset --hard/clean/push -f, rm -r /, curl ghi"],
  ]],
  ["Thư viện nội bộ (không gọi trực tiếp)", [
    ["core/parsers.mjs, core/coverage.mjs, core/ooxml.mjs, kit/env.mjs", "Đọc cases/diff/junit/jest/e2e, coverage istanbul/JaCoCo, đọc/ghi xlsx/docx, guard môi trường + che secret, verify() (Expected/Actual)"],
  ]],
];

const q = (process.argv[2] || "").toLowerCase();
const width = 62;
let shown = 0;
console.log(`vuong-test — lệnh (${P} = thư mục plugin; W = test-work/<scope>/)\n`);
for (const [title, rows] of GROUPS) {
  const hit = rows.filter(([c, d]) => !q || `${title} ${c} ${d}`.toLowerCase().includes(q));
  if (!hit.length) continue;
  console.log(`${title}`);
  for (const [c, d] of hit) {
    shown++;
    console.log(c.length > width ? `  ${c}\n  ${" ".repeat(width)}  ${d}` : `  ${c.padEnd(width)}  ${d}`);
  }
  console.log("");
}
if (!shown) console.log(`Không có lệnh nào khớp "${q}".`);
console.log("Chi tiết: references/ (config.md, layers.md, stacks/*.md) và skills/vuong-test/SKILL.md");
