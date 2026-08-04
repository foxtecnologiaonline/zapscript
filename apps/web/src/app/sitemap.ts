import type { MetadataRoute } from 'next';
import { POSTS } from './blog/posts';
import { allCategories } from './blog/categories';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.zapscript.me';

  const now = new Date();
  // Datas reais da última alteração de conteúdo de cada página (atualizar ao editar a página).
  const d = (iso: string) => new Date(iso);
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base,                   lastModified: d('2026-06-15'), priority: 1.0,  changeFrequency: 'weekly'  },
    { url: `${base}/cadastro`,     lastModified: d('2026-06-10'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/atende`,       lastModified: d('2026-07-14'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/corretores`,   lastModified: d('2026-06-15'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/advogados`,    lastModified: d('2026-06-15'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/vendas`,       lastModified: d('2026-06-15'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/dentistas`,    lastModified: d('2026-06-27'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/campanhas`,    lastModified: d('2026-07-15'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/para/contabilidade`, lastModified: d('2026-06-23'), priority: 0.9, changeFrequency: 'monthly' },
    { url: `${base}/cobranca`,     lastModified: d('2026-07-16'), priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/crm`,          lastModified: now,             priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/afiliados`,    lastModified: now,             priority: 0.7,  changeFrequency: 'monthly' },
    { url: `${base}/regulamento-afiliados`, lastModified: now,    priority: 0.3,  changeFrequency: 'monthly' },
    { url: `${base}/vs/viratexto`, lastModified: d('2026-05-20'), priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/vs/luzia`,     lastModified: d('2026-05-20'), priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/vs/otter`,     lastModified: d('2026-06-25'), priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/vs/notta`,     lastModified: d('2026-06-25'), priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/vs/transkriptor`, lastModified: d('2026-06-27'), priority: 0.8, changeFrequency: 'monthly' },
    { url: `${base}/vs/zapia`,     lastModified: now,             priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/login`,        lastModified: d('2026-05-01'), priority: 0.7,  changeFrequency: 'monthly' },
    { url: `${base}/blog`,         lastModified: now,             priority: 0.9,  changeFrequency: 'weekly'  },
    { url: `${base}/privacidade`,  lastModified: d('2026-05-01'), priority: 0.3,  changeFrequency: 'yearly'  },
    { url: `${base}/termos`,       lastModified: d('2026-05-01'), priority: 0.3,  changeFrequency: 'yearly'  },
    { url: `${base}/status`,       lastModified: now,             priority: 0.4,  changeFrequency: 'daily'   },
  ];

  const blogRoutes: MetadataRoute.Sitemap = POSTS.map(post => ({
    url:             `${base}/blog/${post.slug}`,
    lastModified:    new Date(post.updatedAt ?? post.publishedAt),
    changeFrequency: 'monthly' as const,
    priority:        0.8,
  }));

  const categoryRoutes: MetadataRoute.Sitemap = allCategories().map(c => ({
    url:             `${base}/blog/categoria/${c.slug}`,
    lastModified:    now,
    changeFrequency: 'weekly' as const,
    priority:        0.6,
  }));

  return [...staticRoutes, ...blogRoutes, ...categoryRoutes];
}
