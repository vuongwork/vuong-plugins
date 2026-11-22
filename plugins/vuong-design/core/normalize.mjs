// Normalisation (plan 2, Task 4): ordered rules of spec §9 over an inventory, with one reason code per decision and
// the project's saved answers. Pure and deterministic: no clock, no browser; the output depends neither on the order
// of the uses nor of the screens (uses are re-sorted, aggregates are counts and sets, ties break on values).
//
// normalize(inv, rules = { version: 1, answers: {} }, opts = {}) -> { entries, questions, counts, unparsed, stale }
//  - Entry = { id, cat, role, prop, nodes: [{ screen, node, run? }], from, to, code, status, proposal?, question? }
//    status 'auto' (applied by rule), 'answered' (applied from rules.answers), 'ask' (not applied: to = from,
//    proposal = what the answer 'yes' / the default would give). One entry per (cat, role, prop, from, code, target).
//    An answer that picks the keep option (the value itself, 'no', 'keep') makes no entry (counted under its code).
//    A SRC_SQUASH answered 'declared' is an entry even when to = from (the spec already holds the larger size; the
//    entry is what explains the source's squashed width).
//    prop is the Use prop, except type entries: 'fontSize' or 'lineHeight' (nodes carry `run` for fontSize and for
//    colours of text runs; line-height is per node). id = 8-hex FNV-1a of `cat|role|prop|from` (with code and
//    target appended in the rare case two entries would collide).
//  - `kept` outcomes are not entries: counts[code] = number of use decisions kept under that code (TOKEN, FLEX,
//    IN_SCALE, and a question code when the answer chose to keep the value). A type use makes two decisions (font
//    size and line height). counts.NOISE = uses skipped as geometry noise (R67).
//  - Question = { key, cat, code, text (English, one sentence), options, default, affects (distinct nodes), roles?,
//    answered?, resolved? }. Every question is listed, answered or not (`answered` = the saved answer for this key);
//    resolved = true when the question has no answer of its own but every decision in it was settled by a per-role
//    or project answer. The CLI asks only the open ones (neither answered nor resolved). rules.answers[key] must be
//    one of `options` (compared as strings; a number may be written "12"), else normalize throws an Error naming the
//    key. default = the proposal (what the template drafts), never applied without an answer. stale = answer keys
//    that match no question and no per-role key (sorted).
//  - unparsed = uses with no readable value (inventory `unparsed`), never normalised.
//
// R68: questions are grouped across roles, so a person answers one question per value, not per element:
//  - group question, one per (code, cat, prop family, from, proposal), roles = the role keys it covers (sorted),
//    affects = their distinct nodes. Prop families: space = padding T/R/B/L + gap + counterGap, radius = the four
//    corners, size = width + height, icon = width + height; a colour is one family over every colour prop. Keys:
//    GRID4 `grid4|<cat>|<from>|<proposal>` (e.g. grid4|space|13|12), ICON_FRAME `icon|<from>` (the proposal follows
//    from the size), COLOR_NEAR `color|<from>|<to>`, SRC_SQUASH `squash|<cat>|<from>|<proposal>`. Entries stay per
//    role; their `question` is the group key.
//  - per-role keys (the earlier format) are still read, never listed: GRID4 `grid4|<role>|<from>`, SRC_SQUASH
//    `squash|<node role>` (role without cat and prop). Same options as the group.
//  - project questions (options accept-all / ask-each, default ask-each, so nothing changes without the user):
//    project.grid4, project.iconFrame, project.colorNear, project.srcSquash; accept-all applies each decision's
//    proposal. Listed when the code has at least one decision. (project.typeScale / project.lineHeightInt stay
//    yes / no, as below.)
//  - answer order for a decision: per-role key > group key > project key (accept-all) > none (ask). The template
//    (rules-file.mjs rulesTemplate) therefore lists group and project keys only.
//
// Codes, in the order tried for each use (the first that applies decides):
//  TOKEN           the use carries a CSS variable whose value is its value (inventory R64) -> kept.
//  FLEX            space-between gap (Figma auto spacing), or an icon axis that is not FIXED -> kept, no number.
//  IN_SCALE        already in scale -> kept. space, frame size, radius: a multiple of 4 px (±0.01; 0 never reaches
//                  here). Radius and border width ≤ 2 px (hairlines) are never touched; border widths have no scale
//                  in plan 2 (every width counts as in scale, never GRID4). Images keep their size (their own
//                  scale) when it is the same at widths A and B. Icon width / height: 16, 20 or 24 px and the same at
//                  A and B. Font size: a size of the type scale (below). Line height: an integer px (±0.01).
//                  Colour: no more frequent colour within ΔE2000 3 of the same alpha.
//  ROLE_MAJORITY   off-scale space / frame size / radius / icon value whose role (all screens) has one value used by
//                  strictly more than half its uses, that value in scale -> that value, auto.
//  GRID4           off-grid space / frame size / radius with no majority -> question `grid4|<cat>|<from>|<proposal>`
//                  (R68), options the two neighbouring multiples of 4 and the value itself, proposal the nearest
//                  (tie -> larger).
//                  Never for font sizes, border widths, icons, images, flexible values.
//  COLOR_DE1       colour (unnamed: no use of that hex has a token) within ΔE2000 < 1 of a more frequent unnamed
//                  colour (more uses; tie -> lower hex) with the same alpha: its uses in a role the other colour also
//                  has -> merged, auto. Its uses in other roles fall to COLOR_NEAR.
//  COLOR_NEAR      ΔE2000 < 3 to a more frequent colour of the same alpha otherwise (different roles, or either one
//                  is named) -> question `color|<from>|<to>`, proposal the more frequent colour. Named colours are
//                  never merged without an answer; different alpha never merges and asks nothing. A colour that
//                  itself moved (auto or answered) is not a merge target (no chains).
//  TYPE_SCALE      one project question `project.typeScale` (yes / no): type scale = font sizes used in at least two
//                  roles; an odd size moves to the nearest scale size used in its own role, else to the nearest scale
//                  size within 2 px (tie -> larger); none -> stays (IN_SCALE). One entry per role and size.
//  LINE_HEIGHT_INT one project question `project.lineHeightInt` (yes / no): a line height not within 0.01 px of an
//                  integer -> Math.round. One entry per role and value.
//  ICON_FRAME      icon width / height not 16 / 20 / 24 px -> question `icon|<from>` per distinct size, proposal the
//                  nearest of those (tie -> larger).
//  SRC_SQUASH      R65: an icon or image whose spec axis is FIXED but whose measured size differs between widths A
//                  and B by more than 0.75 px (flex-shrink squashed it at one width). Capture records no declared CSS
//                  size, so the declared size is taken to be the larger of the two measurements (flex-shrink only
//                  shrinks; usually B, the wider) -> question `squash|<cat>|<from>|<proposal>` (options declared /
//                  keep), proposal the larger size at both widths. An icon off 16/20/24 px reaches ICON_FRAME first.
// R69: a number within 0.05 px of an integer counts as that integer for IN_SCALE, role majorities, GRID4 / ICON_FRAME
// proposals, options and question keys (11.01 -> grid4|space|11|12; 12.02 is in scale). Entries keep the exact
// `from` (apply-norm matches it ±0.01); `to` is the grid / frame value; the keep option is the integer. Values
// further from an integer (131.14) are untouched by this rule. Per-role keys keep the exact value.
// R70: a radius use marked `pill` by inventory (radius ≥ half the node's smaller side at A) is in scale, counted
// PILL, never GRID4 or ROLE_MAJORITY; no entry (tokens give it radius.full).
// R71: ICON_FRAME and icon ROLE_MAJORITY apply only to icons whose larger side (inventory box, else the value) is at
// most 32 px. A larger svg is an illustration: kept, counted ILLUSTRATION, no question; SRC_SQUASH still applies
// when its size differs between widths A and B.
// Before every code: R67, a use marked `noise` by inventory (space / size / radius under 0.5 px, a rounding residue
// of the measured geometry) is skipped and counted as NOISE; it never takes part in a role majority.
// Not normalised in plan 2: shadow, opacity, icon glyph font size, type family / weight / style / letter spacing /
// transform. A use with tokenMismatch (inventory R64) is treated as having no token.
import { parseColor, deltaE2000 } from './color.mjs';
import { cmpNodeId } from './inventory.mjs';

