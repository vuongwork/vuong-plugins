#!/usr/bin/env node
// Approve server (R88): open report.html of a layout / ds / figma check run in the browser and save the findings ticked
// there into the allowlist file, so the user never copies allowlistDraft entries by hand.
//
//   node core/approve.mjs --out <run output folder> --allowlist <vd-allowlist.json> [--port <n>] [--no-open]
//
// Reads <out>/report.html and <out>/report.json. A missing allowlist file is created ({ "allowlist": [] }).
// Serves on 127.0.0.1 only (port 0 = any free port, the default) and opens the page unless --no-open.
//   GET  /         -> report.html
//   GET  /allowlist -> { entries: [{ file, screen, node, width, kind }] } the approved entries of the file now, so the
//                     page marks findings submitted since the report was made as saved
//   POST /approve  -> body { approve: [{ file, screen, kind, node, width, reason? }] }, content-type application/json.
//                     Each item must be an open finding of report.json (its allowlistDraft entry), and one the gate
//                     can allowlist (pipeline.gate: never an unexplained norm root outside a real-Figma check, nor a
//                     record-check or norm-layout root). The draft entry is saved with approved: true and the reason
//                     (at most 500 characters; empty: "approved in report.html <date>"); an entry of the file for the
//                     same file / screen / node / width / kind is replaced, every other entry and key is kept. All or
//                     nothing: one bad item saves none (400, the errors listed). The old file is copied to
//                     <allowlist>.bak, the new one is checked with readAllowlist before it replaces the old one.
//                     Reply { saved, total, path, backup }.
// A request whose Host is not this server's address, or whose Origin is another site, is refused (403).
// Runs until Ctrl+C. Exit codes: 2 usage / setup error.
//
// mergeApprovals({ file, report, approve, today }) -> { file, saved, errors }: the pure merge (file = the parsed
// allowlist file, an array or { allowlist: [...] }; report = the parsed report.json).
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openBrowser } from './answer.mjs';
import { readAllowlist } from './layout.mjs';

const REASON_MAX = 500;
const BODY_MAX = 1 << 20;
const KINDS = new Set(['root', 'approval', 'crop']);
const same = (a, b) => a.file === b.file && a.screen === b.screen && a.node === b.node && a.width === b.width && a.kind === b.kind;

export function mergeApprovals({ file, report, approve, today = new Date().toISOString().slice(0, 10) }) {
  const errors = [];
  const list = Array.isArray(file) ? file : file && Array.isArray(file.allowlist) ? file.allowlist : null;
  if (!list) return { file, saved: 0, errors: ['the allowlist file must be an array or { "allowlist": [...] }'] };
  if (!Array.isArray(approve) || !approve.length) return { file, saved: 0, errors: ['"approve" must be a non-empty array'] };
  const screens = (report && report.screens) || [];
  const add = [];
  for (const a of approve) {
    const what = a && `${a.file} ${a.screen} ${a.kind} ${a.node} at ${a.width}`;
    if (!a || typeof a !== 'object' || !KINDS.has(a.kind) || ![a.file, a.screen, a.node].every((x) => typeof x === 'string') || !['A', 'B'].includes(a.width)) {
      errors.push(`not an item: ${JSON.stringify(a)}`); continue;
    }
    const reason = a.reason == null ? '' : a.reason;
    if (typeof reason !== 'string' || reason.length > REASON_MAX) { errors.push(`${what}: the reason is a text of at most ${REASON_MAX} characters`); continue; }
    const s = screens.find((x) => x.summary && x.summary.file === a.file && x.summary.screen === a.screen);
    const draft = s && (s.allowlistDraft || []).find((d) => d.kind === a.kind && d.node === a.node && d.width === a.width);
    if (!draft) { errors.push(`${what}: not an open finding of this run`); continue; }
    if (a.kind === 'root') {
      const r = (s.report.roots || []).find((x) => x.id === a.node && x.width === a.width && !x.explainedBy);
      if (r && r.layer === 'norm' && !(s.report.figmaReal && !r.recordCheck && !r.on)) { errors.push(`${what}: an unexplained norm root cannot be allowlisted (a plugin bug)`); continue; }
    }
    if (a.kind === 'crop' && (s.gate.open.cropsLinked || []).some((x) => x.id === a.node && x.width === a.width)) {
      errors.push(`${what}: this crop passes only with the entry of its layout error`); continue;
    }
    const e = { ...draft, reason: reason.trim() || `approved in report.html ${today}`, approved: true };
    const i = add.findIndex((x) => same(x, e));
    if (i >= 0) add[i] = e; else add.push(e);
  }
  if (errors.length) return { file, saved: 0, errors };
  const merged = [...list.filter((x) => !add.some((e) => x && same(x, e))), ...add];
  return { file: Array.isArray(file) ? merged : { ...file, allowlist: merged }, saved: add.length, errors };
}

