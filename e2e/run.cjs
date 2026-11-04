#!/usr/bin/env node
'use strict';
/**
 * Runner della suite E2E.
 *   node e2e/run.cjs                 build + avvio preview/server + tutti gli scenari
 *   node e2e/run.cjs --only 02,05    solo alcuni scenari (prefisso numerico o parte del nome)
 *   node e2e/run.cjs --no-build      non ricostruisce e2e/tmp/dist
 *   node e2e/run.cjs --no-servers    usa preview (:4180) e server (:8798) gia in esecuzione
 * Esito: 0 se tutti PASS, 1 altrimenti. Screenshot e result.json in e2e/out/<scenario>/, riepilogo in e2e/out/summary.json.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startEnv } = require('../scripts/qa/env.cjs');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const only = (args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean);
const dir = path.join(__dirname, 'scenarios');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort().filter((f) => !only.length || only.some((o) => f.includes(o)));

(async () => {
  let env = null;
  if (!has('--no-servers')) env = await startEnv({ build: !has('--no-build') });
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const rows = [];
  for (const f of files) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 8 * 60_000, env: process.env });
    const name = f.replace(/\.cjs$/, '');
    let res = null;
    try { res = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', name, 'result.json'), 'utf8')); } catch { /* scenario crashato prima di scrivere */ }
    const failed = res ? res.checks.filter((c) => !c.ok) : [];
    rows.push({ name, status: res ? res.status : 'FAIL', total: res ? res.checks.length : 0, failed: failed.map((c) => ({ name: c.name, detail: c.detail })), secs: Math.round((Date.now() - t0) / 1000), crashed: !res, log: !res ? (r.stdout + r.stderr).slice(-800) : undefined });
    process.stdout.write(`${rows.at(-1).status === 'PASS' ? 'PASS' : 'FAIL'}  ${name}  (${rows.at(-1).total - failed.length}/${rows.at(-1).total}, ${rows.at(-1).secs}s)\n`);
  }
  if (env) env.stop();
  fs.writeFileSync(path.join(__dirname, 'out', 'summary.json'), JSON.stringify(rows, null, 2));
  console.log('\n=========== RIEPILOGO ===========');
  for (const r of rows) {
    console.log(`${r.status}  ${r.name}  ${r.total - r.failed.length}/${r.total}`);
    for (const c of r.failed) console.log(`      x ${c.name}${c.detail ? '  -> ' + String(c.detail).slice(0, 160).replace(/\n+/g, ' ') : ''}`);
    if (r.crashed) console.log('      (scenario terminato in modo anomalo)\n' + r.log);
  }
  const bad = rows.filter((r) => r.status !== 'PASS').length;
  console.log(`\n${rows.length - bad}/${rows.length} scenari PASS`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
