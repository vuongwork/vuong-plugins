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
    id, name: id,
    vars: withTok ? {
      '--bg': { value: 'rgb(250,250,250)', uses: 1 }, '--line': { value: 'rgb(229,231,235)', uses: 4 }, '--r': { value: '8px', uses: 1 },
      '--fg': { value: '#111827', uses: 1 }, '--accent': { value: 'rgb(37 99 235)', uses: 1 }, '--pad': { value: '16px', uses: 1 },
    } : {},
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

test('R63: type raw is the family the source authored, mapped back through screen.fontSubs', () => {
  const fx = fixture();
  fx.screen.tree.kids[0].kids[0].font = font({ ff: '"Inter"' }); // capture's override already rewrote the IR family
  const withSubs = (subs) => inventory([{ ...fx, screen: { ...fx.screen, fontSubs: subs } }]);
  let t = of(withSubs([{ from: 'Foo Sans', to: 'Inter', reason: 'not-in-figma' }]), '0.0.0', 'type');
  assert.ok(t.every((u) => u.raw === 'Foo Sans' && u.rawCandidates === undefined && u.value.family === 'Inter'));
  // kept families ('version', 'version-failed', 'override-failed') never map back
  for (const reason of ['version', 'version-failed', 'override-failed']) {
    t = of(withSubs([{ from: 'Foo Sans', to: 'Inter', reason }]), '0.0.0', 'type');
    assert.ok(t.every((u) => u.raw === '"Inter"'), reason);
  }
  // two sources measured in the same Figma family: ambiguous, the IR list stays and the candidates are listed
  t = of(withSubs([{ from: 'Zed', to: 'Inter', reason: 'system' }, { from: 'Foo Sans', to: 'Inter', reason: 'not-loaded' }]), '0.0.0', 'type');
  assert.ok(t.every((u) => u.raw === '"Inter"' && JSON.stringify(u.rawCandidates) === '["Foo Sans","Zed"]'));
  // no substitution for this family
  t = of(withSubs([{ from: 'Bar', to: 'Roboto', reason: 'system' }]), '0.0.0', 'type');
  assert.ok(t.every((u) => u.raw === '"Inter"'));
});

test('R64: a length or colour token is attached only when the variable resolves to the use value', () => {
  const fx = fixture();
  const card = fx.screen.tree.kids[0];
  card.tok = { ...card.tok, paddingT: '--p12', paddingR: '--p13', paddingB: '--prem', paddingL: '--nope' };
  fx.spec.kids[0].lay.p = [12.2, 12, 12, 12];
  fx.screen.vars = { ...fx.screen.vars, '--p12': { value: '12px', uses: 1 }, '--p13': { value: ' 13px ', uses: 1 }, '--prem': { value: '0.75rem', uses: 1 }, '--r': { value: '6px', uses: 1 }, '--bg': { value: '#fff', uses: 1 } };
  const inv = inventory([fx]);
  const sp = Object.fromEntries(of(inv, '0.0', 'space').map((u) => [u.prop, [u.token, u.tokenMismatch]]));
  assert.deepEqual(sp, { paddingT: ['--p12', undefined], paddingR: [undefined, '--p13'], paddingB: [undefined, '--prem'], paddingL: [undefined, '--nope'] });
  assert.ok(of(inv, '0.0', 'radius').every((u) => u.token === undefined && u.tokenMismatch === '--r'));
  const [bg] = of(inv, '0', 'color', 'bg'); // #fafafa vs --bg #ffffff
  assert.deepEqual([bg.token, bg.tokenMismatch], [undefined, '--bg']);
  const borderC = of(inv, '0.0', 'color').filter((u) => u.prop.startsWith('border'));
  assert.ok(borderC.every((u) => u.token === '--line' && u.tokenMismatch === undefined)); // rgb(229,231,235) = #e5e7eb
});

