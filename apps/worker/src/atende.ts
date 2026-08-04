import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution, downloadAudioFromEvolution } from './services/evolution';
import { convertToMp3, estimateMp3DurationSec } from './services/audio';
import { transcribeAudio } from './services/whisper';
import { MAX_AUDIO_SECONDS, MAX_AUDIO_MARGIN_SECONDS } from './lib/freemium';
import { runAtendeAgent } from './services/atende-agent';

/**
 * Worker do ZapScript Atende — consome a fila 'atende-replies' (produzida por
 * apps/api/src/routes/evolution-webhook.ts) e responde o cliente final via IA.
 * Registrado como side-effect: importado por src/index.ts (único entrypoint do worker).
 */

const CRM_DEFAULT_STAGES = [
  { name: 'Novo lead',     order: 0, color: '#3b82f6' },
  { name: 'Contato feito', order: 1, color: '#eab308' },
  { name: 'Negociando',    order: 2, color: '#f97316' },
  { name: 'Fechado',       order: 3, color: '#22c55e', isWon: true },
  { name: 'Perdido',       order: 4, color: '#ef4444', isLost: true },
];

/**
 * CRM #1 — captura automática de lead: o 1º contato de um cliente novo no
 * Atende já entra no funil do CRM (estágio inicial), sem o dono precisar
 * importar manualmente. Só roda se o dono também tiver o módulo CRM ativo;
 * silenciosamente não faz nada pra quem só tem Atende.
 */
async function createCrmLeadFromAtende(ownerId: string, numberId: string, contactPhone: string, contactName: string) {
  const hasCrm = await prisma.entitlement.findFirst({
    where: { userId: ownerId, productKey: 'crm', status: { in: ['active', 'trialing'] } },
    select: { id: true },
  });
  if (!hasCrm) return;

  let firstStage = await prisma.crmStage.findFirst({ where: { userId: ownerId }, orderBy: { order: 'asc' } });
  if (!firstStage) {
    await prisma.crmStage.createMany({ data: CRM_DEFAULT_STAGES.map((s) => ({ userId: ownerId, ...s })) });
    firstStage = await prisma.crmStage.findFirst({ where: { userId: ownerId }, orderBy: { order: 'asc' } });
  }
  if (!firstStage) return; // não deveria acontecer, mas createMany falho não pode travar o atendimento

  try {
    const contact = await prisma.crmContact.create({
      data: {
        userId: ownerId,
        stageId: firstStage.id,
        name: contactName || contactPhone,
        phone: contactPhone,
        numberId,
        source: 'atende_auto',
      },
    });
    await prisma.crmActivity.create({
      data: { contactId: contact.id, userId: ownerId, type: 'note', content: 'Lead criado automaticamente pela 1ª conversa no Atende.' },
    });
    logger.info(`[Atende→CRM] Lead automático criado (contato=${contact.id})`);
  } catch (err: any) {
    if (err?.code === 'P2002') return; // já existe contato com esse telefone — nada a fazer
    throw err;
  }
}

interface AtendeJobData {
  userId: string;
  numberId: string;
  instanceName: string;
  senderPhone: string;
  senderName: string;
  messageText?: string;
  audio?: { messageData: any; durationHint?: number };
  messageId: string;
}

