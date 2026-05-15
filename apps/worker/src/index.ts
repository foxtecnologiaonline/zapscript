import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { convertToMp3 } from './services/audio';
import { downloadAudioFromMeta, sendMessageToMeta } from './services/whatsapp-official';
import { downloadAudioFromTwilio, sendMessageViaTwilio } from './services/twilio';
import { downloadAudioFromZapi, sendMessageViaZapi, markChatAsUnread } from './services/zapi';
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

// Groq — whisper-large-v3-turbo (mais rápido e preciso para PT-BR)
// Compatível com API OpenAI — sem dependência extra
const groq = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null;

// Prompt que melhora acurácia do Whisper em PT-BR (termos comuns em áudios de WhatsApp)
const PT_BR_PROMPT = 'Transcrição em português brasileiro. Áudio de WhatsApp com linguagem coloquial.';

// ─────────────────────────────────────────────────────────────────
//  SHARED HELPERS — usados em ambos os pipelines
// ─────────────────────────────────────────────────────────────────

/**
 * Transcreve mp3Buffer com Whisper.
 * Primário: Groq whisper-large-v3-turbo (PT-BR, rápido).
 * Fallback: OpenAI whisper-1.
 * Retorna texto e duração real extraída do response verbose_json.
 */
async function transcribeBuffer(mp3Buffer: Buffer): Promise<{ text: string; durationSec: number }> {
  const audioFile = new File([mp3Buffer], 'audio.mp3', { type: 'audio/mpeg' });

  // ── Primário: Groq ────────────────────────────────────────────
  if (groq) {
    try {
      const result = await groq.audio.transcriptions.create({
        file:            audioFile,
        model:           'whisper-large-v3-turbo',
        language:        'pt',
        response_format: 'verbose_json',
        prompt:          PT_BR_PROMPT,
      } as any);
      const text = result.text?.trim();
      if (!text) throw new Error('Groq Whisper retornou texto vazio');
      const durationSec = Math.max(1, Math.round((result as any).duration ?? 0));
      logger.info(`[Whisper] Groq whisper-large-v3-turbo — ${durationSec}s`);
      return { text, durationSec };
    } catch (err: any) {
      logger.warn(`[Whisper] Groq falhou, usando OpenAI como fallback: ${err.message}`);
    }
  }

  // ── Fallback: OpenAI whisper-1 ────────────────────────────────
  const result = await openai.audio.transcriptions.create({
    file:            audioFile,
    model:           'whisper-1',
    language:        'pt',
    response_format: 'verbose_json',
    prompt:          PT_BR_PROMPT,
  } as any);
  const text = result.text?.trim();
  if (!text) throw new Error('Whisper retornou texto vazio');
  const durationSec = Math.max(1, Math.round((result as any).duration ?? 0));
  logger.info(`[Whisper] OpenAI whisper-1 — ${durationSec}s`);
  return { text, durationSec };
}

/** Calcula quantos bullets gerar com base nas linhas do texto (máx 5) */
function bulletCount(text: string): number {
  const lines = text.split('\n').filter(l => l.trim().length > 0).length;
  return Math.min(5, Math.max(1, lines));
}

