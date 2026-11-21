// Infer: turn a captured Screen (boxes measured at widths A and B) into a tree that uses only Figma auto-layout
// concepts (spec §7). Layout is decided from geometry alone, never from display/flex/grid/margin. Computed style is
// read only for paint, font, the raster fallback and flex intent (flags only). Behaviours auto layout cannot express
// are reported as flags; overflowing or scrolling content is expressible in Figma and is never flagged.
//
// SNode = { id, t: 'F'|'T'|'V'|'I', w, h, sz: [x, y] of 'FILL'|'HUG'|'FIXED',
//   lay?: { d: 'H'|'V', wrap?, cg?, p: [t, r, b, l], g? | sb?, pa: 'S'|'C'|'E', ca: 'S'|'C'|'E'|'B' },
//   min?, max? (width in px), abs?: { x, y, c: 'L'|'R'|'LR'|'C', cy?: 'B'|'TB'|'C' (omitted = top) },
//   paint?, font?, runs?, icon?, src?, fit?, syn?, kids? }
// Stretch on the counter axis is expressed per child (sz FILL), so ca 'X' is never emitted.
// Every non-syn SNode id is its source INode id; synthetic frames are `<parentId>.g<k>` and have no source box.

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

  // Figma constraint that best predicts the box at width B (ties: simplest first). No SCALE: C or LR stand in.
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

  // ---- recursive frame inference ----
  function infer(L) {
    const sp = baseSpec(L);
    const inf = { hugOK: [false, false], fillAx: [false, false], key: keyOf(L) };
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
        finalItems = items.map((it) => ({ c: { stretch: false }, it }));
      } else {
        plan = primaryPlan(items, d);
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
          if (!best || fits > best.fits) best = { a, v, fits };
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
      // weightedFill: FILL siblings whose flex-grow differs (Figma FILL shares free space equally)
      const grows = fills.filter(([f]) => f.src && f.src.flex);
      if (grows.length > 1 && new Set(grows.map(([f]) => f.src.flex.g)).size > 1) {
        const detail = `flex-grow ${grows.map(([f]) => f.src.flex.g).join('/')}`;
        for (const [f] of grows) flag(f.id, 'weightedFill', detail);
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
      cs.abs = { x: r2(lA), y: r2(tA), c: constraint(lA, rA, lB, rB, k.A[2], k.B[2], L.A[2], L.B[2], ['L', 'R', 'LR', 'C']) };
      const cy = constraint(tA, bA, tB, bB, k.A[3], k.B[3], L.A[3], L.B[3], ['T', 'B', 'TB', 'C']);
      if (cy !== 'T') cs.abs.cy = cy;
      cs.sz = [defaultSize(k, cs, 0), defaultSize(k, cs, 1)];
      childSpecs.push(cs);
    }
    // z-order: flow children keep primary order; absolute children are inserted by paint-order key
    const out = childSpecs.filter((c) => !c.abs);
    for (const a of childSpecs.filter((c) => c.abs)) {
      const ka = internal.get(a).key; let pos = out.length;
      for (let i = 0; i < out.length; i++) if (cmpKey(internal.get(out[i]).key, ka) > 0) { pos = i; break; }
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
  norm(spec);
  return { spec, stats, flags };
}
