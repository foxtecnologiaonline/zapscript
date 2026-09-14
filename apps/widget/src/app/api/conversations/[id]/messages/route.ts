import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const conversation = await db.conversation.findFirst({ where: { id: params.id, clientId: auth.clientId } });
  if (!conversation) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 });

  const messages = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ conversation, messages });
}
