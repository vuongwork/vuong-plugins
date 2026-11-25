// Colour maths for the design-system pass (plan 2, Task 3). Pure functions, no dependencies.
//
// A colour is { r, g, b, a } with sRGB channels and alpha in 0..1 (gamma-encoded sRGB, not linear), plus
// `clamped: true` when the source lay outside the sRGB gamut and was clipped per channel (no gamut mapping).
// Anything that cannot be read becomes { unparsed: css } and is never turned into black.
//
//  - parseColor(css) -> colour | { unparsed }. Reads, case-insensitively, per CSS Color 4: #rgb, #rgba, #rrggbb,
//    #rrggbbaa; rgb()/rgba() and hsl()/hsla() in comma (legacy) and space syntax with optional `/ alpha`; hwb();
//    lab(), lch() (D50, as CSS); oklab(), oklch(); color(srgb | srgb-linear | display-p3 | xyz | xyz-d65 | xyz-d50 …);
//    the 148 named colours and `transparent`. Numbers, percentages, `none` (= 0) and hue units deg/rad/grad/turn
//    are accepted, so every form Chrome's getComputedStyle serialises to parses. currentColor, inherit, var(),
//    calc(), relative colour syntax (`from`), color-mix(), other colour spaces and malformed input -> unparsed.
//  - toHex(c) -> '#rrggbb' (alpha rounds to 255) or '#rrggbbaa'. Throws on an unparsed colour.
//  - labOf(c) -> { L, a, b }: CIE Lab relative to D65 (sRGB's white), the space deltaE2000 uses for colours.
//    Note CSS lab()/lch() are D50; labOf is not the inverse of lab().
//  - deltaE2000(x, y) -> ΔE00 (kL = kC = kH = 1). x, y are { L, a, b } Lab triples, parsed colours (via labOf,
//    alpha ignored) or CSS strings. Throws on an unparsed colour.
//  - luminance(c) -> WCAG 2.x relative luminance of the opaque colour.
//  - contrast(fg, bg) -> WCAG 2.x contrast ratio (1..21). fg alpha is composited over bg first; a translucent bg
//    is composited over white first (WCAG has no answer for it). Accepts parsed colours or CSS strings.
//    Throws on an unparsed colour.
//  - oklchOf(c) -> { l, c, h } (h in degrees 0..360, 0 when c < 1e-6); oklabOf(c) -> { l, a, b }.
//
// Conversion matrices are the CSS Color 4 sample code ones; inverses are computed here.

const NAMED = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
  darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1',
  darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
  dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
  green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
  indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
  lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90',
  lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa',
  lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0',
  lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000',
  mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db',
  mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5',
  navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23',
  orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98',
  paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f',
  pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399',
  red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072',
  sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0',
  skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8',
  tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
  whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};

// ---- matrices ----

