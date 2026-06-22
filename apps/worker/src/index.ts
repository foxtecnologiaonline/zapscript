import 'dotenv/config';
import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { convertToMp3 } from './services/audio';
import { downloadAudioFromMeta, sendMessageToMeta } from './services/whatsapp-official';
import { downloadAudioFromTwilio, sendMessageViaTwilio } from './services/twilio';
import { downloadAudioFromEvolution, sendMessageViaEvolution, markChatAsUnread } from './services/evolution';
import { encryptStr, encryptArr, decryptStr, decryptArr } from './services/encryption';
import { sendEmail } from './services/mailer';
import { logger } from './lib/logger';
// Baileys removido — agora usando Meta Cloud API exclusivamente

// ── Supabase Storage — download/delete de áudios temporários ─────────────────
const AUDIO_TEMP_BUCKET = 'audio-temp';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  // Node.js 20 não tem WebSocket nativo — passar ws como transport
  // Usamos Supabase apenas para Storage, Realtime é desabilitado
  return createClient(url, key, {
    realtime: { transport: ws as any },
    auth:     { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Baixa o buffer de áudio do Supabase Storage usando a storage key.
 * Chamado pelo worker quando o job contém `storageKey` em vez de `audioBase64`.
 */
async function downloadFromStorage(storageKey: string): Promise<Buffer> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase não configurado no worker (SUPABASE_URL / SUPABASE_SERVICE_KEY)');

  const { data, error } = await sb.storage.from(AUDIO_TEMP_BUCKET).download(storageKey);
  if (error) throw new Error(`Supabase Storage download falhou: ${error.message}`);

  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Remove arquivo temporário do Supabase Storage após processamento.
 * Fire-and-forget — falha silenciosa para não afetar o pipeline.
 */
async function deleteFromStorage(storageKey: string): Promise<void> {
  try {
    const sb = getSupabaseClient();
    if (!sb) return;
    await sb.storage.from(AUDIO_TEMP_BUCKET).remove([storageKey]);
  } catch { /* non-fatal */ }
}

/** Escapa HTML para templates de e-mail (C1 — evita HTML injection via nome do usuário) */
function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

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

// ── Prompts para Whisper ────────────────────────────────────────────────────
// IMPORTANTE: o prompt do Whisper NÃO é uma instrução — é uma amostra de
// estilo que orienta vocabulário e formatação. Frases imperativas como
// "Reproduzir exatamente o que foi dito" causam alucinação: quando o áudio
// é silencioso ou ininteligível, o Whisper "preenche" com o texto do prompt.
// Usar frases curtas e naturais que soem como fala real em PT-BR.

// Priming coloquial para áudios de WhatsApp
const PT_BR_PROMPT = 'Tá bom, então. Deixa eu te falar uma coisa.';

// Priming formal/neutro para uploads manuais
const PT_BR_JURIDICAL_PROMPT = 'Bom dia. Então, o que aconteceu foi o seguinte.';

// ── Detecção de alucinação do Whisper ───────────────────────────────────────
// Retorna true se o texto for provavelmente alucinado (prompt repetido,
// saída suspeitamente curta para a duração do áudio, padrões repetitivos).
function isWhisperHallucination(text: string, durationSec: number): boolean {
  if (!text || text.length < 3) return true;

  // Padrões conhecidos de alucinação do Whisper
  const HALLUCINATION_PATTERNS = [
    /reproduzir exatamente o que foi dito/i,
    /transcrição literal e fiel/i,
    /transcrição em português brasileiro/i,
    /sem correções ou omissões/i,
    /thank you for watching/i,
    /thanks for watching/i,
    /please subscribe/i,
  ];
  if (HALLUCINATION_PATTERNS.some(p => p.test(text))) return true;

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Texto excessivamente curto para a duração (< 2 palavras por minuto de áudio)
  const minWords  = Math.floor(durationSec / 60) * 2;
  if (durationSec > 30 && wordCount < Math.max(minWords, 3)) return true;

  // Densidade impossível de fala: humano fala ~2–3 palavras/seg (rápido ~4).
  // Áudio de 2s com 50 palavras (25 p/seg) é alucinação clássica do Whisper em
  // ruído/silêncio. Margem generosa de 6 p/seg + piso absoluto de 8 palavras
  // para não penalizar respostas curtas e legítimas ("Socorro!", "Tá bom, valeu").
  const maxPlausibleWords = Math.max(8, durationSec * 6);
  if (wordCount > maxPlausibleWords) return true;

  // Repetição patológica: mesma palavra/frase curta repetida muitas vezes
  // (ex.: "obrigado obrigado obrigado…"), outro padrão típico de alucinação.
  if (wordCount >= 8) {
    const words  = text.toLowerCase().split(/\s+/).filter(Boolean);
    const unique = new Set(words).size;
    if (unique / words.length < 0.35) return true;
  }

  return false;
}

// Segmento de fala retornado pelo Whisper verbose_json
interface WhisperSegment {
  start:  number;
  end:    number;
  text:   string;
}

/** Bucket Supabase Storage para MP3s de laudos jurídicos (permanente) */
const AUDIO_JURIDICAL_BUCKET = 'audio-juridical';

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
        temperature:     0,   // determinístico — reduz alucinação em ruído/silêncio
        prompt:          PT_BR_PROMPT,
      } as any);
      const text = result.text?.trim();
      if (!text) throw new Error('Groq Whisper retornou texto vazio');
      const durationSec = Math.max(1, Math.round((result as any).duration ?? 0));
      const language    = (result as any).language || 'pt';
      if (isWhisperHallucination(text, durationSec)) {
        throw new Error(`Groq retornou alucinação (prompt repetido) — tentando OpenAI`);
      }
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
    temperature:     0,   // determinístico — reduz alucinação em ruído/silêncio
    prompt:          PT_BR_PROMPT,
  } as any);
  const text = result.text?.trim();
  if (!text) throw new Error('Whisper retornou texto vazio');
  const durationSec = Math.max(1, Math.round((result as any).duration ?? 0));
  const language    = (result as any).language || 'pt';
  if (isWhisperHallucination(text, durationSec)) {
    throw new Error('Whisper retornou alucinação — áudio possivelmente silencioso ou corrompido');
  }
  logger.info(`[Whisper] OpenAI whisper-1 — ${durationSec}s — lang:${language}`);
  return { text, durationSec, language };
}