const EPS = 0.01;
const SQUASH_PX = 0.75;
const FRAMES = [16, 20, 24];
const SNAP = 0.05; // R69
const ICON_MAX = 32; // R71
const snap = (v) => (Math.abs(v - Math.round(v)) <= SNAP + 1e-9 ? Math.round(v) : v);
const GRID_CATS = new Set(['space', 'size', 'radius']);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const onGrid = (v) => Math.abs(v - 4 * Math.round(v / 4)) < EPS;
const isInt = (v) => Math.abs(v - Math.round(v)) < EPS;
const inFrames = (v) => FRAMES.some((f) => Math.abs(f - v) < EPS);

// nearest candidate, tie -> larger
function nearest(v, cands) {
  let best = null;
  for (const c of [...cands].sort((a, b) => a - b)) {
    if (best === null || Math.abs(c - v) <= Math.abs(best - v) + 1e-9) best = c;
  }
  return best;
}
const grid4Of = (v) => { const lo = Math.floor(v / 4) * 4; return lo <= 0 ? [4] : [lo, lo + 4]; };

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const nodeSig = (role) => String(role).split('|').slice(2).join('|');
const cmpUse = (a, b) => cmpStr(String(a.screen), String(b.screen)) || cmpNodeId(a.node, b.node) || cmpStr(a.cat, b.cat) ||
  cmpStr(a.prop, b.prop) || (a.run ?? -1) - (b.run ?? -1) || cmpStr(JSON.stringify(a.value ?? null), JSON.stringify(b.value ?? null));

