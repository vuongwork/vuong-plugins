"""Write translations back into a .pptx, report or fix overflowing text, and swap in overlaid images.

Usage: apply_pptx.py SRC.pptx --maps "GLOB" --out OUT.pptx --target {vi,en,ja} [--keep keep.txt]
                     [--fit report|shrink|widen] [--report check.json] [--images IMGDIR] [--annotate-vi]
  --maps    glob of JSON files {source: translation} (merged)
  --images  dir produced by extract_images.py; uses out/<name>.png where present (meta.json maps them to shapes)
  Run --help for the other options.
"""
import argparse, glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: F401  (UTF-8 stdout on Windows)
from pptx import Presentation
from pptx.util import Pt

JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R_EMBED = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'


def walk(shapes):
    for s in shapes:
        if s.shape_type == 6:
            yield from walk(s.shapes)
        else:
            yield s


def em(s):
    """Approximate rendered width in ems: CJK/full-width ≈ 1, Latin ≈ 0.55."""
    return sum(1.0 if ord(c) > 0x2e80 else 0.6 for c in s)      # 0.6: Vietnamese diacritics / bold run wider than plain Latin


def run_size(para, r):
    if r.font.size is not None:
        return r.font.size.pt
    d = para._p.find('.//' + A + 'defRPr')
    return int(d.get('sz')) / 100 if d is not None and d.get('sz') else 18.0


