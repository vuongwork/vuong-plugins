#!/usr/bin/env node
// Figma CLI (plan 3 Task 7). The script never calls Figma: it prepares `use_figma` calls, takes their results back, and
// verifies the real Figma screens with the plan 1-2 verifier (README "Figma CLI").
//
//   node core/figma.mjs plan   --ds <ds.mjs output folder> --out <dir> [--page Screens] [--max-calls 40] [--force <screen>]... [--redo]
//   node core/figma.mjs ingest --out <dir> --result <file> [--batch vars-NN | batch-NN | N]
//   node core/figma.mjs shots --out <dir>; ingest-shots --out <dir> --result <file>; shots-clean --out <dir>
//   node core/figma.mjs check  --out <dir> [--mutate] [--allowlist <json>] [--html <file>] [--root <sel>] [--widen <sel>]
//        [--name <sel>] [--widen-by <px>] [--viewport <px>] [--no-webfonts] [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>]
//
// Everything is written to <out>/figma/ (README "Figma CLI" has the file table):
//   vars-NN.js (figma-vars.mjs varsPayload, in order), batch-NN.js (planBatches code: runtime + data) and batch-NN.data.json
//   (its data D, for check), state.json, result-<key>.json (ingested results), shot-<screen>.png (saved by the AI),
//   report.json, report.html.
// plan: encodes every screen of the ds output (spec-norm-<id>.json, token-map.json, tokens.json, ir.json svgDefs / W)
//   and writes the batches; vars batches first. A batch already 'done' with the same code is kept as is (not written
//   again) unless --redo; numbering is stable for the same input (screen batches 1.., vars batches 1.. in file names;
//   a vars result carries its 0-based `batch`). --force <screen> (repeatable or comma-separated) puts the screen in
//   D.force: the runtime rebuilds it even when edited by hand. Prints the estimate (use_figma calls = vars + screen
//   batches still to send, get_screenshot calls = their screens, KB) and the batches for this run: in order, while
//   use_figma + get_screenshot calls stay within --max-calls (default 40); it stops at a batch boundary
//   (state.run.stopBefore) and warns when the whole plan needs more.
// ingest: validates a BatchResult (screen batch: README "Figma runtime"; vars batch: README "Figma variables"), copies
//   it to result-<key>.json and merges it into state.json. Malformed JSON or shape -> exit 2, state unchanged. Vars
//   batch: 'done', or 'failed' with its errors when `errors` is not empty. Screen batch: 'failed' when a screen's root
//   failed, else 'done'; per screen status 'done' (built), 'skippedEdited' (edited: true, kept by the runtime) or
//   'failed', with root, sig, extra (further frames), errors, fontMissing, unbound counts.
// check: captures the source page again (the ds run's --html / --root / --widen / --no-webfonts from its report.json;
//   flags override), rebuilds inferred / modelled / target specs (exit 2 when a target differs from spec-norm-<id>.json
//   on disk: the source changed since ds.mjs), renders the local proxies as pipeline.runScreen does, and verifies each
//   screen with the Figma readback as the built proxy (figma-check.mjs figmaProxy, mark 'figma-real'): in the modelled
//   role, or the norm role when the screen has applied norm records. Crops at A on shot-<screen>.png, rescaled to
//   device scale 2 from its own scale (png width / W_A); no screenshot -> crop skipped (screen fails). A screen with no
//   readback (pending, failed, skippedEdited) has no Figma boxes: every node unchecked. Adds per screen the Figma
//   section (proxy vs Figma, unread checks, fontMissing, unbound, errors) to report.json / report.html. --mutate: the
//   four readback mutations of mutate.mjs (FIG_KINDS); a missed one fails the run.
// shots (T8): get_screenshot caps at a node's native size (1x). shots writes shots.js: on page _vd-shots (created when
//   missing, old children removed) a clone of every built screen frame (state.json roots), rescale(2), in a row;
//   returns { page, clones: { screen: id }, sizes: { screen: [w, h] }, missing, errors }. The Screens page is not
//   changed. ingest-shots records it in state.shots and prints the get_screenshot calls (maxDimension = the clone's
//   larger side = 2 x the frame's) -> shot-<screen>.png; shots-clean writes shots-clean.js (removes the clones and the page).
// Exit codes: 0 every screen passes the gate (and no mutation missed), 1 otherwise, 2 usage / setup / malformed input.
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, readAllowlist, runVerdict } from './layout.mjs';
import { encodeScreen, planBatches, newTables, OversizeError } from './figma-encode.mjs';
import { varsPayload, varNames } from './figma-vars.mjs';
import { ordOf, decode, figmaProxy, shotAtDsf, proxyVsFigma, effectNodes } from './figma-check.mjs';

