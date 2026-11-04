// Diritti dell'interessato (GDPR): portabilità (export) e cancellazione dell'account.
//
// Cancellazione, in una sola transazione:
//  - SEMPRE rimossi: sessioni, dispositivi, codici OTP, profilo, catalogo, bozze e preventivi, log di sync, operazioni idempotenti, utente (l'email torna libera);
//  - fatture EMESSE (documents.locked_at): conservate per obbligo di legge (art. 2220 c.c., 10 anni — DA VERIFICARE con il commercialista; art. 17(3)(b) GDPR).
//    I trigger SQL ne impediscono comunque la cancellazione. Se ce ne sono, il tenant resta come "deleted" (senza nome né utenti, nessun login possibile);
//    se non ce ne sono, anche il tenant e i dati di abbonamento/consumi vengono eliminati (purge completo);
//  - sempre conservati (pseudonimi, nessun dato anagrafico diretto): audit_log (append-only) e prove di accettazione Termini/DPA (art. 17(3)(e));
//  - i backup (Litestream, retention 14 giorni) contengono ancora i dati fino alla scadenza: dichiararlo nell'informativa.
import { all, one, run, transaction } from '../db';
import { now } from '../db/clock';
import { audit } from '../db/audit';
import { openJson, aadAudit, aadProfile, open } from '../db/seal';
import { allActiveDocuments } from '../documents/repo';
import { listAcceptances } from '../auth/terms';

export function buildExport(tenantId: string, userId: string) {
  const u = one<{ email: string; created_at: number; last_login_at: number | null; role: string }>('SELECT email, created_at, last_login_at, role FROM users WHERE id=? AND tenant_id=?', userId, tenantId);
  const t = one<{ created_at: number }>('SELECT created_at FROM tenants WHERE id=?', tenantId);
  const prof = one<{ data: string; updated_at: number }>('SELECT data, updated_at FROM profiles WHERE tenant_id=?', tenantId);
  const ent = one<{ plan: string; status: string; current_period_end: number | null; grace_until: number | null }>('SELECT plan, status, current_period_end, grace_until FROM entitlements WHERE tenant_id=?', tenantId);
  return {
    exportVersion: 1,
    generatedAt: new Date(now()).toISOString(),
    note: 'Esportazione completa dei dati del tuo account VocePreventivo (art. 20 GDPR). Non include token di sessione né codici di accesso.',
    account: u ? { email: u.email, role: u.role, tenantId, createdAt: t?.created_at ?? null, lastLoginAt: u.last_login_at } : null,
    subscription: ent ? { plan: ent.plan, status: ent.status, currentPeriodEnd: ent.current_period_end, graceUntil: ent.grace_until } : null,
    profile: prof ? { updatedAt: prof.updated_at, data: openJson(prof.data, aadProfile(tenantId)) } : null,
    catalog: all<{ data: string }>("SELECT data FROM catalog_items WHERE tenant_id=? AND deleted_at IS NULL ORDER BY id", tenantId).map((r) => JSON.parse(r.data)),
    documents: allActiveDocuments(tenantId),
    devices: all<{ id: string; name: string | null; created_at: number; last_seen_at: number }>('SELECT id, name, created_at, last_seen_at FROM devices WHERE tenant_id=? ORDER BY created_at', tenantId)
      .map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at })),
    usage: all<{ month: string; docs_created: number; stt_seconds: number; llm_calls: number }>('SELECT month, docs_created, stt_seconds, llm_calls FROM usage WHERE tenant_id=? ORDER BY month', tenantId)
      .map((r) => ({ month: r.month, docsCreated: r.docs_created, sttSeconds: r.stt_seconds, llmCalls: r.llm_calls })),
    legalAcceptances: listAcceptances(tenantId),
    auditLog: all<{ at: number; action: string; entity: string | null; entity_id: string | null; ref_id: string | null; payload: string | null }>(
      'SELECT at, action, entity, entity_id, ref_id, payload FROM audit_log WHERE tenant_id=? ORDER BY id', tenantId)
      .map((a) => ({ at: a.at, action: a.action, entity: a.entity, entityId: a.entity_id,
        payload: a.payload === null ? null : JSON.parse(a.ref_id ? open(a.payload, aadAudit(tenantId, a.ref_id)) : a.payload) })),
  };
}

export interface DeleteResult { mode: 'purged' | 'anonymized'; retainedInvoices: number }

export function hasActiveSubscription(tenantId: string): boolean {
  const s = one<{ status: string; grace_until: number | null }>('SELECT status, grace_until FROM billing_subscriptions WHERE tenant_id=?', tenantId);
  return !!s && (s.status === 'active' || (s.status === 'past_due' && (s.grace_until ?? 0) > now()));
}

export function deleteAccount(tenantId: string, userId: string): DeleteResult {
  return transaction(() => {
    const t = now();
    const email = one<{ email: string }>('SELECT email FROM users WHERE id=? AND tenant_id=?', userId, tenantId)?.email;
    const retained = one<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND locked_at IS NOT NULL', tenantId)?.n ?? 0;
    run('DELETE FROM sessions WHERE tenant_id=?', tenantId);
    run('DELETE FROM devices WHERE tenant_id=?', tenantId);
    run('DELETE FROM documents WHERE tenant_id=? AND locked_at IS NULL', tenantId); // il trigger protegge le emesse; qui non ce ne sono
    run('DELETE FROM catalog_items WHERE tenant_id=?', tenantId);
    run('DELETE FROM profiles WHERE tenant_id=?', tenantId);
    run('DELETE FROM changes WHERE tenant_id=?', tenantId);
    run('DELETE FROM sync_ops WHERE tenant_id=?', tenantId);
    run('DELETE FROM users WHERE tenant_id=?', tenantId);
    if (email) run('DELETE FROM otp_codes WHERE email=?', email);
    let mode: DeleteResult['mode'];
    if (retained === 0) {
      try { run('DELETE FROM sdi_submissions WHERE tenant_id=?', tenantId); } catch { /* modulo SDI non caricato */ }
      run('DELETE FROM billing_subscriptions WHERE tenant_id=?', tenantId);
      run('DELETE FROM entitlements WHERE tenant_id=?', tenantId);
      run('DELETE FROM usage WHERE tenant_id=?', tenantId);
      run('DELETE FROM tenants WHERE id=?', tenantId);
      mode = 'purged';
    } else {
      run("UPDATE tenants SET status='deleted', deleted_at=?, name=NULL WHERE id=?", t, tenantId);
      mode = 'anonymized';
    }
    audit(tenantId, null, 'account.delete', 'tenant', tenantId, { mode, retainedInvoices: retained });
    return { mode, retainedInvoices: retained };
  });
}
