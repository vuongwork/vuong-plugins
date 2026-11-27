"""OCR every image listed in IMGDIR/meta.json with easyocr (ja+en); writes IMGDIR/ocr_<name>.json.

Boxes are reliable location hints; recognized text is often wrong (vertical/small text) — overlay agents
must read the image themselves. Skips images already done, so it can be re-run after an interruption.
Run with the venv python printed by `setup_env.py ocr` ($OCRPY):  $OCRPY ocr.py IMGDIR [--langs ja,en] [--target vi|en|ja] [--keep keep.txt]
  --langs: easyocr languages of the SOURCE images (ja,en for Japanese decks; vi,en for Vietnamese; en for English).
  'src' flag per box = text still needs translation into --target (any source language); 'jp' kept for compatibility.
  IMGDIR/todo.json = images to give overlay agents: >= --min-src (default 2) 'src' boxes, OR one 'src' box that is a real
  label (>= 2 source-language letters — kana/kanji for ja — at conf >= 0.5). Duplicates (meta dup_of) are not OCR'd.
  IMGDIR/skipped_k.png = thumbnails of every other image: the main session views them once and adds any image with text to
  todo.json. It catches images whose clearly visible text OCR did not recognise (vertical, stylised); thumbnails are too
  small for tiny text — that is covered by the full-detail pass below.
  Speed: fast pass at the image's own size capped at 1600 px (mag_ratio 1); an image larger than that which the fast pass
  would leave out is read again at full detail (mag_ratio 2, the old setting), because shrinking can lose tiny text.
  Images given to agents need no second pass: the agent reads the image itself.
"""
import argparse, glob, json, os, re, sys
import easyocr
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runlog import track
from langcheck import needs_translation, load_keep, worth_translating
from contact import sheets
from PIL import Image
from common import vt_home

ap = argparse.ArgumentParser(); ap.add_argument('imgdir'); ap.add_argument('--langs', default='ja,en')
ap.add_argument('--target', default='vi'); ap.add_argument('--keep'); ap.add_argument('--min-src', type=int, default=2)
A = ap.parse_args()
track(A.imgdir, 'ocr')
D = A.imgdir; KEEP = load_keep(A.keep) if A.keep else []
M = os.path.join(vt_home('ocr'), 'models')      # same folder setup_env.py ocr downloaded the models into
JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
reader = easyocr.Reader(A.langs.split(','), gpu=False, model_storage_directory=M, user_network_directory=M + '/user', verbose=False)
SRC_LANG = 'ja' if 'ja' in A.langs.split(',') else 'en'
FAST = 1600


def read(path, **kw):
    out = []
    for box, text, conf in reader.readtext(path, text_threshold=0.5, low_text=0.3, **kw):
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        out.append({'box': [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))], 'text': text,
                    'conf': round(float(conf), 2), 'jp': bool(JP.search(text)),
                    'src': needs_translation(text, A.target, KEEP)})
    return out


todo, done = [], []
for m in json.load(open(os.path.join(D, 'meta.json'), encoding='utf-8')):
    if m.get('dup_of') or m.get('missing'):
        continue
    done.append(m['name'])
    out = os.path.join(D, f"ocr_{m['name']}.json")
    if os.path.exists(out):
        if worth_translating(json.load(open(out, encoding='utf-8')), A.min_src, SRC_LANG):
            todo.append(m['name'])
        continue
    path = os.path.join(D, m['name'] + '.png')
    lines = read(path, mag_ratio=1, canvas_size=FAST)
    fine = False
    if not worth_translating(lines, A.min_src, SRC_LANG) and max(Image.open(path).size) > FAST:
        # the fast pass shrank this image: tiny text may have vanished -> read it again at full detail before leaving it out
        lines, fine = read(path, mag_ratio=2), True
    json.dump(lines, open(out + '.tmp', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    os.replace(out + '.tmp', out)          # atomic: agents waiting on the file never see a partial one
    n_src = sum(l['src'] for l in lines)
    if worth_translating(lines, A.min_src, SRC_LANG):
        todo.append(m['name'])
    print(m['name'], len(lines), 'boxes,', n_src, 'to translate' + (' (re-read at full detail)' if fine else ''), flush=True)
json.dump(todo, open(os.path.join(D, 'todo.json'), 'w', encoding='utf-8'), indent=0)
skipped = [(n, os.path.join(D, n + '.png')) for n in done if n not in todo]
for old in glob.glob(os.path.join(D, 'skipped_*.png')):
    os.remove(old)
pages = sheets(skipped, os.path.join(D, 'skipped'))
print(f'OCR done; {len(todo)} image(s) with text to translate -> todo.json (give only these to overlay agents)')
if pages:
    print(f'{len(skipped)} image(s) left out -> VIEW {", ".join(pages)} once; add every image showing text to todo.json')