function saveFile(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  readAllowlist(tmp); // throws on a file the run would refuse
  let backup = null;
  if (existsSync(path)) { backup = `${path}.bak`; copyFileSync(path, backup); }
  renameSync(tmp, path);
  return backup;
}

function readRaw(path) {
  if (!existsSync(path)) return { allowlist: [] };
  readAllowlist(path); // same checks as the run
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

export function startApproveServer({ dir, allowlistPath, port = 0, host = '127.0.0.1', log = () => {} }) {
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
    if (req.method === 'GET' && (path === '/' || path === '/report.html')) return reply(res, 200, readFileSync(join(dir, 'report.html'), 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && path === '/allowlist') {
      try {
        const raw = readRaw(allowlistPath);
        const entries = (Array.isArray(raw) ? raw : raw.allowlist).filter((e) => e && e.approved === true)
          .map(({ file, screen, node, width, kind }) => ({ file, screen, node, width, kind }));
        return reply(res, 200, { entries });
      } catch (e) { return reply(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && path === '/approve') {
      if (!/^application\/json\b/.test(String(req.headers['content-type']))) return reply(res, 415, { error: 'content-type must be application/json' });
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { req.destroy(); return; } chunks.push(c); });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
          const { file, saved, errors } = mergeApprovals({ file: readRaw(allowlistPath), report, approve: body.approve });
          if (errors.length) return reply(res, 400, { error: errors.join('; '), errors });
          const backup = saveFile(allowlistPath, file);
          const total = (Array.isArray(file) ? file : file.allowlist).length;
          log(`saved ${saved} entr${saved === 1 ? 'y' : 'ies'} into ${allowlistPath}${backup ? ` (backup ${backup})` : ''}`);
          return reply(res, 200, { saved, total, path: allowlistPath, backup: backup || 'none (new file)' });
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

const USAGE = 'usage: node core/approve.mjs --out <run output folder> --allowlist <vd-allowlist.json> [--port <n>] [--no-open]';

export async function main(argv, { log = (s) => process.stdout.write(`${s}\n`), cwd = process.cwd(), open = openBrowser } = {}) {
  let o;
  try {
    o = parseArgs({ args: argv, options: { out: { type: 'string' }, allowlist: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' } } }).values;
  } catch (e) { log(`${e.message}\n${USAGE}`); return { code: 2 }; }
  if (!o.out || !o.allowlist) { log(USAGE); return { code: 2 }; }
  const dir = resolve(cwd, o.out);
  for (const f of ['report.html', 'report.json']) {
    if (!existsSync(join(dir, f))) { log(`${f} not found in ${dir} (run the check with --out ${o.out} first)`); return { code: 2 }; }
  }
  const allowlistPath = resolve(cwd, o.allowlist);
  try { readRaw(allowlistPath); } catch (e) { log(e.message); return { code: 2 }; }
  const port = o.port === undefined ? 0 : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { log(`bad --port ${o.port}`); return { code: 2 }; }
  const srv = await startApproveServer({ dir, allowlistPath, port, log });
  log(`approved entries go into ${allowlistPath}${existsSync(allowlistPath) ? '' : ' (created on the first submit)'}`);
  log(`open ${srv.url} , tick the findings that are fine, press Submit; Ctrl+C to stop`);
  if (!o['no-open']) open(srv.url);
  return { code: 0, ...srv };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((r) => { if (r.code) process.exit(r.code); }, (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
