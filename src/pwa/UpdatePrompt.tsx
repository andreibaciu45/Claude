/**
 * Avviso "È disponibile una nuova versione". Autonomo: si monta una sola volta in App.tsx (vedi docs/PWA.md).
 * Non ricarica la pagina finché ci sono lavori in corso (`registerBusy`): in quel caso mostra che
 * l'aggiornamento partirà appena l'utente ha finito.
 */
import { useSyncExternalStore } from 'react';
import { getUpdater, type Updater } from './updater';
import { busy as defaultBusy } from './busy';
import './UpdatePrompt.css';

const EMPTY = { available: false, waitingForIdle: false, dismissed: false };
const noopSub = () => () => {};

export function UpdatePrompt({ updater }: { updater?: Updater | null } = {}) {
  const u = updater === undefined ? getUpdater() : updater;
  const st = useSyncExternalStore(u ? u.subscribe : noopSub, u ? u.getState : () => EMPTY, () => EMPTY);
  const isBusy = useSyncExternalStore(defaultBusy.subscribe, defaultBusy.isBusy, () => false);
  if (!u || !st.available || st.dismissed) return null;
  return (
    <div className="up" role="status" aria-live="polite">
      <div className="up-inner">
        <p className="up-msg">
          <strong>È disponibile una nuova versione</strong>
          {st.waitingForIdle
            ? ' L’aggiornamento partirà appena hai finito quello che stai facendo: i tuoi dati non vanno persi.'
            : isBusy
              ? ' Hai un’operazione in corso: aggiorneremo solo quando sarà conclusa.'
              : ' I tuoi dati restano salvati su questo dispositivo.'}
        </p>
        <div className="up-actions">
          <button type="button" className="up-btn up-btn-primary" onClick={() => u.apply()} disabled={st.waitingForIdle}>
            {st.waitingForIdle ? 'In attesa…' : 'Aggiorna ora'}
          </button>
          <button type="button" className="up-btn" onClick={() => u.dismiss()}>Più tardi</button>
        </div>
      </div>
    </div>
  );
}

export default UpdatePrompt;
