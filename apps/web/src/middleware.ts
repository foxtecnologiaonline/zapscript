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

  // Expor o pathname para componentes server-side (BreadcrumbList JSON-LD)
  res.headers.set('x-pathname', req.nextUrl.pathname);

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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co';
  const isDev = process.env.NODE_ENV !== 'production';

  // Hosts de analytics/ads que o app realmente chama (gtag.js e Meta Pixel
  // mandam os beacons de conversão pra cá). Listados explicitamente pra que o
  // connect-src estrito do Report-Only abaixo não acuse falso positivo.
  const analyticsHosts = [
    'https://www.googletagmanager.com',
    'https://www.googleadservices.com',
    'https://googleads.g.doubleclick.net',
    'https://www.google.com',
    'https://www.google-analytics.com',
    'https://connect.facebook.net',
    'https://www.facebook.com',
  ].join(' ');

  // 'unsafe-eval' SÓ em dev: é exigência do refresh/HMR do Next, não do bundle
  // de produção. Em produção ele apenas reabria a porta que o resto do CSP
  // fecha. Confirmado seguro aqui porque a stack de analytics é gtag.js puro
  // (components/Analytics.tsx) — quem costuma exigir eval é container GTM com
  // template de HTML customizado, que este projeto não usa.
  //
  // 'unsafe-inline' FICA, e não é descuido: há scripts inline que precisam
  // rodar antes da pintura — o themeInitScript anti-FOUC e os JSON-LD em
  // app/layout.tsx, mais o gtag-init. Trocar por nonce é o passo seguinte e
  // exige validar a conversão do Google Ads num browser real; enquanto isso
  // não é feito, sair de unsafe-inline quebraria tracking de receita.
  const scriptSrc = [
    `'self'`,
    `'unsafe-inline'`,
    ...(isDev ? [`'unsafe-eval'`] : []),
    analyticsHosts,
  ].join(' ');

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, // estilos inline + Google Fonts
    `img-src 'self' data: blob: https:`,                            // QR codes (data:), imagens externas
    `connect-src 'self' ${apiUrl} ${supabaseUrl} ${analyticsHosts} wss: https:`,
    `font-src 'self' data: https://fonts.gstatic.com`,             // fontes locais + Google Fonts CDN
    `frame-ancestors 'none'`,                                    // equiv. X-Frame-Options: DENY
    `object-src 'none'`,          // <object>/<embed>: vetor clássico de XSS, e o app não usa nenhum
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  res.headers.set('Content-Security-Policy', csp.join('; '));

  // Versão estrita em modo SÓ RELATÓRIO, sem os curingas `wss:`/`https:` do
  // connect-src — hoje eles permitem exfiltrar pra qualquer host HTTPS, que é
  // justamente o que um XSS bem-sucedido faria. Não dá pra apertar às cegas:
  // um host legítimo esquecido quebraria o dashboard em produção. Em
  // Report-Only o navegador reporta a violação sem bloquear nada, então é só
  // olhar o console/relatórios por alguns dias e, se vier limpo, promover
  // este connect-src pro header acima.
  if (!isDev) {
    res.headers.set(
      'Content-Security-Policy-Report-Only',
      csp
        .map(d => d.startsWith('connect-src')
          ? `connect-src 'self' ${apiUrl} ${supabaseUrl} ${analyticsHosts} wss://${new URL(apiUrl).host}`
          : d)
        .join('; ')
    );
  }

  // Impede que scrapers e IA rastejem páginas internas
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/app') ||
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
