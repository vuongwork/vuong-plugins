"""Language classification shared by extract.py / apply_pptx.py / apply_xlsx.py.

needs_translation(text, target, keep) -> True when `text` still contains wording that is not in the
target language and is not on the keep-list (acronyms, codes, e-mails, URLs, file names, numbers,
plus user-approved terms in keep.txt). Works for every direction among ja / vi / en.
"""
import re

JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
VI = re.compile(r'[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ'
                r'ÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ]')
# always kept as written: e-mails, URLs, file names, codes (M-01, P-0123, LINE-02, R03-L2-C15), ACRONYMS, numbers
KEEP_RE = [r'\S+@\S+', r'(?:https?://|www\.)\S+', r'\S+\.(?:pptx?|xlsx?|docx?|pdf|csv|json|md|png|jpe?g)\b',
           r'(?<![A-Za-z0-9])[A-Z0-9]+(?:[-_/][A-Z0-9]+)+(?![A-Za-z0-9])', r'(?<![A-Za-z])[A-Z][A-Z0-9]{1,}s?(?![a-z])',
           r'(?<![A-Za-z])\d[\d.,:/]*[A-Za-z]{0,3}(?![A-Za-z])']
WORD = re.compile(r"[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ'’]+")


def load_keep(path):
    """keep.txt: one term per line (proper nouns, product names, approved English terms). '#' = comment."""
    try:
        return [l.strip() for l in open(path, encoding='utf-8') if l.strip() and not l.startswith('#')]
    except FileNotFoundError:
        return []


def strip_kept(text, keep=()):
    for k in sorted(keep, key=len, reverse=True):
        text = text.replace(k, ' ')
    for p in KEEP_RE:
        text = re.sub(p, ' ', text)
    return text


def foreign_words(text, target, keep=()):
    """Return the pieces of `text` that are not in `target` language (after removing kept terms)."""
    t = strip_kept(text, keep)
    out = []
    if target != 'ja' and JP.search(t):
        out += re.findall(r'[぀-ヿ㐀-鿿ｦ-ﾟ]+', t)
    if target != 'vi':
        out += [w for w in WORD.findall(t) if VI.search(w) or target == 'ja']
    if target == 'vi':
        # plain-ASCII words in Vietnamese output are suspicious only when they are not Vietnamese syllables;
        # ASCII-only Vietnamese words (ban, cho, tin...) exist, so flag only runs of >=2 English-looking words
        # in a string without any Vietnamese diacritic, e.g. "Our Understanding".
        if not VI.search(t):
            ws = [w for w in WORD.findall(t) if w.isascii()]
            if len(ws) >= 2:
                out += ws
    if target == 'en':
        pass  # Latin words are fine; JP / VI-with-diacritics already caught above
    return out


def needs_translation(text, target, keep=()):
    return bool(re.search(r'[A-Za-zÀ-ỹ぀-ヿ㐀-鿿ｦ-ﾟ]', text)) and bool(foreign_words(text, target, keep))


CJK_R = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
CJK_B = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'


def fonts_for(lang, regular, bold):
    """Noto Sans has no Japanese glyphs: use Noto Sans CJK (JP face = index 0) when the target is ja."""
    return (CJK_R, CJK_B) if lang == 'ja' else (regular, bold)
