import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScreens, chooseWiden } from '../core/capture.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

const walk = (n, out = []) => { out.push(n); (n.kids || []).forEach((k) => walk(k, out)); return out; };

// ---- pure widen rule (no browser) ----

test('chooseWiden keeps the requested delta when no breakpoint is crossed', () => {
  const w = chooseWiden(300, [{ type: 'min', px: 600 }, { type: 'max', px: 200 }], 120);
  assert.deepEqual({ by: w.by, unsafe: w.unsafe }, { by: 120, unsafe: false });
  assert.deepEqual(w.breakpoints, [200, 600]);
});

test('chooseWiden lowers delta below a crossed min-width', () => {
  const w = chooseWiden(300, [{ type: 'min', px: 380 }, { type: 'min', px: 410 }], 120);
  assert.equal(w.by, 79);
  assert.equal(w.unsafe, false);
});

test('chooseWiden lowers delta to a crossed max-width', () => {
  const w = chooseWiden(300, [{ type: 'max', px: 360 }], 120);
  assert.equal(w.by, 60);
  assert.equal(w.unsafe, false);
});

test('chooseWiden flags unsafe and keeps requested delta when the safe delta is < 24', () => {
  const w = chooseWiden(300, [{ type: 'min', px: 310 }], 120);
  assert.equal(w.by, 120);
  assert.equal(w.unsafe, true);
  assert.match(w.reason, /310/);
});

// ---- browser capture ----

let basic;
before(async () => { if (!skip) basic = await captureScreens(join(FIX, 'capture-basic.html'), { root: '.scr', fontOverride: false }); });

test('basic: one screen measured at native and native + 120', { skip }, () => {
  assert.equal(basic.screens.length, 1);
  const s = basic.screens[0];
  assert.deepEqual(s.W, [300, 420]);
  assert.deepEqual(s.H, [600, 600]);
  assert.equal(s.id, 's0');
  assert.equal(s.name, 's0');
  assert.equal(s.widen.by, 120);
  assert.equal(s.widen.requested, 120);
  assert.equal(s.tree.id, 'n');
  assert.deepEqual(s.tree.rA, [0, 0, 300, 600]);
  assert.deepEqual(s.tree.rB, [0, 0, 420, 600]);
});

test('basic: ::after becomes an 8x8 pseudo node', { skip }, () => {
  const ps = walk(basic.screens[0].tree).filter((n) => n.kind === 'pseudo');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].rA.slice(2), [8, 8]);
  assert.deepEqual(ps[0].rB.slice(2), [8, 8]);
  assert.ok(ps[0].paint.bg, 'pseudo keeps its background');
});

test('basic: <svg><use href="#i"> is an icon leaf with symbol id and color', { skip }, () => {
  const ic = walk(basic.screens[0].tree).filter((n) => n.kind === 'icon');
  assert.equal(ic.length, 1);
  assert.equal(ic[0].icon.ref, 'i');
  assert.equal(ic[0].icon.color, 'rgb(51, 51, 51)');
  assert.equal(ic[0].kids, undefined);
});

test('basic: Vietnamese text wraps at 300 but not at 420', { skip }, () => {
  const t = walk(basic.screens[0].tree).find((n) => n.kind === 'text' && n.runs?.[0]?.t?.startsWith('Xin chào'));
  assert.ok(t, 'text node found');
  assert.deepEqual(t.lines, [2, 1]);
  assert.equal(t.runs[0].t, 'Xin chào thế giới');
  assert.equal(t.font.lh, 40);
  assert.ok(t.rA[2] <= 300 && t.rB[2] > 300, `widths ${t.rA[2]} / ${t.rB[2]}`);
  assert.equal(t.rA[3], 80);
  assert.equal(t.rB[3], 40);
});

test('basic: nested mixed-style text keeps one run per style', { skip }, () => {
  const t = walk(basic.screens[0].tree).find((n) => n.kind === 'text' && n.runs?.[0]?.t?.startsWith('Chữ'));
  assert.ok(t, 'mixed text node found');
  assert.deepEqual(t.runs.map((r) => r.t), ['Chữ ', 'đậm', ' và ', 'nghiêng', ' lồng nhau']);
  assert.equal(t.runs[1].s.fw, '700');
  assert.equal(t.runs[3].s.fst, 'italic');
  assert.equal(t.runs[0].s, undefined);
  assert.equal(typeof t.font.lh, 'number', 'line-height normal recorded as measured px');
  assert.deepEqual(t.lines, [1, 1]);
});

