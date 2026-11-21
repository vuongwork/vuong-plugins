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
    W: screen.W, widen: screen.widen,
  };
}

// ---------------- rendering ----------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null ? '' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString());
const delta = (d) => (Array.isArray(d) ? `dx ${num(d[0])}, dy ${num(d[1])}, dw ${num(d[2])}, dh ${num(d[3])}` : '');
const box = (b) => (Array.isArray(b) ? `[${b.map(num).join(', ')}]` : 'none');
const counts = (o) => Object.entries(o || {}).map(([k, v]) => `${esc(k)} ${v}`).join(', ');
const anchor = (v) => `s-${esc(v.file)}-${esc(v.summary.screen)}`.replace(/[^A-Za-z0-9_-]/g, '_');

function itemNumbers(it) {
  const x = it.x;
  if (it.kind === 'root') {
    return `layout delta ${delta(x.delta)}; off on ${esc((x.why || []).join(', '))}${x.adjacency ? `; adjacency after ${esc(x.adjacency)}` : ''}${x.explainedBy ? `; explainedBy ${esc(x.explainedBy)}` : ''}`;
  }
  if (it.kind === 'approval') return `model delta ${delta(x.delta)}; magnitude ${num(x.magnitude)}px (> tolModel); explainedBy ${esc(x.explainedBy)}`;
  return `ratio ${num(x.ratio)}, diff ${num(x.diff)} px, peak ${num(x.peak)}`;
}

const KIND_TITLE = { root: 'Unexplained roots', approval: 'Needs approval (model delta > tolModel)', crop: 'Crop fails' };

function renderItem(it) {
  const imgs = it.srcImg
    ? `<div class="pair"><figure><img src="${it.srcImg}" alt="source ${esc(it.id)} at ${esc(it.width)}"><figcaption>source (${esc(it.width)}) ${esc(box(it.src))}</figcaption></figure>` +
      `<figure><img src="${it.simImg}" alt="${esc(it.proxy)} ${esc(it.id)} at ${esc(it.width)}"><figcaption>${esc(it.proxy)} (${esc(it.width)}) ${esc(box(it.box))}</figcaption></figure></div>`
    : '<p class="muted">no box to crop</p>';
  return `<div class="item${it.allowedBy ? ' allowed' : ''}" data-kind="${esc(it.kind)}"><div class="head"><code>${esc(it.id)}</code> @${esc(it.width)} <span class="node">${esc(it.node)}</span></div>` +
    `<div class="nums">${itemNumbers(it)}</div>` +
    (it.flags.length ? `<div class="flags">flags: ${esc(it.flags.join('; '))}</div>` : '') +
    (it.allowedBy ? `<div class="ok">allowlisted: ${esc(it.allowedBy)}</div>` : '') + imgs + '</div>';
}

