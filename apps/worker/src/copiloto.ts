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
      businessContext: config.businessContext,
      aggressiveness: config.aggressiveness,
      knowledgeBase: kb,
      history,
      pastFeedback,
    });
  } catch (err: any) {
    // Antes disso, uma falha aqui (todos os provedores de IA fora) derrubava o
    // job inteiro em silêncio — a triagem já tinha decidido que valia a pena
    // interromper o dono, o custo já foi "gasto", e ele nunca ficava sabendo
    // que nada chegou. Agora: avisa no self-chat (o job ainda falha e o BullMQ
    // reprocessa — se der certo na próxima, o dono recebe o briefing normal
    // depois desse aviso) e registra pra alertar o admin (health-monitor.ts).
    logger.error(`[Copiloto] ❌ buildBriefing falhou (todos os provedores) — ${contactLabel}: ${err.message}`);
    await prisma.systemError.create({
      data: { service: 'copiloto-ai', message: `buildBriefing falhou: ${err.message}`, context: { numberId, feature: 'copiloto_brief' } },
    }).catch(() => null);
    await sendMessageViaEvolution(
      number.zapiInstanceId,
      number.phoneNumber,
      `⚠️ Não consegui montar o briefing de *${contactLabel}* agora — os provedores de IA falharam. Vou tentar de novo em breve.`,
    ).catch(() => null);
    throw err; // deixa o BullMQ reprocessar — não marca como briefado
  }

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
  const offered: Array<{ rank: number; axis: string; title: string; draft: string; rationale: string; technique: string }> = [];
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
      offered.push({ rank, axis: opt.axis, title: opt.title, draft: opt.draft, rationale: opt.rationale, technique: opt.technique });
    } else {
      logger.warn(`[Copiloto] 🚫 Opção ${rank} bloqueada (${contactLabel}): ${check.violations.join('; ')}`);
    }
  }

  const sensitive = briefing.sensitive || hasVulnerabilitySignal(lastText);
  // Sem rodapé aqui de propósito: o job 'deliver' (compilação de rajadas, ver
  // abaixo) é quem manda de verdade, alguns segundos depois, e anexa o rodapé
  // só no envio final — combinando com outro contato do mesmo número que
  // tenha ficado pronto na mesma janela, se for o caso.
  const body = renderBriefingMessage({
    contactLabel,
    lastQuote: lastText,
    briefing,
    offered,
    sensitive,
    footer: false,
  });

  await prisma.copilotoBriefing.update({
    where: { id: created.id },
    data: { selfChatBody: body },
  }).catch(() => null);

  const deliverBucket = Math.floor(Date.now() / DELIVER_WINDOW_MS);
  await copilotoQueue.add(
    'deliver',
    { numberId },
    {
      jobId: `copiloto-deliver-${numberId}-${deliverBucket}`,
      delay: DELIVER_WINDOW_MS,
      // Este Queue (instanciado aqui no worker) não herda o defaultJobOptions
      // do Queue('copiloto') do lado da API (services/queue.ts) — sem isso,
      // BullMQ usaria attempts:1 (sem retry) pra um job cujo êxito é a única
      // forma do dono saber que a conversa mereceu atenção.
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    },
  ).catch((err: any) => logger.error(`[Copiloto] ❌ Falha ao enfileirar entrega — ${contactLabel}: ${err.message}`));

  await markBriefed();
  logger.info(`[Copiloto] ✅ Briefing pronto — ${contactLabel} (${offered.length} opção(ões)) — entrega em até ${DELIVER_WINDOW_MS / 1000}s`);
  return { briefingId: created.id, offered: offered.length };
}

// ── deliver — compila rajadas de contatos diferentes num só envio ──────────
// Cada processBrief() concluído agenda este job com delay fixo e jobId
// bucketado por número+janela de tempo — dois briefings do MESMO número
// prontos dentro da mesma janela colapsam no MESMO job 'deliver' (igual ao
// padrão de debounce do 'brief'), e um só self-chat sai com os dois.
const DELIVER_WINDOW_MS = parseInt(process.env.COPILOTO_DELIVER_WINDOW_MS || '8000'); // 8s

