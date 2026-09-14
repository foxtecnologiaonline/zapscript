import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';

// Cria um Client novo (site/empresa) + seu primeiro Agent (owner) — cadastro
// self-service, sem CNPJ nem aprovação Meta (escopo §4.2 — onboarding simplificado).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { name, email, password } = body ?? {};

  if (!name || !email || !password || String(password).length < 8) {
    return NextResponse.json(
      { error: 'name, email e password (mín. 8 caracteres) são obrigatórios' },
      { status: 400 },
    );
  }

  const existing = await db.client.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const client = await db.client.create({
    data: {
      name,
      email,
      passwordHash,
      widgetSettings: { create: {} },
      agents: { create: { email, passwordHash, role: 'owner' } },
    },
    include: { agents: true },
  });

  const owner = client.agents[0];
  const token = signToken({ agentId: owner.id, clientId: client.id, role: owner.role });

  return NextResponse.json({
    token,
    client: { id: client.id, name: client.name, publicKey: client.publicKey },
  });
}
