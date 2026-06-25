import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import IndiqueClient from './IndiqueClient';

export const metadata: Metadata = {
  title:       'Indique o ZapScript e ganhe minutos grátis — Programa de Indicação',
  description: 'Indique um amigo para o ZapScript e ganhem 15 minutos grátis de conversão cada um quando ele se cadastrar. Sem limite de indicações.',
  keywords:    'indique e ganhe zapscript, programa de indicação whatsapp, link de indicação conversão áudio',
  alternates:  { canonical: 'https://www.zapscript.me/indique' },
  openGraph: {
    title:       'Indique o ZapScript — Ganhe minutos grátis',
    description: 'Cada amigo que você indicar e se cadastrar dá 15 minutos grátis para os dois. Sem limite.',
    url:         'https://www.zapscript.me/indique',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const FAQS = [
  { q: 'Como funciona o programa de indicação?', a: 'Você compartilha seu link pessoal (disponível no seu painel, em "Indique o ZapScript"). Quando alguém se cadastra pelo seu link, você e a pessoa indicada ganham 15 minutos grátis de conversão cada.' },
  { q: 'Existe limite de indicações?', a: 'Não. Você pode indicar quantas pessoas quiser e acumular 15 minutos grátis por cada cadastro válido feito pelo seu link.' },
  { q: 'Onde encontro meu link de indicação?', a: 'Faça login na sua conta ZapScript e acesse o Dashboard — seu link pessoal está no card "Indique o ZapScript", com botão para copiar ou compartilhar direto no WhatsApp.' },
  { q: 'Ainda não tenho conta, posso indicar?', a: 'Você precisa de uma conta ZapScript (mesmo no plano Free, grátis) para gerar seu link pessoal de indicação. Crie sua conta grátis e o link aparece automaticamente no seu painel.' },
  { q: 'Os minutos grátis somam com o plano que eu já tenho?', a: 'Sim. Os 15 minutos de cada indicação são creditados na sua conta e somam ao limite mensal do seu plano atual (Free ou Pro).' },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',  item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Indique', item: 'https://www.zapscript.me/indique' },
  ],
};

export default function IndiquePage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      {/* Captura ?ref= de quem chegou via link compartilhado e redireciona pro cadastro */}
      <Suspense fallback={null}>
        <IndiqueClient />
      </Suspense>

      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/login" className="text-brand-muted hover:text-white text-sm transition-colors">
            Já tenho conta →
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
          🎁 Programa de indicação
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
          Indique um amigo,<br /><span className="text-brand-primary">ganhem 15 minutos grátis</span> os dois
        </h1>
        <p className="text-lg text-brand-muted max-w-xl mx-auto leading-relaxed mb-10">
          Cada pessoa que se cadastrar pelo seu link pessoal dá 15 minutos grátis de conversão para você e para ela. Sem limite de indicações.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 mb-12 text-left">
          {[
            { n: '1', t: 'Pegue seu link', d: 'Faça login (ou crie sua conta grátis) e copie seu link pessoal de indicação no Dashboard.' },
            { n: '2', t: 'Compartilhe', d: 'Mande para amigos, clientes ou no seu grupo de WhatsApp — direto pelo botão "Compartilhar".' },
            { n: '3', t: 'Ganhem juntos', d: 'Quando a pessoa se cadastra pelo seu link, vocês dois recebem 15 minutos grátis na conta.' },
          ].map(s => (
            <div key={s.n} className="rounded-2xl p-5 border border-white/10 bg-white/3">
              <div className="w-7 h-7 rounded-full bg-brand-primary/15 text-brand-primary font-bold text-sm flex items-center justify-center mb-3">{s.n}</div>
              <div className="font-bold text-white text-sm mb-1">{s.t}</div>
              <p className="text-xs text-brand-muted leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16">
          <Link href="/login" className="inline-flex items-center justify-center gap-2 bg-brand-primary text-black font-bold text-base px-8 py-3.5 rounded-2xl hover:opacity-90 transition-opacity">
            Já sou cliente — pegar meu link →
          </Link>
          <Link href="/cadastro" className="inline-flex items-center justify-center gap-2 border border-white/15 text-white font-semibold text-base px-8 py-3.5 rounded-2xl hover:bg-white/5 transition-colors">
            Quero conhecer o ZapScript
          </Link>
        </div>

        {/* FAQ */}
        <div className="text-left">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Perguntas frequentes</h2>
          <div className="space-y-3 max-w-2xl mx-auto">
            {FAQS.map((faq, i) => (
              <details key={i} className="border border-white/10 rounded-xl overflow-hidden group">
                <summary className="px-6 py-4 cursor-pointer font-semibold text-white hover:bg-white/5 transition-colors list-none flex items-center justify-between">
                  {faq.q}
                  <span className="text-brand-primary text-xl ml-4 shrink-0 group-open:rotate-45 transition-transform duration-200">+</span>
                </summary>
                <div className="px-6 pb-5 text-brand-muted leading-relaxed border-t border-white/5 pt-4 text-sm">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
      </footer>
    </div>
  );
}
