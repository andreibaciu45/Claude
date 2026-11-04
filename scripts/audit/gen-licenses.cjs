'use strict';
/**
 * Inventario licenze delle dipendenze di PRODUZIONE (root, server, mobile) letto da package-lock.json + node_modules.
 *   node scripts/audit/gen-licenses.cjs                 stampa la tabella Markdown (versione, licenza, autore) su stdout
 *   node scripts/audit/gen-licenses.cjs --json          JSON
 *   node scripts/audit/gen-licenses.cjs --notices out.txt   testo completo degli avvisi (nome, versione, licenza, copyright e
 *                                                      testo del file LICENSE di ogni pacchetto) da pubblicare nell'app / sul sito
 * Richiede `npm ci` gia' eseguito in ognuna delle tre cartelle. NON e' consulenza legale.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS = [
  { id: 'root', dir: ROOT, label: 'PWA (browser)' },
  { id: 'server', dir: path.join(ROOT, 'server'), label: 'Server API' },
  { id: 'mobile', dir: path.join(ROOT, 'mobile'), label: 'App nativa (Capacitor)' },
];

function readProject(p) {
  const lock = JSON.parse(fs.readFileSync(path.join(p.dir, 'package-lock.json'), 'utf8'));
  const direct = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(p.dir, 'package.json'), 'utf8')).dependencies || {}));
  const rows = [];
  for (const [k, v] of Object.entries(lock.packages)) {
    if (!k || v.dev) continue;
    const name = v.name || k.replace(/^.*node_modules\//, '');
    let pj = {};
    const dir = path.join(p.dir, k);
    try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* non installato (es. binario di altra piattaforma) */ }
    const license = pj.license || (pj.licenses ? JSON.stringify(pj.licenses) : '') || v.license || 'SCONOSCIUTA';
    const author = typeof pj.author === 'string' ? pj.author.replace(/\s*<[^>]*>|\s*\([^)]*\)/g, '').trim() : (pj.author && pj.author.name) || '';
    let licFile = '';
    try { const f = fs.readdirSync(dir).find((x) => /^(licen[sc]e|copying)(\.|$)/i.test(x)); if (f) licFile = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* nessun file */ }
    rows.push({ project: p.id, name, version: v.version, license, author, direct: direct.has(name) && k === `node_modules/${name}`, optional: !!v.optional, installed: !!pj.name, licFile });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

const all = PROJECTS.flatMap(readProject);
if (process.argv.includes('--json')) { console.log(JSON.stringify(all.map(({ licFile, ...r }) => r), null, 1)); process.exit(0); }
const ni = process.argv.indexOf('--notices');
if (ni >= 0) {
  const seen = new Set();
  let out = 'AVVISI DI TERZE PARTI — VocePreventivo\n\nQuesto prodotto include software di terze parti distribuito con le licenze indicate sotto.\nI nomi e i marchi appartengono ai rispettivi titolari.\n\n';
  for (const r of all.filter((x) => x.installed && x.project !== 'server')) { // il server non viene distribuito agli utenti
    const key = `${r.name}@${r.version}`;
    if (seen.has(key)) continue; seen.add(key);
    out += `================================================================\n${r.name} ${r.version}\nLicenza: ${r.license}${r.author ? `\nAutore/titolare: ${r.author}` : ''}\n\n${r.licFile ? r.licFile.trim() : '(il pacchetto non include un file di licenza: vedere la licenza SPDX indicata sopra)'}\n\n`;
  }
  fs.writeFileSync(process.argv[ni + 1], out);
  console.error(`scritto ${process.argv[ni + 1]} (${seen.size} pacchetti, ${Math.round(out.length / 1024)} KB)`);
  process.exit(0);
}
for (const p of PROJECTS) {
  console.log(`\n### ${p.label}\n\n| Pacchetto | Versione | Licenza | Diretta | Note |\n|---|---|---|---|---|`);
  const rows = all.filter((x) => x.project === p.id);
  const bin = rows.filter((x) => x.name.startsWith('@esbuild/'));
  for (const r of rows.filter((x) => !x.name.startsWith('@esbuild/'))) {
    console.log(`| ${r.name} | ${r.version} | ${r.license} | ${r.direct ? 'sì' : ''} | ${[r.optional ? 'opzionale' : '', r.licFile || !r.installed ? '' : 'senza file LICENSE'].filter(Boolean).join(', ')} |`);
  }
  if (bin.length) console.log(`| @esbuild/* (${bin.length} binari per piattaforma di esbuild) | ${bin[0].version} | ${[...new Set(bin.map((b) => b.license))].join(', ')} |  | opzionali: se ne installa uno solo |`);
}
