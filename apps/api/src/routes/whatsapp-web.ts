import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { fetchAllChats, fetchChatMessages, sendTextToJid } from '../services/evolution';

type ResolvedNumber =
  | { ok: true; number: any }
  | { ok: false; status: number; error: string };

/**
 * WhatsApp Web simplificado — lê e envia mensagens de texto usando a mesma
 * instância Evolution já conectada pelo número (nenhuma sessão nova, nenhum
 * QR Code novo). Conversas individuais e grupos (fase 3) — mídia ainda fora
 * de escopo (ver estudo da conversa).
 *
 * Rotas de mensagem usam o JID completo (`:jid`, URL-encoded — ex:
 * `5511999999999%40s.whatsapp.net` ou `120363...%40g.us`) em vez de só o
 * telefone: é o único identificador que funciona igual pros dois tipos de
 * conversa (um grupo não tem "telefone" pra reconstruir a partir de dígitos).
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

  // Só aceita JID de conversa individual ou de grupo — nunca repassa outra
  // coisa (ex: `@c.us`, ou lixo qualquer) direto pro campo `number` da
  // Evolution API.
  function parseJid(raw: string): string | null {
    const jid = String(raw ?? '').trim();
    if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us')) return jid;
    return null;
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

  // ── GET /numbers/:id/chats/:jid/messages ──────────────────────────────────
  app.get<{ Params: { id: string; jid: string }; Querystring: { limit?: string } }>(
    '/:id/chats/:jid/messages', auth, async (req: any, reply) => {
      const { id } = req.params;
      const userId = req.user.sub;

      const resolved = await resolveConnectedNumber(id, userId);
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

      const jid = parseJid(req.params.jid);
      if (!jid) return reply.code(400).send({ error: 'Conversa inválida.' });

      const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '50', 10) || 50, 1), 100);

      try {
        const messages = await fetchChatMessages(resolved.number.zapiInstanceId, jid, limit);
        return { messages };
      } catch (err: any) {
        app.log.error({ err: err.message }, '[WhatsAppWeb] Erro ao listar mensagens');
        return reply.code(502).send({ error: 'Não foi possível carregar as mensagens.' });
      }
    }
  );

  // ── POST /numbers/:id/chats/:jid/messages ─────────────────────────────────
  app.post<{ Params: { id: string; jid: string }; Body: { text?: string } }>(
    '/:id/chats/:jid/messages', auth, async (req: any, reply) => {
      const { id } = req.params;
      const userId = req.user.sub;

      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'Mensagem vazia.' });
      if (text.length > 4096) return reply.code(400).send({ error: 'Mensagem muito longa.' });

      const resolved = await resolveConnectedNumber(id, userId);
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

      const jid = parseJid(req.params.jid);
      if (!jid) return reply.code(400).send({ error: 'Conversa inválida.' });

      try {
        const result = await sendTextToJid(resolved.number.zapiInstanceId, jid, text);
        return { ok: true, id: result.id };
      } catch (err: any) {
        app.log.error({ err: err.message }, '[WhatsAppWeb] Erro ao enviar mensagem');
        return reply.code(502).send({ error: 'Não foi possível enviar a mensagem.' });
      }
    }
  );
}
