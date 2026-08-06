import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';

/**
 * Entrada por voz/foto para o setup do Atende (dashboard) — usado pelas features de
 * configuração inicial por voz, importação de KB por voz/foto e sugestões geradas a
 * partir de histórico. Roda síncrono direto na API (sem fila): os clipes são curtos
 * (gravados no navegador), diferente dos áudios de clientes finais no WhatsApp, que
 * continuam no pipeline do worker (apps/worker/src/index.ts, transcribeAudio).
 *
 * Cada chamada externa tem timeout explícito (antes não tinha, no caso do Whisper) —
 * evita que a request síncrona fique pendurada indefinidamente se Groq/OpenAI/Claude
 * degradarem; em vez de um job assíncrono completo (fila+polling), o corte de tempo
 * garante um erro claro e rápido pro usuário tentar de novo.
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AI_INPUT_TIMEOUT_MS = 30_000;

/** Telemetria de custo (não crítica): nunca deve derrubar a resposta ao usuário. */
function logAiUsage(userId: string | undefined, feature: string, model: string, usage: { input_tokens?: number; output_tokens?: number } | undefined): void {
  if (!userId) return;
  prisma.aiUsageLog.create({
    data: { userId, feature, model, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 },
  }).catch(() => null);
}

const CLAUDE_MODELS = [
  process.env.ATENDE_AGENT_MODEL || 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class AiInputError extends Error {}

function extFromMimeType(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  return 'webm';
}

/**
 * Transcreve um áudio curto gravado no navegador (webm/ogg/mp3/wav) via Whisper —
 * Groq primeiro (mais rápido), OpenAI como fallback. Sem chunking: clipes de setup
 * são curtos (poucos minutos), bem abaixo do limite de 25MB da API Whisper.
 */
export async function transcribeVoiceSetup(buffer: Buffer, mimeType: string): Promise<string> {
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new AiInputError('Áudio muito longo. Grave um clipe mais curto (até uns 2-3 minutos).');
  }

  const ext = extFromMimeType(mimeType);
  const attempts = [
    { label: 'Groq',   url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: process.env.GROQ_API_KEY,   model: 'whisper-large-v3-turbo' },
    { label: 'OpenAI', url: 'https://api.openai.com/v1/audio/transcriptions',      key: process.env.OPENAI_API_KEY, model: 'whisper-1' },
  ];

  let lastErr: Error | null = null;
  for (const a of attempts) {
    if (!a.key) continue;
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer as unknown as BlobPart], { type: mimeType }), `audio.${ext}`);
      form.append('model', a.model);
      form.append('response_format', 'json');

      const res = await fetch(a.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${a.key}` },
        body: form,
        signal: AbortSignal.timeout(AI_INPUT_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`${a.label} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json: any = await res.json();
      const text = (json.text || '').trim();
      if (!text) throw new Error(`${a.label} retornou texto vazio`);
      return text;
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw new AiInputError(`Falha ao transcrever áudio: ${lastErr?.message ?? 'nenhum provedor de transcrição configurado'}`);
}

/** Extrai o conteúdo relevante de uma foto (cardápio, tabela de preços, anotação) via Claude vision. */
export async function extractTextFromImage(buffer: Buffer, mimeType: string, usageCtx?: { userId: string; feature: string }): Promise<string> {
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new AiInputError('Imagem muito grande (máx 8MB).');
  }
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    throw new AiInputError('Formato de imagem não suportado. Use JPEG, PNG, WEBP ou GIF.');
  }

  const base64 = buffer.toString('base64');
  let lastErr: any;
  for (const model of CLAUDE_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64 } },
            {
              type: 'text',
              text: 'Transcreva todo o texto e as informações relevantes desta imagem (preços, produtos, serviços, horários, perguntas e respostas — o que houver). Liste de forma organizada e completa, sem comentários adicionais.',
            },
          ],
        }],
      }, { timeout: AI_INPUT_TIMEOUT_MS });
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
      if (!text) throw new Error('Claude retornou texto vazio');
      if (usageCtx) logAiUsage(usageCtx.userId, usageCtx.feature, model, res.usage);
      return text;
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw new AiInputError(`Falha ao ler imagem: ${lastErr?.message ?? 'erro desconhecido'}`);
}

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new AiInputError('A IA retornou uma resposta sem JSON reconhecível.');
  return JSON.parse(match[0]);
}

/**
 * Estrutura um texto bruto (transcrição de voz ou de imagem) num JSON específico do
 * chamador, via Claude, com a mesma cadeia de fallback de modelo usada no restante
 * do módulo Atende (atende-agent.ts). O systemPrompt define o formato de saída.
 */
export async function structureWithClaude<T = any>(rawText: string, systemPrompt: string, usageCtx?: { userId: string; feature: string }): Promise<T> {
  let lastErr: any;
  for (const model of CLAUDE_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: rawText }],
      }, { timeout: AI_INPUT_TIMEOUT_MS });
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const parsed = extractJson(text) as T;
      if (usageCtx) logAiUsage(usageCtx.userId, usageCtx.feature, model, res.usage);
      return parsed;
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw new AiInputError(`Falha ao estruturar conteúdo: ${lastErr?.message ?? 'erro desconhecido'}`);
}
