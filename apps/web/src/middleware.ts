/**
 * Middleware simplificado — sem Supabase session.
 *
 * Proteção do dashboard é feita pelo dashboard/layout.tsx via
 * api.get('/auth/me').catch(() => router.push('/login')).
 * O JWT fica em localStorage e é enviado nos headers de cada request.
 *
 * Manter o matcher vazio evita o conflito entre Supabase session
 * (inexistente no fluxo atual) e o JWT do backend Fastify.
 */
import { NextResponse } from 'next/server';

export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [], // dashboard/layout.tsx já faz a proteção
};
