#!/usr/bin/env node
// Figma CLI (plan 3 Task 7). The script never calls Figma: it prepares `use_figma` calls, takes their results back, and
// verifies the real Figma screens with the plan 1-2 verifier (README "Figma CLI").
//
//   node core/figma.mjs plan   --ds <ds.mjs output folder> --out <dir> [--page Screens] [--max-calls 40] [--force <screen>]... [--redo] [--prof] [--no-components] [--cmp-page Components]
//   node core/figma.mjs ingest --out <dir> --result <file> [--batch vars-NN | batch-NN | N]
//   node core/figma.mjs shots --out <dir>; ingest-shots --out <dir> --result <file>; shots-clean --out <dir>
//   node core/figma.mjs serve  --out <dir> [--file <Figma file name> [--renamed]] [--send <keys>|run|pending]... [--shots] [--port 8787] [--wait <s>]
//   node core/figma.mjs check  --out <dir> [--mutate] [--allowlist <json>] [--html <file>] [--root <sel>] [--widen <sel>]
//        [--name <sel>] [--widen-by <px>] [--viewport <px>] [--no-webfonts] [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--tol-text-round <px>]
//
// Everything is written to <out>/figma/ (README "Figma CLI" has the file table):
//   vars-NN.js (figma-vars.mjs varsPayload, in order), batch-NN.js (planBatches code: runtime + data) and batch-NN.data.json
//   (its data D, for check), state.json, result-<key>.json (ingested results), shot-<screen>.png (saved by the AI),
//   report.json, report.html.
// plan: encodes every screen of the ds output (spec-norm-<id>.json, token-map.json, tokens.json, ir.json svgDefs / W)
//   and writes the batches; vars batches first. A batch already 'done' with the same code is kept as is (not written
//   again) unless --redo; numbering is stable for the same input (screen batches 1.., vars batches 1.. in file names;
//   a vars result carries its 0-based `batch`). --force <screen> (repeatable or comma-separated) puts the screen in
//   D.force: the runtime rebuilds it even when edited by hand. --prof sets D.prof in the screen batches: the runtime returns
//   prof, ms per phase summed over the batch (ingest prints it and keeps it in state.batches[key].prof). Prints the estimate (use_figma calls = vars + screen
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
// serve (Figma bridge): sends the named batches (--send: comma-separated keys such as runtime,batch-01; `run` = the
//   plan's this-run list; `pending` = every batch not done) through the local Figma Desktop plugin (figma-plugin/,
//   figma-bridge.mjs) instead of use_figma, in plan order, and ingests each result as it arrives (the same checks as
//   ingest). --shots then exports every built screen frame at 2x (PNG, the frame's own bounds) to shot-<screen>.png, with
//   no clone page. The first failed job stops the run. Appends the run's timings and bytes to runs.jsonl. Nothing is
//   sent without --send or --shots. Exit 0 all jobs ok, 1 a job failed, 2 usage / no plugin connected.
//   Target file: jobs go only to a plugin open in the Figma file named --file (two plugin windows in files of that name
//   stop the run). The first run that reaches the plugin records the name in state.json (figmaFile); later runs use it
//   and refuse another --file (the plan's state is that file's), unless --renamed says the same file has a new name.
// Exit codes: 0 every screen passes the gate (and no mutation missed), 1 otherwise, 2 usage / setup / malformed input.
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, readAllowlist, runVerdict } from './layout.mjs';
import { encodeScreen, planBatches, newTables, OversizeError, batchData, compactIds, jsLiteral, fnv } from './figma-encode.mjs';
import { varsPayload, varNames, varsPlan } from './figma-vars.mjs';
import { ordOf, decode, expandNodes, figmaProxy, shotAtDsf, proxyVsFigma, effectNodes, pngSize } from './figma-check.mjs';
import { startBridge, BRIDGE_PORT } from './figma-bridge.mjs';
import { cmpEncode } from './figma-cmp.mjs';
import { stateTokens } from './states.mjs';

