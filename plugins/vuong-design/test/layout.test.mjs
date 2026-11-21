import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseCli, main, UsageError, readAllowlist } from '../core/layout.mjs';
import { gate, sampleIndexes, summarize, loadCorpus } from '../core/pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)')
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

// offline stand-in for the Figma families (as in the verify / mutate tests): Georgia is installed on Windows
const available = ['Inter', 'Georgia'];
const fm = { available, substitute: (f) => (available.includes(String(f).trim().replace(/^["']|["']$/g, '')) ? f : 'Georgia') };

let browser;
before(async () => { if (!skip) { const { launchBrowser } = await import('../core/browser.mjs'); browser = await launchBrowser(); } });
after(async () => { if (browser) await browser.close(); });

const tmp = () => mkdtempSync(join(tmpdir(), 'vd-layout-test-'));
const quiet = () => { const lines = []; return { lines, log: (m) => lines.push(m) }; };

// ---------------- argument parsing ----------------

test('parseCli: plan flags, extras and defaults', () => {
  const o = parseCli(['--html', 'a.html', '--root', '.sc', '--widen', '.ph', '--name', 'h2', '--widen-by', '80', '--viewport', '1200',
    '--tol-frame', '0.75', '--tol-text', '1.5', '--tol-model', '3', '--no-webfonts', '--out', 'o', '--mutate', '--mutate-sample', '2']);
  assert.deepEqual(o, {
    html: 'a.html', root: '.sc', widen: '.ph', nameOf: 'h2', widenBy: 80, viewport: 1200,
    verify: { tolFrame: 0.75, tolText: 1.5, tolModel: 3 }, webFonts: false, out: 'o', allowlist: undefined,
    mutate: true, mutateSample: 2, corpus: undefined, corpusDir: undefined,
  });
  const d = parseCli(['--html', 'a.html', '--root', '.sc', '--out', 'o']);
  assert.deepEqual(d.verify, {});
  assert.equal(d.webFonts, true);
  assert.equal(d.mutate, false);
  assert.equal(d.widenBy, undefined);
  assert.equal(d.mutateSample, undefined);
  assert.equal(parseCli(['--corpus', 'c.json', '--out', 'o'], { VD_CORPUS_DIR: '/x' }).corpusDir, '/x');
  assert.equal(parseCli(['--corpus', 'c.json', '--corpus-dir', '/y', '--out', 'o'], { VD_CORPUS_DIR: '/x' }).corpusDir, '/y');
  assert.deepEqual(parseCli(['-h']), { help: true });
});

test('parseCli: usage errors', () => {
  const bad = [
    [['--root', '.sc', '--out', 'o'], /--html/],
    [['--html', 'a.html', '--out', 'o'], /--root/],
    [['--html', 'a.html', '--root', '.sc'], /--out/],
    [['--html', 'a.html', '--root', '.sc', '--out', 'o', '--tol-frame', 'x'], /--tol-frame/],
    [['--html', 'a.html', '--root', '.sc', '--out', 'o', '--tol-text', '-1'], /--tol-text/],
    [['--html', 'a.html', '--root', '.sc', '--out', 'o', '--widen-by', '0'], /--widen-by/],
    [['--html', 'a.html', '--root', '.sc', '--out', 'o', '--mutate', '--mutate-sample', '1.5'], /--mutate-sample/],
    [['--html', 'a.html', '--root', '.sc', '--out', 'o', '--mutate-sample', '2'], /needs --mutate/],
    [['--html', 'a.html', '--root', '.sc', '--out', 'o', '--bogus'], /bogus/],
    [['--html', 'a.html', '--corpus', 'c.json', '--out', 'o'], /either/],
    [['--corpus', 'c.json', '--root', '.x', '--out', 'o'], /corpus file/],
  ];
  for (const [argv, re] of bad) assert.throws(() => parseCli(argv, {}), (e) => e instanceof UsageError && re.test(e.message), argv.join(' '));
  assert.throws(() => parseCli(['--corpus', 'c.json', '--out', 'o'], {}), /VD_CORPUS_DIR/);
});

test('main: usage error and missing file exit 2 without a browser', async () => {
  const q = quiet();
  assert.equal(await main(['--html', 'a.html', '--out', 'o'], { log: q.log }), 2);
  assert.match(q.lines.join('\n'), /--root/);
  const q2 = quiet();
  assert.equal(await main(['--html', join(FIX, 'nope.html'), '--root', '.scr', '--out', tmp()], { log: q2.log }), 2);
  assert.match(q2.lines.join('\n'), /not found/);
  assert.equal(await main(['--help'], { log: () => {} }), 0);
});

// ---------------- gate / allowlist ----------------

const fakeReport = (over = {}) => ({
  id: 's0', checked: 3, total: 3, unchecked: [], uncheckedReasons: {}, skipped: [], data: [], flags: [],
  roots: [{ id: 'n.1', width: 'A', delta: [1, 0, 0, 0], why: ['x'] }, { id: 'n.2', width: 'A', delta: [1, 0, 0, 0], why: ['x'], explainedBy: 'shrink' }],
  needsApproval: [{ id: 'n.3', width: 'B', delta: [0, 0, 3, 0], magnitude: 3, explainedBy: 'figmaModel' }],
  crop: [{ id: 'n.4', width: 'A', ratio: 0.2, diff: 10, peak: 5 }],
  ...over,
});
const entry = (where, kind, node, width, approved) => ({ ...where, node, width, kind, reason: 'test', approved });

test('gate: only approved allowlist entries are honoured, and only for roots, approvals and crops', () => {
  const where = { file: 'f.html', screen: 's0' };
  const r = fakeReport();
  assert.equal(gate(r, [], where).pass, false);
  const all = (approved) => [entry(where, 'root', 'n.1', 'A', approved), entry(where, 'approval', 'n.3', 'B', approved), entry(where, 'crop', 'n.4', 'A', approved)];
  const g0 = gate(r, all(false), where);
  assert.equal(g0.pass, false);
  assert.equal(g0.open.roots.length + g0.open.approvals.length + g0.open.crops.length, 3);
  for (const bad of [undefined, 'true', 1]) assert.equal(gate(r, all(bad), where).pass, false, String(bad));
  const g1 = gate(r, all(true), where);
  assert.equal(g1.pass, true);
  assert.deepEqual(g1.allowed.roots.map((x) => [x.id, x.allowedBy]), [['n.1', 'test']]);
  assert.equal(g1.allowed.approvals.length, 1);
  assert.equal(g1.allowed.crops.length, 1);
  // the entry must match file, screen, node, width and kind
  for (const [k, v] of [['file', 'g.html'], ['screen', 's1'], ['node', 'n.9'], ['width', 'B'], ['kind', 'crop']]) {
    const list = all(true); list[0] = { ...list[0], [k]: v };
    assert.equal(gate(r, list, where).pass, false, k);
  }
  // unchecked nodes, skipped layers and data findings can never be allowlisted
  for (const over of [{ unchecked: ['n.5'] }, { skipped: ['crop'] }, { data: [{ id: 'n.4', kind: 'text', expected: 'a', actual: 'b' }] }]) {
    assert.equal(gate(fakeReport(over), all(true), where).pass, false, JSON.stringify(over));
  }
});

test('R46: an unsupported-paint finding cannot be allowlisted', () => {
  const where = { file: 'f.html', screen: 's0' };
  const r = fakeReport({ roots: [], needsApproval: [], crop: [], data: [{ id: 'n', kind: 'unsupported', prop: 'text-shadow', value: 'rgb(229, 57, 53) 3px 3px 0px' }] });
  const tries = [[], ['unsupported', 'data', 'root', 'crop', 'approval'].map((k) => entry(where, k, 'n', 'A', true)), ['A', 'B'].map((w) => entry(where, 'unsupported', 'n', w, true))];
  for (const list of tries) assert.equal(gate(r, list, where).pass, false, JSON.stringify(list));
});

test('summarize: counts after the gate, specBytes and payloadOver50k', () => {
  const where = { file: 'f.html', screen: 's0' };
  const r = fakeReport();
  const g = gate(r, [entry(where, 'crop', 'n.4', 'A', true)], where);
  const small = summarize('f.html', { report: r, modelled: { spec: { id: 'n' } } }, g);
  assert.equal(small.unexplainedRoots, 1);
  assert.equal(small.explainedRoots, 1);
  assert.equal(small.needsApproval, 1);
  assert.equal(small.approvalMax, 3);
  assert.equal(small.crop, 0);
  assert.equal(small.allowed, 1);
  assert.equal(small.specBytes, JSON.stringify({ id: 'n' }).length);
  assert.equal(small.payloadOver50k, false);
  assert.equal(small.pass, false);
  const big = summarize('f.html', { report: r, modelled: { spec: { id: 'n', pad: 'x'.repeat(50001) } } }, g);
  assert.ok(big.specBytes > 50000);
  assert.equal(big.payloadOver50k, true);
});

test('sampleIndexes spreads n of N evenly; readAllowlist accepts an array or { allowlist }', () => {
  assert.deepEqual(sampleIndexes(10, 3), [0, 3, 6]);
  assert.deepEqual(sampleIndexes(4, undefined), [0, 1, 2, 3]);
  assert.deepEqual(sampleIndexes(4, 9), [0, 1, 2, 3]);
  const d = tmp();
  writeFileSync(join(d, 'a.json'), JSON.stringify([{ kind: 'root' }]));
  writeFileSync(join(d, 'b.json'), JSON.stringify({ allowlist: [{ kind: 'crop' }] }));
  writeFileSync(join(d, 'c.json'), JSON.stringify({ nope: 1 }));
  assert.deepEqual(readAllowlist(join(d, 'a.json')), [{ kind: 'root' }]);
  assert.deepEqual(readAllowlist(join(d, 'b.json')), [{ kind: 'crop' }]);
  assert.throws(() => readAllowlist(join(d, 'c.json')), UsageError);
  rmSync(d, { recursive: true, force: true });
});

test('corpus.json: the 5 acceptance files with their roots, empty allowlist', () => {
  const c = loadCorpus(join(HERE, 'corpus.json'), '/corpus');
  assert.deepEqual(c.files.map((f) => [f.file, f.root, f.widen ?? null]), [
    ['planora-ui-screens.html', '.cell .sc', '.ph'],
    ['2026-11-05-ui-redesign-entry-mockup.html', '.ph', null],
    ['calendar-layout.html', '.mockup', null],
    ['calendar-layout-v2.html', '.ph', null],
    ['calendar-layout-v3.html', '.ph', null],
  ]);
  assert.deepEqual(c.allowlist, []);
});

// ---------------- end to end (browser) ----------------

test('CLI: a passing fixture exits 0 and writes ir.json, spec-<id>.json, report.json, report.html', { skip }, async () => {
  const out = tmp();
  const code = await main(['--html', join(FIX, 'capture-basic.html'), '--root', '.scr', '--no-webfonts', '--out', out], { fontMap: fm, browser, log: () => {} });
  assert.equal(code, 0);
  const ir = JSON.parse(readFileSync(join(out, 'ir.json'), 'utf8'));
  assert.equal(ir.screens.length, 1);
  assert.equal(ir.screens[0].png, undefined);
  assert.ok(ir.screens[0].tree);
  const spec = readFileSync(join(out, 'spec-s0.json'));
  assert.equal(JSON.parse(spec).model, 'figma');
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(rep.pass, true);
  assert.equal(rep.screens[0].summary.specBytes, spec.length);
  assert.equal(rep.screens[0].summary.payloadOver50k, false);
  const html = readFileSync(join(out, 'report.html'), 'utf8');
  assert.match(html, /Normalisation/);
  assert.doesNotMatch(html, /(src|href)="https?:/);
  rmSync(out, { recursive: true, force: true });
});

test('CLI: a crop fail exits 1; an approved allowlist entry lets it pass, an unapproved one does not', { skip }, async () => {
  const run = async (allow) => {
    const out = tmp(), args = ['--html', join(FIX, 'layout-crop.html'), '--root', '.scr', '--no-webfonts', '--out', out];
    if (allow) { writeFileSync(join(out, 'allow.json'), JSON.stringify(allow)); args.push('--allowlist', join(out, 'allow.json')); }
    const code = await main(args, { fontMap: fm, browser, log: () => {} });
    const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    const html = readFileSync(join(out, 'report.html'), 'utf8');
    rmSync(out, { recursive: true, force: true });
    return { code, rep, html };
  };
  const a = await run(null);
  assert.equal(a.code, 1);
  assert.deepEqual(a.rep.screens[0].gate.open.crops.map((c) => [c.id, c.width]), [['n.0', 'A'], ['n.0', 'B']]);
  assert.equal((a.html.match(/<div class="item"[^>]*data-kind="crop"/g) || []).length, 2);
  const where = { file: 'layout-crop.html', screen: 's0' };
  const list = (approved) => ['A', 'B'].map((w) => entry(where, 'crop', 'n.0', w, approved));
  assert.equal((await run(list(false))).code, 1);
  const c = await run(list(true));
  assert.equal(c.code, 0);
  assert.equal(c.rep.screens[0].summary.allowed, 2);
  assert.match(c.html, /allowlisted: test/);
});

test('R46: a text-shadow on a large text fails the screen end to end (unsupported, not allowlistable)', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const screen = (await captureScreens(join(FIX, 'layout-unsupported.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  const e = await runScreen(browser, screen, inferScreen(screen), fm, { proxy: { webFonts: false } });
  const un = e.report.data.filter((d) => d.kind === 'unsupported').map((d) => d.prop).sort();
  assert.deepEqual(un, ['list-marker', 'mix-blend-mode', 'text-shadow']);
  assert.equal(e.report.pass, false);
  const where = { file: 'layout-unsupported.html', screen: screen.id };
  const every = e.report.data.flatMap((d) => ['A', 'B'].flatMap((w) => ['root', 'crop', 'approval', 'unsupported'].map((k) => entry(where, k, d.id, w, true))));
  assert.equal(gate(e.report, every, where).pass, false);
});

test('CLI: a selector that matches nothing exits 2', { skip }, async () => {
  const q = quiet();
  assert.equal(await main(['--html', join(FIX, 'capture-basic.html'), '--root', '.nothing', '--no-webfonts', '--out', tmp()], { fontMap: fm, browser, log: q.log }), 2);
  assert.match(q.lines.join('\n'), /error/);
});

test('report.html: an unexplained root gets source and layout-proxy crops side by side, as PNG data URIs', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const { screenView, renderReportHtml } = await import('../core/report-html.mjs');
  const screen = (await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  const inferred = inferScreen(screen);
  // plant a known layout error (a wrong left padding on the first row) in the inferred spec
  const row = inferred.spec.kids.find((k) => k.lay && k.lay.d === 'H' && k.kids && k.kids.length === 3);
  assert.ok(row, 'row of three items');
  row.lay = { ...row.lay, p: [row.lay.p[0], row.lay.p[1], row.lay.p[2], row.lay.p[3] + 6] };
  const e = { screen, inferred, ...(await runScreen(browser, screen, inferred, fm, { proxy: { webFonts: false } })) };
  const where = { file: 'capture-basic.html', screen: screen.id };
  const g = gate(e.report, [], where);
  assert.ok(g.open.roots.length > 0, JSON.stringify(e.report.roots));
  const view = await screenView(browser, where.file, e, g, summarize(where.file, e, g));
  const html = renderReportHtml({ generated: 'test', screens: [view] });
  const items = html.split('<div class="item"').slice(1).filter((s) => s.startsWith(' data-kind="root"')).map((s) => s.split('</details>')[0]);
  assert.equal(items.length, g.open.roots.length);
  for (const it of items) {
    const imgs = [...it.matchAll(/<img src="data:image\/png;base64,([^"]+)"/g)].map((m) => Buffer.from(m[1], 'base64'));
    assert.equal(imgs.length, 2);
    for (const b of imgs) assert.equal(b.subarray(1, 4).toString(), 'PNG');
    assert.match(it, /source \(A|source \(B/);
    assert.match(it, /layout proxy/);
    assert.match(it, /layout delta dx/);
  }
});
