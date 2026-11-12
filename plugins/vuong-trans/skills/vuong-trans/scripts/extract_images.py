"""Extract slide pictures (wider than --min-width of the slide) to PNG for OCR/overlay.

PNG/JPEG blobs are saved as PNG. Vector pictures (WMF/EMF, e.g. pasted Excel tables) are cropped from a
high-DPI render of the slide (LibreOffice → PDF → pdftoppm) so they stay sharp.

Usage: extract_images.py SRC.pptx --out IMGDIR [--min-width 0.15] [--dpi 220]
Writes IMGDIR/<name>.png and IMGDIR/meta.json [{name, slide, shape_id}].
"""
import argparse, io, json, os, shutil, subprocess, tempfile
from pptx import Presentation
from PIL import Image


def walk(shapes):
    for s in shapes:
        if s.shape_type == 6:
            yield from walk(s.shapes)
        elif s.shape_type == 13:
            yield s


def render_pdf(src, tmp):
    """LibreOffice → PDF. Fails inside some sandboxes ('no valid pipe path'): ask the user before running it outside the sandbox."""
    env = dict(os.environ, HOME=tmp)
    subprocess.run(['soffice', '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, src],
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
            subprocess.run(['pdftoppm', '-f', str(i), '-l', str(i), '-r', str(a.dpi), '-png', pdf, f'{tmp}/p'], check=True)
            page = sorted(f for f in os.listdir(tmp) if f.startswith('p') and f.endswith('.png'))[-1]
            im = Image.open(f'{tmp}/{page}')
            iw, ih = im.size
            box = (int(s.left / W * iw), int(s.top / H * ih), int((s.left + s.width) / W * iw), int((s.top + s.height) / H * ih))
            im.crop(box).save(f'{a.out}/{name}.png')
            os.remove(f'{tmp}/{page}')
        shutil.rmtree(tmp, ignore_errors=True)
    json.dump(meta, open(f'{a.out}/meta.json', 'w'), indent=0)
    print(f'{len(meta)} images ({len(vector)} vector, cropped from render) -> {a.out}')
    for m in meta:
        print(' ', m['name'], Image.open(f"{a.out}/{m['name']}.png").size)


if __name__ == '__main__':
    main()
