import { redis } from '../../services/queue';
import { logger } from '../../lib/logger';
import { randomToken } from './crypto';

/**
 * Jobs periódicos com lock distribuído em Redis (evita execução duplicada com mais de uma réplica da API).
 * Desligado em NODE_ENV=test e com BV_JOBS=off.
 */
const timers: NodeJS.Timeout[] = [];
const instanceId = randomToken(6);

export async function runExclusive<T>(name: string, ttlSec: number, fn: () => Promise<T>): Promise<T | undefined> {
  const key = `bv:lock:${name}`;
  let got: string | null = null;
  try { got = await redis.set(key, instanceId, 'EX', ttlSec, 'NX'); } catch { /* Redis fora: roda mesmo assim (single-node) */ got = 'OK'; }
  if (got !== 'OK') return undefined;
  try { return await fn(); } finally { try { if ((await redis.get(key)) === instanceId) await redis.del(key); } catch { /* noop */ } }
}

export interface JobOptions { intervalMs: number; lockTtlSec?: number; runOnStart?: boolean }

const jobs: Array<{ name: string; fn: () => Promise<void>; opts: JobOptions }> = [];

/** Registra um job (só inicia em startBalcaoJobs). Idempotente por nome. */
export function registerJob(name: string, opts: JobOptions, fn: () => Promise<void>): void {
  if (jobs.some((j) => j.name === name)) return;
  jobs.push({ name, fn, opts });
}

export function startBalcaoJobs(): void {
  if (process.env.NODE_ENV === 'test' || process.env.BV_JOBS === 'off') return;
  for (const j of jobs) {
    const run = () => runExclusive(j.name, j.opts.lockTtlSec ?? Math.max(30, Math.ceil(j.opts.intervalMs / 1000)), j.fn)
      .catch((err) => logger.error({ err: err?.message, job: j.name }, '[balcao] job falhou'));
    if (j.opts.runOnStart) void run();
    const t = setInterval(run, j.opts.intervalMs);
    t.unref();
    timers.push(t);
  }
  logger.info({ jobs: jobs.map((j) => j.name) }, '[balcao] jobs iniciados');
}

export function stopBalcaoJobs(): void { while (timers.length) clearInterval(timers.pop()!); }
export const listJobs = () => jobs.map((j) => j.name);

/** Hooks de inicialização (conectar ARI, IMAP, etc.), executados uma vez após o servidor subir. */
const startHooks: Array<() => void | Promise<void>> = [];
export function onBalcaoStart(fn: () => void | Promise<void>): void { startHooks.push(fn); }
export async function runBalcaoStartHooks(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  for (const h of startHooks) {
    try { await h(); } catch (err: any) { logger.error({ err: err?.message }, '[balcao] start hook falhou'); }
  }
}
