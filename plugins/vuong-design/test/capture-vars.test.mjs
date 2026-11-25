import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScreens } from '../core/capture.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

const walk = (n, out = []) => { out.push(n); (n.kids || []).forEach((k) => walk(k, out)); return out; };
const byCls = (s, cls) => walk(s.tree).filter((n) => n.cls.split(/\s+/).includes(cls));

let s, plain;
before(async () => {
  if (skip) return;
  s = (await captureScreens(join(FIX, 'vars.html'), { root: '.scr', fontOverride: false })).screens[0];
  plain = (await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr', fontOverride: false })).screens[0];
});

test('vars: declared custom properties with their :root value, not the browser\'s', { skip }, () => {
  assert.deepEqual(Object.keys(s.vars).sort(), ['--accent', '--bg', '--fg', '--fw', '--gap', '--line', '--pad', '--r', '--s', '--same']);
  assert.equal(s.vars['--fg'].value, 'rgb(17,24,39)');
  assert.equal(s.vars['--s'].value, '0.75rem');
  assert.equal(s.varsUnreadable, 0);
});

test('vars: colours as hex, rgb() and named keywords match the computed value', { skip }, () => {
  const root = s.tree;
  assert.equal(root.tok.bg, '--bg'); // #FAFAFA vs rgb(250, 250, 250)
  const card = byCls(s, 'card')[0];
  assert.equal(card.tok.bg, '--accent'); // royalblue vs rgb(65, 105, 225)
  assert.equal(card.kids[0].tok.color, '--fg'); // rgb(17,24,39), inherited from the screen root
});

test('vars: lengths in px and rem; per-side padding and border', { skip }, () => {
  const root = s.tree;
  for (const k of ['paddingT', 'paddingR', 'paddingB', 'paddingL']) assert.equal(root.tok[k], '--pad');
  const card = byCls(s, 'card')[0];
  assert.equal(card.tok.paddingT, '--s'); // 0.75rem vs 12px
  assert.equal(card.tok.paddingB, '--s');
  assert.equal(card.tok.paddingR, undefined); // literal 4px
  for (const k of ['borderT', 'borderR', 'borderB', 'borderL']) assert.equal(card.tok[k], '--line');
  assert.equal(card.tok.radius, '--r');
  assert.equal(byCls(s, 'row')[0].tok.gap, '--gap');
  assert.equal(byCls(s, 'ico')[0].tok.fill, '--accent');
  assert.equal(s.vars['--line'].uses, 4);
});

test('vars: a variable redefined in a subtree points at the right name with the local value', { skip }, () => {
  const t = byCls(s, 't')[0];
  assert.equal(t.font.c, 'rgb(255, 255, 255)');
  assert.equal(t.tok.color, '--fg');
  assert.equal(t.tok.fontWeight, '--fw'); // bold vs 700
  assert.equal(byCls(s, 'dark')[0].tok?.color, undefined); // a frame carries no text tokens
});

test('vars: a var() declaration overridden by a more specific plain rule gives no token', { skip }, () => {
  const o = byCls(s, 'over')[0];
  assert.equal(o.font.c, 'rgb(255, 0, 0)');
  assert.equal(o.tok?.color, undefined);
});

test('vars: two names with the same value: the cascade winner is used', { skip }, () => {
  const [a, b] = byCls(s, 'row')[0].kids;
  assert.equal(a.tok.bg, '--same');
  assert.equal(b.tok.bg, '--accent');
});

test('vars: calc(var()) gives no token and counts as complex', { skip }, () => {
  const c = byCls(s, 'calc')[0];
  assert.equal(c.tok?.paddingT, undefined);
  assert.ok(s.varsComplex >= 1);
});

test('vars: a page without custom properties has empty vars and no tok', { skip }, () => {
  assert.deepEqual(plain.vars, {});
  assert.equal(plain.varsComplex, 0);
  assert.ok(walk(plain.tree).every((n) => !n.tok));
});
