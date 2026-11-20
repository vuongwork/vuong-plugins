const D=__DATA__;
const WN={100:['Thin'],200:['ExtraLight','Extra Light'],300:['Light'],400:['Regular'],500:['Medium'],600:['SemiBold','Semi Bold'],700:['Bold'],800:['ExtraBold','Extra Bold'],900:['Black']};
const AV=new Map();for(const f of await figma.listAvailableFontsAsync()){const k=f.fontName.family;if(!AV.has(k))AV.set(k,new Set());AV.get(k).add(f.fontName.style)}
const USED={},LOADED=new Set(),ERR=[];
async function fn(fk,w,it){const fams=D.FM[fk];let fam=fams.find(x=>AV.has(x))||'Inter';const st=AV.get(fam)||new Set(['Regular']);
 let s=(WN[w]||['Regular']).find(x=>st.has(x+(it?' Italic':'')));if(!s){const ws=Object.keys(WN).map(Number).sort((a,b)=>Math.abs(a-w)-Math.abs(b-w));for(const v of ws){s=WN[v].find(x=>st.has(x));if(s)break}}
 const n={family:fam,style:s||'Regular'};const k=n.family+'|'+n.style;if(!LOADED.has(k)){await figma.loadFontAsync(n);LOADED.add(k)}USED[fk+'@'+w]=k;return n}
const hx=h=>{const v=parseInt(h.slice(1),16),a=h.length>7;return a?{c:{r:(v>>>24&255)/255,g:(v>>>16&255)/255,b:(v>>>8&255)/255},a:(v&255)/255}:{c:{r:(v>>16&255)/255,g:(v>>8&255)/255,b:(v&255)/255},a:1}};
const P=i=>{const x=hx(D.C[i]);return{type:'SOLID',color:x.c,opacity:x.a}};
const isAL=n=>n&&'layoutMode'in n&&n.layoutMode!=='NONE';
const AX={S:'MIN',C:'CENTER',E:'MAX'},CN={L:'MIN',R:'MAX',LR:'STRETCH',C:'CENTER',SC:'SCALE',SCW:'SCALE'};
const REG=[],ABS=[];
const place=(n,s)=>{n.x=s.a[0];n.y=s.a[1];if(s.tf){const[a,b,c,d,ox,oy]=s.tf;const x=s.a[0],y=s.a[1];n.relativeTransform=[[a,c,x+ox-(a*ox+c*oy)],[b,d,y+oy-(b*ox+d*oy)]]}n.constraints={horizontal:CN[s.a[2]]||'MIN',vertical:CN[s.a[3]]||'MIN'}};
async function text(s,t){const F=D.F[s.f];const base=await fn(F[0],F[1],F[9]);t.fontName=base;
 const runs=typeof s.x==='string'?[[s.x]]:s.x;t.characters=runs.map(r=>r[0]).join('');
 t.fontSize=F[2];t.lineHeight=F[3]?{unit:'PIXELS',value:F[3]}:{unit:'AUTO'};if(F[4])t.letterSpacing={unit:'PIXELS',value:F[4]};
 t.fills=[P(F[5])];if(F[6])t.textDecoration=F[6]==='l'?'STRIKETHROUGH':'UNDERLINE';if(F[7])t.textCase=F[7];if(F[8])t.textAlignHorizontal=F[8];
 let i=0;for(const r of runs){const e=i+r[0].length,o=r[1];if(o&&e>i){if(o.fs)t.setRangeFontSize(i,e,o.fs);if(o.fw||o.fk)t.setRangeFontName(i,e,await fn(o.fk||F[0],o.fw||F[1],o.it));
  if(o.c!==undefined)t.setRangeFills(i,e,[P(o.c)]);if(o.ls!==undefined)t.setRangeLetterSpacing(i,e,{unit:'PIXELS',value:o.ls})}i=e}}
