import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sobre o ZapScript — Quem somos e por que existimos',
  description: 'Conheça a história, missão e time por trás do ZapScript — o app que converte áudio do WhatsApp em texto com IA.',
  alternates: { canonical: 'https://www.zapscript.me/sobre' },
  openGraph: {
    title: 'Sobre o ZapScript',
    description: 'Conheça a história, missão e time por trás do ZapScript.',
    url: 'https://www.zapscript.me/sobre',
    type: 'website',
    siteName: 'ZapScript',
    locale: 'pt_BR',
  },
};

/* ── JSON-LD AboutPage ── */
function AboutJsonLd() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'Sobre o ZapScript',
    description: 'O ZapScript nasceu para resolver o maior ladrão de tempo do brasileiro: áudio longo no WhatsApp. Conversão automática com IA, sem esforço.',
    about: {
      '@type': 'Organization',
      name: 'ZapScript',
      url: 'https://www.zapscript.me',
      foundingDate: '2025',
      founder: {
        '@type': 'Person',
        name: 'Roberto',
        jobTitle: 'Founder',
        url: 'https://linkedin.com/in/zapscript',
      },
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default function SobrePage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <AboutJsonLd />

      {/* ── Header ── */}
      <header className="border-b border-white/5 sticky top-0 z-50 backdrop-blur-md bg-brand-bg/80">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
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
        {/* ── Hero ── */}
        <section className="mb-16 text-center">
          <div className="text-5xl mb-5">⚡</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Sobre o ZapScript</h1>
          <p className="text-lg text-brand-muted max-w-xl mx-auto leading-relaxed">
            Nascemos para resolver o maior ladrão de tempo do brasileiro: áudios longos no WhatsApp.
          </p>
        </section>

        {/* ── Missão ── */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-white mb-4">🎯 Nossa missão</h2>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <p className="text-brand-text-secondary leading-relaxed">
              O <strong>Brasil é o país que mais envia mensagens de voz no WhatsApp no mundo</strong>. Profissionais
              perdem horas por semana ouvindo áudios que poderiam ser lidos em segundos. O ZapScript
              elimina esse gargalo: <strong>converte automaticamente qualquer áudio do WhatsApp em texto + resumo com IA</strong>,
              para que você leia em 10 segundos o que levaria 5 minutos ouvindo.
            </p>
            <p className="text-brand-text-secondary leading-relaxed mt-4">
              Acreditamos que <strong>áudio é entrada, texto é saída</strong>. Nossa plataforma processa milhares de
              conversões por mês, economizando horas de profissionais, empresas e equipes em todo o Brasil.
            </p>
          </div>
        </section>

        {/* ── Founder ── */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-white mb-4">👤 Founder</h2>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col sm:flex-row gap-5 items-start">
            <div className="w-16 h-16 rounded-full bg-brand-primary/20 flex items-center justify-center text-2xl shrink-0">
              🧑‍💻
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">Roberto</h3>
              <p className="text-sm text-brand-primary font-medium">Founder & Tech Lead</p>
              <p className="text-sm text-brand-text-secondary leading-relaxed mt-3">
                Desenvolvedor full-stack e empreendedor. Construiu o ZapScript do zero — da primeira linha de código
                à plataforma que processa milhares de áudios por mês. Acredita que tecnologia bem feita
                desaparece: você só percebe que ela existe porque sua vida ficou mais fácil.
              </p>
              <a
                href="https://linkedin.com/in/zapscript"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 mt-3 text-sm text-brand-primary hover:underline font-medium"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                LinkedIn
              </a>
            </div>
          </div>
        </section>

        {/* ── Timeline ── */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-white mb-4">📅 Nossa jornada</h2>
          <div className="space-y-4">
            {[
              { year: '2025', title: 'Fundação', desc: 'Primeira versão do ZapScript construída como solução para um problema pessoal: áudios intermináveis no WhatsApp.' },
              { year: '2026 Q1', title: 'Lançamento MVP', desc: 'Plataforma no ar com conversão automática, resumo com IA e integração direta com WhatsApp.' },
              { year: '2026 Q2', title: 'Módulos e expansão', desc: 'Lançamento da suíte de módulos: Atende (atendimento automático), CRM, Campanhas, Cobrança e Vendas.' },
              { year: '2026 Q3', title: 'Escala', desc: 'Milhares de usuários ativos. Expansão para times e empresas com plano multi-seat. Infraestrutura própria no Brasil.' },
            ].map((m, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="shrink-0 w-20 text-right">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">{m.year}</span>
                </div>
                <div className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="font-bold text-white text-sm">{m.title}</h3>
                  <p className="text-xs text-brand-muted mt-1 leading-relaxed">{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Valores ── */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-white mb-4">💎 Valores</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: '⚡', title: 'Velocidade', desc: 'Ler é 4× mais rápido que ouvir. Nosso produto reflete isso: rápido de configurar, rápido de usar.' },
              { icon: '🔒', title: 'Privacidade', desc: 'Seus áudios são processados e descartados. Não vendemos dados, não ouvimos suas conversas.' },
              { icon: '🤝', title: 'Simplicidade', desc: 'Tecnologia complexa, experiência simples. Conectou o WhatsApp, já está funcionando.' },
            ].map((v, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">{v.icon}</div>
                <h3 className="font-bold text-white text-sm mb-1">{v.title}</h3>
                <p className="text-xs text-brand-muted leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="text-center bg-white/5 border border-white/10 rounded-2xl p-8">
          <div className="text-4xl mb-3">🚀</div>
          <h2 className="text-xl font-bold text-white mb-2">Experimente grátis</h2>
          <p className="text-brand-muted text-sm mb-5">Até 100 áudios por mês, sem cartão, sem compromisso.</p>
          <a
            href="/cadastro"
            className="inline-block bg-brand-primary text-black font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity"
          >
            Criar conta grátis
          </a>
        </div>
      </main>

      {/* ── Footer minimal ── */}
      <footer className="border-t border-white/5 py-8 text-center">
        <p className="text-xs text-brand-muted">
          © {new Date().getFullYear()} ZapScript · <a href="/" className="hover:text-white transition-colors">Início</a> · <a href="/blog" className="hover:text-white transition-colors">Blog</a> · <a href="/sobre" className="hover:text-white transition-colors">Sobre</a>
        </p>
      </footer>
    </div>
  );
}
