// Components in Figma (plan 3b Task 6): components.json (components.mjs findComponents, with Task 5's overrides and
// detached uses) + the screens' target specs -> the component batches' items and the instance marks on the screens'
// encodings. Pure and deterministic, no clock. README "Figma components".
//
// cmpEncode(components, screens, ctx) -> { K, items, mark(enc), used(enc) }
//   components: components.json; screens: [{ id, spec, svgDefs }] (spec-norm trees); ctx: encodeScreen's ctx without
//   screen / svgDefs (file, map, tables, tokens, styleTc). K is ctx.tables.K (created when missing): the component
//   names the runtime finds by their `vuongdesign/cmp` plugin data, `<name>` or `<name>/<axis=value, ...>` per
//   variant, `icon/<ref>` per icon component.
//   items: one per icon component, then one per variant, components in dependency order (a component after those its
//   templates hold), each an encoding like a screen's: { screen: 'cmp:<K name>', file, W: [w, w], T, tables, cm }.
//   cm = { k (K index), n (set or component name), v (variant name 'axis=value, ...', '' without axes), p (the set's
//   properties { name: [type, default] }, INSTANCE_SWAP default = K index of its icon component), b ({ name: path }
//   the variant binds, '' = the root) }. T is the template's own encoding (encodeScreen of the template subtree, its
//   root without absolute placement: placement belongs to each instance), with its nested component occurrences marked
//   as instances and each node bound to an INSTANCE_SWAP property an instance of the default icon component.
//   mark(enc): marks the component occurrences of a screen encoding in place (none detached by Task 5); used(enc): the
//   K names it refers to (for the screen's hash).
// Instance marks on an encoded node (figma-runtime-cmp.js reads them):
//   i  K index of the variant component; on the root of an occurrence (top-level or nested in another one)
//   p  { property: value } of every property the variant binds: TEXT string, BOOLEAN, INSTANCE_SWAP = K index
//   j  on a node inside an occurrence: its index among its parent's children in the component when that differs from
//      its index in k (a BOOLEAN property hid an earlier sibling)
//   rc 1 = an icon whose colours the runtime compares with its own encoding and sets (an icon bound to INSTANCE_SWAP,
//      or one with an icon.* override)
// The rest of every node stays its full plan 3 encoding: the runtime sets on an instance only what differs from it,
// and the readback is the one of plan 3 (every spec node one entry, same ids).
import { encodeScreen } from './figma-encode.mjs';
import { expandInstance } from './components.mjs';
import { cmpNodeId } from './inventory.mjs';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rel = (id, root) => (id === root ? '' : id.slice(root.length + 1));
const at = (root, path) => (path === '' ? root.id : `${root.id}.${path}`);
// override keys the runtime cannot set on an instance (the occurrence would need a structural change)
const UNSUPPORTED = new Set(['paint.strokeOverlay']);

function index(spec) {
  const m = new Map();
  const w = (n) => { m.set(n.id, n); (n.kids || []).forEach(w); };
  w(spec);
  return m;
}
const intern = (tables, name) => {
  if (!Array.isArray(tables.K)) tables.K = [];
  let i = tables.K.indexOf(name);
  if (i < 0) { i = tables.K.length; tables.K.push(name); }
  return i;
};
export const variantName = (axes, props) => axes.map((a) => `${a}=${props[a]}`).join(', ');
export const cmpKey = (c, v) => (c.axes.length ? `${c.name}/${variantName(c.axes, v.props)}` : c.name);