/**
 * Versão estendida de transcribeBuffer para uploads manuais (modo jurídico).
 * Usa prompt de transcrição literal e retorna os segments do Whisper.
 * Segments permitem gerar transcrições com marcação temporal precisa.
 */
async function transcribeBufferFull(mp3Buffer: Buffer): Promise<{
  text: string;
  durationSec: number;
  language: string;
  segments: WhisperSegment[];
}> {
  const audioFile = new File([mp3Buffer], 'audio.mp3', { type: 'audio/mpeg' });

  const parseSegments = (raw: any[]): WhisperSegment[] =>
    (raw || []).map(s => ({
      start: typeof s.start === 'number' ? s.start : 0,
      end:   typeof s.end   === 'number' ? s.end   : 0,
      text:  (s.text || '').trim(),
    })).filter(s => s.text.length > 0);

  // ── Primário: Groq ────────────────────────────────────────────────────
  if (groq) {
    try {
      const result = await groq.audio.transcriptions.create({
        file:            audioFile,
        model:           'whisper-large-v3-turbo',
        language:        'pt',
        response_format: 'verbose_json',
        temperature:     0,   // determinístico — reduz alucinação em ruído/silêncio
        prompt:          PT_BR_JURIDICAL_PROMPT,
      } as any);
      const text = result.text?.trim();
      if (!text) throw new Error('Groq Whisper retornou texto vazio');
      const durationSec = Math.max(1, Math.round((result as any).duration ?? 0));
      const language    = (result as any).language || 'pt';
      if (isWhisperHallucination(text, durationSec)) {
        throw new Error('Groq retornou alucinação — tentando OpenAI');
      }
      const segments = parseSegments((result as any).segments);
      logger.info(`[Whisper] Groq juridical — ${durationSec}s — ${segments.length} segmentos`);
      return { text, durationSec, language, segments };
    } catch (err: any) {
      logger.warn(`[Whisper] Groq juridical falhou, OpenAI fallback: ${err.message}`);
    }
  }

  // ── Fallback: OpenAI whisper-1 ────────────────────────────────────────
  const result = await openai.audio.transcriptions.create({
    file:            audioFile,
    model:           'whisper-1',
    language:        'pt',
    response_format: 'verbose_json',
    temperature:     0,   // determinístico — reduz alucinação em ruído/silêncio
    prompt:          PT_BR_JURIDICAL_PROMPT,
  } as any);
  const text = result.text?.trim();
  if (!text) throw new Error('Whisper retornou texto vazio');
  const durationSec = Math.max(1, Math.round((result as any).duration ?? 0));
  const language    = (result as any).language || 'pt';
  if (isWhisperHallucination(text, durationSec)) {
    throw new Error('Whisper retornou alucinação — áudio possivelmente silencioso ou ininteligível');
  }
  const segments = parseSegments((result as any).segments);
  logger.info(`[Whisper] OpenAI juridical — ${durationSec}s — ${segments.length} segmentos`);
  return { text, durationSec, language, segments };
}

/**
 * Constrói transcrição com marcação temporal a partir dos segmentos do Whisper.
 *
 * Formato: "  N  [MM:SS] Texto do segmento."
 * (N = número de linha, [HH:MM:SS] para áudios ≥ 1h)
 *
 * Cada linha representa um segmento de fala distinto — ideal para uso jurídico
 * pois permite localizar qualquer trecho no áudio de referência pelo timestamp.
 */
function buildTimestampedTranscript(segments: WhisperSegment[], totalDuration: number): string {
  const useHours = totalDuration >= 3600;

  const fmt = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (useHours) {
      return `[${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}]`;
    }
    return `[${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}]`;
  };

  if (!segments.length) return '';

  return segments
    .map((seg, i) => `${String(i + 1).padStart(4, ' ')}  ${fmt(seg.start)}  ${seg.text}`)
    .join('\n');
}

/**
 * Modo de resumo baseado no tamanho do áudio:
 * - < 80 palavras  → 'tldr'    (1 frase telegráfica integrada no cabeçalho)
 * - >= 80 palavras → 'bullets' (extração cirúrgica de fatos concretos)
 */
function audioMode(text: string): 'tldr' | 'bullets' {
  return text.trim().split(/\s+/).length < 80 ? 'tldr' : 'bullets';
}

/**
 * Quantos bullets extrair no modo 'bullets':
 * - 80-220 palavras → 2
 * - > 220 palavras  → 3
 */
function bulletCount(text: string): number {
  const words = text.trim().split(/\s+/).length;
  if (words > 220) return 3;
  return 2;
}

/**
 * Gera resumo com modo adaptado ao tamanho do áudio:
 *
 * TLDR (< 80 palavras): uma frase telegráfica de até 10 palavras,
 *   sem prefixo "•", integrada diretamente no cabeçalho da mensagem.
 *
 * Bullets (>= 80 palavras): extração cirúrgica de fatos concretos
 *   (datas, valores, decisões, ações) em 2-3 tópicos curtos.
 *
 * Cadeia: claude-haiku-4-5 → claude-3-5-haiku → claude-3-haiku → gpt-4o-mini → placeholder.
 */
