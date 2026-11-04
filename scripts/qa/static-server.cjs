'use strict';
// Server statico minimale per la PWA gia' costruita (SPA: fallback su index.html). Uso: node static-server.cjs <dir> <porta>
const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2] || 'e2e/tmp/dist');
const port = Number(process.argv[3] || 4180);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(dir, p);
  if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { if (path.extname(p)) { res.writeHead(404); return res.end('not found'); } f = path.join(dir, 'index.html'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('static su', port));
