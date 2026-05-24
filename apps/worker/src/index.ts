import 'dotenv/config';
import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { convertToMp3 } from './services/audio';
import { downloadAudioFromMeta, sendMessageToMeta } from './services/whatsapp-official';
import { downloadAudioFromTwilio, sendMessageViaTwilio } from './services/twilio';
import { downloadAudioFromEvolution, sendMessageViaEvolution, markChatAsUnread } from './services/evolution';
import { encryptStr, encryptArr, decryptStr, decryptArr } from './services/encryption';
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
async function transcribeBuffer(mp3Buffer: Buffer): Promise<{ text: string; durationSec: number; language: string }> {
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
      const language    = (result as any).language || 'pt';
      logger.info(`[Whisper] Groq whisper-large-v3-turbo — ${durationSec}s — lang:${language}`);
      return { text, durationSec, language };
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
  const language    = (result as any).language || 'pt';
  logger.info(`[Whisper] OpenAI whisper-1 — ${durationSec}s — lang:${language}`);
  return { text, durationSec, language };
}

/**
 * Decide quantos bullets gerar:
 * - até 60s (~150 palavras) → 1 bullet
 * - acima de 60s            → 2 bullets
 * Máximo 2 — ponto chave deve ser curto e direto.
 */
function bulletCount(text: string): number {
  const wordCount = text.trim().split(/\s+/).length;
  return wordCount > 150 ? 2 : 1;
}

/** Gera bullets ultra-concisos com Claude Haiku — máx 10 palavras cada.
 *  Se o texto estiver em idioma diferente do PT-BR, traduz os bullets para PT-BR.
 */
