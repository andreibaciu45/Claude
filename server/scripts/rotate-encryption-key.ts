// Rotazione della chiave di cifratura applicativa (vedi src/db/seal.ts e server/README.md).
//
// Procedura:
//   1. Genera la nuova chiave:   openssl rand -base64 32
//   2. Imposta  APP_ENCRYPTION_KEY=<nuova>  APP_ENCRYPTION_KEY_ID=k2  APP_ENCRYPTION_OLD_KEYS="k1:<vecchia>"  e riavvia il server.
//      Da qui le nuove scritture usano k2 e le vecchie si leggono ancora (nessun downtime).
//   3. (opzionale) ricifra i dati esistenti:   DB_PATH=... npx tsx scripts/rotate-encryption-key.ts [--include-locked]
//      - bozze/preventivi, profili e log di sync vengono ricifrati con la chiave corrente;
//      - le fatture emesse (immutabili per trigger) vengono saltate, a meno di --include-locked: in tal caso, dentro UNA transazione,
//        il trigger di immutabilità viene sospeso solo per riscrivere i campi cifrati (il contenuto in chiaro resta identico) e subito ricreato.
//        Fare un backup PRIMA (scripts/backup.ts).
//      - audit_log è append-only (trigger): le voci vecchie restano con la chiave originale => conservare la vecchia chiave in OLD_KEYS finché serve l'audit.
//   4. Quando `--report` mostra 0 righe con le vecchie chiavi, la vecchia chiave può essere rimossa da OLD_KEYS (dopo aver archiviato i backup che ne dipendono).
import { pathToFileURL } from 'node:url';
import { all, getDb, run, transaction } from '../src/db';
import { aadChange, aadProfile, documentKeyIds, getKeyRing, open, openDocument, sealDocument, sealJson, sealedKeyId, isSealed } from '../src/db/seal';

export interface RotationReport { documents: number; lockedSkipped: number; changes: number; profiles: number; remainingOldKey: Record<string, number> }

export function rotate(opts: { includeLocked?: boolean; dryRun?: boolean } = {}): RotationReport {
  const ring = getKeyRing();
  if (!ring) throw new Error('APP_ENCRYPTION_KEY non impostata');
  const cur = ring.current.id;
  const rep: RotationReport = { documents: 0, lockedSkipped: 0, changes: 0, profiles: 0, remainingOldKey: {} };
  const db = getDb();
  const trig = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_documents_locked_update'").get() as { sql: string } | undefined;

  transaction(() => {
    const docs = all<{ tenant_id: string; id: string; locked_at: number | null; data: string; deleted_at: number | null }>('SELECT tenant_id, id, locked_at, data, deleted_at FROM documents WHERE deleted_at IS NULL');
    const lockedToDo: { t: string; id: string; data: string }[] = [];
    for (const d of docs) {
      const raw = JSON.parse(d.data);
      const ids = documentKeyIds(raw);
      const needs = ids.some((k) => k !== cur) || (ids.length === 0 && (raw.customer || raw.notes || raw.transcript || raw.invoice?.xml));
      if (!needs) continue;
      const fresh = JSON.stringify(sealDocument(d.tenant_id, openDocument(d.tenant_id, raw)));
      if (d.locked_at !== null) {
        if (!opts.includeLocked) { rep.lockedSkipped++; continue; }
        lockedToDo.push({ t: d.tenant_id, id: d.id, data: fresh });
      } else {
        if (!opts.dryRun) run('UPDATE documents SET data=? WHERE tenant_id=? AND id=?', fresh, d.tenant_id, d.id);
        rep.documents++;
      }
    }
    if (lockedToDo.length && !opts.dryRun) {
      if (!trig) throw new Error('trigger trg_documents_locked_update non trovato: schema inatteso');
      run('DROP TRIGGER trg_documents_locked_update');
      for (const l of lockedToDo) run('UPDATE documents SET data=? WHERE tenant_id=? AND id=?', l.data, l.t, l.id);
      db.exec(trig.sql); // ricrea il trigger identico (stessa transazione: se qualcosa fallisce, rollback totale)
    }
    rep.documents += lockedToDo.length;

    for (const r of all<{ tenant_id: string; data: string }>('SELECT tenant_id, data FROM profiles')) {
      if (sealedKeyId(r.data) === cur) continue;
      if (!opts.dryRun) run('UPDATE profiles SET data=? WHERE tenant_id=?', sealJson(JSON.parse(open(r.data, aadProfile(r.tenant_id))), aadProfile(r.tenant_id)), r.tenant_id);
      rep.profiles++;
    }
    for (const c of all<{ seq: number; tenant_id: string; entity: string; entity_id: string; payload: string | null }>('SELECT seq, tenant_id, entity, entity_id, payload FROM changes WHERE payload IS NOT NULL')) {
      if (sealedKeyId(c.payload) === cur) continue;
      const aad = aadChange(c.tenant_id, c.entity, c.entity_id);
      if (!opts.dryRun) run('UPDATE changes SET payload=? WHERE seq=?', sealJson(JSON.parse(open(c.payload!, aad)), aad), c.seq);
      rep.changes++;
    }
  });

  // Quanto resta cifrato con chiavi diverse dalla corrente (audit_log e fatture saltate)
  const bump = (k: string | null) => { if (k && k !== cur) rep.remainingOldKey[k] = (rep.remainingOldKey[k] ?? 0) + 1; };
  for (const d of all<{ data: string }>('SELECT data FROM documents')) for (const k of documentKeyIds(JSON.parse(d.data))) bump(k);
  for (const a of all<{ payload: string | null }>('SELECT payload FROM audit_log WHERE payload IS NOT NULL')) if (isSealed(a.payload)) bump(sealedKeyId(a.payload));
  return rep;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const rep = rotate({ includeLocked: args.includes('--include-locked'), dryRun: args.includes('--report') || args.includes('--dry-run') });
  console.log(JSON.stringify(rep, null, 2));
}
