import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { evolutionEngine } from '@/lib/messaging/evolution-engine';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const connection = await db.whatsappConnection.findFirst({
    where: { id: params.id, clientId: auth.clientId },
  });
  if (!connection) return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 });

  await evolutionEngine.disconnect(connection.instanceName);

  const updated = await db.whatsappConnection.update({
    where: { id: connection.id },
    data: { status: 'disconnected', phoneNumber: null, connectedAt: null },
  });

  return NextResponse.json({ connection: updated });
}
