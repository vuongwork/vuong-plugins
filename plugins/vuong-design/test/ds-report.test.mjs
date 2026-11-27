// Pure rendering of design-system.html (plan 2, Task 8): verdict line, the fixed "How to read" section, questions
// (project questions first, then group questions by nodes affected), units on every value, a parseable JSON answer
// per open question, no external requests except Google Fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDsReport, typeSamples, dsVerdict } from '../core/ds-report.mjs';
import { normalize } from '../core/normalize.mjs';
import { buildTokens } from '../core/tokens.mjs';
import { coverage, loadChecklist, projectQuestions } from '../core/coverage.mjs';

let seq = 0;
const use = (cat, prop, value, role, o = {}) => ({
  screen: o.screen ?? 's1', node: o.node ?? `0.${seq++}`, cat, prop, value, raw: typeof value === 'number' ? `${value}px` : String(value),
  role: `${cat}|${prop}|${role}`, ...o,
});
const type = (size, weight, lineHeight, role, o = {}) => use('type', 'text',
  { family: 'Inter', size, weight, style: 'normal', lineHeight, letterSpacing: 0, transform: 'none' }, role, { run: 0, ...o });

const font = (o = {}) => ({ ff: '"Inter", sans-serif', fs: '14px', fw: '400', fst: 'normal', lh: 20, ls: 'normal', c: 'rgb(153, 153, 153)', tt: 'none', ...o });
const screen = {
  id: 's1', name: 's1', W: [390, 510], vars: {},
  tree: {
    id: 'n', kind: 'frame', tag: 'div', cls: 'sc', rA: [0, 0, 390, 800], paint: { bg: 'rgb(255, 255, 255)' },
    kids: [
      { id: 'n.0', kind: 'text', tag: 'p', cls: 'muted', rA: [0, 0, 100, 20], paint: {}, font: font(), runs: [{ t: 'Việc cần làm' }] },
      { id: 'n.1', kind: 'frame', tag: 'button', cls: 'chip', rA: [0, 40, 60, 37], paint: {}, kids: [] },
    ],
  },
};

function fixture() {
  seq = 0;
  const uses = [
    // off-grid 13 and 14 with no majority: kept (R96 OFF_GRID, no question without project.grid4 ask-each)
    use('space', 'paddingT', 13, 'div.card|div.in', { node: '0.1' }),
    use('space', 'paddingT', 13, 'div.card|div.in', { node: '0.2' }),
    use('space', 'paddingT', 14, 'div.box|div.in', { node: '0.3' }),
    use('space', 'paddingT', 10, 'div.box|div.in', { node: '0.4' }),
    use('space', 'gap', 8, 'div.row|div.in', { node: '0.5' }),
    use('space', 'gap', 8, 'div.row|div.in', { node: '0.6' }),
    // ROLE_MAJORITY 13 -> 12 (auto change)
    ...[0, 1, 2, 3, 4].map((i) => use('space', 'paddingL', 12, 'div.tile|div.in', { node: `1.${i}` })),
    use('space', 'paddingL', 13, 'div.tile|div.in', { node: '1.9' }),
    use('radius', 'radiusTL', 8, 'div.card|div.in', { node: '0.1' }),
    use('radius', 'radiusTL', 8, 'div.card|div.in', { node: '0.2' }),
    use('radius', 'radiusTL', 999, 'span.chip|div.row', { node: '0.7', pill: true }),
    use('color', 'bg', '#2563eb', 'span.chip|div.row', { node: '0.7' }),
    use('color', 'bg', '#2563eb', 'span.chip|div.row', { node: '0.8' }),
    use('color', 'bg', '#2564eb', 'span.chip|div.row', { node: '0.9' }), // ΔE < 1, same role -> COLOR_DE1 auto
    use('color', 'color', '#111827', 'p.title|div.card', { node: '0.1.0', run: 0 }),
    use('color', 'color', '#141a2a', 'p.sub|div.card', { node: '0.2.0', run: 0 }), // near, other role -> COLOR_NEAR ask
    use('color', 'bg', '#ffffff80', 'div.veil|div.in', { node: '0.10' }),
    use('shadow', 'shadow', 'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px', 'div.card|div.in', { node: '0.1' }),
    use('opacity', 'opacity', 0.5, 'div.dim|div.in', { node: '0.11' }),
    use('border', 'borderT', 1, 'div.card|div.in', { node: '0.1' }),
    type(16, 500, 24, 'p.title|div.card', { node: '0.1.0' }),
    type(16, 500, 24, 'p.title|div.card', { node: '0.2.0' }),
    type(14, 400, 20.8, 'p.sub|div.card', { node: '0.2.1' }), // LINE_HEIGHT_INT project question
    type(14, 400, 20, 'p.note|div.card', { node: '0.2.2' }),
  ];
  const inv = { uses, vars: {} };
  const rules = { version: 1, answers: {} };
  const norm = normalize(inv, rules);
  const { tokens } = buildTokens(inv, norm.entries);
  const cov = coverage(loadChecklist(), { inv, tokens, screens: [screen], rules });
  const questions = [...norm.questions, ...projectQuestions({ inv, screens: [screen], rules })];
  return { inv, norm, tokens, cov, questions };
}

