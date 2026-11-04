// Coda job con retry/backoff esponenziale e dead-letter. In-memory + interfaccia per SQLite (CORE).
import type { Clock } from '../billing/common';

export type JobStatus = 'queued' | 'running' | 'done' | 'dead';
export interface Job<P = unknown> {
  id: string;
  kind: string;
  payload: P;
  dedupeKey?: string;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  status: JobStatus;
  lastError?: string;
  createdAt: number;
}
export interface NewJob<P = unknown> { kind: string; payload: P; dedupeKey?: string; maxAttempts?: number; runAt?: number }

export interface JobStore {
  /** Idempotente su dedupeKey: restituisce il job esistente. */
  enqueue(job: NewJob, now: number): Promise<Job>;
  /** Preleva (e marca running) fino a `limit` job con runAt <= now. */
  claimDue(now: number, limit: number): Promise<Job[]>;
  markDone(id: string): Promise<void>;
  /** Rimette in coda con nuovo runAt, oppure dead-letter se nextRunAt === null. */
  markFailed(id: string, error: string, nextRunAt: number | null): Promise<void>;
  get(id: string): Promise<Job | null>;
  list(status?: JobStatus): Promise<Job[]>;
}

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();
  private keys = new Map<string, string>();
  private seq = 0;
  async enqueue(j: NewJob, now: number) {
    if (j.dedupeKey) {
      const ex = this.keys.get(j.dedupeKey);
      if (ex) {
        const old = this.jobs.get(ex)!;
        if (old.status === 'dead') Object.assign(old, { status: 'queued', attempts: 0, runAt: j.runAt ?? now, lastError: undefined, payload: j.payload });
        return { ...old };
      }
    }
    const job: Job = {
      id: `job_${++this.seq}`, kind: j.kind, payload: j.payload, dedupeKey: j.dedupeKey,
      attempts: 0, maxAttempts: j.maxAttempts ?? 5, runAt: j.runAt ?? now, status: 'queued', createdAt: now,
    };
    this.jobs.set(job.id, job);
    if (j.dedupeKey) this.keys.set(j.dedupeKey, job.id);
    return { ...job };
  }
  async claimDue(now: number, limit: number) {
    const due = [...this.jobs.values()].filter((j) => j.status === 'queued' && j.runAt <= now)
      .sort((a, b) => a.runAt - b.runAt).slice(0, limit);
    for (const j of due) { j.status = 'running'; j.attempts++; }
    return due.map((j) => ({ ...j }));
  }
  async markDone(id: string) { const j = this.jobs.get(id); if (j) j.status = 'done'; }
  async markFailed(id: string, error: string, next: number | null) {
    const j = this.jobs.get(id); if (!j) return;
    j.lastError = error;
    if (next === null) j.status = 'dead'; else { j.status = 'queued'; j.runAt = next; }
  }
  async get(id: string) { const j = this.jobs.get(id); return j ? { ...j } : null; }
  async list(status?: JobStatus) { return [...this.jobs.values()].filter((j) => !status || j.status === status).map((j) => ({ ...j })); }
}

export interface BackoffOpts { baseMs: number; maxMs: number }
export const DEFAULT_BACKOFF: BackoffOpts = { baseMs: 30_000, maxMs: 6 * 3600_000 };
/** attempt = numero del tentativo appena fallito (1-based). 30s, 60s, 120s, ... fino a maxMs. */
export const backoffDelay = (attempt: number, o: BackoffOpts = DEFAULT_BACKOFF) =>
  Math.min(o.maxMs, o.baseMs * 2 ** Math.max(0, attempt - 1));

export type JobHandler = (job: Job) => Promise<void>;
/** Un errore `PermanentJobError` manda subito in dead-letter (niente retry). */
export class PermanentJobError extends Error {}

export interface JobRunner {
  /** Elabora i job scaduti; ritorna quanti ne ha toccati. */
  runOnce(limit?: number): Promise<{ done: number; retried: number; dead: number }>;
}
export function createJobRunner(
  store: JobStore, handlers: Record<string, JobHandler>, clock: Clock, backoff: BackoffOpts = DEFAULT_BACKOFF,
): JobRunner {
  return {
    async runOnce(limit = 20) {
      const stats = { done: 0, retried: 0, dead: 0 };
      for (const job of await store.claimDue(clock.now(), limit)) {
        const h = handlers[job.kind];
        try {
          if (!h) throw new PermanentJobError(`nessun handler per ${job.kind}`);
          await h(job);
          await store.markDone(job.id);
          stats.done++;
        } catch (e) {
          const msg = e instanceof Error ? e.message.slice(0, 300) : 'errore';
          const permanent = e instanceof PermanentJobError || job.attempts >= job.maxAttempts;
          await store.markFailed(job.id, msg, permanent ? null : clock.now() + backoffDelay(job.attempts, backoff));
          permanent ? stats.dead++ : stats.retried++;
        }
      }
      return stats;
    },
  };
}
