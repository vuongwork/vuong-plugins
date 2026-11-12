#!/usr/bin/env python3
"""PDF image track: crop picture regions (and whole no-text pages) for OCR + overlay, then paste back.

crop : python3 pdf_images.py crop  WORKDIR --pdfs <translated_or_source.pdf ...> [--dpi 200]
       Crops every raster image >= 90x50 pt (page-sized backgrounds skipped) from the given PDFs,
       plus every page listed in WORKDIR/noTextPages.json as a whole page. Names: <tag>p<NN>_<i>
       with the tag from docs.json -> unique across files. Writes WORKDIR/img/meta.json.
       Crop from the TEXT-TRANSLATED pdf so text drawn over the picture is already Vietnamese.
put  : python3 pdf_images.py put   WORKDIR --map src.pdf=translated.pdf ... --outdir DIR [--lang vi]
       Raster pictures: pastes WORKDIR/img/out/<name>.png over its rect.
       Whole no-text pages (CAD drawings, outlined text): the page is NOT rasterised — the region file
       WORKDIR/img/<lang>_<name>.json is drawn as vector (background box + Noto Sans text) on the original
       page, so line art stays sharp. (Rasterising a CAD page at 200 dpi turned hairlines light grey.)
Then run ocr.py WORKDIR/img and overlay agents exactly as for pptx images.
"""
import argparse, json, os, glob, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import find_font, fonts           # also switches stdout to UTF-8 (Windows)
import pymupdf
ap = argparse.ArgumentParser(); ap.add_argument('cmd'); ap.add_argument('work')
ap.add_argument('--pdfs', nargs='*', default=[]); ap.add_argument('--dpi', type=int, default=200)
ap.add_argument('--map', nargs='*', default=[]); ap.add_argument('--outdir'); ap.add_argument('--lang', default='vi')
a = ap.parse_args()
docs = json.load(open(f'{a.work}/docs.json', encoding='utf-8')); IMG = f'{a.work}/img'; os.makedirs(IMG, exist_ok=True)

FONT, FONT_B = fonts(a.lang, semibold=True)   # Noto Sans (OS fallback on Windows/macOS); ja target -> Noto Sans CJK

GLYPH = str.maketrans({'≦': '≤', '≧': '≥', '・': '•', '〜': '~', '～': '~'})
FALLBACK = find_font('symbol')   # DejaVu Sans: has ≤ ≥ → ① etc. + Vietnamese
_NOTO = pymupdf.Font(fontfile=FONT)


def _rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def draw_vector(p, m):
    """Draw region file of a whole-page crop as vector on the original page (keeps line art sharp)."""
    Z = m.get('dpi', 200) / 72
    im = pymupdf.Pixmap(f"{IMG}/{m['name']}.png")
    regs = json.load(open(f"{IMG}/{a.lang}_{m['name']}.json", encoding='utf-8'))
    for fn, nm in ((FONT, 'vtR'), (FONT_B, 'vtB'), (FALLBACK, 'vtF')):
        p.insert_font(fontname=nm, fontfile=fn)
    for r in regs:
        x1, y1, x2, y2 = r['box']
        if r.get('bg'): bg = _rgb(r['bg'])
        else:   # median of the pixels just outside the box
            px = sorted((im.pixel(min(max(x, 0), im.width - 1), min(max(y, 0), im.height - 1))[:3]
                         for x in (x1 - 3, (x1 + x2) // 2, x2 + 3) for y in (y1 - 3, (y1 + y2) // 2, y2 + 3)), key=sum)
            bg = tuple(c / 255 for c in px[len(px) // 2])
        fg = _rgb(r['fg']) if r.get('fg') else ((0, 0, 0) if sum(bg) > 1.5 else (1, 1, 1))
        rect = pymupdf.Rect(x1 / Z - .5, y1 / Z - .5, x2 / Z + .5, y2 / Z + .5) * p.derotation_matrix
        p.draw_rect(rect, color=None, fill=bg, overlay=True)
        text = r.get('vi', r.get('text', '')).translate(GLYPH)   # chars Noto Sans can't draw
        if not text.strip(): continue
        fname = 'vtB' if r.get('bold') else 'vtR'
        if any(not _NOTO.has_glyph(ord(c)) for c in text if c > ' '): fname = 'vtF'
        side = rect.width if p.rotation in (90, 270) else rect.height   # line-height direction
        fs = min(side * .8, 40)
        while fs >= 2:
            if p.insert_textbox(rect, text, fontsize=fs, fontname=fname, color=fg,
                                align=1 if r.get('align') == 'center' else 0, rotate=p.rotation) >= 0: break
            fs *= .9
    return 1

if a.cmd == 'crop':
    Z = a.dpi / 72; meta = []
    notext = {(f, p) for f, p in json.load(open(f'{a.work}/noTextPages.json', encoding='utf-8'))}
    srcs = list(docs)
    for pdf in a.pdfs:
        # match a translated file to its source by order given (same order as pdf_extract) or by stem
        src = next((s for s in srcs if os.path.splitext(os.path.basename(s))[0] in os.path.basename(pdf)), None)
        assert src, f'cannot match {pdf} to a source in docs.json'
        tag = docs[src]; d = pymupdf.open(pdf)
        for pi, p in enumerate(d):
            if (src, pi) in notext: rects = [p.rect]
            else:
                rects = []
                for b in p.get_text('dict')['blocks']:
                    if b['type'] != 1: continue
                    r = pymupdf.Rect(b['bbox']) & p.rect
                    if r.width < 90 or r.height < 50: continue
                    if r.width > p.rect.width * .95 and r.height > p.rect.height * .95: continue
                    rects.append(r)
            for i, r in enumerate(rects):
                n = f'{tag}p{pi + 1:02d}_{i}'
                assert not any(m['name'] == n for m in meta), f'duplicate image name {n}'
                p.get_pixmap(matrix=pymupdf.Matrix(Z, Z), clip=r).save(f'{IMG}/{n}.png')
                meta.append(dict(name=n, src=src, page=pi, rect=list(r), whole=(src, pi) in notext, dpi=a.dpi))
    json.dump(meta, open(f'{IMG}/meta.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(len(meta), 'images ->', IMG)
elif a.cmd == 'put':
    meta = json.load(open(f'{IMG}/meta.json', encoding='utf-8')); mp = dict(x.split('=', 1) for x in a.map)
    os.makedirs(a.outdir, exist_ok=True); opened, n = {}, 0
    for src, tr in mp.items():
        src = os.path.abspath(src); opened[src] = pymupdf.open(tr)
    for m in meta:
        o = f"{IMG}/out/{m['name']}.png"
        if m['src'] not in opened: continue
        if not m.get('whole') and not os.path.exists(o): continue
        if m.get('whole') and not os.path.exists(f"{IMG}/{a.lang}_{m['name']}.json"): continue
        d = opened[m['src']]; p = d[m['page']]
        if m['whole']:
            n += draw_vector(p, m); continue
        p.insert_image(pymupdf.Rect(m['rect']), filename=o); n += 1
    for src, d in opened.items():
        out = os.path.join(a.outdir, os.path.basename(mp[next(k for k in mp if os.path.abspath(k) == src)]))
        d.save(out, garbage=3, deflate=True); print('saved', out)
    print(n, 'images pasted')