async function processDeliver(job: Job<{ numberId: string }>) {
  const { numberId } = job.data;

  const pending = await prisma.copilotoBriefing.findMany({
    where: { numberId, deliveredAt: null, selfChatBody: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  if (pending.length === 0) return { skipped: true, reason: 'nada_pendente' }; // outro job 'deliver' do mesmo bucket já entregou

  const number = await prisma.whatsappNumber.findUnique({
    where: { id: numberId },
    select: { zapiInstanceId: true, phoneNumber: true, status: true },
  });
  if (!number?.zapiInstanceId || !number.phoneNumber || number.status !== 'connected') {
    // Número caiu entre o briefing ficar pronto e a entrega — bem raro (janela
    // de segundos). O sweep de pendências pega isso na próxima rodada horária.
    logger.info(`[Copiloto] Entrega adiada — número ${numberId} desconectado (${pending.length} briefing(s) no buffer)`);
    return { skipped: true, reason: 'numero_desconectado' };
  }

  const last = pending[pending.length - 1];
  const lastSuggestions = await prisma.copilotoSuggestion.findMany({
    where: { briefingId: last.id, status: 'offered' },
    orderBy: { rank: 'asc' },
    select: { rank: true },
  });
  const footer = lastSuggestions.length > 0 ? renderReplyFooter(lastSuggestions.map((s) => s.rank)) : null;

  const text = pending.length === 1
    ? [pending[0].selfChatBody, footer].filter(Boolean).join('\n\n')
    : [
        `📥 *${pending.length} conversas novas*`,
        pending.map((p) => p.selfChatBody as string).join('\n\n───\n\n'),
        '_Só a mais recente (a última acima) responde a 1/2/3 por enquanto._',
        footer,
      ].filter(Boolean).join('\n\n');

  await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, text).catch((err: any) => {
    logger.error(`[Copiloto] ❌ Falha ao entregar ${pending.length} briefing(s) — número ${numberId}: ${err.message}`);
    throw err; // sem marcar deliveredAt — BullMQ reprocessa e tenta nesse mesmo lote de novo
  });

  await prisma.copilotoBriefing.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { deliveredAt: new Date() },
  });

  logger.info(`[Copiloto] ✅ Entregue — número ${numberId} (${pending.length} conversa(s) compilada(s))`);
  return { delivered: pending.length };
}

// ── Formatação da mensagem no WhatsApp ───────────────────────────────────────

// Rótulo fixo por eixo — sempre os mesmos 3, em vez do título livre que a IA
// gerava por briefing ("Fechar com data", "Descobrir a real"...). O dono passa
// a reconhecer a estrutura de cara em qualquer conversa: opção 1 é sempre
// "empurrar", 2 é sempre "perguntar", 3 é sempre "segurar posição". O título
// livre continua gravado (CopilotoSuggestion.title) e visível no site.
const AXIS_LABEL: Record<string, string> = {
  avancar: 'Avançar', qualificar: 'Qualificar', posicionar: 'Posicionar',
};

/** Corta a citação verbatim do cliente pra não inflar a mensagem com um textão. */
function truncateQuote(text: string, max = 140): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Rodapé de resposta — extraído pra ser reaproveitado pelo job 'deliver' (rajadas compiladas). */
export function renderReplyFooter(nums: number[]): string {
  return `*${nums.join('*, *')}* envia · *${nums[0]}e* edita · *0* ignora`;
}

