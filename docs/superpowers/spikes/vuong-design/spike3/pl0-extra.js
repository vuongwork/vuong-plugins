const NM=/^n(\.|$)/;const read=(rt)=>{const Q=rt.absoluteBoundingBox;const o=[];const v=n=>{if(NM.test(n.name)){const b=n.absoluteBoundingBox;o.push([n.name,r2(b.x-Q.x),r2(b.y-Q.y),r2(b.width),r2(b.height)])}if('children'in n)for(const c of n.children)v(c)};v(rt);return o};
root.resize(424,root.height);OUT.wide=read(root);root.resize(304,root.height);
