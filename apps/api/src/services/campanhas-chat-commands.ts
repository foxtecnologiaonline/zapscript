/**
 * campanhas-chat-commands.ts
 *
 * Chatbot Campanhas — comandos do dono via self-chat ("campanha ..."), mesmo
 * padrão de atende-commands.ts/copiloto-commands.ts: prefixo explícito pra
 * entrar no fluxo, e continuação livre (sem prefixo) enquanto há uma
 * CampanhaChatSession ativa pro telefone (stage != 'idle') — mesma ideia de
 * handleCopilotoChoice() interpretar resposta solta só quando há briefing
 * pendente. Reaproveita 100% a infraestrutura de campanhas já existente
 * (warmContactsForNumber, enqueueCampanhaSend, CampanhaContato) — o bot só
 * decide QUANDO criar/disparar, não reimplementa nada disso.
 *
 * v1: só origem "histórico" (warmContactsForNumber) — CSV e print continuam
 * exclusivos do painel web (ver plano). Compra de saldo é só Pix (o bot não
 * manda formulário de cartão); o QR em si não é enviado como imagem nesta
 * fatia — só o "copia e cola" em texto, que já basta pra pagar.
 */
import { prisma } from '../lib/prisma';
import { sendText } from './evolution';
import { getUserModules } from '../lib/moduleGate';
import { warmContactsForNumber, enqueueCampanhaSend } from '../routes/modules/campanhas';
import { getOrCreateCampanhaBalance, debitCampanhaMessages, InsufficientCampanhaBalanceError } from '../lib/campanha-credit';
import {
  CAMPANHA_MSG_PACKAGES, CAMPANHA_MONTHLY_MESSAGES, CAMPANHA_MONTHLY_PRICE_BRL,
  buyCampanhaMessagesViaPix, subscribeCampanhaMonthlyViaPix,
} from '../routes/billing';

const COMMAND_PREFIX = /^\s*campanha\b/i;
const DAILY_LIMIT = parseInt(process.env.CAMPANHAS_CHAT_RATE_LIMIT || '10', 10);

export function isCampanhaChatCommand(text: string): boolean {
  return COMMAND_PREFIX.test(text ?? '');
}

type Ctx = { userId: string; numberId: string; instanceName: string; selfPhone: string; text: string };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ['👍', 'sim', 's', 'confirmar', 'confirmo', '1', 'ok'].includes(t);
}
function isNegative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ['❌', 'não', 'nao', 'n', 'cancelar', '0'].includes(t);
}
function isEdit(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ['✏️', 'editar', 'mudar', 'trocar'].includes(t);
}

const HELP_TEXT = [
  '*Comandos do Chatbot Campanhas* (mande aqui, pra você mesmo):',
  '• campanha saldo — vê quantas mensagens você ainda tem',
  '• campanha nova — cria e dispara uma campanha pro seu histórico de conversas',
  '• campanha comprar — compra mais mensagens (Pix)',
  '• campanha cancelar — cancela o que estiver em andamento',
].join('\n');

async function reply(instanceName: string, phone: string, text: string): Promise<void> {
  await sendText(instanceName, phone, text).catch(() => { /* não crítico */ });
}

async function balanceText(userId: string): Promise<string> {
  const balance = await getOrCreateCampanhaBalance(userId);
  const planLine = balance.plan === 'monthly'
    ? `\nAssinatura mensal ativa (renova ${balance.renewalDate?.toLocaleDateString('pt-BR') ?? '—'}).`
    : '';
  return `💬 Saldo: *${balance.availableMessages}* mensagens.${planLine}`;
}

function packagesText(): string {
  const lines = CAMPANHA_MSG_PACKAGES.map((p, i) =>
    `${i + 1}️⃣ ${p.label} — R$${p.priceBrl} (${p.desc})`);
  lines.push(`💳 mensal — Plano Mensal, ${CAMPANHA_MONTHLY_MESSAGES} msgs/mês por R$${CAMPANHA_MONTHLY_PRICE_BRL}`);
  return ['Como você quer comprar?', ...lines, '', 'Responda com o número do pacote ou "mensal".'].join('\n');
}