test('basic: hidden elements are excluded with a reason, never nodes', { skip }, () => {
  const s = basic.screens[0];
  assert.equal(s.excluded.length, 2);
  assert.deepEqual(s.excluded.map((e) => e.reason).sort(), ['display:none', 'visibility:hidden']);
  const ids = new Set(walk(s.tree).map((n) => n.id));
  for (const e of s.excluded) assert.ok(!ids.has(e.path), `${e.path} must not be a node`);
  const texts = walk(s.tree).flatMap((n) => (n.runs || []).map((r) => r.t || ''));
  assert.ok(!texts.some((t) => t.includes('Ẩn')), 'hidden text is not in any run');
});

test('basic: node ids are stable paths, unique, and fonts are listed', { skip }, () => {
  const s = basic.screens[0];
  const nodes = walk(s.tree);
  const ids = nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^n(\.[0-9a-z]+)*$/);
  for (const n of nodes) {
    assert.ok(['frame', 'text', 'icon', 'image', 'pseudo'].includes(n.kind), n.kind);
    assert.equal(n.rA.length, 4); assert.equal(n.rB.length, 4);
    assert.equal(typeof n.paint, 'object');
  }
  assert.ok(s.fonts.includes('Courier New'), s.fonts.join(','));
  assert.equal(typeof s.fontsRendered, 'object');
  for (const [list, fam] of Object.entries(s.fontsRendered)) assert.ok(fam && list.includes(fam.replace(/^["']|["']$/g, '')), `${list} -> ${fam}`);
});

test('root selector matching nothing rejects with "không tìm thấy màn" and the selector', { skip }, async () => {
  await assert.rejects(
    captureScreens(join(FIX, 'capture-basic.html'), { root: '.khong-co' }),
    (e) => e.message.includes('không tìm thấy màn') && e.message.includes('.khong-co'),
  );
});

test('zero-size and clipped elements are excluded with reasons; rotated box is measured un-rotated', { skip }, async () => {
  const ir = await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' });
  const s = ir.screens[0];
  assert.deepEqual(s.excluded.map((e) => e.reason).sort(), ['clipped', 'visibility:hidden', 'zero-size']);
  const rot = walk(s.tree).find((n) => n.cls === 'rot');
  assert.ok(rot, 'rotated node present');
  assert.deepEqual(rot.rA.slice(2), [100, 20]);
  assert.ok(rot.paint.transform, 'transform recorded in paint');
});

// Fixture variant written to a temp dir (cleaned) so the source fixture is never modified.
async function withVariant(edit, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'vd-bp-'));
  try {
    const p = join(dir, 'variant.html');
    writeFileSync(p, edit(readFileSync(join(FIX, 'capture-breakpoint.html'), 'utf8')));
    return await fn(p);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('visible child inside a visibility:hidden parent is kept; only the parent is excluded', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' })).screens[0];
  const hidden = s.excluded.find((e) => e.reason === 'visibility:hidden');
  const seen = walk(s.tree).find((n) => n.cls === 'seen');
  assert.ok(seen, 'visible child is a node');
  assert.ok(seen.id.startsWith(hidden.path + '.'), `${seen.id} under ${hidden.path}`);
  assert.equal(seen.runs[0].t, 'Thấy');
  const texts = walk(s.tree).flatMap((n) => (n.runs || []).map((r) => r.t || ''));
  assert.ok(!texts.some((t) => t.includes('Ẩn')), 'hidden parent text is not a run');
});

test('a childless zero-height box that paints (box-shadow) is kept', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' })).screens[0];
  const line = walk(s.tree).find((n) => n.cls === 'line');
  assert.ok(line, 'divider kept');
  assert.equal(line.rA[3], 0);
  assert.ok(line.paint.shadow);
});

test('bare text under white-space:pre keeps its spaces', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-hidden.html'), { root: '.scr' })).screens[0];
  const pre = walk(s.tree).find((n) => n.cls === 'pre');
  assert.equal(pre.kids[0].runs[0].t, 'a   b');
});

