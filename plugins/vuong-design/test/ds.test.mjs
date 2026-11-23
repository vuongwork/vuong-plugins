import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main, designSystem, hasDarkMode, DS_EXT } from '../core/ds.mjs';
import { main as layoutMain, parseCli } from '../core/layout.mjs';
import { readRules } from '../core/rules-file.mjs';
import { tokenMap } from '../core/tokens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const MINI = join(FIX, 'ds-mini.html');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)')
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

// offline stand-in for the Figma families (as in layout.test.mjs)
const available = ['Inter', 'Georgia'];
const fm = { available, substitute: (f) => (available.includes(String(f).trim().replace(/^["']|["']$/g, '')) ? f : 'Georgia') };

let browser;
before(async () => { if (!skip) { const { launchBrowser } = await import('../core/browser.mjs'); browser = await launchBrowser(); } });
after(async () => { if (browser) await browser.close(); });

const tmp = () => mkdtempSync(join(tmpdir(), 'vd-ds-test-'));
const quiet = () => { const lines = []; return { lines, log: (m) => lines.push(m) }; };
const readJson = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

// ---------------- no browser ----------------

test('parseCli with the ds options: --rules and --names are read; layout.mjs alone rejects them', () => {
  const o = parseCli(['--html', 'a.html', '--root', '.s', '--out', 'o', '--rules', 'r.json', '--names', 'n.json'], {}, DS_EXT);
  assert.deepEqual([o.rules, o.names, o.html], ['r.json', 'n.json', 'a.html']);
  assert.throws(() => parseCli(['--html', 'a.html', '--root', '.s', '--out', 'o', '--rules', 'r.json']), /rules/);
});

test('setup: vd-rules.json / vd-names.json in the working directory are the defaults; --rules overrides; a missing --rules file exits 2', async () => {
  const cwd = tmp();
  let s = await DS_EXT.setup({}, { cwd });
  assert.deepEqual([s.rulesPath, s.namesPath, s.rules.answers], [null, null, {}]);
  writeFileSync(join(cwd, 'vd-rules.json'), JSON.stringify({ version: 1, answers: { 'project.lineHeightInt': 'yes' } }));
  writeFileSync(join(cwd, 'vd-names.json'), JSON.stringify({}));
  s = await DS_EXT.setup({}, { cwd });
  assert.deepEqual([s.rulesPath, s.namesPath, s.rules.answers], [join(cwd, 'vd-rules.json'), join(cwd, 'vd-names.json'), { 'project.lineHeightInt': 'yes' }]);
  s = await DS_EXT.setup({ rules: join(FIX, 'rules-accept.json') }, { cwd });
  assert.equal(s.rules.answers['project.srcSquash'], 'accept-all');
  const q = quiet();
  assert.equal(await main(['--html', MINI, '--root', '.scr', '--out', join(cwd, 'o'), '--rules', join(cwd, 'nope.json')], { log: q.log, cwd }), 2);
  assert.match(q.lines.join('\n'), /rules file not found/);
  writeFileSync(join(cwd, 'bad.json'), JSON.stringify({ version: 2, answers: {} }));
  assert.equal(await main(['--html', MINI, '--root', '.scr', '--out', join(cwd, 'o'), '--rules', join(cwd, 'bad.json')], { log: () => {}, cwd }), 2);
  assert.equal(existsSync(join(cwd, 'o')), false); // nothing written on a setup error
  rmSync(cwd, { recursive: true, force: true });
});

test('hasDarkMode: a prefers-color-scheme: dark media query in the page CSS or a local linked stylesheet', () => {
  const d = tmp();
  writeFileSync(join(d, 'a.html'), '<style>@media (prefers-color-scheme: dark){body{background:#000}}</style>');
  writeFileSync(join(d, 'b.html'), '<link rel="stylesheet" href="s.css"><p>x</p>');
  writeFileSync(join(d, 's.css'), '@media (prefers-color-scheme:dark){p{color:#fff}}');
  writeFileSync(join(d, 'c.html'), '<link rel="stylesheet" href="https://x.test/s.css"><style>p{color:red}</style>');
  assert.deepEqual(['a', 'b', 'c'].map((f) => hasDarkMode(join(d, `${f}.html`))), [true, true, false]);
  assert.equal(hasDarkMode(MINI), true);
  rmSync(d, { recursive: true, force: true });
});

// ---------------- CLI on a two-screen fixture ----------------

const DS_FILES = ['tokens.json', 'tokens.css', 'normalisation.json', 'questions.json', 'vd-rules.draft.json', 'coverage.json', 'token-map.json', 'design-system.html', 'spec-norm-s0.json', 'spec-norm-s1.json'];

test('CLI without a rules file: every question asks, the target spec is the modelled spec, plan-1 numbers unchanged', { skip }, async () => {
  const cwd = tmp(), out = join(cwd, 'ds'), outL = join(cwd, 'layout');
  const q = quiet();
  const code = await main(['--html', MINI, '--root', '.scr', '--no-webfonts', '--out', out], { fontMap: fm, browser, log: q.log, cwd });
  const codeL = await layoutMain(['--html', MINI, '--root', '.scr', '--no-webfonts', '--out', outL], { fontMap: fm, browser, log: () => {} });
  assert.equal(code, codeL);
  for (const f of ['ir.json', 'spec-s0.json', 'spec-s1.json', 'report.json', 'report.html', ...DS_FILES]) assert.ok(existsSync(join(out, f)), f);
  const n = readJson(out, 'normalisation.json');
  assert.ok(n.entries.length > 0);
  assert.deepEqual(n.entries.filter((e) => e.status === 'answered'), []);
  assert.ok(n.entries.some((e) => e.code === 'LINE_HEIGHT_INT' && e.status === 'ask' && e.from === 20.8 && e.proposal === 21), JSON.stringify(n.entries));
  // no auto entry on this fixture: the target spec is the modelled spec byte for byte
  assert.deepEqual(n.entries.filter((e) => e.status === 'auto'), []);
  for (const s of ['s0', 's1']) assert.equal(readFileSync(join(out, `spec-norm-${s}.json`), 'utf8'), readFileSync(join(out, `spec-${s}.json`), 'utf8'));
  // plan-1 numbers: the same summaries as layout.mjs
  const strip = (r) => r.screens.map((s) => ({ ...s.summary }));
  assert.deepEqual(strip(readJson(out, 'report.json')), strip(readJson(outL, 'report.json')));
  // questions: open ones drafted; the last line counts them
  const qs = readJson(out, 'questions.json');
  const open = qs.filter((x) => x.code !== 'PROJECT' && x.answered === undefined && !x.resolved);
  assert.ok(open.some((x) => x.key === 'project.lineHeightInt'));
  assert.equal(readJson(out, 'vd-rules.draft.json').answers['project.lineHeightInt'], 'yes');
  assert.match(q.lines.at(-1), new RegExp(`^${open.length} open questions? \\(no rules file\\)`));
  assert.equal(readJson(out, 'coverage.json').items.find((i) => i.id === 'color-theme').state, 'covered');
  assert.equal(readJson(out, 'ir.json').screens[0].darkMode, true);
  const html = readFileSync(join(out, 'design-system.html'), 'utf8');
  assert.match(html, /How to read/);
  rmSync(cwd, { recursive: true, force: true });
});

test('CLI with a rules file answering project.lineHeightInt: the entries are answered, the target spec changes, norm verified', { skip }, async () => {
  const cwd = tmp(), out = join(cwd, 'ds');
  const q = quiet();
  const code = await main(['--html', MINI, '--root', '.scr', '--no-webfonts', '--out', out, '--rules', join(FIX, 'rules-lh.json')], { fontMap: fm, browser, log: q.log, cwd });
  const n = readJson(out, 'normalisation.json');
  const lh = n.entries.filter((e) => e.code === 'LINE_HEIGHT_INT');
  assert.ok(lh.length > 0 && lh.every((e) => e.status === 'answered' && e.to === 21), JSON.stringify(lh));
  assert.notEqual(readFileSync(join(out, 'spec-norm-s0.json'), 'utf8'), readFileSync(join(out, 'spec-s0.json'), 'utf8'));
  assert.match(readFileSync(join(out, 'spec-norm-s0.json'), 'utf8'), /"lh":21/);
  const rep = readJson(out, 'report.json');
  for (const s of rep.screens) {
    assert.ok(s.report.norm && s.report.norm.applied > 0, 'norm proxy ran');
    assert.deepEqual(s.report.norm.unexplained, []);
    assert.deepEqual(s.report.data.filter((d) => d.kind === 'norm-spec'), []);
  }
  assert.equal(rep.args.rules, join(FIX, 'rules-lh.json'));
  assert.equal(code, rep.pass ? 0 : 1);
  // the rules file is never written; the draft no longer holds the answered question
  assert.deepEqual(readRules(join(FIX, 'rules-lh.json')).answers, { 'project.lineHeightInt': 'yes' });
  assert.equal('project.lineHeightInt' in readJson(out, 'vd-rules.draft.json').answers, false);
  rmSync(cwd, { recursive: true, force: true });
});

test('deterministic: reversing the screens gives byte-identical tokens and normalisation; corpus mode writes one folder per file', { skip }, async () => {
  const cwd = tmp(), out = join(cwd, 'ds');
  const corpus = join(cwd, 'c.json');
  writeFileSync(corpus, JSON.stringify({ files: [{ file: 'ds-mini.html', root: '.scr' }, { file: 'capture-basic.html', root: '.scr' }], allowlist: [] }));
  const q = quiet();
  await main(['--corpus', corpus, '--corpus-dir', FIX, '--no-webfonts', '--out', out, '--rules', join(FIX, 'rules-lh.json')], { fontMap: fm, browser, log: q.log, cwd });
  for (const d of ['ds-mini', 'capture-basic']) for (const f of DS_FILES.filter((x) => !x.startsWith('spec-norm-s1'))) assert.ok(existsSync(join(out, d, f)), `${d}/${f}`);
  assert.equal(existsSync(join(out, 'tokens.json')), false);
  assert.ok(existsSync(join(out, 'report.json')) && existsSync(join(out, 'report.html')));
  // rebuild the design system of ds-mini from the written IR and specs, screens reversed
  const dir = join(out, 'ds-mini');
  const ir = readJson(dir, 'ir.json');
  const items = ir.screens.map((screen) => ({ screen, spec: readJson(dir, `spec-${screen.id}.json`) }));
  const rules = readRules(join(FIX, 'rules-lh.json'));
  const a = designSystem(items, { rules }), b = designSystem([...items].reverse(), { rules });
  const norm = (ds) => `${JSON.stringify({ entries: ds.norm.entries, counts: ds.norm.counts, unparsed: ds.norm.unparsed, stale: ds.stale }, null, 1)}\n`;
  assert.equal(norm(a), norm(b));
  assert.equal(JSON.stringify(a.built.tokens), JSON.stringify(b.built.tokens));
  assert.equal(a.built.css, b.built.css);
  assert.equal(norm(a), readFileSync(join(dir, 'normalisation.json'), 'utf8'));
  assert.equal(`${JSON.stringify(a.built.tokens, null, 1)}\n`, readFileSync(join(dir, 'tokens.json'), 'utf8'));
  assert.equal(a.built.css, readFileSync(join(dir, 'tokens.css'), 'utf8'));
  // token-map.json: deterministic (reversed screens, same bytes), equal to tokenMap of the same design system
  const tmJson = (ds) => `${JSON.stringify(tokenMap(ds.inv, ds.built.tokens, ds.norm.entries), null, 1)}
`;
  assert.equal(tmJson(a), tmJson(b));
  assert.equal(tmJson(a), readFileSync(join(dir, 'token-map.json'), 'utf8'));
  assert.deepEqual(Object.keys(readJson(dir, 'token-map.json')).length > 0, true);
  assert.ok(q.lines.some((l) => /^ds-mini\.html: \d+ auto, \d+ answered, \d+ asked; 0 unexplained norm root/.test(l)), q.lines.join('\n'));
  assert.ok(readdirSync(out).every((f) => ['ds-mini', 'capture-basic', 'report.json', 'report.html'].includes(f)), readdirSync(out).join());
  rmSync(cwd, { recursive: true, force: true });
});
