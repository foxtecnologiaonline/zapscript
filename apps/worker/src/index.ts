import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { convertToMp3 } from './services/audio';
import { downloadAudioFromMeta, sendMessageToMeta } from './services/whatsapp-official';
import { logger } from './lib/logger';
// Baileys removido — agora usando Meta Cloud API exclusivamente

// Validate required API keys at startup — fail fast with clear message
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-proj-...')) {
  console.error('[Worker] FATAL: OPENAI_API_KEY não configurada. Configure no Render.com e redeploy.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
  console.error('[Worker] FATAL: ANTHROPIC_API_KEY não configurada. Configure no Render.com e redeploy.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────
//  SHARED HELPERS — usados em ambos os pipelines
// ─────────────────────────────────────────────────────────────────

/** Transcreve um mp3Buffer com Whisper */
async function transcribeBuffer(mp3Buffer: Buffer): Promise<string> {
  const audioFile = new File([mp3Buffer], 'audio.mp3', { type: 'audio/mpeg' });
  const result = await openai.audio.transcriptions.create({
    file:            audioFile,
    model:           'whisper-1',
    language:        'pt',
    response_format: 'verbose_json',
  });
  const text = result.text?.trim();
  if (!text) throw new Error('Whisper retornou texto vazio');
  return text;
}

/** Gera bullets com Claude — com fallback se falhar */
async function generateBullets(originalText: string): Promise<string[]> {
  try {
    const res = await claude.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{
        role:    'user',
        content: `Gere um resumo em até 5 bullets CONCISOS em português brasileiro para o áudio transcrito abaixo.\nResponda SOMENTE com os bullets, um por linha, começando com "- ".\nSem título, sem texto extra, sem introdução.\n\nÁudio transcrito:\n${originalText}`,
      }],
    });
    const raw     = (res.content[0] as any).text || '';
    const bullets = raw
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.startsWith('- '))
      .map((l: string) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean);
    return bullets.length > 0 ? bullets : ['Resumo não disponível'];
  } catch (err: any) {
    logger.warn(`[Worker] Claude falhou ao gerar bullets — usando fallback: ${(err as Error).message}`);
    // Fallback: extrair primeiras frases do texto transcrito
    const sentences = originalText.split(/[.!?]\s+/).filter(s => s.trim().length > 10).slice(0, 3);
    return sentences.length > 0
      ? sentences.map(s => s.trim())
      : ['Transcrição disponível — resumo temporariamente indisponível'];
  }
}

/**
 * Salva transcrição no banco e debita minutos atomicamente.
 * Usa transação interativa para garantir que o débito só ocorre
 * se houver saldo suficiente (previne race condition).
 */
async function saveTranscription(params: {
  userId: string; numberId: string; contactPhone: string;
  durationSec: number; originalText: string; bullets: string[]; source: string;
}) {
  const { userId, numberId, contactPhone, durationSec, originalText, bullets, source } = params;
  const durationMin = durationSec / 60;

  return prisma.$transaction(async (tx) => {
    // Débito atômico: só desconta se tiver saldo suficiente
    const balanceUpdate = await tx.minuteBalance.updateMany({
      where: { userId, availableMinutes: { gte: durationMin } },
      data:  { availableMinutes: { decrement: durationMin } },
    });

    if (balanceUpdate.count === 0) {
      throw new Error(`Saldo insuficiente no momento do débito (${durationMin.toFixed(2)} min)`);
    }

    const [transcription] = await Promise.all([
      tx.transcription.create({
        data: { userId, numberId, contactPhone, durationSec, originalText, summaryBullets: bullets, confidenceScore: 99.0, source },
      }),
      tx.whatsappNumber.update({
        where: { id: numberId },
        data:  { messageCount: { increment: 1 }, minutesUsed: { increment: durationMin }, lastMessageAt: new Date() },
      }),
    ]);

    return transcription;
  });
}