test('pseudo present only at width B does not shift sibling ids', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-pseudo-bp.html'), { root: '.scr', viewport: 300 })).screens[0];
  assert.deepEqual(s.W, [300, 420]);
  const row = walk(s.tree).find((n) => n.cls === 'row');
  const xs = row.kids.filter((n) => n.cls === 'x');
  assert.deepEqual(xs.map((n) => n.id), [`${row.id}.0`, `${row.id}.1`]);
  for (const x of xs) assert.ok(x.rB, `${x.id} matched at B`);
  assert.ok(xs[0].rB[0] > xs[0].rA[0], 'the ::before at B pushes the first item right');
  assert.ok(s.excluded.some((e) => e.path === `${row.id}.b` && e.reason === 'only-at-B'), JSON.stringify(s.excluded));
});

test('breakpoint: viewport-bound root, widen is lowered to stay under min-width 380', { skip }, async () => {
  const ir = await captureScreens(join(FIX, 'capture-breakpoint.html'), { root: '.scr', viewport: 300 });
  const s = ir.screens[0];
  assert.equal(s.widen.by, 79);
  assert.deepEqual(s.W, [300, 379]);
  assert.equal(s.widen.unsafe, false);
  assert.deepEqual(s.widen.breakpoints, [380]);
  // real behaviour: at 379 the min-width:380 rule is still off, so both items stay on one row
  const items = walk(s.tree).filter((n) => n.cls === 'item');
  assert.equal(items.length, 2);
  assert.equal(items[0].rB[1], items[1].rB[1]);
  assert.ok(items[1].rB[0] > items[0].rB[0]);
});

test('breakpoint: a 310 breakpoint leaves no safe delta -> unsafe, by 120', { skip }, async () => {
  await withVariant((src) => src.replace('380px', '310px'), async (p) => {
    const s = (await captureScreens(p, { root: '.scr', viewport: 300 })).screens[0];
    assert.equal(s.widen.unsafe, true);
    assert.equal(s.widen.by, 120);
    assert.match(s.widen.reason, /310/);
  });
});

test('breakpoint: root inside a wider page is not viewport-bound -> full delta, reason given', { skip }, async () => {
  await withVariant((src) => src.replace('.scr {', '.scr { width: 300px;'), async (p) => {
    const s = (await captureScreens(p, { root: '.scr' })).screens[0];
    assert.deepEqual(s.W, [300, 420]);
    assert.equal(s.widen.by, 120);
    assert.equal(s.widen.unsafe, false);
    assert.deepEqual(s.widen.breakpoints, [380]);
    assert.match(s.widen.reason, /viewport/);
  });
});

test('basic: flex intent recorded on flex items and containers', { skip }, () => {
  const nodes = walk(basic.screens[0].tree);
  const row = nodes.find((n) => n.cls === 'row');
  assert.deepEqual(row.flexBox, { jc: 'normal', fd: 'row', ov: false });
  const item = row.kids[0];
  assert.equal(item.flex.g, 1);
  assert.equal(item.flex.s, 1);
  assert.equal(item.flex.b, '0%');
  assert.equal(item.flex.ax, 'x');
  assert.equal(item.flex.n, item.rA[2]);
  assert.equal(nodes.find((n) => n.cls === 'hello').flex, undefined);
});

test('failed @font-face load: fontsRendered maps the list to serif and the model records a substitution', { skip }, async () => {
  const { defaultFontMap } = await import('../core/font-map.mjs');
  const { applyFigmaModel } = await import('../core/figma-model.mjs');
  const { inferScreen } = await import('../core/infer.mjs');
  const screen = (await captureScreens(join(FIX, 'capture-ghost-font.html'), { root: '.scr', fontOverride: false })).screens[0];
  const list = Object.keys(screen.fontsRendered).find((l) => l.includes('Ghost'));
  assert.ok(list, JSON.stringify(screen.fontsRendered));
  assert.equal(screen.fontsRendered[list], 'serif');
  const fm = defaultFontMap(['Ghost']); // pretend Figma has Ghost: the failure is Chrome's, so it must be not-loaded
  const { substitutions, flags } = applyFigmaModel(inferScreen(screen).spec, fm, { rendered: screen.fontsRendered });
  assert.ok(substitutions.some((s) => s.from === 'Ghost' && s.to === 'Inter' && s.reason === 'not-loaded'), JSON.stringify(substitutions));
  assert.ok(flags.some((f) => f.kind === 'fontSubstitution'));
});

