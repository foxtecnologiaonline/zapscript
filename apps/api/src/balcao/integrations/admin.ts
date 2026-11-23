import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { recordConfigVersion } from '../core/configVersion';
import { getIntegration, saveIntegration, setIntegrationStatus } from '../core/integrations';
import { guard, parse, sendError } from '../core/http';
import type { IntegrationType } from '../core/types';
import type { Deps } from './common';
import { eprocConfigSchema, EPROC_SECRETS, testEproc } from './eproc';
import { govbrConfigSchema, GOVBR_SECRETS, testGovbr } from './govbr';
import { oidcConfigSchema, OIDC_SECRETS, testOidc } from './oidc';
import { googleConfigSchema, GOOGLE_SECRETS, testGoogle } from './google';
import { jiraConfigSchema, JIRA_SECRETS, testJira } from './jira';
import { validatePublicUrl } from './http-client';

/** Admin das integrações (perm integration:manage). */

interface Def { schema: z.ZodTypeAny; secrets: string[]; urls: string[]; test: (config: any, deps: Deps) => Promise<{ ok: boolean; message: string }> }

export const MANAGED: Partial<Record<IntegrationType, Def>> = {
  EPROC: { schema: eprocConfigSchema, secrets: EPROC_SECRETS, urls: ['endpoint', 'wsdlUrl'], test: testEproc },
  GOVBR: { schema: govbrConfigSchema, secrets: GOVBR_SECRETS, urls: ['redirectUri', 'authorizeUrl', 'tokenUrl', 'jwksUri', 'userinfoUrl'], test: testGovbr },
  OIDC_TJTO: { schema: oidcConfigSchema, secrets: OIDC_SECRETS, urls: ['redirectUri', 'authorizeUrl', 'tokenUrl', 'jwksUri', 'userinfoUrl', 'frontendRedirect'], test: testOidc },
  GOOGLE_WORKSPACE: { schema: googleConfigSchema, secrets: GOOGLE_SECRETS, urls: ['calendarBaseUrl', 'gmailBaseUrl'], test: testGoogle },
  JIRA: { schema: jiraConfigSchema, secrets: JIRA_SECRETS, urls: ['baseUrl'], test: testJira },
};
/** Tipos que existem no Balcão mas são gerenciados por outras frentes. */
const OTHER: IntegrationType[] = ['WHATSAPP', 'EMAIL_IMAP', 'SIP_TRUNK', 'URA_0800', 'LLM'];
const ALL_TYPES = [...(Object.keys(MANAGED) as IntegrationType[]), ...OTHER];

const MASK = '••••••';
export const SECRET_MASK = MASK;

/** Mascara segredos (lista explícita por tipo + heurística do core para os demais). */
export function maskConfig(type: IntegrationType, config: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...config };
  for (const k of MANAGED[type]?.secrets ?? []) if (out[k]) out[k] = MASK;
  if (!MANAGED[type]) for (const [k, v] of Object.entries(out)) if (typeof v === 'string' && /(secret|token|password|senha|key|pass)/i.test(k) && v) out[k] = MASK;
  return out;
}

