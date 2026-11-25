// Locates Playwright and an already-installed Chromium. Never installs or downloads anything.
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class SetupError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'SetupError';
    this.hint = hint;
  }
}

const INSTALL_HINT =
  'Install playwright-core in a directory (npm i playwright-core) and point VD_PLAYWRIGHT_FROM at it, ' +
  'or run from a project whose node_modules contains playwright or playwright-core.';

function resolveFrom(dir) {
  const req = createRequire(join(dir, 'noop.js'));
  for (const name of ['playwright', 'playwright-core']) {
    try { return req.resolve(name); } catch { /* try next */ }
  }
  return null;
}

// Order: $VD_PLAYWRIGHT_FROM, then the current project's node_modules.
export function findPlaywright() {
  const candidates = [];
  if (process.env.VD_PLAYWRIGHT_FROM) candidates.push(process.env.VD_PLAYWRIGHT_FROM);
  else candidates.push(process.cwd());
  // An explicit env var that fails must not silently fall back to cwd.
  for (const dir of candidates) {
    const found = resolveFrom(dir);
    if (found) return found;
  }
  throw new SetupError(
    `Playwright not found (looked in ${candidates.join(', ')})`,
    INSTALL_HINT,
  );
}

function browsersRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

const EXE_SUBPATHS = {
  win32: [['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe']],
  linux: [['chrome-linux', 'chrome'], ['chrome-linux64', 'chrome']],
  darwin: [
    ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ],
};

// Newest installed chromium-<rev>/... executable.
export function findChromium() {
  const root = browsersRoot();
  let revs = [];
  try {
    revs = readdirSync(root)
      .map((n) => /^chromium-(\d+)$/.exec(n))
      .filter(Boolean)
      .map((m) => ({ rev: Number(m[1]), dir: join(root, m[0]) }))
      .sort((a, b) => b.rev - a.rev);
  } catch { /* root missing */ }
  for (const { dir } of revs) {
    for (const sub of EXE_SUBPATHS[process.platform] || []) {
      const exe = join(dir, ...sub);
      if (existsSync(exe)) return exe;
    }
  }
  throw new SetupError(
    `No installed Playwright Chromium found under ${root}`,
    'Install it once with: npx playwright install chromium (this plugin never downloads browsers).',
  );
}

export async function launchBrowser() {
  const modPath = findPlaywright();
  const executablePath = findChromium();
  const mod = createRequire(modPath)(modPath);
  const chromium = mod.chromium || (mod.default && mod.default.chromium);
  return chromium.launch({ headless: true, executablePath });
}
