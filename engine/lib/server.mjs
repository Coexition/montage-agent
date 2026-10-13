// Serveur HTTP minimal (sans dépendance) : fichiers statiques avec Range, montages de dossiers, routes API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

export function sendFile(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end('not found'); }
  if (st.isDirectory()) { res.writeHead(404); return res.end('dir'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (!m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
    if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

export function readBody(req, limit = 1e9) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export async function readJSON(req) {
  const b = await readBody(req, 50e6);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}

export function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

/**
 * createServer({ mounts: { '/engine': dir, ... }, routes: [[method, regex, handler]], index })
 */
export function createServer({ mounts = {}, routes = [], fallback } = {}) {
  const prefixes = Object.keys(mounts).sort((a, b) => b.length - a.length);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      for (const [method, re, handler] of routes) {
        if (method !== '*' && method !== req.method) continue;
        const m = re.exec(p);
        if (m) return await handler(req, res, m, url);
      }
      for (const pre of prefixes) {
        if (p === pre || p.startsWith(pre + '/')) {
          const root = path.resolve(mounts[pre]);
          const rel = p.slice(pre.length) || '/index.html';
          const file = path.resolve(root, '.' + rel);
          if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
          return sendFile(req, res, file);
        }
      }
      if (fallback) return await fallback(req, res, url);
      res.writeHead(404);
      res.end('not found');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end(String(e?.message || e));
    }
  });
}

export function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onErr = (e) => reject(e);
    server.once('error', onErr);
    server.listen(port, host, () => {
      server.off('error', onErr);
      resolve(server.address().port);
    });
  });
}
