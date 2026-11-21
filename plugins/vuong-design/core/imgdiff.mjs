// Image comparison in the browser with canvas (no image dependencies on the Node side). PNG buffers are decoded by
// Chromium, composited over white, and compared pixel by pixel as pixelmatch does: YIQ colour distance (threshold 0.1),
// anti-aliased pixels ignored (sub-pixel text placement changes edge pixels without changing content).
//  - cropDiffDetail / cropDiffMany: one region of each image (rects in CSS px, [x, y, w, h], scaled by the device
//    scale factor). The window has the size of rectA in both images; it is placed at rectA in image A and at rectB in
//    image B, and image B's window may move up to `shift` CSS px (default 1) on each axis, in whole device pixels and
//    then quarter-pixel (bilinear) steps around the best one, never beyond `shift` in total: the best match counts. Both windows are box-blurred 3x3 first (opts.blur, default on) so glyph stems that fall
//    differently on the pixel grid do not count. Pixels outside an image are white.
//    Result { diff, ink, ratio }: diff = differing device pixels at the best offset; ink = pixels that differ from
//    their window's background (its most common colour) in either window; ratio = diff / ink (0 when there is no
//    ink). Normalising by ink, not by area, keeps a removed thin mark from being diluted by a large empty box.
//  - cropDiff: the ratio only.
//  - pixelDiff: whole images, top-left aligned; area covered by only one of the two images counts as different.
//    Reference only.

const DSF = 2;
const THRESHOLD = 0.1;

