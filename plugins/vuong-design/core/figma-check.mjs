// Figma readback -> a proxy for verify (plan 3 Task 7). The builder (figma-runtime.js) returns per node only what
// differs from the encoded intent (README "Figma runtime", BatchResult); this module reconstructs the actual values
// (actual = encoded intent unless `d` says otherwise) and turns them into the `{ boxes, dom }` shape renderProxy
// returns, so verifyScreen runs on real Figma unchanged (R-P4: mark 'figma-real', model 'figma').
//
// ordOf(T) -> [vd id]   the readback order: pre-order of the encoded tree, `<o>#stroke` after the subtree of a bd.o node
// decode(res, D) -> res   adds s.N = { [vd id]: { fid, A, B, d } } to every built screen of a BatchResult (B = A + dB)
// actualNodes(s, D) -> Map(vd id -> Actual)   s = one decoded screen of the result (decode first). Actual = { o, e (the
//   encoded node; for an overlay the cell's), ov (overlay), fid, A, B, text?, runs?: [{ len, fs, family, weight, italic,
//   fill, ts, fv }], fills?, strokes, radius?, es?, op, vars?, iconEmpty? }; text / runs on TEXT nodes (and glyph icons),
//   fills / radius / es on the others.
// figmaDom(n, ctx) -> DomRecord   one Actual as renderProxy's dom record (proxy.mjs): text, runs, color, bg, ff, op,
//   vis, disp, stroke [t r b l], outline, radius [4], icon, img. ctx = { opEff (effective opacity, undefined when an
//   ancestor is not in the readback), spec (the spec-norm node), overlay (the Actual of `<o>#stroke`; null when the
//   cell's overlay is not in the readback) }.
//   What the readback does not observe is left out of the record (undefined), never filled in from the source:
//    - shadow / bgImage (effects and gradient geometry are not read back)         -> unread 'effect'
//    - svg markup of an inline svg icon (only "has vectors" is read back)         -> unread 'svg'
//    - img fit / position / source of an image fill (only the IMAGE paint is read) -> unread 'image'
//    - text-decoration / text-transform of runs (runtime M5: not compared)        -> unread 'text-decoration' / 'text-transform'
//    - the dash style of a stroke (dashPattern is not read back; the encoded style is used) -> unread 'stroke-style'
//    - width B has no screenshot (get_screenshot shows the frame at width A)      -> unread 'crop-B'
//   verifyScreen records each unread name as skipped 'figma-<name>': listed in the report, never failing the screen.
//   outline is 'none': Figma has no outline (the encoder reports a source outline as raw / unsupported), so a source
//   outline is a real difference. vis 'visible', disp 'flex': every built node is shown. A colour equal to the
//   intent is the intent's hex; alpha = the shortest decimal that encodes to the same byte. A corner radius equal to
//   the intent is reported in the spec's own unit (the intent was encoded from it, e.g. 50% -> px), a different one
//   in px.
// figmaProxy(s, D, spec, { png }) -> { A, B, unread }   A / B = { boxes, dom, png (A only, device scale 2), model:
//   'figma', mark: 'figma-real', unread, fontsMissing, facesMissing } (fonts from the screen's fontMissing). A screen
//   without readback gives empty boxes (every node unchecked).
// pngSize(buf) -> [w, h]; rescalePng(browser, buf, factor) -> Buffer (canvas, smooth). The screenshot's scale is
//   pngWidth / W_A; check rescales it to the proxy's device scale 2 before measureCrops.
// proxyVsFigma(ref, fig, ids) -> { A: { max, worst }, B } the largest |box delta| between a local proxy and Figma.

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const DSF = 2;

export const ordOf = (e, a = []) => { a.push(e.o); (e.k || []).forEach((k) => ordOf(k, a)); if (e.bd && e.bd.o) a.push(e.o + '#stroke'); return a; };

export function decode(res, D) {
  for (const s of res.screens) {
    if (!s.nodes) continue;
    const T = D.screens.find((x) => x.screen === s.screen).T, pf = s.root.split(':')[0] + ':';
    s.N = {};
    ordOf(T).forEach((o, i) => {
      const t = s.nodes[i];
      if (!t) return;
      const [f, A, dB, d] = t;
      s.N[o] = { fid: typeof f === 'number' ? pf + f : f, A, B: dB ? A.map((v, j) => Math.round((v + dB[j]) * 100) / 100 + 0) : A, d };
    });
  }
  return res;
}

