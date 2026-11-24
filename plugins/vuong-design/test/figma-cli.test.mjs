import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main, localScreen, resultHash, RUNTIME_VERSION } from '../core/figma.mjs';
import { compactIds, jsLiteral } from '../core/figma-encode.mjs';
import { ordOf, rescalePng } from '../core/figma-check.mjs';
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)')
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';
const available = ['Inter', 'Georgia'];
const fm = { available, substitute: (f) => (available.includes(String(f).trim().replace(/^["']|["']$/g, '')) ? f : 'Georgia') };

const tmp = () => mkdtempSync(join(tmpdir(), 'vd-figma-cli-'));
const quiet = () => { const lines = []; return { lines, log: (m) => lines.push(m) }; };
const readJson = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const AF = (async () => {}).constructor;
const runCode = (code, fig) => new AF('figma', code)(fig);

// ---------------- a hand-built ds folder: 2 screens, one colour token ----------------
const text = (id, t) => ({
  id, t: 'T', w: 60, h: 16, sz: ['HUG', 'HUG'],
  font: { ff: 'Inter', fs: '12px', fw: '400', fst: 'normal', lh: 16, ls: 'normal', c: 'rgb(0, 0, 0)', ta: 'start', td: 'none', tt: 'none' }, runs: [{ t }],
});
const screenSpec = (t) => ({
  id: 'n', t: 'F', w: 300, h: 200, sz: ['FIXED', 'FIXED'], paint: { bg: 'rgb(255, 255, 255)' },
  lay: { d: 'V', p: [8, 8, 8, 8], g: 4, pa: 'S', ca: 'S' },
  kids: [{ id: 'n.0', t: 'F', w: 284, h: 30, sz: ['FILL', 'HUG'], paint: { bg: 'rgb(238, 238, 238)', radius: ['4px', '4px', '4px', '4px'] }, lay: { d: 'H', p: [7, 7, 7, 7], g: 0, pa: 'S', ca: 'S' }, kids: [text('n.0.0', t)] }],
  model: 'figma',
});
function handDs() {
  const d = tmp(), ds = join(d, 'ds');
  mkdirSync(ds);
  writeFileSync(join(ds, 'ir.json'), JSON.stringify({ file: 'hand.html', root: '.scr', widen: null, screens: [{ id: 's0', W: [300, 420], svgDefs: {} }, { id: 's1', W: [300, 420], svgDefs: {} }] }));
  writeFileSync(join(ds, 'spec-norm-s0.json'), JSON.stringify(screenSpec('Hello')));
  writeFileSync(join(ds, 'spec-norm-s1.json'), JSON.stringify(screenSpec('World')));
  writeFileSync(join(ds, 'tokens.json'), JSON.stringify({ primitive: { color: { c01: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' } } } } }));
  writeFileSync(join(ds, 'token-map.json'), JSON.stringify({ s0: { n: { bg: 'primitive.color.c01' } }, s1: { n: { bg: 'primitive.color.c01' } } }));
  return { d, ds, out: join(d, 'out'), F: join(d, 'out', 'figma') };
}
// sends every batch of the plan to one fake Figma, writes result-<key> files next to out; returns { key: result }
async function sendAll(F, fig = makeFakeFigma({ fonts: DEFAULT_FONTS })) {
  const st = readJson(F, 'state.json'), out = {};
  for (const k of st.order) out[k] = await runCode(readFileSync(join(F, st.batches[k].file), 'utf8'), fig);
  return out;
}
const rehash = (r) => { r.h = resultHash(r); return r; }; // after a test edits a result
const save = (dir, name, x) => { const p = join(dir, name); writeFileSync(p, typeof x === 'string' ? x : JSON.stringify(x)); return p; };

// ---------------- plan / ingest (no browser) ----------------

test('plan on a two-screen ds folder: batches under 50 000 bytes, both screens pending, the estimate counts the calls', async () => {
  const h = handDs(), q = quiet();
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out], { log: q.log }), 0);
  for (const f of ['vars-01.js', 'batch-01.js', 'batch-01.data.json', 'state.json']) assert.ok(existsSync(join(h.F, f)), f);
  assert.ok(Buffer.byteLength(readFileSync(join(h.F, 'batch-01.js'), 'utf8')) <= 50000);
  const st = readJson(h.F, 'state.json');
  assert.deepEqual(st.order, ['vars-01', 'runtime', 'batch-01']);
  assert.ok(existsSync(join(h.F, 'runtime.js')));
  assert.equal(st.runtime, RUNTIME_VERSION);
  assert.deepEqual(Object.entries(st.screens).map(([s, x]) => [s, x.status, x.batch]), [['s0', 'pending', 'batch-01'], ['s1', 'pending', 'batch-01']]);
  assert.deepEqual(st.batches['batch-01'].screens, ['s0', 's1']);
  assert.equal(st.page, 'Screens');
  assert.deepEqual(st.run.calls, { useFigma: 3, screenshot: 2, total: 5 });
  assert.deepEqual(st.run.send, ['vars-01', 'runtime', 'batch-01']);
  assert.ok(q.lines.some((l) => /^estimate: 3 use_figma calls \(1 vars \+ 1 runtime \+ 1 screen batches\), 2 get_screenshot calls, [\d.]+ KB to send$/.test(l)), q.lines.join('\n'));
  // the data file is the D inside the code (compact: ids derivable from the parent left out, a JS literal)
  const D = readJson(h.F, 'batch-01.data.json');
  const code = readFileSync(join(h.F, 'batch-01.js'), 'utf8');
  assert.ok(code.startsWith(`const D=${jsLiteral(compactIds(D))};\n`));
  assert.ok(!code.includes("o:'n.0'") && !code.includes('"o"'), 'n.0 is derivable: not written');
  assert.equal(D.force, undefined);
  rmSync(h.d, { recursive: true, force: true });
});

test('resume: an ingested batch is kept on the next plan (not written again) unless --redo', async () => {
  const h = handDs(), q = quiet();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const res = await sendAll(h.F);
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'r1.json', res['batch-01'])], { log: q.log }), 0);
  let st = readJson(h.F, 'state.json');
  assert.equal(st.batches['batch-01'].status, 'done');
  assert.equal(st.screens.s0.status, 'done');
  assert.ok(existsSync(join(h.F, 'result-batch-01.json')));
  const mtime = statSync(join(h.F, 'batch-01.js')).mtimeMs;
  await new Promise((r) => setTimeout(r, 30));
  const q2 = quiet();
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out], { log: q2.log }), 0);
  st = readJson(h.F, 'state.json');
  assert.equal(st.batches['batch-01'].status, 'done');
  assert.equal(st.screens.s0.status, 'done', 'screen state kept');
  assert.equal(statSync(join(h.F, 'batch-01.js')).mtimeMs, mtime, 'batch-01.js not written again');
  assert.deepEqual(st.run.send, ['vars-01', 'runtime']);
  assert.ok(q2.lines.some((l) => /1 already done \(kept\)/.test(l)), q2.lines.join('\n'));
  assert.ok(q2.lines.some((l) => /^estimate: 2 use_figma calls \(1 vars \+ 1 runtime \+ 0 screen batches\), 0 get_screenshot calls/.test(l)), q2.lines.join('\n'));
  assert.ok(q2.lines.some((l) => l === 'screens unchanged since they were built (not sent again): s0, s1'), q2.lines.join('\n'));
  // --redo: everything pending again
  await main(['plan', '--ds', h.ds, '--out', h.out, '--redo'], { log: () => {} });
  st = readJson(h.F, 'state.json');
  assert.equal(st.batches['batch-01'].status, 'pending');
  assert.equal(st.screens.s0.status, 'pending');
  rmSync(h.d, { recursive: true, force: true });
});

