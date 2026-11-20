const lnF=figma.createAutoLayout('VERTICAL',{name:'spike3-ln',itemSpacing:4});lnF.fills=[];pg.appendChild(lnF);lnF.x=D.X+500;lnF.y=0;
OUT.LN=[];for(const[fam,w,sz]of D.LN){if(!AV.has(fam)){OUT.LN.push([fam,w,sz,null]);continue}const st=AV.get(fam);const s=(WN[w]||[]).find(x=>st.has(x))||'Regular';
 await figma.loadFontAsync({family:fam,style:s});const t=figma.createText();t.fontName={family:fam,style:s};t.characters='Hg Ăn ơ';t.fontSize=sz;t.lineHeight={unit:'AUTO'};lnF.appendChild(t);OUT.LN.push([fam,s,sz,Math.round(t.height*100)/100])}
const want=['Be Vietnam Pro','Roboto','Inter','Segoe UI','SF Pro','SF Pro Text','Material Symbols Outlined','Material Symbols Rounded','Arial','Helvetica'];
OUT.fonts=Object.fromEntries(want.map(f=>[f,AV.has(f)?[...AV.get(f)].filter(s=>!/Italic/.test(s)).join(','):null]));OUT.nFam=AV.size;OUT.ln=lnF.id;
