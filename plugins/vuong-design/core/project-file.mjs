// Project file (R89): one vd-project.json per project holds the arguments every step needs, so a run is
// `ds.mjs --project vd-project.json` instead of a line of flags to remember. Flags given on the command line win.
//
// {
//   "version": 1,
//   "html": "screens.html",          // the source page (spec-to-html writes it)
//   "root": ".screen",               // screens selector (omit for a vd-html v1 file: [data-vd-screen])
//   "widen": ".phone",               // element widened for width B (omit: [data-vd-widen] when the file has one)
//   "name": "...", "viewport": 390, "widenBy": 120, "webFonts": true,
//   "out": "build/vd-ds",            // ds.mjs output folder
//   "rules": "vd-rules.json", "names": "vd-names.json", "allowlist": "vd-allowlist.json", "components": "vd-components.json",
//   "figma": { "out": "build/vd-figma", "file": "My design", "page": "Screens" }
// }
//
// Paths are relative to the folder of the project file. Every key but version and html is optional; an unknown key is
// an error (a typo would otherwise be ignored silently).
//
// readProject(path) -> { path, dir, html, root?, ..., figma? } with absolute paths; throws ProjectError.
// projectDefaults(project, have, wanted) -> { [option]: value } for the options in `wanted` the command line left out
//   (`have`: option name -> value given). A rules / names / allowlist / components file that does not exist yet is
//   left out (a new project has none), except for the commands that create it (answer: rules, approve: allowlist).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class ProjectError extends Error {}

export const PROJECT_VERSION = 1;
const STR = ['html', 'root', 'widen', 'name', 'out', 'rules', 'names', 'allowlist', 'components'];
const PATHS = new Set(['html', 'out', 'rules', 'names', 'allowlist', 'components']);
const NUM = ['viewport', 'widenBy'];
const FIGMA = { out: 'path', file: 'string', page: 'string' };

export function readProject(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new ProjectError(`project file not found: ${abs}`);
  let j;
  try { j = JSON.parse(readFileSync(abs, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new ProjectError(`${abs}: not JSON (${e.message})`); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new ProjectError(`${abs}: expected an object`);
  if (j.version !== PROJECT_VERSION) throw new ProjectError(`${abs}: "version" must be ${PROJECT_VERSION}`);
  const dir = dirname(abs);
  const out = { path: abs, dir };
  for (const [k, v] of Object.entries(j)) {
    if (k === 'version' || k === 'about') continue;
    if (STR.includes(k)) {
      if (typeof v !== 'string' || !v.trim()) throw new ProjectError(`${abs}: "${k}" must be a non-empty string`);
      out[k] = PATHS.has(k) ? resolve(dir, v) : v;
    } else if (NUM.includes(k)) {
      if (typeof v !== 'number' || !(v > 0)) throw new ProjectError(`${abs}: "${k}" must be a number > 0`);
      out[k] = v;
    } else if (k === 'webFonts') {
      if (typeof v !== 'boolean') throw new ProjectError(`${abs}: "webFonts" must be true or false`);
      out.webFonts = v;
    } else if (k === 'figma') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProjectError(`${abs}: "figma" must be an object`);
      out.figma = {};
      for (const [fk, fv] of Object.entries(v)) {
        if (!FIGMA[fk]) throw new ProjectError(`${abs}: unknown key "figma.${fk}" (known: ${Object.keys(FIGMA).join(', ')})`);
        if (typeof fv !== 'string' || !fv.trim()) throw new ProjectError(`${abs}: "figma.${fk}" must be a non-empty string`);
        out.figma[fk] = FIGMA[fk] === 'path' ? resolve(dir, fv) : fv;
      }
    } else {
      throw new ProjectError(`${abs}: unknown key "${k}" (known: version, about, ${[...STR, ...NUM, 'webFonts', 'figma'].join(', ')})`);
    }
  }
  if (!out.html) throw new ProjectError(`${abs}: "html" is required`);
  return out;
}

// option name (as the CLI spells it) -> project key
const OPT = { html: 'html', root: 'root', widen: 'widen', name: 'name', out: 'out', rules: 'rules', names: 'names', allowlist: 'allowlist',
  components: 'components', viewport: 'viewport', 'widen-by': 'widenBy', ds: 'out' };
const OPTIONAL_FILES = new Set(['rules', 'names', 'allowlist', 'components']);

export function projectDefaults(project, have, wanted, { create = [] } = {}) {
  const d = {};
  for (const opt of wanted) {
    if (have[opt] !== undefined) continue;
    if (opt === 'no-webfonts') { if (project.webFonts === false) d[opt] = true; continue; }
    const k = OPT[opt];
    const v = k && project[k];
    if (v === undefined) continue;
    if (OPTIONAL_FILES.has(k) && !create.includes(opt) && !existsSync(v)) continue;
    d[opt] = typeof v === 'number' ? String(v) : v;
  }
  return d;
}
