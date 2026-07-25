import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';
import { classifyVoiceCommand } from './services/voice-command-agent';
import { executeVoiceCommand } from './services/voice-command-executor';

/**
 * Worker do Comando de Voz Universal — consome a fila 'voice-commands', produzida
 * (fire-and-forget) por processEvolutionJob em src/index.ts sempre que um áudio
 * self-note termina de transcrever. Nunca deve afetar a entrega da transcrição —
 * falha aqui só gera log, nunca retry agressivo nem efeito colateral visível
 * além da mensagem de confirmação/erro enviada ao próprio usuário.
 * Registrado como side-effect: importado por src/index.ts (único entrypoint do worker).
 */

interface VoiceCommandJobData {
  userId: string;
  numberId: string;
  instanceName: string;
  senderPhone: string;
  transcriptionId: string;
  rawText: string;
}

async function processVoiceCommandJob(job: Job<VoiceCommandJobData>) {
  const { userId, numberId, instanceName, senderPhone, transcriptionId, rawText } = job.data;

  const classification = await classifyVoiceCommand(rawText);

  if (classification.intent === 'none') {
    logger.info(`[VoiceCommand] Nenhum comando detectado (confiança=${classification.confidence})`);
    return { skipped: true, reason: 'none' };
  }

  logger.info(`[VoiceCommand] Intent=${classification.intent} confiança=${classification.confidence} userId=${userId}`);

  const result = await executeVoiceCommand(userId, classification.intent, classification.data);

  await prisma.voiceCommand.create({
    data: {
      userId,
      numberId,
      transcriptionId,
      rawText,
      intent:        classification.intent,
      status:        result.status,
      resultSummary: result.resultSummary,
      confidence:    classification.confidence,
    },
  }).catch((err: any) => logger.error(`[VoiceCommand] Falha ao gravar log de auditoria: ${err.message}`));

  if (result.resultSummary) {
    try {
      await sendMessageViaEvolution(instanceName, senderPhone, result.resultSummary);
    } catch (err: any) {
      logger.error(`[VoiceCommand] Falha ao enviar confirmação via Evolution: ${err.message}`);
    }
  }

  return { intent: classification.intent, status: result.status };
}

const VOICE_COMMAND_CONCURRENCY = parseInt(process.env.VOICE_COMMAND_WORKER_CONCURRENCY || '2');

const voiceCommandWorker = new Worker('voice-commands', processVoiceCommandJob, {
  connection: redis as any,
  concurrency: VOICE_COMMAND_CONCURRENCY,
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

voiceCommandWorker.on('completed', (job, result) => {
  if (result?.skipped) {
    logger.info(`[VoiceCommand] Job ${job.id} sem ação — motivo: ${result.reason}`);
  } else {
    logger.info(`[VoiceCommand] ✅ Job ${job.id} concluído (${result?.intent} → ${result?.status})`);
  }
});

voiceCommandWorker.on('failed', (job, err) => {
  logger.error(`[VoiceCommand] ❌ Job ${job?.id} falhou: ${err.message}`);
});

voiceCommandWorker.on('error', (err) => {
  logger.error('[VoiceCommand] Erro interno do worker', { err: err.message });
});

logger.info('Worker Comando de Voz Universal iniciado');

export { voiceCommandWorker };
