// design-system.html (plan 2, Task 8): the visual design-system proposal. One self-contained page (images inline as
// data URIs; the only external requests are Google Fonts for the font families of the type specimens, as in plan 1).
// Pure and deterministic: the same inputs give the same bytes except the `generated` string.
//
// renderDsReport({ tokens, entries, questions, coverage, counts?, samples?, crops?, title, generated }) -> HTML string
//  - tokens: buildTokens().tokens (DTCG, $extensions['vuong-design'] = { uses, nodes, screens, merged?, var?, ... }).
//  - entries / counts: normalize() entries and counts (counts = kept decisions per code, optional).
//  - questions: normalize() questions, plus coverage projectQuestions() (code PROJECT, the §8.4 confirmations).
//  - coverage: coverage() result { items, contrast, touch, summary, vars } (R79: vars gives one line on CSS variable
//    uses capture could not attribute, and that a colour behind a scoped variable is treated as named).
//  - samples: { [typography token path]: sample text } (typeSamples() builds it from the real text runs); missing ->
//    'Aa Bb 123 Tiếng Việt'.
//  - crops: [{ entry: entry id, src, norm }]: before / after images of a change, data URLs or file paths (a path is
//    read and inlined). The caller cuts them (report-html.mjs cutImages: source page vs the `norm` proxy).
// Order: verdict line; How to read (fixed); Questions (project questions of normalize first, then group questions by
// nodes affected, descending, then the §8.4 confirmations; each open question with its rules-file JSON; settled
// questions collapsed); Colours; Spacing (bars, and fixed sizes / border widths / opacity); Radius (boxes,
// radius.full drawn as a pill); Type (specimens); Shadows; Changes applied (auto / answered entries); Coverage.
// Every value is shown with its unit (px, %, ΔE, :1, nodes, uses); colours as hex and oklch(L C H). Value cells
// carry class "v" (tested: no bare number in them except inside hex / oklch / font weight / token names).
// Size (Planora: ~500 tokens, ~90 questions): role tokens sit in a collapsed <details> per category; the group
// questions are collapsed when there are more than 20 (the project questions above settle them); a change group with
// more than 30 rows is collapsed. A primitive whose value still waits for an answer (an `ask` entry's from) is tagged
// "question open".
//
// typeSamples({ inv, tokens, map, screens: [{ screen, spec }] }) -> { [primitive typography path]: text }: for each
// type use, the text of its run (spec runs[run].t, whole-node text when the run is missing), whitespace collapsed,
// 1-60 characters; its token path from map (role tokens followed to their primitive). A text of 2+ characters beats a
// single character (a badge digit); then the most frequent wins (tie: longer, then lexical).
//
// dsVerdict({ tokens, entries, questions, coverage }) -> the one-line verdict.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseColor, oklchOf } from './color.mjs';
import { rulesTemplate } from './rules-file.mjs';
import { useKey } from './tokens.mjs';

const VD = 'vuong-design';
const FALLBACK_SAMPLE = 'Aa Bb 123 Tiếng Việt';
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => String(r2(v));
const px = (v) => `${num(v)} px`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isOpen = (q) => q.answered === undefined && !q.resolved;

// ---------------- tokens ----------------

export function flattenTokens(tokens) {
  const out = [];
  const walk = (g, path) => {
    for (const k of Object.keys(g || {})) {
      if (k.startsWith('$')) continue;
      const v = g[k], p = [...path, k];
      if (v && typeof v === 'object' && '$value' in v) out.push({ path: p.join('.'), tier: p[0], $type: v.$type, $value: v.$value, $description: v.$description, ext: (v.$extensions && v.$extensions[VD]) || {} });
      else if (v && typeof v === 'object') walk(v, p);
    }
  };
  walk(tokens, []);
  return out;
}

const aliasOf = (v) => (typeof v === 'string' && /^\{[^{}]+\}$/.test(v) ? v.slice(1, -1) : null);
function indexTokens(tokens) {
  const list = flattenTokens(tokens);
  const byPath = new Map(list.map((t) => [t.path, t]));
  const resolve = (t) => {
    let x = t;
    for (let i = 0; i < 10 && x && aliasOf(x.$value); i++) x = byPath.get(aliasOf(x.$value));
    return x || null;
  };
  // category of a primitive: second segment, 'font.<x>' for font primitives
  const catOf = (t) => {
    const p = resolve(t);
    if (!p) return 'other';
    const s = p.path.split('.');
    return s[1] === 'font' ? `font.${s[2]}` : s[1];
  };
  return { list, byPath, resolve, catOf };
}

// ---------------- value formatting ----------------

function colorParts(css) {
  const c = typeof css === 'string' ? parseColor(css) : css;
  if (!c || c.unparsed !== undefined) return null;
  const o = oklchOf(c);
  const h = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  const hex = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  const a = c.a ?? 1;
  return { hex, alpha: a, css: a < 1 ? `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${r2(a)})` : hex,
    oklch: `oklch(${o.l.toFixed(2)} ${o.c.toFixed(3)} ${Math.round(o.h)})` };
}
const colorOfValue = (v) => (v && typeof v === 'object' && v.hex ? colorParts(v.alpha !== undefined ? `${v.hex}${Math.round(v.alpha * 255).toString(16).padStart(2, '0')}` : v.hex) : colorParts(String(v)));
const alphaText = (c) => (c.alpha < 1 ? ` at ${Math.round(c.alpha * 1000) / 10}% alpha` : '');
const chip = (c, cls = 'chip') => `<span class="${cls}${c.alpha < 1 ? ' alpha' : ''}"><i style="background:${esc(c.css)}"></i></span>`;
const colorText = (c) => `${c.hex}${alphaText(c)} · ${c.oklch}`;

const dimPx = (v) => (v && typeof v === 'object' && typeof v.value === 'number' ? v.value : typeof v === 'number' ? v : null);

