import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Webhook da Evolution API para UMA conexão. `connectionId` no path é o
// próprio segredo (cuid aleatório, não listado em lugar nenhum) — MVP
// suficiente já que a Evolution não assina webhooks nativamente; se isso
// rodar num Evolution compartilhado com outro produto, considerar também
// um header de verificação próprio antes de ir a produção com volume alto.
export async function POST(req: NextRequest, { params }: { params: { connectionId: string } }) {
  const connection = await db.whatsappConnection.findUnique({ where: { id: params.connectionId } });
  if (!connection) return NextResponse.json({ ok: true }); // instância órfã — ignora silenciosamente

  const body = await req.json().catch(() => null);
  const event: string | undefined = body?.event;
  const data = body?.data;
  if (!event || !data) return NextResponse.json({ ok: true });

  if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
    await handleConnectionUpdate(connection.id, data);
  } else if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
    await handleMessageUpsert(connection.id, connection.clientId, data);
  }

  return NextResponse.json({ ok: true });
}

async function handleConnectionUpdate(connectionId: string, data: any) {
  const state = data?.state ?? data?.connection;
  if (state === 'open') {
    const phoneNumber = (data?.wuid ?? data?.ownerJid ?? '').toString().split('@')[0].replace(/\D/g, '') || null;
    await db.whatsappConnection.update({
      where: { id: connectionId },
      data: { status: 'connected', connectedAt: new Date(), phoneNumber },
    });
  } else if (state === 'close') {
    await db.whatsappConnection.update({
      where: { id: connectionId },
      data: { status: 'disconnected' },
    });
  } else if (state === 'connecting') {
    await db.whatsappConnection.update({
      where: { id: connectionId },
      data: { status: 'connecting' },
    });
  }
}

async function handleMessageUpsert(connectionId: string, clientId: string, data: any) {
  const msg = Array.isArray(data) ? data[0] : data;
  const key = msg?.key;
  if (!key || key.fromMe) return; // só mensagens recebidas; envios feitos por nós já são gravados no ponto de envio
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
  let conversation = await db.conversation.findFirst({
    where: { clientId, customerPhone: phone, connectionId },
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
