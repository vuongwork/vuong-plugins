const fs = require('fs');
const rep = (file, pairs) => { let s = fs.readFileSync(file, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(file + ' missing: ' + a.slice(0, 60)); s = s.replace(a, b); } fs.writeFileSync(file, s); };
rep('compile.js', [
  // 1. flatten only plain block/inline text whose inline children share the parent's text style
  ["if (textOnly(n) && s.backgroundColor", "const same = (k) => k.t === '#text' || (k.s && k.s.color === s.color && k.s.fontSize === s.fontSize && k.s.fontWeight === s.fontWeight && k.s.display.startsWith('inline') && (!k.k || k.k.every(same)));\n  if (textOnly(n) && !/flex|grid/.test(s.display) && n.k.every(same) && s.backgroundColor"],
  // 4. strikethrough
  ["op: +s.opacity < 1 ? +s.opacity : undefined };", "op: +s.opacity < 1 ? +s.opacity : undefined, td: s.textDecorationLine === 'line-through' ? 'S' : s.textDecorationLine === 'underline' ? 'U' : undefined };"],
  // 2. inline containers flow horizontally
  ["f.l = isGrid ? 'H' : isFlex", "const inl = s.display.startsWith('inline') && !isFlex;\n  f.l = isGrid || (inl && kids.length) ? 'H' : isFlex"],
  // 3. per-side borders
  ["if (px(s.borderTopWidth)) f.st =", "const bw = [px(s.borderTopWidth), px(s.borderRightWidth), px(s.borderLeftWidth) && px(s.borderBottomWidth), px(s.borderLeftWidth)];\n  const bws = [px(s.borderTopWidth), px(s.borderRightWidth), px(s.borderBottomWidth), px(s.borderLeftWidth)];\n  if (bws.some(Boolean) && !bws.every(v => v === bws[0])) f.sides = [col(bws[0] ? s.borderTopColor : s.borderBottomColor), bws];\n  else if (px(s.borderTopWidth)) f.st ="],
  // 6. box larger than its content -> fixed size
  ["const fixedLeaf = !kids.length || s.aw || s.ah;", "const fixedLeaf = !kids.length || s.aw || s.ah;\n  const els = kids.filter(k => k.t !== '#text' && !(k.s && /absolute|fixed/.test(k.s.position)));\n  const pw = px(s.paddingLeft) + px(s.paddingRight), ph = px(s.paddingTop) + px(s.paddingBottom);\n  const cw = els.length ? (f.l === 'H' ? els.reduce((a, k) => a + k.w, 0) : Math.max(...els.map(k => k.w))) : 0, ch = els.length ? (f.l === 'V' ? els.reduce((a, k) => a + k.h, 0) : Math.max(...els.map(k => k.h))) : 0;\n  const bigW = els.length && kids.every(k => k.t !== '#text') && n.w > cw + pw + 2 && f.ja !== 'SB', bigH = els.length && kids.every(k => k.t !== '#text') && n.h > ch + ph + 2 && f.l === 'H';"],
  ["f.sw = (pl === 'G' ? n.grow : pl === 'H' ? +s.flexGrow > 0 : n.grow) ? 'F' : (fixedLeaf ? 'X' : 'H');", "f.sw = (pl === 'G' ? n.grow : pl === 'H' ? +s.flexGrow > 0 : n.grow) ? 'F' : (fixedLeaf || bigW ? 'X' : 'H');"],
  ["f.sv = (s.ah || !kids.length) ? 'X' : 'H';", "f.sv = (s.ah || !kids.length || bigH) ? 'X' : 'H';"],
]);
rep('runtime.js', [
  // 5. icons: stroke inherited from CSS
  ["if(s.cl)svg=svg.replace(/currentColor/g,s.cl);", "if(s.cl)svg=svg.replace(/currentColor/g,s.cl).replace('<svg ',`<svg stroke=\"${s.cl}\" `);"],
  ["if(s.ta)t.textAlignHorizontal", "if(s.td)t.textDecoration=s.td==='S'?'STRIKETHROUGH':'UNDERLINE';if(s.ta)t.textAlignHorizontal"],
  ["else if(s.sb){", "else if(s.sides){f.strokes=[paint(s.sides[0])];[f.strokeTopWeight,f.strokeRightWeight,f.strokeBottomWeight,f.strokeLeftWeight]=s.sides[1]}\n else if(s.sb){"],
  ["if(!a)size(f,s,par);return f}", "if(!a)size(f,s,par);if(s.sw==='X'&&isAL(par)&&isAL(f))f.layoutSizingHorizontal='FIXED';if(s.sv==='X'&&isAL(par)&&isAL(f))f.layoutSizingVertical='FIXED';return f}"],
  // rerun: remove previous spike output first
  ["async function run(D){D0=D;", "async function run(D){D0=D;for(const id of D.remove||[]){const n=await figma.getNodeByIdAsync(id);if(n)n.remove()}"],
]);
console.log('patched');
