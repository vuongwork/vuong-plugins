// report.html (Task 8): one self-contained page (images inline as data URIs, no external requests) that the user reads
// to approve deviations (spec §14 layer 5: only flagged nodes are looked at, HTML and Figma crops side by side).
//
// screenView(browser, file, entry, gate, summary) -> view of one screen (async: crops are cut in the browser)
//   entry = runFile's screen entry { screen, inferred, modelled, report, proxy, layout, mutations? }
//   For every open (or allowlisted) unexplained root and crop fail: source crop vs LAYOUT proxy crop at that width; for
//   every needsApproval entry: source crop vs MODELLED proxy crop. Both crops use the same window (union of the
//   source box and the proxy box, padded by PAD css px); the node's box is outlined in each. Normalisation (spec §9):
//   capture's font substitutions (from -> to, reason), the model's substitutions (fontSubstitution flags) and the
//   number of 'normal' line heights made explicit (R14), with the original-font screen next to the measured one.
// renderReportHtml({ title, generated, args, screens: [view] }) -> HTML string (pure, sync).
// Crop jobs: imgs = PNG buffers (device scale 2, clipped to the screen root); window in CSS px relative to the root.
const DSF = 2;
const PAD = 8;
const MAX_OUT = 640; // device px: wider crops are scaled down
const MIN_OUT = 200; // device px: narrower item crops are enlarged (up to 4x, nearest neighbour)

async function cropInPage({ imgs, jobs }) {
  const ims = await Promise.all(imgs.map(async (b64) => {
    const im = new Image(); im.src = `data:image/png;base64,${b64}`; await im.decode(); return im;
  }));
  return jobs.map((j) => {
    const im = ims[j.img], s = j.dsf, [x, y, w, h] = j.win;
    let out = j.scale;
    if (j.minOut) out = Math.max(out, Math.min(4, j.minOut / Math.max(1, w * s))); // small nodes: enlarge, crisp
    out = Math.min(out, j.maxOut / Math.max(1, w * s));
    const cw = Math.max(1, Math.round(w * s * out)), ch = Math.max(1, Math.round(h * s * out));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = out < 1;
    ctx.drawImage(im, x * s, y * s, w * s, h * s, 0, 0, cw, ch);
    if (j.mark) {
      const [mx, my, mw, mh] = j.mark, k = s * out;
      ctx.strokeStyle = 'rgba(230, 0, 160, 0.9)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round((mx - x) * k) - 1.5, Math.round((my - y) * k) - 1.5, Math.round(mw * k) + 3, Math.round(mh * k) + 3);
    }
    return c.toDataURL('image/png');
  });
}

// jobs: [{ png (Buffer), win, mark?, scale? (1 = device pixels), minOut?, maxOut? (device px) }] -> data URIs, in order
export async function cutImages(browser, jobs) {
  if (!jobs.length) return [];
  const bufs = [], index = new Map();
  const ref = (b) => { if (!index.has(b)) { index.set(b, bufs.length); bufs.push(b); } return index.get(b); };
  const js = jobs.map((j) => ({ img: ref(j.png), win: j.win, mark: j.mark || null, dsf: DSF, scale: j.scale ?? 1, minOut: j.minOut ?? 0, maxOut: j.maxOut ?? MAX_OUT }));
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    return await page.evaluate(cropInPage, { imgs: bufs.map((b) => Buffer.from(b).toString('base64')), jobs: js });
  } finally { await page.close(); }
}

const union = (a, b) => {
  const rs = [a, b].filter(Boolean);
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0 - PAD, y0 - PAD, x1 - x0 + 2 * PAD, y1 - y0 + 2 * PAD];
};

function nodeIndex(tree) {
  const m = new Map();
  const walk = (n) => { m.set(n.id, n); (n.kids || []).forEach(walk); };
  walk(tree);
  return m;
}

export function describeNode(n) {
  if (!n) return '';
  const cls = n.cls ? `.${String(n.cls).trim().split(/\s+/).join('.')}` : '';
  const text = n.runs ? n.runs.map((r) => r.t || '').join('').replace(/\s+/g, ' ').trim() : '';
  return `${n.tag || n.kind || ''}${cls}${text ? ` "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"` : ''}`;
}