test('ingest: malformed JSON or a wrong shape exits 2 and leaves state.json as it was', async () => {
  const h = handDs();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const before = readFileSync(join(h.F, 'state.json'), 'utf8');
  const q = quiet();
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'bad.json', '{"batch": 1, "screens": [')], { log: q.log }), 2);
  assert.match(q.lines.join('\n'), /not valid JSON/);
  const res = (await sendAll(h.F))['batch-01'];
  const wrong = JSON.parse(JSON.stringify(res));
  wrong.screens[0].nodes.pop();
  const q2 = quiet();
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'wrong.json', wrong)], { log: q2.log }), 2);
  assert.match(q2.lines.join('\n'), /nodes has \d+ entries, the encoding has \d+/);
  const q3 = quiet();
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'one.json', { ...res, screens: [res.screens[0]] })], { log: q3.log }), 2);
  assert.match(q3.lines.join('\n'), /screen s1 of batch-01\.js is missing/);
  assert.equal(readFileSync(join(h.F, 'state.json'), 'utf8'), before);
  assert.equal(existsSync(join(h.F, 'result-batch-01.json')), false);
  rmSync(h.d, { recursive: true, force: true });
});

test('ingest: a vars batch with errors fails; an edited screen is skippedEdited; extra frames are recorded', async () => {
  const h = handDs();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const res = await sendAll(h.F);
  const v = { ...res['vars-01'], errors: [{ kind: 'variable', name: 'color/c01', msg: 'boom' }] };
  const q = quiet();
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'v.json', v)], { log: q.log }), 0);
  let st = readJson(h.F, 'state.json');
  assert.equal(st.batches['vars-01'].status, 'failed');
  assert.deepEqual(st.batches['vars-01'].errors, v.errors);
  assert.match(q.lines.join('\n'), /vars-01: failed \(1 errors: variable color\/c01: boom\)/);
  // F3: only the fields present are printed
  const q0 = quiet();
  await main(['ingest', '--out', h.out, '--result', save(h.d, 'v0.json', { ...res['vars-01'], errors: [{ msg: 'only a message' }] })], { log: q0.log });
  assert.match(q0.lines.join('\n'), /vars-01: failed \(1 errors: only a message\)/);
  const b = JSON.parse(JSON.stringify(res['batch-01']));
  b.screens[1] = { screen: 's1', root: '1:99', edited: true, sig: 'abcd1234', extra: ['1:120'] };
  rehash(b);
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'b.json', b), '--batch', '1'], { log: () => {} }), 0);
  st = readJson(h.F, 'state.json');
  assert.equal(st.batches['batch-01'].status, 'done');
  assert.deepEqual([st.screens.s0.status, st.screens.s1.status, st.screens.s1.skippedEdited, st.screens.s1.root, st.screens.s1.extra], ['done', 'skippedEdited', true, '1:99', ['1:120']]);
  // a screen whose root failed fails the batch
  const f = JSON.parse(JSON.stringify(res['batch-01']));
  f.screens[0] = { screen: 's0', fontMissing: [], errors: [{ o: 'n', msg: 'resize failed' }] };
  rehash(f);
  await main(['ingest', '--out', h.out, '--result', save(h.d, 'f.json', f)], { log: () => {} });
  st = readJson(h.F, 'state.json');
  assert.deepEqual([st.batches['batch-01'].status, st.screens.s0.status], ['failed', 'failed']);
  rmSync(h.d, { recursive: true, force: true });
});

