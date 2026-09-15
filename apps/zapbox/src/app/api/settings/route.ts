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

  // primaryColor e position acabam interpolados direto num atributo HTML no
  // snippet de embed mostrado pro cliente copiar (ver widget-settings/page.tsx)
  // — um valor fora do formato esperado quebraria esse HTML ao ser colado no
  // site do cliente, então valida em vez de aceitar qualquer string.
  if (primaryColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    return NextResponse.json({ error: 'primaryColor deve ser um hex válido, ex: #25D366' }, { status: 400 });
  }
  if (position !== undefined && position !== 'left' && position !== 'right') {
    return NextResponse.json({ error: 'position deve ser "left" ou "right"' }, { status: 400 });
  }
  if (greeting !== undefined && (typeof greeting !== 'string' || greeting.length > 500)) {
    return NextResponse.json({ error: 'greeting deve ter até 500 caracteres' }, { status: 400 });
  }

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
