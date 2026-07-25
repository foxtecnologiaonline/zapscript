'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { captureAffiliateFromUrl } from '@/lib/affiliate';
import { Testimonials } from '@/components/Testimonials';
import AtendeChatDemo from '@/components/AtendeChatDemo';
import { api } from '@/lib/api';
import { ModuleCatalogItem, formatBrl } from '@/lib/modules';

const CTA_HREF = '/cadastro?utm_source=seo&utm_campaign=atende';

/* Espelha packages/modules/catalog.ts (MODULE_BY_KEY.atende) — usado como
   valor inicial para a página nunca renderizar sem preço; GET /modules
   (fonte real, vinda do banco) atualiza silenciosamente se divergir. */
const FALLBACK_MODULE: ModuleCatalogItem = {
  key: 'atende',
  name: 'ZapScript Atende',
  status: 'beta',
  priceMonthly: 67,
  priceYearly: 643,
  dependsOn: [],
};

/* ── FAQ ────────────────────────────────────────────────────────────── */
const FAQS = [
  {
    q: 'Preciso desconectar meu WhatsApp atual ou trocar de número?',
    a: 'Não. O Atende ativa sobre o número que você já tem conectado no ZapScript — sem QR code novo, sem trocar de número, sem interromper nada que já está funcionando.',
  },
  {
    q: 'A IA responde qualquer pergunta do cliente?',
    a: 'Ela responde com base na base de conhecimento do seu negócio, que você mesmo cadastra (perguntas e respostas comuns). Quando a pergunta foge disso, a conversa escala para você automaticamente — ninguém recebe resposta errada ou inventada.',
  },
  {
    q: 'Meu cliente vai perceber que está falando com um robô?',
    a: 'Você define o tom de voz e o contexto do seu negócio na configuração — a resposta sai natural, do jeito que você configurar. Não existe nenhum aviso automático de "isto é um robô" a menos que você queira adicionar um.',
  },
  {
    q: 'Posso mudar as respostas depois de ativar?',
    a: 'Sim, a qualquer momento, direto no painel. Editar, adicionar ou desativar uma pergunta da base de conhecimento leva segundos e vale para a próxima mensagem recebida.',
  },
  {
    q: 'Preciso ter outro plano do ZapScript para usar o Atende?',
    a: 'Não. O Atende é um módulo independente — funciona com qualquer conta ZapScript que tenha um número de WhatsApp conectado, sem depender de nenhum outro módulo.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, a qualquer momento, direto no painel — sem fidelidade e sem multa.',
  },
];

function FAQAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {items.map((faq, i) => (
        <div
          key={i}
          className="border border-white/10 rounded-xl overflow-hidden bg-white/3"
        >
          <button
            className="w-full flex items-center justify-between px-6 py-4 text-left font-semibold text-white hover:bg-white/5 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span>{faq.q}</span>
            <span className={`text-brand-primary text-xl ml-4 shrink-0 transition-transform duration-200 ${open === i ? 'rotate-45' : ''}`}>+</span>
          </button>
          {open === i && (
            <div className="px-6 pb-5 text-brand-muted leading-relaxed border-t border-white/5 pt-4">
              {faq.a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Componente principal ───────────────────────────────────────────── */
export default function AtendeLandingClient() {
  // Captura o ?aff= e remove o código da barra de endereços (mesma convenção das outras LPs)
  useEffect(() => { captureAffiliateFromUrl(); }, []);

  // Preço/nome vindo do catálogo real (GET /modules, já usado pelo launcher e por /dashboard/plano)
  const [mod, setMod] = useState<ModuleCatalogItem>(FALLBACK_MODULE);
  useEffect(() => {
    api.get<{ modules: ModuleCatalogItem[] }>('/modules')
      .then((res) => {
        const found = res.modules?.find((m) => m.key === 'atende');
        if (found) setMod(found);
      })
      .catch(() => { /* mantém fallback — não derrubar a página por causa disso */ });
  }, []);

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
      { '@type': 'ListItem', position: 2, name: 'ZapScript Atende', item: 'https://www.zapscript.me/atende' },
    ],
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Schema.org — rich snippets no Google */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      {/* ── Header mínimo — sem distrações ──────────────────────── */}
      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/login" className="text-brand-muted hover:text-white text-sm transition-colors">
            Já tenho conta →
          </Link>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════
          HERO — acima da dobra, CTA visível sem scroll
      ════════════════════════════════════════════════════════════ */}
      <section className="pt-16 pb-12 px-4 text-center relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.12) 0%, transparent 70%)',
          }}
        />

        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            🤖 Novo módulo · Atendimento automático
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-5">
            Seu WhatsApp respondendo o cliente sozinho, 24 horas por dia.
          </h1>

          <p className="text-lg sm:text-xl text-brand-muted leading-relaxed max-w-2xl mx-auto mb-8">
            O ZapScript Atende usa IA treinada no seu negócio para responder as perguntas mais
            comuns dos seus clientes na hora — e chama você só quando realmente precisa. Sem
            contratar equipe, sem cliente esperando resposta.
          </p>

          <Link
            href={CTA_HREF}
            data-cta="atende_hero_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-lg"
            style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3)' }}
          >
            Contratar Atende
            <span>→</span>
          </Link>

          <p className="mt-4 text-sm text-brand-muted">
            ✓ Ativa em minutos &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          VEJA NA PRÁTICA — mockup real da conversa
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-white mb-2">Veja como fica no seu WhatsApp</h2>
            <p className="text-brand-primary font-medium mb-1">
              O cliente manda uma pergunta e a resposta sai na hora — sozinha, na mesma conversa.
            </p>
            <p className="text-brand-muted">Você só entra quando a IA não sabe responder.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <AtendeChatDemo />
            <div className="space-y-5">
              {[
                { emoji: '📚', title: 'Ensine seu negócio à IA', desc: 'Cadastre as perguntas e respostas mais comuns do seu dia a dia — preço, horário, formas de pagamento, o que for.' },
                { emoji: '⚡', title: 'A IA responde sozinha', desc: 'O cliente manda a mensagem e a resposta certa sai em segundos, na mesma conversa do WhatsApp.' },
                { emoji: '🙋', title: 'Você entra quando precisa', desc: 'Se a IA não souber responder, a conversa escala para você — nenhuma mensagem fica sem resposta.' },
              ].map(({ emoji, title, desc }) => (
                <div key={title} className="flex gap-3">
                  <div className="text-2xl flex-shrink-0">{emoji}</div>
                  <div>
                    <h3 className="font-bold text-white mb-0.5">{title}</h3>
                    <p className="text-brand-muted text-sm leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          BENEFÍCIOS
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Tudo que você precisa, incluído</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '🕐', title: 'Atendimento 24/7', desc: 'Seu WhatsApp responde clientes de madrugada, fim de semana e feriado — sem ninguém de plantão.' },
              { icon: '📚', title: 'Treinada no seu negócio', desc: 'A IA responde com base numa base de conhecimento que você mesmo cadastra e edita quando quiser.' },
              { icon: '🙋', title: 'Escalonamento humano', desc: 'Pergunta fora do que a IA sabe? A conversa sai da automação e chama você — ninguém fica sem resposta.' },
              { icon: '🗂️', title: 'Histórico completo', desc: 'Todas as conversas ficam salvas, organizadas por contato, para você consultar quando quiser.' },
              { icon: '🔌', title: 'Ativa no número que você já usa', desc: 'Nada de QR code novo ou número extra — o Atende liga direto no WhatsApp que você já conectou no ZapScript.' },
              { icon: '🛡️', title: 'LGPD & Segurança', desc: 'Mesma infraestrutura segura do ZapScript — dados criptografados, servidores no Brasil.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white/5 border border-white/8 rounded-xl p-5">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold text-white mb-1.5 text-sm">{title}</h3>
                <p className="text-brand-muted text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          DEPOIMENTOS — renderiza só quando houver
      ════════════════════════════════════════════════════════════ */}
      <Testimonials />

      {/* ════════════════════════════════════════════════════════════
          PREÇO — único, sem tiers
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-3">Um preço, sem pegadinha</h2>
          <p className="text-brand-muted text-center mb-10">Ativa sobre o número que você já tem no ZapScript.</p>

          <div className="rounded-2xl p-6 border border-brand-primary bg-brand-primary/8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-primary text-black text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
              🤖 {mod.name}
            </div>
            <div className="flex items-baseline gap-1.5 mb-4 mt-2 justify-center">
              <span className="text-3xl font-bold text-white">{formatBrl(mod.priceMonthly)}</span>
              <span className="text-brand-muted text-sm">/mês</span>
            </div>
            <ul className="space-y-2 mb-6">
              {[
                'Atendimento automático 24/7',
                'Base de conhecimento própria',
                'Escalonamento humano incluído',
                'Conversas e histórico ilimitados',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span className="text-brand-primary shrink-0 mt-0.5">✓</span>
                  <span className="text-brand-muted">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={CTA_HREF}
              data-cta="atende_plano_cta"
              className="block text-center font-semibold py-2.5 rounded-xl transition-all text-sm bg-brand-primary text-black hover:opacity-90"
            >
              Contratar Atende
            </Link>
          </div>
          <p className="text-center text-brand-muted text-xs mt-6">
            Cobrança proporcional ao ativar no meio do ciclo · Cancele quando quiser · Sem fidelidade
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FAQ
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Perguntas frequentes</h2>
          <FAQAccordion items={FAQS} />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          CTA FINAL
      ════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(16,185,129,0.08) 0%, transparent 70%)',
          }}
        />
        <div className="relative max-w-xl mx-auto text-center">
          <div className="text-6xl mb-6">🤖</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight">
            Pronto para parar de perder cliente por demorar a responder?
          </h2>
          <p className="text-brand-muted text-lg mb-8">
            Ative o Atende sobre o número que você já usa e deixe a IA responder por você — 24 horas por dia.
          </p>
          <Link
            href={CTA_HREF}
            data-cta="atende_footer_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-xl px-12 py-5 rounded-2xl hover:opacity-90 active:scale-95 transition-all"
            style={{ boxShadow: '0 0 40px rgba(16,185,129,0.35)' }}
          >
            Contratar Atende
            <span>→</span>
          </Link>
          <p className="mt-5 text-sm text-brand-muted">
            ✓ {formatBrl(mod.priceMonthly)}/mês &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ LGPD
          </p>
        </div>
      </section>

      {/* ── Footer mínimo ────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-6 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-brand-muted">
          <span>© 2026 ZapScript · FOX TecnologIA</span>
          <div className="flex items-center gap-4">
            <Link href="/privacidade" className="hover:text-white transition-colors">Privacidade</Link>
            <Link href="/termos" className="hover:text-white transition-colors">Termos</Link>
            <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