test('plan: --max-calls stops at a batch boundary and warns; --force goes into D.force; usage errors exit 2', async () => {
  const h = handDs(), q = quiet();
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out, '--max-calls', '2', '--force', 's1', '--page', 'Màn hình'], { log: q.log }), 0);
  const st = readJson(h.F, 'state.json');
  assert.deepEqual([st.run.send, st.run.stopBefore, st.run.sendCalls], [['vars-01', 'runtime'], 'batch-01', 2]);
  assert.ok(q.lines.some((l) => /stops before batch-01/.test(l)));
  assert.ok(q.lines.some((l) => /^warning: the plan needs 5 calls, over --max-calls 2/.test(l)), q.lines.join('\n'));
  const D = readJson(h.F, 'batch-01.data.json');
  assert.deepEqual([D.force, D.page], [['s1'], 'Màn hình']);
  const e = async (argv) => { const x = quiet(); const c = await main(argv, { log: x.log }); return [c, x.lines.join('\n')]; };
  assert.deepEqual((await e(['plan', '--out', h.out]))[0], 2);
  assert.match((await e(['plan', '--ds', h.ds, '--out', h.out, '--force', 'nope']))[1], /--force nope: no such screen/);
  assert.equal((await e(['frobnicate']))[0], 2);
  assert.match((await e(['plan', '--ds', h.d, '--out', h.out]))[1], /no ir\.json/);
  assert.match((await e(['ingest', '--out', join(h.d, 'none'), '--result', 'x.json']))[1], /state\.json/);
  rmSync(h.d, { recursive: true, force: true });
});