/** Formata mensagem de resposta para o WhatsApp */
function buildMessage(bullets: string[], originalText: string, refCode: string): string {
  const bulletLines = bullets.map((b: string) => `- ${b}`).join('\n');
  return (
    `*_✨ Transcrição automática do seu áudio:_*\n\n` +
    `*Resumo:*\n${bulletLines}\n\n` +
    `*Original:*\n_${originalText}_\n\n` +
    `⚡ Transcreva seus áudios com o _zapscript.me/?ref=${refCode}_`
  );
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE B — Uploads manuais do dashboard (source: 'manual')
// ─────────────────────────────────────────────────────────────────
async function processManualJob(job: Job) {
  const { numberId, userId, audioBase64, filename } = job.data;

  log(job, `📥 Upload manual: ${filename}`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo (estimativa: cobra 1 minuto por arquivo)
    const balance = await prisma.minuteBalance.findUnique({ where: { userId } });
    if (!balance || balance.availableMinutes < 0.1) {
      log(job, '⚠️  Saldo insuficiente');
      return { skipped: true, reason: 'insufficient_balance' };
    }

    // PASSO 2: Decodificar base64 → buffer
    log(job, '📦 Decodificando arquivo...');
    const rawBuffer = Buffer.from(audioBase64, 'base64');
    log(job, `✅ Buffer: ${(rawBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 2.5: Validar tamanho (Whisper aceita no máximo 25MB)
    const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
    if (rawBuffer.length > MAX_AUDIO_BYTES) {
      log(job, `⚠️ Arquivo muito grande: ${(rawBuffer.length / 1024 / 1024).toFixed(1)}MB > 25MB`);
      return { skipped: true, reason: 'file_too_large' };
    }

    // PASSO 3: Converter para MP3 (aceita OGG, MP3, M4A, WAV, WebM)
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(rawBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 4: Transcrever com Whisper
    log(job, '🎙️  Whisper API...');
    const originalText = await transcribeBuffer(mp3Buffer);
    log(job, `✅ "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Estimar duração a partir do tamanho do buffer (~128kbps)
    const estimatedDuration = Math.max(1, (rawBuffer.length / 1024 / 16)); // segundos aprox.

    // PASSO 7: Salvar e debitar (atomicamente)
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId, numberId, contactPhone: 'manual',
      durationSec: estimatedDuration, originalText, bullets, source: 'manual',
    });

    log(job, `✅ Upload manual concluído`);
    return { transcriptionId: transcription.id };

  } catch (err) {
    log(job, `❌ Erro no upload manual: ${(err as Error).message}`);
    throw err;
  } finally {
    mp3Buffer?.fill(0);
  }
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE C — WhatsApp Cloud API (Meta official)
// ─────────────────────────────────────────────────────────────────
async function processOfficialWhatsAppJob(job: Job) {
  const { userId, senderPhone, senderName, mediaId, messageId } = job.data;
  const durationMin = 1; // Estimativa padrão

  log(job, `📥 WhatsApp Cloud API: ${senderName} (${senderPhone})`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo + buscar numberId real do usuário
    const [balance, firstNumber] = await Promise.all([
      prisma.minuteBalance.findUnique({ where: { userId } }),
      prisma.whatsappNumber.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (!balance || balance.availableMinutes < durationMin) {
      log(job, '⚠️  Saldo insuficiente — notificando usuário');
      await sendMessageToMeta(
        senderPhone,
        '⚠️ Seu saldo de minutos acabou.\nAcesse zapscript.me para fazer upgrade e continuar recebendo transcrições.'
      );
      return { skipped: true, reason: 'insufficient_balance' };
    }
    if (!firstNumber) {
      log(job, '⚠️  Usuário sem número cadastrado');
      return { skipped: true, reason: 'no_number' };
    }
    log(job, `✅ Saldo OK: ${balance.availableMinutes.toFixed(1)} min`);

    // PASSO 2: Baixar áudio da Meta API
    log(job, '⬇️  Baixando áudio da Meta API...');
    const audioBuffer = await downloadAudioFromMeta(mediaId);
    log(job, `✅ Baixado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter para MP3
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(audioBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 4: Transcrever com Whisper
    log(job, '🎙️  Whisper API...');
    const originalText = await transcribeBuffer(mp3Buffer);
    log(job, `✅ "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Enviar resposta no WhatsApp
    log(job, '📤 Enviando resposta via Meta API...');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const message = buildMessage(bullets, originalText, user?.refCode || '');
    await sendMessageToMeta(senderPhone, message);
    log(job, '✅ Mensagem enviada');

    // PASSO 7: Salvar transcrição e debitar minutos
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId,
      numberId: firstNumber.id, // Usa o WhatsappNumber real do usuário
      contactPhone: senderPhone,
      durationSec: 60, // Estimativa de 1 min por áudio via Meta
      originalText,
      bullets,
      source: 'whatsapp-meta',
    });

    log(job, `✅ Processado via WhatsApp Cloud API`);
    return { transcriptionId: transcription.id };
  } catch (err) {
    log(job, `❌ Erro: ${(err as Error).message}`);
    // Tentar notificar usuário do erro
    try {
      await sendMessageToMeta(senderPhone, '❌ Erro ao processar seu áudio. Tente novamente.');
    } catch {}
    throw err;
  } finally {
    mp3Buffer?.fill(0);
  }
}

// ─────────────────────────────────────────────────────────────────
//  ROUTER — decide qual pipeline usar
// ─────────────────────────────────────────────────────────────────
async function routeJob(job: Job) {
  const source = job.data.source || 'transcribe-official';
  if (source === 'manual') {
    return processManualJob(job);
  }
  // transcribe-official = WhatsApp Cloud API (Meta) — pipeline principal
  return processOfficialWhatsAppJob(job);
}

// ─────────────────────────────────────────────────────────────────
//  WORKER SETUP
// ─────────────────────────────────────────────────────────────────
const worker = new Worker('transcriptions', routeJob, {
  connection:  redis,
  concurrency: 5,
});

worker.on('completed', (job, result) => {
  if (!result?.skipped) {
    logger.info(`Job ${job.id} concluído`);
  }
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} falhou`, { err: err.message });
});

worker.on('error', (err) => {
  logger.error('Worker error', { err: err.message });
});

logger.info('Worker de transcrição iniciado (WhatsApp + Upload manual)');

// ─────────────────────────────────────────────────────────────────
//  CRON — Reset automático de minutos mensais
//  Roda a cada hora e reseta saldos cujo resetAt já passou
// ─────────────────────────────────────────────────────────────────
async function resetExpiredMinutes() {
  try {
    const expired = await prisma.minuteBalance.findMany({
      where:   { resetAt: { lte: new Date() } },
      include: { user: { include: { subscription: { include: { plan: true } } } } },
    });

    if (expired.length === 0) return;

    logger.info(`[Cron] Resetando minutos de ${expired.length} usuário(s)...`);

    for (const balance of expired) {
      const minutesPerMonth = balance.user.subscription?.plan?.minutesPerMonth ?? 0;
      const nextReset       = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await prisma.minuteBalance.update({
        where: { id: balance.id },
        data:  { availableMinutes: minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
      });

      logger.info(`[Cron] ${balance.user.email} → ${minutesPerMonth} min (próximo reset: ${nextReset.toISOString()})`);
    }
  } catch (err) {
    logger.error(`[Cron] Erro no reset de minutos: ${(err as Error).message}`);
  }
}

// Executa na inicialização e a cada hora
resetExpiredMinutes();
setInterval(resetExpiredMinutes, 60 * 60 * 1000);

// ── Graceful shutdown ────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('Worker encerrando...');
  const forceExit = setTimeout(() => {
    logger.error('Worker graceful shutdown timeout — forçando saída');
    process.exit(1);
  }, 30_000);
  try {
    await worker.close();
    await prisma.$disconnect();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('Erro ao encerrar worker', { err: (err as Error).message });
    clearTimeout(forceExit);
    process.exit(1);
  }
});

// ── Helper ───────────────────────────────────────────────────────
function log(job: Job, msg: string) {
  logger.info(msg, { jobId: job.id });
}
