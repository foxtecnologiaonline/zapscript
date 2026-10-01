import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import {
  classifyZapMonneyMessage, matchQuickReply, normalizeCategory,
  ZM_CATEGORIES, type ZmIntentResult,
} from './zapmonney-agent';

/**
 * ZapMonney — fluxo conversacional do assistente financeiro.
 *
 * Decide tudo que a pessoa recebe de volta: onboarding, confirmação de
 * lançamento, consultas e exclusões. O worker (src/zapmonney.ts) só cuida de
 * transporte (baixar/transcrever áudio, enviar a resposta).
 *
 * Duas regras estruturais:
 * 1. Nenhum lançamento entra no saldo sem confirmação explícita — tudo nasce
 *    como 'pending' e só vira 'confirmed' quando a pessoa diz que está certo.
 * 2. Toda mensagem gera resposta. Silêncio aqui é indistinguível de bug para
 *    quem está do outro lado.
 */

// Brasil não tem mais horário de verão desde 2019, então o fuso de São Paulo é
// UTC-3 fixo — não precisa de biblioteca de timezone para fechar o mês certo.
const BRT_OFFSET_HOURS = 3;

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const DELETE_ACCOUNT_PHRASE = 'APAGAR TUDO';
const RECENT_LIMIT = 10;

export interface ZmMessageInput {
  phone: string;
  pushName?: string | null;
  text: string;
  sourceMsgId?: string | null;
}

/** null = não responder nada (só para usuário bloqueado manualmente). */
export type ZmReply = string | null;

// ── Datas no fuso de São Paulo ───────────────────────────────────────────────

