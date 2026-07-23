import type { Metadata } from 'next';
import { POSTS } from '@/app/blog/posts';
import BuscarClient from './BuscarClient';

export const metadata: Metadata = {
  title:       'Buscar — Encontre guias e dicas sobre conversão de áudio WhatsApp',
  description: 'Busque por artigos, comparativos e guias sobre conversão de áudio do WhatsApp com IA no blog do ZapScript.',
  alternates:  { canonical: 'https://www.zapscript.me/buscar' },
  robots:      { index: true, follow: true },
  openGraph: {
    title:       'Buscar no Blog ZapScript — Conversão de Áudio WhatsApp',
    description: 'Encontre guias práticos e comparativos sobre conversão de áudio do WhatsApp com IA.',
    url:         'https://www.zapscript.me/buscar',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

/** FlatMap de termos buscáveis para cada post (título + descrição + keywords). */
const POST_INDEX = POSTS.map(p => ({
  slug:        p.slug,
  title:       p.title,
  description: p.description,
  category:    p.category,
  coverEmoji:  p.coverEmoji,
  readingTime: p.readingTime,
  publishedAt: p.publishedAt,
  searchText:  [p.title, p.description, ...p.keywords].join(' ').toLowerCase(),
}));

function searchPosts(q: string) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return POST_INDEX
    .filter(p => tokens.every(t => p.searchText.includes(t)))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export default function BuscarPage({ searchParams }: { searchParams: { q?: string } }) {
  const query = searchParams.q?.trim() ?? '';
  const results = query ? searchPosts(query) : [];

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      {/* Header */}
      <header className="border-b border-white/5 sticky top-0 z-50 backdrop-blur-md bg-brand-bg/80">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </a>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/blog" className="text-brand-muted hover:text-white transition-colors">Blog</a>
            <a
              href="/cadastro"
              className="bg-brand-primary text-black font-semibold px-4 py-1.5 rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Grátis
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Search input */}
        <form method="GET" action="/buscar" className="mb-8">
          <div className="relative">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Buscar artigos, guias, comparações..."
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-3.5 text-white placeholder:text-brand-muted focus:outline-none focus:border-brand-primary/50 text-lg"
            />
            <button
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-brand-primary text-black font-semibold px-5 py-2 rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Buscar
            </button>
          </div>
        </form>

        {/* Results */}
        <BuscarClient query={query} results={results} />
      </main>

      <footer className="border-t border-white/5 mt-16 py-8 text-center text-brand-muted text-sm">
        <p>© 2026 ZapScript — <a href="/" className="hover:text-white transition-colors">zapscript.me</a></p>
      </footer>
    </div>
  );
}
