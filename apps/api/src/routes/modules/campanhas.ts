import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import {
  validateRequest, createCampanhaSchema, scheduleCampanhaSchema, campanhaSequenceSchema,
  createCampanhaListaSchema, updateCampanhaListaSchema, addCampanhaListaContatosSchema, applyCampanhaListaSchema,
  mergeCampanhaListasSchema,
} from '../../lib/validation';
import { decryptStr } from '../../services/encryption';
import { listTemplates, getPhoneNumberLimits, tierToNumericCap, sendTemplateMessage } from '../../services/whatsapp-campaigns';
import { sendText } from '../../services/evolution';
import { campanhasQueue } from '../../services/queue';
import { sendEmail } from '../../lib/mailer';
import { logger } from '../../lib/logger';
import { debitCampanhaMessages, InsufficientCampanhaBalanceError } from '../../lib/campanha-credit';

/**
 * ZapScript Campanhas — disparo em massa via WhatsApp API oficial (Meta Cloud API).
 * Gratuito pra todos os usuários (decisão de produto, 2026-09-09) — só exige
 * login (authenticate), sem gate de módulo/Entitlement. Ver CAMPANHAS_ARQUITETURA.md §16.
 * Credenciais Meta vêm do WhatsappNumber do próprio usuário (provider='meta'),
 * nunca de env global — ver services/whatsapp-campaigns.ts.
 *
 * O ENVIO em si (mensagens de verdade, não o acesso à tela) consome o mesmo
 * saldo do módulo Campanhas (30 grátis/mês + pré-pago + Mensal Ilimitado —
 * lib/campanha-credit.ts) que antes só o Chatbot debitava — decisão de
 * produto, 2026-09-09, ver CAMPANHAS_ARQUITETURA.md §17. Debitado em
 * POST /:id/start, pelo tamanho do lote que vai pra fila AGORA
 * (pendentes.length, não audienceCount) — uma campanha pausada/retomada só
 * cobra de novo pelos contatos que ainda não saíram.
 */

const PHONE_LIKE = /^\+?\d[\d\s()-]{7,}$/;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/** Palavras-chave de opt-out (convenção SMS/WhatsApp) — igualdade exata após trim+uppercase. */
export const OPT_OUT_KEYWORDS = new Set(['PARAR', 'SAIR', 'STOP', 'CANCELAR', 'UNSUBSCRIBE']);

/** Palavras-chave de opt-in (SIM). */
export const OPT_IN_KEYWORDS = new Set(['SIM']);

/** Palavras-chave de negação (NÃO/NAO). */
export const OPT_OUT_RESPONSE_KEYWORDS = new Set(['NÃO', 'NAO']);

/**
 * Detecta e processa resposta a pergunta de opt-in pendente.
 * Retorna: 'confirmed' | 'rejected' | 'none' (nenhuma resposta detectada)
 */