export async function screenView(browser, file, entry, g, summary) {
  const { screen, report } = entry;
  const idx = nodeIndex(screen.tree);
  const flagsOf = (id) => report.flags.filter((f) => f.id === id).map((f) => `${f.kind}${f.detail ? ` (${f.detail})` : ''}`);
  const items = [];
  const add = (kind, x, proxyName, allowedBy) => {
    const i = x.width === 'A' ? 0 : 1, n = idx.get(x.id);
    const src = n ? (i ? n.rB : n.rA) : null;
    const P = entry[proxyName][x.width];
    const box = P && P.boxes[x.id];
    items.push({
      kind, id: x.id, width: x.width, node: describeNode(n), proxy: proxyName === 'layout' ? 'layout proxy' : 'modelled proxy',
      src, box, x, allowedBy, flags: flagsOf(x.id),
      job: src || box ? { win: union(src, box), i, P } : null,
    });
  };
  for (const r of g.open.roots) add('root', r, 'layout');
  for (const r of g.allowed.roots) add('root', r, 'layout', r.allowedBy);
  for (const a of g.open.approvals) add('approval', a, 'proxy');
  for (const a of g.allowed.approvals) add('approval', a, 'proxy', a.allowedBy);
  for (const c of g.open.crops) add('crop', c, 'layout');
  for (const c of g.allowed.crops) add('crop', c, 'layout', c.allowedBy);

  const jobs = [];
  for (const it of items) {
    if (!it.job) continue;
    it.srcImg = jobs.push({ png: screen.png[it.job.i], win: it.job.win, mark: it.src, minOut: MIN_OUT }) - 1;
    it.simImg = jobs.push({ png: it.job.P.png, win: it.job.win, mark: it.box, minOut: MIN_OUT }) - 1;
  }
  const thumbs = [];
  if (screen.pngOriginal) {
    const win = [0, 0, screen.W[0], screen.H[0]];
    thumbs.push(jobs.push({ png: screen.pngOriginal, win, scale: 0.5, maxOut: 480 }) - 1);
    thumbs.push(jobs.push({ png: screen.png[0], win, scale: 0.5, maxOut: 480 }) - 1);
  }
  const urls = await cutImages(browser, jobs);
  for (const it of items) {
    if (it.srcImg != null) { it.srcImg = urls[it.srcImg]; it.simImg = urls[it.simImg]; }
    delete it.job;
  }
  const modelSubs = report.flags.filter((f) => f.kind === 'fontSubstitution').map((f) => ({ id: f.id, node: describeNode(idx.get(f.id)), detail: f.detail }));
  return {
    file, summary, items,
    data: report.data.map((d) => ({ ...d, node: describeNode(idx.get(d.id)) })),
    unchecked: report.unchecked.map((id) => ({ id, reason: report.uncheckedReasons[id], node: describeNode(idx.get(id)) })),
    skipped: report.skipped,
    norm: {
      fontSubs: screen.fontSubs || [], modelSubs, lineHeight: screen.norm ? screen.norm.lineHeight : null,
      original: thumbs.length ? urls[thumbs[0]] : null, measured: thumbs.length ? urls[thumbs[1]] : null,
    },
    mutations: entry.mutations || null,
    W: screen.W, widen: screen.widen, tol: report.tol || null,
  };
}

// ---------------- rendering ----------------
// Every number is shown with its unit (px, %, /255, KB). Deltas are proxy minus source: [dx, dy, dw, dh] in CSS px.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (v == null ? '' : Number.isInteger(v) ? String(v) : String(r2(v)));
const px = (v) => `${num(v)} px`;
const pct = (r) => `${Math.round((r || 0) * 1000) / 10}%`;
const kb = (bytes) => `${Math.round((bytes || 0) / 100) / 10} KB`; // 1 KB = 1000 bytes, as the 50 KB payload limit
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const counts = (o) => Object.entries(o || {}).map(([k, v]) => `${esc(k)} ${v}`).join(', ');
const anchor = (v) => `s-${esc(v.file)}-${esc(v.summary.screen)}`.replace(/[^A-Za-z0-9_-]/g, '_');
const itemAnchor = (v, it) => `${anchor(v)}-${it.kind}-${it.id}-${it.width}`.replace(/[^A-Za-z0-9_-]/g, '_');
const shortNode = (node) => String(node || '').split(' "')[0];
const screenName = (v) => `${v.file} · ${v.summary.screen}`;

