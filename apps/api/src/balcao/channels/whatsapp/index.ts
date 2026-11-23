import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { auditReq } from '../../core/audit';
import { recordConfigVersion } from '../../core/configVersion';
import { ChannelSendError, registerChannelSender } from '../../core/channels';
import { canAccessConversation, ConversationError, openConversation, sendMessage } from '../../core/conversations';
import { normalizePhone } from '../../core/contacts';
import { randomToken } from '../../core/crypto';
import { guard, idParam, parse, sendError } from '../../core/http';
import { getIntegration, logIntegration, maskSecrets, saveIntegration, setIntegrationStatus } from '../../core/integrations';
import { registerJob } from '../../core/scheduler';
import { getOrgSettings } from '../../core/settings';
import { invalidateWaConfigCache, listWaIntegrations, SECRET_PLACEHOLDER, validSignature, verifyTokenMatches } from './config';
import { customApiBaseAllowed, devSimulatorsEnabled, graphCall, GraphError, isMock, type WaConfig } from './graph';
import { processChanges, resolveChanges, retryPendingMedia, type WaPayload } from './inbound';
import { preflightTemplate, requireWaConfig, whatsappSender } from './sender';
import {
  renderTemplateText, TEMPLATE_CATEGORIES, TEMPLATE_LANG_RE, TEMPLATE_NAME_RE, validateTemplateComponents, type TemplateSendMeta,
} from './templates';

/**
 * Canal WhatsApp (Meta Cloud API oficial) do Balcão Virtual — prefixo /balcao/whatsapp.
 * Webhook público (HMAC), config admin, templates, envio de template e simuladores de desenvolvimento.
 */
registerChannelSender('WHATSAPP', whatsappSender);
registerJob('whatsapp.media_retry', { intervalMs: 60_000, lockTtlSec: 120 }, async () => { await retryPendingMedia(); });

const publicBase = () => (process.env.BV_PUBLIC_API_URL || 'https://api.zapscript.me').replace(/\/+$/, '');
const WEBHOOK_FIELDS = ['messages', 'message_template_status_update', 'template_category_update'];

const statusForCode = (code: string): number => {
  switch (code) {
    case 'whatsapp.quota_exceeded': case 'whatsapp.rate_limited': return 429;
    case 'whatsapp.outside_window': case 'whatsapp.not_configured': case 'whatsapp.disabled': return 409;
    case 'whatsapp.template_not_approved': case 'whatsapp.template_params_mismatch': case 'whatsapp.invalid_recipient': case 'whatsapp.invalid_parameter': return 422;
    default: return 502;
  }
};

async function configView(orgId: string) {
  const row = await prisma.bvIntegration.findUnique({ where: { orgId_type_name: { orgId, type: 'WHATSAPP', name: 'default' } } });
  const integ = row ? await getIntegration<WaConfig>(orgId, 'WHATSAPP') : null;
  const cfg = integ?.config;
  return {
    configured: !!cfg && !!(cfg.mock || (cfg.accessToken && cfg.phoneNumberId && cfg.wabaId && cfg.appSecret)),
    enabled: row?.enabled ?? false,
    status: row?.status ?? 'UNCONFIGURED',
    lastCheckAt: row?.lastCheckAt ?? null,
    lastError: row?.lastError ?? null,
    config: cfg ? maskSecrets({ ...cfg, verifyToken: undefined }) : null,
    webhook: { url: `${publicBase()}/balcao/whatsapp/webhook`, verifyToken: cfg?.verifyToken ?? null, fields: WEBHOOK_FIELDS },
    simulators: devSimulatorsEnabled(),
  };
}

/** Segredo novo (mín. `min` chars) ou o placeholder mascarado devolvido pelo GET (= manter o atual). */
const secretField = (min: number, max: number) => z.string().max(max).refine((v) => v === SECRET_PLACEHOLDER || v.length >= min, { message: `mínimo de ${min} caracteres` });

