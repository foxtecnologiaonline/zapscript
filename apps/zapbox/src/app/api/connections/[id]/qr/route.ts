import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { evolutionEngine } from '@/lib/messaging/evolution-engine';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const connection = await db.whatsappConnection.findFirst({
    where: { id: params.id, clientId: auth.clientId },
  });
  if (!connection) return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 });

  if (connection.status === 'connected') {
    return NextResponse.json({ qrCode: null, status: 'connected' });
  }

  const qr = await evolutionEngine.getQrCode(connection.instanceName);
  return NextResponse.json({ ...qr, status: connection.status });
}
