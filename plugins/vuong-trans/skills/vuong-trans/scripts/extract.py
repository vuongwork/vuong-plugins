"""Extract unique Japanese strings from .pptx / .xlsx files and split them into translation chunks.

pptx: one string per paragraph (runs joined) from text boxes, tables, groups and notes.
xlsx: shared strings (key includes phonetic <rPh> text, matching apply_xlsx.py), drawing paragraphs, sheet names.

Usage: extract.py FILE [FILE ...] --out WORKDIR --target {vi,en,ja} [--keep keep.txt] [--chunk 350]
  --target  target language. Every string that still has non-target wording is extracted, whatever the
            source language (ja/vi/en, mixed decks). Without --target: legacy mode, Japanese strings only.
  --keep    terms kept as written (proper nouns, product names, approved terms); see langcheck.py.
"""
import argparse, json, os, re, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langcheck import needs_translation, load_keep
from xml.etree import ElementTree as ET

JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def walk(shapes):
    for s in shapes:
        if s.shape_type == 6:
            yield from walk(s.shapes)
        else:
            yield s


def pptx_strings(path):
    from pptx import Presentation
    prs = Presentation(path)
    for sl in prs.slides:
        frames = []
        for s in walk(sl.shapes):
            if s.has_text_frame:
                frames.append(s.text_frame)
            if getattr(s, 'has_table', False) and s.has_table:
                frames += [c.text_frame for row in s.table.rows for c in row.cells]
        if sl.has_notes_slide:
            frames.append(sl.notes_slide.notes_text_frame)
        for tf in frames:
            for p in tf.paragraphs:
                yield ''.join(r.text for r in p.runs)


def xlsx_strings(path):
    z = zipfile.ZipFile(path)
    for n in z.namelist():
        if n.endswith('sharedStrings.xml'):
            for si in ET.fromstring(z.read(n)).findall(S + 'si'):
                yield ''.join(t.text or '' for t in si.iter(S + 't'))
        elif n.startswith('xl/drawings/') and n.endswith('.xml'):
            for p in ET.fromstring(z.read(n)).iter(A + 'p'):
                yield ''.join(t.text or '' for t in p.iter(A + 't'))
        elif n.startswith('xl/worksheets/') and n.endswith('.xml'):       # inline strings (openpyxl-written files)
            for c in ET.fromstring(z.read(n)).iter(S + 'c'):
                if c.get('t') == 'inlineStr':
                    yield ''.join(t.text or '' for t in c.iter(S + 't'))
        elif n.startswith('xl/comments') and n.endswith('.xml'):          # cell comments (notes)
            for c in ET.fromstring(z.read(n)).iter(S + 'comment'):
                yield ''.join(t.text or '' for t in c.iter(S + 't'))
        elif n == 'xl/workbook.xml':
            yield from re.findall(r'<sheet [^>]*name="([^"]+)"', z.read(n).decode('utf-8'))


def xlsx_formula_literals(path):
    """String literals used inside formulas ("YES", "Frontend"…) and list validations: translating the cell text
    that a formula compares against breaks the formula, so these are kept as written."""
    z, lits = zipfile.ZipFile(path), set()
    for n in z.namelist():
        if n.startswith('xl/worksheets/') and n.endswith('.xml'):
            s = z.read(n).decode('utf-8')
            for f in re.findall(r'<f(?:\s[^>]*[^/])?>(.*?)</f>', s, re.S):
                lits.update(x for x in re.findall(r'&quot;(.*?)&quot;|"(.*?)"', f) for x in x if x)
            for f in re.findall(r'<(?:x14:)?formula1>(?:<xm:f>)?"(.*?)"', s):
                lits.update(x.strip() for x in f.split(',') if x.strip())
    return sorted(x for x in lits if re.search(r'[^\W\d_]', x))   # text only — numbers/symbols never need protecting


def xlsx_media(path):
    return [n for n in zipfile.ZipFile(path).namelist() if n.startswith('xl/media/')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--chunk', type=int, default=350)
    ap.add_argument('--target', choices=['vi', 'en', 'ja'])
    ap.add_argument('--keep')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    found = []
    for f in a.files:
        gen = pptx_strings(f) if f.lower().endswith('.pptx') else xlsx_strings(f)
        n0 = len(found)
        keep = load_keep(a.keep) if a.keep else []
        if f.lower().endswith('.xlsx'):
            lits = xlsx_formula_literals(f)
            if lits:
                kp = a.keep or f'{a.out}/keep.txt'
                old = open(kp, encoding='utf-8').read().splitlines() if os.path.exists(kp) else []
                add = [x for x in lits if x not in old]
                if add:
                    open(kp, 'a', encoding='utf-8').write(('\n' if old and old[-1] else '') + '\n'.join(add) + '\n')
                keep = load_keep(kp)
                print(f'  formula/validation literals kept as written (added to {kp}): {lits}')
            media = xlsx_media(f)
            if media:
                print(f'  images in workbook (check for baked-in text, redraw charts/translate via track B): {media}')
        if a.target:
            found += [t for t in gen if needs_translation(t, a.target, keep)]
        else:
            found += [t for t in gen if JP.search(t)]
        print(f'{os.path.basename(f)}: {len(found) - n0} strings to translate' + (f' (target {a.target})' if a.target else ' (Japanese)'))
    uniq = list(dict.fromkeys(found))
    json.dump(uniq, open(f'{a.out}/src.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    k = max(1, -(-len(uniq) // a.chunk))
    size = -(-len(uniq) // k)
    for i in range(k):
        json.dump(uniq[i * size:(i + 1) * size], open(f'{a.out}/chunk_{i + 1}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(f'unique: {len(uniq)} strings, {sum(map(len, uniq))} chars -> {k} chunk(s) in {a.out}')


if __name__ == '__main__':
    main()
