// Rebuild fixed.patch: the fixture with every known defect fixed (spec + the BA answers recorded in
// defects.md). Seeded defects D1–D3, B1–B3, and the real unseeded ones U1–U5 found by the bench runs.
//   node bench/fixtures/_meta/leave-request/make-fixed.mjs
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', 'leave-request');
const ws = mkdtempSync(join(tmpdir(), 'leave-fixed-'));
cpSync(SRC, ws, { recursive: true, filter: (s) => !/node_modules|[\\/]\.git$/.test(s) });
const git = (...a) => { const r = spawnSync('git', a, { cwd: ws, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout; };
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=b', '-c', 'user.email=b@l', 'commit', '-qm', 'base');

function edit(file, pairs) {
  const p = join(ws, file);
  let s = readFileSync(p, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${file}: not found: ${a}`);
    s = s.replace(a, b);
  }
  writeFileSync(p, s);
}

edit('lib/leave.js', [
  ['const REASON_MAX = 255;', 'const REASON_MAX = 200;'], // D1
  ["'LV-E02': 'Ngày bắt đầu phải từ hôm nay trở đi.'", "'LV-E02': 'Ngày bắt đầu không được trước hôm nay.'"], // D2
  ['return day === 0 || day === 7;', 'return day === 0 || day === 6;'], // B1
  ['return Number(n || 0).toFixed(1);', "return Number(n || 0).toFixed(1).replace('.', ',');"], // U5 decimal comma (spec example 3,0)
]);
edit('server.js', [
  ["  if (req.method === 'PUT' && !action) {\n", "  if (req.method === 'PUT' && !action) {\n    if (l.status !== 'draft') return fail(res, 409, 'LV-E409');\n"], // B2
  ["if (!['draft', 'pending', 'approved'].includes(l.status))", "if (!['draft', 'pending'].includes(l.status))"], // D3
]);
edit('public/app.js', [
  ["$('btn-cancel').hidden = !(mode !== 'new' && status !== 'approved');", "$('btn-cancel').hidden = !(mode !== 'new' && (status === 'draft' || status === 'pending'));"], // B3
  ["if (!res.ok) throw Object.assign(new Error(data.code || String(res.status)), { code: data.code, status: res.status });",
   "if (!res.ok) throw Object.assign(new Error(data.code || String(res.status)), { code: data.code, status: res.status, text: data.message });"],
  ['  function snack(text, isError) {\n', "  const apiError = (e) => e.text || (e.code && L.MESSAGES[e.code]) || 'Không kết nối được máy chủ, vui lòng thử lại.';\n  function snack(text, isError) {\n"], // U2 {n}, U4 network error text
  ["    try { await persist(); snack(L.message('LV-I01')); setMode('edit'); } catch (e) { snack(L.message(e.code), true); }", "    try { await persist(); snack(L.message('LV-I01')); setMode('edit'); } catch (e) { snack(apiError(e), true); }"],
  ["    } catch (e) { snack(L.message(e.code), true); }\n  }\n\n  async function onCancel", "    } catch (e) { snack(apiError(e), true); }\n  }\n\n  async function onCancel"],
  ["snack(L.message('LV-I03')); setMode('view'); } catch (e) { snack(L.message(e.code), true); }", "snack(L.message('LV-I03')); setMode('view'); } catch (e) { snack(apiError(e), true); }"],
  ['    dirty = false;\n    showErrors([]);\n    render();\n', "    dirty = false;\n    showErrors([]);\n    render();\n    if (m === 'edit') loadBalance();\n"], // U1 balance after Sửa
  ["        $('notice').textContent = L.message(e.code);", "        $('notice').textContent = L.message(e.code);\n        $('title').textContent = 'Chi tiết đơn nghỉ phép';"], // U3 title on 403 / 404
]);
edit('public/index.html', [['>0/255<', '>0/200<']]);
git('add', '-A');
const patch = git('diff', '--cached');
writeFileSync(join(HERE, 'fixed.patch'), patch);
console.log(`fixed.patch: ${patch.split('\n').length} lines (${ws})`);
