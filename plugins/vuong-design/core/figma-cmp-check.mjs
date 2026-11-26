// Components on Figma for figma.mjs check (plan 3b Task 7). A component variant has no source page of its own: it is
// checked against its encoding (the intent figma-cmp.mjs built it from). Its uses are checked through the screens,
// whose instances read back node by node against the source like any layer.
//
// usesOf(D, screen?) -> Set of K names a screen batch's data uses (one screen's when given): instances (i),
//   INSTANCE_SWAP icons (mi) and values (p)
// cmpVariants(st, F, screenData) -> [CmpReport] one per st.components entry (key = the K name), sorted by key:
//   { key, name (component), status (done | skippedEdited | failed | pending), batch, root, usedBy: [screen ids],
//     readback: { nodes, missing } | null, diffs: [{ o, d }], sizes: [{ o, A: [w, h], e: [w, h] }], errors, pass }
//   done: pass when every node is read back, no node differs from its encoding (d, the main check mc included; a text
//   bound to a TEXT property reads back as the property's default: propertyTexts), every FIXED size is within TOL_FRAME
//   and a frame's HUG size within TOL_TEXT (texts TOL_TEXT) of the encoded one (not around a property text that is not
//   the default), and the build had no errors.
//   skippedEdited: kept as the user edited it, not checked here (pass; its screens check its instances); failed /
//   pending: fails, and every instance of it on a screen is unchecked (blockInstances).
//   screenData: { [screen id]: D } (the screen batches' data), for usedBy.
// cmpCheckOne(sres, D, key) -> { readback, diffs, sizes } on one decoded variant result (decode first)
// blockInstances(sres, D, bad) -> { sres, blocked: { [vd id]: reason } }   a copy of a screen result whose instances of a
//   component in bad (Map K name -> reason) and their layers read back as missing (entry 0): unchecked, the screen fails.
// figCmpTargets(sres, D) -> { k, targets: [vd id] }   the component of the first instance root read back on the screen
//   and every read-back instance root of it there (figCmp mutates them all); null when the screen has none.
// otherIcon(D, k) -> another icon component K name of the batch ('icon/<ref>'), or null (figSwap)
import { decode, ordOf } from './figma-check.mjs';

export const TOL_FRAME = 0.5, TOL_TEXT = 1;
const r2 = (v) => Math.round(v * 100) / 100 + 0;
const walkT = (e, fn) => { fn(e); (e.k || []).forEach((k) => walkT(k, fn)); };
const clone = (x) => JSON.parse(JSON.stringify(x));

export function usesOf(D, screen) {
  const out = new Set();
  if (!D || !Array.isArray(D.K)) return out;
  for (const sc of (D.screens || []).filter((x) => screen === undefined || x.screen === screen)) walkT(sc.T, (e) => {
    for (const x of [e.i, e.mi]) if (x !== undefined) out.add(D.K[x]);
    if (e.p) for (const v of Object.values(e.p)) if (typeof v === 'number') out.add(D.K[v]);
  });
  return out;
}

export function cmpCheckOne(s, D, key) {
  const sc = D.screens.find((x) => x.screen === `cmp:${key}`);
  const ord = ordOf(sc.T), N = s.N || {};
  const enc = new Map();
  walkT(sc.T, (e) => enc.set(e.o, e));
  // a text bound to a TEXT property shows the property's default in every variant (Figma has one default per set, real
  // Figma 2026-11-26): it reads back as that default, and the HUG sizes around it follow it, not the encoded text
  const P = (sc.cm && sc.cm.p) || {}, Bd = (sc.cm && sc.cm.b) || {}, bound = new Map();
  for (const [k, [ty, def]] of Object.entries(P)) if (ty === 'TEXT' && Bd[k] !== undefined) bound.set(Bd[k] ? `${sc.T.o}.${Bd[k]}` : sc.T.o, def);
  const grown = new Set();
  const up = (e) => { let g = false; for (const k of e.k || []) g = up(k) || g; if (bound.has(e.o) && e.tx !== bound.get(e.o)) g = true; if (g) grown.add(e.o); return g; };
  up(sc.T);
  const diffs = [], sizes = [], propertyTexts = [];
  for (const [o, x] of Object.entries(N)) {
    if (x.d && bound.has(o) && x.d.text === bound.get(o) && Object.keys(x.d).every((k) => k === 'text' || k === 'runs')) propertyTexts.push(o);
    else if (x.d) diffs.push({ o, d: x.d });
    const e = enc.get(o);
    if (!e || o.endsWith('#stroke') || !x.A) continue;
    const s2 = e.s || 'XX';
    // FILL follows the instance's parent: only FIXED (X) and HUG (H) sizes are the component's own. A HUG text's size
    // comes from the font's metrics in Figma: it is checked on the screens, against the source, with the model's
    // tolerances (the components page has no source). A HUG frame takes TOL_TEXT: Figma rounds the texts it holds.
    const own = (i) => s2[i] === 'X' || (s2[i] === 'H' && e.t !== 'T' && !grown.has(o));
    const tol = (i) => (e.t === 'T' || s2[i] === 'H' ? TOL_TEXT : TOL_FRAME);
    const off = [0, 1].some((i) => own(i) && e[i ? 'h' : 'w'] != null && Math.abs(x.A[2 + i] - e[i ? 'h' : 'w']) > tol(i));
    if (off) sizes.push({ o, A: [r2(x.A[2]), r2(x.A[3])], e: [e.w, e.h] });
  }
  return { readback: { nodes: ord.length, missing: ord.filter((o) => !N[o]).length }, diffs, sizes, propertyTexts };
}

