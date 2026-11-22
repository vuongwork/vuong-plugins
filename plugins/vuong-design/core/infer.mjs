// Infer: turn a captured Screen (boxes measured at widths A and B) into a tree that uses only Figma auto-layout
// concepts (spec §7). Layout is decided from geometry alone, never from display/flex/grid/margin. Computed style is
// read only for paint, font, the raster fallback and flex intent (flags only). Behaviours auto layout cannot express
// are reported as flags; overflowing or scrolling content is expressible in Figma and is never flagged.
//
// SNode = { id, t: 'F'|'T'|'V'|'I', w, h, sz: [x, y] of 'FILL'|'HUG'|'FIXED',
//   lay?: { d: 'H'|'V', wrap?, cg?, p: [t, r, b, l], g? | sb?, pa: 'S'|'C'|'E', ca: 'S'|'C'|'E'|'B' },
//   min?, max? (width in px), abs?: { x, y, c: 'L'|'R'|'LR'|'C'|'SCALE', cy?: 'B'|'TB'|'C'|'SCALE' (omitted = top) },
//   paint?, font?, runs?, icon?, src?, fit?, syn?, kids? }
// Stretch on the counter axis is expressed per child (sz FILL), so ca 'X' is never emitted.
// Every non-syn SNode id is its source INode id; synthetic frames are `<parentId>.g<k>` and have no source box.
// syn kinds: 'row'/'col'/'prox'/'push' groups, 'align' wrappers (counter-axis offset), 'track' (R42: equal FILL
// tracks with min = item width, item centred: CSS grid repeat(n, 1fr) + centred items, or space-around), 'anchor'
// (R47: zero-size frame on an axis where its one child has a % inset but a size that does not scale; the wrapper is
// SCALE-constrained at the inset's place, the child hangs from it with L/R (T/B) at 0 / -size).
// R47: constraint SCALE (per axis) only for an absolutely positioned source node whose authored inset or size on that
// axis is in % (capture's INode.pct) and whose boxes at A and B keep their share of the parent; never from geometry
// alone. Figma SCALE is relative to the parent frame's box; CSS % to the containing block's padding box, so a bordered
// or non-parent containing block fails the fit and keeps the fixed constraints (visible as deviations).

const EPS = 0.75;  // geometric equality tolerance
const GROW = 0.75; // "changed between widths"
const r2 = (v) => Math.round(v * 100) / 100;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const uniform = (a) => a.length === 0 || Math.max(...a) - Math.min(...a) <= EPS;
const union = (rs) => {
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const overlaps = (a, b) => {
  const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return ix > 0.5 && iy > 0.5;
};

// Paint-order key from a source id: '.b' (::before) and '.t' (sole text child) come first, '.a' (::after) last.
const segVal = (s) => (s === 'b' || s === 't' ? -1 : s === 'a' ? 1e9 : +s);
const cmpKey = (a, b) => {
  const A = a.split('.').slice(1).map(segVal), B = b.split('.').slice(1).map(segVal);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] === undefined) return -1;
    if (B[i] === undefined) return 1;
    if (A[i] !== B[i]) return A[i] - B[i];
  }
  return 0;
};
const keyOf = (L) => (L.src ? L.id : L.kids.map(keyOf).sort(cmpKey)[0]);
// R39 CSS paint order within a parent: negative z-index first, then non-positioned content, then positioned /
// transformed / translucent content with z-index auto or 0, then positive z-index; DOM order inside a layer.
const paintKey = (L) => {
  if (!L.src) return L.kids.map(paintKey).sort(cmpPaint)[0];
  const p = L.src.paint || {}, z = p.z ?? 0;
  const stacking = !!p.pos || p.z != null || !!p.transform || (p.opacity != null && p.opacity < 1);
  return { rank: !stacking ? 0 : z < 0 ? -1 : z > 0 ? 2 : 1, z, key: L.id };
};
const cmpPaint = (a, b) => a.rank - b.rank || a.z - b.z || cmpKey(a.key, b.key);

