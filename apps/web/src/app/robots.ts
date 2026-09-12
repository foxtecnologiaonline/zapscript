import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/admin/', '/api/', '/login', '/register', '/payment/'],
      },
      // ── Bots de IA que geram citação (liberados de propósito) ──
      {
        userAgent: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Applebot-Extended'],
        allow: '/',
        disallow: ['/dashboard/', '/admin/', '/api/', '/login', '/register', '/payment/'],
      },
      // ── Revendedores de dados / scrapers (bloqueados) ──
      {
        userAgent: ['Bytespider', 'DataForSeoBot', 'Diffbot', 'ImagesiftBot', 'magpie-crawler', 'Meltwater', 'peer39_crawler', 'Omgilibot', 'YouBot'],
        disallow: '/',
      },
    ],
    sitemap: 'https://www.zapscript.me/sitemap.xml',
  };
}
