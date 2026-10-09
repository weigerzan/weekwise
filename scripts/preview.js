import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStore } from '../desktop/store.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(path.join(root, '.preview-data'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 4173);
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    if (pathname === '/api/state') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET') return res.end(JSON.stringify(await store.read()));
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://127.0.0.1:${port}`) { res.writeHead(403); return res.end('{}'); }
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8_000_000) { res.writeHead(413); return res.end('{}'); } }
        const payload = JSON.parse(body); await store.write(payload.state, payload.previous); return res.end('{"ok":true}');
      }
      res.writeHead(405); return res.end('{}');
    }
    const filename = path.resolve(root, 'src', decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html');
    if (!filename.startsWith(path.join(root, 'src') + path.sep)) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
    res.end(await readFile(filename));
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end(JSON.stringify({ error: error.message })); }
});
server.listen(port, '127.0.0.1', () => console.log(`拾周预览：http://127.0.0.1:${port}`));
