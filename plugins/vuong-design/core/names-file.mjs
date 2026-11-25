// Token names file (plan 2, Task 7): `vd-names.json`, the AI's (or user's) role names for tokens, read only.
//
//  - readNames(path) -> { [token path]: new token path }. A missing file (or no path) is {}. Invalid JSON, a top level
//    that is not an object, or a value that is not a string throw an Error naming the file and the key.
//  - checkPath(path) -> null | reason: a DTCG token path is segments joined by '.', each segment non-empty, without
//    '{', '}' or '.', and not starting with '$'.
//  - validateNames(names, tokens) -> { rename: Map(old -> new), errors: [string], warnings: [{ code, path, message }] }
//    tokens = [{ path, named }] (named: the token's name came from a CSS variable of the source).
//    Errors: an invalid new path, a new path in another tier (the first segment must stay 'primitive' / 'role' /
//    'component'), two tokens ending on the same path (renamed onto each other or onto a token that keeps its name),
//    a path that would be both a token and a group (one path a prefix of another).
//    Warnings: RENAME_NAMED (the token's name came from a CSS variable; renamed anyway, the user may not want it),
//    NAME_UNKNOWN (no token has that path; ignored). A rename to the same path is a no-op.
import { existsSync, readFileSync } from 'node:fs';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function readNames(path) {
  if (!path || !existsSync(path)) return {};
  let j;
  try {
    j = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`names file ${path}: not valid JSON (${e.message})`);
  }
  if (!isObj(j)) throw new Error(`names file ${path}: the top level must be an object of { "token.path": "new.path" }`);
  for (const [k, v] of Object.entries(j)) {
    if (typeof v !== 'string') throw new Error(`names file ${path}: the new name for "${k}" must be a string`);
  }
  return { ...j };
}

export function checkPath(path) {
  if (typeof path !== 'string' || !path) return 'empty path';
  for (const seg of path.split('.')) {
    if (!seg) return `empty segment in "${path}"`;
    if (/[{}]/.test(seg)) return `segment "${seg}" contains '{' or '}'`;
    if (seg[0] === '$') return `segment "${seg}" starts with '$'`;
  }
  return null;
}

export function validateNames(names, tokens) {
  const errors = [], warnings = [];
  const rename = new Map();
  const known = new Map((tokens || []).map((t) => [t.path, t]));
  for (const from of Object.keys(names || {}).sort(cmpStr)) {
    const to = names[from];
    const t = known.get(from);
    if (!t) { warnings.push({ code: 'NAME_UNKNOWN', path: from, message: `no token "${from}"; the rename to "${to}" is ignored` }); continue; }
    const bad = checkPath(to);
    if (bad) { errors.push(`"${from}" -> "${to}": ${bad}`); continue; }
    if (to.split('.')[0] !== from.split('.')[0]) { errors.push(`"${from}" -> "${to}": a token cannot move to another tier (${from.split('.')[0]})`); continue; }
    if (to.split('.').length < 2) { errors.push(`"${from}" -> "${to}": a token path needs a tier and a name`); continue; }
    if (to === from) continue;
    if (t.named) warnings.push({ code: 'RENAME_NAMED', path: from, message: `"${from}" is named after a CSS variable of the source; renamed to "${to}"` });
    rename.set(from, to);
  }
  // final paths: duplicates and token/group clashes
  const owner = new Map();
  for (const t of tokens || []) {
    const p = rename.get(t.path) ?? t.path;
    if (owner.has(p)) errors.push(`"${owner.get(p)}" and "${t.path}" would both be named "${p}"`);
    else owner.set(p, t.path);
  }
  const finals = [...owner.keys()].sort(cmpStr);
  for (let i = 0; i + 1 < finals.length; i++) {
    for (let j = i + 1; j < finals.length && finals[j].startsWith(finals[i]); j++) {
      if (finals[j].startsWith(finals[i] + '.')) errors.push(`"${finals[i]}" would be both a token and the group of "${finals[j]}"`);
    }
  }
  return { rename, errors, warnings };
}
