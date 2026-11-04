/** Conflitti sulle BOZZE (ARCHITECTURE §2.3): nessuna sovrascrittura silenziosa; profilo/catalogo restano last-write-wins con segnalazione nel registro. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QuoteDocument } from '../types';
import { defaultProfile } from '../storage';
import { __resetSyncDbForTests, listOutbox } from './outbox';
import { createSyncEngine, type SyncEngine } from './engine';
import { diffDrafts, makeConflictCopy } from './conflictDiff';
import { makeStorageHooks, StorageHookUnavailableError, unavailableStorageHooks } from './storageHooks';
import { FakeServer, MemStore, mkDoc, mkItem } from './testing/fakes';
import type { AuditEntry } from '../types';

let token: string | null;
let account: { email: string; tenantId: string } | null;
let server: FakeServer;
let store: MemStore;
let engine: SyncEngine;
let clock = 1_000_000;

const make = (hooks = unavailableStorageHooks) => createSyncEngine({
  api: server, store, isOnline: () => true, now: () => clock, hooks,
  tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
  accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
});
const line = (id: string, description: string, qty = 1, unitPrice = 10) => ({ id, description, qty, unit: 'pz' as const, unitPrice, vat: 22 });

beforeEach(async () => {
  await __resetSyncDbForTests();
  token = 'tok'; account = { email: 'a@b.it', tenantId: 't' };
  server = new FakeServer(); store = new MemStore(); engine = make();
});

/** bozza sincronizzata (base 10), poi un altro dispositivo la modifica (updatedAt 100) e qui la si modifica (updatedAt 60) */
async function staleDraft(): Promise<void> {
  store.docs.set('d', mkDoc('d', { notes: 'base', lines: [line('l1', 'Tubo')], updatedAt: 10 }));
  await engine.syncNow(); await engine.confirmMigration();
  server.put('document', 'd', mkDoc('d', { notes: 'dal server', customer: { id: 'c2', name: 'Anna Verdi' }, lines: [line('l1', 'Tubo'), line('l2', 'Raccordo', 2, 5)], updatedAt: 100 }));
  store.docs.set('d', mkDoc('d', { notes: 'mia nota', lines: [line('l1', 'Tubo', 3)], updatedAt: 60 }));
  await engine.syncNow();
}

