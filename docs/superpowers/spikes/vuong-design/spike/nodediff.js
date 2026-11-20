// Node-level comparison: same build order on both sides. Report root causes: a node whose own offset differs from its parent's offset.
const exp=require('./out/expected.json'),act=require('./out/actual.json');
for(const scr of Object.keys(exp)){const E=exp[scr],A=act[scr];// actual[0] is the screen frame
 console.log(`== ${scr}: expected ${E.length} nodes, figma ${A.length}`);
 const bad=[];const unchecked=E.filter((e,i)=>e[1]===null||!A[i]).length;E.forEach((e,i)=>{const a=A[i];if(!a||e[1]===null)return;const d=[a[0]-e[1],a[1]-e[2],a[2]-e[3],a[3]-e[4]].map(v=>+v.toFixed(1));
  const tol=e[0]&&/^(t|m|sub|h1|sec|span|b|a|on|badge|bubble|btn p|chip a)$/.test(e[0])?1.5:0.6; // text-ish names get font tolerance
  if(d.some(v=>Math.abs(v)>tol))bad.push([i,e[0],d,e.slice(1),a])});
 // root cause = first bad node whose position delta differs from the previous reported one (errors cascade down/right)
 let last=null;for(const b of bad){const k=b[2].slice(0,2).join(',');if(k!==last){console.log(`#${b[0]} ${b[1]} d(x,y,w,h)=${b[2].join(',')} html=${b[3].join(',')} fig=${b[4].join(',')}`);last=k}}
 console.log(`${bad.length} nodes outside tolerance, ${unchecked} UNCHECKED (no reference box)`);}