// Estrutura fixa e mínima: nome · citação do cliente · resumo+intenção · 3
// opções (eixo + rascunho) · rodapé de resposta. Temperatura/risco/trava
// continuam gravados no banco e visíveis em /dashboard/copiloto — tirados
// daqui pra sobrar só o que muda a decisão do dono na hora. A "observação"
// (4ª opção implícita: não agir agora) entra na própria linha de resumo em vez
// de linha própria — mais um corte de compactação. Ver ESCOPO_COPILOTO.md §4.1.
export function renderBriefingMessage(params: {
  contactLabel: string;
  lastQuote?: string | null;
  briefing: { summary: string; intent: string; temperature: string; riskLevel: string; blocker: string | null; note: string | null };
  offered: Array<{ rank: number; axis: string; title: string; draft: string; technique: string }>;
  sensitive: boolean;
  // false = compilação de rajada (ver runCopilotoBriefDelivery): manda sem
  // rodapé, o job 'deliver' anexa um só rodapé no final do lote combinado.
  footer?: boolean;
}): string {
  const { contactLabel, briefing, offered, sensitive, lastQuote } = params;
  const footer = params.footer ?? true;
  const lines: string[] = [];

  lines.push(`🎯 *${contactLabel}*`);

  if (lastQuote?.trim()) lines.push(`_"${truncateQuote(lastQuote)}"_`);

  const summaryLine = [
    sensitive ? '🕊️' : null,
    [briefing.summary, briefing.intent ? `(quer: ${briefing.intent})` : null].filter(Boolean).join(' '),
    briefing.note ? `— ${briefing.note}` : null,
  ].filter(Boolean).join(' ');
  if (summaryLine) lines.push(summaryLine);

  if (offered.length === 0) {
    lines.push('');
    lines.push('Não gerei sugestão segura desta vez (faltou info confiável do seu negócio). Responda você mesmo.');
    return lines.join('\n');
  }

  lines.push('');
  for (const o of offered) {
    const axisLabel = AXIS_LABEL[o.axis] ?? o.title;
    lines.push(`*${o.rank} · ${axisLabel}* "${o.draft}"`);
  }

  if (footer) {
    lines.push('');
    lines.push(renderReplyFooter(offered.map((o) => o.rank)));
  }

  return lines.join('\n');
}

// ── Worker ───────────────────────────────────────────────────────────────────

async function processCopilotoJob(job: Job<any>) {
  if (job.name === 'ingest')  return processIngest(job as Job<IngestJobData>);
  if (job.name === 'brief')   return processBrief(job as Job<BriefJobData>);
  if (job.name === 'deliver') return processDeliver(job as Job<{ numberId: string }>);
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

    // Briefing pronto mas nunca entregue (deliveredAt continua null) — o caso
    // raro em que o job 'deliver' falha e ninguém mais reenfileira pra aquele
    // número (markBriefed() já rodou, então o bloco acima não pega). 2 min de
    // fôlego antes de considerar "preso" — dá tempo do retry normal do próprio
    // job 'deliver' (attempts:3) resolver sozinho primeiro.
    const stuckSince = new Date(Date.now() - 2 * 60 * 1000);
    const stuck = await prisma.copilotoBriefing.findMany({
      where: { deliveredAt: null, selfChatBody: { not: null }, createdAt: { lt: stuckSince } },
      select: { numberId: true },
      distinct: ['numberId'],
    });
    let redelivered = 0;
    for (const { numberId } of stuck) {
      await copilotoQueue.add(
        'deliver',
        { numberId },
        { jobId: `copiloto-deliver-sweep-${numberId}-${hourKey}`, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
      ).catch(() => null);
      redelivered++;
    }
    if (redelivered > 0) {
      logger.info(`[Copiloto] Sweep de pendências: ${redelivered} número(s) com entrega presa, reenfileirado(s)`);
    }
    await recordHeartbeat('copiloto_pending_sweep', true);
  } catch (err: any) {
    logger.error(`[Copiloto] Erro no sweep de pendências: ${err.message}`);
    await recordHeartbeat('copiloto_pending_sweep', false, err.message);
  }
}

runCopilotoPendingSweep();
setInterval(runCopilotoPendingSweep, PENDING_SWEEP_POLL_MS);

// ─────────────────────────────────────────────────────────────────────────
// Recap semanal de técnica (Função 1) — toda segunda-feira, quantas sugestões
// de cada técnica foram enviadas e que fração o cliente respondeu depois.
// O dado (CopilotoSuggestion.technique/outcome) já era gravado; só nunca
// virava nada de volta pro dono — a promessa de "em 30 dias você aprende a
// técnica" (ESCOPO_COPILOTO.md §2.3) ficava incompleta sem esse feedback.
// ─────────────────────────────────────────────────────────────────────────

const TECHNIQUE_RECAP_POLL_MS = 60 * 60 * 1000; // checa a cada hora; só age de fato às segundas
const RECAP_TZ = 'America/Sao_Paulo';
const RECAP_MIN_SENT = 5; // amostra mínima — abaixo disso, % de resposta é ruído, não sinal

const TECHNIQUE_LABEL: Record<string, string> = {
  'fechamento-assumido': 'Fechar a venda',
  'qualificacao':        'Perguntar antes de propor',
  'loop-objecao':        'Contornar objeção',
  'ancoragem':           'Ancorar valor',
  'prova-social':        'Prova social',
  'saida-digna':         'Dar saída sem perder a venda',
  'reciprocidade':       'Reciprocidade',
  'escuta-ativa':        'Confirmar antes de responder',
  'proximo-passo':       'Propor próximo passo',
};

