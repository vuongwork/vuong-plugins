const F='Be Vietnam Pro',W={400:'Regular',500:'Medium',600:'SemiBold',700:'Bold',800:'ExtraBold'};let V={},C={},D0,CA,R={vars:0,frames:0,texts:0,icons:0,comps:0,inst:0,err:[]};
const rgb=h=>{h=h.replace('#','');return{r:parseInt(h.slice(0,2),16)/255,g:parseInt(h.slice(2,4),16)/255,b:parseInt(h.slice(4,6),16)/255}};
const paint=c=>{const[t,a]=c,v=V[t],p={type:'SOLID',color:rgb(v?D0.tokens[t]:t),opacity:a};return v?figma.variables.setBoundVariableForPaint(p,'color',v):p};
const isAL=n=>n&&'layoutMode'in n&&n.layoutMode!=='NONE';
function abs(n,s,par){if(s.ab&&isAL(par)){n.layoutPositioning='ABSOLUTE';n.x=s.ab[0];n.y=s.ab[1];return 1}return 0}
function shadow(sh){const m=sh.match(/rgba?\(([^)]+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?/);if(!m)return null;const c=m[1].split(',').map(Number);return{type:'DROP_SHADOW',color:{r:c[0]/255,g:c[1]/255,b:c[2]/255,a:c[3]??1},offset:{x:+m[2],y:+m[3]},radius:+m[4],spread:+(m[5]||0),visible:true,blendMode:'NORMAL'}}
function size(n,s,par){if(!isAL(par))return;const al=isAL(n);
 if(s.sw==='F')n.layoutSizingHorizontal='FILL';else if(s.sw==='H'&&(al||n.type==='TEXT'))n.layoutSizingHorizontal='HUG';
 if(s.sv==='H'&&al)n.layoutSizingVertical='HUG'}
const texts=s=>{const o=[];const w=x=>{if(x.k==='T')o.push(x.tx);(x.c||[]).forEach(w)};(s.c||[]).forEach(w);return o};
async function mk(s,par){
 if(s.k==='SP'){const f=figma.createFrame();f.name='spacer';f.fills=[];f.resize(s.w||1,s.h||1);par.appendChild(f);if(isAL(par)){const hz=par.layoutMode==='HORIZONTAL';if(s.fill){if(hz)f.layoutSizingHorizontal='FILL';else f.layoutSizingVertical='FILL'}else if(!hz)f.layoutSizingHorizontal='FILL'}return f}
 if(s.k==='S'){const ic=D0.icons[s.ic];let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ic.vb}" width="${s.w}" height="${s.h}">${ic.body}</svg>`;if(s.cl)svg=svg.replace(/currentColor/g,s.cl).replace('<svg ',`<svg stroke="${s.cl}" `);
  const n=figma.createNodeFromSvg(svg);n.name=s.n;par.appendChild(n);abs(n,s,par);R.icons++;return n}
 if(s.k==='T'){const t=figma.createText();t.fontName={family:F,style:W[s.fw]||'Regular'};t.characters=s.tx;t.fontSize=s.fs;
  if(s.lh)t.lineHeight={unit:'PIXELS',value:s.lh};if(s.ls)t.letterSpacing={unit:'PIXELS',value:s.ls};if(s.col)t.fills=[paint(s.col)];if(s.op)t.opacity=s.op;
  if(s.td)t.textDecoration=s.td==='S'?'STRIKETHROUGH':'UNDERLINE';if(s.ta)t.textAlignHorizontal=s.ta==='C'?'CENTER':'RIGHT';t.name=s.n;par.appendChild(t);R.texts++;if(abs(t,s,par))return t;
  if(s.sw==='X'){t.resize(s.w,t.height);t.textAutoResize='HEIGHT'}else if(s.sw==='F'&&isAL(par)){t.textAutoResize='HEIGHT';t.layoutSizingHorizontal='FILL'}return t}
 if(s.inst){const i=C[s.inst].createInstance();par.appendChild(i);const src=texts(s);i.findAll(n=>n.type==='TEXT').forEach((d,k)=>{if(src[k]!==undefined&&d.characters!==src[k])d.characters=src[k]});
  if(!abs(i,s,par))size(i,s,par);R.inst++;return i}
 const f=s.def?figma.createComponent():figma.createFrame();f.name=s.def||s.n;f.fills=s.fill?[paint(s.fill)]:[];
 if(s.l){f.layoutMode=s.l==='H'?'HORIZONTAL':'VERTICAL';f.itemSpacing=s.g||0;if(s.p)[f.paddingTop,f.paddingRight,f.paddingBottom,f.paddingLeft]=s.p;
  f.primaryAxisAlignItems={SB:'SPACE_BETWEEN',C:'CENTER',E:'MAX'}[s.ja]||'MIN';f.counterAxisAlignItems={C:'CENTER',E:'MAX'}[s.ca]||'MIN'}
 f.resize(Math.max(s.w,.01),Math.max(s.h,.01));
 if(s.r!==undefined){if(Array.isArray(s.r))[f.topLeftRadius,f.topRightRadius,f.bottomRightRadius,f.bottomLeftRadius]=s.r;else f.cornerRadius=s.r}
 if(s.st){f.strokes=[paint(s.st[0])];f.strokeWeight=s.st[1];if(s.st[2])f.dashPattern=[3,3]}
 else if(s.sides){f.strokes=[paint(s.sides[0])];[f.strokeTopWeight,f.strokeRightWeight,f.strokeBottomWeight,f.strokeLeftWeight]=s.sides[1]}
 else if(s.sb){f.strokes=[paint(s.sb[0])];f.strokeTopWeight=0;f.strokeLeftWeight=0;f.strokeRightWeight=0;f.strokeBottomWeight=s.sb[1]}
 if(s.sh){const e=shadow(s.sh);if(e)f.effects=[e]}if(s.op)f.opacity=s.op;f.clipsContent=!!s.clip;R.frames++;
 if(s.def){CA.appendChild(f);for(const c of s.c||[])await mk(c,f);if(s.l){f.layoutSizingVertical='HUG';if(s.sw==='H')f.layoutSizingHorizontal='HUG'}
  f.setSharedPluginData('vuong','id',s.def);C[s.def]=f;R.comps++;const i=f.createInstance();par.appendChild(i);if(!abs(i,s,par))size(i,s,par);R.inst++;return i}
 par.appendChild(f);const a=abs(f,s,par);for(const c of s.c||[])await mk(c,f);if(!a)size(f,s,par);if(s.sw==='X'&&isAL(par)&&isAL(f))f.layoutSizingHorizontal='FIXED';if(s.sv==='X'&&isAL(par)&&isAL(f))f.layoutSizingVertical='FIXED';return f}
