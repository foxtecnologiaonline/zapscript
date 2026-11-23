import { redis } from '../../services/queue';

/**
 * Rate limit simples por IP+org no login (janela fixa em Redis). Independe do plugin global de rate limit.
 * Se o Redis estiver fora ou lento (>500 ms) NÃO bloqueia o login (fail-open): o bloqueio por conta
 * (5 falhas → 15 min) continua valendo, pois vive no Postgres.
 *
 * Env: BV_LOGIN_RL_MAX (padrão 20), BV_LOGIN_RL_WINDOW_SEC (padrão 600).
 */
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };

export function withTimeout<T>(p: Promise<T>, ms = 500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function hitLoginRateLimit(ip: string, scope: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const max = num(process.env.BV_LOGIN_RL_MAX, 20);
  const windowSec = num(process.env.BV_LOGIN_RL_WINDOW_SEC, 600);
  const key = `bv:rl:login:${ip}:${scope.slice(0, 80)}`;
  try {
    const n = await withTimeout(redis.incr(key));
    if (n === 1) await withTimeout(redis.expire(key, windowSec));
    if (n > max) {
      const ttl = await withTimeout(redis.ttl(key));
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
    }
  } catch { /* Redis indisponível: não bloqueia */ }
  return { allowed: true, retryAfterSec: 0 };
}

/** Marca um código TOTP como usado (anti-replay). Retorna false se já tinha sido usado. Fail-open sem Redis. */
export async function consumeTotpCode(userId: string, code: string): Promise<boolean> {
  try {
    const r = await withTimeout(redis.set(`bv:totp:used:${userId}:${code}`, '1', 'EX', 90, 'NX'));
    return r === 'OK';
  } catch { return true; }
}