const render = (o = {}) => {
  const f = fixture();
  const html = renderDsReport({
    tokens: f.tokens, entries: f.norm.entries, questions: f.questions, coverage: f.cov, counts: f.norm.counts,
    samples: { 'primitive.typography.t16-500': 'Hôm nay' }, title: 'Planora design system', generated: '2026-11-22T00:00:00Z', ...o,
  });
  return { ...f, html };
};

const textOf = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

test('a verdict line at the top: values -> tokens, changes applied, questions open, coverage', () => {
  const { html, cov } = render();
  const m = /<p class="verdict">([^<]*)<\/p>/.exec(html);
  assert.ok(m, 'verdict paragraph');
  assert.ok(html.indexOf('class="verdict"') < html.indexOf('How to read'));
  assert.match(m[1], /^\d+ distinct values → \d+ primitive tokens \(\+ \d+ role tokens\); \d+ changes? applied, \d+ questions? open/);
  assert.match(m[1], new RegExp(`coverage ${cov.summary.covered + cov.summary.answered}/${cov.summary.total} items`));
  assert.equal(dsVerdict({ tokens: { primitive: {}, role: {} }, entries: [], questions: [], coverage: { summary: { total: 0, covered: 0, answered: 0 } } }),
    '0 distinct values → 0 primitive tokens (+ 0 role tokens); 0 changes applied, 0 questions open, coverage 0/0 items.');
});

test('a fixed "How to read" section: tiers, statuses, how to answer, nothing changes until answered', () => {
  const { html } = render();
  const i = html.indexOf('How to read');
  assert.ok(i > 0 && i < html.indexOf('id="questions"'));
  const sec = html.slice(i, html.indexOf('</details>', i));
  for (const w of [/primitive/, /role/, /component/, /\bauto\b/, /\bask\b/, /\bkept\b/, /answered/, /vd-rules\.json/, /project root/, /re-run/i, /[Nn]othing changes/]) assert.match(sec, w);
});

test('project questions come first (settles N nodes), then group questions by nodes affected, descending', () => {
  const { html, norm } = render();
  const cards = [...html.matchAll(/<div class="q" data-kind="(\w+)" data-key="([^"]+)" data-affects="(\d+)"/g)].map((m) => ({ kind: m[1], key: m[2], affects: +m[3] }));
  const open = norm.questions.filter((q) => q.answered === undefined && !q.resolved);
  assert.ok(open.length >= 4);
  const kinds = cards.map((c) => c.kind);
  const lastProject = kinds.lastIndexOf('project'), firstGroup = kinds.indexOf('group');
  assert.ok(lastProject >= 0 && firstGroup > lastProject, `project before group: ${kinds.join(',')}`);
  for (const k of ['project.lineHeightInt', 'project.colorNear']) assert.equal(cards.find((c) => c.key === k).kind, 'project');
  const group = cards.filter((c) => c.kind === 'group').map((c) => c.affects);
  assert.deepEqual(group, [...group].sort((a, b) => b - a));
  assert.match(html, /settles \d+ nodes?/);
  // §8.4 confirmations come after the normalisation questions
  const firstConfirm = kinds.indexOf('confirm');
  assert.ok(firstConfirm > kinds.lastIndexOf('group'));
});

test('every open question has a JSON answer that parses as a rules file and names its key', () => {
  const { html, questions } = render();
  const open = questions.filter((q) => q.answered === undefined && !q.resolved);
  const cards = [...html.matchAll(/<div class="q" data-kind="\w+" data-key="([^"]+)"[\s\S]*?<pre class="json">([\s\S]*?)<\/pre>/g)];
  assert.equal(cards.length, open.length);
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const [, key, json] of cards) {
    const j = JSON.parse(unesc(json));
    assert.equal(j.version, 1);
    assert.deepEqual(Object.keys(j.answers), [unesc(key)]);
    const q = open.find((x) => x.key === unesc(key));
    assert.deepEqual(j.answers[q.key], q.default);
  }
});