/** Gera bullets com Claude Haiku (rápido e econômico para tarefas simples) */
async function generateBullets(originalText: string): Promise<string[]> {
  const count = bulletCount(originalText);
  try {
    const res = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     'Você é um assistente que resume áudios transcritos em bullets concisos em português brasileiro. Responda SOMENTE com os bullets, um por linha, começando com "- ". Sem título, sem texto extra.',
      messages: [{
        role:    'user',
        content: `Resuma em exatamente ${count} ponto${count > 1 ? 's' : ''} principal${count > 1 ? 'is' : ''} ou chave:\n\n${originalText}`,
      }],
    });
    const raw     = (res.content[0] as any).text || '';
    const bullets = raw
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.startsWith('- '))
      .map((l: string) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean)
      .slice(0, count);
    return bullets.length > 0 ? bullets : ['Resumo não disponível'];
  } catch (err: any) {
    logger.warn(`[Worker] Claude falhou ao gerar bullets — usando fallback: ${(err as Error).message}`);
    const sentences = originalText.split(/[.!?]\s+/).filter(s => s.trim().length > 10).slice(0, count);
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
  userId: string; numberId: string; contactPhone: string; contactName?: string;
  durationSec: number; originalText: string; bullets: string[]; source: string;
}) {
  const { userId, numberId, contactPhone, contactName, durationSec, originalText, bullets, source } = params;
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
        data: { userId, numberId, contactPhone, contactName: contactName ?? null, durationSec, originalText, summaryBullets: bullets, confidenceScore: 99.0, source },
      }),
      tx.whatsappNumber.update({
        where: { id: numberId },
        data:  { messageCount: { increment: 1 }, minutesUsed: { increment: durationMin }, lastMessageAt: new Date() },
      }),
    ]);

    return transcription;
  });
}

/** Formata mensagem de resposta para o WhatsApp.
 *
 * Formatação WhatsApp:
 *   *texto*   → negrito
 *   _texto_   → itálico
 *   ~texto~   → tachado
 *   `texto`   → monoespaçado
 *   \n        → nova linha
 */