// a token's resolved value as text with units (no HTML)
function valueText(t, ix) {
  const p = ix.resolve(t) || t;
  const cat = ix.catOf(t), v = p.$value;
  if (p.$type === 'color') { const c = colorOfValue(v); return c ? colorText(c) : String(v); }
  if (p.$type === 'dimension') return px(dimPx(v));
  if (cat === 'opacity') return `${r2(v * 100)}%`;
  if (p.$type === 'fontWeight') return `weight ${v}`;
  if (p.$type === 'fontFamily') return String(v);
  if (p.$type === 'shadow') return shadowText(v);
  if (p.$type === 'typography') return typeText(p, ix);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function shadowText(v) {
  const one = (s) => {
    const c = colorOfValue(s.color);
    return `${s.inset ? 'inset, ' : ''}x ${px(dimPx(s.offsetX))}, y ${px(dimPx(s.offsetY))}, blur ${px(dimPx(s.blur))}, spread ${px(dimPx(s.spread))}, ${c ? `${c.hex}${alphaText(c)}` : ''}`;
  };
  if (typeof v === 'string') return v;
  const layers = Array.isArray(v) ? v : [v];
  return layers.length === 1 ? one(layers[0]) : layers.map((l, i) => `layer ${i + 1}: ${one(l)}`).join('\n');
}
function shadowCss(v, ext) {
  if (typeof v === 'string') return ext.raw || v;
  return (Array.isArray(v) ? v : [v]).map((s) => {
    const c = colorOfValue(s.color);
    return `${s.inset ? 'inset ' : ''}${dimPx(s.offsetX)}px ${dimPx(s.offsetY)}px ${dimPx(s.blur)}px ${dimPx(s.spread)}px ${c ? c.css : '#000'}`;
  }).join(', ');
}

// typography primitive -> { family, size, weight, lineHeight (px), letterSpacing (px), style, transform }
function typeParts(p, ix) {
  const v = p.$value || {};
  const get = (x) => { const t = aliasOf(x) ? ix.byPath.get(aliasOf(x)) : null; return t ? t.$value : x; };
  const size = dimPx(get(v.fontSize));
  return {
    family: get(v.fontFamily), size, weight: get(v.fontWeight), letterSpacing: dimPx(get(v.letterSpacing)) ?? 0,
    lineHeight: p.ext.lineHeightPx ?? (typeof v.lineHeight === 'number' && size ? r2(v.lineHeight * size) : null),
    style: p.ext.fontStyle || 'normal', transform: p.ext.textTransform || 'none',
  };
}
function typeText(p, ix) {
  const t = typeParts(p, ix);
  return `${t.family} · ${px(t.size)} / ${px(t.lineHeight)} · weight ${t.weight} · letter spacing ${px(t.letterSpacing)}` +
    (t.style !== 'normal' ? ` · ${t.style}` : '') + (t.transform !== 'none' ? ` · ${t.transform}` : '');
}

const usesText = (ext) => {
  const sc = Array.isArray(ext.screens) ? ext.screens.length : 0;
  return `${plural(ext.uses || 0, 'use')} · ${plural(ext.nodes || 0, 'node')} · ${plural(sc, 'screen')}`;
};
const shortName = (path) => path.split('.').slice(1).join('.');

// entry value (from / to / proposal) as HTML with units
function entryValue(e, v) {
  if (e.cat === 'color') { const c = colorParts(String(v)); return c ? `${chip(c)}${esc(c.hex)}${esc(alphaText(c))}` : esc(v); }
  if (typeof v === 'number') return esc(px(v));
  return esc(v);
}

// a role key `cat|prop|sig|parent` in words
function roleWords(role) {
  const [, prop, sig, parent] = String(role).split('|');
  return `${prop} on ${sig || 'root'}${parent ? ` in ${parent}` : ''}`;
}

// ---------------- verdict ----------------

export function dsVerdict({ tokens, entries = [], questions = [], coverage }) {
  const ix = indexTokens(tokens || {});
  const prims = ix.list.filter((t) => t.tier === 'primitive');
  const roles = ix.list.filter((t) => t.tier === 'role');
  const merged = prims.reduce((a, t) => a + (Array.isArray(t.ext.merged) ? t.ext.merged.length : 0), 0);
  const applied = entries.filter((e) => e.status === 'auto' || e.status === 'answered').length;
  const open = questions.filter((q) => q.code !== 'PROJECT' && isOpen(q)).length;
  const confirm = questions.filter((q) => q.code === 'PROJECT' && isOpen(q)).length;
  const s = (coverage && coverage.summary) || { total: 0, covered: 0, answered: 0 };
  return `${prims.length + merged} distinct values → ${plural(prims.length, 'primitive token')} (+ ${plural(roles.length, 'role token')}); ` +
    `${plural(applied, 'change')} applied, ${plural(open, 'question')} open${confirm ? ` (+ ${plural(confirm, 'project confirmation')})` : ''}, ` +
    `coverage ${s.covered + s.answered}/${s.total} items.`;
}

// ---------------- how to read ----------------

const HOWTO = `<details class="howto" open><summary><strong>How to read this page</strong></summary>
<ul>
<li><b>Tokens</b> are named design values, in three tiers. <b>primitive</b>: every value the screens use after normalisation (colours, spacing, sizes and radii in px, type styles), named by value (<code>space.12</code>, <code>color.c01</code> = the most used colour). <b>role</b>: a name for what a value is for (<code>role.text-muted</code> → <code>primitive.color.c03</code>); one role groups the elements with the same structure (same tag and classes inside the same kind of parent), and a CSS variable of the source keeps its own name. <b>component</b>: empty for now (filled when Figma components are made).</li>
<li>Every value was checked by fixed rules, each decision has a reason code. Its status: <b>auto</b> = changed by a rule without asking (only a colour the eye cannot tell apart, ΔE2000 below 1, in the same role; a size, a space or a font size is never changed without your answer, and every question keeps the value by default); <b>ask</b> = a proposal that needs your answer, not applied; <b>answered</b> = applied from your answer; <b>kept</b> = already fine (on the 4 px grid, named by a CSS variable, flexible, a pill) and left as it is (only counted).</li>
<li><b>How to answer on this page</b>: pick an option (or type a free answer) under each question you want to settle, then press <b>Submit</b> in the bar at the bottom. Opened with <code>node core/answer.mjs --out &lt;this folder&gt;</code>, Submit merges your answers into the rules file (<code>vd-rules.json</code>, a backup is kept); opened as a plain file, Submit downloads the merged <code>vd-rules.json</code> to save over the old one. Questions you leave blank stay open. Then re-run.</li>
<li><b>How to answer by hand</b>: copy the JSON under a question into <code>vd-rules.json</code> at the project root (one file for all answers: keep <code>"version": 1</code> and put every answer inside the one <code>"answers"</code> object), then re-run. The draft at the end of the Questions section answers every open question with its proposal in one file. Project questions (<code>accept-all</code>) settle a whole kind of question at once; answer <code>ask-each</code> to decide one by one.</li>
<li><b>Nothing changes until you answer.</b> An open question keeps the original value in the spec and in the tokens; a question you never answer is never applied.</li>
<li>Units: <b>px</b> = CSS pixels; <b>ΔE</b> = CIEDE2000 colour difference (below 1 invisible, below 3 hard to see); <b>N:1</b> = WCAG contrast ratio (AA needs 4.5:1, large text 3:1); <b>nodes</b> = elements on the screens; <b>uses</b> = single property uses (one node can use a value several times). Colours: hex and <code>oklch(lightness chroma hue)</code>.</li>
<li>Images under a change: the <b>left</b> one is the source page, the <b>right</b> one the normalised rebuild.</li>
</ul></details>`;

// ---------------- sections ----------------

const CODE_SENTENCE = {
  ROLE_MAJORITY: 'Most elements in the same role use the new value; your answer made this one follow them (a slip, not a variant).',
  GRID4: 'The value was off the 4 px grid; your answer moved it to the grid value.',
  COLOR_DE1: 'The colour cannot be told apart (ΔE2000 below 1) from a more frequent colour in the same role, so they were merged.',
  COLOR_NEAR: 'The colour is close (ΔE2000 below 3) to a more frequent colour; your answer merged them.',
  TYPE_SCALE: 'The font size was outside the type scale; your answer moved it to the nearest scale size.',
  LINE_HEIGHT_INT: 'The line height was a fraction of a pixel; your answer rounded it to whole px.',
  ICON_FRAME: 'The icon was not on a 16, 20 or 24 px frame; your answer moved it to the nearest frame.',
  SRC_SQUASH: 'The icon or image was squashed by the layout at one width; your answer keeps its declared size at both widths.',
};
const KEPT_SENTENCE = {
  IN_SCALE: 'already on the scale', TOKEN: 'named by a CSS variable', FLEX: 'flexible (fill, hug, space-between)',
  NOISE: 'sub-pixel measuring noise (under 0.5 px), ignored', PILL: 'pill radii (half the smaller side or more)',
  ILLUSTRATION: 'illustrations (svg over 32 px), not icons', GRID4: 'off-grid values you chose to keep', COLOR_NEAR: 'near colours you chose to keep',
  TYPE_SCALE: 'font sizes you chose to keep', LINE_HEIGHT_INT: 'line heights you chose to keep', ICON_FRAME: 'icon sizes you chose to keep',
  SRC_SQUASH: 'squashed sizes you chose to keep',
  DERIVED: 'paddings and gaps the layout produced, not written in the CSS (centring, auto margins, absolute children)',
  BORDER_INSET: 'paddings that hold a border (CSS padding on the 4 px grid + border width)',
  HAIRLINE: 'hairline sizes (a width or height of 2 px or less: rules, dividers)',
};

function fmtOption(q, o) {
  if (q.code === 'COLOR_NEAR') { const c = colorParts(String(o)); if (c) return `${chip(c)}${esc(c.hex)}`; }
  if (typeof o === 'number') return esc(px(o));
  return esc(o);
}

function questionCard(q, kind) {
  const nodesLabel = kind === 'project' ? `settles ${plural(q.affects, 'node')}` : kind === 'group' ? `affects ${plural(q.affects, 'node')}` : `applies to ${plural(q.affects, 'screen')}`;
  const opts = Array.isArray(q.options)
    ? `<div class="opts">Options: ${q.options.map((o) => `<label class="v opt${String(o) === String(q.default) ? ' def' : ''}"><input type="radio" name="${esc(q.key)}" value="${esc(JSON.stringify(o))}">${fmtOption(q, o)}${String(o) === String(q.default) ? ' (default)' : ''}</label>`).join(' ')}</div>`
    : `<div class="opts">Free answer. Proposed: <span class="v opt def">${esc(q.default)}</span> <input type="text" class="free" name="${esc(q.key)}" placeholder="${esc(q.default)}" aria-label="your answer"></div>`;
  const roles = Array.isArray(q.roles) && q.roles.length
    ? (q.roles.length <= 3 ? `<p class="muted small">Where: ${q.roles.map((r) => `<code>${esc(roleWords(r))}</code>`).join(', ')}</p>`
      : `<details class="small"><summary>Where: ${plural(q.roles.length, 'role')}</summary><ul>${q.roles.map((r) => `<li><code>${esc(roleWords(r))}</code></li>`).join('')}</ul></details>`)
    : '';
  // one line: a whole rules file holding this one answer
  const json = `{"version": 1, "answers": {${JSON.stringify(q.key)}: ${JSON.stringify(q.default)}}}`;
  return `<div class="q" data-kind="${kind}" data-key="${esc(q.key)}" data-affects="${Number(q.affects) || 0}" data-default="${esc(JSON.stringify(q.default))}">` +
    `<div class="qhead"><span class="code">${esc(q.code)}</span> <code>${esc(q.key)}</code> <span class="v count">${esc(nodesLabel)}</span></div>` +
    `<p class="qtext">${esc(q.text)}</p>${opts}${roles}<details class="small qjson"><summary>JSON for the rules file</summary><pre class="json">${esc(json)}</pre></details></div>`;
}

function renderQuestions(questions) {
  const kindOf = (q) => (q.code === 'PROJECT' ? 'confirm' : String(q.key).startsWith('project.') ? 'project' : 'group');
  const byAffects = (a, b) => (b.affects || 0) - (a.affects || 0) || cmpStr(a.key, b.key);
  const open = questions.filter(isOpen);
  const proj = open.filter((q) => kindOf(q) === 'project').sort(byAffects);
  const group = open.filter((q) => kindOf(q) === 'group').sort(byAffects);
  const confirm = open.filter((q) => kindOf(q) === 'confirm').sort((a, b) => cmpStr(a.key, b.key));
  const settled = questions.filter((q) => !isOpen(q)).sort((a, b) => cmpStr(a.key, b.key));
  const parts = [`<section id="questions"><h2>Questions <span class="muted">(${plural(proj.length + group.length, 'open question')}${confirm.length ? `, ${plural(confirm.length, 'project confirmation')}` : ''})</span></h2>`];
  if (!open.length) parts.push('<p>No open questions.</p>');
  if (proj.length) parts.push(`<h3>Project questions</h3><p class="muted">One answer settles every question of its kind. Answer these first.</p>${proj.map((q) => questionCard(q, 'project')).join('')}`);
  if (group.length) parts.push(`<details class="qgroup"${group.length <= 20 ? ' open' : ''}><summary><h3>One value at a time (${group.length})</h3> <span class="muted small">${group.length > 20 ? 'click to expand' : ''}</span></summary><p class="muted">Sorted by the number of nodes each answer affects. A project answer above (<code>accept-all</code>) settles these too.</p>${group.map((q) => questionCard(q, 'group')).join('')}</details>`);
  if (confirm.length) parts.push(`<details class="qgroup"><summary><h3>Project confirmations (${confirm.length})</h3></summary><p class="muted">Proposed from the screens; they change nothing in the spec. Confirm or correct them the same way.</p>${confirm.map((q) => questionCard(q, 'confirm')).join('')}</details>`);
  // R97: an answer that failing findings name (ds afterFile sets q.breaks): first, so it is changed, not approved
  const breaks = (q) => (q.breaks ? ` <b class="breaks">named by ${plural(q.breaks.findings, 'failing finding')} on ${esc(q.breaks.screens.join(', '))}: change this answer</b>` : '');
  const broken = questions.filter((q) => q.breaks);
  if (broken.length) parts.splice(1, 0, `<div class="breaks-box"><b>${plural(broken.length, 'answer')} spoil the layout.</b> The layout report names them as the cause of failing findings. Answer the question again with the value kept (the default), then run ds again:<ul>${broken.map((q) => `<li><code>${esc(q.key)}</code> = ${esc(JSON.stringify(q.answered))}${breaks(q)}</li>`).join('')}</ul></div>`);
  if (settled.length) {
    parts.push(`<details${broken.length ? ' open' : ''}><summary>Already settled (${settled.length})</summary><ul>${settled.map((q) => `<li><code>${esc(q.key)}</code>: ${q.answered !== undefined ? `answered ${esc(JSON.stringify(q.answered))}` : 'settled by a project or per-role answer'}${breaks(q)}</li>`).join('')}</ul></details>`);
  }
  if (open.length) {
    parts.push(`<details><summary>All open questions in one <code>vd-rules.json</code> draft</summary><p class="muted">Every question answered with its default (the value kept; project questions stay <code>ask-each</code>). Edit, then save as <code>vd-rules.json</code> at the project root.</p><pre class="json-all">${esc(JSON.stringify(rulesTemplate(open), null, 2))}</pre></details>`);
  }
  parts.push('</section>');
  return parts.join('\n');
}

function roleTable(roles, ix, sample) {
  if (!roles.length) return '';
  const rows = roles.map((t) => {
    const p = ix.resolve(t);
    return `<tr><td><code>${esc(shortName(t.path))}</code>${t.ext.var ? ` <span class="muted small">(${esc(t.ext.var)})</span>` : ''}</td><td>${sample(t, p)}</td>` +
      `<td class="v">${esc(valueText(t, ix))}</td><td><code>${esc(p ? shortName(p.path) : '?')}</code></td><td class="v">${esc(usesText(t.ext))}</td></tr>`;
  }).join('');
  return `<details class="roles"><summary>Role tokens (${roles.length})</summary><div class="wrap"><table><tr><th>role token</th><th>sample</th><th>value</th><th>primitive</th><th>used by</th></tr>${rows}</table></div></details>`;
}
const rolesOf = (ix, cats) => ix.list.filter((t) => t.tier === 'role' && cats.includes(ix.catOf(t)))
  .sort((a, b) => (b.ext.uses || 0) - (a.ext.uses || 0) || cmpStr(a.path, b.path));
// primitives of a category in display order: numbers ascending (radius.full last; JS objects list integer-like keys
// first, so the token order cannot be used), typography by size, weight, line height; colours and the rest as built
const numOf = (t) => (t.path.endsWith('.full') ? Infinity : typeof t.$value === 'number' ? t.$value : dimPx(t.$value) ?? 0);
function primsOf(ix, cat) {
  const list = ix.list.filter((t) => t.tier === 'primitive' && ix.catOf(t) === cat);
  if (cat === 'typography') {
    const k = (t) => { const p = typeParts(t, ix); return [p.size ?? 0, Number(p.weight) || 0, p.lineHeight ?? 0]; };
    return list.sort((a, b) => { const x = k(a), y = k(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || cmpStr(a.path, b.path); });
  }
  if (['space', 'size', 'radius', 'border', 'opacity', 'font.size', 'font.weight', 'font.lineHeight', 'font.letterSpacing'].includes(cat)) {
    return list.sort((a, b) => numOf(a) - numOf(b) || cmpStr(a.path, b.path));
  }
  return list;
}
// "question open" tag: a primitive value that is the `from` of an entry still waiting for an answer
const OPEN_TAG = '<span class="tag">question open</span>';
function openSet(entries) {
  const s = new Set();
  for (const e of entries || []) {
    if (e.status !== 'ask') continue;
    if (e.cat === 'color') s.add(`color|${String(e.from).toLowerCase()}`);
    else if (typeof e.from === 'number') s.add(`${e.cat === 'icon' ? 'size' : e.cat}|${r2(e.from)}`);
  }
  return s;
}
const colorKey = (c) => `color|${c.hex}${c.alpha < 1 ? Math.round(c.alpha * 255).toString(16).padStart(2, '0') : ''}`;
const isOpenValue = (ix, cat, t) => (cat === 'color' ? (() => { const c = colorOfValue(t.$value); return !!c && ix.open.has(colorKey(c)); })() : ix.open.has(`${cat}|${r2(numOf(t))}`));

function renderColours(ix) {
  const prims = primsOf(ix, 'color');
  const cards = prims.map((t) => {
    const c = colorOfValue(t.$value);
    const merged = Array.isArray(t.ext.merged) && t.ext.merged.length
      ? `<div class="v small">merged in: ${t.ext.merged.map((m) => { const mc = colorParts(String(m.from)); return `${mc ? chip(mc, 'chip sm') : ''}${esc(mc ? mc.hex : m.from)} (${esc(m.code)}, ${plural(m.uses, 'use')})`; }).join(', ')}</div>` : '';
    return `<div class="swatch"><div class="sw${c && c.alpha < 1 ? ' alpha' : ''}"><i style="background:${esc(c ? c.css : 'transparent')}"></i></div>` +
      `<div class="name"><code>${esc(shortName(t.path))}</code>${isOpenValue(ix, 'color', t) ? ` ${OPEN_TAG}` : ''}</div><div class="v">${esc(c ? c.hex : t.$value)}${esc(c ? alphaText(c) : '')}</div>` +
      `<div class="v small">${esc(c ? c.oklch : '')}</div><div class="v small muted">${esc(usesText(t.ext))}</div>${merged}</div>`;
  }).join('');
  const sample = (t, p) => { const c = p && colorOfValue(p.$value); return c ? chip(c) : ''; };
  return `<section id="colours"><h2>Colours <span class="muted">(${plural(prims.length, 'primitive')})</span></h2><div class="swatches">${cards}</div>${roleTable(rolesOf(ix, ['color']), ix, sample)}</section>`;
}

function barRows(prims, kind, ix) {
  return prims.map((t) => {
    const v = kind === 'opacity' ? t.$value : dimPx(t.$value);
    const vis = kind === 'opacity'
      ? `<span class="op"><i style="opacity:${esc(v)}"></i></span>`
      : kind === 'border' ? `<span class="line" style="height:${esc(Math.max(1, v))}px"></span>`
        : `<span class="bar" style="width:${esc(Math.max(1, v))}px"></span>`;
    const val = kind === 'opacity' ? `${r2(v * 100)}%` : px(v);
    return `<tr><td><code>${esc(shortName(t.path))}</code>${isOpenValue(ix, kind, t) ? ` ${OPEN_TAG}` : ''}<div class="v small muted">${esc(usesText(t.ext))}</div></td><td class="v nw">${esc(val)}</td><td class="vis">${vis}</td></tr>`;
  }).join('');
}
function renderSpacing(ix) {
  const sect = (cat, title, note) => {
    const prims = primsOf(ix, cat);
    if (!prims.length) return '';
    return `<h3>${title} <span class="muted">(${plural(prims.length, 'token')})</span></h3>${note ? `<p class="muted small">${note}</p>` : ''}` +
      `<div class="wrap"><table class="bars"><tr><th>token, used by</th><th>value</th><th>drawn at 1:1</th></tr>${barRows(prims, cat, ix)}</table></div>`;
  };
  const sample = () => '';
  return `<section id="spacing"><h2>Spacing and sizes</h2>${sect('space', 'Spacing (padding, gap)', 'Bars are drawn at the real size in CSS px.')}` +
    `${roleTable(rolesOf(ix, ['space']), ix, sample)}` +
    `<details class="more"><summary>Fixed sizes, border widths and opacity</summary>${sect('size', 'Fixed sizes (frames, images, icons)')}${sect('border', 'Border widths')}${sect('opacity', 'Opacity')}` +
    `${roleTable(rolesOf(ix, ['size', 'border', 'opacity']), ix, sample)}</details></section>`;
}

function renderRadius(ix) {
  const prims = primsOf(ix, 'radius');
  const boxes = prims.map((t) => {
    const full = t.path.endsWith('.full');
    const v = dimPx(t.$value);
    const side = Math.min(120, Math.max(56, Math.ceil(v * 3))); // the box stays larger than twice the radius, so the corner reads true
    return `<div class="rcell"><div class="radius-box${full ? ' pill' : ''}" style="border-radius:${full ? '9999px' : `${esc(v)}px;width:${side}px;height:${side}px`}"></div>` +
      `<div class="name"><code>${esc(shortName(t.path))}</code>${!full && isOpenValue(ix, 'radius', t) ? ` ${OPEN_TAG}` : ''}</div><div class="v">${full ? 'full (pill: half the smaller side or more)' : esc(px(v))}</div><div class="v small muted">${esc(usesText(t.ext))}</div></div>`;
  }).join('');
  return `<section id="radius"><h2>Radius <span class="muted">(${plural(prims.length, 'token')})</span></h2><div class="radii">${boxes || '<p>No radius in the source.</p>'}</div>${roleTable(rolesOf(ix, ['radius']), ix, () => '')}</section>`;
}

function renderType(ix, samples) {
  const prims = primsOf(ix, 'typography');
  const cards = prims.map((t) => {
    const p = typeParts(t, ix);
    const style = `font-family:'${esc(String(p.family).replace(/'/g, ''))}',system-ui,sans-serif;font-size:${esc(p.size)}px;font-weight:${esc(p.weight)};line-height:${esc(p.lineHeight)}px;` +
      `letter-spacing:${esc(p.letterSpacing)}px;font-style:${esc(p.style)};text-transform:${esc(p.transform)}`;
    return `<div class="spec"><div class="sample" style="${style}">${esc(samples[t.path] || FALLBACK_SAMPLE)}</div>` +
      `<div class="meta"><code>${esc(shortName(t.path))}</code> <span class="v">${esc(typeText(t, ix))}</span> <span class="v muted">${esc(usesText(t.ext))}</span></div></div>`;
  }).join('');
  const fonts = ['family', 'size', 'weight', 'lineHeight', 'letterSpacing'].map((k) => {
    const list = primsOf(ix, `font.${k}`);
    if (!list.length) return '';
    return `<tr><td>${esc(k === 'lineHeight' ? 'line height' : k === 'letterSpacing' ? 'letter spacing' : k)}</td><td class="v">${list.map((t) => esc(valueText(t, ix))).join(', ')}</td></tr>`;
  }).join('');
  return `<section id="type"><h2>Type <span class="muted">(${plural(prims.length, 'style')})</span></h2><p class="muted small">Sample text is taken from the screens; the font is the one used in Figma.</p>` +
    `<div class="specs">${cards}</div><details class="more"><summary>Font primitives</summary><table>${fonts}</table></details>${roleTable(rolesOf(ix, ['typography']), ix, () => '')}</section>`;
}

function renderShadows(ix) {
  const prims = primsOf(ix, 'shadow');
  const cards = prims.map((t) => `<div class="shcell"><div class="shbox" style="box-shadow:${esc(shadowCss(t.$value, t.ext))}"></div>` +
    `<div class="name"><code>${esc(shortName(t.path))}</code></div><div class="v small">${esc(shadowText(t.$value))}</div><div class="v small muted">${esc(usesText(t.ext))}</div></div>`).join('');
  return `<section id="shadows"><h2>Shadows <span class="muted">(${plural(prims.length, 'token')})</span></h2>${prims.length ? `<div class="shadows">${cards}</div>` : '<p>No shadows in the source.</p>'}${roleTable(rolesOf(ix, ['shadow']), ix, () => '')}</section>`;
}

const imgSrc = (s) => {
  if (!s) return null;
  if (String(s).startsWith('data:')) return s;
  const ext = extname(String(s)).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${readFileSync(s).toString('base64')}`;
};

function renderChanges(entries, counts, crops) {
  const applied = entries.filter((e) => e.status === 'auto' || e.status === 'answered');
  const cropOf = new Map();
  for (const c of crops || []) if (c && c.entry) cropOf.set(c.entry, c);
  const codes = [...new Set(applied.map((e) => e.code))].sort(cmpStr);
  const parts = [`<section id="changes"><h2>Changes applied <span class="muted">(${plural(applied.length, 'change')})</span></h2>`];
  if (!applied.length) parts.push('<p>No value was changed: every value is kept or waits for an answer.</p>');
  for (const code of codes) {
    const list = applied.filter((e) => e.code === code).sort((a, b) => b.nodes.length - a.nodes.length || cmpStr(a.id, b.id));
    const rows = list.map((e) => {
      const c = cropOf.get(e.id);
      const pair = c ? `<tr class="crop"><td colspan="3"><div class="pair"><figure><img src="${esc(imgSrc(c.src))}" alt="source ${esc(e.id)}"><figcaption>source page</figcaption></figure>` +
        `<figure><img src="${esc(imgSrc(c.norm))}" alt="normalised ${esc(e.id)}"><figcaption>normalised rebuild</figcaption></figure></div></td></tr>` : '';
      return `<tr id="e-${esc(e.id)}"><td>${esc(e.cat)} <code>${esc(e.prop)}</code><div class="muted small">${esc(roleWords(e.role))} · entry <code>${esc(e.id)}</code></div></td>` +
        `<td class="v"><span class="nw">${entryValue(e, e.from)} →</span> <span class="nw">${entryValue(e, e.to)}</span></td><td><span class="v nw">${esc(plural(e.nodes.length, 'node'))}</span><div class="muted small">${esc(e.status)}</div></td></tr>${pair}`;
    }).join('');
    parts.push(`<details class="code-group"${list.length <= 30 ? ' open' : ''}><summary><h3><span class="code">${esc(code)}</span> ${plural(list.length, 'change')}</h3></summary>` +
      `<p>${esc(CODE_SENTENCE[code] || code)}</p><div class="wrap"><table><tr><th>property (where, entry)</th><th>old → new</th><th>nodes, status</th></tr>${rows}</table></div></details>`);
  }
  const kept = Object.entries(counts || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]));
  if (kept.length) {
    parts.push(`<p class="muted">Kept as they are: ${kept.map(([k, n]) => `<span class="v">${esc(plural(n, 'decision'))}</span> ${esc(KEPT_SENTENCE[k] || k)} (<code>${esc(k)}</code>)`).join('; ')}.</p>`);
  }
  parts.push('</section>');
  return parts.join('\n');
}

// R79: what capture could not attribute to a CSS variable, and what that means for the colours
function varsLine(v) {
  if (!v) return '';
  const named = 'A colour whose variable has another value in its scope (a scoped override such as .dark { --fg: ... }) is treated as named: it is never merged without an answer.';
  if (!v.complex && !v.unreadable) return `<p class="muted">Every CSS variable use was attributed. ${esc(named)}</p>`;
  const parts = [];
  if (v.complex) parts.push(`${plural(v.complex, 'CSS variable use')} could not be attributed (var() inside a function or with a fallback): those values count as unnamed, so check their merges under Changes.`);
  if (v.unreadable) parts.push(`${plural(v.unreadable, 'stylesheet')} could not be read: its variables are not known.`);
  return `<p class="v">${esc([...parts, named].join(' '))}</p>`;
}

function renderCoverage(cov) {
  if (!cov) return '<section id="coverage"><h2>Coverage</h2><p>Not measured.</p></section>';
  const s = cov.summary;
  const groups = [...new Set(cov.items.map((i) => i.group))];
  const badge = (st) => `<span class="badge ${esc(st)}">${esc(st)}</span>`;
  const groupHtml = groups.map((g) => {
    const RANK = { covered: 0, answered: 1, missing: 2 };
    const items = cov.items.filter((i) => i.group === g).map((i, k) => [i, k]).sort((a, b) => RANK[a[0].state] - RANK[b[0].state] || a[1] - b[1]).map(([i]) => i);
    const miss = items.filter((i) => i.state === 'missing').length;
    return `<details class="cov"${miss ? ' open' : ''}><summary><b>${esc(g.charAt(0).toUpperCase() + g.slice(1))}</b> <span class="v muted">${esc(`covered or answered: ${plural(items.length - miss, 'item')}; missing: ${plural(miss, 'item')}`)}</span></summary>` +
      `<ul>${items.map((i) => `<li>${badge(i.state)} ${esc(i.label)} <span class="muted small">(${esc(i.tag)}) ${esc(i.evidence)}</span></li>`).join('')}</ul></details>`;
  }).join('');
  const contrast = cov.contrast || [], touch = cov.touch || [];
  const cRows = contrast.map((c) => {
    const fg = colorParts(c.color), bg = colorParts(c.bg);
    return `<tr><td>${esc(c.screen)}</td><td><code>${esc(c.node)}</code> ${esc(c.text)}</td><td class="v">${fg ? chip(fg) : ''}${esc(c.color)} on ${bg ? chip(bg) : ''}${esc(c.bg)}</td>` +
      `<td class="v">${esc(c.ratioText)}</td><td class="v">${esc(c.required)}</td><td class="v">${esc(c.fontSize ? c.fontSize.replace(/px$/, ' px') : '')}</td></tr>`;
  }).join('');
  const tRows = touch.map((t) => `<tr><td>${esc(t.screen)}</td><td><code>${esc(t.node)}</code></td><td>${esc(t.tag)}</td><td class="v">${esc(t.size)}</td></tr>`).join('');
  return `<section id="coverage"><h2>Coverage <span class="muted">(${s.covered + s.answered}/${s.total} items covered or answered)</span></h2>` +
    `<p class="muted">What a complete design system needs, checked against the source. Missing items are not errors: they are what to add or decide next.</p>${varsLine(cov.vars)}${groupHtml}` +
    `<h3>Contrast below WCAG AA (${contrast.length})</h3>` +
    (contrast.length ? `<details${contrast.length <= 20 ? ' open' : ''}><summary>${plural(contrast.length, 'text colour')} below 4.5:1 (large text 3:1); nothing is changed automatically</summary><div class="wrap"><table><tr><th>screen</th><th>node</th><th>text on background</th><th>ratio</th><th>needed</th><th>font size</th></tr>${cRows}</table></div></details>` : '<p>Every text colour meets WCAG AA.</p>') +
    `<h3>Touch targets under 44×44 px (${touch.length})</h3>` +
    (touch.length ? `<details${touch.length <= 20 ? ' open' : ''}><summary>${plural(touch.length, 'interactive element')} smaller than 44×44 px</summary><div class="wrap"><table><tr><th>screen</th><th>node</th><th>tag</th><th>size</th></tr>${tRows}</table></div></details>` : '<p>No interactive element is smaller than 44×44 px.</p>') +
    '</section>';
}

// Google Fonts for the specimen families (icon fonts excluded)
function fontLinks(ix) {
  const fams = new Map();
  for (const t of primsOf(ix, 'typography')) {
    const p = typeParts(t, ix);
    if (!p.family || /icon|symbol/i.test(p.family)) continue;
    const set = fams.get(p.family) || new Set();
    set.add(`${p.style === 'italic' ? 1 : 0},${p.weight}`);
    fams.set(p.family, set);
  }
  return [...fams].sort((a, b) => cmpStr(a[0], b[0])).map(([fam, set]) => {
    const tuples = [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(';');
    return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:ital,wght@${tuples}&amp;display=swap">`;
  }).join('\n');
}