async function processAtendeJob(job: Job<AtendeJobData>) {
  const { userId, numberId, instanceName, senderPhone, senderName, audio } = job.data;
  let messageText = job.data.messageText;

  // Áudio do cliente (Feature 10): transcreve sob demanda, reaproveitando o
  // mesmo pipeline Whisper do core — mas SEM a cota free/pro de transcrição
  // (produto separado; Atende não pode ficar mudo pra quem não assina Pro).
  // Roda ANTES de qualquer escrita no banco: falha aqui é seguro reprocessar
  // do zero (BullMQ retry), diferente de falhas depois do AtendeMessage 'in'.
  if (!messageText && audio) {
    let mp3Buffer: Buffer | null = null;
    try {
      const audioBuffer = await downloadAudioFromEvolution(instanceName, audio.messageData);
      mp3Buffer = await convertToMp3(audioBuffer);
      const estDurSec = Math.max(estimateMp3DurationSec(mp3Buffer), audio.durationHint || 0);
      if (estDurSec > MAX_AUDIO_SECONDS + MAX_AUDIO_MARGIN_SECONDS) {
        logger.warn(`[Atende] 🔊 Áudio de ${senderName} longo demais (~${estDurSec}s) — ignorado`);
        return { skipped: true, reason: 'audio_too_long' };
      }
      const transcribed = await transcribeAudio(mp3Buffer, { vocab: [senderName] });
      messageText = transcribed.text;
    } catch (err: any) {
      logger.error(`[Atende] ❌ Falha ao transcrever áudio de ${senderName}: ${err.message}`);
      throw err;
    } finally {
      mp3Buffer?.fill(0);
    }
  }

  if (!messageText) {
    logger.warn(`[Atende] Job sem texto nem áudio válido (${senderName}) — ignorado`);
    return { skipped: true, reason: 'empty_message' };
  }

  logger.info(`[Atende] 📥 ${senderName} (${senderPhone}): "${messageText.slice(0, 60)}"`);

  const existingConversation = await prisma.atendeConversation.findUnique({
    where: { numberId_contactPhone: { numberId, contactPhone: senderPhone } },
    select: { id: true },
  });

  const conversation = await prisma.atendeConversation.upsert({
    where: { numberId_contactPhone: { numberId, contactPhone: senderPhone } },
    update: { contactName: senderName, lastMessageAt: new Date() },
    create: { userId, numberId, contactPhone: senderPhone, contactName: senderName, status: 'open' },
  });

  // CRM #1: 1º contato de um cliente novo vira lead automaticamente pra quem
  // também tem o módulo CRM — zero-click, em vez de depender de import manual.
  // Roda best-effort (não pode derrubar o atendimento por causa disso) e só na
  // criação real da conversa (existingConversation nulo), nunca a cada mensagem.
  if (!existingConversation) {
    createCrmLeadFromAtende(userId, numberId, senderPhone, senderName).catch((err: any) =>
      logger.warn(`[Atende→CRM] Falha ao criar lead automático: ${err.message}`));
  }

  await prisma.atendeMessage.create({
    data: { conversationId: conversation.id, direction: 'in', content: messageText },
  });

  // Só humanTakeover (ação explícita do dono) bloqueia resposta automática.
  // 'escalated' é só informativo pro inbox — sem isso, uma única resposta de baixa
  // confiança travaria o bot pra sempre nesse contato, sem nenhuma rota para destravar.
  if (conversation.humanTakeover) {
    logger.info(`[Atende] ⏸️ Conversa ${conversation.id} sob controle humano — sem resposta automática`);
    return { skipped: true, reason: 'human_takeover' };
  }

  const config = await prisma.atendeConfig.findUnique({ where: { numberId } });
  if (!config?.enabled) {
    logger.warn(`[Atende] Config desabilitada durante processamento (numberId=${numberId})`);
    return { skipped: true, reason: 'disabled' };
  }

  const history = await prisma.atendeMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { direction: true, content: true },
  });
  const historyText = history.length > 1
    ? history.reverse().slice(0, -1).map(m => `${m.direction === 'in' ? 'Cliente' : 'Atendente'}: ${m.content}`).join('\n')
    : null;

  let reply: string;
  let confidence = 0;
  let needsHuman = false;

  try {
    const result = await runAtendeAgent({
      userId,
      config: { businessContext: config.businessContext, tone: config.tone, confidenceLevel: config.confidenceLevel },
      message: messageText,
      contactName: senderName,
      history: historyText,
    });
    reply = result.reply;
    confidence = result.confidence;
    needsHuman = result.needsHuman;
  } catch (err: any) {
    logger.error(`[Atende] ❌ Agente falhou: ${err.message}`);
    reply = '';
    needsHuman = true;
  }

  const finalMessage = (!needsHuman && reply) ? reply : config.fallbackMessage;

  // Envio não pode ser fatal: um throw aqui reprovaria o job inteiro e o BullMQ
  // reprocessaria do zero, duplicando o AtendeMessage 'in' já gravado acima (não é
  // idempotente) e repetindo a chamada paga ao agente. Falha de entrega vira log,
  // não retry — a resposta gerada fica registrada mesmo se o WhatsApp não recebeu.
  let delivered = true;
  try {
    await sendMessageViaEvolution(instanceName, senderPhone, finalMessage);
  } catch (err: any) {
    delivered = false;
    logger.error(`[Atende] ❌ Falha ao enviar via Evolution: ${err.message}`);
  }

  await prisma.atendeMessage.create({
    data: {
      conversationId: conversation.id,
      direction: 'out',
      content: finalMessage,
      aiGenerated: !needsHuman && !!reply,
      confidence,
    },
  });

  await prisma.atendeConversation.update({
    where: { id: conversation.id },
    data: {
      status: needsHuman ? 'escalated' : 'open',
      lastMessageAt: new Date(),
    },
  });

  if (needsHuman && config.escalationPhone) {
    const notice = `🔔 Atende: conversa com ${senderName} (${senderPhone}) precisa de atenção humana.`;
    sendMessageViaEvolution(instanceName, config.escalationPhone, notice).catch(() => null);
  }

  logger.info(`[Atende] ✅ Respondido (confiança=${confidence}${needsHuman ? ', escalado' : ''}${delivered ? '' : ', ENVIO FALHOU'})`);
  return { conversationId: conversation.id, escalated: needsHuman, delivered };
}

