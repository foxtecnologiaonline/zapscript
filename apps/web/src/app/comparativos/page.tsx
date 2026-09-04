import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title:       'Comparativos — ZapScript vs Otter.ai, Notta, Zapia, LuzIA, ViraTexto, Transkriptor e ZapVox',
  description: 'Compare o ZapScript com as principais alternativas para converter áudio do WhatsApp em texto: automação, preço, privacidade e resumo com IA.',
  keywords:    'zapscript comparativo, alternativa otter.ai, alternativa notta, alternativa zapia, alternativa luzia, alternativa viratexto, alternativa transkriptor, alternativa zapvox',
  alternates:  { canonical: 'https://www.zapscript.me/comparativos' },
  openGraph: {
    title:       'Comparativos — ZapScript vs as principais alternativas',
    description: 'Automação, preço, privacidade e resumo com IA: veja como o ZapScript se compara a cada alternativa para converter áudio do WhatsApp.',
    url:         'https://www.zapscript.me/comparativos',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const COMPARISONS = [
  { slug: 'otter',       name: 'Otter.ai',      angle: 'Reuniões em inglês vs. áudio de WhatsApp em português' },
  { slug: 'notta',       name: 'Notta',         angle: 'Transcrição de reuniões e arquivos vs. automação direto no seu número' },
  { slug: 'zapia',       name: 'Zapia',         angle: 'Assistente de IA multifuncional vs. ferramenta especializada em áudio' },
  { slug: 'luzia',       name: 'LuzIA',         angle: 'Automação, preço e privacidade lado a lado' },
  { slug: 'viratexto',   name: 'ViraTexto',     angle: 'Preço, automação e resumo com IA em 2026' },
  { slug: 'transkriptor', name: 'Transkriptor', angle: 'Envio manual de arquivo vs. conversão automática no WhatsApp' },
  { slug: 'zapvox',      name: 'ZapVox',        angle: 'Extensão de navegador com clique manual vs. automação real' },
];

const schema = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Comparativos — ZapScript vs alternativas',
  url: 'https://www.zapscript.me/comparativos',
  inLanguage: 'pt-BR',
  hasPart: COMPARISONS.map(c => ({
    '@type': 'WebPage',
    name: `ZapScript vs ${c.name}`,
    url: `https://www.zapscript.me/vs/${c.slug}`,
  })),
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Comparativos', item: 'https://www.zapscript.me/comparativos' },
  ],
};

export default function ComparativosPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/cadastro" className="text-sm bg-brand-primary text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
            Começar grátis →
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            Comparativos independentes
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            ZapScript vs. as principais alternativas
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            Cada comparativo olha automação, preço, privacidade e resumo com IA — pra você decidir com base no que cada ferramenta realmente faz, não em marketing.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {COMPARISONS.map(c => (
            <Link
              key={c.slug}
              href={`/vs/${c.slug}`}
              data-cta={`comparativos_${c.slug}`}
              className="group block rounded-2xl p-6 border border-white/10 bg-white/3 hover:border-brand-primary/30 hover:bg-white/5 transition-all"
            >
              <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript vs {c.name}</div>
              <p className="text-sm text-brand-muted leading-relaxed">{c.angle}</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-primary mt-4 group-hover:gap-1.5 transition-all">
                Ver comparativo <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="text-center py-12 mt-16 rounded-2xl border border-brand-primary/20" style={{ background: 'rgba(16,185,129,.05)' }}>
          <h2 className="text-2xl font-bold text-white mb-3">Comece grátis — sem cartão de crédito</h2>
          <p className="text-brand-muted mb-6">Até 200 áudios por mês grátis. Upgrade quando quiser. Cancele a qualquer hora.</p>
          <Link href="/cadastro" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta grátis →
          </Link>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/blog" className="hover:text-brand-primary">Blog</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
      </footer>
    </div>
  );
}
