// Design tokens (plan 2, Task 7): W3C DTCG (2025.10) tokens, a CSS custom-property layer and a use -> token map,
// from an inventory and the normalisation entries. Pure and deterministic: same inventory + entries + names -> the
// same bytes (no clock; every list is sorted; the order of uses and screens does not matter).
//
// buildTokens(inv, entries = [], names = {}) -> { tokens, css, map, warnings }
//  - Values are the values AFTER normalisation: a use covered by an entry with status 'auto' or 'answered' takes the
//    entry's `to` (type entries: fontSize -> size, lineHeight -> lineHeight); 'ask' entries keep `from`. Uses with no
//    value (inventory `unparsed`, space-between gaps) and geometry noise (inventory `noise`, R67: space / size / radius
//    under 0.5 px) get no token and no map entry.
//  - tokens = { primitive, role, component: {} } (groups are plain objects; a token has $type, $value, $description
//    and $extensions['vuong-design'] = { uses, nodes, screens, ... }).
//    primitive: color.cNN (by uses, descending, then hex), space.N, size.N (FIXED frame / image sizes and icon
//      width / height), radius.N, border.N (stroke widths), shadow.sNN, opacity.N (percent), font.family.<name>,
//      font.size.N (text and glyph-icon sizes), font.weight.N, font.lineHeight.N (px), font.letterSpacing.N (px),
//      typography.t<size>-<weight> (composite). N = the px number, '.' written '_' and '-' written 'm' (11.5 -> 11_5).
//      Name collisions (two families or typography styles with the same name) get -2, -3 ... in sorted order (uses
//      descending, then value).
//      $type: color ($value { colorSpace: 'srgb', components, alpha?, hex }), dimension ({ value, unit: 'px' }),
//      fontFamily, fontWeight, number (opacity), shadow (parsed CSS box-shadow: { color, offsetX, offsetY, blur,
//      spread, inset? }, an array for several layers), typography ({ fontFamily, fontSize, fontWeight,
//      letterSpacing: aliases, lineHeight: number = line height / font size; px line height, font style and text
//      transform in $extensions}). A box-shadow that does not parse (a unit other than px, no colour, a colour that
//      does not parse) has no $type, keeps the CSS in $value and in $extensions raw, and is listed in warnings
//      (SHADOW_UNPARSED); DTCG tools will skip it.
//    role: one token per role key (inventory role) with at least 2 uses or a CSS variable among its uses, aliasing
//      the primitive of the role's majority value ("{primitive.color.c01}"; uses carrying the variable decide the
//      majority when there is one). Name: the CSS variable without '--' (sanitised to [A-Za-z0-9_-]); otherwise
//      `<element>-<prop>` from the role's element signature (classes joined by '-', at most 2; an element with no
//      class is named <parent element>-<tag>; sides and corners collapse: padding, border-width, border-color,
//      radius). Role keys with the same name and the same primitive share one token; other collisions get -2, -3 ...
//      in sorted order (named first, then uses descending, then primitive path, then role key).
//    component: empty (plan 3 fills it).
//  - map: { [useKey]: token path } for every use with a token: the role token when the use's role has one and the
//    use's value is the role's value, else the primitive (a use never resolves to a token of another value).
//    useKey = `${screen}|${node}|${cat}|${prop}` plus `|${run}` when the use has a run.
//  - names (vd-names.json, names-file.mjs): { old path: new path } applied after naming; aliases follow. Errors
//    throw (one Error listing them all); warnings (RENAME_NAMED, NAME_UNKNOWN) are returned.
//  - css: ':root {' primitives first, then roles ('--role-<name>: var(--<primitive>)'), in token order. Variable
//    name = the token path without its tier, '.' -> '-', camelCase -> kebab-case. Typography is a `font` shorthand
//    of the primitive variables (letter spacing and transform are not part of it).
//  - warnings: [{ code, path?, message }] sorted by code then path.
import { parseColor, toHex } from './color.mjs';
import { validateNames } from './names-file.mjs';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const VD = 'vuong-design';

export const numName = (v) => String(r2(v)).replace('-', 'm').replace('.', '_');
export const useKey = (u) => `${u.screen}|${u.node}|${u.cat}|${u.prop}${u.run !== undefined ? `|${u.run}` : ''}`;

// ---------------- normalised values ----------------

function entryIndex(entries) {
  const idx = new Map();
  for (const e of entries || []) {
    if (e.status !== 'auto' && e.status !== 'answered') continue;
    for (const n of e.nodes || []) {
      idx.set(JSON.stringify([n.screen, n.node, n.run ?? null, e.cat, e.prop, e.role, e.from]), e);
    }
  }
  return idx;
}

