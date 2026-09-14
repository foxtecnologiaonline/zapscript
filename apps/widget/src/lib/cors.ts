import { NextResponse } from 'next/server';

// Endpoints /api/widget/* são chamados a partir do domínio do CLIENTE (site
// de terceiro que embutiu o widget.js), não do próprio domínio do ZapWidget
// — por isso precisam de CORS aberto. `allowedOrigin` no Client permite
// restringir por domínio quando o cliente quiser travar (opcional, MVP libera geral).
export function corsHeaders(allowedOrigin?: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function corsJson(data: unknown, init?: ResponseInit & { allowedOrigin?: string | null }) {
  const { allowedOrigin, ...rest } = init ?? {};
  return NextResponse.json(data, {
    ...rest,
    headers: { ...corsHeaders(allowedOrigin), ...(rest.headers as Record<string, string> | undefined) },
  });
}

export function corsPreflight(allowedOrigin?: string | null) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowedOrigin) });
}
