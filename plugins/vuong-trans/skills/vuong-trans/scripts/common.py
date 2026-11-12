"""Cross-platform helpers shared by every script (Linux, macOS, Windows).

- Importing this module switches stdout/stderr to UTF-8, so printing Japanese/Vietnamese does not crash on a
  Windows console (cp1252). Every file the scripts read or write is opened with encoding='utf-8'.
- find_font(role) / fonts(lang) look fonts up by file name in the OS font folders (plus $VTRANS_FONT_DIR,
  searched first), instead of hard-coded Linux paths.
- vt_home(kind) / venv_python(base): where setup_env.py puts its private venvs and models.
"""
import functools, os, sys, tempfile


def utf8_stdio():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


utf8_stdio()


# ---------- private venvs (setup_env.py) ----------
def vt_home(kind):
    """Base folder of the venv + models for `kind` ('ocr' | 'pdf'): $VTRANS_HOME/<kind>, else <system temp>/vtrans_<kind>.
    $VTRANS_OCR (older name) still selects the OCR folder."""
    if kind == 'ocr' and os.environ.get('VTRANS_OCR'):
        return os.environ['VTRANS_OCR']
    if os.environ.get('VTRANS_HOME'):
        return os.path.join(os.environ['VTRANS_HOME'], kind)
    return os.path.join(tempfile.gettempdir(), f'vtrans_{kind}')


def venv_python(base):
    """Python of the venv under `base`: venv/Scripts/python.exe on Windows, venv/bin/python elsewhere."""
    if os.name == 'nt':
        return os.path.join(base, 'venv', 'Scripts', 'python.exe')
    return os.path.join(base, 'venv', 'bin', 'python')


# ---------- fonts ----------
# Candidates per role, in order of preference (file names, matched case-insensitively).
# Noto Sans / Noto Sans CJK / DejaVu give the same result on every machine; the OS fonts after them
# (Segoe UI, Arial, Yu Gothic, Meiryo, Hiragino) are fallbacks that also cover Vietnamese / Japanese.
FONT_ROLES = {
    'regular': ['NotoSans-Regular.ttf', 'segoeui.ttf', 'Arial.ttf', 'DejaVuSans.ttf'],
    'bold': ['NotoSans-Bold.ttf', 'segoeuib.ttf', 'arialbd.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf'],
    'semibold': ['NotoSans-SemiBold.ttf', 'NotoSans-Bold.ttf', 'seguisb.ttf', 'segoeuib.ttf', 'arialbd.ttf',
                 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf'],
    # glyphs Noto Sans lacks: → ① ▲ ○ ● ≤ ≥
    'symbol': ['DejaVuSans.ttf', 'seguisym.ttf', 'Arial Unicode.ttf', 'Arial.ttf'],
    'cjk': ['NotoSansCJK-Regular.ttc', 'NotoSansCJKjp-Regular.otf', 'NotoSansJP-Regular.ttf', 'NotoSansJP-Regular.otf',
            'YuGothR.ttc', 'meiryo.ttc', 'msgothic.ttc', 'ヒラギノ角ゴシック W3.ttc', 'Hiragino Sans GB.ttc'],
    'cjk_bold': ['NotoSansCJK-Bold.ttc', 'NotoSansCJKjp-Bold.otf', 'NotoSansJP-Bold.ttf', 'NotoSansJP-Bold.otf',
                 'YuGothB.ttc', 'meiryob.ttc', 'ヒラギノ角ゴシック W6.ttc', 'NotoSansCJK-Regular.ttc', 'meiryo.ttc',
                 'msgothic.ttc'],
}


def _font_dirs():
    dirs = [p for p in os.environ.get('VTRANS_FONT_DIR', '').split(os.pathsep) if p]
    home = os.path.expanduser('~')
    if os.name == 'nt':
        dirs += [os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts'),
                 os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Windows', 'Fonts')]
    elif sys.platform == 'darwin':
        dirs += ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts',
                 os.path.join(home, 'Library', 'Fonts')]
    else:
        dirs += ['/usr/share/fonts', '/usr/local/share/fonts', os.path.join(home, '.local', 'share', 'fonts'),
                 os.path.join(home, '.fonts')]
    return dirs


@functools.lru_cache(maxsize=1)
def _font_index():
    idx = {}
    for d in _font_dirs():
        for root, _, files in os.walk(d):
            for f in files:
                idx.setdefault(f.lower(), os.path.join(root, f))     # first folder wins ($VTRANS_FONT_DIR first)
    return idx


def find_font(role):
    idx = _font_index()
    for name in FONT_ROLES[role]:
        p = idx.get(name.lower())
        if p:
            return p
    raise SystemExit(f"vuong-trans: no font found for '{role}' (tried {', '.join(FONT_ROLES[role])}). "
                     'Install Noto Sans + DejaVu Sans (and Noto Sans CJK JP for a Japanese target), '
                     'or put the font files in a folder and set VTRANS_FONT_DIR to it.')


def fonts(lang, semibold=False):
    """(regular, bold) font paths for drawing text in `lang`. Noto Sans has no Japanese glyphs -> CJK font for ja."""
    if lang == 'ja':
        return find_font('cjk'), find_font('cjk_bold')
    return find_font('regular'), find_font('semibold' if semibold else 'bold')
