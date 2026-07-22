'use client';

import Link from 'next/link';

interface PostResult {
  slug: string;
  title: string;
  description: string;
  category: string;
  coverEmoji: string;
  readingTime: number;
  publishedAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Guias':        'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  'Produtividade':'bg-green-500/15 text-green-300 border border-green-500/20',
  'Dicas':        'bg-yellow-500/15 text-yellow-300 border border-yellow-500/20',
  'Empresas':     'bg-purple-500/15 text-purple-300 border border-purple-500/20',
  'Comparativos': 'bg-orange-500/15 text-orange-300 border border-orange-500/20',
  'Nichos':       'bg-pink-500/15 text-pink-300 border border-pink-500/20',
  'Casos de uso': 'bg-teal-500/15 text-teal-300 border border-teal-500/20',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function BuscarClient({ query, results }: { query: string; results: PostResult[] }) {
  if (!query) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-2xl font-bold text-white mb-3">Buscar no Blog</h1>
        <p className="text-brand-muted max-w-md mx-auto">
          Digite um termo acima para encontrar guias, comparativos e dicas sobre conversão de áudio do WhatsApp com IA.
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">😕</div>
        <h2 className="text-xl font-bold text-white mb-2">
          Nenhum resultado para &ldquo;{query}&rdquo;
        </h2>
        <p className="text-brand-muted mb-6">
          Tente buscar por termos como &ldquo;conversão whatsapp&rdquo;, &ldquo;resumo áudio&rdquo; ou &ldquo;comparativo&rdquo;.
        </p>
        <Link
          href="/blog"
          className="inline-block bg-brand-primary text-black font-semibold px-6 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
        >
          Ver todos os artigos →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="text-brand-muted mb-6">
        {results.length} resultado{results.length !== 1 ? 's' : ''} para &ldquo;{query}&rdquo;
      </p>
      <div className="space-y-4">
        {results.map(post => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="group block">
            <article className="bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl p-5 transition-all duration-200 hover:border-brand-primary/30">
              <div className="flex items-start gap-4">
                <div className="text-4xl shrink-0">{post.coverEmoji}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[post.category] ?? ''}`}>
                      {post.category}
                    </span>
                    <span className="text-brand-muted text-xs">{post.readingTime} min</span>
                  </div>
                  <h3 className="font-bold text-white group-hover:text-brand-primary transition-colors leading-snug mb-1">
                    {post.title}
                  </h3>
                  <p className="text-sm text-brand-muted line-clamp-2">{post.description}</p>
                </div>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </div>
  );
}