const DIRS = [['moved left', 'moved right'], ['moved up', 'moved down'], ['narrower by', 'wider by'], ['shorter by', 'taller by']];
// [dx, dy, dw, dh] -> "moved left 0.61 px, taller by 2 px" (components that round to 0 are left out)
export function describeDelta(d) {
  if (!Array.isArray(d)) return '';
  const parts = d.map((v, i) => (r2(v) === 0 ? null : `${DIRS[i][v < 0 ? 0 : 1]} ${px(Math.abs(v))}`)).filter(Boolean);
  return parts.length ? parts.join(', ') : 'no change';
}

const widthLabel = (v, w) => {
  const W = v.W && v.W[w === 'A' ? 0 : 1];
  return `at width ${esc(w)}${W != null ? ` (${px(W)})` : ''}`;
};
const boxText = (b) => (Array.isArray(b) ? `at (${num(b[0])}, ${num(b[1])}) px, ${num(b[2])} × ${num(b[3])} px` : 'no box');
const AXES = { x: 'horizontal position', y: 'vertical position', w: 'width', h: 'height' };

function itemNumbers(v, it) {
  const x = it.x, at = widthLabel(v, it.width);
  if (it.kind === 'root') {
    return `Layout delta (rebuilt layout proxy vs source page): ${describeDelta(x.delta)}, ${at}.` +
      (x.why && x.why.length ? ` Off on: ${esc(x.why.map((a) => AXES[a] || a).join(', '))}.` : '') +
      (x.adjacency ? ` Positioned after <code>${esc(x.adjacency)}</code>, which moved.` : '') +
      (x.explainedBy ? ` Explained by ${esc(x.explainedBy)}.` : '');
  }
  if (it.kind === 'approval') {
    const tol = v.tol && v.tol.model != null ? ` over the tolerance of ${px(v.tol.model)}` : ' over the model tolerance';
    return `Model delta (Figma model vs layout proxy): ${describeDelta(x.delta)}, ${at}; total ${px(x.magnitude)},${tol}.` +
      (x.drift ? ' This is the largest accumulated difference on the screen (small steps adding up).' : '');
  }
  return `${pct(x.ratio)} of pixels differ; largest colour difference ${num(x.peak)}/255; ${px(x.diff)} differ, ${at}.`;
}

const KIND_TITLE = {
  root: 'Unexplained layout errors (plugin bug)',
  approval: 'Needs your approval (Figma model limitation)',
  crop: 'Image mismatches (crop fails)',
};

// key of a finding for grouping across screens: same file, node id, kind, width and numbers (rounded to 0.01)
const findingKey = (v, it) => {
  const x = it.x;
  const n = it.kind === 'crop' ? [x.ratio, x.diff, x.peak] : [...(x.delta || []), x.magnitude ?? ''];
  return [v.file, it.id, it.kind, it.width, ...n.map((k) => (typeof k === 'number' ? r2(k) : k))].join('|');
};

function groupRepeats(screens) {
  const first = new Map(), refs = new Map(), also = new Map();
  for (const v of screens) {
    for (const it of v.items) {
      const k = findingKey(v, it);
      if (!first.has(k)) { first.set(k, { v, it }); continue; }
      const f = first.get(k);
      refs.set(it, f);
      if (!also.has(f.it)) also.set(f.it, []);
      also.get(f.it).push(v);
    }
  }
  return { refs, also };
}

function renderItem(v, it, g) {
  const ref = g.refs.get(it);
  if (ref) {
    return `<div class="item repeat" data-of="${itemAnchor(ref.v, ref.it)}"><code>${esc(it.id)}</code> ${esc(shortNode(it.node))} ${widthLabel(v, it.width)}: ` +
      `same finding as on <a href="#${itemAnchor(ref.v, ref.it)}">${esc(screenName(ref.v))}</a> (repeated across screens).</div>`;
  }
  const others = g.also.get(it) || [];
  const imgs = it.srcImg
    ? `<div class="pair"><figure><img src="${it.srcImg}" alt="source page ${esc(it.id)} at ${esc(it.width)}"><figcaption>source page (${esc(it.width)}), node ${esc(boxText(it.src))}</figcaption></figure>` +
      `<figure><img src="${it.simImg}" alt="${esc(it.proxy)} ${esc(it.id)} at ${esc(it.width)}"><figcaption>rebuilt ${esc(it.proxy)} (${esc(it.width)}), node ${esc(boxText(it.box))}</figcaption></figure></div>`
    : '<p class="muted">no box to crop</p>';
  return `<div class="item${it.allowedBy ? ' allowed' : ''}" data-kind="${esc(it.kind)}" id="${itemAnchor(v, it)}"><div class="head"><code>${esc(it.id)}</code> <span class="node">${esc(it.node)}</span> · ${widthLabel(v, it.width)}</div>` +
    `<div class="nums">${itemNumbers(v, it)}</div>` +
    (others.length ? `<div class="repeat-note">Repeated across screens: the same finding is also on ${others.map((o) => `<a href="#${anchor(o)}">${esc(screenName(o))}</a>`).join(', ')}.</div>` : '') +
    (it.flags.length ? `<div class="flags">flags: ${esc(it.flags.join('; '))}</div>` : '') +
    (it.allowedBy ? `<div class="ok">allowlisted: ${esc(it.allowedBy)}</div>` : '') + imgs + '</div>';
}

