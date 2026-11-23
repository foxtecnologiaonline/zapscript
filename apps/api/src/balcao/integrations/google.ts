import crypto from 'crypto';
import { signRs256 } from './jws';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { getIntegration } from '../core/integrations';
import { canAccessConversation, sendMessage, ConversationError } from '../core/conversations';
import { guard, parse, sendError } from '../core/http';
import { formBody, httpClientFor, IntegrationError, parseJsonSafe, type HttpClient } from './http-client';
import { logged, type Deps } from './common';

/** Google Workspace — conta de serviço com delegação de domínio: Agenda + Meet e Gmail (envio). */

const serviceAccountSchema = z.object({
  client_email: z.string().email(), private_key: z.string().min(50),
  token_uri: z.string().url().default('https://oauth2.googleapis.com/token'),
}).passthrough();

export const googleConfigSchema = z.object({
  serviceAccountJson: z.string().min(20).max(20_000).refine((s) => { try { return serviceAccountSchema.safeParse(JSON.parse(s)).success; } catch { return false; } }, 'serviceAccountJson inválido (client_email/private_key)'),
  delegatedUser: z.string().email(),
  calendarId: z.string().max(300).default('primary'),
  timeZone: z.string().max(60).default('America/Araguaina'),
  /** URLs base (padrão: Google). Configuráveis para homologação/testes. */
  calendarBaseUrl: z.string().url().default('https://www.googleapis.com'),
  gmailBaseUrl: z.string().url().default('https://gmail.googleapis.com'),
  timeoutMs: z.number().int().min(500).max(60_000).default(10_000),
  allowPrivateHosts: z.boolean().optional(),
});
export type GoogleConfig = z.infer<typeof googleConfigSchema>;
export const GOOGLE_SECRETS = ['serviceAccountJson'];

export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.send';

async function loadConfig(orgId: string): Promise<GoogleConfig> {
  const row = await getIntegration<Record<string, any>>(orgId, 'GOOGLE_WORKSPACE');
  if (!row?.enabled) throw new IntegrationError('google.not_configured', 'Google Workspace não configurado');
  const p = googleConfigSchema.safeParse(row.config);
  if (!p.success) throw new IntegrationError('google.not_configured', 'Configuração do Google inválida');
  return { ...p.data, allowPrivateHosts: row.config.allowPrivateHosts === true };
}

const tokenCache = new Map<string, { token: string; exp: number }>();
export const clearGoogleTokenCache = () => tokenCache.clear();

