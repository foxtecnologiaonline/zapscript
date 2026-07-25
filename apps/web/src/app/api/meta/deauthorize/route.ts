import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Deauthorize Callback da Meta (Facebook Login).
 *
 * A Meta dispara um POST (application/x-www-form-urlencoded) com o campo
 * `signed_request` quando o usuário remove o app. Validamos a assinatura
 * HMAC-SHA256 com o app secret e encaminhamos para a API interna limpar o
 * vínculo. Sempre respondemos 200 (requisito da plataforma).
 *
 * Espelha o padrão de api/data-deletion-callback/route.ts.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.zapscript.me';

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function parseSignedRequest(signed: string, appSecret: string): any | null {
  const [encodedSig, payload] = signed.split('.', 2);
  if (!encodedSig || !payload) return null;

  const expectedSig = crypto.createHmac('sha256', appSecret).update(payload).digest();
  const actualSig   = base64UrlDecode(encodedSig);
  if (
    expectedSig.length !== actualSig.length ||
    !crypto.timingSafeEqual(expectedSig, actualSig)
  ) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(payload).toString('utf8'));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const appSecret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      console.error('[Meta Deauthorize] META_APP_SECRET/FACEBOOK_APP_SECRET não configurado');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const form   = await req.formData();
    const signed = form.get('signed_request');
    if (!signed || typeof signed !== 'string') {
      return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
    }

    const data = parseSignedRequest(signed, appSecret);
    if (!data) {
      console.warn('[Meta Deauthorize] signed_request inválido');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const metaUserId = data.user_id || null;

    // Encaminhar para a API interna limpar o vínculo (best-effort)
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (internalSecret) {
      try {
        await fetch(`${API_URL}/meta/deauthorize-internal`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${internalSecret}`,
          },
          body:   JSON.stringify({ metaUserId, wabaId: data.waba_id || null }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (err) {
        console.error('[Meta Deauthorize] Falha ao notificar API interna:', err);
      }
    }

    console.log(`[Meta Deauthorize] Callback processado: user_id=${metaUserId}`);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('[Meta Deauthorize] Erro ao processar callback:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
