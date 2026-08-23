import crypto from 'crypto';
import { prisma } from './prisma';
import { redis } from '../services/queue';
import { checkAdminTotp } from './totp';
import { rateLimitConfig } from './rateLimit';

/**
 * Auth compartilhada do painel admin (/sys/g5r8t2/*). Antes vivia copiada e
 * colada em admin.ts, admin-master.ts e suporte-admin.ts — unificada aqui
 * pra: (1) o rate limit de admin (rateLimitConfig.admin) parar de ser um
 * preset morto e passar a valer de verdade, e (2) todo acesso (aceito ou
 * negado) virar uma linha em AuditLog, já que o token é compartilhado e
 * sozinho não diz "quem" acessou — só "que alguém com o token" acessou.
 */

function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Nunca logamos o token em claro — só uma fingerprint curta pra correlacionar acessos. */
function tokenFingerprint(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function logAccess(req: any, result: string, tokenFp?: string): void {
  prisma.auditLog.create({
    data: {
      action:       'admin.panel_access',
      adminId:      tokenFp ? `token:${tokenFp}` : 'unknown',
      resourceType: 'admin_panel',
      metadata:     { method: req.method, path: req.url, result },
      ipAddress:    req.ip,
      userAgent:    (req.headers?.['user-agent'] as string) || null,
    },
  }).catch(() => null); // auditoria nunca pode derrubar o painel
}

// Janela fixa de 1 min (bate com rateLimitConfig.admin.timeWindow = '1 minute').
const RATE_LIMIT_WINDOW_SEC = 60;

async function withinAdminRateLimit(ip: string | undefined): Promise<boolean> {
  const key = `admin:ratelimit:${ip || 'unknown'}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
    return count <= rateLimitConfig.admin.max;
  } catch {
    return true; // Redis indisponível — não bloquear o admin por falha do rate limit
  }
}

export const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;

  if (!(await withinAdminRateLimit(req.ip))) {
    logAccess(req, 'rate_limited', token ? tokenFingerprint(token) : undefined);
    return reply.code(429).send(rateLimitConfig.admin.errorResponseBuilder());
  }

  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    logAccess(req, 'unauthorized');
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  const fp = tokenFingerprint(token!);
  const totp = await checkAdminTotp(token!, req.headers['x-admin-totp'] as string | undefined);
  if (totp !== 'ok') {
    logAccess(req, totp === 'totp_required' ? 'totp_required' : 'totp_invalid', fp);
    return reply.code(401).send({
      error: totp === 'totp_required' ? 'Código 2FA necessário' : 'Código 2FA inválido',
      totpRequired: true,
    });
  }

  logAccess(req, 'ok', fp);
};