function brtParts(now: Date): { y: number; m: number; d: number } {
  const shifted = new Date(now.getTime() - BRT_OFFSET_HOURS * 3_600_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

/** 'YYYY-MM-DD' de hoje em São Paulo — é o que o prompt usa como âncora. */
export function todayBrt(now = new Date()): string {
  const { y, m, d } = brtParts(now);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Instante UTC equivalente a 12:00 BRT da data informada. O meio-dia é
 * deliberado: qualquer conversão de fuso que o banco, o Prisma ou um relatório
 * futuro faça continua caindo no mesmo dia, e o lançamento nunca escorrega para
 * o mês vizinho.
 */
export function occurredAtFrom(dateStr: string | undefined, now = new Date()): Date {
  const today = todayBrt(now);
  const match = /^\d{4}-\d{2}-\d{2}$/.exec((dateStr ?? '').trim());

  // Comparação por dia-calendário em BRT (string 'YYYY-MM-DD' ordena sozinha), e
  // não por instante: meio-dia BRT de hoje é "futuro" durante a manhã, mas a
  // despesa de hoje é de hoje. Data realmente adiante é quase sempre erro de
  // extração (ano trocado, "dia 5" do mês que vem) e jogaria o lançamento fora
  // do mês corrente sem a pessoa notar.
  const day = !match || match[0] > today ? today : match[0];

  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12 + BRT_OFFSET_HOURS));
}

export function monthRangeBrt(
  periodo: string | undefined,
  now = new Date(),
): { start: Date; end: Date; label: string } {
  const { y, m } = brtParts(now);
  const offset = periodo === 'mes_passado' ? -1 : 0;
  // 00:00 BRT = 03:00 UTC. Date.UTC normaliza virada de ano sozinho.
  const start = new Date(Date.UTC(y, m + offset, 1, BRT_OFFSET_HOURS));
  const end   = new Date(Date.UTC(y, m + offset + 1, 1, BRT_OFFSET_HOURS));
  const ref   = new Date(Date.UTC(y, m + offset, 1));
  return { start, end, label: `${MONTH_NAMES[ref.getUTCMonth()]} de ${ref.getUTCFullYear()}` };
}

// ── Formatação ───────────────────────────────────────────────────────────────

function fmtBRL(value: unknown): string {
  return Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d: Date): string {
  const shifted = new Date(d.getTime() - BRT_OFFSET_HOURS * 3_600_000);
  return `${String(shifted.getUTCDate()).padStart(2, '0')}/${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function firstName(name?: string | null): string {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n && n.length > 1 ? n : '';
}

const HELP_TEXT =
  '💡 *Como usar o ZapMonney*\n\n' +
  'Me manda por texto ou áudio, do jeito que você falaria para uma pessoa:\n\n' +
  '• _"gastei 50 no mercado"_ — registra uma despesa\n' +
  '• _"recebi 3000 de salário"_ — registra uma entrada\n' +
  '• _"qual meu saldo"_ — balanço do mês\n' +
  '• _"quanto gastei com transporte"_ — total por categoria\n' +
  '• _"meus últimos lançamentos"_ — extrato recente\n' +
  '• _"apaga o último"_ — remove o último lançamento\n\n' +
  'Sempre confirmo com você antes de salvar qualquer coisa. ✅';

// ── Lançamento pendente ──────────────────────────────────────────────────────

function pendingPrompt(tx: {
  type: string; amount: unknown; category: string; description: string | null; occurredAt: Date;
}): string {
  const sinal = tx.type === 'income' ? '📥 Entrada' : '📤 Despesa';
  const desc  = tx.description ? ` · ${tx.description}` : '';
  return `${sinal}: *${fmtBRL(tx.amount)}* · ${tx.category}${desc} · ${fmtDate(tx.occurredAt)}\n\n` +
         'Confirma? Responde *sim* para salvar, *não* para descartar — ou me diz o que corrigir.';
}

async function createPending(
  zmUserId: string,
  type: 'expense' | 'income',
  data: ZmIntentResult['data'],
  rawText: string,
  confidence: number,
  sourceMsgId?: string | null,
): Promise<ZmReply> {
  if (!data.valor) {
    return '🤔 Entendi que você quer registrar um lançamento, mas não peguei o valor. ' +
           'Me manda de novo com o valor, tipo _"gastei 50 no mercado"_.';
  }

  // Retry do mesmo job (o envio da resposta falhou DEPOIS do insert) não pode
  // criar um segundo lançamento nem explodir no unique de sourceMsgId — e sem
  // isso o discard logo abaixo apagaria justamente o pendente da primeira
  // tentativa. Se a conversa já seguiu adiante, fica calado.
  if (sourceMsgId) {
    const existing = await prisma.zmTransaction.findUnique({ where: { sourceMsgId } });
    if (existing) return existing.status === 'pending' ? pendingPrompt(existing) : null;
  }

  // Um pendente por pessoa: o anterior é descartado antes de abrir o novo
  // (Prisma não expressa unique parcial, então a regra vive aqui).
  await prisma.zmTransaction.updateMany({
    where: { zmUserId, status: 'pending' },
    data:  { status: 'discarded' },
  });

  const tx = await prisma.zmTransaction.create({
    data: {
      zmUserId,
      type,
      // String com 2 casas: evita qualquer artefato de float virar centavo errado.
      amount:      data.valor.toFixed(2),
      category:    normalizeCategory(data.categoria, type),
      description: data.descricao?.trim() || null,
      occurredAt:  occurredAtFrom(data.data),
      status:      'pending',
      rawText,
      confidence,
      sourceMsgId: sourceMsgId || null,
    },
  });

  return pendingPrompt(tx);
}

async function confirmPending(pending: { id: string; type: string; amount: unknown }): Promise<ZmReply> {
  await prisma.zmTransaction.update({ where: { id: pending.id }, data: { status: 'confirmed' } });
  const verbo = pending.type === 'income' ? 'Entrada' : 'Despesa';
  return `✅ ${verbo} de *${fmtBRL(pending.amount)}* registrada.`;
}

async function cancelPending(pendingId: string): Promise<ZmReply> {
  await prisma.zmTransaction.update({ where: { id: pendingId }, data: { status: 'discarded' } });
  return '🗑️ Descartado, nada foi salvo.';
}

async function correctPending(
  pending: { id: string; type: string },
  data: ZmIntentResult['data'],
): Promise<ZmReply> {
  const patch: Record<string, unknown> = {};
  if (data.valor) patch.amount = data.valor.toFixed(2);
  if (data.categoria) patch.category = normalizeCategory(data.categoria, pending.type as 'expense' | 'income');
  if (data.descricao?.trim()) patch.description = data.descricao.trim();
  if (data.data) patch.occurredAt = occurredAtFrom(data.data);

  if (Object.keys(patch).length === 0) {
    return '🤔 Não peguei o que mudar. Me diz o campo, tipo _"era 80"_ ou _"foi ontem"_.';
  }

  const tx = await prisma.zmTransaction.update({ where: { id: pending.id }, data: patch });
  return `✏️ Corrigido.\n\n${pendingPrompt(tx)}`;
}

// ── Consultas ────────────────────────────────────────────────────────────────

async function queryBalance(zmUserId: string, periodo?: string): Promise<ZmReply> {
  const { start, end, label } = monthRangeBrt(periodo);

  const grouped = await prisma.zmTransaction.groupBy({
    by:    ['type'],
    where: { zmUserId, status: 'confirmed', occurredAt: { gte: start, lt: end } },
    _sum:  { amount: true },
  });

  const income  = Number(grouped.find((g) => g.type === 'income')?._sum.amount ?? 0);
  const expense = Number(grouped.find((g) => g.type === 'expense')?._sum.amount ?? 0);

  if (income === 0 && expense === 0) {
    return `📊 *${label}*\n\nNenhum lançamento confirmado neste período ainda.`;
  }

  const saldo = income - expense;
  const icone = saldo >= 0 ? '🟢' : '🔴';

  return `📊 *Balanço de ${label}*\n\n` +
         `📥 Entradas: ${fmtBRL(income)}\n` +
         `📤 Saídas: ${fmtBRL(expense)}\n` +
         `${icone} Saldo: *${fmtBRL(saldo)}*`;
}

async function querySummary(zmUserId: string, data: ZmIntentResult['data']): Promise<ZmReply> {
  const { start, end, label } = monthRangeBrt(data.periodo);

  const filtro = typeof data.filtroCategoria === 'string'
    ? ZM_CATEGORIES.find((c) => c.toLowerCase() === data.filtroCategoria!.trim().toLowerCase())
    : undefined;

  const grouped = await prisma.zmTransaction.groupBy({
    by:    ['category'],
    where: {
      zmUserId,
      status:     'confirmed',
      type:       'expense',
      occurredAt: { gte: start, lt: end },
      ...(filtro ? { category: filtro } : {}),
    },
    _sum:   { amount: true },
    _count: { _all: true },
  });

  if (grouped.length === 0) {
    return filtro
      ? `📊 Nenhuma despesa em *${filtro}* em ${label}.`
      : `📊 Nenhuma despesa registrada em ${label}.`;
  }

  if (filtro) {
    const row = grouped[0];
    return `📊 *${filtro}* em ${label}\n\n` +
           `Total: *${fmtBRL(row._sum.amount)}* em ${row._count._all} lançamento(s).`;
  }

  const rows  = grouped.sort((a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0));
  const total = rows.reduce((sum, r) => sum + Number(r._sum.amount ?? 0), 0);
  const lines = rows.map((r) => `• ${r.category}: ${fmtBRL(r._sum.amount)}`);

  return `📊 *Despesas de ${label}*\n\n${lines.join('\n')}\n\nTotal: *${fmtBRL(total)}*`;
}

async function listRecent(zmUserId: string): Promise<ZmReply> {
  const rows = await prisma.zmTransaction.findMany({
    where:   { zmUserId, status: 'confirmed' },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take:    RECENT_LIMIT,
  });

  if (rows.length === 0) {
    return '📄 Você ainda não tem lançamentos confirmados. Manda o primeiro, tipo _"gastei 50 no mercado"_.';
  }

  const lines = rows.map((r) => {
    const sinal = r.type === 'income' ? '📥' : '📤';
    const desc  = r.description ? ` · ${r.description}` : '';
    return `${sinal} ${fmtDate(r.occurredAt)} · ${fmtBRL(r.amount)} · ${r.category}${desc}`;
  });

  return `📄 *Últimos lançamentos*\n\n${lines.join('\n')}`;
}

async function deleteLast(zmUserId: string): Promise<ZmReply> {
  const last = await prisma.zmTransaction.findFirst({
    where:   { zmUserId, status: 'confirmed' },
    orderBy: { createdAt: 'desc' },
  });

  if (!last) return 'ℹ️ Não encontrei nenhum lançamento confirmado para apagar.';

  await prisma.zmTransaction.update({ where: { id: last.id }, data: { status: 'deleted' } });
  return `🗑️ Apaguei: ${fmtBRL(last.amount)} · ${last.category} · ${fmtDate(last.occurredAt)}.`;
}

async function deleteAccount(zmUserId: string): Promise<ZmReply> {
  // Cascade em ZmTransaction — nada do histórico financeiro sobrevive.
  await prisma.zmUser.delete({ where: { id: zmUserId } });
  return '✅ Pronto, apaguei sua conta e todos os seus lançamentos. ' +
         'Se um dia quiser voltar, basta me mandar uma mensagem.';
}

// ── Onboarding ───────────────────────────────────────────────────────────────

const CONSENT_YES = /\b(sim|aceito|concordo|ok|claro|bora|vamos|come[çc]ar|pode|quero)\b/i;
const CONSENT_NO  = /\b(n[ãa]o|nao|recuso|cancela|depois)\b/i;

function welcomeText(name: string): string {
  const saud = name ? `Oi, ${name}! ` : 'Oi! ';
  return `${saud}Eu sou o *ZapMonney*, seu assistente financeiro aqui no WhatsApp. 💰\n\n` +
         'Eu anoto suas despesas e receitas, somo tudo e te mostro o balanço do mês sempre que você pedir — ' +
         'por texto ou por áudio, do jeito que for mais fácil.\n\n' +
         'Para começar, preciso do seu ok para guardar os lançamentos que você me mandar. ' +
         'Você pode pedir para apagar tudo quando quiser, a qualquer momento.\n\n' +
         'Posso começar? Responde *sim* para a gente seguir.';
}

function tutorialText(name: string): string {
  const saud = name ? `Perfeito, ${name}! ` : 'Perfeito! ';
  return `${saud}Tudo pronto. ✅\n\n${HELP_TEXT}`;
}

// ── Orquestração ─────────────────────────────────────────────────────────────

export async function handleZapMonneyMessage(input: ZmMessageInput): Promise<ZmReply> {
  const text = input.text.trim();
  if (!text) return null;

  let zmUser = await prisma.zmUser.findUnique({ where: { phone: input.phone } });

  // ── Primeira mensagem: cadastro na própria conversa ───────────────────────
  if (!zmUser) {
    // Vínculo frouxo com a conta ZapScript do mesmo telefone, quando existe —
    // serve a suporte e cross-sell, nenhuma regra do produto depende disso.
    const zsUser = await prisma.user
      .findFirst({ where: { phone: input.phone }, select: { id: true } })
      .catch(() => null);

    zmUser = await prisma.zmUser.create({
      data: {
        phone:  input.phone,
        name:   input.pushName?.trim() || null,
        stage:  'awaiting_consent',
        userId: zsUser?.id ?? null,
      },
    });

    logger.info(`[ZapMonney] 🆕 Novo usuário ${zmUser.id} (${input.phone})`);
    return welcomeText(firstName(zmUser.name));
  }

  // Lever de operação para número público: um UPDATE manual em ZmUser.stage
  // silencia quem estiver abusando, sem deploy.
  if (zmUser.stage === 'blocked') {
    logger.warn(`[ZapMonney] Mensagem de usuário bloqueado ${zmUser.id} — ignorada`);
    return null;
  }

  prisma.zmUser.update({ where: { id: zmUser.id }, data: { lastSeenAt: new Date() } })
    .catch(() => null);

  // ── Consentimento pendente: resolvido por regex, sem gastar modelo ────────
  if (zmUser.stage === 'awaiting_consent') {
    if (CONSENT_YES.test(text)) {
      await prisma.zmUser.update({
        where: { id: zmUser.id },
        data:  { stage: 'active', consentAt: new Date() },
      });
      return tutorialText(firstName(zmUser.name));
    }
    if (CONSENT_NO.test(text)) {
      return 'Tudo bem, sem problema. Quando quiser começar, só responder *sim* por aqui. 👋';
    }
    return welcomeText(firstName(zmUser.name));
  }

  // ── Exclusão de conta: confirmação por frase exata (ação irreversível) ────
  if (text.toUpperCase() === DELETE_ACCOUNT_PHRASE) {
    return deleteAccount(zmUser.id);
  }

  const pending = await prisma.zmTransaction.findFirst({
    where:   { zmUserId: zmUser.id, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });

  // Atalho sem IA: "sim"/"não" com lançamento aberto é a mensagem mais comum
  // do produto, e não precisa de modelo para ser entendida.
  if (pending) {
    const quick = matchQuickReply(text);
    if (quick === 'confirm') return confirmPending(pending);
    if (quick === 'cancel')  return cancelPending(pending.id);
  }

  const classification = await classifyZapMonneyMessage(text, {
    todayBrt:   todayBrt(),
    hasPending: !!pending,
    userId:     zmUser.userId ?? undefined,
  });

  logger.info(`[ZapMonney] Intent=${classification.intent} confiança=${classification.confidence} zmUser=${zmUser.id}`);

  switch (classification.intent) {
    case 'add_expense':
      return createPending(zmUser.id, 'expense', classification.data, text, classification.confidence, input.sourceMsgId);

    case 'add_income':
      return createPending(zmUser.id, 'income', classification.data, text, classification.confidence, input.sourceMsgId);

    case 'confirm':
      return pending
        ? confirmPending(pending)
        : 'ℹ️ Não tem nenhum lançamento aguardando confirmação agora.';

    case 'cancel':
      return pending
        ? cancelPending(pending.id)
        : 'ℹ️ Não tem nada pendente para descartar.';

    case 'correct':
      return pending
        ? correctPending(pending, classification.data)
        : 'ℹ️ Não tem lançamento aberto para corrigir. Se quer mudar um já salvo, ' +
          'posso apagar o último e você manda de novo.';

    case 'query_balance':
      return queryBalance(zmUser.id, classification.data.periodo);

    case 'query_summary':
      return querySummary(zmUser.id, classification.data);

    case 'list_recent':
      return listRecent(zmUser.id);

    case 'delete_last':
      return deleteLast(zmUser.id);

    case 'delete_account':
      return '⚠️ Isso apaga sua conta e *todos* os seus lançamentos, sem como desfazer.\n\n' +
             `Se é isso que você quer, responde exatamente: *${DELETE_ACCOUNT_PHRASE}*`;

    case 'help':
      return HELP_TEXT;

    case 'none':
    default:
      return '🤔 Não entendi direito.\n\n' + HELP_TEXT;
  }
}