export function cmpVariants(st, F, screenData = {}, read) {
  const uses = Object.entries(screenData).map(([id, D]) => [id, usesOf(D, id)]);
  return Object.keys(st.components || {}).sort().map((key) => {
    const c = st.components[key];
    const name = key.split('/')[0] === 'icon' ? key : key.split('/')[0];
    const status = c.status || 'pending';
    const usedBy = uses.filter(([, u]) => u.has(key)).map(([id]) => id);
    const out = { key, name, status, batch: c.batch || null, root: c.root || null, usedBy, readback: null, diffs: [], sizes: [], errors: [] };
    if (status === 'skippedEdited') return { ...out, edited: true, pass: true };
    if (status !== 'done' || !c.result || !st.batches[c.batch]) return { ...out, ...(c.errors ? { errors: c.errors } : {}), pass: false };
    const res = read(c.result), D = read(st.batches[c.batch].data);
    const raw = (res.screens || []).find((x) => x.screen === `cmp:${key}`);
    if (!raw || !raw.nodes) return { ...out, pass: false };
    const s = decode({ screens: [clone(raw)] }, D).screens[0];
    const one = cmpCheckOne(s, D, key);
    const errors = raw.errors || [];
    return { ...out, ...one, errors, pass: one.readback.missing === 0 && !one.diffs.length && !one.sizes.length && !errors.length };
  });
}

export function blockInstances(sres, D, bad) {
  const blocked = {};
  if (!sres || !sres.nodes || !bad.size || !Array.isArray(D.K)) return { sres, blocked };
  const sc = D.screens.find((x) => x.screen === sres.screen);
  const ord = ordOf(sc.T), out = clone(sres);
  delete out.N;
  const hit = (e, why) => walkT(e, (x) => { for (const o of [x.o, `${x.o}#stroke`]) { const i = ord.indexOf(o); if (i >= 0 && out.nodes[i]) { out.nodes[i] = 0; blocked[o] = why; } } });
  const w = (e) => {
    const k = [e.i, e.mi].find((x) => x !== undefined);
    if (k !== undefined && bad.has(D.K[k])) return hit(e, bad.get(D.K[k]));
    (e.k || []).forEach(w);
  };
  w(sc.T);
  return { sres: out, blocked };
}

export function figCmpTargets(sres, D) {
  if (!sres || !sres.nodes || !Array.isArray(D.K)) return null;
  const sc = D.screens.find((x) => x.screen === sres.screen);
  const ord = ordOf(sc.T), roots = [];
  walkT(sc.T, (e) => { if (e.i !== undefined && e.o !== sc.T.o && sres.nodes[ord.indexOf(e.o)]) roots.push(e); });
  if (!roots.length) return null;
  const k = roots[0].i;
  return { k: D.K[k], targets: roots.filter((e) => e.i === k).map((e) => e.o) };
}

export function otherIcon(D, k) {
  return (D.K || []).find((x) => x.startsWith('icon/') && x !== k) || null;
}

// cmpMutation(variants, st, read) -> { kind: 'figCmp', target, caught } | { kind, target: null, caught: null, skipped }
//   the component side of figCmp (check --mutate): the first passing built variant reads back with its root fill
//   changed (magenta added); its check must fail.
export function cmpMutation(variants, st, read) {
  const v = variants.find((x) => x.status === 'done' && x.pass);
  if (!v) return { kind: 'figCmp', target: null, caught: null, skipped: 'no passing component' };
  const c = st.components[v.key], res = read(c.result), D = read(st.batches[c.batch].data);
  const raw = clone(res.screens.find((x) => x.screen === `cmp:${v.key}`));
  const T = D.screens.find((x) => x.screen === `cmp:${v.key}`).T;
  const t = raw.nodes[0];
  raw.nodes[0] = [t[0], t[1], t[2] || 0, { ...(t[3] || {}), fills: ['#ff00ff'] }];
  const s = decode({ screens: [raw] }, D).screens[0];
  const one = cmpCheckOne(s, D, v.key);
  return { kind: 'figCmp', target: v.key, caught: one.diffs.some((x) => x.o === T.o) };
}
