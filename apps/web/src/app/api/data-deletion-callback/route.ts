import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.zapscript.me';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    // Validar assinatura HMAC-SHA256 da Meta
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      console.error('[Data Deletion] FACEBOOK_APP_SECRET não configurado');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const hash = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(`sha256=${hash}`))) {
      console.warn('[Data Deletion] Assinatura inválida');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse payload
    const payload = JSON.parse(body);
    const { user_id, request_id } = payload;

    if (!user_id || !request_id) {
      return NextResponse.json({ error: 'Missing user_id or request_id' }, { status: 400 });
    }

    // Gerar confirmation code único
    const confirmationCode = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

    // Registrar no banco via API interna
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (internalSecret) {
      try {
        await fetch(`${API_URL}/privacy/meta-deletion`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${internalSecret}`,
          },
          body: JSON.stringify({ user_id, request_id, confirmation_code: confirmationCode }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (err) {
        console.error('[Data Deletion] Falha ao registrar no banco:', err);
        // Não bloquear a resposta à Meta — continuar com o código gerado
      }
    } else {
      console.warn('[Data Deletion] INTERNAL_API_SECRET não configurado — request não persistida no banco.');
    }

    console.log(`[Data Deletion] Callback Meta processado: user_id=${user_id}, code=${confirmationCode}`);

    // Resposta obrigatória da Meta
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://zapscript.me';
    return NextResponse.json(
      {
        url:               `${baseUrl}/deletion-status/${confirmationCode}`,
        confirmation_code: confirmationCode,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Data Deletion] Erro ao processar callback:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
