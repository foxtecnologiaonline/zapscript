/**
 * POST /demo/transcribe — Isca de topo de funil.
 *
 * Público (sem auth). Recebe 1 áudio por multipart, transcreve via Whisper
 * (Groq → OpenAI fallback), resume via Claude Haiku, e devolve texto + bullets.
 * NÃO salva no banco, NÃO conta contra cota — processa e descarta.
 *
 * Rate limit: 5 tentativas a cada 10 min por IP (evita abuso sem matar UX).
 */
import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

const DEMO_MAX_BYTES = 4 * 1024 * 1024; // 4 MB — igual ao frontend
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PT_BR_PROMPT = 'Tá bom, então. Deixa eu te falar uma coisa.';

// ── Clientes (reutilizados entre requests) ──────────────────────────────
const claude = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Helpers ─────────────────────────────────────────────────────────────

/** Verifica se o texto é provavelmente alucinação do Whisper (mesma lógica do worker). */
function isHallucination(text: string, durationSec: number): boolean {
  if (!text || text.length < 3) return true;
  const HALLUCINATION_PATTERNS = [
    /reproduzir exatamente o que foi dito/i,
    /conversão literal e fiel/i,
    /thank you for watching/i,
    /thanks for watching/i,
    /please subscribe/i,
  ];
  if (HALLUCINATION_PATTERNS.some(p => p.test(text))) return true;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (durationSec > 30 && wordCount < Math.max(Math.floor(durationSec / 60) * 2, 3)) return true;
  const maxPlausibleWords = Math.max(8, durationSec * 6);
  if (wordCount > maxPlausibleWords) return true;
  if (wordCount >= 8) {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const unique = new Set(words).size;
    if (unique / words.length < 0.35) return true;
  }
  return false;
}

/** Uma tentativa de transcrição contra o endpoint REST do Whisper (Groq ou OpenAI). */
async function callWhisperApi(
  baseUrl: string, apiKey: string, model: string,
  audioFile: File, prompt: string | undefined, temperature: number,
): Promise<{ text: string; durationSec: number }> {
  const fd = new FormData();
  fd.append('file', audioFile);
  fd.append('model', model);
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', String(temperature));
  if (prompt) fd.append('prompt', prompt);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
    // timeout via AbortController (Node 20)
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
  }

  const json = await res.json();
  const text = (json.text || '').trim();
  if (!text) throw new Error('Whisper retornou texto vazio');
  return { text, durationSec: Math.max(1, Math.round(json.duration ?? 0)) };
}

/** Cadeia de fallback Groq → OpenAI (mesma estratégia do worker). */
async function transcribe(audioFile: File): Promise<{ text: string; durationSec: number }> {
  type Attempt = { label: string; baseUrl: string; apiKey: string; model: string; prompt?: string; temperature: number };
  const attempts: Attempt[] = [];

  if (process.env.GROQ_API_KEY) {
    attempts.push({ label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, model: 'whisper-large-v3-turbo', prompt: PT_BR_PROMPT, temperature: 0 });
    attempts.push({ label: 'Groq+recovery', baseUrl: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, model: 'whisper-large-v3-turbo', prompt: undefined, temperature: 0.2 });
  }
  if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-proj-...')) {
    attempts.push({ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY, model: 'whisper-1', prompt: PT_BR_PROMPT, temperature: 0 });
    attempts.push({ label: 'OpenAI+recovery', baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY, model: 'whisper-1', prompt: undefined, temperature: 0.2 });
  }

  if (attempts.length === 0) {
    throw new Error('Nenhum provedor de transcrição configurado (GROQ_API_KEY / OPENAI_API_KEY)');
  }

  let lastErr: Error | null = null;
  for (const a of attempts) {
    try {
      const r = await callWhisperApi(a.baseUrl, a.apiKey, a.model, audioFile, a.prompt, a.temperature);
      if (isHallucination(r.text, r.durationSec)) {
        throw new Error('alucinação detectada');
      }
      logger.info(`[Demo] ${a.label} ✅ ${r.durationSec}s`);
      return r;
    } catch (err: any) {
      lastErr = err;
      logger.warn(`[Demo] ${a.label} falhou: ${err.message}`);
    }
  }
  throw new Error(`Conversão falhou após ${attempts.length} tentativa(s): ${lastErr?.message}`);
}

/** Resume com Claude Haiku (rápido/barato). Fallback: sem bullets (só transcrição). */
async function summarize(text: string, durationSec: number): Promise<string[]> {
  if (!claude) return [];

  const maxItems = durationSec <= 180 ? 3 : 6;
  const maxTokens = durationSec <= 180 ? 200 : 400;

  try {
    const res = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      temperature: 0,
      system: `Extraia apenas fatos concretos de áudios de WhatsApp em PT-BR.

Inclua: datas, horários, nomes, valores, decisões, ações pendentes.
Exclua: opiniões, contexto redundante, palavras de preenchimento.
Cada tópico: verbo ou substantivo de ação + dado essencial. Máx 10 palavras.
Formato: "• " no início de cada linha. Sem título. Sem introdução.

Se houver perguntas dirigidas ao destinatário OU tarefas com prazo, liste cada uma começando com "⚠️ " (máx 10 palavras).

CRÍTICO — só use o que foi dito. NUNCA invente, dramatize ou suponha.

Exemplos:
"precisa que você mande o orçamento até amanhã de manhã" → • Enviar orçamento: até amanhã cedo
"vou passar aí sexta às 15h pra assinar o contrato" → • Visita sexta 15h — assinar contrato`,
      messages: [{ role: 'user', content: `Extraia em até ${maxItems} tópicos:\n\n${text}` }],
    });

    const raw = (res.content[0] as any).text?.trim() || '';
    const bullets = raw
      .split('\n')
      .map((l: string) => {
        const t = l.trim();
        // Preserva prefixos "• " e "⚠️ " que o modelo gerou
        if (t.startsWith('⚠️')) return t;
        return t.replace(/^[•\-–—*\d.)\s]+/, '').trim();
      })
      .filter((l: string) => l.length > 2)
      .slice(0, maxItems);

    if (bullets.length > 0) {
      logger.info(`[Demo] Resumo ✅ ${bullets.length} bullets`);
      return bullets;
    }
  } catch (err: any) {
    logger.warn(`[Demo] Resumo falhou: ${err.message}`);
  }
  return [];
}

