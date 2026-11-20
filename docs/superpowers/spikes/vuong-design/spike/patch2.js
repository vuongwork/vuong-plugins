const fs = require('fs');
let s = fs.readFileSync('compile.js', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing ' + a.slice(0, 50)); s = s.replace(a, b); };
rep("if (n.t === 'svg') return { k: 'S',", "if (n.t === 'svg') return { _b: [n.x, n.y, n.w, n.h], k: 'S',");
rep("const f = { k: 'F', n:", "const f = { _b: [n.x, n.y, n.w, n.h], k: 'F', n:");
rep("if (abs) t.ab = [n.x - parent.x, n.y - parent.y];", "t._b = [n.x, n.y, n.w, n.h]; if (abs) t.ab = [n.x - parent.x, n.y - parent.y];");
rep("fs.writeFileSync(path.join(O, 'build.json'), JSON.stringify(build));",
`const exp = {}; for (const sc of build.screens) { const L = []; const w = (f) => { for (const c of f.c || []) { if (c.k === 'SP') continue; L.push([c.n, ...(c._b || [null, null, null, null])]); if (c.k === 'F') w(c); } }; w(sc.root); exp[sc.name] = L; }
fs.writeFileSync(path.join(O, 'expected.json'), JSON.stringify(exp));
const noPriv = (k, v) => k.startsWith('_') ? undefined : v;
fs.writeFileSync(path.join(O, 'build.json'), JSON.stringify(build, noPriv));`);
rep("JSON.stringify(build) + ';", "JSON.stringify(build, noPriv) + ';");
rep("dataBytes: JSON.stringify(build).length", "dataBytes: JSON.stringify(build, noPriv).length");
fs.writeFileSync('compile.js', s);
console.log('ok');
