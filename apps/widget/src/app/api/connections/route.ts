import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { evolutionEngine, widgetInstanceName } from '@/lib/messaging/evolution-engine';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const connections = await db.whatsappConnection.findMany({
    where: { clientId: auth.clientId },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ connections });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const client = await db.client.findUnique({ where: { id: auth.clientId } });
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

  // Aviso obrigatório (escopo §2, Fase 1): não deixa conectar número sem o
  // cliente ter confirmado que leu o risco de bloqueio pela Meta.
  if (!client.disclaimerAcceptedAt) {
    return NextResponse.json(
      { error: 'disclaimer_required', message: 'É preciso confirmar o aviso de risco antes de conectar um número.' },
      { status: 412 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : 'Principal';

  const connectionId = crypto.randomUUID();
  const instanceName = widgetInstanceName(connectionId);

  const publicUrl = process.env.WIDGET_PUBLIC_URL;
  if (!publicUrl) {
    return NextResponse.json({ error: 'WIDGET_PUBLIC_URL não configurado no servidor' }, { status: 500 });
  }
  const webhookUrl = `${publicUrl.replace(/\/$/, '')}/api/webhook/evolution/${connectionId}`;

  try {
    await evolutionEngine.createConnection(instanceName, webhookUrl);
  } catch (err: any) {
    return NextResponse.json({ error: `Falha ao provisionar Evolution: ${err.message}` }, { status: 502 });
  }

  const connection = await db.whatsappConnection.create({
    data: {
      id: connectionId,
      clientId: auth.clientId,
      label,
      instanceName,
      status: 'connecting',
    },
  });

  return NextResponse.json({ connection });
}