// Runs in the page. imgs: base64 PNGs. jobs: [{ a, b, ra, rb }] (image indexes + rects) or { whole: [a, b] }.
// The pixel test is pixelmatch's (YIQ distance > 35215 * threshold², anti-aliased pixels ignored), ported so the
// Node side needs no image library.
async function compareInPage({ imgs, jobs, dsf, shift, threshold, blurOn }) {
  const decode = async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
  };
  // w x h RGBA window of im at (x0, y0); outside the image is white
  const win = (im, x0, y0, w, h) => {
    const out = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) {
      const sy = y0 + y; if (sy < 0 || sy >= im.h) continue;
      for (let x = 0; x < w; x++) {
        const sx = x0 + x; if (sx < 0 || sx >= im.w) continue;
        const s = (sy * im.w + sx) * 4, o = (y * w + x) * 4;
        out[o] = im.d[s]; out[o + 1] = im.d[s + 1]; out[o + 2] = im.d[s + 2];
      }
    }
    return out;
  };
  // bilinear window at a fractional origin
  const winF = (im, fx, fy, w, h) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const g = win(im, x0, y0, w + 1, h + 1), W1 = w + 1;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, a = (y * W1 + x) * 4, b = a + 4, c = a + W1 * 4, d = c + 4;
      for (let ch = 0; ch < 3; ch++) out[o + ch] = (g[a + ch] * (1 - tx) + g[b + ch] * tx) * (1 - ty) + (g[c + ch] * (1 - tx) + g[d + ch] * tx) * ty;
      out[o + 3] = 255;
    }
    return out;
  };
  // 3x3 box blur (edges clamp): makes the comparison insensitive to how glyph stems fall on the pixel grid
  const blur = (a, w, h) => {
    const out = new Uint8ClampedArray(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
        const k = (yy * w + xx) * 4; r += a[k]; g += a[k + 1]; b += a[k + 2]; n++;
      }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
    return out;
  };
  const Y = (a, k) => a[k] * 0.29889531 + a[k + 1] * 0.58662247 + a[k + 2] * 0.11448223;
  const I = (a, k) => a[k] * 0.59597799 - a[k + 1] * 0.27417610 - a[k + 2] * 0.32180189;
  const Q = (a, k) => a[k] * 0.21147017 - a[k + 1] * 0.52261711 + a[k + 2] * 0.31114694;
  const delta = (a, b, k, m, yOnly) => {
    const y = Y(a, k) - Y(b, m);
    if (yOnly) return y;
    const i = I(a, k) - I(b, m), q = Q(a, k) - Q(b, m);
    return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  };
  const same = (a, k, m) => a[k] === a[m] && a[k + 1] === a[m + 1] && a[k + 2] === a[m + 2];
  const manySiblings = (a, x1, y1, w, h) => {
    const x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0), x2 = Math.min(x1 + 1, w - 1), y2 = Math.min(y1 + 1, h - 1);
    const k = (y1 * w + x1) * 4;
    let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
    for (let x = x0; x <= x2; x++) for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      if (same(a, k, (y * w + x) * 4)) zeroes++;
      if (zeroes > 2) return true;
    }
    return false;
  };
  const antialiased = (a, x1, y1, w, h, b) => {
    const x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0), x2 = Math.min(x1 + 1, w - 1), y2 = Math.min(y1 + 1, h - 1);
    const k = (y1 * w + x1) * 4;
    let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
    let min = 0, max = 0, minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (let x = x0; x <= x2; x++) for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const dl = delta(a, a, k, (y * w + x) * 4, true);
      if (dl === 0) { zeroes++; if (zeroes > 2) return false; }
      else if (dl < min) { min = dl; minX = x; minY = y; }
      else if (dl > max) { max = dl; maxX = x; maxY = y; }
    }
    if (min === 0 || max === 0) return false;
    return (manySiblings(a, minX, minY, w, h) && manySiblings(b, minX, minY, w, h)) ||
      (manySiblings(a, maxX, maxY, w, h) && manySiblings(b, maxX, maxY, w, h));
  };
  const maxDelta = 35215 * threshold * threshold;
  // most common colour of a window, as a 1-pixel RGBA array
  const mode = (a) => {
    const m = new Map(); let best = 0, key = 0xffffff;
    for (let k = 0; k < a.length; k += 4) {
      const c = (a[k] << 16) | (a[k + 1] << 8) | a[k + 2]; const n = (m.get(c) || 0) + 1; m.set(c, n);
      if (n > best) { best = n; key = c; }
    }
    return [key >> 16, (key >> 8) & 255, key & 255, 255];
  };
  // differing, non-anti-aliased pixels of two w x h windows; stops counting at `stop`
  const count = (a, b, w, h, stop = Infinity) => {
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (delta(a, b, k, k, false) <= maxDelta) continue;
      if (antialiased(a, x, y, w, h, b) || antialiased(b, x, y, w, h, a)) continue;
      if (++n >= stop) return n;
    }
    return n;
  };
  const diffMask = (a, b, w, h) => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (delta(a, b, k, k, false) > maxDelta && !antialiased(a, x, y, w, h, b) && !antialiased(b, x, y, w, h, a)) m[y * w + x] = 1;
    }
    return m;
  };
  const dec = await Promise.all(imgs.map(decode));
  return jobs.map((j) => {
    if (j.whole) {
      const A = dec[j.whole[0]], B = dec[j.whole[1]];
      const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
      const area = Math.max(A.w, B.w) * Math.max(A.h, B.h);
      if (!area) return 0;
      const extra = area - w * h; // covered by one image only
      return (count(win(A, 0, 0, w, h), win(B, 0, 0, w, h), w, h) + extra) / area;
    }
    const A = dec[j.a], B = dec[j.b];
    const ax = Math.round(j.ra[0] * dsf), ay = Math.round(j.ra[1] * dsf);
    const w = Math.max(1, Math.round(j.ra[2] * dsf)), h = Math.max(1, Math.round(j.ra[3] * dsf));
    const bx = Math.round(j.rb[0] * dsf), by = Math.round(j.rb[1] * dsf);
    const s = Math.floor(shift * dsf + 1e-9);
    const BL = blurOn ? (x) => blur(x, w, h) : (x) => x;
    const rawA = win(A, ax, ay, w, h);
    const wa = BL(rawA), bgA = mode(rawA);
    let best = Infinity, bw = null, bdx = 0, bdy = 0;
    const tryAt = (dx, dy) => {
      const wb = Number.isInteger(dx) && Number.isInteger(dy) ? win(B, bx + dx, by + dy, w, h) : winF(B, bx + dx, by + dy, w, h);
      const n = count(wa, BL(wb), w, h, best);
      if (n < best) { best = n; bw = wb; bdx = dx; bdy = dy; }
    };
    for (let dy = -s; dy <= s && best > 0; dy++) for (let dx = -s; dx <= s && best > 0; dx++) tryAt(dx, dy);
    // quarter-pixel refinement around the best whole-pixel offset (bilinear), never beyond `shift` CSS px in total
    const ix = bdx, iy = bdy;
    for (let fy = -0.75; fy <= 0.75 && best > 0; fy += 0.25) for (let fx = -0.75; fx <= 0.75 && best > 0; fx += 0.25) {
      if ((!fx && !fy) || Math.abs(ix + fx) > s || Math.abs(iy + fy) > s) continue;
      tryAt(ix + fx, iy + fy);
    }
    const wbB = BL(bw), bgB = mode(bw);
    let ink = 0;
    for (let k = 0; k < w * h * 4; k += 4) if (delta(wa, bgA, k, 0, false) > maxDelta || delta(wbB, bgB, k, 0, false) > maxDelta) ink++;
    // peak: most differing pixels inside any P x P device-pixel square (P = 8 CSS px). A removed or changed mark is a
    // dense cluster; sub-pixel noise is spread thin, so the peak separates them where the total cannot.
    const mask = diffMask(wa, wbB, w, h);
    const P = Math.round(8 * dsf), S = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = mask[y * w + x] + S[y * (w + 1) + x + 1] + S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
    let peak = 0;
    for (let y = 0; y <= Math.max(0, h - P); y++) for (let x = 0; x <= Math.max(0, w - P); x++) {
      const x1 = Math.min(w, x + P), y1 = Math.min(h, y + P);
      peak = Math.max(peak, S[y1 * (w + 1) + x1] - S[y * (w + 1) + x1] - S[y1 * (w + 1) + x] + S[y * (w + 1) + x]);
    }
    return { diff: best, ink, ratio: ink ? best / ink : 0, peak };
  });
}