const RUNTIME = readFileSync(new URL('./figma-runtime.js', import.meta.url), 'utf8');
const shaOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
// The runtime is installed once in the file (runtime.js: figma.root shared plugin data NS / rt, version in rtv). A screen
// batch is its data D plus a loader that checks the installed version and D's hash, runs the installed runtime with D
// and adds the result hash h (resultHash). README "Figma CLI".
// installed without the comment lines (fewer characters to send)
const RT_BODY = RUNTIME.replace(/\r\n/g, '\n').replace('const D = __DATA__;\n', '').replace(/^[ \t]*\/\/.*\n/gm, '');
export const RUNTIME_VERSION = shaOf(RT_BODY).slice(0, 12);
const NS = 'vuongdesign';
const FNV_JS = 'h=s=>{let x=2166136261;for(let i=0;i<s.length;i++)x=Math.imul(x^s.charCodeAt(i),16777619);return(x>>>0).toString(36)}';
export const runtimeInstallCode = () => `const B=${JSON.stringify(RT_BODY)};
figma.root.setSharedPluginData('${NS}','rt',B);figma.root.setSharedPluginData('${NS}','rtv','${RUNTIME_VERSION}');
return{runtime:'${RUNTIME_VERSION}',bytes:B.length};
`;
// The component runtime (plan 3b Task 6) is installed the same way (rtc / rtcv). A batch that uses components (D.K: a
// screen batch with instances, D.cm: a component batch) runs the screen runtime with CMP_PATCHES applied: each anchor
// must be in the installed runtime exactly once (1 = insert the component runtime before the anchor). A batch without
// components gets the plan 3 loader, byte for byte.
const RUNTIME_CMP = readFileSync(new URL('./figma-runtime-cmp.js', import.meta.url), 'utf8');
const RTC_BODY = RUNTIME_CMP.replace(/\r\n/g, '\n').replace(/^[ \t]*\/\/.*\n/gm, '');
export const RUNTIME_CMP_VERSION = shaOf(RTC_BODY).slice(0, 12);
export const CMP_PATCHES = [
  ['mk=async(e,par,sc)=>{', 'mk=async(e,par,sc)=>{if(e.i!=U)return XI(e,par,sc);'],
  ['root=S.root=await mk(sc.T,null,sc)', 'root=S.root=await CV(await mk(sc.T,null,sc),sc)'],
  ['for(const sc of D.screens){S=', 1],
  ["if(PR){pt('total',T0)", "await PO();if(PR){pt('total',T0)"],
  ['root.x=x;root.y=y;', 'root.x=x;root.y=y;if(XLP[0]){const q=XLP[0];XLP[0]=0;await XD(q)}'],
  // a component root is auto layout too: its late children (state overlays, badges) go ABSOLUTE in it
  ["isAL=n=>!!n&&n.type=='FRAME'&&", "isAL=n=>!!n&&(n.type=='FRAME'||n.type=='COMPONENT')&&"],
  ['const d=read(n,e,ov)', 'const d=await XK(n,e,read(n,e,ov))'],
];
export const runtimeCmpInstallCode = () => `const B=${JSON.stringify(RTC_BODY)};
figma.root.setSharedPluginData('${NS}','rtc',B);figma.root.setSharedPluginData('${NS}','rtcv','${RUNTIME_CMP_VERSION}');
return{runtime:'${RUNTIME_CMP_VERSION}',bytes:B.length,rtc:1};
`;
export function loaderCode(D) {
  const C = compactIds(D);
  const cmp = !!(D.K || D.cm);
  return `const D=${jsLiteral(C)};
const R=figma.root,G=k=>R.getSharedPluginData('${NS}',k),${FNV_JS};
if(G('rtv')!='${RUNTIME_VERSION}')return{batch:D.batch,stale:'${RUNTIME_VERSION}',have:G('rtv')};
${cmp ? `if(G('rtcv')!='${RUNTIME_CMP_VERSION}')return{batch:D.batch,stale:'${RUNTIME_CMP_VERSION}',have:G('rtcv'),rtc:1};
` : ''}if(h(JSON.stringify(D))!='${fnv(JSON.stringify(C))}')return{batch:D.batch,damaged:1};
${cmp ? `let B=G('rt');for(const[a,b]of${JSON.stringify(CMP_PATCHES)}){const s=B.split(a);if(s.length!=2)return{batch:D.batch,damaged:1,anchor:a};B=s.join(b==1?G('rtc')+a:b)}
` : ''}const out=await new(Object.getPrototypeOf(async function(){}).constructor)('D','figma',${cmp ? 'B' : "G('rt')"})(D,figma);
out.h=h(JSON.stringify(out));return out;
`;
}
// the hash the loader adds to a screen batch result (over the result without h, in its key order)
export const resultHash = (res) => { const { h, ...r } = res; return fnv(JSON.stringify(r)); };
export const USAGE = `usage: node core/figma.mjs plan --ds <ds output dir> --out <dir> [--page Screens] [--max-calls 40] [--force <screen>]... [--redo] [--prof] [--no-components] [--cmp-page Components]
       node core/figma.mjs ingest --out <dir> --result <file> [--batch vars-NN|batch-NN|N]
       node core/figma.mjs shots --out <dir> | ingest-shots --out <dir> --result <file> | shots-clean --out <dir>
       node core/figma.mjs serve --out <dir> [--file <Figma file name> [--renamed]] [--send <keys>|run|pending]... [--shots] [--port 8787] [--wait <s>]
       node core/figma.mjs check --out <dir> [--mutate] [--allowlist <json>] [--html <file>] [--root <sel>] [--widen <sel>]
            [--name <sel>] [--widen-by <px>] [--viewport <px>] [--no-webfonts] [--tol-frame <px>] [--tol-text <px>] [--tol-model <px>] [--tol-text-round <px>]`;

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

// states.json -> dsData.states, and its approved rules' number tokens added to dsData.tokens (group `state`)
export function withStateTokens(dsData, states) {
  dsData.states = states;
  const add = stateTokens(states);
  if (add.state) {
    if (dsData.tokens.state) throw new UsageError('tokens.json already has a group "state"; the state variables need that name');
    dsData.tokens = { ...dsData.tokens, ...add };
  }
  return dsData;
}

// encodes every screen; hash per screen = its data alone (tables resolved), page and force included
// components (plan 3b Task 6): dsData.components (components.json) marks the occurrences as instances and adds the
// component batch items (figma-cmp.mjs); a screen's hash then covers the component items it uses.
export function encodeAll(dsData, { page = 'Screens', force = [], cmpPage = 'Components' } = {}) {
  const { ir, tokens, map, screens } = dsData;
  const tables = newTables(varNames(tokens));
  const styleTc = new Map(varsPlan(tokens).textStyles.map((t) => [t.name, t.tc]));
  const encs = screens.map((s) => encodeScreen(s.spec, { screen: s.id, file: ir.file, W: s.W, map, svgDefs: s.svgDefs, tables, tokens, styleTc }));
  let cmp = null;
  if (dsData.components && (dsData.components.components || []).length) {
    cmp = cmpEncode(dsData.components, screens, { file: ir.file, map, tables, tokens, styleTc, states: dsData.states });
    for (const e of encs) cmp.mark(e);
  }
  const itemHash = cmp ? new Map(cmp.items.map((x) => [tables.K[x.cm.k], sha(JSON.stringify(batchData([x], 0, cmpPage, [], false, { cm: 1 })))])) : null;
  const hashes = Object.fromEntries(encs.map((e) => {
    const base = JSON.stringify(batchData([e], 0, page, force, false, cmp ? { cp: cmpPage } : undefined));
    const u = cmp ? cmp.used(e) : [];
    return [e.screen, sha(u.length ? base + JSON.stringify(u.map((k) => itemHash.get(k) || k)) : base)];
  }));
  return { encs, hashes, cmp };
}

