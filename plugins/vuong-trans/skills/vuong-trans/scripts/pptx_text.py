"""Read / write the text of one DrawingML paragraph (<a:p>) — shared by extract.py and apply_pptx.py so both use the same key.

A line break inside a paragraph (<a:br/>) is '\\n' in the key, so the translator sees two lines instead of two words glued
together ("入荷検品出荷検品"), and writing back puts the break where the translation has its '\\n'.
Fields (<a:fld>, e.g. the slide number) are not part of the key and are left untouched.
"""
import copy

A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'


def para_text(p):
    """Text of a python-pptx paragraph (or a raw <a:p> element): runs joined, <a:br/> -> '\\n'."""
    el = getattr(p, '_p', p)
    out = []
    for ch in el:
        if ch.tag == A + 'r':
            out.append(ch.findtext(A + 't') or '')
        elif ch.tag == A + 'br':
            out.append('\n')
    return ''.join(out)


def set_para_text(p, new):
    """Replace the paragraph text with `new`, keeping the FIRST run's formatting; '\\n' becomes <a:br/>.
    Returns False when the paragraph has no run to carry the formatting."""
    el = getattr(p, '_p', p)
    runs = [ch for ch in el if ch.tag == A + 'r']
    if not runs:
        return False
    first = runs[0]
    for ch in list(el):
        if ch is not first and ch.tag in (A + 'r', A + 'br'):
            el.remove(ch)
    lines = new.split('\n')
    first.find(A + 't').text = lines[0]
    prev = first
    rpr = first.find(A + 'rPr')
    for line in lines[1:]:
        br = copy.deepcopy(rpr) if rpr is not None else None
        br_el = first.makeelement(A + 'br', {})
        if br is not None:
            br_el.append(br)
        r = copy.deepcopy(first)
        r.find(A + 't').text = line
        prev.addnext(br_el)
        br_el.addnext(r)
        prev = r
    return True


def master_layout_frames(prs):
    """Text frames printed on slides from masters and the layouts slides use (logo captions, document numbers,
    footers drawn as plain text boxes). Placeholders are skipped: their master text is only an editing prompt
    ("マスター タイトルの書式設定") that never shows in the deck."""
    used = {sl.slide_layout.part.partname for sl in prs.slides}   # proxies are re-created: compare parts
    for m in prs.slide_masters:
        for lay in [m, *[l for l in m.slide_layouts if l.part.partname in used]]:
            stack = list(lay.shapes)
            while stack:
                s = stack.pop(0)
                if s.shape_type == 6:                    # group
                    stack[:0] = list(s.shapes)
                elif s.has_text_frame and not s.is_placeholder:
                    yield s.text_frame
