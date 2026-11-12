"""Language classification shared by extract.py / apply_pptx.py / apply_xlsx.py.

needs_translation(text, target, keep) -> True when `text` still contains wording that is not in the
target language and is not on the keep-list (acronyms, codes, e-mails, URLs, file names, numbers,
plus user-approved terms in keep.txt). Works for every direction among ja / vi / en.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: F401  (UTF-8 stdout on Windows)

JP = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
VI = re.compile(r'[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ'
                r'ÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ]')
# always kept as written: e-mails, URLs, file names, codes (M-01, P-0123, LINE-02, R03-L2-C15), ACRONYMS, numbers
KEEP_RE = [r'\S+@\S+', r'(?:https?://|www\.)\S+', r'\S+\.(?:pptx?|xlsx?|docx?|pdf|csv|json|md|png|jpe?g)\b',
           r'(?<![A-Za-z0-9])[A-Z0-9]+(?:[-_/][A-Z0-9]+)+(?![A-Za-z0-9])', r'(?<![A-Za-z])[A-Z][A-Z0-9]{1,}s?(?![a-z])',
           r'(?<![A-Za-z])\d[\d.,:/]*[A-Za-z]{0,3}(?![A-Za-z])']
WORD = re.compile(r"[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ'’]+")
# one Vietnamese syllable written without diacritics: onset + 1-3 vowels + coda (ban, cho, trong, nguoi, duoc)
VI_SYLLABLE = re.compile(r'(?:ngh|ng|gh|gi|kh|nh|ph|qu|th|tr|ch|[bcdghklmnprstvx])?[aeiouy]{1,3}(?:ng|nh|ch|[cmnpt])?$', re.I)


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
    if target == 'vi' and not VI.search(t):
        # A string without any Vietnamese diacritic: every plain-ASCII word that cannot be a Vietnamese syllable
        # is foreign ("Proposal", "Agenda", "Thank you"). Diacritic-less Vietnamese ("ban cho tin", "trong khong")
        # is not flagged. Inside a Vietnamese sentence (has diacritics) kept English terms are fine.
        out += [w for w in WORD.findall(t) if w.isascii() and not VI_SYLLABLE.match(w)]
    return out


def needs_translation(text, target, keep=()):
    return bool(re.search(r'[A-Za-zÀ-ỹ぀-ヿ㐀-鿿ｦ-ﾟ]', text)) and bool(foreign_words(text, target, keep))