const configBody = z.object({
  accessToken: secretField(10, 4000).optional(),
  phoneNumberId: z.string().regex(/^\d{5,32}$/, 'phoneNumberId deve ser numérico').optional(),
  wabaId: z.string().regex(/^\d{5,32}$/, 'wabaId deve ser numérico').optional(),
  appSecret: secretField(8, 200).optional(),
  verifyToken: secretField(8, 200).optional(),
  graphVersion: z.string().regex(/^v\d{1,2}\.\d{1,2}$/).optional(),
  apiBase: z.string().url().nullable().optional(),
  mock: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).strict();

const templateBody = z.object({
  name: z.string().regex(TEMPLATE_NAME_RE, 'name: só a-z, 0-9 e _'),
  language: z.string().regex(TEMPLATE_LANG_RE, 'language inválido (ex.: pt_BR)').default('pt_BR'),
  category: z.enum(TEMPLATE_CATEGORIES),
  components: z.array(z.record(z.string(), z.any())).min(1).max(8),
});

const sendTemplateBody = z.object({
  contactId: z.string().min(1).max(64).optional(),
  phone: z.string().min(8).max(32).optional(),
  conversationId: z.string().min(1).max(64).optional(),
  templateName: z.string().regex(TEMPLATE_NAME_RE),
  language: z.string().regex(TEMPLATE_LANG_RE).default('pt_BR'),
  params: z.union([z.array(z.string().max(1024)).max(20), z.record(z.string(), z.any())]).optional(),
  components: z.array(z.record(z.string(), z.any())).max(8).optional(),
}).refine((b) => b.contactId || b.phone || b.conversationId, { message: 'Informe contactId, phone ou conversationId' });

export default async function plugin(app: FastifyInstance): Promise<void> {
  registerChannelSender('WHATSAPP', whatsappSender); // idempotente (também após clearChannelSenders em testes)
  // ══ Webhook público (Meta) ════════════════════════════════════════════════
  app.get('/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const mode = q['hub.mode'] ?? q.hub_mode;
    const token = q['hub.verify_token'] ?? q.hub_verify_token ?? '';
    const challenge = q['hub.challenge'] ?? q.hub_challenge;
    if (mode === 'subscribe' && challenge !== undefined && (await verifyTokenMatches(String(token)))) {
      return reply.code(200).type('text/plain').send(String(challenge));
    }
    return reply.code(403).send({ error: { code: 'whatsapp.webhook_forbidden', message: 'Token de verificação inválido' } });
  });

  app.post('/webhook', async (req, reply) => {
    const raw = (req as any).rawBody as Buffer | undefined;
    const payload = req.body as WaPayload;
    if (!raw || !payload || typeof payload !== 'object') return sendError(reply, 400, 'whatsapp.bad_payload', 'Corpo inválido');
    try {
      const resolved = await resolveChanges(payload);
      if (!resolved.length) return reply.code(200).send({ ok: true, ignored: true }); // número/WABA desconhecido: ignora
      const groups = new Map<string, { config: WaConfig; changes: Array<{ field: string; value: any }> }>();
      for (const r of resolved) {
        const g = groups.get(r.orgId) ?? { config: r.config, changes: [] };
        g.changes.push({ field: r.field, value: r.value });
        groups.set(r.orgId, g);
      }
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      let invalid = 0; let failed = 0;
      for (const [orgId, g] of groups) {
        if (!validSignature(raw, sig, g.config.appSecret)) { invalid++; logger.warn({ orgId }, '[balcao/whatsapp] webhook com assinatura inválida'); continue; }
        failed += (await processChanges(orgId, g.config, g.changes)).failed;
      }
      if (invalid === groups.size) return sendError(reply, 401, 'whatsapp.invalid_signature', 'Assinatura inválida');
      // Falha de persistência: 500 faz a Meta reenviar (o processamento é idempotente por wamid).
      if (failed) return sendError(reply, 500, 'whatsapp.processing_failed', 'Falha ao processar; reenvie');
      return reply.code(200).send({ ok: true });
    } catch (err: any) {
      logger.error({ err: err?.message }, '[balcao/whatsapp] erro no webhook');
      return sendError(reply, 500, 'whatsapp.processing_failed', 'Falha ao processar; reenvie');
    }
  });

  // ══ Configuração (admin) ══════════════════════════════════════════════════
  app.get('/config', { preHandler: guard('integration:manage') }, async (req) => configView(req.bv!.orgId));

  app.put('/config', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const body = parse(configBody, req.body, reply); if (!body) return;
    const orgId = req.bv!.orgId;
    const existing = await getIntegration<WaConfig>(orgId, 'WHATSAPP');
    const merged: Record<string, any> = { ...(existing?.config ?? {}) };
    for (const k of ['accessToken', 'appSecret', 'verifyToken'] as const) if (body[k] !== undefined && body[k] !== SECRET_PLACEHOLDER) merged[k] = body[k];
    for (const k of ['phoneNumberId', 'wabaId', 'graphVersion'] as const) if (body[k] !== undefined) merged[k] = body[k];
    if (body.apiBase !== undefined) {
      if (body.apiBase && !customApiBaseAllowed()) return sendError(reply, 400, 'whatsapp.api_base_disabled', 'apiBase só é aceito em ambiente de desenvolvimento/teste');
      if (body.apiBase) merged.apiBase = body.apiBase; else delete merged.apiBase;
    }
    if (body.mock !== undefined) {
      if (body.mock && !devSimulatorsEnabled()) return sendError(reply, 400, 'whatsapp.mock_disabled', 'Modo mock exige BV_DEV_SIMULATORS=1');
      merged.mock = body.mock;
    }
    if (!merged.mock) {
      const missing = (['accessToken', 'phoneNumberId', 'wabaId', 'appSecret'] as const).filter((k) => !merged[k]);
      if (missing.length) return sendError(reply, 400, 'whatsapp.config_incomplete', `Campos obrigatórios ausentes: ${missing.join(', ')}`, { missing });
    }
    if (!merged.verifyToken) merged.verifyToken = randomToken(24);
    // Um número/WABA só pode pertencer a um órgão (o webhook da Meta resolve o órgão por eles).
    for (const other of await listWaIntegrations(true)) {
      if (other.orgId === orgId) continue;
      if ((merged.phoneNumberId && other.config.phoneNumberId === merged.phoneNumberId) || (merged.wabaId && other.config.wabaId === merged.wabaId)) {
        return sendError(reply, 409, 'whatsapp.number_in_use', 'Este número/WABA já está configurado em outro órgão');
      }
    }
    const row = await saveIntegration(orgId, 'WHATSAPP', merged, { enabled: body.enabled ?? (existing ? undefined : true) });
    invalidateWaConfigCache();
    if (merged.mock) await setIntegrationStatus(row.id, 'OK');
    await recordConfigVersion(orgId, 'whatsapp_config', row.id, maskSecrets(merged), req.bv!.userId);
    await auditReq(req, 'whatsapp.config.update', { entityType: 'integration', entityId: row.id, before: existing ? maskSecrets(existing.config) : null, after: maskSecrets(merged) });
    return configView(orgId);
  });

  app.post('/config/test', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const orgId = req.bv!.orgId;
    const integ = await getIntegration<WaConfig>(orgId, 'WHATSAPP');
    if (!integ) return sendError(reply, 409, 'whatsapp.not_configured', 'Canal WhatsApp não configurado');
    const started = Date.now();
    if (isMock(integ.config)) {
      await setIntegrationStatus(integ.id, 'OK');
      return { ok: true, mock: true };
    }
    try {
      const phone = await graphCall<any>(integ.config, { method: 'GET', path: integ.config.phoneNumberId, params: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status' } });
      const waba = await graphCall<any>(integ.config, { method: 'GET', path: integ.config.wabaId, params: { fields: 'id,name,currency,message_template_namespace' } });
      await setIntegrationStatus(integ.id, 'OK');
      await logIntegration(orgId, 'WHATSAPP', 'config.test', true, { durationMs: Date.now() - started });
      await auditReq(req, 'whatsapp.config.test', { entityType: 'integration', entityId: integ.id, meta: { ok: true } });
      return {
        ok: true,
        phone: { displayPhoneNumber: phone?.display_phone_number, verifiedName: phone?.verified_name, qualityRating: phone?.quality_rating },
        waba: { id: waba?.id, name: waba?.name },
      };
    } catch (e: any) {
      const code = e instanceof GraphError ? e.errorCode : 'whatsapp.network_error';
      const msg = e instanceof GraphError ? e.message : 'Falha ao chamar a Graph';
      await setIntegrationStatus(integ.id, 'ERROR', msg);
      await logIntegration(orgId, 'WHATSAPP', 'config.test', false, { durationMs: Date.now() - started, error: `${code}: ${msg}` });
      await auditReq(req, 'whatsapp.config.test', { entityType: 'integration', entityId: integ.id, meta: { ok: false, code } });
      return { ok: false, error: { code, message: msg } };
    }
  });

  app.get('/health', { preHandler: guard('integration:manage') }, async (req) => {
    const orgId = req.bv!.orgId;
    const view = await configView(orgId);
    const since = new Date(Date.now() - 24 * 3600_000);
    const [lastIn, lastOut, failed24h, templates, settings] = await Promise.all([
      prisma.bvMessage.findFirst({ where: { orgId, direction: 'IN', conversation: { channel: 'WHATSAPP' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.bvMessage.findFirst({ where: { orgId, direction: 'OUT', status: { in: ['SENT', 'DELIVERED', 'READ'] }, conversation: { channel: 'WHATSAPP' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.bvMessage.count({ where: { orgId, direction: 'OUT', status: 'FAILED', createdAt: { gte: since }, conversation: { channel: 'WHATSAPP' } } }),
      prisma.bvWaTemplate.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
      getOrgSettings(orgId),
    ]);
    return {
      configured: view.configured, enabled: view.enabled, status: view.status, lastCheckAt: view.lastCheckAt, lastError: view.lastError,
      mock: !!(view.config as any)?.mock && devSimulatorsEnabled(), windowHours: settings.whatsapp.windowHours,
      lastInboundAt: lastIn?.createdAt ?? null, lastOutboundAt: lastOut?.createdAt ?? null, failedOutbound24h: failed24h,
      templates: Object.fromEntries(templates.map((t) => [t.status, t._count._all])),
    };
  });

  // ══ Templates ═════════════════════════════════════════════════════════════
  const listQuery = z.object({ status: z.string().max(30).optional(), category: z.enum(TEMPLATE_CATEGORIES).optional() });

  app.get('/templates', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const q = parse(listQuery, req.query, reply); if (!q) return;
    return prisma.bvWaTemplate.findMany({ where: { orgId: req.bv!.orgId, ...(q.status ? { status: q.status } : {}), ...(q.category ? { category: q.category } : {}) }, orderBy: [{ name: 'asc' }, { language: 'asc' }], take: 500 });
  });

  app.get('/templates/:id', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const t = await prisma.bvWaTemplate.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    return t ?? sendError(reply, 404, 'whatsapp.template_not_found', 'Template não encontrado');
  });

  app.post('/templates', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const b = parse(templateBody, req.body, reply); if (!b) return;
    const errors = validateTemplateComponents(b.components, b.category);
    if (errors.length) return sendError(reply, 400, 'whatsapp.template_invalid', 'Template inválido', errors);
    try {
      const t = await prisma.bvWaTemplate.create({ data: { orgId: req.bv!.orgId, name: b.name, language: b.language, category: b.category, components: b.components as any, status: 'DRAFT' } });
      await auditReq(req, 'whatsapp.template.create', { entityType: 'wa_template', entityId: t.id, after: { name: t.name, language: t.language, category: t.category } });
      return reply.code(201).send(t);
    } catch (err: any) {
      if (err?.code === 'P2002') return sendError(reply, 409, 'whatsapp.template_exists', 'Já existe template com este nome e idioma');
      throw err;
    }
  });

  app.put('/templates/:id', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(templateBody.pick({ category: true, components: true }), req.body, reply); if (!b) return;
    const t = await prisma.bvWaTemplate.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!t) return sendError(reply, 404, 'whatsapp.template_not_found', 'Template não encontrado');
    if (!['DRAFT', 'REJECTED'].includes(t.status)) return sendError(reply, 409, 'whatsapp.template_locked', 'Só rascunhos e templates rejeitados podem ser editados');
    const errors = validateTemplateComponents(b.components, b.category);
    if (errors.length) return sendError(reply, 400, 'whatsapp.template_invalid', 'Template inválido', errors);
    const upd = await prisma.bvWaTemplate.update({ where: { id: t.id }, data: { category: b.category, components: b.components as any, status: 'DRAFT', rejectedReason: null } });
    await auditReq(req, 'whatsapp.template.update', { entityType: 'wa_template', entityId: t.id });
    return upd;
  });

  app.delete('/templates/:id', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const force = (req.query as any)?.force === '1';
    const orgId = req.bv!.orgId;
    const t = await prisma.bvWaTemplate.findFirst({ where: { id: p.id, orgId } });
    if (!t) return sendError(reply, 404, 'whatsapp.template_not_found', 'Template não encontrado');
    if (t.status !== 'DRAFT' && !force) {
      const cfg = (await getIntegration<WaConfig>(orgId, 'WHATSAPP'))?.config;
      if (cfg && !isMock(cfg) && t.metaTemplateId) {
        try { await graphCall(cfg, { method: 'DELETE', path: `${cfg.wabaId}/message_templates`, params: { name: t.name } }); } catch (e: any) {
          const ge = e instanceof GraphError ? e : null;
          return sendError(reply, 502, ge?.errorCode ?? 'whatsapp.send_failed', 'Não foi possível remover o template na Meta (use ?force=1 para remover só localmente)');
        }
      }
    }
    await prisma.bvWaTemplate.delete({ where: { id: t.id } });
    await auditReq(req, 'whatsapp.template.delete', { entityType: 'wa_template', entityId: t.id, meta: { name: t.name, force } });
    return reply.code(204).send();
  });

  app.post('/templates/:id/submit', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const orgId = req.bv!.orgId;
    const t = await prisma.bvWaTemplate.findFirst({ where: { id: p.id, orgId } });
    if (!t) return sendError(reply, 404, 'whatsapp.template_not_found', 'Template não encontrado');
    if (!['DRAFT', 'REJECTED'].includes(t.status)) return sendError(reply, 409, 'whatsapp.template_locked', `Template em status ${t.status} não pode ser submetido`);
    const errors = validateTemplateComponents(t.components, t.category);
    if (errors.length) return sendError(reply, 400, 'whatsapp.template_invalid', 'Template inválido', errors);
    let cfg: WaConfig;
    try { cfg = await requireWaConfig(orgId); } catch (e: any) { return sendError(reply, 409, e.code ?? 'whatsapp.not_configured', e.message); }
    let upd;
    if (isMock(cfg)) {
      upd = await prisma.bvWaTemplate.update({ where: { id: t.id }, data: { status: 'APPROVED', metaTemplateId: `mock-${crypto.randomBytes(5).toString('hex')}`, rejectedReason: null } });
    } else {
      try {
        const r = await graphCall<{ id?: string; status?: string; category?: string }>(cfg, {
          method: 'POST', path: `${cfg.wabaId}/message_templates`, noRetryOnTimeout: true,
          json: { name: t.name, language: t.language, category: t.category, components: t.components },
        });
        upd = await prisma.bvWaTemplate.update({
          where: { id: t.id },
          data: { status: String(r?.status ?? 'PENDING').toUpperCase(), metaTemplateId: r?.id ? String(r.id) : null, rejectedReason: null, ...(r?.category ? { category: String(r.category).toUpperCase() } : {}) },
        });
      } catch (e: any) {
        const ge = e instanceof GraphError ? e : null;
        await logIntegration(orgId, 'WHATSAPP', 'template.submit', false, { error: ge?.message });
        return sendError(reply, ge && ge.httpStatus >= 400 && ge.httpStatus < 500 ? 422 : 502, ge?.errorCode ?? 'whatsapp.send_failed', ge?.message ?? 'Falha ao submeter à Meta');
      }
    }
    await auditReq(req, 'whatsapp.template.submit', { entityType: 'wa_template', entityId: t.id, meta: { status: upd.status } });
    return upd;
  });

  app.post('/templates/sync', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const orgId = req.bv!.orgId;
    let cfg: WaConfig;
    try { cfg = await requireWaConfig(orgId); } catch (e: any) { return sendError(reply, 409, e.code ?? 'whatsapp.not_configured', e.message); }
    if (isMock(cfg)) return { created: 0, updated: 0, unchanged: 0, total: 0, mock: true };
    const remote: any[] = [];
    try {
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const r = await graphCall<any>(cfg, { method: 'GET', path: `${cfg.wabaId}/message_templates`, params: { fields: 'id,name,language,status,category,rejected_reason,components', limit: 100, after } });
        remote.push(...(r?.data ?? []));
        after = r?.paging?.cursors?.after;
        if (!r?.paging?.next || !after) break;
      }
    } catch (e: any) {
      const ge = e instanceof GraphError ? e : null;
      await logIntegration(orgId, 'WHATSAPP', 'template.sync', false, { error: ge?.message });
      return sendError(reply, 502, ge?.errorCode ?? 'whatsapp.send_failed', ge?.message ?? 'Falha ao consultar a Meta');
    }
    let created = 0; let updated = 0; let unchanged = 0;
    for (const r of remote) {
      if (!r?.name || !r?.language) continue;
      const status = String(r.status ?? 'PENDING').toUpperCase();
      const category = String(r.category ?? 'UTILITY').toUpperCase();
      const reason = r.rejected_reason && String(r.rejected_reason).toUpperCase() !== 'NONE' ? String(r.rejected_reason) : null;
      const local = await prisma.bvWaTemplate.findUnique({ where: { orgId_name_language: { orgId, name: String(r.name), language: String(r.language) } } });
      if (!local) {
        await prisma.bvWaTemplate.create({ data: { orgId, name: String(r.name), language: String(r.language), category, components: (r.components ?? []) as any, status, metaTemplateId: r.id ? String(r.id) : null, rejectedReason: reason } });
        created++;
      } else if (local.status !== status || local.category !== category || (local.rejectedReason ?? null) !== reason || local.metaTemplateId !== (r.id ? String(r.id) : local.metaTemplateId)) {
        await prisma.bvWaTemplate.update({ where: { id: local.id }, data: { status, category, rejectedReason: reason, metaTemplateId: r.id ? String(r.id) : local.metaTemplateId } });
        updated++;
      } else unchanged++;
    }
    await logIntegration(orgId, 'WHATSAPP', 'template.sync', true, { meta: { created, updated, unchanged } });
    await auditReq(req, 'whatsapp.template.sync', { meta: { created, updated, unchanged } });
    return { created, updated, unchanged, total: remote.length };
  });

  // ══ Envio ativo de template ═══════════════════════════════════════════════
  app.post('/send-template', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const b = parse(sendTemplateBody, req.body, reply); if (!b) return;
    const ctx = req.bv!;
    const orgId = ctx.orgId;
    const meta: TemplateSendMeta = { templateName: b.templateName, language: b.language, ...(b.params ? { params: b.params as any } : {}), ...(b.components ? { components: b.components } : {}) };
    try {
      await requireWaConfig(orgId);
      const pf = await preflightTemplate(orgId, meta); // falha cedo, sem criar conversa à toa

      let conv = null as Awaited<ReturnType<typeof prisma.bvConversation.findFirst>>;
      if (b.conversationId) {
        conv = await prisma.bvConversation.findFirst({ where: { id: b.conversationId, orgId } });
        if (!conv) return sendError(reply, 404, 'conversation.not_found', 'Conversa não encontrada');
        if (conv.channel !== 'WHATSAPP') return sendError(reply, 400, 'whatsapp.wrong_channel', 'A conversa não é de WhatsApp');
        if (conv.status === 'CLOSED') return sendError(reply, 409, 'conversation.closed', 'Conversa encerrada');
      } else {
        const contact = b.contactId ? await prisma.bvContact.findFirst({ where: { id: b.contactId, orgId, mergedIntoId: null, anonymizedAt: null } }) : null;
        if (b.contactId && !contact) return sendError(reply, 404, 'contact.not_found', 'Contato não encontrado');
        const phone = normalizePhone(b.phone ?? contact?.phone);
        if (!phone) return sendError(reply, 422, 'whatsapp.invalid_recipient', 'Contato sem número de telefone válido');
        conv = await prisma.bvConversation.findFirst({ where: { orgId, channel: 'WHATSAPP', channelRef: phone, status: { not: 'CLOSED' } }, orderBy: { startedAt: 'desc' } });
        if (!conv) {
          const isUser = ctx.via === 'jwt';
          const opened = await openConversation({
            orgId, channel: 'WHATSAPP', channelRef: phone, externalId: phone, phone, name: contact?.name ?? null,
            status: isUser ? 'ACTIVE' : 'WAITING', assignedUserId: isUser ? ctx.userId : null,
          });
          conv = opened.conversation;
        }
      }
      if (!(await canAccessConversation(ctx, conv))) return sendError(reply, 403, 'auth.forbidden', 'Sem acesso à conversa');

      const body = renderTemplateText(pf.tpl.components, meta);
      const r = await sendMessage({
        orgId, conversationId: conv.id, senderType: ctx.via === 'jwt' ? 'AGENT' : 'SYSTEM', userId: ctx.via === 'jwt' ? ctx.userId : null,
        kind: 'TEMPLATE', body, channelMeta: { templateName: pf.name, language: pf.language, ...(b.params ? { params: b.params } : {}), ...(b.components ? { components: b.components } : {}) },
      });
      await auditReq(req, 'whatsapp.template.send', { entityType: 'conversation', entityId: conv.id, meta: { template: pf.name, category: pf.tpl.category, ok: !r.error, error: r.error } });
      if (r.error) return sendError(reply, statusForCode(r.error), r.error, 'Falha ao enviar o template', { conversationId: conv.id, messageId: r.message.id });
      return reply.code(201).send({ conversationId: conv.id, protocol: conv.protocol, message: { id: r.message.id, status: r.message.status, channelMessageId: r.message.channelMessageId }, usageItem: pf.item });
    } catch (e: any) {
      if (e instanceof ChannelSendError) return sendError(reply, statusForCode(e.code), e.code, e.message);
      if (e instanceof ConversationError) return sendError(reply, e.status, e.code, e.message);
      throw e;
    }
  });

  // ══ Simuladores de desenvolvimento (BV_DEV_SIMULATORS=1) ══════════════════
  if (devSimulatorsEnabled()) {
    const simBody = z.object({
      orgId: z.string().max(64).optional(),
      from: z.string().min(8).max(32),
      name: z.string().max(120).optional(),
      text: z.string().min(1).max(4096),
    });
    app.post('/dev/simulate-inbound', { preHandler: guard('integration:manage') }, async (req, reply) => {
      const b = parse(simBody, req.body, reply); if (!b) return;
      const orgId = req.bv!.orgId;
      if (b.orgId && b.orgId !== orgId) return sendError(reply, 403, 'auth.forbidden', 'orgId diferente do órgão autenticado');
      const integ = await getIntegration<WaConfig>(orgId, 'WHATSAPP');
      const from = normalizePhone(b.from);
      if (!from) return sendError(reply, 400, 'validation.failed', 'from inválido');
      const wamid = `wamid.sim.${crypto.randomBytes(9).toString('hex')}`;
      const value = {
        messaging_product: 'whatsapp', metadata: { display_phone_number: from, phone_number_id: integ?.config.phoneNumberId ?? `sim-${orgId}` },
        contacts: [{ profile: { name: b.name ?? 'Cidadão (simulado)' }, wa_id: from }],
        messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: b.text } }],
      };
      const res = await processChanges(orgId, integ?.config ?? ({} as WaConfig), [{ field: 'messages', value }]);
      if (res.failed) return sendError(reply, 500, 'whatsapp.processing_failed', 'Falha ao processar a mensagem simulada');
      const msg = await prisma.bvMessage.findFirst({ where: { orgId, channelMessageId: wamid }, select: { id: true, conversationId: true } });
      return { ok: true, wamid, messageId: msg?.id ?? null, conversationId: msg?.conversationId ?? null };
    });

    const simStatus = z.object({ wamid: z.string().min(5).max(200), status: z.enum(['sent', 'delivered', 'read', 'failed']), errorCode: z.number().int().optional() });
    app.post('/dev/simulate-status', { preHandler: guard('integration:manage') }, async (req, reply) => {
      const b = parse(simStatus, req.body, reply); if (!b) return;
      const orgId = req.bv!.orgId;
      const value = { metadata: { phone_number_id: 'sim' }, statuses: [{ id: b.wamid, status: b.status, timestamp: String(Math.floor(Date.now() / 1000)), ...(b.status === 'failed' ? { errors: [{ code: b.errorCode ?? 131047, title: 'simulado' }] } : {}) }] };
      const res = await processChanges(orgId, {} as WaConfig, [{ field: 'messages', value }]);
      return { ok: res.failed === 0 };
    });
  }
}