async function resetToIdle(phone: string): Promise<void> {
  await prisma.campanhaChatSession.upsert({
    where:  { phone },
    create: { phone, stage: 'idle' },
    update: { stage: 'idle', draftMessageBody: null, draftContactSource: null, campanhaId: null, pendingPackageId: null, pendingChargeId: null, attempts: 0 },
  });
}

/** Entrada com prefixo "campanha ..." — sempre trata (reseta qualquer estado anterior). */
export async function handleCampanhaChatCommand(ctx: Ctx): Promise<void> {
  const { userId, instanceName, selfPhone, text } = ctx;
  const rest = text.replace(COMMAND_PREFIX, '').trim().toLowerCase();
  const [cmd] = rest.split(/\s+/).filter(Boolean);

  if (!cmd || ['ajuda', 'help', 'menu', 'comandos'].includes(cmd)) {
    await reply(instanceName, selfPhone, `${HELP_TEXT}\n\n${await balanceText(userId)}`);
    return;
  }

  if (cmd === 'saldo') {
    await reply(instanceName, selfPhone, await balanceText(userId));
    return;
  }

  if (cmd === 'cancelar') {
    const session = await prisma.campanhaChatSession.findUnique({ where: { phone: selfPhone } });
    if (session?.campanhaId) {
      // rascunho ainda não disparado (draft) — pode apagar com segurança
      await prisma.campanha.deleteMany({ where: { id: session.campanhaId, status: 'draft' } }).catch(() => null);
    }
    await resetToIdle(selfPhone);
    await reply(instanceName, selfPhone, 'Ok, cancelado. Pode mandar "campanha nova" quando quiser começar de novo.');
    return;
  }

  if (cmd === 'comprar') {
    await prisma.campanhaChatSession.upsert({
      where: { phone: selfPhone }, create: { phone: selfPhone, stage: 'awaiting_purchase' },
      update: { stage: 'awaiting_purchase' },
    });
    await reply(instanceName, selfPhone, packagesText());
    return;
  }

  if (cmd === 'continuar') {
    await handleContinuar(ctx);
    return;
  }

  if (cmd === 'nova') {
    if (!(await getUserModules(userId)).includes('campanhas')) {
      await reply(instanceName, selfPhone, 'Você ainda não tem o módulo Campanhas contratado. Contrate em zapscript.me/dashboard/plano e mande "campanha nova" de novo.');
      return;
    }

    const createdToday = await prisma.campanha.count({
      where: { userId, createdViaChat: true, createdAt: { gte: startOfToday() } },
    });
    if (createdToday >= DAILY_LIMIT) {
      await reply(instanceName, selfPhone, `Você já criou ${DAILY_LIMIT} campanhas hoje por aqui — o limite diário é esse. Tente de novo amanhã, ou crie pelo painel.`);
      return;
    }

    await prisma.campanhaChatSession.upsert({
      where:  { phone: selfPhone },
      create: { phone: selfPhone, userId, stage: 'awaiting_message' },
      update: { userId, stage: 'awaiting_message', campanhaId: null, draftMessageBody: null },
    });
    await reply(instanceName, selfPhone, '📝 Qual é a mensagem da campanha?');
    return;
  }

  await reply(instanceName, selfPhone, `Não entendi esse comando.\n\n${HELP_TEXT}`);
}

async function handleContinuar(ctx: Ctx): Promise<void> {
  const { userId, instanceName, selfPhone } = ctx;
  const session = await prisma.campanhaChatSession.findUnique({ where: { phone: selfPhone } });
  if (!session?.campanhaId) {
    await reply(instanceName, selfPhone, 'Não tem nenhuma campanha parada esperando saldo. Mande "campanha nova" para começar uma.');
    return;
  }
  const campanha = await prisma.campanha.findFirst({ where: { id: session.campanhaId, userId, status: 'draft' } });
  if (!campanha) {
    await resetToIdle(selfPhone);
    await reply(instanceName, selfPhone, 'Essa campanha não está mais disponível. Mande "campanha nova" para começar outra.');
    return;
  }
  await prisma.campanhaChatSession.update({ where: { phone: selfPhone }, data: { stage: 'previewing' } });
  await startCampanha(ctx, campanha);
}

