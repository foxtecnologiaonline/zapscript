import { Worker, Job, Queue } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';
import {
  triageConversation, buildBriefing, buildGroupDigest, type CopilotoMessageLike,
} from './services/copiloto-agent';
import { validateDraft, isOptOut, hasVulnerabilitySignal } from './services/copiloto-guardrails';

/**
 * Worker do ZapScript Copiloto (MVP) — consome a fila 'copiloto', produzida por
 * apps/api/src/routes/evolution-webhook.ts.
 *
 * Dois jobs:
 *   'ingest' — persiste a mensagem (entrada do cliente ou saída do dono). Barato,
 *              sem IA. Mantém o webhook rápido.
 *   'brief'  — atrasado pela janela de debounce; é onde a IA roda. Deduplicado
 *              por jobId com bucket de tempo, então uma rajada vira UM briefing.
 *
 * O que o Copiloto NUNCA faz aqui: mandar mensagem para o cliente. O único
 * destinatário deste worker é o próprio dono (self-chat). O envio ao cliente só
 * acontece quando o dono responde 1/2/3 — e isso vive na API
 * (apps/api/src/services/copiloto-commands.ts).
 *
 * Registrado como side-effect: importado por src/index.ts.
 */

/** Janela de agrupamento: mensagens do mesmo contato dentro dela viram um briefing. */
export const DEBOUNCE_MS = parseInt(process.env.COPILOTO_DEBOUNCE_MS || '180000'); // 3 min

// Produtor local pra reenfileirar 'brief' no sweep de pendências (ver
// runCopilotoPendingSweep, no fim do arquivo) — mesma fila 'copiloto' que a
// API produz normalmente, só que aqui é o próprio worker que se re-agenda.
const copilotoQueue = new Queue('copiloto', { connection: redis as any });

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
async function hasCopiloto(userId: string): Promise<boolean> {
  const ent = await prisma.entitlement.findFirst({
    where: { userId, productKey: 'copiloto', status: { in: ['active', 'trialing'] } },
    select: { id: true },
  }).catch(() => null);
  return !!ent;
}

/** "HH:mm" no fuso do dono. */
function localHhMm(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());
  }
}

/**
 * Horário de silêncio. Suporta janela que cruza a meia-noite (21:00 → 07:00),
 * que é justamente o caso padrão.
 */
export function isQuietNow(start: string, end: string, timezone: string): boolean {
  const now = localHhMm(timezone);
  if (start === end) return false;              // janela vazia = sem silêncio
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;             // cruza a meia-noite
}

// ── ingest ───────────────────────────────────────────────────────────────────

