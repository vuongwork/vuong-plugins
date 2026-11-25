// figma.mjs serve + figma-bridge.mjs: a simulated plugin talks real HTTP to the bridge and runs the batches on the fake Figma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main, checkInputs } from '../core/figma.mjs';
import { startBridge } from '../core/figma-bridge.mjs';
import { makeFakeFigma, DEFAULT_FONTS } from './fake-figma.mjs';

const AF = (async () => {}).constructor;
const readJson = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const text = (id, t) => ({
  id, t: 'T', w: 60, h: 16, sz: ['HUG', 'HUG'],
  font: { ff: 'Inter', fs: '12px', fw: '400', fst: 'normal', lh: 16, ls: 'normal', c: 'rgb(0, 0, 0)', ta: 'start', td: 'none', tt: 'none' }, runs: [{ t }],
});
const screenSpec = (t) => ({
  id: 'n', t: 'F', w: 300, h: 200, sz: ['FIXED', 'FIXED'], paint: { bg: 'rgb(255, 255, 255)' },
  lay: { d: 'V', p: [8, 8, 8, 8], g: 4, pa: 'S', ca: 'S' },
  kids: [{ id: 'n.0', t: 'F', w: 284, h: 30, sz: ['FILL', 'HUG'], paint: { bg: 'rgb(238, 238, 238)' }, lay: { d: 'H', p: [7, 7, 7, 7], g: 0, pa: 'S', ca: 'S' }, kids: [text('n.0.0', t)] }],
  model: 'figma',
});
async function planned() {
  const d = mkdtempSync(join(tmpdir(), 'vd-bridge-')), ds = join(d, 'ds'), out = join(d, 'out');
  mkdirSync(ds);
  writeFileSync(join(ds, 'ir.json'), JSON.stringify({ file: 'hand.html', root: '.scr', widen: null, screens: [{ id: 's0', W: [300, 420], svgDefs: {} }, { id: 's1', W: [300, 420], svgDefs: {} }] }));
  writeFileSync(join(ds, 'spec-norm-s0.json'), JSON.stringify(screenSpec('Hello')));
  writeFileSync(join(ds, 'spec-norm-s1.json'), JSON.stringify(screenSpec('World')));
  writeFileSync(join(ds, 'tokens.json'), JSON.stringify({ primitive: { color: { c01: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' } } } } }));
  writeFileSync(join(ds, 'token-map.json'), JSON.stringify({ s0: { n: { bg: 'primitive.color.c01' } }, s1: { n: { bg: 'primitive.color.c01' } } }));
  assert.equal(await main(['plan', '--ds', ds, '--out', out], { log: () => {} }), 0);
  return { out, F: join(out, 'figma') };
}
// a PNG header the bridge accepts (signature + IHDR with width and height)
const fakePng = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

// the plugin's UI loop, against the fake Figma; tamper(job, text) may change a result on the way
async function plugin(port, { fig = makeFakeFigma({ fonts: DEFAULT_FONTS }), tamper = (j, t) => t, fail = () => null } = {}) {
  const base = `http://127.0.0.1:${port}`, seen = [];
  for (let i = 0; i < 200; i++) {
    const j = await (await fetch(`${base}/next`)).json();
    if (j.done) return seen;
    if (j.wait) { await new Promise((r) => setTimeout(r, 5)); continue; }
    seen.push(j.key);
    const err = fail(j);
    if (err) { await fetch(`${base}/result?id=${j.id}`, { method: 'POST', body: JSON.stringify({ ok: false, error: err }) }); continue; }
    if (j.kind === 'shot') { await fetch(`${base}/shot?id=${j.id}`, { method: 'POST', body: fakePng(600, 400) }); continue; }
    const outv = await new AF('figma', j.code)(fig);
    await fetch(`${base}/result?id=${j.id}`, { method: 'POST', body: JSON.stringify({ ok: true, text: tamper(j, JSON.stringify(outv)) }) });
  }
  throw new Error('the plugin loop did not end');
}
async function serveWith(out, argv, pluginOpts) {
  const lines = [];
  let ran;
  const code = await main(['serve', '--out', out, '--port', '0', ...argv], {
    log: (m) => lines.push(m), bridgeOpts: { lingerMs: 30 },
    onListen: (port) => { ran = pluginOpts === false ? null : plugin(port, pluginOpts); },
  });
  return { code, lines, seen: ran ? await ran : null };
}

test('serve sends every pending batch through the plugin, ingests each result and exports 2x shots', async () => {
  const { out, F } = await planned();
  const r = await serveWith(out, ['--send', 'pending', '--shots']);
  assert.equal(r.code, 0, r.lines.join('\n'));
  const st = readJson(F, 'state.json');
  assert.ok(st.order.every((k) => st.batches[k].status === 'done'), JSON.stringify(st.batches));
  assert.deepEqual(Object.keys(st.screens).map((s) => st.screens[s].status), ['done', 'done']);
  assert.deepEqual(r.seen, [...st.order, 'shot-s0', 'shot-s1']);
  for (const s of ['s0', 's1']) assert.ok(existsSync(join(F, `shot-${s}.png`)));
  assert.deepEqual(st.shots, { via: 'export', scale: 2, sizes: { s0: [600, 400], s1: [600, 400] }, roots: { s0: st.screens.s0.root, s1: st.screens.s1.root } });
  const run = readFileSync(join(F, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(run.length, 1);
  assert.equal(run[0].ok, true);
  assert.equal(run[0].jobs.length, st.order.length + 2);
  assert.match(r.lines.at(-1), /0 model tokens/);
});

test('serve sends only the named batches, in plan order', async () => {
  const { out, F } = await planned();
  const st0 = readJson(F, 'state.json');
  const vars = st0.order.filter((k) => st0.batches[k].kind === 'vars');
  const r = await serveWith(out, ['--send', `runtime,${vars.join(',')}`]);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(r.seen, st0.order.filter((k) => k === 'runtime' || vars.includes(k)));
  const st = readJson(F, 'state.json');
  assert.equal(st.batches['batch-01'].status, 'pending');
});

test('a result changed on the way fails its hash check and stops the queue', async () => {
  const { out, F } = await planned();
  const r = await serveWith(out, ['--send', 'pending'], {
    tamper: (j, t) => (j.key === 'batch-01' ? t.replace('"s0"', '"s0" ').replace(/"page":"[^"]*"/, '"page":"X"') : t),
  });
  assert.equal(r.code, 1);
  assert.equal(r.seen.at(-1), 'batch-01');
  assert.match(r.lines.join('\n'), /result hash h .* does not match/);
  assert.equal(readJson(F, 'state.json').batches['batch-01'].status, 'pending');
});

test('a Figma error stops the run before the later batches', async () => {
  const { out, F } = await planned();
  const st0 = readJson(F, 'state.json');
  const r = await serveWith(out, ['--send', 'pending'], { fail: (j) => (j.key === 'runtime' ? 'boom' : null) });
  assert.equal(r.code, 1);
  assert.equal(r.seen.at(-1), 'runtime');
  assert.ok(r.seen.length < st0.order.length);
  assert.match(r.lines.join('\n'), /Figma error: boom/);
});

test('serve refuses to start without --send or --shots, and names an unknown batch', async () => {
  const { out } = await planned();
  const lines = [];
  assert.equal(await main(['serve', '--out', out], { log: (m) => lines.push(m) }), 2);
  assert.match(lines.join('\n'), /nothing to send/);
  assert.equal(await main(['serve', '--out', out, '--send', 'batch-09'], { log: (m) => lines.push(m) }), 2);
  assert.match(lines.join('\n'), /no such batch/);
});

test('serve exits 2 when no plugin connects in time', async () => {
  const { out } = await planned();
  const r = await serveWith(out, ['--send', 'pending', '--wait', '0.2'], false);
  assert.equal(r.code, 2);
  assert.match(r.lines.join('\n'), /no plugin connected/);
});

// review fixes (2026-11-24): a next() that throws after a result stops the queue; a plugin gone between jobs times out;
// a request from a web page (Origin header other than null) is refused
test('bridge: next() throwing after a result ends the run, the finished job is not served again', async () => {
  let n = 0;
  const br = await startBridge({ next: () => { if (n++ === 0) return { key: 'a', kind: 'code', code: '1' }; throw new Error('ENOENT batch-02'); }, onResult: async () => ({ ok: true, msg: 'ok' }), port: 0, lingerMs: 30, jobTimeoutMs: 2000 });
  const base = `http://127.0.0.1:${br.port}`;
  const j = await (await fetch(`${base}/next`)).json();
  assert.equal(j.key, 'a');
  await fetch(`${base}/result?id=${j.id}`, { method: 'POST', body: JSON.stringify({ ok: true, text: '1' }) });
  const again = await (await fetch(`${base}/next`)).json();
  assert.equal(again.done, true, JSON.stringify(again));
  const r = await br.done;
  assert.equal(r.ok, false);
  assert.match(r.reason, /next job: ENOENT batch-02/);
  assert.deepEqual(r.jobs.map((x) => x.key), ['a']);
});

test('bridge: next() throwing at start ends the run instead of crashing', async () => {
  const br = await startBridge({ next: () => { throw new Error('bad state'); }, onResult: async () => ({ ok: true }), port: 0, lingerMs: 10 });
  const r = await br.done;
  assert.equal(r.ok, false);
  assert.match(r.reason, /bad state/);
});

test('bridge: a plugin that stops polling between jobs ends the run by the job timeout', async () => {
  const q = [{ key: 'a', kind: 'code', code: '1' }, { key: 'b', kind: 'code', code: '2' }];
  const br = await startBridge({ next: () => q.shift() || null, onResult: async () => ({ ok: true, msg: 'ok' }), port: 0, lingerMs: 10, jobTimeoutMs: 150 });
  const base = `http://127.0.0.1:${br.port}`;
  const j = await (await fetch(`${base}/next`)).json();
  await fetch(`${base}/result?id=${j.id}`, { method: 'POST', body: JSON.stringify({ ok: true, text: '1' }) });
  const r = await br.done; // the plugin never asks for b
  assert.equal(r.ok, false);
  assert.match(r.reason, /did not ask for b/);
});

test('bridge: a request with a web page Origin is refused; origin null (the plugin) and none (local tools) pass', async () => {
  const br = await startBridge({ next: () => ({ key: 'a', kind: 'code', code: 'SECRET' }), onResult: async () => ({ ok: true }), port: 0, lingerMs: 10, connectTimeoutMs: 2000 });
  const base = `http://127.0.0.1:${br.port}`;
  const evil = await fetch(`${base}/next`, { headers: { Origin: 'https://example.com' } });
  assert.equal(evil.status, 403);
  assert.ok(!(await evil.text()).includes('SECRET'));
  const post = await fetch(`${base}/result?id=1`, { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' });
  assert.equal(post.status, 403);
  assert.equal((await (await fetch(`${base}/next`, { headers: { Origin: 'null' } })).json()).key, 'a');
  br.close();
  await br.done;
});

test('check: a shot of an earlier build of the screen is not used (another root since the shot)', async () => {
  const { out, F } = await planned();
  const fig = makeFakeFigma({ fonts: DEFAULT_FONTS }); // one Figma file for both runs
  assert.equal((await serveWith(out, ['--send', 'pending', '--shots'], { fig })).code, 0);
  const st1 = readJson(F, 'state.json');
  assert.equal(st1.shots.roots.s0, st1.screens.s0.root);
  assert.ok(checkInputs(st1, F).screens.every((x) => x.shot && !x.staleShot));
  const ds = join(out, '..', 'ds');
  writeFileSync(join(ds, 'spec-norm-s0.json'), JSON.stringify(screenSpec('Changed')));
  assert.equal(await main(['plan', '--ds', ds, '--out', out], { log: () => {} }), 0);
  const r2 = await serveWith(out, ['--send', 'pending'], { fig }); // rebuilt without new shots
  assert.equal(r2.code, 0, r2.lines.join('\n'));
  const st2 = readJson(F, 'state.json');
  assert.notEqual(st2.screens.s0.root, st1.screens.s0.root);
  const by = Object.fromEntries(checkInputs(st2, F).screens.map((x) => [x.id, x]));
  assert.equal(by.s0.shot, null);
  assert.equal(by.s0.staleShot, true);
  assert.ok(by.s1.shot, 's1 not rebuilt: its shot is still used');
});
