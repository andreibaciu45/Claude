'use strict';
/**
 * Serve una build della PWA (vite build) applicando ESATTAMENTE gli header e le regole di cache
 * dei Caddyfile di produzione (li legge e li interpreta: nessuna copia a mano).
 *
 *   node scripts/audit/serve-with-headers.cjs --dist <cartella> [--caddyfile infra/Caddyfile] [--port 4190] [--api http://127.0.0.1:8798]
 *   node scripts/audit/serve-with-headers.cjs --check     confronta infra/Caddyfile e infra/Caddyfile.nodocker (esce 1 se differiscono)
 *
 * Come Caddy: /v1/* e /health vanno al server API (proxy), Cache-Control no-store;
 * /assets/* immutabili; /sw.js no-cache; resto = file statico o fallback su /index.html.
 * Limite: HTTP in chiaro su 127.0.0.1 (Chrome considera localhost "secure context": SW e microfono funzionano);
 * HSTS e' presente ma ignorato dal browser su http.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Estrae da un Caddyfile: header di sicurezza (blocco `header {}` del sito) e regole di cache dei blocchi handle. */
function parseCaddyfile(text) {
  const lines = text.split(/\r?\n/);
  const out = { headers: [], removed: [], cache: { api: null, assets: null, sw: null, html: null, static: null }, staticPattern: [], root: null, upstream: null };
  const unq = (s) => s.replace(/^"/, '').replace(/"$/, '');
  // blocco header { ... } di primo livello nel sito (senza matcher)
  let i = lines.findIndex((l) => /^\s*header\s*\{\s*$/.test(l));
  if (i < 0) throw new Error('blocco header {} non trovato');
  for (i = i + 1; i < lines.length && !/^\s*\}\s*$/.test(lines[i]); i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('-')) { out.removed.push(l.slice(1)); continue; }
    const m = /^(\S+)\s+(.*)$/.exec(l);
    if (!m) throw new Error('riga header non valida: ' + l);
    out.headers.push([m[1], unq(m[2].trim())]);
  }
  const grab = (re) => { const m = re.exec(text); return m ? m[1] : null; };
  out.cache.api = grab(/handle @api \{[\s\S]*?header Cache-Control "([^"]+)"/);
  out.cache.assets = grab(/handle \/assets\/\* \{[\s\S]*?header Cache-Control "([^"]+)"/);
  out.cache.sw = grab(/handle \/sw\.js \{[\s\S]*?header Cache-Control "([^"]+)"/);
  out.cache.html = grab(/handle \{\s*root \* \S+[\s\S]*?\n\t\theader Cache-Control "([^"]+)"/); // default del blocco finale
  out.cache.static = grab(/header @static Cache-Control "([^"]+)"/);
  const sp = grab(/@static path ([^\n]+)/);
  out.staticPattern = sp ? sp.trim().split(/\s+/) : [];
  out.root = grab(/handle \/assets\/\* \{\s*root \* (\S+)/);
  out.upstream = grab(/reverse_proxy (\S+)/);
  return out;
}

/** Confronta due configurazioni; ritorna elenco di differenze (vuoto = identiche negli header e nella cache). */
function diffConfigs(a, b) {
  const d = [];
  const ja = JSON.stringify(a.headers), jb = JSON.stringify(b.headers);
  if (ja !== jb) d.push('header diversi:\n  A=' + ja + '\n  B=' + jb);
  if (JSON.stringify(a.removed) !== JSON.stringify(b.removed)) d.push('header rimossi diversi');
  if (JSON.stringify(a.cache) !== JSON.stringify(b.cache)) d.push('regole Cache-Control diverse: ' + JSON.stringify(a.cache) + ' vs ' + JSON.stringify(b.cache));
  if (JSON.stringify(a.staticPattern) !== JSON.stringify(b.staticPattern)) d.push('pattern @static diversi');
  return d;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

function createServer({ dist, cfg, api }) {
  const staticRes = cfg.staticPattern.map(globToRe);
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    const setSec = () => { for (const [k, v] of cfg.headers) res.setHeader(k, v); };
    if (p.startsWith('/v1/') || p === '/health') {
      // proxy verso l'API, come reverse_proxy di Caddy
      const u = new URL(api);
      const preq = http.request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: { ...req.headers, host: u.host } }, (pres) => {
        const h = { ...pres.headers };
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'server') delete h[k];
        for (const [k, v] of cfg.headers) h[k.toLowerCase()] = v;
        h['cache-control'] = cfg.cache.api || 'no-store';
        res.writeHead(pres.statusCode, h);
        pres.pipe(res);
      });
      preq.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(preq);
      return;
    }
    setSec();
    let f = path.normalize(path.join(dist, p));
    if (!f.startsWith(dist)) { res.writeHead(403); return res.end(); }
    let cache = null;
    if (p.startsWith('/assets/')) {
      cache = cfg.cache.assets;
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.setHeader('Cache-Control', 'no-store'); res.writeHead(404); return res.end('not found'); }
    } else if (p === '/sw.js') {
      cache = cfg.cache.sw;
    } else {
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) f = path.join(dist, 'index.html'); // try_files ... /index.html
      cache = cfg.cache.html;
      if (staticRes.some((r) => r.test(p))) cache = cfg.cache.static;
    }
    if (cache) res.setHeader('Cache-Control', cache);
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    res.writeHead(200);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--check')) {
    const A = parseCaddyfile(fs.readFileSync(path.join(ROOT, 'infra/Caddyfile'), 'utf8'));
    const B = parseCaddyfile(fs.readFileSync(path.join(ROOT, 'infra/Caddyfile.nodocker'), 'utf8'));
    const d = diffConfigs(A, B);
    if (d.length) { console.error('DIFFERENZE tra Caddyfile e Caddyfile.nodocker:\n' + d.join('\n')); process.exit(1); }
    console.log('OK: header e regole di cache identici nei due Caddyfile (' + A.headers.length + ' header).');
    process.exit(0);
  }
  const dist = path.resolve(arg('dist', path.join(ROOT, 'dist')));
  const cfg = parseCaddyfile(fs.readFileSync(path.resolve(ROOT, arg('caddyfile', 'infra/Caddyfile')), 'utf8'));
  const port = Number(arg('port', '4190'));
  createServer({ dist, cfg, api: arg('api', 'http://127.0.0.1:8798') }).listen(port, '127.0.0.1', () => console.log(`serve-with-headers su http://127.0.0.1:${port} (dist=${dist})`));
}

module.exports = { parseCaddyfile, diffConfigs, createServer };
