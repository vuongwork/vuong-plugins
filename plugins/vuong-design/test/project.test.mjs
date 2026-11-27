// R91: the project file and next.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProject, projectDefaults, ProjectError } from '../core/project-file.mjs';
import { parseCli } from '../core/layout.mjs';
import { main as approveMain } from '../core/approve.mjs';
import { main as answerMain } from '../core/answer.mjs';
import { nextSteps, main as nextMain } from '../core/next.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'vd-project-'));
const put = (dir, name, body) => { const p = join(dir, name); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); return p; };
const age = (p, s) => utimesSync(p, s, s); // seconds since the epoch: a smaller number is older

test('readProject resolves paths against its folder and refuses unknown keys, bad types and a wrong version', () => {
  const d = tmp();
  const path = put(d, 'vd-project.json', { version: 1, about: 'x', html: 'ui/screens.html', root: '.screen', widen: '.phone', out: 'build/ds', rules: 'vd-rules.json', viewport: 390, webFonts: false, figma: { out: 'build/fig', file: 'My file' } });
  const p = readProject(path);
  assert.equal(p.html, join(d, 'ui', 'screens.html'));
  assert.equal(p.out, join(d, 'build', 'ds'));
  assert.equal(p.root, '.screen');
  assert.equal(p.figma.out, join(d, 'build', 'fig'));
  assert.equal(p.figma.file, 'My file');
  for (const bad of [{ version: 2, html: 'a' }, { version: 1 }, { version: 1, html: 'a', rools: 'x' }, { version: 1, html: 'a', viewport: '390' }, { version: 1, html: 'a', figma: { outt: 'x' } }, { version: 1, html: '' }]) {
    assert.throws(() => readProject(put(d, 'bad.json', bad)), ProjectError, JSON.stringify(bad));
  }
  assert.throws(() => readProject(join(d, 'none.json')), /not found/);
});

test('projectDefaults: the command line wins; a rules / allowlist file that does not exist is left out unless the command creates it', () => {
  const d = tmp();
  put(d, 'vd-rules.json', { version: 1, answers: {} });
  const p = readProject(put(d, 'p.json', { version: 1, html: 'a.html', out: 'o', root: '.s', rules: 'vd-rules.json', allowlist: 'vd-allowlist.json', viewport: 390, webFonts: false }));
  assert.deepEqual(projectDefaults(p, { root: '.mine' }, ['html', 'root', 'out', 'rules', 'allowlist', 'viewport', 'no-webfonts']),
    { html: join(d, 'a.html'), out: join(d, 'o'), rules: join(d, 'vd-rules.json'), viewport: '390', 'no-webfonts': true });
  assert.deepEqual(projectDefaults(p, {}, ['out', 'allowlist'], { create: ['allowlist'] }), { out: join(d, 'o'), allowlist: join(d, 'vd-allowlist.json') });
});

test('layout / ds CLI: --project fills the options, flags override it, --corpus with it is refused', () => {
  const d = tmp();
  const path = put(d, 'p.json', { version: 1, html: 'a.html', out: 'o', root: '.s', widen: '.w' });
  const o = parseCli(['--project', path, '--widen', '.other']);
  assert.equal(o.html, join(d, 'a.html'));
  assert.equal(o.out, join(d, 'o'));
  assert.equal(o.root, '.s');
  assert.equal(o.widen, '.other');
  const ds = parseCli(['--project', path], process.env, { options: { rules: { type: 'string' }, names: { type: 'string' } } });
  assert.equal(ds.rules, undefined, 'no rules file yet');
  assert.throws(() => parseCli(['--project', path, '--corpus', 'c.json']), /either --project or --corpus/);
  assert.throws(() => parseCli(['--project', join(d, 'none.json')]), /not found/);
});

test('answer / approve: --project gives the output folder and the rules / allowlist file (created on the first submit)', async () => {
  const d = tmp();
  const out = join(d, 'o');
  mkdirSync(out);
  put(out, 'report.html', '<p>r</p>');
  put(out, 'report.json', { screens: [] });
  put(out, 'design-system.html', '<p>ds</p>');
  put(out, 'questions.json', []);
  const path = put(d, 'p.json', { version: 1, html: 'a.html', out: 'o', rules: 'vd-rules.json', allowlist: 'vd-allowlist.json' });
  const logs = [];
  const a = await approveMain(['--project', path, '--no-open'], { log: (s) => logs.push(s) });
  try { assert.equal(a.code, 0, logs.join('\n')); assert.match(logs.join('\n'), /vd-allowlist\.json \(created on the first submit\)/); } finally { await a.close(); }
  const r = await answerMain(['--project', path, '--no-open'], { log: (s) => logs.push(s) });
  try { assert.equal(r.code, 0, logs.join('\n')); assert.match(logs.join('\n'), /answers go into .*vd-rules\.json/); } finally { await r.close(); }
  assert.equal((await approveMain(['--project', path, '--figma', '--no-open'], { log: (s) => logs.push(s) })).code, 2, 'no figma out in the project');
});

