import 'dotenv/config';
import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { redis, voiceCommandQueue } from './lib/queue';
import { prisma } from './lib/prisma';
import { convertToMp3, splitMp3ByDuration, estimateMp3DurationSec } from './services/audio';
import { transcribeAudio, WhisperSegment } from './services/whisper';
import { downloadAudioFromMeta, sendMessageToMeta } from './services/whatsapp-official';
import { downloadAudioFromTwilio, sendMessageViaTwilio } from './services/twilio';
import { downloadAudioFromEvolution, sendMessageViaEvolution, markChatAsUnread } from './services/evolution';
import { encryptStr, encryptArr, decryptStr, decryptArr } from './services/encryption';
import { sendEmail } from './services/mailer';
import { logger } from './lib/logger';
import { processCampanhaJob, markCampanhaJobExhausted } from './modules/campanhas';
import {
  planEfetivo, audioQuotaFor, pickFooterVariant, formatSavedTime,
  MAX_AUDIO_SECONDS, MAX_AUDIO_MARGIN_SECONDS, FREE_AUDIO_QUOTA, PRO_AUDIO_CAP,
} from './lib/freemium';
import './atende'; // registra o worker da fila 'atende-replies' (ZapScript Atende)
import './voice-command'; // registra o worker da fila 'voice-commands' (Comando de Voz Universal)
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

/** Bucket Supabase Storage para MP3s de laudos jurídicos (permanente) */
const AUDIO_JURIDICAL_BUCKET = 'audio-juridical';

/**
 * Constrói conversão com marcação temporal a partir dos segmentos do Whisper.
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

// ── Sentinels de resumo estruturado ─────────────────────────────────────────
// O resumo é armazenado como string[] (contrato existente). Para suportar
// seções e pendências sem mudar o schema/webhook, codificamos linhas especiais:
//   "::H::Decisões"  → cabeçalho de seção
//   "::P::enviar orçamento até amanhã" → pendência/pergunta destacada
// Linhas normais são bullets simples. buildMessage (WhatsApp) e a página web
// renderizam esses sentinels de forma apropriada.
const SUMMARY_HEADER = '::H::';
const SUMMARY_PENDING = '::P::';

type SummaryMode = 'tldr' | 'short' | 'medium' | 'long';

// ── Domínio/vertical do áudio ────────────────────────────────────────────────
// Não há perfil de profissão salvo por usuário. Para dar um tom útil por nicho
// (Fase 1.2) sem migração de schema, inferimos o domínio do próprio texto por
// palavras-chave e injetamos UMA diretriz de foco no prompt. Default = genérico.
type SummaryDomain = 'juridico' | 'imoveis' | 'vendas' | 'generico';

const DOMAIN_SIGNALS: { domain: Exclude<SummaryDomain, 'generico'>; re: RegExp }[] = [
  { domain: 'juridico', re: /\b(process[oa]s?|audi[êe]ncia|prazo(s)?|cl[áa]usula|contrato|peti[çc][ãa]o|r[ée]u|autor|juiz|advogad|liminar|recurso|intima[çc][ãa]o|senten[çc]a|c[óo]digo civil|OAB)\b/i },
  { domain: 'imoveis',  re: /\b(im[óo]vel|im[óo]veis|apartamento|casa|aluguel|locat[áa]rio|propriet[áa]ri|corretor|financiamento|entrada|parcel|escritura|visita|vistoria|condom[íi]nio|metro(s)? quadrado|m2|IPTU)\b/i },
  { domain: 'vendas',   re: /\b(or[çc]amento|proposta|desconto|fechar (a )?venda|obje[çc][ãa]o|lead|cliente|follow[- ]?up|negocia[çc][ãa]o|comiss[ãa]o|meta|pipeline|ticket|pedido|cota[çc][ãa]o)\b/i },
];

// Foco extra por vertical, anexado ao system prompt (curto/médio/longo).
const DOMAIN_GUIDANCE: Record<Exclude<SummaryDomain, 'generico'>, string> = {
  juridico: 'Foco jurídico: priorize prazos, datas de audiência, cláusulas, valores e partes/processos citados.',
  imoveis:  'Foco imobiliário: priorize valores, condições de pagamento, endereços/imóveis, datas de visita e próximos passos.',
  vendas:   'Foco comercial: priorize valores, objeções levantadas, o que ficou combinado e o próximo passo/follow-up.',
};

/**
 * Infere o domínio do áudio por contagem de sinais de palavras-chave.
 * Exige pelo menos 2 sinais e uma margem clara sobre o segundo colocado para
 * evitar rótulos frágeis; caso contrário retorna 'generico'.
 */
function detectDomain(text: string): SummaryDomain {
  const scores = DOMAIN_SIGNALS.map(s => ({
    domain: s.domain,
    hits: (text.match(new RegExp(s.re, 'gi')) || []).length,
  })).sort((a, b) => b.hits - a.hits);

  const top = scores[0];
  const runnerUp = scores[1]?.hits ?? 0;
  if (top && top.hits >= 2 && top.hits > runnerUp) return top.domain;
  return 'generico';
}

/**
 * Modo de resumo baseado na DURAÇÃO do áudio (com fallback por nº de palavras
 * quando a duração não está disponível). Escala a densidade do resumo:
 *   tldr   (< 30s ou < 80 palavras) → 1 frase telegráfica
 *   short  (≤ 3 min)  → até 3 bullets
 *   medium (≤ 10 min) → até 6 bullets
 *   long   (> 10 min) → seções (Decisões / Ações / Datas)
 */
function summaryMode(text: string, durationSec: number): SummaryMode {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (durationSec > 0) {
    if (durationSec < 30 && words < 80) return 'tldr';
    if (durationSec <= 180)  return 'short';
    if (durationSec <= 600)  return 'medium';
    return 'long';
  }
  // Sem duração confiável → decide por palavras (ritmo ~130 wpm)
  if (words < 80)  return 'tldr';
  if (words < 400) return 'short';
  if (words < 1300) return 'medium';
  return 'long';
}

/**
 * Gera resumo com densidade escalonada pela duração e bloco dedicado de
 * pendências/perguntas. Modelo escalonado por complexidade:
 *   curto/médio → Haiku (rápido/barato)
 *   longo       → Sonnet (síntese de reunião) com fallback Haiku
 *
 * Retorna string[] possivelmente com sentinels ::H:: (seção) e ::P:: (pendência).
 * Cadeia: [modelo do tier] → claude-3-5-haiku → claude-3-haiku → gpt-4o-mini → placeholder.
 */
export async function generateBullets(originalText: string, durationSec = 0, language?: string): Promise<string[]> {
  const mode        = summaryMode(originalText, durationSec);
  const needsTransl = language && !/^pt(-br)?$/i.test(language);
  const ptNote      = needsTransl ? ' Responda sempre em português brasileiro (PT-BR).' : '';

  // Tom por vertical (Fase 1.2): inferido do conteúdo, não de perfil.
  // Só aplica a modos com bullets — o tldr é curto demais e inflaria a frase.
  const domain     = mode === 'tldr' ? 'generico' : detectDomain(originalText);
  const domainNote = domain === 'generico' ? '' : `\n\n${DOMAIN_GUIDANCE[domain]}`;

  // Regras de pendências reutilizadas nos modos com bullets
  const pendingRule = `
Pendências (o mais valioso no WhatsApp): se houver perguntas dirigidas ao destinatário OU tarefas com prazo que ele precisa executar, liste cada uma numa linha começando EXATAMENTE com "⚠️ " (máx 10 palavras). Se não houver nenhuma, não escreva linha "⚠️ ".`;

  let systemMsg: string;
  let userMsg: string;

  if (mode === 'tldr') {
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

  } else if (mode === 'long') {
    // ── Modo Longo: seções (reunião) ─────────────────────────────────────────
    systemMsg = `Você resume reuniões/áudios longos de WhatsApp em PT-BR.${ptNote}

Organize o resumo em SEÇÕES, cada uma com um cabeçalho próprio em linha iniciada por "## " seguido do nome da seção. Use só as seções que tiverem conteúdo, nesta ordem:
## Decisões   → o que foi decidido/combinado
## Ações      → tarefas a executar (quem faz o quê)
## Datas      → datas, horários, prazos mencionados

Sob cada seção, bullets "• " (máx 10 palavras cada, fatos concretos).
${pendingRule}

CRÍTICO: só use o que foi dito. NUNCA invente, dramatize ou suponha. Sem floreio.${domainNote}`;

    userMsg = `Resuma em seções:\n\n${originalText}`;

  } else {
    // ── Modo Short/Medium: bullets de fatos concretos ────────────────────────
    const max = mode === 'short' ? 3 : 6;
    systemMsg = `Extraia apenas fatos concretos de áudios de WhatsApp em PT-BR.${ptNote}

Inclua: datas, horários, nomes, valores, decisões, ações pendentes.
Exclua: opiniões, contexto redundante, palavras de preenchimento.
Cada tópico: verbo ou substantivo de ação + dado essencial. Máx 10 palavras.
Formato: "• " no início de cada linha. Sem título.
${pendingRule}

Exemplos:
"vou passar aí sexta às 15h pra assinar o contrato" → • Visita sexta 15h — assinar contrato
"precisa que você mande o orçamento até amanhã de manhã" → ⚠️ Enviar orçamento: até amanhã cedo${domainNote}`;

    userMsg = `Extraia em até ${max} tópicos (máx 10 palavras cada):\n\n${originalText}`;
  }

  const parse = (raw: string): string[] =>
    mode === 'tldr' ? parseTldr(raw) : parseStructured(raw);

  // Modelo escalonado: áudio longo usa Sonnet primeiro (melhor síntese);
  // demais usam direto a cadeia Haiku (rápido/barato).
  const claudeChain = mode === 'long'
    ? ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307']
    : ['claude-haiku-4-5', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'];
  const maxTokens = mode === 'long' ? 700 : mode === 'medium' ? 400 : 200;

  // ── Tentativa 1: Claude ───────────────────────────────────────────────────
  for (const model of claudeChain) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens:  maxTokens,
        temperature: 0,   // determinístico — evita embelezamento/dramatização
        system:      systemMsg,
        messages:    [{ role: 'user', content: userMsg }],
      });
      const raw     = (res.content[0] as any).text?.trim() || '';
      const bullets = parse(raw);
      if (bullets.length > 0) {
        logger.info(`[Resumo] ${model} ✅ (modo: ${mode}, ${bullets.length} linhas)`);
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
      max_tokens:  maxTokens,
      temperature: 0,   // determinístico — evita embelezamento/dramatização
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg   },
      ],
    });
    const raw     = res.choices[0]?.message?.content?.trim() || '';
    const bullets = parse(raw);
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