const isTextSrc = (n) => !!n && !n.icon && (n.kind === 'text' || (n.kind === 'pseudo' && !!n.runs));
const isText = (L) => isTextSrc(L.src);
const RASTER_BG = /url\(|conic-gradient|repeating-|image-set\(|cross-fade\(|element\(/;

// LNode: working node. A/B = box at width A/B. A node missing at B is treated as unchanged.
function lnode(n, par = null) {
  return { id: n.id, src: n, par, A: n.rA, B: n.rB || n.rA, kids: (n.kids || []).map((k) => lnode(k, n)) };
}
const SPACE_AROUND = /^(space-around|space-evenly)$/;

export function inferScreen(screen) {
  const stats = { grouping: 0, pushSplit: 0, spaceBetween: 0, absOverlap: 0, absOverflow: 0, absTransform: 0, wrappers: 0, wrapRows: 0 };
  const flags = [];
  const flag = (id, kind, detail) => flags.push({ id, kind, detail });
  const internal = new WeakMap(); // SNode -> { hugOK, fillAx, key }
  const synCount = new Map();
  const nameSyn = (parentId, L) => {
    if (!L.syn || L.id) return;
    const k = synCount.get(parentId) || 0;
    synCount.set(parentId, k + 1);
    L.id = `${parentId}.g${k}`;
  };
  const mkGroup = (items, hint, why) => {
    if (why === 'push') stats.pushSplit++; else stats.grouping++;
    return { id: null, syn: why, hint, A: union(items.map((i) => i.A)), B: union(items.map((i) => i.B)), kids: items };
  };

  const separable = (items, ax) => {
    const s = [...items].sort((a, b) => a.A[ax] - b.A[ax]);
    for (let i = 1; i < s.length; i++) if (s[i].A[ax] < s[i - 1].A[ax] + s[i - 1].A[ax + 2] - 0.5) return false;
    return true;
  };
  const bands = (items, ax, M = 'A') => {
    const s = [...items].sort((a, b) => a[M][ax] - b[M][ax]); const out = [];
    let end = -Infinity;
    for (const it of s) {
      if (out.length && it[M][ax] < end - 0.5) { out[out.length - 1].push(it); end = Math.max(end, it[M][ax] + it[M][ax + 2]); }
      else { out.push([it]); end = it[M][ax] + it[M][ax + 2]; }
    }
    return out;
  };
  const sortAx = (items, d) => [...items].sort((a, b) => (d === 'H' ? a.A[0] - b.A[0] : a.A[1] - b.A[1]));

  // ---- choose the axis; split into row/column bands when the children form a 2-D arrangement ----
  function arrange(L, items) {
    if (items.length === 0) return { d: null, items: [] };
    if (items.length === 1) return { d: L.hint || (isText(items[0]) ? 'H' : 'V'), items };
    const sepH = separable(items, 0), sepV = separable(items, 1);
    if (sepH && !sepV) return { d: 'H', items: sortAx(items, 'H') };
    if (sepV && !sepH) return { d: 'V', items: sortAx(items, 'V') };
    if (sepH && sepV) {
      const d = L.hint || (items.every((it, i) => i === 0 || it.A[1] >= items[i - 1].A[1]) ? 'V' : 'H');
      return { d, items: sortAx(items, d) };
    }
    const by = bands(items, 1), bx = bands(items, 0);
    if (by.length > 1) {
      // band memberships change at width B → real wrap
      const sig = (bs) => bs.map((b) => b.map((i) => i.id).sort().join(',')).sort().join('|');
      if (sig(by) !== sig(bands(items, 1, 'B'))) {
        stats.wrapRows++;
        return { d: 'H', wrap: true, items: by.flatMap((b) => sortAx(b, 'H')), rows: by.map((b) => sortAx(b, 'H')) };
      }
    }
    const rowsOf = () => ({ d: 'V', items: by.map((b) => (b.length > 1 ? mkGroup(b, 'H', 'row') : b[0])) });
    const colsOf = () => ({ d: 'H', items: bx.map((b) => (b.length > 1 ? mkGroup(b, 'V', 'col') : b[0])) });
    if (by.length > 1 && bx.length > 1) {
      const sameCount = by.every((b) => b.length === by[0].length);
      const anyGrow = items.some((i) => i.B[2] - i.A[2] > GROW);
      if (sameCount || !anyGrow || bx.some((b) => b.length > 1 && !separable(b, 1))) return rowsOf();
      return colsOf();
    }
    if (by.length > 1) return rowsOf();
    if (bx.length > 1) return colsOf();
    return { d: null, items: [], fallback: items };
  }

  // ---- primary axis: gap / space-between / push split / proximity grouping ----
  function primaryPlan(items, d) {
    const P = d === 'H' ? 0 : 1, Z = P + 2;
    const gaps = (arr, M) => arr.slice(1).map((it, i) => it[M][P] - (arr[i][M][P] + arr[i][M][Z]));
    let cur = items;
    for (let iter = 0; iter < 30; iter++) {
      if (cur.length < 2) return { mode: 'gap', g: 0, items: cur };
      const gA = gaps(cur, 'A'), gB = gaps(cur, 'B');
      const flex = gA.map((g, i) => gB[i] - g > GROW);
      if (flex.some(Boolean)) {
        if (flex.every(Boolean)) { stats.spaceBetween++; return { mode: 'sb', items: cur }; }
        const segs = [[cur[0]]];
        for (let i = 1; i < cur.length; i++) if (flex[i - 1]) segs.push([cur[i]]); else segs[segs.length - 1].push(cur[i]);
        cur = segs.map((s) => (s.length > 1 ? mkGroup(s, d, 'push') : s[0]));
        continue;
      }
      if (uniform(gA)) return { mode: 'gap', g: r2(mean(gA)), items: cur };
      const m = Math.min(...gA);
      const segs = [[cur[0]]];
      for (let i = 1; i < cur.length; i++) if (Math.abs(gA[i - 1] - m) <= EPS) segs[segs.length - 1].push(cur[i]); else segs.push([cur[i]]);
      cur = segs.map((s) => (s.length > 1 ? mkGroup(s, d, 'prox') : s[0]));
    }
    return { mode: 'gap', g: 0, items: cur };
  }

  // ---- R42 equal tracks: n equal items at a constant step whose offsets fit "centred in n equal tracks with gap g"
  // at both widths (CSS grid repeat(n, 1fr) + justify-items centre, or space-around). The tracks grow by Δ/n, so
  // the first item moves at B, which space-between cannot express. A track at A may sit on the item's width (the
  // grid's min-content floor). Only the combination 2p − g is fixed by the free case, so try g = stepA − w (floor
  // case) and g = 0. -> { g, tracks } (synthetic FILL wrappers, min = item width) | null
  function equalTracks(L, items) {
    const n = items.length;
    if (n < 2) return null;
    const w = items[0].A[2];
    if (items.some((it) => Math.abs(it.A[2] - w) > 0.5 || Math.abs(it.B[2] - w) > 0.5)) return null;
    const steps = (M) => items.slice(1).map((it, i) => it[M][0] - items[i][M][0]);
    const sA = steps('A'), sB = steps('B');
    if (Math.max(...sA) - Math.min(...sA) > 0.5 || Math.max(...sB) - Math.min(...sB) > 0.5) return null;
    const stepA = mean(sA), stepB = mean(sB);
    const c0B = items[0].B[0] - L.B[0] + w / 2;
    for (const g of [stepA - w, 0]) {
      if (g < 0) continue;
      const TB = stepB - g;
      if (TB < w - 0.01 || TB - w <= GROW) continue;
      const pS = c0B - TB / 2, pE = L.B[2] - pS - n * TB - (n - 1) * g;
      if (pS < -0.01 || pE < -0.01) continue;
      const TA = Math.max(w, (L.A[2] - pS - pE - (n - 1) * g) / n);
      const at = (M, T, i) => pS + i * (T + g) + (T - w) / 2;
      if (!items.every((it, i) => Math.abs(it.A[0] - L.A[0] - at('A', TA, i)) <= 0.5 && Math.abs(it.B[0] - L.B[0] - at('B', TB, i)) <= 0.5)) continue;
      const tracks = items.map((it, i) => ({
        id: null, syn: 'track', hint: 'H', min: w, kids: [it],
        A: [L.A[0] + pS + i * (TA + g), it.A[1], TA, it.A[3]], B: [L.B[0] + pS + i * (TB + g), it.B[1], TB, it.B[3]],
      }));
      return { g: r2(g), tracks };
    }
    return null;
  }

  // ---- baseline: first text leaf of each item; baseline ≈ line centre + κ·fontSize, κ = (ascent − descent) / 2 ----
  const firstText = (L) => {
    if (isText(L)) return L;
    for (const k of L.kids || []) { const t = firstText(k); if (t) return t; }
    return null;
  };
  function baselineFits(L, items) {
    const ms = [];
    for (const it of items) {
      const t = firstText(it);
      if (!t || !t.src.font) return false;
      const fs = parseFloat(t.src.font.fs), lh = Number(t.src.font.lh);
      if (!Number.isFinite(fs) || !Number.isFinite(lh)) return false;
      ms.push({ fs, a: t.A[1] - L.A[1] + lh / 2, b: t.B[1] - L.B[1] + lh / 2 });
    }
    const mf = mean(ms.map((m) => m.fs));
    const vf = ms.reduce((s, m) => s + (m.fs - mf) ** 2, 0);
    let k = 0.3; // same size everywhere: κ cancels out
    if (vf > 0.01) {
      const ma = mean(ms.map((m) => m.a));
      k = -ms.reduce((s, m) => s + (m.fs - mf) * (m.a - ma), 0) / vf;
      if (k < 0 || k > 0.6) return false;
    }
    return uniform(ms.map((m) => m.a + k * m.fs)) && uniform(ms.map((m) => m.b + k * m.fs));
  }

  // ---- leaf / node skeleton ----
  function baseSpec(L) {
    const n = L.src; const sp = { id: L.id, t: 'F', w: r2(L.A[2]), h: r2(L.A[3]) };
    if (L.syn) sp.syn = L.syn;
    if (!n) return sp;
    const p = n.paint || {};
    if (Object.keys(p).length) sp.paint = p;
    const why = [];
    if (p.filter) why.push(`filter: ${p.filter}`);
    if (p.clipPath) why.push(`clip-path: ${p.clipPath}`);
    if (p.bgImage && RASTER_BG.test(p.bgImage)) why.push(`background-image: ${p.bgImage}`);
    if (why.length) flag(n.id, 'raster', why.join('; '));
    // shrink: a flex item squeezed below its unshrunk size while its container does not overflow
    const fx = n.flex;
    if (fx && fx.s > 0 && fx.n != null && !(L.par && L.par.flexBox && L.par.flexBox.ov)) {
      const size = fx.ax === 'y' ? L.A[3] : L.A[2];
      if (fx.n - size > 1) flag(n.id, 'shrink', `flex-shrink ${fx.s}: ${r2(size)}px instead of ${r2(fx.n)}px`);
    }
    const fb = n.flexBox;
    if (fb && SPACE_AROUND.test(fb.jc) && (n.kids || []).length >= 2) flag(n.id, 'spaceAround', `justify-content: ${fb.jc}`);
    if (isTextSrc(n)) {
      sp.t = 'T'; sp.font = n.font; sp.runs = n.runs;
    } else if (n.kind === 'icon') {
      sp.t = 'V'; sp.icon = n.icon; if (n.font) sp.font = n.font;
    } else if (n.kind === 'image') {
      sp.t = 'I'; sp.src = n.src; sp.fit = n.fit;
    }
    return sp;
  }
  const textHug = (L) => {
    const n = L.src;
    return isText(L) && !!n.lines && n.lines[0] === 1 && (n.lines[1] ?? 1) === 1 && !!n.tw && Math.abs(L.A[2] - n.tw[0]) < 1;
  };
  const defaultSize = (L, sp, ax) => { // ax 0 = width, 1 = height
    if (sp.t === 'T') return ax === 1 || textHug(L) ? 'HUG' : 'FIXED';
    return sp.lay && internal.get(sp).hugOK[ax] ? 'HUG' : 'FIXED';
  };

  // Figma constraint that best predicts the box at width B (ties: simplest first). SCALE only through pctMode (R47).
  const constraint = (s1, e1, s2, e2, z1, z2, p1, p2, names) => {
    const grows = Math.abs(z2 - z1) > GROW;
    const cand = [
      [names[0], Math.abs(s1 - s2) + Math.abs(z2 - z1)],
      [names[1], Math.abs(e1 - e2) + Math.abs(z2 - z1)],
      [names[2], Math.abs(s1 - s2) + Math.abs(e1 - e2)],
      [names[3], Math.abs((s1 + z1 / 2 - p1 / 2) - (s2 + z2 / 2 - p2 / 2)) + Math.abs(z2 - z1)],
    ];
    let best = cand[0];
    for (const c of cand) if (c[1] < best[1] - 0.05) best = c;
    if (best === cand[2] && !grows) best = cand[0][1] <= cand[1][1] ? cand[0] : cand[1];
    return best[0];
  };

  // R47: per axis, how an absolutely positioned node with an authored % on that axis follows its parent:
  // 'SCALE' (position and size keep their share of the parent: Figma SCALE), 'S' / 'E' (the start / end inset keeps
  // its share while the size stays: anchor wrapper), or null (no % on the axis, or the geometry at A and B fits
  // neither, e.g. the containing block is not the parent or has a border: the fixed constraints stand in). When the
  // parent does not change on the axis the geometry cannot tell, and the authored form decides.
  const PCT_TOL = 0.5;
  function pctMode(L, k, ax, s1, e1, s2, e2) {
    const pc = k.src && k.src.pct, pos = k.src && k.src.paint && k.src.paint.pos;
    if (!pc || !/^(absolute|fixed)$/.test(pos || '')) return null;
    const [ps, pe, pz] = ax ? ['t', 'b', 'h'] : ['l', 'r', 'w'];
    if (!pc[ps] && !pc[pe] && !pc[pz]) return null;
    const P1 = L.A[ax + 2], P2 = L.B[ax + 2], z1 = k.A[ax + 2], z2 = k.B[ax + 2];
    if (!(P1 > 0)) return null;
    const sc = (v) => (v / P1) * P2;
    const errScale = Math.abs(sc(s1) - s2) + Math.abs(sc(z1) - z2);
    const errS = Math.abs(sc(s1) - s2) + Math.abs(z2 - z1), errE = Math.abs(sc(e1) - e2) + Math.abs(z2 - z1);
    const scales = !!pc[pz] || (!!pc[ps] && !!pc[pe]);
    if (Math.abs(P2 - P1) <= GROW) return scales ? 'SCALE' : pc[ps] ? 'S' : 'E';
    if (errScale <= PCT_TOL) return 'SCALE';
    if (pc[ps] && errS <= PCT_TOL && (!pc[pe] || errS <= errE)) return 'S';
    if (pc[pe] && errE <= PCT_TOL) return 'E';
    return null;
  }

  // ---- recursive frame inference ----
  function infer(L) {
    const sp = baseSpec(L);
    const inf = { hugOK: [false, false], fillAx: [false, false], key: keyOf(L), pk: paintKey(L) };
    internal.set(sp, inf);
    if (!L.kids || !L.kids.length) return sp;
    const kids = L.kids;
    const abs = new Map(); // LNode -> reason
    for (const k of kids) if (k.src && k.src.paint && k.src.paint.transform) { abs.set(k, 'transform'); stats.absTransform++; }
    // overlap → absolute (highest overlap degree first; pairwise: the later one in paint order)
    for (;;) {
      const flow = kids.filter((k) => !abs.has(k));
      const deg = new Map(flow.map((k) => [k, 0])); let any = false;
      for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
        if (overlaps(flow[i].A, flow[j].A)) { deg.set(flow[i], deg.get(flow[i]) + 1); deg.set(flow[j], deg.get(flow[j]) + 1); any = true; }
      }
      if (!any) break;
      const maxD = Math.max(...deg.values());
      const pick = (maxD >= 2 ? flow.filter((k) => deg.get(k) === maxD) : flow.filter((k) => deg.get(k) > 0)).pop();
      abs.set(pick, 'overlap'); stats.absOverlap++;
    }
    // overflow → absolute, unless it only overflows at the primary-axis end (clipped flow content)
    let arr;
    for (let it = 0; it < 5; it++) {
      const flow = kids.filter((k) => !abs.has(k));
      arr = arrange(L, flow);
      let changed = false;
      for (const k of flow) {
        const out = [k.A[0] < L.A[0] - 0.5, k.A[1] < L.A[1] - 0.5, k.A[0] + k.A[2] > L.A[0] + L.A[2] + 0.5, k.A[1] + k.A[3] > L.A[1] + L.A[3] + 0.5];
        if (!out.some(Boolean)) continue;
        const endSide = arr.d === 'H' ? 2 : arr.d === 'V' ? 3 : -1;
        if (out.every((o, i) => !o || i === endSide)) continue;
        abs.set(k, 'overflow'); stats.absOverflow++; changed = true;
      }
      if (!changed) break;
    }
    // made absolute for overlapping something that is itself absolute now → back to flow
    for (let it = 0; it < 3; it++) {
      const flow = kids.filter((k) => !abs.has(k)); let back = false;
      for (const [k, why] of abs) if (why === 'overlap' && !flow.some((f) => overlaps(f.A, k.A))) { abs.delete(k); stats.absOverlap--; back = true; }
      if (!back) break;
      arr = arrange(L, kids.filter((k) => !abs.has(k)));
    }
    // a lone flow child that grows without keeping its insets (e.g. width:60%) → absolute
    if (arr.d && arr.items.length === 1 && !arr.items[0].syn) {
      const k = arr.items[0];
      const insetsKept = (ax) => Math.abs((k.A[ax] - L.A[ax]) - (k.B[ax] - L.B[ax])) < EPS &&
        Math.abs((L.A[ax] + L.A[ax + 2] - k.A[ax] - k.A[ax + 2]) - (L.B[ax] + L.B[ax + 2] - k.B[ax] - k.B[ax + 2])) < EPS;
      const scaleFits = (ax) => Math.abs((k.A[ax] - L.A[ax]) / L.A[ax + 2] * L.B[ax + 2] - (k.B[ax] - L.B[ax])) +
        Math.abs(k.A[ax + 2] / L.A[ax + 2] * L.B[ax + 2] - k.B[ax + 2]) <= 0.5;
      if (!isText(k) && [0, 1].some((ax) => k.B[ax + 2] - k.A[ax + 2] > GROW && !insetsKept(ax) && scaleFits(ax))) {
        abs.set(k, 'percent'); arr = arrange(L, []);
      }
    }
    if (arr.fallback) for (const k of arr.fallback) abs.set(k, 'fallback');

    const childSpecs = [];
    if (arr.d) {
      const lay = { d: arr.d };
      sp.lay = lay;
      const d = arr.d, P = d === 'H' ? 0 : 1, Z = P + 2, C = 1 - P, CZ = C + 2;
      let items = arr.items, plan, finalItems;
      if (arr.wrap) {
        lay.wrap = 1;
        const rowGaps = arr.rows.flatMap((r) => r.slice(1).map((it, i) => it.A[0] - (r[i].A[0] + r[i].A[2])));
        const rg = arr.rows.slice(1).map((r, i) => Math.min(...r.map((x) => x.A[1])) - Math.max(...arr.rows[i].map((x) => x.A[1] + x.A[3])));
        plan = { mode: 'gap', g: rowGaps.length ? r2(mean(rowGaps)) : 0, items };
        lay.cg = rg.length ? r2(mean(rg)) : 0;
        const cb0 = union(items.map((i) => i.A));
        lay.p = [cb0[1] - L.A[1], L.A[0] + L.A[2] - (cb0[0] + cb0[2]), L.A[1] + L.A[3] - (cb0[1] + cb0[3]), cb0[0] - L.A[0]].map((v) => r2(Math.max(0, v)));
        lay.g = plan.g; lay.pa = 'S'; lay.ca = 'S';
        // R37: the end padding is only bounded by the breaks (every line fits, the next line's first item did not),
        // at A and at B. Use the midpoint of that interval, never the exact slack of the fullest line: Figma's text
        // round-up would push that line's last item to the next line.
        const rowsAt = (M) => bands(items, 1, M).map((b) => [...b].sort((a, c) => a[M][0] - c[M][0]));
        const rowsAB = { A: arr.rows, B: rowsAt('B') };
        {
          let lo = 0, hi = Infinity;
          for (const M of ['A', 'B']) {
            const endX = L[M][0] + L[M][2];
            rowsAB[M].forEach((r, i) => {
              const re = Math.max(...r.map((x) => x[M][0] + x[M][2]));
              hi = Math.min(hi, endX - re);
              const nx = rowsAB[M][i + 1];
              if (nx) lo = Math.max(lo, endX - (re + plan.g + nx[0][M][2]));
            });
          }
          if (Number.isFinite(hi) && hi >= lo) lay.p[1] = r2(Math.max(0, (lo + hi) / 2));
        }
        // R37: cross alignment of the items inside each line (Figma applies the counter alignment per line)
        const fitsRow = (a) => ['A', 'B'].every((M) => rowsAB[M].every((r) => {
          const t = Math.min(...r.map((x) => x[M][1])), b = Math.max(...r.map((x) => x[M][1] + x[M][3]));
          return r.every((x) => (a === 'S' ? Math.abs(x[M][1] - t) : a === 'E' ? Math.abs(x[M][1] + x[M][3] - b)
            : Math.abs((x[M][1] - t) - (b - x[M][1] - x[M][3]))) <= 0.5);
        }));
        if (!fitsRow('S')) lay.ca = fitsRow('C') ? 'C' : fitsRow('E') ? 'E' : 'S';
        finalItems = items.map((it) => ({ c: { stretch: false }, it }));
      } else {
        plan = primaryPlan(items, d);
        if (plan.mode === 'sb' && d === 'H' && plan.items.length === items.length) {
          const tr = equalTracks(L, items);
          if (tr) { plan = { mode: 'gap', g: tr.g, items: tr.tracks }; stats.tracks = (stats.tracks || 0) + 1; stats.spaceBetween--; }
        }
        items = plan.items;
        const first = items[0], last = items[items.length - 1];
        const padS = first.A[P] - L.A[P], padE = L.A[P] + L.A[Z] - (last.A[P] + last.A[Z]);
        // counter axis
        const cinfo = items.map((it) => {
          const lA = it.A[C] - L.A[C], rA = L.A[C] + L.A[CZ] - (it.A[C] + it.A[CZ]);
          const lB = it.B[C] - L.B[C], rB = L.B[C] + L.B[CZ] - (it.B[C] + it.B[CZ]);
          const grows = it.B[CZ] - it.A[CZ] > GROW;
          return { it, lA, rA, lB, rB, stretch: grows && Math.abs(lA - lB) < EPS && Math.abs(rA - rB) < EPS };
        });
        const st = cinfo.filter((c) => c.stretch);
        let padCS, padCE;
        const modeOf = (vals) => { // most common value (within EPS)
          let best = null, bc = 0;
          for (const v of vals) { const c = vals.filter((w) => Math.abs(w - v) <= EPS).length; if (c > bc || (c === bc && v < best)) { bc = c; best = v; } }
          return best;
        };
        if (st.length) {
          padCS = Math.min(...st.map((c) => c.lA)); padCE = Math.min(...st.map((c) => c.rA));
          st.forEach((c) => { if (Math.abs(c.lA - padCS) > EPS || Math.abs(c.rA - padCE) > EPS) { c.stretch = false; c.stretchMis = true; } });
        }
        const anyStretch = st.some((c) => c.stretch);
        const non = cinfo.filter((c) => !c.stretch);
        const fitFn = {
          S: (c, v) => Math.abs(c.lA - v) <= EPS && Math.abs(c.lB - v) <= EPS,
          E: (c, v) => Math.abs(c.rA - v) <= EPS && Math.abs(c.rB - v) <= EPS,
          C: (c, v) => Math.abs((c.lA - c.rA) - v) <= EPS && Math.abs((c.lB - c.rB) - v) <= EPS,
        };
        const valOf = { S: (c) => c.lA, E: (c) => c.rA, C: (c) => c.lA - c.rA };
        let best = null;
        for (const a of ['S', 'C', 'E']) {
          const v = anyStretch ? (a === 'S' ? padCS : a === 'E' ? padCE : padCS - padCE) : (non.length ? modeOf(non.map(valOf[a])) : 0);
          const fits = non.filter((c) => fitFn[a](c, v)).length;
          // R36: equal fit count → smallest summed residual wins (EPS is wider than verify's tolerance, so loop
          // order would turn a sub-EPS offset into a root)
          const res = non.reduce((s, c) => s + Math.abs(valOf[a](c) - v), 0);
          if (!best || fits > best.fits || (fits === best.fits && res < best.res - 1e-6)) best = { a, v, fits, res };
        }
        let ca = best.a;
        // text items on one baseline: Figma baseline alignment replaces one wrapper per misfit
        const baseline = d === 'H' && !st.length && best.fits < non.length && baselineFits(L, items);
        if (baseline) {
          ca = 'B'; padCS = Math.min(...cinfo.map((c) => c.lA)); padCE = Math.min(...cinfo.map((c) => c.rA));
        } else if (!anyStretch) {
          const fitting = non.filter((c) => fitFn[ca](c, best.v));
          if (ca === 'S') { padCS = best.v; padCE = Math.min(...cinfo.map((c) => c.rA)); }
          else if (ca === 'E') { padCE = best.v; padCS = Math.min(...cinfo.map((c) => c.lA)); }
          else { padCS = Math.min(...fitting.map((c) => c.lA)); padCE = padCS - best.v; }
        }
        padCS = Math.max(0, padCS); padCE = Math.max(0, padCE);
        // misfits → alignment wrapper (synthetic frame whose padding carries the offset), or absolute if negative
        finalItems = [];
        for (const c of cinfo) {
          if (baseline || c.stretch || (!c.stretchMis && fitFn[ca](c, best.v))) { finalItems.push({ c, it: c.it }); continue; }
          if (c.stretchMis && anyStretch && c.lA >= padCS - 0.5 && c.rA >= padCE - 0.5) {
            // stretched child with its own inset: stretched wrapper whose padding carries the inset
            const ext = (r, l, rr) => { const q = [...r]; q[C] -= l; q[CZ] += l + rr; return q; };
            const W = { id: null, syn: 'align', hint: d, A: ext(c.it.A, c.lA - padCS, c.rA - padCE), B: ext(c.it.B, c.lB - padCS, c.rB - padCE), kids: [c.it] };
            stats.wrappers++;
            finalItems.push({ c: { ...c, stretch: true }, it: W }); continue;
          }
          const off = ca === 'S' ? c.lA - padCS : ca === 'E' ? c.rA - padCE : (c.lA - c.rA) - (padCS - padCE);
          if (ca !== 'C' && off < -0.5) { abs.set(c.it, 'counter-misfit'); continue; }
          const grow = (r) => {
            const q = [...r];
            if (ca === 'S' || (ca === 'C' && off > 0)) { q[C] -= Math.abs(off); q[CZ] += Math.abs(off); } else q[CZ] += Math.abs(off);
            return q;
          };
          const W = { id: null, syn: 'align', hint: d, A: grow(c.it.A), B: grow(c.it.B), kids: [c.it] };
          stats.wrappers++;
          finalItems.push({ c: { ...c, stretch: false }, it: W });
        }
        items = finalItems.map((f) => f.it);
        lay.p = (d === 'H' ? [padCS, padE, padCE, padS] : [padS, padCE, padE, padCS]).map((v) => r2(Math.max(0, v)));
        if (plan.mode === 'sb') lay.sb = 1; else lay.g = plan.g;
        lay.pa = 'S';
        lay.ca = ca;
        // primary alignment from width B
        if (plan.mode !== 'sb' && items.length) {
          const contB = items.reduce((s, it) => s + it.B[Z], 0) + (plan.g || 0) * (items.length - 1);
          const freeB = L.B[Z] - padS - padE - contB;
          const act = items[0].B[P] - L.B[P];
          let err = Math.abs(act - padS);
          for (const [a, pred] of [['C', padS + freeB / 2], ['E', padS + freeB]]) {
            if (Math.abs(act - pred) < err - 0.25) { lay.pa = a; err = Math.abs(act - pred); }
          }
        }
      }
      // child sizing
      const fills = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; const c = finalItems[i].c;
        nameSyn(L.id, it);
        const cs = infer(it);
        const prim = it.B[Z] - it.A[Z] > GROW ? 'FILL' : defaultSize(it, cs, P);
        const cnt = c.stretch ? 'FILL' : defaultSize(it, cs, C);
        cs.sz = d === 'H' ? [prim, cnt] : [cnt, prim];
        if (it.syn === 'track' && prim === 'FILL') cs.min = r2(it.min); // R42: the grid's min-content floor
        if (prim === 'FILL') { inf.fillAx[P] = true; fills.push([it, cs]); }
        if (cnt === 'FILL') inf.fillAx[C] = true;
        childSpecs.push(cs);
      }
      // min/max are widths (Figma minWidth/maxWidth), so only set on a horizontal primary axis
      if (fills.length === 1 && P === 0) {
        // a single FILL child that grows less than the free space → FILL capped by maxWidth
        const [f, cs] = fills[0];
        if ((L.B[Z] - L.A[Z]) - (f.B[Z] - f.A[Z]) > GROW) cs.max = r2(f.B[Z]);
      }
      if (fills.length > 1) {
        const spread = (M) => Math.max(...fills.map(([f]) => f[M][Z])) - Math.min(...fills.map(([f]) => f[M][Z]));
        const eqA = spread('A') <= 1, eqB = spread('B') <= 1;
        if (!eqA && eqB && P === 0) {
          // unequal at A, equal at B: the larger ones hit a content floor → Figma minWidth
          const mn = Math.min(...fills.map(([f]) => f.A[Z]));
          for (const [f, cs] of fills) if (f.A[Z] > mn + 1) cs.min = r2(f.A[Z]);
        }
      }
      // weightedFill: Figma FILL behaves like flex: 1 1 0, so FILL siblings with different flex-grow, or equal grow
      // on a non-zero basis (auto/content/px) that leaves them at different sizes, cannot be reproduced
      const grows = fills.filter(([f]) => f.src && f.src.flex);
      if (grows.length > 1) {
        const fx = grows.map(([f]) => f.src.flex);
        const zeroBasis = (b) => /^0(\.0+)?(px|%)?$/.test(String(b).trim());
        const sizes = grows.map(([f]) => f.A[Z]);
        let detail = null;
        if (new Set(fx.map((x) => x.g)).size > 1) detail = `flex-grow ${fx.map((x) => x.g).join('/')}`;
        else if (fx.some((x) => !zeroBasis(x.b)) && Math.max(...sizes) - Math.min(...sizes) > 0.5) {
          detail = `equal flex-grow ${fx[0].g} on basis ${fx.map((x) => x.b).join('/')}, sizes ${sizes.map(r2).join('/')}`;
        }
        if (detail) for (const [f] of grows) flag(f.id, 'weightedFill', detail);
      }
      // HUG is valid on an axis when frame size == content bbox + padding at BOTH widths
      const cb = union(items.map((i) => i.A)), cbB = union(items.map((i) => i.B));
      const pads = [[lay.p[3], lay.p[1]], [lay.p[0], lay.p[2]]];
      inf.hugOK = [0, 1].map((ax) => !inf.fillAx[ax] && !(ax === P && (lay.sb || lay.wrap)) &&
        Math.abs(L.A[ax + 2] - (cb[ax + 2] + pads[ax][0] + pads[ax][1])) <= EPS &&
        Math.abs(L.B[ax + 2] - (cbB[ax + 2] + pads[ax][0] + pads[ax][1])) <= EPS);
    }
    // absolute children with constraints from two widths
    for (const [k] of abs) {
      nameSyn(L.id, k);
      const cs = infer(k);
      const lA = k.A[0] - L.A[0], rA = L.A[0] + L.A[2] - (k.A[0] + k.A[2]), lB = k.B[0] - L.B[0], rB = L.B[0] + L.B[2] - (k.B[0] + k.B[2]);
      const tA = k.A[1] - L.A[1], bA = L.A[1] + L.A[3] - (k.A[1] + k.A[3]), tB = k.B[1] - L.B[1], bB = L.B[1] + L.B[3] - (k.B[1] + k.B[3]);
      const px = [constraint(lA, rA, lB, rB, k.A[2], k.B[2], L.A[2], L.B[2], ['L', 'R', 'LR', 'C']),
        constraint(tA, bA, tB, bB, k.A[3], k.B[3], L.A[3], L.B[3], ['T', 'B', 'TB', 'C'])];
      const pm = [pctMode(L, k, 0, lA, rA, lB, rB), pctMode(L, k, 1, tA, bA, tB, bB)];
      const con = [0, 1].map((ax) => (pm[ax] === 'SCALE' ? 'SCALE' : px[ax]));
      cs.abs = { x: r2(lA), y: r2(tA), c: con[0] };
      if (con[1] !== 'T') cs.abs.cy = con[1];
      cs.sz = [defaultSize(k, cs, 0), defaultSize(k, cs, 1)];
      if (!pm.some((m) => m === 'S' || m === 'E')) { childSpecs.push(cs); continue; }
      // R47 anchor: a % inset with a size that does not scale. Figma has no "scale position, keep size" constraint,
      // so a zero-size frame on that axis carries the % position (SCALE keeps it at 0) and the node hangs from it,
      // start- or end-aligned. On the other axis the wrapper takes the node's extent and constraint.
      const off = [[lA, k.A[2]], [tA, k.A[3]]];
      const W = { id: `${L.id}.g${synCount.get(L.id) || 0}`, t: 'F', syn: 'anchor', w: 0, h: 0, sz: ['FIXED', 'FIXED'] };
      synCount.set(L.id, (synCount.get(L.id) || 0) + 1);
      const wa = [], ka = [];
      for (const ax of [0, 1]) {
        const [o, z] = off[ax], anch = pm[ax] === 'S' || pm[ax] === 'E';
        if (anch) {
          wa[ax] = { at: r2(pm[ax] === 'E' ? o + z : o), c: 'SCALE' };
          ka[ax] = pm[ax] === 'E' ? { at: r2(-z), c: ax ? 'B' : 'R' } : { at: 0, c: ax ? 'T' : 'L' };
        } else {
          wa[ax] = { at: r2(o), c: con[ax], z: r2(z) };
          ka[ax] = { at: 0, c: /^(LR|TB|SCALE)$/.test(con[ax]) ? (ax ? 'TB' : 'LR') : ax ? 'T' : 'L' };
        }
      }
      W.w = wa[0].z ?? 0; W.h = wa[1].z ?? 0;
      W.abs = { x: wa[0].at, y: wa[1].at, c: wa[0].c };
      if (wa[1].c !== 'T') W.abs.cy = wa[1].c;
      cs.abs = { x: ka[0].at, y: ka[1].at, c: ka[0].c };
      if (ka[1].c !== 'T') cs.abs.cy = ka[1].c;
      W.kids = [cs];
      internal.set(W, { hugOK: [false, false], fillAx: [false, false], key: internal.get(cs).key, pk: internal.get(cs).pk });
      childSpecs.push(W);
    }
    // z-order: flow children keep primary order (auto layout order is paint order); absolute children are inserted
    // by CSS paint order (R39), before the first child CSS paints above them
    const out = childSpecs.filter((c) => !c.abs);
    for (const a of childSpecs.filter((c) => c.abs).sort((x, y) => cmpPaint(internal.get(x).pk, internal.get(y).pk))) {
      const ka = internal.get(a).pk; let pos = out.length;
      for (let i = 0; i < out.length; i++) if (cmpPaint(internal.get(out[i]).pk, ka) > 0) { pos = i; break; }
      out.splice(pos, 0, a);
    }
    sp.kids = out;
    return sp;
  }

  const root = lnode(screen.tree);
  const spec = infer(root);
  const H = screen.H || [root.A[3], root.B[3]];
  spec.sz = ['FIXED', Math.abs(H[1] - H[0]) > GROW && internal.get(spec).hugOK[1] ? 'HUG' : 'FIXED'];
  if (screen.widen && screen.widen.unsafe) flag(spec.id, 'unsafeWiden', screen.widen.reason || 'no safe widening delta');

  // free space on an axis that is neither HUG nor filled by a child belongs to alignment, not padding
  const norm = (n) => {
    const l = n.lay;
    if (l && n.sz) {
      const P = l.d === 'H' ? 0 : 1, fillAx = internal.get(n).fillAx;
      for (const ax of [0, 1]) {
        if (n.sz[ax] === 'HUG' || fillAx[ax] || (l.wrap && ax === P)) continue;
        const al = ax === P ? (l.sb ? null : l.pa) : l.ca;
        if (!al || al === 'B') continue;
        const si = ax === 0 ? 3 : 0, ei = ax === 0 ? 1 : 2;
        if (al === 'S') l.p[ei] = 0;
        else if (al === 'E') l.p[si] = 0;
        else { const m = Math.min(l.p[si], l.p[ei]); l.p[si] = r2(l.p[si] - m); l.p[ei] = r2(l.p[ei] - m); }
      }
    }
    (n.kids || []).forEach(norm);
  };
  const keepP = (n) => { if (n.lay) internal.get(n).p0 = [...n.lay.p]; (n.kids || []).forEach(keepP); };
  keepP(spec);
  norm(spec);
  // R38: FILL items share the main axis like flex 1 1 0 (CSS and Figma alike): each gets its own main-axis padding
  // plus an equal share. An end padding norm zeroed (start-aligned content) changes that split, so give it back
  // until (size - main padding) is equal across the FILL siblings, capped at what norm removed. Containers or FILL
  // items flagged shrink / weightedFill keep the plain normalisation: their split is the flag's, not padding's.
  const flagged = new Set(flags.filter((f) => f.kind === 'shrink' || f.kind === 'weightedFill').map((f) => f.id));
  const fillPad = (c) => {
    const l = c.lay;
    if (l && !l.wrap && c.kids && !flagged.has(c.id)) {
      const ax = l.d === 'H' ? 0 : 1, si = ax === 0 ? 3 : 0, ei = ax === 0 ? 1 : 2, Z = ax === 0 ? 'w' : 'h';
      const F = c.kids.filter((k) => !k.abs && k.sz && k.sz[ax] === 'FILL' && k.lay);
      if (F.length > 1 && !F.some((k) => flagged.has(k.id))) {
        const net = (k) => k[Z] - k.lay.p[si] - k.lay.p[ei];
        const share = Math.min(...F.map(net));
        for (const k of F) {
          const al = (k.lay.d === 'H' ? 0 : 1) === ax ? (k.lay.sb ? null : k.lay.pa) : k.lay.ca;
          const p0 = internal.get(k).p0, extra = net(k) - share;
          if (!p0 || extra <= 0.5) continue;
          if (al === 'S') k.lay.p[ei] = r2(k.lay.p[ei] + Math.min(extra, p0[ei] - k.lay.p[ei]));
          else if (al === 'E') k.lay.p[si] = r2(k.lay.p[si] + Math.min(extra, p0[si] - k.lay.p[si]));
        }
      }
    }
    (c.kids || []).forEach(fillPad);
  };
  fillPad(spec);
  return { spec, stats, flags };
}
