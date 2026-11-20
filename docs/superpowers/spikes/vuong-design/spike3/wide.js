const pg=figma.root.children.find(p=>p.name==='spike3');await figma.setCurrentPageAsync(pg);
const r2=v=>Math.round(v*100)/100;
const NM=/^(n|sb|fl|mm|rt2?|ls|wr|ab)(\.|$)/;
const read=(root)=>{const R=root.absoluteBoundingBox;const o=[];const v=n=>{if(NM.test(n.name)){const b=n.absoluteBoundingBox;o.push([n.name,r2(b.x-R.x),r2(b.y-R.y),r2(b.width),r2(b.height)])}if('children'in n)for(const c of n.children)v(c)};v(root);return o};
const OUT={};const WB={'spike3-pl0':424,'spike3-c20':452,'spike3-fe0':456,'spike3-pr':440};
// probe: apply the stroke-layout fix the first probe build lacked, then re-read at native width
const pr=pg.children.find(c=>c.name==='spike3-pr');
for(const f of [pr,...pr.findAll(n=>n.type==='FRAME')])if(f.layoutMode!=='NONE')f.strokesIncludedInLayout=false;
OUT.prA=read(pr);
for(const[name,w]of Object.entries(WB)){const r=pg.children.find(c=>c.name===name);const hug=r.layoutSizingVertical==='HUG';r.resize(w,r.height);if(hug)r.layoutSizingVertical='HUG';OUT[name]=read(r)}
const WA={'spike3-pl0':304,'spike3-c20':332,'spike3-fe0':336,'spike3-pr':320};for(const[name,w]of Object.entries(WA)){const r=pg.children.find(c=>c.name===name);const hug=r.layoutSizingVertical==='HUG';r.resize(w,r.height);if(hug)r.layoutSizingVertical='HUG'}
OUT.roots=Object.fromEntries(pg.children.map(c=>[c.name,c.id]));
// stroke x FILL experiment: parent flag x child flag, child0 has 4px inside stroke, both FILL in a 300px row
OUT.sx=[];for(const pf of [false,true])for(const cf of [false,true]){const p=figma.createAutoLayout('HORIZONTAL');pg.appendChild(p);p.x=3000;p.y=OUT.sx.length*40;p.resize(300,20);p.strokesIncludedInLayout=pf;
 const ks=[0,1].map(i=>{const k=figma.createAutoLayout('HORIZONTAL');p.appendChild(k);k.strokesIncludedInLayout=cf;k.layoutSizingHorizontal='FILL';k.layoutSizingVertical='FILL';k.fills=[{type:'SOLID',color:{r:.8,g:.8,b:.8}}];if(i===0){k.strokes=[{type:'SOLID',color:{r:0,g:0,b:1}}];k.strokeWeight=4;k.strokeAlign='INSIDE'}return k});
 OUT.sx.push({pf,cf,w:ks.map(k=>r2(k.width))});p.remove()}
return OUT;
