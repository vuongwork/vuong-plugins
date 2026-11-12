"""Paint translated text over the Japanese regions of extracted images.

Region file IMGDIR/<lang>_<name>.json: [{"box":[x1,y1,x2,y2], "vi": "...", "bg":"#rrggbb"?, "fg":"#rrggbb"?,
                                       "align":"center"?, "bold":true?}]   (key "text" also accepted for "vi")
Coordinates are source-image pixels. Output IMGDIR/out/<name>.png at SCALE x.
Usage: overlay.py IMGDIR --lang vi [NAME ...]     (no NAME = every region file of that language)
"""
import argparse, glob, json, os
from PIL import Image, ImageDraw, ImageFont

SCALE = 2
FONT = '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'
FONT_B = '/usr/share/fonts/truetype/noto/NotoSans-SemiBold.ttf'
FALLBACK = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'   # → ① ▲ ○ ● etc. missing in Noto Sans
try:
    from fontTools.ttLib import TTFont
    CMAP = set(TTFont(FONT).getBestCmap())
except Exception:                       # fontTools missing: draw everything with the main font
    CMAP = None


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


def render(d, name, lang):
    src = Image.open(f'{d}/{name}.png').convert('RGB')
    im = src.resize((src.width * SCALE, src.height * SCALE), Image.LANCZOS)
    draw = ImageDraw.Draw(im)
    for r in json.load(open(f'{d}/{lang}_{name}.json')):
        text = r.get('vi', r.get('text', ''))
        box = [int(v * SCALE) for v in r['box']]
        box = [max(0, box[0] - 2), max(0, box[1] - 2), min(im.width - 1, box[2] + 2), min(im.height - 1, box[3] + 2)]
        bg = hexrgb(r['bg']) if r.get('bg') else bg_color(im, box)
        draw.rectangle(box, fill=bg)
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


def use_lang_fonts(lang):
    """Target ja: Noto Sans CJK (Noto Sans has no Japanese glyphs)."""
    global FONT, FONT_B, CMAP
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from langcheck import fonts_for
    FONT, FONT_B = fonts_for(lang, FONT, FONT_B)
    if lang == 'ja':
        try:
            CMAP = set(TTFont(FONT, fontNumber=0).getBestCmap())
        except Exception:
            CMAP = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('imgdir')
    ap.add_argument('names', nargs='*')
    ap.add_argument('--lang', default='vi')
    a = ap.parse_intermixed_args()          # allow "IMGDIR --lang vi NAME" and "IMGDIR NAME --lang vi"
    use_lang_fonts(a.lang)
    pre = f'{a.imgdir}/{a.lang}_'
    names = a.names or sorted(f[len(pre):-5] for f in glob.glob(pre + '*.json'))
    for n in names:
        render(a.imgdir, n, a.lang)
        print('ok', n)


if __name__ == '__main__':
    main()
