/**
 * Banner globale sullo stato dell'archivio (REV-DB1): visibile in TUTTE le schermate quando lo stato non è 'ok'.
 * role="alert", testo in italiano, azioni "Riprova" e "Scarica backup di emergenza".
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { dismissStorageNotice, ensureStorageStarted, exportBackup, getStorageStatus, retryStorage, subscribeStorageStatus, type StorageStatus } from '../storage';
import { Button } from './index';
import './StorageBanner.css';

export const useStorageStatus = (): StorageStatus => useSyncExternalStore(subscribeStorageStatus, getStorageStatus, getStorageStatus);

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TITLE: Record<StorageStatus['health'], string> = {
  ok: '',
  degraded: 'Attenzione: i salvataggi potrebbero non andare a buon fine',
  unavailable: 'I dati non vengono salvati',
};

export function StorageBanner() {
  const st = useStorageStatus();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // apre l'archivio anche nelle pagine che non lo usano subito (es. /info), così lo stato è noto
  useEffect(() => { try { ensureStorageStarted(); } catch { /* ignora */ } }, []);
  if (st.health === 'ok') return null;

  const retry = async () => {
    setBusy(true); setNote('');
    try { setNote((await retryStorage()) ? 'Archivio di nuovo disponibile.' : 'L\'archivio non è ancora disponibile. Chiudi le altre schede dell\'app o libera spazio e riprova.'); }
    finally { setBusy(false); }
  };
  const backup = async () => {
    setBusy(true); setNote('');
    try {
      download(`vocepreventivo-backup-emergenza-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup());
      setNote(st.memoryOnly ? 'Scaricato quello che c\'è in memoria in questo momento (solo bozze di questa sessione).' : 'Backup scaricato: conservalo al sicuro.');
    } catch { setNote('Non riesco a leggere l\'archivio per fare il backup in questo momento.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="sb" role="alert" data-health={st.health} data-reason={st.reason}>
      <div className="sb-inner">
        <strong className="sb-title">{st.reason === 'memory-recovered' ? 'Dati recuperati' : st.reason === 'recovery-failed' ? 'Recupero dei dati non riuscito' : TITLE[st.health]}</strong>
        <p className="sb-msg">{st.message}</p>
        {st.memoryOnly && <p className="sb-msg">Puoi continuare con bozze e preventivi, ma <strong>non verranno salvati</strong> e l'emissione delle fatture è bloccata finché l'archivio non è disponibile.</p>}
        {!st.memoryOnly && !st.persistent && <p className="sb-msg">Emissione di fatture, note di credito, incassi ed esiti SDI sono bloccati finché l'archivio non torna disponibile. Non è stato registrato nulla di quanto tentato.</p>}
        <details className="sb-why">
          <summary>Perché succede?</summary>
          <ul>
            <li><strong>Navigazione privata</strong> o archivio del sito disabilitato: il browser non permette di conservare i dati.</li>
            <li><strong>Spazio pieno</strong> sul telefono o sul computer: libera spazio e riprova.</li>
            <li><strong>Altre schede aperte</strong> dell'app (anche in un'altra finestra) che bloccano o aggiornano l'archivio: chiudile.</li>
          </ul>
        </details>
        <div className="sb-actions">
          {st.reason === 'memory-recovered'
            ? <Button size="sm" onClick={() => dismissStorageNotice()}>Ho capito</Button>
            : <Button size="sm" onClick={() => void retry()} disabled={busy}>Riprova</Button>}
          <Button size="sm" variant="secondary" onClick={() => void backup()} disabled={busy}>Scarica backup di emergenza</Button>
        </div>
        {note && <p className="sb-note" role="status">{note}</p>}
      </div>
    </div>
  );
}

export default StorageBanner;
