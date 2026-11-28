// The Figma Desktop bridge plugin at a fixed place (R100). Figma remembers a development plugin by the path of the
// manifest the user imported, and this plugin is installed in a folder named after its version: an update would leave
// Figma running the old copy. figma.mjs serve copies figma-plugin/ to one folder per machine, so the user imports once.
//
// installPlugin({ dir }) -> { dir, manifest (absolute path to paste into Figma's import dialog), version, state }
//   dir: VD_FIGMA_PLUGIN_DIR, else <home>/.vuong-design/figma-plugin.
//   state: 'new' (nothing there: import once), 'manifest' (the manifest changed: import again), 'code' (code.js /
//   ui.html replaced: close the plugin window and run it again), 'same'.
//   ui.html is written with its version in place of __VDV__; the window sends it with every /next (figma-bridge.mjs
//   refuses a window whose version is not this one). A window run from a checkout sends __VDV__ and is accepted.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_SRC = fileURLToPath(new URL('../figma-plugin/', import.meta.url));
export const PLUGIN_FILES = ['manifest.json', 'code.js', 'ui.html'];
export const VDV = '__VDV__';
const lf = (s) => s.replace(/\r\n/g, '\n');
const src = () => Object.fromEntries(PLUGIN_FILES.map((f) => [f, lf(readFileSync(join(PLUGIN_SRC, f), 'utf8'))]));

export function pluginVersion(files = src()) {
  const h = createHash('sha256');
  for (const f of PLUGIN_FILES) h.update(`${f}\0${files[f]}\0`);
  return h.digest('hex').slice(0, 12);
}

export const pluginDir = (env = process.env) => env.VD_FIGMA_PLUGIN_DIR || join(homedir(), '.vuong-design', 'figma-plugin');

export function installPlugin({ dir = pluginDir() } = {}) {
  const files = src(), version = pluginVersion(files);
  const want = { ...files, 'ui.html': files['ui.html'].split(VDV).join(version) };
  const have = Object.fromEntries(PLUGIN_FILES.map((f) => [f, existsSync(join(dir, f)) ? lf(readFileSync(join(dir, f), 'utf8')) : null]));
  const state = have['manifest.json'] == null ? 'new' : have['manifest.json'] !== want['manifest.json'] ? 'manifest'
    : PLUGIN_FILES.some((f) => have[f] !== want[f]) ? 'code' : 'same';
  if (state !== 'same') {
    mkdirSync(dir, { recursive: true });
    for (const f of PLUGIN_FILES) if (have[f] !== want[f]) writeFileSync(join(dir, f), want[f]);
  }
  return { dir, manifest: join(dir, 'manifest.json'), version, state };
}

// How to type a path into the open dialog of each system (the folder starts with a dot, so it is hidden in the dialog):
// Windows has a file name box; macOS opens a path box with Cmd+Shift+G; GTK (Linux) with Ctrl+L. Figma ships Figma
// Desktop for Windows and macOS only: on Linux the bridge needs an unofficial desktop build that can import development
// plugins, else the courier (use_figma) sends the batches.
export const pasteHow = (platform = process.platform) => platform === 'darwin' ? 'press Cmd+Shift+G in the file dialog and paste this path'
  : platform === 'win32' ? 'paste this path into the "File name" box' : 'press Ctrl+L in the file dialog and paste this path';
const LINUX_NOTE = 'Figma Desktop is made for Windows and macOS only: on Linux this needs a desktop build that can import development plugins; without one, send the batches with the courier (README "Figma CLI")';

// the lines serve prints: the path stays on a line of its own, so it can be copied as it is
export function installLines(r, platform = process.platform) {
  const imp = `in Figma Desktop: Plugins > Development > Import plugin from manifest..., then ${pasteHow(platform)}:`;
  const note = platform === 'linux' ? [LINUX_NOTE] : [];
  if (r.state === 'new') return [`Figma plugin, once per machine: ${imp}`, `  ${r.manifest}`, ...note];
  if (r.state === 'manifest') return [`the Figma plugin manifest changed: import it again (${imp})`, `  ${r.manifest}`, ...note];
  if (r.state === 'code') return [`the Figma plugin was updated in ${r.dir}: if its window is open, close it and run it again`];
  return [];
}
