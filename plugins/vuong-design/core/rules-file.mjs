// Project rules file (plan 2, Task 4): the user's answers to normalisation questions, `vd-rules.json` at the project
// root by default (`--rules` to change). Scripts only read it; the answers are written by the user (or an AI on the
// user's word). rulesTemplate() builds a draft the CLI writes under `--out`, never to the rules path.
//
//  - readRules(path) -> { version: 1, answers: { [question key]: option value }, notes?, states? }. `states` (plan 3b
//    Task 3) holds the component state rules; only its type is checked here, its keys by states.mjs stateRules(). A missing file (or no path)
//    is the empty rule set { version: 1, answers: {} }. Invalid JSON, a top-level value that is not an object, a
//    missing or wrong `version`, an unknown top-level key, or `answers` / `notes` that are not objects throw an Error
//    naming the file and the key. Whether an answer is one of its question's options is checked by normalize (it
//    knows the options); answers for questions that no longer exist are reported there as `stale`.
//  - rulesTemplate(questions) -> { version: 1, answers: { [key]: default }, notes: { [key]: question text } } for the
//    open questions (neither answered nor resolved by a per-role or project answer), keys sorted. A draft only:
//    copying it answers every group question with its proposal; the project keys draft 'ask-each' (no change). R68:
//    normalize lists group and project keys only, so the template never holds per-role keys (still read if written).
import { existsSync, readFileSync } from 'node:fs';

export const RULES_VERSION = 1;
const TOP = new Set(['version', 'answers', 'notes', 'states']);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function readRules(path) {
  if (!path || !existsSync(path)) return { version: RULES_VERSION, answers: {} };
  let j;
  try {
    j = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`rules file ${path}: not valid JSON (${e.message})`);
  }
  if (!isObj(j)) throw new Error(`rules file ${path}: the top level must be an object`);
  for (const k of Object.keys(j)) if (!TOP.has(k)) throw new Error(`rules file ${path}: unknown top-level key "${k}"`);
  if (!('version' in j)) throw new Error(`rules file ${path}: missing "version" (expected ${RULES_VERSION})`);
  if (j.version !== RULES_VERSION) throw new Error(`rules file ${path}: "version" is ${JSON.stringify(j.version)}, expected ${RULES_VERSION}`);
  if (j.answers !== undefined && !isObj(j.answers)) throw new Error(`rules file ${path}: "answers" must be an object`);
  if (j.notes !== undefined && !isObj(j.notes)) throw new Error(`rules file ${path}: "notes" must be an object`);
  if (j.states !== undefined && !isObj(j.states)) throw new Error(`rules file ${path}: "states" must be an object`);
  const out = { version: RULES_VERSION, answers: { ...(j.answers || {}) } };
  if (j.notes) out.notes = { ...j.notes };
  if (j.states) out.states = JSON.parse(JSON.stringify(j.states));
  return out;
}

export function rulesTemplate(questions) {
  const open = [...(questions || [])].filter((q) => q.answered === undefined && !q.resolved).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    version: RULES_VERSION,
    answers: Object.fromEntries(open.map((q) => [q.key, q.default])),
    notes: Object.fromEntries(open.map((q) => [q.key, q.text])),
  };
}
