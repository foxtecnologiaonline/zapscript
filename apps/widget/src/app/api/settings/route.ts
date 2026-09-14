import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const client = await db.client.findUnique({
    where: { id: auth.clientId },
    include: { widgetSettings: true },
  });
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

  return NextResponse.json({
    publicKey: client.publicKey,
    disclaimerAcceptedAt: client.disclaimerAcceptedAt,
    settings: client.widgetSettings,
  });
}

export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { primaryColor, greeting, position } = body ?? {};

  const settings = await db.widgetSettings.upsert({
    where: { clientId: auth.clientId },
    update: {
      ...(primaryColor ? { primaryColor } : {}),
      ...(greeting ? { greeting } : {}),
      ...(position ? { position } : {}),
    },
    create: {
      clientId: auth.clientId,
      primaryColor: primaryColor ?? undefined,
      greeting: greeting ?? undefined,
      position: position ?? undefined,
    },
  });

  return NextResponse.json({ settings });
}
