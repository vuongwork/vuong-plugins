import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverage, loadChecklist, validateChecklist, projectQuestions, contrastIssues, touchIssues } from '../core/coverage.mjs';
import { buildTokens } from '../core/tokens.mjs';
import { inventory } from '../core/inventory.mjs';

const font = (o = {}) => ({ ff: '"Inter", sans-serif', fs: '14px', fw: '400', fst: 'normal', lh: 20, ls: 'normal', c: 'rgb(153, 153, 153)', tt: 'none', ...o });
const text = (id, c, o = {}) => ({ id, kind: 'text', tag: 'p', cls: '', rA: [0, 0, 100, 20], paint: {}, font: font({ c, ...(o.font || {}) }), runs: o.runs || [{ t: 'Xin chào thế giới' }] });

function screen(o = {}) {
  return {
    id: 's1', name: 's1', W: [390, 510], ...o.extra,
    vars: {},
    tree: {
      id: 'n', kind: 'frame', tag: 'div', cls: 'sc', rA: [0, 0, 390, 800], paint: { bg: o.rootBg ?? 'rgb(255, 255, 255)' },
      kids: [
        text('n.0', '#999999'),
        text('n.1', '#555555'),
        text('n.2', '#999999', { font: { fs: '24px' } }), // large: 2.85:1 < 3 -> listed
        text('n.3', '#949494', { font: { fs: '19px', fw: '700' } }), // large bold: 3.03:1 >= 3 -> fine
        {
          id: 'n.4', kind: 'frame', tag: 'div', cls: 'card is-selected', rA: [0, 100, 390, 60], paint: { bg: 'rgb(38, 51, 92)' },
          kids: [
            text('n.4.0', '#ffffff'),
            { id: 'n.4.1', kind: 'frame', tag: 'div', cls: 'veil', rA: [0, 100, 390, 60], paint: { bg: 'rgba(255, 255, 255, 0.5)' }, kids: [text('n.4.1.0', '#ffffff')] },
          ],
        },
        { id: 'n.5', kind: 'frame', tag: 'button', cls: 'ico-btn', rA: [10, 200, 32, 32], paint: {}, kids: [] },
        { id: 'n.6', kind: 'frame', tag: 'button', cls: 'cta', rA: [10, 240, 200, 48], paint: { bg: 'rgb(37, 99, 235)' }, kids: [text('n.6.0', '#ffffff')] },
        { id: 'n.7', kind: 'frame', tag: 'a', cls: 'link', rA: [10, 300, 0, 0], paint: {}, kids: [] },
        { id: 'n.8', kind: 'icon', tag: 'svg', cls: '', rA: [0, 0, 20, 20], paint: {}, icon: { ref: 'logo', fill: 'rgb(0, 0, 0)', stroke: 'none' } },
      ],
    },
  };
}

test('contrast: #999 on white is listed, #555 is not; large text needs 3:1; translucent layers compose over the opaque ancestor', () => {
  const list = contrastIssues([screen()]);
  const ids = list.map((x) => x.node);
  assert.ok(ids.includes('n.0'));
  assert.ok(!ids.includes('n.1'));
  assert.ok(ids.includes('n.2'));
  assert.ok(!ids.includes('n.3'));
  assert.ok(!ids.includes('n.4.0')); // white on #26335c
  const a = list.find((x) => x.node === 'n.0');
  assert.deepEqual([a.color, a.bg, a.bgFrom, a.ratioText, a.required, a.fontSize, a.large], ['#999999', '#ffffff', 'n', '2.85:1', '4.5:1', '14px', false]);
  assert.equal(list.find((x) => x.node === 'n.2').required, '3:1');
  // white text on a 50% white veil over navy: bg ≈ #939aae -> fails
  const v = list.find((x) => x.node === 'n.4.1.0');
  assert.equal(v.bgFrom, 'n.4');
  assert.equal(v.bg, '#9399ae');
  assert.ok(v.ratio < 4.5);
});

test('contrast: no opaque ancestor -> white is assumed and said so', () => {
  const [a] = contrastIssues([screen({ rootBg: 'rgba(0, 0, 0, 0)' })]);
  assert.equal(a.bgFrom, 'assumed white');
  assert.equal(a.bg, '#ffffff');
});

test('touch targets: a 32×32 button is listed, a 200×48 one is not, zero-area links are skipped', () => {
  assert.deepEqual(touchIssues([screen()]), [{ screen: 's1', node: 'n.5', tag: 'button', w: 32, h: 32, size: '32×32 px' }]);
});

