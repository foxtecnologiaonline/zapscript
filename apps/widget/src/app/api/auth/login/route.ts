import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, signToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { email, password } = body ?? {};
  if (!email || !password) {
    return NextResponse.json({ error: 'email e password são obrigatórios' }, { status: 400 });
  }

  const agent = await db.agent.findFirst({ where: { email }, include: { client: true } });
  if (!agent || !(await verifyPassword(password, agent.passwordHash))) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  const token = signToken({ agentId: agent.id, clientId: agent.clientId, role: agent.role });

  return NextResponse.json({
    token,
    client: {
      id: agent.client.id,
      name: agent.client.name,
      publicKey: agent.client.publicKey,
      disclaimerAcceptedAt: agent.client.disclaimerAcceptedAt,
    },
  });
}
