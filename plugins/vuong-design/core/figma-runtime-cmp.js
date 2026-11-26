// vuong-design component runtime (plan 3b Task 6). Installed once like figma-runtime.js (shared plugin data rtc /
// rtcv); the loader of a batch that uses components (D.K or D.cm) inserts it into the screen runtime before the
// screen loop and patches three calls there (figma.mjs CMP_PATCHES): mk() hands a node with `i` to XI, screen()
// passes a built root through CV, and PO runs after the loop. So it shares the runtime's scope (mk, txt, read,
// screen, S ...). Marks it reads: figma-cmp.mjs header. README "Figma components".
// XM: K name -> component (plugin data cmp), from the components page, then the ones this batch builds.
const XM=new Map,XC=[],XO=[],XA=['Horizontal','Vertical'],
XN=async()=>{const p=F.root.children.find(p=>p.name==(D.cp||'Components'));if(p){await p.loadAsync();for(const n of p.findAll(n=>n.type=='COMPONENT'&&gd(n,'cmp')))XM.set(gd(n,'cmp'),n)}},
XG=async i=>{const c=XM.get(D.K[i]);if(!c)throw Error('component missing in the file: '+D.K[i]);return c},
// property names -> the instance's keys ('<name>#<id>'); INSTANCE_SWAP values are K indices of icon components
XP=async(n,p)=>{const r={},cp=n.componentProperties;for(const k in p){const q=Object.keys(cp).find(x=>x.split('#')[0]==k);if(!q)throw Error('no property '+k);r[q]=typeof p[k]=='number'?(await XG(p[k])).id:p[k]}return r},
// a TEXT property writes characters: the fonts of the instance's texts must be loaded first
XL=async n=>{for(const t of n.findAll(x=>x.type=='TEXT'))for(const f of t.characters.length?t.getRangeAllFontNames(0,t.characters.length):[t.fontName]){const u=f.family+' '+f.style;if(f!=MX&&!LD.has(u)){await F.loadFontAsync(f);LD.add(u)}}},
// sizing as mk sets it: FILL only in an auto-layout parent (not absolute), HUG only with auto layout or on text
XZ=(n,e,al,T)=>{const s=e.s||'XX',ia=al&&!e.a;if(ia||e.l)XA.forEach((f,i)=>{const m=SZ[s[i]],k='layoutSizing'+f;if(!(m=='FILL'&&!ia)&&!(m=='HUG'&&!e.l&&!T)&&n[k]!=m)n[k]=m})},
// an instance (or a nested one, ex): its own size and placement on a new one, then what differs from its encoding
XI=async(e,par,sc,ex)=>{const o=e.o;let n=ex;
try{const M=await XG(e.i);
if(!n){n=M.createInstance();if(par)par.appendChild(n)}else if(await n.getMainComponentAsync()!=M)n.swapComponent(M);
if(e.p){if(Object.values(e.p).some(x=>typeof x=='string'))await XL(n);n.setProperties(await XP(n,e.p))}
pd(n,'id',o);
await XF(n,e,o,!ex);
if(!ex){const s=e.s||'XX',v=e.v||{};n.resize(Math.max(e.w,.01),Math.max(e.h,.01));XZ(n,e,isAL(par),0);if(e.mn!=U)n.minWidth=e.mn;if(e.mx!=U)n.maxWidth=e.mx;
if(s[0]=='X')bn(o,'w',v.w,n,'width');if(s[1]=='X')bn(o,'h',v.h,n,'height');if(e.a||e.tf)S.late.push([n,e,par])}
S.reg.push([o,n,e])
}catch(x){fail(o,x);skip(e);try{!ex&&n&&n.remove()}catch(y){}return}
await XS(n,e,sc);return n},
// the children of an instance layer: k[i] is the layer at j (else i); a nested occurrence is an instance itself
XS=async(n,e,sc)=>{const c=n.children||[];
for(const[i,k]of(e.k||[]).entries()){const x=c[k.j!=U?k.j:i];
if(!x){fail(k.o,'no layer '+(k.j!=U?k.j:i)+' in the instance');skip(k);continue}
if(k.i!=U){await XI(k,n,sc,x);continue}
try{pd(x,'id',k.o);await XF(x,k,k.o);S.reg.push([k.o,x,k])}catch(z){fail(k.o,z);skip(k);continue}
await XS(x,k,sc)}
if(e.bd&&e.bd.o){const id=e.o+'#stroke',w=c[c.length-1];if(w){pd(w,'id',id);S.reg.push([id,w,e,1])}else fail(id,'no stroke layer')}},
// sets on a layer of an instance only what differs from its encoding e (each set is an override); top: the instance
// root, whose size and sizing XI sets
XF=async(n,e,o,top)=>{const T=n.type=='TEXT',gl=!!(e.ic&&e.ic.g!=U),d=read(n,e)||{},v=e.v||{},l=e.l,p=n.parent,q=(k,w)=>{if(J(n[k])!=J(w))n[k]=w};
if(T){if(d.text||d.runs)await txt(n,e);
const L=n.lineHeight;if(L!=MX&&(e.lh!=U?L.unit!='PIXELS'||r2(L.value)!=e.lh:L.unit!='AUTO'))n.lineHeight=e.lh!=U?px(e.lh):{unit:'AUTO'};
const A=n.letterSpacing;if(A!=MX&&r2(A.value||0)!=(e.ls||0))n.letterSpacing=px(e.ls||0);
q('textAutoResize',gl||e.ar=='N'?'NONE':e.ar=='H'?'HEIGHT':'WIDTH_AND_HEIGHT');if(!gl)q('textAlignHorizontal',TA[e.ta]||'LEFT')}
else{const rv=d.vars;if(d.fills||rv){const fl=[],im=e.im;if(e.bg!=U)fl.push(bp(o,'bg',v.bg,PC(e.bg)));for(const g of e.gr||[])fl.push(grad(g,e));
if(im){const m=/^data:[^,]*;base64,(.*)$/.exec(D.M[im.m]);if(m)fl.push({type:'IMAGE',imageHash:F.createImage(F.base64Decode(m[1])).hash,scaleMode:/contain|scale-down/.test(im.f)?'FIT':'FILL'})}
n.fills=fl}
if(d.strokes||rv&&e.bd){if(e.bd&&!e.bd.o)stroke(n,e,o);else n.strokes=[]}
if(d.radius){if(e.rd==U)n.cornerRadius=0;else radius(n,e,o)}
// other variables than the encoding's (a nested main binds its own): each field to the encoded one, or unbound
if(rv)for(const k in VF){const f=VF[k];if(/^(fills|strokes|vf|vs|width|height)$/.test(f))continue;if(v[k]!=U)bn(o,k,v[k],n,f);else if(BA(n.boundVariables||{},f))try{n.setBoundVariable(f,null)}catch(z){ub(o,k,'',BF)}}
if(d.es&&e.es!=U)await sty(o,'es',e.es,id=>n.setEffectStyleIdAsync(id));
if(e.es==U){const ef=(e.sh||[]).map(([c,x,y,b,s,i])=>({type:i?'INNER_SHADOW':'DROP_SHADOW',color:ra(D.C[c]),offset:{x,y},radius:b,spread:s,visible:true,blendMode:'NORMAL'})),
k=f=>J((f||[]).map(z=>[z.type,HX(z.color)+x2(z.color.a),z.offset.x,z.offset.y,z.radius,z.spread||0]));if(k(ef)!=k(n.effects))n.effects=ef}
if(!!n.clipsContent!=!!e.cl)n.clipsContent=!!e.cl;
if(l&&n.layoutMode!='NONE'){const P=l.p||[0,0,0,0];['paddingTop','paddingRight','paddingBottom','paddingLeft'].forEach((k,i)=>q(k,P[i]));
if(!l.sb)q('itemSpacing',l.g||0);q('primaryAxisAlignItems',l.sb?'SPACE_BETWEEN':AX[l.pa]||'MIN');q('counterAxisAlignItems',AX[l.ca]||'MIN');
q('layoutWrap',l.wr?'WRAP':'NO_WRAP');if(l.wr)q('counterAxisSpacing',l.cg||0)}
// an icon bound to INSTANCE_SWAP or with an icon override: its colours as its own svg draws them
if(e.rc&&e.ic&&e.ic.i!=U){const t=F.createNodeFromSvg(svg(e)),a=t.findAll(()=>1),b=n.findAll(()=>1),B={fills:gv(o,'vf',v.vf),strokes:gv(o,'vs',v.vs)},Q={fills:e.ic.f,strokes:e.ic.s};
// colours and the colour variables (vf / vs, bound as mk binds them) of each vector
const Y=ps=>J([pl(ps),ps==MX?0:(ps||[]).map(z=>BC(z)&&BC(z).id)]);
if(a.length==b.length)a.forEach((y,i)=>{for(const k of['fills','strokes'])if(y[k]!=MX){let w=y[k];if(B[k]&&Q[k]!=U&&Q[k]!=-1)w=w.map(z=>z.type=='SOLID'&&HX(z.color)==D.C[Q[k]].slice(0,7).toLowerCase()?bv(o,k=='fills'?'vf':'vs',B[k],z):z);if(Y(w)!=Y(b[i][k]))b[i][k]=w}});
else ub(o,'rc','','icon layers differ');t.remove()}}
if(d.op)n.opacity=e.op!=U?e.op:1;
if(!top&&p)XZ(n,e,!!p.layoutMode&&p.layoutMode!='NONE',T)},
// readback (CMP_PATCHES): an instance (i) or an icon an INSTANCE_SWAP value sets (mi) whose main component is not the
// encoded one reads back d.mc = the main's cmp key ('' when it has none); mainComponent itself is not readable with
// documentAccess dynamic-page
XK=async(n,e,d)=>{const x=e.i!=U?e.i:e.mi;if(x!=U&&n.type=='INSTANCE'){const m=await n.getMainComponentAsync(),k=m?gd(m,'cmp'):'';if(k!=D.K[x])(d=d||{}).mc=k}return d},
// component batch (D.cm): a built template root becomes a component (CV); once the last variant of a name is built
// (a component's variants are consecutive and never split between batches) they form a set and the set (or the
// component) gets its properties (XD), before a later component uses it; after the loop (PO) the components of an
// earlier build of the same names hand their instances to the new ones and go
XR={},XE=[],XF2=new Set,
CV=async(n,sc)=>{const c=sc.cm;if(!c||!n)return n;const m=F.createComponentFromNode(n),k=D.K[c.k],L=D.screens,i=L.indexOf(sc);
pd(m,'id',sc.T.o);pd(m,'screen',sc.screen);pd(m,'file',sc.file);pd(m,'cmp',k);
for(const r of S.reg)if(r[1]==n)r[1]=m;for(const l of S.late)if(l[2]==n)l[2]=m;
XM.set(k,m);XC.push([m,sc]);if(!L[i+1]||L[i+1].cm.n!=c.n)await XD(c.n);return m},
XD=async nm=>{const L=XC.filter(x=>x[1].cm.n==nm);let o=L[0][0];XF2.add(nm);
for(const[m,sc]of L){const e=sc.T,s=e.s||'XX';m.name=sc.cm.v||nm;if(e.l)XA.forEach((f,i)=>{if(s[i]=='H')m['layoutSizing'+f]='HUG'})}
try{if(L[0][1].cm.v){o=F.combineAsVariants(L.map(x=>x[0]),pg);o.name=nm;pd(o,'cmp',nm)}
const P=L[0][1].cm.p||{};
for(const k in P){const[t,d]=P[k],q=o.addComponentProperty(k,t,t=='INSTANCE_SWAP'?(await XG(d)).id:d),f={TEXT:'characters',BOOLEAN:'visible',INSTANCE_SWAP:'mainComponent'}[t];
for(const[m,sc]of L){const b=(sc.cm.b||{})[k];if(b==U)continue;const id=b?sc.T.o+'.'+b:sc.T.o,x=b?m.findAll(y=>gd(y,'id')==id)[0]:m;if(!x)throw Error('no node '+id+' for property '+k);x.componentPropertyReferences={[f]:q}}}
XR[nm]=o.id}catch(z){XE.push({o:nm,msg:String(z&&z.message||z).slice(0,200)})}},
PO=async()=>{if(!D.cm)return;
// a set whose last variant failed: its built variants still form it
for(const[,sc]of XC)if(!XF2.has(sc.cm.n))await XD(sc.cm.n);
// screen() names a built root after its screen key: a variant takes its axis=value name back
for(const[m,sc]of XC)m.name=sc.cm.v||sc.cm.n;
// an old component replaced by this build hands its instances over and goes (kept while some stay); one this build
// failed to replace stays as it is
let sw=0,kept=0;for(const o of XO)if(o.type=='COMPONENT'){const w=XM.get(gd(o,'cmp'));if(!w||w==o)continue;for(const i of await o.getInstancesAsync()){i.swapComponent(w);sw++}
if((await o.getInstancesAsync()).length)kept++;else o.remove()}
// signatures once the sets, properties and swaps are done (they move and size the variants)
for(const[m,sc]of XC){pd(m,'sig',sig(m));const r=out.screens.find(x=>x.screen==sc.screen);if(r)r.sig=gd(m,'sig')}
for(const o of XO)if(o.type=='COMPONENT_SET'&&!o.removed&&!(o.children||[]).length)o.remove();
out.cm={sets:XR,swapped:sw,oldKept:kept,errors:XE}};
if(D.K||D.cm)await XN();
// an earlier build of the components this batch builds (other batches' stay out): out of screen()'s frame lookup (PO
// replaces them). A component edited by hand (sig, as a screen frame's) keeps its whole name (every variant, the set):
// its variants are not built, each reports edited with the old root, its instances keep it; D.force 'cmp:<name>'
// rebuilds it. A variant the kept name lacks is not built (an error).
if(D.cm){const KN={},E=new Set,FO=D.force||[];for(const sc of D.screens)KN[D.K[sc.cm.k]]=sc.cm.n;const NS=new Set(Object.values(KN));
const L=pg.findAll(n=>(n.type=='COMPONENT'||n.type=='COMPONENT_SET')&&gd(n,'cmp')).filter(n=>n.type=='COMPONENT'?KN[gd(n,'cmp')]!=U:NS.has(gd(n,'cmp')));
for(const n of L){const g=gd(n,'sig'),nm=KN[gd(n,'cmp')];if(n.type=='COMPONENT'&&g&&g!=sig(n)&&g!=sig(n,1)&&FO.indexOf('cmp:'+nm)<0)E.add(nm)}
for(const n of L)if(!E.has(n.type=='COMPONENT'?KN[gd(n,'cmp')]:gd(n,'cmp'))){XO.push(n);pd(n,'screen','')}
D.screens=D.screens.filter(sc=>{const nm=sc.cm.n;if(!E.has(nm))return 1;const m=XM.get(D.K[sc.cm.k]);
out.screens.push(m?{screen:sc.screen,root:m.id,edited:true,sig:gd(m,'sig')}:{screen:sc.screen,fontMissing:[],errors:[{o:sc.T.o,msg:'not built: component '+nm+' was edited by hand and is kept (--force cmp:'+nm+' rebuilds it)'}]})})}