// ---- fonts: style names as the runtime reads them ----
const WL = ['thin', 'extralight', 'light', 'regular', 'medium', 'semibold', 'bold', 'extrabold', 'black'];
// 'SemiBold' -> [600, false]; 'Bold Italic' -> [700, true]; an unknown style name -> [null, italic]
export function styleWeight(style) {
  const k = String(style).toLowerCase().replace(/[\s_-]/g, ''), it = /italic|oblique/.test(k);
  const i = WL.indexOf(k.replace(/italic|oblique/, '') || 'regular');
  return [i >= 0 ? (i + 1) * 100 : null, it];
}
// 'Be Vietnam Pro SemiBold' -> ['Be Vietnam Pro', 'SemiBold'], using the known families first
export function splitFont(s, families = []) {
  const str = String(s);
  for (const f of [...families].sort((a, b) => b.length - a.length)) if (str.startsWith(`${f} `)) return [f, str.slice(f.length + 1)];
  const w = str.split(' ');
  if (w.length < 2) return [str, 'Regular'];
  const n = w.length >= 3 && /^(italic|oblique)$/i.test(w[w.length - 1]) && styleWeight(w[w.length - 2])[0] ? 2 : 1;
  return [w.slice(0, -n).join(' '), w.slice(-n).join(' ')];
}

// ---- colours ----
// '#rrggbb[aa]' -> 'rgb(r, g, b)' / 'rgba(r, g, b, a)'; anything else (a paint type) as it is
export function rgbOf(hex) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || ''));
  if (!m) return hex == null || hex === '' ? 'transparent' : String(hex);
  const v = parseInt(m[1], 16), ch = `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`;
  if (!m[2]) return `rgb(${ch})`;
  const b = parseInt(m[2], 16);
  if (b === 0) return 'transparent';
  let a = Math.round((b / 255) * 100) / 100;
  if (Math.round(a * 255) !== b) a = r3(b / 255);
  return a >= 1 ? `rgb(${ch})` : `rgba(${ch}, ${a})`;
}
const solid = (x) => typeof x === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x);

// ---- intent of a text node, expanded like the runtime's run(): [{ len, fs, f: [family, weight, italic?], fill, ts, fv }]
function intentRuns(e, D, text) {
  const v = e.v || {};
  const base = { fs: e.fs ?? 12, f: D.F[e.f], fill: e.c != null ? D.C[e.c] : '#000000', ts: e.ts != null ? D.S[e.ts] || '' : '', fv: v.c != null ? D.V[v.c] || '' : '' };
  const out = [];
  for (const r of e.rn || [text.length]) {
    const [len, x] = Array.isArray(r) ? r : [r, null];
    const xv = (x && x.v) || {};
    const s = !x ? base : {
      fs: x.fs ?? base.fs, f: x.f != null ? D.F[x.f] : base.f, fill: x.c != null ? D.C[x.c] : base.fill,
      ts: x.ts != null ? D.S[x.ts] || '' : base.ts, fv: x.c != null || xv.c != null ? (xv.c != null ? D.V[xv.c] || '' : '') : base.fv,
    };
    const p = out[out.length - 1];
    const key = (q) => JSON.stringify([q.fs, q.f, q.fill, q.ts, q.fv]);
    if (p && key(p) === key(s)) p.len += len; else out.push({ len, ...s });
  }
  return out.map((q) => ({ len: q.len, fs: q.fs, family: q.f ? q.f[0] : '', weight: q.f ? q.f[1] : 400, italic: !!(q.f && q.f[2]), fill: q.fill, ts: q.ts, fv: q.fv }));
}

const fourOf = (w) => (Array.isArray(w) ? w : [w, w, w, w]);

