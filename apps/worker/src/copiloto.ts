import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';
import { triageConversation, buildBriefing, type CopilotoMessageLike } from './services/copiloto-agent';
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

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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
  if (!config?.enabled) return { skipped: true, reason: 'desligado' };

  // Reconfere a titularidade na hora de gastar: o admin pode ter revogado o
  // acesso entre a mensagem chegar e o briefing rodar.
  if (!(await hasCopiloto(userId))) return { skipped: true, reason: 'sem_modulo' };

  const number = await prisma.whatsappNumber.findUnique({
    where: { id: numberId },
    select: { zapiInstanceId: true, phoneNumber: true, status: true },
  });
  if (!number?.zapiInstanceId || !number.phoneNumber || number.status !== 'connected') {
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
  if (newMessages.length === 0) return { skipped: true, reason: 'nada_novo' };

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
    return { skipped: true, reason: 'horario_silencio' };
  }

  const todayCount = await prisma.copilotoBriefing.count({
    where: { numberId, createdAt: { gte: startOfToday() } },
  });
  if (todayCount >= config.maxBriefsPerDay) {
    return { skipped: true, reason: 'teto_diario' };
  }

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

export { copilotoWorker };