// one plain sentence on what a screen needs (counts from the summary: the gate's open findings)
export function verdictLine(v) {
  const s = v.summary;
  if (s.pass) return s.allowed ? `Matches (${plural(s.allowed, 'item', 'items')} allowlisted).` : 'Matches.';
  const parts = [];
  if (s.unexplainedRoots) {
    const names = [...new Set(v.items.filter((i) => i.kind === 'root' && !i.allowedBy).map((i) => shortNode(i.node)).filter(Boolean))];
    const list = names.length ? ` (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})` : '';
    parts.push(`${plural(s.unexplainedRoots, 'layout error', 'layout errors')} the plugin cannot explain${list}`);
  }
  if (s.cropLinked) parts.push(`${plural(s.cropLinked, 'image mismatch', 'image mismatches')} caused by those layout errors`);
  if (s.crop) parts.push(plural(s.crop, 'image mismatch', 'image mismatches'));
  const nData = Object.values(s.data || {}).reduce((a, b) => a + b, 0);
  if (nData) parts.push(plural(nData, 'data finding', 'data findings'));
  if (s.unchecked) parts.push(`${plural(s.unchecked, 'node', 'nodes')} could not be checked`);
  if (s.skipped && s.skipped.length) parts.push(`${plural(s.skipped.length, 'layer', 'layers')} skipped`);
  const approve = s.needsApproval
    ? `${s.needsApproval === 1 ? '1 item needs' : `${s.needsApproval} items need`} your approval (Figma model limitation).`
    : 'Nothing for you to approve.';
  return parts.length ? `${parts.join(', ')}. ${approve}` : approve;
}

function fontReason(f) {
  const r = f.reason;
  if (r === 'version') return "the installed copy differs from the one Figma uses; measured with Figma's version";
  if (r === 'version-failed') return "the installed copy may differ from Figma's, but Figma's version did not load; measured with the installed copy";
  if (r === 'not-in-figma') return `${f.from} is not available in Figma; replaced with ${f.to}`;
  if (r === 'system') return `${f.from} depends on the machine; fixed to ${f.to}`;
  if (r === 'not-loaded') return `the browser could not load ${f.from}; measured with ${f.to}`;
  if (r === 'override-failed') return `${f.to} did not render, so ${f.from} was kept${f.cause ? ` (original reason: ${fontReason({ ...f, reason: f.cause })})` : ''}`;
  return r || '';
}

