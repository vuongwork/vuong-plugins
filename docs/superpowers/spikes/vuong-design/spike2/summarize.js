const R=require('./out/report.json');
const agg={}; let tot={n:0,a:0,b:0,chk:0,drop:0,merged:0};
console.log('| screen | nodes | coverage | A within tol | B within tol | root causes A/B | pixel diff A/B | spec bytes |');
for (const [id,r] of Object.entries(R)) {
  console.log(`| ${id} ${r.name.slice(0,26)} | ${r.nodes} | ${r.checked}/${r.nodes} | ${(100*r.passA/r.nodes).toFixed(1)}% | ${(100*r.passB/r.nodes).toFixed(1)}% | ${r.rootsA.length}/${r.rootsB.length} | ${(100*r.pix.A).toFixed(2)}%/${(100*r.pix.B).toFixed(2)}% | ${r.payload} |`);
  tot.n+=r.nodes; tot.a+=r.passA; tot.b+=r.passB; tot.chk+=r.checked; tot.drop+=r.dropped.length; tot.merged+=r.merged;
  for (const [k,v] of Object.entries(r.stats)) if (typeof v==='number') agg[k]=(agg[k]||0)+v;
}
console.log('TOTAL nodes',tot.n,'checked',tot.chk,'A',(100*tot.a/tot.n).toFixed(1),'B',(100*tot.b/tot.n).toFixed(1),'dropped',tot.drop,'merged spans',tot.merged);
console.log(JSON.stringify(agg));
for (const k of ['proxEx','pushEx','alignWrapEx','unequalFillEx','sbUnevenEx','primaryMisEx','counterMisEx','allAbsEx']) { const ex=Object.entries(R).flatMap(([id,r])=>(r.stats[k]||[]).map(e=>id+' '+e)); console.log(k, ex.length, ex.slice(0,8).join(' ;; ')); }
