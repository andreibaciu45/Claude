import { useRef, useState } from 'react';
import { Badge, Button, Card, PageHeader, Sheet, useToast } from '../ui';
import { exportBackup, importBackup, parseBackup } from '../storage';
import { downloadText } from './catalog/download';
import './catalog/catalog.css';

const KEY = 'vp:lastBackupAt';
const REMIND_DAYS = 14;

function readLast(): number | null {
  try { const v = localStorage.getItem(KEY); return v ? Number(v) : null; } catch { return null; }
}
function writeLast(t: number) {
  try { localStorage.setItem(KEY, String(t)); } catch { /* ignora */ }
}

export default function BackupPage() {
  const toast = useToast();
  const [last, setLast] = useState<number | null>(readLast);
  const [pending, setPending] = useState<{ json: string; summary: string } | null>(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const stale = days === null || days >= REMIND_DAYS;

  const doExport = async () => {
    setBusy(true);
    try {
      const json = await exportBackup();
      downloadText(`vocepreventivo-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
      const now = Date.now();
      writeLast(now);
      setLast(now);
      toast('Backup scaricato');
    } catch { toast('Backup non riuscito'); } finally { setBusy(false); }
  };

  const pick = async (f?: File) => {
    if (!f) return;
    setError('');
    try {
      const json = await f.text();
      const b = parseBackup(json);
      setPending({ json, summary: `${b.catalog.length} voci di listino, ${b.documents.length} documenti${b.profile.businessName ? `, azienda «${b.profile.businessName}»` : ''}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File non valido');
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await importBackup(pending.json);
      setPending(null);
      setWarnings(res?.warnings ?? []);
      toast(res?.warnings?.length ? 'Dati ripristinati (con avvisi)' : 'Dati ripristinati');
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : 'Ripristino non riuscito');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Backup dei dati" subtitle="Salva e ripristina il tuo archivio" />
      <div className="cat-page">
        <Card>
          <div className="cat-col cat-card-body">
            <strong>I tuoi dati stanno solo su questo dispositivo</strong>
            <p>
              Non c'è nessun server: dati azienda, listino e documenti sono salvati nel browser di questo telefono o computer.
              Se cambi dispositivo, cancelli i dati di navigazione o disinstalli l'app, li perdi. Scarica un backup ogni tanto e conservalo al sicuro (email, cloud, chiavetta).
            </p>
          </div>
        </Card>

        <Card>
          <div className="cat-col cat-card-body">
            <div className="cat-row">
              <strong>Ultimo backup:</strong>
              {last ? <span>{new Date(last).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</span> : <span>mai eseguito</span>}
              {stale && <Badge tone="warning">{last ? `da ${days} giorni` : 'consigliato ora'}</Badge>}
            </div>
            {stale && <p role="status">{last ? 'È passato un po\' di tempo: scarica un nuovo backup.' : 'Non hai ancora salvato nessun backup.'}</p>}
            <Button size="lg" onClick={() => void doExport()} disabled={busy}>Scarica backup (.json)</Button>
          </div>
        </Card>

        {warnings.length > 0 && (
          <Card>
            <div role="status" className="cat-col cat-card-body">
              <strong>Attenzione dopo il ripristino</strong>
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          </Card>
        )}

        <Card>
          <div className="cat-col cat-card-body">
            <strong>Ripristina da backup</strong>
            <p>Scegli un file di backup scaricato in precedenza. Attenzione: i dati attuali verranno <strong>sostituiti</strong>.</p>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="File di backup" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <Button size="lg" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Scegli file di backup…</Button>
            {error && <p role="alert" className="cat-error">{error}</p>}
          </div>
        </Card>
      </div>

      <Sheet open={!!pending} onClose={() => setPending(null)} title="Sostituire i dati attuali?">
        <div className="cat-col">
          <p>Il backup contiene {pending?.summary}.</p>
          <p>Tutti i dati presenti ora su questo dispositivo (azienda, listino, documenti) saranno sostituiti. L'operazione non si può annullare: se vuoi, scarica prima un backup di quelli attuali.</p>
          <Button variant="danger" size="lg" disabled={busy} onClick={() => void doImport()}>Sì, sostituisci i dati</Button>
          <Button variant="secondary" size="lg" onClick={() => setPending(null)}>Annulla</Button>
        </div>
      </Sheet>
    </div>
  );
}