export function actualNodes(s, D) {
  const out = new Map();
  if (!s || !s.N) return out;
  const T = D.screens.find((x) => x.screen === s.screen).T;
  const fams = [...new Set((D.F || []).map((f) => f[0])), 'Inter'];
  const walk = (e) => {
    const r = s.N[e.o];
    if (r) out.set(e.o, one(e, r, false));
    (e.k || []).forEach(walk);
    if (e.bd && e.bd.o) { const ro = s.N[`${e.o}#stroke`]; if (ro) out.set(`${e.o}#stroke`, one(e, ro, true)); }
  };
  const one = (e, r, ov) => {
    const d = r.d || {};
    const o = ov ? `${e.o}#stroke` : e.o;
    const gl = !!(e.ic && e.ic.g != null), T_ = !ov && (e.t === 'T' || gl);
    const n = { o, e, ov, fid: r.fid, A: r.A, B: r.B, op: d.op !== undefined ? d.op : ov || e.op == null ? 1 : e.op };
    if (T_) {
      const intentText = gl ? e.ic.g : e.tx ?? '';
      n.text = d.text !== undefined ? d.text : intentText;
      n.runs = d.runs !== undefined
        ? d.runs.map(([len, fs, font, fill, ts, fv]) => { const [family, style] = splitFont(font, fams); const [w, it] = styleWeight(style); return { len, fs, family, weight: w ?? style, italic: it, fill, ts, fv }; })
        : intentRuns(e, D, intentText);
    } else {
      n.fills = d.fills !== undefined ? d.fills : ov ? [] : [...(e.bg != null ? [D.C[e.bg]] : []), ...(e.gr || []).map((g) => `GRADIENT_${g.k === 'R' ? 'RADIAL' : 'LINEAR'}`), ...(e.im ? ['IMAGE'] : [])];
      n.radius = d.radius !== undefined ? d.radius : typeof e.rd === 'number' ? [e.rd, e.rd, e.rd, e.rd] : e.rd || [0, 0, 0, 0];
      n.radiusIntent = d.radius === undefined;
      n.es = d.es !== undefined ? d.es : ov || e.es == null ? '' : D.S[e.es] || '';
      if (e.t === 'V' && !gl) n.iconEmpty = d.icon === 0;
    }
    const b = e.bd;
    n.strokes = d.strokes !== undefined ? d.strokes : b && (ov || !b.o) && !T_ ? { c: [D.C[b.c]], w: fourOf(b.w) } : null;
    if (d.vars !== undefined) n.vars = d.vars;
    return n;
  };
  walk(T);
  return out;
}

const textCss = (t) => String(t ?? '').replace(/\n/g, ' ');
const sides = (strokes, style) => {
  if (!strokes || !Array.isArray(strokes.w)) return ['none', 'none', 'none', 'none'];
  const c = rgbOf(strokes.c && strokes.c[0]);
  return strokes.w.map((w) => (w > 0 ? `${r2(w)}px ${style} ${c}` : 'none'));
};

export function figmaDom(n, ctx = {}) {
  const { opEff, spec, overlay } = ctx;
  const e = n.e;
  const dom = { op: opEff === undefined ? undefined : r3(opEff), vis: 'visible', disp: 'flex', outline: 'none' };
  if (n.text !== undefined) {
    dom.text = textCss(n.text);
    dom.bg = 'transparent';
    dom.stroke = ['none', 'none', 'none', 'none'];
    dom.radius = ['0px', '0px', '0px', '0px'];
    const runs = n.runs || [];
    // the node colour: the fill at the first character the intent leaves at the node's own colour
    let at = 0, colourAt = 0;
    for (const x of e.rn || []) { const [len, ov] = Array.isArray(x) ? x : [x, null]; if (!ov || ov.c == null) { colourAt = at; break; } at += len; }
    let pos = 0, first = runs[0];
    for (const r of runs) { if (colourAt < pos + r.len) { first = r; break; } pos += r.len; }
    dom.color = rgbOf(first ? first.fill : '#000000');
    dom.ff = runs[0] ? runs[0].family : undefined;
    let i = 0;
    dom.runs = runs.map((r) => {
      const t = String(n.text).slice(i, i + r.len); i += r.len;
      return [t, `${r.fs}px`, String(r.weight), r.italic ? 'italic' : 'normal', undefined, undefined, r.family, rgbOf(r.fill)];
    });
    return dom;
  }
  const f = (n.fills || []).find(solid);
  dom.bg = f ? rgbOf(f) : 'transparent';
  const style = e.bd && e.bd.d ? e.bd.d : 'solid';
  if (e.bd && e.bd.o) dom.stroke = overlay ? sides(overlay.strokes, style) : undefined; // overlay not read back: unknown
  else dom.stroke = sides(n.strokes, style);
  const sr = spec && spec.paint && Array.isArray(spec.paint.radius) && spec.paint.radius.length === 4 ? spec.paint.radius : null;
  dom.radius = n.radiusIntent && sr ? sr.map((x) => (typeof x === 'number' ? `${x}px` : String(x))) : (n.radius || [0, 0, 0, 0]).map((x) => `${r2(x)}px`);
  if (e.t === 'V') {
    if (!n.iconEmpty) {
      const ic = spec && spec.icon;
      dom.icon = ic && ic.ref ? ic.ref : 'svg';
    }
  }
  if (e.t === 'I' || e.im) { if (!(n.fills || []).includes('IMAGE')) dom.img = null; }
  return dom;
}