/** Continuação sem prefixo — só age se houver sessão ativa (stage != 'idle'). Retorna se tratou. */
export async function handleCampanhaChatReply(ctx: Ctx): Promise<boolean> {
  const session = await prisma.campanhaChatSession.findUnique({ where: { phone: ctx.selfPhone } });
  if (!session || session.stage === 'idle') return false;

  switch (session.stage) {
    case 'awaiting_message':  await handleAwaitingMessage(ctx, session); return true;
    case 'previewing':        await handlePreviewing(ctx, session);      return true;
    case 'awaiting_purchase': await handleAwaitingPurchase(ctx);         return true;
    default:                  return false;
  }
}

async function handleAwaitingMessage(ctx: Ctx, session: { campanhaId: string | null }): Promise<void> {
  const { userId, numberId, instanceName, selfPhone, text } = ctx;
  const messageBody = text.trim();
  if (!messageBody) {
    await reply(instanceName, selfPhone, 'Manda o texto da campanha (pode usar {{nome}} para personalizar).');
    return;
  }

  let campanhaId = session.campanhaId;
  if (campanhaId) {
    // veio de "editar" — atualiza o rascunho existente, contatos já importados continuam valendo
    await prisma.campanha.update({ where: { id: campanhaId }, data: { messageBody } });
  } else {
    const warm = await warmContactsForNumber(numberId);
    if (warm.size === 0) {
      await resetToIdle(selfPhone);
      await reply(instanceName, selfPhone, 'Não encontrei ninguém que já falou com esse número ainda — não dá para criar a campanha. Assim que você tiver conversas, tente de novo.');
      return;
    }

    const optOuts = await prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } });
    const optOutSet = new Set(optOuts.map((o) => o.phone));

    const campanha = await prisma.campanha.create({
      data: {
        userId, whatsappNumberId: numberId,
        name: `Campanha via chat — ${new Date().toLocaleDateString('pt-BR')}`,
        channel: 'evolution', messageBody, createdViaChat: true,
      },
    });
    const toCreate = [...warm.entries()]
      .filter(([phone]) => !optOutSet.has(phone))
      .map(([phone, name]) => ({ campanhaId: campanha.id, phone, name }));
    await prisma.campanhaContato.createMany({ data: toCreate });
    await prisma.campanha.update({ where: { id: campanha.id }, data: { audienceCount: toCreate.length } });
    campanhaId = campanha.id;
  }

  const campanha = await prisma.campanha.findUniqueOrThrow({ where: { id: campanhaId } });
  await prisma.campanhaChatSession.update({
    where: { phone: selfPhone },
    data:  { stage: 'previewing', campanhaId, draftMessageBody: messageBody },
  });

  const preview = [
    '🔍 Prontinho — confira antes de disparar:',
    '',
    '┌─────────────────',
    ...campanha.messageBody!.split('\n').map((l) => `│ ${l}`),
    '└─────────────────',
    '',
    `👥 ${campanha.audienceCount} contatos (quem já falou com você).`,
    '⚠️ O envio sai pelo seu próprio número conectado — uso fora da API oficial pode levar o WhatsApp a banir o número em caso de abuso.',
    '',
    '👍 Enviar · ✏️ Editar mensagem · ❌ Cancelar',
  ].join('\n');
  await reply(instanceName, selfPhone, preview);
}

async function handlePreviewing(ctx: Ctx, session: { campanhaId: string | null }): Promise<void> {
  const { userId, instanceName, selfPhone, text } = ctx;
  if (!session.campanhaId) { await resetToIdle(selfPhone); return; }

  if (isNegative(text)) {
    await prisma.campanha.deleteMany({ where: { id: session.campanhaId, status: 'draft' } });
    await resetToIdle(selfPhone);
    await reply(instanceName, selfPhone, 'Cancelado — nada foi enviado.');
    return;
  }

  if (isEdit(text)) {
    await prisma.campanhaChatSession.update({ where: { phone: selfPhone }, data: { stage: 'awaiting_message' } });
    await reply(instanceName, selfPhone, '📝 Manda a nova mensagem.');
    return;
  }

  if (isAffirmative(text)) {
    const campanha = await prisma.campanha.findFirst({ where: { id: session.campanhaId, userId, status: 'draft' } });
    if (!campanha) {
      await resetToIdle(selfPhone);
      await reply(instanceName, selfPhone, 'Essa campanha não está mais disponível.');
      return;
    }
    await startCampanha(ctx, campanha);
    return;
  }

  await reply(instanceName, selfPhone, 'Não entendi — responda 👍 para enviar, ✏️ para editar a mensagem, ou ❌ para cancelar.');
}

