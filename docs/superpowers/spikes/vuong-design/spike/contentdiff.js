// Per-node content check: crop each node's HTML box from the HTML render and the matching Figma box from the Figma render,
// compare pixels. Catches right-place-wrong-content (wrong icon, missing ::after mark) that box comparison cannot see.
const fs=require('fs'),{PNG}=require('pngjs'),pm=require('pixelmatch');
const exp=require('./out/expected.json'),act=require('./out/actual.json');
const half=p=>{const o=new PNG({width:p.width>>1,height:p.height>>1});for(let y=0;y<o.height;y++)for(let x=0;x<o.width;x++)for(let c=0;c<4;c++){let s=0;for(const[dx,dy]of[[0,0],[1,0],[0,1],[1,1]])s+=p.data[((2*y+dy)*p.width+2*x+dx)*4+c];o.data[(y*o.width+x)*4+c]=s/4}return o};
const crop=(p,x,y,w,h)=>{x=Math.round(x);y=Math.round(y);w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));const o=new PNG({width:w,height:h});PNG.bitblt(p,o,Math.max(0,x),Math.max(0,y),Math.min(w,p.width-x),Math.min(h,p.height-y),0,0);return o};
for(const [code,scr] of [['A1','A1. Hôm nay'],['A4','A4. Inbox']]){
 let H=PNG.sync.read(fs.readFileSync(`out/html-${code}.png`));if(H.width>400)H=half(H);const F=PNG.sync.read(fs.readFileSync(`out/fig-${code}.png`));
 const E=exp[scr],A=act[scr];const bad=[];
 E.forEach((e,i)=>{const[name,x,y,w,h]=e,a=A[i];if(x===null||!a||w*h<40||w*h>4000)return; // leaf-sized nodes: icons, marks, labels
  const hc=crop(H,x,y,w,h),fc=crop(F,a[0],a[1],w,h);const n=pm(hc.data,fc.data,null,hc.width,hc.height,{threshold:0.2});const r=n/(hc.width*hc.height);
  if(r>0.12)bad.push(`#${i} ${name} ${(100*r).toFixed(0)}% pixels differ`)});
 console.log(`== ${scr}: ${bad.length} nodes with different content`);bad.forEach(b=>console.log('  '+b));}
