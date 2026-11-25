// components.html (plan 3b Task 4): a local preview of every component with all its variants and states, so the user
// reviews the state rules and the declarations before anything goes to Figma. No Figma call, no browser at build time:
// each cell is an <iframe srcdoc> holding the norm proxy page of one subtree (proxy.mjs buildProxyHtml, the renderer
// every other check uses; no second renderer). Pure and deterministic: the same inputs give the same bytes except the
// `generated` string. English, every number with its unit (report convention).
//
// stateSpec(root, patch) -> a copy of a component template (SNode) with a proposed state's patch (states.mjs) applied,
//   as the preview draws it:
//   overlay        paint.bgImage = a flat gradient of the colour at that opacity, above any image the root has
//   contentOpacity each kid's paint.opacity multiplied by it
//   fillOpacity    the root fill's alpha multiplied by it;  strokeOpacity: each border colour's alpha multiplied by it
//   ring           an outer box-shadow 0 0 0 <width> px in the colour (before any shadow the root has)
//   stroke         a solid border of <width> px in the colour on all four sides
//   spinner        each replaced text becomes a frame of the text's box (so the size does not change) with a vector
//                  spinner (spinnerSvg: faint ring + quarter arc) of <size> px centred in it
//
// renderComponents({ cmps, states, specs, screens, fontMap, draft?, rulesDraft?, title?, generated? }) -> HTML
//  - cmps: findComponents() result; states: componentStates() result; specs: { [screen]: spec-norm root };
//    screens: { [screen]: { svgDefs, fontCss } } (ir.json); fontMap: font-map.mjs map (proxy fonts);
//    draft: componentsDraft() (vd-components.draft.json); rulesDraft: statesDraft() (the `states` section).
//  - Order: verdict; how to read; one section per component (header: kind, reason, uses, screens, axes, properties;
//    cells: the HTML variants, then the proposed states, then the missing states with their reasons); bare
//    proposals (first occurrence drawn, the `keep` line to copy); skipped groups; warnings; the drafts.
//  - Each cell's page background is the nearest fill above the template in its screen (white when none), so a white
//    chip on a coloured card is visible.
//
// componentsSummary({ cmps, states, href }) -> a small <section id="components"> for design-system.html: counts and
// a link to components.html.
import { buildProxyHtml } from './proxy.mjs';
import { parseColor, toHex } from './color.mjs';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clone = (x) => JSON.parse(JSON.stringify(x));
const PAD = 8;

// ---- state patches -------------------------------------------------------------------------------------------------

const rgba = (css, k) => {
  const c = parseColor(css);
  if (c.unparsed !== undefined) return css;
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${r3((c.a ?? 1) * k)})`;
};
const hexA = (hex, a) => rgba(hex, a);
const findNode = (n, id) => { if (n.id === id) return n; for (const k of n.kids || []) { const x = findNode(k, id); if (x) return x; } return null; };

// spinner: a faint full ring and a quarter arc, stroke 2.5 on a 24 grid, round caps
export const spinnerSvg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="${color}" stroke-opacity="0.25" stroke-width="2.5"/><path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/></svg>`;

