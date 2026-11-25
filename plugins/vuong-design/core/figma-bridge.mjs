// Local bridge between figma.mjs and the vuong-design Figma Desktop plugin (figma-plugin/). It replaces the AI courier:
// the plugin polls this server, runs each job in Figma and posts the result back, so no batch or result passes through a
// model. The bridge only moves bytes; figma.mjs serve decides the jobs and ingests the results (README "Figma bridge").
//
// Protocol (loopback only: 127.0.0.1 and ::1, CORS open because the plugin UI iframe has origin null; a request with
// any other Origin header, i.e. from a web page, is refused with 403):
//   GET  /next            -> { session, done: true } | { session, wait: true } | { session, id, key, kind, code?, root?, scale?, n, of }
//                            (a job already served and not answered is served again: the plugin was reloaded)
//   POST /result?id=<id>  <- JSON { ok: true, text } (text = JSON of the code's return value) | { ok: false, error }
//   POST /shot?id=<id>    <- the PNG bytes of a shot job
// Every answer is JSON { ok, msg }. A failed job stops the queue (later jobs are not served).
import http from 'node:http';
import { randomBytes } from 'node:crypto';

export const BRIDGE_PORT = 8787; // the plugin manifest allows this port only (devAllowedDomains)
const MAX_BODY = 64 * 1024 * 1024;

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true' };

// next(): the next job ({ key, kind: 'code' | 'shot', code?, root?, scale? }) or null when the queue is empty; it is
// called after the previous job's onResult, so it can read what that result changed.
// onResult(job, { ok, text?, png?, error? }) -> { ok, msg }; ok false stops the queue.
// total: the job count shown by the plugin (null when unknown). Resolves to { port, session, done, close }: done resolves to { ok, reason?, jobs: [{ key, kind, ok, ms, bytesOut, bytesIn, msg }] }.
export function startBridge({ next, onResult, port = BRIDGE_PORT, host = '127.0.0.1', log = () => {}, connectTimeoutMs = 300000, jobTimeoutMs = 300000, lingerMs = 3000, total = null }) {
  const session = randomBytes(4).toString('hex');
  const jobs = [];
  let cur = null, curAt = 0, finished = null, ids = 0, connected = false, busy = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let timer = null;
  const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => finish(false, why), ms); };
  const finish = (ok, reason) => {
    if (finished) return;
    clearTimeout(timer);
    finished = { ok, ...(reason ? { reason } : {}), jobs };
    // keep answering { done } for a moment so the plugin sees the end, then close
    setTimeout(() => { for (const sv of servers) { sv.close(); sv.closeAllConnections(); } resolveDone(finished); }, lingerMs);
  };
  // the next job; a next() that throws stops the queue (never serve the finished job again). A new job arms the job
  // timeout at once, so a plugin closed between two jobs still ends the run.
  const advance = () => {
    cur = null;
    let j;
    try { j = next(); } catch (e) { finish(false, `next job: ${String((e && e.message) || e)}`); return; }
    if (!j) { finish(true); return; }
    cur = { ...j, id: ++ids };
    curAt = 0;
    if (connected) arm(jobTimeoutMs, `the plugin did not ask for ${cur.key} within ${Math.round(jobTimeoutMs / 1000)} s`);
  };
  const send = (res, code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((ok, bad) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { bad(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', bad);
  });

  const handler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      // the plugin UI iframe has origin null; a web page open in a browser sends its own origin: refused
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== 'null') return send(res, 403, { ok: false, msg: 'origin not allowed' });
      const u = new URL(req.url, 'http://x');
      if (req.method === 'GET' && u.pathname === '/next') {
        if (!connected) { connected = true; log(`plugin connected (session ${session})`); }
        if (finished) return send(res, 200, { session, done: true, ok: finished.ok });
        if (busy || !cur) return send(res, 200, { session, wait: true });
        if (!curAt) { curAt = Date.now(); arm(jobTimeoutMs, `no result for ${cur.key} within ${Math.round(jobTimeoutMs / 1000)} s`); }
        const { id, key, kind, code, root, scale } = cur;
        return send(res, 200, { session, id, key, kind, ...(code != null ? { code } : {}), ...(root ? { root, scale } : {}), n: jobs.length + 1, of: total });
      }
      if (req.method === 'POST' && (u.pathname === '/result' || u.pathname === '/shot')) {
        const id = Number(u.searchParams.get('id'));
        const buf = await body(req);
        if (finished || busy || !cur || id !== cur.id) return send(res, 409, { ok: false, msg: 'not the current job' });
        let payload;
        if (u.pathname === '/shot') payload = { ok: true, png: buf };
        else {
          try { payload = JSON.parse(buf.toString('utf8')); } catch { payload = { ok: false, error: 'the plugin sent malformed JSON' }; }
        }
        busy = true;
        const job = cur;
        let r;
        try { r = await onResult(job, payload); } catch (e) { r = { ok: false, msg: String((e && e.message) || e) }; }
        const bytesOut = job.code != null ? Buffer.byteLength(job.code) : 0;
        jobs.push({ key: job.key, kind: job.kind, ok: !!r.ok, ms: Date.now() - curAt, bytesOut, bytesIn: buf.length, msg: r.msg });
        busy = false;
        send(res, 200, { ok: !!r.ok, msg: r.msg });
        if (!r.ok) { cur = null; finish(false, `${job.key}: ${r.msg}`); return; }
        clearTimeout(timer);
        advance();
        return;
      }
      if (req.method === 'GET' && u.pathname === '/') return send(res, 200, { ok: true, msg: 'vuong-design bridge', session });
      send(res, 404, { ok: false, msg: 'not found' });
    } catch (e) {
      try { send(res, 500, { ok: false, msg: String((e && e.message) || e) }); } catch { /* closed */ }
    }
  };
  // the plugin calls http://localhost (Figma only accepts localhost in devAllowedDomains), which may resolve to ::1 on
  // Windows: listen on 127.0.0.1 and, when IPv6 is there, on ::1 at the same port
  const server = http.createServer(handler);
  const servers = [server];

  return new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, host, () => {
      server.off('error', bad);
      if (host === '127.0.0.1') {
        const v6 = http.createServer(handler);
        v6.once('error', () => { /* no IPv6 loopback, or the port is taken there: IPv4 only */ });
        v6.listen(server.address().port, '::1', () => servers.push(v6));
      }
      advance();
      if (!finished) arm(connectTimeoutMs, `no plugin connected within ${Math.round(connectTimeoutMs / 1000)} s (open Plugins > Development > vuong-design bridge in Figma Desktop)`);
      ok({ port: server.address().port, session, done, close: () => finish(false, 'closed') });
    });
  });
}