const typeParam = z.object({ type: z.enum(ALL_TYPES as [IntegrationType, ...IntegrationType[]]) });
const putBody = z.object({ enabled: z.boolean().optional(), config: z.record(z.string(), z.any()) });
const logsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function registerAdminRoutes(app: FastifyInstance, deps: Deps = {}): void {
  app.get('/', { preHandler: guard('integration:manage') }, async (req) => {
    const rows = await prisma.bvIntegration.findMany({ where: { orgId: req.bv!.orgId, name: 'default' } });
    return {
      integrations: ALL_TYPES.map((type) => {
        const r = rows.find((x) => x.type === type);
        return {
          type, managedHere: !!MANAGED[type], configured: !!r?.configEnc, enabled: r?.enabled ?? false,
          status: r?.status ?? 'UNCONFIGURED', lastCheckAt: r?.lastCheckAt ?? null, lastError: r?.lastError ?? null,
        };
      }),
    };
  });

  app.get('/:type', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(typeParam, req.params, reply);
    if (!p) return;
    const row = await getIntegration(req.bv!.orgId, p.type);
    if (!row) return { type: p.type, configured: false, enabled: false, status: 'UNCONFIGURED', config: {} };
    return { type: p.type, configured: true, enabled: row.enabled, status: row.status, config: maskConfig(p.type, row.config) };
  });

  app.put('/:type', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(typeParam, req.params, reply);
    const b = p && parse(putBody, req.body, reply);
    if (!p || !b) return;
    const def = MANAGED[p.type];
    if (!def) return sendError(reply, 400, 'integration.not_managed_here', 'Este tipo é configurado em outro módulo');
    const orgId = req.bv!.orgId;
    const existing = await getIntegration<Record<string, any>>(orgId, p.type);
    // Segredo omitido/vazio/mascarado mantém o valor atual.
    const merged: Record<string, any> = { ...b.config };
    for (const k of def.secrets) if (merged[k] === undefined || merged[k] === '' || merged[k] === MASK) { if (existing?.config?.[k]) merged[k] = existing.config[k]; else delete merged[k]; }
    const parsed = def.schema.safeParse(merged);
    if (!parsed.success) return sendError(reply, 400, 'validation.failed', 'Configuração inválida', parsed.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })));
    const policy = { allowPrivateHosts: merged.allowPrivateHosts === true && process.env.NODE_ENV !== 'production' };
    for (const k of def.urls) {
      const v = (parsed.data as any)[k];
      const err = typeof v === 'string' && v ? validatePublicUrl(v, policy) : null;
      // URLs do próprio sistema (redirectUri / frontendRedirect) podem ser http local em dev; as demais seguem a política de SSRF.
      if (err && !(k === 'frontendRedirect' || k === 'redirectUri')) return sendError(reply, 400, 'validation.failed', 'Configuração inválida', [{ path: k, message: err }]);
    }
    const toSave = { ...(parsed.data as Record<string, any>), ...(merged.allowPrivateHosts === true ? { allowPrivateHosts: true } : {}) };
    const row = await saveIntegration(orgId, p.type, toSave, { enabled: b.enabled ?? existing?.enabled ?? true });
    await setIntegrationStatus(row.id, 'ERROR', 'Aguardando teste de conexão').catch(() => undefined);
    await prisma.bvIntegration.update({ where: { id: row.id }, data: { status: 'UNCONFIGURED', lastError: null, lastCheckAt: null } });
    await recordConfigVersion(orgId, 'integration', row.id, { type: p.type, enabled: row.enabled, config: maskConfig(p.type, toSave) }, req.bv!.userId.startsWith('token:') ? null : req.bv!.userId);
    await auditReq(req, 'integration.update', { entityType: 'integration', entityId: row.id, meta: { type: p.type, enabled: row.enabled } });
    return { type: p.type, enabled: row.enabled, status: 'UNCONFIGURED', config: maskConfig(p.type, toSave) };
  });

  app.post('/:type/test', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(typeParam, req.params, reply);
    if (!p) return;
    const def = MANAGED[p.type];
    if (!def) return sendError(reply, 400, 'integration.not_managed_here', 'Este tipo é testado em outro módulo');
    const orgId = req.bv!.orgId;
    const row = await getIntegration<Record<string, any>>(orgId, p.type);
    if (!row) return sendError(reply, 404, 'integration.not_configured', 'Integração não configurada');
    const parsed = def.schema.safeParse(row.config);
    let result: { ok: boolean; message: string };
    if (!parsed.success) result = { ok: false, message: 'Configuração inválida' };
    else result = await def.test({ ...(parsed.data as any), allowPrivateHosts: row.config.allowPrivateHosts === true }, deps);
    await setIntegrationStatus(row.id, result.ok ? 'OK' : 'ERROR', result.ok ? null : result.message);
    const { logIntegration } = await import('../core/integrations');
    await logIntegration(orgId, p.type, 'test', result.ok, { error: result.ok ? undefined : result.message });
    await auditReq(req, 'integration.test', { entityType: 'integration', entityId: row.id, meta: { type: p.type, ok: result.ok } });
    return { type: p.type, ok: result.ok, status: result.ok ? 'OK' : 'ERROR', message: result.message };
  });

  app.get('/:type/logs', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(typeParam, req.params, reply);
    const q = p && parse(logsQuery, req.query, reply);
    if (!p || !q) return;
    const logs = await prisma.bvIntegrationLog.findMany({ where: { orgId: req.bv!.orgId, type: p.type }, orderBy: { createdAt: 'desc' }, take: q.limit });
    return { logs: logs.map((l) => ({ id: l.id, operation: l.operation, ok: l.ok, durationMs: l.durationMs, error: l.error, createdAt: l.createdAt })) };
  });
}
