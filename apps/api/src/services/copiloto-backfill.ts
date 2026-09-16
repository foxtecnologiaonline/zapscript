import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { fetchUnreadChats, fetchChatMessages } from './evolution';
import { enqueueCopilotoMessage } from './copiloto-commands';
import { getUserModules } from '../lib/moduleGate';

/**
 * Backfill do Copiloto — pega o BACKLOG de conversas individuais que já
 * estavam com mensagens não lidas no momento em que o dono liga o Copiloto
 * (via admin ou "copiloto ligar" no self-chat), em vez de só reagir dali pra
 * frente. Sem isso, quem liga o Copiloto com conversas represadas não recebe
 * briefing nenhum delas — só das mensagens que chegarem depois.
 *
 * Reaproveita 100% do pipeline de ingestão normal (enqueueCopilotoMessage →
 * fila 'copiloto' → processIngest em apps/worker/src/copiloto.ts): cada
 * mensagem histórica vira um job 'ingest' comum, só persiste (sem IA).
 *
 * v3.0 — não enfileira mais 'brief' (isso virou sob demanda, disparado pelo
 * painel — ver ESCOPO_COPILOTO.md §15). Depois do backfill, a conversa
 * aparece como "não lida" em GET /copiloto/inbox normalmente, e vira
 * briefing quando o dono clicar "Atualizar".
 *
 * Volume: processa as conversas não lidas mais recentes primeiro, até
 * MAX_UNREAD_CHATS por rodada — o sweep periódico abaixo cobre o resto nas
 * rodadas seguintes.
 */

// Configuráveis via env var (sem redeploy de código) — o sweep periódico
// (runCopilotoUnreadSweep, abaixo) roda a cada 2h contra todo número
// conectado, então o teto certo depende de volume real observado em
// produção, não de um chute fixo no código.
const MAX_UNREAD_CHATS = parseInt(process.env.COPILOTO_BACKFILL_MAX_CHATS || '30', 10);       // teto de segurança por rodada — não varre a vida inteira do WhatsApp de uma vez
const MAX_MESSAGES_PER_CHAT = parseInt(process.env.COPILOTO_BACKFILL_MAX_MESSAGES || '20', 10);  // últimas N mensagens por conversa — contexto suficiente sem virar prompt gigante

export interface BackfillResult {
  chatsProcessed: number;
  messagesIngested: number;
}

export async function backfillUnreadConversations(params: {
  userId: string;
  numberId: string;
  instanceId: string;
  ownPhoneDigits: string; // nunca tenta brifar o próprio self-chat
}): Promise<BackfillResult> {
  let chats;
  try {
    chats = await fetchUnreadChats(params.instanceId);
  } catch (err: any) {
    logger.warn(`[Copiloto] Backfill: falha ao listar chats não lidos (número ${params.numberId}): ${err.message}`);
    return { chatsProcessed: 0, messagesIngested: 0 };
  }

  const targets = chats
    .filter((c) => c.phone && c.phone !== params.ownPhoneDigits)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    .slice(0, MAX_UNREAD_CHATS);

  let messagesIngested = 0;
  for (const chat of targets) {
    let messages;
    try {
      messages = await fetchChatMessages(params.instanceId, chat.jid, MAX_MESSAGES_PER_CHAT);
    } catch (err: any) {
      logger.warn(`[Copiloto] Backfill: falha ao buscar mensagens de ${chat.phone}: ${err.message}`);
      continue;
    }
    for (const m of messages) {
      await enqueueCopilotoMessage({
        userId:       params.userId,
        numberId:     params.numberId,
        contactPhone: chat.phone,
        contactName:  chat.name,
        direction:    m.fromMe ? 'out' : 'in',
        content:      m.text,
        messageId:    m.id,
      }).catch((err: any) =>
        logger.warn(`[Copiloto] Backfill: falha ao enfileirar mensagem de ${chat.phone}: ${err.message}`));
      messagesIngested++;
    }
  }

  logger.info(
    `[Copiloto] Backfill concluído — número ${params.numberId}: ${targets.length} conversa(s) não lida(s), ${messagesIngested} mensagem(ns) ingerida(s)`,
  );
  return { chatsProcessed: targets.length, messagesIngested };
}