/**
 * Parseia a resposta estruturada do resumo em string[] com sentinels:
 *   "## Título"  → "::H::Título"
 *   "⚠️ texto"   → "::P::texto"
 *   "• texto"    → "texto"
 * Pendências (::P::) são reordenadas para o fim, agrupadas. Linhas vazias e
 * cabeçalhos sem conteúdo subsequente são descartados.
 */
function parseStructured(raw: string): string[] {
  if (!raw) return [];
  const bullets: string[] = [];
  const pendings: string[] = [];

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith('##')) {
      const title = t.replace(/^#+\s*/, '').trim();
      if (title) bullets.push(SUMMARY_HEADER + title);
      continue;
    }
    if (t.startsWith('⚠️')) {
      const p = t.replace(/^⚠️\s*/, '').trim();
      if (p.length > 2) pendings.push(SUMMARY_PENDING + p);
      continue;
    }
    // Bullet ou texto puro — remove qualquer prefixo (•  -  –  1.  * etc.)
    const b = t.replace(/^[•\-–—*\d.)\s]+/, '').trim();
    if (b.length > 2) bullets.push(b);
  }

  // Remove cabeçalhos órfãos (sem bullet logo após)
  const cleaned = bullets.filter((b, i) => {
    if (!b.startsWith(SUMMARY_HEADER)) return true;
    const next = bullets[i + 1];
    return next && !next.startsWith(SUMMARY_HEADER);
  });

  return [...cleaned, ...pendings];
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
 * Salva conversão no banco e debita minutos atomicamente.
 * Usa transação interativa para garantir que o débito só ocorre
 * se houver saldo suficiente (previne race condition).
 */
