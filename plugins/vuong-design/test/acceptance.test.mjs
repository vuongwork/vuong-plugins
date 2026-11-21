// Acceptance on the real corpus (plan 1 Task 8 Step 1): the 25 screens of test/corpus.json through the same pipeline
// as the CLI (pipeline.mjs runFile + gate with the corpus allowlist). Needs VD_CORPUS_DIR (skipped otherwise) and
// VD_PLAYWRIGHT_FROM. The mutation part (spec §14 layer 4, ≈30 s per screen) runs only with VD_ACCEPT_MUTATE=1.
// Prints a per-screen table and every failing item before the assertions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFile, gate, summarize, loadCorpus, PAYLOAD_LIMIT } from '../core/pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.VD_CORPUS_DIR;
const MUTATE = process.env.VD_ACCEPT_MUTATE === '1';
const skip = !DIR ? 'set VD_CORPUS_DIR to the acceptance corpus directory (see test/corpus.json)'
  : !process.env.VD_PLAYWRIGHT_FROM ? 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core' : false;
const EXPECTED_SCREENS = 25;

let browser;
const rows = [];
const fmt = (d) => (Array.isArray(d) ? `[${d.map((v) => Math.round(v * 100) / 100).join(',')}]` : '');

before(async () => {
  if (skip) return;
  const { launchBrowser } = await import('../core/browser.mjs');
  browser = await launchBrowser();
  const corpus = loadCorpus(join(HERE, 'corpus.json'), DIR);
  for (const f of corpus.files) {
    const res = await runFile(browser, f.path, { root: f.root, widen: f.widen, nameOf: f.nameOf, viewport: f.viewport, mutate: MUTATE });
    for (const e of res.screens) {
      const g = gate(e.report, corpus.allowlist, { file: f.file, screen: e.report.id });
      rows.push({ s: summarize(f.file, e, g), g, report: e.report, mutations: e.mutations });
    }
  }
  const pad = (v, n) => String(v).padEnd(n);
  const lines = ['file                                      screen         checked  unch roots appr(max)      crop A/B  data pass'];
  for (const { s } of rows) {
    lines.push(`${pad(s.file, 42)}${pad(s.screen, 15)}${pad(`${s.checked}/${s.total}`, 9)}${pad(s.unchecked, 5)}${pad(s.unexplainedRoots, 6)}` +
      `${pad(`${s.needsApproval}(${s.approvalMax})`, 15)}${pad(`${s.cropA}/${s.cropB}`, 10)}${pad(Object.values(s.data).reduce((a, b) => a + b, 0), 5)}${s.pass ? 'pass' : 'FAIL'}`);
  }
  const tot = (k) => rows.reduce((a, r) => a + r.s[k], 0);
  lines.push(`total: ${rows.length} screens, ${rows.filter((r) => r.s.pass).length} pass; unexplained roots ${tot('unexplainedRoots')}, needsApproval ${tot('needsApproval')}, crop fails ${tot('crop')}`);
  for (const { s, g, report } of rows) {
    if (s.pass) continue;
    const it = [];
    for (const r of g.open.roots) it.push(`root ${r.id}@${r.width} ${r.why.join('')} ${fmt(r.delta)}${r.adjacency ? ` adj ${r.adjacency}` : ''}`);
    for (const c of g.open.crops) it.push(`crop ${c.id}@${c.width} ratio ${c.ratio} peak ${c.peak}`);
    for (const a of g.open.approvals) it.push(`approval ${a.id}@${a.width} ${a.magnitude}`);
    for (const d of report.data) it.push(`data ${d.kind} ${d.id}: ${d.expected} -> ${d.actual}`);
    for (const id of report.unchecked) it.push(`unchecked ${id}: ${report.uncheckedReasons[id]}`);
    for (const k of report.skipped) it.push(`skipped ${k}`);
    lines.push(`-- ${s.file} ${s.screen}: ${it.join('; ')}`);
  }
  if (MUTATE) {
    for (const { s, mutations: m } of rows) lines.push(`mutations ${s.file} ${s.screen}: allCaught ${m.allCaught}; ${m.results.map((x) => `${x.kind}=${x.caught === null ? 'skip' : x.caught}`).join(' ')}`);
  }
  console.log(lines.join('\n'));
});
after(async () => { if (browser) await browser.close(); });

test(`acceptance: the corpus has ${EXPECTED_SCREENS} screens`, { skip }, () => {
  assert.equal(rows.length, EXPECTED_SCREENS);
});

test('acceptance: every screen fully covered (unchecked empty, no skipped layer)', { skip }, () => {
  const bad = rows.filter((r) => r.s.unchecked > 0 || r.s.skipped.length).map((r) => `${r.s.file} ${r.s.screen}`);
  assert.deepEqual(bad, []);
});

test('acceptance: no unexplained root outside the approved allowlist', { skip }, () => {
  assert.deepEqual(rows.flatMap((r) => r.g.open.roots.map((x) => `${r.s.file} ${r.s.screen} ${x.id}@${x.width}`)), []);
});

test('acceptance: no model delta above tolModel outside the approved allowlist', { skip }, () => {
  assert.equal(rows.reduce((a, r) => a + r.g.open.approvals.length, 0), 0);
});

test('acceptance: no crop fail outside the approved allowlist, no data finding', { skip }, () => {
  assert.deepEqual(rows.flatMap((r) => r.g.open.crops.map((x) => `${r.s.file} ${r.s.screen} ${x.id}@${x.width}`)), []);
  assert.deepEqual(rows.flatMap((r) => r.report.data.map((d) => `${r.s.file} ${r.s.screen} ${d.kind} ${d.id}`)), []);
});

test('acceptance: payloadOver50k exactly when specBytes > 50000', { skip }, () => {
  for (const { s } of rows) assert.equal(s.payloadOver50k, s.specBytes > PAYLOAD_LIMIT, `${s.file} ${s.screen}`);
});

test('acceptance: every screen passes (after the allowlist)', { skip }, () => {
  assert.deepEqual(rows.filter((r) => !r.s.pass).map((r) => `${r.s.file} ${r.s.screen}`), []);
});

test('acceptance: every mutation is caught or skipped (VD_ACCEPT_MUTATE=1)', { skip: skip || (MUTATE ? false : 'set VD_ACCEPT_MUTATE=1 (≈30 s per screen)') }, () => {
  const missed = rows.flatMap((r) => r.mutations.results.filter((x) => x.caught === false).map((x) => `${r.s.file} ${r.s.screen} ${x.kind} ${x.target}`));
  assert.deepEqual(missed, []);
});
