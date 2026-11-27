"""Extract unique Japanese strings from .pptx / .xlsx files and split them into translation chunks.

pptx: one string per paragraph (runs joined) from text boxes, tables, groups and notes.
xlsx: shared strings (key includes phonetic <rPh> text, matching apply_xlsx.py), drawing paragraphs, sheet names.

Usage: extract.py FILE [FILE ...] --out WORKDIR --target {vi,en,ja} [--keep keep.txt] [--chunk 350]
  --target  target language. Every string that still has non-target wording is extracted, whatever the
            source language (ja/vi/en, mixed decks). Without --target: legacy mode, Japanese strings only.
  --keep    terms kept as written (proper nouns, product names, approved terms); see langcheck.py.
  --project translation memory of this project (tm.py): strings translated before are written to <lang>_chunk_0_tm.json
            instead of the chunks, earlier translations of context-dependent / short strings go to tm_hints.json,
            and the project's saved glossary.md / keep.txt are copied into --out if missing. Needs --target.
  --loc     xlsx: write loc.json = where every string is (sheet + cell / shape anchor / comment / sheet name) and which
            sheet + cell each image is anchored to. Translators can use the sheet as context; other tools can cite it.
"""
import argparse, glob, html, json, os, re, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runlog import track
from langcheck import needs_translation, load_keep, lang_of, main_lang
from pptx_text import para_text, master_layout_frames
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
    texts = []
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
                yield para_text(p)
                texts.append(para_text(p))
    yield from master_strings(prs, texts)


def master_strings(prs, slide_texts):
    """Master / layout text in the deck's main language only. Text in another language there is the company
    template (office addresses, copyright, "Thank you!" in a Japanese deck: 28 strings / 1,420 chars on a
    sample deck) and must not be translated; the deck's own text (整理番号 on every slide) is. No slide text -> keep all."""
    main = main_lang(slide_texts)
    for tf in master_layout_frames(prs):
        for p in tf.paragraphs:
            t = para_text(p)
            if main is None or lang_of(t) == main:
                yield t


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
                # XML entities (&#12304; &quot; &amp;) must be decoded first, or the literal never matches the cell text
                lits.update(x.replace('""', '"') for x in re.findall(r'"((?:[^"]|"")*)"', html.unescape(f)) if x)
            for f in re.findall(r'<(?:x14:)?formula1>(?:<xm:f>)?(.*?)<', s):
                f = html.unescape(f)
                if f.startswith('"') and f.endswith('"'):
                    lits.update(x.strip() for x in f[1:-1].split(',') if x.strip())
    return sorted(x for x in lits if re.search(r'[^\W\d_]', x))   # text only — numbers/symbols never need protecting