// the plan's items in send order: vars batches, the runtime, (with components: the component runtime and the
// component batches cmp-NN, atoms first), screen batches of the screens not in `keep` (numbered from `first`)
// force: screen ids and 'cmp:<component name>' (Task 7: a component edited by hand is rebuilt): the screen batches get
// the screen ids, the component batches the cmp: ones (a batch without any: no force, byte for byte as before)
export function planAll(dsData, { page = 'Screens', force = [], keep = new Set(), first = 1, encoded, prof = false, cmpPage = 'Components' } = {}) {
  const sf = force.filter((f) => !f.startsWith('cmp:')), cf = force.filter((f) => f.startsWith('cmp:'));
  const { encs, cmp } = encoded || encodeAll(dsData, { page, force: sf, cmpPage });
  const batches = planBatches(encs.filter((e) => !keep.has(e.screen)), { wrap: loaderCode, page, force: sf, first, prof, ...(cmp ? { extra: { cp: cmpPage } } : {}) });
  const cmpBatches = cmp ? planBatches(cmp.items, { wrap: loaderCode, page: cmpPage, prof, extra: { cm: 1 }, unit: (x) => x.cm.n, ...(cf.length ? { force: cf } : {}) }) : [];
  const rtc = cmp ? runtimeCmpInstallCode() : null;
  // the text style variants of every screen (kept ones too: the vars batches are sent whole)
  const vars = varsPayload(dsData.tokens, { variants: [...new Map(encs.flatMap((e) => e.variants || []).map((v) => [v[0], v])).values()] });
  const rt = runtimeInstallCode();
  return [
    ...vars.map((code, i) => ({ key: `vars-${pad(i + 1)}`, kind: 'vars', code, bytes: Buffer.byteLength(code, 'utf8'), screens: [] })),
    { key: 'runtime', kind: 'runtime', code: rt, bytes: Buffer.byteLength(rt, 'utf8'), screens: [], hash: RUNTIME_VERSION },
    ...(rtc ? [{ key: 'runtime-cmp', kind: 'runtime', code: rtc, bytes: Buffer.byteLength(rtc, 'utf8'), screens: [], hash: RUNTIME_CMP_VERSION }] : []),
    ...cmpBatches.map((b) => ({ key: `cmp-${pad(b.n)}`, kind: 'cmp', n: b.n, code: b.code, data: b.data, bytes: b.bytes, screens: b.screens })),
    ...batches.map((b) => ({ key: `batch-${pad(b.n)}`, kind: 'screens', n: b.n, code: b.code, data: b.data, bytes: b.bytes, screens: b.screens })),
  ].map((b) => ({ ...b, hash: b.hash || sha(b.code) }));
}

// calls of a batch: one use_figma, plus one get_screenshot per screen
const callsOf = (b) => ({ useFigma: 1, screenshot: b.kind === 'screens' ? b.screens.length : 0 });