const CSS = `
:root{--bg:#fafafa;--fg:#1b1b1b;--muted:#666;--line:#ddd;--card:#fff;--accent:#3b6fd8;--code:#f0f0f0;--ok:#1b7f3b;--miss:#b3261e;--ans:#7a5c00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#343434;--card:#1f1f1f;--accent:#7aa2ff;--code:#2a2a2a;--ok:#5cc27a;--miss:#ff8a80;--ans:#e0c060}}
:root[data-theme="dark"]{--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#343434;--card:#1f1f1f;--accent:#7aa2ff;--code:#2a2a2a;--ok:#5cc27a;--miss:#ff8a80;--ans:#e0c060}
*{box-sizing:border-box}
body{margin:0 auto;max-width:1180px;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:0 0 8px}h3{font-size:15px;margin:14px 0 6px;display:inline-block}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:16px 0}
.muted{color:var(--muted)}.small{font-size:12px}code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}
.verdict{font-weight:600;font-size:15px;margin:4px 0 8px}
nav.toc{font-size:13px;display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0}nav.toc a{color:var(--accent)}
table{border-collapse:collapse;margin:6px 0;width:100%}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}th{font-weight:600;font-size:12px;color:var(--muted)}
.wrap{overflow-x:auto}
details>summary{cursor:pointer;margin:8px 0 4px}
.howto{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 14px;margin:10px 0}.howto ul{margin:6px 0;padding-left:20px}.howto li{margin:3px 0}
.chip{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:4px;overflow:hidden;position:relative}
.chip i,.sw i{position:absolute;inset:0}.chip.sm{width:11px;height:11px}
.alpha{background-image:linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%);background-size:8px 8px;background-position:0 0,4px 4px}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.swatch{border:1px solid var(--line);border-radius:8px;padding:6px;font-size:13px;min-width:0}
.sw{height:56px;border-radius:6px;border:1px solid var(--line);position:relative;overflow:hidden;margin-bottom:4px}
.swatch .name,.rcell .name,.shcell .name{margin:2px 0}
table.bars td.vis{width:60%;overflow:hidden;max-width:0}.nw{white-space:nowrap}.bar{display:inline-block;height:12px;background:var(--accent);border-radius:2px;max-width:100%}
.line{display:inline-block;width:120px;background:var(--fg);vertical-align:middle}
.op{display:inline-block;width:40px;height:20px;border:1px solid var(--line);border-radius:4px;position:relative;overflow:hidden}.op i{position:absolute;inset:0;background:var(--accent)}
.radii{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}
.rcell{font-size:13px;min-width:0}.radius-box{width:64px;height:64px;background:var(--code);border:2px solid var(--accent);margin-bottom:4px}.radius-box.pill{width:110px;height:40px}
.specs{display:flex;flex-direction:column;gap:2px}
.spec{border-bottom:1px solid var(--line);padding:8px 0;min-width:0}.spec .sample{overflow-wrap:anywhere}.spec .meta{font-size:12px;margin-top:2px;display:flex;flex-wrap:wrap;gap:4px 10px}
.shadows{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}
.shcell{font-size:13px;min-width:0}.shcell .v{white-space:pre-line}.shbox{height:64px;border-radius:8px;background:#fff;border:1px solid var(--line);margin:8px 8px 14px}
.q{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:8px 0;min-width:0}
.qhead{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}.qhead .count{margin-left:auto;font-size:12px;color:var(--muted)}
.qtext{margin:4px 0}
.tag{display:inline-block;font-size:11px;padding:0 5px;border-radius:4px;border:1px solid var(--ans);color:var(--ans);white-space:nowrap}
.code{display:inline-block;font:600 11px ui-monospace,monospace;padding:1px 6px;border-radius:4px;background:var(--code)}
.opts{font-size:13px}.opt{display:inline-block;border:1px solid var(--line);border-radius:12px;padding:0 8px;margin:2px 2px 2px 0}.opt.def{border-color:var(--accent);font-weight:600}
pre.json,pre.json-all{background:var(--code);border-radius:6px;padding:6px 8px;font:12px ui-monospace,monospace;overflow-x:auto;margin:6px 0 0;white-space:pre}pre.json{white-space:pre-wrap;overflow-wrap:anywhere}
.breaks{color:var(--miss)}.breaks-box{border:1px solid var(--miss);border-radius:6px;padding:8px 12px;margin:8px 0}
.badge{font-size:11px;padding:0 6px;border-radius:4px;color:#fff}.badge.covered{background:var(--ok)}.badge.missing{background:var(--miss)}.badge.answered{background:var(--ans)}
.cov ul{list-style:none;padding-left:4px;margin:4px 0}.cov li{margin:2px 0}
.pair{display:flex;flex-wrap:wrap;gap:12px;margin-top:4px}figure{margin:0;max-width:100%}figure img{display:block;max-width:100%;height:auto;background:#fff;border:1px solid var(--line);image-rendering:pixelated}figcaption{font-size:12px;color:var(--muted)}
label.opt{cursor:pointer}label.opt input{margin:0 4px 0 0;vertical-align:-1px}label.opt:has(input:checked){background:var(--accent);border-color:var(--accent);color:#fff}
input.free{font:13px system-ui,sans-serif;padding:2px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);min-width:0;max-width:100%;width:260px}
.q.done{border-color:var(--ok);box-shadow:inset 3px 0 0 var(--ok)}
.qjson>summary{margin:4px 0 0;color:var(--muted)}
#answerbar{position:sticky;bottom:0;z-index:5;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:12px 0;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;box-shadow:0 -2px 10px rgba(0,0,0,.08)}
#answerbar .count{font-weight:600;margin-right:auto}#answerbar .msg{flex-basis:100%;font-size:13px}#answerbar .msg:empty{display:none}#answerbar .msg.err{color:var(--miss)}#answerbar .msg.ok{color:var(--ok)}
#answerbar button{font:13px system-ui,sans-serif;padding:5px 12px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}#answerbar button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}#answerbar button:disabled{opacity:.5;cursor:default}
@media (max-width:600px){body{padding:10px}section{padding:10px}th,td{padding:3px 4px}.swatches{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}table.bars td.vis{width:40%}}
`;