const RUNTIME = readFileSync(new URL('./figma-runtime.js', import.meta.url), 'utf8');
export const USAGE = `usage: node core/figma.mjs plan --ds <ds output dir> --out <dir> [--page Screens] [--max-calls 40] [--force <screen>]... [--redo]
       node core/figma.mjs ingest --out <dir> --result <file> [--batch vars-NN|batch-NN|N]
       node core/figma.mjs shots --out <dir> | ingest-shots --out <dir> --result <file> | shots-clean --out <dir>
       node core/figma.mjs check --out <dir> [--mutate] [--allowlist <json>] [--html <file>] [--root <sel>] [--widen <sel>]
            [--name <sel>] [--widen-by <px>] [--viewport <px>] [--no-webfonts] [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>]`;

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const pad = (n) => String(n).padStart(2, '0');
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const json = (x) => `${JSON.stringify(x, null, 1)}\n`;
const readJson = (p, what) => {
  if (!existsSync(p)) throw new UsageError(`${what || 'file'} not found: ${p}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new UsageError(`${p}: not valid JSON (${e.message})`); }
};
const figDir = (out) => join(out, 'figma');
const statePath = (out) => join(figDir(out), 'state.json');
const loadState = (out) => readJson(statePath(out), 'state.json (run figma.mjs plan first)');
const num = (name, v, def) => {
  if (v == null) return def;
  const n = Number(v);
  if (v === '' || !Number.isFinite(n) || n < 0) throw new UsageError(`--${name} needs a number >= 0 (got "${v}")`);
  return n;
};
const args = (argv, options) => {
  try { return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values; } catch (e) { throw new UsageError(e.message); }
};

// ---------------- plan ----------------
function readDs(dsDir) {
  const ds = resolve(dsDir);
  if (!existsSync(join(ds, 'ir.json'))) throw new UsageError(`${ds}: no ir.json (pass the --out folder of ds.mjs --html; in corpus mode, its <file stem> subfolder)`);
  const ir = readJson(join(ds, 'ir.json'));
  const tokens = readJson(join(ds, 'tokens.json'), 'tokens.json (ds.mjs output)');
  const map = readJson(join(ds, 'token-map.json'), 'token-map.json (ds.mjs output)');
  const screens = (ir.screens || []).map((s) => {
    const id = String(s.id ?? s.name);
    const p = join(ds, `spec-norm-${safe(id)}.json`);
    return { id, W: s.W, svgDefs: s.svgDefs || {}, spec: readJson(p, `spec-norm of screen ${id}`) };
  });
  if (!screens.length) throw new UsageError(`${ds}/ir.json has no screens`);
  const rep = existsSync(join(ds, 'report.json')) ? readJson(join(ds, 'report.json')) : null;
  const a = (rep && rep.args) || {};
  const source = a.html ? { html: resolve(a.html), root: a.root ?? ir.root, widen: a.widen ?? ir.widen ?? undefined, webFonts: a.webFonts !== false } : null;
  return { ds, ir, tokens, map, screens, source };
}

export function planAll(dsData, { page = 'Screens', force = [] } = {}) {
  const { ir, tokens, map, screens } = dsData;
  const tables = newTables(varNames(tokens));
  const encs = screens.map((s) => encodeScreen(s.spec, { screen: s.id, file: ir.file, W: s.W, map, svgDefs: s.svgDefs, tables, tokens }));
  const batches = planBatches(encs, { runtime: RUNTIME, page, force });
  const vars = varsPayload(tokens);
  return [
    ...vars.map((code, i) => ({ key: `vars-${pad(i + 1)}`, kind: 'vars', code, bytes: Buffer.byteLength(code, 'utf8'), screens: [] })),
    ...batches.map((b) => ({ key: `batch-${pad(b.n)}`, kind: 'screens', n: b.n, code: b.code, data: b.data, bytes: b.bytes, screens: b.screens })),
  ].map((b) => ({ ...b, hash: sha(b.code) }));
}

// calls of a batch: one use_figma, plus one get_screenshot per screen
const callsOf = (b) => ({ useFigma: 1, screenshot: b.kind === 'screens' ? b.screens.length : 0 });

async function plan(argv, log) {
  const o = args(argv, { ds: { type: 'string' }, out: { type: 'string' }, page: { type: 'string' }, 'max-calls': { type: 'string' }, force: { type: 'string', multiple: true }, redo: { type: 'boolean' } });
  if (!o.ds) throw new UsageError('--ds <ds.mjs output folder> is required');
  if (!o.out) throw new UsageError('--out <dir> is required');
  const maxCalls = num('max-calls', o['max-calls'], 40);
  const dsData = readDs(o.ds);
  const ids = dsData.screens.map((s) => s.id);
  const force = [...new Set((o.force || []).flatMap((f) => f.split(',')).map((f) => f.trim()).filter(Boolean))];
  for (const f of force) if (!ids.includes(f)) throw new UsageError(`--force ${f}: no such screen (screens: ${ids.join(', ')})`);
  let all;
  try { all = planAll(dsData, { page: o.page || 'Screens', force }); } catch (e) {
    if (e instanceof OversizeError) throw new UsageError(e.message);
    throw new UsageError(`cannot plan the batches: ${e.message}`);
  }
  const F = figDir(o.out);
  mkdirSync(F, { recursive: true });
  const prev = existsSync(statePath(o.out)) ? loadState(o.out) : null;
  const st = {
    version: 1, ds: dsData.ds, file: dsData.ir.file, page: o.page || 'Screens', source: dsData.source, force,
    order: [], batches: {}, screens: {}, run: null,
  };
  const changed = [];
  for (const b of all) {
    const p = prev && prev.batches && prev.batches[b.key];
    const files = { file: `${b.key}.js`, ...(b.kind === 'screens' ? { data: `${b.key}.data.json` } : {}) };
    const keep = p && p.status === 'done' && p.hash === b.hash && !o.redo && Object.values(files).every((f) => existsSync(join(F, f)));
    if (keep) st.batches[b.key] = p;
    else {
      const lastFailed = !p ? null : p.status === 'failed' ? (p.errors || []) : (p.lastFailed || null); // kept across plans until a good ingest
      writeFileSync(join(F, files.file), b.code);
      if (b.data) writeFileSync(join(F, files.data), JSON.stringify(b.data));
      if (p && p.status === 'done' && p.hash !== b.hash) changed.push(b.key);
      st.batches[b.key] = { kind: b.kind, ...(b.n ? { n: b.n } : {}), ...files, screens: b.screens, bytes: b.bytes, hash: b.hash, status: 'pending', ...(lastFailed && p.hash === b.hash ? { lastFailed } : {}) };
    }
    st.order.push(b.key);
    for (const s of b.screens) {
      const ps = prev && prev.screens && prev.screens[s];
      st.screens[s] = keep && ps ? ps : { batch: b.key, status: 'pending' };
    }
  }
  // batches of an earlier plan that no longer exist
  for (const k of Object.keys((prev && prev.batches) || {})) {
    if (st.batches[k]) continue;
    for (const f of [`${k}.js`, `${k}.data.json`]) if (existsSync(join(F, f))) rmSync(join(F, f));
  }
  // estimate and this run's budget
  const todo = st.order.filter((k) => st.batches[k].status !== 'done');
  const tot = { useFigma: 0, screenshot: 0, bytes: 0 };
  for (const k of todo) { const c = callsOf(st.batches[k]); tot.useFigma += c.useFigma; tot.screenshot += c.screenshot; tot.bytes += st.batches[k].bytes; }
  const send = [];
  let used = 0, stopBefore = null;
  for (const k of todo) {
    const c = callsOf(st.batches[k]), n = c.useFigma + c.screenshot;
    if (used + n > maxCalls) { stopBefore = k; break; }
    used += n; send.push(k);
  }
  const nv = todo.filter((k) => st.batches[k].kind === 'vars').length;
  // M6: a vars batch that failed (and is unchanged) while screen batches are still to send: their bindings would miss
  const varsFailed = st.order.filter((k) => st.batches[k].kind === 'vars' && st.batches[k].status !== 'done' && st.batches[k].lastFailed);
  const warnings = varsFailed.length && todo.some((k) => st.batches[k].kind === 'screens')
    ? [`${varsFailed.join(', ')} failed when last sent (${varsFailed.map((k) => `${st.batches[k].lastFailed.length} errors`).join(', ')}); screen batches are still scheduled and would bind to missing variables / styles: fix the cause and send ${varsFailed.join(', ')} again first`]
    : [];
  st.run = { maxCalls, ...(warnings.length ? { warnings } : {}), calls: { useFigma: tot.useFigma, screenshot: tot.screenshot, total: tot.useFigma + tot.screenshot }, kb: Math.round(tot.bytes / 100) / 10, send, sendCalls: used, stopBefore };
  writeFileSync(statePath(o.out), json(st));
  const skippedDone = st.order.length - todo.length;
  log(`plan: ${st.order.length} batches (${st.order.filter((k) => st.batches[k].kind === 'vars').length} vars, ${st.order.filter((k) => st.batches[k].kind === 'screens').length} screen), ${ids.length} screens${skippedDone ? `; ${skippedDone} already done (kept)` : ''}`);
  if (changed.length) log(`changed since they were sent: ${changed.join(', ')} (pending again)`);
  log(`estimate: ${tot.useFigma} use_figma calls (${nv} vars + ${tot.useFigma - nv} screen batches), ${tot.screenshot} get_screenshot calls, ${st.run.kb} KB to send`);
  log(`this run (--max-calls ${maxCalls}): send ${send.length ? send.join(', ') : 'nothing'} (${used} calls)${stopBefore ? `; stops before ${stopBefore}` : ''}`);
  if (tot.screenshot) log('screenshots: after the screen batches run figma.mjs shots --out <dir> (2x clones on page _vd-shots, then ingest-shots and shots-clean: 2 more use_figma calls; README "Figma CLI" step 3)');
  for (const w of warnings) log(`warning: ${w}`);
  if (tot.useFigma + tot.screenshot > maxCalls) log(`warning: the plan needs ${tot.useFigma + tot.screenshot} calls, over --max-calls ${maxCalls}: after this run, ingest the results and run plan again to continue`);
  return 0;
}

// ---------------- ingest ----------------
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v));
const isArr = (x) => Array.isArray(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function validateScreenBatch(res, entry, D) {
  const bad = [];
  if (!isObj(res)) return ['not an object'];
  if (res.batch !== entry.n) bad.push(`batch is ${JSON.stringify(res.batch)}, expected ${entry.n}`);
  if (typeof res.page !== 'string') bad.push('page is not a string');
  if (!isArr(res.screens)) return [...bad, 'screens is not an array'];
  const seen = new Set();
  for (const [i, s] of res.screens.entries()) {
    const at = `screens[${i}]`;
    if (!isObj(s) || typeof s.screen !== 'string') { bad.push(`${at}: no screen id`); continue; }
    if (!entry.screens.includes(s.screen)) { bad.push(`${at}: screen ${s.screen} is not in ${entry.file}`); continue; }
    if (seen.has(s.screen)) bad.push(`${at}: screen ${s.screen} twice`);
    seen.add(s.screen);
    if (s.extra !== undefined && !(isArr(s.extra) && s.extra.every((x) => typeof x === 'string'))) bad.push(`${at}: extra is not a list of ids`);
    if (s.edited === true) {
      if (typeof s.root !== 'string' || typeof s.sig !== 'string') bad.push(`${at}: an edited screen needs root and sig`);
      continue;
    }
    if (!isArr(s.fontMissing)) bad.push(`${at}: fontMissing is not an array`);
    if (!isArr(s.errors) || !s.errors.every((x) => isObj(x) && typeof x.o === 'string')) bad.push(`${at}: errors is not a list of { o, msg }`);
    if (s.root === undefined) continue; // root failed
    if (typeof s.root !== 'string') { bad.push(`${at}: root is not an id`); continue; }
    if (typeof s.sig !== 'string') bad.push(`${at}: sig is missing`);
    if (s.unbound !== undefined && !isArr(s.unbound)) bad.push(`${at}: unbound is not an array`);
    if (s.unsupported !== undefined && !isObj(s.unsupported)) bad.push(`${at}: unsupported is not an object`);
    const T = D.screens.find((x) => x.screen === s.screen).T, n = ordOf(T).length;
    if (!isArr(s.nodes)) { bad.push(`${at}: nodes is not an array`); continue; }
    if (s.nodes.length !== n) bad.push(`${at}: nodes has ${s.nodes.length} entries, the encoding has ${n}`);
    s.nodes.forEach((t, j) => {
      if (t === 0) return;
      const ok = isArr(t) && t.length >= 2 && t.length <= 4 && (typeof t[0] === 'number' || typeof t[0] === 'string') && isBox(t[1]) &&
        (t.length < 3 || t[2] === 0 || isBox(t[2])) && (t.length < 4 || isObj(t[3]));
      if (!ok) bad.push(`${at}.nodes[${j}]: not 0 or [fid, A, dB?, d?]`);
    });
  }
  for (const s of entry.screens) if (!seen.has(s)) bad.push(`screen ${s} of ${entry.file} is missing`);
  return bad;
}

export function validateVarsBatch(res, entry, index) {
  const bad = [];
  if (!isObj(res)) return ['not an object'];
  if (res.batch !== index) bad.push(`batch is ${JSON.stringify(res.batch)}, expected ${index} (vars batches count from 0)`);
  for (const k of ['collections', 'variables', 'textStyles', 'effectStyles']) if (!isObj(res[k])) bad.push(`${k} is not an object`);
  if (!isArr(res.errors)) bad.push('errors is not an array');
  else res.errors.forEach((x, i) => { if (!isObj(x) || typeof x.msg !== 'string' || (x.kind !== undefined && typeof x.kind !== 'string') || (x.name !== undefined && typeof x.name !== 'string')) bad.push(`errors[${i}]: not { msg, kind?, name? }`); });
  if (!isArr(res.fontMissing)) bad.push('fontMissing is not an array');
  else res.fontMissing.forEach((x, i) => { if (!isObj(x)) bad.push(`fontMissing[${i}]: not an object`); });
  return bad;
}

const keyOf = (st, res, given) => {
  if (given != null) {
    const g = String(given);
    const k = /^\d+$/.test(g) ? `batch-${pad(+g)}` : g;
    if (!st.batches[k]) throw new UsageError(`--batch ${g}: no such batch (${st.order.join(', ')})`);
    return k;
  }
  if (isObj(res) && isArr(res.screens) && Number.isInteger(res.batch)) return `batch-${pad(res.batch)}`;
  if (isObj(res) && isObj(res.collections) && Number.isInteger(res.batch)) return `vars-${pad(res.batch + 1)}`;
  throw new UsageError('cannot tell which batch this result belongs to (no batch number); pass --batch');
};

async function ingest(argv, log) {
  const o = args(argv, { out: { type: 'string' }, result: { type: 'string' }, batch: { type: 'string' } });
  if (!o.out) throw new UsageError('--out <dir> is required');
  if (!o.result) throw new UsageError('--result <file> is required');
  const st = loadState(o.out), F = figDir(o.out);
  const res = readJson(resolve(o.result), 'result file');
  const key = keyOf(st, res, o.batch);
  const b = st.batches[key];
  if (!b) throw new UsageError(`${key}: not in the plan (${st.order.join(', ')})`);
  const D = b.kind === 'screens' ? readJson(join(F, b.data), `data of ${key}`) : null;
  const bad = b.kind === 'screens' ? validateScreenBatch(res, b, D) : validateVarsBatch(res, b, st.order.filter((k) => st.batches[k].kind === 'vars').indexOf(key));
  if (bad.length) throw new UsageError(`${o.result} is not a valid result of ${key}:\n  ${bad.slice(0, 20).join('\n  ')}${bad.length > 20 ? `\n  ... ${bad.length - 20} more` : ''}`);
  const file = `result-${key}.json`;
  copyFileSync(resolve(o.result), join(F, file));
  if (b.kind === 'vars') {
    b.status = res.errors.length ? 'failed' : 'done';
    b.result = file;
    if (res.errors.length) b.errors = res.errors; else { delete b.errors; delete b.lastFailed; }
    b.fontMissing = res.fontMissing.length;
    log(`${key}: ${b.status}${res.errors.length ? ` (${res.errors.length} errors: ${res.errors.slice(0, 3).map((x) => [x.kind, x.name].filter((v) => v != null).join(' ') + (x.kind != null || x.name != null ? ': ' : '') + x.msg).join('; ')})` : ''}`);
  } else {
    let failed = 0;
    for (const s of res.screens) {
      const rec = { batch: key, result: file };
      if (s.extra && s.extra.length) rec.extra = s.extra;
      if (s.edited === true) Object.assign(rec, { status: 'skippedEdited', root: s.root, sig: s.sig, edited: true, skippedEdited: true });
      else if (s.root === undefined) { failed++; Object.assign(rec, { status: 'failed', errors: s.errors, fontMissing: s.fontMissing.length }); }
      else {
        const unbound = {};
        for (const u of s.unbound || []) unbound[u.reason] = (unbound[u.reason] || 0) + 1;
        Object.assign(rec, { status: 'done', root: s.root, sig: s.sig, errors: s.errors.length, fontMissing: s.fontMissing.length, unbound });
      }
      st.screens[s.screen] = rec;
    }
    b.status = failed ? 'failed' : 'done';
    b.result = file;
    const by = (k) => res.screens.filter((s) => st.screens[s.screen].status === k).map((s) => s.screen);
    log(`${key}: ${b.status}; built ${by('done').join(', ') || 'none'}${by('skippedEdited').length ? `; edited by hand, kept (skippedEdited): ${by('skippedEdited').join(', ')}` : ''}${failed ? `; failed: ${by('failed').join(', ')}` : ''}`);
  }
  writeFileSync(statePath(o.out), json(st));
  return 0;
}

// ---------------- shots (2x screenshots, T8) ----------------
// get_screenshot caps at a node's native size, so a screen frame shoots at 1x. shots.js clones every built frame onto
// the page _vd-shots (the clone is created next to its original, then moved: the Screens page ends as it was), rescales
// the clone 2x and lines the clones up in a row; the AI shoots each clone, then shots-clean.js removes them.
export const SHOTS_PAGE = '_vd-shots';
export function shotsPayload(screens, { page = SHOTS_PAGE, scale = 2, gap = 80 } = {}) {
  const D = { page, scale, gap, screens };
  return `// vuong-design 2x screenshots (figma.mjs shots): rescaled clones of the screen frames on their own page
const D = ${JSON.stringify(D)};
const F = figma;
let pg = F.root.children.find((p) => p.name === D.page);
if (!pg) { pg = F.createPage(); pg.name = D.page; }
if (pg.loadAsync) await pg.loadAsync();
for (const c of [...pg.children]) c.remove();
const out = { page: pg.id, clones: {}, sizes: {}, missing: [], errors: [] };
let x = 0;
for (const s of D.screens) {
  try {
    const n = await F.getNodeByIdAsync(s.root);
    if (!n || n.removed) { out.missing.push(s.screen); continue; }
    const c = n.clone();
    pg.appendChild(c);
    c.rescale(D.scale);
    c.x = x; c.y = 0; x += c.width + D.gap;
    out.clones[s.screen] = c.id;
    out.sizes[s.screen] = [Math.round(c.width * 100) / 100, Math.round(c.height * 100) / 100];
  } catch (e) { out.errors.push({ screen: s.screen, msg: String((e && e.message) || e).slice(0, 200) }); }
}
return out;
`;
}
export function shotsCleanPayload({ page = SHOTS_PAGE } = {}) {
  return `// vuong-design: remove the screenshot clones (figma.mjs shots-clean)
const D = ${JSON.stringify({ page })};
const F = figma, pg = F.root.children.find((p) => p.name === D.page);
if (!pg) return { page: null, removed: 0, pageRemoved: false };
if (pg.loadAsync) await pg.loadAsync();
const id = pg.id, n = pg.children.length;
for (const c of [...pg.children]) c.remove();
let pageRemoved = false;
if (F.currentPage !== pg && F.root.children.length > 1) { pg.remove(); pageRemoved = true; }
return { page: id, removed: n, pageRemoved };
`;
}

async function shots(argv, log) {
  const o = args(argv, { out: { type: 'string' } });
  if (!o.out) throw new UsageError('--out <dir> is required');
  const st = loadState(o.out), F = figDir(o.out);
  const list = Object.entries(st.screens).filter(([, s]) => s.status === 'done' && s.root).map(([screen, s]) => ({ screen, root: s.root }));
  if (!list.length) throw new UsageError('no built screen in state.json (send and ingest the screen batches first)');
  writeFileSync(join(F, 'shots.js'), shotsPayload(list));
  log(`shots: ${join(F, 'shots.js')} clones ${list.length} screen frames (${list.map((s) => s.screen).join(', ')}) at 2x onto page ${SHOTS_PAGE}`);
  log('next: send it with use_figma, save the result, run figma.mjs ingest-shots --out <dir> --result <file>');
  return 0;
}

async function ingestShots(argv, log) {
  const o = args(argv, { out: { type: 'string' }, result: { type: 'string' } });
  if (!o.out) throw new UsageError('--out <dir> is required');
  if (!o.result) throw new UsageError('--result <file> is required');
  const st = loadState(o.out), F = figDir(o.out);
  const res = readJson(resolve(o.result), 'shots result');
  const bad = [];
  if (!isObj(res)) bad.push('not an object');
  else {
    if (typeof res.page !== 'string') bad.push('page is not a string');
    if (!isObj(res.clones)) bad.push('clones is not an object');
    else for (const [s, id] of Object.entries(res.clones)) {
      if (!st.screens[s]) bad.push(`clones.${s}: no such screen`);
      if (typeof id !== 'string') bad.push(`clones.${s}: not a node id`);
    }
    if (res.sizes !== undefined && !(isObj(res.sizes) && Object.values(res.sizes).every((v) => isArr(v) && v.length === 2 && v.every((x) => typeof x === 'number')))) bad.push('sizes is not { screen: [w, h] }');
  }
  if (bad.length) throw new UsageError(`${o.result} is not a valid shots result:\n  ${bad.join('\n  ')}`);
  copyFileSync(resolve(o.result), join(F, 'result-shots.json'));
  st.shots = { page: res.page, clones: res.clones, ...(res.sizes ? { sizes: res.sizes } : {}), ...(res.missing && res.missing.length ? { missing: res.missing } : {}) };
  writeFileSync(statePath(o.out), json(st));
  for (const [s, id] of Object.entries(res.clones)) {
    const z = res.sizes && res.sizes[s];
    log(`  ${s}: get_screenshot nodeId ${id}${z ? ` maxDimension ${Math.ceil(Math.max(...z))}` : ' maxDimension = the clone\'s larger side'} -> ${join(F, `shot-${safe(s)}.png`)}`);
  }
  if (res.missing && res.missing.length) log(`missing frames (not cloned): ${res.missing.join(', ')}`);
  log('then: run figma.mjs shots-clean --out <dir> and send shots-clean.js with use_figma');
  return 0;
}

async function shotsClean(argv, log) {
  const o = args(argv, { out: { type: 'string' } });
  if (!o.out) throw new UsageError('--out <dir> is required');
  loadState(o.out);
  const p = join(figDir(o.out), 'shots-clean.js');
  writeFileSync(p, shotsCleanPayload());
  log(`shots-clean: ${p} removes the clones on page ${SHOTS_PAGE} (and the page)`);
  return 0;
}

// ---------------- check ----------------
const CHECK_OPTS = {
  out: { type: 'string' }, mutate: { type: 'boolean' }, allowlist: { type: 'string' }, html: { type: 'string' }, root: { type: 'string' },
  widen: { type: 'string' }, name: { type: 'string' }, 'widen-by': { type: 'string' }, viewport: { type: 'string' }, 'no-webfonts': { type: 'boolean' },
  'tol-frame': { type: 'string' }, 'tol-text': { type: 'string' }, 'tol-model': { type: 'string' },
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// what check needs from the ds folder and the plan, per screen
function checkInputs(st, F) {
  const ds = st.ds;
  const ir = readJson(join(ds, 'ir.json'));
  const nj = existsSync(join(ds, 'normalisation.json')) ? readJson(join(ds, 'normalisation.json')) : { entries: [] };
  const screens = (ir.screens || []).map((s) => {
    const id = String(s.id ?? s.name), p = join(ds, `spec-norm-${safe(id)}.json`);
    if (!existsSync(p)) throw new UsageError(`spec-norm of screen ${id} not found: ${p}`);
    const ss = st.screens[id] || { status: 'pending' };
    let sres = null, D = null;
    if (ss.result && ss.status !== 'pending' && st.batches[ss.batch]) {
      const res = readJson(join(F, ss.result));
      sres = (res.screens || []).find((x) => x.screen === id) || null;
      D = readJson(join(F, st.batches[ss.batch].data));
    }
    const shot = join(F, `shot-${safe(id)}.png`);
    return { id, specText: readFileSync(p, 'utf8'), state: ss, sres, D, shot: existsSync(shot) ? shot : null };
  });
  return { ir, entries: nj.entries || [], screens };
}

// The local side of one screen, as pipeline.runScreen renders it: inferred, modelled and target specs (applyNorm of the
// ds entries), the layout and modelled proxies, and with applied records the norm proxy (mark 'norm') and the norm
// layout proxy (records replayed on the inferred spec, mark 'normLayout').
export async function localScreen(browser, sc, { id, fontMap, webFonts = true, entries = [] }) {
  const { inferScreen } = await import('./infer.mjs');
  const { applyFigmaModel } = await import('./figma-model.mjs');
  const { applyNorm } = await import('./apply-norm.mjs');
  const { buildProxyHtml, renderProxy } = await import('./proxy.mjs');
  const { replayApplied } = await import('./pipeline.mjs');
  const inferred = inferScreen(sc);
  const modelled = applyFigmaModel(inferred.spec, fontMap, { rendered: sc.fontsRendered });
  const target = applyNorm(modelled.spec, entries, id);
  const normOn = Array.isArray(target.applied) && target.applied.length > 0;
  const fc = sc.fontCss || {};
  const po = { fontLinks: fc.links || [], fontFaces: fc.faces || [], ...(webFonts ? {} : { webFonts: false }) };
  const at = (sp, i) => renderProxy(browser, buildProxyHtml(sp, sc.svgDefs || {}, fontMap, po), sc.W[i], { origin: sc.origin[i] });
  const two = async (sp, mark) => { const A = await at(sp, 0), B = await at(sp, 1); return mark ? { A: { ...A, mark }, B: { ...B, mark } } : { A, B }; };
  const layout = await two(inferred.spec), modP = await two(modelled.spec);
  let normP = null, normLayout = null, normLayoutError = null;
  if (normOn) {
    normP = await two(target.spec, 'norm');
    try { normLayout = await two(replayApplied(inferred.spec, target.applied), 'normLayout'); } catch (e) { normLayoutError = e.message; }
  }
  return { inferred, modelled, target, normOn, layout, modP, normP, normLayout, normLayoutError };
}

async function check(argv, log, deps) {
  const o = args(argv, CHECK_OPTS);
  if (!o.out) throw new UsageError('--out <dir> is required');
  const st = loadState(o.out), F = figDir(o.out);
  const verifyOpts = {};
  for (const [k, n] of [['tol-frame', 'tolFrame'], ['tol-text', 'tolText'], ['tol-model', 'tolModel']]) { const v = num(k, o[k]); if (v != null) verifyOpts[n] = v; }
  const src = { ...(st.source || {}) };
  if (o.html) src.html = resolve(o.html);
  if (o.root) src.root = o.root;
  if (o.widen) src.widen = o.widen;
  if (o['no-webfonts']) src.webFonts = false;
  if (!src.html) throw new UsageError('the source page is unknown (no html in the ds report.json): pass --html <file> --root <sel>');
  if (!existsSync(src.html)) throw new UsageError(`HTML file not found: ${src.html} (pass --html)`);
  if (!src.root) throw new UsageError('--root <selector> is required (not in the ds report.json)');
  const widenBy = num('widen-by', o['widen-by']), viewport = num('viewport', o.viewport);
  const allowlist = o.allowlist ? readAllowlist(o.allowlist) : [];
  const inp = checkInputs(st, F);
  const webFonts = src.webFonts !== false;

  const { captureScreens } = await import('./capture.mjs');
  const { verifyScreen, measureCrops } = await import('./verify.mjs');
  const { pixelDiff } = await import('./imgdiff.mjs');
  const { gate, summarize, specJson, allowlistEntry } = await import('./pipeline.mjs');
  const { defaultFontMap } = await import('./font-map.mjs');
  const { runFigMutations } = await import('./mutate.mjs');
  const fontMap = deps.fontMap || defaultFontMap();
  const t0 = Date.now();
  let browser = deps.browser, own = false;
  try {
    if (!browser) { const { launchBrowser } = await import('./browser.mjs'); browser = await launchBrowser(); own = true; }
  } catch (e) { throw new UsageError(e.message); }
  try {
    log(`${inp.ir.file}: capturing ${src.root}`);
    let cap;
    try { ({ screens: cap } = await captureScreens(src.html, { root: src.root, widen: src.widen, nameOf: o.name, widenBy, viewport, png: true, fontMap, webFonts })); } catch (e) { throw new UsageError(`capture of ${src.html} failed: ${e.message}`); }
    const capById = new Map(cap.map((s) => [String(s.id ?? s.name), s]));
    const missing = inp.screens.filter((x) => !capById.has(x.id)).map((x) => x.id);
    if (missing.length) throw new UsageError(`screens ${missing.join(', ')} are not in the captured page any more (same --root / --name as the ds run?)`);
    const screensOut = [], views = [];
    const { screenView, renderReportHtml } = await import('./report-html.mjs');
    for (const x of inp.screens) {
      const sc = capById.get(x.id);
      const { inferred, modelled, target, normOn, layout, modP, normP, normLayout, normLayoutError } = await localScreen(browser, sc, { id: x.id, fontMap, webFonts, entries: inp.entries });
      if (specJson(target.spec) !== x.specText) throw new UsageError(`screen ${x.id}: the target spec rebuilt from the page differs from spec-norm-${safe(x.id)}.json: the source changed since ds.mjs ran; run ds.mjs and figma.mjs plan again`);
      // the Figma readback and screenshot
      const sres = x.sres && x.sres.nodes ? x.sres : null;
      let shot = null;
      if (x.shot) shot = await shotAtDsf(browser, readFileSync(x.shot), sc.W[0]);
      const build = (s) => figmaProxy(s ? decode({ screens: [clone(s)] }, x.D).screens[0] : null, x.D, target.spec, { png: shot ? shot.png : null });
      const fig = build(sres);
      let crops;
      if (shot) crops = await measureCrops(browser, sc, fig, { ...verifyOpts, widths: ['A'] });
      const pixel = [shot ? await pixelDiff(browser, sc.png[0], shot.png) : null, null];
      const flags = [...(inferred.flags || []), ...modelled.flags];
      const extra = {};
      if (normOn && normLayout && crops) {
        const ratio = verifyOpts.cropRatio ?? 0.05, peak = verifyOpts.cropPeak ?? 40;
        const ids = [...new Set(crops.filter((c) => c.ratio > ratio || (c.peak ?? 0) >= peak).map((c) => c.id))];
        extra.cropsLayout = ids.length ? await measureCrops(browser, sc, layout, { ...verifyOpts, ids, widths: ['A'] }) : [];
        extra.cropsNormVsLayout = ids.length ? await measureCrops(browser, sc, normLayout, { ...verifyOpts, ids, base: layout, widths: ['A'] }) : [];
      }
      const input = (figP) => (normOn
        ? { screen: sc, spec: modelled.spec, proxy: modP, layout, flags, norm: { spec: target.spec, applied: target.applied, proxy: figP, entries: inp.entries }, normLayout, crops, pixel, ...extra }
        : { screen: sc, spec: modelled.spec, proxy: figP, layout, flags, crops, pixel });
      const report = verifyScreen(input(fig), verifyOpts);
      if (normLayoutError) report.normLayoutError = normLayoutError;
      let mutations = null;
      if (o.mutate) {
        mutations = await runFigMutations({ id: x.id, base: report, screen: sres, D: x.D, tree: sc.tree, spec: target.spec, run: async (m) => verifyScreen(input(build(m)), verifyOpts) });
      }
      const ids = [];
      const walk = (n) => { ids.push(n.id); (n.kids || []).forEach(walk); };
      walk(sc.tree);
      const ss = x.state;
      const figma = {
        status: ss.status, batch: ss.batch || null, root: ss.root || null, ...(ss.edited ? { edited: true, skippedEdited: true } : {}), ...(ss.extra ? { extra: ss.extra } : {}),
        role: normOn ? 'norm' : 'modelled',
        readback: sres ? { nodes: sres.nodes.length, missing: sres.nodes.filter((t) => t === 0).length } : null,
        fontMissing: (x.sres && x.sres.fontMissing) || [], errors: (x.sres && x.sres.errors) || [], unbound: (x.sres && x.sres.unbound) || [],
        unsupported: Object.keys((x.sres && x.sres.unsupported) || {}),
        shot: shot ? { file: `shot-${safe(x.id)}.png`, scale: Math.round(shot.scale * 1000) / 1000, rescaled: shot.rescaled } : null,
        unread: fig.unread,
        effectsNotRead: (() => { const ns = effectNodes(sc.tree); return { count: ns.length, nodes: ns }; })(),
        proxyVsFigma: { ref: normOn ? 'norm' : 'modelled', ...proxyVsFigma(normOn ? normP : modP, fig, ids) },
      };
      const entry = { screen: sc, inferred, modelled, report, proxy: normOn ? modP : fig, layout, norm: normOn ? fig : null, normLayout, figma: fig, ...(mutations ? { mutations } : {}) };
      const where = { file: inp.ir.file, screen: x.id, tree: sc.tree };
      const g = gate(report, allowlist, where);
      const summary = summarize(inp.ir.file, entry, g);
      const allowlistDraft = [...g.open.roots.map((r) => allowlistEntry('root', r, where)), ...g.open.approvals.map((r) => allowlistEntry('approval', r, where)),
        ...g.open.crops.map((r) => allowlistEntry('crop', r, where))];
      screensOut.push({ summary, gate: g, report, flags: report.flags, allowlistDraft, figma, ...(mutations ? { mutations } : {}) });
      const v = await screenView(browser, inp.ir.file, entry, g, summary, { crop: 'figma', approval: 'figma', label: 'Figma' });
      views.push({ ...v, figma });
      log(`  ${x.id}: ${summary.pass ? 'pass' : 'fail'}${sres ? '' : ` (no readback: ${ss.status})`}${shot ? '' : ' (no screenshot)'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
    const { pass, missed } = runVerdict(screensOut);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const a = { out: o.out, html: src.html, root: src.root, webFonts, tol: verifyOpts, mutate: !!o.mutate, allowlistApproved: allowlist.filter((e) => e && e.approved === true).length };
    writeFileSync(join(F, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), seconds, args: a, pass, ...(o.mutate ? { mutationsMissed: missed } : {}), screens: screensOut }, null, 1));
    writeFileSync(join(F, 'report.html'), renderReportHtml({ title: 'vuong-design check on real Figma', generated: `${new Date().toISOString()} · ${seconds} s`, args: a, screens: views }));
    const failed = screensOut.filter((s) => !s.summary.pass).length;
    log(`${screensOut.length - failed}/${screensOut.length} screens pass on Figma in ${seconds} s; report: ${join(F, 'report.html')}`);
    if (missed.length) log(`the mutation check missed ${missed.length} planted error${missed.length === 1 ? '' : 's'} (${missed.join(', ')}): the verifier cannot be trusted; exit 1`);
    return pass ? 0 : 1;
  } finally {
    if (own && browser) await browser.close();
  }
}

export async function main(argv, deps = {}) {
  const log = deps.log || ((m) => process.stderr.write(`${m}\n`));
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'plan') return await plan(rest, log);
    if (cmd === 'ingest') return await ingest(rest, log);
    if (cmd === 'check') return await check(rest, log, deps);
    if (cmd === 'shots') return await shots(rest, log);
    if (cmd === 'ingest-shots') return await ingestShots(rest, log);
    if (cmd === 'shots-clean') return await shotsClean(rest, log);
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') { log(USAGE); return 0; }
    throw new UsageError(cmd ? `unknown command ${cmd}` : 'a command is required (plan, ingest, shots, ingest-shots, shots-clean, check)');
  } catch (e) {
    if (e instanceof UsageError) { log(`error: ${e.message}\n${USAGE}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