function buildMessage(bullets: string[], originalText: string, _refCode: string): string {
  // Detectar bullets genéricos/fallback que não agregam valor ao usuário
  const FALLBACK_PHRASES = [
    'Transcrição disponível',
    'resumo temporariamente indisponível',
    'Resumo não disponível',
    'Não foi possível gerar',
  ];
  const hasRealBullets =
    bullets.length > 0 &&
    !bullets.some(b => FALLBACK_PHRASES.some(f => b.includes(f)));

  const highlightsSection = hasRealBullets
    ? `🎯 Destaques\n${bullets.map(b => `- ${b}`).join('\n')}\n\n`
    : '';

  return (
    `✨ Transcrição do seu áudio ✨\n\n` +
    highlightsSection +
    `📄 Transcrição completa\n_${originalText}_\n\n` +
    `---\n` +
    `⚡ Pronto em segundos!\n` +
    `👉 https://ZapScript.me — Ative agora`
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

    // PASSO 4: Transcrever com Whisper (Groq primary / OpenAI fallback)
    log(job, '🎙️  Whisper API (PT-BR)...');
    const { text: originalText, durationSec } = await transcribeBuffer(mp3Buffer);
    log(job, `✅ ${durationSec}s — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Salvar e debitar (atomicamente) — duração real do Whisper
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId, numberId, contactPhone: 'manual',
      durationSec, originalText, bullets, source: 'manual',
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

    // PASSO 4: Transcrever com Whisper (Groq primary / OpenAI fallback)
    log(job, '🎙️  Whisper API (PT-BR)...');
    const { text: originalText, durationSec } = await transcribeBuffer(mp3Buffer);
    log(job, `✅ ${durationSec}s — "${originalText.substring(0, 60)}..."`);

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

    // PASSO 7: Salvar transcrição e debitar minutos — duração real do Whisper
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId,
      numberId:     firstNumber.id,
      contactPhone: senderPhone,
      contactName:  senderName,
      durationSec,
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
//  PIPELINE D — WhatsApp via Twilio BSP
// ─────────────────────────────────────────────────────────────────
async function processTwilioJob(job: Job) {
  const { userId, senderPhone, senderName, mediaUrl, twilioFrom } = job.data;

  log(job, `📥 Twilio BSP: ${senderName} (${senderPhone})`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo
    const [balance, firstNumber] = await Promise.all([
      prisma.minuteBalance.findUnique({ where: { userId } }),
      prisma.whatsappNumber.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);

    if (!balance || balance.availableMinutes < 1) {
      log(job, '⚠️  Saldo insuficiente — notificando via Twilio');
      await sendMessageViaTwilio(
        senderPhone,
        twilioFrom,
        '⚠️ Seu saldo de minutos acabou.\nAcesse zapscript.me para fazer upgrade e continuar recebendo transcrições.'
      ).catch(() => null);
      return { skipped: true, reason: 'insufficient_balance' };
    }
    if (!firstNumber) {
      log(job, '⚠️  Usuário sem número cadastrado');
      return { skipped: true, reason: 'no_number' };
    }

    // PASSO 2: Baixar áudio do Twilio
    log(job, '⬇️  Baixando áudio do Twilio...');
    const audioBuffer = await downloadAudioFromTwilio(mediaUrl);
    log(job, `✅ Baixado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter para MP3
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(audioBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 4: Transcrever com Whisper (Groq primary / OpenAI fallback)
    log(job, '🎙️  Whisper API (PT-BR)...');
    const { text: originalText, durationSec } = await transcribeBuffer(mp3Buffer);
    log(job, `✅ ${durationSec}s — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Enviar resposta via Twilio
    log(job, '📤 Enviando resposta via Twilio...');
    const user    = await prisma.user.findUnique({ where: { id: userId } });
    const message = buildMessage(bullets, originalText, user?.refCode || '');
    await sendMessageViaTwilio(senderPhone, twilioFrom, message);
    log(job, '✅ Mensagem enviada');

    // PASSO 7: Salvar transcrição e debitar minutos
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId,
      numberId:     firstNumber.id,
      contactPhone: senderPhone,
      contactName:  senderName,
      durationSec,
      originalText,
      bullets,
      source: 'whatsapp-twilio',
    });

    log(job, `✅ Processado via Twilio BSP`);
    return { transcriptionId: transcription.id };

  } catch (err) {
    log(job, `❌ Erro Twilio: ${(err as Error).message}`);
    try {
      await sendMessageViaTwilio(senderPhone, twilioFrom, '❌ Erro ao processar seu áudio. Tente novamente.');
    } catch {}
    throw err;
  } finally {
    mp3Buffer?.fill(0);
  }
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE E — WhatsApp via Z-API (dispositivo adicional)
// ─────────────────────────────────────────────────────────────────
async function processZapiJob(job: Job) {
  const { userId, numberId, senderPhone, senderName, audioUrl, durationHint } = job.data;

  log(job, `📥 Z-API: ${senderName} (${senderPhone})`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo e buscar o número exato que recebeu o áudio
    const [balance, whatsappNumber] = await Promise.all([
      // upsert garante que registro existe (evita skipped silencioso em novas contas)
      prisma.minuteBalance.upsert({
        where:  { userId },
        update: {},
        create: { userId, availableMinutes: 0, accumulatedMinutes: 0, resetAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
      }),
      numberId
        ? prisma.whatsappNumber.findUnique({ where: { id: numberId } })
        : prisma.whatsappNumber.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);

    if (balance.availableMinutes < 0.1) {
      log(job, `⚠️  Saldo insuficiente: ${balance.availableMinutes.toFixed(2)} min — notificando via Z-API`);
      await sendMessageViaZapi(
        senderPhone,
        whatsappNumber?.zapiInstanceId ?? undefined,
        whatsappNumber?.zapiToken ?? undefined,
        '⚠️ Seu saldo de minutos acabou.\nAcesse zapscript.me para fazer upgrade e continuar recebendo transcrições.'
      ).catch(() => null);
      return { skipped: true, reason: 'insufficient_balance' };
    }
    if (!whatsappNumber) {
      log(job, '⚠️  Número não encontrado no banco');
      return { skipped: true, reason: 'no_number' };
    }
    log(job, `✅ Saldo OK: ${balance.availableMinutes.toFixed(1)} min`);

    // PASSO 2: Baixar áudio da Z-API
    log(job, '⬇️  Baixando áudio da Z-API...');
    const audioBuffer = await downloadAudioFromZapi(audioUrl);
    log(job, `✅ Baixado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter para MP3
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(audioBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 4: Transcrever com Whisper (Groq primary / OpenAI fallback)
    log(job, '🎙️  Whisper API (PT-BR)...');
    const { text: originalText, durationSec: whisperDuration } = await transcribeBuffer(mp3Buffer);
    const durationSec = whisperDuration > 0 ? whisperDuration : Math.max(1, durationHint || 1);
    log(job, `✅ ${durationSec}s — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude Haiku
    log(job, '🤖 Claude Haiku resumo...');
    const bullets = await generateBullets(originalText);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Enviar resposta usando credenciais do número que recebeu o áudio
    log(job, '📤 Enviando resposta via Z-API...');
    const user    = await prisma.user.findUnique({ where: { id: userId } });
    const message = buildMessage(bullets, originalText, user?.refCode || '');
    await sendMessageViaZapi(
      senderPhone,
      whatsappNumber.zapiInstanceId ?? undefined,
      whatsappNumber.zapiToken ?? undefined,
      message
    );
    log(job, '✅ Mensagem enviada na conversa');

    // PASSO 6.5: Marcar conversa como não lida (preserva notificação no WhatsApp)
    await markChatAsUnread(
      senderPhone,
      whatsappNumber.zapiInstanceId ?? undefined,
      whatsappNumber.zapiToken ?? undefined,
    );

    // PASSO 7: Salvar transcrição e debitar minutos
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId,
      numberId:     whatsappNumber.id,
      contactPhone: senderPhone,
      contactName:  senderName,
      durationSec,
      originalText,
      bullets,
      source: 'whatsapp-zapi',
    });

    log(job, `✅ Concluído via Z-API`);
    return { transcriptionId: transcription.id };

  } catch (err) {
    log(job, `❌ Erro Z-API: ${(err as Error).message}`);
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
  if (source === 'manual')           return processManualJob(job);
  if (source === 'whatsapp-twilio')  return processTwilioJob(job);
  if (source === 'whatsapp-zapi')    return processZapiJob(job);
  // transcribe-official = WhatsApp Cloud API (Meta) — pipeline principal
  return processOfficialWhatsAppJob(job);
}

// ─────────────────────────────────────────────────────────────────
//  WORKER SETUP
// ─────────────────────────────────────────────────────────────────
const worker = new Worker('transcriptions', routeJob, {
  connection:   redis,
  concurrency:  2,            // era 5 — Render free (512MB) não aguenta 5 Whisper simultâneos
  lockDuration: 5 * 60_000,   // 5 min — Whisper pode demorar em áudios longos (era default 30s → stalled!)
  lockRenewTime: 2 * 60_000,  // renovar lock a cada 2 min enquanto processa
  stalledInterval: 30_000,    // checar stalled jobs a cada 30s
  maxStalledCount: 1,         // max 1 stall antes de marcar como falha
});

worker.on('completed', (job, result) => {
  if (result?.skipped) {
    logger.warn(`[Worker] Job ${job.id} ignorado — motivo: ${result.reason}`);
  } else {
    logger.info(`[Worker] ✅ Job ${job.id} [${job.name}] concluído`);
  }
});

worker.on('failed', (job, err) => {
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 4;
  logger.error(
    `[Worker] ❌ Job ${job?.id} [${job?.name}] falhou (tentativa ${attempts}/${maxAttempts}): ${err.message}`,
    { stack: err.stack?.split('\n').slice(0, 5).join(' | ') }
  );
});

worker.on('stalled', (jobId) => {
  logger.warn(`[Worker] ⚠️ Job ${jobId} ficou stalled (processamento demorou demais)`);
});

worker.on('error', (err) => {
  logger.error('[Worker] Erro interno', { err: err.message });
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
