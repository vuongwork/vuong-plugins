// Apply normalisation (plan 2, Task 5): write the approved entries of normalize() into a copy of one screen's
// modelled spec (infer + figma-model), giving the target spec the norm proxy renders and plan 3 builds. Pure: no
// clock, no browser; the input spec and entries are never mutated (the spec is deep-copied with structuredClone).
//
// applyNorm(spec, entries, screenId) -> { spec, applied }
//  - Only entries with status 'auto' or 'answered' and only their nodes whose screen is screenId (compared as strings)
//    are applied; 'ask' / 'kept' entries and other screens' nodes change nothing.
//  - applied = one record per (entry, node[, run]) of this screen, in entry order then node order:
//    { entry (entry id), cat, code, node, run? (text runs), prop, from, to, szFrom? (R74, below) }. cat and code are carried so verify
//    (Task 6) can tell colour / radius / icon / ICON_FRAME / SRC_SQUASH records apart without the entry list.
//  - Every record must locate its node and find the current value equal to `from`: numbers within 0.01 px, colours
//    by hex (color.mjs toHex(parseColor(found)) === from, so 'rgb(26, 115, 232)' equals '#1a73e8'). A missing node,
//    a missing field, an unparsable colour or a different value throws an Error naming the entry id, the node (and
//    run), the prop and the value found. Nothing is skipped silently.
//  - to === from (a SRC_SQUASH answered 'declared' whose spec already holds the larger size) still gives an applied
//    record (it explains the squashed source) but writes nothing.
//
// prop -> SNode field (entry cat | prop | node type):
//   space  paddingT|R|B|L        lay.p[0..3]                   number px
//   space  gap                   lay.g                         number px (a space-between frame has no g: throws)
//   space  counterGap            lay.cg                        number px
//   size   width | height        w | h                         number px; the axis (sz[0] | sz[1]) must be FIXED,
//   icon   width | height        w | h                           else throws (icons without sz count as FIXED, as in
//                                                                inventory). HUG parents are not resized: the proxy
//                                                                recomputes them. R74: a SRC_SQUASH entry on a FILL /
//                                                                HUG axis restores it: w | h = to and sz[axis] =
//                                                                'FIXED'; its records carry szFrom (the old sizing).
//   icon   fontSize              font.fs                       'Npx'
//   radius radiusTL|TR|BR|BL     paint.radius[0..3]            'Npx' (a non-px corner never matches: throws)
//   border borderT|R|B|L         paint.border[0..3].w          number px (stroke width; normalize never emits it)
//   color  bg                    paint.bg
//   color  borderT|R|B|L         paint.border[0..3].color
//   color  fill | stroke         icon.fill | icon.stroke       (icon node)
//   color  color   (icon node)   icon.color
//   color  color   (text node)   runs[run].s.c, or font.c when that run has no own colour (see text runs)
//   type   fontSize              runs[run].s.fs, or font.fs when that run has no own size / the entry has no run
//   type   lineHeight            font.lh                       per node; a number stays a number, a string 'Npx'
//
// Text runs. inventory lists a run colour / run style once per text node (the first run that has it), so one
// explicit run can stand for several. For an entry on a text node: an explicit run with its own value changes that
// run's s.c / s.fs; an explicit run that inherits changes font.c / font.fs (and with it every run that inherits);
// every other non-<br> run of the node whose own value equals `from` changes too (it was listed under the same use,
// same role, same value, so it belongs to the same entry). Runs with an own value that differs are untouched. Only
// the explicit runs get an applied record. Colours of runs without `run` in the entry fall back to font.c.
//
// Colour notation: the new colour is written in the family of the value found. A hex value ('#rgb', '#rrggbb', any
// case) is replaced by the entry's hex (lower case); anything else (capture's computed 'rgb()' / 'rgba()', a named
// colour, oklch() ...) becomes Chrome's legacy serialisation 'rgb(r, g, b)', or 'rgba(r, g, b, a)' with alpha to 3
// decimals (round-trips to the same 8-digit hex).
//
// Text boxes. A changed font size or line height leaves the text node's w / h as figma-model pinned them (the Chrome
// box rounded with figmaTextBox): they are stale and are NOT recomputed here (that needs a browser). The node gets
// `font.remeasure = true` instead; the proxy treats it like `font.sub` (its HUG axes hug naturally in the new style,
// then are pinned to figmaTextBox of that size), so the stale HUG w / h are never used. FIXED / FILL text axes do
// not depend on the text and are kept. Without `remeasure` the proxy would pin the stale box (proxy.mjs ownSize).
import { parseColor, toHex } from './color.mjs';