// ─────────────────────────────────────────────────────────────────────────
// Sweep periódico — rede de segurança pra garantir que TODA mensagem que o
// WhatsApp mostra como "não lida" passe pelo Copiloto, não só nos dois
// momentos em que o backfill acima já era chamado ("copiloto ligar" e
// liberação do módulo pelo admin) e na reconexão (evolution-heartbeat.ts).
// Sem isso, um webhook perdido (Evolution fora do ar por alguns minutos,
// etc.) deixava a mensagem "presa" — não lida no WhatsApp, mas nunca
// ingerida no Copiloto, e sem reconexão nenhuma pra disparar o backfill de
// novo. Seguro pra rodar em loop: fetchUnreadChats só devolve o que ainda
// está de fato não lido (o próprio WhatsApp já filtra o que repete), e o
// dedup por externalId em processIngest (apps/worker/src/copiloto.ts) evita
// duplicar mensagem quando o mesmo chat aparece em duas rodadas seguidas.
// Mesmo padrão de setTimeout+setInterval+unref de evolution-heartbeat.ts.
// ─────────────────────────────────────────────────────────────────────────

const UNREAD_SWEEP_INTERVAL_MS = 2 * 60 * 60 * 1000; // a cada 2h — rede de segurança, não o caminho principal
const UNREAD_SWEEP_FIRST_MS    = 20 * 60 * 1000;      // 1ª rodada 20min após o boot, dá tempo do resto do startup assentar

export async function runCopilotoUnreadSweep(log: any): Promise<void> {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return;

  const numbers = await prisma.copilotoConfig.findMany({
    where: { enabled: true },
    select: {
      numberId: true,
      number: { select: { userId: true, zapiInstanceId: true, phoneNumber: true, status: true } },
    },
  }).catch(() => [] as any[]);

  let swept = 0;
  for (const cfg of numbers) {
    const n = cfg.number;
    if (!n || n.status !== 'connected' || !n.zapiInstanceId || !n.phoneNumber || n.phoneNumber === 'pending') continue;

    const hasCopiloto = await getUserModules(n.userId).then((mods) => mods.includes('copiloto')).catch(() => false);
    if (!hasCopiloto) continue;

    await backfillUnreadConversations({
      userId: n.userId,
      numberId: cfg.numberId,
      instanceId: n.zapiInstanceId,
      ownPhoneDigits: String(n.phoneNumber).replace(/\D/g, ''),
    }).catch((err: any) => log.warn(`[Copiloto] Sweep de não lidas falhou (número ${cfg.numberId}): ${err.message}`));
    swept++;

    await new Promise((r) => setTimeout(r, 200)); // não martela a Evolution API — mesmo espaçamento do heartbeat
  }

  if (swept > 0) log.info(`[Copiloto] Sweep de não lidas: ${swept} número(s) verificado(s)`);
}

export function startCopilotoUnreadSweep(log: any): void {
  const t = setTimeout(
    () => runCopilotoUnreadSweep(log).catch((e: any) => log.error(`[Copiloto] Sweep de não lidas: ${e.message}`)),
    UNREAD_SWEEP_FIRST_MS,
  );
  const i = setInterval(
    () => runCopilotoUnreadSweep(log).catch((e: any) => log.error(`[Copiloto] Sweep de não lidas: ${e.message}`)),
    UNREAD_SWEEP_INTERVAL_MS,
  );
  t.unref(); i.unref();
  log.info('[Copiloto] ✅ Sweep de não lidas a cada 2h (1ª em 20min)');
}