test('icon and image size uses carry the sizes at A and B; icons say whether the axis is FIXED', () => {
  const fx = fixture();
  const row = fx.screen.tree.kids[1];
  row.kids[2].rA = [0, 0, 18, 18]; row.kids[2].rB = [0, 0, 18, 18];
  row.kids.push({ id: '0.1.3', kind: 'image', tag: 'img', cls: 'av', paint: {}, rA: [0, 0, 32, 32], rB: [0, 0, 40, 40] });
  fx.spec.kids[1].kids.push({ id: '0.1.3', t: 'I', w: 32, h: 32, sz: ['FIXED', 'FIXED'], src: 'a.png' });
  fx.spec.kids[1].kids[2] = { ...fx.spec.kids[1].kids[2], sz: ['FIXED', 'FILL'] };
  const inv = inventory([fx]);
  assert.deepEqual(of(inv, '0.1.2', 'icon').map((u) => [u.prop, u.sizes, u.fixed]), [['height', [18, 18, 18, 18], false], ['width', [18, 18, 18, 18], true]]);
  assert.deepEqual(of(inv, '0.1.3', 'size').map((u) => [u.prop, u.value, u.sizes, u.img]), [['height', 32, [32, 32, 40, 40], true], ['width', 32, [32, 32, 40, 40], true]]);
  assert.ok(of(inv, '0.1.0', 'size').every((u) => u.sizes === undefined && u.img === undefined));
});

test('R67: space, size and radius under 0.5 px are geometry noise: marked, value kept for tracing; 0.5 px is not noise', () => {
  const fx = fixture();
  fx.spec.kids[0].lay.p = [12, 0.02, 0.5, 0.01];
  fx.spec.kids[0].paint = { ...fx.spec.kids[0].paint, radius: ['0.3px', '8px', '8px', '8px'] };
  fx.spec.kids[1].kids[0] = { ...fx.spec.kids[1].kids[0], h: 0.4 };
  const inv = inventory([fx]);
  const sp = Object.fromEntries(of(inv, '0.0', 'space').map((u) => [u.prop, [u.value, u.noise]]));
  assert.deepEqual(sp, { paddingT: [12, undefined], paddingR: [0.02, true], paddingB: [0.5, undefined], paddingL: [0.01, true] });
  const r = Object.fromEntries(of(inv, '0.0', 'radius').map((u) => [u.prop, u.noise]));
  assert.deepEqual(r, { radiusTL: true, radiusTR: undefined, radiusBR: undefined, radiusBL: undefined });
  assert.deepEqual(of(inv, '0.1.0', 'size').map((u) => [u.prop, u.noise]), [['height', true], ['width', undefined]]);
  // borders and icons are never noise
  assert.ok(inv.uses.filter((u) => u.cat === 'border' || u.cat === 'icon').every((u) => u.noise === undefined));
});

