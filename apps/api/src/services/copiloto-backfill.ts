import { logger } from '../lib/logger';
import { fetchUnreadChats, fetchChatMessages } from './evolution';
import { enqueueCopilotoMessage } from './copiloto-commands';

/**
 * Backfill do Copiloto — pega o BACKLOG de conversas individuais que já
 * estavam com mensagens não lidas no momento em que o dono liga o Copiloto
 * (via admin ou "copiloto ligar" no self-chat), em vez de só reagir dali pra
 * frente. Sem isso, quem liga o Copiloto com conversas represadas não recebe
 * briefing nenhum delas — só das mensagens que chegarem depois.
 *
 * Reaproveita 100% do pipeline normal (enqueueCopilotoMessage → fila
 * 'copiloto' → processIngest/processBrief em apps/worker/src/copiloto.ts):
 * cada mensagem histórica vira um job 'ingest' comum, e o 'brief' por
 * conversa já dedupa pelo mesmo bucket de debounce — não gera 1 briefing por
 * mensagem antiga, gera 1 por conversa, como uma rajada normal geraria.
 *
 * Volume: processa as conversas não lidas mais recentes primeiro. O teto
 * diário de briefings (CopilotoConfig.maxBriefsPerDay) já filtra o resto
 * naturalmente em processBrief — o que não coube hoje fica com a mensagem
 * ingerida mas sem brief, e runCopilotoPendingSweep() (worker) tenta de novo
 * nos dias seguintes até esvaziar.
 */

const MAX_UNREAD_CHATS = 30;       // teto de segurança por rodada — não varre a vida inteira do WhatsApp de uma vez
const MAX_MESSAGES_PER_CHAT = 20;  // últimas N mensagens por conversa — contexto suficiente sem virar prompt gigante

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
