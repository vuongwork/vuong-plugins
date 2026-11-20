const r=require('./out/report.json')[process.argv[2]]; const M=process.argv[3]||'A';
console.log(JSON.stringify(r.stats));
for (const x of r['roots'+M].slice(0,+(process.argv[4]||25))) console.log(x.id, x.k, x.tag, x.cls||'', x.pseudo||'', JSON.stringify(x.dl), x.text||'');
