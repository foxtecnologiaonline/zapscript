import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// Registra o aceite do aviso obrigatório (escopo §2, Fase 1): o motor de
// envio é Evolution/Baileys, não-oficial — risco de bloqueio de número pela
// Meta. Sem isso, POST /api/connections recusa criar uma nova conexão.
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const client = await db.client.update({
    where: { id: auth.clientId },
    data: { disclaimerAcceptedAt: new Date() },
  });

  return NextResponse.json({ disclaimerAcceptedAt: client.disclaimerAcceptedAt });
}
