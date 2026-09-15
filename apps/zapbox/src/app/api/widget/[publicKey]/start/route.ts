import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';
import { getMessagingEngine } from '@/lib/messaging/engine';

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

  if (!visitorId || !name || !phone || phone.length < 10 || phone.length > 20 || name.length > 200) {
    return corsJson(
      { error: 'visitorId, name e phone (com DDI, só dígitos) são obrigatórios' },
      { status: 400, allowedOrigin: client.allowedOrigin },
    );
  }

  let conversation = await db.conversation.findUnique({
    where: { clientId_visitorId: { clientId: client.id, visitorId } },
  });

  let justCreated = false;
  if (!conversation) {
    // Se o cliente final já mandou mensagem direto pro WhatsApp antes de
    // usar o widget, o webhook já criou uma Conversation com
    // visitorId="wa-<telefone>" (ver route do webhook). "wa-*" só é gerado
    // por nós — nenhuma sessão de widget legítima usa esse id — então é
    // seguro adotar essa linha em vez de criar uma segunda thread do zero e
    // perder o histórico que já existe.
    const waVisitorId = `wa-${phone}`;
    const existingByPhone = visitorId !== waVisitorId
      ? await db.conversation.findUnique({
          where: { clientId_visitorId: { clientId: client.id, visitorId: waVisitorId } },
        })
      : null;

    if (existingByPhone) {
      conversation = await db.conversation.update({
        where: { id: existingByPhone.id },
        data: { visitorId, customerName: name, status: 'open' },
      });
    }

    if (conversation) {
      return corsJson(
        { conversationId: conversation.id, connected: !!conversation.connectionId },
        { allowedOrigin: client.allowedOrigin },
      );
    }

    const connection = await db.whatsappConnection.findFirst({
      where: { clientId: client.id, status: 'connected' },
      orderBy: { createdAt: 'asc' },
    });

    try {
      conversation = await db.conversation.create({
        data: {
          clientId: client.id,
          connectionId: connection?.id ?? null,
          visitorId,
          customerPhone: phone,
          customerName: name,
        },
      });
      justCreated = true;
    } catch (err: any) {
      // Corrida rara (duplo-clique/duas abas): outra requisição já criou a
      // conversa entre o findUnique acima e este create — reaproveita a dela
      // em vez de estourar erro pro visitante.
      if (err?.code === 'P2002') {
        conversation = await db.conversation.findUnique({
          where: { clientId_visitorId: { clientId: client.id, visitorId } },
        });
      }
      if (!conversation) throw err;
    }

    if (justCreated && connection) {
      const greeting = client.widgetSettings?.greeting ?? 'Olá! Como podemos ajudar você hoje?';
      try {
        const engine = getMessagingEngine(connection.provider as 'evolution' | 'meta');
        const sent = await engine.sendText(connection.instanceName, phone, greeting);
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