// The answer form (R88): every open question card carries radio buttons (options) or a text box (free answer). The
// sticky bar counts the answers and submits them: served by core/answer.mjs (http) it POSTs { answers } to ./answers,
// which merges them into the rules file; opened as a file it downloads the merged vd-rules.json instead (the rules
// read by the run, embedded in #vd-answer-ctx, plus the new answers). Choices survive a reload (localStorage).
const ANSWER_JS = `(function(){
var ctx={};try{ctx=JSON.parse(document.getElementById('vd-answer-ctx').textContent)||{};}catch(e){}
var bar=document.getElementById('answerbar');if(!bar)return;
var cards=[].slice.call(document.querySelectorAll('#questions .q[data-key]'));
var served=/^https?:$/.test(location.protocol);
var $=function(s){return bar.querySelector(s);};
var count=$('.count'),msg=$('.msg'),submit=$('.submit');
submit.textContent=served?'Submit: save to the rules file':'Submit: download vd-rules.json';
var LS='vd-answers:'+(ctx.rulesPath||location.pathname);
function read(c){var r=c.querySelector('input[type=radio]:checked');if(r)return JSON.parse(r.value);var t=c.querySelector('input.free');if(t&&t.value.trim())return t.value.trim();return undefined;}
function put(c,v){var rs=c.querySelectorAll('input[type=radio]');for(var i=0;i<rs.length;i++)rs[i].checked=v!==undefined&&rs[i].value===JSON.stringify(v);var t=c.querySelector('input.free');if(t)t.value=v===undefined?'':String(v);}
function collect(){var a={};cards.forEach(function(c){var v=read(c);if(v!==undefined)a[c.dataset.key]=v;});return a;}
function say(t,k){msg.textContent=t;msg.className='msg'+(k?' '+k:'');}
function update(){var a=collect(),n=Object.keys(a).length;count.textContent=n+' of '+cards.length+' open questions answered';cards.forEach(function(c){c.classList.toggle('done',read(c)!==undefined);});submit.disabled=!n;try{localStorage.setItem(LS,JSON.stringify(a));}catch(e){}}
try{var saved=JSON.parse(localStorage.getItem(LS)||'{}');cards.forEach(function(c){if(saved[c.dataset.key]!==undefined)put(c,saved[c.dataset.key]);});}catch(e){}
document.getElementById('questions').addEventListener('input',update);
document.getElementById('questions').addEventListener('change',update);
$('.useall').onclick=function(){cards.forEach(function(c){if(read(c)===undefined)put(c,JSON.parse(c.dataset.default));});update();say('Every unanswered question now holds its default (the value kept). Change any you disagree with, then submit.');};
$('.clear').onclick=function(){cards.forEach(function(c){put(c,undefined);});update();say('');};
function merged(a){var r=JSON.parse(JSON.stringify(ctx.rules||{version:1,answers:{}}));r.version=1;r.answers=r.answers||{};for(var k in a)r.answers[k]=a[k];return r;}
function download(a){var blob=new Blob([JSON.stringify(merged(a),null,2)+'\\n'],{type:'application/json'});var u=URL.createObjectURL(blob);var l=document.createElement('a');l.href=u;l.download='vd-rules.json';document.body.appendChild(l);l.click();l.remove();setTimeout(function(){URL.revokeObjectURL(u);},1000);
say('Downloaded vd-rules.json: the '+Object.keys((ctx.rules&&ctx.rules.answers)||{}).length+' answers of the run plus your '+Object.keys(a).length+'. Save it over '+(ctx.rulesPath||'vd-rules.json at the project root')+', then re-run ds.mjs. To save it directly, open this page with: node core/answer.mjs --out <this folder>','ok');}
submit.onclick=function(){var a=collect();if(!served)return download(a);submit.disabled=true;say('Saving…');
fetch('answers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({answers:a})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(x){
if(x.ok){say('Saved '+x.j.saved+' answer(s) into '+x.j.path+' ('+x.j.total+' answers in the file; backup: '+x.j.backup+'). Re-run ds.mjs to apply them.','ok');try{localStorage.removeItem(LS);}catch(e){}}
else say('Not saved: '+x.j.error,'err');}).catch(function(e){say('The answer server did not reply ('+e.message+'). Nothing was saved; start it again or use the download.','err');}).then(function(){submit.disabled=false;});};
$('.dl').onclick=function(){download(collect());};
update();
})();`;

