'use client';

import Link from 'next/link';
import { POSTS } from '../posts';
import INTERLINK_MAP from '../interlinks';

/**
 * Client component que renderiza o HTML do post substituindo tags [[slug]]
 * por links inline para posts relacionados.
 *
 * Uso no HTML do post:
 *   <p>Veja também nosso guia sobre [[como-transcrever-audio-whatsapp]].</p>
 *
 * O componente busca o título do post referenciado e renderiza um <Link>.
 * Se o slug não existir na base, renderiza o texto como está.
 */
export default function PostContent({ html, currentSlug }: { html: string; currentSlug: string }) {
  // Coleta os slugs de interlinks para este post
  const linkedSlugs = INTERLINK_MAP[currentSlug] ?? [];

  // Se não há interlinks, renderiza o HTML puro
  if (linkedSlugs.length === 0) {
    return <div className="prose-blog" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Substitui [[slug]] por links inline
  let result = html;
  for (const slug of linkedSlugs) {
    const post = POSTS.find(p => p.slug === slug);
    if (!post) continue;
    const pattern = new RegExp(`\\[\\[${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g');
    const replacement = `<a href="/blog/${slug}" class="zs-inline-link" style="color:rgb(var(--color-primary));text-decoration:underline;text-underline-offset:2px;font-weight:500;">${post.title}</a>`;
    result = result.replace(pattern, replacement);
  }

  return <div className="prose-blog" dangerouslySetInnerHTML={{ __html: result }} />;
}