def height_needed(texts_sizes, width, k):
    """Estimated text height (pt) after wrapping at `width` with sizes scaled by k (incl. paragraph spacing)."""
    h = 0
    for text, size in texts_sizes:
        sz = size * k
        lines = max(1, -(-em(text) * sz // max(width, 1)))
        h += lines * sz * 1.25 + sz * 0.3
    return h


def frames(prs):
    """(slide_no, text_frame, usable width pt, usable height pt, shape|None); table cells / notes -> shape None."""
    for no, sl in enumerate(prs.slides, 1):
        for s in walk(sl.shapes):
            if s.has_text_frame:
                yield no, s.text_frame, s.width.pt - 14, s.height.pt - 7, s
            if getattr(s, 'has_table', False) and s.has_table:
                t = s.table
                for row in t.rows:
                    for ci, c in enumerate(row.cells):
                        yield no, c.text_frame, t.columns[ci].width.pt - 10, row.height.pt - 4, None
        if sl.has_notes_slide:
            yield no, sl.notes_slide.notes_text_frame, 1e9, 1e9, None


def group_key(shape, size):
    """Frames of the same kind (same base shape name + same original size) must keep one font size."""
    name = re.sub(r'[\d_;:\-\s]+$', '', re.sub(r'\d+', '#', shape.name)) if shape is not None else 'cell'
    return (name, round(size, 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--maps', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--images')
    ap.add_argument('--target', choices=['vi', 'en', 'ja'], help='target language; enables the leftover check for every source language')
    ap.add_argument('--keep', help='keep.txt (terms allowed to stay as written)')
    ap.add_argument('--fit', choices=['report', 'shrink', 'widen'], default='report',
                    help='overflowing frames: report = change nothing, list them (default; ask the user); '
                         'shrink = smaller font, the same scale for every frame of the same kind; '
                         'widen = keep the original size, widen the frame and push right-hand neighbours')
    ap.add_argument('--report', help='write overflow + leftover lists as JSON here (work dir, not the user folder)')
    ap.add_argument('--min-scale', type=float, default=0.6)
    ap.add_argument('--annotate-vi', action='store_true',
                    help='append Vietnamese meaning in brackets to English WMS terms, first occurrence per slide (annotate_vi.py)')
    a = ap.parse_args()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from langcheck import foreign_words, load_keep, JP as JPc, VI as VIc
    keep = load_keep(a.keep) if a.keep else []

    tmap = {}
    for f in sorted(glob.glob(a.maps)):
        tmap.update(json.load(open(f, encoding='utf-8')))
    prs = Presentation(a.src)
    SW = prs.slide_width

    if a.annotate_vi:
        from annotate_vi import annotate
    seen = {}
    left, review, over = [], [], []
    for slide_no, tf, width, height, shape in frames(prs):
        ja, tr = [], []
        for para in tf.paragraphs:
            runs = para.runs
            if not runs:
                continue
            text = ''.join(r.text for r in runs)
            size = run_size(para, runs[0])
            ja.append((text, size))
            new = tmap.get(text)
            out = text if new is None else new
            # leftover check against the TARGET language (any source language)
            if a.target:
                src_script = (JPc.search(out) and a.target != 'ja') or (VIc.search(out) and a.target != 'vi')
                fw = foreign_words(out, a.target, keep)
                if src_script and fw:
                    left.append({'slide': slide_no, 'text': out, 'words': fw})
                elif fw and out == text:
                    review.append({'slide': slide_no, 'text': out, 'words': fw})
            elif new is None and JP.search(text):
                left.append({'slide': slide_no, 'text': text, 'words': []})
            if new is None:
                tr.append((text, size))
                continue
            if a.annotate_vi:
                new = annotate(new, seen.setdefault(slide_no, set()))
            tr.append((new, size))
            runs[0].text = new
            for r in runs[1:]:
                r._r.getparent().remove(r._r)
        if not tr:
            continue
        budget = max(height, height_needed(ja, width, 1.0))
        nowrap = tf.word_wrap is False
        line_w = lambda items, k: max(max(em(l) for l in t.split('\n')) * sz * k for t, sz in items)
        if nowrap:     # single-line frames: compare line width, not height
            src_w = max(width, line_w(ja, 1.0))
            if line_w(tr, 1.0) <= src_w * 1.02:
                continue
            k = max(a.min_scale, src_w / line_w(tr, 1.0))
            over.append({'slide': slide_no, 'shape': shape.name if shape is not None else '(table cell/notes)',
                         'text': tr[0][0][:60], 'size': tr[0][1], 'scale_to_fit': round(k, 2),
                         'extra_width_pt': round(line_w(tr, 1.0) - width), '_tf': tf, '_shape': shape,
                         '_key': group_key(shape, tr[0][1]), '_k': k, '_need_w': line_w(tr, 1.0) + 14})
            continue
        if height_needed(tr, width, 1.0) <= budget * 1.05:
            continue
        k = 1.0
        while k > a.min_scale and height_needed(tr, width, k) > budget * 1.05:
            k -= 0.05
        need_w = width
        while need_w < width * 4 and height_needed(tr, need_w, 1.0) > budget * 1.05:
            need_w += 6
        over.append({'slide': slide_no, 'shape': shape.name if shape is not None else '(table cell/notes)',
                     'text': tr[0][0][:60], 'size': tr[0][1], 'scale_to_fit': round(k, 2),
                     'extra_width_pt': round(need_w - width), '_tf': tf, '_shape': shape,
                     '_key': group_key(shape, tr[0][1]), '_k': k, '_need_w': need_w + 14})

    changed = []
    if a.fit == 'shrink':
        gk = {}
        for o in over:
            gk[o['_key']] = min(gk.get(o['_key'], 1.0), o['_k'])
        for slide_no, tf, width, height, shape in frames(prs):
            runs0 = [p for p in tf.paragraphs if p.runs]
            if not runs0:
                continue
            key = group_key(shape, run_size(runs0[0], runs0[0].runs[0]))
            if key in gk:
                for para in tf.paragraphs:
                    for r in para.runs:
                        r.font.size = Pt(max(6, round(run_size(para, r) * gk[key], 1)))
                changed.append(f'slide {slide_no} {shape.name if shape is not None else "cell"}: x{gk[key]:.2f}')
    elif a.fit == 'widen':
        for o in over:
            s = o['_shape']
            if s is None:
                o['note'] = 'table cell / notes: cannot widen, fix by hand'
                continue
            sl = prs.slides[o['slide'] - 1]
            old_right = s.left + s.width
            new_w = min(int(o['_need_w'] * 12700), SW - s.left - 91440)
            delta = new_w - s.width
            if delta <= 0:
                continue
            s.width = new_w
            for x in walk(sl.shapes):        # push neighbours on the same row that start right of the frame
                if x.shape_id != s.shape_id and abs(x.top - s.top) < s.height and x.left >= old_right - 12700:
                    x.left = min(x.left + delta, SW - x.width)
            hits = [x.name for x in walk(sl.shapes) if x.shape_id != s.shape_id and x.left < s.left + s.width and x.left + x.width > s.left
                    and x.top < s.top + s.height and x.top + x.height > s.top and x.left < old_right]
            changed.append(f'slide {o["slide"]} {s.name}: +{delta / 12700:.0f}pt' + (f'  (touches: {", ".join(hits[:3])})' if hits else ''))
            if new_w < o['_need_w'] * 12700:
                changed[-1] += '  (slide edge reached: still overflows)'
    # master / layout texts (footers etc.)
    for layout in [prs.slide_master, *prs.slide_layouts]:
        for s in layout.shapes:
            if s.has_text_frame:
                for para in s.text_frame.paragraphs:
                    for r in para.runs:
                        if r.text in tmap:
                            r.text = tmap[r.text]
                        elif r.text.strip() in tmap:
                            r.text = tmap[r.text.strip()]

    swapped = 0
    if a.images:
        meta = json.load(open(os.path.join(a.images, 'meta.json'), encoding='utf-8'))
        for m in meta:
            out = os.path.join(a.images, 'out', m['name'] + '.png')
            if not os.path.exists(out):
                continue
            sl = prs.slides[m['slide'] - 1]
            shp = [x for x in walk(sl.shapes) if x.shape_id == m['shape_id']][0]
            _, rid = sl.part.get_or_add_image_part(out)
            shp._element.xpath('.//a:blip')[0].set(R_EMBED, rid)
            swapped += 1

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    prs.save(a.out)
    print(f'{a.out}\n  leftover source-language paragraphs: {len(left)}; unchanged non-target paragraphs to review: {len(review)};'
          f' overflowing frames: {len(over)} (fit={a.fit}); images swapped: {swapped}')
    for t in left[:20]:
        print('   LEFT  ', t['slide'], t['text'][:90])
    for t in review[:40]:
        print('   REVIEW', t['slide'], t['text'][:70], '->', t['words'][:4])
    if a.fit == 'report':
        for o in over[:60]:
            print(f"   OVER   slide {o['slide']} {o['shape'][:30]} {o['size']}pt '{o['text'][:30]}' shrink x{o['scale_to_fit']} or +{o['extra_width_pt']}pt width")
        if over:
            print('  -> ask the user: --fit shrink (uniform per kind) or --fit widen (keep size, widen frame)')
    for c in changed:
        print('   FIT   ', c)
    if a.report:
        json.dump({'left': left, 'review': review, 'overflow': [{k: v for k, v in o.items() if not k.startswith('_')} for o in over],
                   'fit_changes': changed}, open(a.report, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
