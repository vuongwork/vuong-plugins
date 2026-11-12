#!/usr/bin/env python3
"""PDF text track, step 1: extract every Japanese text LINE (not block) with position/style.

Usage: python3 pdf_extract.py <a.pdf> [b.pdf ...] --out WORKDIR --target {vi,en,ja} [--keep keep.txt] [--chunk-lines 200]
  --target: extract every line not yet in the target language (any source language). Without it: Japanese lines only (legacy).
Writes WORKDIR/lines.json  {pdf_path: [{page,bbox,text,size,color,bold,dir}]}
       WORKDIR/docs.json   {pdf_path: "d1" ...}  unique short tag per file (used for image names)
       WORKDIR/pages_k.json {"<tag> page N": [lines in reading order]}  translator chunks, split by page
       WORKDIR/src.json    unique strings (for find_entities.py)
       WORKDIR/noTextPages.json  pages without any text layer (scans / outlined drawings) -> image track
Why lines: a PowerPoint/CAD table is often ONE text block spanning many cells; redacting a block
deletes the numbers in it. Lines keep exact positions; page-ordered chunks keep sentence context.
Needs PyMuPDF (pip install pymupdf in a venv).
"""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langcheck import needs_translation, load_keep
import pymupdf
JP = re.compile(r'[぀-ヿ一-鿿ｦ-ﾟ]')
ap = argparse.ArgumentParser(); ap.add_argument('pdfs', nargs='+'); ap.add_argument('--out', required=True)
ap.add_argument('--chunk-lines', type=int, default=200); ap.add_argument('--target', choices=['vi', 'en', 'ja'])
ap.add_argument('--keep'); a = ap.parse_args()
KEEP = load_keep(a.keep) if a.keep else []
wanted = (lambda t: needs_translation(t, a.target, KEEP)) if a.target else (lambda t: bool(JP.search(t)))
os.makedirs(a.out, exist_ok=True)
lines, docs, pages, uniq, notext = {}, {}, [], {}, []
for i, f in enumerate(a.pdfs, 1):
    f = os.path.abspath(f); docs[f] = f'd{i}'; L = []
    for pi, p in enumerate(pymupdf.open(f)):
        if not p.get_text().strip(): notext.append([f, pi]); continue
        pl = []
        for b in p.get_text('dict')['blocks']:
            if b['type']: continue
            for l in b['lines']:
                sp = [s for s in l['spans'] if s['text'].strip()]
                t = ''.join(s['text'] for s in l['spans']).strip()
                if not sp or not wanted(t): continue
                s0 = max(sp, key=lambda s: len(s['text']))
                L.append(dict(page=pi, bbox=l['bbox'], text=t, size=s0['size'], color=s0['color'],
                              bold=bool(s0['flags'] & 16) or 'Bold' in s0['font'], dir=l['dir']))
                pl.append(t); uniq[t] = 1
        if pl: pages.append((f'{docs[f]} page {pi + 1}', pl))
    lines[f] = L
json.dump(lines, open(f'{a.out}/lines.json', 'w'), ensure_ascii=False)
json.dump(docs, open(f'{a.out}/docs.json', 'w'), ensure_ascii=False, indent=1)
json.dump(list(uniq), open(f'{a.out}/src.json', 'w'), ensure_ascii=False)
json.dump(notext, open(f'{a.out}/noTextPages.json', 'w'), ensure_ascii=False)
k, cur, n = 1, {}, 0
for key, pl in pages:
    if n and n + len(pl) > a.chunk_lines:
        json.dump(cur, open(f'{a.out}/pages_{k}.json', 'w'), ensure_ascii=False, indent=0); k, cur, n = k + 1, {}, 0
    cur[key] = pl; n += len(pl)
if cur: json.dump(cur, open(f'{a.out}/pages_{k}.json', 'w'), ensure_ascii=False, indent=0)
print(f'{sum(map(len, lines.values()))} lines, {len(uniq)} unique, {k} chunk(s), {len(notext)} page(s) without text layer')