const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
function inv(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const SRGB_TO_XYZ = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_SRGB = inv(SRGB_TO_XYZ);
const P3_TO_XYZ = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const D50_TO_D65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D65_TO_D50 = inv(D50_TO_D65);
const XYZ_TO_LMS = [
  [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB = [
  [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ = inv(XYZ_TO_LMS);
const OKLAB_TO_LMS = inv(LMS_TO_OKLAB);

const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
// sRGB's own white (row sums of SRGB_TO_XYZ), so sRGB white maps to exactly a = b = 0
const D65 = SRGB_TO_XYZ.map((r) => r[0] + r[1] + r[2]);
const KAPPA = 24389 / 27, EPS = 216 / 24389;

// ---- transfer functions and spaces ----

const toLinear = (v) => {
  const s = Math.sign(v) || 1, x = Math.abs(v);
  return x <= 0.04045 ? v / 12.92 : s * ((x + 0.055) / 1.055) ** 2.4;
};
const toGamma = (v) => {
  const s = Math.sign(v) || 1, x = Math.abs(v);
  return x <= 0.0031308 ? v * 12.92 : s * (1.055 * x ** (1 / 2.4) - 0.055);
};

function labToXyz([L, a, b], white) {
  const f1 = (L + 16) / 116, f0 = a / 500 + f1, f2 = f1 - b / 200;
  const x = f0 ** 3 > EPS ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = L > KAPPA * EPS ? f1 ** 3 : L / KAPPA;
  const z = f2 ** 3 > EPS ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return [x * white[0], y * white[1], z * white[2]];
}
function xyzToLab(xyz, white) {
  const f = xyz.map((v, i) => {
    const t = v / white[i];
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
const oklabToXyz = (lab) => mul(LMS_TO_XYZ, mul(OKLAB_TO_LMS, lab).map((v) => v ** 3));
const xyzToOklab = (xyz) => mul(LMS_TO_OKLAB, mul(XYZ_TO_LMS, xyz).map(Math.cbrt));
const polar = (l, c, h) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

const linOf = (c) => [c.r, c.g, c.b].map(toLinear);
const xyzOf = (c) => mul(SRGB_TO_XYZ, linOf(c));

// XYZ (D65) -> colour, clipping to the sRGB gamut
function fromXyz(xyz, a) {
  return fromGamma(mul(XYZ_TO_SRGB, xyz).map(toGamma), a);
}
function fromGamma([r, g, b], a) {
  const T = 1e-5;
  const out = [r, g, b].map((v) => Math.min(1, Math.max(0, v)));
  const c = { r: out[0], g: out[1], b: out[2], a };
  if ([r, g, b].some((v) => !(v >= -T && v <= 1 + T))) c.clamped = true;
  return c;
}

// ---- parsing ----

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/;

// token -> number. pct: what 100% means (undefined: % not allowed). hue: accept angle units.
function num(tok, { pct, hue } = {}) {
  if (tok === 'none') return 0;
  const m = NUM.exec(tok);
  if (!m) return NaN;
  const v = parseFloat(m[0]);
  const unit = tok.slice(m[0].length);
  if (unit === '') return v;
  if (unit === '%') return pct === undefined ? NaN : (v / 100) * pct;
  if (hue) {
    const k = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[unit];
    return k === undefined ? NaN : v * k;
  }
  return NaN;
}
const alphaOf = (tok) => (tok === undefined ? 1 : Math.min(1, Math.max(0, num(tok, { pct: 1 }))));
const hueNorm = (h) => ((h % 360) + 360) % 360;

// body of fn(...) -> { main: [tokens], alpha: token|undefined, legacy } or null
function split(body) {
  if (body.includes(',')) {
    const parts = body.split(',').map((s) => s.trim());
    if (parts.some((p) => p === '' || /\s|\//.test(p))) return null;
    return { main: parts.slice(0, 3), alpha: parts[3], legacy: true, n: parts.length };
  }
  const slash = body.split('/');
  if (slash.length > 2) return null;
  const main = slash[0].trim().split(/\s+/).filter(Boolean);
  let alpha;
  if (slash.length === 2) {
    const a = slash[1].trim().split(/\s+/).filter(Boolean);
    if (a.length !== 1) return null;
    alpha = a[0];
  }
  return { main, alpha, legacy: false, n: main.length + (alpha === undefined ? 0 : 1) };
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const SPACES = {
  srgb: (v) => ({ gamma: v }),
  'srgb-linear': (v) => ({ xyz: mul(SRGB_TO_XYZ, v) }),
  'display-p3': (v) => ({ xyz: mul(P3_TO_XYZ, v.map(toLinear)) }),
  xyz: (v) => ({ xyz: v }),
  'xyz-d65': (v) => ({ xyz: v }),
  'xyz-d50': (v) => ({ xyz: mul(D50_TO_D65, v) }),
};

function parseFn(name, body) {
  if (/[a-z-]+\(|\bfrom\b/.test(body)) return null; // var(), calc(), relative colour syntax
  if (name === 'color') {
    const m = /^\s*([a-z0-9-]+)\s+(.*)$/s.exec(body);
    if (!m || !SPACES[m[1]]) return null;
    const p = split(m[2]);
    if (!p || p.legacy || p.main.length !== 3) return null;
    const v = p.main.map((t) => num(t, { pct: 1 }));
    const a = alphaOf(p.alpha);
    if (v.some(Number.isNaN) || Number.isNaN(a)) return null;
    const s = SPACES[m[1]](v);
    return s.gamma ? fromGamma(s.gamma, a) : fromXyz(s.xyz, a);
  }
  const p = split(body);
  if (!p || p.main.length !== 3 || p.n > 4) return null;
  if (p.legacy && !['rgb', 'rgba', 'hsl', 'hsla'].includes(name)) return null;
  const a = alphaOf(p.alpha);
  if (Number.isNaN(a)) return null;
  const [t0, t1, t2] = p.main;
  if (p.legacy && p.main.includes('none')) return null;
  let v, out;
  switch (name) {
    case 'rgb': case 'rgba':
      v = p.main.map((t) => num(t, { pct: 255 }));
      if (v.some(Number.isNaN)) return null;
      return fromGamma(v.map((x) => Math.min(255, Math.max(0, x)) / 255), a);
    case 'hsl': case 'hsla': case 'hwb': {
      v = [num(t0, { hue: true }), num(t1, { pct: 100 }), num(t2, { pct: 100 })];
      if (v.some(Number.isNaN)) return null;
      const h = hueNorm(v[0]);
      if (name === 'hwb') {
        let w = Math.max(0, v[1]) / 100, bl = Math.max(0, v[2]) / 100;
        if (w + bl >= 1) { const g = w / (w + bl); out = [g, g, g]; }
        else out = hslToRgb(h, 1, 0.5).map((x) => x * (1 - w - bl) + w);
      } else {
        out = hslToRgb(h, Math.min(1, Math.max(0, v[1] / 100)), Math.min(1, Math.max(0, v[2] / 100)));
      }
      return fromGamma(out, a);
    }
    case 'lab': case 'oklab': {
      const ok = name === 'oklab';
      v = [num(t0, { pct: ok ? 1 : 100 }), num(t1, { pct: ok ? 0.4 : 125 }), num(t2, { pct: ok ? 0.4 : 125 })];
      if (v.some(Number.isNaN)) return null;
      v[0] = Math.min(ok ? 1 : 100, Math.max(0, v[0]));
      return fromXyz(ok ? oklabToXyz(v) : mul(D50_TO_D65, labToXyz(v, D50)), a);
    }
    case 'lch': case 'oklch': {
      const ok = name === 'oklch';
      v = [num(t0, { pct: ok ? 1 : 100 }), num(t1, { pct: ok ? 0.4 : 150 }), num(t2, { hue: true })];
      if (v.some(Number.isNaN)) return null;
      const lab = polar(Math.min(ok ? 1 : 100, Math.max(0, v[0])), Math.max(0, v[1]), v[2]);
      return fromXyz(ok ? oklabToXyz(lab) : mul(D50_TO_D65, labToXyz(lab, D50)), a);
    }
    default:
      return null;
  }
}

export function parseColor(css) {
  const bad = { unparsed: css };
  if (typeof css !== 'string') return bad;
  const s = css.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[s]) return parseColor('#' + NAMED[s]);
  if (s[0] === '#') {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return bad;
    const full = h.length <= 4 ? [...h].map((x) => x + x).join('') : h;
    const n = (i) => parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1 };
  }
  const m = /^([a-z]+)\((.*)\)$/s.exec(s);
  if (!m) return bad;
  return parseFn(m[1], m[2]) || bad;
}

// ---- outputs ----

function need(c) {
  if (typeof c === 'string') c = parseColor(c);
  if (!c || c.unparsed !== undefined || typeof c.r !== 'number') {
    throw new TypeError(`unparsed colour: ${JSON.stringify(c && 'unparsed' in c ? c.unparsed : c)}`);
  }
  return c;
}

export function toHex(c) {
  c = need(c);
  const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  const a = h(c.a ?? 1);
  return '#' + h(c.r) + h(c.g) + h(c.b) + (a === 'ff' ? '' : a);
}

export function labOf(c) {
  const [L, a, b] = xyzToLab(xyzOf(need(c)), D65);
  return { L, a, b };
}

export function oklabOf(c) {
  const [l, a, b] = xyzToOklab(xyzOf(need(c)));
  return { l, a, b };
}

export function oklchOf(c) {
  const { l, a, b } = oklabOf(c);
  const ch = Math.hypot(a, b);
  return { l, c: ch, h: ch < 1e-6 ? 0 : hueNorm((Math.atan2(b, a) * 180) / Math.PI) };
}

const asLab = (x) => (x && typeof x === 'object' && 'L' in x ? x : labOf(x));

// Sharma, Wu & Dalal (2005), eqs. 1-23
export function deltaE2000(x, y) {
  const { L: L1, a: a1, b: b1 } = asLab(x);
  const { L: L2, a: a2, b: b2 } = asLab(y);
  const rad = Math.PI / 180;
  const Cab = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cab ** 7 / (Cab ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const C1 = Math.hypot(ap1, b1), C2 = Math.hypot(ap2, b2);
  const hOf = (ap, b) => (ap === 0 && b === 0 ? 0 : hueNorm(Math.atan2(b, ap) / rad));
  const h1 = hOf(ap1, b1), h2 = hOf(ap2, b2);
  const dL = L2 - L1, dC = C2 - C1;
  let dh = 0;
  if (C1 * C2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, Cm = (C1 + C2) / 2;
  let hm = h1 + h2;
  if (C1 * C2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm /= 2;
    else hm = h1 + h2 < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad)
    + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cm, SH = 1 + 0.015 * Cm * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

export function luminance(c) {
  const [r, g, b] = linOf(need(c));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const over = (top, under) => {
  const a = top.a ?? 1;
  const m = (k) => top[k] * a + under[k] * (1 - a);
  return { r: m('r'), g: m('g'), b: m('b'), a: 1 };
};

export function contrast(fg, bg) {
  fg = need(fg); bg = need(bg);
  if ((bg.a ?? 1) < 1) bg = over(bg, { r: 1, g: 1, b: 1, a: 1 });
  const l1 = luminance(over(fg, bg)), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