test('checklist file: missing, bad version, unknown check and bad tag are clear errors; the shipped one loads', () => {
  const cl = loadChecklist();
  assert.equal(cl.version, 1);
  assert.equal(cl.groups.length, 8);
  const dir = mkdtempSync(join(tmpdir(), 'vd-cl-'));
  assert.throws(() => loadChecklist(join(dir, 'none.json')), /checklist file .*none\.json not found/);
  writeFileSync(join(dir, 'v2.json'), JSON.stringify({ version: 2, groups: [] }));
  assert.throws(() => loadChecklist(join(dir, 'v2.json')), /"version" is 2, expected 1/);
  writeFileSync(join(dir, 'nov.json'), JSON.stringify({ groups: [] }));
  assert.throws(() => loadChecklist(join(dir, 'nov.json')), /"version" is undefined, expected 1/);
  writeFileSync(join(dir, 'bad.json'), '{');
  assert.throws(() => loadChecklist(join(dir, 'bad.json')), /not valid JSON/);
  const g = (item) => ({ version: 1, groups: [{ id: 'g', label: 'G', items: [item] }] });
  assert.throws(() => validateChecklist(g({ id: 'x', label: 'X', tag: 'ask', check: 'nope' })), /unknown check "nope"/);
  assert.throws(() => validateChecklist(g({ id: 'x', label: 'X', tag: 'maybe' })), /tag "maybe"/);
  assert.throws(() => coverage({ version: 3, groups: [] }, {}), /"version" is 3/);
});

test('coverage: automatic checks, answered questions and evidence with units', () => {
  const scr = screen();
  const inv = {
    uses: [
      { screen: 's1', node: 'n.4', cat: 'color', prop: 'bg', value: '#26335c', raw: '#26335c', role: 'color|bg|div.card|div.sc' },
      { screen: 's1', node: 'n.6', cat: 'color', prop: 'bg', value: '#2563eb', raw: '#2563eb', role: 'color|bg|button.cta|div.sc' },
      { screen: 's1', node: 'n.6', cat: 'space', prop: 'paddingT', value: 12, raw: '12px', role: 'space|paddingT|button.cta|div.sc' },
      { screen: 's1', node: 'n.4', cat: 'space', prop: 'paddingT', value: 16, raw: '16px', role: 'space|paddingT|div.card|div.sc' },
      { screen: 's1', node: 'n.4', cat: 'radius', prop: 'radiusTL', value: 16, raw: '16px', role: 'radius|radiusTL|div.card|div.sc' },
      { screen: 's1', node: 'n.0', cat: 'type', prop: 'text', run: 0, value: { family: 'Inter', size: 14, weight: 400, style: 'normal', lineHeight: 20, letterSpacing: 0, transform: 'none' }, raw: 'Inter', role: 'type|text|p|div.sc' },
      { screen: 's1', node: 'n.2', cat: 'type', prop: 'text', run: 0, value: { family: 'Inter', size: 24, weight: 400, style: 'normal', lineHeight: 30, letterSpacing: 0, transform: 'none' }, raw: 'Inter', role: 'type|text|p|div.sc' },
    ],
    vars: { '--danger': { value: '#dc2626', uses: 0, screens: ['s1'] } },
  };
  const { tokens } = buildTokens(inv, []);
  const cl = loadChecklist();
  const res = coverage(cl, { inv, tokens, screens: [scr], rules: { version: 1, answers: { 'project.density': 'compact' } } });
  const by = Object.fromEntries(res.items.map((x) => [x.id, x]));
  assert.equal(res.items.length, cl.groups.reduce((n, g) => n + g.items.length, 0));
  for (const it of res.items) {
    assert.ok(['covered', 'missing', 'answered'].includes(it.state), it.id);
    assert.ok(['ask', 'default', 'derived'].includes(it.tag), it.id);
    assert.equal(typeof it.evidence, 'string', it.id);
  }
  assert.equal(by['type-scale'].state, 'covered');
  assert.equal(by['type-scale'].evidence, '2 font sizes: 14, 24 px');
  assert.equal(by['space-scale'].evidence, '2 spacing values: 12, 16 px');
  assert.equal(by.shadow.state, 'missing');
  assert.equal(by['color-theme'].evidence, 'not measured');
  assert.equal(by.density.state, 'answered');
  assert.equal(by['color-states'].state, 'missing'); // error (--danger) and selected (.is-selected) found, disabled not
  assert.match(by['color-states'].evidence, /error \(variable --danger\).*selected \(\.is-selected on n\.4\).*not found: disabled/);
  assert.equal(by.contrast.state, 'missing');
  assert.equal(by['touch-target'].state, 'missing');
  assert.match(by['touch-target'].evidence, /1 interactive element smaller than 44×44 px/);
  assert.equal(by.motion.state, 'missing');
  assert.match(by.motion.evidence, /default applies/);
  assert.equal(res.touch.length, 1);
  assert.ok(res.contrast.length >= 3);
  assert.equal(res.summary.total, res.items.length);
  // dark mode signal from the caller
  const dm = coverage(cl, { inv, tokens, screens: [{ ...scr, darkMode: true }] });
  assert.equal(dm.items.find((x) => x.id === 'color-theme').state, 'covered');
  const nodm = coverage(cl, { inv, tokens, screens: [{ ...scr, darkMode: false }] });
  assert.equal(nodm.items.find((x) => x.id === 'color-theme').evidence, 'no dark-mode styles in the CSS');
});

