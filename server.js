// ローカル専用のデータ・画像サーバー。Node.js だけで動作します。
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'store.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
let store = { docs: {} };

function safePart(value) { return typeof value === 'string' && value && !value.includes('..') && !value.includes('\\') && !value.includes('/'); }
function safeDocPath(value) { return typeof value === 'string' && value && !value.split('/').some((part) => !safePart(part)); }
function deepCopy(value) { return JSON.parse(JSON.stringify(value)); }
function merge(target, patch) {
  const out = { ...(target || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.__delete__ === true) delete out[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = merge(out[key], value);
    else out[key] = value;
  }
  return out;
}
async function load() { try { store = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8')); } catch (_) { await save(); } }
async function save() { await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true }); await fsp.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8'); }
function send(res, status, body, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { const chunks = []; req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
function query(url, name) { return url.searchParams.get(name) || ''; }
function mime(file) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

async function api(req, res, url) {
  if (url.pathname === '/api/doc') {
    const docPath = query(url, 'path');
    if (!safeDocPath(docPath)) return send(res, 400, { error: 'invalid_path' });
    if (req.method === 'GET') return send(res, 200, { exists: Object.hasOwn(store.docs, docPath), data: store.docs[docPath] || null });
    if (req.method === 'DELETE') { delete store.docs[docPath]; await save(); return send(res, 200, { ok: true }); }
    const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (req.method === 'PUT') store.docs[docPath] = deepCopy(payload.data || {});
    else if (req.method === 'PATCH') store.docs[docPath] = merge(store.docs[docPath], payload.data || {});
    else return send(res, 405, { error: 'method_not_allowed' });
    await save(); return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/collection' && req.method === 'GET') {
    const collectionPath = query(url, 'path');
    if (!safeDocPath(collectionPath)) return send(res, 400, { error: 'invalid_path' });
    const prefix = collectionPath + '/';
    const docs = Object.entries(store.docs).filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(([key, data]) => ({ id: key.slice(prefix.length), data }));
    return send(res, 200, { docs });
  }
  if (url.pathname === '/api/collection' && req.method === 'POST') {
    const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!safeDocPath(payload.path)) return send(res, 400, { error: 'invalid_path' });
    const id = crypto.randomUUID().replace(/-/g, '');
    store.docs[`${payload.path}/${id}`] = deepCopy(payload.data || {}); await save();
    return send(res, 201, { id });
  }
  if (url.pathname === '/api/assets' && req.method === 'POST') {
    const name = req.headers['x-file-name'] || 'image';
    const ext = path.extname(String(name)).replace(/[^.a-z0-9]/gi, '').slice(0, 12);
    const id = crypto.randomUUID().replace(/-/g, '') + ext;
    await fsp.writeFile(path.join(UPLOAD_DIR, id), await readBody(req));
    return send(res, 201, { id });
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) { const handled = await api(req, res, url); if (handled !== false) return; }
    if (url.pathname.startsWith('/_blob/')) {
      const id = decodeURIComponent(url.pathname.slice(7));
      if (!safePart(id)) return send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
      const file = path.join(UPLOAD_DIR, id); if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      res.writeHead(200, { 'Content-Type': mime(file) }); return fs.createReadStream(file).pipe(res);
    }
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!safePart(requested)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const file = path.join(ROOT, requested); if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(res);
  } catch (error) { console.error(error); if (!res.headersSent) send(res, 500, { error: 'server_error' }); else res.end(); }
});

load().then(() => fsp.mkdir(UPLOAD_DIR, { recursive: true })).then(() => server.listen(PORT, HOST, () => console.log(`シノビガミ資料庫: http://${HOST}:${PORT}`)));