async function generateBullets(originalText: string, language?: string): Promise<string[]> {
  const count       = bulletCount(originalText);
  const needsTransl = language && language !== 'pt' && language !== 'pt-BR' && language !== 'pt-br';
  const systemMsg   = needsTransl
    ? 'Você resume áudios de WhatsApp. SEMPRE responda em português brasileiro (PT-BR). Se o texto não estiver em português, traduza e resuma em PT-BR. Cada ponto deve ter no máximo 10 palavras, ser curtíssimo, direto e objetivo. Responda SOMENTE com os pontos, um por linha, começando com "- ". Sem título, sem explicação.'
    : 'Você resume áudios de WhatsApp em PT-BR. Cada ponto deve ter no máximo 10 palavras, ser curtíssimo, direto e objetivo — só o essencial do assunto. Responda SOMENTE com os pontos, um por linha, começando com "- ". Sem título, sem explicação, sem verbosidade.';

  try {
    const res = await claude.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 120,
      system:     systemMsg,
      messages: [{
        role:    'user',
        content: `Resuma em ${count === 1 ? 'exatamente 1 ponto curto e objetivo' : '2 pontos curtos e objetivos'}:\n\n${originalText}`,
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
    // Fallback: primeira frase do texto, truncada
    const first = originalText.split(/[.!?]\s+/).find(s => s.trim().length > 5) || originalText;
    const words = first.trim().split(/\s+/).slice(0, 12).join(' ');
    return [words || 'Transcrição disponível'];
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

  const transcription = await prisma.$transaction(async (tx) => {
    // Débito atômico: só desconta se tiver saldo suficiente
    const balanceUpdate = await tx.minuteBalance.updateMany({
      where: { userId, availableMinutes: { gte: durationMin } },
      data:  { availableMinutes: { decrement: durationMin } },
    });

    if (balanceUpdate.count === 0) {
      throw new Error(`Saldo insuficiente no momento do débito (${durationMin.toFixed(2)} min)`);
    }

    // Criptografar campos sensíveis antes de salvar
    const encPhone   = encryptStr(contactPhone);
    const encText    = encryptStr(originalText);
    const encBullets = encryptArr(bullets);

    const [t] = await Promise.all([
      tx.transcription.create({
        data: { userId, numberId, contactPhone: encPhone, contactName: contactName ?? null, durationSec, originalText: encText, summaryBullets: encBullets, confidenceScore: 99.0, source },
      }),
      tx.whatsappNumber.update({
        where: { id: numberId },
        data:  { messageCount: { increment: 1 }, minutesUsed: { increment: durationMin }, lastMessageAt: new Date() },
      }),
    ]);

    return t;
  });

  // ── Alertas de consumo (fire-and-forget) ─────────────────────────────────
  triggerMinuteAlertIfNeeded(userId).catch(() => null);

  // ── Webhook personalizado (fire-and-forget, Executive+) ───────────────────
  dispatchWebhook(userId, transcription, { originalText, bullets }).catch(() => null);

  return transcription;
}

/**
 * Verifica se o usuário ultrapassou 50/80/100% dos minutos mensais.
 * Envia WhatsApp ao próprio número conectado. Cada threshold é enviado no máximo 1x/mês
 * (controlado pelo campo lastAlertSent e alertThreshold no banco).
 */
async function triggerMinuteAlertIfNeeded(userId: string): Promise<void> {
  try {
    const balance = await (prisma as any).minuteBalance.findUnique({
      where:   { userId },
      include: { user: { include: { subscription: { include: { plan: true } } } } },
    });
    if (!balance) return;

    const total     = balance.user?.subscription?.plan?.minutesPerMonth ?? 0;
    if (total <= 0) return;

    const used      = total - balance.availableMinutes;
    const pct       = Math.floor((used / total) * 100);
    const lastAlert = parseInt(balance.lastAlertSent || '0', 10); // string "50"|"80"|"100"|null → number

    // Determinar threshold que deve ser enviado (50 → 80 → 100, um por vez)
    let threshold: 50 | 80 | 100 | null = null;
    if (pct >= 100 && lastAlert < 100)      threshold = 100;
    else if (pct >= 80 && lastAlert < 80)   threshold = 80;
    else if (pct >= 50 && lastAlert < 50)   threshold = 50;

    if (!threshold) return;

    // Buscar número conectado para enviar o alerta
    const n = await (prisma as any).whatsappNumber.findFirst({
      where: { userId, status: 'connected', zapiInstanceId: { not: null }, phoneNumber: { not: null } },
      orderBy: { connectedAt: 'desc' },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    const msgs: Record<number, string> = {
      50:  `📊 *ZapScript* — 50% dos minutos usados\n\nVocê já usou *metade dos seus minutos* do mês.\n\n💡 Considere fazer upgrade para não perder nenhum áudio:\n👉 https://ZapScript.me/dashboard/plano`,
      80:  `⚠️ *ZapScript* — 80% dos minutos usados\n\nSeus minutos estão quase esgotando! Restam apenas *20%*.\n\n🚀 Faça upgrade agora:\n👉 https://ZapScript.me/dashboard/plano`,
      100: `🔴 *ZapScript* — Minutos esgotados\n\nVocê atingiu *100% dos seus minutos* deste mês.\n\n📵 As transcrições foram *pausadas* até o próximo ciclo ou upgrade.\n\n⚡ Faça upgrade agora:\n👉 https://ZapScript.me/dashboard/plano`,
    };

    await sendMessageViaEvolution(n.zapiInstanceId, n.phoneNumber, msgs[threshold]);

    // Marcar alerta enviado para não repetir no mesmo ciclo
    await (prisma as any).minuteBalance.update({
      where: { userId },
      data:  { lastAlertSent: String(threshold) }, // schema: String?
    }).catch(() => null);

    logger.info(`[MinuteAlert] ✅ Alerta ${threshold}% enviado ao usuário ${userId}`);
  } catch (err: any) {
    logger.warn(`[MinuteAlert] Falha ao verificar alerta: ${err.message}`);
  }
}

/**
 * Dispara webhook personalizado do usuário após uma transcrição concluída.
 * Fire-and-forget: erros são logados mas não afetam o pipeline.
 */
async function dispatchWebhook(
  userId: string,
  transcription: { id: string; contactPhone: string; contactName: string | null; durationSec: number; language: string; source: string; createdAt: Date },
  plain: { originalText: string; bullets: string[] },
): Promise<void> {
  try {
    const config = await (prisma as any).webhookConfig.findUnique({ where: { userId, active: true } });
    if (!config) return;

    const payload = {
      event:     'transcription.completed',
      timestamp: new Date().toISOString(),
      data: {
        id:            transcription.id,
        contactPhone:  decryptStr(transcription.contactPhone),
        contactName:   transcription.contactName,
        durationSec:   transcription.durationSec,
        originalText:  plain.originalText,
        summaryBullets: plain.bullets,
        language:      transcription.language,
        source:        transcription.source,
        createdAt:     transcription.createdAt.toISOString(),
      },
    };

    const body      = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', config.secret).update(body).digest('hex');

    await fetch(config.url, {
      method:  'POST',
      headers: {
        'Content-Type':          'application/json',
        'X-ZapScript-Signature': signature,
        'X-ZapScript-Event':     'transcription.completed',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });

    logger.info(`[Webhook] ✅ Disparado para ${config.url}`);
  } catch (err: any) {
    logger.warn(`[Webhook] Falha ao disparar: ${err.message}`);
  }
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
    ? `🔑 Ponto chave\n${bullets.map(b => `- ${b}`).join('\n')}\n\n`
    : '';

  return (
    `✨ Transcrição do seu áudio ✨\n\n` +
    highlightsSection +
    `📄 Transcrição completa\n_${originalText}_\n\n` +
    `---\n` +
    `👉 https://ZapScript.me`
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
    const { text: originalText, durationSec, language: detectedLanguage } = await transcribeBuffer(mp3Buffer);
    log(job, `✅ ${durationSec}s — lang:${detectedLanguage} — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude (com tradução automática se idioma ≠ PT-BR)
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText, detectedLanguage);
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

    // PASSO 5: Resumo com Claude (com tradução automática se necessário)
    log(job, '🤖 Claude resumo...');
    const detectedLang = (job.data.language as string | undefined) || 'pt';
    const bullets = await generateBullets(originalText, detectedLang);
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

    // PASSO 5: Resumo com Claude (com tradução automática se necessário)
    log(job, '🤖 Claude resumo...');
    const detectedLang = (job.data.language as string | undefined) || 'pt';
    const bullets = await generateBullets(originalText, detectedLang);
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
async function processEvolutionJob(job: Job) {
  const { userId, numberId, instanceName, senderPhone, senderName, messageData, durationHint } = job.data;

  log(job, `📥 Evolution API: ${senderName} (${senderPhone})`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo e buscar o número exato que recebeu o áudio
    const [balance, whatsappNumber] = await Promise.all([
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
      log(job, `⚠️  Saldo insuficiente: ${balance.availableMinutes.toFixed(2)} min — notificando`);
      if (instanceName) {
        await sendMessageViaEvolution(
          instanceName, senderPhone,
          '⚠️ Seu saldo de minutos acabou.\nAcesse zapscript.me para fazer upgrade e continuar recebendo transcrições.'
        ).catch(() => null);
      }
      return { skipped: true, reason: 'insufficient_balance' };
    }
    if (!whatsappNumber) {
      log(job, '⚠️  Número não encontrado no banco');
      return { skipped: true, reason: 'no_number' };
    }
    log(job, `✅ Saldo OK: ${balance.availableMinutes.toFixed(1)} min`);

    // PASSO 2: Baixar áudio via Evolution API (getBase64FromMediaMessage)
    const instName = instanceName ?? whatsappNumber.zapiInstanceId;
    if (!instName) throw new Error('instanceName não disponível para download do áudio');

    log(job, '⬇️  Baixando áudio via Evolution API...');
    const audioBuffer = await downloadAudioFromEvolution(instName, messageData);
    log(job, `✅ Baixado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter para MP3
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(audioBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 4: Transcrever com Whisper (Groq primary / OpenAI fallback)
    log(job, '🎙️  Whisper API (PT-BR)...');
    const { text: originalText, durationSec: whisperDuration } = await transcribeBuffer(mp3Buffer);
    const durationSec = whisperDuration > 0 ? whisperDuration : Math.max(1, durationHint || 1);
    // Detectar idioma via Whisper response (stored on verbose_json) — fallback 'pt'
    const detectedLanguage = (job.data.language as string | undefined) || 'pt';
    log(job, `✅ ${durationSec}s — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude Haiku (com tradução automática se não PT-BR)
    log(job, '🤖 Claude Haiku resumo...');
    const bullets = await generateBullets(originalText, detectedLanguage);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Enviar resposta via Evolution API
    log(job, '📤 Enviando resposta via Evolution API...');
    const user    = await prisma.user.findUnique({ where: { id: userId } });
    const message = buildMessage(bullets, originalText, user?.refCode || '');

    // Modo privado: envia ao próprio número do usuário em vez do remetente.
    // Guard: só ativa modo privado se o phoneNumber já foi resolvido (≠ 'pending').
    const isPrivate   = whatsappNumber.privateMode === true
                        && !!whatsappNumber.phoneNumber
                        && whatsappNumber.phoneNumber !== 'pending';
    const targetPhone = isPrivate ? whatsappNumber.phoneNumber : senderPhone;
    const privMsg     = isPrivate
      ? message + `\n\n💬 *Responder:* https://wa.me/${senderPhone.replace(/\D/g, '')}`
      : message;

    await sendMessageViaEvolution(instName, targetPhone, privMsg);
    log(job, `✅ Mensagem enviada ${isPrivate ? `(privado → ${targetPhone})` : 'na conversa'}`);

    // PASSO 6.5: Marcar conversa como não lida
    await markChatAsUnread(instName, senderPhone);

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
      source: 'whatsapp-evolution',
    });

    // PASSO 8: Notificar dashboard via Socket.IO (fire-and-forget)
    const apiUrl      = process.env.API_URL?.replace(/\/$/, '');
    const intToken    = process.env.INTERNAL_TOKEN;
    if (apiUrl && intToken) {
      fetch(`${apiUrl}/internal/emit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': intToken },
        body: JSON.stringify({
          userId,
          event: 'transcription_ready',
          data:  { transcriptionId: transcription.id, numberId: whatsappNumber.id, durationSec, senderName },
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);  // não bloqueia o pipeline
    }

    log(job, `✅ Concluído via Evolution API`);
    return { transcriptionId: transcription.id };

  } catch (err) {
    log(job, `❌ Erro Evolution: ${(err as Error).message}`);
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
  if (source === 'whatsapp-evolution') return processEvolutionJob(job);
  // transcribe-official = WhatsApp Cloud API (Meta) — pipeline principal
  return processOfficialWhatsAppJob(job);
}

// ─────────────────────────────────────────────────────────────────
//  WORKER SETUP
// ─────────────────────────────────────────────────────────────────
// Concorrência configurável via env — padrão 2 para Render free (512MB).
// No plano Starter/Standard, aumente para 4-8 conforme RAM disponível.
// WORKER_CONCURRENCY=4 no painel Render → sem redeploy.
const WORKER_CONCURRENCY  = parseInt(process.env.WORKER_CONCURRENCY  || '2');
const WORKER_LOCK_MINUTES = parseInt(process.env.WORKER_LOCK_MINUTES || '5');

const worker = new Worker('transcriptions', routeJob, {
  connection:      redis,
  concurrency:     WORKER_CONCURRENCY,
  lockDuration:    WORKER_LOCK_MINUTES * 60_000,  // Whisper pode demorar em áudios longos
  lockRenewTime:   Math.floor(WORKER_LOCK_MINUTES * 60_000 / 2),
  stalledInterval: 30_000,
  maxStalledCount: 2,         // 2 stalls antes de marcar como falha (evita falso positivo em restart)
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

// ─────────────────────────────────────────────────────────────────
//  CRON — Service Health Checker (#6 + #4)
//  Verifica saúde dos serviços a cada 5 minutos e persiste no DB.
//  Se thresholds de alerta forem excedidos, envia notificação via WhatsApp.
// ─────────────────────────────────────────────────────────────────
const HEALTH_SERVICES = ['db', 'redis', 'queue', 'whatsapp', 'groq'] as const;

async function checkAndLogServiceHealth() {
  const now = new Date();

  // ── DB ──────────────────────────────────────────────────────────
  async function checkDb() {
    const t = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: null };
    }
  }

  // ── Redis ────────────────────────────────────────────────────────
  async function checkRedis() {
    const t = Date.now();
    try {
      await redis.ping();
      return { status: 'up', latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: null };
    }
  }

  // ── BullMQ queue ─────────────────────────────────────────────────
  async function checkQueue() {
    const t = Date.now();
    try {
      const { Queue: BQueue } = await import('bullmq');
      const q = new BQueue('transcription', { connection: redis });
      const [waiting, active, failed] = await Promise.all([q.getWaitingCount(), q.getActiveCount(), q.getFailedCount()]);
      await q.close();
      // Degraded if too many waiting or failed
      const status = failed > 20 || waiting > 50 ? 'degraded' : 'up';
      return { status, latencyMs: Date.now() - t, waiting, active, failed };
    } catch {
      return { status: 'down', latencyMs: null };
    }
  }

  // ── Evolution API / WhatsApp ──────────────────────────────────────
  async function checkWhatsapp() {
    const t = Date.now();
    try {
      const evolutionUrl = process.env.EVOLUTION_API_URL;
      if (!evolutionUrl) return { status: 'degraded', latencyMs: null };
      const res = await fetch(`${evolutionUrl.replace(/\/$/, '')}/instance/fetchInstances`, {
        headers: { apikey: process.env.EVOLUTION_API_KEY || '' },
        signal:  AbortSignal.timeout(5000),
      });
      const status = res.ok ? 'up' : 'degraded';
      return { status, latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: null };
    }
  }

  // ── Groq API ─────────────────────────────────────────────────────
  async function checkGroq() {
    const t = Date.now();
    if (!process.env.GROQ_API_KEY) return { status: 'degraded', latencyMs: null };
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        signal:  AbortSignal.timeout(5000),
      });
      return { status: res.ok ? 'up' : 'degraded', latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: null };
    }
  }

  try {
    const [db, redisR, queue, whatsapp, groq] = await Promise.allSettled([
      checkDb(), checkRedis(), checkQueue(), checkWhatsapp(), checkGroq(),
    ]);

    const results: Record<string, { status: string; latencyMs: number | null }> = {
      db:        db.status        === 'fulfilled' ? db.value        : { status: 'down', latencyMs: null },
      redis:     redisR.status    === 'fulfilled' ? redisR.value    : { status: 'down', latencyMs: null },
      queue:     queue.status     === 'fulfilled' ? queue.value     : { status: 'down', latencyMs: null },
      whatsapp:  whatsapp.status  === 'fulfilled' ? whatsapp.value  : { status: 'down', latencyMs: null },
      groq:      groq.status      === 'fulfilled' ? groq.value      : { status: 'down', latencyMs: null },
    };

    // Persiste logs (fire-and-forget individual inserts em lote)
    await prisma.$transaction(
      Object.entries(results).map(([service, r]) =>
        (prisma as any).serviceStatusLog.create({
          data: { service, status: r.status, latencyMs: r.latencyMs, checkedAt: now },
        })
      )
    );

    // Limpa logs > 30 dias para não encher o BD
    await (prisma as any).serviceStatusLog.deleteMany({
      where: { checkedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    });

    // ── Alertas automáticos (#4) ─────────────────────────────────
    const alertConfigs = await (prisma as any).adminAlertConfig.findMany();
    const cfg: Record<string, any> = Object.fromEntries(alertConfigs.map((r: any) => [r.key, r.value]));

    const alertPhone = cfg.alertPhone && cfg.alertPhone !== 'null' ? String(cfg.alertPhone) : null;
    const queueMax   = Number(cfg.queueMaxWaiting) || 20;
    const queueData  = results.queue as any;

    const issues: string[] = [];
    if (results.db.status       === 'down')     issues.push('❌ Banco de dados offline!');
    if (results.redis.status    === 'down')     issues.push('❌ Redis offline!');
    if (results.whatsapp.status === 'down')     issues.push('⚠️ Evolution API/WhatsApp offline!');
    if (queueData?.waiting      > queueMax)    issues.push(`⚠️ Fila com ${queueData.waiting} jobs aguardando (limite: ${queueMax})`);
    if (queueData?.failed       > 20)           issues.push(`❌ ${queueData.failed} jobs com falha na fila`);

    if (issues.length > 0 && alertPhone) {
      const message = `🚨 *ZapScript Admin — Alerta* 🚨\n\n${issues.join('\n')}\n\n⏰ ${now.toLocaleString('pt-BR')}`;
      try {
        // Usa o mesmo número remetente dos convites para enviar alerta
        const senderNumber = await prisma.whatsappNumber.findFirst({
          where:  { status: 'connected', zapiInstanceId: { not: null } },
          select: { zapiInstanceId: true },
        });
        if (senderNumber?.zapiInstanceId) {
          const { sendText } = await import('./services/evolution');
          await sendText(senderNumber.zapiInstanceId, alertPhone, message);
          logger.info({ issues }, '[HealthChecker] Alerta WhatsApp enviado');
        }
      } catch (e: any) {
        logger.error(`[HealthChecker] Falha ao enviar alerta: ${e.message}`);
      }
    }

    const downCount = Object.values(results).filter(r => r.status === 'down').length;
    if (downCount > 0) {
      logger.warn(`[HealthChecker] ${downCount} serviço(s) offline: ${Object.entries(results).filter(([, r]) => r.status === 'down').map(([s]) => s).join(', ')}`);
    }
  } catch (err: any) {
    logger.error(`[HealthChecker] Erro ao verificar saúde: ${err.message}`);
  }
}

// Executa na inicialização e a cada 5 minutos
checkAndLogServiceHealth();
setInterval(checkAndLogServiceHealth, 5 * 60 * 1000);

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