function renderScreen(v) {
  const s = v.summary;
  const parts = [`<section class="screen" id="${anchor(v)}"><h2>${esc(v.file)} · ${esc(s.screen)} <span class="badge ${s.pass ? 'pass' : 'fail'}">${s.pass ? 'pass' : 'fail'}</span></h2>`];
  parts.push(`<p class="muted">width A ${num(v.W[0])}px, B ${num(v.W[1])}px${v.widen && v.widen.unsafe ? ' (unsafe widen)' : ''}; checked ${s.checked}/${s.total}; specBytes ${s.specBytes}${s.payloadOver50k ? ' (payloadOver50k)' : ''}; pixel ${esc((s.pixel || []).map(num).join(' / '))} (reference only)</p>`);
  if (v.unchecked.length) parts.push(`<h3>Unchecked</h3><ul>${v.unchecked.map((u) => `<li><code>${esc(u.id)}</code> ${esc(u.node)}: ${esc(u.reason)}</li>`).join('')}</ul>`);
  if (v.skipped.length) parts.push(`<h3>Skipped layers</h3><p>${esc(v.skipped.join(', '))}</p>`);
  for (const kind of ['root', 'approval', 'crop']) {
    const its = v.items.filter((i) => i.kind === kind);
    if (its.length) parts.push(`<details open><summary><h3>${KIND_TITLE[kind]} (${its.length})</h3></summary>${its.map(renderItem).join('')}</details>`);
  }
  if (v.data.length) {
    parts.push(`<h3>Data findings (${v.data.length})</h3><table><tr><th>node</th><th>kind</th><th>expected</th><th>actual</th></tr>` +
      v.data.map((d) => `<tr><td><code>${esc(d.id)}</code> ${esc(d.node)}</td><td>${esc(d.kind)}${d.side ? ` ${esc(d.side)}` : ''}</td><td>${esc(d.expected)}</td><td>${esc(d.actual)}</td></tr>`).join('') + '</table>');
  }
  const n = v.norm;
  parts.push('<h3>Normalisation</h3>');
  parts.push(n.fontSubs.length
    ? `<table><tr><th>font from</th><th>to</th><th>reason</th></tr>${n.fontSubs.map((f) => `<tr><td>${esc(f.from)}</td><td>${esc(f.to)}</td><td>${esc(f.reason)}</td></tr>`).join('')}</table>`
    : '<p>No font substitutions in capture.</p>');
  if (n.modelSubs.length) parts.push(`<p>Substituted by the Figma model: ${n.modelSubs.map((m) => `<code>${esc(m.id)}</code> ${esc(m.detail)}`).join('; ')}</p>`);
  parts.push(`<p>line-height normal made explicit: ${n.lineHeight == null ? 'not run' : n.lineHeight} element(s)</p>`);
  if (n.original) {
    parts.push(`<div class="pair"><figure><img src="${n.original}" alt="original fonts"><figcaption>original fonts and line heights (A)</figcaption></figure>` +
      `<figure><img src="${n.measured}" alt="as measured"><figcaption>as measured (A, normalised)</figcaption></figure></div>`);
  }
  if (v.mutations) {
    const m = v.mutations;
    parts.push(`<h3>Mutations (allCaught ${esc(String(m.allCaught))})</h3><table><tr><th>kind</th><th>target</th><th>caught</th><th>by</th></tr>` +
      m.results.map((r) => `<tr><td>${esc(r.kind)}</td><td><code>${esc(r.target ?? '')}</code></td><td>${r.caught === null ? `skipped (${esc(r.skipped)})` : esc(String(r.caught))}</td><td>${esc((r.by || []).join(', '))}</td></tr>`).join('') + '</table>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

const CSS = `
:root{--bg:#fafafa;--fg:#1b1b1b;--muted:#666;--line:#ddd;--card:#fff;--pass:#1b7f3b;--fail:#b3261e;--allow:#7a5c00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--card:#1f1f1f;--pass:#5cc27a;--fail:#ff8a80;--allow:#e0c060}}
:root[data-theme="dark"]{--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--card:#1f1f1f;--pass:#5cc27a;--fail:#ff8a80;--allow:#e0c060}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:0 0 6px}h3{font-size:15px;margin:14px 0 6px;display:inline}
.muted{color:var(--muted)}code{font:12px ui-monospace,monospace}
table{border-collapse:collapse;margin:6px 0;max-width:100%}th,td{border:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}
.wrap{overflow-x:auto}
.screen{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:16px 0}
.badge{font-size:12px;padding:1px 6px;border-radius:4px;color:#fff}.badge.pass{background:var(--pass)}.badge.fail{background:var(--fail)}
tr.fail td:last-child{color:var(--fail);font-weight:600}tr.pass td:last-child{color:var(--pass);font-weight:600}
.item{border-top:1px solid var(--line);padding:8px 0}.item.allowed{opacity:.8}.item .ok{color:var(--allow)}
.head .node{color:var(--muted)}.nums,.flags{font-size:13px}
.pair{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}
figure{margin:0;max-width:100%}figure img{display:block;max-width:100%;height:auto;background:#fff;border:1px solid var(--line);image-rendering:pixelated}
figcaption{font-size:12px;color:var(--muted)}
details>summary{cursor:pointer;margin-top:10px}
`;

export function renderReportHtml({ title = 'vuong-design layout report', generated = '', args = {}, screens = [] }) {
  const total = screens.length, passed = screens.filter((v) => v.summary.pass).length;
  const rows = screens.map((v) => {
    const s = v.summary;
    return `<tr class="${s.pass ? 'pass' : 'fail'}"><td><a href="#${anchor(v)}">${esc(v.file)} · ${esc(s.screen)}</a></td><td>${s.checked}/${s.total}</td>` +
      `<td>${s.unexplainedRoots}</td><td>${s.needsApproval}${s.needsApproval ? ` (max ${num(s.approvalMax)})` : ''}</td><td>${s.crop}</td>` +
      `<td>${counts(s.data) || 0}</td><td>${counts(s.flags)}</td><td>${s.specBytes}</td><td>${s.payloadOver50k ? 'yes' : 'no'}</td>` +
      `<td>${s.allowed}</td><td>${s.pass ? 'pass' : 'fail'}</td></tr>`;
  }).join('\n');
  const sum = (k) => screens.reduce((a, v) => a + v.summary[k], 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Layout report</title><style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${esc(generated)} · ${passed}/${total} screens pass · unexplained roots ${sum('unexplainedRoots')} · needs approval ${sum('needsApproval')} · crop fails ${sum('crop')}</p>
<p class="muted">${esc(Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '))}</p>
<div class="wrap"><table><tr><th>screen</th><th>checked</th><th>unexplained roots</th><th>needs approval</th><th>crop fails</th><th>data</th><th>flags</th><th>specBytes</th><th>payloadOver50k</th><th>allowlisted</th><th>pass</th></tr>
${rows}</table></div>
${screens.map(renderScreen).join('\n')}
</body></html>
`;
}
