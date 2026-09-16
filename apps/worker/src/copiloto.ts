import { Worker, Job, Queue } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';
import {
  triageConversation, buildBriefing, buildGroupDigest,
  type CopilotoMessageLike, type GroupDigestBlock,
} from './services/copiloto-agent';
import { validateDraft, isOptOut, hasVulnerabilitySignal } from './services/copiloto-guardrails';

/**
 * Worker do ZapScript Copiloto — consome a fila 'copiloto'.
 *
 * v3.0 (ESCOPO_COPILOTO.md §15) — o Copiloto virou SOB DEMANDA: não empurra
 * mais nada pro self-chat do dono. Dois jobs:
 *   'ingest' — persiste a mensagem (entrada do cliente ou saída do dono). Barato,
 *              sem IA. Produzido por apps/api/src/routes/evolution-webhook.ts a
 *              cada mensagem — mantém o webhook rápido.
 *   'brief'  — roda a IA (triagem + buildBriefing + guardrails) e persiste
 *              CopilotoBriefing + CopilotoSuggestion. Só é enfileirado quando o
 *              dono clica "Atualizar" no painel (POST /copiloto/inbox/refresh,
 *              apps/api/src/routes/copiloto.ts) — nunca automaticamente depois
 *              de uma mensagem chegar.
 *
 * O que o Copiloto NUNCA faz aqui: mandar mensagem para o cliente. Isso só
 * acontece quando o dono clica "Enviar" no painel (POST /copiloto/suggestions/
 * :id/send), que vive na API (apps/api/src/services/copiloto-actions.ts).
 *
 * Registrado como side-effect: importado por src/index.ts.
 */
const copilotoQueue = new Queue('copiloto', { connection: redis as any });

/**
 * Mesmo job 'ingest' de enqueueCopilotoMessage (apps/api/src/services/
 * copiloto-commands.ts) — existe uma cópia aqui (em vez de importar da API)
 * porque quem chama isto é processEvolutionJob (apps/worker/src/index.ts)
 * depois de transcrever um áudio — o texto só fica pronto DEPOIS que o job de
 * transcrição roda aqui no worker, então não dá pra passar pela rota normal
 * do webhook (síncrona, sem IA).
 *
 * v3.0 — só persiste ('ingest'). NÃO enfileira mais 'brief' automaticamente:
 * o Copiloto virou sob demanda (painel /dashboard/copiloto, ver
 * ESCOPO_COPILOTO.md §15) — quem decide processar uma conversa é o dono,
 * clicando "Atualizar" no site (POST /copiloto/inbox/refresh, apps/api/src/
 * routes/copiloto.ts), não uma janela de debounce depois de cada mensagem.
 */
export async function enqueueCopilotoIngest(params: {
  userId: string;
  numberId: string;
  contactPhone: string;
  contactName?: string | null;
  direction: 'in' | 'out';
  content: string;
  messageId: string;
}): Promise<void> {
  await copilotoQueue.add(
    'ingest',
    {
      userId: params.userId,
      numberId: params.numberId,
      contactPhone: params.contactPhone,
      contactName: params.contactName ?? null,
      direction: params.direction,
      content: params.content,
      externalId: params.messageId,
    },
    { jobId: `copiloto-in-${params.messageId}` },
  );
}

/** Teto de mensagens levadas ao prompt — conversa longa não pode virar prompt gigante. */
const HISTORY_LIMIT = 12;
const NEW_MESSAGES_LIMIT = 20;

interface IngestJobData {
  userId: string;
  numberId: string;
  contactPhone: string;
  contactName?: string | null;
  direction: 'in' | 'out';
  content: string;
  // messageId do WhatsApp — presente em mensagens vindas do webhook e do
  // backfill/sweep de não lidas (copiloto-backfill.ts). Ausente só em código
  // antigo/caminho que não tenha sido atualizado — nesse caso cai no
  // comportamento anterior (sem dedup por id, só o echo-guard abaixo).
  externalId?: string | null;
}

interface BriefJobData {
  userId: string;
  numberId: string;
  contactPhone: string;
}

