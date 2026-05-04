import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }

    // Validar assinatura HMAC-SHA256
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      console.error('FACEBOOK_APP_SECRET não configurado');
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500 }
      );
    }

    const hash = crypto
      .createHmac('sha256', appSecret)
      .update(body)
      .digest('hex');

    const expectedSignature = `sha256=${hash}`;

    if (signature !== expectedSignature) {
      console.warn('[Data Deletion] Assinatura inválida');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse payload
    const payload = JSON.parse(body);
    const { user_id, request_id } = payload;

    if (!user_id || !request_id) {
      return NextResponse.json(
        { error: 'Missing user_id or request_id' },
        { status: 400 }
      );
    }

    // Gerar confirmation code único
    const confirmationCode = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // TODO: Implementar lógica de exclusão real
    // - Buscar usuário pelo user_id (usuários do Facebook/Meta)
    // - Deletar dados conforme política de privacidade
    // - Registrar em auditLog
    console.log(`[Data Deletion] Processando exclusão para user_id=${user_id}, request_id=${request_id}`);

    // URL de status (usar o domínio configurado)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://zapscript.me';
    const statusUrl = `${baseUrl}/deletion-status/${confirmationCode}`;

    // Resposta obrigatória da Meta
    return NextResponse.json(
      {
        url: statusUrl,
        confirmation_code: confirmationCode,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Data Deletion] Erro ao processar callback:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