async function mk(s,par){let n;
 if(s.t==='T'||s.t==='R'){n=figma.createText();await text(s,n)}
 else if(s.t==='V'){const ic=D.I[s.v[0]],[,st,fl,sw,cc]=s.v;
  n=figma.createNodeFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}" viewBox="${ic[0]}"><g stroke="${D.C[st]}" fill="${D.C[fl]}" stroke-width="${sw}" color="${D.C[cc]}">${ic[1].replace(/currentColor/g,D.C[cc])}</g></svg>`.replace(/"(#[0-9a-f]{6})([0-9a-f]{2})"/g,'"$1"'));
  n.fills=[]}
 else{n=figma.createFrame();n.fills=[];n.clipsContent=!!s.c;
  if(s.l){const[d,pt,pr,pb,pl,g,pa,ca,sb,wr,cg]=s.l;n.layoutMode=d==='H'?'HORIZONTAL':'VERTICAL';n.strokesIncludedInLayout=false;n.paddingTop=pt;n.paddingRight=pr;n.paddingBottom=pb;n.paddingLeft=pl;n.itemSpacing=g||0;
   n.primaryAxisAlignItems=sb?'SPACE_BETWEEN':AX[pa];n.counterAxisAlignItems=AX[ca];if(wr){n.layoutWrap='WRAP';n.counterAxisSpacing=cg||0}}}
 n.name=s.n||'w';
 if(s.t!=='T'||s.s[0]!=='H')n.resize(Math.max(s.w,.01),Math.max(s.h,.01));
 if(s.t!=='T'&&s.t!=='R'){if(s.bg!==undefined)n.fills=[P(s.bg)];
  if(s.rd){const[a,b,c,d]=s.rd;if(a===b&&b===c&&c===d)n.cornerRadius=a;else{n.topLeftRadius=a;n.topRightRadius=b;n.bottomRightRadius=c;n.bottomLeftRadius=d}}
  if(s.bd){const[ws,ci,dash]=s.bd;n.strokes=[P(ci)];n.strokeAlign='INSIDE';n.strokeTopWeight=ws[0];n.strokeRightWeight=ws[1];n.strokeBottomWeight=ws[2];n.strokeLeftWeight=ws[3];if(dash)n.dashPattern=[Math.max(...ws)*3,Math.max(...ws)*3]}
  if(s.sh)n.effects=s.sh.map(([ci,x,y,b,sp])=>{const q=hx(D.C[ci]);return{type:'DROP_SHADOW',color:{...q.c,a:q.a},offset:{x,y},radius:b,spread:sp,visible:true,blendMode:'NORMAL'}})}
 if(s.op!==undefined)n.opacity=s.op;
 if(par)par.appendChild(n);
 if(s.a&&par){if(isAL(par))n.layoutPositioning='ABSOLUTE';n.constraints={horizontal:'MIN',vertical:'MIN'};n.x=s.a[0];n.y=s.a[1];ABS.push([n,s])}
 if(s.t==='T'){if(s.s[0]==='H')n.textAutoResize='WIDTH_AND_HEIGHT';else n.textAutoResize=s.s[1]==='H'?'HEIGHT':'NONE'}
 if(s.t==='R'){n.textAutoResize='NONE';n.textAlignHorizontal='CENTER'}
 if(par&&isAL(par)&&!s.a){const M={F:'FILL',H:'HUG',X:'FIXED'};const canH=isAL(n)||n.type==='TEXT';
  const h=M[s.s[0]],v=M[s.s[1]];n.layoutSizingHorizontal=h==='HUG'&&!canH?'FIXED':h;n.layoutSizingVertical=v==='HUG'&&!canH?'FIXED':v}
 else if(isAL(n)){if(s.s[0]==='H')n.layoutSizingHorizontal='HUG';if(s.s[1]==='H')n.layoutSizingVertical='HUG'}
 if(s.m){const[a,b,c,d]=s.m;if(a)n.minWidth=a;if(b)n.maxWidth=b;if(c)n.minHeight=c;if(d)n.maxHeight=d}
 if(s.o!==undefined)REG.push([s.o,n]);
 for(const k of s.k||[]){try{await mk(k,n)}catch(e){ERR.push((k.n||'w')+': '+String(e).slice(0,140))}}
 return n}
const pg=figma.root.children.find(p=>p.name==='spike3')||(()=>{const p=figma.createPage();p.name='spike3';return p})();
await figma.setCurrentPageAsync(pg);
for(const c of pg.children.filter(c=>c.name===D.name))c.remove();
const root=await mk(D.T,null);root.name=D.name;pg.appendChild(root);root.x=D.X;root.y=0;
for(const[n,s]of ABS)place(n,s);
const R=root.absoluteBoundingBox,r2=v=>Math.round(v*100)/100;const B=[];
for(const[o,n]of REG){const b=n.absoluteBoundingBox;B[o]=b?[r2(b.x-R.x),r2(b.y-R.y),r2(b.width),r2(b.height)]:null}
const OUT={page:pg.id,root:root.id,B,USED,ERR};
__EXTRA__
return OUT;
