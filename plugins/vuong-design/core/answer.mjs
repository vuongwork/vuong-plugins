#!/usr/bin/env node
// Answer server (R88): open design-system.html of a ds.mjs run in the browser and save the answers picked there into
// the rules file, so the user never edits vd-rules.json by hand.
//
//   node core/answer.mjs --out <ds output folder> [--rules <vd-rules.json>] [--port <n>] [--no-open]
//   node core/answer.mjs --project <vd-project.json> [options]   (R91: out and rules from the project file)
//
// Reads <out>/design-system.html and <out>/questions.json. Rules file: --rules, else the one the run read (embedded
// in the page, #vd-answer-ctx), else a usage error. A missing rules file is created ({ version: 1, answers: {} }).
// Serves on 127.0.0.1 only (port 0 = any free port, the default) and opens the page unless --no-open.
//   GET  /         -> design-system.html
//   POST /answers  -> body { answers: { [question key]: value } }, content-type application/json. Each key must be a
//                     question of questions.json (an open one, or an answered one to change it); a question with
//                     options takes one of them (compared as strings, saved as the option itself), a free question a
//                     non-empty string of at most 500 characters. All or nothing: one bad answer saves none (400, the
//                     errors listed). Otherwise the answers are merged into the rules file: every other key of the
//                     file (notes, states, other answers) is kept as it was, the old file is copied to <rules>.bak,
//                     the new one is checked with readRules before it replaces the old one. Reply { saved, total,
//                     path, backup }.
// A request whose Host is not this server's address, or whose Origin is another site, is refused (403).
// Runs until Ctrl+C. Exit codes: 2 usage / setup error.
//
// mergeAnswers({ rules, questions, answers }) -> { rules, saved, errors }: the pure merge (rules = the parsed file).
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readRules, RULES_VERSION } from './rules-file.mjs';
import { readProject, projectDefaults } from './project-file.mjs';

const FREE_MAX = 500;
const BODY_MAX = 1 << 20;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function mergeAnswers({ rules, questions, answers }) {
  const errors = [];
  if (!isObj(answers)) return { rules, saved: 0, errors: ['"answers" must be an object'] };
  const byKey = new Map((questions || []).map((q) => [q.key, q]));
  const valid = {};
  for (const [key, a] of Object.entries(answers)) {
    const q = byKey.get(key);
    if (!q) { errors.push(`"${key}" is not a question of this run`); continue; }
    if (Array.isArray(q.options)) {
      const opt = q.options.find((o) => String(o) === String(a));
      if (opt === undefined) errors.push(`"${key}": ${JSON.stringify(a)} is not one of ${q.options.map((o) => JSON.stringify(o)).join(', ')}`);
      else valid[key] = opt;
    } else if (typeof a !== 'string' || !a.trim() || a.length > FREE_MAX) errors.push(`"${key}": a free answer is a non-empty text of at most ${FREE_MAX} characters`);
    else valid[key] = a.trim();
  }
  if (errors.length) return { rules, saved: 0, errors };
  const out = { ...(rules || {}) };
  if (!('version' in out)) out.version = RULES_VERSION;
  out.answers = { ...(isObj(out.answers) ? out.answers : {}), ...valid };
  // version first, as the files are written by hand
  const ordered = { version: out.version, ...out };
  return { rules: ordered, saved: Object.keys(valid).length, errors };
}

function saveRules(rulesPath, rules) {
  const tmp = `${rulesPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rules, null, 2)}\n`);
  readRules(tmp); // throws on a file the run would refuse
  let backup = null;
  if (existsSync(rulesPath)) { backup = `${rulesPath}.bak`; copyFileSync(rulesPath, backup); }
  renameSync(tmp, rulesPath);
  return backup;
}

function readRaw(rulesPath) {
  if (!existsSync(rulesPath)) return { version: RULES_VERSION, answers: {} };
  readRules(rulesPath); // same checks as the run
  return JSON.parse(readFileSync(rulesPath, 'utf8').replace(/^﻿/, ''));
}

