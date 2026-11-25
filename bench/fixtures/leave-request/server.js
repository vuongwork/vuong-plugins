// Leave request app: static files + JSON API, data in memory (reset on restart).
//   node server.js            PORT (default 3210), LEAVE_TODAY=YYYY-MM-DD to pin "today"
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./lib/leave.js');

const PORT = +process.env.PORT || 3210;
const ANNUAL = 12;
const today = () => process.env.LEAVE_TODAY || L.toDateString(new Date());
const now = () => new Date().toISOString();

const seed = [
  ['LV-20261110-001', 'E001', 'annual', '2026-11-10', '2026-11-11', 'full', 'approved'],
  ['LV-20261112-001', 'E001', 'sick', '2026-11-12', '2026-11-12', 'am', 'rejected'],
  ['LV-20261124-001', 'E001', 'annual', '2026-12-01', '2026-12-02', 'full', 'pending'],
  ['LV-20261124-002', 'E001', 'personal', '2026-12-10', '2026-12-10', 'full', 'draft'],
  ['LV-20261124-003', 'E002', 'annual', '2026-12-03', '2026-12-03', 'full', 'draft'],
];
const leaves = new Map(seed.map(([id, owner, type, from, to, part, status]) =>
  [id, { id, owner, type, from, to, part, days: L.workingDays(from, to, part), reason: '', status, createdAt: now(), updatedAt: now() }]));

function newId() {
  const day = today().replace(/-/g, '');
  let n = 1;
  while (leaves.has(`LV-${day}-${String(n).padStart(3, '0')}`)) n++;
  return `LV-${day}-${String(n).padStart(3, '0')}`;
}

function balance(user) {
  let used = 0;
  for (const l of leaves.values()) if (l.owner === user && l.type === 'annual' && (l.status === 'pending' || l.status === 'approved')) used += l.days;
  return { annual: ANNUAL, used, remaining: ANNUAL - used };
}

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const fail = (res, status, code, vars) => send(res, status, { code, message: L.message(code, vars) });

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } });
  });
}

function fields(body) {
  const b = body || {};
  return { type: b.type, from: b.from, to: b.to, part: L.normalizePart(b.from, b.to, b.part), reason: String(b.reason || '') };
}

// Find a leave of the caller: [leave] or [null, status, code]
function own(id, user) {
  const l = leaves.get(id);
  if (!l) return [null, 404, 'LV-E404'];
  if (l.owner !== user) return [null, 403, 'LV-E403'];
  return [l];
}

async function api(req, res, url, user) {
  const parts = url.pathname.split('/').filter(Boolean); // api, leaves, :id, action
  if (req.method === 'GET' && url.pathname === '/api/leave-balance') return send(res, 200, balance(user));
  if (parts[1] !== 'leaves') return fail(res, 404, 'LV-E404');
  const id = parts[2], action = parts[3];

  if (req.method === 'POST' && !id) {
    const f = fields(await readBody(req));
    const errors = L.validate(f, today());
    if (errors.length) return fail(res, 400, errors[0].code);
    const l = { id: newId(), owner: user, ...f, days: L.workingDays(f.from, f.to, f.part), status: 'draft', createdAt: now(), updatedAt: now() };
    leaves.set(l.id, l);
    return send(res, 201, l);
  }
  const [l, status, code] = own(id, user);
  if (!l) return fail(res, status, code);

  if (req.method === 'GET' && !action) return send(res, 200, l);
  if (req.method === 'PUT' && !action) {
    const f = fields(await readBody(req));
    const errors = L.validate(f, today());
    if (errors.length) return fail(res, 400, errors[0].code);
    Object.assign(l, f, { days: L.workingDays(f.from, f.to, f.part), updatedAt: now() });
    return send(res, 200, l);
  }
  if (req.method === 'POST' && action === 'submit') {
    if (l.status !== 'draft') return fail(res, 409, 'LV-E409');
    const b = balance(user);
    if (l.type === 'annual' && l.days > b.remaining) return fail(res, 400, 'LV-E04', { n: L.formatDays(b.remaining) });
    Object.assign(l, { status: 'pending', updatedAt: now() });
    return send(res, 200, l);
  }
  if (req.method === 'POST' && action === 'cancel') {
    if (!['draft', 'pending', 'approved'].includes(l.status)) return fail(res, 409, 'LV-E409');
    Object.assign(l, { status: 'cancelled', updatedAt: now() });
    return send(res, 200, l);
  }
  return fail(res, 404, 'LV-E404');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const STATIC = { '/': 'public/index.html', '/app.js': 'public/app.js', '/styles.css': 'public/styles.css', '/leave.js': 'lib/leave.js' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const user = req.headers['x-user'];
    if (!user) return send(res, 401, { code: 'LV-E401', message: 'Unauthorized' });
    try { return await api(req, res, url, String(user)); } catch (e) { return send(res, 500, { code: 'LV-E500', message: String(e.message) }); }
  }
  const file = STATIC[url.pathname];
  if (!file) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
  fs.createReadStream(path.join(__dirname, file)).pipe(res);
});

if (require.main === module) server.listen(PORT, () => console.log(`leave app on http://localhost:${PORT}`));
module.exports = { server, leaves, balance };
