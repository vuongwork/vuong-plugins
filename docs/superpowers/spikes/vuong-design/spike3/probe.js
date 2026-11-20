// Hand-written probe spec (spike2 spec format) for semantics the 3 screens do not exercise:
// spaceBetween+gap, FILL distribution with padding/stroke/overflowing content, min/max on FILL, rich mixed-size text, abs constraints.
const BV = '"Be Vietnam Pro", system-ui, sans-serif';
const font = (fs, lh, fw = '400', extra = {}) => ({ ff: BV, fs: fs + 'px', fw, fst: 'normal', lh, ls: 'normal', c: 'rgb(38, 51, 92)', td: 'none', tt: 'none', ta: 'start', ws: 'normal', ...extra });
const box = (id, w, h, bg, sz = ['X', 'X'], extra = {}) => ({ id, t: 'F', w, h, sz, p: { bg }, ...extra });
const T = (id, s, f, sz = ['H', 'H'], extra = {}) => ({ id, t: 'T', w: 0, h: 0, font: f, runs: Array.isArray(s) ? s : [{ t: s }], sz, ...extra });
const lay = (d, p, g, extra = {}) => ({ d, p, g, pa: 'S', ca: 'S', ...extra });
const bd = (w, c) => [[w, 'solid', c], [w, 'solid', c], [w, 'solid', c], [w, 'solid', c]];
module.exports = {
  W: [320, 440],
  spec: {
    id: 'n', t: 'F', w: 320, h: 0, sz: ['X', 'H'], p: { bg: 'rgb(255, 255, 255)' }, lay: lay('V', [12, 12, 12, 12], 10), kids: [
      { id: 'sb', t: 'F', w: 296, h: 28, sz: ['F', 'H'], p: { bg: 'rgb(235, 235, 250)' }, lay: lay('H', [4, 6, 4, 6], 20, { sb: 1, ca: 'C' }), kids: [
        box('sb.a', 90, 20, 'rgb(200, 120, 120)'), box('sb.b', 90, 20, 'rgb(120, 200, 120)'), box('sb.c', 90, 20, 'rgb(120, 120, 200)')] },
      { id: 'fl', t: 'F', w: 296, h: 30, sz: ['F', 'H'], p: { bg: 'rgb(250, 240, 230)', bd: bd(4, 'rgb(30, 30, 200)') }, lay: lay('H', [5, 7, 5, 9], 6), kids: [
        box('fl.a', 40, 20, 'rgb(200, 120, 120)'),
        { id: 'fl.b', t: 'F', w: 100, h: 20, sz: ['F', 'H'], p: { bg: 'rgb(220, 220, 220)' }, lay: lay('V', [2, 2, 2, 2], 0), kids: [T('fl.b.t', 'short', font(13, 16))] },
        { id: 'fl.c', t: 'F', w: 100, h: 20, sz: ['F', 'H'], p: { bg: 'rgb(200, 220, 240)' }, lay: lay('V', [2, 2, 2, 2], 0), kids: [T('fl.c.t', 'much longer content text', font(13, 16))] },
        box('fl.d', 10, 10, 'rgb(90, 90, 90)', ['X', 'F'])] },
      { id: 'mm', t: 'F', w: 296, h: 20, sz: ['F', 'X'], lay: lay('H', [0, 0, 0, 0], 4), kids: [
        box('mm.a', 100, 20, 'rgb(200, 120, 120)', ['F', 'F'], { minW: 150 }), box('mm.b', 100, 20, 'rgb(120, 200, 120)', ['F', 'F']),
        box('mm.c', 100, 20, 'rgb(120, 120, 200)', ['F', 'F'], { maxW: 40 })] },
      T('rt', [{ t: 'Big ', s: { fs: '22px', fw: '800' } }, { t: 'small words here and there, ' }, { t: 'mid size run', s: { fs: '16px', c: 'rgb(201, 104, 63)' } }, { t: ' then plain text that wraps onto a further line' }], font(14, 20), ['F', 'H']),
      T('rt2', [{ t: 'Aa', s: { fs: '22px' } }, { t: ' tiny', s: { fs: '10px' } }], font(14, 20)),
      T('ls', 'Letter spaced 1px', font(13, 16, '600', { ls: '1px' })),
      T('wr', 'A FILL text that is long enough to wrap onto two or three lines at the native width', font(12.5, 16, '500'), ['F', 'H']),
      { id: 'ab', t: 'F', w: 296, h: 40, sz: ['F', 'X'], p: { bg: 'rgb(240, 240, 240)' }, lay: lay('H', [0, 0, 0, 0], 0), kids: [
        box('ab.f', 10, 10, 'rgb(0, 0, 0)'),
        box('ab.r', 20, 10, 'rgb(200, 0, 0)', ['X', 'X'], { abs: { x: 266, y: 2, cx: 'R', cy: 'L' } }),
        box('ab.c', 30, 10, 'rgb(0, 160, 0)', ['X', 'X'], { abs: { x: 133, y: 14, cx: 'C', cy: 'L' } }),
        box('ab.s', 30, 10, 'rgb(0, 0, 200)', ['X', 'X'], { abs: { x: 100, y: 26, cx: 'SC', cy: 'L' } }),
        box('ab.lr', 256, 4, 'rgb(200, 0, 200)', ['X', 'X'], { abs: { x: 20, y: 36, cx: 'LR', cy: 'L' } }),
        T('ab.st', 'SC text', font(10, 13), ['H', 'H'], { abs: { x: 200, y: 0, cx: 'SC', cy: 'L' } })] },
    ],
  },
  // line-height:normal probes: [family key, weight, size]
  LN: [['bv', 400, 11.5], ['bv', 600, 14], ['bv', 800, 22], ['rb', 400, 13], ['rb', 500, 18], ['rb', 400, 20], ['in', 400, 13], ['in', 700, 15], ['su', 400, 13], ['su', 700, 15]],
  LNF: { bv: "'Be Vietnam Pro'", rb: 'Roboto', in: 'Inter', su: "'Segoe UI'" },
};
