"""Append the Vietnamese business meaning in parentheses after English WMS terms: 'Putaway' -> 'Putaway (cất hàng)'.

annotate(text, seen) annotates the first occurrence of each term not yet in `seen` (a set shared per scope).
If the term is already followed by '(...)', the meaning is merged into that bracket: '(出荷検品)' -> '(出荷検品 – kiểm hàng tập kết)'.
"""
import re

TERMS = {
    # process names (longest first is handled below)
    'piece replenishment picking': 'lấy hàng bổ sung lẻ',
    'extended piece picking': 'lấy hàng lẻ mở rộng',
    'piece bulk picking': 'lấy hàng lẻ tổng',
    'case bulk picking': 'lấy hàng thùng tổng',
    'replenishment picking': 'lấy hàng bổ sung',
    'piece picking': 'lấy hàng lẻ',
    'case picking': 'lấy hàng thùng',
    'bulk picking': 'lấy hàng tổng',
    'list picking': 'lấy hàng theo picking list',
    'pick-by-order': 'lấy hàng theo đơn',
    'receiving inspection': 'kiểm hàng nhập',
    'staging inspection': 'kiểm hàng tập kết',
    're-putaway': 'cất lại về kệ',
    'putaway': 'cất hàng',
    'emergency piece replenishment': 'bổ sung hàng lẻ khẩn cấp',
    'emergency replenishment': 'bổ sung khẩn cấp',
    'piece replenishment': 'bổ sung hàng lẻ',
    'replenishment block': 'block bổ sung',
    'replenishment': 'bổ sung hàng',
    'staging location': 'vị trí tập kết',
    'staging area': 'khu tập kết',
    'staging route': 'tuyến tập kết',
    'staging': 'tập kết hàng',
    'loading': 'xếp hàng lên xe',
    'stocktaking': 'kiểm kê',
    'stock allocation': 'phân bổ tồn kho',
    'transfer': 'chuyển vị trí',
    # labels
    'putaway label': 'label nơi cất',
    'replenishment label': 'label nơi bổ sung',
    # katakana loanwords whose meaning is not obvious
    'over area': 'khu tràn',
}
_alts = sorted(TERMS, key=len, reverse=True)
PAT = re.compile(r'(?<![\w-])(' + '|'.join(re.escape(t) for t in _alts) + r')(?![\w-])', re.I)
JP = re.compile(r'^[぀-ヿ㐀-鿿ｦ-ﾟ]')


def annotate(text, seen):
    out, pos = [], 0
    for m in PAT.finditer(text):
        key = m.group(1).lower()
        if key in seen:
            continue
        before = text[:m.start()]
        if before.count('(') > before.count(')'):          # inside a bracket: no nested brackets, wait for next occurrence
            continue
        if before.count('“') > before.count('”') or before.count('"') % 2 or before.count('「') > before.count('」'):
            continue                                       # inside a quoted title / file name: leave it verbatim
        seen.add(key)
        vi = TERMS[key]
        out.append(text[pos:m.end()])
        rest = text[m.end():]
        b = re.match(r'\s*\(([^)]*)\)', rest)
        if b and vi in b.group(1):
            pos = m.end()                                  # already annotated
        elif b and JP.match(b.group(1)):                   # '(出荷検品)' -> '(出荷検品 – vi)'
            inner_end = m.end() + b.end(1)                 # position just before ')'
            out.append(text[m.end():inner_end] + ' – ' + vi)
            pos = inner_end
        elif b:                                            # another bracket follows: 're-putaway – cất lại về kệ (kèm …)'
            out.append(' – ' + vi)
            pos = m.end()
        else:
            out.append(' (' + vi + ')')
            pos = m.end()
    out.append(text[pos:])
    return ''.join(out)


def annotate_markdown(md):
    """Per '## ' section: first occurrence of each term gets its meaning. Headings and code spans included."""
    res, seen = [], set()
    for line in md.split('\n'):
        if line.startswith('## '):
            seen = set()
        res.append(annotate(line, seen))
    return '\n'.join(res)


if __name__ == '__main__':
    import sys
    s = open(sys.argv[1], encoding='utf-8').read()
    open(sys.argv[1], 'w', encoding='utf-8').write(annotate_markdown(s))