async function processIngest(job: Job<IngestJobData>) {
  const { userId, numberId, contactPhone, contactName, direction, content } = job.data;
  if (!content?.trim()) return { skipped: true, reason: 'empty' };

  const conversation = await prisma.copilotoConversation.upsert({
    where: { numberId_contactPhone: { numberId, contactPhone } },
    update: { lastMessageAt: new Date(), ...(contactName ? { contactName } : {}) },
    create: { userId, numberId, contactPhone, contactName: contactName ?? null },
  });

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
    data: { conversationId: conversation.id, direction, content },
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

async function processBrief(job: Job<BriefJobData>) {
  const { userId, numberId, contactPhone } = job.data;

  const conversation = await prisma.copilotoConversation.findUnique({
    where: { numberId_contactPhone: { numberId, contactPhone } },
  });
  if (!conversation) return { skipped: true, reason: 'sem_conversa' };

  const config = await prisma.copilotoConfig.findUnique({ where: { numberId } });
  if (!config?.enabled) {
    logger.info(`[Copiloto] ⏭️ ${contactPhone}: pulado (Copiloto desligado pro número ${numberId})`);
    return { skipped: true, reason: 'desligado' };
  }

  // Reconfere a titularidade na hora de gastar: o admin pode ter revogado o
  // acesso entre a mensagem chegar e o briefing rodar.
  if (!(await hasCopiloto(userId))) {
    logger.info(`[Copiloto] ⏭️ ${contactPhone}: pulado (usuário ${userId} sem módulo Copiloto)`);
    return { skipped: true, reason: 'sem_modulo' };
  }

  const number = await prisma.whatsappNumber.findUnique({
    where: { id: numberId },
    select: { zapiInstanceId: true, phoneNumber: true, status: true },
  });
  if (!number?.zapiInstanceId || !number.phoneNumber || number.status !== 'connected') {
    logger.info(`[Copiloto] ⏭️ ${contactPhone}: pulado (número ${numberId} não conectado)`);
    return { skipped: true, reason: 'numero_desconectado' };
  }

  // Só o que ainda não virou briefing. Sem isso, cada job reavaliaria a conversa
  // inteira e o dono receberia o mesmo resumo várias vezes.
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
  if (newMessages.length === 0) return { skipped: true, reason: 'nada_novo' }; // não loga — acontece toda hora em rajadas normais, seria ruído

  const markBriefed = () =>
    prisma.copilotoConversation.update({
      where: { id: conversation.id },
      data: { lastBriefedAt: new Date() },
    }).catch(() => null);

  const lastText = newMessages[newMessages.length - 1].content;
  const contactLabel = conversation.contactName || contactPhone;

  // Recusa explícita: o Copiloto não sugere nada comercial depois do "não".
  // Avisa o dono e para — insistir aqui é prática abusiva (CDC art. 39) e queima
  // o número no WhatsApp.
  if (isOptOut(lastText)) {
    await sendMessageViaEvolution(
      number.zapiInstanceId,
      number.phoneNumber,
      `🛑 *${contactLabel}* pediu para não receber mais mensagens.\n\n` +
      `Não vou sugerir abordagem para este contato. Se precisar responder, responda você mesmo — ` +
      `e o ideal é só confirmar que parou.`,
    ).catch(() => null);
    await markBriefed();
    return { optOut: true };
  }

  if (isQuietNow(config.quietStart, config.quietEnd, config.timezone)) {
    // Não marca como briefado: a próxima mensagem depois do silêncio reabre a
    // janela e o dono recebe o acumulado, em vez de perder a conversa.
    logger.info(`[Copiloto] ⏭️ ${contactPhone}: pulado (horário de silêncio do número ${numberId})`);
    return { skipped: true, reason: 'horario_silencio' };
  }

  // Teto diário removido por pedido explícito — maxBriefsPerDay (e o comando
  // "copiloto limite") ficam só como contador informativo em buildStatus(),
  // sem bloquear nada aqui.

  const historyDesc = await prisma.copilotoMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { direction: true, content: true },
  });
  const history: CopilotoMessageLike[] = historyDesc.reverse();

  const triage = await triageConversation({
    userId,
    contactName: conversation.contactName,
    newMessages,
    recentHistory: history.slice(0, Math.max(0, history.length - newMessages.length)),
  });

  if (!triage.shouldBrief) {
    // Marca como avaliado: sem isto, a mesma mensagem "bom dia" seria triada de
    // novo a cada nova mensagem da conversa, pagando triagem repetida.
    await markBriefed();
    logger.info(`[Copiloto] ⏭️ ${contactLabel}: sem briefing (${triage.reason})`);
    return { skipped: true, reason: `triagem: ${triage.reason}` };
  }

  const kb = await prisma.atendeKnowledgeBase.findMany({
    where: { userId, active: true },
    orderBy: { createdAt: 'asc' },
    take: 30,
    select: { question: true, answer: true },
  }).catch(() => [] as Array<{ question: string; answer: string }>);

  const briefing = await buildBriefing({
    userId,
    contactName: conversation.contactName,
    businessContext: config.businessContext,
    aggressiveness: config.aggressiveness,
    knowledgeBase: kb,
    history,
  });

  // Ancoragem dos guardrails: só é "fato do negócio" o que já existe na conversa,
  // no contexto do negócio ou na base de conhecimento. Qualquer preço fora disso
  // é invenção da IA em nome do negócio do dono.
  const allowedText = [
    config.businessContext ?? '',
    kb.map((k) => `${k.question} ${k.answer}`).join('\n'),
    history.map((m) => m.content).join('\n'),
  ].join('\n');

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
      deliveredVia: 'whatsapp',
    },
  });

  // As opções reprovadas ficam gravadas como 'discarded' — auditoria de quantas
  // vezes o modelo tentou inventar preço/urgência é o que diz se o prompt precisa
  // de ajuste. Nunca são oferecidas ao dono.
  let rank = 0;
  const offered: Array<{ rank: number; title: string; draft: string; rationale: string; technique: string }> = [];
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
      offered.push({ rank, title: opt.title, draft: opt.draft, rationale: opt.rationale, technique: opt.technique });
    } else {
      logger.warn(`[Copiloto] 🚫 Opção ${rank} bloqueada (${contactLabel}): ${check.violations.join('; ')}`);
    }
  }

  const sensitive = briefing.sensitive || hasVulnerabilitySignal(lastText);
  const message = renderBriefingMessage({
    contactLabel,
    briefing,
    offered,
    sensitive,
  });

  try {
    await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, message);
  } catch (err: any) {
    // Envio falho não pode reprocessar o job: a IA já foi paga e o briefing já
    // está gravado. Fica registrado e aparece na próxima interação do dono.
    logger.error(`[Copiloto] ❌ Falha ao entregar briefing: ${err.message}`);
  }

  await markBriefed();
  logger.info(`[Copiloto] ✅ Briefing entregue — ${contactLabel} (${offered.length} opção(ões))`);
  return { briefingId: created.id, offered: offered.length };
}