// a project folder at a given stage
function stage() {
  const d = tmp();
  const out = join(d, 'ds');
  const p = { version: 1, html: 'ui.html', out: 'ds', rules: 'vd-rules.json', allowlist: 'vd-allowlist.json', figma: { out: 'fig', file: 'Design' } };
  const path = put(d, 'p.json', p);
  const html = put(d, 'ui.html', '<p>ui</p>');
  age(html, 1000);
  return { d, out, path, html, project: () => readProject(path) };
}
const screen = (pass, extra = {}) => ({ summary: { file: 'ui.html', screen: 's0', pass }, gate: { pass, open: { roots: [], approvals: [], crops: [], cropsLinked: [] } }, report: { data: [], unchecked: [] }, allowlistDraft: [], ...extra });
function ds(out, screens, questions = [], t = 2000) {
  mkdirSync(out, { recursive: true });
  for (const [f, b] of [['report.json', { screens }], ['design-system.html', '<p>ds</p>'], ['questions.json', questions]]) age(put(out, f, b), t);
}

test('next: html, ds, a changed input, open questions, findings to approve and a plugin bug, in that order', () => {
  const s = stage();
  assert.equal(nextSteps(readProject(put(s.d, 'q.json', { version: 1, html: 'missing.html' }))).next.id, 'html');
  let n = nextSteps(s.project()).next;
  assert.equal(n.id, 'ds');
  assert.match(n.cmd, /ds\.mjs" --project|ds\.mjs --project/);
  ds(s.out, [screen(true)], [{ key: 'k', options: [1, 2] }]);
  n = nextSteps(s.project()).next;
  assert.equal(n.id, 'questions');
  assert.match(n.cmd, /answer\.mjs/);
  age(put(s.d, 'vd-rules.json', { version: 1, answers: { k: 1 } }), 3000);
  n = nextSteps(s.project()).next;
  assert.equal(n.id, 'ds');
  assert.match(n.why, /the rules changed/);
  const crop = { file: 'ui.html', screen: 's0', node: 'n.1', width: 'A', kind: 'crop', ratio: 0.2, peak: 40 };
  ds(s.out, [screen(false, { allowlistDraft: [crop] })], [{ key: 'k', options: [1, 2], answered: 1 }], 4000);
  n = nextSteps(s.project()).next;
  assert.equal(n.id, 'approve');
  assert.match(n.cmd, /approve\.mjs/);
  const norm = { id: 'n.2', width: 'A', layer: 'norm' };
  const bug = screen(false, { allowlistDraft: [{ ...crop, kind: 'root', node: 'n.2' }] });
  bug.gate.open.roots = [norm];
  ds(s.out, [bug], [], 4000);
  n = nextSteps(s.project()).next;
  assert.equal(n.cmd, null);
  assert.match(n.why, /1 layout error the plugin cannot explain/);
});

test('next: the Figma steps follow once every screen passes: plan, send, shots, check, approve, done', () => {
  const s = stage();
  ds(s.out, [screen(true)]);
  const F = join(s.d, 'fig');
  assert.equal(nextSteps(s.project()).next.id, 'figma-plan');
  mkdirSync(F);
  const state = (batch, t) => age(put(F, 'state.json', { batches: { 'batch-01': { status: batch } }, screens: { s0: { status: batch === 'done' ? 'done' : 'pending' } } }), t);
  state('pending', 3000);
  let n = nextSteps(s.project()).next;
  assert.equal(n.id, 'figma-send');
  assert.match(n.cmd, /serve --out .* --file Design --send pending --shots/);
  state('done', 3000);
  assert.equal(nextSteps(s.project()).next.id, 'figma-shots');
  age(put(F, 'shot-s0.png', 'png'), 3100);
  assert.equal(nextSteps(s.project()).next.id, 'figma-check');
  age(put(F, 'report.json', { screens: [screen(false, { allowlistDraft: [{ kind: 'crop', node: 'n.1', width: 'A' }] })] }), 3200);
  n = nextSteps(s.project()).next;
  assert.equal(n.id, 'figma-approve');
  assert.match(n.cmd, /approve\.mjs.* --figma/);
  age(put(F, 'report.json', { screens: [screen(true)] }), 3200);
  assert.equal(nextSteps(s.project()).next, null);
  const logs = [];
  assert.equal(nextMain(['--project', s.path], { log: (x) => logs.push(x) }), 0);
  assert.match(logs.join('\n'), /all done/);
  // the design system runs again: plan again
  ds(s.out, [screen(true)], [], 5000);
  assert.equal(nextSteps(s.project()).next.id, 'figma-plan');
});