async function generateBullets(originalText: string, language?: string): Promise<string[]> {
  const mode        = audioMode(originalText);
  const count       = bulletCount(originalText);
  const needsTransl = language && language !== 'pt' && language !== 'pt-BR' && language !== 'pt-br';
  const ptNote      = needsTransl ? ' Responda sempre em português brasileiro (PT-BR).' : '';

  let systemMsg: string;
  let userMsg: string;

  if (mode === 'tldr') {
    // ── Modo TLDR: 1 frase direta, sem prefixo ───────────────────────────────
    systemMsg = `Resuma o áudio em UMA frase telegráfica em PT-BR.${ptNote}

Regras:
- Máximo 10 palavras
- Comece com o ponto mais importante
- Use dois-pontos para separar contexto de detalhe quando útil
- Sem artigos desnecessários, sem "então", "né", "tipo"
- Responda apenas com a frase. Sem "• ", sem prefixo, sem explicação.

CRÍTICO — fidelidade ao conteúdo:
- NUNCA adicione, invente ou suponha informação que não está no áudio.
- NÃO dramatize, NÃO intensifique, NÃO interprete intenção ou urgência.
- Se o áudio é muito curto (1-3 palavras), repita-o quase literal, sem inflar.
- Use apenas o que foi dito. Nada de adjetivos ou contexto que não esteja na fala.

Exemplos:
"então a reunião das 10 foi remarcada pra 14h na sala 2" → Reunião remarcada: 14h sala 2
"queria saber se você pode me ajudar com o relatório até sexta" → Relatório: ajuda necessária até sexta
"só passando pra avisar que o pedido chegou" → Pedido chegou
"Socorro!" → Socorro!
"oi, tudo bem?" → Oi, tudo bem?`;

    userMsg = `Em até 10 palavras:\n\n${originalText}`;

  } else {
    // ── Modo Bullets: extração cirúrgica de fatos concretos ──────────────────
    systemMsg = `Extraia apenas fatos concretos de áudios de WhatsApp em PT-BR.${ptNote}

Inclua: datas, horários, nomes, valores, decisões, ações pendentes.
Exclua: opiniões, contexto redundante, palavras de preenchimento.
Cada tópico: verbo ou substantivo de ação + dado essencial. Máx 8 palavras.
Formato: "• " no início de cada linha. Sem título, sem explicação.

Exemplos:
"vou passar aí sexta às 15h pra assinar o contrato" → • Visita sexta 15h — assinar contrato
"precisa que você mande o orçamento até amanhã de manhã" → • Enviar orçamento: até amanhã cedo`;

    userMsg = `Extraia em ${count} ${count === 1 ? 'tópico' : 'tópicos'} (máx 8 palavras cada):\n\n${originalText}`;
  }

  // ── Tentativa 1: Claude ───────────────────────────────────────────────────
  for (const model of ['claude-haiku-4-5', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307']) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens:  200,
        temperature: 0,   // determinístico — evita embelezamento/dramatização
        system:      systemMsg,
        messages:    [{ role: 'user', content: userMsg }],
      });
      const raw     = (res.content[0] as any).text?.trim() || '';
      const bullets = mode === 'tldr' ? parseTldr(raw) : parseBullets(raw, count);
      if (bullets.length > 0) {
        logger.info(`[Resumo] ${model} ✅ (modo: ${mode})`);
        return bullets;
      }
    } catch (err: any) {
      logger.warn(`[Resumo] ${model} falhou (${err.status ?? err.message}) — tentando próximo`);
    }
  }

  // ── Tentativa 2: OpenAI gpt-4o-mini ──────────────────────────────────────
  try {
    const res = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      max_tokens:  200,
      temperature: 0,   // determinístico — evita embelezamento/dramatização
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg   },
      ],
    });
    const raw     = res.choices[0]?.message?.content?.trim() || '';
    const bullets = mode === 'tldr' ? parseTldr(raw) : parseBullets(raw, count);
    if (bullets.length > 0) {
      logger.info(`[Resumo] gpt-4o-mini ✅ (modo: ${mode})`);
      return bullets;
    }
    logger.warn(`[Resumo] gpt-4o-mini respondeu vazio: "${raw.slice(0, 100)}"`);
  } catch (err: any) {
    logger.error(`[Resumo] gpt-4o-mini falhou: ${err.message}`);
  }

  // ── Fallback final ────────────────────────────────────────────────────────
  logger.error('[Resumo] Todos os modelos falharam — placeholder');
  return ['Resumo não disponível'];
}

/**
 * Parseia resposta TLDR — extrai a primeira frase não-vazia,
 * removendo qualquer prefixo de bullet que o modelo insistir em colocar.
 */
function parseTldr(raw: string): string[] {
  const line = raw
    .split('\n')
    .map(l => l.replace(/^[•\-–—*\d.)\s]+/, '').trim())
    .find(l => l.length > 3);
  return line ? [line] : [];
}

/** Parseia bullets da resposta — aceita "• ", "- ", "1. " e texto puro */
function parseBullets(raw: string, count: number): string[] {
  if (!raw) return [];
  // Preferência: linhas com "• "
  const withDot = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('• '))
    .map(l => l.replace(/^•\s*/, '').trim())
    .filter(Boolean);
  if (withDot.length > 0) return withDot.slice(0, count);

  // Fallback: remover qualquer prefixo de bullet (-  –  1.  *  etc.)
  const lines = raw
    .split('\n')
    .map(l => l.replace(/^[-–—*\d.)\s]+/, '').trim())
    .filter(l => l.length > 8);
  return lines.slice(0, count);
}

/** @deprecated use parseBullets */
function parseFallbackLines(raw: string, count: number): string[] {
  return parseBullets(raw, count);
}

/**
 * Saldo total disponível = pool do plano (availableMinutes) + saldo extra válido
 * (extraMinutes, contabilizado só se extraExpiresAt ainda não passou).
 */