export function stateSpec(root, patch) {
  const n = clone(root);
  const p = (n.paint = { ...(n.paint || {}) });
  const P = patch || {};
  if (P.overlay) {
    const g = `linear-gradient(${hexA(P.overlay.color, P.overlay.opacity)}, ${hexA(P.overlay.color, P.overlay.opacity)})`;
    p.bgImage = p.bgImage && p.bgImage !== 'none' ? `${g}, ${p.bgImage}` : g;
  }
  if (P.contentOpacity != null) for (const k of n.kids || []) k.paint = { ...(k.paint || {}), opacity: r3(((k.paint && k.paint.opacity) ?? 1) * P.contentOpacity) };
  if (P.fillOpacity != null && p.bg) p.bg = rgba(p.bg, P.fillOpacity);
  if (P.strokeOpacity != null && Array.isArray(p.border)) p.border = p.border.map((b) => (b ? { ...b, color: rgba(b.color, P.strokeOpacity) } : b));
  if (P.ring) p.shadow = [`0 0 0 ${P.ring.width}px ${P.ring.color}`, ...(p.shadow && p.shadow !== 'none' ? [p.shadow] : [])].join(', ');
  if (P.stroke) p.border = [0, 1, 2, 3].map(() => ({ w: P.stroke.width, style: 'solid', color: P.stroke.color }));
  if (P.spinner) {
    for (const path of P.spinner.replace) {
      const id = path === '' ? n.id : `${n.id}.${path}`;
      const t = findNode(n, id);
      if (!t) continue;
      const s = P.spinner.size;
      // a vector icon (not a bordered frame: the proxy draws borders as inset shadows, uneven on a 13 px circle)
      const spin = { id: `${id}.spin`, t: 'V', w: s, h: s, sz: ['FIXED', 'FIXED'], abs: { x: r2((t.w - s) / 2), y: r2((t.h - s) / 2), c: 'L' },
        icon: { svg: spinnerSvg(P.spinner.color) } };
      for (const k of Object.keys(t)) if (!['id', 'w', 'h', 'sz'].includes(k)) delete t[k];
      Object.assign(t, { t: 'F', sz: ['FIXED', 'FIXED'], kids: [spin] });
    }
  }
  if (!Object.keys(p).length) delete n.paint;
  return n;
}

// ---- cells ---------------------------------------------------------------------------------------------------------

function pathTo(n, id, chain = []) {
  if (n.id === id) return [...chain, n];
  for (const k of n.kids || []) { const r = pathTo(k, id, [...chain, n]); if (r) return r; }
  return null;
}
function backdrop(spec, id) {
  const chain = pathTo(spec, id) || [];
  for (const x of chain.slice(0, -1).reverse()) {
    const bg = x.paint && x.paint.bg;
    if (bg && bg !== 'transparent') { const c = parseColor(bg); if (c.unparsed === undefined && (c.a ?? 1) >= 1) return toHex(c); }
  }
  return '#ffffff';
}
function refsOf(n, out = new Set()) { if (n.icon && n.icon.ref) out.add(n.icon.ref); for (const k of n.kids || []) refsOf(k, out); return out; }

function cellPage(sub, ctx, screenId, bg) {
  const sc = (ctx.screens && ctx.screens[screenId]) || {};
  const defs = {};
  for (const r of [...refsOf(sub)].sort(cmpStr)) if (sc.svgDefs && sc.svgDefs[r]) defs[r] = sc.svgDefs[r];
  const fc = sc.fontCss || {};
  const html = buildProxyHtml(sub, defs, ctx.fontMap, { fontLinks: fc.links || [], fontFaces: fc.faces || [] });
  return html.replace('</style></head>', `\nbody{padding:${PAD}px;background:${bg}}</style></head>`);
}
function cell(ctx, { spec, screen, root, label, tag, note }) {
  const sub = clone(root);
  delete sub.abs;
  if (spec.model) sub.model = spec.model;
  const bg = backdrop(spec, root.id);
  const page = cellPage(sub, ctx, screen, bg);
  const w = Math.ceil(root.w) + 2 * PAD, h = Math.ceil(root.h) + 2 * PAD;
  return `<figure class="cell"><div class="frame"><iframe title="${esc(label)}" width="${w}" height="${h}" loading="lazy" srcdoc="${esc(page)}"></iframe></div>` +
    `<figcaption><span class="tag ${tag}">${tag}</span> ${esc(label)}${note ? `<br><span class="muted">${esc(note)}</span>` : ''}</figcaption></figure>`;
}
const propsLabel = (props) => Object.keys(props || {}).length ? Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', ') : 'default';
const RULE_TEXT = {
  pressed: (p) => `overlay ${p.overlay.color} at ${r2(p.overlay.opacity * 100)} %`,
  disabled: (p) => [p.contentOpacity != null && `content at ${r2(p.contentOpacity * 100)} %`, p.fillOpacity != null && `fill at ${r2(p.fillOpacity * 100)} %`, p.strokeOpacity != null && `stroke at ${r2(p.strokeOpacity * 100)} %`].filter(Boolean).join(', '),
  focus: (p) => `ring ${p.ring.width} px ${p.ring.color} (${p.ring.token})`,
  error: (p) => `stroke ${p.stroke.width} px ${p.stroke.color} (${p.stroke.token})`,
  loading: (p) => `spinner ${p.spinner.size} px ${p.spinner.color} replaces ${plural(p.spinner.replace.length, 'label')}`,
};