describe('bozza rifiutata con stale', () => {
  it('NON sovrascrive: il server resta com’è e nasce un conflitto con le due versioni', async () => {
    await staleDraft();
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('dal server');
    expect(store.docs.get('d')?.notes).toBe('mia nota');
    const st = engine.getStatus();
    expect(st.phase).toBe('conflict');
    expect(st.conflicts).toHaveLength(1);
    const c = st.conflicts[0];
    expect(c).toMatchObject({ reason: 'stale', canUseServer: true, canKeepBoth: true });
    expect(c.draft?.localDeleted).toBe(false);
    expect(c.draft?.rows.map((r) => r.field)).toEqual(['Cliente', 'Righe', 'Totale', 'Note']);
    expect(c.draft?.rows.find((r) => r.field === 'Cliente')).toMatchObject({ local: 'Mario Rossi', server: 'Anna Verdi' });
    expect(c.draft?.rows.find((r) => r.field === 'Note')).toMatchObject({ local: 'mia nota', server: 'dal server' });
    expect(c.draft?.localUpdatedAt).toBe(60);
    expect(c.draft?.serverUpdatedAt).toBe(100);
  });

  it('i cicli successivi non rimandano né duplicano il conflitto', async () => {
    await staleDraft();
    const pushes = server.pushCalls;
    await engine.syncNow(); await engine.scan(); await engine.syncNow();
    expect(engine.getStatus().conflicts).toHaveLength(1);
    expect((await listOutbox()).filter((r) => r.status === 'conflict')).toHaveLength(1);
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('dal server');
    expect(server.pushCalls).toBeGreaterThanOrEqual(pushes);
  });

  it('"usa quella del server": la bozza locale diventa quella del server, nessuna copia', async () => {
    await staleDraft();
    await engine.resolveConflict(engine.getStatus().conflicts[0].opId, 'use-server');
    await engine.syncNow();
    expect(store.docs.get('d')?.notes).toBe('dal server');
    expect(store.docs.size).toBe(1);
    expect(engine.getStatus().conflicts).toHaveLength(0);
    expect(engine.getStatus().phase).toBe('idle');
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('dal server');
  });

  it('"tieni la mia": la versione locale sostituisce quella del server solo dopo la scelta', async () => {
    await staleDraft();
    await engine.resolveConflict(engine.getStatus().conflicts[0].opId, 'keep-local');
    await engine.syncNow();
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('mia nota');
    expect(store.docs.get('d')?.notes).toBe('mia nota');
    expect(engine.getStatus().conflicts).toHaveLength(0);
    expect(engine.getStatus().log.some((l) => /per scelta tua/.test(l.message))).toBe(true);
  });

  it('"tieni entrambe": la mia diventa una nuova bozza "copia in conflitto" senza numero fiscale, l’originale adotta il server', async () => {
    store.docs.set('d', mkDoc('d', { type: 'fattura', number: '', notes: 'base', updatedAt: 10, invoice: {
      tipoDocumento: 'TD01', year: 2026, sectional: 'FT', number: '9/2026', seq: 9, operationDate: '2026-01-01', stampDuty: false,
      stampDutyChargedToCustomer: false, stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [] } }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { type: 'fattura', number: '', notes: 'dal server', updatedAt: 100, invoice: store.docs.get('d')!.invoice }));
    store.docs.set('d', { ...store.docs.get('d')!, notes: 'mia', updatedAt: 60 });
    await engine.syncNow();
    await engine.resolveConflict(engine.getStatus().conflicts[0].opId, 'keep-both');
    const docs = [...store.docs.values()];
    expect(docs).toHaveLength(2);
    const copy = docs.find((x) => x.id !== 'd')!;
    expect(copy.notes).toContain('Copia in conflitto');
    expect(copy.notes).toContain('mia');
    expect(copy.status).toBe('bozza');
    expect(copy.number).toBe('');
    expect(copy.invoice?.number).toBeUndefined();
    expect(copy.invoice?.seq).toBeUndefined();
    expect(copy.invoice?.lockedAt).toBeUndefined();
    expect(store.docs.get('d')?.notes).toBe('dal server');
    await engine.syncNow();
    expect(server.count('document')).toBe(2); // la copia è una bozza nuova e viene caricata
    expect(engine.getStatus().conflicts).toHaveLength(0);
  });

  it('bozza eliminata qui ma modificata altrove: conflitto, nessuna cancellazione silenziosa', async () => {
    store.docs.set('d', mkDoc('d', { updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { notes: 'altrove', updatedAt: 100 }));
    store.docs.delete('d');
    await engine.syncNow();
    expect(server.get('document', 'd')).toBeDefined();
    const c = engine.getStatus().conflicts[0];
    expect(c.draft?.localDeleted).toBe(true);
    expect(c.canKeepBoth).toBe(false);
    await engine.resolveConflict(c.opId, 'use-server');
    expect(store.docs.get('d')?.notes).toBe('altrove');
  });

  it('eliminata qui: "elimina comunque" cancella anche dal server', async () => {
    store.docs.set('d', mkDoc('d', { updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { notes: 'altrove', updatedAt: 100 }));
    store.docs.delete('d');
    await engine.syncNow();
    await engine.resolveConflict(engine.getStatus().conflicts[0].opId, 'keep-local');
    await engine.syncNow();
    expect(server.get('document', 'd')).toBeUndefined();
  });

  it('le fatture emesse restano fuori da questo percorso (locked_document, non stale)', async () => {
    store.docs.set('d', mkDoc('d', { updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { updatedAt: 100, type: 'fattura', invoice: { lockedAt: 5 } as QuoteDocument['invoice'] }));
    store.docs.set('d', mkDoc('d', { notes: 'x', updatedAt: 60 }));
    await engine.syncNow();
    const c = engine.getStatus().conflicts[0];
    expect(c.reason).toBe('locked_document');
    expect(c.draft).toBeUndefined();
  });
});

describe('versione remota più recente di una bozza con modifiche locali non inviate (pull)', () => {
  it('mentre il pull è in corso: conflitto, la bozza locale non viene sovrascritta', async () => {
    store.docs.set('d', mkDoc('d', { notes: 'base', updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { notes: 'dal server', updatedAt: 100 }));
    // l'utente modifica la bozza dopo lo scan e il push del ciclo, un attimo prima del pull
    const realPull = server.syncPull.bind(server);
    server.syncPull = async (c) => { store.docs.set('d', mkDoc('d', { notes: 'modifica nel mezzo', updatedAt: 80 })); return realPull(c); };
    await engine.syncNow();
    server.syncPull = realPull;
    const st = engine.getStatus();
    expect(store.docs.get('d')?.notes).toBe('modifica nel mezzo');
    expect(st.conflicts).toHaveLength(1);
    expect(st.conflicts[0].draft?.rows.find((r) => r.field === 'Note')).toMatchObject({ local: 'modifica nel mezzo', server: 'dal server' });
    expect(st.log.some((l) => /modificata anche su un altro dispositivo/.test(l.message))).toBe(true);
    // scelta: tengo la mia -> sul server finisce la mia
    await engine.resolveConflict(st.conflicts[0].opId, 'keep-local');
    await engine.syncNow();
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('modifica nel mezzo');
  });

  it('pull senza modifiche locali: la bozza si aggiorna normalmente (nessun conflitto)', async () => {
    store.docs.set('d', mkDoc('d', { notes: 'base', updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { notes: 'nuova', updatedAt: 100 }));
    await engine.syncNow();
    expect(store.docs.get('d')?.notes).toBe('nuova');
    expect(engine.getStatus().conflicts).toHaveLength(0);
  });
});

describe('profilo e catalogo: last-write-wins con segnalazione nel registro', () => {
  it('catalogo stale: vince la modifica locale e il registro lo dice', async () => {
    store.catalog.set('c1', mkItem('c1', 'base', 10));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('catalog', 'c1', mkItem('c1', 'altro', 30));
    store.catalog.set('c1', mkItem('c1', 'mio', 20));
    await engine.syncNow();
    expect(server.get('catalog', 'c1')).toMatchObject({ name: 'mio' });
    expect(engine.getStatus().conflicts).toHaveLength(0);
    expect(engine.getStatus().log.some((l) => l.level === 'warn' && l.message.includes('Voce di catalogo: mio') && /vince l'ultima modifica/.test(l.message))).toBe(true);
  });
  it('profilo stale: idem', async () => {
    store.profile = { ...defaultProfile(), businessName: 'Rossi', vatNumber: '01234567897', updatedAt: 10 } as typeof store.profile;
    await engine.syncNow(); await engine.confirmMigration();
    server.put('profile', 'profile', { ...store.profile, businessName: 'Altro', updatedAt: 90 } as never);
    store.profile = { ...store.profile, businessName: 'Mio', updatedAt: 50 } as typeof store.profile;
    await engine.syncNow();
    expect(engine.getStatus().conflicts).toHaveLength(0);
    expect(engine.getStatus().log.some((l) => l.message.startsWith('Dati azienda'))).toBe(true);
  });
});

describe('confronto bozze (puro)', () => {
  it('elenca solo i campi diversi; totale in euro', () => {
    const a = mkDoc('x', { lines: [line('1', 'Tubo', 2, 10)], notes: 'a' });
    const b = mkDoc('x', { lines: [line('1', 'Tubo', 2, 10)], notes: 'b' });
    expect(diffDrafts(a, b).map((r) => r.field)).toEqual(['Note']);
    const c = mkDoc('x', { lines: [line('1', 'Tubo', 3, 10)] });
    const rows = diffDrafts(a, c);
    expect(rows.map((r) => r.field)).toEqual(['Righe', 'Totale', 'Note']);
    expect(rows.find((r) => r.field === 'Totale')).toEqual({ field: 'Totale', local: '24,40 €', server: '36,60 €' });
    expect(diffDrafts(a, a)).toEqual([]);
  });
  it('copia in conflitto di un preventivo: nuovo id, numero marcato', () => {
    const d = mkDoc('x', { notes: 'ciao', convertedToInvoiceId: 'f1' });
    const c = makeConflictCopy(d, 'nuovo', 5);
    expect(c).toMatchObject({ id: 'nuovo', number: 'PRev-x (copia in conflitto)', createdAt: 5 });
    expect(c.convertedToInvoiceId).toBeUndefined();
    expect(d.id).toBe('x');
  });
});

describe('StorageHooks (opzionali)', () => {
  it('predefinito: non disponibili; audit remoto non importato e nessun errore', async () => {
    expect(unavailableStorageHooks.available).toEqual({ clearLocalData: false, importAuditEntries: false });
    await expect(unavailableStorageHooks.clearLocalData()).rejects.toBeInstanceOf(StorageHookUnavailableError);
    expect(engine.canDiscardLocalData()).toBe(false);
    server.put('audit', 'a1', { id: 'a1', at: 1 } as never);
    await engine.syncNow();
    expect(engine.getStatus().phase).toBe('idle');
  });
  it('importAuditEntries disponibile: le voci di altri dispositivi vengono importate', async () => {
    const got: AuditEntry[] = [];
    (store as { saveAudit?: unknown }).saveAudit = undefined; // come lo storage vero: nessuna scrittura di audit remoto
    engine = make(makeStorageHooks({ importAuditEntries: async (e) => { got.push(...e); return e.length; } }));
    server.put('audit', 'a1', { id: 'a1', at: 1, action: 'x' } as never);
    await engine.syncNow();
    expect(got.map((e) => e.id)).toEqual(['a1']);
  });
  it('cambio account: i dati locali dell’altro sono segnalati e si possono svuotare (se lo storage può)', async () => {
    let wiped = 0;
    token = null; account = null;
    engine = make(makeStorageHooks({ clearLocalData: async () => { wiped++; store.docs.clear(); store.catalog.clear(); } }));
    await engine.verifyCode('a@b.it', '123456');
    store.docs.set('d1', mkDoc('d1'));
    await engine.syncNow(); await engine.confirmMigration();
    engine.signOut();
    await engine.verifyCode('altro@b.it', '123456');
    const st = engine.getStatus();
    expect(st.migration).not.toBeNull();
    expect(st.foreignData).toBe(true);
    expect(engine.canDiscardLocalData()).toBe(true);
    server.entities.clear(); server.log = []; server.seq = 0; // il server finto è uno solo: simula il tenant dell'altro account
    server.put('document', 'srv', mkDoc('srv'));
    await engine.discardLocalData();
    expect(wiped).toBe(1);
    expect(store.docs.has('d1')).toBe(false);
    expect(store.docs.has('srv')).toBe(true);
    expect(engine.getStatus()).toMatchObject({ migration: null, foreignData: false });
    expect(server.get('document', 'd1')).toBeUndefined();
  });
  it('senza la funzione di storage discardLocalData rifiuta e non tocca nulla', async () => {
    token = null; account = null;
    await engine.verifyCode('a@b.it', '123456');
    store.docs.set('d1', mkDoc('d1'));
    await engine.syncNow(); await engine.confirmMigration();
    engine.signOut();
    await engine.verifyCode('altro@b.it', '123456');
    await expect(engine.discardLocalData()).rejects.toBeInstanceOf(StorageHookUnavailableError);
    expect(store.docs.has('d1')).toBe(true);
    expect(engine.getStatus().foreignData).toBe(true);
  });
  it('primo accesso su dispositivo mai usato da altri: nessun avviso "altro account"', async () => {
    token = null; account = null;
    store.docs.set('d1', mkDoc('d1'));
    await engine.verifyCode('a@b.it', '123456');
    expect(engine.getStatus().foreignData).toBe(false);
  });
});

describe('codice invito nel motore', () => {
  it('verifyCode invia inviteCode normalizzato (maiuscole, senza spazi); senza codice non lo invia', async () => {
    token = null; account = null;
    await engine.verifyCode('a@b.it', '123456', undefined, ' vp-ab12-cd34 ');
    expect(server.verifyBodies[0].inviteCode).toBe('VP-AB12-CD34');
    token = null; account = null;
    await engine.verifyCode('a@b.it', '123456', undefined, '  ');
    expect('inviteCode' in server.verifyBodies[1]).toBe(false);
  });
  it('invite_required / invite_invalid: errore con codice, nessun accesso', async () => {
    token = null; account = null; server.validInvites = ['VP-OK'];
    await expect(engine.verifyCode('a@b.it', '123456')).rejects.toMatchObject({ code: 'invite_required', status: 403 });
    await expect(engine.verifyCode('a@b.it', '123456', undefined, 'VP-NO')).rejects.toMatchObject({ code: 'invite_invalid' });
    expect(token).toBeNull();
    await engine.verifyCode('a@b.it', '123456', undefined, 'vp-ok');
    expect(token).not.toBeNull();
  });
});

describe('collegamento a src/storage', () => {
  it('detectStorageHooks collega le funzioni reali (clearLocalData con conferma + copia di sicurezza, importAuditEntries)', async () => {
    const { detectStorageHooks } = await import('./storageHooks');
    const h = detectStorageHooks();
    expect(h.available).toEqual({ clearLocalData: true, importAuditEntries: true });
    await expect(h.importAuditEntries([])).resolves.toBe(0);
  });
  it('quando lo storage sa importare l’audit, la prima volta si rilegge il server dall’inizio (una volta sola)', async () => {
    const got: string[] = [];
    engine = make(makeStorageHooks({ importAuditEntries: async (e) => { got.push(...e.map((x) => x.id)); return e.length; } }));
    (store as { saveAudit?: unknown }).saveAudit = undefined;
    server.put('document', 'd0', mkDoc('d0'));
    await make().syncNow();                       // senza hook: cursor avanza oltre
    server.put('audit', 'a1', { id: 'a1', at: 1 } as never);
    await make().syncNow();                       // audit saltato
    await engine.syncNow();                       // con hook: ripassa da 0
    expect(got).toContain('a1');
    got.length = 0;
    await engine.syncNow();
    expect(got).toEqual([]);                      // non di nuovo
  });
});
