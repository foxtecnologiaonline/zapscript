import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { recordConfigVersion } from '../../core/configVersion';
import { bvAuth, guard, idParam, parse, sendError } from '../../core/http';
import { getIntegration, logIntegration, maskSecrets, saveIntegration, setIntegrationStatus } from '../../core/integrations';
import { can } from '../../core/permissions';
import { getHolidays, getOrgSettings } from '../../core/settings';
import { newKey, putObject } from '../../core/storage';
import { maskNumber } from './dialPolicy';
import { URA0800_DEFAULTS, testUra0800, ura0800Schema, type Ura0800Config } from './ura0800';
import { getAriController } from './controller';
import { DEFAULT_TRUNK, devSimulatorsEnabled, trunkConfigSchema, voiceEnabled, type TrunkConfig } from './config';
import { FlowError, createDraft, deleteDraft, publishFlow, updateDraft } from './ivrFlows';
import { simulateIvr, validateIvrDefinition } from './ivr';
import { prewarmPrompts, ALLOWED_AUDIO_EXT } from './prompts';
import { streamRecording, verifyRecordingIntegrity } from './recordings';
import { simulateCall } from './simulator';
import { buildSoftphoneCredentials } from './sip';
import { inspectWav } from './wav';
import { logger } from '../../../lib/logger';

const MASK = '••••••';

function callDto(c: any) {
  return {
    id: c.id, conversationId: c.conversationId, protocol: c.conversation?.protocol ?? null, direction: c.direction, from: c.fromNumber, to: c.toNumber,
    status: c.status, agentUserId: c.agentUserId, startedAt: c.startedAt, answeredAt: c.answeredAt, endedAt: c.endedAt, durationSec: c.durationSec,
    ivrFlowId: c.ivrFlowId, ivrPath: c.ivrPath, recordingNotified: c.recordingNotified, endReason: c.endReason,
    hasRecording: !!c.recordingKey, recordingSha256: c.recordingSha256 ?? null, recordingSizeBytes: c.recordingSizeBytes != null ? Number(c.recordingSizeBytes) : null,
  };
}

function flowDto(f: any, withDef = false) {
  return { id: f.id, name: f.name, version: f.version, status: f.status, language: f.language, createdById: f.createdById, publishedAt: f.publishedAt, createdAt: f.createdAt, dids: f.definition?.dids ?? [], ...(withDef ? { definition: f.definition } : {}) };
}

const flowErr = (reply: any, err: unknown) => {
  if (err instanceof FlowError) return sendError(reply, err.status, err.code, err.message, err.details);
  throw err;
};