async function run(D){D0=D;for(const id of D.remove||[]){const n=await figma.getNodeByIdAsync(id);if(n)n.remove()}for(const st of new Set(Object.values(W)))await figma.loadFontAsync({family:F,style:st});
 const cols=await figma.variables.getLocalVariableCollectionsAsync();let col=cols.find(c=>c.name==='Color')||figma.variables.createVariableCollection('Color');
 const ex=await figma.variables.getLocalVariablesAsync('COLOR'),m=col.modes[0].modeId;
 for(const[n,h]of Object.entries(D.tokens)){let v=ex.find(x=>x.name===n&&x.variableCollectionId===col.id);if(!v){v=figma.variables.createVariable(n,col,'COLOR');v.scopes=['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];R.vars++}v.setValueForMode(m,rgb(h));V[n]=v}
 const pg=figma.currentPage;let x=Math.max(0,...pg.children.map(n=>n.x+n.width))+200;
 CA=figma.createAutoLayout('VERTICAL',{name:'Components',itemSpacing:24});CA.fills=[];pg.appendChild(CA);CA.x=x;CA.y=0;x+=600;
 const out={};
 for(const sc of D.screens){const fr=figma.createFrame();fr.name=sc.name;fr.resize(sc.root.w,sc.root.h);fr.x=x;fr.y=0;x+=sc.root.w+120;pg.appendChild(fr);
  fr.setSharedPluginData('vuong','id','scr.'+sc.code);fr.clipsContent=true;fr.fills=sc.root.fill?[paint(sc.root.fill)]:[];
  if(sc.root.l){fr.layoutMode=sc.root.l==='H'?'HORIZONTAL':'VERTICAL';fr.itemSpacing=sc.root.g||0;if(sc.root.p)[fr.paddingTop,fr.paddingRight,fr.paddingBottom,fr.paddingLeft]=sc.root.p;fr.primaryAxisSizingMode='FIXED';fr.counterAxisSizingMode='FIXED'}
  for(const c of sc.root.c||[]){try{await mk(c,fr)}catch(e){R.err.push(sc.code+': '+String(e).slice(0,160))}}
  out[sc.code]=fr.id}
 // prototype probe: Inbox tab on A1 navigates to A4
 try{const a1=await figma.getNodeByIdAsync(out.A1),t=a1.findOne(n=>n.type==='TEXT'&&n.characters.trim()==='Inbox');
  if(t&&out.A4){await t.parent.setReactionsAsync([{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:out.A4,navigation:'NAVIGATE',transition:null}]}]);pg.flowStartingPoints=[{nodeId:out.A1,name:'FAB demo'}];R.proto='ok'}}catch(e){R.proto='err '+String(e).slice(0,160)}
 return{screens:out,components:Object.fromEntries(Object.entries(C).map(([k,v])=>[k,v.id])),componentsArea:CA.id,...R}}