// the use's value after normalisation, and the entries that changed it
function normValue(u, idx) {
  const look = (prop, run, from) => idx.get(JSON.stringify([u.screen, u.node, run ?? null, u.cat, prop, u.role, from]));
  if (u.cat === 'type') {
    const v = { ...u.value }, by = [];
    const fs = look('fontSize', u.run, v.size);
    if (fs) { v.size = fs.to; by.push(fs); }
    const lh = look('lineHeight', undefined, v.lineHeight);
    if (lh) { v.lineHeight = lh.to; by.push(lh); }
    return { value: v, by };
  }
  const e = look(u.prop, u.cat === 'color' ? u.run : undefined, u.value);
  return e ? { value: e.to, by: [e] } : { value: u.value, by: [] };
}

// ---------------- DTCG values ----------------

export function colorValue(css) {
  const c = typeof css === "string" ? parseColor(css) : css;
  const o = { colorSpace: 'srgb', components: [r4(c.r), r4(c.g), r4(c.b)] };
  if (c.a < 1) o.alpha = r4(c.a);
  o.hex = toHex({ ...c, a: 1 });
  return o;
}
const dim = (v) => ({ value: r2(v), unit: 'px' });

function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// CSS box-shadow (computed form) -> DTCG shadow value, or null when it does not parse
export function parseShadow(css) {
  if (typeof css !== 'string' || !css.trim() || css.trim() === 'none') return null;
  const layers = [];
  for (const layer of splitTop(css, ',')) {
    let color = null, inset = false; const lens = [];
    for (const t of splitTop(layer, ' ')) {
      if (t === 'inset') { inset = true; continue; }
      const m = /^(-?\d*\.?\d+)(px)?$/.exec(t);
      if (m) { if (!m[2] && +m[1] !== 0) return null; lens.push(+m[1]); continue; }
      if (color) return null;
      const c = parseColor(t);
      if (c.unparsed !== undefined) return null;
      color = c;
    }
    if (!color || lens.length < 2 || lens.length > 4) return null;
    const o = { color: colorValue(color), offsetX: dim(lens[0]), offsetY: dim(lens[1]), blur: dim(lens[2] ?? 0), spread: dim(lens[3] ?? 0) };
    if (inset) o.inset = true;
    layers.push(o);
  }
  if (!layers.length) return null;
  return layers.length === 1 ? layers[0] : layers;
}

// ---------------- role names ----------------

const sanitize = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'x';
function elemName(sig, parentSig) {
  const one = (s) => {
    if (!s) return 'root';
    if (s.startsWith('syn:')) return 'syn-' + s.slice(4);
    if (s.startsWith('::')) return s.slice(2);
    const [tag, ...cls] = s.split('.');
    return cls.length ? cls.slice(0, 2).join('-') : tag;
  };
  const own = one(sig);
  const bare = sig && !sig.startsWith('syn:') && !sig.includes('.');
  return sanitize(bare || (sig || '').startsWith('::') ? `${one(parentSig)}-${own}` : own);
}
function propName(cat, prop) {
  if (cat === 'type') return 'text';
  if (cat === 'shadow' || cat === 'opacity') return cat;
  if (/^padding[TRBL]$/.test(prop)) return 'padding';
  if (/^radius/.test(prop)) return 'radius';
  if (/^border[TRBL]$/.test(prop)) return cat === 'color' ? 'border-color' : 'border-width';
  if (cat === 'icon') return prop === 'fontSize' ? 'icon-size' : `icon-${prop}`;
  if (prop === 'counterGap') return 'row-gap';
  return prop;
}
export function roleBase(role) {
  const [cat, prop, sig, parentSig] = String(role).split('|');
  return `${elemName(sig, parentSig)}-${propName(cat, prop)}`;
}

// ---------------- build ----------------

const CAT_ORDER = ['color', 'space', 'size', 'radius', 'border', 'shadow', 'opacity', 'font.family', 'font.size', 'font.weight',
  'font.lineHeight', 'font.letterSpacing', 'typography'];

