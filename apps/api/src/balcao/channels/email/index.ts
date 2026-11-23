import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import MailComposer from 'nodemailer/lib/mail-composer';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { registerChannelSender } from '../../core/channels';
import { recordConfigVersion } from '../../core/configVersion';
import { guard, parse, sendError } from '../../core/http';
import { getIntegration, logIntegration, maskSecrets, saveIntegration, setIntegrationStatus } from '../../core/integrations';
import { registerJob } from '../../core/scheduler';
import { credentialProblems, emailConfigInput, loadEmailConfig, mergeConfig, normalizeConfig, ownAddressesOf } from './config';
import { ingestRawEmail } from './inbound';
import { imapPoller, pollAllOrgs, safeError } from './imap';
import { createMailTransport, getDevOutbox, isDevSimulators, sendEmailOutbound } from './outbound';
import { MAX_RAW_BYTES, type EmailConfig } from './types';

export { setImapClientFactory, imapPoller } from './imap';
export { setMailTransportFactory } from './outbound';

const putConfigSchema = emailConfigInput.extend({ enabled: z.boolean().optional(), generateInboundSecret: z.boolean().optional() });
const testSchema = emailConfigInput.partial().optional();
const simulateSchema = z.object({
  from: z.string().trim().email().max(320), name: z.string().trim().max(120).optional(),
  subject: z.string().max(300).default('(sem assunto)'), text: z.string().min(1).max(100_000),
  messageId: z.string().max(300).optional(), inReplyTo: z.string().max(300).optional(),
});

