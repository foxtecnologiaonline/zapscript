import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { logger } from './lib/logger';
import { captureJobFailure, captureWorkerError } from './lib/sentry';
import { recordFailedJob } from './lib/dlq';
import { downloadAudioFromEvolution, sendMessageViaEvolution } from './services/evolution';
import { convertToMp3 } from './services/audio';
import { transcribeAudio } from './services/whisper';
import { handleZapMonneyMessage } from './services/zapmonney-executor';

/**
 * Worker do ZapMonney — consome a fila 'zapmonney', produzida pelo router da API
 * (apps/api/src/services/zapmonney-router.ts) a cada mensagem que chega no número
 * dedicado do assistente financeiro.
 *
 * Caminho de transcrição próprio, de propósito: a fila 'transcriptions' carrega
 * quota de áudio, freemium e CTA de demo pública, nada disso se aplica aqui — o
 * ZapMonney não tem billing e seus usuários não são contas do ZapScript.
 *
 * Registrado como side-effect: importado por src/index.ts (único entrypoint).
 */

interface ZapMonneyJobData {
  instanceName: string;
  phone:        string;
  pushName?:    string | null;
  messageId:    string;
  kind:         'text' | 'audio';
  text?:        string;
  /** payload bruto da Evolution — só em kind='audio', para baixar a mídia */
  messageData?: any;
}

async function transcribe(instanceName: string, messageData: any): Promise<string> {
  const raw = await downloadAudioFromEvolution(instanceName, messageData);
  const mp3 = await convertToMp3(raw);
  const { text } = await transcribeAudio(mp3);
  return text.trim();
}

async function processZapMonneyJob(job: Job<ZapMonneyJobData>) {
  const { instanceName, phone, pushName, messageId, kind } = job.data;

  let text = job.data.text?.trim() ?? '';

  if (kind === 'audio') {
    try {
      text = await transcribe(instanceName, job.data.messageData);
      logger.info(`[ZapMonney] 🎙️ Áudio transcrito (${text.length} chars) de ${phone}`);
    } catch (err: any) {
      logger.error(`[ZapMonney] Falha ao transcrever áudio de ${phone}: ${err.message}`);
      // Áudio ilegível é problema da pessoa resolver repetindo, não de retry:
      // o Whisper vai falhar igual na segunda tentativa com o mesmo arquivo.
      await sendMessageViaEvolution(
        instanceName, phone,
        '🎙️ Não consegui entender esse áudio. Pode mandar de novo, ou escrever?',
      ).catch(() => null);
      return { skipped: true, reason: 'transcription_failed' };
    }
  }

  if (!text) return { skipped: true, reason: 'empty' };

  const reply = await handleZapMonneyMessage({ phone, pushName, text, sourceMsgId: messageId });

  if (!reply) return { skipped: true, reason: 'no_reply' };

  await sendMessageViaEvolution(instanceName, phone, reply);
  return { replied: true };
}

const ZAPMONNEY_CONCURRENCY = parseInt(process.env.ZAPMONNEY_WORKER_CONCURRENCY || '4');

const zapmonneyWorker = new Worker('zapmonney', processZapMonneyJob, {
  connection:      redis as any,
  concurrency:     ZAPMONNEY_CONCURRENCY,
  // Transcrição de áudio pode passar de 1min em áudio longo.
  lockDuration:    120_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

zapmonneyWorker.on('completed', (job, result) => {
  if (result?.skipped) {
    logger.info(`[ZapMonney] Job ${job.id} sem resposta — motivo: ${result.reason}`);
  } else {
    logger.info(`[ZapMonney] ✅ Job ${job.id} respondido`);
  }
});

zapmonneyWorker.on('failed', (job, err) => {
  captureJobFailure('zapmonney', job, err);
  void recordFailedJob('zapmonney', job, err);
  logger.error(`[ZapMonney] ❌ Job ${job?.id} falhou: ${err.message}`);
});

zapmonneyWorker.on('error', (err) => {
  captureWorkerError('zapmonney', err);
  logger.error('[ZapMonney] Erro interno do worker', { err: err.message });
});

logger.info('Worker ZapMonney iniciado');

export { zapmonneyWorker };
