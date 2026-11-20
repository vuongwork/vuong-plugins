// Proxy render: spec → HTML whose flexbox semantics mirror Figma auto layout.
// border-box everywhere, no margins, frame = flex, FILL primary = flex:1 1 0 + min 0, FILL counter = align-self:stretch,
// HUG = flex:none + auto, FIXED = px, absolute = left/top (or constraint) relative to parent frame, strokes = overlay (no layout).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const AL = { S: 'flex-start', C: 'center', E: 'flex-end' };

function buildHtml(scr, spec, svgOf) {
  const rules = [];
  let ruleN = 0;
  const fontCss = (f) => `font-family:${f.ff};font-size:${f.fs};font-weight:${f.fw};font-style:${f.fst};line-height:${f.lh}px;` +
    `letter-spacing:${f.ls === 'normal' ? '0px' : f.ls};color:${f.c};text-decoration-line:${f.td};text-transform:${f.tt};`;
  const runCss = (s) => {
    const m = { c: 'color', ff: 'font-family', fs: 'font-size', fw: 'font-weight', fst: 'font-style', ls: 'letter-spacing', td: 'text-decoration-line', tt: 'text-transform' };
    return Object.entries(s).map(([k, v]) => `${m[k]}:${v}`).join(';');
  };
  const node = (n, parent, isRoot) => {
    const st = ['box-sizing:border-box', 'margin:0', `min-width:${n.minW || 0}px`, `min-height:${n.minH || 0}px`];
    if (n.maxW) st.push(`max-width:${n.maxW}px`); if (n.maxH) st.push(`max-height:${n.maxH}px`);
    const pl = parent && parent.lay;
    if (isRoot) { st.push('position:relative', 'width:var(--W)', n.sz[1] === 'X' ? `height:${n.h}px` : 'height:auto'); }
    else if (n.abs) {
      st.push('position:absolute');
      const pw = parent.w, ph = parent.h, a = n.abs;
      const hz = (con, x, w, P, L, R, Wd) => {
        con = con.replace('?', '');
        const t = n.sz[Wd] === 'H' && con !== 'LR' ? [] : [`${Wd ? 'height' : 'width'}:${Wd ? n.h : n.w}px`];
        if (con === 'LR') return [`${L}:${x}px`, `${R}:${r(P - x - (Wd ? n.h : n.w))}px`];
        if (con === 'R') return [`${R}:${r(P - x - (Wd ? n.h : n.w))}px`, ...t];
        if (con === 'C') return [`${L}:calc(50% + ${r(x - P / 2)}px)`, ...t];
        if (con === 'SC') return [`${L}:${r(100 * x / P)}%`, ...t];
        if (con === 'SCW') return [`${L}:${r(100 * x / P)}%`, `${Wd ? 'height' : 'width'}:${r(100 * (Wd ? n.h : n.w) / P)}%`];
        return [`${L}:${x}px`, ...t];
      };
      st.push(...hz(a.cx, a.x, n.w, pw, 'left', 'right', 0), ...hz(a.cy, a.y, n.h, ph, 'top', 'bottom', 1));
      if (n.t === 'T' && n.sz[0] === 'H') st.push('white-space:nowrap');
    } else {
      st.push('position:relative');
      const d = pl.d; const [sx, sy] = n.sz;
      const prim = d === 'H' ? sx : sy, cnt = d === 'H' ? sy : sx;
      const PW = d === 'H' ? 'width' : 'height', CW = d === 'H' ? 'height' : 'width';
      const pv = d === 'H' ? n.w : n.h, cv = d === 'H' ? n.h : n.w;
      if (prim === 'F') st.push('flex:1 1 0px'); else st.push('flex:0 0 auto', prim === 'X' ? `${PW}:${pv}px` : `${PW}:auto`);
      if (cnt === 'F') st.push('align-self:stretch'); else if (cnt === 'X') st.push(`${CW}:${cv}px`);
    }
    if (n.t === 'T' && !n.abs && n.sz[0] === 'H') st.push('white-space:nowrap');
    if (n.t === 'T' && n.sz[0] !== 'H') st.push('white-space:normal', 'overflow-wrap:normal');
    // paint
    const p = n.p || {};
    if (p.bg) st.push(`background-color:${p.bg}`);
    if (p.bgi) st.push(`background-image:${p.bgi}`);
    if (p.rad) st.push(`border-radius:${p.rad.join(' ')}`);
    if (p.sh) st.push(`box-shadow:${p.sh}`);
    if (p.op) st.push(`opacity:${p.op}`);
    if (p.clip) st.push('overflow:hidden');
    if (p.tf) st.push(`transform:${p.tf}`, `transform-origin:${p.to}`);
    if (p.filt) st.push(`filter:${p.filt}`);
    if (p.cpath) st.push(`clip-path:${p.cpath}`);
    const cls = [];
    if (p.bd) {
      const k = 'k' + (ruleN++); cls.push(k);
      const b = p.bd.map(x => x || [0, 'none', 'transparent']);
      st.push('isolation:isolate');
      rules.push(`.${k}::before{content:"";position:absolute;inset:0;pointer-events:none;box-sizing:border-box;border-radius:inherit;z-index:-1;` +
        `border-width:${b.map(x => x[0] + 'px').join(' ')};border-style:${b.map(x => x[0] ? x[1] : 'none').join(' ')};border-color:${b.map(x => x[2]).join(' ')}}`);
    }
    if (p.outline) st.push(`outline:${p.outline}`);
    const idAttr = n.syn ? `data-g="${n.id}"` : `data-id="${n.id}"`;
    let inner = '';
    if (n.t === 'F' && n.lay && n.lay.d) {
      const l = n.lay;
      st.push('display:flex', `flex-direction:${l.d === 'H' ? 'row' : 'column'}`, `padding:${l.p.map(v => v + 'px').join(' ')}`);
      if (l.wrap) st.push('flex-wrap:wrap', `gap:${l.cg}px ${l.g}px`, 'align-content:flex-start');
      else if (l.sb) st.push('justify-content:space-between');
      else st.push(`gap:${l.g}px`, `justify-content:${AL[l.pa]}`);
      st.push(`align-items:${AL[l.ca]}`);
    } else if (n.t === 'F') st.push('display:block');
    if (n.t === 'T') {
      st.push(fontCss(n.font), `text-align:${/center/.test(n.font.ta) ? 'center' : /right|end/.test(n.font.ta) ? 'right' : 'left'}`);
      inner = n.runs.map(rn => rn.br ? '<br>' : rn.s ? `<span style="${runCss(rn.s).replace(/"/g, '&quot;')}">${esc(rn.t)}</span>` : esc(rn.t)).join('');
    } else if (n.t === 'V') {
      const sv = n.sv || {};
      const svg = svgOf(n.svgRef).replace(/^<svg\b/, `<svg style="display:block;width:100%;height:100%;stroke:${sv.stroke};fill:${sv.fill};stroke-width:${sv.sw};color:${sv.c}"`);
      inner = svg;
    } else if (n.t === 'R') {
      st.push(fontCss(n.font), 'white-space:nowrap', 'text-align:center', 'overflow:visible');
      inner = esc(n.name);
    } else if (n.t === 'I') {
      inner = `<img src="${n.src}" style="display:block;width:100%;height:100%;object-fit:${n.fit}">`;
    }
    if (n.kids) inner += n.kids.map(k => node(k, n, false)).join('');
    return `<div ${idAttr}${cls.length ? ` class="${cls.join(' ')}"` : ''} style="${st.join(';').replace(/"/g, '&quot;')}">${inner}</div>`;
  };
  const r = (v) => Math.round(v * 100) / 100;
  const body = node(spec, null, true);
  return `<!doctype html><html><head><meta charset="utf-8">${scr.links.map(h => `<link rel="stylesheet" href="${h}">`).join('')}
<style>html,body{margin:0;padding:0;background:${scr.backdrop}} body>div{margin:0} ${rules.join('\n')}</style></head>
<body><svg width="0" height="0" style="position:absolute">${scr.symbols.join('')}</svg>${body}</body></html>`;
}
module.exports = { buildHtml };
