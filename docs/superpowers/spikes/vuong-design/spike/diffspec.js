// Property-level diff between two build specs, addressed by node order (same order the builder creates them).
const fs=require('fs');const load=f=>JSON.parse(fs.readFileSync(f,'utf8').trim().replace(/^const D=/,'').replace(/;$/,''));
const A=load('out/data2.txt'),B=load('out/data3.txt');const ops=[];
const list=r=>{const L=[];const w=f=>{for(const c of f.c||[]){if(c.k==='SP')continue;L.push(c);if(c.k==='F')w(c)}};w(r);return L};
B.screens.forEach((sc,si)=>{const a=list(A.screens[si].root),b=list(sc.root);if(a.length!==b.length)throw 'shape changed '+sc.code;
 b.forEach((n,i)=>{const o={};for(const k of ['lh','ca','g','p'])if(JSON.stringify(n[k])!==JSON.stringify(a[i][k]))o[k]=n[k]??null;if(Object.keys(o).length)ops.push([si,i,o])})});
fs.writeFileSync('out/ops.json',JSON.stringify(ops));console.log(ops.length,'ops',JSON.stringify(ops).length,'bytes');console.log(JSON.stringify(ops))