async function plan(argv, log) {
  const o = args(argv, { ds: { type: 'string' }, out: { type: 'string' }, page: { type: 'string' }, 'max-calls': { type: 'string' }, force: { type: 'string', multiple: true }, redo: { type: 'boolean' }, prof: { type: 'boolean' },
    'no-components': { type: 'boolean' }, 'cmp-page': { type: 'string' } });
  if (!o.ds) throw new UsageError('--ds <ds.mjs output folder> is required');
  if (!o.out) throw new UsageError('--out <dir> is required');
  const maxCalls = num('max-calls', o['max-calls'], 40);
  const dsData = readDs(o.ds);
  // components (plan 3b): components.json of cmp.mjs in the ds folder, unless --no-components
  const cmpFile = join(dsData.ds, 'components.json');
  if (!o['no-components'] && existsSync(cmpFile)) {
    dsData.components = readJson(cmpFile, 'components.json');
    // proposed states (Task 6 part 2): states.json of cmp.mjs; approved rules add the State variables
    const stFile = join(dsData.ds, 'states.json');
    if (existsSync(stFile)) withStateTokens(dsData, readJson(stFile, 'states.json'));
  }
  const cmpPage = o['cmp-page'] || 'Components';
  if (cmpPage === (o.page || 'Screens')) throw new UsageError(`--cmp-page ${cmpPage}: the components need a page of their own, not the screens page`);
  const ids = dsData.screens.map((s) => s.id);
  const force = [...new Set((o.force || []).flatMap((f) => f.split(',')).map((f) => f.trim()).filter(Boolean))];
  const cnames = dsData.components ? (dsData.components.components || []).map((c) => c.name) : [];
  for (const f of force) {
    if (f.startsWith('cmp:')) { if (!cnames.includes(f.slice(4))) throw new UsageError(`--force ${f}: no such component (components: ${cnames.join(', ') || 'none'})`); }
    else if (!ids.includes(f)) throw new UsageError(`--force ${f}: no such screen (screens: ${ids.join(', ')})`);
  }
  const page = o.page || 'Screens';
  const F = figDir(o.out);
  mkdirSync(F, { recursive: true });
  const prev = existsSync(statePath(o.out)) ? loadState(o.out) : null;
  const pb = (prev && prev.batches) || {}, ps = (prev && prev.screens) || {};
  const filesOf = (key, kind) => ({ file: `${key}.js`, ...(kind === 'screens' || kind === 'cmp' ? { data: `${key}.data.json` } : {}) });
  const has = (key, kind) => Object.values(filesOf(key, kind)).every((f) => existsSync(join(F, f)));
  let all, encoded, keep;
  try {
    encoded = encodeAll(dsData, { page, force: force.filter((f) => !f.startsWith('cmp:')), cmpPage });
    // a screen built (or kept as edited) from the same data is not sent again
    keep = new Set(o.redo ? [] : ids.filter((s) => {
      const p = ps[s];
      return p && (p.status === 'done' || p.status === 'skippedEdited') && p.hash === encoded.hashes[s] && pb[p.batch] && has(p.batch, 'screens');
    }));
    const first = Math.max(0, ...[...keep].map((s) => pb[ps[s].batch].n)) + 1;
    all = planAll(dsData, { page, force, keep, first, encoded, prof: !!o.prof, cmpPage });
  } catch (e) {
    if (e instanceof OversizeError) throw new UsageError(e.message);
    throw new UsageError(`cannot plan the batches: ${e.message}`);
  }
  const st = {
    version: 2, ds: dsData.ds, file: dsData.ir.file, page, source: dsData.source, force, runtime: RUNTIME_VERSION,
    ...(encoded.cmp ? { cmpPage, runtimeCmp: RUNTIME_CMP_VERSION, components: (prev && prev.components) || {} } : {}),
    order: [], batches: {}, screens: {}, run: null,
    // the shots on disk stay recorded (with the frame each is of), so check can tell a shot of an earlier build
    ...(prev && prev.shots ? { shots: prev.shots } : {}),
    // the Figma file the batches were sent to (serve --file): a new plan of the same --out is still that file's
    ...(prev && prev.figmaFile ? { figmaFile: prev.figmaFile } : {}),
  };
  const changed = [];
  // batches whose screens are all or partly kept stay in the state (check reads their data), before the new ones
  const keptBatches = [...new Set([...keep].map((s) => ps[s].batch))].sort((a, b) => pb[a].n - pb[b].n);
  const addKept = () => { for (const k of keptBatches) if (!st.batches[k]) { st.batches[k] = pb[k]; st.order.push(k); } };
  for (const b of all) {
    if (b.kind === 'screens') addKept();
    const p = pb[b.key];
    const files = filesOf(b.key, b.kind);
    const kept = b.kind !== 'screens' && p && p.status === 'done' && p.hash === b.hash && !o.redo && has(b.key, b.kind);
    if (kept) st.batches[b.key] = p;
    else {
      const lastFailed = !p ? null : p.status === 'failed' ? (p.errors || []) : (p.lastFailed || null); // kept across plans until a good ingest
      writeFileSync(join(F, files.file), b.code);
      if (b.data) writeFileSync(join(F, files.data), JSON.stringify(b.data));
      if (b.kind !== 'screens' && p && p.status === 'done' && p.hash !== b.hash) changed.push(b.key);
      st.batches[b.key] = { kind: b.kind, ...(b.n ? { n: b.n } : {}), ...files, screens: b.screens, bytes: b.bytes, hash: b.hash, status: 'pending', ...(lastFailed && p.hash === b.hash ? { lastFailed } : {}) };
    }
    st.order.push(b.key);
  }
  addKept();
  for (const s of ids) {
    if (keep.has(s)) { st.screens[s] = ps[s]; continue; }
    if (ps[s] && (ps[s].status === 'done' || ps[s].status === 'skippedEdited') && !o.redo) changed.push(s);
    st.screens[s] = { batch: all.find((b) => b.screens.includes(s)).key, status: 'pending', hash: encoded.hashes[s] };
  }
  // batches of an earlier plan that no longer exist
  for (const k of Object.keys(pb)) {
    if (st.batches[k]) continue;
    for (const f of [`${k}.js`, `${k}.data.json`]) if (existsSync(join(F, f))) rmSync(join(F, f));
  }
  // estimate and this run's budget
  const todo = st.order.filter((k) => st.batches[k].status !== 'done' && !keptBatches.includes(k));
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
  const nc = st.order.filter((k) => st.batches[k].kind === 'cmp').length;
  log(`plan: ${st.order.length} batches (${st.order.filter((k) => st.batches[k].kind === 'vars').length} vars, ${nc ? `${nc} component, ` : ''}${st.order.filter((k) => st.batches[k].kind === 'screens').length} screen), ${ids.length} screens${skippedDone ? `; ${skippedDone} already done (kept)` : ''}`);
  if (encoded.cmp) {
    let inst = 0;
    const w = (e) => { if (e.i !== undefined) inst++; (e.k || []).forEach(w); };
    for (const e of encoded.encs) w(e.T);
    const it = encoded.cmp.items;
    log(`components: ${it.filter((x) => !x.cm.n.startsWith('icon/')).length} variants of ${new Set(it.map((x) => x.cm.n).filter((n) => !n.startsWith('icon/'))).size} components, ${it.filter((x) => x.cm.n.startsWith('icon/')).length} icon components, ${inst} instances on the screens (page ${cmpPage})`);
  }
  if (changed.length) log(`changed since they were sent: ${changed.join(', ')} (pending again)`);
  const nr = todo.filter((k) => st.batches[k].kind === 'runtime').length, ncb = todo.filter((k) => st.batches[k].kind === 'cmp').length;
  log(`estimate: ${tot.useFigma} use_figma calls (${nv} vars + ${nr} runtime + ${ncb ? `${ncb} component + ` : ''}${tot.useFigma - nv - nr - ncb} screen batches), ${tot.screenshot} get_screenshot calls, ${st.run.kb} KB to send`);
  const ks = ids.filter((s) => keep.has(s));
  if (ks.length) log(`screens unchanged since they were built (not sent again): ${ks.join(', ')}`);
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
        (t.length < 3 || t[2] === 0 || (res.z === 1 && t[2] === 1) || isBox(t[2])) && (t.length < 4 || isObj(t[3]));
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
  if (isObj(res) && typeof res.runtime === 'string' && res.rtc && st.batches['runtime-cmp']) return 'runtime-cmp';
  if (isObj(res) && typeof res.runtime === 'string' && st.batches.runtime) return 'runtime';
  if (isObj(res) && isObj(res.cm) && Number.isInteger(res.batch)) return `cmp-${pad(res.batch)}`;
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
  // the loader refused to build: nothing changed in Figma
  if (isObj(res) && typeof res.stale === 'string') throw new UsageError(`batch ${res.batch}: the file has runtime ${res.have || '(none)'}, the batch needs ${res.stale}: send ${res.rtc ? 'runtime-cmp' : 'runtime'}.js, ingest its result, then send the batch again`);
  if (isObj(res) && res.damaged) throw new UsageError(`batch ${res.batch}: its data arrived changed (hash mismatch); nothing was built: send the file content verbatim`);
  const key = keyOf(st, res, o.batch);
  const b = st.batches[key];
  if (!b) throw new UsageError(`${key}: not in the plan (${st.order.join(', ')})`);
  const built = b.kind === 'screens' || b.kind === 'cmp'; // a component batch returns screen-like results, one per variant
  const D = built ? readJson(join(F, b.data), `data of ${key}`) : null;
  const bad = built ? [...validateScreenBatch(res, b, D), ...(b.kind === 'cmp' && !isObj(res.cm) ? ['cm is missing (not the result of a component batch)'] : [])]
    : b.kind === 'runtime' ? (isObj(res) && res.runtime === b.hash ? [] : [`runtime is ${JSON.stringify(isObj(res) ? res.runtime : res)}, expected ${b.hash}`])
      : validateVarsBatch(res, b, st.order.filter((k) => st.batches[k].kind === 'vars').indexOf(key));
  // a screen batch result carries the hash the loader computed in Figma: a result retyped or cut on the way fails here
  if (built && !bad.length && res.h !== resultHash(res)) bad.push(res.h === undefined ? 'no result hash h (not the output of this batch\'s loader)' : `result hash h ${res.h} does not match its content (${resultHash(res)}): it was changed after Figma returned it; save the use_figma output verbatim`);
  if (bad.length) throw new UsageError(`${o.result} is not a valid result of ${key}:\n  ${bad.slice(0, 20).join('\n  ')}${bad.length > 20 ? `\n  ... ${bad.length - 20} more` : ''}`);
  const file = `result-${key}.json`;
  // a compact screen result (z: 1) is kept expanded, so later steps read plain nodes
  if (built && res.z === 1) writeFileSync(join(F, file), JSON.stringify(expandNodes(res, D)));
  else copyFileSync(resolve(o.result), join(F, file));
  if (b.kind === 'runtime') {
    b.status = 'done'; b.result = file;
    log(`${key}: done (${res.runtime}, ${res.bytes} chars installed)`);
  } else if (b.kind === 'cmp') {
    // per variant: built (root = the component) or failed; set-level errors (combine, properties) fail the batch
    let failed = res.cm.errors && res.cm.errors.length ? 1 : 0;
    st.components ||= {};
    for (const s of res.screens) {
      const rec = { batch: key, result: file };
      if (s.edited === true) Object.assign(rec, { status: 'skippedEdited', root: s.root, sig: s.sig, edited: true, skippedEdited: true });
      else if (s.root === undefined) { failed++; Object.assign(rec, { status: 'failed', errors: s.errors, fontMissing: s.fontMissing.length }); }
      else Object.assign(rec, { status: 'done', root: s.root, sig: s.sig, errors: s.errors.length, fontMissing: s.fontMissing.length });
      st.components[s.screen.replace(/^cmp:/, '')] = rec;
    }
    b.status = failed ? 'failed' : 'done';
    b.result = file;
    if (res.cm.errors && res.cm.errors.length) b.errors = res.cm.errors; else delete b.errors;
    const kept = res.screens.filter((s) => s.edited === true).map((s) => s.screen.replace(/^cmp:/, ''));
    log(`${key}: ${b.status}; ${res.screens.filter((s) => s.root !== undefined && s.edited !== true).length}/${res.screens.length} variants built,${kept.length ? ` edited by hand, kept (skippedEdited; --force cmp:<name> rebuilds): ${kept.join(', ')},` : ''} ${Object.keys(res.cm.sets || {}).length} components${res.cm.swapped ? `, ${res.cm.swapped} instances moved to the new build` : ''}${res.cm.oldKept ? `, ${res.cm.oldKept} old components kept (instances left)` : ''}${failed ? `; errors: ${[...(res.cm.errors || []).map((x) => `${x.o}: ${x.msg}`), ...res.screens.filter((s) => s.root === undefined).map((s) => s.screen)].slice(0, 3).join('; ')}` : ''}`);
  } else if (b.kind === 'vars') {
    b.status = res.errors.length ? 'failed' : 'done';
    b.result = file;
    if (res.errors.length) b.errors = res.errors; else { delete b.errors; delete b.lastFailed; }
    b.fontMissing = res.fontMissing.length;
    log(`${key}: ${b.status}${res.errors.length ? ` (${res.errors.length} errors: ${res.errors.slice(0, 3).map((x) => [x.kind, x.name].filter((v) => v != null).join(' ') + (x.kind != null || x.name != null ? ': ' : '') + x.msg).join('; ')})` : ''}`);
  } else {
    let failed = 0;
    for (const s of res.screens) {
      const rec = { batch: key, result: file, ...(st.screens[s.screen] && st.screens[s.screen].hash ? { hash: st.screens[s.screen].hash } : {}) };
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
    if (isObj(res.prof)) b.prof = res.prof; else delete b.prof;
    const by = (k) => res.screens.filter((s) => st.screens[s.screen].status === k).map((s) => s.screen);
    if (b.prof) log(`${key} prof (ms): ${Object.entries(b.prof).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
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
  // roots: the frame each shot is of (check ignores a shot whose screen was built again since)
  const roots = Object.fromEntries(Object.keys(res.clones).filter((x) => st.screens[x].root).map((x) => [x, st.screens[x].root]));
  st.shots = { page: res.page, clones: res.clones, ...(res.sizes ? { sizes: res.sizes } : {}), ...(res.missing && res.missing.length ? { missing: res.missing } : {}), roots };
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

// ---------------- serve (Figma bridge) ----------------
async function serve(argv, log, deps = {}) {
  const o = args(argv, { out: { type: 'string' }, file: { type: 'string' }, renamed: { type: 'boolean' }, send: { type: 'string', multiple: true }, shots: { type: 'boolean' }, port: { type: 'string' }, wait: { type: 'string' } });
  if (!o.out) throw new UsageError('--out <dir> is required');
  const st0 = loadState(o.out), F = figDir(o.out);
  const asked = (o.send || []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
  if (!asked.length && !o.shots) throw new UsageError('nothing to send: name the batches with --send (keys, run or pending) and/or --shots');
  const keys = new Set();
  for (const a of asked) {
    if (a === 'run') { for (const k of (st0.run && st0.run.send) || []) keys.add(k); continue; }
    if (a === 'pending') { for (const k of st0.order) if (st0.batches[k].status !== 'done') keys.add(k); continue; }
    const k = /^\d+$/.test(a) ? `batch-${pad(+a)}` : a;
    if (!st0.batches[k]) throw new UsageError(`--send ${a}: no such batch (${st0.order.join(', ')})`);
    keys.add(k);
  }
  const given = o.file != null ? o.file.trim() : null;
  if (given === '') throw new UsageError('--file: the Figma file name is empty');
  if (o.renamed && given == null) throw new UsageError('--renamed needs --file <the new name>');
  if (given == null && !st0.figmaFile) throw new UsageError('--file <Figma file name> is required: this plan was never sent to Figma (jobs go only to a plugin open in that file)');
  if (given != null && st0.figmaFile && given !== st0.figmaFile && !o.renamed) {
    throw new UsageError(`this plan was sent to the Figma file "${st0.figmaFile}", not "${given}": to draw into another file use a new --out; if the file was renamed, add --renamed`);
  }
  const target = given != null ? given : st0.figmaFile;
  if (o.renamed && st0.figmaFile && given !== st0.figmaFile) log(`Figma file renamed: "${st0.figmaFile}" -> "${given}"`);
  const codeJobs = st0.order.filter((k) => keys.has(k));
  const already = codeJobs.filter((k) => st0.batches[k].status === 'done');
  if (already.length) log(`note: already done, sent again: ${already.join(', ')}`);
  const port = o.port == null ? BRIDGE_PORT : num('port', o.port, BRIDGE_PORT);
  if (port !== BRIDGE_PORT && port !== 0) log(`warning: the plugin only reaches port ${BRIDGE_PORT} (manifest devAllowedDomains)`);
  const waitMs = num('wait', o.wait, 300) * 1000;
  mkdirSync(join(F, 'inbox'), { recursive: true });
  // shots are queued after the batches, from the state those batches leave
  let ci = 0, shotList = null;
  const next = () => {
    if (ci < codeJobs.length) { const k = codeJobs[ci++]; return { key: k, kind: 'code', code: readFileSync(join(F, st0.batches[k].file), 'utf8') }; }
    if (!o.shots) return null;
    if (!shotList) shotList = Object.entries(loadState(o.out).screens).filter(([, s]) => s.status === 'done' && s.root).map(([screen, s]) => ({ screen, root: s.root }));
    const s = shotList.shift();
    return s ? { key: `shot-${s.screen}`, kind: 'shot', screen: s.screen, root: s.root, scale: 2 } : null;
  };
  const shotSizes = {}, shotRoots = {};
  const onResult = async (job, p) => {
    if (!p || !p.ok) return { ok: false, msg: `Figma error: ${(p && p.error) || 'no result'}` };
    if (job.kind === 'shot') {
      const buf = p.png;
      if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { ok: false, msg: 'not a PNG' };
      writeFileSync(join(F, `shot-${safe(job.screen)}.png`), buf);
      shotSizes[job.screen] = pngSize(buf);
      shotRoots[job.screen] = job.root;
      log(`  ${job.key}: ${shotSizes[job.screen].join(' x ')} px`);
      return { ok: true, msg: shotSizes[job.screen].join('x') };
    }
    if (typeof p.text !== 'string') return { ok: false, msg: 'no result text' };
    const file = join(F, 'inbox', `${job.key}.json`);
    writeFileSync(file, p.text);
    const lines = [];
    let code;
    try { code = await ingest(['--out', o.out, '--result', file, '--batch', job.key], (m) => lines.push(m)); } catch (e) {
      if (e instanceof UsageError) return { ok: false, msg: e.message };
      throw e;
    }
    for (const l of lines) log(`  ${l}`);
    const b = loadState(o.out).batches[job.key];
    if (code !== 0 || b.status !== 'done') return { ok: false, msg: `${job.key} is ${b.status}: ${lines.join('; ')}` };
    return { ok: true, msg: lines[0] || 'ok' };
  };
  const total = codeJobs.length + (o.shots ? Object.values(st0.screens).filter((s) => (s.status === 'done' && s.root) || keys.has(s.batch)).length : 0);
  const t0 = Date.now();
  const br = await (deps.startBridge || startBridge)({ next, onResult, port, log, connectTimeoutMs: waitMs, total: total || null, file: target, ...(deps.bridgeOpts || {}) });
  log(`serve: ${codeJobs.length ? codeJobs.join(', ') : 'no batches'}${o.shots ? ' + 2x shots of the built screens' : ''} on http://localhost:${br.port}, Figma file "${target}"`);
  if (deps.onListen) deps.onListen(br.port);
  log('waiting for the Figma Desktop plugin (Plugins > Development > vuong-design bridge)');
  const r = await br.done;
  const reached = r.jobs.some((j) => j.ok);
  if ((o.shots && Object.keys(shotSizes).length) || (reached && loadState(o.out).figmaFile !== target)) {
    const st = loadState(o.out);
    if (o.shots && Object.keys(shotSizes).length) st.shots = { via: 'export', scale: 2, sizes: shotSizes, roots: shotRoots };
    if (reached) st.figmaFile = target;
    writeFileSync(statePath(o.out), json(st));
  }
  const kb = (n) => Math.round(n / 100) / 10;
  const sum = (f) => r.jobs.reduce((a, j) => a + j[f], 0);
  appendFileSync(join(F, 'runs.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), via: 'bridge', ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), seconds: Math.round((Date.now() - t0) / 100) / 10, kbOut: kb(sum('bytesOut')), kbIn: kb(sum('bytesIn')), jobs: r.jobs.map(({ key, ok, ms, bytesOut, bytesIn }) => ({ key, ok, ms, bytesOut, bytesIn })) })}\n`);
  const okN = r.jobs.filter((j) => j.ok).length;
  log(`serve: ${okN}/${r.jobs.length} jobs ok, ${Math.round(sum('ms') / 100) / 10} s in Figma, ${kb(sum('bytesOut'))} KB sent, ${kb(sum('bytesIn'))} KB back, 0 model tokens`);
  if (!r.ok) {
    log(`stopped: ${r.reason}`);
    return !r.jobs.length && /no plugin connected/.test(r.reason || '') ? 2 : 1;
  }
  return 0;
}

// ---------------- check ----------------
const CHECK_OPTS = {
  out: { type: 'string' }, mutate: { type: 'boolean' }, allowlist: { type: 'string' }, html: { type: 'string' }, root: { type: 'string' },
  widen: { type: 'string' }, name: { type: 'string' }, 'widen-by': { type: 'string' }, viewport: { type: 'string' }, 'no-webfonts': { type: 'boolean' },
  'tol-frame': { type: 'string' }, 'tol-text': { type: 'string' }, 'tol-model': { type: 'string' }, 'tol-text-round': { type: 'string' },
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// what check needs from the ds folder and the plan, per screen
export function checkInputs(st, F) {
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
    // a shot of an earlier frame (the screen was built again since: another root) is not used: the crops would compare
    // the new build with the old picture. Shots recorded without roots (before 2026-11-24) are used as before.
    const shotRoot = st.shots && st.shots.roots ? st.shots.roots[id] : undefined;
    const stale = shotRoot !== undefined && shotRoot !== ss.root;
    return { id, specText: readFileSync(p, 'utf8'), state: ss, sres, D, shot: existsSync(shot) && !stale ? shot : null, ...(stale ? { staleShot: true } : {}) };
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
  for (const [k, n] of [['tol-frame', 'tolFrame'], ['tol-text', 'tolText'], ['tol-model', 'tolModel'], ['tol-text-round', 'tolTextRound']]) { const v = num(k, o[k]); if (v != null) verifyOpts[n] = v; }
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
  const { runFigMutations, swapIconSpec, hideFrameSpec } = await import('./mutate.mjs');
  const { cmpVariants, blockInstances, cmpMutation } = await import('./figma-cmp-check.mjs');
  const { buildProxyHtml, renderProxy } = await import('./proxy.mjs');
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
    // plan 3b Task 7: the component variants against their encoding; an instance of one without readback is unchecked
    const cmpOn = !!(st.components && Object.keys(st.components).length);
    const variants = cmpOn ? cmpVariants(st, F, Object.fromEntries(inp.screens.filter((x) => x.D).map((x) => [x.id, x.D])), (f) => readJson(join(F, f))) : [];
    const noRead = new Map(variants.filter((v) => v.status !== 'done' && v.status !== 'skippedEdited').map((v) => [v.key, `instance of component ${v.key}, which has no readback (${v.status})`]));
    const cmpMut = cmpOn && o.mutate ? cmpMutation(variants, st, (f) => readJson(join(F, f))) : null;
    const { screenView, renderReportHtml } = await import('./report-html.mjs');
    for (const x of inp.screens) {
      const sc = capById.get(x.id);
      // a screen with no readback (never sent, failed): fails without the local model, proxy and report view (about 6 s
      // each on Planora)
      if (!x.sres || !x.sres.nodes) {
        screensOut.push({ summary: { file: inp.ir.file, screen: x.id, pass: false, notBuilt: x.state.status }, notBuilt: true, figma: { status: x.state.status, batch: x.state.batch || null } });
        log(`  ${x.id}: fail (no readback: ${x.state.status}; not checked)`);
        continue;
      }
      const { inferred, modelled, target, normOn, layout, modP, normP, normLayout, normLayoutError } = await localScreen(browser, sc, { id: x.id, fontMap, webFonts, entries: inp.entries });
      if (specJson(target.spec) !== x.specText) throw new UsageError(`screen ${x.id}: the target spec rebuilt from the page differs from spec-norm-${safe(x.id)}.json: the source changed since ds.mjs ran; run ds.mjs and figma.mjs plan again`);
      // the Figma readback and screenshot
      const bl = blockInstances(x.sres && x.sres.nodes ? x.sres : null, x.D, noRead);
      const sres = bl.sres;
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
        // R77 (iii) on real Figma: a record explains a crop only when the norm proxy matches the shot there
        extra.cropsRefVsFigma = ids.length && normP ? await measureCrops(browser, sc, fig, { ...verifyOpts, ids, base: normP, widths: ['A'] }) : [];
      }
      const input = (figP, cr = crops, rf = null) => (normOn
        ? { screen: sc, spec: modelled.spec, proxy: modP, layout, flags, norm: { spec: target.spec, applied: target.applied, proxy: figP, entries: inp.entries }, normLayout, crops: cr, pixel, ...extra, ...(rf ? { cropsRefVsFigma: rf } : {}) }
        : { screen: sc, spec: modelled.spec, proxy: figP, layout, flags, crops: cr, pixel });
      // an instance of another component than the encoded one (not an icon: its identity is the icon check) is a finding
      const verifyFig = (figP, ...a) => { const r = verifyScreen(input(figP, ...a), verifyOpts); for (const w of figP.swapped || []) r.data.push(w); if ((figP.swapped || []).length) r.pass = false; return r; };
      const report = verifyFig(fig);
      for (const [id, why] of Object.entries(bl.blocked)) if (report.unchecked.includes(id)) (report.uncheckedReasons ||= {})[id] = why;
      if (normLayoutError) report.normLayoutError = normLayoutError;
      let mutations = null;
      if (o.mutate) {
        // figIconPx: the icon drawn as another one (proxy of the target spec) replaces the node's crop against the shot,
        // and its norm-proxy-vs-shot crop (R77 iii) too: the shot shows the right icon, the proxy the wrong one
        const fc = sc.fontCss || {}, po = { fontLinks: fc.links || [], fontFaces: fc.faces || [], ...(webFonts ? {} : { webFonts: false }) };
        const pixelCrops = async (o, kind) => {
          const sp = (kind === 'figHide' ? hideFrameSpec : swapIconSpec)(target.spec, o);
          if (!sp || !shot || !crops || !crops.some((c) => c.id === o)) return null;
          const P = { A: await renderProxy(browser, buildProxyHtml(sp, sc.svgDefs || {}, fontMap, po), sc.W[0], { origin: sc.origin[0] }) };
          const m = await measureCrops(browser, sc, fig, { ...verifyOpts, widths: ['A'], base: P, ids: [o] });
          if (!m.length) return null;
          const rf = (extra.cropsRefVsFigma || []).filter((c) => c.id !== o);
          return { cr: crops.map((c) => (c.id === o && c.width === 'A' ? m[0] : c)), rf: extra.cropsRefVsFigma ? [...rf, m[0]] : null };
        };
        mutations = await runFigMutations({
          id: x.id, base: report, screen: sres, D: x.D, tree: sc.tree, spec: target.spec,
          run: async (m, px) => { if (!px) return verifyFig(build(m)); const pc = await pixelCrops(px.o, px.kind); return pc ? verifyFig(build(m), pc.cr, pc.rf) : null; },
        });
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
      log(`  ${x.id}: ${summary.pass ? 'pass' : 'fail'}${sres ? '' : ` (no readback: ${ss.status})`}${shot ? '' : x.staleShot ? ' (screenshot of an earlier build: take new shots)' : ' (no screenshot)'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
    const verdict = runVerdict(screensOut);
    const cmpPass = variants.every((v) => v.pass);
    const missed = [...verdict.missed, ...(cmpMut && cmpMut.caught === false ? [`components:${cmpMut.kind}`] : [])];
    const pass = verdict.pass && cmpPass && missed.length === verdict.missed.length;
    const components = cmpOn ? { pass: cmpPass, variants, ...(cmpMut ? { mutations: [cmpMut] } : {}) } : null;
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const a = { out: o.out, html: src.html, root: src.root, webFonts, tol: verifyOpts, mutate: !!o.mutate, allowlistApproved: allowlist.filter((e) => e && e.approved === true).length };
    writeFileSync(join(F, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), seconds, args: a, pass, ...(o.mutate ? { mutationsMissed: missed } : {}), screens: screensOut, ...(components ? { components } : {}) }, null, 1));
    writeFileSync(join(F, 'report.html'), renderReportHtml({ title: 'vuong-design check on real Figma', generated: `${new Date().toISOString()} · ${seconds} s`, args: a, screens: views, ...(components ? { components } : {}) }));
    const failed = screensOut.filter((s) => !s.summary.pass).length;
    if (components) {
      const by = (k) => variants.filter((v) => v.status === k).length, bad = variants.filter((v) => !v.pass);
      log(`components: ${variants.length - bad.length}/${variants.length} variants pass (${by('done')} built, ${by('skippedEdited')} edited by hand and kept${variants.length - by('done') - by('skippedEdited') ? `, ${variants.length - by('done') - by('skippedEdited')} without readback` : ''})${bad.length ? `; failing: ${bad.slice(0, 5).map((v) => v.key).join(', ')}` : ''}`);
      for (const v of variants.filter((x) => x.edited)) log(`  ${v.key}: edited by hand, kept; used by ${v.usedBy.join(', ') || 'no screen'} (their instances are checked on each screen)`);
    }
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
    if (cmd === 'serve') return await serve(rest, log, deps);
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') { log(USAGE); return 0; }
    throw new UsageError(cmd ? `unknown command ${cmd}` : 'a command is required (plan, ingest, serve, shots, ingest-shots, shots-clean, check)');
  } catch (e) {
    if (e instanceof UsageError) { log(`error: ${e.message}\n${USAGE}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