const ATENDE_CONCURRENCY = parseInt(process.env.ATENDE_WORKER_CONCURRENCY || '2');

const atendeWorker = new Worker('atende-replies', processAtendeJob, {
  connection: redis as any,
  concurrency: ATENDE_CONCURRENCY,
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

atendeWorker.on('completed', (job, result) => {
  if (result?.skipped) {
    logger.warn(`[Atende] Job ${job.id} ignorado — motivo: ${result.reason}`);
  } else {
    logger.info(`[Atende] ✅ Job ${job.id} concluído`);
  }
});

atendeWorker.on('failed', (job, err) => {
  logger.error(`[Atende] ❌ Job ${job?.id} falhou: ${err.message}`);
});

atendeWorker.on('error', (err) => {
  logger.error('[Atende] Erro interno do worker', { err: err.message });
});

logger.info('Worker Atende (respostas automáticas) iniciado');

// ─────────────────────────────────────────────────────────────────
//  Feature 9 — Digest periódico ao dono (self-chat), opt-in por número
//  via AtendeConfig.digestFrequency ('daily' | 'weekly'). Idempotência
//  por delta de tempo (lastDigestAt), não por calendário — mesma ideia
//  do runWeeklyWhatsappDigest em index.ts, mas sem exigir alinhamento a
//  um horário fixo (não há tag de período pra casar entre configs com
//  números diferentes rodando em instantes diferentes).
// ─────────────────────────────────────────────────────────────────
const DIGEST_INTERVAL_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

async function runAtendeDigests() {
  const now = new Date();
  const APP_URL = process.env.APP_URL || 'https://zapscript.me';

  try {
    const configs = await prisma.atendeConfig.findMany({
      where: { digestFrequency: { in: ['daily', 'weekly'] } },
      include: { number: { select: { zapiInstanceId: true, phoneNumber: true, status: true } } },
    }).catch(() => [] as any[]);

    for (const cfg of configs) {
      const intervalMs = DIGEST_INTERVAL_MS[cfg.digestFrequency];
      if (!intervalMs) continue;
      if (cfg.lastDigestAt && now.getTime() - cfg.lastDigestAt.getTime() < intervalMs) continue;
      if (cfg.number?.status !== 'connected' || !cfg.number?.zapiInstanceId || !cfg.number?.phoneNumber) continue;

      const since = new Date(now.getTime() - intervalMs);
      const [openCount, escalatedCount, periodCount] = await Promise.all([
        prisma.atendeConversation.count({ where: { numberId: cfg.numberId, status: 'open' } }),
        prisma.atendeConversation.count({ where: { numberId: cfg.numberId, status: 'escalated' } }),
        prisma.atendeConversation.count({ where: { numberId: cfg.numberId, lastMessageAt: { gte: since } } }),
      ]);

      // Sem conversa nenhuma no período: não manda mensagem à toa, só adia a
      // próxima checagem (evita reprocessar o mesmo config a cada hora).
      if (periodCount === 0) {
        await prisma.atendeConfig.update({ where: { id: cfg.id }, data: { lastDigestAt: now } }).catch(() => null);
        continue;
      }

      const label = cfg.digestFrequency === 'daily' ? 'do dia' : 'da semana';
      const msg = [
        `📊 *Atende* — resumo ${label}`,
        '',
        `Conversas com clientes: *${periodCount}*`,
        `Abertas (bot respondendo): ${openCount}`,
        `Escaladas pra você: ${escalatedCount}`,
        '',
        `Painel: ${APP_URL}/app/atende`,
      ].join('\n');

      await sendMessageViaEvolution(cfg.number.zapiInstanceId, cfg.number.phoneNumber, msg).catch(() => null);
      await prisma.atendeConfig.update({ where: { id: cfg.id }, data: { lastDigestAt: now } }).catch(() => null);
      logger.info(`[Atende] 📊 Digest (${cfg.digestFrequency}) enviado — config ${cfg.id}`);
    }
  } catch (err: any) {
    logger.error(`[Atende] Erro no digest periódico: ${err.message}`);
  }
}

runAtendeDigests();
setInterval(runAtendeDigests, 60 * 60 * 1000);

export { atendeWorker };
