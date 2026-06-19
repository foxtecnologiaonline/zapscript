import type { MetadataRoute } from 'next';
import { POSTS } from './blog/posts';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.zapscript.me';

  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base,                   lastModified: now, priority: 1.0,  changeFrequency: 'weekly'  },
    { url: `${base}/cadastro`,     lastModified: now, priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/corretores`,   lastModified: now, priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/advogados`,    lastModified: now, priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/vendas`,       lastModified: now, priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/afiliados`,    lastModified: now, priority: 0.7,  changeFrequency: 'monthly' },
    { url: `${base}/vs/viratexto`, lastModified: now, priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/vs/luzia`,     lastModified: now, priority: 0.8,  changeFrequency: 'monthly' },
    { url: `${base}/login`,        lastModified: now, priority: 0.7,  changeFrequency: 'monthly' },
    { url: `${base}/blog`,         lastModified: now, priority: 0.9,  changeFrequency: 'weekly'  },
    { url: `${base}/privacidade`,  lastModified: now, priority: 0.3,  changeFrequency: 'yearly'  },
    { url: `${base}/termos`,       lastModified: now, priority: 0.3,  changeFrequency: 'yearly'  },
    { url: `${base}/status`,       lastModified: now, priority: 0.4,  changeFrequency: 'daily'   },
  ];

  const blogRoutes: MetadataRoute.Sitemap = POSTS.map(post => ({
    url:             `${base}/blog/${post.slug}`,
    lastModified:    new Date(post.updatedAt ?? post.publishedAt),
    changeFrequency: 'monthly' as const,
    priority:        0.8,
  }));

  return [...staticRoutes, ...blogRoutes];
}