export function normalize(inv, rules = { version: 1, answers: {} }, opts = {}) { // eslint-disable-line no-unused-vars
  const answers = (rules && rules.answers) || {};
  const uses = [...((inv && inv.uses) || [])].sort(cmpUse);
  const counts = {};
  let unparsed = 0;
  const keep = (code) => { counts[code] = (counts[code] || 0) + 1; };
  const questions = new Map(); // key -> question
  const pending = []; // decisions: { u, cat, role, prop, from, code, target, qkey?, rkey?, bulk?, auto?, keepOpt?, map?, node }
  const roleKeys = new Map(); // per-role key -> options (read, never listed)
  const bulks = new Map(); // project key -> { code, nodes }

  // text: a string or a function of the question (its roles / nodes are only known at the end)
  const ask = (key, cat, code, text, options, def, grouped = true) => {
    if (!questions.has(key)) questions.set(key, { key, cat, code, text, options, default: def, nodes: new Set(), roles: grouped ? new Set() : null });
    return key;
  };
  const decide = (d) => {
    if (d.rkey) roleKeys.set(d.rkey, questions.get(d.qkey).options);
    if (d.bulk) {
      const b = bulks.get(d.bulk) || { code: d.code, nodes: new Set() };
      b.nodes.add(`${d.u.screen}|${d.u.node}`);
      bulks.set(d.bulk, b);
    }
    pending.push(d);
  };
  const BULK = { GRID4: 'project.grid4', ICON_FRAME: 'project.iconFrame', COLOR_NEAR: 'project.colorNear', SRC_SQUASH: 'project.srcSquash' };
  const BULK_CAT = { GRID4: 'space', ICON_FRAME: 'icon', COLOR_NEAR: 'color', SRC_SQUASH: 'size' };
  const BULK_TEXT = {
    GRID4: (n) => `Apply every proposed 4 px grid value (${n} off-grid spacing, size and radius question(s)) without asking each one?`,
    ICON_FRAME: (n) => `Move every icon to its proposed 16, 20 or 24 px frame (${n} icon size question(s)) without asking each one?`,
    COLOR_NEAR: (n) => `Merge every near colour (ΔE2000 < 3) into its proposed more frequent colour (${n} colour question(s)) without asking each one?`,
    SRC_SQUASH: (n) => `Keep the declared (larger) size at both widths for every squashed icon or image (${n} question(s)) without asking each one?`,
  };
  const roleSummary = (q) => {
    const sigs = [...q.roles].map((r) => { const [, prop, ...rest] = String(r).split('|'); return `${prop} on ${rest.join('|')}`; }).sort(cmpStr);
    return sigs.length === 1 ? sigs[0] : `${sigs.length} roles, e.g. ${sigs[0]}`;
  };
  const nodeOf = (u, withRun) => (withRun && u.run !== undefined ? { screen: u.screen, node: u.node, run: u.run } : { screen: u.screen, node: u.node });

  // ---------- numbers: space, size, radius, border, icon width/height ----------
  const numeric = uses.filter((u) => ['space', 'size', 'radius', 'border'].includes(u.cat) || (u.cat === 'icon' && u.prop !== 'fontSize'));
  const axisOf = (u) => (u.prop === 'width' ? 0 : 1);
  const stable = (u) => !Array.isArray(u.sizes) || Math.abs(u.sizes[axisOf(u)] - u.sizes[axisOf(u) + 2]) <= SQUASH_PX;
  const scaleValue = (u, v) => (u.cat === 'icon' ? inFrames(v) : u.cat === 'radius' ? v <= 2 || onGrid(v) : onGrid(v));
  const inScale = (u) => {
    const v = snap(u.value);
    if (u.cat === 'border') return true;
    if (u.cat === 'radius' && v <= 2) return true;
    if (u.cat === 'size' && u.img) return stable(u);
    if (u.cat === 'icon') return inFrames(v) && stable(u);
    return onGrid(v);
  };
  const byRole = new Map();
  for (const u of numeric) if (typeof u.value === 'number' && !u.noise) {
    const m = byRole.get(u.role) || new Map();
    const sv = snap(u.value);
    m.set(sv, (m.get(sv) || 0) + 1);
    byRole.set(u.role, m);
  }
  const majorityOf = (role) => {
    const m = byRole.get(role); if (!m) return null;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    for (const [v, n] of m) if (n * 2 > total) return v;
    return null;
  };

  for (const u of numeric) {
    if (u.noise) { keep('NOISE'); continue; }
    if (u.flex) { keep('FLEX'); continue; }
    if (typeof u.value !== 'number') { unparsed++; continue; }
    if (u.token) { keep('TOKEN'); continue; }
    if (u.cat === 'icon' && u.fixed === false) { keep('FLEX'); continue; }
    if (u.cat === 'radius' && u.pill) { keep('PILL'); continue; } // R70
    const illustration = u.cat === 'icon' && snap(u.box ? Math.max(...u.box) : u.value) > ICON_MAX; // R71
    if (illustration && stable(u)) { keep('ILLUSTRATION'); continue; }
    if (!illustration && inScale(u)) { keep('IN_SCALE'); continue; }
    const v = u.value, sv = snap(v);
    const base = { u, cat: u.cat, role: u.role, prop: u.prop, from: v, node: nodeOf(u, false) };
    const majorityCat = GRID_CATS.has(u.cat) ? !(u.cat === 'size' && u.img) : u.cat === 'icon' && !illustration;
    if (majorityCat) {
      const maj = majorityOf(u.role);
      if (maj !== null && Math.abs(maj - sv) > EPS && scaleValue(u, maj)) { decide({ ...base, code: 'ROLE_MAJORITY', target: maj, auto: true }); continue; }
    }
    if (GRID_CATS.has(u.cat) && !(u.cat === 'size' && u.img)) {
      const nb = grid4Of(sv), p = nearest(sv, nb);
      const key = ask(`grid4|${u.cat}|${sv}|${p}`, u.cat, 'GRID4',
        (q) => `${u.cat} ${sv} px (${roleSummary(q)}) is off the 4 px grid with no majority value in its role: use ${p} px?`,
        [...nb, sv], p);
      decide({ ...base, code: 'GRID4', target: p, qkey: key, rkey: `grid4|${u.role}|${v}`, bulk: BULK.GRID4, keepOpt: sv, map: (a) => Number(a) });
      continue;
    }
    if (u.cat === 'icon' && !illustration && !inFrames(sv)) {
      const p = nearest(sv, FRAMES);
      const key = ask(`icon|${sv}`, 'icon', 'ICON_FRAME', `Icons drawn at ${sv} px are not on a 16, 20 or 24 px frame: use ${p} px?`, [...FRAMES, sv], p);
      decide({ ...base, code: 'ICON_FRAME', target: p, qkey: key, bulk: BULK.ICON_FRAME, keepOpt: sv, map: (a) => Number(a) });
      continue;
    }
    // unstable icon (in frames) or image: SRC_SQUASH (R65)
    const ax = axisOf(u), p = r2(Math.max(u.sizes[ax], u.sizes[ax + 2]));
    const sig = nodeSig(u.role);
    const key = ask(`squash|${u.cat}|${v}|${p}`, u.cat, 'SRC_SQUASH',
      (q) => `A ${u.cat === 'icon' ? 'icon' : 'image'} ${v} px (${roleSummary(q)}) has a FIXED size but measures differently at widths A and B (flex-shrink): keep its declared ${p} px at both widths?`,
      ['declared', 'keep'], 'declared');
    decide({ ...base, code: 'SRC_SQUASH', target: p, qkey: key, rkey: `squash|${sig}`, bulk: BULK.SRC_SQUASH, keepOpt: 'keep', map: () => p });
  }

  // ---------- type: font size (TYPE_SCALE), line height (LINE_HEIGHT_INT) ----------
  const types = uses.filter((u) => u.cat === 'type');
  const rolesBySize = new Map(), sizesByRole = new Map();
  for (const u of types) {
    const s = u.value && u.value.size; if (typeof s !== 'number') continue;
    (rolesBySize.get(s) || rolesBySize.set(s, new Set()).get(s)).add(u.role);
    (sizesByRole.get(u.role) || sizesByRole.set(u.role, new Set()).get(u.role)).add(s);
  }
  const scale = [...rolesBySize].filter(([, r]) => r.size >= 2).map(([s]) => s).sort((a, b) => a - b);
  const scaleSet = new Set(scale);
  const TYPE_Q = 'project.typeScale', LH_Q = 'project.lineHeightInt';
  const typeDecisions = [], lhDecisions = [];
  const lhSeen = new Set();
  for (const u of types) {
    const tk = u.tokens || {};
    const s = u.value && u.value.size;
    if (typeof s !== 'number') unparsed++;
    else if (tk.size) keep('TOKEN');
    else if (!scale.length || scaleSet.has(s)) keep('IN_SCALE');
    else {
      const own = [...(sizesByRole.get(u.role) || [])].filter((x) => scaleSet.has(x));
      let t = own.length ? nearest(s, own) : null;
      if (t === null) { const n = nearest(s, scale); if (Math.abs(n - s) <= 2 + 1e-9) t = n; }
      if (t === null) keep('IN_SCALE');
      else typeDecisions.push({ u, cat: 'type', role: u.role, prop: 'fontSize', from: s, code: 'TYPE_SCALE', target: t, qkey: TYPE_Q, node: nodeOf(u, true), keepOpt: 'no', map: () => t });
    }
    // line height is per node: one decision per node and value
    const lh = u.value && u.value.lineHeight;
    const k = `${u.screen}|${u.node}|${lh}`;
    if (lhSeen.has(k)) continue;
    lhSeen.add(k);
    if (typeof lh !== 'number') unparsed++;
    else if (tk.lineHeight) keep('TOKEN');
    else if (isInt(lh)) keep('IN_SCALE');
    else {
      const t = Math.round(lh);
      lhDecisions.push({ u, cat: 'type', role: u.role, prop: 'lineHeight', from: lh, code: 'LINE_HEIGHT_INT', target: t, qkey: LH_Q, node: nodeOf(u, false), keepOpt: 'no', map: () => t });
    }
  }
  if (typeDecisions.length) {
    ask(TYPE_Q, 'type', 'TYPE_SCALE', `Move ${new Set(typeDecisions.map((d) => d.from)).size} odd font size(s) to the type scale ${scale.join(', ')} px (nearest size used in the same role)?`, ['yes', 'no'], 'yes', false);
  }
  if (lhDecisions.length) {
    ask(LH_Q, 'type', 'LINE_HEIGHT_INT', `Round ${new Set(lhDecisions.map((d) => d.from)).size} fractional line height(s) to whole px?`, ['yes', 'no'], 'yes', false);
  }
  typeDecisions.forEach(decide); lhDecisions.forEach(decide);

  // ---------- colours, per distinct hex ----------
  const colors = uses.filter((u) => u.cat === 'color');
  const hexes = new Map(); // hex -> { hex, n, roles, named, alpha, lab }
  for (const u of colors) {
    if (typeof u.value !== 'string') continue;
    const h = hexes.get(u.value) || { hex: u.value, n: 0, roles: new Set(), named: false, alpha: u.value.length === 9 ? u.value.slice(7) : 'ff' };
    h.n++; h.roles.add(u.role); if (u.token) h.named = true;
    hexes.set(u.value, h);
  }
  const order = [...hexes.values()].sort((a, b) => b.n - a.n || cmpStr(a.hex, b.hex));
  const parsed = new Map(order.map((h) => [h.hex, parseColor(h.hex)]));
  const moved = new Set(); // hexes with a use that moves (auto, or answered to another colour): not merge targets
  const colorFate = new Map(); // hex -> { de1: {to, roles}, near: {to, de} }
  order.forEach((X, i) => {
    const cands = order.slice(0, i).filter((Y) => Y.alpha === X.alpha && !moved.has(Y.hex))
      .map((Y, j) => ({ Y, j, de: deltaE2000(parsed.get(X.hex), parsed.get(Y.hex)) }));
    const best = (list) => list.sort((a, b) => a.de - b.de || a.j - b.j)[0] || null;
    const fate = {};
    if (!X.named) {
      const d1 = best(cands.filter((c) => c.de < 1 && !c.Y.named && [...X.roles].some((r) => c.Y.roles.has(r))));
      if (d1) fate.de1 = { to: d1.Y.hex, roles: d1.Y.roles };
    }
    const near = best(cands.filter((c) => c.de < 3));
    if (near) fate.near = { to: near.Y.hex, de: near.de, named: X.named || near.Y.named };
    colorFate.set(X.hex, fate);
    const untok = colors.filter((u) => u.value === X.hex && !u.token);
    const autoMoves = fate.de1 && untok.some((u) => fate.de1.roles.has(u.role));
    const nearRest = fate.near && untok.some((u) => !(fate.de1 && fate.de1.roles.has(u.role)));
    const nearKey = nearRest ? `color|${X.hex}|${fate.near.to}` : null;
    const nearAnswer = nearKey ? answers[nearKey] : undefined;
    const nearMoves = nearKey && (nearAnswer !== undefined ? String(nearAnswer) === fate.near.to : answers[BULK.COLOR_NEAR] === 'accept-all');
    if (autoMoves || nearMoves) moved.add(X.hex);
  });
  for (const u of colors) {
    if (typeof u.value !== 'string') { unparsed++; continue; }
    if (u.token) { keep('TOKEN'); continue; }
    const fate = colorFate.get(u.value) || {};
    const base = { u, cat: 'color', role: u.role, prop: u.prop, from: u.value, node: nodeOf(u, true) };
    if (fate.de1 && fate.de1.roles.has(u.role)) { decide({ ...base, code: 'COLOR_DE1', target: fate.de1.to, auto: true }); continue; }
    if (fate.near) {
      const { to, de, named } = fate.near;
      const why = named ? ' (a named colour is involved)' : ' in another role';
      const key = ask(`color|${u.value}|${to}`, 'color', 'COLOR_NEAR',
        `${u.value} is ${de.toFixed(2)} ΔE from the more frequent ${to}${why}: merge it into ${to}?`, [to, u.value], to);
      decide({ ...base, code: 'COLOR_NEAR', target: to, qkey: key, bulk: BULK.COLOR_NEAR, keepOpt: u.value, map: (a) => String(a) });
      continue;
    }
    keep('IN_SCALE');
  }

  // ---------- project questions (R68) ----------
  for (const [key, b] of [...bulks].sort((x, y) => cmpStr(x[0], y[0]))) {
    const n = new Set(pending.filter((d) => d.bulk === key).map((d) => d.qkey)).size;
    ask(key, BULK_CAT[b.code], b.code, BULK_TEXT[b.code](n), ['accept-all', 'ask-each'], 'ask-each', false);
    const q = questions.get(key);
    q.project = true;
    for (const x of b.nodes) q.nodes.add(x);
  }

  // ---------- answers ----------
  const pick = (key, options) => {
    const a = answers[key];
    const opt = options.find((o) => String(o) === String(a));
    if (opt === undefined) throw new Error(`rules: answer ${JSON.stringify(a)} for "${key}" is not one of ${options.map((o) => JSON.stringify(o)).join(', ')}`);
    return opt;
  };
  for (const [key, q] of questions) if (key in answers) q.answered = pick(key, q.options);
  const roleAnswer = new Map();
  for (const [key, options] of roleKeys) if (key in answers) roleAnswer.set(key, pick(key, options));
  const stale = Object.keys(answers).filter((k) => !questions.has(k) && !roleKeys.has(k)).sort(cmpStr);
  // per-role key > group key > project key (accept-all) > none
  const resolve = (d) => {
    if (d.rkey && roleAnswer.has(d.rkey)) return { a: roleAnswer.get(d.rkey) };
    const q = questions.get(d.qkey);
    if (q.answered !== undefined) return { a: q.answered };
    if (d.bulk && questions.get(d.bulk).answered === 'accept-all') return { proposal: true };
    return null;
  };

  // ---------- group decisions into entries ----------
  const groups = new Map();
  for (const d of pending) {
    let status, to;
    if (d.auto) { status = 'auto'; to = d.target; } else {
      const q = questions.get(d.qkey);
      q.nodes.add(`${d.u.screen}|${d.u.node}`);
      if (q.roles) q.roles.add(d.role);
      const r = resolve(d);
      if (r === null) { status = 'ask'; to = d.from; q.open = true; } else if (r.proposal) {
        to = d.target;
        status = 'answered';
      } else {
        if (String(r.a) === String(d.keepOpt)) { keep(d.code); continue; }
        to = d.map(r.a);
        status = 'answered';
      }
    }
    const gk = JSON.stringify([d.cat, d.role, d.prop, d.from, d.code, d.target, status]);
    let g = groups.get(gk);
    if (!g) {
      g = { cat: d.cat, role: d.role, prop: d.prop, nodes: [], from: d.from, to, code: d.code, status };
      if (!d.auto) { g.proposal = d.target; g.question = d.qkey; }
      groups.set(gk, g);
    }
    if (!g.nodes.some((n) => n.screen === d.node.screen && n.node === d.node.node && n.run === d.node.run)) g.nodes.push(d.node);
  }
  const cmpNode = (a, b) => cmpStr(String(a.screen), String(b.screen)) || cmpNodeId(a.node, b.node) || (a.run ?? -1) - (b.run ?? -1);
  const entries = [...groups.values()].map((g) => ({ ...g, nodes: g.nodes.sort(cmpNode) }))
    .sort((a, b) => cmpStr(a.cat, b.cat) || cmpStr(a.prop, b.prop) || cmpStr(a.role, b.role) ||
      cmpStr(JSON.stringify(a.from), JSON.stringify(b.from)) || cmpStr(a.code, b.code) || cmpStr(JSON.stringify(a.to), JSON.stringify(b.to)));
  const ids = new Set();
  const out = entries.map((e) => {
    let id = fnv(`${e.cat}|${e.role}|${e.prop}|${e.from}`);
    if (ids.has(id)) id = fnv(`${e.cat}|${e.role}|${e.prop}|${e.from}|${e.code}|${e.proposal ?? e.to}|${e.status}`);
    ids.add(id);
    const o = { id, cat: e.cat, role: e.role, prop: e.prop, nodes: e.nodes, from: e.from, to: e.to, code: e.code, status: e.status };
    if (e.proposal !== undefined) { o.proposal = e.proposal; o.question = e.question; }
    return o;
  });

  const qs = [...questions.values()].sort((a, b) => cmpStr(a.key, b.key)).map((q) => {
    const text = typeof q.text === 'function' ? q.text(q) : q.text;
    const o = { key: q.key, cat: q.cat, code: q.code, text, options: q.options, default: q.default, affects: q.nodes.size };
    if (q.roles) o.roles = [...q.roles].sort(cmpStr);
    if (q.answered !== undefined) o.answered = q.answered;
    else if (!q.open && !q.project) o.resolved = true;
    return o;
  });
  const sortedCounts = Object.fromEntries(Object.keys(counts).sort(cmpStr).map((k) => [k, counts[k]]));
  return { entries: out, questions: qs, counts: sortedCounts, unparsed, stale };
}
