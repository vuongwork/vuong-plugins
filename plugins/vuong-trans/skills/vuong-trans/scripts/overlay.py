"""Paint translated text over the Japanese regions of extracted images.

Region file IMGDIR/<lang>_<name>.json: [{"box":[x1,y1,x2,y2], "vi": "...", "bg":"#rrggbb"?, "fg":"#rrggbb"?,
                                       "align":"center"?, "bold":true?}]   (key "text" also accepted for "vi")
Coordinates are source-image pixels. Output IMGDIR/out/<name>.png at SCALE x.
Also writes IMGDIR/out/check_<name>.png: only the painted areas (+ a margin), source left | output right, one row per
area. Agents check THIS after each fix round instead of the whole 2x image (text covered ~5-16 % of the image area in
the JA-IMG sample, so a check sheet costs a fraction of the vision tokens); view the full output once at the end.
Usage: overlay.py IMGDIR --lang vi [NAME ...]     (no NAME = every region file of that language)
"""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runlog import track
from common import find_font, fonts           # also switches stdout to UTF-8 (Windows)
from PIL import Image, ImageDraw, ImageFont

SCALE = 2
FONT = FONT_B = FALLBACK = None   # set by use_lang_fonts(): Noto Sans (or OS fallback), CJK for ja
CMAP = None                       # glyphs of FONT; others are drawn with FALLBACK (→ ① ▲ ○ ● missing in Noto Sans)


def _cmap(path):
    try:
        from fontTools.ttLib import TTFont
        kw = {'fontNumber': 0} if path.lower().endswith('.ttc') else {}
        return set(TTFont(path, **kw).getBestCmap())
    except Exception:                   # fontTools missing: draw everything with the main font
        return None


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def bg_color(im, box):
    """Median colour of the pixels just around the box."""
    x1, y1, x2, y2 = box
    px = []
    for x in range(x1, x2, max(1, (x2 - x1) // 20)):
        for y in (max(y1 - 2, 0), min(y2 + 1, im.height - 1)):
            px.append(im.getpixel((x, y))[:3])
    for y in range(y1, y2, max(1, (y2 - y1) // 6)):
        for x in (max(x1 - 2, 0), min(x2 + 1, im.width - 1)):
            px.append(im.getpixel((x, y))[:3])
    px.sort(key=sum)
    return px[len(px) // 2]


def wrap(draw, text, font, width):
    lines = []
    for para in text.split('\n'):
        cur = ''
        for w in para.split(' '):
            t = (cur + ' ' + w).strip()
            if draw.textlength(t, font=font) <= width or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def fit(draw, text, box, bold):
    """Largest font (≤ 80 % of box height, ≤ 60 px) whose wrapped text fits the box."""
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    size = max(8, int(min(h * 0.8, 60)))
    while size >= 7:
        font = ImageFont.truetype(FONT_B if bold else FONT, size)
        lines = wrap(draw, text, font, w)
        lh = int(size * 1.18)
        if len(lines) * lh <= h + size * 0.3 and all(draw.textlength(l, font=font) <= w + 2 for l in lines):
            return font, lines, lh
        size -= 1
    return font, lines, lh


def check_sheet(before, after, boxes, margin=16 * SCALE, gap=6):
    """Side-by-side crops (before | after) of the painted areas; overlapping areas are merged into one row."""
    areas = []
    for b in boxes:
        x1, y1, x2, y2 = max(0, b[0] - margin), max(0, b[1] - margin), min(after.width, b[2] + margin), min(after.height, b[3] + margin)
        for a in areas:
            if x1 < a[2] and a[0] < x2 and y1 < a[3] and a[1] < y2:
                a[:] = [min(a[0], x1), min(a[1], y1), max(a[2], x2), max(a[3], y2)]
                break
        else:
            areas.append([x1, y1, x2, y2])
    merged = True
    while merged:                                   # merging can create new overlaps
        merged = False
        for i in range(len(areas)):
            for j in range(i + 1, len(areas)):
                a, b = areas[i], areas[j]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    areas[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del areas[j]
                    merged = True
                    break
            if merged:
                break
    areas.sort(key=lambda a: (a[1], a[0]))
    w = max(2 * (a[2] - a[0]) + gap for a in areas)
    h = sum(a[3] - a[1] + gap for a in areas)
    sheet = Image.new('RGB', (w, h), (255, 0, 255))   # magenta separators: never mistaken for document content
    y = 0
    for a in areas:
        sheet.paste(before.crop(a), (0, y))
        sheet.paste(after.crop(a), (a[2] - a[0] + gap, y))
        y += a[3] - a[1] + gap
    return sheet


def render(d, name, lang):
    src = Image.open(f'{d}/{name}.png').convert('RGB')
    im = src.resize((src.width * SCALE, src.height * SCALE), Image.LANCZOS)
    before = im.copy()
    boxes = []
    draw = ImageDraw.Draw(im)
    for r in json.load(open(f'{d}/{lang}_{name}.json', encoding='utf-8')):
        text = r.get('vi', r.get('text', ''))
        box = [int(v * SCALE) for v in r['box']]
        box = [max(0, box[0] - 2), max(0, box[1] - 2), min(im.width - 1, box[2] + 2), min(im.height - 1, box[3] + 2)]
        bg = hexrgb(r['bg']) if r.get('bg') else bg_color(im, box)
        draw.rectangle(box, fill=bg)
        boxes.append(box)
        if not text.strip():
            continue                      # blank cover region
        fg = hexrgb(r['fg']) if r.get('fg') else ((0, 0, 0) if sum(bg) > 380 else (255, 255, 255))
        font, lines, lh = fit(draw, text, box, r.get('bold', False))
        fb = ImageFont.truetype(FALLBACK, font.size)
        y = box[1] + max(0, (box[3] - box[1] - len(lines) * lh) // 2)
        for l in lines:
            x = box[0] + (box[2] - box[0] - draw.textlength(l, font=font)) / 2 if r.get('align') == 'center' else box[0] + 1
            for ch in l:                  # per-glyph fallback font
                f = font if CMAP is None or ord(ch) in CMAP else fb
                draw.text((x, y), ch, font=f, fill=fg)
                x += draw.textlength(ch, font=f)
            y += lh
    os.makedirs(f'{d}/out', exist_ok=True)
    im.save(f'{d}/out/{name}.png', optimize=True)
    if boxes:
        sheet = check_sheet(before, im, boxes)
        sheet.save(f'{d}/out/check_{name}.png', optimize=True)
        return sheet.width * sheet.height / (im.width * im.height)
    return 0.0


def use_lang_fonts(lang):
    """Noto Sans (SemiBold for bold); target ja: Noto Sans CJK (Noto Sans has no Japanese glyphs)."""
    global FONT, FONT_B, FALLBACK, CMAP
    FONT, FONT_B = fonts(lang, semibold=True)
    FALLBACK = find_font('symbol')
    CMAP = _cmap(FONT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('imgdir')
    ap.add_argument('names', nargs='*')
    ap.add_argument('--lang', default='vi')
    a = ap.parse_intermixed_args()          # allow "IMGDIR --lang vi NAME" and "IMGDIR NAME --lang vi"
    track(a.imgdir, 'overlay')
    use_lang_fonts(a.lang)
    pre = f'{a.imgdir}/{a.lang}_'
    names = a.names or sorted(f[len(pre):-5] for f in glob.glob(pre + '*.json'))
    for n in names:
        ratio = render(a.imgdir, n, a.lang)
        print(f'ok {n}  (check_{n}.png = {ratio:.0%} of the full output area)')


if __name__ == '__main__':
    main()