function componentSection(c, st, ctx) {
  const at = (ref) => { const spec = ctx.specs[ref.screen]; const root = spec && findNode(spec, ref.node); return root ? { spec, root, screen: ref.screen } : null; };
  const cells = [];
  const stateOf = new Map();
  for (const s of (st && st.states) || []) for (const i of s.variants || []) stateOf.set(i, [...(stateOf.get(i) || []), s.state]);
  const extraOf = new Map();
  for (const e of (st && st.extra) || []) for (const i of e.variants) extraOf.set(i, [...(extraOf.get(i) || []), e.state]);
  c.variants.forEach((v, i) => {
    const t = at(v.template);
    const note = [`${plural(v.nodes.length, 'use')}`, stateOf.has(i) ? `state: ${stateOf.get(i).join(', ')}` : '', extraOf.has(i) ? `extra state: ${extraOf.get(i).join(', ')}` : ''].filter(Boolean).join(' · ');
    if (!t) { cells.push(`<figure class="cell"><figcaption><span class="tag missing">not found</span> ${esc(propsLabel(v.props))}: template ${esc(v.template.screen)} ${esc(v.template.node)}</figcaption></figure>`); return; }
    cells.push(cell(ctx, { ...t, label: propsLabel(v.props), tag: 'html', note }));
  });
  for (const p of (st && st.proposed) || []) {
    const t = at(c.variants[p.base].template);
    if (!t) continue;
    cells.push(cell(ctx, { spec: t.spec, screen: t.screen, root: stateSpec(t.root, p.patch), label: propsLabel(p.props), tag: 'proposed', note: `rule ${p.state}: ${RULE_TEXT[p.state] ? RULE_TEXT[p.state](p.patch) : ''}${contrastText(p.contrast)}` }));
  }
  for (const s of ((st && st.states) || []).filter((x) => x.source === 'missing')) {
    cells.push(`<figure class="cell empty"><div class="frame none">no drawing</div><figcaption><span class="tag missing">missing</span> state=${esc(s.state)}<br><span class="muted">${esc(s.reason)}</span></figcaption></figure>`);
  }
  const states = (st && st.states) || [];
  const stateLine = states.length ? states.map((s) => `${esc(s.state)} <span class="tag ${s.source}">${s.source}</span>`).join(' ') : '<span class="muted">kind other: no state table</span>';
  const props = c.props.length ? c.props.map((p) => `<code>${esc(p.name)}</code> ${esc(p.type)}${p.type === 'TEXT' ? ` (default "${esc(p.default)}")` : p.type === 'BOOLEAN' ? ` (default ${p.default})` : ''}`).join(', ') : 'none';
  return `<section class="cmp" id="c-${esc(c.name)}"><h2>${esc(c.name)} <span class="muted small">${esc(c.kind)} · reason ${esc(c.reason)} · ${plural(c.count, 'use')} on ${plural(c.screens.length, 'screen')}</span></h2>
<p class="small">Screens: ${esc(c.screens.join(', '))}. Axes: ${c.axes.length ? esc(c.axes.join(', ')) : 'none'}. Variants from the HTML: ${c.variants.length}. Properties: ${props}${c.icons ? `. Icons to swap: ${esc(c.icons.join(', '))}` : ''}.</p>
<p class="small">States: ${stateLine}</p>
${detachedLine(c)}<div class="cells">${cells.join('\n')}</div></section>`;
}

