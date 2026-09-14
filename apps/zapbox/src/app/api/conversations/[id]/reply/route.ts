import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { evolutionEngine } from '@/lib/messaging/evolution-engine';

// Resposta do agente — sai de fato por WhatsApp pro telefone do cliente
// final; o widget aberto (se ainda estiver) recebe no próximo poll de
// /api/widget/:publicKey/messages, já que é a mesma linha de Conversation.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const conversation = await db.conversation.findFirst({
    where: { id: params.id, clientId: auth.clientId },
    include: { connection: true },
  });
  if (!conversation) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 });
  if (!conversation.connection || !conversation.customerPhone) {
    return NextResponse.json({ error: 'Conversa sem número de WhatsApp conectado' }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const text: string | undefined = body?.text;
  if (!text?.trim()) return NextResponse.json({ error: 'text é obrigatório' }, { status: 400 });

  let sent: { id: string | null };
  try {
    sent = await evolutionEngine.sendText(conversation.connection.instanceName, conversation.customerPhone, text.trim());
  } catch (err: any) {
    return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${err.message}` }, { status: 502 });
  }

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'out',
      channel: 'whatsapp',
      senderType: 'agent',
      body: text.trim(),
      whatsappMessageId: sent.id,
    },
  });
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  return NextResponse.json({ message });
}
