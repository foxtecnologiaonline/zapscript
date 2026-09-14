import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';
import { evolutionEngine } from '@/lib/messaging/evolution-engine';

export async function OPTIONS() {
  return corsPreflight();
}

// Pré-chat: o visitante informa nome + WhatsApp e abre (ou retoma) uma
// conversa. Se for a primeira vez, dispara uma saudação via WhatsApp pro
// número do visitante — a partir daí a conversa "existe" de fato no
// WhatsApp dele, e o widget só espelha essa mesma thread.
export async function POST(req: NextRequest, { params }: { params: { publicKey: string } }) {
  const client = await db.client.findUnique({
    where: { publicKey: params.publicKey },
    include: { widgetSettings: true },
  });
  if (!client) return corsJson({ error: 'Widget não encontrado' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const visitorId: string | undefined = body?.visitorId;
  const name: string | undefined = body?.name;
  const phoneRaw: string | undefined = body?.phone;
  const phone = phoneRaw?.replace(/\D/g, '');

  if (!visitorId || !name || !phone || phone.length < 10) {
    return corsJson(
      { error: 'visitorId, name e phone (com DDI, só dígitos) são obrigatórios' },
      { status: 400, allowedOrigin: client.allowedOrigin },
    );
  }

  let conversation = await db.conversation.findUnique({
    where: { clientId_visitorId: { clientId: client.id, visitorId } },
  });

  if (!conversation) {
    const connection = await db.whatsappConnection.findFirst({
      where: { clientId: client.id, status: 'connected' },
      orderBy: { createdAt: 'asc' },
    });

    conversation = await db.conversation.create({
      data: {
        clientId: client.id,
        connectionId: connection?.id ?? null,
        visitorId,
        customerPhone: phone,
        customerName: name,
      },
    });

    if (connection) {
      const greeting = client.widgetSettings?.greeting ?? 'Olá! Como podemos ajudar você hoje?';
      try {
        const sent = await evolutionEngine.sendText(connection.instanceName, phone, greeting);
        await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: 'out',
            channel: 'whatsapp',
            senderType: 'system',
            body: greeting,
            whatsappMessageId: sent.id,
          },
        });
      } catch {
        // Não derruba o pré-chat se o envio falhar (instância pode ter caído
        // entre o polling de status e agora) — visitante segue no widget,
        // agente vê a conversa sem mensagem de saudação.
      }
    }
  }

  return corsJson(
    { conversationId: conversation.id, connected: !!conversation.connectionId },
    { allowedOrigin: client.allowedOrigin },
  );
}