/**
 * Titularidade do módulo. O worker não tem o moduleGate da API (que depende de
 * Fastify/Redis cache), então consulta o Entitlement direto — mesma fonte da
 * verdade, sem cache. Volume baixo: roda uma vez por briefing, não por mensagem.
 */
export async function hasCopiloto(userId: string): Promise<boolean> {
  const ent = await prisma.entitlement.findFirst({
    where: { userId, productKey: 'copiloto', status: { in: ['active', 'trialing'] } },
    select: { id: true },
  }).catch(() => null);
  return !!ent;
}

// ── ingest ───────────────────────────────────────────────────────────────────

async function processIngest(job: Job<IngestJobData>) {
  const { userId, numberId, contactPhone, contactName, direction, content, externalId } = job.data;
  if (!content?.trim()) return { skipped: true, reason: 'empty' };

  const conversation = await prisma.copilotoConversation.upsert({
    where: { numberId_contactPhone: { numberId, contactPhone } },
    update: { lastMessageAt: new Date(), ...(contactName ? { contactName } : {}) },
    create: { userId, numberId, contactPhone, contactName: contactName ?? null },
  });

  // Dedup por messageId real do WhatsApp — cobre o backfill/sweep de não lidas
  // (copiloto-backfill.ts) reprocessando o mesmo chat em rodadas diferentes.
  // O jobId da fila ('copiloto-in-<messageId>') já dedupa enquanto o job ainda
  // existir no Redis, mas removeOnComplete apaga esse registro depois de
  // 24h/500 jobs (ver apps/api/src/services/queue.ts) — sem este check, uma
  // mensagem antiga que continua não lida vira duplicata a cada nova rodada.
  if (externalId) {
    const dup = await prisma.copilotoMessage.findFirst({
      where: { conversationId: conversation.id, externalId },
      select: { id: true },
    });
    if (dup) return { skipped: true, reason: 'duplicado' };
  }

  // Eco do próprio envio do Copiloto: quando o dono escolhe uma opção, a API já
  // grava a mensagem como 'out'; o WhatsApp devolve o mesmo texto como fromMe
  // segundos depois. Sem este guarda, toda sugestão enviada aparece duplicada no
  // histórico e polui o prompt do próximo briefing.
  if (direction === 'out') {
    const echo = await prisma.copilotoMessage.findFirst({
      where: {
        conversationId: conversation.id,
        direction: 'out',
        content,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (echo) return { skipped: true, reason: 'echo' };
  }

  await prisma.copilotoMessage.create({
    data: { conversationId: conversation.id, direction, content, externalId: externalId ?? null },
  });

  // Resultado da sugestão: o cliente respondeu depois do que o dono mandou?
  // É o sinal mais barato de "a ação funcionou" e alimenta a taxa de acerto por
  // técnica. Best-effort — nunca pode derrubar a ingestão.
  if (direction === 'in') {
    // Em dois passos de propósito: filtro por relação em updateMany não é
    // garantido no Prisma — findMany (que aceita) resolve os ids, updateMany
    // fecha por id.
    const pendingOutcome = await prisma.copilotoSuggestion.findMany({
      where: {
        status: 'sent',
        outcome: null,
        briefing: { conversationId: conversation.id },
        createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
      select: { id: true },
    }).catch(() => [] as Array<{ id: string }>);

    if (pendingOutcome.length > 0) {
      await prisma.copilotoSuggestion.updateMany({
        where: { id: { in: pendingOutcome.map((s) => s.id) } },
        data: { outcome: 'replied', outcomeAt: new Date() },
      }).catch(() => null);
    }
  }

  return { conversationId: conversation.id };
}

// ── brief ────────────────────────────────────────────────────────────────────
// v3.0 — reescrito pra "sob demanda, sem filtro" (ESCOPO_COPILOTO.md §15): só
// roda quando o dono clica "Atualizar" no painel (POST /copiloto/inbox/refresh,
// que enfileira este job pra cada conversa não lida). Sem gate de "vale a pena
// te interromper" — não existe mais interrupção, o card só aparece na lista.
// Por isso saíram: horário de silêncio, teto diário, cooldown de "pessoal",
// piso de confiança por tipo, e a checagem de número conectado (ler e
// analisar não depende do número estar online agora — só enviar depende, e
// isso é checado na hora do envio, não aqui).
async function processBrief(job: Job<BriefJobData>) {
  const { userId, numberId, contactPhone } = job.data;

  const conversation = await prisma.copilotoConversation.findUnique({
    where: { numberId_contactPhone: { numberId, contactPhone } },
  });
  if (!conversation) return { skipped: true, reason: 'sem_conversa' };

  // Reconfere a titularidade na hora de gastar: o admin pode ter revogado o
  // acesso entre o dono clicar "Atualizar" e o job rodar.
  if (!(await hasCopiloto(userId))) {
    logger.info(`[Copiloto] ⏭️ ${contactPhone}: pulado (usuário ${userId} sem módulo Copiloto)`);
    return { skipped: true, reason: 'sem_modulo' };
  }

  const config = await prisma.copilotoConfig.findUnique({ where: { numberId } });
  // "enabled" continua sendo o botão mestre ("copiloto ligar/desligar" no
  // self-chat, ou pausa administrativa em massa) — mesmo sem push, o dono
  // ainda pode querer desligar o Copiloto de vez pra um número.
  if (config?.enabled === false) {
    logger.info(`[Copiloto] ⏭️ ${contactPhone}: pulado (Copiloto desligado pro número ${numberId})`);
    return { skipped: true, reason: 'desligado' };
  }

  // Só o que ainda não virou briefing. Sem isso, cada job reavaliaria a conversa
  // inteira e o painel mostraria o mesmo resumo várias vezes.
  const newMessages = await prisma.copilotoMessage.findMany({
    where: {
      conversationId: conversation.id,
      direction: 'in',
      ...(conversation.lastBriefedAt ? { createdAt: { gt: conversation.lastBriefedAt } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: NEW_MESSAGES_LIMIT,
    select: { direction: true, content: true },
  });
  if (newMessages.length === 0) return { skipped: true, reason: 'nada_novo' }; // não loga — acontece toda hora, seria ruído

  const markBriefed = () =>
    prisma.copilotoConversation.update({
      where: { id: conversation.id },
      data: { lastBriefedAt: new Date() },
    }).catch(() => null);

  const lastText = newMessages[newMessages.length - 1].content;
  const contactLabel = conversation.contactName || contactPhone;

  // Recusa explícita do cliente: o Copiloto não sugere nada comercial depois
  // do "não" — insistir aqui é prática abusiva (CDC art. 39). Ainda cria o
  // card (o dono precisa saber que isso aconteceu), só sem opções de ação.
  if (isOptOut(lastText)) {
    await prisma.copilotoBriefing.create({
      data: {
        userId, numberId, conversationId: conversation.id,
        summary: `${contactLabel} pediu para não receber mais mensagens.`,
        intent: 'Parar de receber contato comercial',
        temperature: 'frio',
        riskLevel: 'alto',
        deliveredVia: 'painel',
      },
    });
    await markBriefed();
    logger.info(`[Copiloto] 🛑 ${contactLabel}: opt-out registrado, sem sugestão`);
    return { optOut: true };
  }

  const historyDesc = await prisma.copilotoMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { direction: true, content: true },
  });
  const history: CopilotoMessageLike[] = historyDesc.reverse();

  // Triagem mantida só pra classificar tipo/remetente (usado no filtro e na
  // adaptação dos eixos do briefing, ver copiloto-playbook.ts) — o resultado
  // "ignorar" dela não bloqueia mais nada; "todas as conversas, sem filtro"
  // foi decisão explícita do dono (a triagem existia pra proteger contra
  // interrupção desnecessária no WhatsApp, e essa interrupção não existe mais).
  const triage = await triageConversation({
    userId,
    contactName: conversation.contactName,
    newMessages,
    recentHistory: history.slice(0, Math.max(0, history.length - newMessages.length)),
  });
  logger.info(`[Copiloto] ✓ ${contactLabel}: tipo=${triage.tipo ?? 'comercial'}, remetente=${triage.remetente ?? 'n/d'}`);

  const kb = await prisma.atendeKnowledgeBase.findMany({
    where: { userId, active: true },
    orderBy: { createdAt: 'asc' },
    take: 30,
    select: { question: true, answer: true },
  }).catch(() => [] as Array<{ question: string; answer: string }>);

  // Feedback que o dono deixou no site sobre sugestões anteriores DESTA
  // conversa — só existe se ele editou em /dashboard/copiloto. Entra no
  // próximo briefing pra IA não repetir o mesmo erro pro mesmo contato.
  const pastFeedback = await prisma.copilotoSuggestion.findMany({
    where: { userFeedback: { not: null }, briefing: { conversationId: conversation.id } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { userFeedback: true },
  }).then((rows) => rows.map((r) => r.userFeedback as string)).catch(() => [] as string[]);

  let briefing;
  try {
    briefing = await buildBriefing({
      userId,
      contactName: conversation.contactName,
      businessContext: config?.businessContext,
      aggressiveness: config?.aggressiveness,
      knowledgeBase: kb,
      history,
      pastFeedback,
      tipo: triage.tipo,
      remetente: triage.remetente,
    });
  } catch (err: any) {
    // Falha aqui (todos os provedores de IA fora) não pode derrubar o job em
    // silêncio — registra pra alertar o admin (health-monitor.ts) e deixa o
    // BullMQ reprocessar; o painel mostra a conversa como "ainda não lida"
    // até um refresh dar certo.
    logger.error(`[Copiloto] ❌ buildBriefing falhou (todos os provedores) — ${contactLabel}: ${err.message}`);
    await prisma.systemError.create({
      data: { service: 'copiloto-ai', message: `buildBriefing falhou: ${err.message}`, context: { numberId, feature: 'copiloto_brief' } },
    }).catch(() => null);
    throw err; // não marca como briefado — o próximo refresh tenta de novo
  }

  // Ancoragem dos guardrails: só é "fato do negócio" o que já existe na conversa,
  // no contexto do negócio ou na base de conhecimento. Qualquer preço fora disso
  // é invenção da IA em nome do negócio do dono.
  const allowedText = [
    config?.businessContext ?? '',
    kb.map((k) => `${k.question} ${k.answer}`).join('\n'),
    history.map((m) => m.content).join('\n'),
  ].join('\n');

  const sensitive = briefing.sensitive || hasVulnerabilitySignal(lastText);

  const created = await prisma.copilotoBriefing.create({
    data: {
      userId,
      numberId,
      conversationId: conversation.id,
      summary: briefing.summary,
      intent: briefing.intent,
      temperature: briefing.temperature,
      blocker: briefing.blocker,
      riskLevel: briefing.riskLevel,
      tipo: triage.tipo,
      remetente: triage.remetente,
      triageConfidence: triage.confidence,
      sensitive,
      deliveredVia: 'painel',
    },
  });

  // As opções reprovadas ficam gravadas como 'discarded' — auditoria de quantas
  // vezes o modelo tentou inventar preço/urgência é o que diz se o prompt precisa
  // de ajuste. Nunca aparecem no painel.
  let rank = 0;
  let offeredCount = 0;
  for (const opt of briefing.options) {
    const check = validateDraft(opt.draft, { allowedText });
    rank += 1;
    await prisma.copilotoSuggestion.create({
      data: {
        briefingId: created.id,
        rank,
        axis: opt.axis,
        title: opt.title,
        draft: opt.draft,
        rationale: check.ok ? opt.rationale : `[bloqueado] ${check.violations.join('; ')}`,
        risk: opt.risk,
        technique: opt.technique,
        confidence: opt.confidence,
        status: check.ok ? 'offered' : 'discarded',
        // Compromisso só é gravado em opção aprovada — uma opção bloqueada
        // pelos guardrails não deve virar Task quando o dono nunca vai vê-la.
        commitmentTitle: check.ok ? opt.commitment?.title ?? null : null,
        commitmentDueAt: check.ok && opt.commitment ? new Date(opt.commitment.dueAt) : null,
      },
    });
    if (check.ok) {
      offeredCount += 1;
    } else {
      logger.warn(`[Copiloto] 🚫 Opção ${rank} bloqueada (${contactLabel}): ${check.violations.join('; ')}`);
    }
  }

  await markBriefed();
  logger.info(`[Copiloto] ✅ Briefing pronto — ${contactLabel} [${triage.tipo ?? 'comercial'}] (${offeredCount} opção(ões)) — disponível no painel`);
  return { briefingId: created.id, offered: offeredCount };
}

// ── Worker ───────────────────────────────────────────────────────────────────

async function processCopilotoJob(job: Job<any>) {
  if (job.name === 'ingest') return processIngest(job as Job<IngestJobData>);
  if (job.name === 'brief')  return processBrief(job as Job<BriefJobData>);
  logger.warn(`[Copiloto] Job desconhecido: ${job.name}`);
  return { skipped: true, reason: 'job_desconhecido' };
}

const COPILOTO_CONCURRENCY = parseInt(process.env.COPILOTO_WORKER_CONCURRENCY || '2');

const copilotoWorker = new Worker('copiloto', processCopilotoJob, {
  connection: redis as any,
  concurrency: COPILOTO_CONCURRENCY,
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

copilotoWorker.on('failed', (job, err) => {
  logger.error(`[Copiloto] ❌ Job ${job?.id} (${job?.name}) falhou: ${err.message}`);
});

copilotoWorker.on('error', (err) => {
  logger.error('[Copiloto] Erro interno do worker', { err: err.message });
});

logger.info('Worker Copiloto (briefings do dono) iniciado');

// ─────────────────────────────────────────────────────────────────────────
// Função 2 — resumo diário de grupo (polling, mesmo padrão do digest de
// Tarefas/Atende — não é fila, é um cron simples). Opt-in por grupo
// (CopilotoGroup), sem briefing, sem triagem por mensagem: só agrega o dia e
// resume uma vez. Entrega no mesmo self-chat da Função 1, formatado à parte.
// ─────────────────────────────────────────────────────────────────────────

// Hora padrão pra quem nunca configurou (CopilotoConfig.groupDigestHour é por
// número, ajustável na tela /dashboard/copiloto → aba Grupos). Env var só entra
// como fallback de instalação nova/config ausente.
const GROUP_DIGEST_HOUR_DEFAULT = parseInt(process.env.COPILOTO_GROUP_DIGEST_HOUR || '20', 10);
const GROUP_DIGEST_POLL_MS = 30 * 60 * 1000; // checa a cada 30 min
const GROUP_TZ             = 'America/Sao_Paulo';
const MAX_MESSAGES_PER_GROUP = 400; // teto de custo/contexto por grupo/dia

function groupDigestDateLabel(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: GROUP_TZ }); // 'YYYY-MM-DD'
}

function groupDigestLocalHour(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: GROUP_TZ, hour: '2-digit', hour12: false }), 10);
}

// Heartbeat genérico (tabela CronHeartbeat) — lido pelo health-monitor.ts do
// lado da API pra alertar se um desses pollers parar de rodar. api e worker
// são processos/imagens Docker separados; o banco é o único jeito de um saber
// do outro sem acoplar os dois. Nunca lança — heartbeat não pode derrubar o
// próprio cron que ele está monitorando.
async function recordHeartbeat(jobName: string, ok: boolean, errorMessage?: string): Promise<void> {
  // try/catch (não só .catch na promise) — proteção contra o método nem
  // existir ainda no client (mock de teste, ou client desatualizado num
  // ambiente que ainda não rodou a migration), o que lançaria de forma
  // síncrona antes de qualquer .catch conseguir prender o erro.
  try {
    await prisma.cronHeartbeat.upsert({
      where: { jobName },
      update: ok
        ? { lastOkAt: new Date() }
        : { lastErrorAt: new Date(), lastErrorMessage: errorMessage?.slice(0, 500) ?? null },
      create: {
        jobName,
        lastOkAt: ok ? new Date() : null,
        lastErrorAt: ok ? null : new Date(),
        lastErrorMessage: ok ? null : (errorMessage?.slice(0, 500) ?? null),
      },
    });
  } catch {
    /* heartbeat nunca pode derrubar o cron que ele está monitorando */
  }
}

async function runCopilotoGroupDigests() {
  const nowHour = groupDigestLocalHour();
  const date = groupDigestDateLabel();

  try {
    const numbersWithGroups = await prisma.copilotoGroup.groupBy({
      by:    ['numberId'],
      where: { active: true },
    });

    for (const { numberId } of numbersWithGroups) {
      const config = await prisma.copilotoConfig.findUnique({
        where: { numberId },
        select: { groupDigestHour: true, groupDigestFrequency: true },
      });
      const digestHour = config?.groupDigestHour ?? GROUP_DIGEST_HOUR_DEFAULT;
      const frequency = config?.groupDigestFrequency === 'weekly' ? 'weekly' : 'daily';

      // Semanal: só dispara na segunda-feira, e olha pra semana inteira (não só
      // o dia) — pra grupo mais devagar que não precisa de resumo todo dia.
      const isMonday = new Date().toLocaleDateString('en-US', { timeZone: GROUP_TZ, weekday: 'short' }) === 'Mon';
      if (frequency === 'weekly' && !isMonday) continue;

      const periodStart = frequency === 'weekly'
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: GROUP_TZ })
        : date;

      const already = await prisma.copilotoGroupDigest.findFirst({
        where: { numberId, date: { gte: periodStart } },
      });
      if (already) {
        logger.info(`[Copiloto] Digest de grupo: número ${numberId} já processado neste período (${frequency})`);
        continue;
      }

      if (frequency === 'daily' && nowHour < digestHour) continue; // esse número ainda não chegou no horário configurado — tenta de novo no próximo poll (log seria ruído: acontece em toda rodada antes do horário)

      const number = await prisma.whatsappNumber.findUnique({
        where:  { id: numberId },
        select: { userId: true, zapiInstanceId: true, phoneNumber: true, status: true, user: { select: { name: true } } },
      });
      if (!number || number.status !== 'connected' || !number.zapiInstanceId || !number.phoneNumber) {
        logger.info(`[Copiloto] Digest de grupo: número ${numberId} não conectado — tenta de novo no próximo poll`);
        continue;
      }

      const hasCopilotoModule = await prisma.entitlement.findFirst({
        where: { userId: number.userId, productKey: 'copiloto', status: { in: ['active', 'trialing'] } },
        select: { id: true },
      });
      if (!hasCopilotoModule) {
        logger.info(`[Copiloto] Digest de grupo: número ${numberId} sem módulo Copiloto ativo`);
        continue;
      }

      const groups = await prisma.copilotoGroup.findMany({
        where: { numberId, active: true },
        include: {
          messages: {
            where:   { createdAt: { gte: new Date(`${periodStart}T00:00:00-03:00`) } },
            orderBy: { createdAt: 'asc' },
            take:    MAX_MESSAGES_PER_GROUP,
          },
        },
      });
      if (groups.length === 0) continue; // groupBy já garantiu >=1 grupo ativo; corrida rara com desativação no meio do poll

      const groupsWithActivity = groups.filter((g) => g.messages.length > 0);
      if (groupsWithActivity.length === 0) {
        // Marca o período como processado mesmo sem envio — silêncio total não
        // gera mensagem nenhuma, mas evita reprocessar o mesmo número à toa.
        await prisma.copilotoGroupDigest.create({
          data: { userId: number.userId, numberId, date, groupsIncluded: 0, summaryMd: '' },
        }).catch(() => null);
        logger.info(`[Copiloto] Digest de grupo: número ${numberId} sem mensagem no período em nenhum dos ${groups.length} grupo(s) ativo(s)`);
        continue;
      }

      let blocos: GroupDigestBlock[];
      try {
        const result = await buildGroupDigest({
          userId: number.userId,
          ownerName: number.user?.name ?? null,
          groups: groupsWithActivity.map((g) => ({
            name:     g.name,
            messages: g.messages.map((m) => `${m.senderName || m.senderJid}: ${m.content}`),
          })),
        });
        blocos = result.blocos;
      } catch (err: any) {
        logger.error(`[Copiloto] ❌ Agente (digest de grupo) falhou — número ${numberId}: ${err.message}`);
        await prisma.systemError.create({
          data: { service: 'copiloto-ai', message: `buildGroupDigest falhou: ${err.message}`, context: { numberId, feature: 'copiloto_grupo_digest' } },
        }).catch(() => null);
        continue; // tenta de novo no próximo poll do mesmo dia
      }

      // Uma linha por grupo que teve conversa — não só os que a IA marcou como
      // "decidido"/"pendente". Antes, um dia só com papo sem decisão nenhuma
      // (comum logo que o grupo é ativado) marcava o dia como processado com
      // summaryMd vazio: nenhuma mensagem saía e nunca mais tentava de novo
      // naquele dia, mesmo que o grupo bombasse horas depois. Casa a resposta
      // da IA pelo nome do grupo; se ela não devolveu bloco pra algum, ainda
      // assim mostra que teve conversa (ver ESCOPO_COPILOTO.md §4.2).
      const blocoByName = new Map<string, GroupDigestBlock>(blocos.map((b) => [b.grupo, b]));
      // blocksJson estruturado — alimenta a tendência de grupo no site (contagem
      // de mensagens e streak de "sem novidade") sem precisar parsear o markdown.
      const blocksJson = groupsWithActivity.map((g) => {
        const b = blocoByName.get(g.name);
        return {
          grupo: g.name,
          decidido: b?.decidido ?? null,
          pendente: b?.pendente ?? null,
          ruido: b?.ruido ?? 0,
          messageCount: g.messages.length,
        };
      });
      const summaryMd = blocksJson.map((b) => {
        const lines = [`👥 *${b.grupo}*`];
        if (b.decidido) lines.push(`• Decidido: ${b.decidido}`);
        if (b.pendente) lines.push(`• Pendente com você: ${b.pendente} ❗`);
        if (!b.decidido && !b.pendente) {
          lines.push(`• Nada exige você hoje (${b.messageCount} msg${b.messageCount === 1 ? '' : 's'})`);
        } else if (b.ruido > 0) {
          lines.push(`• Ruído: ${b.ruido} msgs`);
        }
        return lines.join('\n');
      }).join('\n\n');
      const msg = [
        frequency === 'weekly' ? '📋 *Resumo dos grupos — esta semana*' : '📋 *Resumo dos grupos — hoje*',
        '',
        summaryMd,
      ].join('\n');

      await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, msg).catch((err: any) =>
        logger.error(`[Copiloto] ❌ Falha ao entregar digest de grupo (número ${numberId}): ${err.message}`));

      await prisma.copilotoGroupDigest.create({
        data: { userId: number.userId, numberId, date, groupsIncluded: groupsWithActivity.length, summaryMd, blocksJson },
      }).catch(() => null);

      logger.info(`[Copiloto] ✅ Digest de grupo enviado — número ${numberId} (${groupsWithActivity.length}/${groups.length} grupos com atividade)`);
    }
    await recordHeartbeat('copiloto_group_digest', true);
  } catch (err: any) {
    logger.error(`[Copiloto] Erro no digest diário de grupo: ${err.message}`);
    await recordHeartbeat('copiloto_group_digest', false, err.message);
  }
}

runCopilotoGroupDigests();
// unref(): timer de poll não pode ser motivo pra o processo não encerrar num
// shutdown normal (SIGTERM do orquestrador/deploy) nem travar um `jest
// --runInBand` que importa este módulo em teste.
setInterval(runCopilotoGroupDigests, GROUP_DIGEST_POLL_MS).unref();

// v3.0 — removidos runCopilotoPendingSweep (recuperação de entrega presa no
// self-chat, sem sentido no modelo sob demanda: o painel sempre reflete o
// estado atual de "não lida" a cada refresh) e runCopilotoTechniqueRecap
// (recap semanal era push de self-chat; os mesmos números já aparecem em
// GET /copiloto/metrics, sob demanda, no painel). Ver ESCOPO_COPILOTO.md §15.

export { copilotoWorker, runCopilotoGroupDigests };