test('runtime installed once; a batch checks its version and data hash; ingest checks the result hash; only a changed screen is sent again', async () => {
  const h = handDs(), fig = makeFakeFigma({ fonts: DEFAULT_FONTS });
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const code = (k) => readFileSync(join(h.F, `${k}.js`), 'utf8');
  const e = async (argv) => { const x = quiet(); const c = await main(argv, { log: x.log }); return [c, x.lines.join('\n')]; };
  // batch before the runtime: refused, nothing built
  const stale = await runCode(code('batch-01'), fig);
  assert.deepEqual(stale, { batch: 1, stale: RUNTIME_VERSION, have: '' });
  assert.equal(fig.root.children[0].children.length, 0);
  const [c0, m0] = await e(['ingest', '--out', h.out, '--result', save(h.d, 'stale.json', stale)]);
  assert.equal(c0, 2); assert.match(m0, /send runtime\.js/);
  // install; a damaged literal is refused
  const rt = await runCode(code('runtime'), fig);
  assert.equal(rt.runtime, RUNTIME_VERSION);
  assert.equal((await e(['ingest', '--out', h.out, '--result', save(h.d, 'rt.json', rt)]))[0], 0);
  assert.deepEqual(await runCode(code('batch-01').replace("tx:'Hello'", "tx:'Hellp'"), fig), { batch: 1, damaged: 1 });
  // the real batch: the result hash catches a value retyped on the way
  const res = await runCode(code('batch-01'), fig);
  assert.equal(res.h, resultHash(res));
  const bad = JSON.parse(JSON.stringify(res)); bad.screens[0].nodes[0][1][0] += 1;
  const [c1, m1] = await e(['ingest', '--out', h.out, '--result', save(h.d, 'bad.json', bad)]);
  assert.equal(c1, 2); assert.match(m1, /result hash h \w+ does not match its content/);
  assert.equal((await e(['ingest', '--out', h.out, '--result', save(h.d, 'ok.json', res)]))[0], 0);
  // s1 changes: only s1 goes out, in batch-02; s0 stays with batch-01; the runtime is not sent again
  writeFileSync(join(h.ds, 'spec-norm-s1.json'), JSON.stringify(screenSpec('Changed')));
  const [, m2] = await e(['plan', '--ds', h.ds, '--out', h.out]);
  const st = readJson(h.F, 'state.json');
  assert.deepEqual(st.run.send, ['vars-01', 'batch-02']);
  assert.deepEqual(st.batches['batch-02'].screens, ['s1']);
  assert.deepEqual([st.screens.s0.status, st.screens.s0.batch, st.screens.s1.status, st.screens.s1.batch], ['done', 'batch-01', 'pending', 'batch-02']);
  assert.match(m2, /changed since they were sent: s1/);
  assert.match(m2, /not sent again\): s0$/m);
  const r2 = await runCode(code('batch-02'), fig);
  assert.equal((await e(['ingest', '--out', h.out, '--result', save(h.d, 'r2.json', r2)]))[0], 0);
  assert.equal(readJson(h.F, 'state.json').screens.s1.status, 'done');
  assert.equal(fig.root.children.find((p) => p.name === 'Screens').children.length, 2, 'one frame per screen');
  rmSync(h.d, { recursive: true, force: true });
});

// ---------------- check end to end (ds.mjs on a fixture, the batches on the fake, boxes from the local proxy) ----------------

let browser, base;
before(async () => {
  if (skip) return;
  const { launchBrowser } = await import('../core/browser.mjs');
  browser = await launchBrowser();
  base = tmp();
  const { main: ds } = await import('../core/ds.mjs');
  for (const [name, extra] of [['lh', ['--rules', join(FIX, 'rules-lh.json')]], ['plain', []]]) {
    await ds(['--html', join(FIX, 'ds-mini.html'), '--root', '.scr', '--no-webfonts', '--out', join(base, name), ...extra], { fontMap: fm, browser, log: () => {}, cwd: base });
  }
});
after(async () => { if (browser) await browser.close(); if (base) rmSync(base, { recursive: true, force: true }); });