function proposalsSection(cmps, ctx) {
  const list = cmps.proposed || [];
  if (!list.length) return '<section id="proposals"><h2>Bare proposals</h2><p class="muted">None.</p></section>';
  const rows = list.map((p) => {
    const ref = p.nodes[0];
    const spec = ctx.specs[ref.screen];
    const root = spec && findNode(spec, ref.node);
    const keep = `"keep": { ${JSON.stringify(p.key)}: "<name>" }`;
    return `<div class="prop">${root ? cell(ctx, { spec, screen: ref.screen, root, label: p.key, tag: 'proposal' }) : ''}<p class="small">${plural(p.count, 'use')} on ${esc(p.screens.join(', '))}. To make it a component, add to vd-components.json:</p><pre>${esc(keep)}</pre></div>`;
  });
  return `<section id="proposals"><h2>Bare proposals <span class="muted small">(${plural(list.length, 'group')}, built as layers until kept)</span></h2><div class="cells">${rows.join('\n')}</div></section>`;
}
// Task 5: contrast of a proposed state; occurrences that do not rebuild from the component (built as layers)
const contrastText = (x) => (!x ? '' : x.exempt ? '; contrast: exempt (disabled)' : `; contrast ${x.what} ${x.ratio}:1 (WCAG ${x.required}${x.ok ? ', ok' : ', below'}${x.base != null ? `; ${x.base}:1 without the overlay` : ''})`);
const detachedLine = (c) => (!c.detached || !c.detached.length ? '' : `<p class="small">Built as layers (${plural(c.detached.length, 'use')} that the component cannot rebuild): ${c.detached.map((d) => `${esc(d.screen)} ${esc(d.node)}: ${esc(d.reason)}`).join('; ')}.</p>
`);