test('M2-a: an svg root fill that is the initial black and reaches no shape gives no fill use', () => {
  const mk = (icon, svgDefs) => {
    const fx = fixture();
    fx.screen.tree.kids[1].kids[2].icon = icon;
    fx.screen.tree.kids[1].kids[2].tok = {};
    fx.spec.kids[1].kids[2].icon = icon;
    if (svgDefs) fx.screen.svgDefs = svgDefs;
    return of(inventory([fx]), '0.1.2', 'color').map((u) => [u.prop, u.value]);
  };
  const black = { color: 'rgb(38, 51, 92)', fill: 'rgb(0, 0, 0)', stroke: 'rgb(38, 51, 92)', sw: '1px' };
  // stroke icon: every shape sits in <g fill="none"> -> the root fill paints nothing
  assert.deepEqual(mk({ ...black, svg: '<svg viewBox="0 0 24 24"><g fill="none" stroke-width="2"><path d="M3 4h2"></path><circle cx="9" cy="19" r="1.4"></circle></g></svg>' }),
    [['stroke', '#26335c']]);
  // fill set on the shape itself (attribute or inlined style) and a line (no interior): nothing inherits
  assert.deepEqual(mk({ ...black, svg: '<svg><path d="M1 1" fill="none"></path><rect width="2" height="2" style="fill: rgb(1, 2, 3);"></rect><line x1="0" y1="0" x2="1" y2="1"></line></svg>' }),
    [['stroke', '#26335c']]);
  // sprite icon (R54): the markup is the symbol in screen.svgDefs
  assert.deepEqual(mk({ ...black, ref: 'i-back' }, { 'i-back': '<symbol id="i-back" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke-width="2.2"></path></symbol>' }),
    [['stroke', '#26335c']]);
  // a plain <path> with no fill inherits the root's black: the use stays
  assert.deepEqual(mk({ ...black, svg: '<svg viewBox="0 0 24 24"><path d="M12 5v14"></path></svg>' }), [['fill', '#000000'], ['stroke', '#26335c']]);
  // a <use> whose target (in the leading defs) has a shape with no fill inherits too
  assert.deepEqual(mk({ ...black, svg: '<svg><defs><path id="p" d="M1 1"></path></defs><use href="#p"></use></svg>' }), [['fill', '#000000'], ['stroke', '#26335c']]);
  // fill="inherit" is not an explicit fill
  assert.deepEqual(mk({ ...black, svg: '<svg><path d="M1 1" fill="inherit"></path></svg>' }), [['fill', '#000000'], ['stroke', '#26335c']]);
  // a sprite whose markup is missing, or no markup at all: kept (cannot tell)
  assert.deepEqual(mk({ ...black, ref: 'gone' }), [['fill', '#000000'], ['stroke', '#26335c']]);
  // a root fill that is not the initial black is always listed
  assert.deepEqual(mk({ ...black, fill: 'rgb(37, 99, 235)', svg: '<svg><g fill="none"><path d="M1 1"></path></g></svg>' }), [['fill', '#2563eb'], ['stroke', '#26335c']]);
});

test('R70 / R71: radius uses carry the node box at A and pill when radius >= half the smaller side; icon uses carry the box', () => {
  const fx = fixture();
  fx.spec.kids[0].paint = { ...fx.spec.kids[0].paint, radius: ['40px', '39.9px', '99px', '8px'] }; // card 358 x 80
  const inv = inventory([fx]);
  const r = Object.fromEntries(of(inv, '0.0', 'radius').map((u) => [u.prop, [u.box, u.pill]]));
  assert.deepEqual(r, { radiusTL: [[358, 80], true], radiusTR: [[358, 80], undefined], radiusBR: [[358, 80], true], radiusBL: [[358, 80], undefined] });
  assert.ok(of(inv, '0.1.2', 'icon').every((u) => JSON.stringify(u.box) === '[20,20]'));
});

test('R74: an icon axis the spec made FILL carries the flex item natural size (capture flex.n) when it may only shrink', () => {
  const fx = fixture();
  const row = fx.screen.tree.kids[1];
  // the Planora .say avatar: svg width 34 squashed to 26 at A by flex-shrink, 34 at B
  Object.assign(row.kids[2], { rA: [0, 0, 26, 34], rB: [0, 0, 34, 34], flex: { g: 0, s: 1, b: 'auto', ax: 'x', n: 34 } });
  fx.spec.kids[1].kids[2] = { ...fx.spec.kids[1].kids[2], w: 26, h: 34, sz: ['FILL', 'FIXED'] };
  let inv = inventory([fx]);
  assert.deepEqual(of(inv, '0.1.2', 'icon').map((u) => [u.prop, u.fixed, u.natural]), [['height', true, undefined], ['width', false, 34]]);
  // a growing item (flex-grow > 0), a cross axis or a FIXED axis: no natural
  row.kids[2].flex = { g: 1, s: 1, b: 'auto', ax: 'x', n: 34 };
  inv = inventory([fx]);
  assert.equal(of(inv, '0.1.2', 'icon', 'width')[0].natural, undefined);
  row.kids[2].flex = { g: 0, s: 1, b: 'auto', ax: 'y', n: 34 };
  inv = inventory([fx]);
  assert.ok(of(inv, '0.1.2', 'icon').every((u) => u.natural === undefined));
});