/** Debita o saldo e dispara — ou, sem saldo, oferece compra e deixa a campanha em draft para "campanha continuar". */
async function startCampanha(ctx: Ctx, campanha: { id: string; userId: string; audienceCount: number; channel: string }): Promise<void> {
  const { instanceName, selfPhone } = ctx;
  const balance = await getOrCreateCampanhaBalance(campanha.userId);

  if (balance.availableMessages < campanha.audienceCount) {
    const faltam = campanha.audienceCount - balance.availableMessages;
    await prisma.campanhaChatSession.update({ where: { phone: selfPhone }, data: { stage: 'awaiting_purchase' } });
    await reply(instanceName, selfPhone, [
      `Saldo insuficiente: você tem ${balance.availableMessages} e essa campanha precisa de ${campanha.audienceCount} (faltam ${faltam}).`,
      '', packagesText(),
      '', 'Depois de pagar, mande "campanha continuar" para disparar.',
    ].join('\n'));
    return;
  }

  try {
    await debitCampanhaMessages(campanha.userId, campanha.audienceCount, { referenceType: 'campanha', referenceId: campanha.id });
  } catch (err) {
    if (err instanceof InsufficientCampanhaBalanceError) {
      await reply(instanceName, selfPhone, 'Saldo insuficiente no momento do envio — tente "campanha continuar" depois de comprar mais mensagens.');
      return;
    }
    throw err;
  }

  await prisma.campanha.update({
    where: { id: campanha.id },
    data: {
      status: 'running', startedAt: new Date(), messagesCost: campanha.audienceCount,
      consentConfirmedAt: new Date(),
    },
  });
  const enqueued = await enqueueCampanhaSend(campanha.id, campanha.channel);
  await resetToIdle(selfPhone);
  await reply(instanceName, selfPhone, `🚀 Disparo iniciado! ${enqueued} mensagens na fila. Acompanhe pelo painel (zapscript.me/dashboard/campanhas).`);
}

async function handleAwaitingPurchase(ctx: Ctx): Promise<void> {
  const { userId, instanceName, selfPhone, text } = ctx;
  const choice = text.trim().toLowerCase();

  if (choice === 'mensal') {
    const result = await subscribeCampanhaMonthlyViaPix(userId);
    if (!result.ok) { await reply(instanceName, selfPhone, `Não deu para criar a assinatura: ${result.error}`); return; }
    await prisma.campanhaChatSession.update({ where: { phone: selfPhone }, data: { pendingChargeId: result.data.paymentId ?? undefined } });
    await reply(instanceName, selfPhone, [
      `💳 Plano Mensal — R$${CAMPANHA_MONTHLY_PRICE_BRL}/mês (${CAMPANHA_MONTHLY_MESSAGES} msgs).`,
      'Pix copia e cola:', result.data.copyPaste || '(erro ao gerar o código — tente de novo)',
      '', 'Assim que cair, eu credito automaticamente. Se tinha uma campanha esperando, mande "campanha continuar".',
    ].join('\n'));
    return;
  }

  const idx = parseInt(choice, 10) - 1;
  const pkg = CAMPANHA_MSG_PACKAGES[idx];
  if (!pkg) {
    await reply(instanceName, selfPhone, `Não entendi. ${packagesText()}`);
    return;
  }

  const result = await buyCampanhaMessagesViaPix(userId, pkg.id);
  if (!result.ok) { await reply(instanceName, selfPhone, `Não deu para gerar a cobrança: ${result.error}`); return; }
  await prisma.campanhaChatSession.update({ where: { phone: selfPhone }, data: { pendingPackageId: pkg.id, pendingChargeId: result.data.paymentId } });
  await reply(instanceName, selfPhone, [
    `💰 ${pkg.label} — R$${pkg.priceBrl}.`,
    'Pix copia e cola:', result.data.copyPaste || '(erro ao gerar o código — tente de novo)',
    '', 'Assim que cair, eu credito automaticamente. Se tinha uma campanha esperando, mande "campanha continuar".',
  ].join('\n'));
}
