#!/usr/bin/env python3
"""PDF text track, step 3: redact each Japanese line and draw its translation in the same place.

Usage: python3 apply_pdf.py WORKDIR --maps "WORKDIR/vi_*.json" --outdir DIR [--suffix _VN] --target {vi,en,ja} [--keep keep.txt]
       [--fit report|shrink|widen] [--report check.json]
  --fit report (default): draw at the ORIGINAL size and list every line that is too long -> ask the user, then re-run with
        shrink = smaller font, one common scale per (page, original size, bold) so same-kind lines stay uniform, or
        widen  = keep the original size and let the line run on up to the page edge (shrinks only past the edge).
  Never fix length by shortening the translation.
Map keys: exact line text; a page-specific override "<tag>|<page_index0>|<text>" wins (use it when the
same short label needs different words on different pages). Output: DIR/<name><suffix>.pdf
- Redaction rect = middle 50% of the line height, so neighbouring lines/table numbers survive.
- Font: Noto Sans (Bold when the source span is bold); shrinks to fit width (+20% slack, page edge),
  floor 35%. Vertical lines are drawn rotated. Prints how many lines were shrunk.
"""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langcheck import foreign_words, load_keep, fonts_for, JP as JPc, VI as VIc
import pymupdf
ap = argparse.ArgumentParser(); ap.add_argument('work'); ap.add_argument('--maps', required=True)
ap.add_argument('--outdir', required=True); ap.add_argument('--suffix', default='_VN')
ap.add_argument('--target', choices=['vi', 'en', 'ja']); ap.add_argument('--keep'); ap.add_argument('--report')
ap.add_argument('--fit', choices=['report', 'shrink', 'widen'], default='report'); a = ap.parse_args()
KEEP = load_keep(a.keep) if a.keep else []; LEFT, REVIEW, OVER = [], [], []
lines = json.load(open(f'{a.work}/lines.json')); docs = json.load(open(f'{a.work}/docs.json')); M = {}
for f in sorted(glob.glob(a.maps)): M.update(json.load(open(f)))
N = '/usr/share/fonts/truetype/noto/'
_r, _b = fonts_for(a.target, N + 'NotoSans-Regular.ttf', N + 'NotoSans-Bold.ttf')
FR, FB = pymupdf.Font(fontfile=_r), pymupdf.Font(fontfile=_b)
os.makedirs(a.outdir, exist_ok=True); miss, shrunk = [], 0
for f, L in lines.items():
    d = pymupdf.open(f); tag = docs[f]
    for pi, p in enumerate(d):
        mine = [l for l in L if l['page'] == pi]
        if not mine: continue
        for l in mine:
            r = pymupdf.Rect(l['bbox']); h = r.height
            p.add_redact_annot(pymupdf.Rect(r.x0, r.y0 + h * .25, r.x1, r.y1 - h * .25))
        p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
        plan = []
        for l in mine:
            t = M.get(f"{tag}|{pi}|{l['text']}", M.get(l['text']))
            if t is None: miss.append(l['text']); t = l['text']
            if a.target:
                fw = foreign_words(t, a.target, KEEP)
                src = (JPc.search(t) and a.target != 'ja') or (VIc.search(t) and a.target != 'vi')
                if fw and src: LEFT.append({'doc': tag, 'page': pi + 1, 'text': t})
                elif fw and t == l['text']: REVIEW.append({'doc': tag, 'page': pi + 1, 'text': t})
            t = t.replace('\n', ' ').strip()
            if not t: continue
            r = pymupdf.Rect(l['bbox']); F = FB if l['bold'] else FR; vert = abs(l['dir'][0]) < .5
            room = r.height if vert else r.width * 1.2
            edge = r.height if vert else p.rect.x1 - r.x0 - 6
            w = F.text_length(t, l['size'])
            k = 1.0
            if a.fit == 'shrink' and w > room: k = max(room / w, .35)
            elif a.fit in ('widen', 'report') and w > edge: k = max(edge / w, .35)
            if w > room: OVER.append({'doc': tag, 'page': pi + 1, 'text': t[:50], 'size': l['size'], 'scale_to_fit': round(room / w, 2)})
            plan.append([l, t, k])
        if a.fit == 'shrink':                       # one scale per (original size, bold) on the page
            gk = {}
            for l, t, k in plan: gk[(round(l['size'], 1), l['bold'])] = min(gk.get((round(l['size'], 1), l['bold']), 1.0), k)
            for it in plan: it[2] = gk[(round(it[0]['size'], 1), it[0]['bold'])]
        for l, t, k in plan:
            r = pymupdf.Rect(l['bbox']); c = l['color']
            col = ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255
            dx, dy = l['dir']; F = FB if l['bold'] else FR; vert = abs(dx) < .5
            fs = l['size'] * k
            if k < 1: shrunk += 1
            tw = pymupdf.TextWriter(p.rect)
            if not vert:
                tw.append(pymupdf.Point(r.x0, r.y1 - (r.height - fs) / 2 - fs * .22), t, font=F, fontsize=fs)
                tw.write_text(p, color=col)
            else:
                ang = 90 if dy < 0 else -90
                x = r.x0 + (r.width + fs) / 2 - fs * .22 if dy < 0 else r.x1 - (r.width + fs) / 2 + fs * .22
                pt = pymupdf.Point(x, r.y1 if dy < 0 else r.y0)
                tw.append(pt, t, font=F, fontsize=fs); tw.write_text(p, color=col, morph=(pt, pymupdf.Matrix(ang)))
    out = os.path.join(a.outdir, os.path.splitext(os.path.basename(f))[0] + a.suffix + '.pdf')
    d.save(out, garbage=3, deflate=True); print('saved', out)
print('missing', len(miss), miss[:10], '| shrunk', shrunk, f'| fit={a.fit}, too-long lines: {len(OVER)}')
for x in LEFT[:20]: print('   LEFT  ', x['doc'], 'p', x['page'], x['text'][:80])
for x in REVIEW[:40]: print('   REVIEW', x['doc'], 'p', x['page'], x['text'][:80])
if a.fit == 'report':
    for x in OVER[:60]: print(f"   OVER   {x['doc']} p{x['page']} {x['size']:.1f}pt '{x['text'][:30]}' needs x{x['scale_to_fit']}")
    if OVER: print('  -> ask the user: --fit shrink (uniform per kind) or --fit widen (original size, run on to the page edge)')
if a.report: json.dump({'left': LEFT, 'review': REVIEW, 'overflow': OVER}, open(a.report, 'w'), ensure_ascii=False, indent=1)
