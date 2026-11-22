import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventory, roleSig } from '../core/inventory.mjs';

// Hand-built IR (capture) and modelled spec (infer + figma-model) for one screen; no browser.
const border = (c) => [0, 1, 2, 3].map(() => ({ w: 1, style: 'solid', color: c }));
const font = (o = {}) => ({ ff: '"Foo", sans-serif', fs: '16px', fw: '400', fst: 'normal', lh: 24, ls: 'normal', c: 'rgb(17, 24, 39)', tt: 'none', ...o });
const lay = (o = {}) => ({ d: 'V', p: [0, 0, 0, 0], g: 0, pa: 'S', ca: 'S', ...o });

function fixture(id = 'home', withTok = true) {
  const tok = (o) => (withTok ? { tok: o } : {});
  const ir = {
    id, name: id, vars: withTok ? { '--bg': { value: 'rgb(250,250,250)', uses: 1 }, '--line': { value: 'rgb(229,231,235)', uses: 4 } } : {},
    tree: {
      id: '0', kind: 'frame', tag: 'div', cls: 'scr', paint: { bg: 'rgb(250, 250, 250)' }, ...tok({ bg: '--bg', paddingT: '--pad' }),
      kids: [
        {
          id: '0.0', kind: 'frame', tag: 'div', cls: 'card', ...tok({ borderT: '--line', borderR: '--line', borderB: '--line', borderL: '--line', radius: '--r' }),
          paint: { bg: 'rgb(255, 255, 255)', border: border('rgb(229, 231, 235)'), radius: ['8px', '8px', '8px', '8px'] },
          kids: [{
            id: '0.0.0', kind: 'text', tag: 'p', cls: 'title', paint: {}, font: font(), ...tok({ color: '--fg', fontSize: '--fs' }),
            runs: [{ t: 'Hello ' }, { t: 'world', s: { fw: '700' } }, { br: 1 }, { t: 'again', s: { c: 'rgb(220, 38, 38)' } }],
          }],
        },
        {
          id: '0.1', kind: 'frame', tag: 'div', cls: 'row', paint: {},
          kids: [
            { id: '0.1.0', kind: 'frame', tag: 'button', cls: 'chip is-on', paint: { bg: 'rgb(37, 99, 235)' } },
            { id: '0.1.1', kind: 'frame', tag: 'button', cls: 'chip', paint: { bg: 'color-mix(in srgb, red, blue)' } },
            { id: '0.1.2', kind: 'icon', tag: 'svg', cls: 'ico', paint: {}, icon: { fill: 'rgb(37, 99, 235)', stroke: 'none', color: 'rgb(0, 0, 0)' }, ...tok({ fill: '--accent' }) },
          ],
        },
        { id: '0.2', kind: 'frame', tag: 'div', cls: 'fill', paint: { opacity: 0.5 } },
        {
          id: '0.3', kind: 'frame', tag: 'ul', cls: 'list', paint: {},
          kids: [{ id: '0.3.0', kind: 'frame', tag: 'li', cls: 'item', paint: {} }, { id: '0.3.1', kind: 'frame', tag: 'li', cls: 'item active', paint: {} }],
        },
      ],
    },
  };
  const spec = {
    id: '0', t: 'F', w: 390, h: 800, sz: ['FIXED', 'FIXED'], paint: ir.tree.paint, lay: lay({ p: [16, 16, 16, 16], g: 12 }), model: 'figma',
    kids: [
      {
        id: '0.0', t: 'F', w: 358, h: 80, sz: ['FILL', 'HUG'], paint: { ...ir.tree.kids[0].paint, strokeOverlay: true }, lay: lay({ p: [12, 12, 12, 12] }),
        kids: [{
          id: '0.0.0', t: 'T', w: 120, h: 48, sz: ['FILL', 'HUG'], font: font({ ff: 'Inter', sub: true }),
          runs: [{ t: 'Hello ' }, { t: 'world', s: { fw: '700' } }, { br: 1 }, { t: 'again', s: { c: 'rgb(220, 38, 38)' } }],
        }],
      },
      {
        id: '0.1', t: 'F', w: 358, h: 40, sz: ['FILL', 'FIXED'], lay: lay({ d: 'H', g: undefined, sb: 1 }),
        kids: [
          { id: '0.1.0', t: 'F', w: 64, h: 32, sz: ['FIXED', 'FIXED'], paint: { bg: 'rgb(37, 99, 235)' } },
          { id: '0.1.1', t: 'F', w: 64, h: 32, sz: ['FIXED', 'FIXED'], paint: { bg: 'color-mix(in srgb, red, blue)' } },
          { id: '0.1.2', t: 'V', w: 20, h: 20, sz: ['FIXED', 'FIXED'], icon: ir.tree.kids[1].kids[2].icon },
        ],
      },
      { id: '0.2', t: 'F', w: 358, h: 10, sz: ['FILL', 'HUG'], paint: { opacity: 0.5 } },
      {
        id: '0.3', t: 'F', w: 358, h: 40, sz: ['FILL', 'HUG'], lay: lay(),
        kids: [{
          id: '0.3.g0', t: 'F', syn: 'row', w: 200, h: 40, sz: ['HUG', 'HUG'], lay: lay({ d: 'H', g: 8, p: [0, 4, 0, 0] }),
          kids: [{ id: '0.3.0', t: 'F', w: 96, h: 40, sz: ['FIXED', 'FIXED'] }, { id: '0.3.1', t: 'F', w: 96, h: 40, sz: ['FIXED', 'FIXED'] }],
        }],
      },
    ],
  };
  return { screen: ir, spec };
}