export function cmpEncode(components, screens, ctx) {
  const tables = ctx.tables;
  const specs = new Map(screens.map((s) => [String(s.id), { ...s, idx: index(s.spec) }]));
  const comps = (components && components.components) || [];
  const byName = new Map(comps.map((c) => [c.name, c]));
  const propsOf = (c) => Object.fromEntries(c.props.map((p) => [p.name, { type: p.type, default: p.default }]));
  // occurrence index: screen \0 node -> { c, v, x }
  const occ = new Map();
  for (const c of comps) for (const v of c.variants) for (const x of v.nodes) {
    for (const ov of Object.values(x.ov || {})) for (const k of Object.keys(ov)) {
      if (UNSUPPORTED.has(k)) throw new Error(`component ${c.name}: ${x.screen} ${x.node} needs an override of ${k}, which an instance cannot take (declare the block as its own component or drop it)`);
    }
    occ.set(`${x.screen}\0${x.node}`, { c, v, x });
  }
  const nodeOf = (screen, id) => {
    const s = specs.get(String(screen));
    const n = s && s.idx.get(id);
    if (!n) throw new Error(`components.json: no node ${id} in screen ${screen} (run cmp.mjs again after ds.mjs)`);
    return n;
  };
  const swapBound = (c, v) => new Set(c.props.filter((p) => p.type === 'INSTANCE_SWAP' && v.bind[p.name] !== undefined).map((p) => v.bind[p.name]));
  const iconKey = (ref) => intern(tables, `icon/${ref}`);
  const pVal = (p, value) => (p.type === 'INSTANCE_SWAP' ? iconKey(value) : value);

  // marks e (encoding of spec node n) as an instance of its occurrence o, and its subtree against the variant template
  function markOcc(e, n, o, screen) {
    const { c, v, x } = o;
    e.i = intern(tables, cmpKey(c, v));
    const props = {};
    for (const p of c.props) if (v.bind[p.name] !== undefined) props[p.name] = pVal(p, Object.hasOwn(x.vals || {}, p.name) ? x.vals[p.name] : p.default);
    if (Object.keys(props).length) e.p = props;
    const tpl = nodeOf(v.template.screen, v.template.node);
    const exp = expandInstance(tpl, { bind: v.bind, props: propsOf(c), vals: x.vals || {}, ov: x.ov || {} });
    const tIdx = index(tpl), swaps = swapBound(c, v);
    const rc = new Set(Object.entries(x.ov || {}).filter(([, ov]) => Object.keys(ov).some((k) => k.startsWith('icon.'))).map(([p]) => p));
    const pair = (en, sn, xn) => {
      const path = rel(xn.id, tpl.id);
      if ((swaps.has(path) || rc.has(path)) && en.t === 'V') en.rc = 1;
      const tn = tIdx.get(xn.id);
      (sn.kids || []).forEach((k, i) => {
        const ek = en.k[i], xk = (xn.kids || [])[i];
        if (!xk) throw new Error(`component ${c.name}: ${screen} ${k.id} has no counterpart in the template`);
        const j = (tn.kids || []).findIndex((t) => t.id === xk.id);
        if (j !== i) ek.j = j;
        const inner = occ.get(`${screen}\0${k.id}`);
        if (inner) markOcc(ek, k, inner, screen); else pair(ek, k, xk);
      });
    };
    pair(e, n, exp);
  }
  // marks every occurrence of a tree; `skip` = the template root itself (a component, not an instance)
  function markTree(e, n, screen, skip) {
    const o = n.id !== skip && occ.get(`${screen}\0${n.id}`);
    if (o) return markOcc(e, n, o, screen);
    (n.kids || []).forEach((k, i) => markTree(e.k[i], k, screen, skip));
  }
  const mark = (enc) => {
    const s = specs.get(String(enc.screen));
    if (s) markTree(enc.T, s.spec, String(enc.screen), null);
    return enc;
  };
  const used = (enc) => {
    const out = new Set();
    const w = (e) => { if (e.i !== undefined) out.add(tables.K[e.i]); if (e.p) for (const v of Object.values(e.p)) if (typeof v === 'number') out.add(tables.K[v]); (e.k || []).forEach(w); };
    w(enc.T);
    return [...out].sort(cmpStr);
  };

  const encOf = (screen, sn) => {
    const s = specs.get(String(screen));
    return encodeScreen(sn, { ...ctx, screen: String(screen), svgDefs: s.svgDefs || {}, tables });
  };
  // icon components: every ref an INSTANCE_SWAP property can take, sized and coloured as its first bound node
  const icons = new Map(); // ref -> { screen, sn }
  for (const c of [...comps].sort((a, b) => cmpStr(a.name, b.name))) {
    for (const v of c.variants) for (const p of c.props) {
      if (p.type !== 'INSTANCE_SWAP' || v.bind[p.name] === undefined) continue;
      const tpl = nodeOf(v.template.screen, v.template.node), sn = index(tpl).get(at(tpl, v.bind[p.name]));
      for (const ref of [...(c.icons || []), p.default].sort(cmpStr)) {
        if (icons.has(ref)) continue;
        const svgOk = [v.template.screen, ...specs.keys()].find((id) => (specs.get(String(id)).svgDefs || {})[ref]);
        if (svgOk === undefined) throw new Error(`component ${c.name}: icon ${ref} has no svg symbol in any screen`);
        icons.set(ref, { screen: svgOk, sn: { id: 'icon', t: 'V', w: sn.w, h: sn.h, sz: ['FIXED', 'FIXED'], icon: { ...(sn.icon || {}), ref } } });
      }
    }
  }
  const items = [];
  for (const ref of [...icons.keys()].sort(cmpStr)) {
    const { screen, sn } = icons.get(ref);
    const enc = encOf(screen, sn);
    const name = `icon/${ref}`;
    items.push({ ...enc, screen: `cmp:${name}`, W: [enc.T.w, enc.T.w], cm: { k: iconKey(ref), n: name, v: '' } });
  }
  // dependency order: a component after the components its templates hold
  const deps = new Map(comps.map((c) => [c.name, new Set(c.variants.flatMap((v) => Object.values(v.nested || {})).filter((n) => byName.has(n)))]));
  const order = [], done = new Set();
  const visit = (name, stack = []) => {
    if (done.has(name)) return;
    if (stack.includes(name)) throw new Error(`components nest in a cycle: ${[...stack, name].join(' > ')}`);
    for (const d of [...deps.get(name)].sort(cmpStr)) visit(d, [...stack, name]);
    done.add(name); order.push(byName.get(name));
  };
  for (const c of [...comps].sort((a, b) => cmpStr(a.name, b.name))) visit(c.name);
  for (const c of order) {
    const p = {};
    for (const q of c.props) p[q.name] = [q.type, q.type === 'INSTANCE_SWAP' ? iconKey(q.default) : q.default];
    for (const v of c.variants) {
      const tpl = nodeOf(v.template.screen, v.template.node);
      const enc = encOf(v.template.screen, tpl);
      delete enc.T.a; // placement belongs to each instance
      markTree(enc.T, tpl, String(v.template.screen), tpl.id);
      // a node bound to INSTANCE_SWAP is an instance of the default icon component in the main
      const swaps = swapBound(c, v), tIdx = new Map();
      const w = (e) => { tIdx.set(e.o, e); (e.k || []).forEach(w); };
      w(enc.T);
      for (const path of swaps) {
        const e = tIdx.get(at(tpl, path));
        const q = c.props.find((x) => x.type === 'INSTANCE_SWAP' && v.bind[x.name] === path);
        e.i = iconKey(q.default); e.rc = 1;
      }
      const name = cmpKey(c, v);
      const cm = { k: intern(tables, name), n: c.name, v: c.axes.length ? variantName(c.axes, v.props) : '' };
      if (Object.keys(p).length) cm.p = p;
      if (Object.keys(v.bind).length) cm.b = { ...v.bind };
      items.push({ ...enc, screen: `cmp:${name}`, W: [enc.T.w, enc.T.w], cm });
    }
  }
  return { K: tables.K || [], items, mark, used };
}

// the occurrences of a screen that became instances, for the plan log: { components, instances }
export function cmpCount(items, encs) {
  let inst = 0;
  const w = (e) => { if (e.i !== undefined) inst++; (e.k || []).forEach(w); };
  for (const e of encs) w(e.T);
  return { components: items.filter((x) => !x.cm.n.startsWith('icon/')).length, icons: items.filter((x) => x.cm.n.startsWith('icon/')).length, instances: inst };
}
export { cmpNodeId };
