import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { fetchAllChats, fetchChatMessages, sendText } from '../services/evolution';

type ResolvedNumber =
  | { ok: true; number: any }
  | { ok: false; status: number; error: string };

/**
 * WhatsApp Web simplificado — lê e envia mensagens de texto usando a mesma
 * instância Evolution já conectada pelo número (nenhuma sessão nova, nenhum
 * QR Code novo). Fase 1: só conversas individuais, só texto — sem grupos e
 * sem mídia (ver estudo da conversa).
 */
export default async function whatsappWebRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // Resolve o número (dono confere), e valida que é um número Evolution já
  // conectado — números via API oficial da Meta (provider='meta', ver
  // schema.prisma) não têm instância Evolution e não são suportados aqui.
  async function resolveConnectedNumber(id: string, userId: string): Promise<ResolvedNumber> {
    const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId, isPublic: false } });
    if (!number) return { ok: false, status: 404, error: 'Número não encontrado' };
    if (number.provider === 'meta') {
      return {
        ok: false, status: 400,
        error: 'Este recurso é exclusivo de números conectados via QR Code (Evolution) — números via API oficial da Meta não são suportados aqui.',
      };
    }
    if (!number.zapiInstanceId) {
      return { ok: false, status: 400, error: 'WhatsApp ainda não conectado.' };
    }
    return { ok: true, number };
  }

  // ── GET /numbers/:id/chats ────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/chats', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const resolved = await resolveConnectedNumber(id, userId);
    if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

    try {
      const chats = await fetchAllChats(resolved.number.zapiInstanceId);
      return { chats };
    } catch (err: any) {
      app.log.error({ err: err.message }, '[WhatsAppWeb] Erro ao listar chats');
      return reply.code(502).send({ error: 'Não foi possível carregar as conversas.' });
    }
  });

  // ── GET /numbers/:id/chats/:phone/messages ────────────────────────────────
  app.get<{ Params: { id: string; phone: string }; Querystring: { limit?: string } }>(
    '/:id/chats/:phone/messages', auth, async (req: any, reply) => {
      const { id, phone } = req.params;
      const userId = req.user.sub;

      const resolved = await resolveConnectedNumber(id, userId);
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

      const cleanPhone = String(phone).replace(/\D/g, '');
      if (!cleanPhone) return reply.code(400).send({ error: 'Telefone inválido.' });

      const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '50', 10) || 50, 1), 100);
      const remoteJid = `${cleanPhone}@s.whatsapp.net`;

      try {
        const messages = await fetchChatMessages(resolved.number.zapiInstanceId, remoteJid, limit);
        return { messages };
      } catch (err: any) {
        app.log.error({ err: err.message }, '[WhatsAppWeb] Erro ao listar mensagens');
        return reply.code(502).send({ error: 'Não foi possível carregar as mensagens.' });
      }
    }
  );

  // ── POST /numbers/:id/chats/:phone/messages ───────────────────────────────
  app.post<{ Params: { id: string; phone: string }; Body: { text?: string } }>(
    '/:id/chats/:phone/messages', auth, async (req: any, reply) => {
      const { id, phone } = req.params;
      const userId = req.user.sub;

      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'Mensagem vazia.' });
      if (text.length > 4096) return reply.code(400).send({ error: 'Mensagem muito longa.' });

      const resolved = await resolveConnectedNumber(id, userId);
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

      const cleanPhone = String(phone).replace(/\D/g, '');
      if (!cleanPhone) return reply.code(400).send({ error: 'Telefone inválido.' });

      try {
        const result = await sendText(resolved.number.zapiInstanceId, cleanPhone, text);
        return { ok: true, id: result.id };
      } catch (err: any) {
        app.log.error({ err: err.message }, '[WhatsAppWeb] Erro ao enviar mensagem');
        return reply.code(502).send({ error: 'Não foi possível enviar a mensagem.' });
      }
    }
  );
}