// plan -> batches on the fake (fonts as the page) -> boxes taken from the local proxy of the built spec (the fake does
// no layout) -> ingest; screenshots = that proxy's PNG (opts.fourX: s0 saved at scale 4, which check rescales to 2)
async function figmaFor(dsName, opts = {}) {
  const out = join(mkdtempSync(join(base, `${dsName}-`)), 'out'), ds = join(base, dsName), F = join(out, 'figma');
  assert.equal(await main(['plan', '--ds', ds, '--out', out], { log: () => {} }), 0);
  const { captureScreens } = await import('../core/capture.mjs');
  const st = readJson(F, 'state.json');
  const { screens: cap } = await captureScreens(st.source.html, { root: st.source.root, png: true, fontMap: fm, webFonts: false });
  const entries = readJson(ds, 'normalisation.json').entries;
  const res = await sendAll(F, makeFakeFigma({ fonts: [...DEFAULT_FONTS, 'Georgia|Regular', 'Georgia|Bold'] }));
  const roles = {};
  for (const k of st.order) {
    if (st.batches[k].kind === 'screens') {
      const D = readJson(F, st.batches[k].data);
      for (const s of res[k].screens) {
        const L = await localScreen(browser, cap.find((x) => x.id === s.screen), { id: s.screen, fontMap: fm, webFonts: false, entries });
        const ref = L.normOn ? L.normP : L.modP;
        roles[s.screen] = L.normOn ? 'norm' : 'modelled';
        ordOf(D.screens.find((x) => x.screen === s.screen).T).forEach((o, i) => {
          const t = s.nodes[i], id = o.replace(/#stroke$/, '');
          assert.ok(t && !t[3], `${o}: built as encoded on the fake`);
          const A = ref.A.boxes[id], dB = ref.B.boxes[id].map((v, j) => Math.round((v - A[j]) * 100) / 100);
          s.nodes[i] = dB.some((v) => v) ? [t[0], A, dB] : [t[0], A];
        });
        delete res[k].z; // the entries above are in the plain form
        rehash(res[k]);
        writeFileSync(join(F, `shot-${s.screen}.png`), opts.fourX && s.screen === 's0' ? await rescalePng(browser, ref.A.png, 2) : ref.A.png);
      }
    }
    assert.equal(await main(['ingest', '--out', out, '--result', save(dirname(out), `${k}.json`, res[k])], { log: () => {} }), 0);
  }
  return { out, F, roles, res };
}

test('check: a readback matching the page passes in the norm role (screenshot rescaled from scale 4), and the 4 readback mutations are caught', { skip }, async () => {
  const { out, F, roles } = await figmaFor('lh', { fourX: true });
  assert.deepEqual(roles, { s0: 'norm', s1: 'norm' });
  const q = quiet();
  const code = await main(['check', '--out', out, '--mutate'], { log: q.log, fontMap: fm, browser });
  const rep = readJson(F, 'report.json');
  for (const s of rep.screens) {
    assert.equal(s.summary.pass, true, `${s.summary.screen}: ${JSON.stringify({ u: s.report.unchecked, sk: s.report.skipped, d: s.report.data, r: s.report.roots.filter((r) => !r.explainedBy), a: s.report.needsApproval, c: s.report.crop })}`);
    assert.equal(s.figma.role, 'norm');
    assert.deepEqual(s.report.skipped, ['figma-crop-B', 'figma-effect', 'figma-text-decoration', 'figma-text-transform']);
    assert.ok(s.report.cropChecked > 0 && s.report.cropWidths.join() === 'A', 'crops measured on the screenshot at A');
    assert.deepEqual(s.mutations.results.map((r) => [r.kind, r.caught]), [['figMove', true], ['figText', true], ['figFill', true], ['figDrop', true]]);
    assert.equal(s.figma.proxyVsFigma.A.max, 0);
  }
  assert.deepEqual(rep.screens.map((s) => s.figma.shot.rescaled), [true, false]);
  assert.equal(rep.screens[0].figma.shot.scale, 4);
  assert.equal(rep.screens[1].figma.shot.scale, 2, 'a 2x shot is used as it is; its crops ran (cropChecked above)');
  assert.deepEqual(rep.mutationsMissed, []);
  assert.equal(code, 0, q.lines.join('\n'));
  const html = readFileSync(join(F, 'report.html'), 'utf8');
  assert.match(html, /<h3>Figma<\/h3>/);
  assert.match(html, /Proxy vs Figma \(norm proxy/);
});

test('check: modelled role without norm records; a missing screenshot or a node missing from the readback fails the screen', { skip }, async () => {
  const { out, F, res } = await figmaFor('plain');
  assert.equal(await main(['check', '--out', out], { log: () => {}, fontMap: fm, browser }), 0);
  assert.deepEqual(readJson(F, 'report.json').screens.map((s) => [s.figma.role, s.summary.pass]), [['modelled', true], ['modelled', true]]);
  // s1 without its screenshot; s0 with its text node not read back
  rmSync(join(F, 'shot-s1.png'));
  const b = JSON.parse(JSON.stringify(res['batch-01']));
  const D = readJson(F, 'batch-01.data.json');
  const i = ordOf(D.screens[0].T).indexOf('n.1.0');
  b.screens[0].nodes[i] = 0;
  assert.equal(await main(['ingest', '--out', out, '--result', save(dirname(out), 'b2.json', rehash(b))], { log: () => {} }), 0);
  const q = quiet();
  assert.equal(await main(['check', '--out', out], { log: q.log, fontMap: fm, browser }), 1);
  const [s0, s1] = readJson(F, 'report.json').screens;
  assert.equal(s0.summary.pass, false);
  assert.ok(s0.report.unchecked.includes('n.1.0'), JSON.stringify(s0.report.unchecked));
  assert.match(s0.report.uncheckedReasons['n.1.0'], /no proxy box at A/);
  assert.equal(s1.summary.pass, false);
  assert.ok(s1.report.skipped.includes('crop'), 'crops not checked without the screenshot');
  assert.equal(s1.figma.shot, null);
  assert.ok(q.lines.some((l) => /s1: fail \(no screenshot\)/.test(l)), q.lines.join('\n'));
});

test('ingest: a vars result with malformed errors items exits 2 before anything is written (M2)', async () => {
  const h = handDs();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const before = readFileSync(join(h.F, 'state.json'), 'utf8');
  const res = await sendAll(h.F);
  for (const errors of [['boom'], [{ kind: 'variable', name: 'x' }], [{ msg: 3 }]]) {
    const q = quiet();
    assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'v.json', { ...res['vars-01'], errors })], { log: q.log }), 2);
    assert.match(q.lines.join('\n'), /errors\[0\]: not \{ msg, kind\?, name\? \}/);
  }
  assert.equal(readFileSync(join(h.F, 'state.json'), 'utf8'), before);
  assert.equal(existsSync(join(h.F, 'result-vars-01.json')), false);
  rmSync(h.d, { recursive: true, force: true });
});

