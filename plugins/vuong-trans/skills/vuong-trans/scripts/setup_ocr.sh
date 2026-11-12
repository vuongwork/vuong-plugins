#!/usr/bin/env bash
# One-time setup: private venv with CPU torch + easyocr, models downloaded into the same folder.
# Nothing is installed into the user's Python. Location: ${VTRANS_OCR:-$TMPDIR/vtrans_ocr}
# Network hosts needed: pypi.org files.pythonhosted.org download.pytorch.org download-r2.pytorch.org
#                       github.com objects.githubusercontent.com release-assets.githubusercontent.com
set -euo pipefail
BASE="${VTRANS_OCR:-${TMPDIR:-/tmp}/vtrans_ocr}"
mkdir -p "$BASE/models/user"
if [ ! -x "$BASE/venv/bin/python" ]; then
  python3 -m venv "$BASE/venv"
fi
"$BASE/venv/bin/python" -c "import easyocr" 2>/dev/null || {
  "$BASE/venv/bin/pip" install -q --index-url https://download.pytorch.org/whl/cpu torch torchvision
  "$BASE/venv/bin/pip" install -q easyocr
}
# first Reader() call downloads detection + ja recognition models (~100 MB)
"$BASE/venv/bin/python" - "$BASE/models" <<'EOF' 2>&1 | grep -v -E 'Progress|Warning' || true
import sys, easyocr
m = sys.argv[1]
easyocr.Reader(['ja', 'en'], gpu=False, model_storage_directory=m, user_network_directory=m + '/user', verbose=False)
print('easyocr ready:', m)
EOF
echo "python: $BASE/venv/bin/python"