function isRecapDay(): boolean {
  return new Date().toLocaleDateString('en-US', { timeZone: RECAP_TZ, weekday: 'short' }) === 'Mon';
}

async function runCopilotoTechniqueRecap() {
  if (!isRecapDay()) return; // log seria ruído: essa função "acerta" 1 dia por semana, os outros 6 é esperado não fazer nada
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const configs = await prisma.copilotoConfig.findMany({
      where: { enabled: true },
      select: { numberId: true, aggressiveness: true, lastTechniqueRecapAt: true },
    });

    let sent = 0;
    for (const config of configs) {
      if (config.lastTechniqueRecapAt && config.lastTechniqueRecapAt >= weekAgo) continue; // já mandou nos últimos 7 dias

      const number = await prisma.whatsappNumber.findUnique({
        where: { id: config.numberId },
        select: { zapiInstanceId: true, phoneNumber: true, status: true },
      });
      if (!number?.zapiInstanceId || !number.phoneNumber || number.status !== 'connected') continue;

      const suggestions = await prisma.copilotoSuggestion.findMany({
        where: { status: { in: ['sent', 'edited'] }, sentAt: { gte: weekAgo }, briefing: { numberId: config.numberId } },
        select: { technique: true, outcome: true },
      });
      if (suggestions.length === 0) continue; // nada enviado essa semana — não há o que recapitular

      const byTechnique = new Map<string, { sent: number; replied: number }>();
      for (const s of suggestions) {
        const cur = byTechnique.get(s.technique) ?? { sent: 0, replied: 0 };
        cur.sent += 1;
        if (s.outcome === 'replied') cur.replied += 1;
        byTechnique.set(s.technique, cur);
      }

      const rows = [...byTechnique.entries()]
        .map(([technique, v]) => ({
          technique, sent: v.sent, replied: v.replied,
          rate: v.sent > 0 ? Math.round((v.replied / v.sent) * 100) : 0,
        }))
        .sort((a, b) => b.rate - a.rate);

      const lines = ['📊 *Seu recap da semana*', ''];
      for (const r of rows) {
        lines.push(`• ${TECHNIQUE_LABEL[r.technique] ?? r.technique}: ${r.sent} enviada${r.sent === 1 ? '' : 's'}, ${r.rate}% respondeu`);
      }

      // #11 — nunca troca sozinho (o dono decide tudo que muda o tom do negócio
      // dele), só sugere quando a amostra é grande o bastante pra significar
      // algo e a taxa geral está baixa.
      const totalSent = suggestions.length;
      const totalReplied = suggestions.filter((s) => s.outcome === 'replied').length;
      const overallRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;
      if (totalSent >= RECAP_MIN_SENT && overallRate < 20) {
        const gentler = config.aggressiveness === 'direto' ? 'equilibrado' : config.aggressiveness === 'equilibrado' ? 'consultivo' : null;
        if (gentler) {
          lines.push('', `💡 Só ${overallRate}% respondeu essa semana. Quer tentar o tom *${gentler}*? Manda *copiloto agressividade ${gentler}*.`);
        }
      }

      await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, lines.join('\n')).catch((err: any) =>
        logger.error(`[Copiloto] ❌ Falha ao entregar recap semanal (número ${config.numberId}): ${err.message}`));

      await prisma.copilotoConfig.update({ where: { numberId: config.numberId }, data: { lastTechniqueRecapAt: new Date() } }).catch(() => null);
      sent++;
    }
    if (sent > 0) logger.info(`[Copiloto] Recap semanal de técnica enviado para ${sent} número(s)`);
    await recordHeartbeat('copiloto_technique_recap', true);
  } catch (err: any) {
    logger.error(`[Copiloto] Erro no recap semanal de técnica: ${err.message}`);
    await recordHeartbeat('copiloto_technique_recap', false, err.message);
  }
}

runCopilotoTechniqueRecap();
setInterval(runCopilotoTechniqueRecap, TECHNIQUE_RECAP_POLL_MS);

export { copilotoWorker, runCopilotoGroupDigests, runCopilotoPendingSweep, runCopilotoTechniqueRecap };
