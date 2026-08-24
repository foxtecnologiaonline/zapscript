import OpenAI from 'openai';
import { logger } from '../lib/logger';
import { logAiUsage } from '../lib/aiUsage';
import { splitMp3ByDuration, estimateMp3DurationSec } from './audio';

// ── Clientes Whisper ─────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Groq — whisper-large-v3-turbo (mais rápido e preciso para PT-BR)
// Compatível com API OpenAI — sem dependência extra
const groq = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null;

// ── Prompts para Whisper ─────────────────────────────────────────────────────
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
    /conversão literal e fiel/i,
    /conversão em português brasileiro/i,
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
export interface WhisperSegment {
  start:  number;
  end:    number;
  text:   string;
}

// Opções de conversão: vocabulário do usuário melhora a grafia de nomes
// próprios e jargão (o prompt do Whisper é uma amostra de estilo/vocabulário).
export interface TranscribeOpts {
  vocab?: (string | null | undefined)[];  // nomes de contato, termos do nicho
  juridical?: boolean;                     // usa priming formal + retorna segmentos
  userId?: string;                         // se presente, loga custo em AiUsageLog (feature)
  feature?: string;                        // default 'core_transcription' — ver chamadores
}

// Tamanho de cada bloco em áudios longos (segundos). 30 min @64k mono ≈ 14 MB,
// seguro abaixo do limite de 25 MB da API Whisper. Override via AUDIO_CHUNK_SEC.
const AUDIO_CHUNK_SEC = parseInt(process.env.AUDIO_CHUNK_SEC || '1800', 10);

/** Monta o prompt de priming do Whisper, anexando vocabulário do usuário. */
function buildWhisperPrompt(base: string, vocab?: (string | null | undefined)[]): string {
  if (!vocab?.length) return base;
  const names = Array.from(new Set(
    vocab.map(v => (v || '').trim()).filter(v => v && v.toLowerCase() !== 'manual' && v.length > 1),
  )).slice(0, 20);
  return names.length ? `${base} (${names.join(', ')})` : base;
}

/** Uma chamada única à API Whisper. Sem language → auto-detecção de idioma. */
async function runWhisper(
  client: OpenAI, model: string, audioFile: File, prompt: string | undefined, temperature: number,
): Promise<{ text: string; durationSec: number; language: string; raw: any }> {
  const result: any = await client.audio.transcriptions.create({
    file:            audioFile,
    model,
    response_format: 'verbose_json',
    temperature,
    ...(prompt ? { prompt } : {}),   // sem prompt na tentativa de recuperação
  } as any);
  const text = result.text?.trim();
  if (!text) throw new Error('Whisper retornou texto vazio');
  return {
    text,
    durationSec: Math.max(1, Math.round(result.duration ?? 0)),
    language:    result.language || 'pt',
    raw:         result,
  };
}

const parseSegments = (raw: any[]): WhisperSegment[] =>
  (raw || []).map(s => ({
    start: typeof s.start === 'number' ? s.start : 0,
    end:   typeof s.end   === 'number' ? s.end   : 0,
    text:  (s.text || '').trim(),
  })).filter(s => s.text.length > 0);

/**
 * Converte um único bloco de áudio (≤ limite da API) com Whisper.
 *
 * Cadeia com RECUPERAÇÃO em vez de falha imediata:
 *   1. Groq turbo + prompt (temp 0, determinístico)
 *   2. Groq turbo SEM prompt (temp 0.2)   ← recupera alucinação por priming/silêncio
 *   3. OpenAI whisper-1 + prompt (temp 0)
 *   4. OpenAI whisper-1 SEM prompt (temp 0.2)
 * Retorna a primeira tentativa que passa no detector de alucinação.
 * Auto-detecta o idioma (sem language fixo).
 */
