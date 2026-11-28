// R90: approve findings in report.html; Submit writes their allowlistDraft entries into the allowlist file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeApprovals, startApproveServer, main } from '../core/approve.mjs';
import { renderReportHtml } from '../core/report-html.mjs';

const fp = { tag: 'div', cls: 'card', kids: 2, sibs: 3 };
const draft = (kind, node, width, extra) => ({ file: 'f.html', screen: 's0', node, width, kind, ...extra, fingerprint: fp, reason: '', approved: false });
const REPORT = {
  screens: [{
    summary: { file: 'f.html', screen: 's0', pass: false },
    gate: { pass: false, open: { roots: [], approvals: [], crops: [], cropsLinked: [{ id: 'n.4', width: 'A', root: 'n.5' }] } },
    report: { roots: [{ id: 'n.5', width: 'A', layer: 'norm', delta: [0, 1, 0, 0], why: ['y'] }, { id: 'n.6', width: 'B', layer: 'layout', delta: [1, 0, 0, 0], why: ['x'] }] },
    allowlistDraft: [
      draft('crop', 'n.3', 'A', { ratio: 0.2, peak: 48 }), draft('approval', 'n.2', 'B', { delta: [0, 3, 0, 0], why: ['y'] }),
      draft('root', 'n.5', 'A', { delta: [0, 1, 0, 0], why: ['y'] }), draft('root', 'n.6', 'B', { delta: [1, 0, 0, 0], why: ['x'] }),
      draft('crop', 'n.4', 'A', { ratio: 0.1, peak: 20 }),
    ],
  }],
};
const OLD = { file: 'f.html', screen: 's0', node: 'n.3', width: 'A', kind: 'crop', ratio: 0.1, peak: 10, fingerprint: fp, reason: 'old', approved: true };
const OTHER = { file: 'g.html', screen: 's1', node: 'n.9', width: 'B', kind: 'crop', ratio: 0.1, peak: 10, fingerprint: fp, reason: 'kept', approved: true };
const FILE = { about: 'kept', allowlist: [OLD, OTHER] };
const item = (kind, node, width, reason) => ({ file: 'f.html', screen: 's0', kind, node, width, ...(reason === undefined ? {} : { reason }) });

