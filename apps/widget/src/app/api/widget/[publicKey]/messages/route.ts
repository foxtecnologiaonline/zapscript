import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return corsPreflight();
}

// Polling simples (sem WebSocket nesta primeira versão — ver README §Próximos
// passos) pro widget puxar mensagens novas, incluindo as que chegaram por
// WhatsApp de verdade (resposta do agente, ou o visitante respondendo do
// próprio app dele em vez do widget).
export async function GET(req: NextRequest, { params }: { params: { publicKey: string } }) {
  const client = await db.client.findUnique({ where: { publicKey: params.publicKey } });
  if (!client) return corsJson({ error: 'Widget não encontrado' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const visitorId = searchParams.get('visitorId');
  const since = searchParams.get('since');
  if (!visitorId) return corsJson({ error: 'visitorId é obrigatório' }, { status: 400, allowedOrigin: client.allowedOrigin });

  const conversation = await db.conversation.findUnique({
    where: { clientId_visitorId: { clientId: client.id, visitorId } },
  });
  if (!conversation) return corsJson({ messages: [] }, { allowedOrigin: client.allowedOrigin });

  const messages = await db.message.findMany({
    where: {
      conversationId: conversation.id,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  return corsJson({ messages }, { allowedOrigin: client.allowedOrigin });
}