export async function handleOptinResponse(userId: string, rawPhone: string, messageText: string): Promise<'confirmed' | 'rejected' | 'none'> {
  const phone = normalizePhone(rawPhone);
  const normalized = messageText.trim().toUpperCase();

  // Detectar resposta: Sim = confirmar, Não/Sair = rejeitar
  if (OPT_IN_KEYWORDS.has(normalized)) {
    // Marca todos os CampanhaContato com status 'pending_optin' deste contato como 'confirmed'
    const updated = await prisma.campanhaContato.updateMany({
      where: {
        phone,
        status: 'pending_optin',
        campanha: { userId },
      },
      data: {
        optinConfirmedAt: new Date(),
        status: 'pending', // volta a enviar
      },
    });
    if (updated.count > 0) {
      // Também marcar no CrmContact se existir
      await prisma.crmContact.updateMany({
        where: { phone, userId },
        data: { whatsappOptinConfirmedAt: new Date() },
      });
      return 'confirmed';
    }
  }

  if (OPT_OUT_RESPONSE_KEYWORDS.has(normalized) || OPT_OUT_KEYWORDS.has(normalized)) {
    // Registra opt-out + marca como optout
    await registerCampanhaOptOut(userId, rawPhone, normalized);
    return 'rejected';
  }

  return 'none';
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * E-mail de conclusão quando o gatilho é opt-out em massa — caminho raro (exige
 * TODOS os pendentes de uma campanha 'running' saírem por opt-out antes do worker
 * processá-los; o caminho comum é notifyCampanhaCompleted no worker). Duplicada de
 * propósito — api e worker não compartilham código neste monorepo (ver §11/item 10).
 */
async function notifyCampanhaCompletedByOptOut(campanhaId: string): Promise<void> {
  const campanha = await prisma.campanha.findUnique({
    where: { id: campanhaId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!campanha?.user?.email) return;
  const APP_URL   = process.env.APP_URL || 'https://zapscript.me';
  const firstName = escHtml(campanha.user.name?.split(' ')[0] || 'tudo bem');
  const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
    <div style="font-size:22px;font-weight:bold;margin-bottom:16px">📣 Campanha concluída: ${escHtml(campanha.name)}</div>
    <div style="font-size:14px;line-height:1.9;color:#a7f3d0">
      Olá, ${firstName}!<br><br>
      Todos os contatos pendentes da campanha <strong>"${escHtml(campanha.name)}"</strong> saíram da lista por
      opt-out antes do envio, e por isso ela foi concluída automaticamente.<br><br>
      ✅ Enviados: <strong>${campanha.sentCount}</strong>
    </div>
    <div style="margin:24px 0;text-align:center">
      <a href="${APP_URL}/dashboard/campanhas/${campanhaId}" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver resultado completo →</a>
    </div>
    <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
  </div>`;
  await sendEmail(campanha.user.email, `📣 Campanha "${campanha.name}" concluída`, html);
}

/**
 * Registra opt-out de campanhas (upsert + marca CampanhaContato pendentes como
 * 'optout'). Compartilhado pelos dois webhooks de entrada — Meta oficial
 * (routes/whatsapp-webhook.ts) e Evolution (routes/evolution-webhook.ts) — pra não
 * duplicar essa lógica; cada webhook manda a mensagem de confirmação com seu
 * próprio cliente de envio (Meta ou sendText do Evolution) depois de chamar isto.
 *
 * IMPORTANTE (§11/item 9): um contato que opta por sair nunca passa pelo worker
 * (que é quem normalmente incrementa processedCount — ver bumpProcessedAndMaybeComplete
 * em apps/worker/src/modules/campanhas.ts), então esta função precisa fazer esse
 * incremento aqui, por campanha afetada — senão uma campanha com muitos opt-outs
 * nunca bateria audienceCount e ficaria "running" pra sempre. consecutiveFailures
 * (circuit breaker) NÃO é tocado aqui de propósito: opt-out é ação do destinatário,
 * não falha de envio/número.
 */
export async function registerCampanhaOptOut(userId: string, rawPhone: string, keyword: string): Promise<string> {
  const phone = normalizePhone(rawPhone);
  await prisma.campanhaOptOut.upsert({
    where:  { userId_phone: { userId, phone } },
    create: { userId, phone, reason: keyword },
    update: { reason: keyword },
  });

  const afetados = await prisma.campanhaContato.findMany({
    where: { phone, status: 'pending', campanha: { userId } },
    select: { id: true, campanhaId: true },
  });
  if (afetados.length === 0) return phone;

  await prisma.campanhaContato.updateMany({
    where: { id: { in: afetados.map((a: any) => a.id) } },
    data:  { status: 'optout' },
  });

  const porCampanha = new Map<string, number>();
  for (const a of afetados) porCampanha.set(a.campanhaId, (porCampanha.get(a.campanhaId) || 0) + 1);

  for (const [campanhaId, count] of porCampanha) {
    const updated = await prisma.campanha.update({
      where: { id: campanhaId },
      data: { processedCount: { increment: count } },
      select: { processedCount: true, audienceCount: true, status: true },
    });
    if (updated.status === 'running' && updated.processedCount >= updated.audienceCount) {
      const completed = await prisma.campanha.updateMany({
        where: { id: campanhaId, status: 'running' },
        data: { status: 'completed', completedAt: new Date() },
      });
      if (completed.count > 0) {
        notifyCampanhaCompletedByOptOut(campanhaId).catch((e: any) =>
          logger.warn(`[Campanhas] Falha ao notificar conclusão (via opt-out) da campanha ${campanhaId}: ${e.message}`));
      }
    }
  }

  return phone;
}

/**
 * Corte de recência da audiência "quente" (§11/item 8): contato que só falou com o
 * número há muito tempo não é mais "quente" de verdade — mandar campanha pra ele
 * carrega o mesmo risco de "mensagem não solicitada" que mandar pra um desconhecido.
 * Default generoso (180 dias) porque o guardrail principal já é "conversou alguma
 * vez"; isso só corta o extremo (contato de anos atrás), configurável por env.
 */
const WARM_AUDIENCE_DAYS = parseInt(process.env.CAMPANHAS_WARM_AUDIENCE_DAYS || '180', 10);

/**
 * Audiência "quente" pra campanhas via Evolution (channel='evolution'): união dos
 * telefones que já trocaram mensagem com este número recentemente, via transcrição
 * (core), Atende ou Copiloto — nunca CSV livre. É o guardrail central do canal
 * Evolution (ver CAMPANHAS_ARQUITETURA.md §8): só quem já tem relação com o número,
 * reduzindo o padrão de "spam pra desconhecido" que o WhatsApp mais penaliza.
 */
export async function warmContactsForNumber(numberId: string): Promise<Map<string, string | null>> {
  const cutoff = new Date(Date.now() - WARM_AUDIENCE_DAYS * 24 * 60 * 60 * 1000);
  const [transcricoes, atende, copiloto] = await Promise.all([
    prisma.transcription.findMany({
      where: { numberId, source: 'whatsapp', createdAt: { gte: cutoff } },
      select: { contactPhone: true, contactName: true },
    }),
    prisma.atendeConversation.findMany({
      where: { numberId, lastMessageAt: { gte: cutoff } },
      select: { contactPhone: true, contactName: true },
    }),
    prisma.copilotoConversation.findMany({
      where: { numberId, lastMessageAt: { gte: cutoff } },
      select: { contactPhone: true, contactName: true },
    }),
  ]);

  const byPhone = new Map<string, string | null>();
  for (const row of [...transcricoes, ...atende, ...copiloto]) {
    const phone = normalizePhone(row.contactPhone);
    if (!byPhone.has(phone) || (!byPhone.get(phone) && row.contactName)) {
      byPhone.set(phone, row.contactName ?? null);
    }
  }
  return byPhone;
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis  = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

/** Parser CSV minimalista com suporte a campos entre aspas (sem dependência externa). */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // ignorado — \n fecha a linha
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
}

async function ownedCampanha(userId: string, id: string) {
  return prisma.campanha.findFirst({ where: { id, userId } });
}

async function ownedLista(userId: string, id: string) {
  return prisma.campanhaLista.findFirst({ where: { id, userId } });
}

/** Conexão válida pra disparar, nos dois canais (Meta exige token; Evolution exige instância). */
function numberReadyToSend(whatsappNumber: { status: string; metaAccessTokenEnc: string | null; zapiInstanceId: string | null } | null, channel: string): boolean {
  if (!whatsappNumber || whatsappNumber.status !== 'connected') return false;
  // 'meta' é o default histórico (linhas antigas da migration não têm channel setado
  // explicitamente) — só trata como evolution quando for exatamente isso.
  return channel === 'evolution' ? !!whatsappNumber.zapiInstanceId : !!whatsappNumber.metaAccessTokenEnc;
}

const META_LIMITS_TTL_MS = 60 * 60 * 1000; // 1h — evita bater na Graph API a cada /start

/**
 * Garante um valor relativamente fresco de messaging_limit_tier/quality_rating
 * do número (Graph API) — ver CAMPANHAS_ARQUITETURA.md §5.1/§9. Cache de até 1h
 * em WhatsappNumber; se a Meta estiver indisponível, falha em silêncio e usa o
 * último valor conhecido (ou nenhum) em vez de bloquear o disparo por
 * instabilidade externa — mesma filosofia fail-open de moduleGate.ts.
 */
async function ensureFreshMetaLimits(whatsappNumber: {
  id: string;
  metaPhoneNumberId: string | null;
  metaAccessTokenEnc: string | null;
  metaMessagingLimitTier: string | null;
  metaQualityRating: string | null;
  metaLimitsSyncedAt: Date | null;
}): Promise<{ tier: string | null; quality: string | null }> {
  const fresh = !!whatsappNumber.metaLimitsSyncedAt
    && Date.now() - whatsappNumber.metaLimitsSyncedAt.getTime() < META_LIMITS_TTL_MS;
  const cached = { tier: whatsappNumber.metaMessagingLimitTier, quality: whatsappNumber.metaQualityRating };
  if (fresh || !whatsappNumber.metaPhoneNumberId || !whatsappNumber.metaAccessTokenEnc) return cached;

  try {
    const token = decryptStr(whatsappNumber.metaAccessTokenEnc);
    const limits = await getPhoneNumberLimits(token, whatsappNumber.metaPhoneNumberId);
    await prisma.whatsappNumber.update({
      where: { id: whatsappNumber.id },
      data: {
        metaMessagingLimitTier: limits.messagingLimitTier,
        metaQualityRating: limits.qualityRating,
        metaLimitsSyncedAt: new Date(),
      },
    });
    return { tier: limits.messagingLimitTier, quality: limits.qualityRating };
  } catch {
    return cached;
  }
}

interface TierDetail { numberId: string; tier: string | null; quality: string | null; cap: number | null }

/**
 * Números da "rotação de envio" de uma campanha (§11/item 2): o primário + os do
 * pool que estiverem prontos pra enviar AGORA. Compartilhada entre /:id/schedule,
 * /:id/start e o disparo automático (campanhas-scheduler.ts, cópia própria —
 * api/worker não compartilham código neste monorepo).
 */
export async function resolveSendNumbers(
  campanha: { poolNumberIds: string[]; channel: string },
  userId: string,
  primary: { id: string; status: string; metaAccessTokenEnc: string | null; zapiInstanceId: string | null },
): Promise<any[]> {
  let sendNumbers: any[] = [primary];
  if (campanha.poolNumberIds.length > 0) {
    const poolNumbers = await prisma.whatsappNumber.findMany({
      where: { id: { in: campanha.poolNumberIds }, userId, provider: campanha.channel },
    });
    sendNumbers = sendNumbers.concat(poolNumbers.filter((n: any) => numberReadyToSend(n, campanha.channel)));
  }
  return sendNumbers;
}

/**
 * Teto combinado de contatos únicos/24h somando o tier de cada número da rotação
 * (Graph API, cache de 1h via ensureFreshMetaLimits). null = tier desconhecido em
 * todos os números (fail-open, não bloqueia); Infinity = algum número é UNLIMITED.
 */
async function checkCombinedTierCap(sendNumbers: any[]): Promise<{ combinedCap: number | null; tierDetails: TierDetail[] }> {
  let combinedCap: number | null = 0;
  const tierDetails: TierDetail[] = [];
  for (const n of sendNumbers) {
    const { tier, quality } = await ensureFreshMetaLimits(n);
    const cap = tierToNumericCap(tier);
    tierDetails.push({ numberId: n.id, tier, quality, cap });
    if (cap === null) continue;
    if (!Number.isFinite(cap)) { combinedCap = Infinity; continue; }
    if (combinedCap !== null && Number.isFinite(combinedCap)) combinedCap += cap;
  }
  if (tierDetails.every((d) => d.cap === null)) combinedCap = null;
  return { combinedCap, tierDetails };
}

function tierExceededResponse(combinedCap: number, tierDetails: TierDetail[], pendentesCount: number, multiplas: boolean) {
  return {
    error: multiplas
      ? `Os ${tierDetails.length} números desta campanha somam um teto de ${combinedCap} contatos únicos/24h `
        + `e esta campanha tem ${pendentesCount} contatos pendentes — pode ser rejeitada em massa pela `
        + `Meta. Confirme que quer prosseguir mesmo assim (confirmExceedsTier: true) ou reduza a lista.`
      : `Este número está no tier "${tierDetails[0]?.tier}" da Meta (até ${tierDetails[0]?.cap} contatos únicos por 24h) `
        + `e esta campanha tem ${pendentesCount} contatos pendentes — pode ser rejeitada em `
        + `massa pela Meta. Confirme que quer prosseguir mesmo assim (confirmExceedsTier: true) `
        + `ou reduza a lista.`,
    metaMessagingLimitTier: tierDetails[0]?.tier ?? null,
    metaQualityRating: tierDetails[0]?.quality ?? null,
    metaTierCap: combinedCap,
    pendentesCount,
    numeros: multiplas ? tierDetails : undefined,
  };
}

const EVOLUTION_DAILY_LIMIT = parseInt(process.env.CAMPANHAS_EVOLUTION_DAILY_LIMIT || '40', 10);

/**
 * Espaçamento entre envios do canal Evolution — ritmo bem mais lento e "humano"
 * que o teto de segurança do Meta (10 msg/s), pra reduzir o risco de o WhatsApp
 * detectar padrão de disparo automatizado no número do próprio usuário (ver
 * CAMPANHAS_ARQUITETURA.md §8). Sem contador vivo em Redis: o intervalo médio já
 * é calculado pra manter o total dentro do limite diário (index 0 sai quase na
 * hora; os demais espaçados por ~24h / limite diário, com jitter de ±30%).
 * Duplicada de propósito em apps/worker/src/campanhas-scheduler.ts — api e
 * worker não compartilham código entre si neste monorepo.
 */
export function evolutionSendDelayMs(index: number, dailyLimit: number = EVOLUTION_DAILY_LIMIT): number {
  if (index <= 0) return 0;
  const baseIntervalMs = (24 * 60 * 60 * 1000) / Math.max(dailyLimit, 1);
  const jitter = (Math.random() * 0.6 - 0.3) * baseIntervalMs; // ±30%
  return Math.max(0, Math.round(index * baseIntervalMs + jitter));
}

const EVOLUTION_WARMUP_DAYS = parseInt(process.env.CAMPANHAS_EVOLUTION_WARMUP_DAYS || '10', 10);
const EVOLUTION_WARMUP_FLOOR_PCT = 0.15; // dia 1 já manda uma fração, não zero

/**
 * Aquecimento progressivo do canal Evolution (§11/item 3): um número recém-conectado
 * disparando no limite diário cheio desde o dia 1 é justamente o padrão que mais
 * aciona detecção de spam num número que ainda não tem histórico de uso "normal".
 * Rampa linear de EVOLUTION_WARMUP_FLOOR_PCT até 100% do limite ao longo de
 * EVOLUTION_WARMUP_DAYS a partir de connectedAt. Sem connectedAt (não deveria
 * acontecer com status='connected', mas defensivo) usa o limite cheio — fail-open,
 * mesma filosofia do resto do módulo.
 */
export function effectiveEvolutionDailyLimit(connectedAt: Date | null, dailyLimit: number = EVOLUTION_DAILY_LIMIT): number {
  if (!connectedAt || EVOLUTION_WARMUP_DAYS <= 0) return dailyLimit;
  const daysSinceConnected = (Date.now() - connectedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceConnected >= EVOLUTION_WARMUP_DAYS) return dailyLimit;
  const progress = Math.max(0, daysSinceConnected) / EVOLUTION_WARMUP_DAYS; // 0..1
  const pct = EVOLUTION_WARMUP_FLOOR_PCT + (1 - EVOLUTION_WARMUP_FLOOR_PCT) * progress;
  return Math.max(1, Math.round(dailyLimit * pct));
}

const SEND_WINDOW_START_HOUR = parseInt(process.env.CAMPANHAS_SEND_WINDOW_START_HOUR || '8', 10);
const SEND_WINDOW_END_HOUR   = parseInt(process.env.CAMPANHAS_SEND_WINDOW_END_HOUR || '21', 10);

/**
 * Janela de envio (§11/item 4): empurra um delay (ms a partir de agora) pra fora do
 * horário de silêncio (madrugada), horário de Brasília fixo (UTC-3, sem horário de
 * verão no Brasil desde 2019) — evita a campanha começar a mandar mensagem às 3h da
 * manhã só porque o usuário clicou em "iniciar" àquela hora, ou porque o índice de
 * um contato específico caiu de madrugada num disparo Evolution de vários dias.
 * Aplica-se por contato (cada horário-alvo é validado independentemente), não só
 * ao lote inteiro — importante pra campanhas Evolution que atravessam mais de um dia.
 */
export function applySendWindow(delayMs: number, now: Date = new Date()): number {
  if (SEND_WINDOW_START_HOUR <= 0 && SEND_WINDOW_END_HOUR >= 24) return delayMs; // janela desativada
  const target = new Date(now.getTime() + delayMs);
  const hourBRT = (target.getUTCHours() + 24 - 3) % 24;
  if (hourBRT >= SEND_WINDOW_START_HOUR && hourBRT < SEND_WINDOW_END_HOUR) return delayMs;
  const hoursUntilStart = hourBRT < SEND_WINDOW_START_HOUR
    ? SEND_WINDOW_START_HOUR - hourBRT
    : (24 - hourBRT) + SEND_WINDOW_START_HOUR;
  return delayMs + hoursUntilStart * 60 * 60 * 1000;
}

/**
 * Confirmação de consentimento/risco antes do 1º agendamento ou início de uma
 * campanha — em AMBOS os canais, com texto diferente por canal:
 * - 'meta': consentimento de marketing (opt-in) sobre a lista importada — LGPD e
 *   política de mensageria da Meta (ver CAMPANHAS_ARQUITETURA.md §3.4/§5.4).
 * - 'evolution': risco de banimento do próprio número pelo WhatsApp (mesmo número
 *   que serve core/atende/copiloto) — ver CAMPANHAS_ARQUITETURA.md §8.
 * Uma vez confirmado, fica salvo na campanha (consentConfirmedAt/Ip) — não pede
 * de novo em pause/resume, só na primeira vez que ela é agendada ou iniciada.
 */
function requireConsentAcknowledgement(campanha: { channel: string; consentConfirmedAt: Date | null }, body: any): string | null {
  if (campanha.consentConfirmedAt) return null;
  if (body?.confirmConsent === true) return null;
  return campanha.channel === 'evolution'
    ? 'Confirme que entende o risco de banimento do seu número pelo WhatsApp ao usar o canal Evolution (confirmConsent: true).'
    : 'Confirme que tem consentimento (opt-in) destes contatos para campanhas de marketing, conforme LGPD e política da Meta (confirmConsent: true).';
}

/**
 * Enfileira o disparo dos contatos 'pending' de uma campanha — jobId
 * determinístico campanhaId:contatoId (reenviar não duplica jobs em voo),
 * pool/round-robin (assignedNumberId — §11/item 2), aquecimento progressivo do
 * canal Evolution (§11/item 3) e janela de silêncio (§11/item 4). Recebe
 * `sendNumbers`/`pendentes` já resolvidos (pelo chamador) em vez de buscar de
 * novo — POST /:id/start já precisa dos dois antes de chegar aqui (checagem de
 * tier/audiência vazia), e o Chatbot Campanhas (services/
 * campanhas-chat-commands.ts) resolve os mesmos dois via resolveSendNumbers
 * (exportado) antes de chamar — mesma lógica dos dois caminhos, sem duplicar
 * nem sem re-buscar o que o chamador já tem em mãos.
 */
export async function enqueueCampanhaSend(
  campanhaId: string,
  channel: string,
  sendNumbers: any[],
  pendentes: { id: string }[],
): Promise<number> {
  if (pendentes.length === 0) return 0;

  // Round-robin entre os números da rotação (assignedNumberId) — só grava quando
  // há mais de 1 número; no caso comum (sem pool) o worker usa direto
  // campanha.whatsappNumber, sem query nem write extra (ver modules/campanhas.ts).
  if (sendNumbers.length > 1) {
    const grupos = new Map<string, string[]>();
    pendentes.forEach((p: any, i: number) => {
      const numberId = sendNumbers[i % sendNumbers.length].id;
      const arr = grupos.get(numberId);
      if (arr) arr.push(p.id); else grupos.set(numberId, [p.id]);
    });
    await Promise.all(
      Array.from(grupos.entries()).map(([numberId, ids]) =>
        prisma.campanhaContato.updateMany({ where: { id: { in: ids } }, data: { assignedNumberId: numberId } }),
      ),
    );
  }

  const dailyLimit = channel === 'evolution'
    ? Math.min(...sendNumbers.map((n: any) => effectiveEvolutionDailyLimit(n.connectedAt)))
    : EVOLUTION_DAILY_LIMIT;

  await campanhasQueue.addBulk(
    pendentes.map((p: any, i: number) => ({
      name: 'send',
      data: { campanhaId, contatoId: p.id },
      opts: {
        jobId: `${campanhaId}:${p.id}`,
        delay: applySendWindow(channel === 'evolution' ? evolutionSendDelayMs(i, dailyLimit) : 0),
      },
    })),
  );
  return pendentes.length;
}

export default async function campanhasRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET / — lista campanhas do usuário ───────────────────────────────────
  app.get('/', auth, async (req: any) => {
    const userId = req.user.sub;
    const campanhas = await prisma.campanha.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, status: true, channel: true, templateName: true,
        audienceCount: true, sentCount: true,
        startedAt: true, completedAt: true, createdAt: true,
        whatsappNumber: { select: { id: true, phoneNumber: true, displayName: true } },
      },
    });
    if (campanhas.length === 0) return { campanhas: [] };

    const grouped = await prisma.campanhaContato.groupBy({
      by: ['campanhaId', 'status'],
      where: { campanhaId: { in: campanhas.map((c: any) => c.id) } },
      _count: true,
    });
    const statsByCampanha = new Map<string, Record<string, number>>();
    for (const g of grouped) {
      const m = statsByCampanha.get(g.campanhaId) || {};
      m[g.status] = g._count;
      statsByCampanha.set(g.campanhaId, m);
    }

    return { campanhas: campanhas.map((c: any) => ({ ...c, stats: statsByCampanha.get(c.id) || {} })) };
  });

  // ── GET /templates — templates aprovados do WABA conectado ──────────────
  app.get('/templates', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const numberId = (req.query as any)?.whatsappNumberId as string | undefined;

    const whatsappNumber = numberId
      ? await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId, provider: 'meta' } })
      : await prisma.whatsappNumber.findFirst({ where: { userId, provider: 'meta' } });

    if (!whatsappNumber || !whatsappNumber.metaAccessTokenEnc || !whatsappNumber.metaWabaId) {
      return reply.code(400).send({
        error: 'Nenhum WhatsApp oficial (Meta) conectado.',
        message: 'Conecte um número via API oficial da Meta em /dashboard/numeros antes de criar uma campanha.',
      });
    }

    try {
      const token = decryptStr(whatsappNumber.metaAccessTokenEnc);
      const templates = await listTemplates(token, whatsappNumber.metaWabaId);
      return { templates: templates.filter((t) => t.status === 'APPROVED') };
    } catch (err: any) {
      return reply.code(502).send({ error: err.message || 'Falha ao buscar templates da Meta.' });
    }
  });

  // ── GET /optouts — lista de opt-out do usuário ───────────────────────────
  app.get('/optouts', auth, async (req: any) => {
    const userId = req.user.sub;
    const optOuts = await prisma.campanhaOptOut.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { optOuts };
  });

  // ── GET /crm-tags — tags do CRM do usuário (pra segmentar audiência, §15.1) ─
  app.get('/crm-tags', auth, async (req: any) => {
    const userId = req.user.sub;
    const contacts = await prisma.crmContact.findMany({ where: { userId }, select: { tags: true } });
    const tagSet = new Set<string>();
    for (const c of contacts) for (const t of c.tags) tagSet.add(t);
    return { tags: Array.from(tagSet).sort() };
  });

  // ── GET /performance — agregado por template (canal meta) ───────────────
  // Ajuda o usuário a ver qual template converte melhor / falha mais, em vez de
  // olhar campanha por campanha (§11/item 7). Baseado em CampanhaContato.status
  // atual (mesma fonte que GET /:id/GET / já usam) — não é funil cumulativo.
  app.get('/performance', auth, async (req: any) => {
    const userId = req.user.sub;
    const campanhas = await prisma.campanha.findMany({
      where: { userId, channel: 'meta', templateName: { not: null } },
      select: { id: true, templateName: true, audienceCount: true },
    });
    if (campanhas.length === 0) return { templates: [] };

    const grouped = await prisma.campanhaContato.groupBy({
      by: ['campanhaId', 'status'],
      where: { campanhaId: { in: campanhas.map((c: any) => c.id) } },
      _count: true,
    });
    const statsByCampanha = new Map<string, Record<string, number>>();
    for (const g of grouped) {
      const m = statsByCampanha.get(g.campanhaId) || {};
      m[g.status] = g._count;
      statsByCampanha.set(g.campanhaId, m);
    }

    const byTemplate = new Map<string, { campanhas: number; audienceCount: number; sent: number; delivered: number; read: number; failed: number; optout: number }>();
    for (const c of campanhas) {
      const stats = statsByCampanha.get(c.id) || {};
      const acc = byTemplate.get(c.templateName!) || { campanhas: 0, audienceCount: 0, sent: 0, delivered: 0, read: 0, failed: 0, optout: 0 };
      acc.campanhas += 1;
      acc.audienceCount += c.audienceCount;
      acc.sent += stats.sent || 0;
      acc.delivered += stats.delivered || 0;
      acc.read += stats.read || 0;
      acc.failed += stats.failed || 0;
      acc.optout += stats.optout || 0;
      byTemplate.set(c.templateName!, acc);
    }

    const templates = Array.from(byTemplate.entries()).map(([templateName, s]) => ({
      templateName,
      ...s,
      successRate: s.audienceCount > 0 ? (s.sent + s.delivered + s.read) / s.audienceCount : null,
      failureRate: s.audienceCount > 0 ? s.failed / s.audienceCount : null,
      optoutRate:  s.audienceCount > 0 ? s.optout / s.audienceCount : null,
    })).sort((a, b) => b.audienceCount - a.audienceCount);

    return { templates };
  });

  // ── GET /numeros-evolution — números Evolution conectados do usuário ────
  // Só o que o canal 'evolution' precisa pra listar (id/nome/telefone) — endpoint
  // próprio pra não mexer em routes/numbers.ts (usado por telas fora de Campanhas).
  app.get('/numeros-evolution', auth, async (req: any) => {
    const userId = req.user.sub;
    const numeros = await prisma.whatsappNumber.findMany({
      where: { userId, provider: 'evolution', status: 'connected', isPublic: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, phoneNumber: true, displayName: true },
    });
    return { numeros };
  });

  // ── Listas de números — contatos salvos e reutilizáveis entre campanhas ──
  // (fluxo "Nova campanha": passo 2, "escolher números", oferece uma lista já
  // pronta em vez de sempre pedir upload de CSV do zero). Ver from-lista mais
  // abaixo pra como uma lista é aplicada dentro de uma campanha.
  app.get('/listas', auth, async (req: any) => {
    const userId = req.user.sub;
    const listas = await prisma.campanhaLista.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { contatos: true } } },
    });
    return {
      listas: listas.map((l: any) => ({
        id: l.id, name: l.name, description: l.description, consentConfirmedAt: l.consentConfirmedAt,
        contatosCount: l._count.contatos, createdAt: l.createdAt, updatedAt: l.updatedAt,
      })),
    };
  });

  app.post('/listas', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(createCampanhaListaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const lista = await prisma.campanhaLista.create({
      data: {
        userId, name: v.data.name, description: v.data.description || null,
        consentConfirmedAt: v.data.consentConfirmed ? new Date() : null,
      },
    });
    return reply.code(201).send({ lista: { ...lista, contatosCount: 0 } });
  });

  app.get('/listas/:listaId', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const [contatos, total] = await Promise.all([
      prisma.campanhaListaContato.findMany({ where: { listaId }, orderBy: { createdAt: 'desc' }, take: 2000 }),
      prisma.campanhaListaContato.count({ where: { listaId } }),
    ]);
    return { lista, contatos, total };
  });

  app.put('/listas/:listaId', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const v = validateRequest(updateCampanhaListaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const updated = await prisma.campanhaLista.update({
      where: { id: listaId },
      data: {
        ...(v.data.name !== undefined ? { name: v.data.name } : {}),
        ...(v.data.description !== undefined ? { description: v.data.description } : {}),
        ...(v.data.consentConfirmed !== undefined
          ? { consentConfirmedAt: v.data.consentConfirmed ? (lista.consentConfirmedAt || new Date()) : null }
          : {}),
      },
    });
    return { lista: updated };
  });

  // Duplicar (item 7) — cópia independente, útil pra testar uma variação sem
  // arriscar a lista original que já pode estar em uso noutra campanha.
  app.post('/listas/:listaId/duplicate', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const contatos = await prisma.campanhaListaContato.findMany({
      where: { listaId }, select: { phone: true, name: true },
    });
    const copy = await prisma.campanhaLista.create({
      data: {
        userId, name: `${lista.name} (cópia)`, description: lista.description,
        consentConfirmedAt: lista.consentConfirmedAt,
        contatos: { createMany: { data: contatos.map((c: any) => ({ phone: c.phone, name: c.name })) } },
      },
    });
    return reply.code(201).send({ lista: { ...copy, contatosCount: contatos.length } });
  });

  // Mesclar (item 7) — combina os números de N listas numa nova, sem alterar
  // as originais; dedupe por telefone (mantém o 1º nome encontrado).
  app.post('/listas/merge', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(mergeCampanhaListasSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const listas = await prisma.campanhaLista.findMany({
      where: { id: { in: v.data.listaIds }, userId },
      select: { id: true },
    });
    if (listas.length !== v.data.listaIds.length) {
      return reply.code(404).send({ error: 'Uma ou mais listas não foram encontradas.' });
    }
    const contatos = await prisma.campanhaListaContato.findMany({
      where: { listaId: { in: v.data.listaIds } },
      select: { phone: true, name: true },
    });
    const merged = new Map<string, string | null>();
    for (const c of contatos) if (!merged.has(c.phone)) merged.set(c.phone, c.name);

    const lista = await prisma.campanhaLista.create({
      data: {
        userId, name: v.data.name,
        contatos: { createMany: { data: Array.from(merged, ([phone, name]) => ({ phone, name })) } },
      },
    });
    return reply.code(201).send({ lista: { ...lista, contatosCount: merged.size } });
  });

  // Exportar CSV (item 7) — devolve o texto pronto; o download em si acontece
  // no browser (Blob local), sem esse endpoint precisar setar content-disposition.
  app.get('/listas/:listaId/export', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const contatos = await prisma.campanhaListaContato.findMany({
      where: { listaId }, orderBy: { createdAt: 'asc' }, select: { phone: true, name: true },
    });
    const csvEsc = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = contatos.map((c: any) => `${csvEsc(c.phone)},${csvEsc(c.name || '')}`).join('\n');
    return { csv, filename: `${lista.name.replace(/[^\w-]+/g, '_')}.csv` };
  });

  app.delete('/listas/:listaId', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    await prisma.campanhaLista.delete({ where: { id: listaId } });
    return reply.code(204).send();
  });

  // Upload de CSV (telefone,nome) — mesmo parser/validação do upload de contatos
  // direto numa campanha, só que salvando na lista em vez de numa Campanha.
  app.post('/listas/:listaId/contatos', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });

    let csvText: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 5 * 1024 * 1024) {
          return reply.code(400).send({ error: 'Arquivo muito grande (máx 5MB).' });
        }
        csvText = buffer.toString('utf-8');
      }
    }
    if (!csvText) return reply.code(400).send({ error: 'Envie um arquivo CSV no campo "file".' });

    const delimiter = detectDelimiter(csvText);
    const rows = parseCsv(csvText, delimiter);
    if (rows.length === 0) return reply.code(400).send({ error: 'CSV vazio.' });
    const dataRows = PHONE_LIKE.test(rows[0][0] || '') ? rows : rows.slice(1);
    if (dataRows.length === 0) return reply.code(400).send({ error: 'Nenhum contato encontrado no CSV.' });

    const existing = await prisma.campanhaListaContato.findMany({ where: { listaId }, select: { phone: true } });
    const existingSet = new Set(existing.map((e: any) => e.phone));

    const seen = new Set<string>();
    let skippedInvalid = 0;
    let skippedDuplicate = 0;
    const toCreate: { listaId: string; phone: string; name: string | null }[] = [];
    for (const row of dataRows) {
      const rawPhone = row[0] || '';
      if (!PHONE_LIKE.test(rawPhone)) { skippedInvalid++; continue; }
      const phone = normalizePhone(rawPhone);
      if (phone.length < 12 || phone.length > 15) { skippedInvalid++; continue; }
      if (existingSet.has(phone) || seen.has(phone)) { skippedDuplicate++; continue; }
      seen.add(phone);
      toCreate.push({ listaId, phone, name: row[1]?.trim() || null });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaListaContato.createMany({ data: toCreate });
      await prisma.campanhaLista.update({ where: { id: listaId }, data: { updatedAt: new Date() } });
    }

    return reply.send({ imported: toCreate.length, skippedInvalid, skippedDuplicate });
  });

  // Colar números direto (textarea no front, já parseado em {phone,name}[]) —
  // alternativa ao CSV pra listas pequenas/rápidas.
  app.post('/listas/:listaId/contatos/manual', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const v = validateRequest(addCampanhaListaContatosSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const existing = await prisma.campanhaListaContato.findMany({ where: { listaId }, select: { phone: true } });
    const existingSet = new Set(existing.map((e: any) => e.phone));

    const seen = new Set<string>();
    let skippedInvalid = 0;
    let skippedDuplicate = 0;
    const toCreate: { listaId: string; phone: string; name: string | null }[] = [];
    for (const c of v.data.contatos) {
      if (!PHONE_LIKE.test(c.phone)) { skippedInvalid++; continue; }
      const phone = normalizePhone(c.phone);
      if (phone.length < 12 || phone.length > 15) { skippedInvalid++; continue; }
      if (existingSet.has(phone) || seen.has(phone)) { skippedDuplicate++; continue; }
      seen.add(phone);
      toCreate.push({ listaId, phone, name: c.name?.trim() || null });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaListaContato.createMany({ data: toCreate });
      await prisma.campanhaLista.update({ where: { id: listaId }, data: { updatedAt: new Date() } });
    }

    return reply.send({ imported: toCreate.length, skippedInvalid, skippedDuplicate });
  });

  app.delete('/listas/:listaId/contatos/:contatoId', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { listaId, contatoId } = req.params;
    const lista = await ownedLista(userId, listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });
    await prisma.campanhaListaContato.deleteMany({ where: { id: contatoId, listaId } });
    return reply.code(204).send();
  });

  // ── POST / — cria campanha (rascunho) ────────────────────────────────────
  app.post('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(createCampanhaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const {
      name, whatsappNumberId, channel, templateName, templateLanguage, templateComponents, templateVarCount, messageBody,
      abTestEnabled, variantBTemplateName, variantBTemplateLanguage, variantBTemplateComponents, variantBTemplateVarCount, variantBMessageBody,
    } = v.data;

    const whatsappNumber = await prisma.whatsappNumber.findFirst({
      where: { id: whatsappNumberId, userId, provider: channel },
    });
    if (!whatsappNumber) {
      return reply.code(400).send({
        error: channel === 'meta'
          ? 'Número Meta inválido ou não pertence a este usuário.'
          : 'Número Evolution inválido ou não pertence a este usuário.',
      });
    }

    const campanha = await prisma.campanha.create({
      data: {
        userId, whatsappNumberId, name, channel,
        templateName:     channel === 'meta' ? templateName : null,
        templateLanguage,
        templateComponents: channel === 'meta' ? templateComponents : undefined,
        templateVarCount: channel === 'meta' ? (templateVarCount ?? null) : null,
        messageBody:      channel === 'evolution' ? messageBody : null,
        abTestEnabled: !!abTestEnabled,
        ...(abTestEnabled ? {
          variantBTemplateName:       channel === 'meta' ? variantBTemplateName : null,
          variantBTemplateLanguage:   channel === 'meta' ? (variantBTemplateLanguage || templateLanguage) : null,
          variantBTemplateComponents: channel === 'meta' ? variantBTemplateComponents : undefined,
          variantBTemplateVarCount:   channel === 'meta' ? (variantBTemplateVarCount ?? null) : null,
          variantBMessageBody:        channel === 'evolution' ? variantBMessageBody : null,
        } : {}),
      },
    });

    return reply.code(201).send({ campanha });
  });

  // ── GET /:id — detalhe da campanha ───────────────────────────────────────
  app.get('/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const campanha = await prisma.campanha.findFirst({
      where: { id, userId },
      include: {
        whatsappNumber: {
          select: {
            id: true, phoneNumber: true, displayName: true,
            metaMessagingLimitTier: true, metaQualityRating: true,
          },
        },
      },
    });
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });

    const grouped = await prisma.campanhaContato.groupBy({
      by: ['status'],
      where: { campanhaId: id },
      _count: true,
    });
    const stats: Record<string, number> = {};
    for (const g of grouped) stats[g.status] = g._count;

    // Quebra por número do pool (§11.13 — item que ficava pendente): só busca
    // quando a campanha tem pool configurado, pra não pagar 2 queries extras à
    // toa no caso comum (sem pool). assignedNumberId nulo (contato criado antes
    // do pool existir, ou pool desativado depois) cai no número primário.
    let statsByNumber: Record<string, Record<string, number>> | undefined;
    let poolNumbers: Array<{ id: string; phoneNumber: string | null; displayName: string | null }> | undefined;
    if (campanha.poolNumberIds.length > 0) {
      const [groupedByNumber, poolNumbersRows] = await Promise.all([
        prisma.campanhaContato.groupBy({
          by: ['assignedNumberId', 'status'],
          where: { campanhaId: id },
          _count: true,
        }),
        prisma.whatsappNumber.findMany({
          where: { id: { in: campanha.poolNumberIds } },
          select: { id: true, phoneNumber: true, displayName: true },
        }),
      ]);
      statsByNumber = {};
      for (const g of groupedByNumber) {
        // assignedNumberId nulo colapsa no primário — pode coincidir com um grupo
        // que já tem assignedNumberId === primário explicitamente, então soma em
        // vez de sobrescrever (senão um dos dois "sent" apaga o outro).
        const key = g.assignedNumberId || campanha.whatsappNumberId;
        statsByNumber[key] = statsByNumber[key] || {};
        statsByNumber[key][g.status] = (statsByNumber[key][g.status] || 0) + g._count;
      }
      poolNumbers = poolNumbersRows;
    }

    // Sequência/drip (§15.2): mostra os passos-filhos (se esta é a mãe) ou a
    // mãe (se esta é um passo) — só busca quando faz sentido, sem query extra
    // pra campanha comum sem sequência.
    let sequenceSteps: Array<{ id: string; name: string; status: string; sequenceIndex: number; sequenceDelayDays: number; scheduledAt: Date | null }> | undefined;
    let sequenceParent: { id: string; name: string } | undefined;
    if (!campanha.sequenceParentId) {
      const steps = await prisma.campanha.findMany({
        where: { sequenceParentId: id },
        orderBy: { sequenceIndex: 'asc' },
        select: { id: true, name: true, status: true, sequenceIndex: true, sequenceDelayDays: true, scheduledAt: true },
      });
      if (steps.length > 0) sequenceSteps = steps as any;
    } else {
      const parent = await prisma.campanha.findUnique({
        where: { id: campanha.sequenceParentId },
        select: { id: true, name: true },
      });
      if (parent) sequenceParent = parent;
    }

    // A/B test (§15.3): stats por variante — só reporta, sem promover vencedor.
    let statsByVariant: Record<string, Record<string, number>> | undefined;
    if (campanha.abTestEnabled) {
      const groupedByVariant = await prisma.campanhaContato.groupBy({
        by: ['variant', 'status'],
        where: { campanhaId: id },
        _count: true,
      });
      statsByVariant = { A: {}, B: {} };
      for (const g of groupedByVariant) {
        const key = g.variant === 'B' ? 'B' : 'A'; // contato sem variant (raro, pré-A/B) cai em A
        statsByVariant[key][g.status] = (statsByVariant[key][g.status] || 0) + g._count;
      }
    }

    return { campanha, stats, statsByNumber, poolNumbers, sequenceSteps, sequenceParent, statsByVariant };
  });

  // ── GET /:id/contatos — lista contatos (paginado, filtro por status) ────
  app.get('/:id/contatos', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });

    const query = req.query as any;
    const limit  = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const where = { campanhaId: id, ...(query.status ? { status: String(query.status) } : {}) };

    const [contatos, total] = await Promise.all([
      prisma.campanhaContato.findMany({ where, orderBy: { createdAt: 'asc' }, skip: offset, take: limit }),
      prisma.campanhaContato.count({ where }),
    ]);

    return { contatos, total, limit, offset };
  });

  // ── DELETE /:id — remove campanha em rascunho ────────────────────────────
  app.delete('/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'scheduled'].includes(campanha.status)) {
      return reply.code(400).send({ error: 'Só é possível excluir campanhas em rascunho ou agendadas.' });
    }
    await prisma.campanha.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // ── POST /:id/contatos/from-conversas — audiência "quente" (canal evolution) ─
  // Único jeito de popular contatos de uma campanha evolution — nunca CSV livre
  // (guardrail server-side, não só de UI, ver CAMPANHAS_ARQUITETURA.md §8).
  app.post('/:id/contatos/from-conversas', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.channel !== 'evolution') {
      return reply.code(400).send({ error: 'Este endpoint é só para campanhas do canal Evolution.' });
    }
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível adicionar contatos a campanhas em rascunho.' });
    }

    const [warmContacts, optOuts, existing] = await Promise.all([
      warmContactsForNumber(campanha.whatsappNumberId),
      prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } }),
      prisma.campanhaContato.findMany({ where: { campanhaId: id }, select: { phone: true } }),
    ]);
    const optOutSet   = new Set(optOuts.map((o: any) => o.phone));
    const existingSet = new Set(existing.map((e: any) => e.phone));

    let skippedOptOut = 0;
    let skippedDuplicate = 0;
    const toCreate: { campanhaId: string; phone: string; name: string | null; variant?: string }[] = [];
    for (const [phone, name] of warmContacts) {
      if (optOutSet.has(phone)) { skippedOptOut++; continue; }
      if (existingSet.has(phone)) { skippedDuplicate++; continue; }
      // A/B test (§15.3): alterna pela posição entre os aceitos, não pelo índice
      // bruto do loop — garante split 50/50 de verdade mesmo com opt-out/duplicado no meio.
      toCreate.push({ campanhaId: id, phone, name, variant: campanha.abTestEnabled ? (toCreate.length % 2 === 0 ? 'A' : 'B') : undefined });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaContato.createMany({ data: toCreate });
      await prisma.campanha.update({
        where: { id },
        data: { audienceCount: { increment: toCreate.length } },
      });
    }

    return reply.send({ imported: toCreate.length, skippedOptOut, skippedDuplicate, elegiveis: warmContacts.size });
  });

  // ── POST /:id/contatos/from-crm — audiência segmentada por tag do CRM (§15.1) ─
  // Canal evolution: intersecta com quem já conversou (warmContactsForNumber) —
  // segmentação por tag NUNCA fura o guardrail de audiência quente, só reduz.
  // Canal meta: só aceita quando o template não exige variáveis — o CRM não tem
  // como preencher {{1}}, {{2}}... posicionais (isso é papel do CSV).
  app.post('/:id/contatos/from-crm', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível adicionar contatos a campanhas em rascunho.' });
    }
    const tag = String(req.body?.tag || '').trim();
    if (!tag) return reply.code(400).send({ error: 'Informe uma tag do CRM.' });
    if (campanha.channel === 'meta' && campanha.templateVarCount) {
      return reply.code(400).send({
        error: `Este template exige ${campanha.templateVarCount} variável(is) — a importação por tag do CRM não `
          + `preenche variáveis automaticamente. Use o upload de CSV pra esse template.`,
      });
    }

    const crmContacts = await prisma.crmContact.findMany({
      where: { userId, tags: { has: tag } },
      select: { phone: true, name: true },
    });
    const candidates = new Map<string, string | null>();
    for (const c of crmContacts) candidates.set(normalizePhone(c.phone), c.name ?? null);

    let skippedCold = 0;
    if (campanha.channel === 'evolution') {
      const warm = await warmContactsForNumber(campanha.whatsappNumberId);
      for (const phone of Array.from(candidates.keys())) {
        if (!warm.has(phone)) { candidates.delete(phone); skippedCold++; }
      }
    }

    const [optOuts, existing] = await Promise.all([
      prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } }),
      prisma.campanhaContato.findMany({ where: { campanhaId: id }, select: { phone: true } }),
    ]);
    const optOutSet   = new Set(optOuts.map((o: any) => o.phone));
    const existingSet = new Set(existing.map((e: any) => e.phone));

    let skippedOptOut = 0;
    let skippedDuplicate = 0;
    const toCreate: { campanhaId: string; phone: string; name: string | null; variant?: string }[] = [];
    for (const [phone, name] of candidates) {
      if (optOutSet.has(phone)) { skippedOptOut++; continue; }
      if (existingSet.has(phone)) { skippedDuplicate++; continue; }
      toCreate.push({ campanhaId: id, phone, name, variant: campanha.abTestEnabled ? (toCreate.length % 2 === 0 ? 'A' : 'B') : undefined });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaContato.createMany({ data: toCreate });
      await prisma.campanha.update({
        where: { id },
        data: { audienceCount: { increment: toCreate.length } },
      });
    }

    return reply.send({
      imported: toCreate.length, skippedOptOut, skippedDuplicate, skippedCold,
      elegiveis: crmContacts.length,
    });
  });

  // ── POST /:id/contatos/from-lista — aplica uma lista salva à campanha ────
  // Copia os números da CampanhaLista pra CampanhaContato (mesmas checagens de
  // opt-out/duplicata/tag-quente do Evolution que from-crm já faz) — editar a
  // lista depois não afeta campanhas que já a usaram.
  app.post('/:id/contatos/from-lista', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível adicionar contatos a campanhas em rascunho.' });
    }
    const v = validateRequest(applyCampanhaListaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const lista = await ownedLista(userId, v.data.listaId);
    if (!lista) return reply.code(404).send({ error: 'Lista não encontrada.' });

    if (campanha.channel === 'meta' && campanha.templateVarCount) {
      return reply.code(400).send({
        error: `Este template exige ${campanha.templateVarCount} variável(is) — listas salvas não preenchem `
          + `variáveis automaticamente. Use o upload de CSV pra esse template.`,
      });
    }

    const listaContatos = await prisma.campanhaListaContato.findMany({
      where: { listaId: lista.id },
      select: { phone: true, name: true },
    });
    const candidates = new Map<string, string | null>();
    for (const c of listaContatos) candidates.set(c.phone, c.name ?? null);

    let skippedCold = 0;
    if (campanha.channel === 'evolution') {
      const warm = await warmContactsForNumber(campanha.whatsappNumberId);
      for (const phone of Array.from(candidates.keys())) {
        if (!warm.has(phone)) { candidates.delete(phone); skippedCold++; }
      }
    }

    const [optOuts, existing] = await Promise.all([
      prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } }),
      prisma.campanhaContato.findMany({ where: { campanhaId: id }, select: { phone: true } }),
    ]);
    const optOutSet   = new Set(optOuts.map((o: any) => o.phone));
    const existingSet = new Set(existing.map((e: any) => e.phone));

    let skippedOptOut = 0;
    let skippedDuplicate = 0;
    const toCreate: { campanhaId: string; phone: string; name: string | null; variant?: string }[] = [];
    for (const [phone, name] of candidates) {
      if (optOutSet.has(phone)) { skippedOptOut++; continue; }
      if (existingSet.has(phone)) { skippedDuplicate++; continue; }
      toCreate.push({ campanhaId: id, phone, name, variant: campanha.abTestEnabled ? (toCreate.length % 2 === 0 ? 'A' : 'B') : undefined });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaContato.createMany({ data: toCreate });
      await prisma.campanha.update({
        where: { id },
        data: {
          audienceCount: { increment: toCreate.length },
          // Consentimento confirmado na origem (lista) cobre a campanha também —
          // evita reconfirmar na hora do disparo quando a lista já foi validada.
          ...(lista.consentConfirmedAt && !campanha.consentConfirmedAt
            ? { consentConfirmedAt: lista.consentConfirmedAt }
            : {}),
        },
      });
    }

    return reply.send({
      imported: toCreate.length, skippedOptOut, skippedDuplicate, skippedCold,
      elegiveis: listaContatos.length,
    });
  });

  // ── POST /:id/contatos — upload de CSV (telefone,nome,var1,var2,...) ────
  // Só para campanhas do canal 'meta' — evolution usa /from-conversas (guardrail).
  app.post('/:id/contatos', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.channel === 'evolution') {
      return reply.code(400).send({
        error: 'Campanhas via Evolution só aceitam contatos que já conversaram com o número — use "Importar contatos que já falaram com você".',
      });
    }
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível adicionar contatos a campanhas em rascunho.' });
    }

    let csvText: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 5 * 1024 * 1024) {
          return reply.code(400).send({ error: 'Arquivo muito grande (máx 5MB).' });
        }
        csvText = buffer.toString('utf-8');
      }
    }
    if (!csvText) return reply.code(400).send({ error: 'Envie um arquivo CSV no campo "file".' });

    const delimiter = detectDelimiter(csvText);
    const rows = parseCsv(csvText, delimiter);
    if (rows.length === 0) return reply.code(400).send({ error: 'CSV vazio.' });

    // Pula cabeçalho se a 1ª célula da 1ª linha não parecer telefone
    const dataRows = PHONE_LIKE.test(rows[0][0] || '') ? rows : rows.slice(1);
    if (dataRows.length === 0) return reply.code(400).send({ error: 'Nenhum contato encontrado no CSV.' });

    const [optOuts, existing] = await Promise.all([
      prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } }),
      prisma.campanhaContato.findMany({ where: { campanhaId: id }, select: { phone: true } }),
    ]);
    const optOutSet   = new Set(optOuts.map((o: any) => o.phone));
    const existingSet = new Set(existing.map((e: any) => e.phone));

    const seen = new Set<string>();
    let skippedOptOut = 0;
    let skippedInvalid = 0;
    let skippedDuplicate = 0;
    let skippedVarMismatch = 0;
    const toCreate: { campanhaId: string; phone: string; name: string | null; variables: string[] | undefined; variant?: string }[] = [];

    for (const row of dataRows) {
      const rawPhone = row[0] || '';
      if (!PHONE_LIKE.test(rawPhone)) { skippedInvalid++; continue; }
      const phone = normalizePhone(rawPhone);
      if (phone.length < 12 || phone.length > 15) { skippedInvalid++; continue; }
      if (optOutSet.has(phone)) { skippedOptOut++; continue; }
      if (existingSet.has(phone) || seen.has(phone)) { skippedDuplicate++; continue; }

      const name = row[1]?.trim() || null;
      const vars = row.slice(2).filter((v) => v.length > 0);
      // Nº de variáveis precisa bater com o template selecionado — senão o envio
      // desse contato falharia lá na frente (Meta rejeita template com parâmetro
      // faltando/sobrando). templateVarCount null = campanha antiga, sem essa
      // validação (comportamento anterior preservado). Ver §11/item 6.
      if (campanha.templateVarCount != null && vars.length !== campanha.templateVarCount) {
        skippedVarMismatch++; continue;
      }
      seen.add(phone);

      toCreate.push({
        campanhaId: id, phone, name, variables: vars.length ? vars : undefined,
        variant: campanha.abTestEnabled ? (toCreate.length % 2 === 0 ? 'A' : 'B') : undefined,
      });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaContato.createMany({ data: toCreate });
      await prisma.campanha.update({
        where: { id },
        data: { audienceCount: { increment: toCreate.length } },
      });
    }

    return reply.send({ imported: toCreate.length, skippedOptOut, skippedInvalid, skippedDuplicate, skippedVarMismatch });
  });

  // ── POST /:id/test-send — envia 1 mensagem de teste (não conta em métricas) ─
  // Não cria CampanhaContato nem toca audienceCount/sentCount/processedCount —
  // é só uma prévia real (mesmo path de envio do worker) pro usuário conferir
  // antes de iniciar de verdade. Ver §11/item 5.
  app.post('/:id/test-send', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.channel === 'meta' && !campanha.templateName) {
      return reply.code(400).send({ error: 'Campanha sem template selecionado.' });
    }
    if (campanha.channel === 'evolution' && !campanha.messageBody) {
      return reply.code(400).send({ error: 'Campanha sem mensagem definida.' });
    }

    const rawPhone = String(req.body?.phone || '');
    if (!PHONE_LIKE.test(rawPhone)) {
      return reply.code(400).send({ error: 'Informe um telefone válido pra receber o teste.' });
    }
    const phone = normalizePhone(rawPhone);

    const whatsappNumber = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
    if (!numberReadyToSend(whatsappNumber, campanha.channel)) {
      return reply.code(400).send({
        error: campanha.channel === 'evolution'
          ? 'Número Evolution desconectado. Reconecte em /dashboard/numeros.'
          : 'Número Meta desconectado. Reconecte em /dashboard/numeros.',
      });
    }

    try {
      if (campanha.channel === 'evolution') {
        const nome  = typeof req.body?.nome === 'string' && req.body.nome.trim() ? req.body.nome.trim() : 'Teste';
        const texto = (campanha.messageBody || '').replace(/\{\{\s*nome\s*\}\}/gi, nome);
        const res = await sendText(whatsappNumber!.zapiInstanceId!, phone, `[TESTE] ${texto}`);
        return reply.send({ ok: true, messageId: res.id });
      }

      const token = decryptStr(whatsappNumber!.metaAccessTokenEnc!);
      const staticComponents = (campanha.templateComponents as Array<Record<string, any>> | null) || [];
      const varCount = campanha.templateVarCount ?? 0;
      const sampleVars: string[] = Array.isArray(req.body?.variables) && req.body.variables.length
        ? req.body.variables.map((v: any) => String(v))
        : Array.from({ length: varCount }, (_, i) => `Teste${i + 1}`);
      const components = sampleVars.length
        ? [...staticComponents, { type: 'body', parameters: sampleVars.map((v) => ({ type: 'text', text: v })) }]
        : staticComponents;
      const messageId = await sendTemplateMessage(
        token, whatsappNumber!.metaPhoneNumberId!, phone,
        campanha.templateName!, campanha.templateLanguage, components,
      );
      return reply.send({ ok: true, messageId });
    } catch (err: any) {
      return reply.code(502).send({ error: err.message || 'Falha ao enviar mensagem de teste.' });
    }
  });

  // ── POST /:id/sequence — cria os passos de uma sequência/drip (§15.2) ───
  // Cada passo é uma Campanha inteira ligada por sequenceParentId — reaproveita
  // 100% do disparo/scheduler já existentes (nenhuma lógica nova de envio). Os
  // passos ficam 'draft' até o pai iniciar (ver POST /:id/start), que os agenda
  // automaticamente com scheduledAt = startedAt do pai + delayDays de cada um.
  app.post('/:id/sequence', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível criar sequência a partir de uma campanha em rascunho.' });
    }
    if (campanha.sequenceParentId) {
      return reply.code(400).send({ error: 'Uma campanha que já é passo de outra sequência não pode iniciar a sua própria.' });
    }
    if (campanha.audienceCount === 0) {
      return reply.code(400).send({ error: 'Adicione contatos à campanha antes de criar a sequência — os passos herdam a mesma audiência.' });
    }
    const existingSteps = await prisma.campanha.count({ where: { sequenceParentId: id } });
    if (existingSteps > 0) {
      return reply.code(400).send({ error: 'Esta campanha já tem uma sequência criada.' });
    }

    const v = validateRequest(campanhaSequenceSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    for (const [i, step] of v.data.steps.entries()) {
      const ok = campanha.channel === 'meta' ? !!step.templateName : !!step.messageBody;
      if (!ok) {
        return reply.code(400).send({
          error: campanha.channel === 'meta'
            ? `Passo ${i + 1}: informe templateName (campanha via Meta).`
            : `Passo ${i + 1}: informe messageBody (campanha via Evolution).`,
        });
      }
    }

    const contatosBase = await prisma.campanhaContato.findMany({
      where: { campanhaId: id, status: { not: 'optout' } },
      select: { phone: true, name: true, variables: true },
    });

    const steps = [];
    for (const [i, step] of v.data.steps.entries()) {
      const child = await prisma.campanha.create({
        data: {
          userId, whatsappNumberId: campanha.whatsappNumberId, channel: campanha.channel,
          poolNumberIds: campanha.poolNumberIds,
          name: `${campanha.name} — passo ${i + 1}`,
          templateName:       campanha.channel === 'meta' ? step.templateName : null,
          templateLanguage:   step.templateLanguage,
          templateComponents: campanha.channel === 'meta' ? step.templateComponents : undefined,
          templateVarCount:   campanha.channel === 'meta' ? (step.templateVarCount ?? null) : null,
          messageBody:        campanha.channel === 'evolution' ? step.messageBody : null,
          sequenceParentId: id, sequenceIndex: i + 1, sequenceDelayDays: step.delayDays,
          audienceCount: contatosBase.length,
        },
      });
      if (contatosBase.length > 0) {
        await prisma.campanhaContato.createMany({
          data: contatosBase.map((c: any) => ({ campanhaId: child.id, phone: c.phone, name: c.name, variables: c.variables })),
        });
      }
      steps.push(child);
    }

    return reply.code(201).send({ steps });
  });

  // ── POST /:id/schedule — agenda o início automático do disparo ──────────
  app.post('/:id/schedule', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'scheduled'].includes(campanha.status)) {
      return reply.code(400).send({ error: `Campanha em status "${campanha.status}" não pode ser agendada.` });
    }
    if (campanha.audienceCount === 0) {
      return reply.code(400).send({ error: 'Adicione contatos antes de agendar a campanha.' });
    }

    const v = validateRequest(scheduleCampanhaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const { scheduledAt } = v.data;
    if (scheduledAt.getTime() <= Date.now()) {
      return reply.code(400).send({ error: 'A data agendada precisa estar no futuro.' });
    }

    const consentError = requireConsentAcknowledgement(campanha, req.body);
    if (consentError) return reply.code(400).send({ error: consentError });

    const whatsappNumber = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
    if (!numberReadyToSend(whatsappNumber, campanha.channel)) {
      return reply.code(400).send({
        error: campanha.channel === 'evolution'
          ? 'Número Evolution desconectado. Reconecte em /dashboard/numeros.'
          : 'Número Meta desconectado. Reconecte em /dashboard/numeros.',
      });
    }

    // Mesmo teto real de tier/quality que /:id/start já checava (§11/item 2 do
    // gap conhecido em §9.3) — avisa AGORA, no momento de agendar, em vez de só
    // na hora do disparo automático (que não tem usuário pra confirmar). Se o
    // tier mudar entre agendar e disparar, o disparo automático ainda assim
    // prossegue (fail-open, ver campanhas-scheduler.ts) — aqui é só a chance
    // inicial do usuário reconsiderar antes de comprometer a campanha.
    if (campanha.channel !== 'evolution') {
      const sendNumbers = await resolveSendNumbers(campanha, userId, whatsappNumber!);
      const { combinedCap, tierDetails } = await checkCombinedTierCap(sendNumbers);
      if (combinedCap !== null && Number.isFinite(combinedCap) && campanha.audienceCount > combinedCap && req.body?.confirmExceedsTier !== true) {
        return reply.code(400).send(tierExceededResponse(combinedCap, tierDetails, campanha.audienceCount, sendNumbers.length > 1));
      }
    }

    const updated = await prisma.campanha.update({
      where: { id },
      data: {
        status: 'scheduled', scheduledAt,
        ...(!campanha.consentConfirmedAt
          ? { consentConfirmedAt: new Date(), consentConfirmedIp: req.ip }
          : {}),
      },
    });
    return reply.send({ campanha: updated });
  });

  // ── POST /:id/unschedule — cancela o agendamento, volta a rascunho ──────
  app.post('/:id/unschedule', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'scheduled') {
      return reply.code(400).send({ error: 'Só é possível cancelar o agendamento de campanhas agendadas.' });
    }
    const updated = await prisma.campanha.update({
      where: { id },
      data: { status: 'draft', scheduledAt: null },
    });
    return reply.send({ campanha: updated });
  });

  // ── GET /:id/pool-candidates — números do mesmo canal, elegíveis pro pool ──
  app.get('/:id/pool-candidates', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    const numeros = await prisma.whatsappNumber.findMany({
      where: { userId, provider: campanha.channel, isPublic: false, id: { not: campanha.whatsappNumberId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, phoneNumber: true, displayName: true, status: true },
    });
    return { numeros };
  });

  // ── POST /:id/pool — define números extras (mesmo canal) pra dividir o disparo ─
  // Round-robin de verdade acontece no /start (assignedNumberId por contato) —
  // aqui só valida e salva a lista. Ver §11/item 2.
  app.post('/:id/pool', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'scheduled', 'paused'].includes(campanha.status)) {
      return reply.code(400).send({ error: 'Só é possível ajustar o pool de números fora de uma campanha em execução.' });
    }

    const raw = Array.isArray(req.body?.numberIds) ? req.body.numberIds.filter((v: any) => typeof v === 'string') : [];
    const uniqueIds = Array.from(new Set(raw)) as string[];
    if (uniqueIds.length > 10) {
      return reply.code(400).send({ error: 'Máximo de 10 números extras no pool.' });
    }
    const poolIds = uniqueIds.filter((nid) => nid !== campanha.whatsappNumberId);

    if (poolIds.length > 0) {
      const owned = await prisma.whatsappNumber.findMany({
        where: { id: { in: poolIds }, userId, provider: campanha.channel },
        select: { id: true },
      });
      if (owned.length !== poolIds.length) {
        return reply.code(400).send({ error: 'Um ou mais números informados não existem, não são seus, ou não são do mesmo canal desta campanha.' });
      }
    }

    const updated = await prisma.campanha.update({ where: { id }, data: { poolNumberIds: poolIds } });
    return reply.send({ campanha: updated });
  });

  // ── POST /:id/start — inicia (ou retoma após pausa/agendamento) o disparo ─
  app.post('/:id/start', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'paused', 'scheduled'].includes(campanha.status)) {
      return reply.code(400).send({ error: `Campanha em status "${campanha.status}" não pode ser iniciada.` });
    }
    if (campanha.audienceCount === 0) {
      return reply.code(400).send({ error: 'Adicione contatos antes de iniciar a campanha.' });
    }

    const consentError = requireConsentAcknowledgement(campanha, req.body);
    if (consentError) return reply.code(400).send({ error: consentError });

    const whatsappNumber = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
    if (!numberReadyToSend(whatsappNumber, campanha.channel)) {
      return reply.code(400).send({
        error: campanha.channel === 'evolution'
          ? 'Número Evolution desconectado. Reconecte em /dashboard/numeros.'
          : 'Número Meta desconectado. Reconecte em /dashboard/numeros.',
      });
    }

    // Pool de números (§11/item 2): números extras do mesmo canal pra dividir o
    // disparo — só entram na rotação os que estiverem prontos pra enviar agora;
    // um número do pool que caiu não trava a campanha, só sai da rotação desta vez.
    const sendNumbers = await resolveSendNumbers(campanha, userId, whatsappNumber!);

    const pendentes = await prisma.campanhaContato.findMany({
      where: { campanhaId: id, status: 'pending' },
      select: { id: true },
    });
    if (pendentes.length === 0) {
      return reply.code(400).send({ error: 'Nenhum contato pendente de envio nesta campanha.' });
    }

    // Canal meta: teto real de contatos únicos/24h somado entre todos os números da
    // rotação (Graph API, cache de 1h) — não deixa a campanha ser rejeitada em massa
    // silenciosamente pela Meta sem que o usuário tenha sido avisado com o número de
    // verdade. Ver §5.1/§9.
    if (campanha.channel !== 'evolution') {
      const { combinedCap, tierDetails } = await checkCombinedTierCap(sendNumbers);
      if (combinedCap !== null && Number.isFinite(combinedCap) && pendentes.length > combinedCap && req.body?.confirmExceedsTier !== true) {
        return reply.code(400).send(tierExceededResponse(combinedCap, tierDetails, pendentes.length, sendNumbers.length > 1));
      }
    }

    // Cobra ANTES de iniciar o disparo (nunca depois) — mesmo princípio do
    // Chatbot Campanhas (services/campanhas-chat-commands.ts). Sem saldo,
    // 402 com o que falta em vez de travar o disparo pela metade.
    try {
      await debitCampanhaMessages(userId, pendentes.length, { referenceType: 'campanha', referenceId: id });
    } catch (err) {
      if (err instanceof InsufficientCampanhaBalanceError) {
        return reply.code(402).send({
          error:   'Saldo de mensagens insuficiente.',
          message: `Essa campanha precisa de ${pendentes.length} mensagens. Compre mais em /dashboard/campanhas ou assine o Mensal Ilimitado.`,
          upsellUrl: '/dashboard/campanhas?upsell=saldo',
        });
      }
      throw err;
    }

    const startedCampanha = await prisma.campanha.update({
      where: { id },
      data: {
        // pausedReason/consecutiveFailures zerados ao (re)iniciar: se a pausa foi
        // automática (circuit breaker), retomar é uma intervenção do usuário —
        // merece um novo "crédito" de tentativas, e a mensagem de pausa antiga não
        // deve ressurgir enganosamente numa pausa manual futura (ver §11/item 1).
        status: 'running', startedAt: campanha.startedAt ?? new Date(),
        pausedReason: null, consecutiveFailures: 0,
        ...(!campanha.consentConfirmedAt
          ? { consentConfirmedAt: new Date(), consentConfirmedIp: req.ip }
          : {}),
      },
    });

    // Sequência/drip (§15.2): se esta campanha tem passos-filhos ainda em
    // rascunho, agenda cada um pra scheduledAt = startedAt + delayDays — a
    // partir daqui é o campanhas-scheduler.ts existente que dispara, sem
    // nenhuma lógica nova. Consentimento copiado do pai: o usuário já
    // consentiu pra esta mesma audiência ao iniciar o primeiro passo.
    if (!campanha.sequenceParentId) {
      const steps = await prisma.campanha.findMany({
        where: { sequenceParentId: id, status: 'draft' },
      });
      await Promise.all(steps.map((step: any) => prisma.campanha.update({
        where: { id: step.id },
        data: {
          status: 'scheduled',
          scheduledAt: new Date(startedCampanha.startedAt!.getTime() + step.sequenceDelayDays * 24 * 60 * 60 * 1000),
          consentConfirmedAt: startedCampanha.consentConfirmedAt,
          consentConfirmedIp: startedCampanha.consentConfirmedIp,
        },
      })));
    }

    // Round-robin (assignedNumberId), aquecimento progressivo e janela de silêncio
    // já ficam dentro de enqueueCampanhaSend (mesma função reaproveitada pelo
    // Chatbot Campanhas) — não duplica aqui o que já foi resolvido acima
    // (sendNumbers/pendentes) só pra decidir se a campanha tem o que enviar.
    const enqueued = await enqueueCampanhaSend(id, campanha.channel, sendNumbers, pendentes);

    return reply.send({ ok: true, enqueued });
  });

  // ── POST /:id/pause — pausa campanha em execução ─────────────────────────
  // Jobs já na fila continuam sendo consumidos, mas o worker reconfere o status
  // antes de enviar e não age (contato permanece 'pending'); /start reenfileira.
  app.post('/:id/pause', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'running') {
      return reply.code(400).send({ error: 'Só é possível pausar campanhas em execução.' });
    }
    await prisma.campanha.update({ where: { id }, data: { status: 'paused' } });
    return reply.send({ ok: true });
  });

  // ── POST /:id/cancel — cancela definitivamente ───────────────────────────
  app.post('/:id/cancel', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['running', 'paused', 'draft'].includes(campanha.status)) {
      return reply.code(400).send({ error: 'Campanha já finalizada.' });
    }
    await prisma.campanha.update({ where: { id }, data: { status: 'canceled', completedAt: new Date() } });

    // Sequência/drip (§15.2): cancelar o pai cancela os passos que ainda não
    // terminaram — não faz sentido a campanha "acabar" mas os próximos passos
    // continuarem disparando sozinhos depois.
    if (!campanha.sequenceParentId) {
      await prisma.campanha.updateMany({
        where: { sequenceParentId: id, status: { in: ['draft', 'scheduled', 'paused', 'running'] } },
        data: { status: 'canceled', completedAt: new Date() },
      });
    }

    return reply.send({ ok: true });
  });

  // ── POST /contatos/from-csv — upload de contatos via CSV ────────────────
  // Aceita file multipart + listaId (reutilizar) ou listName (criar nova)
  app.post<{ Body: any }>('/contatos/from-csv', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    let data;
    try {
      data = await req.file();
    } catch (err: any) {
      return reply.code(400).send({ error: 'Erro ao processar arquivo. Verifique se é um CSV válido.' });
    }
    if (!data) return reply.code(400).send({ error: 'Arquivo CSV é obrigatório.' });

    const validation = validateRequest(uploadContatosCsvSchema)(data.fields);
    if (!validation.valid) return reply.code(400).send({ error: validation.error });

    const { listaId, listName } = validation.data;
    if (!listaId && !listName) {
      return reply.code(400).send({ error: 'Informe listaId (reutilizar) ou listName (criar nova).' });
    }

    let targetListaId = listaId;
    if (!listaId) {
      const newLista = await prisma.campanhaLista.create({
        data: { userId, name: listName || 'Import CSV', description: `Importado em ${new Date().toLocaleString('pt-BR')}` },
      });
      targetListaId = newLista.id;
    } else {
      const lista = await prisma.campanhaLista.findUnique({ where: { id: listaId } });
      if (!lista || lista.userId !== userId) {
        return reply.code(404).send({ error: 'Lista não encontrada.' });
      }
    }

    // Parse CSV com melhor tratamento de erros
    let csv: string;
    try {
      const buffer = await data.file.toBuffer();
      csv = buffer.toString('utf-8');
      if (!csv || csv.length === 0) {
        return reply.code(400).send({ error: 'Arquivo vazio.' });
      }
    } catch (err: any) {
      return reply.code(400).send({ error: 'Erro ao ler arquivo.' });
    }

    const lines = csv.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return reply.code(400).send({ error: 'CSV deve ter ao menos 1 contato + header.' });

    const headerLine = lines[0].toLowerCase();
    const hasPhone = /\b(phone|numero|telefone)\b/.test(headerLine);
    const hasName = /\b(name|nome)\b/.test(headerLine);
    if (!hasPhone) return reply.code(400).send({ error: 'CSV deve conter coluna "phone", "numero" ou "telefone".' });

    // Detectar delimiter (preferir , se ambos existem)
    const commaCnt = (headerLine.match(/,/g) || []).length;
    const semiCnt = (headerLine.match(/;/g) || []).length;
    const delimiter = commaCnt >= semiCnt ? ',' : ';';

    const headers = headerLine.split(delimiter).map((h: string) => h.trim());
    const phoneIdx = headers.findIndex(h => ['phone', 'numero', 'telefone'].includes(h));
    const nameIdx = hasName ? headers.findIndex(h => ['name', 'nome'].includes(h)) : -1;

    if (phoneIdx === -1) {
      return reply.code(400).send({ error: 'Não foi possível localizar coluna de telefone.' });
    }

    const contatos: Array<{ phone: string; name?: string }> = [];
    const errors: string[] = [];
    let imported = 0, skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
      if (cells.length <= phoneIdx || !cells[phoneIdx]) continue;

      const rawPhone = cells[phoneIdx].trim();
      if (!PHONE_LIKE.test(rawPhone)) {
        if (errors.length < 10) errors.push(`Linha ${i + 1}: "${rawPhone}" inválido.`);
        skipped++;
        continue;
      }

      try {
        const phone = normalizePhone(rawPhone);
        const name = nameIdx >= 0 && cells[nameIdx] ? cells[nameIdx] : undefined;
        contatos.push({ phone, name });
        imported++;
      } catch (err: any) {
        if (errors.length < 10) errors.push(`Linha ${i + 1}: erro ao processar.`);
        skipped++;
      }
    }

    if (imported === 0) {
      return reply.code(400).send({ error: 'Nenhum contato válido encontrado no CSV.' });
    }

    // Dedup + insert
    const existing = await prisma.campanhaListaContato.findMany({
      where: { listaId: targetListaId },
      select: { phone: true },
    });
    const existingPhones = new Set(existing.map(e => e.phone));

    const toInsert = contatos.filter(c => !existingPhones.has(c.phone));
    const dedupedCount = contatos.length - toInsert.length;

    if (toInsert.length > 0) {
      await prisma.campanhaListaContato.createMany({
        data: toInsert.map(c => ({ listaId: targetListaId, phone: c.phone, name: c.name })),
        skipDuplicates: true,
      });
    }

    return reply.send({
      ok: true,
      listaId: targetListaId,
      importedCount: toInsert.length,
      skippedCount: skipped,
      dedupedCount,
      errors,
    });
  });

  // ── GET /contatos/preview-historico — lista contatos do histórico ────────
  app.get<{ Querystring: any }>('/contatos/preview-historico', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const validation = validateRequest(previewContatosSchema)(req.query);
    if (!validation.valid) return reply.code(400).send({ error: validation.error });

    const { numberId, since, limit } = validation.data;
    const whereFilter: any = { userId };
    if (numberId) whereFilter.numberId = numberId;
    if (since) whereFilter.createdAt = { gte: since };

    const transcricoes = await prisma.transcription.findMany({
      where: whereFilter,
      select: { contactPhone: true, contactName: true },
      distinct: ['contactPhone'],
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    // Filtro: já em CampanhaOptOut deste usuário?
    const optOuts = await prisma.campanhaOptOut.findMany({
      where: { userId },
      select: { phone: true },
    });
    const optOutPhones = new Set(optOuts.map(o => o.phone));

    const contatos = transcricoes
      .filter(t => !optOutPhones.has(normalizePhone(t.contactPhone)))
      .map(t => ({
        phone: normalizePhone(t.contactPhone),
        name: t.contactName || undefined,
      }));

    return reply.send({ ok: true, contatos, total: contatos.length });
  });

  // ── GET /contatos/preview-crm — lista contatos do CRM ─────────────────────
  app.get<{ Querystring: any }>('/contatos/preview-crm', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const validation = validateRequest(previewContatosSchema)(req.query);
    if (!validation.valid) return reply.code(400).send({ error: validation.error });

    const { limit } = validation.data;

    const crmContacts = await prisma.crmContact.findMany({
      where: { userId },
      select: { phone: true, name: true },
      take: limit,
      orderBy: { lastActivityAt: 'desc' },
    });

    // Filtro: já em CampanhaOptOut?
    const optOuts = await prisma.campanhaOptOut.findMany({
      where: { userId },
      select: { phone: true },
    });
    const optOutPhones = new Set(optOuts.map(o => o.phone));

    const contatos = crmContacts
      .filter(c => !optOutPhones.has(c.phone))
      .map(c => ({ phone: c.phone, name: c.name }));

    return reply.send({ ok: true, contatos, total: contatos.length });
  });
}