test('project questions: eleven, defaults from the source, answers marked, never thrown on', () => {
  const scr = screen();
  const inv = {
    uses: [
      { screen: 's1', node: 'n.6', cat: 'color', prop: 'bg', value: '#2563eb', role: 'color|bg|button.cta|div.sc' },
      { screen: 's1', node: 'n.4', cat: 'color', prop: 'bg', value: '#dc2626', role: 'color|bg|div.card|div.sc' },
      { screen: 's1', node: 'n.4', cat: 'color', prop: 'bg', value: '#dc2626', role: 'color|bg|div.card|div.sc' },
      { screen: 's1', node: 'n.4', cat: 'space', prop: 'paddingT', value: 6, role: 'space|paddingT|div.card|div.sc' },
      { screen: 's1', node: 'n.4', cat: 'radius', prop: 'radiusTL', value: 16, role: 'radius|radiusTL|div.card|div.sc' },
      { screen: 's1', node: 'n.0', cat: 'type', prop: 'text', run: 0, value: { family: 'Inter', size: 14 }, role: 'type|text|p|div.sc' },
    ],
    vars: {},
  };
  const qs = projectQuestions({ inv, screens: [scr], rules: { version: 1, answers: { 'project.platform': 'android', 'project.font': 'Not in the list' } } });
  assert.deepEqual(qs.map((q) => q.key), ['project.adjectives', 'project.brandAssets', 'project.darkMode', 'project.density', 'project.font', 'project.i18n',
    'project.iconStyle', 'project.platform', 'project.primaryColor', 'project.screenSizes', 'project.shadows']);
  const by = Object.fromEntries(qs.map((q) => [q.key.slice(8), q]));
  for (const q of qs) {
    assert.equal(q.cat, 'project');
    assert.match(q.text, /^[^\n]+[?.]$/);
    assert.ok(q.default !== undefined && q.default !== null, q.key);
    if (q.options) assert.ok(q.options.map(String).includes(String(q.default)), q.key);
  }
  assert.equal(by.platform.answered, 'android');
  assert.equal(by.font.answered, 'Not in the list');
  assert.equal(by.platform.default, 'android+ios');
  assert.equal(by.primaryColor.default, '#2563eb'); // on the button, though red is used more
  assert.equal(by.density.default, 'compact');
  assert.equal(by.i18n.default, 'vi');
  assert.equal(by.darkMode.default, 'no');
  assert.equal(by.shadows.default, 'no');
  assert.equal(by.iconStyle.default, 'filled');
  assert.equal(by.brandAssets.default, 'logo in the screens');
  assert.equal(by.screenSizes.default, '390 px');
  assert.equal(by.adjectives.default, 'soft, efficient, vivid');
});

test('end to end on inventory output: tokens + coverage run on a real inventory shape', () => {
  const scr = screen();
  const spec = { id: 'n', t: 'F', w: 390, h: 800, sz: ['FIXED', 'FIXED'], paint: scr.tree.paint, kids: [] };
  const inv = inventory([{ screen: scr, spec }]);
  const { tokens } = buildTokens(inv, []);
  const res = coverage(loadChecklist(), { inv, tokens, screens: [scr] });
  assert.equal(res.items.length > 40, true);
});