def xlsx_locations(path):
    """Where each string sits: {text: [{"file", "sheet", "cell"|"anchor", "kind"}]} plus "__images__": [{media, sheet, anchor}].
    kind = cell | shape | comment | sheetname. Anchors are the top-left cell of the drawing object."""
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    XDR = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
    PR = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    base = os.path.basename(path)

    def rels(part):
        rp = os.path.dirname(part) + '/_rels/' + os.path.basename(part) + '.rels'
        if rp not in names:
            return {}
        out = {}
        for r in ET.fromstring(z.read(rp)).iter(PR + 'Relationship'):
            t = r.get('Target')
            out[r.get('Id')] = t.lstrip('/') if t.startswith('/') else os.path.normpath(os.path.join(os.path.dirname(part), t)).replace(os.sep, '/')
        return out

    def col(n):
        s = ''
        n += 1
        while n:
            n, r = divmod(n - 1, 26)
            s = chr(65 + r) + s
        return s

    sst = []
    if 'xl/sharedStrings.xml' in names:
        sst = [''.join(t.text or '' for t in si.iter(S + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(S + 'si')]
    loc = {}
    add = lambda text, **kw: text.strip() and loc.setdefault(text, []).append(dict(file=base, **kw))
    wb_rels = rels('xl/workbook.xml')
    images = []
    for sh in ET.fromstring(z.read('xl/workbook.xml')).iter(S + 'sheet'):
        sheet, part = sh.get('name'), wb_rels.get(sh.get(R + 'id'))
        add(sheet, sheet=sheet, kind='sheetname')
        if part not in names:
            continue
        for c in ET.fromstring(z.read(part)).iter(S + 'c'):
            v = c.find(S + 'v')
            if c.get('t') == 's' and v is not None:
                add(sst[int(v.text)], sheet=sheet, cell=c.get('r'), kind='cell')
            elif c.get('t') == 'inlineStr':
                add(''.join(t.text or '' for t in c.iter(S + 't')), sheet=sheet, cell=c.get('r'), kind='cell')
        for target in rels(part).values():
            if target.startswith('xl/comments') and target in names:
                for cm in ET.fromstring(z.read(target)).iter(S + 'comment'):
                    add(''.join(t.text or '' for t in cm.iter(S + 't')), sheet=sheet, cell=cm.get('ref'), kind='comment')
            elif target.startswith('xl/drawings/') and target.endswith('.xml') and target in names:
                drels = rels(target)
                for anc in ET.fromstring(z.read(target)):
                    fr = anc.find(XDR + 'from')
                    where = col(int(fr.findtext(XDR + 'col'))) + str(int(fr.findtext(XDR + 'row')) + 1) if fr is not None else '?'
                    for p in anc.iter(A + 'p'):
                        add(''.join(t.text or '' for t in p.iter(A + 't')), sheet=sheet, anchor=where, kind='shape')
                    for b in anc.iter(A + 'blip'):
                        m = drels.get(b.get(R + 'embed'))
                        if m:
                            images.append({'media': m, 'file': base, 'sheet': sheet, 'anchor': where})
    loc['__images__'] = images
    return loc


def xlsx_media(path):
    return [n for n in zipfile.ZipFile(path).namelist() if n.startswith('xl/media/')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--chunk', type=int, default=350)
    ap.add_argument('--target', choices=['vi', 'en', 'ja'])
    ap.add_argument('--keep')
    ap.add_argument('--project')
    ap.add_argument('--loc', action='store_true', help='xlsx: also write loc.json (sheet / cell / shape anchor of every string, image anchors)')
    a = ap.parse_args()
    track(a.out, 'extract')
    if a.project and not a.target:
        ap.error('--project needs --target')
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
    if a.loc:
        loc = {'__images__': []}
        for f in a.files:
            if f.lower().endswith('.xlsx'):
                for k, v in xlsx_locations(f).items():
                    loc.setdefault(k, []).extend(v)
        json.dump(loc, open(f'{a.out}/loc.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(f'loc.json: {len(loc) - 1} strings with positions, {len(loc["__images__"])} anchored image(s)')
    json.dump(uniq, open(f'{a.out}/src.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    todo = uniq
    if a.project:
        import tm
        got = tm.restore_glossary(a.project, a.target, a.out)
        reuse, hints, todo = tm.split(uniq, a.project, a.target)
        tm.write_lookup(a.out, a.target, reuse, hints)
        print(f'TM [{a.project}]: {len(reuse)} re-used ({sum(map(len, reuse))} chars), {len(hints)} with earlier '
              f'translations as hints (tm_hints.json)' + (f'; restored {got}' if got else ''))
    for old in glob.glob(f'{a.out}/chunk_*.json'):
        os.remove(old)
    k = max(1, -(-len(todo) // a.chunk)) if todo else 0
    size = -(-len(todo) // k) if k else 0
    for i in range(k):
        json.dump(todo[i * size:(i + 1) * size], open(f'{a.out}/chunk_{i + 1}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(f'unique: {len(uniq)} strings, {sum(map(len, uniq))} chars; to translate: {len(todo)} strings, '
          f'{sum(map(len, todo))} chars -> {k} chunk(s) in {a.out}')


if __name__ == '__main__':
    main()