function skippedSection(cmps) {
  const list = cmps.skipped || [];
  if (!list.length) return '';
  const why = { shapes: 'several structures, no shapes choice (layers)', nested: 'always inside another component with the same count', user: 'dropped in vd-components.json', structure: 'does not fit its variant template (layers)', detached: 'no use rebuilds from the component (layers)' };
  const rows = list.map((s) => `<tr><td><code>${esc(s.key)}</code></td><td class="v">${plural(s.count, 'use')}</td><td>${esc(why[s.reason] || s.reason)}${s.sizes ? ` (shapes of ${s.sizes.map((x) => plural(x, 'use')).join(', ')})` : ''}</td></tr>`);
  return `<section id="skipped"><h2>Not components</h2><table><thead><tr><th>Group</th><th>Uses</th><th>Why</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
}

export function componentsVerdict({ cmps, states }) {
  const cs = (cmps && cmps.components) || [];
  const by = {};
  for (const c of cs) by[c.kind] = (by[c.kind] || 0) + 1;
  const ss = ((states && states.components) || []).flatMap((c) => c.states);
  const n = (src) => ss.filter((s) => s.source === src).length;
  return `${plural(cs.length, 'component')} (${Object.keys(by).sort(cmpStr).map((k) => `${k} ${by[k]}`).join(', ') || 'none'}), ` +
    `${plural(cs.reduce((x, c) => x + c.variants.length, 0), 'variant')} from the HTML; states: ${n('html')} from the HTML, ${n('proposed')} proposed by rules ` +
    `(${states && states.approved ? 'rules approved: they go to Figma' : 'rules not approved: nothing proposed goes to Figma'}), ${n('missing')} missing; ` +
    `${plural(((cmps && cmps.proposed) || []).length, 'bare proposal')}.`;
}

const CSS = `:root{--fg:#1d2433;--muted:#5d6678;--line:#d9dde5;--bg:#f6f7f9;--card:#fff;--html:#2f7d4f;--prop:#a15c00;--miss:#b3261e;--code:#eef0f4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--fg:#e6e8ee;--muted:#a3abbb;--line:#3a4152;--bg:#161a22;--card:#1e2430;--code:#262d3b;--html:#6cc28f;--prop:#f0a64a;--miss:#f2867e}}
*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 6px}.small{font-size:12.5px}.muted{color:var(--muted)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:12px 0;min-width:0}
.verdict{font-weight:600}.toc{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px}
.cells{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}.cell{margin:0;max-width:100%;min-width:0}
.frame{border:1px dashed var(--line);border-radius:6px;overflow:auto;max-width:100%;width:fit-content}.frame iframe{display:block;border:0}
.frame.none{width:120px;height:60px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px}
figcaption{font-size:12px;margin-top:3px;max-width:260px;overflow-wrap:anywhere}
.tag{display:inline-block;font-size:11px;padding:0 5px;border-radius:4px;color:#fff;background:var(--muted)}.tag.html{background:var(--html)}.tag.proposed,.tag.proposal{background:var(--prop)}.tag.missing{background:var(--miss)}
code,pre{font:12px ui-monospace,monospace;background:var(--code);border-radius:4px}code{padding:0 3px}pre{padding:6px 8px;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid var(--line);padding:4px 6px;vertical-align:top}
.prop{min-width:0;max-width:100%}
@media (max-width:600px){body{padding:10px}section{padding:10px}}`;

const HOWTO = `<section class="howto"><h2>How to read</h2><ul class="small">
<li><span class="tag html">html</span> drawn from the HTML (one cell per variant); <span class="tag proposed">proposed</span> drawn by a state rule from the variant in the base state; <span class="tag missing">missing</span> not drawn, with the reason.</li>
<li>Proposed states go to Figma only after you set <code>"approved": true</code> in the <code>states</code> section of vd-rules.json. Change a rule there and every component follows.</li>
<li>Kinds, state classes, modifier classes, names and the choice for classes with several structures are answered in vd-components.json (start from the draft at the end of this page). Nothing here is written to your files.</li>
<li>Each cell is drawn by the same proxy renderer as the checks, on the fill found behind the component in its screen.</li></ul></section>`;

export function renderComponents({ cmps, states, specs = {}, screens = {}, fontMap, draft = null, rulesDraft = null, title = 'Components', generated = '' } = {}) {
  const ctx = { specs, screens, fontMap };
  const stOf = new Map(((states && states.components) || []).map((c) => [c.name, c]));
  const cs = (cmps && cmps.components) || [];
  const toc = cs.map((c) => `<a href="#c-${esc(c.name)}">${esc(c.name)}</a>`).join('') + '<a href="#proposals">bare proposals</a><a href="#skipped">not components</a><a href="#drafts">drafts</a>';
  const warn = [...((cmps && cmps.warnings) || []), ...((states && states.warnings) || [])];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Components</title>
<style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted small">${esc(generated)}</p>
<p class="verdict">${esc(componentsVerdict({ cmps, states }))}</p>
<nav class="toc">${toc}</nav>
${HOWTO}
${cs.map((c) => componentSection(c, stOf.get(c.name), ctx)).join('\n')}
${proposalsSection(cmps || {}, ctx)}
${skippedSection(cmps || {})}
${warn.length ? `<section id="warnings"><h2>Warnings</h2><ul class="small">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}
<section id="drafts"><h2>Drafts</h2>
<details><summary>vd-components.draft.json (suggestions; copy what you agree with into vd-components.json)</summary><pre>${esc(JSON.stringify(draft || {}, null, 2))}</pre></details>
<details><summary>states rules (the <code>states</code> section of vd-rules.draft.json)</summary><pre>${esc(JSON.stringify(rulesDraft || {}, null, 2))}</pre></details>
</section>
</body></html>
`;
}

export function componentsSummary({ cmps, states, href = 'components.html' }) {
  return `<section id="components"><h2>Components</h2><p>${esc(componentsVerdict({ cmps, states }))}</p><p><a href="${esc(href)}">Open the component preview (${esc(href)})</a></p></section>`;
}
