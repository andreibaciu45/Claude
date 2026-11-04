import { useState } from 'react';
import { Button, Card, Field, Input } from '../../ui';
import { ApiClientError, describeError, describeVerifyError } from '../../sync/api';
import type { SyncEngine } from '../../sync/engine';
import { currentAcceptance } from '../../sync/legal';
import { a, PRIVACY_NOTICE } from './styles';
import { TermsCheckbox } from './TermsCheckbox';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVITE_RE = /^[A-Za-z0-9-]{4,40}$/;

/** Codice invito da un link: `?invito=CODICE` (prima o dopo il `#` dell'HashRouter). Valori non plausibili si ignorano. */
export function inviteFromUrl(href: string = typeof window !== 'undefined' ? window.location.href : ''): string {
  try {
    const u = new URL(href, 'https://app.invalid');
    const hashQuery = u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?')) : '';
    const v = (u.searchParams.get('invito') ?? new URLSearchParams(hashQuery).get('invito') ?? '').trim();
    return INVITE_RE.test(v) ? v.toUpperCase() : '';
  } catch { return ''; }
}

const TERMS_NEEDED = 'Per continuare devi confermare di aver letto Termini e Privacy.';

/**
 * Accesso con email + codice. Richiede l'accettazione (checkbox non preselezionata) di Termini, Privacy e DPA:
 * la versione accettata viaggia in `/auth/verify` (`acceptedTerms`) e il server ne registra data/ora.
 * `reacceptEmail`: modalità "Termini aggiornati" per un utente già connesso (stessa procedura, email fissa).
 */
export function LoginForm({ engine, reacceptEmail, onDone }: { engine: SyncEngine; reacceptEmail?: string; onDone?: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(reacceptEmail ?? '');
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // campo "Codice invito": compare solo se arriva da un link (?invito=) o se il server lo chiede (invite_required)
  const [invite, setInvite] = useState(() => inviteFromUrl());
  const [showInvite, setShowInvite] = useState(() => !!inviteFromUrl());
  const [inviteError, setInviteError] = useState('');

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setError('Inserisci un indirizzo email valido.'); return; }
    if (!accepted) { setTermsError(TERMS_NEEDED); return; }
    setBusy(true); setError(''); setTermsError('');
    try { await engine.requestCode(email); setStep('code'); setCode(''); } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Il codice ha 6 cifre.'); return; }
    if (!accepted) { setTermsError(TERMS_NEEDED); return; }
    setBusy(true); setError(''); setTermsError(''); setInviteError('');
    try {
      await engine.verifyCode(email, code, currentAcceptance(), invite);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiClientError && !err.isNetwork && (err.code === 'invite_required' || err.code === 'invite_invalid')) {
        setShowInvite(true);
        setInviteError(describeError(err));
      } else if (err instanceof ApiClientError && (err.code === 'terms_required' || err.code === 'terms_version_mismatch')) {
        setTermsError(describeError(err));
        if (err.code === 'terms_required') setAccepted(false);
      } else setError(describeVerifyError(err));
    } finally { setBusy(false); }
  };

  const inviteField = showInvite && !reacceptEmail ? (
    <Field label="Codice invito" hint="Serve solo per creare un nuovo account. Se hai già un account lascialo vuoto." error={inviteError || undefined}>
      <Input
        value={invite} onChange={(e) => { setInvite(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)); setInviteError(''); }}
        autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="VP-XXXX-XXXX-XXXX" aria-invalid={!!inviteError}
      />
    </Field>
  ) : null;

  return (
    <Card>
      <div style={a.stack}>
        <h2 style={a.h2}>{reacceptEmail ? 'Accetta i Termini aggiornati' : 'Accedi (facoltativo)'}</h2>
        {reacceptEmail
          ? <p style={a.muted}>Per continuare a usare la sincronizzazione conferma di nuovo l’accesso: ti mandiamo un codice a 6 cifre.</p>
          : <p style={a.muted}>Serve solo per sincronizzare i dati tra più dispositivi e per il piano Pro. L'app funziona benissimo anche senza account.</p>}
        <p style={a.notice} role="note">{PRIVACY_NOTICE}</p>
        {step === 'email' ? (
          <form onSubmit={send} style={a.stack} noValidate>
            <Field label="Email" error={error || undefined}>
              <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} readOnly={!!reacceptEmail} required />
            </Field>
            {inviteField}
            <TermsCheckbox checked={accepted} onChange={(v) => { setAccepted(v); if (v) setTermsError(''); }} error={termsError} />
            <Button type="submit" disabled={busy}>{busy ? 'Invio…' : 'Inviami il codice'}</Button>
          </form>
        ) : (
          <form onSubmit={verify} style={a.stack} noValidate>
            <p style={a.muted} aria-live="polite">Abbiamo inviato un codice a 6 cifre a <strong>{email}</strong>.</p>
            <Field label="Codice a 6 cifre" error={error || undefined}>
              <Input
                style={a.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={!!error} data-autofocus autoFocus
              />
            </Field>
            {inviteField}
            <TermsCheckbox checked={accepted} onChange={(v) => { setAccepted(v); if (v) setTermsError(''); }} error={termsError} />
            <Button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifico…' : 'Accedi'}</Button>
            <div style={a.row}>
              {!reacceptEmail && <Button variant="ghost" size="sm" onClick={() => { setStep('email'); setError(''); }}>Cambia email</Button>}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send()}>Invia di nuovo il codice</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
