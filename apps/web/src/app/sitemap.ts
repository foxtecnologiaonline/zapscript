import type { MetadataRoute } from 'next';
import { POSTS } from './blog/posts';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.zapscript.me';

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base,                priority: 1.0,  changeFrequency: 'weekly'  },
    { url: `${base}/cadastro`,  priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/corretores`,priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/advogados`, priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/vendas`,    priority: 0.9,  changeFrequency: 'monthly' },
    { url: `${base}/login`,     priority: 0.7,  changeFrequency: 'monthly' },
    { url: `${base}/blog`,      priority: 0.9,  changeFrequency: 'weekly'  },
    { url: `${base}/privacidade`, priority: 0.3, changeFrequency: 'yearly' },
    { url: `${base}/termos`,    priority: 0.3,  changeFrequency: 'yearly'  },
    { url: `${base}/status`,    priority: 0.4,  changeFrequency: 'daily'   },
  ];

  const blogRoutes: MetadataRoute.Sitemap = POSTS.map(post => ({
    url:             `${base}/blog/${post.slug}`,
    lastModified:    new Date(post.updatedAt ?? post.publishedAt),
    changeFrequency: 'monthly' as const,
    priority:        0.8,
  }));

  return [...staticRoutes, ...blogRoutes];
}
