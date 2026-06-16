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

  // Permissions-Policy — desabilita APIs sensíveis não usadas pelo app
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Content-Security-Policy (M2) — bloqueia XSS e injeção de recursos externos
  // 'unsafe-inline' necessário para estilos inline usados pelo Next.js e componentes de UI
  // supabase.co e zapscript.me são os domínios externos legítimos
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co';
  res.headers.set(
    'Content-Security-Policy',
    [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://connect.facebook.net`, // Next.js requer unsafe-eval em dev; inline p/ hydration; GA4 + Google Ads (conversão/remarketing) + Meta Pixel
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, // estilos inline + Google Fonts
      `img-src 'self' data: blob: https:`,                            // QR codes (data:), imagens externas
      `connect-src 'self' ${apiUrl} ${supabaseUrl} wss: https:`,     // API, Supabase, WebSocket
      `font-src 'self' data: https://fonts.gstatic.com`,             // fontes locais + Google Fonts CDN
      `frame-ancestors 'none'`,                                    // equiv. X-Frame-Options: DENY
      `base-uri 'self'`,
      `form-action 'self'`,
    ].join('; ')
  );

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
