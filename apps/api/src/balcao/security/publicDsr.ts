import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { redis } from '../../services/queue';
import { audit } from '../core/audit';
import { hashToken, randomToken, sha256Hex } from '../core/crypto';
import { normalizeEmail } from '../core/contacts';
import { parse, sendError } from '../core/http';
import { DSR_TYPES, DsrError, openDsr } from './dsr';
import { hitLimit, notifyOrgManagers } from './util';

/**
 * Endpoint público do titular (sem login): solicitação → e-mail com token de uso único → confirmação → cria a
 * BvDataSubjectRequest (OPEN) para tratamento humano. DELETE/ANONYMIZE nunca são executados automaticamente.
 * A resposta da solicitação é sempre a mesma (não revela se o e-mail/órgão existem).
 */
export type DsrMailer = (to: string, subject: string, text: string) => Promise<void>;
let mailer: DsrMailer = async (to, subject, text) => {
  const { sendEmail } = await import('../../lib/mailer');
  await sendEmail(to, subject, `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);
};
export const setDsrMailer = (m: DsrMailer) => { mailer = m; };

const TTL_SEC = () => Number(process.env.BV_DSR_VERIFY_TTL_SEC) || 3600;
const vKey = (token: string) => `bv:dsr:verify:${hashToken(token)}`;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

const requestSchema = z.object({
  org: z.string().min(2).max(60),
  email: z.string().email().max(200),
  type: z.enum(DSR_TYPES),
  justification: z.string().max(1000).optional(),
});

const GENERIC = { status: 'PENDING_VERIFICATION', message: 'Se os dados estiverem corretos, enviaremos um e-mail com o link para confirmar sua solicitação. O link vale por 1 hora.' };

export async function publicDsrRoutes(app: FastifyInstance): Promise<void> {
  app.post('/public/dsr', async (req, reply) => {
    const b = parse(requestSchema, req.body, reply);
    if (!b) return;
    const email = normalizeEmail(b.email)!;
    const [ipRl, mailRl] = await Promise.all([hitLimit(`dsr:ip:${req.ip}`, 10, 3600), hitLimit(`dsr:mail:${sha256Hex(email)}`, 3, 3600)]);
    if (!ipRl.allowed || !mailRl.allowed) {
      reply.header('Retry-After', String(Math.max(ipRl.retryAfterSec, mailRl.retryAfterSec)));
      return sendError(reply, 429, 'dsr.rate_limited', 'Muitas solicitações. Tente novamente mais tarde.');
    }
    const org = await prisma.bvOrg.findUnique({ where: { slug: b.org }, select: { id: true, name: true } });
    if (org) {
      const token = randomToken(32);
      try {
        await redis.set(vKey(token), JSON.stringify({ orgId: org.id, email, type: b.type, justification: b.justification ?? null }), 'EX', TTL_SEC());
        const base = process.env.BV_PUBLIC_API_URL || process.env.API_URL || '';
        const link = `${base.replace(/\/$/, '')}/balcao/security/public/dsr/confirm?token=${token}`;
        await mailer(email, `Confirme sua solicitação de titular — ${org.name}`,
          `Recebemos um pedido (${b.type}) de exercício de direitos da LGPD para este e-mail.\n\nPara confirmar que foi você, acesse (válido por 1 hora, uso único):\n${link}\n\nSe não foi você, ignore esta mensagem.`);
      } catch (err: any) {
        logger.warn({ err: err?.message }, '[balcao.security] falha ao enviar verificação de DSR'); // sem e-mail/token no log
      }
    }
    return reply.code(202).send(GENERIC);
  });

  // Página mínima: a confirmação só ocorre no POST (scanners de e-mail que fazem GET não consomem o token).
  app.get('/public/dsr/confirm', async (req, reply) => {
    const token = String((req.query as any)?.token ?? '');
    if (!TOKEN_RE.test(token)) return reply.code(400).type('text/plain').send('Link inválido.');
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'").header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmar solicitação</title>
<body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>Confirmar solicitação de titular</h1>
<p>Clique para confirmar que você pediu o exercício dos seus direitos (LGPD).</p><button id="b" style="font-size:1rem;padding:.6rem 1.2rem">Confirmar</button><p id="m" role="status"></p>
<script>document.getElementById('b').onclick=async function(){var m=document.getElementById('m');try{var r=await fetch('./verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)}})});var j=await r.json();m.textContent=r.ok?j.message:(j.error&&j.error.message)||'Falha na confirmação.'}catch(e){m.textContent='Falha de rede.'}}</script></body></html>`);
  });

  app.post('/public/dsr/verify', async (req, reply) => {
    const b = parse(z.object({ token: z.string().regex(TOKEN_RE) }), req.body, reply);
    if (!b) return;
    const rl = await hitLimit(`dsr:verify:${req.ip}`, 20, 600);
    if (!rl.allowed) return sendError(reply, 429, 'dsr.rate_limited', 'Muitas tentativas.');
    let payload: { orgId: string; email: string; type: (typeof DSR_TYPES)[number]; justification: string | null } | null = null;
    try {
      const raw = await redis.get(vKey(b.token));
      // DEL devolve 1 só para quem consumiu: uso único mesmo com requisições concorrentes
      if (raw && (await redis.del(vKey(b.token))) === 1) payload = JSON.parse(raw);
    } catch { return sendError(reply, 503, 'dsr.unavailable', 'Serviço temporariamente indisponível'); }
    if (!payload) return sendError(reply, 400, 'dsr.invalid_token', 'Link inválido, expirado ou já utilizado');

    const { orgId, email } = payload;
    const ident = await prisma.bvContactIdentity.findFirst({ where: { orgId, channel: 'EMAIL', externalId: email }, select: { contactId: true } });
    const contact = (ident && (await prisma.bvContact.findFirst({ where: { id: ident.contactId, orgId, anonymizedAt: null }, select: { id: true, mergedIntoId: true } })))
      || (await prisma.bvContact.findFirst({ where: { orgId, email, anonymizedAt: null, mergedIntoId: null }, select: { id: true, mergedIntoId: true } }));
    if (!contact) {
      await audit({ orgId, actorType: 'CONTACT', action: 'dsr.public.no_data', meta: { emailHash: sha256Hex(email), type: payload.type } });
      return { status: 'NO_DATA', message: 'E-mail confirmado. Não localizamos dados pessoais associados a ele.' };
    }
    try {
      const { request, created } = await openDsr({ orgId, contactId: contact.mergedIntoId ?? contact.id, type: payload.type, origin: 'PUBLIC', justification: payload.justification ?? undefined, requesterEmailHash: sha256Hex(email), note: 'Solicitação pública com e-mail verificado' });
      if (created) await notifyOrgManagers(orgId, 'dsr.requested', `Nova solicitação de titular (${payload.type})`, 'Prazo legal de resposta: 15 dias (LGPD art. 19, II).', { requestId: request.id });
      return { status: 'CONFIRMED', requestId: request.id, message: 'Solicitação registrada. Responderemos em até 15 dias.' };
    } catch (err) {
      if (err instanceof DsrError) return sendError(reply, err.status, err.code, err.message);
      throw err;
    }
  });
}