function availableTotal(balance: { availableMinutes: number; extraMinutes?: number | null; extraExpiresAt?: Date | null } | null): number {
  if (!balance) return 0;
  const extraValid = balance.extraExpiresAt && balance.extraExpiresAt > new Date() ? (balance.extraMinutes ?? 0) : 0;
  return balance.availableMinutes + extraValid;
}

/**
 * Salva transcrição no banco e debita minutos atomicamente.
 * Usa transação interativa para garantir que o débito só ocorre
 * se houver saldo suficiente (previne race condition).
 */
async function saveTranscription(params: {
  userId: string; numberId: string | null; contactPhone: string; contactName?: string;
  filename?: string; durationSec: number; originalText: string; bullets: string[]; source: string;
}) {
  const { userId, numberId, contactPhone, contactName, filename, durationSec, originalText, bullets, source } = params;
  // Garantir que numberId seja null (não 'unknown') para não violar FK do Prisma
  const safeNumberId = (numberId && numberId !== 'unknown') ? numberId : null;
  const durationMin = Math.round((durationSec / 60) * 100) / 100;

  const transcription = await prisma.$transaction(async (tx) => {
    // Débito em dois buckets: primeiro o pool do plano (availableMinutes), depois o
    // saldo extra válido (extraMinutes, se não expirado). Dentro da transação para consistência.
    const nowDebit = new Date();
    const bal = await tx.minuteBalance.findUnique({ where: { userId } });
    if (!bal) throw new Error('Saldo não encontrado no momento do débito');

    const extraValid = bal.extraExpiresAt && bal.extraExpiresAt > nowDebit ? bal.extraMinutes : 0;
    const totalAvail = bal.availableMinutes + extraValid;
    if (totalAvail + 1e-9 < durationMin) {
      throw new Error(`Saldo insuficiente no momento do débito (${durationMin.toFixed(2)} min)`);
    }

    const fromPlan  = Math.min(bal.availableMinutes, durationMin);
    const fromExtra = Math.round((durationMin - fromPlan) * 100) / 100;
    await tx.minuteBalance.update({
      where: { userId },
      data: {
        availableMinutes:   { decrement: fromPlan },
        ...(fromExtra > 0 ? { extraMinutes: { decrement: fromExtra } } : {}),
        accumulatedMinutes: { increment: durationMin },
      },
    });

    // Criptografar campos sensíveis antes de salvar
    const encPhone   = encryptStr(contactPhone);
    const encText    = encryptStr(originalText);
    const encBullets = encryptArr(bullets);

    const transcr = await tx.transcription.create({
      data: { userId, numberId: safeNumberId, contactPhone: encPhone, contactName: contactName ?? null, filename: filename ?? null, durationSec, originalText: encText, summaryBullets: encBullets, confidenceScore: 99.0, source },
    });

    const ops: Promise<any>[] = [
      tx.usageLog.create({
        data: { userId, transcriptionId: transcr.id, minutesUsed: durationMin },
      }),
    ];

    // Atualizar contadores do número só se tivermos um numberId válido
    if (safeNumberId) {
      ops.push(
        tx.whatsappNumber.update({
          where: { id: safeNumberId },
          data:  { messageCount: { increment: 1 }, minutesUsed: { increment: durationMin }, lastMessageAt: new Date() },
        })
      );
    }

    await Promise.all(ops);
    return transcr;
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

    // Enviar via WhatsApp (principal)
    await sendMessageViaEvolution(n.zapiInstanceId, n.phoneNumber, msgs[threshold]).catch(() => null);

    // Enviar via e-mail como fallback/reforço
    const userRecord = await (prisma as any).user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (userRecord?.email) {
      const APP_URL = process.env.APP_URL || 'https://zapscript.me';
      const emailMsgs: Record<number, { subject: string; body: string }> = {
        50: {
          subject: '📊 ZapScript — Você usou 50% dos seus minutos',
          body: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:16px">📊 Metade dos minutos usados</div>
            <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
              Olá${userRecord.name ? `, <strong>${escHtml(userRecord.name)}</strong>` : ''}!<br><br>
              Você já usou <strong>50% dos seus minutos</strong> do mês. Ainda há bastante — mas vale a pena ficar de olho.<br><br>
              Se quiser ampliar sua capacidade antes de chegar ao limite, acesse seus planos:
            </div>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/plano" style="background:#10b981;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Ver planos →</a>
            </div>
            <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
          </div>`,
        },
        80: {
          subject: '⚠️ ZapScript — 80% dos minutos usados — atenção!',
          body: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:16px">⚠️ Seus minutos estão quase no limite</div>
            <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
              Olá${userRecord.name ? `, <strong>${escHtml(userRecord.name)}</strong>` : ''}!<br><br>
              Você usou <strong>80% dos seus minutos</strong> — restam apenas 20%. Quando zerar, as transcrições são pausadas até o próximo ciclo.<br><br>
              Faça upgrade agora para não perder nenhum áudio importante:
            </div>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/plano" style="background:#f59e0b;color:#1c1204;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Fazer upgrade →</a>
            </div>
            <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
          </div>`,
        },
        100: {
          subject: '🔴 ZapScript — Minutos esgotados — transcrições pausadas',
          body: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:16px">🔴 Seus minutos acabaram</div>
            <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
              Olá${userRecord.name ? `, <strong>${escHtml(userRecord.name)}</strong>` : ''}!<br><br>
              Você atingiu <strong>100% dos seus minutos</strong> deste mês. As transcrições estão <strong>pausadas</strong> até o próximo ciclo ou até você fazer upgrade.<br><br>
              Para voltar a transcrever agora mesmo:
            </div>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/plano" style="background:#ef4444;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Desbloquear agora →</a>
            </div>
            <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
          </div>`,
        },
      };
      const em = emailMsgs[threshold];
      sendEmail(userRecord.email, em.subject, em.body).catch(() => null);
    }

    // Marcar alerta enviado para não repetir no mesmo ciclo
    await (prisma as any).minuteBalance.update({
      where: { userId },
      data:  { lastAlertSent: String(threshold) }, // schema: String?
    }).catch(() => null);

    logger.info(`[MinuteAlert] ✅ Alerta ${threshold}% enviado ao usuário ${userId} (WA + email)`);
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

/** Formata número de telefone BR: "5534917902​54" → "+55 34 9 1790-254" */
function fmtPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,5)} ${d.slice(5,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `+55 ${d.slice(0,2)} ${d.slice(2,3)} ${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `+55 ${d.slice(0,2)} ${d.slice(2,6)}-${d.slice(6)}`;
  return phone;
}

// Teto seguro de caracteres por mensagem do WhatsApp. Mensagens muito acima
// disso podem ser rejeitadas/truncadas pelo provedor; quebramos em partes.
const WHATSAPP_LIMIT = 4000;

/**
 * Divide um texto em partes de no máximo `firstMax` (1ª parte) / `restMax` (demais),
 * cortando preferencialmente em fim de frase e, na falta, no último espaço —
 * nunca no meio de uma palavra.
 */
function splitText(text: string, firstMax: number, restMax: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  let max  = firstMax;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max);              // preferir fim de frase
    if (cut < max * 0.6) cut = rest.lastIndexOf(' ', max); // senão, último espaço
    if (cut <= 0) cut = max;                            // sem espaço → corte duro
    else cut += 1;                                      // inclui o '.'/espaço no chunk atual
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
    max  = restMax;
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.length > 0 ? chunks : [''];
}

/**
 * Formata mensagem de resposta para o WhatsApp.
 *
 * Modo normal:
 *   🎙️ *Áudio de [nome]* • ⏱ [dur]
 *   📋 *Resumo* / bullets
 *   📝 *Transcrição*
 *   _Gerado por_ → *ZapScript.me* ⚡
 *
 * Modo Privado (Opção B):
 *   🔒 *Privado* | *[nome]* → você
 *   📱 +55 xx x xxxx-xxxx · ⏱ [dur]
 *   📋 *Resumo* / bullets
 *   📝 *Transcrição*
 *   ↩️ Responder: wa.me/[phone]
 *   _Gerado por_ → *ZapScript.me* ⚡
 */
function buildMessage(
  bullets:      string[],
  originalText: string,
  opts: {
    contactName?: string | null;
    durationSec?: number;
    isPrivate?: boolean;
    senderPhone?: string;
    isSelfNote?: boolean;       // áudio que o usuário encaminhou para o próprio número
    forwarded?: boolean;        // veio com selo de encaminhamento (forwardingScore)
    originPhone?: string | null;// remetente original (só existe via mensagem citada)
  } = {},
): string[] {
  const { contactName, durationSec, isPrivate, senderPhone, isSelfNote, forwarded, originPhone } = opts;

  const mode    = audioMode(originalText); // 'tldr' | 'bullets'
  const hasName = contactName && contactName !== 'manual' && contactName.trim().length > 0;
  const durStr  = durationSec && durationSec > 0
    ? `⏱ ${durationSec >= 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60 > 0 ? ` ${durationSec % 60}s` : ''}` : `${durationSec}s`}`
    : '';

  const FALLBACK       = ['Transcrição disponível', 'Resumo não disponível', 'Não foi possível'];
  const hasRealBullets = bullets.length > 0 && !bullets.some(b => FALLBACK.some(f => b.includes(f)));
  const tldr           = hasRealBullets && mode === 'tldr' ? bullets[0] : null;

  // ── Cabeçalho ──
  // Modo TLDR: frase integrada na mesma linha do cabeçalho → menos blocos, mais direto
  // Modo Bullets: cabeçalho simples + seção 📋 separada abaixo
  let header: string;
  if (isSelfNote) {
    // Áudio encaminhado/enviado pelo usuário ao próprio número (self-chat).
    // Origem só aparece quando o WhatsApp expõe `participant` (mensagem citada);
    // num encaminhamento puro o remetente original não vem — mostramos só o selo.
    const label    = forwarded ? '🔁 *Áudio encaminhado*' : '🎙️ *Sua nota de voz*';
    const origin   = originPhone ? ` de *${fmtPhone(originPhone)}*` : '';
    const tldrLine = tldr ? `\n→ ${tldr}` : '';
    header = `${label}${origin}${durStr ? ` • ${durStr}` : ''}${tldrLine}`;
  } else if (isPrivate && senderPhone) {
    const namePart  = hasName ? `*${contactName}*` : `*${fmtPhone(senderPhone)}*`;
    const phoneLine = `📱 ${fmtPhone(senderPhone)}${durStr ? ` · ${durStr}` : ''}`;
    const tldrLine  = tldr ? `\n↯ ${tldr}` : '';
    header = `🔒 *Privado* | ${namePart} → você\n${phoneLine}${tldrLine}`;
  } else if (tldr) {
    const nameStr = hasName ? `*${contactName}*` : '*Áudio*';
    header = `🎙️ ${nameStr}${durStr ? ` • ${durStr}` : ''}\n→ ${tldr}`;
  } else {
    const nameStr = hasName ? `Áudio de *${contactName}*` : '*Áudio*';
    header = `🎙️ ${nameStr}${durStr ? ` • ${durStr}` : ''}`;
  }

  // ── Seção de bullets (apenas no modo 'bullets') ──
  const pontoSection = hasRealBullets && mode === 'bullets'
    ? `\n\n📋 *Resumo*\n${bullets.map(b => `• ${b}`).join('\n')}`
    : '';

  // ── Rodapé ──
  // Modo privado responde ao remetente; self-note responde à origem quando ela existir.
  const replyTarget = isPrivate ? senderPhone : (isSelfNote ? originPhone : null);
  const replyLink = replyTarget
    ? `\n\n↩️ Responder: wa.me/${replyTarget.replace(/\D/g, '')}`
    : '';
  const footer = `${replyLink}\n\n_Gerado por_ → *ZapScript.me* ⚡`;

  // ── Transcrição COMPLETA, dividida em mensagens se exceder o teto do WhatsApp ──
  // A 1ª mensagem carrega cabeçalho + resumo + início da transcrição; as demais
  // continuam a transcrição. O rodapé fica só na última. Nada é truncado.
  const transcHeader = `\n\n📝 *Transcrição*\n`;
  const contHeader   = `📝 *Transcrição (cont.)*\n`;
  const head         = header + pontoSection + transcHeader;

  const firstBudget = Math.max(500, WHATSAPP_LIMIT - head.length - footer.length);
  const restBudget  = Math.max(500, WHATSAPP_LIMIT - contHeader.length - footer.length);
  const parts       = splitText(originalText, firstBudget, restBudget);

  const messages = parts.map((part, i) => (i === 0 ? head + part : contHeader + part));
  // Rodapé apenas na última mensagem (evita repetir a assinatura em cada parte)
  messages[messages.length - 1] += footer;
  return messages;
}


// ─────────────────────────────────────────────────────────────────
//  PIPELINE B — Uploads manuais do dashboard (source: 'manual')
// ─────────────────────────────────────────────────────────────────
async function processManualJob(job: Job) {
  const { numberId, userId, audioBase64, storageKey, filename } = job.data;

  log(job, `📥 Upload manual (jurídico): ${filename}`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Verificar saldo
    const balance = await prisma.minuteBalance.findUnique({ where: { userId } });
    if (!balance || availableTotal(balance) < 0.1) {
      log(job, '⚠️  Saldo insuficiente');
      return { skipped: true, reason: 'insufficient_balance' };
    }

    // PASSO 2: Obter buffer — Supabase Storage (preferido) ou base64 (fallback)
    let rawBuffer: Buffer;
    if (storageKey) {
      log(job, `☁️ Baixando do Supabase Storage: ${storageKey}`);
      rawBuffer = await downloadFromStorage(storageKey);
      log(job, `✅ Baixado: ${(rawBuffer.length / 1024).toFixed(0)} KB`);
    } else {
      log(job, '📦 Decodificando base64...');
      rawBuffer = Buffer.from(audioBase64, 'base64');
      log(job, `✅ Buffer: ${(rawBuffer.length / 1024).toFixed(0)} KB`);
    }

    if (rawBuffer.length > 100 * 1024 * 1024) {
      log(job, `⚠️ Arquivo excede limite absoluto de 100MB`);
      return { skipped: true, reason: 'file_too_large' };
    }

    // PASSO 3: Converter para MP3 64kbps
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(rawBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    if (mp3Buffer.length > 25 * 1024 * 1024) {
      log(job, `⚠️ MP3 pós-conversão > 25MB`);
      return { skipped: true, reason: 'file_too_large_after_compression' };
    }

    // PASSO 4: Transcrever em modo JURÍDICO (retorna segments com timestamps)
    log(job, '🎙️  Whisper — modo jurídico com marcação temporal...');
    const { text: rawText, durationSec, language: detectedLanguage, segments } =
      await transcribeBufferFull(mp3Buffer);
    log(job, `✅ ${durationSec}s — lang:${detectedLanguage} — ${segments.length} segmentos`);

    // PASSO 5: Montar transcrição com marcação temporal [MM:SS] por segmento
    const timestampedText = segments.length > 0
      ? buildTimestampedTranscript(segments, durationSec)
      : rawText; // fallback: texto puro se Whisper não retornar segmentos
    log(job, `✅ Transcrição com ${segments.length} segmentos temporais`);

    // PASSO 6: Resumo com Claude (gerado a partir do texto puro — sem os timestamps)
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(rawText, detectedLanguage);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 7: Salvar transcrição (originalText = texto com marcação temporal)
    log(job, '💾 Salvando...');
    const transcription = await saveTranscription({
      userId, numberId, contactPhone: 'manual',
      filename: filename || null,
      durationSec, originalText: timestampedText, bullets, source: 'manual',
    });

    // PASSO 8: Salvar MP3 permanente para download jurídico (best-effort)
    // Caminho determinístico: audio-juridical/{userId}/{transcriptionId}.mp3
    try {
      const sb = getSupabaseClient();
      if (sb && mp3Buffer) {
        await sb.storage.createBucket(AUDIO_JURIDICAL_BUCKET, { public: false }).catch(() => null);
        const audioPath = `${userId}/${transcription.id}.mp3`;
        const { error: uploadErr } = await sb.storage
          .from(AUDIO_JURIDICAL_BUCKET)
          .upload(audioPath, mp3Buffer, { contentType: 'audio/mpeg', upsert: false });
        if (uploadErr) {
          log(job, `⚠️ Falha ao salvar MP3 jurídico: ${uploadErr.message}`);
        } else {
          log(job, `✅ MP3 jurídico salvo: ${AUDIO_JURIDICAL_BUCKET}/${audioPath}`);
        }
      }
    } catch (audioSaveErr: any) {
      log(job, `⚠️ Falha ao salvar MP3 jurídico (non-fatal): ${audioSaveErr.message}`);
    }

    log(job, `✅ Upload manual jurídico concluído — ${transcription.id}`);
    return { transcriptionId: transcription.id };

  } catch (err) {
    log(job, `❌ Erro no upload manual: ${(err as Error).message}`);
    throw err;
  } finally {
    mp3Buffer?.fill(0);
    if (storageKey) {
      await deleteFromStorage(storageKey);
      log(job, `🗑️ Temp storage removido: ${storageKey}`);
    }
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
    if (!balance || availableTotal(balance) < durationMin) {
      log(job, '⚠️  Saldo insuficiente — alertando o próprio usuário');
      // Avisa SOMENTE o próprio usuário (throttle + e-mail). NUNCA na conversa com o contato.
      triggerMinuteAlertIfNeeded(userId).catch(() => null);
      return { skipped: true, reason: 'insufficient_balance' };
    }
    if (!firstNumber) {
      log(job, '⚠️  Usuário sem número cadastrado');
      return { skipped: true, reason: 'no_number' };
    }
    log(job, `✅ Saldo OK: ${availableTotal(balance).toFixed(1)} min`);

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
    const messages = buildMessage(bullets, originalText, { contactName: senderName, durationSec });
    for (const m of messages) await sendMessageToMeta(senderPhone, m);
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
    } catch (notifyErr: any) {
      logger.warn(`[Worker] M7: Falha ao notificar usuário Meta sobre erro: ${notifyErr.message}`);
    }
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

    if (!balance || availableTotal(balance) < 1) {
      log(job, '⚠️  Saldo insuficiente — alertando o próprio usuário');
      // Avisa SOMENTE o próprio usuário (throttle + e-mail). NUNCA na conversa com o contato.
      triggerMinuteAlertIfNeeded(userId).catch(() => null);
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
    const messages = buildMessage(bullets, originalText, { contactName: senderName, durationSec });
    for (const m of messages) await sendMessageViaTwilio(senderPhone, twilioFrom, m);
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
    } catch (notifyErr: any) {
      logger.warn(`[Worker] M7: Falha ao notificar usuário Twilio sobre erro: ${notifyErr.message}`);
    }
    throw err;
  } finally {
    mp3Buffer?.fill(0);
  }
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE E — WhatsApp via Evolution API (self-hosted)
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

    if (availableTotal(balance) < 0.1) {
      log(job, `⚠️  Saldo insuficiente: ${availableTotal(balance).toFixed(2)} min — alertando o próprio usuário`);
      // Avisa SOMENTE o próprio número do usuário (throttle + e-mail). NUNCA responde
      // na conversa com o contato/grupo que enviou o áudio (senderPhone), para não
      // vazar a situação de saldo a terceiros nem poluir conversas alheias.
      triggerMinuteAlertIfNeeded(userId).catch(() => null);
      return { skipped: true, reason: 'insufficient_balance' };
    }
    if (!whatsappNumber) {
      log(job, '⚠️  Número não encontrado no banco');
      return { skipped: true, reason: 'no_number' };
    }
    log(job, `✅ Saldo OK: ${availableTotal(balance).toFixed(1)} min`);

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

    // Self-note: áudio que o usuário encaminhou para o próprio número (self-chat).
    // Nesse caso a resposta volta ao próprio chat (senderPhone == número conectado)
    // e NÃO aplicamos modo privado (cabeçalho dedicado de nota/encaminhado).
    const isSelfNote  = job.data.isSelfNote === true;

    // Modo privado (Executive): envia ao próprio número; inclui link de resposta no cabeçalho.
    // Guard: phoneNumber deve estar resolvido (≠ 'pending'). Desativado em self-notes.
    const isPrivate   = !isSelfNote
                        && whatsappNumber.privateMode === true
                        && !!whatsappNumber.phoneNumber
                        && whatsappNumber.phoneNumber !== 'pending';
    const targetPhone = isPrivate ? whatsappNumber.phoneNumber! : senderPhone;

    const messages = buildMessage(bullets, originalText, {
      contactName: senderName,
      durationSec,
      isPrivate,
      senderPhone,
      isSelfNote,
      forwarded:   job.data.forwarded === true,
      originPhone: (job.data.originPhone as string | undefined) ?? null,
    });

    for (const m of messages) await sendMessageViaEvolution(instName, targetPhone, m);
    log(job, `✅ ${messages.length} mensagem(ns) enviada(s) ${isPrivate ? `(🔒 privado → ${targetPhone})` : 'na conversa'}`);

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
  if (source === 'manual')          return processManualJob(job);
  if (source === 'whatsapp-twilio') return processTwilioJob(job);
  if (source === 'whatsapp-evolution') return processEvolutionJob(job);
  // transcribe-official / whatsapp-meta = WhatsApp Cloud API (Meta)
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
  connection:      redis as any,
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
  const now = new Date();

  // ── Seção 1: Downgrade de assinaturas past_due após 24h de tolerância ──
  try {
    const graceCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h atrás

    const overdueList = await prisma.subscription.findMany({
      where: {
        status:           'past_due',
        currentPeriodEnd: { lte: graceCutoff },
      },
      include: { plan: true, user: { select: { id: true, email: true, name: true } } },
    });

    if (overdueList.length > 0) {
      logger.info(`[Cron] Fazendo downgrade de ${overdueList.length} assinatura(s) past_due...`);

      const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });

      for (const sub of overdueList) {
        if (!freePlan) continue;

        const nextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        await prisma.$transaction([
          prisma.subscription.update({
            where: { id: sub.id },
            data: {
              planId:           freePlan.id,
              status:           'canceled',
              currentPeriodEnd: null,
            },
          }),
          prisma.minuteBalance.upsert({
            where:  { userId: sub.userId },
            create: { userId: sub.userId, availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
            update: { availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
          }),
        ]);

        logger.info(`[Cron] Downgrade: ${sub.user.email} (${sub.plan.name} → free) por falta de pagamento`);

        // Notificação por e-mail
        if (sub.user.email) {
          const APP_URL = process.env.APP_URL || 'https://zapscript.me';
          const firstName = escHtml(sub.user.name?.split(' ')[0] || 'você');
          const html = `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
              <div style="font-size:22px;font-weight:bold;margin-bottom:16px">🔴 Sua assinatura foi cancelada</div>
              <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
                Olá, <strong>${firstName}</strong>!<br><br>
                Por falta de pagamento, sua assinatura <strong>${sub.plan.label}</strong> foi cancelada e sua conta foi movida para o <strong>plano gratuito (20 min/mês)</strong>.<br><br>
                Para reativar seu plano e recuperar todas as funcionalidades, basta renovar sua assinatura:
              </div>
              <div style="margin:24px 0;text-align:center">
                <a href="${APP_URL}/dashboard/plano" style="background:#10b981;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Reativar assinatura →</a>
              </div>
              <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
            </div>
          `;
          sendEmail(sub.user.email, '🔴 ZapScript — Assinatura cancelada por falta de pagamento', html)
            .catch(e => logger.warn(`[Cron] Erro ao enviar e-mail de downgrade: ${e.message}`));
        }

        // Notificação por WhatsApp
        const wn = await prisma.whatsappNumber.findFirst({
          where: { userId: sub.userId, status: 'connected', phoneNumber: { not: null } },
          orderBy: { connectedAt: 'desc' },
        }).catch(() => null);

        if (wn?.zapiInstanceId && wn?.phoneNumber) {
          const APP_URL = process.env.APP_URL || 'https://zapscript.me';
          const msg = `🔴 *ZapScript* — Assinatura cancelada\n\nOlá! Sua assinatura *${sub.plan.label}* foi cancelada por falta de pagamento.\n\nSua conta foi movida para o plano gratuito (20 min/mês).\n\nPara reativar:\n👉 ${APP_URL}/dashboard/plano`;
          sendMessageViaEvolution(wn.zapiInstanceId, wn.phoneNumber, msg).catch(() => null);
        }
      }
    }
  } catch (err) {
    logger.error(`[Cron] Erro no downgrade de past_due: ${(err as Error).message}`);
  }

  // ── Seção 2: Reset mensal de minutos expirados ──
  try {
    const expired = await prisma.minuteBalance.findMany({
      where:   { resetAt: { lte: now } },
      include: { user: { include: { subscription: { include: { plan: true } } } } },
    });

    // Pular usuários past_due — serão tratados pela seção 1 (antes ou na próxima hora)
    const toReset = expired.filter(b => b.user.subscription?.status !== 'past_due');

    if (toReset.length === 0) return;

    logger.info(`[Cron] Resetando minutos de ${toReset.length} usuário(s)...`);

    for (const balance of toReset) {
      const sub              = balance.user.subscription;
      const minutesPerMonth  = sub?.plan?.minutesPerMonth ?? 0;
      const isTester         = balance.user.isTester;
      const renewalsUsed     = sub?.testerRenewalsUsed ?? 0;
      const MAX_TESTER_RENEW = 12;

      // Ancorar o próximo reset na data original (resetAt atual + 30 dias),
      // não em "agora + 30 dias" — garante ciclo mensal a partir do dia do cadastro/pagamento
      const nextReset = new Date(balance.resetAt.getTime() + 30 * 24 * 60 * 60 * 1000);

      // O reset mensal NÃO toca no saldo extra (minutos avulsos/indicação valem 60 dias).
      // Apenas zera o extra se já tiver expirado, para manter o saldo exibido correto.
      const extraExpired = balance.extraExpiresAt && balance.extraExpiresAt <= now;

      await prisma.minuteBalance.update({
        where: { id: balance.id },
        data:  {
          availableMinutes: minutesPerMonth,
          resetAt:          nextReset,
          lastAlertSent:    null,
          ...(extraExpired ? { extraMinutes: 0, extraExpiresAt: null } : {}),
        },
      });

      // Rastrear renovação tester (até 12 isenções)
      if (isTester && sub?.id && renewalsUsed < MAX_TESTER_RENEW) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data:  { testerRenewalsUsed: { increment: 1 } },
        });
        const remaining = MAX_TESTER_RENEW - renewalsUsed - 1;
        logger.info(`[Cron] Tester ${balance.user.email} — renovação #${renewalsUsed + 1}/12 (${remaining} restante(s))`);

        if (remaining === 0) {
          // Última isenção usada — notificar sobre conversão
          const APP_URL = process.env.API_URL?.replace('/api', '') || 'https://zapscript.me';
          sendEmail(balance.user.email, '🎁 ZapScript — Sua avaliação gratuita está chegando ao fim',
            `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
              <div style="font-size:22px;font-weight:bold;margin-bottom:16px">🎁 Obrigado por ser Tester!</div>
              <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
                Você usou todas as suas <strong>12 renovações gratuitas</strong> como Tester.<br><br>
                Para continuar com o <strong>Plano Pro (200 min/mês)</strong>, assine agora com desconto exclusivo.
              </div>
              <div style="margin:24px 0;text-align:center">
                <a href="${APP_URL}/dashboard/plano" style="background:#10b981;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Assinar Pro →</a>
              </div>
              <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
            </div>`
          ).catch(() => null);
        }
      } else if (isTester && sub?.id && renewalsUsed >= MAX_TESTER_RENEW) {
        logger.info(`[Cron] Tester ${balance.user.email} — 12 isenções esgotadas (renovações: ${renewalsUsed})`);
      }

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
      const q = new BQueue('transcriptions', { connection: redis as any }); // A1: era 'transcription' (singular) — fila real é 'transcriptions'
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
          await sendMessageViaEvolution(senderNumber.zapiInstanceId, alertPhone, message);
          logger.info('[HealthChecker] Alerta WhatsApp enviado', { issues });
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
