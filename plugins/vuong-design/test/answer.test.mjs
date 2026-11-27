import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeAnswers, pageContext, startAnswerServer, main } from '../core/answer.mjs';
import { renderDsReport } from '../core/ds-report.mjs';
import { readRules } from '../core/rules-file.mjs';

const QUESTIONS = [
  { key: 'grid4|space|10|12', cat: 'space', code: 'GRID4', text: 'space 10 px: use 12 px?', options: [8, 12, 10], default: 12, affects: 14 },
  { key: 'project.grid4', cat: 'space', code: 'GRID4', text: 'all off-grid?', options: ['accept-all', 'ask-each'], default: 'ask-each', affects: 30 },
  { key: 'project.i18n', cat: 'project', code: 'PROJECT', text: 'Languages? </script><b>', options: null, default: 'vi', affects: 18 },
  { key: 'project.lineHeightInt', cat: 'type', code: 'LINE_HEIGHT_INT', text: 'round?', options: ['yes', 'no'], default: 'yes', affects: 9, answered: 'yes' },
];
const RULES = { version: 1, answers: { 'project.lineHeightInt': 'yes' }, notes: { about: 'kept' }, states: { approved: true, pressed: { overlay: 0.1 } } };

test('mergeAnswers keeps every other key, stores the option itself, adds and changes answers', () => {
  const r = mergeAnswers({ rules: RULES, questions: QUESTIONS, answers: { 'grid4|space|10|12': '12', 'project.i18n': ' vi, en ', 'project.lineHeightInt': 'no' } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.saved, 3);
  assert.deepEqual(r.rules.answers, { 'project.lineHeightInt': 'no', 'grid4|space|10|12': 12, 'project.i18n': 'vi, en' });
  assert.deepEqual(r.rules.notes, RULES.notes);
  assert.deepEqual(r.rules.states, RULES.states);
  assert.equal(Object.keys(r.rules)[0], 'version');
  assert.deepEqual(RULES.answers, { 'project.lineHeightInt': 'yes' }, 'input not mutated');
});

test('mergeAnswers is all or nothing: an unknown key, a value off the options or an empty free answer saves none', () => {
  for (const answers of [{ nope: 1 }, { 'grid4|space|10|12': 11 }, { 'project.i18n': '  ' }, { 'project.i18n': 3 }]) {
    const r = mergeAnswers({ rules: RULES, questions: QUESTIONS, answers: { 'project.grid4': 'accept-all', ...answers } });
    assert.equal(r.saved, 0);
    assert.equal(r.errors.length, 1, JSON.stringify(answers));
    assert.equal(r.rules, RULES);
  }
  assert.equal(mergeAnswers({ rules: RULES, questions: QUESTIONS, answers: [] }).errors.length, 1);
});

test('design-system.html: inputs on every open card, the answer bar and the run context (script-safe)', () => {
  const html = renderDsReport({ questions: QUESTIONS, answer: { rulesPath: 'E:/p/vd-rules.json', rules: RULES } });
  for (const q of QUESTIONS.filter((x) => !x.answered)) assert.match(html, new RegExp(`data-key="${q.key.replace(/[|.]/g, '\\$&')}"[^>]*data-default="`));
  assert.equal((html.match(/<input type="radio" name="grid4\|space\|10\|12"/g) || []).length, 3);
  assert.match(html, /<input type="radio" name="grid4\|space\|10\|12" value="12">/);
  assert.match(html, /<input type="text" class="free" name="project\.i18n" placeholder="vi"/);
  assert.match(html, /<div id="answerbar">[\s\S]*class="submit primary"/);
  assert.equal(html.match(/<\/script>/g).length, 2, 'the question text cannot close a script');
  assert.deepEqual(pageContext(html), { rulesPath: 'E:/p/vd-rules.json', rules: RULES });
  const none = renderDsReport({ questions: [QUESTIONS[3]] });
  assert.doesNotMatch(none, /id="answerbar"/);
});

async function post(url, body, headers = {}) {
  const r = await fetch(new URL('answers', url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
}

test('server: GET serves the page, POST merges into the rules file with a backup, bad answers change nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-answer-'));
  const rulesPath = join(dir, 'vd-rules.json');
  writeFileSync(rulesPath, JSON.stringify(RULES, null, 2));
  writeFileSync(join(dir, 'questions.json'), JSON.stringify(QUESTIONS));
  writeFileSync(join(dir, 'design-system.html'), renderDsReport({ questions: QUESTIONS, answer: { rulesPath, rules: RULES } }));
  const srv = await startAnswerServer({ dir, rulesPath });
  try {
    const page = await fetch(srv.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="answerbar"/);

    const bad = await post(srv.url, { answers: { 'grid4|space|10|12': 7 } });
    assert.equal(bad.status, 400);
    assert.match(bad.j.error, /not one of/);
    assert.equal(existsSync(`${rulesPath}.bak`), false);

    const ok = await post(srv.url, { answers: { 'grid4|space|10|12': 12, 'project.grid4': 'accept-all' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    assert.deepEqual([ok.j.saved, ok.j.total], [2, 3]);
    const saved = readRules(rulesPath);
    assert.deepEqual(saved.answers, { 'project.lineHeightInt': 'yes', 'grid4|space|10|12': 12, 'project.grid4': 'accept-all' });
    assert.deepEqual(saved.states, RULES.states);
    assert.deepEqual(JSON.parse(readFileSync(`${rulesPath}.bak`, 'utf8')), RULES);

    assert.equal((await post(srv.url, { answers: {} }, { origin: 'https://evil.example' })).status, 403);
    const plain = await fetch(new URL('answers', srv.url), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(plain.status, 415);
  } finally { await srv.close(); }
});

test('main: the rules path comes from the page; a missing rules file is created on submit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-answer-'));
  const rulesPath = join(dir, 'new', '..', 'vd-rules.json');
  writeFileSync(join(dir, 'questions.json'), JSON.stringify(QUESTIONS));
  writeFileSync(join(dir, 'design-system.html'), renderDsReport({ questions: QUESTIONS, answer: { rulesPath, rules: null } }));
  const logs = [];
  let opened = null;
  const r = await main(['--out', dir], { log: (s) => logs.push(s), open: (u) => { opened = u; } });
  try {
    assert.equal(r.code, 0);
    assert.equal(opened, r.url);
    assert.match(logs.join('\n'), /created on the first submit/);
    const ok = await post(r.url, { answers: { 'project.i18n': 'vi' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    assert.deepEqual(readRules(rulesPath).answers, { 'project.i18n': 'vi' });
  } finally { await r.close(); }
  const none = mkdtempSync(join(tmpdir(), 'vd-answer-'));
  writeFileSync(join(none, 'questions.json'), '[]');
  writeFileSync(join(none, 'design-system.html'), renderDsReport({ questions: QUESTIONS }));
  assert.equal((await main(['--out', none], { log: () => {}, open: () => {} })).code, 2, 'no rules path anywhere');
  assert.equal((await main([], { log: () => {} })).code, 2);
});