const of = (inv, node, cat, prop) => inv.uses.filter((u) => u.node === node && (!cat || u.cat === cat) && (!prop || u.prop === prop));

test('padding 12 on all sides gives 4 space uses; zero padding and zero gap give none', () => {
  const inv = inventory([fixture()]);
  const sp = of(inv, '0.0', 'space');
  assert.deepEqual(sp.map((u) => [u.prop, u.value]), [['paddingB', 12], ['paddingL', 12], ['paddingR', 12], ['paddingT', 12]]);
  assert.ok(sp.every((u) => u.raw === '12px' && u.flex === undefined));
  assert.equal(of(inv, '0.3', 'space').length, 0);
  assert.deepEqual(of(inv, '0', 'space', 'gap').map((u) => u.value), [12]);
});

test('space-between gives a flex use without a value', () => {
  const [u] = of(inventory([fixture()]), '0.1', 'space');
  assert.equal(u.prop, 'gap');
  assert.equal(u.flex, 'sb');
  assert.equal(u.value, undefined);
  assert.equal(of(inventory([fixture()]), '0.1', 'space').length, 1);
});

test('size: only FIXED axes of frames; FILL/HUG, text, the screen root and icons give no size use', () => {
  const inv = inventory([fixture()]);
  assert.deepEqual(of(inv, '0.1', 'size').map((u) => [u.prop, u.value]), [['height', 40]]);
  assert.deepEqual(of(inv, '0.1.0', 'size').map((u) => [u.prop, u.value]), [['height', 32], ['width', 64]]);
  for (const id of ['0', '0.0', '0.2', '0.0.0', '0.1.2', '0.3.g0']) assert.equal(of(inv, id, 'size').length, 0, id);
  assert.deepEqual(of(inv, '0.1.2', 'icon').map((u) => [u.prop, u.value]), [['height', 20], ['width', 20]]);
});

test('a 1px border is cat border (width) plus a colour use per side, never space', () => {
  const inv = inventory([fixture()]);
  const b = of(inv, '0.0', 'border');
  assert.deepEqual(b.map((u) => [u.prop, u.value, u.raw]), ['borderB', 'borderL', 'borderR', 'borderT'].map((p) => [p, 1, '1px solid']));
  assert.ok(b.every((u) => u.token === undefined));
  const c = of(inv, '0.0', 'color').filter((u) => u.prop.startsWith('border'));
  assert.equal(c.length, 4);
  assert.ok(c.every((u) => u.value === '#e5e7eb' && u.raw === 'rgb(229, 231, 235)' && u.token === '--line'));
  assert.ok(!inv.uses.some((u) => u.cat === 'space' && u.value === 1));
  assert.deepEqual(of(inv, '0.0', 'radius').map((u) => [u.prop, u.value, u.token]),
    [['radiusBL', 8, '--r'], ['radiusBR', 8, '--r'], ['radiusTL', 8, '--r'], ['radiusTR', 8, '--r']]);
});