async function run(browser, imgs, jobs, opts = {}) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    return await page.evaluate(compareInPage, {
      imgs: imgs.map((b) => Buffer.from(b).toString('base64')), jobs,
      dsf: opts.dsf ?? DSF, shift: opts.shift ?? 1, threshold: opts.threshold ?? THRESHOLD, blurOn: opts.blur ?? true,
    });
  } finally { await page.close(); }
}

const r4 = (v) => Math.round(v * 10000) / 10000;

export async function cropDiff(browser, pngA, rectA, pngB, rectB, opts) {
  return (await cropDiffDetail(browser, pngA, rectA, pngB, rectB, opts)).ratio;
}

export async function cropDiffDetail(browser, pngA, rectA, pngB, rectB, opts) {
  const [r] = await cropDiffMany(browser, pngA, pngB, [{ rectA, rectB }], opts);
  return r;
}

// Many regions of the same two images, decoded once. pairs: [{ rectA, rectB }] -> [{ diff, ink, ratio }] in order.
export async function cropDiffMany(browser, pngA, pngB, pairs, opts) {
  if (!pairs.length) return [];
  const res = await run(browser, [pngA, pngB], pairs.map((p) => ({ a: 0, b: 1, ra: p.rectA, rb: p.rectB })), opts);
  return res.map((r) => ({ ...r, ratio: r4(r.ratio) }));
}

export async function pixelDiff(browser, pngA, pngB, opts) {
  const [r] = await run(browser, [pngA, pngB], [{ whole: [0, 1] }], opts);
  return r4(r);
}
