import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModule } from '../lib/moduleGate';
import {
  validateRequest,
  atendeConfigSchema,
  atendeKbCreateSchema,
  atendeKbUpdateSchema,
} from '../lib/validation';

const DEFAULT_FALLBACK = 'Recebemos sua mensagem! Já já alguém te responde por aqui.';

/**
 * Rotas do módulo ZapScript Atende (resposta automática por IA no WhatsApp).
 * Todas exigem entitlement ativo — ver requireModule('atende') (moduleGate.ts).
 */
export default async function atendeRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate, requireModule('atende')] };

  // ── GET /atende/config/:numberId ─────────────────────────────────────────
  app.get<{ Params: { numberId: string } }>('/config/:numberId', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { numberId } = req.params;

    const number = await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const config = await prisma.atendeConfig.findUnique({ where: { numberId } });
    // Sem config ainda é estado normal (número nunca configurou o Atende) — devolve
    // o shape default em vez de 404, pra UI renderizar o form sem tratamento especial.
    return config ?? {
      numberId,
      userId,
      enabled: false,
      businessContext: null,
      tone: 'profissional-amigavel',
      fallbackMessage: DEFAULT_FALLBACK,
      escalationPhone: null,
    };
  });

  // ── PUT /atende/config/:numberId ─────────────────────────────────────────
  app.put<{ Params: { numberId: string }; Body: any }>('/config/:numberId', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { numberId } = req.params;

    const v = validateRequest(atendeConfigSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const number = await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const data = v.data;

    // Mesma convenção de numbers.ts: números guardados com DDI 55 — é o formato
    // que sendMessageViaEvolution/WhatsApp esperam.
    let escalationPhone: string | null | undefined = undefined;
    if (data.escalationPhone !== undefined) {
      if (data.escalationPhone === null) {
        escalationPhone = null;
      } else {
        const digits = data.escalationPhone.replace(/\D/g, '');
        escalationPhone = digits.startsWith('55') ? digits : `55${digits}`;
      }
    }

    const config = await prisma.atendeConfig.upsert({
      where: { numberId },
      update: { ...data, ...(escalationPhone !== undefined ? { escalationPhone } : {}) },
      create: {
        numberId,
        userId,
        enabled: data.enabled ?? false,
        businessContext: data.businessContext,
        tone: data.tone ?? 'profissional-amigavel',
        fallbackMessage: data.fallbackMessage ?? DEFAULT_FALLBACK,
        escalationPhone: escalationPhone ?? null,
      },
    });

    return config;
  });

  // ── GET /atende/kb ────────────────────────────────────────────────────────
  app.get('/kb', auth, async (req: any) => {
    return prisma.atendeKnowledgeBase.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
  });

  // ── POST /atende/kb ───────────────────────────────────────────────────────
  app.post<{ Body: { question: string; answer: string } }>('/kb', auth, async (req: any, reply) => {
    const v = validateRequest(atendeKbCreateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const entry = await prisma.atendeKnowledgeBase.create({
      data: {
        userId:   req.user.sub,
        question: v.data.question.trim(),
        answer:   v.data.answer.trim(),
      },
    });
    return reply.code(201).send(entry);
  });

  // ── PUT /atende/kb/:id ────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: any }>('/kb/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.atendeKnowledgeBase.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: 'Item não encontrado' });

    const v = validateRequest(atendeKbUpdateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    if (Object.keys(v.data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    const data: any = { ...v.data };
    if (data.question) data.question = data.question.trim();
    if (data.answer)   data.answer   = data.answer.trim();

    return prisma.atendeKnowledgeBase.update({ where: { id }, data });
  });

  // ── DELETE /atende/kb/:id ─────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/kb/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.atendeKnowledgeBase.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: 'Item não encontrado' });

    await prisma.atendeKnowledgeBase.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ── GET /atende/conversations ─────────────────────────────────────────────
  app.get('/conversations', auth, async (req: any) => {
    const conversations = await prisma.atendeConversation.findMany({
      where:   { userId: req.user.sub },
      orderBy: { lastMessageAt: 'desc' },
      take:    100,
      include: {
        number:   { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return conversations.map((c) => ({
      id:            c.id,
      contactPhone:  c.contactPhone,
      contactName:   c.contactName,
      status:        c.status,
      humanTakeover: c.humanTakeover,
      lastMessageAt: c.lastMessageAt,
      number:        c.number,
      lastMessage:   c.messages[0] ?? null,
    }));
  });

  // ── GET /atende/conversations/:id/messages ────────────────────────────────
  app.get<{ Params: { id: string } }>('/conversations/:id/messages', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const conversation = await prisma.atendeConversation.findFirst({ where: { id, userId } });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });

    const messages = await prisma.atendeMessage.findMany({
      where:   { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take:    200,
    });

    return { conversation, messages };
  });

  // ── POST /atende/conversations/:id/takeover ───────────────────────────────
  // Dono assume a conversa manualmente — desliga a resposta automática só aqui.
  app.post<{ Params: { id: string } }>('/conversations/:id/takeover', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const conversation = await prisma.atendeConversation.findFirst({ where: { id, userId } });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });

    return prisma.atendeConversation.update({ where: { id }, data: { humanTakeover: true } });
  });

  // ── POST /atende/conversations/:id/release ────────────────────────────────
  // Devolve a conversa para o bot (contrapartida do takeover).
  app.post<{ Params: { id: string } }>('/conversations/:id/release', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const conversation = await prisma.atendeConversation.findFirst({ where: { id, userId } });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });

    return prisma.atendeConversation.update({ where: { id }, data: { humanTakeover: false } });
  });
}
