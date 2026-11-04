// Cifratura applicativa AES-256-GCM dei campi sensibili (APP_ENCRYPTION_KEY) con colonne indicizzate e trigger di immutabilità intatti.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, catalogItem, docOp, freshEnv, invoice, login, opId, push, quote } from './helpers';
import { all, one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { open, openDocument, seal, sealDocument, getKeyRing } from '../../src/db/seal';
import { SqliteDocumentSink, SqliteDocumentSource } from '../../src/sdi/sqlite';
import { patchLockedDocument, getDocument } from '../../src/documents/repo';
import { rotate } from '../../scripts/rotate-encryption-key';

const K1 = Buffer.alloc(32, 1).toString('base64');
const K2 = Buffer.alloc(32, 2).toString('hex');
const setKeys = (v: { key?: string; id?: string; old?: string }) => {
  for (const [k, x] of [['APP_ENCRYPTION_KEY', v.key], ['APP_ENCRYPTION_KEY_ID', v.id], ['APP_ENCRYPTION_OLD_KEYS', v.old]] as const) {
    if (x === undefined) delete process.env[k]; else process.env[k] = x;
  }
};
beforeEach(() => { freshEnv(); setKeys({ key: K1, id: 'k1' }); });
afterEach(() => setKeys({}));

const SECRET = 'SEGRETO-ANAGRAFICA';
const rawData = (id: string) => one<{ data: string }>('SELECT data FROM documents WHERE id=?', id)!.data;

describe('seal/open', () => {
  it('round-trip, IV casuale vs deterministico, AAD vincolante, manomissione rilevata', () => {
    const a = seal('ciao', 'aad1'), b = seal('ciao', 'aad1');
    expect(a).not.toBe(b); // IV casuale
    expect(a).toMatch(/^enc:v1:k1:[A-Za-z0-9_-]+$/);
    expect(open(a, 'aad1')).toBe('ciao');
    expect(seal('ciao', 'aad1', 'deterministic')).toBe(seal('ciao', 'aad1', 'deterministic'));
    expect(seal('ciao', 'aad1', 'deterministic')).not.toBe(seal('ciao', 'aad2', 'deterministic'));
    expect(seal('ciao', 'aad1', 'deterministic')).not.toBe(seal('ciao!', 'aad1', 'deterministic'));
    expect(() => open(a, 'aad-diverso')).toThrow(); // non si può spostare un valore su un'altra riga/campo
    const t = a.slice(0, -3) + (a.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(() => open(t, 'aad1')).toThrow();
    expect(open('in chiaro', 'x')).toBe('in chiaro'); // dati pre-cifratura leggibili
  });
  it('senza chiave non cifra; chiave non valida lancia; chiave mancante in lettura lancia', () => {
    setKeys({});
    expect(seal('x', 'a')).toBe('x');
    setKeys({ key: 'troppo-corta' });
    expect(() => getKeyRing()).toThrow(/32 byte/);
    setKeys({ key: K1, id: 'k1' });
    const s = seal('x', 'a');
    setKeys({ key: K2, id: 'k2' });
    expect(() => open(s, 'a')).toThrow(/non disponibile/);
    setKeys({ key: K2, id: 'k2', old: `k1:${K1}` });
    expect(open(s, 'a')).toBe('x');
    expect(() => { setKeys({ key: K2, id: 'k2', old: 'k1' }); getKeyRing(); }).toThrow(/formato/);
  });
});

describe('documenti cifrati a riposo', () => {
  it('il DB non contiene l\'anagrafica in chiaro; API, pull ed export restituiscono il chiaro; colonne indicizzate intatte', async () => {
    const A = await login('a@x.it');
    setEntitlement(A.tenantId, { plan: 'pro' });
    const inv = invoice('f1', 7, { customer: { id: 'c', name: SECRET, vatNumber: '01234567890' }, notes: 'NOTA-' + SECRET, transcript: 'TRASCRIZIONE-' + SECRET });
    (inv.invoice as any).xml = '<xml>' + SECRET + '</xml>';
    await push(A.token, [
      docOp(quote('q1', { customer: { id: 'c', name: SECRET } })), docOp(inv),
      { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', clientTs: 5, payload: { businessName: 'X', vatNumber: '1', iban: 'IT-IBAN-SEGRETO' } } as any,
      { opId: opId(), entity: 'audit', entityId: 'a1', op: 'upsert', clientTs: 5, payload: { id: 'a1', at: 5, docId: 'q1', action: 'x', actor: 'user', detail: 'DETTAGLIO-' + SECRET } } as any,
    ]);
    // a riposo
    const everything = JSON.stringify([all('SELECT * FROM documents'), all('SELECT * FROM changes'), all('SELECT * FROM profiles'), all('SELECT * FROM audit_log')]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('IT-IBAN-SEGRETO');
    expect(rawData('q1')).toContain('enc:v1:k1:');
    // colonne indicizzate e campi non sensibili in chiaro
    expect(one<any>("SELECT number, inv_year, inv_sectional, inv_seq, locked_at, status FROM documents WHERE id='f1'")).toMatchObject({ number: '7/2026', inv_year: 2026, inv_sectional: 'FT', inv_seq: 7, status: 'emessa' });
    // API
    expect((await call('GET', '/v1/documents/q1', { token: A.token })).json.customer.name).toBe(SECRET);
    const pull = (await call('GET', '/v1/sync/pull', { token: A.token })).json.ops;
    const f1 = pull.find((o: any) => o.entityId === 'f1').payload;
    expect(f1.customer.vatNumber).toBe('01234567890');
    expect(f1.notes).toBe('NOTA-' + SECRET);
    expect(f1.invoice.xml).toBe('<xml>' + SECRET + '</xml>');
    expect(pull.find((o: any) => o.entity === 'profile').payload.iban).toBe('IT-IBAN-SEGRETO');
    const exp = (await call('GET', '/v1/me/export', { token: A.token })).json;
    expect(JSON.stringify(exp)).toContain('DETTAGLIO-' + SECRET);
    expect(exp.profile.data.iban).toBe('IT-IBAN-SEGRETO');
  });

  it('numero duplicato e immutabilità continuano a funzionare sui dati cifrati', async () => {
    const A = await login('a@x.it');
    setEntitlement(A.tenantId, { plan: 'pro' });
    await push(A.token, [docOp(invoice('f1', 1, { customer: { id: 'c', name: SECRET } }))]);
    const dup = await push(A.token, [docOp(invoice('f2', 1))]);
    expect(dup.json.conflicts[0].reason).toBe('duplicate_invoice_number');
    // modifica del cliente su fattura emessa: rifiutata (il confronto avviene sul chiaro)
    const tamper = await push(A.token, [docOp(invoice('f1', 1, { customer: { id: 'c', name: 'ALTRO' }, updatedAt: 9000 }))]);
    expect(tamper.json.conflicts[0].reason).toBe('locked_document');
    // aggiornamento ammesso (stato SDI) dal client: il trigger vede i campi cifrati INVARIATI
    const upd: any = invoice('f1', 1, { customer: { id: 'c', name: SECRET }, status: 'inviata', updatedAt: 9000 });
    upd.invoice.sdiEvents = [{ at: 1, type: 'INVIO', channel: 'manual' }];
    const ok = await push(A.token, [docOp(upd)]);
    expect(ok.json.conflicts).toEqual([]);
    expect(getDocument(A.tenantId, 'f1')!.status).toBe('inviata');
    expect(getDocument(A.tenantId, 'f1')!.customer.name).toBe(SECRET);
    expect(rawData('f1')).not.toContain(SECRET);
  });

  it('SDI: sorgente (xml in chiaro al provider), sink e patchLockedDocument operano sul raw senza ricifrare', async () => {
    const A = await login('a@x.it');
    const inv: any = invoice('f1', 1, { customer: { id: 'c', name: SECRET } });
    inv.invoice.xml = '<Fattura>' + SECRET + '</Fattura>'; inv.invoice.fileName = 'f.xml';
    await push(A.token, [docOp(inv)]);
    const src = await new SqliteDocumentSource().getIssuedInvoice(A.tenantId, 'f1');
    expect(src!.xml).toBe('<Fattura>' + SECRET + '</Fattura>');
    const before = rawData('f1');
    await new SqliteDocumentSink().applyEvent(A.tenantId, 'f1', { at: 5, type: 'INVIO', channel: 'provider' });
    await new SqliteDocumentSink().applyEvent(A.tenantId, 'f1', { at: 9, type: 'RC', channel: 'provider' });
    expect(patchLockedDocument(A.tenantId, 'f1', { paymentStatus: 'pagata' })).toBe(true);
    const raw = JSON.parse(rawData('f1'));
    expect(raw.customer).toBe(JSON.parse(before).customer); // byte per byte uguale
    expect(raw.invoice.xml).toBe(JSON.parse(before).invoice.xml);
    expect(raw.status).toBe('consegnata');
    const pulled = (await call('GET', '/v1/sync/pull', { token: A.token })).json.ops[0].payload;
    expect(pulled.customer.name).toBe(SECRET);
    expect(pulled.invoice.paymentStatus).toBe('pagata');
    expect(pulled.invoice.sdiEvents).toHaveLength(2);
  });

  it('rotazione: dati vecchi leggibili con OLD_KEYS, aggiornamento di fattura emessa OK dopo il cambio chiave, nuove scritture con la nuova chiave', async () => {
    const A = await login('a@x.it');
    setEntitlement(A.tenantId, { plan: 'pro' });
    await push(A.token, [docOp(quote('q1', { customer: { id: 'c', name: SECRET }, notes: 'n' })), docOp(invoice('f1', 1, { customer: { id: 'c', name: SECRET } })),
      { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', clientTs: 5, payload: { businessName: 'X', vatNumber: '1' } } as any]);
    setKeys({ key: K2, id: 'k2', old: `k1:${K1}` });
    expect((await call('GET', '/v1/documents/q1', { token: A.token })).json.customer.name).toBe(SECRET);
    // fattura emessa: aggiornamento di stato dopo la rotazione (nessuna ricifratura dei campi bloccati: il trigger non scatta)
    const upd: any = invoice('f1', 1, { customer: { id: 'c', name: SECRET }, status: 'inviata', updatedAt: 9000 });
    expect((await push(A.token, [docOp(upd)])).json.conflicts).toEqual([]);
    expect(rawData('f1')).toContain('enc:v1:k1:');
    // nuova bozza -> chiave k2
    await push(A.token, [docOp(quote('q2', { customer: { id: 'c', name: SECRET } }))]);
    expect(rawData('q2')).toContain('enc:v1:k2:');
    // script di rotazione: bozze/profili/changes passano a k2, fatture emesse solo con --include-locked
    const r1 = rotate();
    expect(r1.documents).toBe(1); expect(r1.lockedSkipped).toBe(1);
    expect(rawData('q1')).toContain('enc:v1:k2:');
    expect(rawData('f1')).toContain('enc:v1:k1:');
    const r2 = rotate({ includeLocked: true });
    expect(r2.documents).toBe(1);
    expect(rawData('f1')).toContain('enc:v1:k2:');
    expect(rawData('f1')).not.toContain('enc:v1:k1:');
    expect(one('SELECT 1 AS x FROM sqlite_master WHERE name=?', 'trg_documents_locked_update')).toBeTruthy(); // trigger ricreato
    expect((await push(A.token, [docOp(invoice('f1', 1, { customer: { id: 'c', name: 'ALTRO' }, updatedAt: 9500 }))])).json.conflicts[0].reason).toBe('locked_document');
    // il solo audit (append-only) resta con la vecchia chiave se presente; qui non ce n'era
    expect(r2.remainingOldKey).toEqual({});
    expect((await call('GET', '/v1/documents/f1', { token: A.token })).json.customer.name).toBe(SECRET);
  });

  it('abilitare la cifratura su dati già esistenti in chiaro: letti normalmente, ricifrati dallo script', async () => {
    setKeys({});
    const A = await login('a@x.it');
    await push(A.token, [docOp(quote('q1', { customer: { id: 'c', name: SECRET } }))]);
    expect(rawData('q1')).toContain(SECRET);
    setKeys({ key: K1, id: 'k1' });
    expect((await call('GET', '/v1/documents/q1', { token: A.token })).json.customer.name).toBe(SECRET);
    rotate();
    expect(rawData('q1')).not.toContain(SECRET);
    expect((await call('GET', '/v1/documents/q1', { token: A.token })).json.customer.name).toBe(SECRET);
  });

  it('sealDocument/openDocument: round-trip e idempotenza', () => {
    const d: any = quote('q9', { customer: { id: 'c', name: SECRET }, notes: 'n' });
    const s = sealDocument('t1', d);
    expect(sealDocument('t1', s)).toEqual(s); // già cifrato: invariato
    expect(s.customer).toMatch(/^enc:v1:/);
    expect(openDocument('t1', s)).toEqual(d);
    expect(() => openDocument('t2', s)).toThrow(); // legato al tenant
  });

  it('dati corrotti nel DB: errore 500 generico, nessun dettaglio', async () => {
    const A = await login('a@x.it');
    await push(A.token, [docOp(quote('q1', { customer: { id: 'c', name: SECRET } }))]);
    setKeys({ key: K2, id: 'k2' }); // chiave sbagliata
    const r = await call('GET', '/v1/documents/q1', { token: A.token });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toMatch(/k1|chiave/);
  });
});
