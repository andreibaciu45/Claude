// Controllo all'avvio: la configurazione delle chiavi deve essere coerente con i dati già nel DB.
// Senza questo, se APP_ENCRYPTION_KEY sparisce (file di configurazione perso, variabile rinominata) il server parte "regolarmente" e
//  - scrive i NUOVI dati in chiaro (downgrade silenzioso della cifratura a riposo),
//  - fallisce con 500 su tutto ciò che era già cifrato.
// Se cambia la chiave senza metterla in APP_ENCRYPTION_OLD_KEYS, i dati vecchi diventano illeggibili (500) senza alcun avviso all'avvio.
import type { DatabaseSync } from 'node:sqlite';
import { documentKeyIds, getKeyRing, sealedKeyId } from './seal';

const SAMPLE = 50;

/** Messaggio di errore se la configurazione delle chiavi non copre i dati cifrati presenti (campione recente), altrimenti null. */
export function encryptionConfigProblem(db: DatabaseSync): string | null {
  const kids = new Set<string>();
  const add = (v: unknown) => { const k = sealedKeyId(v); if (k) kids.add(k); };
  const rows = (sql: string) => { try { return db.prepare(sql).all() as Record<string, string | null>[]; } catch { return []; } };
  for (const r of rows(`SELECT data FROM profiles ORDER BY updated_at DESC LIMIT ${SAMPLE}`)) add(r.data);
  for (const r of rows(`SELECT payload FROM changes WHERE payload LIKE 'enc:v1:%' ORDER BY seq DESC LIMIT ${SAMPLE}`)) add(r.payload);
  for (const r of rows(`SELECT payload FROM audit_log WHERE payload LIKE 'enc:v1:%' ORDER BY id DESC LIMIT ${SAMPLE}`)) add(r.payload);
  for (const r of rows(`SELECT data FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${SAMPLE}`)) {
    try { for (const k of documentKeyIds(JSON.parse(String(r.data)))) kids.add(k); } catch { /* riga non valida: la segnala integrity-check */ }
  }
  if (kids.size === 0) return null;
  const ring = getKeyRing();
  if (!ring) return `Il database contiene dati cifrati (chiavi: ${[...kids].join(', ')}) ma APP_ENCRYPTION_KEY non è impostata: il server scriverebbe i nuovi dati in chiaro e non leggerebbe i vecchi. Ripristina la chiave.`;
  const missing = [...kids].filter((k) => !ring.all.has(k));
  if (missing.length) return `Il database contiene dati cifrati con chiavi non configurate (${missing.join(', ')}): aggiungile ad APP_ENCRYPTION_OLD_KEYS prima di avviare il server.`;
  return null;
}
