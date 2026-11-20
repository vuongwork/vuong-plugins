// Spike: render HTML, walk each target screen, measure at two widths, emit compact IR + token stats.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1255/chrome-win64/chrome.exe');
const SRC = path.join(__dirname, 'src/ui.html');
const CODES = (process.argv[2] || 'A1,A4').split(',');
const WIDE = 116; // extra px for the second measurement

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto('file:///' + SRC.replace(/\\/g, '/'));
  await page.evaluate(() => document.fonts.ready);

  const walk = ({ codes, wide }) => {
    const rootVars = {};
    const cs0 = getComputedStyle(document.documentElement);
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules } catch { continue } for (const r of rules)
      if (r.selectorText === ':root') for (const p of r.style) if (p.startsWith('--')) rootVars[p] = cs0.getPropertyValue(p).trim();}
    const symbols = {};
    document.querySelectorAll('symbol').forEach(s => symbols[s.id] = { vb: s.getAttribute('viewBox'), body: s.innerHTML });
    const out = {};
    for (const cell of document.querySelectorAll('.cell')) {
      const name = cell.querySelector('.name')?.textContent.trim() || '';
      const code = name.split('.')[0];
      if (!codes.includes(code)) continue;
      const ph = cell.querySelector('.ph'), sc = ph.querySelector('.sc') || ph;
      if (wide) ph.style.width = (ph.getBoundingClientRect().width + wide) + 'px';
      const R = sc.getBoundingClientRect();
      const node = (el) => {
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || b.width === 0 && b.height === 0) return null;
        const n = { t: el.tagName.toLowerCase(), c: el.className?.baseVal ?? el.className, x: +(b.left - R.left).toFixed(1), y: +(b.top - R.top).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
        if (n.t === 'svg') { const u = el.querySelector('use'); n.icon = u ? u.getAttribute('href').slice(1) : null; n.stroke = cs.stroke; n.color = cs.color; return n; }
        const s = {};
        for (const k of ['display', 'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap', 'rowGap', 'columnGap', 'position', 'backgroundColor', 'color', 'opacity', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'flexGrow', 'width', 'height',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom',
          'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor', 'boxShadow', 'overflow', 'borderLeftWidth', 'borderRightWidth', 'textDecorationLine', 'alignSelf', 'marginLeft', 'marginRight']) s[k] = cs[k];
        // authored (not computed) width/height/flex, to tell explicit sizes from layout results
        s.aw = el.style.width || ''; s.ah = el.style.height || '';
        n.s = s;
        const kids = [];
        for (const ch of el.childNodes) {
          if (ch.nodeType === 3) { const tx = ch.textContent.replace(/\s+/g, ' ').trim(); if (tx) { const rg = document.createRange(); rg.selectNodeContents(ch); const rb = rg.getBoundingClientRect(); kids.push({ t: '#text', text: tx, x: +(rb.left - R.left).toFixed(1), y: +(rb.top - R.top).toFixed(1), w: +rb.width.toFixed(1), h: +rb.height.toFixed(1) }); } }
          else if (ch.nodeType === 1) { const k = node(ch); if (k) kids.push(k); }
        }
        if (kids.length) n.k = kids;
        return n;
      };
      out[code] = { name, w: R.width, h: R.height, root: node(sc) };
      if (wide) ph.style.width = '';
    }
    return { rootVars, symbols, screens: out };
  };

  const A = await page.evaluate(walk, { codes: CODES, wide: 0 });
  const B = await page.evaluate(walk, { codes: CODES, wide: WIDE });
  // Mark nodes whose width grows with the container -> FILL; gaps between flex children that change -> AUTO spacing.
  const mark = (a, b) => {
    if (!a || !b || a.t !== b.t) return;
    if (a.w !== undefined) a.grow = Math.abs(b.w - a.w) > 1;
    if (a.k && b.k) a.k.forEach((ch, i) => mark(ch, b.k[i]));
    if (a.k && b.k && a.k.length > 1) {
      const gapsA = a.k.slice(1).map((ch, i) => ch.x - (a.k[i].x + a.k[i].w)), gapsB = b.k.slice(1).map((ch, i) => ch.x - (b.k[i].x + b.k[i].w));
      a.gapGrows = gapsA.some((g, i) => Math.abs(gapsB[i] - g) > 1);
    }
  };
  for (const c of Object.keys(A.screens)) mark(A.screens[c].root, B.screens[c].root);

  // Screenshots of the source screens for later pixel comparison.
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  for (const c of Object.keys(A.screens)) {
    const loc = page.locator('.cell', { has: page.locator('.name', { hasText: new RegExp('^' + c + '\\.') }) }).locator('.sc').first();
    await loc.screenshot({ path: path.join(__dirname, 'out', `html-${c}.png`) });
  }
  fs.writeFileSync(path.join(__dirname, 'out/ir.json'), JSON.stringify(A));
  await browser.close();

  // Token stats (what an AI would read instead of the HTML).
  const colors = {}, sizes = {}, radii = {}, spacing = {};
  const inc = (m, k) => { if (k) m[k] = (m[k] || 0) + 1; };
  const visit = (n) => {
    if (!n || !n.s) return; const s = n.s;
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') inc(colors, 'bg ' + s.backgroundColor);
    if (n.k?.some(k => k.t === '#text')) { inc(colors, 'text ' + s.color); inc(sizes, `${s.fontSize}/${s.fontWeight}`); }
    if (s.borderTopWidth !== '0px') inc(colors, 'border ' + s.borderTopColor);
    inc(radii, s.borderTopLeftRadius !== '0px' ? s.borderTopLeftRadius : null);
    for (const p of ['paddingTop', 'paddingLeft', 'gap']) if (s[p] !== '0px' && s[p] !== 'normal') inc(spacing, s[p]);
    n.k?.forEach(visit);
  };
  for (const c of Object.keys(A.screens)) visit(A.screens[c].root);
  const sortObj = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ');
  const summary = { screens: Object.fromEntries(Object.entries(A.screens).map(([c, s]) => [c, s.name + ` ${s.w}x${s.h}`])),
    rootVars: A.rootVars, colors: sortObj(colors), text: sortObj(sizes), radii: sortObj(radii), spacing: sortObj(spacing), icons: Object.keys(A.symbols) };
  fs.writeFileSync(path.join(__dirname, 'out/summary.json'), JSON.stringify(summary, null, 1));
  console.log('ir bytes', fs.statSync(path.join(__dirname, 'out/ir.json')).size, 'summary bytes', fs.statSync(path.join(__dirname, 'out/summary.json')).size);
})();
