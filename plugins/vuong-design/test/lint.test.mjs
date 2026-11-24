import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { lintFile, summarize, main } from '../core/lint.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM ? false : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

let browser;
before(async () => { if (!skip) { const { launchBrowser } = await import('../core/browser.mjs'); browser = await launchBrowser(); } });
after(async () => { if (browser) await browser.close(); });

const lint = (name, o = {}) => lintFile(join(FIX, name), { browser, ...o });
const codes = (r, level) => [...new Set(r.findings.filter((f) => !level || f.level === level).map((f) => f.code))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const tmp = () => mkdtempSync(join(tmpdir(), 'vd-lint-test-'));

test('summarize: 300 findings still fit in 15 lines', () => {
  const findings = Array.from({ length: 300 }, (_, i) => ({ code: i % 2 ? 'W5' : 'E4', level: i % 2 ? 'warn' : 'error', screen: `S${i}`, sel: 'div.a > span.b', msg: `message ${i}`, n: i + 1 }));
  const lines = summarize({ file: '/x/y.html', ms: 1234, screens: [{}, {}], counts: { error: 150, warn: 150 }, tokens: { color: { ratio: 0.5 } }, findings });
  assert.ok(lines.length <= 15, `got ${lines.length} lines`);
  assert.match(lines[0], /2 screens, 150 errors, 150 warnings/);
});

test('lint-clean: 0 errors, 0 warnings, all tokens used through var()', { skip }, async () => {
  const r = await lint('lint-clean.html');
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.counts, { error: 0, warn: 0 });
  assert.deepEqual(r.screens.map((s) => s.id), ['A1', 'A2']);
  for (const g of ['color', 'space', 'radius', 'fontSize']) assert.equal(r.tokens[g].ratio, 1, g);
  assert.equal(r.profile, 'vd-html/1');
});

test('lint-errors: exactly the E codes of the profile, as errors', { skip }, async () => {
  const r = await lint('lint-errors.html');
  assert.deepEqual(codes(r), ['E2', 'E3', 'E4', 'E6', 'E7', 'E8']);
  assert.ok(r.findings.every((f) => f.level === 'error'));
  assert.equal(r.counts.warn, 0);
  assert.ok(r.findings[0].level === 'error' && r.findings[0].n >= 1 && r.findings[0].sel);
});

