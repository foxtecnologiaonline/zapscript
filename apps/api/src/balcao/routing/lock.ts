import crypto from 'crypto';
import { redis } from '../../services/queue';

/**
 * Lock distribuído curto (Redis SET NX PX) + trava em processo. Garante que a mesma conversa não seja roteada
 * por dois workers ao mesmo tempo e que a checagem de capacidade de um atendente + a atribuição sejam atômicas.
 * Ordem obrigatória de aquisição: conversa → atendente (nunca o contrário), para não haver deadlock.
 */
const held = new Set<string>();
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryAcquire(key: string, token: string, ttlMs: number): Promise<boolean> {
  if (held.has(key)) return false;
  held.add(key);
  try {
    const got = await redis.set(`bv:acd:${key}`, token, 'PX', ttlMs, 'NX');
    if (got !== 'OK') { held.delete(key); return false; }
  } catch {
    /* Redis fora: segue só com a trava em processo (instância única) */
  }
  return true;
}

async function release(key: string, token: string): Promise<void> {
  held.delete(key);
  try { await redis.eval(RELEASE, 1, `bv:acd:${key}`, token); } catch { /* expira sozinho pelo TTL */ }
}

export type LockResult<T> = { ok: true; value: T } | { ok: false };

/** Executa `fn` com o lock `key`. Espera até `waitMs` (0 = não espera). */
export async function withLock<T>(key: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<LockResult<T>> {
  const token = crypto.randomBytes(8).toString('hex');
  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    if (await tryAcquire(key, token, opts.ttlMs ?? 20_000)) break;
    if (Date.now() >= deadline) return { ok: false };
    await sleep(15 + Math.floor(Math.random() * 25));
  }
  try { return { ok: true, value: await fn() }; } finally { await release(key, token); }
}

export const convLockKey = (conversationId: string) => `conv:${conversationId}`;
export const agentLockKey = (userId: string) => `agent:${userId}`;
