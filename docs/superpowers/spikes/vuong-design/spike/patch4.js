const fs = require('fs');
const edit = (file, pairs) => { let s = fs.readFileSync(file, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(file + ' missing: ' + a.slice(0, 60)); s = s.replace(a, b); } fs.writeFileSync(file, s); };
edit('extract.js', [["'textDecorationLine', 'alignSelf']", "'textDecorationLine', 'alignSelf', 'marginLeft', 'marginRight']"]]);
edit('compile.js', [
  // 3. explicit line height = measured height of a single-line text element (avoids Figma rounding "normal")
  ["const t = textSpec(n, s, flat(n),", "if (s.lineHeight === 'normal' && n.h < px(s.fontSize) * 1.9) s.lineHeight = n.h + 'px';\n    const t = textSpec(n, s, flat(n),"],
  // 1. single-line mixed text + elements: center on the cross axis, gap from the elements' horizontal margins
  ["  for (const ch of kids) {\n    if (ch.t === '#text') {",
   `  if (f.l === 'H' && !geo && !isFlex && kids.some(k => k.t === '#text')) { f.ca = 'C'; const m = Math.max(0, ...kids.filter(k => k.s).map(k => px(k.s.marginRight) + px(k.s.marginLeft))); if (m) f.g = m; if (s.lineHeight === 'normal') s.lineHeight = n.h + 'px'; }
  for (const ch of kids) {
    if (ch.t === '#text') {`],
  // 2. invisible FILL child narrower than its column: absorb side margins into its own padding
  ["    if (spacerBefore.has(ch)) {",
   `    if (f.l === 'V' && cs.k === 'F' && cs.sw === 'F' && !cs.fill && !cs.st && !cs.sides && ch.w < (cx1 - cx0) - 1) { const ml = +(ch.x - cx0).toFixed(1), mr = +(cx1 - ch.x - ch.w).toFixed(1); cs.p = cs.p || [0, 0, 0, 0]; cs.p[3] += ml; cs.p[1] += mr; cs.w = +(cx1 - cx0).toFixed(1); }
    if (spacerBefore.has(ch)) {`],
]);
console.log('patched');
