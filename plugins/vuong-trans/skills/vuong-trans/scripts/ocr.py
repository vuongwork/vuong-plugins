"""OCR every image listed in IMGDIR/meta.json with easyocr (ja+en); writes IMGDIR/ocr_<name>.json.

Boxes are reliable location hints; recognized text is often wrong (vertical/small text) — overlay agents
must read the image themselves. Skips images already done, so it can be re-run after an interruption.
Run with the venv from setup_ocr.sh:  $TMPDIR/vtrans_ocr/venv/bin/python ocr.py IMGDIR [--langs ja,en] [--target vi|en|ja] [--keep keep.txt]
  --langs: easyocr languages of the SOURCE images (ja,en for Japanese decks; vi,en for Vietnamese; en for English).
  'src' flag per box = text still needs translation into --target (any source language); 'jp' kept for compatibility.
"""
import argparse, json, os, re, sys
import easyocr
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langcheck import needs_translation, load_keep

ap = argparse.ArgumentParser(); ap.add_argument('imgdir'); ap.add_argument('--langs', default='ja,en')
ap.add_argument('--target', default='vi'); ap.add_argument('--keep'); A = ap.parse_args()
D = A.imgdir; KEEP = load_keep(A.keep) if A.keep else []
M = os.path.join(os.environ.get('VTRANS_OCR', os.path.join(os.environ.get('TMPDIR', '/tmp'), 'vtrans_ocr')), 'models')
JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
reader = easyocr.Reader(A.langs.split(','), gpu=False, model_storage_directory=M, user_network_directory=M + '/user', verbose=False)
for m in json.load(open(os.path.join(D, 'meta.json'))):
    out = os.path.join(D, f"ocr_{m['name']}.json")
    if os.path.exists(out):
        continue
    lines = []
    for box, text, conf in reader.readtext(os.path.join(D, m['name'] + '.png'), mag_ratio=2, text_threshold=0.5, low_text=0.3):
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        lines.append({'box': [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))], 'text': text,
                      'conf': round(float(conf), 2), 'jp': bool(JP.search(text)),
                      'src': needs_translation(text, A.target, KEEP)})
    json.dump(lines, open(out + '.tmp', 'w'), ensure_ascii=False, indent=0)
    os.replace(out + '.tmp', out)          # atomic: agents waiting on the file never see a partial one
    print(m['name'], len(lines), 'boxes,', sum(l['src'] for l in lines), 'to translate', flush=True)
print('OCR done')
