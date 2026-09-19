import { Worker, Job } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { transcribeAudio } from './services/whisper';
import { convertToMp3 } from './services/audio';
import { buildModelChain, callAiWithFallback, ModelSpec } from './services/ai-fallback';

/**
 * ZapScript ZapScreve — worker do job 'process' (fila 'zapscreve').
 *
 * Áudio do DONO vira texto refinado, pra ser enviado no lugar do áudio (ver
 * ESCOPO_ZAPSCREVE.md). Direção contrária da transcrição de entrada
 * (whisper.ts já reaproveitado 100%): aqui não há "resposta ao cliente" —
 * só transcrever o que o dono falou e limpar gramática/pontuação/acentuação
 * (Fase 1 — "modo rápido"). Modo Copiloto (tom aprendido) fica pra Fase 2,
 * quando o CopilotoStyleProfile existir.
 *
 * O ENVIO em si não passa por aqui — é síncrono na API (POST
 * /zapscreve/:id/send), igual ao Copiloto (copiloto-actions.ts). Este
 * arquivo só transcreve e refina.
 */

const ZAPSCREVE_UPLOADS_BUCKET = 'zapscreve-uploads';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    realtime: { transport: ws as any },
    auth:     { persistSession: false, autoRefreshToken: false },
  });
}

