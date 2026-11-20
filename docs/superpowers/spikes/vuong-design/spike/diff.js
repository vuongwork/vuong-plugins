const fs=require('fs'),{PNG}=require('pngjs'),pm=require('pixelmatch'),path=require('path');
const O=path.join(__dirname,'out');
const half=(p)=>{const o=new PNG({width:p.width>>1,height:p.height>>1});for(let y=0;y<o.height;y++)for(let x=0;x<o.width;x++)for(let c=0;c<4;c++){let s=0;for(const[dx,dy]of[[0,0],[1,0],[0,1],[1,1]])s+=p.data[((2*y+dy)*p.width+2*x+dx)*4+c];o.data[(y*o.width+x)*4+c]=s/4}return o};
for(const c of process.argv.slice(2)){
 let h=PNG.sync.read(fs.readFileSync(path.join(O,`html-${c}.png`)));const f=PNG.sync.read(fs.readFileSync(path.join(O,`fig-${c}.png`)));
 if(h.width===f.width*2)h=half(h);
 const w=Math.min(h.width,f.width),H=Math.min(h.height,f.height);const crop=(p)=>{const o=new PNG({width:w,height:H});PNG.bitblt(p,o,0,0,w,H,0,0);return o};
 const a=crop(h),b=crop(f),d=new PNG({width:w,height:H});const n=pm(a.data,b.data,d.data,w,H,{threshold:0.15});
 const side=new PNG({width:w*3+20,height:H});side.data.fill(255);PNG.bitblt(a,side,0,0,w,H,0,0);PNG.bitblt(b,side,0,0,w,H,w+10,0);PNG.bitblt(d,side,0,0,w,H,2*w+20,0);
 fs.writeFileSync(path.join(O,`side-${c}.png`),PNG.sync.write(side));
 console.log(c,`html ${h.width}x${h.height} fig ${f.width}x${f.height} mismatch ${(100*n/(w*H)).toFixed(1)}%`);
}