export function buildTokens(inv, entries = [], names = {}) {
  const idx = entryIndex(entries);
  const warnings = [];
  const uses = [...((inv && inv.uses) || [])];
  // primitive registry: key `${cat}|${JSON value}` -> { cat, value, uses: [], by: Map(from -> {from, code, uses}) }
  const prim = new Map();
  const usePrim = new Map(); // use -> primitive key (typography for type uses)
  const addPrim = (cat, value, u, extra) => {
    const k = `${cat}|${JSON.stringify(value)}`;
    let p = prim.get(k);
    if (!p) { p = { cat, value, uses: [], merged: new Map(), ...extra }; prim.set(k, p); }
    if (u) p.uses.push(u);
    return k;
  };
  // values moved into a primitive by normalisation (not for typography: its parts move separately)
  const noteMerged = (k, by) => {
    for (const e of by) {
      if (e.cat === 'type') continue;
      const m = prim.get(k).merged;
      const key = JSON.stringify([e.from, e.code]);
      const x = m.get(key) || { from: e.from, code: e.code, uses: 0 };
      x.uses++; m.set(key, x);
    }
  };
  for (const u of uses) {
    if (u.unparsed || u.flex || u.noise || u.value === null || u.value === undefined) continue;
    const { value, by } = normValue(u, idx);
    let k = null;
    if (u.cat === 'color' && typeof value === 'string') k = addPrim('color', value, u);
    else if ((u.cat === 'space' || u.cat === 'size' || u.cat === 'radius' || u.cat === 'border') && typeof value === 'number') k = addPrim(u.cat, value, u);
    else if (u.cat === 'icon' && typeof value === 'number') k = addPrim(u.prop === 'fontSize' ? 'font.size' : 'size', value, u);
    else if (u.cat === 'opacity' && typeof value === 'number') k = addPrim('opacity', value, u);
    else if (u.cat === 'shadow' && typeof value === 'string') k = addPrim('shadow', value, u);
    else if (u.cat === 'type' && value && typeof value === 'object') {
      const t = value;
      if (typeof t.size !== 'number' || typeof t.weight !== 'number' || typeof t.lineHeight !== 'number' || !t.family) {
        warnings.push({ code: 'TYPE_UNREADABLE', path: useKey(u), message: `type use ${useKey(u)} has no readable size, weight, line height or family; no token` });
        continue;
      }
      const ls = typeof t.letterSpacing === 'number' ? t.letterSpacing : 0;
      addPrim('font.family', t.family, u, { raw: u.raw });
      addPrim('font.size', t.size, u);
      addPrim('font.weight', t.weight, u);
      addPrim('font.lineHeight', t.lineHeight, u);
      addPrim('font.letterSpacing', ls, u);
      k = addPrim('typography', { family: t.family, size: t.size, weight: t.weight, lineHeight: t.lineHeight, letterSpacing: ls, style: t.style || 'normal', transform: t.transform || 'none' }, u);
    }
    if (k) { usePrim.set(u, k); noteMerged(k, by); }
  }

  // ---- primitive names ----
  const cntCmp = (a, b) => b.uses.length - a.uses.length;
  const byCat = new Map(CAT_ORDER.map((c) => [c, []]));
  for (const p of prim.values()) byCat.get(p.cat).push(p);
  const order = [];
  for (const [cat, list] of byCat) {
    if (cat === 'color' || cat === 'shadow') {
      list.sort((a, b) => cntCmp(a, b) || cmpStr(a.value, b.value));
      const w = Math.max(2, String(list.length).length);
      list.forEach((p, i) => { p.path = `primitive.${cat}.${cat[0]}${String(i + 1).padStart(w, '0')}`; });
    } else if (cat === 'font.family' || cat === 'typography') {
      const nm = (p) => (cat === 'font.family' ? sanitize(p.value.toLowerCase()) : `t${numName(p.value.size)}-${p.value.weight}`);
      list.sort((a, b) => cmpStr(nm(a), nm(b)) || cntCmp(a, b) || cmpStr(JSON.stringify(a.value), JSON.stringify(b.value)));
      const seen = new Map();
      for (const p of list) {
        const n = nm(p), c = (seen.get(n) || 0) + 1;
        seen.set(n, c);
        p.path = `primitive.${cat}.${c === 1 ? n : `${n}-${c}`}`;
      }
    } else {
      list.sort((a, b) => a.value - b.value);
      list.forEach((p) => { p.path = `primitive.${cat}.${numName(cat === 'opacity' ? p.value * 100 : p.value)}`; });
    }
    order.push(...list);
  }

  // ---- roles ----
  const byRole = new Map();
  for (const u of uses) if (usePrim.has(u)) (byRole.get(u.role) || byRole.set(u.role, []).get(u.role)).push(u);
  const varOf = (u) => (u.cat === 'type' ? (u.tokens && (u.tokens.size || u.tokens.family || Object.values(u.tokens).sort(cmpStr)[0])) : u.token);
  const majority = (list) => {
    const m = new Map();
    for (const u of list) { const p = prim.get(usePrim.get(u)).path; m.set(p, (m.get(p) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))[0][0];
  };
  const cands = new Map(); // `${base}|${primPath}` -> candidate
  for (const role of [...byRole.keys()].sort(cmpStr)) {
    const list = byRole.get(role);
    const vc = new Map();
    for (const u of list) { const v = varOf(u); if (v) vc.set(v, (vc.get(v) || 0) + 1); }
    const v = [...vc].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))[0]?.[0];
    if (!v && list.length < 2) continue;
    const primPath = majority(v ? list.filter((u) => varOf(u) === v) : list);
    const base = v ? sanitize(v.replace(/^--/, '')) : roleBase(role);
    const ck = `${base}|${primPath}`;
    const c = cands.get(ck) || { base, var: v, primPath, roles: [], uses: [] };
    if (v && !c.var) c.var = v;
    c.roles.push(role);
    for (const u of list) if (prim.get(usePrim.get(u)).path === primPath) c.uses.push(u);
    cands.set(ck, c);
  }
  const roleList = [...cands.values()].sort((a, b) => cmpStr(a.base, b.base) || (b.var ? 1 : 0) - (a.var ? 1 : 0) ||
    b.uses.length - a.uses.length || cmpStr(a.primPath, b.primPath) || cmpStr(a.roles[0], b.roles[0]));
  const taken = new Set();
  for (const c of roleList) {
    let n = c.base, i = 1;
    while (taken.has(n)) n = `${c.base}-${++i}`;
    taken.add(n);
    c.path = `role.${n}`;
  }
  const roleOfUse = new Map();
  for (const c of roleList) for (const u of c.uses) roleOfUse.set(u, c);

  // ---- registry of tokens (internal, aliases as { alias: path }) ----
  const pByKey = new Map([...prim].map(([k, p]) => [k, p]));
  const pathOfPrim = (cat, value) => pByKey.get(`${cat}|${JSON.stringify(value)}`).path;
  const nodesScreens = (list) => {
    const nodes = new Set(list.map((u) => `${u.screen}|${u.node}`)), screens = [...new Set(list.map((u) => String(u.screen)))].sort(cmpStr);
    return { nodes: nodes.size, screens };
  };
  const describe = (list, extra = '') => {
    const { nodes, screens } = nodesScreens(list);
    const bases = [...new Set(list.map((u) => roleBase(u.role)))].sort(cmpStr);
    const shown = bases.slice(0, 3).join(', ') + (bases.length > 3 ? ` (+${bases.length - 3} more)` : '');
    return `used by ${nodes} node${nodes === 1 ? '' : 's'} on ${screens.length} screen${screens.length === 1 ? '' : 's'}: ${shown}${extra}`;
  };
  const reg = [];
  for (const p of order) {
    const ns = nodesScreens(p.uses);
    const ext = { uses: p.uses.length, nodes: ns.nodes, screens: ns.screens };
    const merged = [...p.merged.values()].sort((a, b) => cmpStr(JSON.stringify(a.from), JSON.stringify(b.from)) || cmpStr(a.code, b.code));
    if (merged.length) ext.merged = merged;
    const t = { path: p.path, named: false, ext, $description: describe(p.uses) };
    const v = p.value;
    switch (p.cat) {
      case 'color': Object.assign(t, { $type: 'color', $value: colorValue(v), css: v }); break;
      case 'space': case 'size': case 'radius': case 'border': case 'font.size': case 'font.lineHeight': case 'font.letterSpacing':
        Object.assign(t, { $type: 'dimension', $value: dim(v), css: `${r2(v)}px` }); break;
      case 'opacity': Object.assign(t, { $type: 'number', $value: v, css: String(v) }); break;
      case 'font.weight': Object.assign(t, { $type: 'fontWeight', $value: v, css: String(v) }); break;
      case 'font.family': {
        Object.assign(t, { $type: 'fontFamily', $value: v, css: `"${v.replace(/"/g, '\\"')}"` });
        const raws = [...new Set(p.uses.map((u) => (typeof u.raw === 'string' ? u.raw : null)).filter(Boolean))].sort(cmpStr);
        if (raws.length) ext.source = raws;
        break;
      }
      case 'shadow': {
        const s = parseShadow(v);
        if (s) Object.assign(t, { $type: 'shadow', $value: s, css: v });
        else {
          Object.assign(t, { $value: v, css: v });
          ext.raw = v;
          warnings.push({ code: 'SHADOW_UNPARSED', path: p.path, message: `box-shadow "${v}" does not parse into a DTCG shadow; kept raw, no $type` });
        }
        break;
      }
      case 'typography': {
        const al = (cat, x) => ({ alias: pathOfPrim(cat, x) });
        t.$type = 'typography';
        t.$value = {
          fontFamily: al('font.family', v.family), fontSize: al('font.size', v.size), fontWeight: al('font.weight', v.weight),
          letterSpacing: al('font.letterSpacing', v.letterSpacing), lineHeight: r4(v.lineHeight / v.size),
        };
        t.cssParts = { family: al('font.family', v.family), size: al('font.size', v.size), weight: al('font.weight', v.weight), lineHeight: al('font.lineHeight', v.lineHeight), style: v.style };
        Object.assign(ext, { lineHeightPx: v.lineHeight, lineHeightToken: pathOfPrim('font.lineHeight', v.lineHeight) });
        if (v.style !== 'normal') ext.fontStyle = v.style;
        if (v.transform !== 'none') ext.textTransform = v.transform;
        break;
      }
      default: break;
    }
    reg.push(t);
  }
  const primByPath = new Map(reg.map((t) => [t.path, t]));
  for (const c of roleList) {
    const target = primByPath.get(c.primPath);
    const ns = nodesScreens(c.uses);
    const ext = { uses: c.uses.length, nodes: ns.nodes, screens: ns.screens, roles: [...c.roles].sort(cmpStr) };
    if (c.var) ext.var = c.var;
    const t = { path: c.path, named: !!c.var, ext, $description: describe(c.uses, c.var ? ` (CSS variable ${c.var})` : '') };
    if (target.$type) t.$type = target.$type;
    t.$value = { alias: c.primPath };
    reg.push(t);
  }

  // ---- renames ----
  const { rename, errors, warnings: nw } = validateNames(names || {}, reg.map((t) => ({ path: t.path, named: t.named })));
  if (errors.length) throw new Error(`names: ${errors.join('; ')}`);
  warnings.push(...nw);
  const fin = (p) => rename.get(p) ?? p;
  const resolveAliases = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.alias === 'string' && Object.keys(v).length === 1) return `{${fin(v.alias)}}`;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveAliases(x)]));
    }
    return Array.isArray(v) ? v.map(resolveAliases) : v;
  };

  // ---- tokens object ----
  const tokens = { primitive: {}, role: {}, component: {} };
  for (const t of reg) {
    const segs = fin(t.path).split('.');
    let g = tokens;
    for (const s of segs.slice(0, -1)) g = (g[s] ||= {});
    const o = {};
    if (t.$type) o.$type = t.$type;
    o.$value = resolveAliases(t.$value);
    o.$description = t.$description;
    o.$extensions = { [VD]: t.ext };
    g[segs[segs.length - 1]] = o;
  }

  // ---- map ----
  const map = {};
  const sortedUses = [...usePrim.keys()].map((u) => [useKey(u), u]).sort((a, b) => cmpStr(a[0], b[0]));
  for (const [k, u] of sortedUses) {
    const c = roleOfUse.get(u);
    map[k] = fin(c ? c.path : prim.get(usePrim.get(u)).path);
  }

  // ---- css ----
  const cssName = (p) => '--' + fin(p).split('.').slice(1).join('-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const lines = [];
  for (const t of reg) {
    if (t.path.startsWith('role.')) continue;
    if (t.$type === 'typography') {
      const v = (a) => `var(${cssName(a.alias)})`, cp = t.cssParts;
      lines.push(`  ${cssName(t.path)}: ${cp.style !== 'normal' ? cp.style + ' ' : ''}${v(cp.weight)} ${v(cp.size)}/${v(cp.lineHeight)} ${v(cp.family)};`);
    } else lines.push(`  ${cssName(t.path)}: ${t.css};`);
  }
  for (const t of reg) {
    if (!t.path.startsWith('role.')) continue;
    lines.push(`  --role-${cssName(t.path).slice(2)}: var(${cssName(t.$value.alias)});`);
  }
  const css = `:root {\n${lines.join('\n')}\n}\n`;

  warnings.sort((a, b) => cmpStr(a.code, b.code) || cmpStr(a.path || '', b.path || ''));
  return { tokens, css, map, warnings };
}