const BASE_UNREAD = ['crop-B', 'effect', 'text-decoration', 'text-transform'];

export function figmaProxy(s, D, spec, opts = {}) {
  const T = D && s ? (D.screens.find((x) => x.screen === s.screen) || {}).T : null;
  const act = T && s.N ? actualNodes(s, D) : new Map();
  const specIdx = new Map();
  const idx = (n) => { specIdx.set(n.id, n); (n.kids || []).forEach(idx); };
  if (spec) idx(spec);
  const boxes = { A: {}, B: {} }, dom = {};
  const unread = new Set(BASE_UNREAD);
  const walk = (e, opParent) => {
    const n = act.get(e.o);
    const opEff = n && opParent !== undefined ? opParent * n.op : undefined;
    if (n) {
      boxes.A[e.o] = n.A; boxes.B[e.o] = n.B;
      const ov = e.bd && e.bd.o ? act.get(`${e.o}#stroke`) || null : undefined;
      dom[e.o] = figmaDom(n, { opEff, spec: specIdx.get(e.o), overlay: ov });
      if (e.t === 'V' && !(e.ic && e.ic.g != null) && dom[e.o].icon === 'svg') unread.add('svg');
      if ((e.t === 'I' || e.im) && dom[e.o].img === undefined) unread.add('image');
      if (e.bd && e.bd.d) unread.add('stroke-style');
    }
    for (const k of e.k || []) walk(k, opEff);
    const so = act.get(`${e.o}#stroke`);
    if (so) { boxes.A[so.o] = so.A; boxes.B[so.o] = so.B; }
  };
  if (T) walk(T, 1);
  const fm = (s && s.fontMissing) || [];
  const fontsMissing = [...new Set(fm.filter((x) => !String(x.used).startsWith(`${x.family} `)).map((x) => x.family))];
  const facesMissing = [...new Set(fm.filter((x) => String(x.used).startsWith(`${x.family} `)).map((x) => {
    const [w, it] = styleWeight(x.style);
    return `${x.family}|${it ? 1 : 0}|${w ?? (Number.parseInt(x.style, 10) || 400)}`;
  }))];
  const list = [...unread];
  const mk = (M) => ({ boxes: boxes[M], dom, png: M === 'A' ? opts.png || null : null, model: 'figma', mark: 'figma-real', unread: list, fontsMissing, facesMissing });
  return { A: mk('A'), B: mk('B'), unread: list };
}

// ---- screenshot ----
export function pngSize(buf) {
  const b = Buffer.from(buf);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') throw new Error('not a PNG file');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

export async function rescalePng(browser, buf, factor) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    const b64 = await page.evaluate(async ({ src, k }) => {
      const im = new Image(); im.src = `data:image/png;base64,${src}`; await im.decode();
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    }, { src: Buffer.from(buf).toString('base64'), k: factor });
    return Buffer.from(b64, 'base64');
  } finally { await page.close(); }
}

// the Figma screenshot at the proxy's device scale (2): { png, scale (of the file), rescaled }
export async function shotAtDsf(browser, buf, widthA) {
  const [w] = pngSize(buf);
  const scale = w / widthA;
  if (Math.abs(scale - DSF) <= 0.01) return { png: Buffer.from(buf), scale, rescaled: false };
  return { png: await rescalePng(browser, buf, DSF / scale), scale, rescaled: true };
}

// ---- proxy vs Figma ----
export function proxyVsFigma(ref, fig, ids, worstN = 5) {
  const out = {};
  for (const M of ['A', 'B']) {
    const rows = [];
    for (const id of ids) {
      const a = ref[M] && ref[M].boxes[id], b = fig[M] && fig[M].boxes[id];
      if (!a || !b) continue;
      const delta = b.map((v, i) => r2(v - a[i]));
      rows.push({ id, delta, max: Math.max(...delta.map(Math.abs)) });
    }
    rows.sort((x, y) => y.max - x.max || (x.id < y.id ? -1 : 1));
    out[M] = { compared: rows.length, max: rows.length ? rows[0].max : null, worst: rows.slice(0, worstN).filter((r) => r.max > 0) };
  }
  return out;
}
