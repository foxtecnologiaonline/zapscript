import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPost, getAllSlugs, POSTS, type BlogPost } from '../posts';

/* ── Static generation ──────────────────────────────────────────────── */
export function generateStaticParams() {
  return getAllSlugs().map(slug => ({ slug }));
}

/* ── Dynamic metadata ───────────────────────────────────────────────── */
export async function generateMetadata(
  { params }: { params: { slug: string } }
): Promise<Metadata> {
  const post = getPost(params.slug);
  if (!post) return { title: 'Post não encontrado' };

  const canonical = `https://www.zapscript.me/blog/${post.slug}`;

  return {
    title:       post.title,
    description: post.description,
    keywords:    post.keywords.join(', '),
    alternates:  { canonical },
    authors:     [{ name: 'ZapScript', url: 'https://www.zapscript.me' }],
    openGraph: {
      title:           post.title,
      description:     post.description,
      url:             canonical,
      type:            'article',
      publishedTime:   post.publishedAt,
      modifiedTime:    post.updatedAt ?? post.publishedAt,
      siteName:        'ZapScript',
      locale:          'pt_BR',
    },
    twitter: {
      card:        'summary_large_image',
      title:       post.title,
      description: post.description,
    },
  };
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const CATEGORY_COLORS: Record<string, string> = {
  'Guias':        'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  'Produtividade':'bg-green-500/15 text-green-300 border border-green-500/20',
  'Dicas':        'bg-yellow-500/15 text-yellow-300 border border-yellow-500/20',
  'Empresas':     'bg-purple-500/15 text-purple-300 border border-purple-500/20',
  'Comparativos': 'bg-orange-500/15 text-orange-300 border border-orange-500/20',
};

/* ── JSON-LD Article Schema ─────────────────────────────────────────── */
function ArticleJsonLd({ post }: { post: BlogPost }) {
  const authorObj = post.author
    ? { '@type': 'Person', name: post.author.name, ...(post.author.linkedin ? { sameAs: post.author.linkedin } : {}) }
    : { '@type': 'Organization', name: 'ZapScript', url: 'https://www.zapscript.me' };

  const schema = {
    '@context':        'https://schema.org',
    '@type':           'Article',
    headline:          post.title,
    description:       post.description,
    datePublished:     post.publishedAt,
    dateModified:      post.updatedAt ?? post.publishedAt,
    author:            authorObj,
    publisher: {
      '@type': 'Organization',
      name:    'ZapScript',
      url:     'https://www.zapscript.me',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id':   `https://www.zapscript.me/blog/${post.slug}`,
    },
    keywords:          post.keywords.join(', '),
    inLanguage:        'pt-BR',
    url:               `https://www.zapscript.me/blog/${post.slug}`,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

/* ── Breadcrumb JSON-LD ─────────────────────────────────────────────── */
function BreadcrumbJsonLd({ post }: { post: BlogPost }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início',  item: 'https://www.zapscript.me' },
      { '@type': 'ListItem', position: 2, name: 'Blog',    item: 'https://www.zapscript.me/blog' },
      { '@type': 'ListItem', position: 3, name: post.title, item: `https://www.zapscript.me/blog/${post.slug}` },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */
export default function BlogPost({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  // Prioriza posts da mesma categoria (cluster) para fortalecer o silo de internal linking
  const others       = POSTS.filter(p => p.slug !== post.slug);
  const sameCategory = others.filter(p => p.category === post.category);
  const rest          = others.filter(p => p.category !== post.category);
  const related        = [...sameCategory, ...rest].slice(0, 2);

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <ArticleJsonLd post={post} />
      <BreadcrumbJsonLd post={post} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="border-b border-white/5 sticky top-0 z-50 backdrop-blur-md bg-brand-bg/80">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="text-brand-muted hover:text-white transition-colors">← Blog</Link>
            <Link
              href="/cadastro"
              className="bg-brand-primary text-black font-semibold px-4 py-1.5 rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Grátis
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">

        {/* ── Breadcrumb ──────────────────────────────────────────── */}
        <nav className="text-sm text-brand-muted mb-8" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-white transition-colors">Início</Link></li>
            <li className="opacity-40">/</li>
            <li><Link href="/blog" className="hover:text-white transition-colors">Blog</Link></li>
            <li className="opacity-40">/</li>
            <li className="text-white truncate max-w-[200px]">{post.category}</li>
          </ol>
        </nav>

        {/* ── Header do post ──────────────────────────────────────── */}
        <article>
          <header className="mb-10">
            <div className="text-6xl mb-6">{post.coverEmoji}</div>
            <div className="flex items-center gap-3 mb-4">
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${CATEGORY_COLORS[post.category] ?? ''}`}>
                {post.category}
              </span>
              <span className="text-brand-muted text-xs">·</span>
              <span className="text-brand-muted text-xs">{post.readingTime} min de leitura</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
              {post.title}
            </h1>
            <p className="text-brand-muted text-lg leading-relaxed mb-6">
              {post.description}
            </p>
            <div className="flex items-center gap-3 text-sm text-brand-muted border-t border-white/5 pt-4">
              {/* Autor (se definido) */}
              {post.author && (
                <>
                  <span>Por{' '}
                    {post.author.linkedin ? (
                      <a href={post.author.linkedin} target="_blank" rel="noopener" className="text-brand-primary hover:underline font-medium">
                        {post.author.name}
                      </a>
                    ) : (
                      <span className="font-medium text-white">{post.author.name}</span>
                    )}
                    {' '}· {post.author.role}
                  </span>
                  <span>·</span>
                </>
              )}
              <span>Publicado em <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time></span>
              {post.updatedAt && (
                <>
                  <span>·</span>
                  <span>Atualizado em <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time></span>
                </>
              )}
              <span className="ml-auto flex items-center gap-3">
                <a
                  href={`https://www.linkedin.com/sharing/share-offsite/?url=https://www.zapscript.me/blog/${post.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs text-brand-muted hover:text-brand-primary transition-colors"
                  title="Compartilhar no LinkedIn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                  Compartilhar
                </a>
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(post.title + ' — https://www.zapscript.me/blog/' + post.slug)}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs text-brand-muted hover:text-green-400 transition-colors"
                  title="Compartilhar no WhatsApp"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>
              </span>
            </div>
          </header>

          {/* ── CTA topo ────────────────────────────────────────────── */}
          <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-xl p-4 mb-10 flex items-center justify-between gap-4">
            <p className="text-sm text-white">
              <span className="font-semibold">Cansado de ouvir áudios?</span>{' '}
              O ZapScript converte tudo automaticamente com resumo por IA.
            </p>
            <Link
              href="/cadastro"
              className="shrink-0 bg-brand-primary text-black font-bold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Grátis →
            </Link>
          </div>

          {/* ── Conteúdo do post ─────────────────────────────────────── */}
          <div
            className="prose-blog"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />

          {/* ── CTA rodapé ──────────────────────────────────────────── */}
          <div className="mt-12 bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">⚡</div>
            <h2 className="text-xl font-bold text-white mb-2">
              Pronto para parar de ouvir áudios?
            </h2>
            <p className="text-brand-muted text-sm mb-5">
              Conecte seu número e receba conversões automáticas com IA. Grátis para começar.
            </p>
            <Link
              href="/cadastro"
              className="inline-block bg-brand-primary text-black font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity"
            >
              Criar conta grátis — sem cartão
            </Link>
          </div>
        </article>

        {/* ── Posts relacionados ───────────────────────────────────── */}
        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="text-lg font-bold text-white mb-6">Leia também</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {related.map(r => (
                <Link key={r.slug} href={`/blog/${r.slug}`} className="group block">
                  <article className="bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl p-5 h-full transition-all hover:border-brand-primary/30">
                    <div className="text-3xl mb-3">{r.coverEmoji}</div>
                    <h3 className="font-semibold text-white group-hover:text-brand-primary transition-colors text-sm leading-snug mb-2">
                      {r.title}
                    </h3>
                    <p className="text-xs text-brand-muted line-clamp-2">{r.description}</p>
                  </article>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 mt-16 py-8 text-center text-brand-muted text-sm">
        <p>© 2026 ZapScript — <Link href="/" className="hover:text-white transition-colors">zapscript.me</Link></p>
      </footer>
    </div>
  );
}
