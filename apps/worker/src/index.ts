import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { convertToMp3 } from './services/audio';
import { sendMessage } from './services/whatsapp';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ─────────────────────────────────────────────────────────────────
//  SHARED HELPERS — usados em ambos os pipelines
// ─────────────────────────────────────────────────────────────────

/** Baixa mídia do WhatsApp com timeout de 30s */
async function downloadWithTimeout(msg: any): Promise<Buffer> {
  const download = downloadMediaMessage(msg, 'buffer', {}) as Promise<Buffer>;
  const timeout  = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Download de mídia excedeu 30s')), 30_000)
  );
  return Promise.race([download, timeout]);
}

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

/** Gera bullets com Claude */
async function generateBullets(originalText: string): Promise<string[]> {
  const res = await claude.messages.create({
    model:      'claude-sonnet-4-6',
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
//  PIPELINE A — Jobs do WhatsApp (source: 'whatsapp')
// ─────────────────────────────────────────────────────────────────
async function processWhatsAppJob(job: Job) {
  const { numberId, userId, msg, contactJid, duration } = job.data;
  const durationMin = duration / 60;

  log(job, `📥 WhatsApp: ${contactJid} (${duration}s)`);

  let oggBuffer: Buffer | null = null;
  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo
    const balance = await prisma.minuteBalance.findUnique({ where: { userId } });
    if (!balance || balance.availableMinutes < durationMin) {
      log(job, '⚠️  Saldo insuficiente — notificando usuário');
      await sendMessage(
        numberId,
        contactJid,
        `⚠️ Seu saldo de minutos acabou.\nAcesse zapscript.me para fazer upgrade e continuar recebendo transcrições.`
      );
      return { skipped: true, reason: 'insufficient_balance' };
    }
    log(job, `✅ Saldo OK: ${balance.availableMinutes.toFixed(1)} min`);

    // PASSO 2: Baixar áudio do WhatsApp (com timeout de 30s)
    log(job, '⬇️  Baixando áudio...');
    oggBuffer = await downloadWithTimeout(msg);
    log(job, `✅ Baixado: ${(oggBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter OGG → MP3
    log(job, '🔄 Convertendo OGG → MP3...');
    mp3Buffer = await convertToMp3(oggBuffer);
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
    log(job, '📤 Enviando no WhatsApp...');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await sendMessage(numberId, contactJid, buildMessage(bullets, originalText, user?.refCode || ''));
    log(job, '✅ Mensagem enviada');

    // PASSO 7: Salvar e debitar (atomicamente)
    log(job, '💾 Salvando...');
    const contactPhone = contactJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
    const transcription = await saveTranscription({
      userId, numberId, contactPhone,
      durationSec: duration, originalText, bullets, source: 'whatsapp',
    });

    log(job, `✅ Concluído — ${durationMin.toFixed(2)} min debitados`);
    return { transcriptionId: transcription.id, durationMin };

  } catch (err) {
    log(job, `❌ Erro: ${(err as Error).message}`);
    throw err;
  } finally {
    // LGPD: limpar buffers de áudio independentemente de sucesso ou erro
    oggBuffer?.fill(0);
    mp3Buffer?.fill(0);
  }
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE B — Uploads manuais do dashboard (source: 'manual')
// ─────────────────────────────────────────────────────────────────
async function processManualJob(job: Job) {
  const { numberId, userId, audioBase64, filename, contactJid } = job.data;

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

    // PASSO 6: Enviar resultado no WhatsApp (se houver número conectado)
    if (contactJid) {
      log(job, '📤 Enviando no WhatsApp...');
      const user = await prisma.user.findUnique({ where: { id: userId } });
      await sendMessage(numberId, contactJid, buildMessage(bullets, originalText, user?.refCode || ''));
      log(job, '✅ Mensagem enviada');
    }

    // PASSO 7: Estimar duração a partir do tamanho do buffer (~128kbps)
    const estimatedDuration = Math.max(1, (rawBuffer.length / 1024 / 16)); // segundos aprox.

    // PASSO 8: Salvar e debitar (atomicamente)
    log(job, '💾 Salvando...');
    const contactPhone = contactJid?.replace('@s.whatsapp.net', '') || 'manual';
    const transcription = await saveTranscription({
      userId, numberId, contactPhone,
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
//  ROUTER — decide qual pipeline usar
// ─────────────────────────────────────────────────────────────────
async function routeJob(job: Job) {
  const source = job.data.source || 'whatsapp';
  if (source === 'manual') {
    return processManualJob(job);
  }
  return processWhatsAppJob(job);
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
    console.log(`✅ [Job ${job.id}] Transcrição concluída`);
  }
});

worker.on('failed', (job, err) => {
  console.error(`❌ [Job ${job?.id}] Falhou:`, err.message);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

console.log('🔄 Worker de transcrição iniciado (WhatsApp + Upload manual)');
console.log('   Aguardando jobs na fila "transcriptions"...');

// ── Graceful shutdown ────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('Worker encerrando...');
  const forceExit = setTimeout(() => {
    console.error('Worker graceful shutdown timeout — forçando saída');
    process.exit(1);
  }, 30_000);
  try {
    await worker.close();
    await prisma.$disconnect();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    console.error('Erro ao encerrar worker:', err);
    clearTimeout(forceExit);
    process.exit(1);
  }
});

// ── Helper ───────────────────────────────────────────────────────
function log(job: Job, msg: string) {
  console.log(`[Job ${job.id}] ${msg}`);
}