test('mergeApprovals saves the draft entries approved, replaces the same finding and keeps every other entry and key', () => {
  const r = mergeApprovals({ file: FILE, report: REPORT, approve: [item('crop', 'n.3', 'A', ' icon is 24 px now '), item('approval', 'n.2', 'B'), item('root', 'n.6', 'B', '')], today: '2026-11-27' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.saved, 3);
  assert.equal(r.file.about, 'kept');
  const list = r.file.allowlist;
  assert.equal(list.length, 4);
  assert.deepEqual(list[0], OTHER);
  assert.deepEqual(list[1], { ...REPORT.screens[0].allowlistDraft[0], reason: 'icon is 24 px now', approved: true });
  assert.equal(list[2].reason, 'approved in report.html 2026-11-27');
  assert.deepEqual(list[2].delta, [0, 3, 0, 0]);
  assert.equal(list[3].node, 'n.6');
  assert.deepEqual(FILE.allowlist, [OLD, OTHER], 'input not mutated');
  // a bare array file stays an array
  assert.ok(Array.isArray(mergeApprovals({ file: [], report: REPORT, approve: [item('crop', 'n.3', 'A')] }).file));
});

test('mergeApprovals is all or nothing: not open, an unexplained norm root, a linked crop or a bad item saves none', () => {
  const bad = [item('crop', 'n.7', 'A'), item('root', 'n.5', 'A'), item('crop', 'n.4', 'A'), { ...item('crop', 'n.3', 'C') }, item('crop', 'n.3', 'A', 'x'.repeat(501)), 'n.3'];
  for (const b of bad) {
    const r = mergeApprovals({ file: FILE, report: REPORT, approve: [item('approval', 'n.2', 'B'), b] });
    assert.equal(r.saved, 0);
    assert.equal(r.errors.length, 1, JSON.stringify(b));
    assert.equal(r.file, FILE);
  }
  assert.equal(mergeApprovals({ file: FILE, report: REPORT, approve: [] }).errors.length, 1);
  // a norm root on a real-Figma check (R83) can be approved
  const fig = structuredClone(REPORT); fig.screens[0].report.figmaReal = true;
  assert.deepEqual(mergeApprovals({ file: FILE, report: fig, approve: [item('root', 'n.5', 'A')] }).errors, []);
});

const summary = { file: 'f.html', screen: 's0', checked: 4, total: 4, unchecked: 0, unexplainedRoots: 1, needsApproval: 0, approvalMax: 0, crop: 1, cropLinked: 1, data: {}, flags: {}, skipped: [], allowed: 0, specBytes: 100, payloadOver50k: false, pixel: [0, 0], pass: false };
const it = (kind, id, x, o = {}) => ({ kind, id, width: 'A', node: 'div', proxy: 'layout proxy', src: null, box: null, x: { id, width: 'A', ...x }, flags: [], ...o });
const view = (items, screen = 's0') => ({ file: 'f.html', summary: { ...summary, screen }, items, data: [], unchecked: [], skipped: [], norm: { fontSubs: [], modelSubs: [], lineHeight: 0 }, mutations: null, W: [300, 420] });

test('report.html: an approve box on every finding that can be approved, a note on the others, the bar only when needed', () => {
  const items = [
    it('crop', 'n.3', { ratio: 0.2, diff: 10, peak: 48, sizeExplainedBy: 'norm' }, { approvable: true, normCause: ['n.3 paddingT 1 → 4 (GRID4)'] }),
    it('root', 'n.5', { delta: [0, 1, 0, 0], layer: 'norm' }, { approvable: false }),
    it('crop', 'n.4', { ratio: 0.1, diff: 5, peak: 20, root: 'n.5' }, { approvable: false }),
  ];
  const html = renderReportHtml({ screens: [view(items), view([it('crop', 'n.3', { ratio: 0.2, diff: 10, peak: 48, sizeExplainedBy: 'norm' }, { approvable: true })], 's1')] });
  assert.equal((html.match(/<input type="checkbox" class="ap">/g) || []).length, 1, 'the repeat on s1 has no box of its own');
  assert.match(html, /class="approve" data-file="f\.html" data-screen="s0" data-akind="crop" data-node="n\.3" data-width="A" data-anchor="[^"]+">/);
  // R96: a difference from a normalisation answer names that answer; no button ticks such items in bulk
  assert.match(html, /class="normcause">Caused by a normalisation answer, not by the build: <code>n\.3 paddingT 1 → 4 \(GRID4\)<\/code>/);
  assert.doesNotMatch(html, /ap-explained|data-explained/);
  assert.match(html, /class="item repeat" data-of="[^"]+" data-file="f\.html" data-screen="s1" data-akind="crop"/);
  assert.match(html, /Cannot be approved: a layout error the plugin must explain/);
  assert.match(html, /Approved together with the layout error on <code>n\.5<\/code>/);
  assert.match(html, /<div id="approvebar">[\s\S]*id="ap-submit"/);
  assert.match(html, /<input type="checkbox" id="ap-only"> show only items left to approve/);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(renderReportHtml({ screens: [view([items[1]])] }), /id="approvebar"/);
});

async function post(url, body, headers = {}) {
  const r = await fetch(new URL('approve', url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
}

test('server: GET serves report.html, POST merges into the allowlist with a backup, a bad item or another origin changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-approve-'));
  writeFileSync(join(dir, 'report.html'), '<!doctype html><p>report</p>');
  writeFileSync(join(dir, 'report.json'), JSON.stringify(REPORT));
  const path = join(dir, 'vd-allowlist.json');
  writeFileSync(path, JSON.stringify(FILE));
  const logs = [];
  const srv = await startApproveServer({ dir, allowlistPath: path, log: (s) => logs.push(s) });
  try {
    assert.match(await (await fetch(srv.url)).text(), /report/);
    const bad = await post(srv.url, { approve: [item('root', 'n.5', 'A')] });
    assert.equal(bad.status, 400);
    assert.match(bad.j.error, /norm root/);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), FILE);
    assert.equal((await post(srv.url, { approve: [item('crop', 'n.3', 'A')] }, { origin: 'http://evil.example' })).status, 403);
    const ok = await post(srv.url, { approve: [item('crop', 'n.3', 'A', 'fine')] });
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.saved, 1);
    assert.equal(ok.j.total, 2);
    assert.deepEqual(JSON.parse(readFileSync(`${path}.bak`, 'utf8')), FILE);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.allowlist.find((e) => e.node === 'n.3').reason, 'fine');
    assert.match(logs.join('\n'), /saved 1 entry/);
    // the page asks which findings are in the file now (submitted since the report was made)
    const al = await (await fetch(new URL('allowlist', srv.url))).json();
    assert.deepEqual(al.entries.find((e) => e.file === 'f.html'), { file: 'f.html', screen: 's0', node: 'n.3', width: 'A', kind: 'crop' });
    assert.equal(al.entries.length, 2);
  } finally { await srv.close(); }
});

test('main: usage errors and a missing allowlist file is created on the first submit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-approve-main-'));
  const logs = [];
  assert.equal((await main(['--out', dir], { log: (s) => logs.push(s), open: () => {} })).code, 2);
  assert.equal((await main(['--out', dir, '--allowlist', join(dir, 'a.json')], { log: (s) => logs.push(s), open: () => {} })).code, 2, 'no report yet');
  writeFileSync(join(dir, 'report.html'), '<p>r</p>');
  writeFileSync(join(dir, 'report.json'), JSON.stringify(REPORT));
  let opened = null;
  const r = await main(['--out', dir, '--allowlist', join(dir, 'a.json')], { log: (s) => logs.push(s), open: (u) => { opened = u; } });
  try {
    assert.equal(r.code, 0);
    assert.equal(opened, r.url);
    assert.match(logs.join('\n'), /created on the first submit/);
    assert.equal((await post(r.url, { approve: [item('crop', 'n.3', 'A')] })).status, 200);
    assert.equal(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).allowlist.length, 1);
    assert.ok(!existsSync(join(dir, 'a.json.bak')));
  } finally { await r.close(); }
});

test('R97 answerImpact: entries named by failing findings, per entry, allowlisted findings left out', async () => {
  const { answerImpact } = await import('../core/report-html.mjs');
  const v = (screen, items) => ({ summary: { screen }, items });
  const rows = answerImpact([
    v('s1', [{ normEntries: ['e1', 'e2'] }, { normEntries: ['e1'], allowedBy: 'ok' }]),
    v('s10', [{ normEntries: ['e1'] }]), v('s2', [{ normEntries: [] }, {}]),
  ]);
  assert.deepEqual(rows, [{ entry: 'e1', screens: ['s1', 's10'], findings: 2 }, { entry: 'e2', screens: ['s1'], findings: 1 }]);
});