async function transcribeBuffer(
  mp3Buffer: Buffer, opts: TranscribeOpts = {},
): Promise<{ text: string; durationSec: number; language: string; segments: WhisperSegment[] }> {
  const audioFile = new File([mp3Buffer], 'audio.mp3', { type: 'audio/mpeg' });
  const base      = opts.juridical ? PT_BR_JURIDICAL_PROMPT : PT_BR_PROMPT;
  const prompt    = buildWhisperPrompt(base, opts.vocab);

  type Attempt = { label: string; client: OpenAI; model: string; prompt?: string; temperature: number };
  const attempts: Attempt[] = [];
  if (groq) {
    attempts.push({ label: 'Groq',          client: groq,   model: 'whisper-large-v3-turbo', prompt,            temperature: 0   });
    attempts.push({ label: 'Groq+recovery', client: groq,   model: 'whisper-large-v3-turbo', prompt: undefined, temperature: 0.2 });
  }
  attempts.push({ label: 'OpenAI',          client: openai, model: 'whisper-1',              prompt,            temperature: 0   });
  attempts.push({ label: 'OpenAI+recovery', client: openai, model: 'whisper-1',              prompt: undefined, temperature: 0.2 });

  let lastErr: Error | null = null;
  for (const a of attempts) {
    try {
      const r = await runWhisper(a.client, a.model, audioFile, a.prompt, a.temperature);
      if (isWhisperHallucination(r.text, r.durationSec)) {
        throw new Error('alucinação detectada (prompt/silêncio)');
      }
      const segments = opts.juridical ? parseSegments(r.raw.segments) : [];
      logger.info(`[Whisper] ${a.label} ✅ ${r.durationSec}s — lang:${r.language}${opts.juridical ? ` — ${segments.length} seg` : ''}`);
      // Whisper cobra por duração, não por token — inputTokens carrega os
      // segundos de áudio processados (ver comentário em lib/aiUsage.ts).
      if (opts.userId) {
        logAiUsage(opts.userId, opts.feature || 'core_transcription', a.model, r.durationSec, 0);
      }
      return { text: r.text, durationSec: r.durationSec, language: r.language, segments };
    } catch (err: any) {
      lastErr = err;
      logger.warn(`[Whisper] ${a.label} falhou: ${err.message}`);
    }
  }
  throw new Error(`Conversão falhou após ${attempts.length} tentativa(s): ${lastErr?.message}`);
}

/**
 * Converte áudio de qualquer duração, fatiando em blocos de AUDIO_CHUNK_SEC
 * quando excede o limite seguro da API Whisper. Blocos são convertidos em
 * sequência (respeita rate limit) e concatenados; os segmentos têm o timestamp
 * deslocado pela duração acumulada (modo jurídico).
 */
export async function transcribeAudio(
  mp3Buffer: Buffer, opts: TranscribeOpts = {},
): Promise<{ text: string; durationSec: number; language: string; segments: WhisperSegment[] }> {
  const estDur = estimateMp3DurationSec(mp3Buffer);

  // Cabe num único request (com margem de 60s) → caminho rápido
  if (estDur <= AUDIO_CHUNK_SEC + 60) {
    return transcribeBuffer(mp3Buffer, opts);
  }

  const chunks = await splitMp3ByDuration(mp3Buffer, AUDIO_CHUNK_SEC);
  logger.info(`[Whisper] Áudio longo (~${Math.round(estDur / 60)}min) → ${chunks.length} bloco(s) de ${AUDIO_CHUNK_SEC / 60}min`);

  let fullText = '';
  let totalDur = 0;
  let language = 'pt';
  const allSegments: WhisperSegment[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const r = await transcribeBuffer(chunks[i], opts);
    if (opts.juridical) {
      for (const s of r.segments) {
        allSegments.push({ start: s.start + totalDur, end: s.end + totalDur, text: s.text });
      }
    }
    fullText += (fullText ? ' ' : '') + r.text;
    totalDur += r.durationSec;
    if (i === 0) language = r.language;
    chunks[i].fill(0);  // limpa buffer sensível
    logger.info(`[Whisper] Bloco ${i + 1}/${chunks.length} ✅ (${r.durationSec}s)`);
  }

  return { text: fullText.trim(), durationSec: totalDur, language, segments: allSegments };
}