const numberRe = /^\+?[0-9*#]{2,20}$/;
const inputsSchema = z.array(z.string().max(60)).max(200);

export default async function registerRoutes(app: FastifyInstance): Promise<void> {
  // áudio bruto para upload de prompts (escopo deste plugin)
  app.addContentTypeParser(['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 12 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // ── status ────────────────────────────────────────────────────────────────────────────────────────
  app.get('/status', { preHandler: guard('conversation:monitor') }, async () => {
    const c = getAriController();
    if (!c) return { enabled: voiceEnabled(), role: null, connected: false, started: false };
    return { ...c.status(), started: true };
  });

  // ── chamadas ──────────────────────────────────────────────────────────────────────────────────────
  const listQuery = z.object({
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), number: z.string().max(30).optional(), agentUserId: z.string().max(64).optional(),
    status: z.enum(['RINGING', 'IVR', 'QUEUED', 'ACTIVE', 'ENDED', 'ABANDONED', 'FAILED']).optional(), direction: z.enum(['IN', 'OUT']).optional(),
    protocol: z.string().max(40).optional(), hasRecording: z.enum(['true', 'false']).optional(), minDuration: z.coerce.number().int().min(0).optional(), maxDuration: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(64).optional(),
  });

  app.get('/calls', { preHandler: guard('conversation:read') }, async (req, reply) => {
    const q = parse(listQuery, req.query, reply); if (!q) return;
    const ctx = req.bv!;
    const where: Prisma.BvCallWhereInput = { orgId: ctx.orgId };
    if (!can(ctx.role, 'conversation:read_all')) where.agentUserId = ctx.userId; else if (q.agentUserId) where.agentUserId = q.agentUserId;
    if (q.from || q.to) where.startedAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.status) where.status = q.status;
    if (q.direction) where.direction = q.direction;
    if (q.number) { const d = q.number.replace(/[^\d+*#]/g, ''); if (d) where.OR = [{ fromNumber: { contains: d } }, { toNumber: { contains: d } }]; }
    if (q.hasRecording) where.recordingKey = q.hasRecording === 'true' ? { not: null } : null;
    if (q.protocol) where.conversation = { protocol: { contains: q.protocol, mode: 'insensitive' } };
    if (q.minDuration != null || q.maxDuration != null) where.durationSec = { ...(q.minDuration != null ? { gte: q.minDuration } : {}), ...(q.maxDuration != null ? { lte: q.maxDuration } : {}) };
    const rows = await prisma.bvCall.findMany({
      where, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, include: { conversation: { select: { protocol: true } } },
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    return { items: page.map(callDto), nextCursor: rows.length > q.limit ? page[page.length - 1].id : null };
  });

  async function loadCall(req: any, reply: any, id: string) {
    const ctx = req.bv!;
    const call = await prisma.bvCall.findFirst({ where: { id, orgId: ctx.orgId }, include: { conversation: { select: { protocol: true, metadata: true } } } });
    if (!call || (!can(ctx.role, 'conversation:read_all') && call.agentUserId !== ctx.userId)) { sendError(reply, 404, 'call.not_found', 'Chamada não encontrada'); return null; }
    return call;
  }

  app.get('/calls/:id', { preHandler: guard('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const call = await loadCall(req, reply, p.id); if (!call) return;
    // metadados da conversa: cabeçalhos SIP X-* da URA 0800, DID, transbordo e resultado da URA (sem dados sensíveis)
    const meta = ((call as any).conversation?.metadata ?? {}) as { voice?: Record<string, any>; ivr?: Record<string, any> };
    const v = meta.voice ?? {}; const i = meta.ivr ?? {};
    return {
      ...callDto(call),
      voice: { did: v.did ?? call.toNumber, headers: v.headers ?? {}, flow: v.flow ?? null, transferredTo: v.transferredTo ?? null, transferredAt: v.transferredAt ?? null, simulated: v.simulated === true, hasUraRecording: !!v.uraRecording },
      ivr: { lang: i.lang ?? null, category: i.category ?? null, queue: i.queue ?? null, outcome: i.outcome ?? null, vars: i.vars ?? {}, sensitiveCollected: i.sensitiveCollected ?? [] },
    };
  });

  // Cobertura de gravação (TR: 100% das chamadas): chamadas atendidas pela plataforma × com arquivo de gravação.
  app.get('/recording/coverage', { preHandler: guard('report:read') }, async (req, reply) => {
    const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query, reply); if (!q) return;
    const base: Prisma.BvCallWhereInput = {
      orgId: req.bv!.orgId, endedAt: { not: null },
      // gravável = a plataforma atendeu (URA/fila) ou houve ligação estabelecida; originações que nunca atenderam não têm áudio
      OR: [{ direction: 'IN', status: { in: ['ENDED', 'ABANDONED'] } }, { answeredAt: { not: null } }],
      ...(q.from || q.to ? { startedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const [total, withRecording] = await Promise.all([prisma.bvCall.count({ where: base }), prisma.bvCall.count({ where: { ...base, recordingKey: { not: null } } })]);
    const missing = await prisma.bvCall.findMany({ where: { ...base, recordingKey: null }, select: { id: true, startedAt: true, endReason: true }, orderBy: { startedAt: 'desc' }, take: 50 });
    return { total, withRecording, withoutRecording: total - withRecording, coveragePct: total ? Math.round((withRecording / total) * 10000) / 100 : 100, recentMissing: missing };
  });

  const recQuery = z.object({ part: z.enum(['main', 'ura']).default('main'), download: z.coerce.boolean().optional() });
  app.get('/calls/:id/recording', { preHandler: guard('recording:listen') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const q = parse(recQuery, req.query, reply); if (!q) return;
    return streamRecording(req, reply, p.id, q.part, q.download === true);
  });

  app.get('/calls/:id/recording/meta', { preHandler: guard('recording:listen') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const q = parse(z.object({ verify: z.coerce.boolean().optional() }), req.query, reply); if (!q) return;
    const call = await prisma.bvCall.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!call) return sendError(reply, 404, 'call.not_found', 'Chamada não encontrada');
    if (!call.recordingKey) return sendError(reply, 404, 'recording.not_found', 'Esta chamada não tem gravação');
    await auditReq(req, 'recording.meta', { entityType: 'BvCall', entityId: call.id });
    return {
      callId: call.id, format: 'audio/wav', sha256: call.recordingSha256, sizeBytes: call.recordingSizeBytes != null ? Number(call.recordingSizeBytes) : null, durationSec: call.durationSec,
      recordedAt: call.startedAt, ...(q.verify ? { integrityOk: await verifyRecordingIntegrity(call.recordingKey, call.recordingSha256) } : {}),
    };
  });

  app.post('/calls/:id/transfer', { preHandler: guard('conversation:transfer') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.object({ number: z.string().regex(numberRe, 'número inválido') }), req.body, reply); if (!b) return;
    const ctl = getAriController(); if (!ctl) return sendError(reply, 503, 'voice.disabled', 'Telefonia desabilitada ou desconectada');
    const call = await loadCall(req, reply, p.id); if (!call) return;
    const r = await ctl.transferCall(req.bv!.orgId, p.id, b.number);
    if (!r.ok) return sendError(reply, r.code === 'call.not_found' ? 404 : r.code === 'voice.transfer_not_allowed' ? 403 : 409, r.code, r.message);
    await auditReq(req, 'call.transfer', { entityType: 'BvCall', entityId: p.id, meta: { toLast4: b.number.slice(-4) } });
    return reply.code(202).send({ ok: true });
  });

  app.post('/calls/:id/hangup', { preHandler: guard('conversation:close') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const ctl = getAriController(); if (!ctl) return sendError(reply, 503, 'voice.disabled', 'Telefonia desabilitada ou desconectada');
    const call = await loadCall(req, reply, p.id); if (!call) return;
    return (await ctl.hangup(req.bv!.orgId, p.id)) ? { ok: true } : sendError(reply, 404, 'call.not_found', 'Chamada não encontrada ou já encerrada');
  });

  // Permissão (conversation:reply), presença e limites são aplicados pela política de discagem do órgão (settings.voice.dial*) dentro do controlador.
  app.post('/calls/dial', { preHandler: bvAuth }, async (req, reply) => {
    const b = parse(z.object({ number: z.string().regex(numberRe, 'número inválido') }), req.body, reply); if (!b) return;
    const ctl = getAriController(); if (!ctl) return sendError(reply, 503, 'voice.disabled', 'Telefonia desabilitada ou desconectada');
    const r = await ctl.dial(req.bv!.orgId, req.bv!.userId, b.number);
    const meta = { to: maskNumber(b.number) };
    if (!r.ok) {
      if (r.code === 'voice.dial_not_allowed' || r.code === 'voice.dial_limit' || r.code === 'voice.originate_failed') {
        await auditReq(req, 'call.dial', { entityType: 'BvCall', entityId: 'denied', meta: { ...meta, outcome: r.code === 'voice.originate_failed' ? 'failed' : 'denied', code: r.code, reason: r.reason ?? null } });
      }
      return sendError(reply, r.status ?? 400, r.code, r.message, r.reason ? { reason: r.reason } : undefined);
    }
    await auditReq(req, 'call.dial', { entityType: 'BvCall', entityId: r.callId, meta: { ...meta, outcome: 'started' } });
    return reply.code(202).send({ callId: r.callId, conversationId: r.conversationId });
  });

  // ── softphone (credenciais SIP do próprio atendente) ─────────────────────────────────────────────
  app.get('/softphone', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const u = await prisma.bvUser.findFirst({ where: { id: req.bv!.userId, orgId: req.bv!.orgId, active: true }, select: { name: true, sipExtension: true } });
    if (!u?.sipExtension) return sendError(reply, 409, 'voice.no_extension', 'Seu usuário não tem ramal SIP. Peça ao administrador para definir o ramal.');
    const creds = buildSoftphoneCredentials({ name: u.name, sipExtension: u.sipExtension });
    if (!creds) return sendError(reply, 503, 'voice.not_configured', 'BV_SIP_SECRET não configurado no servidor');
    await auditReq(req, 'softphone.credentials', { entityType: 'BvUser', entityId: req.bv!.userId });
    reply.header('Cache-Control', 'no-store');
    return creds;
  });

  // ── URA: fluxos ───────────────────────────────────────────────────────────────────────────────────
  const flowBody = z.object({ name: z.string().min(1).max(80), language: z.string().max(10).optional(), definition: z.unknown() });

  app.get('/ivr/flows', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const q = parse(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(), name: z.string().max(80).optional() }), req.query, reply); if (!q) return;
    const rows = await prisma.bvIvrFlow.findMany({ where: { orgId: req.bv!.orgId, ...(q.status ? { status: q.status } : {}), ...(q.name ? { name: q.name } : {}) }, orderBy: [{ name: 'asc' }, { version: 'desc' }], take: 500 });
    return { items: rows.map((f) => flowDto(f)) };
  });

  app.post('/ivr/flows', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const b = parse(flowBody, req.body, reply); if (!b) return;
    const v = validateIvrDefinition(b.definition);
    // rascunho pode ter erros de grafo (trabalho em andamento); só estrutura inválida é recusada
    if (v.errors.some((e) => e.code === 'ivr.schema')) return sendError(reply, 422, 'ivr.invalid', 'Estrutura do fluxo inválida', { errors: v.errors });
    const flow = await createDraft(req.bv!.orgId, { name: b.name, language: b.language, definition: b.definition }, req.bv!.userId);
    await auditReq(req, 'ivr.draft_create', { entityType: 'BvIvrFlow', entityId: flow.id, meta: { name: flow.name, version: flow.version } });
    return reply.code(201).send({ ...flowDto(flow, true), validation: { ok: v.ok, errors: v.errors, warnings: v.warnings } });
  });

  app.post('/ivr/validate', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const b = parse(z.object({ definition: z.unknown() }), req.body, reply); if (!b) return;
    const v = validateIvrDefinition(b.definition);
    return { ok: v.ok, errors: v.errors, warnings: v.warnings };
  });

  app.get('/ivr/flows/:id', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const f = await prisma.bvIvrFlow.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!f) return sendError(reply, 404, 'ivr.not_found', 'Fluxo não encontrado');
    return flowDto(f, true);
  });

  app.put('/ivr/flows/:id', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.object({ language: z.string().max(10).optional(), definition: z.unknown().optional() }), req.body, reply); if (!b) return;
    if (b.definition !== undefined) {
      const v = validateIvrDefinition(b.definition);
      if (v.errors.some((e) => e.code === 'ivr.schema')) return sendError(reply, 422, 'ivr.invalid', 'Estrutura do fluxo inválida', { errors: v.errors });
    }
    try {
      const f = await updateDraft(req.bv!.orgId, p.id, b);
      await auditReq(req, 'ivr.draft_update', { entityType: 'BvIvrFlow', entityId: f.id });
      const v = validateIvrDefinition(f.definition);
      return { ...flowDto(f, true), validation: { ok: v.ok, errors: v.errors, warnings: v.warnings } };
    } catch (e) { return flowErr(reply, e); }
  });

  app.delete('/ivr/flows/:id', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    try { await deleteDraft(req.bv!.orgId, p.id); } catch (e) { return flowErr(reply, e); }
    await auditReq(req, 'ivr.draft_delete', { entityType: 'BvIvrFlow', entityId: p.id });
    return reply.code(204).send();
  });

  app.post('/ivr/flows/:id/publish', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    try {
      const r = await publishFlow(req.bv!.orgId, p.id, req.bv!.userId);
      await auditReq(req, 'ivr.publish', { entityType: 'BvIvrFlow', entityId: r.flow.id, meta: { name: r.flow.name, version: r.flow.version, archivedId: r.archivedId } });
      if (voiceEnabled()) void prewarmPrompts(req.bv!.orgId, r.flow.definition as any).catch((err) => logger.warn({ err: err?.message }, '[balcao/voice] prewarm de prompts falhou'));
      return { ...flowDto(r.flow), archivedId: r.archivedId, warnings: r.warnings };
    } catch (e) { return flowErr(reply, e); }
  });

  const simBody = z.object({ inputs: inputsSchema.default([]), at: z.coerce.date().optional(), lang: z.string().max(10).optional(), headers: z.record(z.string(), z.string().max(200)).optional() });

  async function runSimulation(orgId: string, definition: unknown, b: z.infer<typeof simBody>) {
    const v = validateIvrDefinition(definition);
    if (!v.definition) return { error: v };
    const settings = await getOrgSettings(orgId);
    const at = b.at;
    const r = await simulateIvr(v.definition, b.inputs, { now: () => at ?? new Date(), settings, holidays: await getHolidays(orgId) }, { lang: b.lang ?? v.definition.defaultLang ?? settings.language, headers: b.headers });
    return { result: { outcome: r.outcome, trail: r.trail, lang: r.lang, vars: r.vars, sensitiveVars: r.sensitiveVars, spoken: r.spoken, unusedInputs: r.unusedInputs, validation: { ok: v.ok, errors: v.errors, warnings: v.warnings } } };
  }

  app.post('/ivr/flows/:id/simulate', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(simBody, req.body ?? {}, reply); if (!b) return;
    const f = await prisma.bvIvrFlow.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!f) return sendError(reply, 404, 'ivr.not_found', 'Fluxo não encontrado');
    const r = await runSimulation(req.bv!.orgId, f.definition, b);
    if ('error' in r) return sendError(reply, 422, 'ivr.invalid', 'Fluxo inválido', { errors: r.error!.errors });
    return r.result;
  });

  app.post('/ivr/simulate', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    const b = parse(simBody.extend({ definition: z.unknown() }), req.body, reply); if (!b) return;
    const r = await runSimulation(req.bv!.orgId, b.definition, b);
    if ('error' in r) return sendError(reply, 422, 'ivr.invalid', 'Fluxo inválido', { errors: r.error!.errors });
    return r.result;
  });

  // upload de áudio de prompt (corpo bruto; ?ext=wav&name=...)
  app.post('/ivr/prompts', { preHandler: guard('ivr:manage'), bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const q = parse(z.object({ ext: z.string().max(8).default('wav'), name: z.string().max(80).optional() }), req.query, reply); if (!q) return;
    const ext = q.ext.toLowerCase();
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return sendError(reply, 400, 'validation.failed', 'Envie o áudio no corpo (Content-Type: audio/wav)');
    if (!ALLOWED_AUDIO_EXT.includes(ext)) return sendError(reply, 415, 'ivr.audio_format', `Formato não suportado. Use: ${ALLOWED_AUDIO_EXT.join(', ')}`);
    if (ext === 'wav') {
      const h = inspectWav(body);
      if (!h || h.format !== 1 || h.channels !== 1 || h.bits !== 16 || ![8000, 16000].includes(h.sampleRate)) return sendError(reply, 415, 'ivr.audio_format', 'WAV deve ser PCM 16-bit mono, 8 kHz ou 16 kHz');
    }
    const stored = await putObject(newKey(req.bv!.orgId, 'ivr', ext), body);
    await auditReq(req, 'ivr.prompt_upload', { entityType: 'IvrPrompt', entityId: stored.key, meta: { name: q.name ?? null, size: stored.size } });
    return reply.code(201).send({ audioKey: stored.key, sizeBytes: stored.size, sha256: stored.sha256 });
  });

  // ── configuração do tronco SIP ───────────────────────────────────────────────────────────────────
  app.get('/config', { preHandler: guard('integration:manage') }, async (req) => {
    const i = await getIntegration<TrunkConfig>(req.bv!.orgId, 'SIP_TRUNK');
    return {
      configured: !!i, enabled: i?.enabled ?? false, status: i?.status ?? 'UNCONFIGURED', config: maskSecrets({ ...DEFAULT_TRUNK, ...(i?.config ?? {}) }), defaults: DEFAULT_TRUNK,
      environment: { voiceEnabled: voiceEnabled(), ariUrl: process.env.BV_ARI_URL ?? null, agentExtensions: { start: process.env.BV_AGENT_EXT_START ?? null, end: process.env.BV_AGENT_EXT_END ?? null }, sipSecretConfigured: !!process.env.BV_SIP_SECRET },
    };
  });

  app.put('/config', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const b = parse(z.object({ enabled: z.boolean().optional(), config: trunkConfigSchema }), req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const cur = await getIntegration<TrunkConfig>(orgId, 'SIP_TRUNK');
    const next: TrunkConfig = { ...b.config };
    if (next.password === MASK) next.password = cur?.config.password;
    if (next.ari?.password === MASK && cur?.config.ari) next.ari = { ...next.ari, password: cur.config.ari.password };
    const row = await saveIntegration(orgId, 'SIP_TRUNK', next, { enabled: b.enabled });
    await recordConfigVersion(orgId, 'SIP_TRUNK', row.id, maskSecrets(next), req.bv!.userId);
    await auditReq(req, 'config.update', { entityType: 'SIP_TRUNK', entityId: row.id, before: cur ? maskSecrets(cur.config) : undefined, after: maskSecrets(next) });
    // ARI informado só pela integração (sem BV_ARI_URL): conecta agora, sem reiniciar a API. Mudança de credencial exige reinício.
    if (voiceEnabled() && !getAriController()) { const { startVoice } = await import('./index'); void startVoice().catch((err) => logger.warn({ err: err?.message }, '[balcao/voice] start após PUT /config falhou')); }
    return { ok: true, config: maskSecrets(next) };
  });

  app.post('/config/test', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const orgId = req.bv!.orgId;
    const ctl = getAriController();
    const i = await getIntegration<TrunkConfig>(orgId, 'SIP_TRUNK');
    if (!ctl) return sendError(reply, 503, 'voice.disabled', 'Telefonia desabilitada (BV_VOICE_ENABLED) ou ARI não configurado');
    const t0 = Date.now();
    try {
      const info = await ctl.http.request<any>('GET', '/asterisk/info', { query: { only: 'system' } });
      const trunk = i?.config.trunkEndpoint ?? DEFAULT_TRUNK.trunkEndpoint;
      let trunkState: string | null = null;
      try { trunkState = (await ctl.http.request<any>('GET', `/endpoints/PJSIP/${encodeURIComponent(trunk)}`))?.state ?? null; } catch { trunkState = 'not_found'; }
      const ok = trunkState === 'online';
      if (i) await setIntegrationStatus(i.id, ok ? 'OK' : 'ERROR', ok ? null : `tronco ${trunk}: ${trunkState}`);
      await logIntegration(orgId, 'SIP_TRUNK', 'test', ok, { durationMs: Date.now() - t0, error: ok ? undefined : `tronco ${trunkState}` });
      return { ok, ari: { ok: true, version: info?.system?.version ?? null, connected: ctl.isConnected }, trunk: { endpoint: trunk, state: trunkState } };
    } catch (err: any) {
      if (i) await setIntegrationStatus(i.id, 'ERROR', err?.message);
      await logIntegration(orgId, 'SIP_TRUNK', 'test', false, { durationMs: Date.now() - t0, error: err?.message });
      return reply.code(502).send({ ok: false, ari: { ok: false, error: err?.message ?? 'falha' } });
    }
  });

  // ── URA 0800 (integração URA_0800: DID → fluxo, cabeçalhos X-* → metadata, IPs de origem) ────────────────
  const uraPut = z.object({ enabled: z.boolean().optional(), config: ura0800Schema });
  const uraTest = z.object({
    did: z.string().regex(numberRe).optional(),
    headers: z.record(z.string().max(80), z.string().max(200)).optional(),
    sourceIp: z.string().max(64).optional(),
  });

  app.get('/ura0800', { preHandler: guard('integration:manage') }, async (req) => {
    const i = await getIntegration<Ura0800Config>(req.bv!.orgId, 'URA_0800');
    return {
      configured: !!i, enabled: i?.enabled ?? false, status: i?.status ?? 'UNCONFIGURED',
      config: { dids: [], headerMap: {}, ...(i?.config ?? {}) }, defaults: URA0800_DEFAULTS,
    };
  });

  app.put('/ura0800', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const b = parse(uraPut, req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const cur = await getIntegration<Ura0800Config>(orgId, 'URA_0800');
    const row = await saveIntegration(orgId, 'URA_0800', b.config, { enabled: b.enabled });
    await recordConfigVersion(orgId, 'URA_0800', row.id, b.config, req.bv!.userId);
    await auditReq(req, 'config.update', { entityType: 'URA_0800', entityId: row.id, before: cur?.config, after: b.config });
    return { ok: true, enabled: row.enabled, config: b.config };
  });

  // Autoteste: confere DID → fluxo ACTIVE, extração dos cabeçalhos de um INVITE de teste e IP de origem. Não cria chamada.
  app.post('/ura0800/test', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const b = parse(uraTest, req.body ?? {}, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const i = await getIntegration<Record<string, unknown>>(orgId, 'URA_0800');
    if (!i) return sendError(reply, 404, 'ura0800.not_configured', 'Integração URA 0800 não configurada');
    const parsed = ura0800Schema.safeParse(i.config);
    if (!parsed.success) return sendError(reply, 422, 'ura0800.invalid_config', 'Configuração salva é inválida', parsed.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })));
    const t0 = Date.now();
    const result = await testUra0800(orgId, parsed.data, b);
    await setIntegrationStatus(i.id, result.ok ? 'OK' : 'ERROR', result.ok ? null : result.warnings.join(' | ').slice(0, 500) || 'verificação falhou');
    await logIntegration(orgId, 'URA_0800', 'test', result.ok, { durationMs: Date.now() - t0, error: result.ok ? undefined : result.warnings.join(' | ') });
    return { ...result, enabled: i.enabled };
  });

  // ── simulador de desenvolvimento ─────────────────────────────────────────────────────────────────
  app.post('/dev/simulate-call', { preHandler: guard('ivr:manage') }, async (req, reply) => {
    if (!devSimulatorsEnabled()) return sendError(reply, 404, 'not_found', 'Recurso indisponível');
    const b = parse(z.object({
      from: z.string().regex(numberRe), did: z.string().regex(numberRe), inputs: inputsSchema.default([]), agentUserId: z.string().max(64).optional(),
      durationSec: z.number().int().min(1).max(7200).optional(), closeConversation: z.boolean().optional(), headers: z.record(z.string(), z.string().max(200)).optional(),
    }), req.body, reply); if (!b) return;
    if (b.agentUserId) {
      const u = await prisma.bvUser.findFirst({ where: { id: b.agentUserId, orgId: req.bv!.orgId, active: true }, select: { id: true } });
      if (!u) return sendError(reply, 404, 'user.not_found', 'Atendente não encontrado');
    }
    try { return reply.code(201).send(await simulateCall(req.bv!.orgId, b)); } catch (e) { return flowErr(reply, e); }
  });
}

