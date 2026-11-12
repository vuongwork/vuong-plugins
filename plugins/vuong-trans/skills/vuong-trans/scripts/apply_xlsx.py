"""Write translations into an .xlsx by editing the zip XML directly (keeps shapes, images, formulas, styles).

Translates sharedStrings and inline strings (rich-text runs merged into the first run, phonetic <rPh> dropped), drawing/shape
paragraphs, cell comments, cached text results of formulas (t="str") and sheet names; renamed sheets are fixed inside formulas,
defined names and chart references. String literals used in formulas / validation lists (e.g. "YES") are never translated.
Sets fullCalcOnLoad so Excel recalculates on open. Images in xl/media are listed, not translated.

Usage: apply_xlsx.py SRC.xlsx --maps "GLOB" --out OUT.xlsx
"""
import argparse, glob, json, os, re, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langcheck import foreign_words, load_keep, JP as JPc, VI as VIc
from lxml import etree

A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'
JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')


def sync_table_headers(parts):
    """Excel Online refuses a workbook whose tableColumn names differ from the header cell texts.
    Set every tableColumn name to the (translated) text actually in its header row."""
    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    sst = []
    if 'xl/sharedStrings.xml' in parts:
        sst = [''.join(x.text or '' for x in si.iter('{%s}t' % S))
               for si in etree.fromstring(parts['xl/sharedStrings.xml']).findall('{%s}si' % S)]
    for n in [p for p in parts if re.match(r'xl/worksheets/_rels/sheet\d+\.xml\.rels$', p)]:
        sheet = 'xl/worksheets/' + n.split('/')[-1][:-5]
        rels = re.findall(r'Target="\.\./tables/(table\d+\.xml)"', parts[n].decode('utf-8'))
        if not rels:
            continue
        cells = {}
        for c in etree.fromstring(parts[sheet]).iter('{%s}c' % S):
            v, t = c.find('{%s}v' % S), c.get('t')
            if t == 's' and v is not None:
                cells[c.get('r')] = sst[int(v.text)]
            elif t == 'inlineStr':
                cells[c.get('r')] = ''.join(x.text or '' for x in c.iter('{%s}t' % S))
            elif v is not None:
                cells[c.get('r')] = v.text
        for tb in rels:
            tn = 'xl/tables/' + tb
            root = etree.fromstring(parts[tn])
            m = re.match(r'([A-Z]+)(\d+)', root.get('ref', ''))
            if not m or root.get('headerRowCount') == '0':
                continue
            col = 0
            for ch in m.group(1):
                col = col * 26 + ord(ch) - 64
            for k, tc in enumerate(root.iter('{%s}tableColumn' % S)):
                c, letters = col + k, ''
                while c:
                    c, r = divmod(c - 1, 26)
                    letters = chr(65 + r) + letters
                h = cells.get(letters + m.group(2))
                if h and h != tc.get('name'):
                    tc.set('name', h)
            parts[tn] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--maps', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--target', choices=['vi', 'en', 'ja'], help='target language; enables the leftover check for every source language')
    ap.add_argument('--keep', help='keep.txt (terms allowed to stay as written)')
    ap.add_argument('--report', help='write LEFT / REVIEW lists as JSON here (work dir)')
    a = ap.parse_args()
    keep = load_keep(a.keep) if a.keep else []
    review = []
    tmap = {}
    for f in sorted(glob.glob(a.maps)):
        tmap.update(json.load(open(f)))
    left = []

    from extract import xlsx_formula_literals
    literals = set(xlsx_formula_literals(a.src))    # text compared inside formulas / validation lists: never translate
    kept_literals = set()

    def tr(text):
        if not text.strip():
            return None
        if text in literals:
            if text in tmap and tmap[text] != text:
                kept_literals.add(text)
            return None
        new = tmap.get(text)
        out = text if new is None else new
        if a.target:
            fw = foreign_words(out, a.target, keep)
            src_script = (JPc.search(out) and a.target != 'ja') or (VIc.search(out) and a.target != 'vi')
            if fw and src_script:
                left.append(out)
            elif fw and out == text:
                review.append(out)
        elif new is None and JP.search(text):
            left.append(text)
        return new

    def set_runs(runs, ttag, new):
        runs[0].find(ttag).text = new
        for r in runs[1:]:
            r.getparent().remove(r)

    zin = zipfile.ZipFile(a.src)
    wb = zin.read('xl/workbook.xml').decode('utf-8')
    renames, used = {}, set()
    for name in re.findall(r'<sheet [^>]*name="([^"]+)"', wb):
        new = tmap.get(name)
        if new and new != name:
            new = re.sub(r"[\[\]:*?/\\]", '-', new)[:31].strip("'")
            while new in used:
                new = new[:29] + '_' + str(len(used))
            used.add(new)
            renames[name] = new

    def fix_refs(s):
        for old, new in renames.items():
            q = "'%s'" % new.replace("'", "''")
            s = s.replace("'%s'!" % old, q + '!').replace(old + '!', q + '!')
        return s

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    zout = zipfile.ZipFile(a.out, 'w', zipfile.ZIP_DEFLATED)
    parts = {}
    for item in zin.infolist():
        n, data = item.filename, zin.read(item.filename)
        if n == 'xl/workbook.xml':
            s = data.decode('utf-8')
            for old, new in renames.items():
                s = s.replace('name="%s"' % old, 'name="%s"' % new.replace('"', '&quot;'))
            s = re.sub(r'(<definedName[^>]*>)(.*?)(</definedName>)', lambda m: m.group(1) + fix_refs(m.group(2)) + m.group(3), s)
            # cached results of text formulas were translated by map; force Excel to recalc on open anyway
            if '<calcPr' in s and 'fullCalcOnLoad' not in s:
                s = s.replace('<calcPr', '<calcPr fullCalcOnLoad="1"', 1)
            data = s.encode('utf-8')
        elif n.startswith('xl/comments') and n.endswith('.xml'):
            root = etree.fromstring(data)
            for cm in root.iter('{%s}comment' % S):
                txt = cm.find('{%s}text' % S)
                if txt is None:
                    continue
                new = tr(''.join(x.text or '' for x in txt.iter('{%s}t' % S)))
                if new is None:
                    continue
                runs = txt.findall('{%s}r' % S)
                if runs:
                    set_runs(runs, '{%s}t' % S, new)
                    t = runs[0].find('{%s}t' % S)
                else:
                    t = txt.find('{%s}t' % S)
                    t.text = new
                t.set(XML_SPACE, 'preserve')
            data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        elif n == 'xl/sharedStrings.xml':
            root = etree.fromstring(data)
            for si in root.findall('{%s}si' % S):
                key = ''.join(x.text or '' for x in si.iter('{%s}t' % S))   # same key as extract.py
                for rph in si.findall('{%s}rPh' % S):
                    si.remove(rph)
                new = tr(key)
                if new is None:
                    continue
                runs = si.findall('{%s}r' % S)
                if runs:
                    set_runs(runs, '{%s}t' % S, new)
                    t = runs[0].find('{%s}t' % S)
                else:
                    t = si.find('{%s}t' % S)
                    t.text = new
                t.set(XML_SPACE, 'preserve')
            data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        elif n.startswith('xl/drawings/') and n.endswith('.xml'):
            root = etree.fromstring(data)
            for p in root.iter('{%s}p' % A):
                runs = [r for r in p if r.tag == '{%s}r' % A]
                if runs:
                    new = tr(''.join(r.findtext('{%s}t' % A) or '' for r in runs))
                    if new is not None:
                        set_runs(runs, '{%s}t' % A, new)
            data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        elif n.startswith('xl/worksheets/') and n.endswith('.xml'):
            if b'inlineStr' in data or b't="str"' in data or renames:   # inline strings (openpyxl files) + cached text results of formulas; re-serialising also turns &#NNN; entities in formulas into chars so fix_refs can match
                root = etree.fromstring(data)
                for c in root.iter('{%s}c' % S):
                    if c.get('t') == 'str':                 # =OtherSheet!B15 etc.: cached value still shows the source text until recalculated
                        v = c.find('{%s}v' % S)
                        if v is not None and v.text:
                            new = tmap.get(v.text)
                            if new is not None and v.text not in literals:
                                v.text = new
                        continue
                    is_ = c.find('{%s}is' % S) if c.get('t') == 'inlineStr' else None
                    if is_ is None:
                        continue
                    new = tr(''.join(x.text or '' for x in is_.iter('{%s}t' % S)))
                    if new is None:
                        continue
                    runs = is_.findall('{%s}r' % S)
                    if runs:
                        set_runs(runs, '{%s}t' % S, new)
                        t = runs[0].find('{%s}t' % S)
                    else:
                        t = is_.find('{%s}t' % S)
                        t.text = new
                    t.set(XML_SPACE, 'preserve')
                data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
            if renames:
                s = data.decode('utf-8')
                s = re.sub(r'(<f(?:\s[^>]*[^/])?>)(.*?)(</f>)', lambda m: m.group(1) + fix_refs(m.group(2)) + m.group(3), s, flags=re.S)
                # x14 data validations / conditional formats keep their references in <xm:f>, legacy ones in <formula1|2>/<formula>
                s = re.sub(r'(<xm:f>|<formula1>|<formula2>|<formula>)(.*?)(</xm:f>|</formula1>|</formula2>|</formula>)',
                           lambda m: m.group(1) + fix_refs(m.group(2)) + m.group(3), s, flags=re.S)
                data = s.encode('utf-8')
        elif n.startswith('xl/tables/') and n.endswith('.xml'):
            # tableColumn names must equal the (translated) header cells, otherwise Excel Online refuses the file
            # tableColumn names are synced to the header cells AFTER all parts are written (see sync_table_headers below)
            pass
        elif renames and n.startswith('xl/charts/') and n.endswith('.xml'):
            s = data.decode('utf-8')
            s = re.sub(r'(<c:f>)(.*?)(</c:f>)', lambda m: m.group(1) + fix_refs(m.group(2)) + m.group(3), s)
            data = s.encode('utf-8')
        parts[item.filename] = data
    sync_table_headers(parts)
    for item in zin.infolist():
        if item.filename.endswith('/'):       # directory entries make Excel Online refuse the file
            continue
        zout.writestr(item, parts[item.filename])
    zout.close()
    left[:] = list(dict.fromkeys(left)); review[:] = list(dict.fromkeys(review))
    print(f'{a.out}\n  sheets renamed: {renames}\n  leftover source-language strings: {len(left)}; unchanged non-target strings to review: {len(review)}')
    for t in left[:20]:
        print('   LEFT  ', t[:90])
    for t in review[:40]:
        print('   REVIEW', t[:90])
    if kept_literals:
        print(f'  kept untranslated because formulas/validation lists compare against them: {sorted(kept_literals)}')
    media = [n for n in zin.namelist() if n.startswith('xl/media/')]
    if media:
        print(f'  images NOT translated by this script — view each, redraw charts / overlay text (track B): {media}')
    print('  note: cell text never shrinks/widens automatically — check wrapped/overflowing cells and column widths in the render')
    if a.report:
        json.dump({'left': left, 'review': review}, open(a.report, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