async function saveTranscription(params: {
  userId: string; numberId: string | null; contactPhone: string; contactName?: string;
  filename?: string; durationSec: number; originalText: string; bullets: string[]; source: string;
  footerShown?: boolean; footerVariant?: string | null;
}) {
  const { userId, numberId, contactPhone, contactName, filename, durationSec, originalText, bullets, source, footerShown, footerVariant } = params;
  // Garantir que numberId seja null (não 'unknown') para não violar FK do Prisma
  const safeNumberId = (numberId && numberId !== 'unknown') ? numberId : null;
  const durationMin = Math.round((durationSec / 60) * 100) / 100;

  const transcription = await prisma.$transaction(async (tx) => {
    // Métrica primária = nº de áudios → incrementa audiosUsed.
    // Minutos viram métrica INTERNA de custo (accumulatedMinutes alimenta o
    // contador "economizou Xh"). O débito de availableMinutes/extra é mantido
    // por compatibilidade, mas é NÃO-BLOQUEANTE (clamp em 0) — a cota agora é
    // controlada por áudios na entrada de cada pipeline, não por saldo de minutos.
    const nowDebit = new Date();
    const bal = await tx.minuteBalance.findUnique({ where: { userId } });
    if (!bal) throw new Error('Saldo não encontrado no momento do débito');

    const extraValid = bal.extraExpiresAt && bal.extraExpiresAt > nowDebit ? bal.extraMinutes : 0;
    const fromPlan  = Math.min(bal.availableMinutes, durationMin);
    const remainder = Math.max(0, durationMin - fromPlan);
    const fromExtra = Math.round(Math.min(extraValid, remainder) * 100) / 100;
    await tx.minuteBalance.update({
      where: { userId },
      data: {
        availableMinutes:   { decrement: fromPlan },
        ...(fromExtra > 0 ? { extraMinutes: { decrement: fromExtra } } : {}),
        accumulatedMinutes: { increment: durationMin },
        audiosUsed:         { increment: 1 },
      },
    });

    // Criptografar campos sensíveis antes de salvar
    const encPhone   = encryptStr(contactPhone);
    const encText    = encryptStr(originalText);
    const encBullets = encryptArr(bullets);

    const transcr = await tx.transcription.create({
      data: { userId, numberId: safeNumberId, contactPhone: encPhone, contactName: contactName ?? null, filename: filename ?? null, durationSec, originalText: encText, summaryBullets: encBullets, confidenceScore: 99.0, source, footerShown: footerShown ?? false, footerVariant: footerVariant ?? null },
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

  // ── Alertas de consumo ────────────────────────────────────────────────────
  // (legado) Os alertas por MINUTOS foram desativados: a métrica primária agora é
  // ÁUDIOS. O aviso ao usuário acontece no gate de cota (triggerQuotaBlockNotice)
  // e na dashboard. triggerMinuteAlertIfNeeded fica disponível, mas não é mais
  // chamado aqui para não enviar mensagens contraditórias falando em "minutos".

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
      100: `🔴 *ZapScript* — Minutos esgotados\n\nVocê atingiu *100% dos seus minutos* deste mês.\n\n📵 As conversões foram *pausadas* até o próximo ciclo ou upgrade.\n\n⚡ Faça upgrade agora:\n👉 https://ZapScript.me/dashboard/plano`,
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
              Você usou <strong>80% dos seus minutos</strong> — restam apenas 20%. Quando zerar, as conversões são pausadas até o próximo ciclo.<br><br>
              Faça upgrade agora para não perder nenhum áudio importante:
            </div>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/plano" style="background:#f59e0b;color:#1c1204;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Fazer upgrade →</a>
            </div>
            <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
          </div>`,
        },
        100: {
          subject: '🔴 ZapScript — Minutos esgotados — conversões pausadas',
          body: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:16px">🔴 Seus minutos acabaram</div>
            <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
              Olá${userRecord.name ? `, <strong>${escHtml(userRecord.name)}</strong>` : ''}!<br><br>
              Você atingiu <strong>100% dos seus minutos</strong> deste mês. As conversões estão <strong>pausadas</strong> até o próximo ciclo ou até você fazer upgrade.<br><br>
              Para voltar a converter agora mesmo:
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
 * Dispara webhook personalizado do usuário após uma conversão concluída.
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
 *   📝 *Conversão*
 *   _Gerado por_ → *ZapScript.me* ⚡
 *
 * Modo Privado (Opção B):
 *   🔒 *Privado* | *[nome]* → você
 *   📱 +55 xx x xxxx-xxxx · ⏱ [dur]
 *   📋 *Resumo* / bullets
 *   📝 *Conversão*
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
    footerText?: string | null; // rodapé viral a exibir (B). null/undefined → Modo Privado (sem rodapé)
  } = {},
): string[] {
  const { contactName, durationSec, isPrivate, senderPhone, isSelfNote, forwarded, originPhone, footerText } = opts;

  const isTldr  = summaryMode(originalText, durationSec ?? 0) === 'tldr'
    && bullets.length === 1
    && !bullets[0].startsWith(SUMMARY_HEADER)
    && !bullets[0].startsWith(SUMMARY_PENDING);
  const hasName = contactName && contactName !== 'manual' && contactName.trim().length > 0;
  const durStr  = durationSec && durationSec > 0
    ? `⏱ ${durationSec >= 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60 > 0 ? ` ${durationSec % 60}s` : ''}` : `${durationSec}s`}`
    : '';

  const FALLBACK       = ['Conversão disponível', 'Resumo não disponível', 'Não foi possível'];
  const hasRealBullets = bullets.length > 0 && !bullets.some(b => FALLBACK.some(f => b.includes(f)));
  const tldr           = hasRealBullets && isTldr ? bullets[0] : null;

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

  // ── Seção de resumo (não-TLDR): bullets + seções + pendências ──
  // Sentinels: ::H::Título → "*Título*" (negrito WhatsApp); ::P::texto → "⚠️ texto".
  const renderSummaryLine = (b: string): string => {
    if (b.startsWith(SUMMARY_HEADER))  return `\n*${b.slice(SUMMARY_HEADER.length)}*`;
    if (b.startsWith(SUMMARY_PENDING)) return `⚠️ *${b.slice(SUMMARY_PENDING.length)}*`;
    return `• ${b}`;
  };
  const pontoSection = hasRealBullets && !isTldr
    ? `\n\n📋 *Resumo*\n${bullets.map(renderSummaryLine).join('\n')}`
    : '';

  // ── Rodapé ──
  // Modo privado responde ao remetente; self-note responde à origem quando ela existir.
  const replyTarget = isPrivate ? senderPhone : (isSelfNote ? originPhone : null);
  const replyLink = replyTarget
    ? `\n\n↩️ Responder: wa.me/${replyTarget.replace(/\D/g, '')}`
    : '';
  // Rodapé viral CONDICIONAL (BLOCO B): só aparece quando footerText é fornecido.
  //   FREE → rodapé em toda transcrição (transcrição cai na conversa do contato).
  //   PAGO → Modo Privado automático: transcrição vai só ao próprio número, sem rodapé.
  // A decisão (mostrar/qual variação) é tomada pelo caller; aqui só renderizamos.
  // O preview do link é desativado no envio (evolution.ts).
  const ctaLine = footerText ? `\n\n${footerText}` : '';
  const footer = `${replyLink}${ctaLine}`;

  // ── Conversão COMPLETA, dividida em mensagens se exceder o teto do WhatsApp ──
  // A 1ª mensagem carrega cabeçalho + resumo + início da conversão; as demais
  // continuam a conversão. O rodapé fica só na última. Nada é truncado.
  const transcHeader = `\n\n📝 *Conversão*\n`;
  const contHeader   = `📝 *Conversão (cont.)*\n`;
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
//  FREEMIUM — cota por áudios (A1/A2) + rodapé condicional (B)
// ─────────────────────────────────────────────────────────────────

/** Carrega plano efetivo + uso de áudios do ciclo para um usuário. */
async function loadUsage(userId: string): Promise<{ plan: 'pro' | 'free'; quota: number; used: number; allowed: boolean }> {
  const [user, bal] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { isTester: true, subscription: { select: { status: true, trialEndsAt: true, plan: { select: { name: true } } } } },
    }),
    prisma.minuteBalance.findUnique({ where: { userId }, select: { audiosUsed: true } }),
  ]);
  const plan  = planEfetivo(user || {}, new Date());
  const quota = audioQuotaFor(plan);
  const used  = bal?.audiosUsed ?? 0;
  return { plan, quota, used, allowed: used < quota };
}

/** Áudio acima do teto de 10 min (com margem) → rejeita sem contar cota. */
function isAudioTooLong(durationSec: number): boolean {
  return durationSec > MAX_AUDIO_SECONDS + MAX_AUDIO_MARGIN_SECONDS;
}
const REJECT_TOO_LONG_MSG =
  '🎧 Esse áudio passa de 10 minutos. Por aqui eu transcrevo áudios de até 10 min — ' +
  'peça pra dividir em partes que eu cuido do resto. (não descontou nada da sua cota)';

/**
 * Decide se mostra o rodapé viral nesta transcrição e qual variação (B).
 *  Mostra em TODA transcrição, exceto:
 *   - Modo Privado ativo (a transcrição vai só ao dono, ninguém mais veria o rodapé);
 *   - Self-note (áudio encaminhado ao próprio número — cai no próprio chat).
 */
function decideFooter(
  isSelfNote: boolean, isPrivate: boolean,
): { show: boolean; variantId: string | null; variantText: string | null } {
  if (isSelfNote || isPrivate) return { show: false, variantId: null, variantText: null };
  const variant = pickFooterVariant();
  return { show: true, variantId: variant.id, variantText: variant.text };
}

/**
 * Avisa o PRÓPRIO usuário (WhatsApp + e-mail) que a cota FREE do mês acabou,
 * com CTA de upgrade ancorado em "menos de R$1,23/dia". Throttle: 1x por ciclo.
 * NUNCA responde na conversa do contato que enviou o áudio.
 */
async function triggerQuotaBlockNotice(userId: string): Promise<void> {
  try {
    const bal = await prisma.minuteBalance.findUnique({ where: { userId }, select: { lastAlertSent: true } });
    if (bal?.lastAlertSent === 'quota_block') return; // já avisou neste ciclo

    const user    = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    const APP_URL = process.env.APP_URL || 'https://zapscript.me';
    const waMsg =
      `🔓 *ZapScript* — Você usou seus ${FREE_AUDIO_QUOTA} áudios grátis do mês\n\n` +
      `Continue lendo seus áudios *sem limite*, por *menos de R$1,23/dia*.\n` +
      `Não volte a ouvir áudio:\n👉 ${APP_URL}/dashboard/plano`;

    const n = await prisma.whatsappNumber.findFirst({
      where:   { userId, status: 'connected', zapiInstanceId: { not: null }, phoneNumber: { not: null } },
      orderBy: { connectedAt: 'desc' },
    });
    if (n?.zapiInstanceId && n?.phoneNumber) {
      await sendMessageViaEvolution(n.zapiInstanceId, n.phoneNumber, waMsg).catch(() => null);
    }
    if (user?.email) {
      const firstName = escHtml(user.name?.split(' ')[0] || 'você');
      sendEmail(user.email, '🔓 ZapScript — seus áudios grátis acabaram este mês',
        `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
          <div style="font-size:22px;font-weight:bold;margin-bottom:16px">🔓 Continue lendo sem limite</div>
          <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
            Olá, <strong>${firstName}</strong>!<br><br>
            Você usou seus <strong>${FREE_AUDIO_QUOTA} áudios grátis</strong> deste mês.
            Quem tem vida corrida não para pra ouvir áudio — lê.<br><br>
            Volte a ler tudo, sem limite, por <strong>menos de R$1,23/dia</strong>:
          </div>
          <div style="margin:24px 0;text-align:center">
            <a href="${APP_URL}/dashboard/plano" style="background:#10b981;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Ativar o Pro →</a>
          </div>
          <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
        </div>`,
      ).catch(() => null);
    }
    await prisma.minuteBalance.update({ where: { userId }, data: { lastAlertSent: 'quota_block' } }).catch(() => null);
    logger.info(`[Quota] ✅ Aviso de cota FREE esgotada enviado ao usuário ${userId}`);
  } catch (err: any) {
    logger.warn(`[Quota] Falha ao avisar cota esgotada: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE B — Uploads manuais do dashboard (source: 'manual')
// ─────────────────────────────────────────────────────────────────
async function processManualJob(job: Job) {
  const { numberId, userId, audioBase64, storageKey, filename } = job.data;

  log(job, `📥 Upload manual (jurídico): ${filename}`);

  let mp3Buffer: Buffer | null = null;

  try {
    // PASSO 1: Cota por ÁUDIOS (métrica primária).
    // Upload jurídico é recurso PRO → sem teto de 10 min e sem rodapé.
    const usage = await loadUsage(userId);
    if (!usage.allowed) {
      log(job, `⚠️  Cota de áudios atingida (${usage.used}/${usage.quota}, plano ${usage.plan})`);
      if (usage.plan === 'free') triggerQuotaBlockNotice(userId).catch(() => null);
      return { skipped: true, reason: usage.plan === 'free' ? 'free_quota_reached' : 'pro_cap_reached' };
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

    // Teto pós-conversão 100MB: áudios longos são fatiados internamente
    // (transcribeAudio) em blocos de 30 min, então não há mais limite de 25MB.
    if (mp3Buffer.length > 100 * 1024 * 1024) {
      log(job, `⚠️ MP3 pós-conversão > 100MB`);
      return { skipped: true, reason: 'file_too_large_after_compression' };
    }

    // PASSO 4: Converter em modo JURÍDICO (retorna segments com timestamps).
    // Áudios > 30 min são fatiados e convertidos em blocos automaticamente.
    log(job, '🎙️  Whisper — modo jurídico com marcação temporal...');
    const { text: rawText, durationSec, language: detectedLanguage, segments } =
      await transcribeAudio(mp3Buffer, { juridical: true, vocab: [filename] });
    log(job, `✅ ${durationSec}s — lang:${detectedLanguage} — ${segments.length} segmentos`);

    // PASSO 5: Montar conversão com marcação temporal [MM:SS] por segmento
    const timestampedText = segments.length > 0
      ? buildTimestampedTranscript(segments, durationSec)
      : rawText; // fallback: texto puro se Whisper não retornar segmentos
    log(job, `✅ Conversão com ${segments.length} segmentos temporais`);

    // PASSO 6: Resumo com Claude (gerado a partir do texto puro — sem os timestamps)
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(rawText, durationSec, detectedLanguage);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 7: Salvar conversão (originalText = texto com marcação temporal)
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
    if (!firstNumber) {
      log(job, '⚠️  Usuário sem número cadastrado');
      return { skipped: true, reason: 'no_number' };
    }

    // Cota por ÁUDIOS (métrica primária). FREE no limite → bloqueia + upsell
    // (aviso só ao próprio usuário). PRO → teto oculto, skip silencioso.
    const usage = await loadUsage(userId);
    if (!usage.allowed) {
      log(job, `⚠️  Cota de áudios atingida (${usage.used}/${usage.quota}, plano ${usage.plan})`);
      if (usage.plan === 'free') triggerQuotaBlockNotice(userId).catch(() => null);
      return { skipped: true, reason: usage.plan === 'free' ? 'free_quota_reached' : 'pro_cap_reached' };
    }
    log(job, `✅ Cota OK: ${usage.used}/${usage.quota} áudios (${usage.plan})`);

    // PASSO 2: Baixar áudio da Meta API
    log(job, '⬇️  Baixando áudio da Meta API...');
    const audioBuffer = await downloadAudioFromMeta(mediaId);
    log(job, `✅ Baixado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter para MP3
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(audioBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3.5: Teto de 10 min — rejeita antes de processar (não conta cota).
    if (isAudioTooLong(estimateMp3DurationSec(mp3Buffer))) {
      log(job, '⚠️  Áudio acima de 10 min — rejeitado sem contar cota');
      await sendMessageToMeta(senderPhone, REJECT_TOO_LONG_MSG).catch(() => null);
      return { skipped: true, reason: 'audio_too_long' };
    }

    // PASSO 4: Converter com Whisper (chunking automático p/ áudios longos)
    log(job, '🎙️  Whisper API (auto-idioma)...');
    const { text: originalText, durationSec, language: detectedLang } =
      await transcribeAudio(mp3Buffer, { vocab: [senderName] });
    log(job, `✅ ${durationSec}s — lang:${detectedLang} — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude (densidade por duração + tradução se necessário)
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText, durationSec, detectedLang);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // Rodapé viral: mostra sempre (pipeline sem Modo Privado).
    const footer = decideFooter(false, false);

    // PASSO 6: Enviar resposta no WhatsApp
    log(job, '📤 Enviando resposta via Meta API...');
    const messages = buildMessage(bullets, originalText, { contactName: senderName, durationSec, footerText: footer.variantText });
    for (const m of messages) await sendMessageToMeta(senderPhone, m);
    log(job, '✅ Mensagem enviada');

    // PASSO 7: Salvar conversão e debitar minutos — duração real do Whisper
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
      footerShown:   footer.show,
      footerVariant: footer.variantId,
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

    if (!firstNumber) {
      log(job, '⚠️  Usuário sem número cadastrado');
      return { skipped: true, reason: 'no_number' };
    }

    // Cota por ÁUDIOS (métrica primária). FREE no limite → bloqueia + upsell
    // (aviso só ao próprio usuário). PRO → teto oculto, skip silencioso.
    const usage = await loadUsage(userId);
    if (!usage.allowed) {
      log(job, `⚠️  Cota de áudios atingida (${usage.used}/${usage.quota}, plano ${usage.plan})`);
      if (usage.plan === 'free') triggerQuotaBlockNotice(userId).catch(() => null);
      return { skipped: true, reason: usage.plan === 'free' ? 'free_quota_reached' : 'pro_cap_reached' };
    }
    log(job, `✅ Cota OK: ${usage.used}/${usage.quota} áudios (${usage.plan})`);

    // PASSO 2: Baixar áudio do Twilio
    log(job, '⬇️  Baixando áudio do Twilio...');
    const audioBuffer = await downloadAudioFromTwilio(mediaUrl);
    log(job, `✅ Baixado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: Converter para MP3
    log(job, '🔄 Convertendo para MP3...');
    mp3Buffer = await convertToMp3(audioBuffer);
    log(job, `✅ Convertido: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3.5: Teto de 10 min — rejeita antes de processar (não conta cota).
    if (isAudioTooLong(estimateMp3DurationSec(mp3Buffer))) {
      log(job, '⚠️  Áudio acima de 10 min — rejeitado sem contar cota');
      await sendMessageViaTwilio(senderPhone, twilioFrom, REJECT_TOO_LONG_MSG).catch(() => null);
      return { skipped: true, reason: 'audio_too_long' };
    }

    // PASSO 4: Converter com Whisper (chunking automático p/ áudios longos)
    log(job, '🎙️  Whisper API (auto-idioma)...');
    const { text: originalText, durationSec, language: detectedLang } =
      await transcribeAudio(mp3Buffer, { vocab: [senderName] });
    log(job, `✅ ${durationSec}s — lang:${detectedLang} — "${originalText.substring(0, 60)}..."`);

    // PASSO 5: Resumo com Claude (densidade por duração + tradução se necessário)
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText, durationSec, detectedLang);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // Rodapé viral: mostra sempre (pipeline sem Modo Privado).
    const footer = decideFooter(false, false);

    // PASSO 6: Enviar resposta via Twilio
    log(job, '📤 Enviando resposta via Twilio...');
    const messages = buildMessage(bullets, originalText, { contactName: senderName, durationSec, footerText: footer.variantText });
    for (const m of messages) await sendMessageViaTwilio(senderPhone, twilioFrom, m);
    log(job, '✅ Mensagem enviada');

    // PASSO 7: Salvar conversão e debitar minutos
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
      footerShown:   footer.show,
      footerVariant: footer.variantId,
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
//  Comando de voz — módulo Cobrança (self-note apenas)
//  #1: criar cobrança por voz. #7: marcar paga/cancelar por voz.
//  Roda ANTES do resumo normal da transcrição — se nenhuma intenção bater
//  (ou o módulo não estiver ativo), cai no fluxo de transcrição de sempre.
// ─────────────────────────────────────────────────────────────────
const COBRANCA_VOICE_KEYWORDS = /cobran|cliente|pag(a|o|ou|amento)|cancel|vencime?nto|vence/i;

function cobrancaExtractJson(text: string): any {
  // Modelo às vezes embrulha em ```json — extrai o primeiro objeto {...}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta sem JSON');
  return JSON.parse(match[0]);
}

interface CobrancaVoiceIntent {
  intent: 'criar_cobranca' | 'marcar_paga' | 'cancelar' | 'nenhum';
  nome_cliente?: string | null;
  telefone?: string | null;
  valor?: number | null;
  descricao?: string | null;
  vencimento?: string | null; // AAAA-MM-DD
}

async function classifyCobrancaVoiceIntent(text: string): Promise<CobrancaVoiceIntent | null> {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const systemMsg = `Você identifica comandos de voz para o módulo de Cobrança de um sistema de gestão. O usuário grava uma nota de voz para si mesmo (self-note) no WhatsApp.

Hoje é ${hoje}. Responda APENAS com um JSON, sem texto ao redor, no formato:
{"intent": "criar_cobranca" | "marcar_paga" | "cancelar" | "nenhum", "nome_cliente": string|null, "telefone": string|null, "valor": number|null, "descricao": string|null, "vencimento": "AAAA-MM-DD"|null}

Regras:
- "criar_cobranca": usuário quer registrar uma nova cobrança/cliente a cobrar. Extraia nome, valor e vencimento (resolva datas relativas como "dia 10", "amanhã", "daqui 30 dias" para AAAA-MM-DD usando hoje como referência). Telefone (com DDD, só dígitos) somente se foi dito explicitamente.
- "marcar_paga": usuário diz que um cliente pagou/quitou uma cobrança.
- "cancelar": usuário quer cancelar/desistir de cobrar um cliente.
- "nenhum": o áudio não é um comando de Cobrança (lembrete pessoal, outro assunto etc.) — use sempre que houver dúvida, não force uma intenção.
- Nunca invente nome, valor ou telefone que não foram ditos.`;

  try {
    const res = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      temperature: 0,
      system: systemMsg,
      messages: [{ role: 'user', content: `Áudio transcrito: "${text}"` }],
    });
    const raw = (res.content[0] as any).text?.trim() || '';
    return cobrancaExtractJson(raw) as CobrancaVoiceIntent;
  } catch (err: any) {
    logger.warn(`[Cobrança][Voz] Classificação falhou: ${err.message}`);
    return null;
  }
}

async function tryHandleCobrancaVoiceCommand(opts: {
  userId: string;
  text: string;
  instanceName: string;
  ownerPhone: string;
}): Promise<boolean> {
  const { userId, text, instanceName, ownerPhone } = opts;
  if (!COBRANCA_VOICE_KEYWORDS.test(text)) return false;

  const hasCobranca = await prisma.entitlement.findFirst({
    where: { userId, productKey: 'cobranca', status: { in: ['active', 'trialing'] } },
    select: { id: true },
  }).catch(() => null);
  if (!hasCobranca) return false;

  const parsed = await classifyCobrancaVoiceIntent(text);
  if (!parsed || parsed.intent === 'nenhum') return false;

  const reply = async (msg: string) => {
    await sendMessageViaEvolution(instanceName, ownerPhone, msg).catch(() => null);
  };

  try {
    if (parsed.intent === 'criar_cobranca') {
      const nome = (parsed.nome_cliente || '').trim();
      if (!nome || !parsed.valor || parsed.valor <= 0 || !parsed.vencimento) {
        await reply('🎙️ Entendi que é pra criar uma cobrança, mas faltou nome, valor ou vencimento. Pode repetir com esses três dados ou cadastrar pelo painel?');
        return true;
      }
      const vencimento = new Date(`${parsed.vencimento}T00:00:00.000Z`);
      if (isNaN(vencimento.getTime())) {
        await reply('🎙️ Não consegui entender a data de vencimento. Pode repetir ou cadastrar pelo painel?');
        return true;
      }

      // Reaproveita cliente existente pelo nome (evita pedir telefone de novo por voz).
      let cliente = await prisma.cobrancaCliente.findFirst({
        where: { userId, deletedAt: null, nome: { contains: nome, mode: 'insensitive' } },
      });
      if (!cliente) {
        const telefoneDigits = (parsed.telefone || '').replace(/\D/g, '');
        if (telefoneDigits.length < 10 || telefoneDigits.length > 15) {
          await reply(`🎙️ Não encontrei "${nome}" nos seus clientes e não peguei o telefone direito. Pode repetir com o telefone (com DDD) ou cadastrar pelo painel?`);
          return true;
        }
        cliente = await prisma.cobrancaCliente.create({ data: { userId, nome, telefone: telefoneDigits } });
      }

      const cobranca = await prisma.cobrancaCobranca.create({
        data: {
          userId,
          clienteId: cliente.id,
          descricao: (parsed.descricao || 'Cobrança').trim().slice(0, 200) || 'Cobrança',
          valor: parsed.valor,
          vencimento,
          origemVoz: true,
        },
      });

      await reply(`✅ Cobrança criada: *${cliente.nome}* — ${formatBRL(cobranca.valor)}, vence ${formatDateBR(vencimento)}.`);
      return true;
    }

    if (parsed.intent === 'marcar_paga' || parsed.intent === 'cancelar') {
      const nome = (parsed.nome_cliente || '').trim();
      if (!nome) {
        await reply('🎙️ Entendi o comando, mas não peguei o nome do cliente. Pode repetir?');
        return true;
      }
      const abertas = await prisma.cobrancaCobranca.findMany({
        where: {
          userId, status: 'pendente', deletedAt: null,
          cliente: { nome: { contains: nome, mode: 'insensitive' }, deletedAt: null },
        },
        include: { cliente: true },
        orderBy: { vencimento: 'asc' },
      });

      if (abertas.length === 0) {
        await reply(`🎙️ Não encontrei cobrança em aberto de "${nome}".`);
        return true;
      }
      if (abertas.length > 1) {
        const lista = abertas.map((c) => `• ${formatBRL(c.valor)} — vence ${formatDateBR(c.vencimento)}`).join('\n');
        await reply(`🎙️ Encontrei ${abertas.length} cobranças em aberto de ${abertas[0].cliente.nome}:\n${lista}\n\nAjusta pelo painel pra eu saber qual.`);
        return true;
      }

      const alvo = abertas[0];
      const novoStatus = parsed.intent === 'marcar_paga' ? 'paga' : 'cancelada';
      await prisma.cobrancaCobranca.update({
        where: { id: alvo.id },
        data: { status: novoStatus, pagoEm: novoStatus === 'paga' ? new Date() : alvo.pagoEm },
      });

      // #5: recorrência — gera a próxima ocorrência ao marcar paga por voz também.
      if (novoStatus === 'paga' && alvo.recorrente && alvo.recorrenciaMeses) {
        const proxVencimento = new Date(alvo.vencimento);
        proxVencimento.setUTCMonth(proxVencimento.getUTCMonth() + alvo.recorrenciaMeses);
        await prisma.cobrancaCobranca.create({
          data: {
            userId, clienteId: alvo.clienteId, descricao: alvo.descricao, valor: alvo.valor,
            vencimento: proxVencimento, recorrente: true, recorrenciaMeses: alvo.recorrenciaMeses,
          },
        }).catch((err: any) => logger.error(`[Cobrança][Voz] Falha ao gerar próxima recorrência: ${err.message}`));
      }

      const verbo = novoStatus === 'paga' ? 'marcada como paga' : 'cancelada';
      await reply(`✅ Cobrança de *${alvo.cliente.nome}* (${formatBRL(alvo.valor)}) ${verbo}.`);
      return true;
    }
  } catch (err: any) {
    logger.error(`[Cobrança][Voz] Erro ao executar comando: ${err.message}`);
    await reply('🎙️ Entendi o comando, mas algo deu errado ao executar. Tenta pelo painel?');
    return true; // já tentamos executar — não cai no resumo normal
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────
//  PIPELINE E — WhatsApp via Evolution API (self-hosted)
// ─────────────────────────────────────────────────────────────────
async function processEvolutionJob(job: Job) {
  const { userId, numberId, instanceName, senderPhone, senderName, messageData, durationHint } = job.data;

  log(job, `📥 Evolution API: ${senderName} (${senderPhone})`);

  let mp3Buffer: Buffer | null = null;

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // 🆕 DEMO PÚBLICA (número público) — estranho envia áudio, respondemos
    // com transcrição + CTA de cadastro. NÃO conta quota, NÃO salva no DB.
    // ═══════════════════════════════════════════════════════════════════════
    const isPublicDemo = job.data.isPublicDemo === true;

    // PASSO 1: Verificar saldo e buscar o número (skippado para demo pública)
    const [balance, whatsappNumber] = isPublicDemo
      ? [null, numberId
            ? await prisma.whatsappNumber.findUnique({ where: { id: numberId } })
            : null]
      : await Promise.all([
          prisma.minuteBalance.upsert({
            where:  { userId },
            update: {},
            create: { userId, availableMinutes: 0, accumulatedMinutes: 0, resetAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
          }),
          numberId
            ? prisma.whatsappNumber.findUnique({ where: { id: numberId } })
            : prisma.whatsappNumber.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        ]);

    // Cota por ÁUDIOS (métrica primária). FREE atinge o limite → bloqueia + upsell
    // (aviso só ao próprio usuário). PRO → teto oculto de segurança (500/mês), skip silencioso.
    // ⚠️ Demo pública NÃO conta quota — cu$to de aquisição.
    if (!isPublicDemo) {
      const usage = await loadUsage(userId);
      if (!usage.allowed) {
        log(job, `⚠️  Cota de áudios atingida (${usage.used}/${usage.quota}, plano ${usage.plan})`);
        if (usage.plan === 'free') {
          triggerQuotaBlockNotice(userId).catch(() => null);
        }
        return { skipped: true, reason: usage.plan === 'free' ? 'free_quota_reached' : 'pro_cap_reached' };
      }
      log(job, `✅ Cota OK: ${usage.used}/${usage.quota} áudios (${usage.plan})`);
    } else {
      log(job, `🆕 Demo pública: quota ignorada`);
    }

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

    // PASSO 3.5: Teto de 10 min — rejeita antes de processar (não conta cota).
    const estDurSec = Math.max(estimateMp3DurationSec(mp3Buffer), durationHint || 0);
    if (isAudioTooLong(estDurSec)) {
      log(job, `⚠️  Áudio acima de 10 min (~${Math.round(estDurSec / 60)}min) — rejeitado sem contar cota`);
      const instNameReject = instanceName ?? whatsappNumber.zapiInstanceId;
      if (instNameReject) await sendMessageViaEvolution(instNameReject, senderPhone, REJECT_TOO_LONG_MSG).catch(() => null);
      return { skipped: true, reason: 'audio_too_long' };
    }

    // PASSO 4: Converter com Whisper (chunking automático p/ áudios longos)
    log(job, '🎙️  Whisper API (auto-idioma)...');
    const { text: originalText, durationSec: whisperDuration, language: detectedLanguage } =
      await transcribeAudio(mp3Buffer, { vocab: [senderName] });
    const durationSec = whisperDuration > 0 ? whisperDuration : Math.max(1, durationHint || 1);
    log(job, `✅ ${durationSec}s — lang:${detectedLanguage} — "${originalText.substring(0, 60)}..."`);

    // Self-note: áudio que o usuário encaminhou para o próprio número (self-chat).
    // Nesse caso a resposta volta ao próprio chat (senderPhone == número conectado)
    // e NÃO aplicamos modo privado (cabeçalho dedicado de nota/encaminhado).
    const isSelfNote = job.data.isSelfNote === true;

    // PASSO 4.5: comando de voz do módulo Cobrança (#1/#7) — só em self-note.
    // Se bater uma intenção, executa a ação e ENCERRA aqui (não gera resumo
    // duplicado); se não bater nada, cai no fluxo normal de transcrição abaixo.
    if (isSelfNote) {
      const handledByCobranca = await tryHandleCobrancaVoiceCommand({
        userId,
        text: originalText,
        instanceName: instName,
        ownerPhone: senderPhone,
      });
      if (handledByCobranca) {
        log(job, '✅ Comando de voz da Cobrança executado');
        await markChatAsUnread(instName, senderPhone).catch(() => null);
        return { skipped: true, reason: 'cobranca_voice_command' };
      }
    }

    // PASSO 5: Resumo com Claude (densidade por duração + tradução se não PT-BR)
    log(job, '🤖 Claude resumo...');
    const bullets = await generateBullets(originalText, durationSec, detectedLanguage);
    log(job, `✅ ${bullets.length} bullet(s)`);

    // PASSO 6: Enviar resposta via Evolution API
    log(job, '📤 Enviando resposta via Evolution API...');

    // 🆕 Demo pública: responde ao estranho com transcrição + CTA de cadastro.
    if (isPublicDemo) {
      const APP_URL = process.env.APP_URL || 'https://zapscript.me';
      const demoHeader = `🔊 *Transcrição gratuita — ZapScript*${durationSec ? ` • ${durationSec >= 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s` : `${durationSec}s`}` : ''}`;
      const bulletsStr = bullets.length > 0
        ? `\n\n📋 *Resumo*\n${bullets.map((b: string) => `• ${b}`).join('\n')}`
        : '';
      const ctaBlock =
        `\n\n━━━━━━━━━━━━━━━━━━\n` +
        `⚡ *ZapScript* faz isso automático no seu WhatsApp — 24h por dia.\n` +
        `👉 ${APP_URL}/cadastro?ref=public\n\n` +
        `_15 áudios grátis · sem cartão de crédito · cancele quando quiser_`;

      // Cabeçalho de áudio público (não privado, não self-note)
      const header = `🎙️ *${senderName || fmtPhone(senderPhone)}*${bullets.length > 0 ? `\n→ ${bullets[0]}` : ''}`;

      const messages: string[] = [];
      // Bloco 1: transcrição completa (corta se > 1000 chars)
      const fullText = `🔊 *Transcrição*\n\n${originalText}`;
      messages.push(fullText.length > 1200 ? fullText.slice(0, 1197) + '…' : fullText);

      // Bloco 2: resumo + CTA
      const summaryBlock = bullets.length > 0 ? `📋 *Resumo*\n${bullets.map((b: string) => `• ${b}`).join('\n')}` : '';
      messages.push(summaryBlock + ctaBlock);

      for (const m of messages) {
        await sendMessageViaEvolution(instName, senderPhone, m);
      }
      log(job, `✅ Demo pública: ${messages.length} msg(ns) enviada(s) → ${senderPhone}`);

      // NÃO salva no banco, NÃO debita cota
      return { ok: true, isPublicDemo: true };
    }

    // Modo Privado é OPT-IN: usuário ativa manualmente no painel.
    // Disponível apenas para planos pagos. Quando ligado (privateMode === true),
    // a transcrição vai só ao próprio número (nunca cai na conversa do contato).
    // Desativado em self-notes (áudio que o próprio usuário encaminhou).
    const usage = await loadUsage(userId);
    const isPaidPlan  = usage.plan === 'pro';
    const isPrivate   = !isSelfNote
                        && isPaidPlan
                        && !!whatsappNumber.privateMode
                        && !!whatsappNumber.phoneNumber
                        && whatsappNumber.phoneNumber !== 'pending';
    const targetPhone = isPrivate ? whatsappNumber.phoneNumber! : senderPhone;

    // Rodapé viral: mostra sempre, exceto Modo Privado ativo ou self-note.
    const footer = decideFooter(isSelfNote, isPrivate);

    const messages = buildMessage(bullets, originalText, {
      contactName: senderName,
      durationSec,
      isPrivate,
      senderPhone,
      isSelfNote,
      forwarded:   job.data.forwarded === true,
      originPhone: (job.data.originPhone as string | undefined) ?? null,
      footerText:  footer.variantText,
    });

    for (const m of messages) await sendMessageViaEvolution(instName, targetPhone, m);
    log(job, `✅ ${messages.length} mensagem(ns) enviada(s) ${isPrivate ? `(🔒 privado → ${targetPhone})` : 'na conversa'}`);

    // PASSO 6.5: Marcar conversa como não lida
    await markChatAsUnread(instName, senderPhone);

    // PASSO 7: Salvar conversão e debitar minutos
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
      footerShown:   footer.show,
      footerVariant: footer.variantId,
    });

    // Comando de Voz Universal: self-note pode ser também um comando (CRM/Atende/stats).
    // Fire-and-forget — nunca deve atrasar nem arriscar a entrega da transcrição acima.
    if (isSelfNote) {
      voiceCommandQueue.add('classify', {
        userId,
        numberId:        whatsappNumber.id,
        instanceName:    instName,
        senderPhone,
        transcriptionId: transcription.id,
        rawText:         originalText,
      }).catch((err: any) => logger.error(`[VoiceCommand] Falha ao enfileirar: ${err.message}`));
    }

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
//  PIPELINE D — Legendas (upload de vídeo → .srt/.vtt), fila própria
// ─────────────────────────────────────────────────────────────────
const LEGENDA_UPLOADS_BUCKET   = 'legenda-uploads';
const LEGENDA_OUTPUT_BUCKET    = 'legenda-output';
const LEGENDA_MAX_DURATION_SEC = 10 * 60; // teto de custo (Whisper + CPU de extração)

async function downloadFromBucket(bucket: string, storageKey: string): Promise<Buffer> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase não configurado no worker (SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  const { data, error } = await sb.storage.from(bucket).download(storageKey);
  if (error) throw new Error(`Supabase Storage download falhou (${bucket}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function uploadToBucket(bucket: string, storageKey: string, buffer: Buffer, contentType: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase não configurado no worker (SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  await sb.storage.createBucket(bucket, { public: false }).catch(() => null);
  const { error } = await sb.storage.from(bucket).upload(storageKey, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Supabase Storage upload falhou (${bucket}): ${error.message}`);
}

async function deleteFromBucket(bucket: string, storageKey: string): Promise<void> {
  try {
    const sb = getSupabaseClient();
    if (!sb) return;
    await sb.storage.from(bucket).remove([storageKey]);
  } catch { /* non-fatal */ }
}

function srtTimestamp(sec: number): string {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

/** Mesma base do .srt, trocando vírgula por ponto nos milissegundos (spec WebVTT) */
function vttTimestamp(sec: number): string {
  return srtTimestamp(sec).replace(',', '.');
}

function buildSrt(segments: WhisperSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${srtTimestamp(seg.start)} --> ${srtTimestamp(seg.end)}\n${seg.text.trim()}\n`)
    .join('\n');
}

function buildVtt(segments: WhisperSegment[]): string {
  const body = segments
    .map((seg) => `${vttTimestamp(seg.start)} --> ${vttTimestamp(seg.end)}\n${seg.text.trim()}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

async function processLegendaJob(job: Job) {
  const { legendaJobId, userId, storageKey, originalFilename } = job.data;

  log(job, `📥 Legendas: job ${legendaJobId} (${originalFilename})`);

  let mp3Buffer: Buffer | null = null;

  try {
    await prisma.legendaJob.update({ where: { id: legendaJobId }, data: { status: 'processing' } });

    // PASSO 1: baixar vídeo do bucket de upload
    log(job, `☁️ Baixando vídeo: ${storageKey}`);
    const videoBuffer = await downloadFromBucket(LEGENDA_UPLOADS_BUCKET, storageKey);
    log(job, `✅ Baixado: ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);

    // PASSO 2: extrair áudio — convertToMp3 já lida com containers de vídeo (ex. MOV/MP4)
    log(job, '🔄 Extraindo áudio do vídeo...');
    const ext = (originalFilename?.split('.').pop() || 'mp4').toLowerCase();
    mp3Buffer = await convertToMp3(videoBuffer, ext);
    log(job, `✅ Áudio extraído: ${(mp3Buffer.length / 1024).toFixed(0)} KB`);

    // PASSO 3: teto de duração — rejeita antes de gastar Whisper
    const estDur = estimateMp3DurationSec(mp3Buffer);
    if (estDur > LEGENDA_MAX_DURATION_SEC) {
      throw new Error(`Vídeo acima do limite de ${LEGENDA_MAX_DURATION_SEC / 60} min (~${Math.round(estDur / 60)} min detectado)`);
    }

    // PASSO 4: Whisper com timestamps por segmento.
    // juridical:true é o único flag que faz transcribeAudio devolver `segments`
    // (reaproveitado aqui só pela marcação temporal, não pelo conteúdo do prompt).
    log(job, '🎙️ Whisper — segmentos com timestamp...');
    const { durationSec, language, segments } = await transcribeAudio(mp3Buffer, { juridical: true });
    log(job, `✅ ${durationSec}s — lang:${language} — ${segments.length} segmento(s)`);

    if (!segments.length) {
      throw new Error('Nenhuma fala detectada no vídeo');
    }

    // PASSO 5: gerar .srt e .vtt
    const srt = buildSrt(segments);
    const vtt = buildVtt(segments);

    // PASSO 6: salvar arquivos de saída
    const srtKey = `${userId}/${legendaJobId}.srt`;
    const vttKey = `${userId}/${legendaJobId}.vtt`;
    await uploadToBucket(LEGENDA_OUTPUT_BUCKET, srtKey, Buffer.from(srt, 'utf-8'), 'text/plain; charset=utf-8');
    await uploadToBucket(LEGENDA_OUTPUT_BUCKET, vttKey, Buffer.from(vtt, 'utf-8'), 'text/vtt; charset=utf-8');
    log(job, `✅ Legendas salvas: ${srtKey} / ${vttKey}`);

    // PASSO 7: concluir job e limpar upload original (só após sucesso — ver nota no catch)
    await prisma.legendaJob.update({
      where: { id: legendaJobId },
      data: { status: 'done', durationSec, language, srtStorageKey: srtKey, vttStorageKey: vttKey },
    });
    await deleteFromBucket(LEGENDA_UPLOADS_BUCKET, storageKey);

    log(job, `✅ Legenda concluída — ${legendaJobId}`);
    return { legendaJobId };

  } catch (err) {
    log(job, `❌ Erro no job de legenda: ${(err as Error).message}`);
    await prisma.legendaJob.update({
      where: { id: legendaJobId },
      data: { status: 'error', errorMessage: (err as Error).message.slice(0, 500) },
    }).catch(() => null);

    // Diferente do pipeline manual: só apaga o upload original na ÚLTIMA tentativa,
    // para permitir retry do BullMQ sem perder o arquivo fonte em falhas transitórias.
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
    if (isLastAttempt) await deleteFromBucket(LEGENDA_UPLOADS_BUCKET, storageKey);
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
  if (source === 'vendas')          return (await import('./modules/vendas/process')).processVendasJob(job);
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

logger.info('Worker de conversão iniciado (WhatsApp + Upload manual)');

// ─────────────────────────────────────────────────────────────────
//  WORKER SETUP — Legendas (fila própria, isolada da fila de WhatsApp)
// ─────────────────────────────────────────────────────────────────
const legendaWorker = new Worker('legendas', processLegendaJob, {
  connection:      redis as any,
  concurrency:     parseInt(process.env.LEGENDA_WORKER_CONCURRENCY || '1'),
  lockDuration:    15 * 60_000, // extração de vídeo + Whisper pode passar do tempo de um áudio
  lockRenewTime:   Math.floor(15 * 60_000 / 2),
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

legendaWorker.on('completed', (job) => {
  logger.info(`[LegendaWorker] ✅ Job ${job.id} concluído`);
});

legendaWorker.on('failed', (job, err) => {
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 2;
  logger.error(`[LegendaWorker] ❌ Job ${job?.id} falhou (tentativa ${attempts}/${maxAttempts}): ${err.message}`);
});

legendaWorker.on('stalled', (jobId) => {
  logger.warn(`[LegendaWorker] ⚠️ Job ${jobId} ficou stalled`);
});

legendaWorker.on('error', (err) => {
  logger.error('[LegendaWorker] Erro interno', { err: err.message });
});

logger.info('Worker de Legendas iniciado');

// ─────────────────────────────────────────────────────────────────
//  WORKER — Campanhas (disparo em massa via Meta Cloud API)
// ─────────────────────────────────────────────────────────────────
// Fila e worker separados da fila 'transcriptions': domínio isolado, permite
// tunar concorrência/rate limit sem afetar o pipeline de transcrição.
const CAMPANHAS_CONCURRENCY = parseInt(process.env.CAMPANHAS_WORKER_CONCURRENCY || '3', 10);

const campanhasWorker = new Worker('campanhas', processCampanhaJob, {
  connection:  redis as any,
  concurrency: CAMPANHAS_CONCURRENCY,
  limiter:     { max: 10, duration: 1_000 }, // teto de segurança: 10 envios/seg à Graph API
});

campanhasWorker.on('completed', (job, result) => {
  if (result?.skipped) {
    logger.warn(`[Campanhas] Job ${job.id} ignorado — motivo: ${result.reason}`);
  } else {
    logger.info(`[Campanhas] ✅ Job ${job.id} concluído`);
  }
});

campanhasWorker.on('failed', (job, err) => {
  const attempts    = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 3;
  logger.error(`[Campanhas] ❌ Job ${job?.id} falhou (tentativa ${attempts}/${maxAttempts}): ${err.message}`);
  // Só marca o contato como 'failed' quando as tentativas realmente se esgotaram —
  // o evento 'failed' dispara a cada tentativa, não só na exaustão (ver comentário em modules/campanhas.ts).
  if (job && attempts >= maxAttempts) {
    markCampanhaJobExhausted(job, err).catch((e) =>
      logger.error(`[Campanhas] Falha ao marcar contato como failed: ${e.message}`));
  }
});

campanhasWorker.on('error', (err) => {
  logger.error('[Campanhas] Erro interno', { err: err.message });
});

logger.info('Worker de campanhas iniciado (Meta Cloud API)');

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
            create: { userId: sub.userId, availableMinutes: freePlan.minutesPerMonth, audiosUsed: 0, resetAt: nextReset, lastAlertSent: null },
            update: { availableMinutes: freePlan.minutesPerMonth, audiosUsed: 0, resetAt: nextReset, lastAlertSent: null },
          }),
          // Tiers ZapScript 2.0: falta de pagamento cancela o tier → revoga os
          // módulos que vieram no pacote (source='bundle'). Módulos comprados
          // avulso (source='paid') seguem sua própria cobrança agregada.
          prisma.entitlement.updateMany({
            where: { userId: sub.userId, source: 'bundle', status: { in: ['active', 'trialing'] } },
            data:  { status: 'canceled', canceledAt: now },
          }),
        ]);
        // Mesma chave de cache usada por moduleGate.ts (apps/api) — invalida para
        // o 402/entitlement refletir a revogação sem esperar o TTL de 60s.
        await redis.del(`ent:${sub.userId}`).catch(() => null);

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
                Por falta de pagamento, sua assinatura <strong>${sub.plan.label}</strong> foi cancelada e sua conta foi movida para o <strong>plano gratuito (15 áudios/mês)</strong>.<br><br>
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
          const msg = `🔴 *ZapScript* — Assinatura cancelada\n\nOlá! Sua assinatura *${sub.plan.label}* foi cancelada por falta de pagamento.\n\nSua conta foi movida para o plano gratuito (15 áudios/mês).\n\nPara reativar:\n👉 ${APP_URL}/dashboard/plano`;
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
          audiosUsed:       0, // métrica primária — zera o contador de áudios do ciclo
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
                Para continuar com o <strong>Plano Pro (áudios ilimitados)</strong>, assine agora com desconto exclusivo.
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
//  CRON — Resumo semanal via WhatsApp ao próprio número (Lote B #5c)
//  Segundas, ~9h BRT (12h UTC). Reforço de valor recorrente no canal
//  de maior abertura. Só engajados (≥1 conversão em 7d) com número
//  conectado. Idempotente por semana ISO. A mensagem vai SEMPRE ao
//  número do próprio usuário (self-chat) — nunca à conversa do contato.
// ─────────────────────────────────────────────────────────────────
/** Identificador de semana ISO (ex.: "2026-W26") para idempotência semanal. */
function isoWeekTag(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function runWeeklyWhatsappDigest() {
  const now = new Date();
  // Roda de hora em hora; dispara só na segunda às 12h UTC (~9h BRT) → 1x/semana.
  if (now.getUTCDay() !== 1 || now.getUTCHours() !== 12) return;

  const tag     = `wadigest_${isoWeekTag(now)}`;
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const APP_URL = process.env.APP_URL || 'https://zapscript.me';

  try {
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        NOT:           { lifecycleEmailsSent: { has: tag } },
        transcriptions: { some: { createdAt: { gte: weekAgo } } },
        numbers:        { some: { status: 'connected', zapiInstanceId: { not: null }, phoneNumber: { not: null } } },
      },
      select: {
        id: true, name: true, lifecycleEmailsSent: true,
        numbers: {
          where:   { status: 'connected', zapiInstanceId: { not: null }, phoneNumber: { not: null } },
          orderBy: { connectedAt: 'desc' },
          take:    1,
          select:  { zapiInstanceId: true, phoneNumber: true },
        },
      },
    }).catch(() => [] as any[]);

    let sent = 0;
    for (const u of users) {
      if (u.lifecycleEmailsSent.includes(tag)) continue; // belt & suspenders
      const n = u.numbers?.[0];
      if (!n?.zapiInstanceId || !n?.phoneNumber) continue;

      const agg = await prisma.transcription.aggregate({
        where:  { userId: u.id, createdAt: { gte: weekAgo } },
        _sum:   { durationSec: true },
        _count: true,
      }).catch(() => null);
      const cnt = agg?._count || 0;
      if (cnt === 0) continue;
      const savedSec   = agg?._sum.durationSec || 0;
      const savedLabel = formatSavedTime(savedSec);
      const firstName  = u.name?.split(' ')[0] || 'você';

      const msg =
        `📊 *ZapScript* — seu resumo da semana\n\n` +
        `Olá, ${firstName}! Nos últimos 7 dias eu li *${cnt} áudio${cnt !== 1 ? 's' : ''}* por você` +
        (savedSec > 0 ? ` e te poupei *${savedLabel}* que você não precisou parar pra ouvir` : '') + `.\n\n` +
        `Tudo já está no seu painel, em texto e com resumo — fácil de buscar quando precisar:\n${APP_URL}/dashboard`;

      // Envia ao número do PRÓPRIO usuário (self-chat) — nunca à conversa do contato.
      await sendMessageViaEvolution(n.zapiInstanceId, n.phoneNumber, msg).catch(() => null);
      await prisma.user.update({ where: { id: u.id }, data: { lifecycleEmailsSent: { push: tag } } }).catch(() => null);
      sent++;
    }
    if (sent > 0) logger.info(`[Cron] Resumo semanal WhatsApp enviado a ${sent} usuário(s)`);
  } catch (err) {
    logger.error(`[Cron] Erro no resumo semanal WhatsApp: ${(err as Error).message}`);
  }
}

runWeeklyWhatsappDigest();
setInterval(runWeeklyWhatsappDigest, 60 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────
//  CRON — Lembretes de Cobrança via WhatsApp (módulo Cobrança)
//  Roda de hora em hora; dispara só às 12h UTC (~9h BRT) → 1x/dia.
//  Régua configurável por dono (CobrancaConfig.diasAntes/diasDepois);
//  sem config, usa default D-1 (antes) + D0 (vence hoje) + D+1/3/7 (atraso).
//  Não é gateway de pagamento — só lembrete. Idempotente via CobrancaEnvio
//  (1 tipo por cobrancaId); reenvio depois disso é manual, via API.
// ─────────────────────────────────────────────────────────────────
function cobrancaDateOnlyUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(d: Date): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

type CobrancaTom = 'cordial' | 'formal' | 'direto';
type CobrancaFase = 'antes' | 'hoje' | 'depois';

// Mesmos templates/tons da API (apps/routes/cobranca.ts) — duplicado de propósito:
// apps/worker builda isolado de apps/api (rootDir/Docker context próprios).
const COBRANCA_TEMPLATES: Record<CobrancaTom, Record<CobrancaFase, (o: { primeiroNome: string; descricao: string; valorFmt: string; dataFmt: string }) => string>> = {
  cordial: {
    antes:  (o) => `Olá, ${o.primeiroNome}! Passando para avisar que *${o.descricao}* no valor de *${o.valorFmt}* vence em ${o.dataFmt}. Qualquer dúvida, é só responder por aqui. 🙂`,
    hoje:   (o) => `Olá, ${o.primeiroNome}! Passando para lembrar que *${o.descricao}* no valor de *${o.valorFmt}* vence hoje (${o.dataFmt}). Qualquer dúvida, é só responder por aqui. 🙂`,
    depois: (o) => `Olá, ${o.primeiroNome}! *${o.descricao}* no valor de *${o.valorFmt}* venceu em ${o.dataFmt} e ainda consta em aberto. Se já pagou, pode desconsiderar esta mensagem — qualquer dúvida, é só responder por aqui.`,
  },
  formal: {
    antes:  (o) => `Prezado(a) ${o.primeiroNome}, informamos que *${o.descricao}*, no valor de *${o.valorFmt}*, vencerá em ${o.dataFmt}. Permanecemos à disposição para qualquer esclarecimento.`,
    hoje:   (o) => `Prezado(a) ${o.primeiroNome}, informamos que *${o.descricao}*, no valor de *${o.valorFmt}*, vence hoje (${o.dataFmt}). Permanecemos à disposição para qualquer esclarecimento.`,
    depois: (o) => `Prezado(a) ${o.primeiroNome}, *${o.descricao}*, no valor de *${o.valorFmt}*, venceu em ${o.dataFmt} e permanece em aberto até o momento. Caso o pagamento já tenha sido efetuado, favor desconsiderar. Permanecemos à disposição.`,
  },
  direto: {
    antes:  (o) => `${o.primeiroNome}, *${o.descricao}* (*${o.valorFmt}*) vence em ${o.dataFmt}.`,
    hoje:   (o) => `${o.primeiroNome}, *${o.descricao}* (*${o.valorFmt}*) vence hoje (${o.dataFmt}).`,
    depois: (o) => `${o.primeiroNome}, *${o.descricao}* (*${o.valorFmt}*) venceu em ${o.dataFmt} e segue em aberto. Se já pagou, desconsidere.`,
  },
};

function cobrancaPixSuffix(pixKey?: string | null): string {
  return pixKey ? `\n\nPix para pagamento: *${pixKey}*` : '';
}

// Endurece o tom conforme os dias de atraso, quando o dono habilita escalarTom.
function cobrancaTomEfetivo(base: string | null | undefined, escalar: boolean, diasAtraso: number): CobrancaTom {
  const ordem: CobrancaTom[] = ['cordial', 'formal', 'direto'];
  let idx = Math.max(0, ordem.indexOf((base as CobrancaTom) || 'cordial'));
  if (escalar && diasAtraso > 0) {
    if (diasAtraso >= 7) idx = 2;
    else if (diasAtraso >= 3) idx = Math.max(idx, 1);
  }
  return ordem[idx];
}

function buildCobrancaReminderMessage(
  fase: CobrancaFase,
  opts: { nomeCliente: string; descricao: string; valor: number; vencimento: Date; tom?: string | null; escalarTom?: boolean; diasAtraso: number; pixKey?: string | null },
): string {
  const tom = cobrancaTomEfetivo(opts.tom, !!opts.escalarTom, opts.diasAtraso);
  const primeiroNome = opts.nomeCliente.trim().split(' ')[0] || opts.nomeCliente;
  const texto = COBRANCA_TEMPLATES[tom][fase]({
    primeiroNome,
    descricao: opts.descricao,
    valorFmt: formatBRL(opts.valor),
    dataFmt: formatDateBR(opts.vencimento),
  });
  return texto + cobrancaPixSuffix(opts.pixKey);
}

// 'vence_hoje'/'venceu' preservados por compat com envios já feitos em produção;
// demais offsets (régua configurável) usam 'd+N'/'d-N'.
function cobrancaEnvioTipo(diasAtraso: number): string {
  if (diasAtraso === 0) return 'vence_hoje';
  if (diasAtraso === 1) return 'venceu';
  return diasAtraso > 0 ? `d+${diasAtraso}` : `d${diasAtraso}`;
}

async function sendCobrancaReminders() {
  const today = cobrancaDateOnlyUTC(new Date());
  const windowStart = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000); // até 60 dias de atraso
  const windowEnd = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000); // até 30 dias antes do vencimento

  const cobrancas = await prisma.cobrancaCobranca.findMany({
    where: {
      status: 'pendente',
      deletedAt: null,
      vencimento: { gte: windowStart, lte: windowEnd },
    },
    include: {
      cliente: true,
      envios: { select: { tipo: true } },
      user: {
        select: {
          cobrancaConfig: true,
          numbers: {
            where: { status: 'connected', zapiInstanceId: { not: null } },
            orderBy: { connectedAt: 'desc' },
            take: 1,
            select: { zapiInstanceId: true },
          },
        },
      },
    },
  }).catch(() => [] as any[]);

  // Agrupa por instância WhatsApp: dentro da MESMA instância os envios ficam
  // sequenciais (evita rajada no mesmo número, que aumenta risco de bloqueio);
  // instâncias diferentes (usuários diferentes) enviam em paralelo, já que não
  // competem por rate limit nem risco de ban entre si.
  const porInstancia = new Map<string, any[]>();
  for (const c of cobrancas) {
    if (c.cliente.deletedAt) continue;
    const inst = c.user.numbers?.[0]?.zapiInstanceId;
    if (!inst) continue;

    const diasAtraso = Math.round((today.getTime() - cobrancaDateOnlyUTC(c.vencimento).getTime()) / (24 * 60 * 60 * 1000));
    const config = c.user.cobrancaConfig;
    const diasAntes: number[] = config?.diasAntes ?? [1];
    const diasDepois: number[] = config?.diasDepois ?? [1, 3, 7];

    const devido =
      diasAtraso === 0 ||
      (diasAtraso < 0 && diasAntes.includes(-diasAtraso)) ||
      (diasAtraso > 0 && diasDepois.includes(diasAtraso));
    if (!devido) continue;

    const tipo = cobrancaEnvioTipo(diasAtraso);
    if (c.envios.some((e: any) => e.tipo === tipo)) continue; // já enviado (idempotência)

    const fase: CobrancaFase = diasAtraso < 0 ? 'antes' : diasAtraso === 0 ? 'hoje' : 'depois';
    const item = { c, fase, diasAtraso, tipo, config };
    const grupo = porInstancia.get(inst);
    if (grupo) grupo.push(item); else porInstancia.set(inst, [item]);
  }

  let sent = 0;
  const enviarUm = async (inst: string, item: any) => {
    const { c, fase, diasAtraso, tipo, config } = item;
    const message = buildCobrancaReminderMessage(fase, {
      nomeCliente: c.cliente.nome,
      descricao: c.descricao,
      valor: c.valor,
      vencimento: c.vencimento,
      tom: config?.tom,
      escalarTom: config?.escalarTom,
      diasAtraso,
      pixKey: config?.pixKey,
    });
    try {
      await sendMessageViaEvolution(inst, c.cliente.telefone, message);
      await prisma.cobrancaEnvio.create({ data: { cobrancaId: c.id, tipo, sucesso: true } });
      sent++;
    } catch (err: any) {
      await prisma.cobrancaEnvio.create({
        data: { cobrancaId: c.id, tipo, sucesso: false, erro: String(err?.message || err) },
      }).catch(() => null);
      logger.error(`[Cron][Cobrança] Falha ao enviar lembrete ${tipo} (cobrancaId=${c.id}): ${err?.message}`);
    }
  };

  await Promise.all(
    Array.from(porInstancia.entries()).map(async ([inst, itens]) => {
      for (const item of itens) await enviarUm(inst, item);
    }),
  );

  if (sent > 0) logger.info(`[Cron][Cobrança] ${sent} lembrete(s) enviado(s)`);
}

async function runCobrancaReminders() {
  const now = new Date();
  // Roda de hora em hora; dispara só às 12h UTC (~9h BRT) → 1x/dia.
  if (now.getUTCHours() !== 12) return;

  try {
    await sendCobrancaReminders();
  } catch (err) {
    logger.error(`[Cron][Cobrança] Erro no lembrete de cobrança: ${(err as Error).message}`);
  }
}

runCobrancaReminders();
setInterval(runCobrancaReminders, 60 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────
//  CRON — Resumo diário de Cobrança via WhatsApp (módulo Cobrança)
//  Roda de hora em hora; dispara por dono no horário configurado
//  (CobrancaConfig.resumoHora, horário de Brasília). Texto simples,
//  enviado ao próprio número conectado (mesmo canal do self-note).
// ─────────────────────────────────────────────────────────────────
async function sendCobrancaResumoDiario() {
  const nowUtcHour = new Date().getUTCHours();
  const today = cobrancaDateOnlyUTC(new Date());
  const ontem = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const configs = await prisma.cobrancaConfig.findMany({ where: { resumoDiario: true } }).catch(() => [] as any[]);
  const devidos = configs.filter((cfg: any) => nowUtcHour === (cfg.resumoHora + 3) % 24);
  if (devidos.length === 0) return;

  for (const cfg of devidos) {
    const numero = await prisma.whatsappNumber.findFirst({
      where: { userId: cfg.userId, status: 'connected', zapiInstanceId: { not: null } },
      orderBy: { connectedAt: 'desc' },
    }).catch(() => null);
    if (!numero?.zapiInstanceId || !numero.phoneNumber || numero.phoneNumber === 'pending') continue;

    const [vencemHoje, vencidas, recebidasOntem] = await Promise.all([
      prisma.cobrancaCobranca.findMany({
        where: { userId: cfg.userId, status: 'pendente', deletedAt: null, vencimento: { gte: today, lt: new Date(today.getTime() + 86400000) } },
        include: { cliente: true },
      }),
      prisma.cobrancaCobranca.findMany({
        where: { userId: cfg.userId, status: 'pendente', deletedAt: null, vencimento: { lt: today } },
        include: { cliente: true },
      }),
      prisma.cobrancaCobranca.findMany({
        where: { userId: cfg.userId, status: 'paga', deletedAt: null, pagoEm: { gte: ontem } },
        include: { cliente: true },
      }),
    ]).catch(() => [[], [], []] as any[][]);

    if (vencemHoje.length === 0 && vencidas.length === 0 && recebidasOntem.length === 0) continue;

    const linhas: string[] = ['📊 *Resumo Cobrança — hoje*', ''];
    if (vencemHoje.length) {
      linhas.push(`🟡 Vencem hoje (${vencemHoje.length}):`);
      for (const c of vencemHoje) linhas.push(`  • ${c.cliente.nome} — ${formatBRL(c.valor)}`);
      linhas.push('');
    }
    if (vencidas.length) {
      linhas.push(`🔴 Em atraso (${vencidas.length}):`);
      for (const c of vencidas) linhas.push(`  • ${c.cliente.nome} — ${formatBRL(c.valor)} (venceu ${formatDateBR(c.vencimento)})`);
      linhas.push('');
    }
    if (recebidasOntem.length) {
      const total = (recebidasOntem as any[]).reduce((s: number, c: any) => s + Number(c.valor), 0);
      linhas.push(`🟢 Recebidas nas últimas 24h (${recebidasOntem.length}): ${formatBRL(total)}`);
    }

    try {
      await sendMessageViaEvolution(numero.zapiInstanceId, numero.phoneNumber, linhas.join('\n').trim());
    } catch (err: any) {
      logger.error(`[Cron][Cobrança] Falha ao enviar resumo diário (userId=${cfg.userId}): ${err?.message}`);
    }
  }
}

async function runCobrancaResumoDiario() {
  try {
    await sendCobrancaResumoDiario();
  } catch (err) {
    logger.error(`[Cron][Cobrança] Erro no resumo diário: ${(err as Error).message}`);
  }
}

runCobrancaResumoDiario();
setInterval(runCobrancaResumoDiario, 60 * 60 * 1000);

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

// ─────────────────────────────────────────────────────────────────
//  CRON — Relatório periódico do Programa de Afiliados
//  Cadência ("weekly" | "monthly") e destino (e-mail) configuráveis pelo
//  admin sem redeploy, via AffiliateConfig chave "reportSchedule" (ver
//  apps/api/src/lib/affiliateConfig.ts — mesma tabela, lida aqui direto
//  pelo Prisma pois o worker não importa código de apps/api).
//  Verifica a cada hora; dispara uma vez por período (semana ISO ou mês)
//  e é idempotente via chave "reportLastSent" na mesma tabela.
// ─────────────────────────────────────────────────────────────────
function monthTag(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function runAffiliateReportSchedule(): Promise<void> {
  try {
    const [scheduleRow, lastSentRow] = await Promise.all([
      (prisma as any).affiliateConfig.findUnique({ where: { key: 'reportSchedule' } }),
      (prisma as any).affiliateConfig.findUnique({ where: { key: 'reportLastSent' } }),
    ]);
    const cadence: 'off' | 'weekly' | 'monthly' = scheduleRow?.value?.cadence || 'off';
    const destination: string = (scheduleRow?.value?.destination || '').trim();
    if (cadence === 'off' || !destination) return;

    const now = new Date();
    const tag = cadence === 'weekly' ? isoWeekTag(now) : monthTag(now);
    if (lastSentRow?.value?.tag === tag) return; // já enviado neste período

    const dayMs       = 24 * 60 * 60 * 1000;
    const periodStart = new Date(now.getTime() - (cadence === 'weekly' ? 7 : 30) * dayMs);

    const [newAffiliates, conversions, commissionAgg, payoutAffiliates] = await Promise.all([
      (prisma as any).affiliate.count({ where: { appliedAt: { gte: periodStart } } }),
      (prisma as any).affiliateReferral.count({ where: { status: 'converted', convertedAt: { gte: periodStart } } }),
      (prisma as any).affiliateCommission.aggregate({
        where: { createdAt: { gte: periodStart } },
        _sum:  { commissionAmount: true },
        _count: true,
      }),
      (prisma as any).affiliate.findMany({
        where:  { payoutRequestedAt: { not: null }, commissions: { some: { status: 'pending' } } },
        select: { id: true, commissions: { where: { status: 'pending' }, select: { commissionAmount: true } } },
      }),
    ]);

    const payoutCount  = payoutAffiliates.length;
    const payoutAmount = payoutAffiliates.reduce((sum: number, a: any) =>
      sum + a.commissions.reduce((s: number, c: any) => s + c.commissionAmount, 0), 0);

    const fmtBRL       = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const periodLabel  = cadence === 'weekly' ? 'nos últimos 7 dias' : 'nos últimos 30 dias';
    const cadenceLabel = cadence === 'weekly' ? 'semanal' : 'mensal';
    const APP_URL      = process.env.APP_URL || 'https://zapscript.me';

    const subject = `📊 ZapScript — Relatório ${cadenceLabel} de afiliados`;
    const body = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
      <div style="font-size:22px;font-weight:bold;margin-bottom:16px">📊 Relatório ${cadenceLabel} — Programa de Afiliados</div>
      <div style="font-size:14px;line-height:1.9;color:#a7f3d0">
        Resumo ${periodLabel}:<br><br>
        🆕 Novos afiliados: <strong>${newAffiliates}</strong><br>
        ✅ Conversões (indicados que assinaram): <strong>${conversions}</strong><br>
        💰 Comissões geradas: <strong>${commissionAgg._count}</strong> (${fmtBRL(commissionAgg._sum.commissionAmount || 0)})<br>
        💸 Saques pendentes: <strong>${payoutCount}</strong> afiliado(s) — ${fmtBRL(payoutAmount)}
      </div>
      <div style="margin:24px 0;text-align:center">
        <a href="${APP_URL}/g5r8t2" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver painel admin →</a>
      </div>
      <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
    </div>`;

    await sendEmail(destination, subject, body);
    await (prisma as any).affiliateConfig.upsert({
      where:  { key: 'reportLastSent' },
      create: { key: 'reportLastSent', value: { tag } },
      update: { value: { tag }, updatedAt: new Date() },
    });
    logger.info(`[Afiliados] Relatório ${cadenceLabel} enviado a ${destination} (tag: ${tag})`);
  } catch (err: any) {
    logger.error(`[Afiliados] Falha no relatório periódico: ${err?.message}`);
  }
}

// Verifica a cada hora se é hora de enviar (idempotente por período — ver acima)
runAffiliateReportSchedule();
setInterval(runAffiliateReportSchedule, 60 * 60 * 1000);

// ── Graceful shutdown ────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('Worker encerrando...');
  const forceExit = setTimeout(() => {
    logger.error('Worker graceful shutdown timeout — forçando saída');
    process.exit(1);
  }, 30_000);
  try {
    await worker.close();
    await legendaWorker.close();
    await campanhasWorker.close();
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
