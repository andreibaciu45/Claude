'use strict';
/**
 * Calcola gli hash SHA-256 degli <style> inline (e degli attributi style="...") presenti nei file HTML di una build
 * e verifica che la CSP dei Caddyfile li elenchi tutti (e non ne elenchi di inutili).
 *
 *   node scripts/audit/csp-hashes.cjs <dist> [--print]
 *
 * Perche': la CSP non usa 'unsafe-inline' per gli stili; gli <style> inline di index.html, offline.html, pagine legali
 * e prodotto.html sono ammessi SOLO se il loro hash e' in `style-src`; gli attributi style="" (1 nelle guide) in
 * `style-src-attr 'unsafe-hashes'`. Se qualcuno modifica quei file l'hash cambia: questo script (e il test) lo segnala.
 * Codici di uscita: 0 ok, 1 CSP non allineata.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');

const h = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.html')) out.push(p); } return out; }

function collect(dist) {
  const blocks = new Map(); // hash -> file[]
  const attrs = new Map();
  for (const f of walk(dist)) {
    const html = fs.readFileSync(f, 'utf8');
    const rel = path.relative(dist, f);
    for (const m of html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)) { const k = h(m[1]); blocks.set(k, [...(blocks.get(k) || []), rel]); }
    for (const m of html.matchAll(/\sstyle="([^"]*)"/gi)) { const k = h(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); attrs.set(k, [...(attrs.get(k) || []), rel]); }
  }
  return { blocks, attrs };
}

function cspDirective(csp, name) { const m = new RegExp('(?:^|;)\\s*' + name + '\\s+([^;]*)').exec(csp); return m ? m[1].trim().split(/\s+/) : null; }

function check(dist, caddyfile) {
  const txt = fs.readFileSync(caddyfile, 'utf8');
  const csp = /Content-Security-Policy "([^"]+)"/.exec(txt)[1];
  const { blocks, attrs } = collect(dist);
  const problems = [];
  const styleSrc = cspDirective(csp, 'style-src') || [];
  const attrSrc = cspDirective(csp, 'style-src-attr') || [];
  if (styleSrc.includes("'unsafe-inline'")) problems.push("style-src contiene 'unsafe-inline'");
  for (const [k, files] of blocks) if (!styleSrc.includes(k)) problems.push(`manca in style-src: ${k}  (${[...new Set(files)].join(', ')})`);
  for (const k of styleSrc.filter((x) => x.startsWith("'sha256-"))) if (!blocks.has(k)) problems.push(`hash in style-src senza corrispondenza nella build: ${k}`);
  for (const [k, files] of attrs) if (!attrSrc.includes(k)) problems.push(`manca in style-src-attr: ${k}  (${[...new Set(files)].join(', ')})`);
  for (const k of attrSrc.filter((x) => x.startsWith("'sha256-"))) if (!attrs.has(k)) problems.push(`hash in style-src-attr senza corrispondenza: ${k}`);
  return { problems, blocks, attrs };
}

module.exports = { collect, check, cspDirective };

if (require.main === module) {
  const dist = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  if (process.argv.includes('--print')) {
    const { blocks, attrs } = collect(dist);
    console.log('style-src hash:\n  ' + [...blocks.keys()].join(' '));
    console.log('style-src-attr hash:\n  ' + [...attrs.keys()].join(' '));
    process.exit(0);
  }
  let bad = 0;
  for (const cf of ['infra/Caddyfile', 'infra/Caddyfile.nodocker']) {
    const r = check(dist, path.join(ROOT, cf));
    console.log(`${cf}: ${r.problems.length ? 'NON ALLINEATA' : 'OK'} (${r.blocks.size} blocchi <style>, ${r.attrs.size} attributi style)`);
    for (const p of r.problems) console.log('  - ' + p);
    bad += r.problems.length;
  }
  process.exit(bad ? 1 : 0);
}
