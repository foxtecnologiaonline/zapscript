import type { Metadata } from 'next';
import Link from 'next/link';
import { POSTS } from './posts';
import { allCategories } from './categories';
import NewsletterSignup from '@/components/NewsletterSignup';

export const metadata: Metadata = {
  title:       'Blog — Conversão de Áudio WhatsApp, Dicas e Produtividade',
  description: 'Guias práticos, comparativos e dicas sobre conversão de áudio do WhatsApp com IA. Economize horas por dia com automação inteligente.',
  keywords:    'blog conversão whatsapp, dicas produtividade whatsapp, ia conversão audio, como converter audio whatsapp, transcrição whatsapp blog, guia conversão áudio, comparativo ferramentas whatsapp',
  alternates:  { canonical: 'https://www.zapscript.me/blog' },
  openGraph: {
    title:       'Blog ZapScript — Conversão de Áudio WhatsApp com IA',
    description: 'Guias práticos e comparativos sobre conversão de áudio do WhatsApp com IA.',
    url:         'https://www.zapscript.me/blog',
    type:        'website',
    siteName:    'ZapScript',
    locale:      'pt_BR',
  },
};

/* ── JSON-LD Blog ─────────────────────────────────────────────────── */
function BlogJsonLd() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Blog ZapScript',
    description: 'Guias práticos, comparativos e dicas sobre conversão de áudio do WhatsApp com IA.',
    url: 'https://www.zapscript.me/blog',
    inLanguage: 'pt-BR',
    publisher: {
      '@type': 'Organization',
      name: 'ZapScript',
      url: 'https://www.zapscript.me',
    },
    blogPost: POSTS.map(post => ({
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt ?? post.publishedAt,
      url: `https://www.zapscript.me/blog/${post.slug}`,
      author: post.author
        ? { '@type': 'Person', name: post.author.name }
        : { '@type': 'Organization', name: 'ZapScript' },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  'Guias':        'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  'Produtividade':'bg-green-500/15 text-green-300 border border-green-500/20',
  'Dicas':        'bg-yellow-500/15 text-yellow-300 border border-yellow-500/20',
  'Empresas':     'bg-purple-500/15 text-purple-300 border border-purple-500/20',
  'Comparativos': 'bg-orange-500/15 text-orange-300 border border-orange-500/20',
  'Casos de uso': 'bg-pink-500/15 text-pink-300 border border-pink-500/20',
  'Nichos':       'bg-teal-500/15 text-teal-300 border border-teal-500/20',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function BlogIndex() {
  const sorted = [...POSTS].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  const [featured, ...rest] = sorted;

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <BlogJsonLd />
      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="border-b border-white/5 sticky top-0 z-50 backdrop-blur-md bg-brand-bg/80">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="text-white font-medium">Blog</Link>
            <Link href="/login" className="text-brand-muted hover:text-white transition-colors">Entrar</Link>
            <Link
              href="/cadastro"
              className="bg-brand-primary text-black font-semibold px-4 py-1.5 rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Grátis
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">

        {/* ── Hero ──────────────────────────────────────────────────── */}
        <div className="mb-12 text-center">
          <p className="text-brand-primary font-semibold text-sm tracking-widest uppercase mb-3">Blog ZapScript</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">
            Conversão de áudio, IA<br className="hidden sm:block" /> e produtividade no WhatsApp
          </h1>
          <p className="text-brand-muted text-lg max-w-xl mx-auto">
            Guias práticos e comparativos honestos para quem quer parar de perder tempo com áudios.
          </p>
        </div>

        {/* ── Navegação por categoria ─────────────────────────────── */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {allCategories().map(c => (
            <Link
              key={c.slug}
              href={`/blog/categoria/${c.slug}`}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 ${CATEGORY_COLORS[c.label] ?? 'bg-white/5 text-brand-muted border border-white/10'}`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        {/* ── Post em destaque ───────────────────────────────────── */}
        {featured && (
          <Link href={`/blog/${featured.slug}`} className="group block mb-12">
            <article className="bg-white/5 hover:bg-white/8 border border-white/10 rounded-2xl p-8 transition-all duration-200 hover:border-brand-primary/30">
              <div className="flex items-start gap-6">
                <div className="text-6xl shrink-0 leading-none">{featured.coverEmoji}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${CATEGORY_COLORS[featured.category] ?? ''}`}>
                      {featured.category}
                    </span>
                    <span className="text-brand-muted text-xs">⭐ Destaque</span>
                  </div>
                  <h2 className="text-2xl font-bold text-white group-hover:text-brand-primary transition-colors mb-3 leading-snug">
                    {featured.title}
                  </h2>
                  <p className="text-brand-muted leading-relaxed mb-4">{featured.description}</p>
                  <div className="flex items-center gap-4 text-xs text-brand-muted">
                    <time dateTime={featured.publishedAt}>{formatDate(featured.publishedAt)}</time>
                    <span>·</span>
                    <span>{featured.readingTime} min de leitura</span>
                  </div>
                </div>
              </div>
            </article>
          </Link>
        )}

        {/* ── Grade de posts ─────────────────────────────────────── */}
        <div className="grid sm:grid-cols-2 gap-6">
          {rest.map(post => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="group block">
              <article className="bg-white/5 hover:bg-white/8 border border-white/10 rounded-2xl p-6 h-full transition-all duration-200 hover:border-brand-primary/30 flex flex-col">
                <div className="text-4xl mb-4">{post.coverEmoji}</div>
                <div className="mb-3">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${CATEGORY_COLORS[post.category] ?? ''}`}>
                    {post.category}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white group-hover:text-brand-primary transition-colors mb-2 leading-snug flex-1">
                  {post.title}
                </h2>
                <p className="text-brand-muted text-sm leading-relaxed mb-4 line-clamp-3">
                  {post.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-brand-muted mt-auto">
                  <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                  <span>·</span>
                  <span>{post.readingTime} min</span>
                </div>
              </article>
            </Link>
          ))}
        </div>

        {/* ── Newsletter ──────────────────────────────────────────── */}
        <div className="mt-16 mb-8">
          <NewsletterSignup source="blog-index" />
        </div>

        {/* ── CTA ───────────────────────────────────────────────────── */}
        <div className="mt-16 text-center bg-white/5 border border-white/10 rounded-2xl p-10">
          <div className="text-5xl mb-4">⚡</div>
          <h2 className="text-2xl font-bold text-white mb-3">
            Chega de perder tempo ouvindo áudios
          </h2>
          <p className="text-brand-muted mb-6 max-w-md mx-auto">
            Conecte seu WhatsApp e receba conversões automáticas com resumo por IA. Comece grátis, sem cartão.
          </p>
          <Link
            href="/cadastro"
            className="inline-block bg-brand-primary text-black font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity"
          >
            Criar conta grátis
          </Link>
        </div>
      </main>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 mt-16 py-8 text-center text-brand-muted text-sm">
        <p>© 2026 ZapScript — <Link href="/" className="hover:text-white transition-colors">zapscript.me</Link></p>
      </footer>
    </div>
  );
}
