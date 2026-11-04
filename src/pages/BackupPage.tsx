import { useRef, useState } from 'react';
import { Badge, Button, Card, PageHeader, Sheet, useToast } from '../ui';
import { describeBackup, exportBackup, getStorageSummary, importBackup, parseBackup, verifyStorageIntegrity, type BackupPreview, type IntegrityReport } from '../storage';
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
  const [pending, setPending] = useState<{ json: string; preview: BackupPreview } | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [checkError, setCheckError] = useState('');
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
      const current = await getStorageSummary().catch(() => null);
      setUnderstood(false);
      setPending({ json, preview: describeBackup(b, current) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File non valido');
    }
  };

  const runCheck = async () => {
    setBusy(true);
    setCheckError('');
    try { setReport(await verifyStorageIntegrity()); }
    catch { setReport(null); setCheckError('Il controllo non è riuscito. Riprova.'); }
    finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await importBackup(pending.json);
      setPending(null);
      setReport(null);
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
        <Card>
          <div className="cat-col cat-card-body">
            <strong>Controllo dati</strong>
            <p>Verifica che l'archivio sia coerente: numerazione delle fatture senza buchi, nessun numero doppio, file XML integri, note di credito collegate, registro delle operazioni completo. Non modifica nulla.</p>
            <Button size="lg" variant="secondary" onClick={() => void runCheck()} disabled={busy}>Controlla i dati</Button>
            {checkError && <p role="alert" className="cat-error">{checkError}</p>}
            {report && (
              <div role="status" className="cat-col" aria-label="Esito del controllo dati">
                <p>
                  <Badge tone={report.ok ? (report.clean ? 'success' : 'warning') : 'danger'}>{report.ok ? (report.clean ? 'Tutto in ordine' : 'Da controllare') : 'Problemi trovati'}</Badge>{' '}
                  {report.summary}
                </p>
                <p>Controllati {report.counts.documents} documenti ({report.counts.issuedInvoices} fatture e {report.counts.creditNotes} note di credito emesse).</p>
                {report.issues.map((i, k) => (
                  <p key={k}><strong>{i.severity === 'error' ? 'Problema: ' : 'Da controllare: '}</strong>{i.message}</p>
                ))}
                {!report.ok && <p>Scarica subito un backup e fai controllare i dati al tuo commercialista prima di emettere altre fatture.</p>}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Sheet open={!!pending} onClose={() => setPending(null)} title="Sostituire i dati attuali?">
        {pending && (
          <div className="cat-col">
            <p>Il backup contiene {pending.preview.summary}.</p>
            {pending.preview.versionNotes.length > 0 && (
              <div role="note" className="cat-col">
                <strong>Sul file</strong>
                {pending.preview.versionNotes.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}
            {pending.preview.replacesExisting ? (
              <div role="alert" className="cat-col">
                <strong>Cosa verrà sostituito</strong>
                <p>Su questo dispositivo ci sono ora: {pending.preview.currentSummary}. Tutto questo sarà sostituito dal contenuto del backup. L'operazione non si può annullare.</p>
                {pending.preview.replaceNotes.map((n, i) => <p key={i}>{n}</p>)}
                <Button variant="secondary" size="lg" disabled={busy} onClick={() => void doExport()}>Scarica prima un backup dei dati attuali</Button>
                <label className="cat-row">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                  <span>Ho capito: i dati attuali verranno sostituiti</span>
                </label>
              </div>
            ) : (
              <p>Su questo dispositivo non ci sono dati: il backup verrà semplicemente caricato.</p>
            )}
            <Button variant="danger" size="lg" disabled={busy || (pending.preview.replacesExisting && !understood)} onClick={() => void doImport()}>
              {pending.preview.replacesExisting ? 'Sì, sostituisci i dati' : 'Ripristina i dati'}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setPending(null)}>Annulla</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
