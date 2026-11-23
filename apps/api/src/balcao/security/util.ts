import { prisma } from '../../lib/prisma';
import { redis } from '../../services/queue';

/** Cria notificação interna para ADMIN/SUPERVISOR ativos do órgão (nunca lança). */
export async function notifyOrgManagers(orgId: string, type: string, title: string, body?: string, data?: unknown, roles: string[] = ['ADMIN', 'SUPERVISOR']): Promise<number> {
  try {
    const users = await prisma.bvUser.findMany({ where: { orgId, active: true, role: { in: roles } }, select: { id: true } });
    if (!users.length) return 0;
    await prisma.bvNotification.createMany({ data: users.map((u) => ({ orgId, userId: u.id, type, title, body: body ?? null, data: (data ?? undefined) as any })) });
    return users.length;
  } catch { return 0; }
}

const memHits = new Map<string, { n: number; exp: number }>();

/**
 * Rate limit de janela fixa (Redis; cai para memória do processo se o Redis falhar — para endpoints públicos
 * é preferível limitar por réplica a deixar sem limite).
 */
export async function hitLimit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  try {
    const k = `bv:sec:rl:${key}`;
    const n = await Promise.race([redis.incr(k), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 700))]);
    if (n === 1) await redis.expire(k, windowSec);
    if (n > max) {
      const ttl = await redis.ttl(k);
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    const now = Date.now();
    const cur = memHits.get(key);
    if (!cur || cur.exp < now) { memHits.set(key, { n: 1, exp: now + windowSec * 1000 }); return { allowed: true, retryAfterSec: 0 }; }
    cur.n++;
    return cur.n > max ? { allowed: false, retryAfterSec: Math.ceil((cur.exp - now) / 1000) } : { allowed: true, retryAfterSec: 0 };
  }
}