test('plan warns when a vars batch failed and screen batches are still scheduled (M6)', async () => {
  const h = handDs();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const res = await sendAll(h.F);
  await main(['ingest', '--out', h.out, '--result', save(h.d, 'v.json', { ...res['vars-01'], errors: [{ kind: 'variable', name: 'color/c01', msg: 'boom' }] })], { log: () => {} });
  const q = quiet();
  assert.equal(await main(['plan', '--ds', h.ds, '--out', h.out], { log: q.log }), 0);
  assert.ok(q.lines.some((l) => /^warning: vars-01 failed when last sent \(1 errors\); screen batches are still scheduled/.test(l)), q.lines.join('\n'));
  // F1: a second plan with no ingest in between still warns
  const q1 = quiet();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: q1.log });
  assert.ok(q1.lines.some((l) => /^warning: vars-01 failed when last sent \(1 errors\)/.test(l)), q1.lines.join('\n'));
  const st = readJson(h.F, 'state.json');
  assert.equal(st.run.warnings.length, 1);
  assert.deepEqual(st.batches['vars-01'].lastFailed, [{ kind: 'variable', name: 'color/c01', msg: 'boom' }]);
  // once vars-01 is done, no warning
  await main(['ingest', '--out', h.out, '--result', save(h.d, 'v2.json', res['vars-01'])], { log: () => {} });
  const q2 = quiet();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: q2.log });
  assert.ok(!q2.lines.some((l) => /failed when last sent/.test(l)), q2.lines.join('\n'));
  rmSync(h.d, { recursive: true, force: true });
});

