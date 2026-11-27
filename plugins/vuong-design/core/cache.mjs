// Screen cache (R95): the result of one screen's proxies and verify, kept on disk and reused when nothing it depends on
// changed, so a run after an answer or a source edit only renders the screens that edit reaches.
//
// screenCache(dir, { browserVersion }) -> { key(parts) -> hex, get(slot, key) -> value | null, put(slot, key, value),
//   prune(slots) }
//   key(parts): sha256 over JSON.stringify([CODE, browserVersion, ...keyable(parts)]); CODE = the hash of every file of core/ (any
//   plugin change empties the cache in effect), browserVersion = the Chromium version (rendering depends on it).
//   A slot names one screen of one source file ("<file hash>-<screen id>"); a slot holds one value: put removes the
//   slot's other keys. Values go through v8.serialize (Buffers stay Buffers). A file that cannot be read or decoded is
//   a miss. prune(slots) removes the files of every slot not in `slots` that starts with one of their file prefixes.
// The caller decides what goes into the key: everything the cached value is a function of.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize, deserialize } from 'node:v8';

const sha = (b) => createHash('sha256').update(b).digest('hex');

// R95: a screenshot is a function of the captured tree and the resources it names, up to GPU raster noise (the same
// page gives a few pixels that differ from run to run), so it is left out of a key: keyable(v) puts 'png' in place of
// every PNG Buffer (other Buffers: their sha256). What a screenshot shows beyond the tree is keyed by screenKey.
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const isPng = (b) => (Buffer.isBuffer(b) || b instanceof Uint8Array) && b.length > 8 && Buffer.from(b.buffer, b.byteOffset, 8).equals(PNG_SIG);
export function keyable(v) {
  if (isPng(v)) return 'png';
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `bytes:${sha(Buffer.from(v.buffer, v.byteOffset, v.byteLength))}`;
  if (Array.isArray(v)) return v.map(keyable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keyable(x)]));
  return v;
}

// screenKey(screen) -> what of a captured screen a key needs besides keyable(screen): the content hash of every local
// file its images and background images name (a file replaced under the same name), or null when the screen holds a
// canvas, video or iframe (content the tree does not describe: such a screen is never cached).
export function screenKey(screen) {
  const urls = new Set();
  let opaque = false;
  const walk = (n) => {
    if (['canvas', 'video', 'iframe'].includes(n.tag)) opaque = true;
    if (n.src) urls.add(String(n.src));
    const bg = n.paint && n.paint.bgImage;
    if (bg) for (const m of String(bg).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) urls.add(m[1]);
    (n.kids || []).forEach(walk);
  };
  walk(screen.tree || {});
  if (opaque) return null;
  return [...urls].sort().map((u) => {
    if (!u.startsWith('file:')) return [u, null];
    try { return [u, sha(readFileSync(fileURLToPath(u)))]; } catch { return [u, 'missing']; }
  });
}

let CODE = null;
export function codeHash() {
  if (CODE) return CODE;
  const dir = dirname(fileURLToPath(import.meta.url));
  const h = createHash('sha256');
  for (const f of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort()) { h.update(f); h.update(readFileSync(join(dir, f))); }
  return (CODE = h.digest('hex'));
}

export const slotOf = (file, screenId) => `${sha(String(file)).slice(0, 12)}-${String(screenId).replace(/[^A-Za-z0-9_.]/g, '_')}`;

export function screenCache(dir, { browserVersion = '' } = {}) {
  mkdirSync(dir, { recursive: true });
  const name = (slot, key) => `${slot}--${key.slice(0, 32)}.bin`;
  return {
    // JSON, not v8.serialize: v8 writes the same number as an int or a double depending on how it was computed
    key: (parts) => sha(JSON.stringify([codeHash(), browserVersion, ...keyable(parts)])),
    get(slot, key) {
      try { return deserialize(readFileSync(join(dir, name(slot, key)))); } catch { return null; }
    },
    put(slot, key, value) {
      const f = join(dir, name(slot, key)), tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, serialize(value));
      renameSync(tmp, f);
      for (const g of readdirSync(dir)) if (g.startsWith(`${slot}--`) && g !== name(slot, key)) rmSync(join(dir, g), { force: true });
    },
    prune(slots) {
      const keep = new Set(slots), prefixes = new Set([...keep].map((s) => s.split('-')[0]));
      for (const g of readdirSync(dir)) {
        const slot = g.split('--')[0];
        if (prefixes.has(slot.split('-')[0]) && !keep.has(slot)) rmSync(join(dir, g), { force: true });
      }
    },
  };
}
