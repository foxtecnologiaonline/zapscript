import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis } from '../services/queue';
import { fetchAllChats, fetchChatMessages, sendTextToJid, markChatAsRead } from '../services/evolution';

type ResolvedNumber =
  | { ok: true; number: any }
  | { ok: false; status: number; error: string };

// Cache curto da lista de conversas — evita bater na Evolution toda vez que o
// usuário reabre a aba ou troca de número e volta (o real-time via Socket.IO
// já cobre "mensagem nova apareceu"; isto só evita refetch redundante de
// GET /chats em sequência rápida). TTL curto o bastante pra nunca ficar
// visivelmente desatualizado, e o botão "Atualizar" (?fresh=1) sempre pula o
// cache quando o usuário pede explicitamente.
const CHATS_CACHE_TTL_S = 15;
function chatsCacheKey(instanceNameStr: string): string {
  return `wa-web:chats:${instanceNameStr}`;
}

// O client `redis` compartilhado (services/queue.ts) é configurado com
// maxRetriesPerRequest:null — obrigatório pro BullMQ, mas isso também
// significa que um comando emitido com o Redis fora do ar fica preso na fila
// offline do ioredis esperando reconectar (com backoff de até 30s), em vez
// de rejeitar rápido. Sem um teto aqui, `.catch(() => null)` sozinho não
// protege — só pega promise rejeitada, não uma que nunca resolve. Esta rota
// é caminho crítico (sem ela, a tela de conversas nem carrega), então um
// timeout curto garante: Redis lento/fora do ar → cache é ignorado e segue
// pro fetch ao vivo da Evolution, nunca trava a requisição do usuário.
function withRedisTimeout<T>(promise: Promise<T>, ms = 500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), ms)),
  ]);
}

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
  app.get<{ Params: { id: string }; Querystring: { fresh?: string } }>('/:id/chats', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const resolved = await resolveConnectedNumber(id, userId);
    if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

    const instanceId = resolved.number.zapiInstanceId;
    const cacheKey    = chatsCacheKey(instanceId);
    const bypassCache = req.query?.fresh === '1';

    if (!bypassCache) {
      const cached = await withRedisTimeout(redis.get(cacheKey)).catch(() => null);
      if (cached) {
        try { return { chats: JSON.parse(cached) }; } catch { /* cache corrompido — segue pro fetch normal */ }
      }
    }

    try {
      const chats = await fetchAllChats(instanceId);
      // Aguarda a escrita (é local, sub-milissegundo) — sem isso, duas
      // requisições em sequência rápida (ex: React reexecutando o efeito)
      // podiam nem ver o cache ainda gravado, justamente o caso que ele
      // deveria otimizar. Falha (ou Redis fora do ar) não derruba a resposta.
      await withRedisTimeout(redis.set(cacheKey, JSON.stringify(chats), 'EX', CHATS_CACHE_TTL_S)).catch(() => null);
      return { chats };
    } catch (err: any) {
      app.log.error({ err: err.message }, '[WhatsAppWeb] Erro ao listar chats');
      return reply.code(502).send({ error: 'Não foi possível carregar as conversas.' });
    }
  });

  // ── GET /numbers/:id/chats/:jid/messages ──────────────────────────────────
  // `before` (epoch seconds) pagina pra trás — passa o timestamp da mensagem
  // mais antiga já carregada na tela pra buscar o lote anterior a ela.
  app.get<{ Params: { id: string; jid: string }; Querystring: { limit?: string; before?: string } }>(
    '/:id/chats/:jid/messages', auth, async (req: any, reply) => {
      const { id } = req.params;
      const userId = req.user.sub;

      const resolved = await resolveConnectedNumber(id, userId);
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error });

      const jid = parseJid(req.params.jid);
      if (!jid) return reply.code(400).send({ error: 'Conversa inválida.' });

      const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '50', 10) || 50, 1), 100);
      // undefined explícito (não "sem before" via falsy) — "0" é um cursor
      // válido em teoria (timestamp 0 é o fallback de mensagem sem
      // messageTimestamp em fetchChatMessages) e um `? :` simples trataria
      // isso como "não veio before", voltando pra 1ª página sem avisar.
      let before: number | undefined;
      if (req.query?.before !== undefined) {
        const parsed = parseInt(req.query.before, 10);
        if (!Number.isFinite(parsed)) return reply.code(400).send({ error: 'Parâmetro "before" inválido.' });
        before = parsed;
      }
      const isFirstPage = before === undefined;

      try {
        const messages = await fetchChatMessages(resolved.number.zapiInstanceId, jid, limit, before);

        // Confirmação de leitura: só na primeira página (abrir a conversa),
        // não ao "carregar mais antigas" — isso já foi lido há muito tempo,
        // marcar de novo é trabalho à toa. Fire-and-forget: nunca atrasa nem
        // quebra o carregamento da conversa por causa disto. Também invalida
        // o cache curto de /chats — sem isso, reabrir a lista de conversas
        // (mesmo depois de ler) podia mostrar o badge de não-lida antigo até
        // o cache expirar (15s).
        if (isFirstPage) {
          const unread = messages.filter(m => !m.fromMe);
          if (unread.length > 0) {
            markChatAsRead(resolved.number.zapiInstanceId, unread.map(m => ({
              id: m.id, fromMe: false, remoteJid: jid, participant: m.senderJid,
            }))).catch((err: any) =>
              app.log.warn({ err: err.message }, '[WhatsAppWeb] Falha ao marcar como lida — ignorado'));
            withRedisTimeout(redis.del(chatsCacheKey(resolved.number.zapiInstanceId))).catch(() => null);
          }
        }

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