test('basic: the screen carries the <symbol> markup its icons reference (svgDefs)', { skip }, () => {
  const s = basic.screens[0];
  assert.deepEqual(Object.keys(s.svgDefs), ['i']);
  assert.match(s.svgDefs.i, /^<symbol id="i" viewBox="0 0 24 24">/);
  assert.deepEqual(s.fontCss, { links: [], faces: [] });
});

test('@font-face rules are carried with absolute urls (fontCss.faces)', { skip }, async () => {
  const screen = (await captureScreens(join(FIX, 'capture-ghost-font.html'), { root: '.scr', fontOverride: false })).screens[0];
  assert.equal(screen.fontCss.faces.length, 1);
  assert.match(screen.fontCss.faces[0], /font-family: "?Ghost"?/);
  assert.match(screen.fontCss.faces[0], /url\("file:\/\/\/.*\/fixtures\/missing\.woff2"\)/);
});

// ---- font override (R10): substituted families are resolved before inference ----
// A local stand-in for the Figma family keeps these tests offline: Georgia is installed on Windows; elsewhere skip.
const localMap = (to) => {
  const available = ['Inter', to];
  return { available, substitute: (f) => (available.some((a) => a.toLowerCase() === String(f).trim().replace(/^["']|["']$/g, '').toLowerCase()) ? f : to) };
};
const winSkip = skip || (process.platform === 'win32' ? false : 'needs a locally installed Georgia (Windows)');
const textNodes = (s) => { const out = []; const v = (n) => { if (n.runs) out.push(n); (n.kids || []).forEach(v); }; v(s.tree); return out; };

test('fontOverride: system-ui text is measured in the Figma family and fontSubs lists it', { skip: winSkip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-system-font.html'), { root: '.scr', fontMap: localMap('Georgia'), webFonts: false, png: true })).screens[0];
  assert.deepEqual(s.fontSubs, [{ from: 'system-ui', to: 'Georgia', reason: 'system' }]);
  const texts = textNodes(s);
  assert.ok(texts.length >= 3, `text nodes: ${texts.length}`);
  for (const t of texts) assert.equal(t.font.ff, 'Georgia', `${t.id}: ${t.font.ff}`);
  assert.deepEqual(s.fonts, ['Georgia']);
  assert.ok(Buffer.isBuffer(s.pngOriginal), 'original-font PNG at A');
  assert.notDeepEqual(s.pngOriginal, s.png[0], 'the original-font image differs from the overridden one');

  const off = (await captureScreens(join(FIX, 'capture-system-font.html'), { root: '.scr', fontOverride: false })).screens[0];
  assert.equal(off.fontSubs, undefined);
  assert.ok(textNodes(off).every((t) => /system-ui/.test(t.font.ff)));
});

test('fontOverride: a target that cannot load keeps the original font and is listed as override-failed', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-system-font.html'), { root: '.scr', fontMap: localMap('Nope Sans Zz'), webFonts: false })).screens[0];
  assert.deepEqual(s.fontSubs, [{ from: 'system-ui', to: 'Nope Sans Zz', reason: 'override-failed', cause: 'system' }]);
  assert.ok(textNodes(s).every((t) => /system-ui/.test(t.font.ff)));
});

test('fontOverride: every used weight must exist in the target (a 400-only @font-face cannot take 700 text)', { skip: winSkip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-half-font.html'), { root: '.scr', fontMap: localMap('HalfFace'), webFonts: false })).screens[0];
  assert.deepEqual(s.fontSubs, [{ from: 'system-ui', to: 'HalfFace', reason: 'override-failed', cause: 'system' }]);
  assert.ok(textNodes(s).every((t) => /system-ui/.test(t.font.ff)), 'not overridden');
  // the same target is fine when only regular text uses it
  const ok = (await captureScreens(join(FIX, 'capture-system-font.html'), { root: '.scr', fontMap: localMap('Georgia'), webFonts: false })).screens[0];
  assert.deepEqual(ok.fontSubs.map((f) => f.reason), ['system']);
});

test('lineHeightOverride (R14): text with line-height normal is measured with an explicit px line-height', { skip }, async () => {
  const file = join(FIX, 'capture-normal-lh.html');
  const on = (await captureScreens(file, { root: '.scr', fontOverride: false })).screens[0];
  const off = (await captureScreens(file, { root: '.scr', fontOverride: false, lineHeightOverride: false })).screens[0];
  assert.equal(off.norm, undefined);
  // .scr, .t, .chip and .chip::before use 'normal' and contain text; .px has its own px value
  assert.equal(on.norm.lineHeight, 4, JSON.stringify(on.norm));
  const byText = (s, t) => textNodes(s).find((n) => n.runs.map((r) => r.t).join('').includes(t));
  for (const t of ['Hôm nay', 'tag', 'explicit']) {
    assert.equal(byText(on, t).font.lh, byText(off, t).font.lh, `${t}: the explicit value is the measured normal height`);
  }
  // boxes do not move: the explicit value equals the normal line height
  assert.deepEqual(textNodes(on).map((n) => n.rA), textNodes(off).map((n) => n.rA));
});

test('R40: a root is shot alone, neighbours that overlap it at B are hidden', { skip }, async () => {
  const { launchBrowser } = await import('../core/browser.mjs');
  const s = (await captureScreens(join(FIX, 'capture-isolate.html'), { root: '.scr', png: true })).screens[0];
  assert.equal(s.W[1], 320);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const rgb = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      return [...x.getImageData(520, 100, 1, 1).data].slice(0, 3); // CSS (260, 50) at device scale 2
    }, s.png[1].toString('base64'));
    assert.deepEqual(rgb, [255, 255, 255]);
  } finally { await browser.close(); }
});

test('R41: a Figma family rendered from a local install is measured in its Google Fonts face', { skip }, async (t) => {
  const plain = (await captureScreens(join(FIX, 'capture-local-font.html'), { root: '.scr', fontOverride: false })).screens[0];
  const list = Object.keys(plain.fontsRendered).find((l) => /Roboto/.test(l));
  if (plain.fontsRendered[list] !== 'Roboto') { t.skip('Roboto is not installed locally'); return; }
  const s = (await captureScreens(join(FIX, 'capture-local-font.html'), { root: '.scr' })).screens[0];
  assert.deepEqual(s.fontSubs, [{ from: 'Roboto', to: 'Roboto', reason: 'version' }]);
  const off = (await captureScreens(join(FIX, 'capture-local-font.html'), { root: '.scr', webFonts: false })).screens[0];
  assert.deepEqual(off.fontSubs, [], 'R9 opt-out: no web face is fetched, nothing to report');
});

test('R46: paint capture does not translate is listed as paint.unsupported at its origin', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'layout-unsupported.html'), { root: '.scr', fontOverride: false })).screens[0];
  const all = walk(s.tree);
  const un = all.filter((n) => n.paint && n.paint.unsupported).map((n) => [n.cls || n.tag, n.paint.unsupported.map((u) => u.prop).join(',')]);
  assert.deepEqual(un, [['big', 'text-shadow'], ['blend', 'mix-blend-mode'], ['li', 'list-marker']]);
  const big = all.find((n) => n.cls === 'big');
  assert.ok(big.rA[2] * big.rA[3] > 4000, 'larger than the crop limit');
});