function answerBar(questions, answer) {
  if (!questions.some(isOpen)) return '';
  const ctx = { rulesPath: (answer && answer.rulesPath) || null, rules: (answer && answer.rules) || { version: 1, answers: {} } };
  return `<div id="answerbar"><span class="count"></span><button type="button" class="useall">Keep the value for the rest</button><button type="button" class="clear">Clear</button>` +
    `<button type="button" class="dl">Download vd-rules.json</button><button type="button" class="submit primary"></button><div class="msg"></div></div>\n` +
    `<script type="application/json" id="vd-answer-ctx">${JSON.stringify(ctx).replace(/</g, '\\u003c')}</script>\n<script>${ANSWER_JS}</script>`;
}

export function renderDsReport({ tokens = {}, entries = [], questions = [], coverage = null, counts = null, samples = {}, crops = [], title = 'Design system proposal', generated = '', answer = null } = {}) {
  const ix = { ...indexTokens(tokens), open: openSet(entries) };
  const toc = [['questions', 'Questions'], ['colours', 'Colours'], ['spacing', 'Spacing'], ['radius', 'Radius'], ['type', 'Type'], ['shadows', 'Shadows'], ['changes', 'Changes'], ['coverage', 'Coverage']]
    .map(([id, l]) => `<a href="#${id}">${l}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design system</title>
${fontLinks(ix)}
<style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted small">${esc(generated)}</p>
<p class="verdict">${esc(dsVerdict({ tokens, entries, questions, coverage }))}</p>
<nav class="toc">${toc}</nav>
${HOWTO}
${renderQuestions(questions)}
${renderColours(ix)}
${renderSpacing(ix)}
${renderRadius(ix)}
${renderType(ix, samples || {})}
${renderShadows(ix)}
${renderChanges(entries, counts, crops)}
${renderCoverage(coverage)}
${answerBar(questions, answer)}
</body></html>
`;
}

// ---------------- samples ----------------

export function typeSamples({ inv, tokens, map, screens = [] }) {
  const ix = indexTokens(tokens || {});
  const nodes = new Map();
  for (const { screen, spec } of screens) {
    const sid = String(screen.id ?? screen.name);
    const walk = (n) => { if (!n) return; nodes.set(`${sid}|${n.id}`, n); (n.kids || []).forEach(walk); };
    walk(spec);
  }
  const counts = new Map(); // path -> Map(text -> n)
  for (const u of (inv && inv.uses) || []) {
    if (u.cat !== 'type') continue;
    const path = map && map[useKey(u)];
    const t = path && ix.byPath.get(path);
    const p = t && ix.resolve(t);
    if (!p) continue;
    const n = nodes.get(`${u.screen}|${u.node}`);
    if (!n || !Array.isArray(n.runs)) continue;
    const run = u.run !== undefined && n.runs[u.run] ? n.runs[u.run].t : n.runs.map((r) => r.t || '').join('');
    const text = String(run || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 60) continue;
    const m = counts.get(p.path) || new Map();
    m.set(text, (m.get(text) || 0) + 1);
    counts.set(p.path, m);
  }
  const out = {};
  for (const path of [...counts.keys()].sort(cmpStr)) {
    out[path] = [...counts.get(path)].sort((a, b) => (b[0].length >= 2) - (a[0].length >= 2) || b[1] - a[1] || b[0].length - a[0].length || cmpStr(a[0], b[0]))[0][0];
  }
  return out;
}
