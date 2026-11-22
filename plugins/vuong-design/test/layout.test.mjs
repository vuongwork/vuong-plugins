import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseCli, main, UsageError, readAllowlist } from '../core/layout.mjs';
import { gate, sampleIndexes, summarize, loadCorpus, allowlistEntry } from '../core/pipeline.mjs';

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
// R51: entries carry the finding's magnitude and the node's fingerprint (drafted from the fake report's finding)
const FAKE_TREE = { id: 'n', tag: 'div', cls: 'scr', kids: ['n.1', 'n.2', 'n.3', 'n.4', 'n.5'].map((id) => ({ id, kind: 'frame', tag: 'div', cls: id.replace('.', '-') })) };
const entry = (where, kind, node, width, approved, rep = fakeReport()) => {
  const items = { root: rep.roots, approval: rep.needsApproval, crop: [...rep.crop, ...(rep.cropLinked || [])] }[kind] || [];
  const x = items.find((i) => i.id === node && i.width === width) || { id: node, width, delta: [0, 0, 0, 0], ratio: 0, peak: 0 };
  return { ...allowlistEntry(kind, x, where), kind, reason: 'test', approved };
};

test('gate: only approved allowlist entries are honoured, and only for roots, approvals and crops', () => {
  const where = { file: 'f.html', screen: 's0', tree: FAKE_TREE };
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
  const where = { file: 'f.html', screen: 's0', tree: FAKE_TREE };
  const r = fakeReport({ roots: [], needsApproval: [], crop: [], data: [{ id: 'n', kind: 'unsupported', prop: 'text-shadow', value: 'rgb(229, 57, 53) 3px 3px 0px' }] });
  const tries = [[], ['unsupported', 'data', 'root', 'crop', 'approval'].map((k) => entry(where, k, 'n', 'A', true)), ['A', 'B'].map((w) => entry(where, 'unsupported', 'n', w, true))];
  for (const list of tries) assert.equal(gate(r, list, where).pass, false, JSON.stringify(list));
});

test('R44: a crop linked to a root passes or fails with that root, never with its own entry', () => {
  const where = { file: 'f.html', screen: 's0', tree: FAKE_TREE };
  const r = fakeReport({ needsApproval: [], crop: [], cropLinked: [{ id: 'n.1', width: 'A', ratio: 0.2, diff: 10, peak: 5, root: 'n.1' }] });
  assert.equal(gate(r, [], where).pass, false);
  assert.equal(gate(r, [entry(where, 'crop', 'n.1', 'A', true)], where).pass, false);
  const g = gate(r, [entry(where, 'root', 'n.1', 'A', true)], where);
  assert.equal(g.pass, true);
  assert.deepEqual(g.allowed.cropsLinked.map((c) => c.id), ['n.1']);
});

