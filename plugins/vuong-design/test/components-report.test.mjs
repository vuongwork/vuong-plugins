import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findComponents } from '../core/components.mjs';
import { componentStates, statesDraft } from '../core/states.mjs';
import { renderComponents, stateSpec, componentsSummary } from '../core/components-report.mjs';
import { main } from '../core/cmp.mjs';
import { defaultFontMap } from '../core/font-map.mjs';

// Same hand-built IR + spec builder as components.test.mjs (no browser).
const BG = 'rgb(255, 255, 255)';
const F = (cls, o = {}, ...kids) => ({ t: 'F', cls, ...o, kids });
const T = (text, cls = 't') => ({ t: 'T', cls, text });
function specOf(d, id) {
  const sn = { id, t: d.t, w: 40, h: 20, sz: ['HUG', 'HUG'] };
  if (d.t === 'F') sn.lay = { d: d.d || 'H', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S' };
  const paint = {};
  if (d.bg) paint.bg = d.bg;
  if (d.border) paint.border = [0, 1, 2, 3].map(() => ({ w: d.border, style: 'solid', color: 'rgb(0, 0, 0)' }));
  if (Object.keys(paint).length) sn.paint = paint;
  if (d.text != null) { sn.runs = [{ t: d.text }]; sn.font = { ff: 'Inter', fs: '14px', fw: '400', lh: 20, c: 'rgb(0, 0, 0)' }; }
  return sn;
}
function srcNode(d, id) {
  const sn = specOf(d, id);
  const ir = { id, kind: d.t === 'T' ? 'text' : 'frame', tag: d.t === 'T' ? 'span' : 'div', cls: d.cls || '', paint: {} };
  let k = 0;
  const irKids = [];
  const kids = (d.kids || []).map((x) => { const r = srcNode(x, `${id}.${k++}`); irKids.push(r.ir); return r.sn; });
  if (kids.length) sn.kids = kids;
  if (irKids.length) ir.kids = irKids;
  return { sn, ir };
}
const scr = (id, ...kids) => {
  const { sn, ir } = srcNode(F('sc', { bg: 'rgb(240, 240, 200)', d: 'V' }, ...kids), 'n');
  return { screen: { id, name: id, tree: ir, svgDefs: {}, fontCss: {} }, spec: sn };
};
const btn = (text, ...cls) => F(['btn', ...cls].join(' '), { bg: 'rgb(255, 0, 0)' }, T(text, 'lbl'));
const DECL = { version: 1, classes: { btn: { kind: 'button' } }, keep: {}, drop: [] };
const fixture = () => [scr('s1', btn('OK'), btn('No', 'is-disabled'), F('x', {}, F('', { bg: BG }, T('a'), T('b'))), F('x', {}, F('', { bg: BG }, T('c'), T('d'))))];
function page(screens = fixture(), generated = 'G') {
  const specs = Object.fromEntries(screens.map((s) => [s.screen.id, s.spec]));
  const cmps = findComponents(screens, { decl: DECL });
  const states = componentStates(cmps, { specs, decl: DECL });
  const html = renderComponents({ cmps, states, specs, fontMap: defaultFontMap(), generated, rulesDraft: statesDraft(undefined),
    screens: Object.fromEntries(screens.map((s) => [s.screen.id, s.screen])) });
  return { cmps, states, html };
}
const count = (s, re) => (s.match(re) || []).length;

test('the preview has a cell for every variant and state: html, proposed with its rule, missing with its reason', () => {
  const { cmps, states, html } = page();
  const c = cmps.components.find((x) => x.name === 'btn');
  const st = states.components.find((x) => x.name === 'btn');
  const sec = html.slice(html.indexOf('id="c-btn"'), html.indexOf('</section>', html.indexOf('id="c-btn"')));
  assert.equal(count(sec, /<figcaption><span class="tag html">/g), c.variants.length);
  assert.equal(count(sec, /<figcaption><span class="tag proposed">/g), st.proposed.length);
  assert.equal(count(sec, /<figcaption><span class="tag missing">missing<\/span> state=/g), st.states.filter((s) => s.source === 'missing').length);
  assert.match(sec, /rule pressed: overlay #000000 at 10 %/);
  assert.match(sec, /state=focus<br><span class="muted">no focus colour token/);
  assert.equal(count(sec, /<iframe /g), c.variants.length + st.proposed.length);
  assert.match(html, /rules not approved: nothing proposed goes to Figma/);
});

test('cells are proxy pages on the fill behind the component; bare proposals are drawn with the keep line', () => {
  const { cmps, html } = page();
  assert.match(html, /srcdoc="&lt;!doctype html&gt;/);
  assert.match(html, /body\{padding:8px;background:#f0f0c8\}/);
  assert.equal(cmps.proposed.length, 1);
  assert.match(html, new RegExp(`&quot;keep&quot;: \\{ &quot;${cmps.proposed[0].key.replace(/[:]/g, '\\$&')}&quot;: &quot;&lt;name&gt;&quot; \\}`));
  assert.match(html, /<span class="tag proposal">proposal<\/span>/);
});

test('the preview is deterministic and does not depend on the order of screens', () => {
  const a = scr('s1', btn('OK'), btn('No', 'is-disabled'));
  const b = scr('s2', btn('Go'));
  assert.equal(page([a, b]).html, page([b, a]).html);
  assert.equal(page().html, page().html);
});

test('stateSpec draws each patch on a copy of the template', () => {
  const root = { id: 'r', t: 'F', w: 40, h: 20, paint: { bg: 'rgb(255, 0, 0)', border: [{ w: 1, style: 'solid', color: 'rgb(0, 0, 0)' }] }, kids: [{ id: 'r.0', t: 'T', w: 30, h: 16, font: { fs: '14px', c: 'rgb(0, 0, 0)' }, runs: [{ t: 'OK' }] }] };
  const before = JSON.stringify(root);
  assert.equal(stateSpec(root, { overlay: { color: '#000000', opacity: 0.1 } }).paint.bgImage, 'linear-gradient(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1))');
  const d = stateSpec(root, { contentOpacity: 0.38, fillOpacity: 0.12, strokeOpacity: 0.12 });
  assert.equal(d.paint.bg, 'rgba(255, 0, 0, 0.12)');
  assert.equal(d.paint.border[0].color, 'rgba(0, 0, 0, 0.12)');
  assert.equal(d.kids[0].paint.opacity, 0.38);
  assert.equal(stateSpec(root, { ring: { width: 2, color: '#0000ff', token: 'role.focus' } }).paint.shadow, '0 0 0 2px #0000ff');
  assert.deepEqual(stateSpec(root, { stroke: { width: 1, color: '#ff0000', token: 'role.error' } }).paint.border[2], { w: 1, style: 'solid', color: '#ff0000' });
  const l = stateSpec(root, { spinner: { replace: ['0'], size: 14, color: '#000000' } });
  assert.equal(l.kids[0].t, 'F');
  assert.deepEqual([l.kids[0].w, l.kids[0].h], [30, 16]);
  assert.equal(l.kids[0].runs, undefined);
  assert.deepEqual(l.kids[0].kids[0].abs, { x: 8, y: 1, c: 'L' });
  assert.equal(l.kids[0].kids[0].t, 'V');
  assert.match(l.kids[0].kids[0].icon.svg, /^<svg[^>]*viewBox="0 0 24 24".*stroke="#000000"/);
  assert.equal(JSON.stringify(root), before);
});

function dsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'vd-cmp-'));
  const screens = fixture();
  writeFileSync(join(dir, 'ir.json'), JSON.stringify({ file: 'x.html', screens: screens.map((s) => s.screen) }));
  for (const s of screens) writeFileSync(join(dir, `spec-norm-${s.screen.id}.json`), JSON.stringify(s.spec));
  writeFileSync(join(dir, 'vd-rules.draft.json'), JSON.stringify({ version: 1, answers: { 'q.a': 'x' }, notes: { 'q.a': 'text' } }));
  writeFileSync(join(dir, 'coverage.json'), JSON.stringify({ items: [], summary: { total: 0 } }));
  writeFileSync(join(dir, 'design-system.html'), '<html><body><h1>DS</h1></body></html>');
  writeFileSync(join(dir, 'vd-components.json'), JSON.stringify(DECL));
  return dir;
}
const cli = (argv, cwd) => { const out = []; return main(argv, { cwd, log: (s) => out.push(s), err: (s) => out.push(s), generated: 'G' }).then((code) => ({ code, out: out.join('\n') })); };

test('cmp.mjs writes the component files, adds states to the rules draft and coverage, and links the preview once', async () => {
  const dir = dsDir();
  let r = await cli(['--ds', dir], dir);
  assert.equal(r.code, 0, r.out);
  for (const f of ['components.json', 'states.json', 'vd-components.draft.json', 'components.html']) assert.ok(existsSync(join(dir, f)), f);
  const rd = JSON.parse(readFileSync(join(dir, 'vd-rules.draft.json'), 'utf8'));
  assert.deepEqual(rd.answers, { 'q.a': 'x' });
  assert.equal(rd.states.approved, '');
  const cov = JSON.parse(readFileSync(join(dir, 'coverage.json'), 'utf8'));
  assert.deepEqual(cov.components.missing.map((m) => m.state), ['focus']);
  assert.equal(cov.components.summary.approved, false);
  const first = readFileSync(join(dir, 'components.json'), 'utf8');
  r = await cli(['--ds', dir], dir);
  assert.equal(readFileSync(join(dir, 'components.json'), 'utf8'), first);
  const ds = readFileSync(join(dir, 'design-system.html'), 'utf8');
  assert.equal(count(ds, /<!--vd:components-->/g), 1);
  assert.match(ds, /<h1>DS<\/h1><!--vd:components--><section id="components">.*components\.html.*<!--\/vd:components-->\n<\/body>/s);
  assert.match(r.out, /rules not approved: nothing proposed goes to Figma/);
});

test('cmp.mjs: approved rules remove the states draft; a bad declaration or a missing ds folder is a usage error', async () => {
  const dir = dsDir();
  writeFileSync(join(dir, 'vd-rules.json'), JSON.stringify({ version: 1, answers: {}, states: { approved: true } }));
  assert.equal((await cli(['--ds', dir], dir)).code, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'vd-rules.draft.json'), 'utf8')).states, undefined);
  assert.equal(JSON.parse(readFileSync(join(dir, 'states.json'), 'utf8')).approved, true);
  writeFileSync(join(dir, 'vd-components.json'), JSON.stringify({ version: 1, classes: { btn: { kind: 'rocket' } } }));
  const bad = await cli(['--ds', dir], dir);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /classes\.btn\.kind "rocket"/);
  const none = await cli(['--ds', join(dir, 'nope'), '--components', join(dir, 'vd-rules.json')], dir);
  assert.equal(none.code, 2);
  assert.equal((await cli([], dir)).code, 2);
});

test('componentsSummary links the preview with the verdict', () => {
  const { cmps, states } = page();
  assert.match(componentsSummary({ cmps, states }), /<a href="components\.html">/);
});