const EPS = 0.01;
const SIDE = { T: 0, R: 1, B: 2, L: 3 };
const CORNER = { TL: 0, TR: 1, BR: 2, BL: 3 };
const APPLY = new Set(['auto', 'answered']);

const pxNum = (v) => {
  if (typeof v === 'number') return v;
  const m = /^\s*(-?\d*\.?\d+)(px)?\s*$/.exec(String(v ?? ''));
  return m ? +m[1] : null;
};
const hexOf = (v) => {
  if (typeof v !== 'string') return null;
  const c = parseColor(v);
  return c.unparsed !== undefined ? null : toHex(c);
};

function writeColor(found, toHexStr) {
  const to = String(toHexStr).toLowerCase();
  if (/^\s*#/.test(String(found))) return to;
  const c = parseColor(to);
  const ch = [c.r, c.g, c.b].map((x) => Math.round(x * 255));
  return c.a >= 1 ? `rgb(${ch.join(', ')})` : `rgba(${ch.join(', ')}, ${Number(c.a.toFixed(3))})`;
}

export function applyNorm(spec, entries, screenId) {
  const out = structuredClone(spec);
  const idx = new Map();
  const rec = (n) => { idx.set(String(n.id), n); (n.kids || []).forEach(rec); };
  rec(out);
  const sid = String(screenId);
  const applied = [];

  for (const e of entries || []) {
    if (!APPLY.has(e.status)) continue;
    const mine = (e.nodes || []).filter((n) => String(n.screen) === sid);
    // group this screen's nodes by node id (one text node can be listed with several runs)
    const byNode = new Map();
    for (const n of mine) (byNode.get(String(n.node)) || byNode.set(String(n.node), []).get(String(n.node))).push(n);
    for (const [nodeId, refs] of byNode) {
      const where = (run) => `apply-norm: entry ${e.id} node ${nodeId}${run !== undefined ? ` run ${run}` : ''} prop ${e.prop}`;
      const sn = idx.get(nodeId);
      if (!sn) throw new Error(`${where()}: node not found on screen ${sid}`);
      const extra = applyToNode(e, sn, refs.map((r) => r.run), where);
      for (const r of refs) {
        const a = { entry: e.id, cat: e.cat, code: e.code, node: r.node };
        if (r.run !== undefined) a.run = r.run;
        Object.assign(a, { prop: e.prop, from: e.from, to: e.to });
        if (extra && extra.szFrom) a.szFrom = extra.szFrom;
        applied.push(a);
      }
    }
  }
  return { spec: out, applied };
}

// a slot = { get, set } on one SNode field
const field = (obj, key) => ({ obj, get: () => (obj ? obj[key] : undefined), set: (v) => { obj[key] = v; } });

function applyToNode(e, sn, runs, where) {
  const isColor = e.cat === 'color';
  const matches = (v) => (isColor ? hexOf(v) === String(e.from).toLowerCase() : (() => { const n = pxNum(v); return n !== null && Math.abs(n - e.from) <= EPS; })());
  const same = isColor ? String(e.to).toLowerCase() === String(e.from).toLowerCase() : Math.abs(e.to - e.from) <= EPS;
  const check = (slot, run) => {
    const v = slot.get();
    if (!matches(v)) throw new Error(`${where(run)}: expected ${JSON.stringify(e.from)}, found ${JSON.stringify(v ?? null)}`);
  };
  // new value in the representation of the old one
  const conv = (old) => {
    if (isColor) return writeColor(old, e.to);
    return typeof old === 'number' ? e.to : `${e.to}px`;
  };
  const write = (slots) => {
    if (same) return;
    for (const s of slots) s.set(conv(s.get()));
  };
  const need = (obj, what) => { if (!obj) throw new Error(`${where()}: node has no ${what}`); return obj; };
  const one = (slot) => { check(slot); write([slot]); };

  const { cat, prop } = e;
  const side = /^border([TRBL])$/.exec(prop);
  if (cat === 'space') {
    const lay = need(sn.lay, 'lay');
    const pm = /^padding([TRBL])$/.exec(prop);
    if (pm) return one(field(need(lay.p, 'lay.p'), SIDE[pm[1]]));
    if (prop === 'gap') return one(field(lay, 'g'));
    if (prop === 'counterGap') return one(field(lay, 'cg'));
  } else if ((cat === 'size' || cat === 'icon') && (prop === 'width' || prop === 'height')) {
    const ax = prop === 'width' ? 0 : 1;
    const sz = Array.isArray(sn.sz) ? sn.sz[ax] : sn.t === 'V' ? 'FIXED' : undefined;
    if (sz !== 'FIXED') {
      // R74: a SRC_SQUASH restores the FIXED size the source declared on an axis the spec made FILL / HUG
      if (e.code !== 'SRC_SQUASH' || !Array.isArray(sn.sz) || (sz !== 'FILL' && sz !== 'HUG')) throw new Error(`${where()}: axis is ${sz ?? 'unsized'}, not FIXED`);
      one(field(sn, ax === 0 ? 'w' : 'h'));
      sn.sz[ax] = 'FIXED';
      return { szFrom: sz };
    }
    return one(field(sn, ax === 0 ? 'w' : 'h'));
  } else if (cat === 'icon' && prop === 'fontSize') {
    return one(field(need(sn.font, 'font'), 'fs'));
  } else if (cat === 'radius') {
    const cm = /^radius(TL|TR|BR|BL)$/.exec(prop);
    if (cm) return one(field(need(need(sn.paint, 'paint').radius, 'paint.radius'), CORNER[cm[1]]));
  } else if (cat === 'border' && side) {
    const b = need(need(sn.paint, 'paint').border, 'paint.border')[SIDE[side[1]]];
    return one(field(need(b, `border ${side[1]}`), 'w'));
  } else if (cat === 'color') {
    if (prop === 'bg') return one(field(need(sn.paint, 'paint'), 'bg'));
    if (side) {
      const b = need(need(sn.paint, 'paint').border, 'paint.border')[SIDE[side[1]]];
      return one(field(need(b, `border ${side[1]}`), 'color'));
    }
    if (prop === 'fill' || prop === 'stroke') return one(field(need(sn.icon, 'icon'), prop));
    if (prop === 'color' && sn.t === 'V') return one(field(need(sn.icon, 'icon'), 'color'));
    if (prop === 'color' && sn.t === 'T') return runLevel(sn, 'c', runs);
  } else if (cat === 'type') {
    if (prop === 'fontSize') { runLevel(sn, 'fs', runs); if (!same) sn.font.remeasure = true; return; }
    if (prop === 'lineHeight') { one(field(need(sn.font, 'font'), 'lh')); if (!same) sn.font.remeasure = true; return; }
  }
  throw new Error(`${where()}: no SNode field for cat ${cat} prop ${prop} on a node of type ${sn.t}`);

  // text: per run when the entry names runs, else node-level (see header)
  function runLevel(n, key, explicit) {
    const font = need(n.font, 'font');
    const list = Array.isArray(n.runs) && n.runs.length ? n.runs : null;
    const nodeSlot = field(font, key);
    const slots = new Set();
    for (const r of explicit) {
      if (r === undefined) { check(nodeSlot); slots.add(nodeSlot); continue; }
      const run = list ? list[r] : r === 0 ? {} : undefined;
      if (!run || run.br) throw new Error(`${where(r)}: no run ${r} on this text node`);
      if (run.s && run.s[key] !== undefined) {
        const s = field(run.s, key); check(s, r); slots.add(s);
      } else { check(nodeSlot, r); slots.add(nodeSlot); }
    }
    // peers: runs with their own value equal to from (listed once under the same use)
    for (const run of list || []) if (!run.br && run.s && run.s[key] !== undefined && matches(run.s[key])) slots.add(field(run.s, key));
    // one write per target object (the node slot or a run may be reached several ways)
    const seen = new Set();
    write([...slots].filter((s) => !seen.has(s.obj) && seen.add(s.obj)));
  }
}