test('.chip.is-on and .chip under the same parent share the role; state classes are dropped', () => {
  const inv = inventory([fixture()]);
  const [a] = of(inv, '0.1.0', 'color', 'bg'), [b] = of(inv, '0.1.1', 'color', 'bg');
  assert.equal(a.role, b.role);
  assert.equal(a.role, 'color|bg|button.chip|div.row');
  assert.equal(roleSig('button', 'is-on chip active selected disabled on z-a'), 'button.chip.z-a');
  const [s0] = of(inv, '0.3.0', 'size', 'width'), [s1] = of(inv, '0.3.1', 'size', 'width');
  assert.equal(s0.role, s1.role); // parent is the source parent (ul.list), not the synthetic row
  assert.equal(s0.role, 'size|width|li.item|ul.list');
});

test('a synthetic frame contributes its spacing; its role is syn kind + source parent', () => {
  const inv = inventory([fixture()]);
  const sp = of(inv, '0.3.g0', 'space');
  assert.deepEqual(sp.map((u) => [u.prop, u.value, u.role]), [['gap', 8, 'space|gap|syn:row|ul.list'], ['paddingR', 4, 'space|paddingR|syn:row|ul.list']]);
  assert.ok(sp.every((u) => u.token === undefined));
});

test('nested text styles give one type use per distinct style; family is the Figma family, raw the source list', () => {
  const inv = inventory([fixture()]);
  const t = of(inv, '0.0.0', 'type');
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((u) => u.value), [
    { family: 'Inter', size: 16, weight: 400, style: 'normal', lineHeight: 24, letterSpacing: 0, transform: 'none' },
    { family: 'Inter', size: 16, weight: 700, style: 'normal', lineHeight: 24, letterSpacing: 0, transform: 'none' },
  ]);
  assert.ok(t.every((u) => u.raw === '"Foo", sans-serif'));
  assert.deepEqual(t.map((u) => u.tokens), [{ size: '--fs' }, { size: '--fs' }]);
  const c = of(inv, '0.0.0', 'color');
  assert.deepEqual(c.map((u) => [u.value, u.token]), [['#111827', '--fg'], ['#dc2626', undefined]]);
});

test('colours: hex value, CSS raw kept; an unreadable colour is kept as unparsed, never dropped or black', () => {
  const inv = inventory([fixture()]);
  const [root] = of(inv, '0', 'color', 'bg');
  assert.deepEqual([root.value, root.raw, root.token], ['#fafafa', 'rgb(250, 250, 250)', '--bg']);
  const [bad] = of(inv, '0.1.1', 'color', 'bg');
  assert.equal(bad.value, null);
  assert.equal(bad.unparsed, true);
  assert.equal(bad.raw, 'color-mix(in srgb, red, blue)');
  const ic = of(inv, '0.1.2', 'color');
  assert.deepEqual(ic.map((u) => [u.prop, u.value, u.token]), [['fill', '#2563eb', '--accent']]); // stroke none, svg color unused
  assert.deepEqual(of(inv, '0.2', 'opacity').map((u) => u.value), [0.5]);
});

test('without tok (capture before Task 1) token is undefined; vars are merged across screens', () => {
  const inv = inventory([fixture('a'), fixture('b', false)]);
  assert.ok(inv.uses.filter((u) => u.screen === 'b').every((u) => u.token === undefined && u.tokens === undefined));
  assert.deepEqual(inv.vars['--line'], { value: 'rgb(229,231,235)', uses: 4, screens: ['a'] });
  const inv2 = inventory([fixture('a'), { ...fixture('c'), screen: { ...fixture('c').screen, vars: { '--line': { value: 'red', uses: 2 } } } }]);
  assert.deepEqual(inv2.vars['--line'], { value: 'rgb(229,231,235)', uses: 6, screens: ['a', 'c'], values: { a: 'rgb(229,231,235)', c: 'red' } });
});

test('deterministic: shuffling screens and kids (IR and spec) gives the same inventory', () => {
  const rev = (n) => { if (n.kids) { n.kids.reverse(); n.kids.forEach(rev); } return n; };
  const a = inventory([fixture('a'), fixture('b'), fixture('c', false)]);
  const shuffled = [fixture('c', false), fixture('a'), fixture('b')].map((s) => ({ screen: { ...s.screen, tree: rev(s.screen.tree) }, spec: rev(s.spec) }));
  const b = inventory(shuffled);
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  // sorted by screen, then node in tree order (DOM path), then cat, prop
  const nodes = a.uses.filter((u) => u.screen === 'a').map((u) => u.node);
  assert.deepEqual([...new Set(nodes)], ['0', '0.0', '0.0.0', '0.1', '0.1.0', '0.1.1', '0.1.2', '0.2', '0.3.g0', '0.3.0', '0.3.1']);
});
