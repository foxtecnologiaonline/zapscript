import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getMessagingEngine } from '@/lib/messaging/engine';
import type { WhatsappConnection } from 'zapbox-db';

// Webhook da Evolution API para UMA conexão. `connectionId` no path é o
// próprio segredo (cuid aleatório, não listado em lugar nenhum) — MVP
// suficiente já que a Evolution não assina webhooks nativamente; se isso
// rodar num Evolution compartilhado com outro produto, considerar também
// um header de verificação próprio antes de ir a produção com volume alto.
//
// Responde 200 IMEDIATAMENTE e processa em background (mesmo padrão do
// webhook do ZapScript.me) — a Evolution reenvia o evento se não receber
// resposta rápida, e o debounce de desconexão abaixo sozinho já levaria
// ~8s se bloqueasse a resposta.
export async function POST(req: NextRequest, { params }: { params: { connectionId: string } }) {
  const body = await req.json().catch(() => null);

  processEvent(params.connectionId, body).catch((err) => {
    console.error('[ZapBox webhook] erro ao processar evento', err);
  });

  return NextResponse.json({ ok: true });
}

async function processEvent(connectionId: string, body: any) {
  const connection = await db.whatsappConnection.findUnique({ where: { id: connectionId } });
  if (!connection) return; // instância órfã — ignora silenciosamente

  const event: string | undefined = body?.event;
  const data = body?.data;
  if (!event || !data) return;

  if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
    await handleConnectionUpdate(connection, data);
  } else if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
    await handleMessageUpsert(connection.id, connection.clientId, data);
  }
}

async function handleConnectionUpdate(connection: WhatsappConnection, data: any) {
  const state = data?.state ?? data?.connection;

  if (state === 'open') {
    const phoneNumber = (data?.wuid ?? data?.ownerJid ?? '').toString().split('@')[0].replace(/\D/g, '') || null;
    await db.whatsappConnection.update({
      where: { id: connection.id },
      data: { status: 'connected', connectedAt: new Date(), phoneNumber },
    });
    return;
  }

  if (state === 'close') {
    // Evolution manda "close" em quedas momentâneas de socket (restart do
    // container, instabilidade de rede) que se resolvem sozinhas em segundos.
    // Espera 8s e reconfere o estado real antes de marcar como desconectado
    // de fato — evita o modal de reconexão piscando por um evento falso-positivo.
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    const engine = getMessagingEngine(connection.provider as 'evolution' | 'meta');
    const realState = await engine.getStatus(connection.instanceName);
    if (realState === 'connected') return; // falso positivo — já reconectou sozinho

    await db.whatsappConnection.update({
      where: { id: connection.id },
      data: { status: 'disconnected' },
    });
    return;
  }

  if (state === 'connecting') {
    await db.whatsappConnection.update({
      where: { id: connection.id },
      data: { status: 'connecting' },
    });
  }
}

async function handleMessageUpsert(connectionId: string, clientId: string, data: any) {
  const msg = Array.isArray(data) ? data[0] : data;
  const key = msg?.key;
  // Só mensagens recebidas. Mensagens fromMe enviadas pela própria ZapBox já
  // são gravadas no ponto de envio (reply/start); fromMe mandadas pelo dono
  // direto do próprio WhatsApp dele (fora da Inbox) não são capturadas aqui —
  // limitação conhecida, ver README.
  if (!key || key.fromMe) return;
  const remoteJid: string = key.remoteJid ?? '';
  if (!remoteJid.endsWith('@s.whatsapp.net')) return; // ignora grupos/status

  const phone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  if (!phone) return;

  const messageType = msg?.messageType;
  const text: string | undefined =
    messageType === 'conversation' ? msg?.message?.conversation :
    messageType === 'extendedTextMessage' ? msg?.message?.extendedTextMessage?.text :
    undefined;
  if (!text) return; // MVP: só texto — mídia fica para uma próxima iteração

  const pushName: string | undefined = msg?.pushName;

  // Cliente final pode responder direto pelo próprio app do WhatsApp (fora do
  // widget) — nesse caso não existe ainda um visitorId; usamos o telefone
  // como chave de conversa estável para essa origem.
  // Duas sessões de widget diferentes (sem localStorage compartilhado) podem
  // ter cadastrado o mesmo telefone com visitorId's distintos — nesse caso
  // existe mais de uma Conversation com esse telefone. Resolve pra mais
  // recente (thread ativa) em vez de ordem arbitrária do banco.
  let conversation = await db.conversation.findFirst({
    where: { clientId, customerPhone: phone, connectionId },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        clientId,
        connectionId,
        visitorId: `wa-${phone}`,
        customerPhone: phone,
        customerName: pushName ?? null,
        status: 'open',
      },
    });
  } else {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), status: 'open' },
    });
  }

  await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'in',
      channel: 'whatsapp',
      senderType: 'visitor',
      body: text,
      whatsappMessageId: key.id ?? null,
    },
  });
}
