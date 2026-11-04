// Arresto ordinato (SIGTERM/SIGINT): entro SHUTDOWN_TIMEOUT_MS (default 10 s)
//   1. smette di accettare traffico: le nuove richieste ricevono 503 (drainGuard) e il listener si chiude;
//   2. lascia finire le richieste in corso (le connessioni inattive vengono chiuse subito);
//   3. ferma i worker (SDI, manutenzione) e attende il ciclo in corso;
//   4. chiude il database (checkpoint finale del WAL) ed esce con codice 0.
// Se qualcosa non finisce in tempo: chiude a forza le connessioni residue, chiude comunque il DB ed esce con codice 1.
import { logEvent } from '../log';
import { setDraining } from './state';

export interface ClosableServer {
  close(cb?: (err?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}
export type Stoppable = (() => void | Promise<void>) & { drain?: () => Promise<void> };

export interface ShutdownDeps {
  server: ClosableServer;
  workers: Stoppable[];
  closeDb: () => void;
  exit: (code: number) => void;
  timeoutMs?: number;
}
export interface ShutdownResult { forced: boolean; ms: number; code: number }

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<'timeout' | T> =>
  Promise.race([p, new Promise<'timeout'>((r) => { const t = setTimeout(() => r('timeout'), ms); t.unref?.(); })]);

/** `failed`: l'arresto e' dovuto a un errore (uscita con codice 1 anche se pulito, cosi' systemd riavvia il servizio). */
export function createShutdown(deps: ShutdownDeps): (signal: string, failed?: boolean) => Promise<ShutdownResult> {
  let running: Promise<ShutdownResult> | null = null;
  const budget = deps.timeoutMs ?? (Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000);

  return (signal, failed = false) => {
    if (running) return running; // segnali ripetuti: stesso arresto
    running = (async () => {
      const t0 = Date.now();
      const left = () => Math.max(50, budget - (Date.now() - t0));
      let forced = false;
      logEvent('info', 'shutdown_start', { signal, timeoutMs: budget });
      setDraining(true);
      const hard = setTimeout(() => deps.exit(1), budget + 1000); // rete di sicurezza: non restare mai appesi

      // 1-2. niente nuove connessioni; richieste in corso a termine
      const closed = new Promise<void>((resolve) => { try { deps.server.close(() => resolve()); } catch { resolve(); } });
      deps.server.closeIdleConnections?.();
      // le connessioni che diventano inattive DOPO aver risposto (keep-alive) si chiudono subito, senza aspettare il timeout di keep-alive
      const sweep = setInterval(() => deps.server.closeIdleConnections?.(), 50);
      closed.then(() => clearInterval(sweep), () => clearInterval(sweep));
      // lascia ~20% del budget per worker e chiusura del DB
      const drain = await withTimeout(closed, Math.floor(budget * 0.8));
      clearInterval(sweep);
      if (drain === 'timeout') {
        forced = true;
        logEvent('warn', 'shutdown_forcing_connections');
        deps.server.closeAllConnections?.();
        await withTimeout(closed, 500);
      }

      // 3. worker (anche se il server non e' stato drenato del tutto)
      for (const w of deps.workers) {
        try {
          const res = w.drain ? await withTimeout(w.drain(), left()) : await withTimeout(Promise.resolve(w()), left());
          if (res === 'timeout') { forced = true; logEvent('warn', 'shutdown_worker_timeout'); }
        } catch { /* un worker che fallisce non deve impedire la chiusura del DB */ }
      }

      // 4. DB
      try { deps.closeDb(); } catch { forced = true; }
      const ms = Date.now() - t0;
      const code = forced || failed ? 1 : 0;
      logEvent(forced ? 'warn' : 'info', 'shutdown_done', { ms, forced });
      clearTimeout(hard);
      deps.exit(code);
      return { forced, ms, code };
    })();
    return running;
  };
}