function renderScreen(v, g) {
  const s = v.summary;
  const parts = [`<section class="screen" id="${anchor(v)}"><h2>${esc(screenName(v))} <span class="badge ${s.pass ? 'pass' : 'fail'}">${s.pass ? 'pass' : 'fail'}</span></h2>`];
  parts.push(`<p class="verdict ${s.pass ? 'pass' : 'fail'}">${esc(verdictLine(v))}</p>`);
  const stretch = v.W ? r2(v.W[1] - v.W[0]) : null;
  parts.push(`<p class="muted">Widths: A = ${px(v.W[0])}, B = ${px(v.W[1])} (stretched by ${px(stretch)} to test resizing${v.widen && v.widen.unsafe ? '; the stretch crosses a breakpoint, so B may use different CSS' : ''}). ` +
    `Checked ${s.checked} of ${plural(s.total, 'node', 'nodes')}. Figma spec size ${kb(s.specBytes)}${s.payloadOver50k ? ' (over the 50 KB limit)' : ''}. ` +
    `Reference: pixel difference ${(s.pixel || []).map((p, i) => `${pct(p)} at ${i ? 'B' : 'A'}`).join(' / ')} (for reference only, not used for pass/fail).</p>`);
  if (v.unchecked.length) parts.push(`<h3>Unchecked</h3><ul>${v.unchecked.map((u) => `<li><code>${esc(u.id)}</code> ${esc(u.node)}: ${esc(u.reason)}</li>`).join('')}</ul>`);
  if (v.skipped.length) parts.push(`<h3>Skipped layers</h3><p>${esc(v.skipped.join(', '))}</p>`);
  for (const kind of ['root', 'approval', 'crop']) {
    const its = v.items.filter((i) => i.kind === kind);
    if (its.length) parts.push(`<details open><summary><h3>${KIND_TITLE[kind]} (${its.length})</h3></summary>${its.map((it) => renderItem(v, it, g)).join('')}</details>`);
  }
  if (v.data.length) {
    parts.push(`<h3>Data findings (${v.data.length})</h3><table><tr><th>node</th><th>kind</th><th>expected</th><th>actual</th></tr>` +
      v.data.map((d) => `<tr><td><code>${esc(d.id)}</code> ${esc(d.node)}</td><td>${esc(d.kind)}${d.side ? ` ${esc(d.side)}` : ''}</td><td>${esc(d.expected)}</td><td>${esc(d.actual)}</td></tr>`).join('') + '</table>');
  }
  const n = v.norm;
  parts.push('<h3>Normalisation</h3>');
  parts.push(n.fontSubs.length
    ? `<table><tr><th>font in the page</th><th>measured with</th><th>why</th></tr>${n.fontSubs.map((f) => `<tr><td>${esc(f.from)}</td><td>${esc(f.to)}</td><td>${esc(fontReason(f))}</td></tr>`).join('')}</table>`
    : '<p>No font substitutions in capture.</p>');
  if (n.modelSubs.length) parts.push(`<p>Substituted by the Figma model: ${n.modelSubs.map((m) => `<code>${esc(m.id)}</code> ${esc(m.detail)}`).join('; ')}</p>`);
  parts.push(`<p>${n.lineHeight == null ? 'Line-height normalisation was not run.'
    : esc(`${plural(n.lineHeight, 'text element', 'text elements')} had line-height: normal; written as exact px because Figma has no 'normal'.`)}</p>`);
  if (n.original) {
    parts.push(`<div class="pair"><figure><img src="${n.original}" alt="before normalisation"><figcaption>Before: original fonts and line heights (width A)</figcaption></figure>` +
      `<figure><img src="${n.measured}" alt="after normalisation"><figcaption>After: as measured (width A)</figcaption></figure></div>` +
      '<p class="muted">Identical = normalisation changed nothing.</p>');
  }
  if (v.mutations) {
    const m = v.mutations;
    parts.push(`<h3>Mutations: planted errors, each must be caught (all caught: ${m.allCaught ? 'yes' : 'no'})</h3><table><tr><th>planted error</th><th>target</th><th>caught</th><th>caught by</th></tr>` +
      m.results.map((r) => `<tr><td>${esc(r.kind)}</td><td><code>${esc(r.target ?? '')}</code></td><td>${r.caught === null ? `skipped (not applicable: ${esc(r.skipped)})` : r.caught ? 'yes' : 'no'}</td><td>${esc((r.by || []).join(', '))}</td></tr>`).join('') + '</table>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

const HOWTO = `<details class="howto"><summary><strong>How to read this report</strong></summary>
<ul>
<li>Each screen is measured at two widths: <b>width A</b> (its own width) and <b>width B</b> (stretched wider, to test how it resizes).</li>
<li>A screen fails for three kinds of finding:
<ul>
<li><b>Unexplained layout error</b>: the rebuilt layout differs from the page and the plugin cannot say why. This is a plugin bug; nothing for you to approve.</li>
<li><b>Needs approval</b>: the layout is right, but Figma cannot model it exactly (a Figma limitation, e.g. text-height rounding). You decide: add an allowlist entry with <code>approved: true</code> to accept it.</li>
<li><b>Image mismatch (crop fail)</b>: the pixels of a node differ between the page and the rebuild.</li>
</ul></li>
<li>Images: the <b>left</b> one is the source page, the <b>right</b> one the rebuilt proxy; the <b>magenta</b> box marks the node.</li>
<li><b>Normalisation</b>: before measuring, fonts are swapped for the ones Figma uses and 'normal' line heights are written as px, so differences are not caused by fonts.</li>
<li><b>Mutations</b>: deliberately planted errors; each must show caught = yes. Skipped means the mutation does not apply to that screen.</li>
<li>An item with a <b>yellow border</b> is allowlisted: approved earlier, so it no longer fails the screen.</li>
</ul></details>`;

const CSS = `
:root{--bg:#fafafa;--fg:#1b1b1b;--muted:#666;--line:#ddd;--card:#fff;--pass:#1b7f3b;--fail:#b3261e;--allow:#7a5c00;--allowline:#d9b100}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--card:#1f1f1f;--pass:#5cc27a;--fail:#ff8a80;--allow:#e0c060;--allowline:#c9a400}}
:root[data-theme="dark"]{--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--card:#1f1f1f;--pass:#5cc27a;--fail:#ff8a80;--allow:#e0c060;--allowline:#c9a400}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:0 0 6px}h3{font-size:15px;margin:14px 0 6px;display:inline}
.muted{color:var(--muted)}code{font:12px ui-monospace,monospace}
table{border-collapse:collapse;margin:6px 0;max-width:100%}th,td{border:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}
.wrap{overflow-x:auto}
.screen{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:16px 0}
.badge{font-size:12px;padding:1px 6px;border-radius:4px;color:#fff}.badge.pass{background:var(--pass)}.badge.fail{background:var(--fail)}
.verdict{margin:2px 0 6px;font-weight:600}.verdict.pass{color:var(--pass)}.verdict.fail{color:var(--fail)}
tr.fail td:last-child{color:var(--fail);font-weight:600}tr.pass td:last-child{color:var(--pass);font-weight:600}
.item{border-top:1px solid var(--line);padding:8px 0}.item.allowed{border:2px solid var(--allowline);border-radius:6px;padding:8px;margin:6px 0}.item .ok{color:var(--allow)}
.item.repeat{font-size:13px;color:var(--muted)}.repeat-note{font-size:13px;font-style:italic}
.head .node{color:var(--muted)}.nums,.flags{font-size:13px}
.pair{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}
figure{margin:0;max-width:100%}figure img{display:block;max-width:100%;height:auto;background:#fff;border:1px solid var(--line);image-rendering:pixelated}
figcaption{font-size:12px;color:var(--muted)}
details>summary{cursor:pointer;margin-top:10px}
.howto{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 12px;margin:10px 0}.howto ul{margin:6px 0;padding-left:20px}
`;

export function renderReportHtml({ title = 'vuong-design layout report', generated = '', args = {}, screens = [] }) {
  const total = screens.length, passed = screens.filter((v) => v.summary.pass).length;
  const groups = groupRepeats(screens);
  const rows = screens.map((v) => {
    const s = v.summary;
    return `<tr class="${s.pass ? 'pass' : 'fail'}"><td><a href="#${anchor(v)}">${esc(screenName(v))}</a></td><td>${s.checked} of ${s.total}</td>` +
      `<td>${s.unexplainedRoots}</td><td>${s.needsApproval}${s.needsApproval ? ` (largest ${px(s.approvalMax)})` : ''}</td><td>${s.crop}</td>` +
      `<td>${counts(s.data) || 0}</td><td>${counts(s.flags)}</td><td>${kb(s.specBytes)}</td><td>${s.payloadOver50k ? 'yes' : 'no'}</td>` +
      `<td>${s.allowed}</td><td>${s.pass ? 'pass' : 'fail'}</td></tr>`;
  }).join('\n');
  const sum = (k) => screens.reduce((a, v) => a + v.summary[k], 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Layout report</title><style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${esc(generated)} · ${passed}/${total} screens pass · unexplained layout errors (unexplained roots) ${sum('unexplainedRoots')} · items needing approval ${sum('needsApproval')} · image mismatches (crop fails) ${sum('crop')}</p>
<p class="muted">${esc(Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '))}</p>
${HOWTO}
<div class="wrap"><table><tr><th>screen</th><th>nodes checked</th><th>unexplained layout errors (plugin bug)</th><th>items needing approval (largest model delta, px)</th><th>image mismatches (crop fails)</th><th>data findings (by kind)</th><th>flags (by kind)</th><th>Figma spec size (KB)</th><th>spec over 50 KB</th><th>allowlisted items</th><th>result</th></tr>
${rows}</table></div>
${screens.map((v) => renderScreen(v, groups)).join('\n')}
</body></html>
`;
}
