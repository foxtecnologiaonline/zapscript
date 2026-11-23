import { redis } from '../../../services/queue';

/**
 * Rate limit de janela fixa. Usa Redis (compartilhado entre réplicas); se o Redis estiver fora ou lento,
 * cai para contagem em memória local — nunca deixa a rota sem limite (falha fechada em abuso).
 */
const mem = new Map<string, { n: number; resetAt: number }>();

function memHit(key: string, windowSec: number): number {
  const now = Date.now();
  if (mem.size > 20000) for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
  const cur = mem.get(key);
  if (!cur || cur.resetAt <= now) { mem.set(key, { n: 1, resetAt: now + windowSec * 1000 }); return 1; }
  cur.n += 1;
  return cur.n;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

export interface RateResult { ok: boolean; retryAfter: number }

/** Conta uma ocorrência de `bucket:id` na janela; `ok=false` quando passou de `max`. */
export async function rateHit(bucket: string, id: string, max: number, windowSec = 60): Promise<RateResult> {
  const win = Math.floor(Date.now() / (windowSec * 1000));
  const key = `bv:wc:rl:${bucket}:${id}:${win}`;
  const retryAfter = Math.max(1, windowSec - Math.floor((Date.now() / 1000) % windowSec));
  let n: number;
  try {
    n = await withTimeout((async () => {
      const c = await redis.incr(key);
      if (c === 1) await redis.expire(key, windowSec + 2);
      return c;
    })(), 400);
  } catch {
    n = memHit(key, windowSec + 2);
  }
  return { ok: n <= max, retryAfter };
}

/** Só para testes. */
export const clearRateMemory = () => mem.clear();
