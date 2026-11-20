// Geometry-driven layout: derive padding, gaps, cross-axis alignment and pushed/overflowing children
// from measured boxes instead of interpreting each CSS margin/grid/transform rule.
const fs = require('fs');
const edit = (file, pairs) => { let s = fs.readFileSync(file, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(file + ' missing: ' + a.slice(0, 60)); s = s.replace(a, b); } fs.writeFileSync(file, s); };
edit('compile.js', [
  ["  if (isGrid) f.ja = 'SB';\n", ""],
  // wrapped text element that does not grow keeps its measured width
  ["    if (s.aw) { t.sw = 'X'; t.w = n.w; }", "    if (s.aw || (t.sw !== 'F' && n.h > px(s.fontSize) * 1.9)) { t.sw = 'X'; t.w = n.w; }"],
  ["  const out = [];\n  let prev = null;\n  for (const ch of kids) {\n    if (ch.t === '#text') { out.push(textSpec(n, s, ch.text, f.l === 'V')); continue; }\n    const cs = spec(ch, n, isGrid ? 'G' : f.l);\n    if (f.l === 'V' && !isFlex && prev && !cs.ab) {",
`  const out = [];
  let prev = null;
  const cx0 = n.x + px(s.paddingLeft) + px(s.borderLeftWidth), cy0 = n.y + px(s.paddingTop) + px(s.borderTopWidth);
  const cx1 = n.x + n.w - px(s.paddingRight) - px(s.borderRightWidth), cy1 = n.y + n.h - px(s.paddingBottom) - px(s.borderBottomWidth);
  const outside = (k) => k.y < n.y - 0.5 || k.y + k.h > n.y + n.h + 0.5 || k.x < n.x - 0.5 || k.x + k.w > n.x + n.w + 0.5;
  const flow = kids.filter(k => k.t !== '#text' && !(k.s && /absolute|fixed/.test(k.s.position)) && !outside(k));
  const Hz = f.l === 'H', geo = f.l && flow.length && kids.every(k => k.t !== '#text');
  let spacerBefore = new Map();
  if (geo) {
    const st = k => Hz ? k.x : k.y, en = k => Hz ? k.x + k.w : k.y + k.h;
    const gaps = flow.slice(1).map((k, i) => +(st(k) - en(flow[i])).toFixed(1));
    const lead = +(st(flow[0]) - (Hz ? cx0 : cy0)).toFixed(1), trail = +((Hz ? cx1 : cy1) - en(flow[flow.length - 1])).toFixed(1);
    if (!['SB', 'C', 'E'].includes(f.ja) && lead > 0.5) { f.p = f.p || [0, 0, 0, 0]; f.p[Hz ? 3 : 0] = +(f.p[Hz ? 3 : 0] + lead).toFixed(1); }
    if (f.ja !== 'SB' && gaps.length) {
      const sorted = [...gaps].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const uniq = [...new Set(gaps.map(g => Math.round(g * 2) / 2))];
      if (uniq.length === 1 && uniq[0] >= 0) { if (uniq[0]) f.g = uniq[0]; else delete f.g; }
      else { delete f.g; gaps.forEach((g, i) => { const pushed = trail < 0.5 && g > med + 8 && i === gaps.length - 1; if (pushed) spacerBefore.set(flow[i + 1], { k: 'SP', fill: 1 }); else if (g > 0.5) spacerBefore.set(flow[i + 1], Hz ? { k: 'SP', w: g } : { k: 'SP', h: g }); }); }
    }
    const c0 = Hz ? cy0 : cx0, c1 = Hz ? cy1 : cx1, cst = k => Hz ? k.y : k.x, csz = k => Hz ? k.h : k.w;
    const spans = flow.every(k => Math.abs(csz(k) - (c1 - c0)) < 1);
    if (!spans) {
      const dev = (m) => Math.max(...flow.map(k => Math.abs(m === 'S' ? cst(k) - c0 : m === 'E' ? c1 - (cst(k) + csz(k)) : (cst(k) + csz(k) / 2) - (c0 + c1) / 2)));
      const best = ['S', 'C', 'E'].map(m => [m, dev(m)]).sort((a, b) => a[1] - b[1])[0];
      f.ca = best[0]; if (best[1] > 1.5) stats.crossDeviation = (stats.crossDeviation || 0) + 1;
    }
  }
  for (const ch of kids) {
    if (ch.t === '#text') { const t = textSpec(n, s, ch.text, f.l === 'V'); if (f.sw !== 'F' && f.l === 'V') { t.sw = 'X'; t.w = +(cx1 - cx0).toFixed(1); } out.push(t); continue; }
    const cs = spec(ch, n, isGrid ? 'G' : f.l);
    if (!cs.ab && ch.t !== '#text' && outside(ch)) { cs.ab = [+(ch.x - n.x).toFixed(1), +(ch.y - n.y).toFixed(1)]; stats.outside = (stats.outside || 0) + 1; }
    if (spacerBefore.has(ch)) { out.push(spacerBefore.get(ch)); stats.spacers++; }
    if (!geo && f.l === 'V' && !isFlex && prev && !cs.ab) {`],
]);
edit('runtime.js', [
  ["if(s.k==='SP'){const f=figma.createFrame();f.name='spacer';f.fills=[];f.resize(1,s.h);par.appendChild(f);if(isAL(par))f.layoutSizingHorizontal='FILL';return f}",
   "if(s.k==='SP'){const f=figma.createFrame();f.name='spacer';f.fills=[];f.resize(s.w||1,s.h||1);par.appendChild(f);if(isAL(par)){const hz=par.layoutMode==='HORIZONTAL';if(s.fill){if(hz)f.layoutSizingHorizontal='FILL';else f.layoutSizingVertical='FILL'}else if(!hz)f.layoutSizingHorizontal='FILL'}return f}"],
]);
console.log('patched');