test('every value cell carries a unit (px, %, ΔE, :1, nodes, uses); colours show hex and OKLCH', () => {
  const { html } = render();
  const cells = [...html.matchAll(/<(td|span|div|figcaption) class="v[ "][^>]*>([\s\S]*?)<\/\1>/g)].map((m) => textOf(m[2]));
  assert.ok(cells.length > 30, `value cells: ${cells.length}`);
  for (const c of cells) {
    const rest = c.replace(/#[0-9a-f]{3,8}\b/gi, '').replace(/oklch\([^)]*\)/g, '').replace(/weight \d+/g, '')
      .replace(/\b[A-Z][A-Z0-9_]+\b/g, '') // reason codes (COLOR_DE1)
      .replace(/\b[ct]\d+\b|t\d+(_\d+)?-\d+/g, '');
    for (const m of rest.matchAll(/(?<![:\d.])-?\d+(?:\.\d+)?/g)) { // the 1 of a ratio unit (4.08:1) is the unit
      const after = rest.slice(m.index + m[0].length);
      assert.match(after, /^\s*(px|%|ΔE|:1|×|nodes?\b|uses?\b|screens?\b|items?\b|decisions?\b|roles?\b|tokens?\b)/, `bare number "${m[0]}" in value cell: ${c.trim()}`);
    }
  }
  assert.match(html, /oklch\(0\.\d+ 0\.\d+ \d+\)/);
  assert.match(html, /#2563eb/);
  assert.match(html, /\d+(\.\d+)?:1/); // contrast ratio
  assert.match(html, /60×37 px/); // touch target
});

test('sections in order; pill radius drawn as a pill; type specimens use the given sample text or the fallback', () => {
  const { html } = render();
  const ids = ['questions', 'colours', 'spacing', 'radius', 'type', 'shadows', 'changes', 'coverage'].map((id) => html.indexOf(`id="${id}"`));
  for (const i of ids) assert.ok(i > 0);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.match(html, /class="radius-box pill"/);
  assert.match(html, />Hôm nay</);
  assert.match(html, /Aa Bb 123 Tiếng Việt/);
  assert.match(html, /<details[^>]*><summary>Role tokens/);
});

test('changes applied: old -> new with units, reason in a sentence, node count, optional crops', () => {
  const f = fixture();
  const e = f.norm.entries.find((x) => x.code === 'ROLE_MAJORITY');
  const html = renderDsReport({ tokens: f.tokens, entries: f.norm.entries, questions: f.questions, coverage: f.cov, title: 't', generated: '',
    crops: [{ entry: e.id, src: 'data:image/png;base64,AAAA', norm: 'data:image/png;base64,BBBB' }] });
  const sec = html.slice(html.indexOf('id="changes"'), html.indexOf('id="coverage"'));
  assert.match(textOf(sec), /13 px →\s+12 px/);
  assert.match(sec, /Most elements in the same role/);
  assert.match(sec, /1 node\b/);
  assert.match(sec, /#2564eb[\s\S]*→[\s\S]*#2563eb/);
  assert.match(sec, /src="data:image\/png;base64,AAAA"[\s\S]*src="data:image\/png;base64,BBBB"/);
  assert.doesNotMatch(sec, /GRID4/); // ask entries are not changes
});

test('self-contained: no http(s) except Google Fonts; deterministic except the generated string', () => {
  const { html } = render();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) assert.match(m[0], /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, m[0]);
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter/);
  const a = render({ generated: 'x' }).html, b = render({ generated: 'y' }).html;
  assert.equal(a.replace(/>x</, '><'), b.replace(/>y</, '><'));
  assert.match(html, /prefers-color-scheme: dark/);
});

test('typeSamples: the most frequent real text of each typography primitive, via role aliases', () => {
  const f = fixture();
  const { tokens, map } = buildTokens(f.inv, f.norm.entries);
  const spec = (id, t) => ({ id, runs: [{ t }] });
  const specs = [{ screen: { id: 's1' }, spec: { id: '0', kids: [spec('0.1.0', 'Hôm nay'), spec('0.2.0', 'Hôm nay'), spec('0.2.1', 'Ghi chú'), spec('0.2.2', '  ')] } }];
  const s = typeSamples({ inv: f.inv, tokens, map, screens: specs });
  assert.equal(s['primitive.typography.t16-500'], 'Hôm nay');
  assert.equal(s['primitive.typography.t14-400-2'], 'Ghi chú'); // line height 20.8 px sorts after 20 px
  assert.equal(s['primitive.typography.t14-400'], undefined); // only blank text: no sample
});

test('R79: the coverage section says how many CSS variable uses could not be attributed and what that means for colours', () => {
  const f = fixture();
  const html = renderDsReport({ tokens: f.tokens, entries: f.norm.entries, questions: f.questions, coverage: { ...f.cov, vars: { complex: 7, unreadable: 2 } }, title: 't', generated: '' });
  const t = textOf(html).replace(/\s+/g, ' ');
  assert.match(t, /7 CSS variable uses could not be attributed/);
  assert.match(t, /2 stylesheets could not be read/);
  assert.match(t, /treated as named/);
  const z = textOf(renderDsReport({ tokens: f.tokens, entries: f.norm.entries, questions: f.questions, coverage: { ...f.cov, vars: { complex: 0, unreadable: 0 } }, title: 't', generated: '' })).replace(/\s+/g, ' ');
  assert.match(z, /Every CSS variable use was attributed/);
});