test('R48: inline svg internals get the paint page CSS gave them inlined; what is not carried is unsupported', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-svgcss.html'), { root: '.scr', fontOverride: false })).screens[0];
  const all = walk(s.tree);
  const svg = (cls) => all.find((n) => n.cls === cls);
  const ic = svg('ic').icon.svg;
  assert.match(ic, /<rect [^>]*style="[^"]*fill: rgb\(229, 57, 53\)/);
  assert.match(ic, /<circle [^>]*style="[^"]*stroke: rgb\(30, 136, 229\)/);
  assert.match(ic, /<circle [^>]*style="[^"]*stroke-width: 3px/);
  assert.match(ic, /<circle [^>]*style="[^"]*opacity: 0\.5/);
  assert.match(ic, /<circle [^>]*style="[^"]*fill: none/);
  const rootTag = ic.match(/^<svg[^>]*>/)[0];
  assert.match(rootTag, /style="stroke-linejoin: round;?"/, 'the root keeps only the page paint the proxy does not set');
  assert.equal(svg('ic').paint.unsupported, undefined, 'everything .ic needs is carried');
  const un = svg('ic2').paint.unsupported || [];
  assert.deepEqual(un.map((u) => u.prop), ['svg rect transform'], JSON.stringify(un));
  const plain = svg('plain').icon.svg;
  assert.doesNotMatch(plain.replace(/^<svg[^>]*>/, ''), /style=/, 'presentation attributes only: nothing inlined inside');
  assert.equal(svg('plain').paint.unsupported, undefined);
});

