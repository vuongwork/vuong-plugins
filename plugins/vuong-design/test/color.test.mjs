import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, toHex, deltaE2000, contrast, oklchOf, labOf, luminance } from '../core/color.mjs';

const skip = process.env.VD_PLAYWRIGHT_FROM
  ? false
  : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core';

const near = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg ?? ''} got ${got}, want ${want} (tol ${tol})`);
const near255 = (c, rgb, msg) => {
  for (const [i, k] of ['r', 'g', 'b'].entries()) near(c[k] * 255, rgb[i], 1, `${msg} ${k}`);
};

// ---- CIEDE2000: Sharma, Wu & Dalal (2005), Table 1 ----
const SHARMA = [
  [[50.0000, 2.6772, -79.7751], [50.0000, 0.0000, -82.7485], 2.0425],
  [[50.0000, 3.1571, -77.2803], [50.0000, 0.0000, -82.7485], 2.8615],
  [[50.0000, 2.8361, -74.0200], [50.0000, 0.0000, -82.7485], 3.4412],
  [[50.0000, -1.3802, -84.2814], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -1.1848, -84.8006], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -0.9009, -85.5211], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, 0.0000, 0.0000], [50.0000, -1.0000, 2.0000], 2.3669],
  [[50.0000, -1.0000, 2.0000], [50.0000, 0.0000, 0.0000], 2.3669],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0009], 7.1792],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0010], 7.1792],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0011], 7.2195],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0012], 7.2195],
  [[50.0000, -0.0010, 2.4900], [50.0000, 0.0009, -2.4900], 4.8045],
  [[50.0000, -0.0010, 2.4900], [50.0000, 0.0010, -2.4900], 4.8045],
  [[50.0000, -0.0010, 2.4900], [50.0000, 0.0011, -2.4900], 4.7461],
  [[50.0000, 2.5000, 0.0000], [50.0000, 0.0000, -2.5000], 4.3065],
  [[50.0000, 2.5000, 0.0000], [73.0000, 25.0000, -18.0000], 27.1492],
  [[50.0000, 2.5000, 0.0000], [61.0000, -5.0000, 29.0000], 22.8977],
  [[50.0000, 2.5000, 0.0000], [56.0000, -27.0000, -3.0000], 31.9030],
  [[50.0000, 2.5000, 0.0000], [58.0000, 24.0000, 15.0000], 19.4535],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.1736, 0.5854], 1.0000],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.2972, 0.0000], 1.0000],
  [[50.0000, 2.5000, 0.0000], [50.0000, 1.8634, 0.5757], 1.0000],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.2592, 0.3350], 1.0000],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.2480, -4.9620], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
  [[36.4612, 47.8580, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.4410], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082],
];

test('CIEDE2000: the 34 Sharma, Wu & Dalal (2005) pairs within 1e-4, in both orders', () => {
  assert.equal(SHARMA.length, 34);
  SHARMA.forEach(([p, q, want], i) => {
    const L = (v) => ({ L: v[0], a: v[1], b: v[2] });
    near(deltaE2000(L(p), L(q)), want, 1e-4, `pair ${i + 1}`);
    near(deltaE2000(L(q), L(p)), want, 1e-4, `pair ${i + 1} reversed`);
  });
});

test('deltaE2000 takes parsed colours and CSS strings (via D65 Lab)', () => {
  assert.equal(deltaE2000('#1a73e8', '#1a73e8'), 0);
  const d = deltaE2000('#1a73e8', parseColor('#1a74e8'));
  assert.ok(d > 0 && d < 1, `${d}`);
  near(deltaE2000('#000', '#fff'), 100, 1e-3);
  assert.throws(() => deltaE2000('currentColor', '#fff'), /unparsed/);
});

test('labOf: sRGB white is L 100, a b 0 (D65); mid grey is L 53.39', () => {
  const w = labOf(parseColor('#fff'));
  near(w.L, 100, 1e-6); near(w.a, 0, 1e-6); near(w.b, 0, 1e-6);
  const g = labOf(parseColor('#808080'));
  near(g.L, 53.585, 0.01); near(g.a, 0, 1e-6); near(g.b, 0, 1e-6);
  // sRGB red in D65 Lab: L 53.24, a 80.09, b 67.20 (Bruce Lindbloom, D65)
  const r = labOf(parseColor('#f00'));
  near(r.L, 53.2408, 0.01); near(r.a, 80.0925, 0.02); near(r.b, 67.2032, 0.02);
});

// ---- WCAG ----

test('contrast: WCAG 2.x ratios', () => {
  near(contrast('#000', '#fff'), 21, 1e-9);
  near(contrast('#fff', '#000'), 21, 1e-9);
  near(contrast('#777', '#fff'), 4.48, 0.005);
  near(contrast('#fff', '#fff'), 1, 1e-9);
  near(luminance(parseColor('#fff')), 1, 1e-12);
});

test('contrast: a translucent fg is composited over the bg first', () => {
  // black at 50% over white = rgb(127.5) -> same as #808080 within rounding
  near(contrast('rgb(0 0 0 / 0.5)', '#fff'), contrast('rgb(127.5 127.5 127.5)', '#fff'), 1e-9);
  near(contrast('transparent', '#123456'), 1, 1e-9);
  assert.throws(() => contrast('currentColor', '#fff'), /unparsed/);
});

// ---- parsing ----

test('parseColor: hex forms', () => {
  assert.deepEqual(parseColor('#fff'), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseColor('#FF000080'), { r: 1, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseColor('#0f08'), { r: 0, g: 1, b: 0, a: 136 / 255 });
  assert.deepEqual(parseColor('#336699'), { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255, a: 1 });
});

test('parseColor: rgb()/rgba() legacy and modern syntax, percentages, none', () => {
  const want = { r: 1, g: 0.5, b: 0, a: 0.25 };
  for (const css of ['rgba(255, 127.5, 0, 0.25)', 'rgb(255 127.5 0 / 0.25)', 'rgb(255 127.5 0 / 25%)',
    'rgb(100% 50% 0% / .25)', 'RGBA(255,127.5,0,.25)', 'rgb(255 127.5 none / 0.25)']) {
    const c = parseColor(css);
    for (const k of ['r', 'g', 'b', 'a']) near(c[k], want[k], 1e-9, `${css} ${k}`);
  }
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor('rgb(300 -5 0)'), { r: 1, g: 0, b: 0, a: 1 });
});

test('parseColor: hsl, hwb, named, transparent', () => {
  near255(parseColor('hsl(120 100% 25%)'), [0, 128, 0], 'hsl');
  near255(parseColor('hsla(240, 100%, 50%, 0.5)'), [0, 0, 255], 'hsla');
  assert.equal(parseColor('hsla(240, 100%, 50%, 0.5)').a, 0.5);
  near255(parseColor('hsl(0.5turn 100% 50%)'), [0, 255, 255], 'turn');
  near255(parseColor('hsl(3.14159265rad 100% 50%)'), [0, 255, 255], 'rad');
  near255(parseColor('hwb(0 0% 0%)'), [255, 0, 0], 'hwb');
  near255(parseColor('hwb(120 20% 30%)'), [51, 179, 51], 'hwb');
  near255(parseColor('hwb(0 60% 60%)'), [128, 128, 128], 'hwb grey');
  near255(parseColor('rebeccapurple'), [102, 51, 153], 'named');
  near255(parseColor('CornflowerBlue'), [100, 149, 237], 'named case');
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
});

// Reference values computed in Chromium (1x1 sRGB canvas, fillStyle = colour, read back; see the browser test below).
const REF = [
  ['oklch(0.7 0.1 200)', [64, 177, 183]],
  ['oklch(70% 0.1 200deg / 1)', [64, 177, 183]],
  ['oklab(0.6 0.05 -0.1)', [135, 113, 187]],
  ['lab(50 20 -30)', [133, 108, 170]],
  ['lch(60 40 120)', [125, 154, 81]],
  ['color(srgb 0.2 0.4 0.6)', [51, 102, 153]],
  ['color(srgb-linear 0.2 0.4 0.6)', [124, 170, 203]],
  ['color(display-p3 0.5 0.4 0.3)', [132, 101, 73]],
  ['color(xyz-d65 0.3 0.3 0.3)', [162, 145, 143]],
];

test('parseColor: oklch, oklab, lab, lch, color() match Chromium within 1/255', () => {
  for (const [css, rgb] of REF) {
    const c = parseColor(css);
    assert.ok(!c.unparsed, css);
    near255(c, rgb, css);
    assert.equal(c.a, 1);
  }
});

test('parseColor: out-of-gamut display-p3 / oklch is clamped and flagged', () => {
  const c = parseColor('color(display-p3 0 1 0)');
  assert.equal(c.clamped, true);
  for (const k of ['r', 'g', 'b']) assert.ok(c[k] >= 0 && c[k] <= 1);
  assert.equal(c.g, 1);
  assert.equal(parseColor('oklch(0.9 0.4 30)').clamped, true);
  assert.equal(parseColor('color(display-p3 0.5 0.4 0.3)').clamped, undefined);
  assert.equal(parseColor('oklch(1 0 0)').clamped, undefined);
});

test('parseColor: alpha in every function form', () => {
  for (const css of ['oklch(0.7 0.1 200 / 0.4)', 'lab(50 20 -30 / 40%)', 'color(srgb 0.2 0.4 0.6 / 0.4)',
    'hsl(10 20% 30% / 0.4)', 'hwb(10 20% 30% / 0.4)', 'oklab(0.6 0.05 -0.1 / .4)', 'lch(60 40 120 / 0.4)']) {
    near(parseColor(css).a, 0.4, 1e-9, css);
  }
});

test('parseColor: currentColor, inherit, var(), calc, relative syntax and garbage are unparsed, never black', () => {
  for (const css of ['currentColor', 'currentcolor', 'inherit', 'initial', 'var(--brand)', 'rgb(var(--x))',
    'rgb(calc(10 + 5) 0 0)', 'rgb(from red r g b)', 'color-mix(in srgb, red, blue)', '', 'blurple', '#12',
    '#ggg', 'rgb(1 2)', 'rgb(1 2 3 4)', 'rgb(1, 2 3)', 'color(foo 1 2 3)', 'hsl(10 20% 30% /)', undefined, null, 42]) {
    const c = parseColor(css);
    assert.ok(c && 'unparsed' in c, `${String(css)} -> ${JSON.stringify(c)}`);
    assert.equal(c.r, undefined, String(css));
  }
});

test('toHex: #rrggbb when opaque, #rrggbbaa otherwise; throws on unparsed', () => {
  assert.equal(toHex(parseColor('rgb(255 128 0)')), '#ff8000');
  assert.equal(toHex(parseColor('rgb(255 128 0 / 0.5)')), '#ff800080');
  assert.equal(toHex(parseColor('#AbC')), '#aabbcc');
  assert.equal(toHex(parseColor('transparent')), '#00000000');
  assert.throws(() => toHex(parseColor('currentColor')), /unparsed/);
});

test('oklchOf: round trip with oklch(), achromatic hue 0', () => {
  const o = oklchOf(parseColor('oklch(0.7 0.1 200)'));
  near(o.l, 0.7, 1e-6); near(o.c, 0.1, 1e-6); near(o.h, 200, 1e-4);
  const w = oklchOf(parseColor('#fff'));
  near(w.l, 1, 1e-4); near(w.c, 0, 1e-4); assert.equal(w.h, 0);
  // #ff0000 in OKLCH: 0.62796 0.25768 29.234
  const r = oklchOf(parseColor('#f00'));
  near(r.l, 0.62796, 1e-4); near(r.c, 0.25768, 1e-4); near(r.h, 29.234, 0.01);
});

// ---- Chromium as the reference ----

let browser, page;
before(async () => {
  if (skip) return;
  const { launchBrowser } = await import('../core/browser.mjs');
  browser = await launchBrowser();
  page = await browser.newPage();
});
after(async () => { if (browser) await browser.close(); });

const SAMPLES = [
  ...REF.map((r) => r[0]),
  'oklch(0.5 0.15 30)', 'oklch(0.85 0.05 260)', 'oklab(0.3 -0.05 0.02)', 'lab(80 -20 40)', 'lab(20 10 10)',
  'lch(40 30 300)', 'color(display-p3 0.2 0.6 0.4)', 'color(xyz-d50 0.2 0.3 0.25)', 'color(xyz 0.4 0.2 0.1)',
  'hsl(200 50% 40%)', 'hwb(300 10% 20%)', 'rgb(10% 20% 30%)', 'teal', 'peru', '#c0ffee',
];

test('Chromium agrees: canvas pixel within 1/255 for every sample', { skip }, async () => {
  const px = await page.evaluate((list) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    return list.map((css) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });
  }, SAMPLES);
  SAMPLES.forEach((css, i) => near255(parseColor(css), px[i], css));
});

test('Chromium agrees: every computed-style serialisation parses to the same colour', { skip }, async () => {
  const list = [...SAMPLES, 'rgb(0 0 0 / 0.5)', 'oklch(0.7 0.1 200 / 0.3)', 'color(srgb 1 0 0 / 50%)',
    'color(display-p3 0 1 0)', 'transparent', 'hsl(10 20% 30% / 0.4)'];
  const out = await page.evaluate((l) => l.map((css) => {
    const d = document.createElement('div'); d.style.color = css; document.body.append(d);
    const v = getComputedStyle(d).color; d.remove(); return v;
  }), list);
  list.forEach((css, i) => {
    const a = parseColor(css), b = parseColor(out[i]);
    assert.ok(!b.unparsed, `${css} -> ${out[i]} unparsed`);
    // Chrome keeps wide-gamut colours as-is in computed style, so compare after the same clamp
    for (const k of ['r', 'g', 'b', 'a']) near(b[k], a[k], 1 / 255, `${css} -> ${out[i]} ${k}`);
  });
});
