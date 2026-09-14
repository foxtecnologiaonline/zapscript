import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return corsPreflight();
}

// Visitante digitou no widget. Fica visível pro agente no Inbox — a resposta
// do agente é que sai de fato por WhatsApp (ver /api/conversations/:id/reply).
export async function POST(req: NextRequest, { params }: { params: { publicKey: string } }) {
  const client = await db.client.findUnique({ where: { publicKey: params.publicKey } });
  if (!client) return corsJson({ error: 'Widget não encontrado' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const visitorId: string | undefined = body?.visitorId;
  const text: string | undefined = body?.text;

  if (!visitorId || !text?.trim()) {
    return corsJson({ error: 'visitorId e text são obrigatórios' }, { status: 400, allowedOrigin: client.allowedOrigin });
  }

  const conversation = await db.conversation.findUnique({
    where: { clientId_visitorId: { clientId: client.id, visitorId } },
  });
  if (!conversation) {
    return corsJson({ error: 'Conversa não iniciada — chame /start primeiro' }, { status: 404, allowedOrigin: client.allowedOrigin });
  }

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'in',
      channel: 'widget',
      senderType: 'visitor',
      body: text.trim(),
    },
  });
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), status: 'open' } });

  return corsJson({ messageId: message.id }, { allowedOrigin: client.allowedOrigin });
}
