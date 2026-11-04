import { useState } from 'react';
import { Button, Card, Field, Input } from '../../ui';
import { describeError } from '../../sync/api';
import type { SyncEngine } from '../../sync/engine';
import { a, PRIVACY_NOTICE } from './styles';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function LoginForm({ engine }: { engine: SyncEngine }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setError('Inserisci un indirizzo email valido.'); return; }
    setBusy(true); setError('');
    try { await engine.requestCode(email); setStep('code'); setCode(''); } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Il codice ha 6 cifre.'); return; }
    setBusy(true); setError('');
    try { await engine.verifyCode(email, code); } catch (err) { setError(describeError(err)); setBusy(false); }
  };

  return (
    <Card>
      <div style={a.stack}>
        <h2 style={a.h2}>Accedi (facoltativo)</h2>
        <p style={a.muted}>Serve solo per sincronizzare i dati tra più dispositivi e per il piano Pro. L'app funziona benissimo anche senza account.</p>
        <p style={a.notice} role="note">{PRIVACY_NOTICE}</p>
        {step === 'email' ? (
          <form onSubmit={send} style={a.stack} noValidate>
            <Field label="Email" error={error || undefined}>
              <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} required />
            </Field>
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
            <Button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifico…' : 'Accedi'}</Button>
            <div style={a.row}>
              <Button variant="ghost" size="sm" onClick={() => { setStep('email'); setError(''); }}>Cambia email</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send()}>Invia di nuovo il codice</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