test('lint-warns: exactly these W codes, no errors', { skip }, async () => {
  const r = await lint('lint-warns.html');
  assert.equal(r.counts.error, 0);
  assert.deepEqual(codes(r), ['W1', 'W2', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10']);
  assert.ok(r.tokens.color.ratio < 0.8);
  const w5 = r.findings.filter((f) => f.code === 'W5').map((f) => f.msg).join(' ');
  for (const p of ['outline', 'filter', 'text-shadow']) assert.match(w5, new RegExp(p));
});

test('lint-wrap: W11 on the chip row that re-wraps when widened, not on the row that keeps one line', { skip }, async () => {
  const r = await lint('lint-wrap.html');
  assert.deepEqual(codes(r), ['W11']);
  const w = r.findings.filter((f) => f.code === 'W11');
  assert.equal(w.length, 1);
  assert.match(w[0].sel, /rewraps|chips:nth-of-type\(1\)/);
  assert.match(w[0].msg, /3\+1 -> 4/);
});

test('lint-pct: W12 on an in-flow % width, not on the absolute fill or width:100%', { skip }, async () => {
  const r = await lint('lint-pct.html');
  assert.deepEqual(codes(r), ['W12']);
  const w = r.findings.filter((f) => f.code === 'W12');
  assert.equal(w.length, 1);
  assert.equal(w[0].sel, 'div.bar:nth-of-type(1) > div.fill');
  assert.match(w[0].msg, /width: 65%/);
});

test('lint-zorder: W13 on a dropdown covered by a later row, not on the same dropdown placed last or a badge inside its parent', { skip }, async () => {
  const r = await lint('lint-zorder.html');
  assert.deepEqual(codes(r), ['W13']);
  const w = r.findings.filter((f) => f.code === 'W13');
  assert.equal(w.length, 1);
  assert.equal(w[0].screen, 'A1');
  assert.match(w[0].sel, /menu/);
});

test('lint-ratio: W14 on a stretching aspect-ratio box, W15 on content cut by the screen bottom; nothing on a fixed-width ratio', { skip }, async () => {
  const r = await lint('lint-ratio.html');
  assert.deepEqual(codes(r), ['W14', 'W15']);
  for (const f of r.findings) assert.equal(f.screen, 'A2');
  assert.match(r.findings.find((f) => f.code === 'W14').msg, /aspect-ratio 16 \/ 9/);
});

test('lint-stretch: W16 grow ratio, W17 max-width cap, W18 inline icon, W5 justify + subscript; nothing on equal fills or an icon in a flex row', { skip }, async () => {
  const r = await lint('lint-stretch.html');
  assert.deepEqual(codes(r), ['W5', 'W16', 'W17', 'W18']);
  for (const f of r.findings) assert.equal(f.screen, 'A2', `${f.code} ${f.sel}`);
  const w5 = r.findings.filter((f) => f.code === 'W5').map((f) => f.msg).join(' | ');
  assert.match(w5, /justify/);
  assert.match(w5, /vertical-align/);
});

test('lint-shrink: W3 on the row that relies on flex-shrink, not on the min-width:0 / flex:1 rows', { skip }, async () => {
  const r = await lint('lint-shrink.html');
  assert.deepEqual(codes(r), ['W3']);
  const sels = r.findings.map((f) => f.sel).join(' | ');
  assert.match(sels, /row-bad/);
  assert.doesNotMatch(sels, /row-good/);
});

test('lint-fixed: W2 only for the fixed-width screen and the screen where no child stretches', { skip }, async () => {
  const r = await lint('lint-fixed.html');
  const w2 = Object.fromEntries(r.findings.filter((f) => f.code === 'W2').map((f) => [f.screen, f.msg]));
  assert.deepEqual(Object.keys(w2).sort(), ['A1', 'A3']);
  assert.match(w2.A1, /fixed width/);
  assert.match(w2.A3, /nothing inside/);
  assert.deepEqual(codes(r), ['W2']);
});

test('E1: no screen for the selector', { skip }, async () => {
  const r = await lint('lint-clean.html', { root: '.nope' });
  assert.deepEqual(codes(r), ['E1']);
  const r2 = await lint('lint-clean.html', { root: '[[' });
  assert.deepEqual(codes(r2), ['E1']);
});

test('lint does not modify the source file', { skip }, async () => {
  const p = join(FIX, 'lint-warns.html');
  const before = readFileSync(p);
  await lintFile(p, { browser });
  assert.deepEqual(readFileSync(p), before);
});

test('main: exit 0 / 1 / 2, --strict, --out, --log', { skip }, async () => {
  const dir = tmp();
  try {
    const lines = [];
    const deps = { browser, out: (m) => lines.push(m), log: () => {} };
    assert.equal(await main(['--html', join(FIX, 'lint-clean.html')], deps), 0);
    assert.equal(await main(['--html', join(FIX, 'lint-errors.html'), '--out', dir], deps), 1);
    assert.ok(existsSync(join(dir, 'lint.json')));
    assert.ok(lines.length <= 15 * 2);
    assert.equal(await main(['--html', join(FIX, 'lint-warns.html')], deps), 0);
    assert.equal(await main(['--html', join(FIX, 'lint-warns.html'), '--strict'], deps), 1);
    assert.equal(await main(['--html', join(dir, 'missing.html')], deps), 2);
    assert.equal(await main([], deps), 2);
    assert.equal(await main(['--bogus'], deps), 2);
    const logPath = join(dir, 'runs.jsonl');
    await main(['--html', join(FIX, 'lint-clean.html'), '--log', logPath], deps);
    const rows = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(rows.length, 1);
    const row = JSON.parse(rows[0]);
    assert.deepEqual([row.tool, row.screens, row.error, row.warn], ['lint', 2, 0, 0]);
    assert.ok(row.ts && row.file && row.ms >= 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('main: --json prints the full result', { skip }, async () => {
  const lines = [];
  assert.equal(await main(['--html', join(FIX, 'lint-clean.html'), '--json'], { browser, out: (m) => lines.push(m), log: () => {} }), 0);
  assert.equal(JSON.parse(lines.join('\n')).version, 1);
});

test('templates/starter.html: 0 errors, 0 warnings, every token group fully on var()', { skip }, async () => {
  const r = await lintFile(join(FIX, '..', '..', 'templates', 'starter.html'), { browser });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.screens.map((s) => s.id), ['S1', 'S2', 'S3']);
  for (const g of ['color', 'space', 'radius', 'fontSize']) assert.equal(r.tokens[g].ratio, 1, g);
});
