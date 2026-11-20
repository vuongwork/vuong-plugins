const ir=require('./out/ir.json')[process.argv[2]]; const want=process.argv[3];
const f=(n)=>{ if(n.id===want) return n; for(const k of n.kids||[]){const r=f(k); if(r) return r;} };
const pr=(n,d)=>{ console.log(' '.repeat(d*2)+n.id,n.k,n.tag,n.cls||'','r',JSON.stringify(n.r),'rB',JSON.stringify(n.rB),n.lines?('lines '+n.lines+'/'+n.linesB+' tw '+n.tw):'', n.runs?JSON.stringify(n.runs).slice(0,80):''); (n.kids||[]).forEach(k=>pr(k,d+1))};
pr(f(ir.tree),0);
const sp=require('./out/spec-'+process.argv[2]+'.json');
const g=(n)=>{ if(n.id===want) return n; for(const k of n.kids||[]){const r=g(k); if(r) return r;} };
const ps=(n,d)=>{ const {kids,runs,font,sv,p,...rest}=n; console.log(' '.repeat(d*2)+JSON.stringify(rest)); (kids||[]).forEach(k=>ps(k,d+1))};
ps(g(sp),0);