/** Comparação em tempo constante (via hash, independe do tamanho). */
export function secretsMatch(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function buildRaw(opts: { from: { name?: string; address: string }; to: string; subject: string; text: string; messageId?: string; inReplyTo?: string }): Promise<Buffer> {
  const mail = new MailComposer({
    from: opts.from, to: opts.to, subject: opts.subject, text: opts.text,
    messageId: opts.messageId, inReplyTo: opts.inReplyTo, references: opts.inReplyTo,
  });
  return mail.compile().build();
}

/** Plugin da frente e-mail — prefixo /balcao/email definido em balcao/index.ts. */
export default async function plugin(app: FastifyInstance): Promise<void> {
  registerChannelSender('EMAIL', sendEmailOutbound);
  registerJob('balcao.email.poll', { intervalMs: 10_000, lockTtlSec: 120 }, pollAllOrgs);

  // corpo bruto MIME (message/rfc822) para o webhook de entrada
  if (!app.hasContentTypeParser('message/rfc822')) {
    app.addContentTypeParser('message/rfc822', { parseAs: 'buffer', bodyLimit: MAX_RAW_BYTES }, (_req, body, done) => done(null, body));
  }

  // ── Configuração ──────────────────────────────────────────────────────────
  app.get('/config', { preHandler: guard('integration:manage') }, async (req) => {
    const orgId = req.bv!.orgId;
    const row = await getIntegration<Record<string, any>>(orgId, 'EMAIL_IMAP');
    const full = await prisma.bvIntegration.findUnique({ where: { orgId_type_name: { orgId, type: 'EMAIL_IMAP', name: 'default' } }, select: { lastError: true, lastCheckAt: true } });
    return {
      configured: !!row, enabled: row?.enabled ?? false, status: row?.status ?? 'UNCONFIGURED', lastError: full?.lastError ?? null, lastCheckAt: full?.lastCheckAt ?? null,
      config: row ? maskSecrets(row.config) : null,
      webhook: { path: `/balcao/email/inbound?org=${orgId}`, secretConfigured: !!row?.config?.inboundSecret },
    };
  });

  app.put('/config', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const body = parse(putConfigSchema, req.body, reply);
    if (!body) return;
    const orgId = req.bv!.orgId;
    const { enabled, generateInboundSecret, ...input } = body;
    const before = await getIntegration<Partial<EmailConfig>>(orgId, 'EMAIL_IMAP');
    const merged = mergeConfig(input, before?.config);
    const problems = credentialProblems(merged);
    if (problems.length) return sendError(reply, 400, 'email.credentials_required', 'Credenciais incompletas', problems);
    let generated: string | undefined;
    if (generateInboundSecret) { generated = crypto.randomBytes(24).toString('hex'); merged.inboundSecret = generated; }
    const cfg = normalizeConfig(merged)!;

    const row = await saveIntegration(orgId, 'EMAIL_IMAP', cfg as unknown as Record<string, any>, { enabled: enabled ?? true });
    await imapPoller.ensureMailbox(orgId, cfg);
    await recordConfigVersion(orgId, 'EMAIL_IMAP', row.id, maskSecrets(cfg as any), req.bv!.userId);
    await auditReq(req, 'config.update', { entityType: 'integration:EMAIL_IMAP', entityId: row.id, before: before ? maskSecrets(before.config as any) : null, after: maskSecrets(cfg as any) });
    return { ok: true, enabled: row.enabled, config: maskSecrets(cfg as any), ...(generated ? { inboundSecret: generated } : {}) };
  });

  app.post('/config/test', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const body = parse(testSchema, req.body ?? undefined, reply);
    if (body === null) return;
    const orgId = req.bv!.orgId;
    const saved = await getIntegration<Partial<EmailConfig>>(orgId, 'EMAIL_IMAP');
    let cfg: EmailConfig | null;
    const provided = body && Object.keys(body).length > 0;
    if (provided) {
      const full = emailConfigInput.safeParse({ ...(saved?.config ?? {}), ...body });
      if (!full.success) return sendError(reply, 400, 'validation.failed', 'Configuração incompleta para teste', full.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })));
      cfg = normalizeConfig(mergeConfig(full.data, saved?.config));
    } else cfg = (await loadEmailConfig(orgId))?.config ?? null;
    if (!cfg) return sendError(reply, 404, 'email.not_configured', 'Canal de e-mail não configurado');

    const out: { imap: { ok: boolean; error?: string }; smtp: { ok: boolean; error?: string } } = { imap: { ok: true }, smtp: { ok: true } };
    const t0 = Date.now();
    try { await imapPoller.testImap(cfg.imap, cfg.mailbox); } catch (err) { out.imap = { ok: false, error: safeError(err, cfg) }; }
    try {
      const t = createMailTransport(cfg.smtp);
      try { await t.verify?.(); } finally { try { t.close?.(); } catch { /* noop */ } }
    } catch (err) { out.smtp = { ok: false, error: safeError(err, cfg) }; }

    await logIntegration(orgId, 'EMAIL_IMAP', 'config.test', out.imap.ok && out.smtp.ok, { durationMs: Date.now() - t0, error: [out.imap.error, out.smtp.error].filter(Boolean).join(' | ') || undefined });
    if (saved && !provided) await setIntegrationStatus(saved.id, out.imap.ok && out.smtp.ok ? 'OK' : 'ERROR', [out.imap.error, out.smtp.error].filter(Boolean).join(' | ') || null);
    return { ok: out.imap.ok && out.smtp.ok, ...out };
  });

  // ── Estado da coleta ──────────────────────────────────────────────────────
  app.get('/mailboxes', { preHandler: guard('integration:manage') }, async (req) => {
    const rows = await prisma.bvMailbox.findMany({ where: { orgId: req.bv!.orgId }, orderBy: { address: 'asc' } });
    return { items: rows.map((m) => ({ id: m.id, address: m.address, folder: m.folder, enabled: m.enabled, uidValidity: m.uidValidity?.toString() ?? null, lastUid: m.lastUid.toString(), lastPolledAt: m.lastPolledAt, lastError: m.lastError })) };
  });

  app.post('/poll', { preHandler: guard('integration:manage') }, async (req, reply) => {
    const orgId = req.bv!.orgId;
    const r = await imapPoller.pollOrg(orgId, { force: true });
    if (r.skipped === 'not_configured') return sendError(reply, 404, 'email.not_configured', 'Canal de e-mail não configurado ou desabilitado');
    await auditReq(req, 'email.poll', { entityType: 'integration:EMAIL_IMAP', meta: { fetched: r.fetched, ingested: r.ingested, failed: r.failed } });
    return r;
  });

  // ── Webhook alternativo de entrada (provedores que entregam e-mail por HTTP) ──
  app.post('/inbound', { bodyLimit: MAX_RAW_BYTES }, async (req, reply) => {
    const q = z.object({ org: z.string().min(1).max(64) }).safeParse(req.query);
    const given = req.headers['x-inbound-secret'];
    const unauthorized = () => sendError(reply, 401, 'email.unauthorized', 'Credencial inválida');
    if (!q.success || typeof given !== 'string') return unauthorized();
    const org = await prisma.bvOrg.findFirst({ where: { OR: [{ id: q.data.org }, { slug: q.data.org }] }, select: { id: true } });
    const loaded = org ? await loadEmailConfig(org.id) : null;
    if (!org || !loaded || !loaded.enabled || !secretsMatch(given, loaded.config.inboundSecret)) return unauthorized();

    let raw: Buffer | null = null;
    const b: any = req.body;
    if (Buffer.isBuffer(b)) raw = b;
    else if (b && typeof b.raw === 'string') raw = Buffer.from(b.raw, b.encoding === 'base64' ? 'base64' : 'utf8');
    if (!raw || raw.length === 0) return sendError(reply, 400, 'email.invalid_body', 'Envie o e-mail bruto (message/rfc822) ou JSON {"raw": "..."}');

    try {
      const out = await ingestRawEmail(raw, { orgId: org.id, ownAddresses: ownAddressesOf(loaded.config), autoReply: loaded.config.autoReply, source: 'webhook' });
      await logIntegration(org.id, 'EMAIL_IMAP', 'inbound.webhook', true, { meta: { status: out.status } });
      return out;
    } catch (err: any) {
      await logIntegration(org.id, 'EMAIL_IMAP', 'inbound.webhook', false, { error: safeError(err) });
      return sendError(reply, 500, 'email.ingest_failed', 'Falha ao processar o e-mail');
    }
  });

  // ── Simulador (somente BV_DEV_SIMULATORS=1) ───────────────────────────────
  if (isDevSimulators()) {
    app.post('/dev/simulate-inbound', { preHandler: guard('integration:manage') }, async (req, reply) => {
      const body = parse(simulateSchema, req.body, reply);
      if (!body) return;
      const orgId = req.bv!.orgId;
      const loaded = await loadEmailConfig(orgId);
      const own = loaded?.config.from.address ?? 'balcao@dev.local';
      const raw = await buildRaw({ from: { name: body.name, address: body.from }, to: own, subject: body.subject, text: body.text, messageId: body.messageId, inReplyTo: body.inReplyTo });
      return ingestRawEmail(raw, { orgId, ownAddresses: ownAddressesOf(loaded?.config ?? null), autoReply: loaded?.config.autoReply, source: 'simulator' });
    });
    app.get('/dev/outbox', { preHandler: guard('integration:manage') }, async (req) => ({ items: getDevOutbox(req.bv!.orgId) }));
  }
}
