import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModule } from '../lib/moduleGate';
import { fetchGroups, setGroupsIgnore } from '../services/evolution';

/**
 * Módulo Copiloto — Função 2 (resumo diário de grupos).
 *
 * A Função 1 (briefing por conversa individual) não passa por API nenhuma —
 * vive inteira no self-chat via comandos ("copiloto status/ligar/...", ver
 * copiloto-commands.ts) e no worker (copiloto.ts). Grupo é diferente: exige
 * opt-in explícito por grupo, e não dá pra escolher "qual grupo" por comando de
 * texto sem expor uma lista — por isso só essa parte tem rota própria.
 *
 * Sem teamScope de propósito: o Copiloto é pessoal do dono, não compartilhado
 * com o time (diferente de Atende/Tarefas). Ver ESCOPO_COPILOTO.md.
 */
export default async function copilotoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate);
  app.addHook('preHandler', requireModule('copiloto'));

  async function ownedNumber(userId: string, numberId: string) {
    return prisma.whatsappNumber.findFirst({ where: { id: numberId, userId } });
  }

  // ── GET /copiloto/conversations ──────────────────────────────────────────
  // Painel web (leitura). A ação de verdade (1/2/3, editar, ignorar) continua
  // só no self-chat — ver ESCOPO_COPILOTO.md §1. Esta rota é só "mostrar".
  app.get<{ Querystring: { numberId?: string; temperature?: string; status?: string; q?: string } }>(
    '/conversations',
    async (req: any) => {
      const userId = req.user.sub;
      const { numberId, temperature, status, q } = req.query || {};

      const conversations = await prisma.copilotoConversation.findMany({
        where: {
          userId,
          ...(numberId ? { numberId } : {}),
          ...(q ? {
            OR: [
              { contactName:  { contains: q, mode: 'insensitive' } },
              { contactPhone: { contains: q } },
            ],
          } : {}),
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
        include: {
          number: { select: { id: true, displayName: true, phoneNumber: true } },
          briefings: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { suggestions: { orderBy: { rank: 'asc' } } },
          },
        },
      });

      let list = conversations.map((c) => {
        const b = c.briefings[0] ?? null;
        return {
          id:            c.id,
          numberId:      c.numberId,
          number:        c.number,
          contactName:   c.contactName,
          contactPhone:  c.contactPhone,
          lastMessageAt: c.lastMessageAt,
          latestBriefing: b ? {
            id:          b.id,
            summary:     b.summary,
            intent:      b.intent,
            temperature: b.temperature,
            riskLevel:   b.riskLevel,
            blocker:     b.blocker,
            status:      b.status,
            createdAt:   b.createdAt,
            suggestions: b.suggestions.map((s) => ({
              id: s.id, rank: s.rank, axis: s.axis, title: s.title, draft: s.draft, technique: s.technique,
              status: s.status, sentText: s.sentText, outcome: s.outcome,
              commitmentTitle: s.commitmentTitle, commitmentDueAt: s.commitmentDueAt,
              userFeedback: s.userFeedback,
            })),
          } : null,
        };
      });

      // Filtro em memória — o volume por dono (dezenas de conversas, não milhares)
      // não justifica a complexidade de levar isso pro where do Prisma, já que
      // depende do briefing MAIS RECENTE de cada conversa (subquery correlata).
      if (temperature) list = list.filter((c) => c.latestBriefing?.temperature === temperature);
      if (status)      list = list.filter((c) => c.latestBriefing?.status === status);

      return { conversations: list };
    },
  );

  // ── GET /copiloto/conversations/:id ──────────────────────────────────────
  app.get<{ Params: { id: string } }>('/conversations/:id', async (req: any, reply) => {
    const userId = req.user.sub;
    const conversation = await prisma.copilotoConversation.findFirst({
      where: { id: req.params.id, userId },
      include: {
        messages:  { orderBy: { createdAt: 'asc' }, take: 300 },
        briefings: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: { suggestions: { orderBy: { rank: 'asc' } } },
        },
      },
    });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });
    return { conversation };
  });

  // ── PUT /copiloto/suggestions/:id/feedback ───────────────────────────────
  // Único jeito de dar "userFeedback" — só no site, de propósito (ver decisão
  // do usuário). Alimenta o PRÓXIMO briefing da mesma conversa — ver
  // processBrief em apps/worker/src/copiloto.ts.
  app.put<{ Params: { id: string }; Body: { feedback?: string } }>(
    '/suggestions/:id/feedback',
    async (req: any, reply) => {
      const userId = req.user.sub;
      const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim().slice(0, 500) : '';

      const suggestion = await prisma.copilotoSuggestion.findFirst({
        where: { id: req.params.id, briefing: { userId } },
      });
      if (!suggestion) return reply.code(404).send({ error: 'Sugestão não encontrada' });

      await prisma.copilotoSuggestion.update({
        where: { id: suggestion.id },
        data: { userFeedback: feedback || null },
      });

      return { ok: true, userFeedback: feedback || null };
    },
  );

  // ── GET /copiloto/numbers/:numberId/groups ──────────────────────────────
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/groups', async (req: any, reply) => {
    const userId = req.user.sub;
    const number = await ownedNumber(userId, req.params.numberId);
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });
    if (!number.zapiInstanceId || number.status !== 'connected') {
      return reply.code(409).send({ error: 'Número precisa estar conectado para listar grupos.' });
    }

    const [live, saved] = await Promise.all([
      fetchGroups(number.zapiInstanceId).catch(() => []),
      prisma.copilotoGroup.findMany({ where: { numberId: number.id } }),
    ]);

    const savedByJid = new Map(saved.map((g) => [g.groupJid, g]));
    const groups = live.map((g) => ({
      groupJid: g.jid,
      name:     savedByJid.get(g.jid)?.name || g.name,
      active:   savedByJid.get(g.jid)?.active ?? false,
    }));
    for (const s of saved) {
      if (!groups.some((g) => g.groupJid === s.groupJid)) {
        groups.push({ groupJid: s.groupJid, name: `${s.name} (indisponível)`, active: s.active });
      }
    }

    return { groups };
  });

  // ── POST /copiloto/numbers/:numberId/groups ─────────────────────────────
  app.post<{ Params: { numberId: string }; Body: { groupJid: string; name: string; active: boolean } }>(
    '/numbers/:numberId/groups',
    async (req: any, reply) => {
      const userId = req.user.sub;
      const number = await ownedNumber(userId, req.params.numberId);
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      const { groupJid, name, active } = req.body || {};
      if (!groupJid || typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
        return reply.code(400).send({ error: 'groupJid inválido' });
      }

      await prisma.copilotoGroup.upsert({
        where:  { numberId_groupJid: { numberId: number.id, groupJid } },
        update: { name: name || groupJid, active: !!active },
        create: { userId, numberId: number.id, groupJid, name: name || groupJid, active: !!active },
      });

      if (number.zapiInstanceId) {
        const anyActive = await prisma.copilotoGroup.count({ where: { numberId: number.id, active: true } });
        setGroupsIgnore(number.zapiInstanceId, anyActive === 0).catch((err: any) =>
          app.log.warn({ err: err?.message }, '[Copiloto] Falha ao ajustar groupsIgnore'));
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // ── GET /copiloto/numbers/:numberId/digests ─────────────────────────────
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/digests', async (req: any, reply) => {
    const userId = req.user.sub;
    const number = await ownedNumber(userId, req.params.numberId);
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const digests = await prisma.copilotoGroupDigest.findMany({
      where:   { numberId: number.id },
      orderBy: { date: 'desc' },
      take:    30,
    });
    return { digests };
  });

  // ── GET /copiloto/numbers/:numberId/config ──────────────────────────────
  // Só o que tem tela própria (resumo de grupos). O resto (silêncio, limite,
  // negócio, ligar/desligar, agressividade) continua só via comando no
  // self-chat — ver copiloto-commands.ts.
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/config', async (req: any, reply) => {
    const userId = req.user.sub;
    const number = await ownedNumber(userId, req.params.numberId);
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const config = await prisma.copilotoConfig.findUnique({ where: { numberId: number.id } });
    return {
      groupDigestHour: config?.groupDigestHour ?? 20,
      groupDigestFrequency: config?.groupDigestFrequency ?? 'daily',
    };
  });

  // ── PUT /copiloto/numbers/:numberId/config ──────────────────────────────
  app.put<{ Params: { numberId: string }; Body: { groupDigestHour?: number; groupDigestFrequency?: string } }>(
    '/numbers/:numberId/config',
    async (req: any, reply) => {
      const userId = req.user.sub;
      const number = await ownedNumber(userId, req.params.numberId);
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      const { groupDigestHour, groupDigestFrequency } = req.body || {};
      const data: { groupDigestHour?: number; groupDigestFrequency?: string } = {};

      if (groupDigestHour !== undefined) {
        if (!Number.isInteger(groupDigestHour) || groupDigestHour < 0 || groupDigestHour > 23) {
          return reply.code(400).send({ error: 'groupDigestHour precisa ser um número inteiro entre 0 e 23.' });
        }
        data.groupDigestHour = groupDigestHour;
      }
      if (groupDigestFrequency !== undefined) {
        if (groupDigestFrequency !== 'daily' && groupDigestFrequency !== 'weekly') {
          return reply.code(400).send({ error: "groupDigestFrequency precisa ser 'daily' ou 'weekly'." });
        }
        data.groupDigestFrequency = groupDigestFrequency;
      }
      if (Object.keys(data).length === 0) return reply.code(200).send({ ok: true });

      const config = await prisma.copilotoConfig.upsert({
        where:  { numberId: number.id },
        update: data,
        create: { userId, numberId: number.id, ...data },
      });

      // Destrava o período atual se ele ainda não recebeu resumo de verdade:
      // sem isso, mudar a hora (ou a frequência) não adiantava nada — o worker
      // (runCopilotoGroupDigests) já tinha marcado o número como "processado" e
      // não tentava de novo, mesmo com a config nova. Só apaga o registro se
      // summaryMd estiver vazio (nada foi realmente enviado) — nunca mexe num
      // período que já teve resumo de verdade entregue, pra não duplicar mensagem.
      const todayBr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      await prisma.copilotoGroupDigest.deleteMany({
        where: { numberId: number.id, date: todayBr, summaryMd: '' },
      }).catch(() => null);

      return { ok: true, groupDigestHour: config.groupDigestHour, groupDigestFrequency: config.groupDigestFrequency };
    },
  );

  // ── GET /copiloto/usage ──────────────────────────────────────────────────
  // Custo de IA do mês corrente, só das features do Copiloto — AiUsageLog já
  // gravava isso por userId, só nunca tinha ficado visível pra ninguém.
  app.get('/usage', async (req: any) => {
    const userId = req.user.sub;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const logs = await prisma.aiUsageLog.findMany({
      where: { userId, feature: { startsWith: 'copiloto_' }, createdAt: { gte: startOfMonth } },
      select: { inputTokens: true, outputTokens: true },
    });

    const calls = logs.length;
    const inputTokens = logs.reduce((s, l) => s + l.inputTokens, 0);
    const outputTokens = logs.reduce((s, l) => s + l.outputTokens, 0);

    return { calls, inputTokens, outputTokens, since: startOfMonth };
  });
}
