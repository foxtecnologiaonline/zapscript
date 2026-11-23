import type { FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface AuditEntry {
  orgId: string;
  actorType?: 'USER' | 'SYSTEM' | 'CONTACT' | 'INTEGRATION';
  actorId?: string | null;
  action: string; // auth.login, conversation.read, user.create, config.update, recording.listen …
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Grava na trilha de auditoria (append-only). NUNCA lança: falha de auditoria é logada, não derruba a operação. */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    await prisma.bvAuditLog.create({
      data: {
        orgId: e.orgId, actorType: e.actorType ?? 'USER', actorId: e.actorId ?? null, action: e.action,
        entityType: e.entityType, entityId: e.entityId, before: (e.before ?? undefined) as any,
        after: (e.after ?? undefined) as any, meta: (e.meta ?? undefined) as any,
        ip: e.ip ?? null, userAgent: e.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message, action: e.action }, '[balcao] falha ao gravar auditoria');
  }
}

/** Atalho para rotas: preenche org/ator/ip/user-agent a partir de `req.bv`. */
export function auditReq(
  req: FastifyRequest, action: string,
  extra: Partial<Omit<AuditEntry, 'orgId' | 'action'>> & { orgId?: string } = {},
): Promise<void> {
  return audit({
    orgId: extra.orgId ?? req.bv!.orgId, actorType: 'USER', actorId: req.bv?.userId, action,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, ...extra,
  });
}

/** Remove campos sensíveis antes de guardar before/after. */
export function redact<T extends Record<string, any>>(obj: T, keys = ['passwordHash', 'totpSecretEnc', 'configEnc', 'tokenHash', 'refreshHash']): Partial<T> {
  const out: any = { ...obj };
  for (const k of keys) if (k in out) out[k] = '[redacted]';
  return out;
}