test('summarize: counts after the gate, specBytes and payloadOver50k', () => {
  const where = { file: 'f.html', screen: 's0', tree: FAKE_TREE };
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
  // R51: report.json carries a draft entry (magnitude + fingerprint, approved false) per open finding
  const drafts = a.rep.screens[0].allowlistDraft;
  assert.deepEqual(drafts.map((d) => [d.file, d.screen, d.kind, d.node, d.width, d.approved, typeof d.ratio, d.fingerprint && d.fingerprint.tag]),
    [['layout-crop.html', 's0', 'crop', 'n.0', 'A', false, 'number', 'img'], ['layout-crop.html', 's0', 'crop', 'n.0', 'B', false, 'number', 'img']]);
  const list = (approved) => drafts.map((d) => ({ ...d, reason: 'test', approved }));
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

test('R48: an inline svg styled by page CSS is drawn as the page drew it; an uncarried inner transform is unsupported', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const screen = (await captureScreens(join(FIX, 'capture-svgcss.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  const e = await runScreen(browser, screen, inferScreen(screen), fm, { proxy: { webFonts: false } });
  const id = (cls) => { const f = (n) => (n.cls === cls ? n : (n.kids || []).map(f).find(Boolean)); return f(screen.tree).id; };
  const ic = id('ic'), ic2 = id('ic2'), plain = id('plain');
  assert.ok(e.report.cropChecked > 0, 'crops ran (the 40x40 icons are under the crop limit)');
  for (const k of [ic, plain]) assert.deepEqual(e.report.crop.filter((c) => c.id === k), [], `${k}: crop matches`);
  const un = e.report.data.filter((d) => d.kind === 'unsupported');
  assert.deepEqual(un.map((d) => [d.id, d.prop]), [[ic2, 'svg rect transform']]);
  assert.equal(e.report.pass, false);
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
    assert.match(it, /source page \((A|B)\)/);
    assert.match(it, /layout proxy/);
    assert.match(it, /Layout delta \(rebuilt layout proxy vs source page\): (moved|narrower|wider|shorter|taller) [^,;]*px/);
    assert.match(it, /at width (A|B) \(\d+(\.\d+)? px\)/);
  }
});

test('R49 (probe-r47): a moved % anchor is a position root on its child even when the child\'s width is off too', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const screen = (await captureScreens(join(FIX, 'infer-percent.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  const inf = inferScreen(screen);
  const find = (s, id) => (s.id === id ? s : (s.kids || []).map((k) => find(k, id)).find(Boolean));
  const anchor = find(inf.spec, 'n.7.g0'), badge = find(inf.spec, 'n.7.0');
  assert.equal(anchor.syn, 'anchor');
  // two planted errors: the anchor 2px right (constraint error) and the badge's right padding 3px larger (its own width is off)
  anchor.abs.x += 2;
  badge.lay = { ...badge.lay, p: badge.lay.p.map((v, i) => (i === 1 ? v + 3 : v)) };
  const { report } = await runScreen(browser, screen, inf, fm, { proxy: { webFonts: false } });
  const r = report.roots.filter((x) => x.id === 'n.7.0' && !x.explainedBy);
  assert.ok(r.length && r.every((x) => x.why.includes('w') && x.why.includes('x')), JSON.stringify(report.roots));
});

test('R50 (probe-paint): radius, font, svg and image errors on large nodes fail the screen; the page itself passes', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const { measureCrops } = await import('../core/verify.mjs');
  const screen = (await captureScreens(join(FIX, 'layout-paint.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  const base = inferScreen(screen);
  const find = (s, pred) => (pred(s) ? s : (s.kids || []).map((k) => find(k, pred)).find(Boolean));
  const plants = {
    baseline: () => null,
    radius0: (sp) => { const n = find(sp, (x) => x.paint && x.paint.radius); n.paint.radius = ['0px', '0px', '0px', '0px']; return [n.id, 'radius']; },
    weight400: (sp) => { const n = find(sp, (x) => x.t === 'T'); n.font.fw = '400'; for (const r of n.runs || []) if (r.s) delete r.s.fw; return [n.id, 'font-style']; },
    size19: (sp) => { const n = find(sp, (x) => x.t === 'T'); n.font.fs = '19px'; return [n.id, 'font-style']; },
    italic: (sp) => { const n = find(sp, (x) => x.t === 'T'); n.font.fst = 'italic'; return [n.id, 'font-style']; },
    underline: (sp) => { const n = find(sp, (x) => x.t === 'T'); n.font.td = 'underline'; return [n.id, 'font-style']; },
    svgColour: (sp) => { const n = find(sp, (x) => x.icon && x.icon.svg); n.icon.svg = n.icon.svg.replace(/#e53935|rgb\(229, 57, 53\)/g, '#1e88e5'); return [n.id, 'svg']; },
    svgShape: (sp) => { const n = find(sp, (x) => x.icon && x.icon.svg); n.icon.svg = n.icon.svg.replace(/<circle[^>]*>(<\/circle>)?/, '<rect x="10" y="10" width="80" height="80" fill="#e53935"></rect>'); return [n.id, 'svg']; },
    imgFit: (sp) => { const n = find(sp, (x) => x.t === 'I'); n.fit = 'fill'; return [n.id, 'image']; },
    imgPos: (sp) => { const n = find(sp, (x) => x.t === 'I'); n.pos = '0px 0px'; return [n.id, 'image']; },
  };
  for (const [name, plant] of Object.entries(plants)) {
    const inf = structuredClone(base);
    const want = plant(inf.spec);
    const e = await runScreen(browser, screen, inf, fm, { proxy: { webFonts: false } });
    if (!want) {
      assert.equal(e.report.pass, true, `${name}: ${JSON.stringify({ data: e.report.data, crop: e.report.crop, roots: e.report.roots })}`);
      // crops now also cover the large leaves (text, svg, image), not only nodes <= 4000 px²
      const ids = new Set((await measureCrops(browser, screen, e.layout)).map((c) => c.id));
      for (const pred of [(x) => x.t === 'T', (x) => x.icon && x.icon.svg, (x) => x.t === 'I']) assert.ok(ids.has(find(base.spec, pred).id), `${name}: crop ids ${[...ids]}`);
      continue;
    }
    assert.equal(e.report.pass, false, name);
    assert.ok(e.report.data.some((d) => d.id === want[0] && d.kind === want[1]), `${name}: ${JSON.stringify(e.report.data)}`);
  }
});

// ---------------- fix round 9: R51 (allowlist entries carry magnitude and fingerprint) ----------------
test('R51: an entry is honoured only when the node fingerprint matches and the finding is no larger than approved', async () => {
  const { allowlistEntry } = await import('../core/pipeline.mjs');
  const tree = { id: 'n', tag: 'div', cls: 'scr', kids: [
    { id: 'n.1', kind: 'text', tag: 'span', cls: 'badge', runs: [{ t: 'Inbox  3' }] },
    { id: 'n.3', kind: 'frame', tag: 'div', cls: 'card' }, { id: 'n.4', kind: 'icon', tag: 'svg', cls: 'ic', icon: { ref: 'star' } }] };
  const where = { file: 'f.html', screen: 's0', tree };
  const r = fakeReport();
  const approve = (rep, w = where) => [...rep.roots.filter((x) => !x.explainedBy).map((x) => allowlistEntry('root', x, w)),
    ...rep.needsApproval.map((x) => allowlistEntry('approval', x, w)), ...rep.crop.map((x) => allowlistEntry('crop', x, w))].map((e) => ({ ...e, reason: 'ok', approved: true }));
  const list = approve(r);
  assert.deepEqual(list[0], { file: 'f.html', screen: 's0', node: 'n.1', width: 'A', kind: 'root', delta: [1, 0, 0, 0], why: ['x'], fingerprint: { tag: 'span', cls: 'badge', text: 'Inbox 3' }, reason: 'ok', approved: true });
  assert.deepEqual(list[2].fingerprint, { tag: 'svg', cls: 'ic', ref: 'star' });
  assert.equal(gate(r, list, where).pass, true);
  // within the slack (0.25 px per delta component, 0.02 crop ratio): still honoured
  const near = fakeReport({ roots: [{ id: 'n.1', width: 'A', delta: [1.2, -0.2, 0, 0], why: ['x'] }], needsApproval: [{ id: 'n.3', width: 'B', delta: [0, 0, 3.25, 0], magnitude: 3.25 }], crop: [{ id: 'n.4', width: 'A', ratio: 0.215, diff: 10, peak: 5 }] });
  assert.equal(gate(near, list, where).pass, true);
  // larger than approved: not honoured (the root also moved on another axis, R49; the approval grew; the crop got worse)
  for (const over of [{ roots: [{ id: 'n.1', width: 'A', delta: [1, 0, 0, 0.5], why: ['x', 'h'] }] }, { roots: [{ id: 'n.1', width: 'A', delta: [1.3, 0, 0, 0], why: ['x'] }] },
    { needsApproval: [{ id: 'n.3', width: 'B', delta: [0, 0, 3.3, 0], magnitude: 3.3 }] }, { crop: [{ id: 'n.4', width: 'A', ratio: 0.23, diff: 10, peak: 5 }] }, { crop: [{ id: 'n.4', width: 'A', ratio: 0.2, diff: 10, peak: 6 }] }]) {
    assert.equal(gate(fakeReport(over), list, where).pass, false, JSON.stringify(over));
  }
  // another node now has that id (text, class or tag changed): not honoured
  for (const change of [(t) => { t.kids[0].runs = [{ t: 'Outbox 3' }]; }, (t) => { t.kids[0].cls = 'pill'; }, (t) => { t.kids[0].tag = 'b'; }, (t) => { t.kids[2].icon = { ref: 'moon' }; }]) {
    const t2 = structuredClone(tree); change(t2);
    assert.equal(gate(r, list, { ...where, tree: t2 }).pass, false, String(change));
  }
  // entries without magnitude or fingerprint, or a gate without the tree, are never honoured
  for (const strip of ['delta', 'fingerprint']) assert.equal(gate(r, list.map((e) => { const c = { ...e }; delete c[strip]; if (strip === 'delta') { delete c.ratio; delete c.peak; } return c; }), where).pass, false, strip);
  assert.equal(gate(r, list, { file: 'f.html', screen: 's0' }).pass, false);
});

test('R51: corpus files are keyed by their path relative to the corpus dir', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ files: [{ file: 'a/x.html', root: '.s' }, { file: ['b', 'x.html'].join(String.fromCharCode(92)), root: '.s' }, { file: 'y.html', root: '.s' }], allowlist: [] }));
  const c = loadCorpus(join(dir, 'c.json'), '/corpus');
  assert.deepEqual(c.files.map((f) => f.file), ['a/x.html', 'b/x.html', 'y.html']);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------- fix round 9: R53 (--mutate: a missed mutation fails the run) ----------------
test('R53: runVerdict fails the run when a mutation was not caught, even if every screen passes', async () => {
  const { runVerdict } = await import('../core/layout.mjs');
  const s = (pass, results) => ({ summary: { pass }, ...(results ? { mutations: { results } } : {}) });
  assert.deepEqual(runVerdict([s(true), s(true, [{ kind: 'gap', caught: true }, { kind: 'swapIcon', caught: null }])]), { pass: true, missed: [] });
  assert.deepEqual(runVerdict([s(true, [{ kind: 'gap', caught: false }]), s(true, [{ kind: 'drift', caught: false }])]), { pass: false, missed: ['gap', 'drift'] });
  assert.deepEqual(runVerdict([s(false)]), { pass: false, missed: [] });
});

test('R53: CLI --mutate with a verifier too loose to catch a planted error exits 1 and says so', { skip }, async () => {
  const out = tmp(), q = quiet();
  const code = await main(['--html', join(FIX, 'mutate-mini.html'), '--root', '.scr', '--no-webfonts', '--out', out, '--mutate',
    '--tol-frame', '100', '--tol-text', '100', '--tol-model', '100'], { fontMap: fm, browser, log: q.log });
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  const html = readFileSync(join(out, 'report.html'), 'utf8');
  rmSync(out, { recursive: true, force: true });
  const missed = rep.screens[0].mutations.results.filter((r) => r.caught === false).map((r) => r.kind);
  assert.ok(missed.length > 0, JSON.stringify(rep.screens[0].mutations.results));
  assert.equal(code, 1);
  assert.match(q.lines.join('\n'), /mutation check missed/);
  assert.match(html, /the mutation check missed/);
});

test('R54: an svg with a <use> and its own shapes is drawn whole by the proxy and verifies end to end', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const screen = (await captureScreens(join(FIX, 'capture-sprite-mixed.html'), { root: '.scr', fontMap: fm, webFonts: false, png: true })).screens[0];
  const e = await runScreen(browser, screen, inferScreen(screen), fm, { proxy: { webFonts: false } });
  assert.equal(e.report.pass, true, JSON.stringify({ data: e.report.data, crop: e.report.crop, roots: e.report.roots }));
  const mixed = (function f(n) { return n.cls === 'mixed' ? n : (n.kids || []).map(f).find(Boolean); })(screen.tree);
  assert.equal(e.proxy.A.dom[mixed.id].icon, 'svg');
});

test('M3: a corpus without files is a usage error (exit 2)', async () => {
  const dir = tmp(), q = quiet();
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ files: [], allowlist: [] }));
  assert.equal(await main(['--corpus', join(dir, 'c.json'), '--corpus-dir', dir, '--out', join(dir, 'o')], { log: q.log }), 2);
  assert.match(q.lines.join('\n'), /no files/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------- fix round 10: R56 (allowlist entries are honoured only for the same kind of finding) ----------------
test('R56: an entry covers only its axes (why), the same direction of every delta component, and the same container', () => {
  // probe-r51: an end-aligned card shrank 10px (approved, why w)
  const tree = { id: 'n', tag: 'div', cls: 'root', kids: [{ id: 'n.0', tag: 'div', cls: 'card', kids: [] }, { id: 'n.1', tag: 'div', cls: 'card', kids: [] }] };
  const where = { file: 'a.html', screen: 's1', tree };
  const rep = (roots) => ({ roots, needsApproval: [], crop: [], cropLinked: [], unchecked: [], skipped: [], data: [] });
  const approved = { id: 'n.0', width: 'A', delta: [10, 0, -10, 0], why: ['w'] };
  const e = { ...allowlistEntry('root', approved, where), reason: 'ok', approved: true };
  assert.deepEqual(e.why, ['w']);
  assert.equal(gate(rep([approved]), [e], where).pass, true);
  // the same magnitudes with the position sign flipped: a new axis (x) the entry does not cover
  let g = gate(rep([{ id: 'n.0', width: 'A', delta: [-10, 0, -10, 0], why: ['w', 'x'] }]), [e], where);
  assert.deepEqual([g.open.roots.length, g.allowed.roots.length], [1, 0]);
  // grows instead of shrinking (same axis, same magnitudes, opposite signs)
  g = gate(rep([{ id: 'n.0', width: 'A', delta: [-10, 0, 10, 0], why: ['w'] }]), [e], where);
  assert.deepEqual([g.open.roots.length, g.allowed.roots.length], [1, 0]);
  // a component within the slack may have either sign
  assert.equal(gate(rep([{ id: 'n.0', width: 'A', delta: [10, -0.2, -10, 0.25], why: ['w'] }]), [e], where).pass, true);
  // an entry without why covers no axis
  const noWhy = { ...e }; delete noWhy.why;
  assert.equal(gate(rep([approved]), [noWhy], where).pass, false);
  // another container with the same tag and class now has that id (n.0 removed, n.1 shifted in): not honoured
  const tree2 = { id: 'n', tag: 'div', cls: 'root', kids: [{ id: 'n.0', tag: 'div', cls: 'card', kids: [] }] };
  g = gate(rep([approved]), [e], { ...where, tree: tree2 });
  assert.equal(g.allowed.roots.length, 0);
  // a container's fingerprint also holds its child count and the hash of its first text descendant
  const box = (txt, n = 1) => ({ id: 'n', tag: 'div', cls: 'root', kids: [{ id: 'n.0', tag: 'div', cls: 'card', kids: [...Array(n)].map((_, i) => ({ id: `n.0.${i}`, kind: 'text', tag: 'p', runs: [{ t: i ? 'x' : txt }] })) }, { id: 'n.1', tag: 'div', cls: 'card' }] });
  const w3 = { ...where, tree: box('Milk') }, e3 = { ...allowlistEntry('root', approved, w3), reason: 'ok', approved: true };
  assert.equal(gate(rep([approved]), [e3], w3).pass, true);
  assert.equal(gate(rep([approved]), [e3], { ...where, tree: box('Eggs') }).pass, false);
  assert.equal(gate(rep([approved]), [e3], { ...where, tree: box('Milk', 2) }).pass, false);
  // approvals: why and signs are checked the same way
  const ap = { id: 'n.0', width: 'B', delta: [0, 3, 0, 0], why: ['y'], magnitude: 3, explainedBy: 'figmaModel' };
  const ea = { ...allowlistEntry('approval', ap, where), reason: 'ok', approved: true };
  const repA = (a) => ({ ...rep([]), needsApproval: [a] });
  assert.equal(gate(repA(ap), [ea], where).pass, true);
  assert.equal(gate(repA({ ...ap, delta: [0, -3, 0, 0] }), [ea], where).pass, false);
  assert.equal(gate(repA({ ...ap, delta: [0, 3, 0, 1], why: ['y', 'h'] }), [ea], where).pass, false);
});

test('R56 (M-d): an approved entry with an empty reason is shown as allowed by "approved"', () => {
  const tree = { id: 'n', tag: 'div', cls: 's', kids: [{ id: 'n.1', tag: 'span', cls: 'badge', runs: [{ t: 'New' }] }] };
  const where = { file: 'f.html', screen: 's0', tree };
  const f = { id: 'n.1', width: 'B', delta: [-0.61, 0, 0, 0], why: ['x'] };
  const e = { ...allowlistEntry('root', f, where), approved: true };
  const g = gate({ roots: [f], needsApproval: [], crop: [], cropLinked: [], unchecked: [], skipped: [], data: [] }, [e], where);
  assert.equal(g.pass, true);
  assert.equal(g.allowed.roots[0].allowedBy, 'approved');
});

// ---------------- fix round 10: minors ----------------
test('M-b (probe-paint2): a run colour or run font family planted in the spec is a data finding; the page passes', { skip }, async () => {
  const { captureScreens } = await import('../core/capture.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const { runScreen } = await import('../core/pipeline.mjs');
  const { defaultFontMap } = await import('../core/font-map.mjs');
  const fm2 = defaultFontMap(['Georgia', 'Courier New']);
  const screen = (await captureScreens(join(FIX, 'layout-runs.html'), { root: '.scr', fontMap: fm2, webFonts: false, png: true })).screens[0];
  const base = inferScreen(screen);
  const find = (s, pred) => (pred(s) ? s : (s.kids || []).map((k) => find(k, pred)).find(Boolean));
  const para = (n) => n.t === 'T' && (n.runs || []).length > 2;
  const plants = {
    baseline: () => null,
    runColour: (sp) => { const n = find(sp, para); n.runs.find((r) => r.s && r.s.c).s.c = 'rgb(34, 34, 34)'; return [n.id, 'color']; },
    runColourNear: (sp) => { const n = find(sp, para); n.runs.find((r) => r.s && r.s.c).s.c = 'rgb(140, 40, 40)'; return [n.id, 'color']; },
    runFamily: (sp) => { const n = find(sp, para); delete n.runs.find((r) => r.s && r.s.ff).s.ff; return [n.id, 'font-family']; },
  };
  for (const [name, plant] of Object.entries(plants)) {
    const inf = structuredClone(base);
    const want = plant(inf.spec);
    const e = await runScreen(browser, screen, inf, fm2, { proxy: { webFonts: false } });
    if (!want) { assert.equal(e.report.pass, true, `${name}: ${JSON.stringify({ data: e.report.data, crop: e.report.crop, roots: e.report.roots })}`); continue; }
    assert.ok(e.report.data.some((d) => d.id === want[0] && d.kind === 'font-style' && d.prop === want[1]), `${name}: ${JSON.stringify(e.report.data)}`);
  }
});