// T8: get_screenshot caps at a node's native size, so a 300 px frame shoots at 1x. shots.js clones each built frame
// onto the page _vd-shots and rescales the clone 2x; the AI shoots the clones, then shots-clean.js removes them
test('shots: clones of the built frames at 2x on _vd-shots, the Screens page untouched; ingest-shots records them; shots-clean removes them', async () => {
  const h = handDs();
  await main(['plan', '--ds', h.ds, '--out', h.out], { log: () => {} });
  const fig = makeFakeFigma({ fonts: DEFAULT_FONTS });
  const res = await sendAll(h.F, fig);
  assert.equal(await main(['ingest', '--out', h.out, '--result', save(h.d, 'r1.json', res['batch-01'])], { log: () => {} }), 0);
  const screensPage = fig.root.children.find((p) => p.name === 'Screens');
  const snap = () => JSON.stringify(screensPage.children.map((c) => [c.id, c.x, c.y, c.width, c.height, c.getSharedPluginData('vuongdesign', 'sig'), c.children.length]));
  const before = snap();
  const q = quiet();
  assert.equal(await main(['shots', '--out', h.out], { log: q.log }), 0);
  const code = readFileSync(join(h.F, 'shots.js'), 'utf8');
  let r;
  for (let i = 0; i < 2; i++) r = await runCode(code, fig); // a rerun replaces the old clones
  assert.equal(snap(), before, 'the Screens page is not changed');
  const shots = fig.root.children.find((p) => p.name === '_vd-shots');
  assert.equal(r.page, shots.id);
  assert.equal(shots.children.length, 2);
  const st0 = readJson(h.F, 'state.json');
  for (const [i, s] of ['s0', 's1'].entries()) {
    const c = shots.children[i];
    assert.equal(r.clones[s], c.id);
    assert.notEqual(c.id, st0.screens[s].root);
    assert.deepEqual([c.width, c.height], [600, 400], `${s}: rescaled 2x`);
    assert.deepEqual(r.sizes[s], [600, 400]);
    assert.equal(c.children[0].width, 568, 'children scale too');
  }
  assert.deepEqual(shots.children.map((c) => [c.x, c.y]), [[0, 0], [680, 0]], 'in a row');
  // ingest-shots: the clone ids go into state.json, with the get_screenshot size per screen
  const q2 = quiet();
  assert.equal(await main(['ingest-shots', '--out', h.out, '--result', save(h.d, 'shots.json', r)], { log: q2.log }), 0);
  const st = readJson(h.F, 'state.json');
  assert.deepEqual(st.shots.clones, r.clones);
  assert.equal(st.shots.page, r.page);
  assert.ok(q2.lines.some((l) => l.includes(r.clones.s0) && /maxDimension 600/.test(l) && /shot-s0\.png/.test(l)), q2.lines.join('\n'));
  assert.equal(await main(['ingest-shots', '--out', h.out, '--result', save(h.d, 'bad.json', { page: 'x', clones: { s9: '1:2' } })], { log: () => {} }), 2);
  assert.deepEqual(readJson(h.F, 'state.json'), st, 'a bad result leaves the state as it was');
  // shots-clean: the clones and the page go
  assert.equal(await main(['shots-clean', '--out', h.out], { log: () => {} }), 0);
  const c = await runCode(readFileSync(join(h.F, 'shots-clean.js'), 'utf8'), fig);
  assert.deepEqual([c.removed, c.pageRemoved], [2, true]);
  assert.equal(fig.root.children.find((p) => p.name === '_vd-shots'), undefined);
  assert.equal(snap(), before);
  rmSync(h.d, { recursive: true, force: true });
});
