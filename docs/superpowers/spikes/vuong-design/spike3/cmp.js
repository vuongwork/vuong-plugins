// Compare Figma boxes vs proxy boxes and vs source boxes, at native (A) and wide (B) width, with root-cause detection like spike2/compare.js.
const fs = require('fs'), path = require('path');
const S2 = path.join(__dirname, '../spike2');
const OUT = path.join(__dirname, 'out');
const ir = JSON.parse(fs.readFileSync(S2 + '/out/ir.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync(OUT + '/meta.json', 'utf8'));
const wide = JSON.parse(fs.readFileSync(OUT + '/fig-wide.json', 'utf8'));
const probe = require('./probe');
const TOL = { frame: 0.5, text: 1 };
const r2 = v => Math.round(v * 100) / 100;

// generic tree: {id, k:'text'|'frame', kids, A, B}
function srcTree(n) { return { id: n.id, k: n.k === 'text' ? 'text' : 'frame', text: n.runs ? n.runs.map(r => r.t || '').join('') : undefined, kids: (n.kids || []).map(srcTree), r: n.r, rB: n.rB }; }
function specTree(n) { // probe has no source: walk spec, skipping synthetic wrappers
  const kids = []; (n.kids || []).forEach(k => { const t = specTree(k); if (k.syn) kids.push(...t.kids); else kids.push(t); });
  return { id: n.id, k: n.t === 'T' ? 'text' : 'frame', text: n.runs ? n.runs.map(r => r.t).join('') : undefined, kids };
}
function flatten(tree) { const out = []; const v = (n, parent, prev) => { out.push({ n, parent, prev }); (n.kids || []).forEach((k, i) => v(k, n, n.kids[i - 1])); }; v(tree, null, null); return out; }

function compare(tree, X, Y) { // X = candidate boxes by id, Y = reference boxes by id
  const nodes = flatten(tree), st = {}, res = { n: 0, pass: 0, roots: [] };
  for (const { n } of nodes) {
    const x = X[n.id], y = Y[n.id]; if (!x || !y) { st[n.id] = { miss: 1 }; continue; }
    const tol = n.k === 'text' ? TOL.text : TOL.frame; const dl = [0, 1, 2, 3].map(i => x[i] - y[i]);
    st[n.id] = { ok: Math.max(...dl.map(Math.abs)) <= tol, dl, tol };
  }
  for (const { n, parent, prev } of nodes) {
    const x = st[n.id]; if (x.miss) continue; res.n++;
    if (x.ok) { res.pass++; continue; }
    let inherited = false;
    if (Math.abs(x.dl[2]) <= x.tol && Math.abs(x.dl[3]) <= x.tol) {
      const refs = []; const ps = parent && st[parent.id]; if (ps && !ps.miss) refs.push([ps.dl[0], ps.dl[1]]);
      const qs = prev && st[prev.id]; if (qs && !qs.miss) refs.push([qs.dl[0], qs.dl[1]], [qs.dl[0] + qs.dl[2], qs.dl[1]], [qs.dl[0], qs.dl[1] + qs.dl[3]]);
      const xs = refs.map(r => r[0]), ys = refs.map(r => r[1]);
      inherited = (xs.some(v => Math.abs(x.dl[0] - v) <= x.tol) || Math.abs(x.dl[0]) <= x.tol) && (ys.some(v => Math.abs(x.dl[1] - v) <= x.tol) || Math.abs(x.dl[1]) <= x.tol);
    }
    if (!inherited) res.roots.push({ id: n.id, k: n.k, dl: x.dl.map(r2), text: n.text && n.text.slice(0, 24) });
  }
  return res;
}

const rep = {};
for (const id of ['pl0', 'c20', 'fe0', 'pr']) {
  const prox = JSON.parse(fs.readFileSync(`${OUT}/prox-${id}.json`, 'utf8'));
  const P = { A: {}, B: {} }; for (const M of ['A', 'B']) for (const [k, v] of Object.entries(prox[M].nodes)) P[M][k] = v.r;
  const F = { A: {}, B: {} };
  let tree, S = null;
  if (id === 'pr') {
    tree = specTree(probe.spec);
    for (const [k, ...b] of wide.prA) F.A[k] = b;
    for (const [k, ...b] of wide['spike3-pr']) F.B[k] = b;
  } else {
    const src = ir[id]; tree = srcTree(src.tree);
    S = { A: {}, B: {} }; for (const { n } of flatten(tree)) { S.A[n.id] = n.r; S.B[n.id] = n.rB; }
    const fa = JSON.parse(fs.readFileSync(`${OUT}/fig-${id}-A.json`, 'utf8'));
    meta[id].order.forEach((nid, i) => { if (fa.B[i]) F.A[nid] = fa.B[i]; });
    for (const [k, ...b] of wide['spike3-' + id]) F.B[k] = b;
    F.B.n = [0, 0, src.W[1], fa.B[0][3]];
  }
  const R = { nodes: flatten(tree).length };
  R.figVsProxA = compare(tree, F.A, P.A); R.figVsProxB = compare(tree, F.B, P.B);
  if (S) { R.figVsSrcA = compare(tree, F.A, S.A); R.figVsSrcB = compare(tree, F.B, S.B); R.proxVsSrcA = compare(tree, P.A, S.A); R.proxVsSrcB = compare(tree, P.B, S.B); }
  const p2 = JSON.parse(fs.readFileSync(`${OUT}/prox2-${id}.json`, 'utf8'));
  for (const kind of ['fig', 'ceil']) for (const M of ['A', 'B']) { const Q = {}; for (const [k, v] of Object.entries(p2[kind][M].nodes)) Q[k] = v.r; if (id === 'pr') delete Q.n; R[`figVsP${kind}${M}`] = compare(tree, F[M], Q); }
  if (S) for (const M of ['A', 'B']) { const Q = {}; for (const [k, v] of Object.entries(p2.ceil[M].nodes)) Q[k] = v.r; R[`pceilVsSrc${M}`] = compare(tree, Q, S[M]); }
  rep[id] = R;
  const pct = c => c ? `${(100 * c.pass / c.n).toFixed(1)}% (${c.pass}/${c.n}, roots ${c.roots.length})` : '-';
  console.log(`\n== ${id} nodes ${R.nodes}`);
  for (const k of Object.keys(R).filter(k => k !== 'nodes')) console.log(`  ${k.padEnd(11)} ${pct(R[k])}`);
}
fs.writeFileSync(OUT + '/cmp.json', JSON.stringify(rep, null, 1));
if (process.argv[2]) { const [id, k] = process.argv[2].split(':'); console.log(JSON.stringify(rep[id][k].roots, null, 0).replace(/\},\{/g, '},\n{')); }
