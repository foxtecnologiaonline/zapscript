import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { decryptJson, encryptJson } from './crypto';
import type { IntegrationType } from './types';

/** Credenciais/config de canais e integrações, cifradas em repouso (BvIntegration.configEnc). */
export async function getIntegration<T = Record<string, any>>(orgId: string, type: IntegrationType, name = 'default'): Promise<{ id: string; enabled: boolean; config: T; status: string } | null> {
  const row = await prisma.bvIntegration.findUnique({ where: { orgId_type_name: { orgId, type, name } } });
  if (!row) return null;
  return { id: row.id, enabled: row.enabled, status: row.status, config: (row.configEnc ? decryptJson<T>(row.configEnc) : {}) as T };
}

export async function saveIntegration(orgId: string, type: IntegrationType, config: Record<string, any>, opts: { name?: string; enabled?: boolean } = {}) {
  const name = opts.name ?? 'default';
  const configEnc = encryptJson(config);
  return prisma.bvIntegration.upsert({
    where: { orgId_type_name: { orgId, type, name } },
    create: { orgId, type, name, configEnc, enabled: opts.enabled ?? true, status: 'UNCONFIGURED' },
    update: { configEnc, ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }) },
  });
}

export async function setIntegrationStatus(id: string, status: 'OK' | 'ERROR', lastError?: string | null) {
  await prisma.bvIntegration.update({ where: { id }, data: { status, lastError: lastError ?? null, lastCheckAt: new Date() } });
}

/** Devolve a config com segredos mascarados (para exibir no admin). */
export function maskSecrets<T extends Record<string, any>>(config: T): Record<string, any> {
  const SECRET = /(secret|token|password|senha|key|pass)/i;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    out[k] = typeof v === 'string' && SECRET.test(k) ? (v ? '••••••' : '') : v && typeof v === 'object' && !Array.isArray(v) ? maskSecrets(v) : v;
  }
  return out;
}

/** Registra chamada a sistema externo (diagnóstico/auditoria técnica; retenção curta). Nunca lança. */
export async function logIntegration(orgId: string, type: IntegrationType, operation: string, ok: boolean, extra: { durationMs?: number; error?: string; meta?: unknown } = {}) {
  try {
    await prisma.bvIntegrationLog.create({ data: { orgId, type, operation, ok, durationMs: extra.durationMs, error: extra.error?.slice(0, 500), meta: (extra.meta ?? undefined) as any } });
  } catch (err: any) { logger.warn({ err: err?.message }, '[balcao] logIntegration falhou'); }
}
