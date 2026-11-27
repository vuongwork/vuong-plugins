"""Extract slide pictures to PNG for OCR/overlay (every picture by default; duplicates by content hash are listed once).

PNG/JPEG blobs are saved as PNG; icons below --min-px are skipped. Vector pictures (WMF/EMF, e.g. pasted Excel tables) are cropped from a
high-DPI render of the slide (LibreOffice → PDF → pdftoppm) so they stay sharp.

Usage: extract_images.py SRC.pptx --out IMGDIR [--min-width 0] [--min-px 64] [--dpi 220]
Writes IMGDIR/<name>.png and IMGDIR/meta.json [{name, slide, shape_id, sha1, px, dup_of?, vector?, missing?}].
Which images need overlay is decided by ocr.py (todo.json), not by size.
"""
import argparse, glob, hashlib, io, json, os, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runlog import track
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


def save_meta(out, meta):
    json.dump(meta, open(f'{out}/meta.json', 'w', encoding='utf-8'), indent=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', required=True)
    ap.add_argument('--min-width', type=float, default=0.0,
                    help='skip pictures narrower than this share of the slide (default 0 = keep all: a chart placed '
                         'small on the slide can still be a 1200 px image with data)')
    ap.add_argument('--min-px', type=int, default=64, help='skip raster pictures whose longer native side is below this (icons)')
    ap.add_argument('--dpi', type=int, default=220)
    a = ap.parse_args()
    track(a.out, 'extract_images')
    os.makedirs(a.out, exist_ok=True)
    prs = Presentation(a.src)
    W, H = prs.slide_width, prs.slide_height
    meta, vector, first, skipped, unread = [], [], {}, 0, []
    for i, sl in enumerate(prs.slides, 1):
        for k, s in enumerate([p for p in walk(sl.shapes) if p.width > W * a.min_width], 1):
            name = f's{i:03d}_{k}'
            try:
                blob, ext = s.image.blob, s.image.ext.lower()
            except Exception:                   # linked (not embedded) picture
                unread.append(name)
                continue
            h = hashlib.sha1(blob).hexdigest()
            m = {'name': name, 'slide': i, 'shape_id': s.shape_id, 'sha1': h}
            if h in first:                      # same picture already listed: OCR / overlay it once, reuse the output
                m['dup_of'] = first[h]
                meta.append(m)
                continue
            if ext in ('wmf', 'emf'):
                m['vector'] = True
                vector.append((m, s))
            else:
                try:
                    im = Image.open(io.BytesIO(blob))
                    im.load()
                except Exception:               # format Pillow cannot read (e.g. SVG): list it for the user
                    unread.append(name)
                    continue
                if max(im.size) < a.min_px:
                    skipped += 1
                    continue
                im.convert('RGB').save(f'{a.out}/{name}.png')
                m['px'] = list(im.size)
            first[h] = name
            meta.append(m)
    save_meta(a.out, meta)                      # raster pictures are usable even if the vector render below fails
    if vector:
        tmp = tempfile.mkdtemp(prefix='vtrans_render_')
        try:
            pdf = render_pdf(os.path.abspath(a.src), tmp)
        except SystemExit as e:
            for m, _ in vector:
                m['missing'] = True
            save_meta(a.out, meta)
            print(f'{e}\n  meta.json written; {len(vector)} vector picture(s) marked "missing" (re-run after fixing LibreOffice).')
            sys.exit(2)
        pages = {}
        for m, s in vector:
            i = m['slide']
            if i not in pages:                  # one render per slide, not per picture
                pages[i] = os.path.join(tmp, f'page{i}.png')
                render_page_png(pdf, i, a.dpi, pages[i])
            with Image.open(pages[i]) as im:
                iw, ih = im.size
                box = (int(s.left / W * iw), int(s.top / H * ih), int((s.left + s.width) / W * iw), int((s.top + s.height) / H * ih))
                crop = im.crop(box)
                crop.save(f"{a.out}/{m['name']}.png")
                m['px'] = list(crop.size)
        shutil.rmtree(tmp, ignore_errors=True)
        save_meta(a.out, meta)
    dups = sum('dup_of' in m for m in meta)
    print(f'{len(meta) - dups} unique images ({len(vector)} vector, cropped from render), {dups} duplicate(s) reuse them, '
          f'{skipped} icon(s) < {a.min_px} px skipped -> {a.out}')
    if unread:
        print(f'  not extracted (linked or unreadable format) — view these slides yourself: {unread}')


if __name__ == '__main__':
    main()
