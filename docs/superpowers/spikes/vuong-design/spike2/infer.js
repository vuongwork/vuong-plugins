// Infer Figma auto layout recursively from measured geometry at two widths (doc §7).
// No branching on display/flex/grid/margin. Inputs per node: layout box at width A and B (+ paint/text data).
// Output spec uses only auto-layout concepts: frame{d,p,g|sb,pa,ca,wrap,cg}, child sz [x,y] in F(ill)/H(ug)/X(fixed), abs{x,y,cx,cy}.
const EPS = 0.75;      // geometric equality tolerance used by inference
const GROW = 0.75;     // "changed between widths"

function mkStats() {
  return { prox: 0, proxEx: [], push: 0, pushEx: [], sb: 0, bandRows: 0, bandCols: 0, wrap: 0, alignWrap: 0, alignWrapEx: [],
    absOverlap: 0, absOverflow: 0, absTransform: 0, allAbsFallback: 0, allAbsEx: [], primaryMis: 0, primaryMisEx: [],
    counterMis: 0, counterMisEx: [], unequalFill: 0, unequalFillEx: [], sbUneven: 0, sbUnevenEx: [], rasterFallback: 0, frames: 0, singles: 0 };
}

const union = (rs) => {
  const x0 = Math.min(...rs.map(r => r[0])), y0 = Math.min(...rs.map(r => r[1]));
  const x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const r2 = (v) => Math.round(v * 100) / 100;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const uniform = (a) => a.length === 0 || Math.max(...a) - Math.min(...a) <= EPS;

const keyOf = (L) => L.src ? L.id : L.kids.map(keyOf).sort(cmpKey)[0];
const cmpKey = (a, b) => {
  const A = a.split('.').slice(1).map(x => x === 't' ? -1 : +x), B = b.split('.').slice(1).map(x => x === 't' ? -1 : +x);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { if (A[i] === undefined) return -1; if (B[i] === undefined) return 1; if (A[i] !== B[i]) return A[i] - B[i]; }
  return 0;
};
function lnode(n) {
  const isText = n.k === 'text';
  return { id: n.id, src: n, A: isText ? n.r : n.l, B: isText ? n.rB : n.lB, kids: (n.kids || []).map(lnode) };
}

function inferScreen(ir) {
  const S = mkStats(); let gid = 0;
  const mkGroup = (items, hint, why) => ({ id: 'g' + (gid++), syn: why, hint, A: union(items.map(i => i.A)), B: union(items.map(i => i.B)), kids: items });

  const overlaps = (a, b) => {
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return ix > 0.5 && iy > 0.5;
  };
  const separable = (items, ax) => { // no overlap of projections on axis ax (0=x,1=y) after sorting
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
  const sortAx = (items, d) => [...items].sort((a, b) => d === 'H' ? a.A[0] - b.A[0] : a.A[1] - b.A[1]);

  // ---- choose axis / build bands ----
  function arrange(L, items) {
    if (items.length === 0) return { d: null, items: [] };
    if (items.length === 1) { S.singles++; return { d: L.hint || (items[0].src?.k === 'text' ? 'H' : 'V'), items }; }
    const sepH = separable(items, 0), sepV = separable(items, 1);
    if (sepH && !sepV) return { d: 'H', items: sortAx(items, 'H') };
    if (sepV && !sepH) return { d: 'V', items: sortAx(items, 'V') };
    if (sepH && sepV) {
      const d = L.hint || (items.every((it, i) => i === 0 || it.A[1] >= items[i - 1].A[1]) ? 'V' : 'H');
      return { d, items: sortAx(items, d) };
    }
    const by = bands(items, 1), bx = bands(items, 0);
    if (by.length > 1) {
      // reflow test: do band memberships change at width B? → real wrap
      const byB = bands(items, 1, 'B');
      const sig = (bs) => bs.map(b => b.map(i => i.id).sort().join(',')).sort().join('|');
      if (sig(by) !== sig(byB)) {
        S.wrap++;
        return { d: 'H', wrap: true, items: by.flatMap(b => sortAx(b, 'H')), rows: by.map(b => sortAx(b, 'H')) };
      }
    }
    if (by.length > 1 && bx.length > 1) {
      const sameCount = by.every(b => b.length === by[0].length);
      const anyGrow = items.some(i => i.B[2] - i.A[2] > GROW);
      if (sameCount || !anyGrow || bx.some(b => b.length > 1 && !separable(b, 1))) {
        S.bandRows++; return { d: 'V', items: by.map(b => b.length > 1 ? mkGroup(b, 'H', 'row') : b[0]) };
      }
      S.bandCols++; return { d: 'H', items: bx.map(b => b.length > 1 ? mkGroup(b, 'V', 'col') : b[0]) };
    }
    if (by.length > 1) { S.bandRows++; return { d: 'V', items: by.map(b => b.length > 1 ? mkGroup(b, 'H', 'row') : b[0]) }; }
    if (bx.length > 1) { S.bandCols++; return { d: 'H', items: bx.map(b => b.length > 1 ? mkGroup(b, 'V', 'col') : b[0]) }; }
    return { d: null, items: [], fallback: items };
  }

  // ---- primary axis: gap / space-between / push split / proximity grouping ----
  function primaryPlan(L, items, d) {
    const P = d === 'H' ? 0 : 1, Z = P + 2;
    const gaps = (arr, M) => arr.slice(1).map((it, i) => it[M][P] - (arr[i][M][P] + arr[i][M][Z]));
    let cur = items;
    for (let iter = 0; iter < 30; iter++) {
      if (cur.length < 2) return { mode: 'gap', g: 0, items: cur };
      const gA = gaps(cur, 'A'), gB = gaps(cur, 'B');
      const flex = gA.map((g, i) => gB[i] - g > GROW);
      if (flex.some(Boolean)) {
        if (flex.every(Boolean)) {
          if (!(uniform(gA) && uniform(gB))) { S.sbUneven++; if (S.sbUnevenEx.length < 4) S.sbUnevenEx.push(`${L.id} gapsA=${gA.map(r2)} gapsB=${gB.map(r2)}`); }
          S.sb++; return { mode: 'sb', items: cur };
        }
        const segs = [[cur[0]]];
        for (let i = 1; i < cur.length; i++) flex[i - 1] ? segs.push([cur[i]]) : segs[segs.length - 1].push(cur[i]);
        S.push++; if (S.pushEx.length < 4) S.pushEx.push(`${L.id}: ${segs.map(s => s.length).join('|')} gapsA=${gA.map(r2)} gapsB=${gB.map(r2)}`);
        cur = segs.map(s => s.length > 1 ? mkGroup(s, d, 'push') : s[0]);
        continue;
      }
      if (uniform(gA)) return { mode: 'gap', g: r2(mean(gA)), items: cur };
      const m = Math.min(...gA);
      const segs = [[cur[0]]];
      for (let i = 1; i < cur.length; i++) Math.abs(gA[i - 1] - m) <= EPS ? segs[segs.length - 1].push(cur[i]) : segs.push([cur[i]]);
      S.prox++; if (S.proxEx.length < 6) S.proxEx.push(`${L.id}: gaps=${gA.map(r2)} → groups ${segs.map(s => s.length).join('|')}`);
      cur = segs.map(s => s.length > 1 ? mkGroup(s, d, 'prox') : s[0]);
    }
    return { mode: 'gap', g: 0, items: cur };
  }

  // ---- leaf / node spec skeleton ----
  function baseSpec(L) {
    const n = L.src; const sp = { id: L.id, w: r2(L.A[2]), h: r2(L.A[3]) };
    Object.defineProperty(sp, '_key', { value: keyOf(L), enumerable: false });
    if (!n) { sp.t = 'F'; return sp; }
    if (n.p) {
      const p = n.p, q = {};
      for (const k of ['bg', 'bgi', 'bd', 'rad', 'sh', 'op', 'clip', 'tf', 'to', 'filt', 'cpath', 'outline']) if (p[k] !== undefined) q[k] = p[k];
      if (q.bd) q.bd = q.bd.map(b => b[0] ? b : 0);
      if (q.bgi || q.filt || q.cpath) S.rasterFallback++;
      if (Object.keys(q).length) sp.p = q;
    }
    if (n.k === 'text') { sp.t = 'T'; sp.font = n.font; sp.runs = n.runs; sp.lines = n.lines; }
    else if (n.k === 'svg') { sp.t = 'V'; sp.icon = n.icon; sp.sv = n.sv; sp.svgRef = n.id; }
    else if (n.k === 'img') { sp.t = 'I'; sp.src = n.src; sp.fit = n.fit; }
    else if (n.k === 'iconfont') { sp.t = 'R'; sp.name = n.name; sp.font = n.font; }
    else sp.t = 'F';
    return sp;
  }
  const textHug = (L) => L.src && L.src.k === 'text' && L.src.lines === 1 && Math.abs(L.A[2] - L.src.tw) < 1 && (L.src.linesB ?? 1) === 1;
  const defaultSize = (L, sp, ax) => { // ax 0 = width, 1 = height
    if (sp.t === 'T') return ax === 1 ? 'H' : (textHug(L) ? 'H' : 'X');
    if (sp.t === 'F' && sp.lay && sp.lay.d) return sp.hugOK[ax] ? 'H' : 'X';
    return 'X';
  };

  // ---- recursive frame inference ----
  function infer(L) {
    const sp = baseSpec(L);
    if (!L.kids || !L.kids.length) return sp;
    S.frames++;
    const kids = L.kids;
    const abs = new Map(); // LNode -> reason
    for (const k of kids) if (k.src?.p?.tf) { abs.set(k, 'transform'); S.absTransform++; }
    // overlap → absolute (highest overlap degree first; pairwise: the later one in paint order)
    for (;;) {
      const flow = kids.filter(k => !abs.has(k));
      const deg = new Map(flow.map(k => [k, 0])); let any = false;
      for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++)
        if (overlaps(flow[i].A, flow[j].A)) { deg.set(flow[i], deg.get(flow[i]) + 1); deg.set(flow[j], deg.get(flow[j]) + 1); any = true; }
      if (!any) break;
      const maxD = Math.max(...deg.values());
      let pick;
      if (maxD >= 2) pick = flow.filter(k => deg.get(k) === maxD).pop();
      else pick = flow.filter(k => deg.get(k) > 0).pop(); // later in paint order
      abs.set(pick, 'overlap'); S.absOverlap++;
    }
    // axis, then overflow → absolute unless it only overflows at the primary-axis end (clipped flow content)
    let arr;
    for (let it = 0; it < 5; it++) {
      const flow = kids.filter(k => !abs.has(k));
      arr = arrange(L, flow);
      let changed = false;
      for (const k of flow) {
        const out = [k.A[0] < L.A[0] - 0.5, k.A[1] < L.A[1] - 0.5, k.A[0] + k.A[2] > L.A[0] + L.A[2] + 0.5, k.A[1] + k.A[3] > L.A[1] + L.A[3] + 0.5];
        if (!out.some(Boolean)) continue;
        const endSide = arr.d === 'H' ? 2 : arr.d === 'V' ? 3 : -1;
        if (out.every((o, i) => !o || i === endSide)) continue;
        abs.set(k, 'overflow'); S.absOverflow++; changed = true;
      }
      if (!changed) break;
    }
    // children made absolute for overlapping something that is itself absolute now → back to flow
    for (let it = 0; it < 3; it++) {
      const flow = kids.filter(k => !abs.has(k)); let back = false;
      for (const [k, why] of abs) if (why === 'overlap' && !flow.some(f => overlaps(f.A, k.A))) { abs.delete(k); S.absOverlap--; back = true; }
      if (!back) break;
      arr = arrange(L, kids.filter(k => !abs.has(k)));
    }
    // a lone flow child that grows on an axis without keeping its insets (e.g. width:60%) → absolute + scale constraint
    if (arr.d && arr.items.length === 1 && !arr.items[0].syn) {
      const k = arr.items[0];
      const insetsKept = (ax) => Math.abs((k.A[ax] - L.A[ax]) - (k.B[ax] - L.B[ax])) < EPS && Math.abs((L.A[ax] + L.A[ax + 2] - k.A[ax] - k.A[ax + 2]) - (L.B[ax] + L.B[ax + 2] - k.B[ax] - k.B[ax + 2])) < EPS;
      const scaleFits = (ax) => Math.abs((k.A[ax] - L.A[ax]) / L.A[ax + 2] * L.B[ax + 2] - (k.B[ax] - L.B[ax])) + Math.abs(k.A[ax + 2] / L.A[ax + 2] * L.B[ax + 2] - k.B[ax + 2]) <= 0.5;
      if (k.src?.k !== 'text' && [0, 1].some(ax => k.B[ax + 2] - k.A[ax + 2] > GROW && !insetsKept(ax) && scaleFits(ax))) { abs.set(k, 'scale'); S.absScale = (S.absScale || 0) + 1; arr = arrange(L, []); }
    }
    if (arr.fallback) { for (const k of arr.fallback) abs.set(k, 'fallback'); S.allAbsFallback++; if (S.allAbsEx.length < 4) S.allAbsEx.push(`${L.id} (${arr.fallback.length} kids)`); }

    const childSpecs = [];
    const lay = { d: arr.d };
    sp.lay = lay;
    const fillAx = [false, false];
    let items = arr.items;
    if (arr.d) {
      const d = arr.d, P = d === 'H' ? 0 : 1, Z = P + 2, C = 1 - P, CZ = C + 2;
      let plan;
      if (arr.wrap) {
        lay.wrap = 1;
        const rowGaps = arr.rows.flatMap(r => r.slice(1).map((it, i) => it.A[0] - (r[i].A[0] + r[i].A[2])));
        const rg = arr.rows.slice(1).map((r, i) => Math.min(...r.map(x => x.A[1])) - Math.max(...arr.rows[i].map(x => x.A[1] + x.A[3])));
        plan = { mode: 'gap', g: rowGaps.length ? r2(mean(rowGaps)) : 0, items };
        lay.cg = rg.length ? r2(mean(rg)) : 0;
        if (!uniform(rowGaps) || !uniform(rg)) { S.primaryMis++; if (S.primaryMisEx.length < 6) S.primaryMisEx.push(`${L.id} wrap gaps uneven`); }
      } else plan = primaryPlan(L, items, d);
      items = plan.items;
      let finalItems;
      if (arr.wrap) {
        const cb0 = union(items.map(i => i.A));
        lay.p = [cb0[1] - L.A[1], L.A[0] + L.A[2] - (cb0[0] + cb0[2]), L.A[1] + L.A[3] - (cb0[1] + cb0[3]), cb0[0] - L.A[0]].map(v => r2(Math.max(0, v)));
        lay.ca = 'S'; lay.pa = 'S'; lay.g = plan.g;
        finalItems = items.map(it => ({ c: { stretch: false }, it }));
      } else {
        const first = items[0], last = items[items.length - 1];
        const padS = first.A[P] - L.A[P], padE = L.A[P] + L.A[Z] - (last.A[P] + last.A[Z]);
        // counter axis
        const cinfo = items.map(it => {
          const lA = it.A[C] - L.A[C], rA = L.A[C] + L.A[CZ] - (it.A[C] + it.A[CZ]);
          const lB = it.B[C] - L.B[C], rB = L.B[C] + L.B[CZ] - (it.B[C] + it.B[CZ]);
          const grows = it.B[CZ] - it.A[CZ] > GROW;
          return { it, lA, rA, lB, rB, grows, stretch: grows && Math.abs(lA - lB) < EPS && Math.abs(rA - rB) < EPS };
        });
        const st = cinfo.filter(c => c.stretch);
        let padCS, padCE, ca = 'S';
        const modeOf = (vals) => { // most common value (within EPS)
          let best = null, bc = 0;
          for (const v of vals) { const c = vals.filter(w => Math.abs(w - v) <= EPS).length; if (c > bc || (c === bc && v < best)) { bc = c; best = v; } }
          return best;
        };
        if (st.length) { padCS = Math.min(...st.map(c => c.lA)); padCE = Math.min(...st.map(c => c.rA)); st.forEach(c => { if (Math.abs(c.lA - padCS) > EPS || Math.abs(c.rA - padCE) > EPS) { c.stretch = false; c.stretchMis = true; } }); }
        const non = cinfo.filter(c => !c.stretch);
        const fitFn = {
          S: (c, v) => Math.abs(c.lA - v) <= EPS && Math.abs(c.lB - v) <= EPS,
          E: (c, v) => Math.abs(c.rA - v) <= EPS && Math.abs(c.rB - v) <= EPS,
          C: (c, v) => Math.abs((c.lA - c.rA) - v) <= EPS && Math.abs((c.lB - c.rB) - v) <= EPS,
        };
        const valOf = { S: c => c.lA, E: c => c.rA, C: c => c.lA - c.rA };
        let best = null;
        for (const a of ['S', 'C', 'E']) {
          let v;
          if (st.some(c => c.stretch)) v = a === 'S' ? padCS : a === 'E' ? padCE : padCS - padCE;
          else v = non.length ? modeOf(non.map(valOf[a])) : 0;
          const fits = non.filter(c => fitFn[a](c, v)).length;
          if (!best || fits > best.fits) best = { a, v, fits };
        }
        ca = best.a;
        if (!st.some(c => c.stretch)) {
          const fitting = non.filter(c => fitFn[ca](c, best.v));
          if (ca === 'S') { padCS = best.v; padCE = Math.min(...cinfo.map(c => c.rA)); }
          else if (ca === 'E') { padCE = best.v; padCS = Math.min(...cinfo.map(c => c.lA)); }
          else { padCS = Math.min(...fitting.map(c => c.lA)); padCE = padCS - best.v; }
        }
        padCS = Math.max(0, padCS); padCE = Math.max(0, padCE);
        // misfits → alignment wrapper (synthetic frame with counter-axis padding), or absolute if negative offset
        finalItems = [];
        for (const c of cinfo) {
          if (c.stretch || (!c.stretchMis && fitFn[ca](c, best.v))) { finalItems.push({ c, it: c.it }); continue; }
          if (c.stretchMis && st.some(x => x.stretch) && c.lA >= padCS - 0.5 && c.rA >= padCE - 0.5) {
            // stretched child with its own inset: stretched wrapper whose padding carries the inset
            const ext = (r, l, rr) => { const q = [...r]; q[C] -= l; q[CZ] += l + rr; return q; };
            const oL = c.lA - padCS, oR = c.rA - padCE;
            const W = { id: 'g' + (gid++), syn: 'align', hint: d, A: ext(c.it.A, oL, oR), B: ext(c.it.B, c.lB - padCS, c.rB - padCE), kids: [c.it] };
            S.alignWrap++; if (S.alignWrapEx.length < 6) S.alignWrapEx.push(`${c.it.id} in ${L.id}: stretched with inset ${r2(oL)}/${r2(oR)}`);
            finalItems.push({ c: { ...c, stretch: true }, it: W }); continue;
          }
          let off; // offset needed on start side (S/C) or end side (E)
          if (ca === 'S') off = c.lA - padCS; else if (ca === 'E') off = c.rA - padCE; else off = (c.lA - c.rA) - (padCS - padCE);
          const offB = ca === 'S' ? c.lB - padCS : ca === 'E' ? c.rB - padCE : (c.lB - c.rB) - (padCS - padCE);
          if (Math.abs(off - offB) > EPS) { S.counterMis++; if (S.counterMisEx.length < 6) S.counterMisEx.push(`${c.it.id} in ${L.id}: ${ca} off A=${r2(off)} B=${r2(offB)}`); }
          if (ca !== 'C' && off < -0.5) { abs.set(c.it, 'counter-misfit'); continue; }
          // build wrapper box: same primary extent, counter extent grown by |off| on the needed side
          const wA = [...c.it.A], wB = [...c.it.B];
          const grow = (r, o) => {
            const q = [...r];
            if (ca === 'S' || (ca === 'C' && o > 0)) { q[C] -= Math.abs(o); q[CZ] += Math.abs(o); }
            else { q[CZ] += Math.abs(o); }
            return q;
          };
          const W = { id: 'g' + (gid++), syn: 'align', hint: d, A: grow(wA, off), B: grow(wB, off), kids: [c.it] };
          S.alignWrap++; if (S.alignWrapEx.length < 6) S.alignWrapEx.push(`${c.it.id} in ${L.id}: ${ca}-aligned, off=${r2(off)}`);
          finalItems.push({ c: { ...c, stretch: false }, it: W });
        }
        items = finalItems.map(f => f.it);
        lay.p = [0, 0, 0, 0];
        if (d === 'H') lay.p = [r2(padCS), r2(padE), r2(Math.max(0, padCE)), r2(padS)];
        else lay.p = [r2(padS), r2(padCE), r2(padE), r2(padCS)];
        lay.p = lay.p.map(v => Math.max(0, v));
        lay.ca = ca;
        if (plan.mode === 'sb') lay.sb = 1; else lay.g = plan.g;
        // primary alignment from width B
        if (plan.mode !== 'sb' && items.length) {
          const contB = items.reduce((s, it) => s + it.B[Z], 0) + (plan.g || 0) * (items.length - 1);
          const freeB = L.B[Z] - padS - padE - contB;
          const act = items[0].B[P] - L.B[P];
          let pa = 'S', err = Math.abs(act - padS);
          for (const [a, pred] of [['C', padS + freeB / 2], ['E', padS + freeB]]) if (Math.abs(act - pred) < err - 0.25) { pa = a; err = Math.abs(act - pred); }
          lay.pa = pa;
          // check every item along primary at B
          let pos = L.B[P] + (pa === 'S' ? padS : pa === 'C' ? padS + freeB / 2 : padS + freeB); let maxe = 0;
          for (const it of items) { maxe = Math.max(maxe, Math.abs(it.B[P] - pos)); pos += it.B[Z] + (plan.g || 0); }
          if (maxe > 0.5) { S.primaryMis++; if (S.primaryMisEx.length < 6) S.primaryMisEx.push(`${L.id} (${d}, gap ${plan.g}, ${pa}) max err @B ${r2(maxe)}`); }
        } else lay.pa = 'S';
      }
      // child sizing
      const fills = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; const c = finalItems[i].c;
        const cs = infer(it);
        const prim = it.B[Z] - it.A[Z] > GROW ? 'F' : defaultSize(it, cs, P);
        const cnt = c.stretch ? 'F' : defaultSize(it, cs, C);
        cs.sz = d === 'H' ? [prim, cnt] : [cnt, prim];
        if (prim === 'F') { fillAx[P] = true; fills.push(it); }
        if (cnt === 'F') fillAx[C] = true;
        if (it.syn) cs.syn = it.syn;
        childSpecs.push(cs);
      }
      // a single FILL child that grows less than the free space → FILL capped by a max size (Figma maxWidth/maxHeight)
      if (fills.length === 1) {
        const f = fills[0], dF = f.B[Z] - f.A[Z], dP = L.B[Z] - L.A[Z];
        if (dP - dF > GROW) { const cs = childSpecs.find(c => c.id === f.id); cs[P === 0 ? 'maxW' : 'maxH'] = r2(f.B[Z]); S.maxSize = (S.maxSize || 0) + 1; }
      }
      if (fills.length > 1 && Math.max(...fills.map(f => f.A[Z])) - Math.min(...fills.map(f => f.A[Z])) > 1) {
        // unequal FILL siblings: if they become equal at the wider width, the larger ones hit a content floor → Figma min size
        const eqB = Math.max(...fills.map(f => f.B[Z])) - Math.min(...fills.map(f => f.B[Z])) <= 1;
        const mn = Math.min(...fills.map(f => f.A[Z]));
        if (eqB) {
          fills.forEach((f, i) => { if (f.A[Z] > mn + 1) { const cs = childSpecs.find(c => c.id === f.id); cs[P === 0 ? 'minW' : 'minH'] = r2(f.A[Z]); } });
          S.minSize = (S.minSize || 0) + 1;
        } else { S.unequalFill++; if (S.unequalFillEx.length < 6) S.unequalFillEx.push(`${L.id}: FILL siblings sized A ${fills.map(f => r2(f.A[Z])).join('/')} B ${fills.map(f => r2(f.B[Z])).join('/')}`); }
      }
      const cb = union(items.map(i => i.A)), cbB = union(items.map(i => i.B));
      // HUG is valid on an axis when frame size == content bbox + padding at BOTH widths
      const pads = d === 'H' ? [[lay.p[3], lay.p[1]], [lay.p[0], lay.p[2]]] : [[lay.p[3], lay.p[1]], [lay.p[0], lay.p[2]]];
      sp.hugOK = [0, 1].map(ax => !fillAx[ax] && !(ax === P && (lay.sb || lay.wrap)) &&
        Math.abs(L.A[ax + 2] - (cb[ax + 2] + pads[ax][0] + pads[ax][1])) <= EPS && Math.abs(L.B[ax + 2] - (cbB[ax + 2] + pads[ax][0] + pads[ax][1])) <= EPS);
      Object.defineProperty(sp, '_fillAx', { value: fillAx, enumerable: false });
    }
    // absolute children with constraints from two widths
    for (const [k, why] of abs) {
      const cs = infer(k);
      const lA = k.A[0] - L.A[0], rA = L.A[0] + L.A[2] - (k.A[0] + k.A[2]), lB = k.B[0] - L.B[0], rB = L.B[0] + L.B[2] - (k.B[0] + k.B[2]);
      const tA = k.A[1] - L.A[1], bA = L.A[1] + L.A[3] - (k.A[1] + k.A[3]), tB = k.B[1] - L.B[1], bB = L.B[1] + L.B[3] - (k.B[1] + k.B[3]);
      const con = (l1, r1, l2, r2_, sz1, sz2, psz1, psz2) => {
        // predict position+size at width B under each Figma constraint; pick the best (ties: simplest first)
        const grows = Math.abs(sz2 - sz1) > GROW;
        const cand = [
          ['L', Math.abs(l1 - l2) + Math.abs(sz2 - sz1)],
          ['R', Math.abs(r1 - r2_) + Math.abs(sz2 - sz1)],
          ['LR', Math.abs(l1 - l2) + Math.abs(r1 - r2_)],
          ['C', Math.abs((l1 + sz1 / 2 - psz1 / 2) - (l2 + sz2 / 2 - psz2 / 2)) + Math.abs(sz2 - sz1)],
          ['SC', Math.abs(l1 / psz1 * psz2 - l2) + Math.abs(sz2 - sz1)],
          ['SCW', Math.abs(l1 / psz1 * psz2 - l2) + Math.abs(sz1 / psz1 * psz2 - sz2)],
        ];
        let best = cand[0]; for (const c of cand) if (c[1] < best[1] - 0.05) best = c;
        if (best[0] === 'LR' && !grows) best = cand[0][1] <= cand[1][1] ? cand[0] : cand[1];
        return best[1] <= 0.5 ? best[0] : best[0] + '?';
      };
      cs.abs = { x: r2(lA), y: r2(tA), cx: con(lA, rA, lB, rB, k.A[2], k.B[2], L.A[2], L.B[2]), cy: con(tA, bA, tB, bB, k.A[3], k.B[3], L.A[3], L.B[3]), why };
      if (/\?/.test(cs.abs.cx) || /\?/.test(cs.abs.cy)) { S.counterMis++; if (S.counterMisEx.length < 6) S.counterMisEx.push(`${k.id} abs: no constraint fits both widths`); }
      cs.sz = [cs.t === 'T' && textHug(k) ? 'H' : 'X', cs.t === 'T' ? 'H' : 'X'];
      if (cs.t === 'F' && cs.hugOK) cs.sz = cs.sz.map((v, i) => cs.hugOK[i] ? 'H' : v);
      if (k.syn) cs.syn = k.syn;
      childSpecs.push(cs);
    }
    if (!arr.d) sp.hugOK = [false, false];
    // z-order: flow children keep primary order; absolute children are inserted by DOM order key
    const flowSpecs = childSpecs.filter(c => !c.abs), absSpecs = childSpecs.filter(c => c.abs);
    const out = [...flowSpecs];
    for (const a of absSpecs) {
      const ka = a._key; let pos = out.length;
      for (let i = 0; i < out.length; i++) if (cmpKey(out[i]._key, ka) > 0) { pos = i; break; }
      out.splice(pos, 0, a);
    }
    sp.kids = out;
    return sp;
  }

  const root = lnode(ir.tree);
  const spec = infer(root);
  spec.sz = ['X', Math.abs(ir.H[1] - ir.H[0]) <= GROW ? 'X' : (spec.hugOK && spec.hugOK[1] ? 'H' : 'X')];
  // normalise padding on non-HUG axes without FILL children: free space belongs to alignment, not padding
  const norm = (n) => {
    if (n.lay && n.lay.d && n.sz) {
      const l = n.lay, P = l.d === 'H' ? 0 : 1;
      for (const ax of [0, 1]) {
        if (n.sz[ax] === 'H' || (n._fillAx && n._fillAx[ax]) || (l.wrap && ax === P)) continue;
        const si = ax === 0 ? 3 : 0, ei = ax === 0 ? 1 : 2;
        const al = ax === P ? (l.sb ? null : l.pa) : l.ca;
        if (!al) continue;
        if (al === 'S') l.p[ei] = 0;
        else if (al === 'E') l.p[si] = 0;
        else { const m = Math.min(l.p[si], l.p[ei]); l.p[si] = r2(l.p[si] - m); l.p[ei] = r2(l.p[ei] - m); }
      }
    }
    (n.kids || []).forEach(norm);
  };
  norm(spec);
  return { spec, stats: S };
}

module.exports = { inferScreen };
