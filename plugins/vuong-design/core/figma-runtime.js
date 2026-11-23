// vuong-design builder (plan 3 Task 5): the code of a use_figma call. D: figma-encode.mjs header. Result, build order,
// signature: README "Figma runtime". S: screen state; e: encoded node, o: its id, v: its bindings.
const D = __DATA__;
const F=figma,U=undefined,MX=F.mixed,BF='bind-failed',BK='#000000',r2=v=>Math.round(v*100)/100+0,VM=new Map,VN=new Map,SM=new Map,SN=new Map,FC={},LD=new Set,AV=new Map,
WN='Thin ExtraLight Light Regular Medium SemiBold Bold ExtraBold Black'.split(' '),WL=WN.map(x=>x.toLowerCase());
for(const v of await F.variables.getLocalVariablesAsync())VM.set(v.name,v)&&VN.set(v.id,v.name);
for(const s of[...await F.getLocalTextStylesAsync(),...await F.getLocalEffectStylesAsync()])SM.set(s.name,s)&&SN.set(s.id,s.name);
const wt=s=>{const k=s.toLowerCase().replace(/[\s_-]/g,''),i=/italic|oblique/.test(k);return[WL.indexOf(k.replace(/italic|oblique/,'')||'regular')*100+100,i]};
for(const{fontName:f}of await F.listAvailableFontsAsync()){const[w,it]=wt(f.style);if(w)(AV.get(f.family)||AV.set(f.family,[]).get(f.family)).push({s:f.style,w,it})}
let S;
const font=async(i,o)=>{let r=FC[i];
if(!r){const[fa,w,x]=D.F[i],it=!!x,fm=AV.has(fa)?fa:'Inter',p=(AV.get(fm)||[]).slice().sort((a,b)=>(a.it!=it)-(b.it!=it)||Math.abs(a.w-w)-Math.abs(b.w-w))[0]||{s:'Regular'},u=fm+' '+p.s;
r=FC[i]={f:{family:fm,style:p.s},m:fm==fa&&p.w==w&&p.it==it?0:{family:fa,style:(WN[w/100-1]||w)+(it?' Italic':''),used:u}};
if(!LD.has(u)){await F.loadFontAsync(r.f);LD.add(u)}}
if(r.m&&!S.fm.some(m=>m.o==o&&m.style==r.m.style&&m.family==r.m.family))S.fm.push({o,...r.m});
return r.f},
rgb=h=>{const v=parseInt(h.slice(1,7),16);return{r:(v>>16&255)/255,g:(v>>8&255)/255,b:(v&255)/255}},al=h=>h[7]?parseInt(h.slice(7),16)/255:1,
ra=h=>({...rgb(h),a:al(h)}),P=h=>al(h)<1?{type:'SOLID',color:rgb(h),opacity:al(h)}:{type:'SOLID',color:rgb(h)},PC=i=>P(i==U?BK:D.C[i]),
x2=v=>Math.round(v*255).toString(16).padStart(2,'0'),
pl=ps=>{if(ps==MX||!ps)return;const a=ps.filter(p=>p.visible!==false).map(p=>p.type=='SOLID'?'#'+x2(p.color.r)+x2(p.color.g)+x2(p.color.b)+(p.opacity<1?x2(p.opacity):''):p.type);return a[0]?a:U},
NI=o=>S.i[o]||(S.i[o]={}),ub=(o,prop,name,reason)=>(NI(o).u=NI(o).u||[]).push({prop,name,reason}),
gv=(o,k,i)=>{if(i==U)return;const v=VM.get(D.V[i]);v||ub(o,k,D.V[i],'missing-in-file');return v},
bn=(o,k,i,n,f)=>{const v=gv(o,k,i);if(v)try{n.setBoundVariable(f,v)}catch(x){ub(o,k,v.name,BF)}},
bv=(o,k,v,p)=>{if(v)try{return F.variables.setBoundVariableForPaint(p,'color',v)}catch(x){ub(o,k,v.name,BF)}return p},
bp=(o,k,i,p)=>bv(o,k,gv(o,k,i),p),
sty=async(o,k,i,f)=>{const s=SM.get(D.S[i]);if(!s)return ub(o,k,D.S[i],'missing-in-file');try{await f(s.id)}catch(x){ub(o,k,D.S[i],BF)}},
isAL=n=>!!n&&n.type=='FRAME'&&n.layoutMode!='NONE',SZ={F:'FILL',H:'HUG',X:'FIXED'},AX={C:'CENTER',E:'MAX',B:'BASELINE'},
K={L:'MIN',T:'MIN',R:'MAX',B:'MAX',LR:'STRETCH',TB:'STRETCH',C:'CENTER',SCALE:'SCALE'},
TD={U:'UNDERLINE',S:'STRIKETHROUGH'},TT={U:'UPPER',L:'LOWER',T:'TITLE'},TA={C:'CENTER',R:'RIGHT',J:'JUSTIFIED'},
CO=['topLeftRadius','topRightRadius','bottomRightRadius','bottomLeftRadius'],SI=['Top','Right','Bottom','Left'].map(s=>'stroke'+s+'Weight'),
PD='pt paddingTop pr paddingRight pb paddingBottom pl paddingLeft g itemSpacing cg counterAxisSpacing'.split(' '),px=value=>({unit:'PIXELS',value}),
RG=[['fs','FontSize'],['lh','LineHeight',px],['ls','LetterSpacing',px],['td','TextDecoration',v=>TD[v]||'NONE'],['tt','TextCase',v=>TT[v]||'ORIGINAL']],
txt=async(n,e)=>{const o=e.o,v=e.v||{};let i=0;
n.fontName=await font(e.f,o);
for(const r of e.rn||[])if(r[1]&&r[1].f!=U)await font(r[1].f,o);
n.characters=e.ic?e.ic.g:e.tx;
for(const[k,f,t]of RG)if(e[k]!=U)n[f[0].toLowerCase()+f.slice(1)]=t?t(e[k]):e[k];
if(e.ta)n.textAlignHorizontal=TA[e.ta];
if(e.ts!=U)await sty(o,'ts',e.ts,id=>n.setTextStyleIdAsync(id));
if(e.c!=U||v.c!=U)n.fills=[bp(o,'c',v.c,PC(e.c))];
bn(o,'fs',v.fs,n,'fontSize');
for(const[q,r]of(e.rn||[]).entries()){const[l,x]=r.length?r:[r],j=i+l,k='rn'+q+'.',xv=x&&x.v||{};
if(x&&j>i){if(x.f!=U)n.setRangeFontName(i,j,await font(x.f,o));
for(const[a,f,t]of RG)if(x[a]!=U)n['setRange'+f](i,j,t?t(x[a]):x[a]);
if(x.ts!=U)await sty(o,k+'ts',x.ts,id=>n.setRangeTextStyleIdAsync(i,j,id));
if(x.c!=U||xv.c!=U)n.setRangeFills(i,j,[bp(o,k+'c',xv.c,PC(x.c!=U?x.c:e.c))])}
i=j}},
svg=e=>{const c=e.ic,[vb,m]=D.I[c.i],h=i=>i==-1?'none':D.C[i].slice(0,7),cc=c.c!=U?h(c.c):BK,mk=m.replace(/currentColor/g,cc);let a='';
for(const[k,x]of[['fill',c.f],['stroke',c.s]])if(x!=U)a+=` ${k}="${h(x)}"`;
if(c.w!=U)a+=` stroke-width="${c.w}"`;
return vb===null?mk:`<svg xmlns="http://www.w3.org/2000/svg" width="${e.w}" height="${e.h}" viewBox="${vb}"><g color="${cc}"${a}>${mk}</g></svg>`},
inv=([[a,b,e],[c,d,f]],t=a*d-b*c)=>[[d/t,-b/t,(b*f-d*e)/t],[-c/t,a/t,(c*e-a*f)/t]],
// gradientTransform: inverse of (gradient space -> node fractions)
grad=(g,e)=>{const[a,b,c,d]=g.p,R=g.k=='R',x=c-a,y=d-b,nx=-y*e.h/e.w,ny=x*e.w/e.h;
return{type:'GRADIENT_'+(R?'RADIAL':'LINEAR'),gradientStops:g.s.map(([position,i])=>({position,color:ra(D.C[i])})),
gradientTransform:inv(R?[[2*c,0,a-c],[0,2*d,b-d]]:[[x,nx,a-nx/2],[y,ny,b-ny/2]])}},
radius=(n,e,o,r=e.rd)=>{if(r>=0)n.cornerRadius=r;CO.forEach((f,i)=>{if(r&&r.length)n[f]=r[i];bn(o,'r'+i,(e.v||{})['r'+i],n,f)})},
stroke=(n,e,o)=>{const b=e.bd,v=e.v||{},w=b.w.length?b.w:[b.w,b.w,b.w,b.w],m=Math.max(...w);
n.strokes=[bp(o,'sc',v.sc,PC(b.c))];n.strokeAlign='INSIDE';
SI.forEach((f,i)=>{n[f]=w[i];bn(o,'b'+i,v['b'+i],n,f)});
if(b.d)n.dashPattern=b.d=='dashed'?[3*m,3*m]:[m,m]},
paint=async(n,e,o)=>{const v=e.v||{},fl=[],im=e.im;
if(e.bg!=U)fl.push(bp(o,'bg',v.bg,PC(e.bg)));
for(const g of e.gr||[])fl.push(grad(g,e));
if(im){const s=D.M[im.m],m=/^data:[^,]*;base64,(.*)$/.exec(s);
if(m)fl.push({type:'IMAGE',imageHash:F.createImage(F.base64Decode(m[1])).hash,scaleMode:/contain|scale-down/.test(im.f)?'FIT':'FILL'});else NI(o).im=s.slice(0,120)}
if(fl[0])n.fills=fl;
if(e.cl)n.clipsContent=true;
radius(n,e,o);
if(e.bd&&!e.bd.o)stroke(n,e,o);
if(e.sh)n.effects=e.sh.map(([c,x,y,b,s,i])=>({type:i?'INNER_SHADOW':'DROP_SHADOW',color:ra(D.C[c]),offset:{x,y},radius:b,spread:s,visible:true,blendMode:'NORMAL'}));
if(e.es!=U)await sty(o,'es',e.es,id=>n.setEffectStyleIdAsync(id))},
fail=(o,x)=>{S.er.push({o,msg:String(x&&x.message||x).slice(0,200)});S.bad.add(o)},
pf_=o=>S.er.push({o,msg:'parent failed'}),skip=e=>{(e.k||[]).forEach(k=>{pf_(k.o);skip(k)});if(e.bd&&e.bd.o)pf_(e.o+'#stroke')},
frame=()=>{const n=F.createFrame();n.fills=[];n.clipsContent=false;return n},
NS='vuongdesign',pd=(n,k,v)=>n.setSharedPluginData(NS,k,v),gd=(n,k)=>n.getSharedPluginData(NS,k),
mk=async(e,par,sc)=>{const o=e.o,v=e.v||{},gl=!!(e.ic&&e.ic.g!=U),T=e.t=='T'||gl,l=e.l,s=e.s||'XX',ia=isAL(par)&&!e.a,rs=()=>n.resize(Math.max(e.w,.01),Math.max(e.h,.01));
let n;
try{n=T?F.createText():e.t=='V'?F.createNodeFromSvg(svg(e)):F.createFrame();
if(!T){n.fills=[];n.clipsContent=false;n.name=e.y?e.y+' '+o:o}
pd(n,'id',o);
if(!par){pd(n,'screen',sc.screen);pd(n,'file',sc.file)}
await(T?txt:paint)(n,e,o);
if(e.t=='V'&&!gl){const b={fills:gv(o,'vf',v.vf),strokes:gv(o,'vs',v.vs)};
if(b.fills||b.strokes)for(const x of n.findAll(()=>1))for(const k in b)if(b[k]&&x[k]&&x[k]!=MX&&x[k][0])x[k]=x[k].map(p=>p.type=='SOLID'?bv(o,k=='fills'?'vf':'vs',b[k],p):p)}
if(e.op!=U)n.opacity=e.op;
bn(o,'op',v.op,n,'opacity');
if(T&&(e.ar||gl))rs();
if(par)par.appendChild(n);
if(l){n.layoutMode=l.d=='H'?'HORIZONTAL':'VERTICAL';n.strokesIncludedInLayout=false;
if(l.p)[n.paddingTop,n.paddingRight,n.paddingBottom,n.paddingLeft]=l.p;
if(l.g)n.itemSpacing=l.g;
n.primaryAxisAlignItems=l.sb?'SPACE_BETWEEN':AX[l.pa]||'MIN';
if(l.ca)n.counterAxisAlignItems=AX[l.ca];
if(l.wr){n.layoutWrap='WRAP';if(l.cg)n.counterAxisSpacing=l.cg}
for(let i=0;i<12;i+=2)bn(o,PD[i],v[PD[i]],n,PD[i+1])}
if(T){n.textAutoResize=gl||e.ar=='N'?'NONE':e.ar=='H'?'HEIGHT':'WIDTH_AND_HEIGHT';if(gl)n.textAlignHorizontal=n.textAlignVertical='CENTER'}else rs();
if(ia||l)['Horizontal','Vertical'].forEach((f,i)=>{const m=SZ[s[i]];if(!(m=='FILL'&&!ia)&&!(m=='HUG'&&!l&&!T))n['layoutSizing'+f]=m});
if(e.mn!=U)n.minWidth=e.mn;
if(e.mx!=U)n.maxWidth=e.mx;
if(s[0]=='X')bn(o,'w',v.w,n,'width');
if(s[1]=='X')bn(o,'h',v.h,n,'height');
if(e.raw)NI(o).raw=e.raw;
S.reg.push([o,n,e]);
if(e.a||e.tf)S.late.push([n,e,par])
}catch(x){fail(o,x);skip(e);try{n&&n.remove()}catch(y){}return}
for(const k of e.k||[])await mk(k,n,sc);
if(e.bd&&e.bd.o){const id=o+'#stroke';// strokeOverlay
try{const w=frame();w.name='stroke';pd(w,'id',id);radius(w,e,id);stroke(w,e,id);n.appendChild(w);S.reg.push([id,w,e,1]);S.late.push([w,0,n])}catch(x){fail(id,x)}}
return n},
// after the tree: absolute, transform, constraints
place=([n,e,p])=>{const a=e&&e.a,x=a?a[0]:n.x,y=a?a[1]:n.y;
if((a||!e)&&isAL(p))n.layoutPositioning='ABSOLUTE';
if(!e){n.x=n.y=0;n.resize(p.width,p.height);n.constraints={horizontal:'STRETCH',vertical:'STRETCH'};return}
if(e.tf){const[A,B,C,E,tx,ty,ox,oy]=e.tf;n.relativeTransform=[[A,C,x+ox+tx-A*ox-C*oy],[B,E,y+oy+ty-B*ox-E*oy]]}else{n.x=x;n.y=y}
if(a)n.constraints={horizontal:K[a[2]]||'MIN',vertical:K[a[3]]||'MIN'}},
SK=['characters','fontSize','opacity','layoutMode','paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing'],
fn=f=>f.family+' '+f.style,
sig=root=>{let h=0x811c9dc5;const q=v=>v==MX?'M':typeof v=='number'?r2(v):v,
w=(n,t)=>{const f=n.fontName,c=n.cornerRadius,s=JSON.stringify([gd(n,'id'),n.type,t?0:r2(n.x),t?0:r2(n.y),r2(n.width),r2(n.height),pl(n.fills),pl(n.strokes),
f&&f!=MX?fn(f):q(f),c==MX?CO.map(k=>n[k]):c,...SK.map(k=>q(n[k]))]);
for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;
for(const c of n.children||[])w(c)};
w(root,1);return('0000000'+h.toString(16)).slice(-8)},
pv=ps=>{const p=ps!=MX&&ps&&ps.find(x=>x.boundVariables&&x.boundVariables.color);return p&&VN.get(p.boundVariables.color.id)},
// d: fields whose actual value differs from the encoded intent
VF={bg:'fills',sc:'strokes',w:'width',h:'height',op:'opacity',fs:'fontSize',vf:'vf',vs:'vs'},J=JSON.stringify,
so=o=>J(Object.keys(o).sort().map(k=>[k,o[k]])),
run=(e,t)=>{const v=e.v||{},fk=i=>{const[f,w,x]=D.F[i];return f+'|'+w+'|'+!!x},
b=[e.fs==U?12:e.fs,fk(e.f),e.c==U?BK:D.C[e.c],D.S[e.ts]||'',D.V[v.c]||''],c=[],o=[];
for(const r of e.rn||[t.length]){const[l,x]=r.length?r:[r],xv=x&&x.v||{},
s=x?[x.fs!=U?x.fs:b[0],x.f!=U?fk(x.f):b[1],x.c!=U?D.C[x.c]:b[2],x.ts!=U?D.S[x.ts]:b[3],x.c!=U||xv.c!=U?D.V[xv.c]||'':b[4]]:b;
for(let k=0;k<l;k++)c.push(s)}
for(const s of c){const p=o[o.length-1];if(p&&J(p.slice(1))==J(s))p[0]++;else o.push([1,...s])}
return o},
read=(n,e,ov)=>{const T=n.type=='TEXT',v=e.v||{},d={},vw={},vg={},bv=n.boundVariables||{},o2=e.bd&&e.bd.o,
ck=(k,w,g)=>{if(J(w)!=J(g))d[k]=g};
if(T){const t=e.ic?e.ic.g:e.tx,sg=n.getStyledTextSegments(['fontSize','fontName','fills','textStyleId']),
g=sg.map(s=>[s.characters.length,s.fontSize,s.fontName.family+'|'+wt(s.fontName.style).join('|'),(pl(s.fills)||[''])[0],SN.get(s.textStyleId)||'',pv(s.fills)||'']);
ck('text',t,n.characters);
if(J(g)!=J(run(e,t)))d.runs=g.map((x,i)=>(x[2]=fn(sg[i].fontName),x))}
else{const b=e.bd,st=pl(n.strokes);
ck('fills',ov?[]:[...e.bg!=U?[D.C[e.bg]]:[],...(e.gr||[]).map(g=>'GRADIENT_'+(g.k=='R'?'RADIAL':'LINEAR')),...e.im?['IMAGE']:[]],pl(n.fills)||[]);
ck('strokes',b&&(ov||!b.o)?{c:[D.C[b.c]],w:b.w.length?b.w:[b.w,b.w,b.w,b.w]}:null,st?{c:st,w:SI.map(k=>r2(n[k]))}:null);
ck('radius',e.rd>=0?[e.rd,e.rd,e.rd,e.rd]:e.rd||[0,0,0,0],CO.map(k=>r2(n[k])));
ck('es',ov?'':D.S[e.es]||'',SN.get(n.effectStyleId)||'');
for(const k of['fills','strokes'])if(pv(n[k]))vg[k]=pv(n[k])}
ck('op',ov||e.op==U?1:e.op,r2(n.opacity));
for(const k in v)if(ov?/^(sc|b\d|r\d)$/.test(k):!(o2&&/^(sc|b\d)$/.test(k))&&!(T&&k=='c'))vw[VF[k]]=D.V[v[k]];
for(const k in bv){const a=bv[k]&&(bv[k].length?bv[k][0]:bv[k]);if(a&&a.id&&k!='fills'&&k!='strokes')vg[k]=VN.get(a.id)||a.id}
if(e.ic&&e.ic.i!=U&&!ov){const x=n.findAll(()=>1);if(!x[0])d.icon=0;for(const[k,c]of[['vf','fills'],['vs','strokes']]){const p=x.map(y=>pv(y[c])).find(z=>z);if(p)vg[k]=p}}
if(so(vw)!=so(vg))d.vars=vg;
return Object.keys(d)[0]&&d},
ord=(e,a=[])=>{a.push(e.o);(e.k||[]).forEach(k=>ord(k,a));if(e.bd&&e.bd.o)a.push(e.o+'#stroke');return a},
PG=D.page||'Screens',pg=F.root.children.find(p=>p.name==PG)||(()=>{const p=F.createPage();p.name=PG;return p})();
await F.setCurrentPageAsync(pg);
for(let i=0;i<12;i+=2)VF[PD[i]]=PD[i+1];
CO.forEach((f,i)=>{VF['r'+i]=f;VF['b'+i]=SI[i]});
// the first frame of the screen is replaced (after the new one is built) unless edited; other copies: extra, kept
const screen=async sc=>{
const res={screen:sc.screen},M0=pg.children.filter(c=>gd(c,'screen')==sc.screen&&gd(c,'file')==sc.file),t=M0[0];
if(M0[1])res.extra=M0.slice(1).map(c=>c.id);
if(t&&gd(t,'sig')&&gd(t,'sig')!=sig(t)&&(D.force||[]).indexOf(sc.screen)<0)return{...res,root:t.id,edited:true,sig:gd(t,'sig')};// no sig = interrupted build
const x=t?t.x:pg.children.reduce((m,c)=>Math.max(m,c.x+c.width+80),0),y=t?t.y:0,root=S.root=await mk(sc.T,null,sc);
if(root){root.name=sc.screen;
for(const l of S.late)try{place(l)}catch(z){fail(gd(l[0],'id'),z)}
root.x=x;root.y=y;
const box=()=>{const R=root.absoluteBoundingBox,m={};
for(const[o,n]of S.reg)if(!S.bad.has(o))try{const b=n.absoluteBoundingBox;m[o]=[b.x-R.x,b.y-R.y,b.width,b.height].map(r2)}catch(z){fail(o,z)}
return m},
size=w=>{const v=root.layoutSizingVertical;root.resize(w,root.height);if(v=='HUG')root.layoutSizingVertical=v},A=box();
size(sc.W[1]);const B=box();size(sc.W[0]);
const M={},pf=root.id.split(':')[0]+':',ui=[],us={};
for(const[o,n,e,ov]of S.reg)if(!S.bad.has(o)&&A[o]&&B[o])try{const d=read(n,e,ov),b=B[o].map((x,i)=>r2(x-A[o][i])),t=[n.id.indexOf(pf)?n.id:+n.id.slice(pf.length),A[o]];
if(d||b.some(x=>x))t.push(b.some(x=>x)?b:0);if(d)t.push(d);M[o]=t}catch(z){fail(o,z)}
for(const o in S.i){const I=S.i[o];if(I.u)ui.push(...I.u.map(u=>({o,...u})));if(I.raw||I.im)us[o]=I.im?{...I.raw,im:I.im}:I.raw}
res.root=root.id;res.nodes=ord(sc.T).map(o=>M[o]||0);
if(ui[0])res.unbound=ui;
if(Object.keys(us)[0])res.unsupported=us;
pd(root,'sig',res.sig=sig(root));
if(t)t.remove()}
res.fontMissing=S.fm;res.errors=S.er;
return res},
out={batch:D.batch,page:pg.name,pageId:pg.id,screens:[]};
for(const sc of D.screens){S={reg:[],late:[],i:{},fm:[],er:[],bad:new Set};
try{out.screens.push(await screen(sc))}catch(z){try{S.root&&S.root.remove()}catch(y){}// keep the old frame, drop the half-built one
out.screens.push({screen:sc.screen,fontMissing:S.fm,errors:[...S.er,{o:sc.T.o,msg:String(z&&z.message||z).slice(0,200)}]})}}
return out;