// ── Formatação da mensagem no WhatsApp ───────────────────────────────────────

const TEMP_ICON: Record<string, string> = { quente: '🔥 Quente', morno: '🌤️ Morno', frio: '❄️ Frio' };
const RISK_ICON: Record<string, string> = { baixo: 'baixo', medio: '⚠️ médio', alto: '🚨 alto' };
const BLOCKER_LABEL: Record<string, string> = {
  preco: 'preço', prazo: 'prazo', confianca: 'confiança',
  autoridade: 'quem decide', urgencia: 'falta de urgência',
};

export function renderBriefingMessage(params: {
  contactLabel: string;
  briefing: { summary: string; intent: string; temperature: string; riskLevel: string; blocker: string | null; note: string | null };
  offered: Array<{ rank: number; title: string; draft: string; technique: string }>;
  sensitive: boolean;
}): string {
  const { contactLabel, briefing, offered, sensitive } = params;
  const lines: string[] = [];

  lines.push(`🎯 *${contactLabel}*`);
  lines.push('');
  if (briefing.summary) lines.push(briefing.summary);
  if (briefing.intent) lines.push(`_O que ele quer:_ ${briefing.intent}`);

  const status = [
    TEMP_ICON[briefing.temperature] ?? briefing.temperature,
    `risco ${RISK_ICON[briefing.riskLevel] ?? briefing.riskLevel}`,
    briefing.blocker ? `trava: ${BLOCKER_LABEL[briefing.blocker] ?? briefing.blocker}` : null,
  ].filter(Boolean).join(' · ');
  lines.push(status);

  if (sensitive) {
    lines.push('');
    lines.push('🕊️ _Sinal delicado nessa conversa. Acolha antes de qualquer proposta._');
  }

  if (briefing.note) {
    lines.push('');
    lines.push(`💭 ${briefing.note}`);
  }

  if (offered.length === 0) {
    lines.push('');
    lines.push('Não gerei sugestão segura desta vez (faltou informação confiável do seu negócio para responder sem chutar). Responda você mesmo — e, se for algo que se repete, cadastre na base de conhecimento.');
    return lines.join('\n');
  }

  lines.push('');
  for (const o of offered) {
    lines.push(`*${o.rank} · ${o.title}* ⟨${o.technique}⟩`);
    lines.push(`"${o.draft}"`);
    lines.push('');
  }

  const nums = offered.map((o) => o.rank);
  lines.push('─────');
  lines.push(
    `Responda *${nums.join('*, *')}* pra enviar · ` +
    `*${nums[0]}e* pra editar antes · *0* pra ignorar`,
  );

  return lines.join('\n');
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

async function runCopilotoGroupDigests() {
  const nowHour = groupDigestLocalHour();
  const date = groupDigestDateLabel();

  try {
    const numbersWithGroups = await prisma.copilotoGroup.groupBy({
      by:    ['numberId'],
      where: { active: true },
    });

    for (const { numberId } of numbersWithGroups) {
      const already = await prisma.copilotoGroupDigest.findUnique({ where: { numberId_date: { numberId, date } } });
      if (already) continue;

      const config = await prisma.copilotoConfig.findUnique({ where: { numberId }, select: { groupDigestHour: true } });
      const digestHour = config?.groupDigestHour ?? GROUP_DIGEST_HOUR_DEFAULT;
      if (nowHour < digestHour) continue; // esse número ainda não chegou no horário configurado — tenta de novo no próximo poll

      const number = await prisma.whatsappNumber.findUnique({
        where:  { id: numberId },
        select: { userId: true, zapiInstanceId: true, phoneNumber: true, status: true },
      });
      if (!number || number.status !== 'connected' || !number.zapiInstanceId || !number.phoneNumber) continue;

      const hasCopilotoModule = await prisma.entitlement.findFirst({
        where: { userId: number.userId, productKey: 'copiloto', status: { in: ['active', 'trialing'] } },
        select: { id: true },
      });
      if (!hasCopilotoModule) continue;

      const groups = await prisma.copilotoGroup.findMany({
        where: { numberId, active: true },
        include: {
          messages: {
            where:   { createdAt: { gte: new Date(`${date}T00:00:00-03:00`) } },
            orderBy: { createdAt: 'asc' },
            take:    MAX_MESSAGES_PER_GROUP,
          },
        },
      });
      if (groups.length === 0) continue;

      const totalMessages = groups.reduce((s, g) => s + g.messages.length, 0);
      if (totalMessages === 0) {
        // Marca o dia como processado mesmo sem envio — silêncio total não gera
        // mensagem nenhuma, mas evita reprocessar o mesmo número o dia todo.
        await prisma.copilotoGroupDigest.create({
          data: { userId: number.userId, numberId, date, groupsIncluded: 0, summaryMd: '' },
        }).catch(() => null);
        continue;
      }

      let blocos;
      try {
        const result = await buildGroupDigest({
          userId: number.userId,
          groups: groups.map((g) => ({
            name:     g.name,
            messages: g.messages.map((m) => `${m.senderName || m.senderJid}: ${m.content}`),
          })),
        });
        blocos = result.blocos;
      } catch (err: any) {
        logger.error(`[Copiloto] ❌ Agente (digest de grupo) falhou — número ${numberId}: ${err.message}`);
        continue; // tenta de novo no próximo poll do mesmo dia
      }

      const relevantes = blocos.filter((b) => b.decidido || b.pendente);
      if (relevantes.length === 0) {
        await prisma.copilotoGroupDigest.create({
          data: { userId: number.userId, numberId, date, groupsIncluded: groups.length, summaryMd: '' },
        }).catch(() => null);
        continue;
      }

      const summaryMd = relevantes.map((b) => {
        const lines = [`👥 *${b.grupo}*`];
        if (b.decidido) lines.push(`• Decidido: ${b.decidido}`);
        if (b.pendente) lines.push(`• Pendente com você: ${b.pendente} ❗`);
        if (b.ruido > 0) lines.push(`• Ruído: ${b.ruido} msgs`);
        return lines.join('\n');
      }).join('\n\n');
      const msg = [`📋 *Resumo dos grupos — hoje*`, '', summaryMd].join('\n');

      await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, msg).catch((err: any) =>
        logger.error(`[Copiloto] ❌ Falha ao entregar digest de grupo (número ${numberId}): ${err.message}`));

      await prisma.copilotoGroupDigest.create({
        data: { userId: number.userId, numberId, date, groupsIncluded: relevantes.length, summaryMd },
      }).catch(() => null);

      logger.info(`[Copiloto] ✅ Digest de grupo enviado — número ${numberId} (${relevantes.length}/${groups.length} grupos com destaque)`);
    }
  } catch (err: any) {
    logger.error(`[Copiloto] Erro no digest diário de grupo: ${err.message}`);
  }
}

