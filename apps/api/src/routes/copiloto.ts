import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModule } from '../lib/moduleGate';
import { fetchGroups } from '../services/evolution';
import { copilotoQueue } from '../services/queue';
import { sendCopilotoSuggestion, dismissCopilotoBriefing } from '../services/copiloto-actions';

/**
 * Módulo Copiloto.
 *
 * v3.0 (ESCOPO_COPILOTO.md §15) — a Função 1 (briefing por conversa
 * individual) virou SOB DEMANDA e vive neste painel: GET /inbox lista o que
 * precisa de atenção, POST /inbox/refresh dispara a análise (IA), POST
 * /suggestions/:id/send envia ao cliente, POST /briefings/:id/dismiss
 * descarta. O self-chat ("copiloto status/ligar/...", ver copiloto-commands.ts)
 * ficou só com configuração — não processa nem envia mais nada.
 *
 * Função 2 (resumo diário de grupos) continua com rota própria: exige opt-in
 * explícito por grupo, e não dá pra escolher "qual grupo" por comando de
 * texto sem expor uma lista.
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
  // Navegação livre (busca, filtro por tipo/temperatura/status) — pro dono
  // revisar histórico. GET /inbox (abaixo) é a fila do dia-a-dia.
  app.get<{ Querystring: { numberId?: string; temperature?: string; status?: string; tipo?: string; q?: string } }>(
    '/conversations',
    async (req: any) => {
      const userId = req.user.sub;
      const { numberId, temperature, status, tipo, q } = req.query || {};

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
            // v2.0 — null em briefing anterior à expansão de escopo; o
            // frontend trata null como "comercial" (ver ESCOPO_COPILOTO.md).
            tipo:        b.tipo,
            remetente:   b.remetente,
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
      // Briefing v1.0 (tipo=null) é tratado como "comercial" no filtro — era o
      // único tipo que existia antes da v2.0, não deve sumir da listagem.
      if (tipo)        list = list.filter((c) => (c.latestBriefing?.tipo ?? 'comercial') === tipo);

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

      // Nota: groupsIgnore da instância NÃO é mais ligado/desligado aqui —
      // desde o WhatsApp Web simplificado (fase 3), grupos ficam sempre
      // ligados pra toda instância (decisão de produto), gerenciado em
      // evolution-sync.ts (boot) e evolution-webhook.ts (connection.update).
      // Antes, desativar o último grupo do Copiloto desligava groupsIgnore de
      // volta — o que agora quebraria o WhatsApp Web pra esse número.

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

  // ── GET /copiloto/metrics ─────────────────────────────────────────────────
  // Dashboard do PRÓPRIO dono — diferente de /admin/copiloto/insights (que é
  // cross-usuário, só pro time interno decidir onde apertar a triagem). Aqui
  // é "o Copiloto está fazendo alguma coisa por mim?": quantas conversas
  // ainda não viraram briefing, quantos contatos, quanta atividade no
  // período. Só leitura — mesma filosofia de /conversations.
  app.get<{ Querystring: { numberId?: string; days?: string } }>('/metrics', async (req: any) => {
    const userId = req.user.sub;
    const { numberId } = req.query || {};
    const days = Math.min(90, Math.max(1, parseInt(req.query?.days as any, 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const convWhere = { userId, ...(numberId ? { numberId } : {}) };
    const briefingWhere = { userId, ...(numberId ? { numberId } : {}) };

    const [totalContacts, conversationsForUnread] = await Promise.all([
      prisma.copilotoConversation.count({ where: convWhere }),
      // "Não lida" = mesma definição do sweep de pendências (worker):
      // lastBriefedAt nulo ou mais velho que a última mensagem. Comparação
      // entre duas colunas da mesma linha não dá pra expressar num `where`
      // do Prisma — traz os dois campos e filtra em memória, igual
      // runCopilotoPendingSweep já faz (volume por usuário é baixo, não é
      // a tabela inteira da plataforma).
      prisma.copilotoConversation.findMany({
        where: convWhere,
        select: { lastMessageAt: true, lastBriefedAt: true },
      }),
    ]);
    const unreadConversations = conversationsForUnread.filter(
      (c) => !c.lastBriefedAt || c.lastBriefedAt < c.lastMessageAt,
    ).length;
    const readConversations = totalContacts - unreadConversations;

    const [
      messagesIn, messagesOut, briefingsGenerated, briefingsDismissed,
      suggestionsSent, customerReplies, tasksCreated, byTipoRaw,
    ] = await Promise.all([
      prisma.copilotoMessage.count({ where: { direction: 'in', createdAt: { gte: since }, conversation: convWhere } }),
      prisma.copilotoMessage.count({ where: { direction: 'out', createdAt: { gte: since }, conversation: convWhere } }),
      prisma.copilotoBriefing.count({ where: { ...briefingWhere, createdAt: { gte: since } } }),
      prisma.copilotoBriefing.count({ where: { ...briefingWhere, status: 'dismissed', createdAt: { gte: since } } }),
      prisma.copilotoSuggestion.count({ where: { status: { in: ['sent', 'edited'] }, createdAt: { gte: since }, briefing: briefingWhere } }),
      prisma.copilotoSuggestion.count({ where: { outcome: 'replied', createdAt: { gte: since }, briefing: briefingWhere } }),
      prisma.copilotoSuggestion.count({ where: { taskId: { not: null }, createdAt: { gte: since }, briefing: briefingWhere } }),
      prisma.copilotoBriefing.groupBy({ by: ['tipo'], where: { ...briefingWhere, createdAt: { gte: since } }, _count: { _all: true } }),
    ]);

    const byTipo = byTipoRaw
      .map((r) => ({ tipo: r.tipo ?? 'comercial', count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    return {
      since: since.toISOString(),
      days,
      snapshot: { totalContacts, unreadConversations, readConversations },
      activity: {
        messagesIn, messagesOut,
        briefingsGenerated, briefingsDismissed,
        suggestionsSent, customerReplies, tasksCreated,
        byTipo,
      },
    };
  });

  // ── GET /copiloto/inbox ───────────────────────────────────────────────────
  // A fila do dia-a-dia: conversas com algo que precisa da sua atenção —
  // mensagem ainda não processada (não lida) OU já processada mas com um
  // briefing 'pending' (você ainda não enviou nem descartou). v3.0 —
  // ESCOPO_COPILOTO.md §15: sem filtro de "vale a pena" — toda conversa
  // pendente aparece, você que decide no site.
  app.get<{ Querystring: { numberId?: string } }>('/inbox', async (req: any) => {
    const userId = req.user.sub;
    const { numberId } = req.query || {};

    const conversations = await prisma.copilotoConversation.findMany({
      where: { userId, ...(numberId ? { numberId } : {}) },
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

    const TEMP_RANK: Record<string, number> = { quente: 0, morno: 1, frio: 2 };

    const inbox = conversations
      .map((c) => {
        const b = c.briefings[0] ?? null;
        const unread = !c.lastBriefedAt || c.lastBriefedAt < c.lastMessageAt;
        const needsAttention = unread || b?.status === 'pending';
        return { c, b, unread, needsAttention };
      })
      .filter((row) => row.needsAttention)
      .sort((a, b) => {
        const rankA = TEMP_RANK[a.b?.temperature ?? ''] ?? 3;
        const rankB = TEMP_RANK[b.b?.temperature ?? ''] ?? 3;
        if (rankA !== rankB) return rankA - rankB;
        return b.c.lastMessageAt.getTime() - a.c.lastMessageAt.getTime();
      })
      .map(({ c, b, unread }) => ({
        id:            c.id,
        numberId:      c.numberId,
        number:        c.number,
        contactName:   c.contactName,
        contactPhone:  c.contactPhone,
        lastMessageAt: c.lastMessageAt,
        // true = ainda não foi processada nesta rodada (precisa de refresh);
        // false com briefing 'pending' = já tem análise, só falta você agir.
        unread,
        latestBriefing: b ? {
          id:          b.id,
          summary:     b.summary,
          intent:      b.intent,
          temperature: b.temperature,
          riskLevel:   b.riskLevel,
          blocker:     b.blocker,
          tipo:        b.tipo,
          remetente:   b.remetente,
          sensitive:   b.sensitive,
          status:      b.status,
          createdAt:   b.createdAt,
          suggestions: b.suggestions
            .filter((s) => s.status === 'offered')
            .map((s) => ({
              id: s.id, rank: s.rank, axis: s.axis, title: s.title, draft: s.draft,
              rationale: s.rationale, risk: s.risk, technique: s.technique, confidence: s.confidence,
              commitmentTitle: s.commitmentTitle, commitmentDueAt: s.commitmentDueAt,
            })),
        } : null,
      }));

    return { inbox, unreadCount: inbox.filter((i) => i.unread).length };
  });

  // ── POST /copiloto/inbox/refresh ─────────────────────────────────────────
  // Dispara a IA (triagem + buildBriefing + guardrails, ver processBrief em
  // apps/worker/src/copiloto.ts) pra cada conversa ainda não processada. Só
  // enfileira — quem chama deve reconsultar GET /inbox depois (o front faz
  // polling curto até o `unread` de cada conversa que estava marcada zerar).
  app.post<{ Body: { numberId?: string } }>('/inbox/refresh', async (req: any, reply) => {
    const userId = req.user.sub;
    const { numberId } = req.body || {};

    if (numberId) {
      const owned = await ownedNumber(userId, numberId);
      if (!owned) return reply.code(404).send({ error: 'Número não encontrado' });
    }

    const conversations = await prisma.copilotoConversation.findMany({
      where: { userId, ...(numberId ? { numberId } : {}) },
      select: { numberId: true, contactPhone: true, lastMessageAt: true, lastBriefedAt: true },
    });
    const pending = conversations.filter((c) => !c.lastBriefedAt || c.lastBriefedAt < c.lastMessageAt);

    let enqueued = 0;
    for (const c of pending) {
      // Sem bucket de tempo (não é mais debounce): jobId estável por conversa
      // só evita dois cliques em "Atualizar" processarem a mesma conversa em
      // paralelo — o job existente é reaproveitado, não duplicado.
      await copilotoQueue.add(
        'brief',
        { userId, numberId: c.numberId, contactPhone: c.contactPhone },
        { jobId: `copiloto-brief-refresh-${c.numberId}-${c.contactPhone}` },
      ).catch(() => null);
      enqueued++;
    }

    return { enqueued, pending: pending.length };
  });

  // ── POST /copiloto/suggestions/:id/send ──────────────────────────────────
  // Envia ao cliente — o rascunho original ou o texto que o dono editou no
  // painel antes de clicar Enviar. Único ponto de envio ao cliente no
  // Copiloto (ver copiloto-actions.ts).
  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    '/suggestions/:id/send',
    async (req: any, reply) => {
      const userId = req.user.sub;
      const result = await sendCopilotoSuggestion({
        userId, suggestionId: req.params.id, finalText: req.body?.text,
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.error });
      return result;
    },
  );

  // ── POST /copiloto/briefings/:id/dismiss ─────────────────────────────────
  // Equivalente ao antigo "0"/"0!" no self-chat — descarta sem enviar nada.
  // `noise: true` é o antigo "0!": alimenta ESCOPO_COPILOTO.md §13.3/13.4.
  app.post<{ Params: { id: string }; Body: { noise?: boolean } }>(
    '/briefings/:id/dismiss',
    async (req: any, reply) => {
      const userId = req.user.sub;
      const result = await dismissCopilotoBriefing({
        userId, briefingId: req.params.id, noise: !!req.body?.noise,
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.error });
      return result;
    },
  );
}
