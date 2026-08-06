import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { POSTS } from '../../posts';
import { allCategories, getCategoryBySlug, NICHE_LPS } from '../../categories';

export function generateStaticParams() {
  return allCategories().map(c => ({ slug: c.slug }));
}

export async function generateMetadata(
  { params }: { params: { slug: string } }
): Promise<Metadata> {
  const category = getCategoryBySlug(params.slug);
  if (!category) return { title: 'Categoria não encontrada' };

  const canonical = `https://www.zapscript.me/blog/categoria/${category.slug}`;
  const title = `${category.label} — Blog ZapScript`;

  return {
    title,
    description: category.description,
    alternates:  { canonical },
    openGraph: {
      title,
      description: category.description,
      url:         canonical,
      type:        'website',
      siteName:    'ZapScript',
      locale:      'pt_BR',
    },
  };
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

export default function BlogCategoryPage({ params }: { params: { slug: string } }) {
  const category = getCategoryBySlug(params.slug);
  if (!category) notFound();

  const posts = [...POSTS]
    .filter(p => p.category === category.label)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
      { '@type': 'ListItem', position: 2, name: 'Blog',   item: 'https://www.zapscript.me/blog' },
      { '@type': 'ListItem', position: 3, name: category.label, item: `https://www.zapscript.me/blog/categoria/${category.slug}` },
    ],
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <header className="border-b border-white/5 sticky top-0 z-50 backdrop-blur-md bg-brand-bg/80">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="text-brand-muted hover:text-white transition-colors">Blog</Link>
            <Link href="/cadastro" className="bg-brand-primary text-black font-semibold px-4 py-1.5 rounded-lg hover:opacity-90 transition-opacity text-sm">
              Grátis
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">

        <div className="mb-4 text-sm text-brand-muted">
          <Link href="/blog" className="hover:text-white transition-colors">Blog</Link> / {category.label}
        </div>

        <div className="mb-12">
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${CATEGORY_COLORS[category.label] ?? ''}`}>
            {category.label}
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mt-4 mb-3 leading-tight">
            {category.label}
          </h1>
          <p className="text-brand-muted text-lg max-w-xl">{category.description}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 mb-12">
          {posts.map(post => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="group block">
              <article className="bg-white/5 hover:bg-white/8 border border-white/10 rounded-2xl p-6 h-full transition-all duration-200 hover:border-brand-primary/30 flex flex-col">
                <div className="text-4xl mb-4">{post.coverEmoji}</div>
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

        {/* Silo temático — categoria "Nichos" linka de volta para as LPs por profissão */}
        {category.label === 'Nichos' && (
          <div className="mb-12 rounded-2xl p-6 border border-white/10 bg-white/3">
            <h2 className="text-lg font-bold text-white mb-4">Veja também, por profissão</h2>
            <div className="flex flex-wrap gap-2">
              {NICHE_LPS.map(lp => (
                <Link
                  key={lp.href}
                  href={lp.href}
                  className="text-sm px-3.5 py-2 rounded-full border border-white/10 bg-white/5 text-brand-muted hover:text-white hover:border-brand-primary/30 transition-colors"
                >
                  {lp.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="text-center bg-white/5 border border-white/10 rounded-2xl p-10">
          <div className="text-5xl mb-4">⚡</div>
          <h2 className="text-2xl font-bold text-white mb-3">Chega de perder tempo ouvindo áudios</h2>
          <p className="text-brand-muted mb-6 max-w-md mx-auto">
            Conecte seu WhatsApp e receba conversões automáticas com resumo por IA. Comece grátis, sem cartão.
          </p>
          <Link href="/cadastro" className="inline-block bg-brand-primary text-black font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity">
            Criar conta grátis
          </Link>
        </div>
      </main>

      <footer className="border-t border-white/5 mt-16 py-8 text-center text-brand-muted text-sm">
        <p>© {new Date().getFullYear()} ZapScript — <Link href="/" className="hover:text-white transition-colors">zapscript.me</Link></p>
      </footer>
    </div>
  );
}
