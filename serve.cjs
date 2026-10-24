// Local static preview. No installation required: node serve.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const port = Number(process.env.PORT || 4173);
http.createServer((req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;
  if (requested === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { res.writeHead(400); res.end('Bad URL'); return; }
  const file = path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Planet: http://localhost:${port}`));
