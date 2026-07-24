import { headers } from 'next/headers';

/**
 * Mapa de paths para nomes amigáveis usados no BreadcrumbList JSON-LD.
 * Adicione novas rotas aqui para que o breadcrumb apareça automaticamente.
 */
const PATH_MAP: Record<string, string> = {
  '/blog':                     'Blog',
  '/cadastro':                 'Criar Conta',
  '/login':                    'Entrar',
  '/atende':                   'Atendimento IA',
  '/vendas':                   'Vendas',
  '/campanhas':                'Campanhas WhatsApp',
  '/cobranca':                 'Cobrança Automática',
  '/crm':                      'CRM WhatsApp',
  '/corretores':               'Corretores de Imóveis',
  '/advogados':                'Advogados',
  '/dentistas':                'Dentistas e Clínicas',
  '/afiliados':                'Programa de Afiliados',
  '/indique':                  'Indique e Ganhe',
  '/legendas':                 'Legendas',
  '/sobre':                    'Sobre',
  '/privacidade':              'Política de Privacidade',
  '/termos':                   'Termos de Uso',
  '/status':                   'Status',
  '/contrato':                 'Contrato',
  '/transcrever-audio-gratis': 'Transcrever Áudio Grátis',
  '/vs/viratexto':             'ZapScript vs ViraTexto',
  '/vs/luzia':                 'ZapScript vs LuzIA',
  '/vs/otter':                 'ZapScript vs Otter',
  '/vs/notta':                 'ZapScript vs Notta',
  '/vs/transkriptor':          'ZapScript vs Transkriptor',
  '/para/contabilidade':       'ZapScript para Contabilidade',
};

function buildBreadcrumb(pathname: string): { name: string; url: string }[] {
  const items: { name: string; url: string }[] = [
    { name: 'Início', url: 'https://www.zapscript.me' },
  ];

  if (!pathname || pathname === '/') return items;

  const segments = pathname.replace(/\/$/, '').split('/').filter(Boolean);

  let accumulated = '';
  for (const seg of segments) {
    accumulated += '/' + seg;
    const label = PATH_MAP[accumulated] ?? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
    items.push({ name: label, url: `https://www.zapscript.me${accumulated}` });
  }

  return items;
}

/**
 * Server component — injeta BreadcrumbList JSON-LD no <head>.
 * O Google processa este JSON-LD do HTML inicial (SSR), ao contrário
 * de uma abordagem client-side que fica invisível para crawlers.
 *
 * Apenas rotas públicas conhecidas são renderizadas; páginas internas
 * (/dashboard, /app, etc.) são ignoradas.
 */
export default function BreadcrumbServer() {
  let pathname = '/';
  try {
    const h = headers();
    const p = h.get('x-pathname');
    if (p) pathname = p;
  } catch {
    // headers() throws em alguns contextos; usa fallback vazio
    return null;
  }

  const items = buildBreadcrumb(pathname);
  if (items.length <= 1) return null;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