export function pageContext(html) {
  const m = /<script type="application\/json" id="vd-answer-ctx">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export function startAnswerServer({ dir, rulesPath, port = 0, host = '127.0.0.1', log = () => {} }) {
  const htmlPath = join(dir, 'design-system.html');
  const qPath = join(dir, 'questions.json');
  const reply = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const server = http.createServer((req, res) => {
    const addr = server.address();
    const allowed = new Set([`127.0.0.1:${addr.port}`, `localhost:${addr.port}`]);
    if (!allowed.has(String(req.headers.host))) return reply(res, 403, { error: 'wrong host' });
    if (req.headers.origin && !allowed.has(String(req.headers.origin).replace(/^https?:\/\//, ''))) return reply(res, 403, { error: 'wrong origin' });
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && (path === '/' || path === '/design-system.html')) {
      return reply(res, 200, readFileSync(htmlPath, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && path === '/answers') {
      if (!/^application\/json\b/.test(String(req.headers['content-type']))) return reply(res, 415, { error: 'content-type must be application/json' });
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { req.destroy(); return; } chunks.push(c); });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const questions = JSON.parse(readFileSync(qPath, 'utf8'));
          const { rules, saved, errors } = mergeAnswers({ rules: readRaw(rulesPath), questions, answers: body.answers });
          if (errors.length) return reply(res, 400, { error: errors.join('; '), errors });
          const backup = saveRules(rulesPath, rules);
          log(`saved ${saved} answer(s) into ${rulesPath}${backup ? ` (backup ${backup})` : ''}`);
          return reply(res, 200, { saved, total: Object.keys(rules.answers).length, path: rulesPath, backup: backup || 'none (new file)' });
        } catch (e) {
          return reply(res, 400, { error: e.message });
        }
      });
      return undefined;
    }
    return reply(res, 404, { error: 'not found' });
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      ok({ url, server, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref(); } catch { /* the URL is printed anyway */ }
}

const USAGE = 'usage: node core/answer.mjs --out <ds output folder> [--rules <vd-rules.json>] [--port <n>] [--no-open]\n       node core/answer.mjs --project <vd-project.json> [options]';

export async function main(argv, { log = (s) => process.stdout.write(`${s}\n`), cwd = process.cwd(), open = openBrowser } = {}) {
  let o;
  try {
    o = parseArgs({ args: argv, options: { out: { type: 'string' }, rules: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, project: { type: 'string' } } }).values;
    if (o.project) Object.assign(o, projectDefaults(readProject(resolve(cwd, o.project)), o, ['out', 'rules'], { create: ['rules'] }));
  } catch (e) { log(`${e.message}\n${USAGE}`); return { code: 2 }; }
  if (!o.out) { log(USAGE); return { code: 2 }; }
  const dir = resolve(cwd, o.out);
  for (const f of ['design-system.html', 'questions.json']) {
    if (!existsSync(join(dir, f))) { log(`${f} not found in ${dir} (run ds.mjs with --out ${o.out} first)`); return { code: 2 }; }
  }
  const ctx = pageContext(readFileSync(join(dir, 'design-system.html'), 'utf8'));
  const rulesPath = o.rules ? resolve(cwd, o.rules) : ctx && ctx.rulesPath;
  if (!rulesPath) { log(`no rules file: the run read none, pass --rules <path of vd-rules.json>\n${USAGE}`); return { code: 2 }; }
  try { readRaw(rulesPath); } catch (e) { log(e.message); return { code: 2 }; }
  const port = o.port === undefined ? 0 : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { log(`bad --port ${o.port}`); return { code: 2 }; }
  const srv = await startAnswerServer({ dir, rulesPath, port, log });
  log(`answers go into ${rulesPath}${existsSync(rulesPath) ? '' : ' (created on the first submit)'}`);
  log(`open ${srv.url} , pick the answers, press Submit; Ctrl+C to stop`);
  if (!o['no-open']) open(srv.url);
  return { code: 0, ...srv };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((r) => { if (r.code) process.exit(r.code); }, (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
