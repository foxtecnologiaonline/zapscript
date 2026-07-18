import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';
import { runAtendeAgent } from './services/atende-agent';

/**
 * Worker do ZapScript Atende — consome a fila 'atende-replies' (produzida por
 * apps/api/src/routes/evolution-webhook.ts) e responde o cliente final via IA.
 * Registrado como side-effect: importado por src/index.ts (único entrypoint do worker).
 */

interface AtendeJobData {
  userId: string;
  numberId: string;
  instanceName: string;
  senderPhone: string;
  senderName: string;
  messageText: string;
  messageId: string;
}

async function processAtendeJob(job: Job<AtendeJobData>) {
  const { userId, numberId, instanceName, senderPhone, senderName, messageText } = job.data;

  logger.info(`[Atende] 📥 ${senderName} (${senderPhone}): "${messageText.slice(0, 60)}"`);

  const conversation = await prisma.atendeConversation.upsert({
    where: { numberId_contactPhone: { numberId, contactPhone: senderPhone } },
    update: { contactName: senderName, lastMessageAt: new Date() },
    create: { userId, numberId, contactPhone: senderPhone, contactName: senderName, status: 'open' },
  });

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
      config: { businessContext: config.businessContext, tone: config.tone },
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

export { atendeWorker };
