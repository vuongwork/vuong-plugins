"""Extract slide pictures (wider than --min-width of the slide) to PNG for OCR/overlay.

PNG/JPEG blobs are saved as PNG. Vector pictures (WMF/EMF, e.g. pasted Excel tables) are cropped from a
high-DPI render of the slide (LibreOffice → PDF → pdftoppm) so they stay sharp.

Usage: extract_images.py SRC.pptx --out IMGDIR [--min-width 0.15] [--dpi 220]
Writes IMGDIR/<name>.png and IMGDIR/meta.json [{name, slide, shape_id}].
"""
import argparse, glob, io, json, os, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: F401  (UTF-8 stdout on Windows)
from pptx import Presentation
from PIL import Image


def find_tool(name, extra):
    """Program on PATH, else the usual install folders (LibreOffice / poppler are often not on PATH on Windows/macOS)."""
    p = shutil.which(name)
    if p:
        return p
    for pat in extra:
        hits = sorted(glob.glob(os.path.expandvars(pat)))
        if hits:
            return hits[-1]
    return None


SOFFICE = ['%ProgramFiles%/LibreOffice/program/soffice.exe', '%ProgramFiles(x86)%/LibreOffice/program/soffice.exe',
           '/Applications/LibreOffice.app/Contents/MacOS/soffice']
PDFTOPPM = ['%ProgramFiles%/poppler*/Library/bin/pdftoppm.exe', '%LOCALAPPDATA%/Programs/poppler*/Library/bin/pdftoppm.exe',
            '/opt/homebrew/bin/pdftoppm', '/usr/local/bin/pdftoppm']


def render_page_png(pdf, page_no, dpi, out_png):
    """One page of `pdf` to PNG: pdftoppm if installed, else PyMuPDF if importable."""
    exe = find_tool('pdftoppm', PDFTOPPM)
    if exe:
        stem = out_png[:-4]
        subprocess.run([exe, '-f', str(page_no), '-l', str(page_no), '-r', str(dpi), '-png', '-singlefile', pdf, stem], check=True)
        return
    try:
        import pymupdf
    except ImportError:
        raise SystemExit('Needs poppler (pdftoppm) or PyMuPDF (pip install pymupdf) in this Python to crop WMF/EMF pictures.')
    doc = pymupdf.open(pdf)
    doc[page_no - 1].get_pixmap(dpi=dpi).save(out_png)


def walk(shapes):
    for s in shapes:
        if s.shape_type == 6:
            yield from walk(s.shapes)
        elif s.shape_type == 13:
            yield s


def render_pdf(src, tmp):
    """LibreOffice → PDF. Fails inside some sandboxes ('no valid pipe path'): ask the user before running it outside the sandbox."""
    exe = find_tool('soffice', SOFFICE)
    if not exe:
        raise SystemExit('LibreOffice (soffice) not found — install it; it is needed to render WMF/EMF pictures.')
    env = dict(os.environ, HOME=tmp)
    subprocess.run([exe, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, src],
                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    pdf = os.path.join(tmp, os.path.splitext(os.path.basename(src))[0] + '.pdf')
    if not os.path.exists(pdf):
        raise SystemExit('LibreOffice could not render the deck (needed for WMF/EMF pictures). '
                         'If running in a sandbox, ask the user to approve running this conversion outside the sandbox.')
    return pdf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', required=True)
    ap.add_argument('--min-width', type=float, default=0.15)
    ap.add_argument('--dpi', type=int, default=220)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    prs = Presentation(a.src)
    W, H = prs.slide_width, prs.slide_height
    meta, vector = [], []
    for i, sl in enumerate(prs.slides, 1):
        for k, s in enumerate([p for p in walk(sl.shapes) if p.width > W * a.min_width], 1):
            name = f's{i:03d}_{k}'
            meta.append({'name': name, 'slide': i, 'shape_id': s.shape_id})
            if s.image.ext.lower() in ('wmf', 'emf'):
                vector.append((name, i, s))
            else:
                Image.open(io.BytesIO(s.image.blob)).convert('RGB').save(f'{a.out}/{name}.png')
    if vector:
        tmp = tempfile.mkdtemp(prefix='vtrans_render_')
        pdf = render_pdf(os.path.abspath(a.src), tmp)
        for name, i, s in vector:
            page = os.path.join(tmp, 'page.png')
            render_page_png(pdf, i, a.dpi, page)
            with Image.open(page) as im:
                iw, ih = im.size
                box = (int(s.left / W * iw), int(s.top / H * ih), int((s.left + s.width) / W * iw), int((s.top + s.height) / H * ih))
                im.crop(box).save(f'{a.out}/{name}.png')
            os.remove(page)
        shutil.rmtree(tmp, ignore_errors=True)
    json.dump(meta, open(f'{a.out}/meta.json', 'w', encoding='utf-8'), indent=0)
    print(f'{len(meta)} images ({len(vector)} vector, cropped from render) -> {a.out}')
    for m in meta:
        print(' ', m['name'], Image.open(f"{a.out}/{m['name']}.png").size)


if __name__ == '__main__':
    main()
