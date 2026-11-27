"""Contact sheets: many images as labelled thumbnails on one page, so the main session can look at all of them in one
image view (~1,600 tokens per sheet, estimate) instead of one view per image.

Used by ocr.py for the images OCR left out (IMGDIR/skipped_k.png): OCR misses vertical and tiny text, a look at the
thumbnails does not. Pillow only (works in the OCR venv and the system Python).
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

CELL, COLS, ROWS, LABEL = 256, 6, 6, 18          # 6×6 cells of 256 px -> 1536 px wide: one view at full detail


def sheets(items, out_prefix):
    """items = [(name, path)]. Writes out_prefix_1.png, _2.png … (36 images each); returns the written paths."""
    font = ImageFont.load_default()
    written = []
    per = COLS * ROWS
    for k in range(math.ceil(len(items) / per)):
        chunk = items[k * per:(k + 1) * per]
        rows = math.ceil(len(chunk) / COLS)
        page = Image.new('RGB', (COLS * CELL, rows * (CELL + LABEL)), 'white')
        d = ImageDraw.Draw(page)
        for i, (name, path) in enumerate(chunk):
            x, y = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL)
            try:
                im = Image.open(path).convert('RGB')
            except OSError:
                d.text((x + 4, y + 4), 'unreadable', fill='red', font=font)
                continue
            im.thumbnail((CELL - 8, CELL - 8))
            page.paste(im, (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
            d.rectangle([x, y, x + CELL - 1, y + CELL - 1], outline=(200, 0, 200))
            d.text((x + 4, y + CELL + 2), name, fill='black', font=font)
        p = f'{out_prefix}_{k + 1}.png'
        page.save(p)
        written.append(p)
    return written
