"""One-time setup of a private venv (nothing is installed into the user's own Python). Works on Linux, macOS, Windows.

Usage:  python3 setup_env.py pdf    venv with PyMuPDF                      hosts: pypi.org, files.pythonhosted.org
        python3 setup_env.py ocr    venv with CPU torch + easyocr, and the OCR models for ja+en and vi+en
                                    hosts: pypi.org, files.pythonhosted.org, download.pytorch.org,
                                    download-r2.pytorch.org, github.com, objects/release-assets.githubusercontent.com
The LAST line printed is the venv's python: use it as $PY (pdf) / $OCRPY (ocr).
Folder: $VTRANS_HOME/<kind>, else <system temp>/vtrans_<kind> ($VTRANS_OCR also selects the OCR folder).
Re-running is cheap: an existing venv / installed packages / downloaded models are reused.
"""
import os, subprocess, sys, venv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import vt_home, venv_python


def has(py, module):
    return subprocess.run([py, '-c', f'import {module}'], capture_output=True).returncode == 0


def pip(py, *args):
    subprocess.run([py, '-m', 'pip', 'install', '-q', *args], check=True)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('pdf', 'ocr'):
        raise SystemExit('usage: setup_env.py pdf|ocr')
    kind = sys.argv[1]
    base = vt_home(kind)
    py = venv_python(base)
    if not os.path.exists(py):
        venv.EnvBuilder(with_pip=True).create(os.path.join(base, 'venv'))
    if kind == 'pdf':
        if not has(py, 'pymupdf'):
            pip(py, 'pymupdf')
    else:
        if not has(py, 'easyocr'):
            pip(py, '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch', 'torchvision')
            pip(py, 'easyocr')
        models = os.path.join(base, 'models')
        os.makedirs(os.path.join(models, 'user'), exist_ok=True)
        # the first Reader() per language set downloads the detection + recognition models (~100 MB);
        # done here so ocr.py never downloads while translating (ja and vi cannot share one Reader)
        code = ('import sys, easyocr\n'
                'for langs in (["ja", "en"], ["vi", "en"]):\n'
                '    easyocr.Reader(langs, gpu=False, model_storage_directory=sys.argv[1],\n'
                '                   user_network_directory=sys.argv[1] + "/user", verbose=False)\n'
                'print("easyocr ready:", sys.argv[1])\n')
        subprocess.run([py, '-c', code, models], check=True)
    print(py)


if __name__ == '__main__':
    main()