test('R54: only an svg made of exactly one <use> is a sprite reference; any other svg is serialised whole with its <use> targets inlined', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-sprite-mixed.html'), { root: '.scr', fontOverride: false })).screens[0];
  const by = (cls) => walk(s.tree).find((n) => n.cls === cls);
  const one = by('one'), mixed = by('mixed');
  assert.equal(one.icon.ref, 'sq');
  assert.equal(one.icon.svg, undefined);
  assert.ok(s.svgDefs.sq, 'the sprite target is in svgDefs');
  assert.equal(mixed.icon.ref, null);
  assert.match(mixed.icon.svg, /<circle\b/);
  assert.match(mixed.icon.svg, /<use\b[^>]*href="#sq"/);
  assert.match(mixed.icon.svg, /<defs>.*<symbol\b[^>]*id="sq".*<\/defs>/s, 'the <use> target is inlined in the markup');
});

test('R59: an image fit or position Figma cannot reproduce (fit none / scale-down, position off centre) is unsupported', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-image-fit.html'), { root: '.scr', fontOverride: false })).screens[0];
  const imgs = walk(s.tree).filter((n) => n.kind === 'image');
  const un = imgs.map((n) => [n.cls, (n.paint && n.paint.unsupported || []).map((u) => `${u.prop}: ${u.value}`).join('; ')]);
  assert.deepEqual(un, [['cover', ''], ['contain', ''], ['fill', ''], ['mid', ''],
    ['none', 'image fit/position: object-fit none'], ['sd', 'image fit/position: object-fit scale-down'],
    ['tl', 'image fit/position: object-position 0px 0px'], ['right', 'image fit/position: object-position 100% 50%']]);
});

test('M-e: page CSS on inlined sprite targets is carried (paint) or reported (transform); inherited paint stays', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-svg-defs.html'), { root: '.scr', fontOverride: false })).screens[0];
  const by = (cls) => walk(s.tree).find((n) => n.cls === cls);
  const mixed = by('mixed'), tw = by('tw');
  const sym = (svg, id) => (new RegExp(`<symbol[^>]*id="${id}"[^>]*>(.*?)</symbol>`, 's').exec(svg) || [])[1] || '';
  assert.match(sym(mixed.icon.svg, 'red'), /<path[^>]*style="[^"]*fill: rgb\(229, 57, 53\)/, mixed.icon.svg);
  assert.doesNotMatch(sym(mixed.icon.svg, 'plain'), /style=/, 'a target that inherits through the <use> keeps inheriting');
  assert.equal(mixed.paint.unsupported, undefined, JSON.stringify(mixed.paint.unsupported));
  assert.deepEqual((tw.paint.unsupported || []).map((u) => u.prop), ['svg rect transform']);
});

test('text decoration drawn through from an ancestor is the text\'s own td; not into atomic inline or out-of-flow nodes', { skip }, async () => {
  const s = (await captureScreens(join(FIX, 'capture-decoration.html'), { root: '.scr', fontOverride: false })).screens[0];
  const td = (cls) => { const n = walk(s.tree).find((x) => x.cls === cls); return (n.font || n.kids[0].font).td; };
  assert.equal(td('in'), 'line-through');
  assert.equal(td('chip'), 'none');
  assert.equal(td('pin'), 'none');
  assert.deepEqual(td('own').split(' ').sort(), ['line-through', 'underline']);
  assert.equal(td('plain'), 'none');
});