runCopilotoGroupDigests();
setInterval(runCopilotoGroupDigests, GROUP_DIGEST_POLL_MS);

// ─────────────────────────────────────────────────────────────────────────
// Sweep de pendências — conversas com mensagem ainda não briefada (nem por
// briefing de verdade, nem por triagem: as duas marcam lastBriefedAt). Uma
// conversa fica "presa" nesse estado quando processBrief() pula por um
// motivo temporário sem marcar lastBriefedAt — número desconectado na hora,
// horário de silêncio, módulo revogado e depois liberado de novo, etc. (ver
// processBrief acima). Esse sweep é o que garante que essas conversas não
// ficam esquecidas pra sempre: tenta de novo a cada hora até conseguir.
// Cobre também o backfill de mensagens não lidas
// (apps/api/src/services/copiloto-backfill.ts).
// ─────────────────────────────────────────────────────────────────────────

const PENDING_SWEEP_POLL_MS = 60 * 60 * 1000; // a cada hora
const PENDING_SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // não ressuscita conversa parada há mais de 7 dias

async function runCopilotoPendingSweep() {
  try {
    const candidates = await prisma.copilotoConversation.findMany({
      where: { lastMessageAt: { gte: new Date(Date.now() - PENDING_SWEEP_LOOKBACK_MS) } },
      select: { userId: true, numberId: true, contactPhone: true, lastMessageAt: true, lastBriefedAt: true },
    });
    const pending = candidates.filter((c) => !c.lastBriefedAt || c.lastBriefedAt < c.lastMessageAt);
    if (pending.length === 0) return;

    const hourKey = new Date().toISOString().slice(0, 13); // 1 tentativa de reenfileirar por conversa por rodada do sweep
    let enqueued = 0;
    for (const c of pending) {
      const config = await prisma.copilotoConfig.findUnique({ where: { numberId: c.numberId }, select: { enabled: true } });
      if (!config?.enabled) continue;
      await copilotoQueue.add(
        'brief',
        { userId: c.userId, numberId: c.numberId, contactPhone: c.contactPhone },
        { jobId: `copiloto-brief-sweep-${c.numberId}-${c.contactPhone}-${hourKey}` },
      ).catch(() => null);
      enqueued++;
    }
    if (enqueued > 0) {
      logger.info(`[Copiloto] Sweep de pendências: ${enqueued}/${pending.length} conversa(s) reenfileirada(s)`);
    }
  } catch (err: any) {
    logger.error(`[Copiloto] Erro no sweep de pendências: ${err.message}`);
  }
}

runCopilotoPendingSweep();
setInterval(runCopilotoPendingSweep, PENDING_SWEEP_POLL_MS);

export { copilotoWorker, runCopilotoGroupDigests, runCopilotoPendingSweep };
