/**
 * Middleware de segurança — ZapScript
 *
 * Adiciona cabeçalhos de proteção em todas as respostas:
 * - HSTS: força HTTPS por 1 ano
 * - X-Frame-Options: bloqueia embedding em iframes (clickjacking)
 * - X-Content-Type-Options: evita MIME sniffing
 * - Referrer-Policy: limita vazamento de URL em referrers
 *
 * A proteção de rotas do dashboard é feita pelo dashboard/layout.tsx via
 * api.get('/auth/me').catch(() => router.push('/login')).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // HSTS — força HTTPS por 1 ano (só válido em produção com HTTPS real)
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Bloqueia o site de ser carregado em iframes
  res.headers.set('X-Frame-Options', 'DENY');

  // Evita MIME type sniffing
  res.headers.set('X-Content-Type-Options', 'nosniff');

  // Controla informações de referrer enviadas ao navegar
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Impede que scrapers e IA rastejem páginas internas
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/payment')
  ) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  return res;
}

export const config = {
  // Aplica em todas as rotas exceto assets estáticos e _next
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)'],
};
