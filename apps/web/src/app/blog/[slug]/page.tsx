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
  const schema = {
    '@context':        'https://schema.org',
    '@type':           'Article',
    headline:          post.title,
    description:       post.description,
    datePublished:     post.publishedAt,
    dateModified:      post.updatedAt ?? post.publishedAt,
    author: {
      '@type': 'Organization',
      name:    'ZapScript',
      url:     'https://www.zapscript.me',
    },
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

  const related = POSTS.filter(p => p.slug !== post.slug).slice(0, 2);

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
              <span>Publicado em <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time></span>
              {post.updatedAt && (
                <>
                  <span>·</span>
                  <span>Atualizado em <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time></span>
                </>
              )}
            </div>
          </header>

          {/* ── CTA topo ────────────────────────────────────────────── */}
          <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-xl p-4 mb-10 flex items-center justify-between gap-4">
            <p className="text-sm text-white">
              <span className="font-semibold">Cansado de ouvir áudios?</span>{' '}
              O ZapScript transcreve tudo automaticamente com resumo por IA.
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
              Conecte seu número e receba transcrições automáticas com IA. Grátis para começar.
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