/** Token OAuth via JWT assinado (RS256) da conta de serviço, em nome do usuário delegado. Cache até 1 min antes de expirar. */
export async function getAccessToken(cfg: GoogleConfig, scope: string, http: HttpClient): Promise<string> {
  const sa = serviceAccountSchema.parse(JSON.parse(cfg.serviceAccountJson));
  const key = crypto.createHash('sha256').update(`${sa.client_email}|${cfg.delegatedUser}|${scope}|${sa.token_uri}`).digest('hex');
  const hit = tokenCache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const iat = Math.floor(Date.now() / 1000);
  const assertion = signRs256({ iss: sa.client_email, sub: cfg.delegatedUser, scope, aud: sa.token_uri, iat, exp: iat + 55 * 60 }, sa.private_key.replace(/\\n/g, '\n'));
  const res = await http.request({
    method: 'POST', url: sa.token_uri, timeoutMs: cfg.timeoutMs,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = parseJsonSafe<{ access_token?: string; expires_in?: number }>(res.text);
  if (res.status !== 200 || !j?.access_token) throw new IntegrationError('google.token_rejected', `Token recusado (HTTP ${res.status})`, res.status);
  tokenCache.set(key, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export interface MeetInput { summary: string; start: string; durationMin: number; attendees?: string[]; description?: string }
export interface MeetResult { eventId: string; meetLink: string; htmlLink?: string; start: string; end: string }

/** Cria evento na Agenda com sala do Google Meet (conferenceData.createRequest). */
export async function createMeetEvent(orgId: string, input: MeetInput, deps: Deps = {}): Promise<MeetResult> {
  const cfg = await loadConfig(orgId);
  const http = deps.http ?? httpClientFor(cfg);
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new IntegrationError('google.invalid_input', 'Data inválida');
  const end = new Date(start.getTime() + input.durationMin * 60_000);
  return logged(orgId, 'GOOGLE_WORKSPACE', 'meet.create', async () => {
    const token = await getAccessToken(cfg, SCOPE_CALENDAR, http);
    const url = `${cfg.calendarBaseUrl.replace(/\/+$/, '')}/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
    const res = await http.request({
      method: 'POST', url, timeoutMs: cfg.timeoutMs,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        summary: input.summary.slice(0, 250), description: input.description?.slice(0, 2000),
        start: { dateTime: start.toISOString(), timeZone: cfg.timeZone }, end: { dateTime: end.toISOString(), timeZone: cfg.timeZone },
        attendees: (input.attendees ?? []).map((email) => ({ email })),
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      }),
    });
    const j = parseJsonSafe<any>(res.text);
    if (res.status < 200 || res.status >= 300 || !j) throw new IntegrationError('google.calendar_error', `Agenda recusou (HTTP ${res.status})`, res.status);
    const link: string | undefined = j.hangoutLink ?? j.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri;
    if (!link) throw new IntegrationError('google.no_meet_link', 'Evento criado sem link do Meet');
    return { eventId: String(j.id), meetLink: link, htmlLink: j.htmlLink, start: start.toISOString(), end: end.toISOString() };
  });
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const b64lines = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

/** Monta a mensagem RFC 2822 (UTF-8) com proteção contra injeção de cabeçalhos. */
export function buildRfc822(p: { from: string; to: string[]; subject: string; text: string }): string {
  return [
    `From: ${clean(p.from)}`, `To: ${p.to.map(clean).join(', ')}`,
    `Subject: =?UTF-8?B?${Buffer.from(clean(p.subject), 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(p.text),
  ].join('\r\n');
}

export interface MailInput { to: string[]; subject: string; text: string }
export async function sendGmail(orgId: string, input: MailInput, deps: Deps = {}): Promise<{ messageId: string }> {
  const cfg = await loadConfig(orgId);
  const http = deps.http ?? httpClientFor(cfg);
  return logged(orgId, 'GOOGLE_WORKSPACE', 'gmail.send', async () => {
    const token = await getAccessToken(cfg, SCOPE_GMAIL, http);
    const raw = Buffer.from(buildRfc822({ from: cfg.delegatedUser, ...input }), 'utf8').toString('base64url');
    const res = await http.request({
      method: 'POST', url: `${cfg.gmailBaseUrl.replace(/\/+$/, '')}/gmail/v1/users/me/messages/send`, timeoutMs: cfg.timeoutMs,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ raw }),
    });
    const j = parseJsonSafe<any>(res.text);
    if (res.status < 200 || res.status >= 300 || !j?.id) throw new IntegrationError('google.gmail_error', `Gmail recusou (HTTP ${res.status})`, res.status);
    return { messageId: String(j.id) };
  }, { recipients: input.to.length });
}

export async function testGoogle(cfg: GoogleConfig, deps: Deps = {}): Promise<{ ok: boolean; message: string }> {
  try {
    clearGoogleTokenCache();
    await getAccessToken(cfg, SCOPE_CALENDAR, deps.http ?? httpClientFor(cfg));
    return { ok: true, message: 'Token obtido com delegação de domínio' };
  } catch (err: any) {
    return { ok: false, message: err instanceof IntegrationError ? err.code : 'Falha ao obter token' };
  }
}

const meetBody = z.object({
  conversationId: z.string().min(1).max(64).optional(), summary: z.string().min(1).max(250),
  start: z.string().datetime({ offset: true }), durationMin: z.number().int().min(5).max(480),
  attendees: z.array(z.string().email()).max(30).default([]),
});
const mailBody = z.object({ to: z.array(z.string().email()).min(1).max(20), subject: z.string().min(1).max(250), text: z.string().min(1).max(20_000) });

const statusOf = (err: unknown) => (err instanceof IntegrationError ? (err.code === 'google.not_configured' ? 409 : err.code === 'google.invalid_input' ? 400 : 502) : 500);

export function registerGoogleRoutes(app: FastifyInstance, deps: Deps = {}): void {
  app.post('/google/meet', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const b = parse(meetBody, req.body, reply);
    if (!b) return;
    const orgId = req.bv!.orgId;
    let conv: Awaited<ReturnType<typeof prisma.bvConversation.findFirst>> = null;
    if (b.conversationId) {
      conv = await prisma.bvConversation.findFirst({ where: { id: b.conversationId, orgId } });
      if (!conv) return sendError(reply, 404, 'conversation.not_found', 'Conversa não encontrada');
      if (!(await canAccessConversation(req.bv!, conv))) return sendError(reply, 403, 'auth.forbidden', 'Sem acesso à conversa');
    }
    try {
      const ev = await createMeetEvent(orgId, { summary: b.summary, start: b.start, durationMin: b.durationMin, attendees: b.attendees }, deps);
      await auditReq(req, 'google.meet_create', { entityType: 'conversation', entityId: conv?.id, meta: { attendees: b.attendees.length } });
      if (conv) {
        try { await sendMessage({ orgId, conversationId: conv.id, senderType: 'AGENT', userId: req.bv!.userId, body: `Videochamada agendada: ${ev.meetLink}` }); }
        catch (e) { if (!(e instanceof ConversationError)) throw e; }
      }
      return reply.code(201).send({ eventId: ev.eventId, meetLink: ev.meetLink, start: ev.start, end: ev.end });
    } catch (err) {
      return sendError(reply, statusOf(err), err instanceof IntegrationError ? err.code : 'google.error', 'Não foi possível criar a reunião');
    }
  });

  app.post('/google/mail/send', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const b = parse(mailBody, req.body, reply);
    if (!b) return;
    try {
      const r = await sendGmail(req.bv!.orgId, b, deps);
      await auditReq(req, 'google.mail_send', { meta: { recipients: b.to.length } });
      return reply.code(202).send({ messageId: r.messageId });
    } catch (err) {
      return sendError(reply, statusOf(err), err instanceof IntegrationError ? err.code : 'google.error', 'Não foi possível enviar o e-mail');
    }
  });
}