async function downloadAudio(storageKey: string): Promise<Buffer> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase não configurado no worker (SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  const { data, error } = await sb.storage.from(ZAPSCREVE_UPLOADS_BUCKET).download(storageKey);
  if (error) throw new Error(`Supabase Storage download falhou (${ZAPSCREVE_UPLOADS_BUCKET}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

const REFINE_MODELS: ModelSpec[] = buildModelChain({
  anthropic: [process.env.ZAPSCREVE_REFINE_MODEL || 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openaiModel: process.env.ZAPSCREVE_REFINE_MODEL_OPENAI || 'gpt-4o-mini',
  groqModel:   process.env.ZAPSCREVE_REFINE_MODEL_GROQ   || 'llama-3.3-70b-versatile',
  geminiModel: process.env.ZAPSCREVE_REFINE_MODEL_GEMINI || 'gemini-2.5-flash',
});

const REFINE_SYSTEM_PROMPT = `Você recebe a transcrição de um áudio que o DONO de um número de WhatsApp
gravou para SI MESMO, pensando em mandar como mensagem de texto no lugar do áudio.

Sua ÚNICA tarefa é limpar a ESCRITA, nunca o CONTEÚDO:
- Corrigir gramática, pontuação e acentuação.
- Remover vícios de fala orais ("é...", "tipo", "né", "aí", "hã", repetições, gaguejo).
- Organizar em frases e parágrafos naturais de mensagem de WhatsApp (não um bloco só).

PROIBIDO, sem exceção:
- Mudar o sentido do que foi dito.
- Acrescentar qualquer informação, número, nome, preço ou prazo que não esteja no áudio.
- Remover conteúdo relevante (só remova vício de fala, nunca fato).
- Responder à mensagem, comentar ou fazer perguntas — você só reescreve.

Se o texto vier vazio, cortado no meio ou sem sentido nenhum, devolva-o exatamente como recebeu
(não tente adivinhar o que faltou).

Responda em JSON, só isto: {"text": "<texto revisado>"}`;

/** Todas as sequências de dígitos do texto (preço, prazo, telefone, quantidade) — o que a Fase 1 nunca pode alterar. */
function extractDigitSequences(text: string): string[] {
  return (text.match(/\d+/g) || []).sort();
}

/**
 * Guardrail determinístico (ESCOPO_ZAPSCREVE.md §9): o modo rápido só pode
 * mexer em FORMA. Se o refino mudou algum número (preço, prazo, quantidade)
 * ou alterou demais o tamanho do texto (sinal de ter cortado ou inventado
 * conteúdo), a saída não é confiável — cai pro texto bruto do Whisper em vez
 * de arriscar mudar o que o dono quis dizer.
 */
function passesEntityGuardrail(rawText: string, refinedText: string): boolean {
  if (!refinedText.trim()) return false;

  const rawNumbers = extractDigitSequences(rawText);
  const refinedNumbers = extractDigitSequences(refinedText);
  if (JSON.stringify(rawNumbers) !== JSON.stringify(refinedNumbers)) return false;

  const rawLen = rawText.trim().length;
  const refinedLen = refinedText.trim().length;
  if (rawLen > 20 && (refinedLen < rawLen * 0.4 || refinedLen > rawLen * 2.5)) return false;

  return true;
}

async function refineQuickText(rawText: string, userId: string): Promise<string> {
  try {
    const parsed = await callAiWithFallback({
      models:   REFINE_MODELS,
      system:   REFINE_SYSTEM_PROMPT,
      user:     rawText,
      maxTokens: 1024,
      userId,
      feature:  'zapscreve_refine',
      label:    '[ZapScreve]',
    });
    const refined = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
    if (passesEntityGuardrail(rawText, refined)) return refined;
    logger.warn('[ZapScreve] Guardrail rejeitou o refino (número mudou ou tamanho suspeito) — usando texto bruto');
    return rawText;
  } catch (err: any) {
    logger.warn(`[ZapScreve] Refino falhou, usando texto bruto: ${err.message}`);
    return rawText;
  }
}

interface ZapScreveJobData {
  draftId: string;
  userId: string;
  numberId: string;
  storageKey: string;
}

async function processZapScreveJob(job: Job<ZapScreveJobData>) {
  const { draftId, userId, storageKey } = job.data;
  logger.info(`[ZapScreve] Job ${draftId} — iniciando`);

  try {
    const rawBuffer = await downloadAudio(storageKey);
    const ext = (storageKey.split('.').pop() || 'webm').toLowerCase();
    const mp3Buffer = await convertToMp3(rawBuffer, ext);

    const { text: rawText, durationSec } = await transcribeAudio(mp3Buffer, {
      userId, feature: 'zapscreve_transcription',
    });

    if (!rawText.trim()) {
      throw new Error('Nenhuma fala detectada no áudio');
    }

    const quickText = await refineQuickText(rawText, userId);

    await prisma.zapScreveDraft.update({
      where: { id: draftId },
      data:  { status: 'ready', rawText, quickText, durationSec },
    });

    logger.info(`[ZapScreve] Job ${draftId} ✅ concluído (${durationSec}s)`);
    return { draftId };
  } catch (err: any) {
    logger.error(`[ZapScreve] Job ${draftId} ❌ falhou: ${err.message}`);
    await prisma.zapScreveDraft.update({
      where: { id: draftId },
      data:  { status: 'error', errorMessage: err.message.slice(0, 500) },
    }).catch(() => null);
    throw err;
  }
}

const zapscreveWorker = new Worker('zapscreve', processZapScreveJob, {
  connection:      redis as any,
  concurrency:     parseInt(process.env.ZAPSCREVE_WORKER_CONCURRENCY || '2'),
  lockDuration:    5 * 60_000,
  lockRenewTime:   Math.floor(5 * 60_000 / 2),
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

zapscreveWorker.on('completed', (job) => {
  logger.info(`[ZapScreveWorker] ✅ Job ${job.id} concluído`);
});

zapscreveWorker.on('failed', (job, err) => {
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 2;
  logger.error(`[ZapScreveWorker] ❌ Job ${job?.id} falhou (tentativa ${attempts}/${maxAttempts}): ${err.message}`);
});

zapscreveWorker.on('stalled', (jobId) => {
  logger.warn(`[ZapScreveWorker] ⚠️ Job ${jobId} ficou stalled`);
});

zapscreveWorker.on('error', (err) => {
  logger.error('[ZapScreveWorker] Erro interno', { err: err.message });
});

export { zapscreveWorker, passesEntityGuardrail };