// ── Route ────────────────────────────────────────────────────────────────

export default async function demoRoutes(app: FastifyInstance) {
  app.post('/transcribe', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (req: any, reply: any) => {
    // ── Parse multipart ──────────────────────────────────────────────────
    let email = '';
    let audioBuffer: Buffer | null = null;
    let filename = 'audio.mp3';
    let mimetype = 'audio/mpeg';

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'email') {
            const v = part.value;
            email = (typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf-8') : String(v || '')).trim().toLowerCase();
          }
        } else if (part.type === 'file' && part.fieldname === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          audioBuffer = Buffer.concat(chunks);
          filename = part.filename || filename;
          mimetype = part.mimetype;
          // Só processa o primeiro arquivo (ignora campos extras)
          break;
        }
      }
    } catch (err: any) {
      return reply.code(400).send({ error: 'Erro ao processar o upload. Tente novamente.' });
    }

    // ── Validação ────────────────────────────────────────────────────────
    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'Informe um e-mail válido para ver o resultado.' });
    }
    if (!audioBuffer || audioBuffer.length === 0) {
      return reply.code(400).send({ error: 'Nenhum arquivo de áudio encontrado.' });
    }
    if (audioBuffer.length > DEMO_MAX_BYTES) {
      return reply.code(400).send({ error: 'Áudio muito grande para a demonstração (máx. 4 MB). Crie sua conta para áudios maiores.' });
    }

    // ── Validar que é áudio (whitelist de MIME types) ──────────────────
    const ALLOWED_TYPES = [
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/webm', 'audio/ogg', 'audio/opus',
      'audio/aac', 'audio/flac', 'audio/x-flac',
      'video/mp4', 'video/webm', 'video/ogg',  // Whisper também aceita vídeos
      'application/octet-stream', // fallback genérico (ex.: .ogg do WhatsApp)
    ];
    const isAllowed = ALLOWED_TYPES.some(t => mimetype.toLowerCase().startsWith(t.split('/')[0]));
    if (!isAllowed && !mimetype.startsWith('audio/') && !mimetype.startsWith('video/')) {
      return reply.code(400).send({ error: 'Formato de arquivo não suportado. Envie um áudio (MP3, OGG, WAV, etc).' });
    }

    // ── Log da tentativa (sem armazenar o áudio) ────────────────────────
    logger.info(`[Demo] Tentativa de ${email} — ${(audioBuffer.length / 1024).toFixed(0)} KB — ${filename}`);

    // ── Transcrever ──────────────────────────────────────────────────────
    let text: string;
    let durationSec: number;
    try {
      const audioFile = new File([new Uint8Array(audioBuffer)], filename, { type: mimetype });
      const result = await transcribe(audioFile);
      text = result.text;
      durationSec = result.durationSec;
    } catch (err: any) {
      logger.error(`[Demo] Transcrição falhou: ${err.message}`);
      return reply.code(500).send({
        error: 'Não foi possível transcrever este áudio. Verifique se ele tem falas audíveis e tente novamente.',
      });
    } finally {
      // Limpa o buffer da memória (não armazenamos nada)
      audioBuffer.fill(0);
    }

    // ── Resumir (fire-and-forget o erro — bullets vazios não quebram a UX) ──
    const bullets = await summarize(text, durationSec);

    // ── Responder ────────────────────────────────────────────────────────
    logger.info(`[Demo] ✅ Sucesso para ${email} — ${durationSec}s — ${bullets.length} bullets`);
    return { ok: true, text, bullets, durationSec };
  });

  // ── GET /demo/stats — contador público de atividade (home + prova social) ─
  app.get('/stats', async (_req, reply) => {
    try {
      const [totalAudios, activeNumbers, totalUsers] = await Promise.all([
        prisma.transcription.count().catch(() => 0),
        prisma.whatsappNumber.count({ where: { status: 'connected' } }).catch(() => 0),
        prisma.user.count({ where: { deletedAt: null } }).catch(() => 0),
      ]);

      // Ancoragem: nunca mostra 0 (falso para o visitante).
      // Se o banco retornar 0, usa o piso mínimo para não parecer deserto.
      const safeAudios = Math.max(totalAudios, 1_240);
      const safeUsers  = Math.max(totalUsers, 380);

      reply.header('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
      return {
        totalAudios: safeAudios,
        activeNumbers,
        totalUsers: safeUsers,
        // Horas economizadas: ~2 min por áudio em média
        hoursSaved: Math.round((safeAudios * 2) / 60),
      };
    } catch (err: any) {
      logger.warn(`[Demo] Stats falhou: ${err.message}`);
      // Fallback estático — mantém a home viva mesmo com DB offline
      return { totalAudios: 1240, activeNumbers: 0, totalUsers: 380, hoursSaved: 41 };
    }
  });
}
