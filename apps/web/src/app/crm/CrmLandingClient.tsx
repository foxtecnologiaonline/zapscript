'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { captureAffiliateFromUrl } from '@/lib/affiliate';

const CTA_HREF = '/cadastro?utm_source=seo&utm_campaign=crm';

/* ── Dados estáticos da página ─────────────────────────────────────── */
const PAINS = [
  { icon: '🗂️', title: 'Zero lead esquecido', desc: 'Cada contato fica em um estágio visível — nada se perde no meio de centenas de conversas.' },
  { icon: '📥', title: 'Chega de planilha solta', desc: 'O funil vive junto do WhatsApp que você já usa — sem exportar e importar Excel toda semana.' },
  { icon: '⚡', title: 'Importação em 1 clique', desc: 'Sugerimos contatos direto do histórico que você já transcreveu — sem digitar tudo de novo.' },
];

const STEPS = [
  { emoji: '📲', title: 'Organize', desc: 'Arraste contatos entre os estágios do funil: novo lead, negociando, fechado, perdido.' },
  { emoji: '📝', title: 'Registre', desc: 'Adicione notas, ligações, reuniões e lembretes em cada contato — tudo em um só lugar.' },
  { emoji: '🔄', title: 'Importe', desc: 'Um clique importa sugestões a partir das conversas que você já transcreveu no ZapScript.' },
];

const BENEFITS = [
  { icon: '🗂️', title: 'Funil Kanban visual', desc: 'Arraste e solte contatos entre estágios personalizáveis, com cores e ordem à sua escolha.' },
  { icon: '🔔', title: 'Lembretes', desc: 'Nunca esqueça um follow-up — alertas por contato com data e hora.' },
  { icon: '📥', title: 'Importar do WhatsApp', desc: 'Sugestões automáticas a partir do seu histórico de conversas já transcritas.' },
  { icon: '💰', title: 'Valor do negócio', desc: 'Acompanhe o valor estimado de cada contato e o total por estágio do funil.' },
  { icon: '🔍', title: 'Busca rápida', desc: 'Encontre qualquer contato por nome, telefone ou empresa em segundos.' },
  { icon: '🔒', title: 'Segurança da plataforma', desc: 'Mesmos padrões de segurança e conformidade com a LGPD de todo o ZapScript.' },
];

const COMPARISON: [string, string, string, string][] = [
  ['Direto no WhatsApp que você já usa', '❌', '❌', '✅'],
  ['Importação a partir de conversas',   '❌', '❌', '✅'],
  ['Funil arrastar-e-soltar',            '❌', '✅', '✅'],
  ['Lembretes por contato',              '⚠️ Manual', '✅', '✅'],
  ['Tempo de configuração',              '—', '⚠️ Dias', '✅ Minutos'],
  ['Custo mensal',                       '✅ Grátis', '⚠️ Alto', '✅ R$47'],
];

const FAQS = [
  {
    q: 'Preciso ter o ZapScript principal para usar o CRM?',
    a: 'Sim — o CRM é um módulo da plataforma ZapScript, não um produto separado. Ele usa o mesmo login e, quando disponível, o histórico de conversas já transcritas para sugerir importações.',
  },
  {
    q: 'Como funciona a importação automática de contatos?',
    a: 'O CRM sugere contatos a partir do histórico de conversas que você já transcreveu no ZapScript. Você revisa a lista e escolhe quem importar com um clique — nada é adicionado sem sua confirmação.',
  },
  {
    q: 'Posso personalizar os estágios do funil?',
    a: 'Sim. Você pode criar, renomear, reordenar e colorir os estágios — inclusive marcar quais representam "ganho" ou "perda" para acompanhar sua taxa de conversão.',
  },
  {
    q: 'Meus contatos e notas ficam seguros?',
    a: 'Sim. O CRM segue os mesmos padrões de segurança e conformidade com a LGPD de toda a plataforma ZapScript, com acesso restrito à sua conta.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, a qualquer momento, direto pelo painel — sem fidelidade ou multa.',
  },
];

const KANBAN_PREVIEW = [
  { name: 'Novo lead', color: '#3b82f6', cards: [
    { name: 'Rafael M.', sub: 'há 12min' },
    { name: 'Camila S.', sub: 'há 2h' },
  ] },
  { name: 'Negociando', color: '#f97316', cards: [
    { name: 'Studio MS', sub: 'R$ 1.500' },
  ] },
  { name: 'Fechado', color: '#22c55e', cards: [
    { name: 'Ana Souza', sub: 'R$ 5.000' },
  ] },
];

/* ── FAQ Accordion ─────────────────────────────────────────────────── */
function FAQAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {items.map((faq, i) => (
        <div key={i} className="border border-white/10 rounded-xl overflow-hidden bg-white/3">
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

/* ── Componente principal ──────────────────────────────────────────── */
export default function CrmLandingClient() {
  useEffect(() => { captureAffiliateFromUrl(); }, []);

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map(f => ({
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
      { '@type': 'ListItem', position: 2, name: 'CRM', item: 'https://www.zapscript.me/crm' },
    ],
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      {/* ── Header ───────────────────────────────────────────────── */}
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
          HERO
      ════════════════════════════════════════════════════════════ */}
      <section className="pt-16 pb-12 px-4 text-center relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.12) 0%, transparent 70%)' }}
        />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            📊 Novo módulo ZapScript
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-5">
            Você responde no WhatsApp. Mas sabe quem é lead novo, quem tá negociando e quem já fechou?
          </h1>

          <p className="text-lg sm:text-xl text-brand-muted leading-relaxed max-w-2xl mx-auto mb-8">
            O ZapScript CRM organiza seus contatos em um funil visual — sem sair do WhatsApp. Arraste entre estágios, registre notas e lembretes, e importe contatos com 1 clique a partir do que você já transcreveu.
          </p>

          <Link
            href={CTA_HREF}
            data-cta="crm_hero_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-lg"
            style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3)' }}
          >
            Ativar CRM — R$47/mês
            <span>→</span>
          </Link>

          <p className="mt-4 text-sm text-brand-muted">
            ✓ Usa sua conta ZapScript atual &nbsp;·&nbsp; ✓ Sem instalar nada &nbsp;·&nbsp; ✓ Cancele quando quiser
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          PREVIEW DO FUNIL — mockup do Kanban
      ════════════════════════════════════════════════════════════ */}
      <section className="py-10 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
            <div className="grid sm:grid-cols-3 gap-3">
              {KANBAN_PREVIEW.map(col => (
                <div key={col.name} className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                    <span className="text-xs font-semibold text-white">{col.name}</span>
                    <span className="text-[10px] text-brand-muted ml-auto">{col.cards.length}</span>
                  </div>
                  <div className="space-y-2">
                    {col.cards.map(card => (
                      <div key={card.name} className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                        <div className="text-xs font-medium text-white truncate">{card.name}</div>
                        <div className="text-[11px] text-brand-muted">{card.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-center text-brand-muted text-sm mt-6 max-w-xl mx-auto">
            Arraste um contato de coluna e ele muda de estágio na hora. <span className="text-white font-medium">Simples assim.</span>
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          NICHO — "Feito para quem vende pelo WhatsApp"
      ════════════════════════════════════════════════════════════ */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Feito para quem vende ou atende <span className="text-brand-primary">pelo WhatsApp</span>
          </h2>
          <p className="text-brand-muted mb-10 max-w-xl mx-auto">
            Seu funil de vendas já existe — só está espalhado em conversas. O CRM organiza isso.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 text-left">
            {PAINS.map(({ icon, title, desc }) => (
              <div key={title} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold text-white mb-1.5 text-sm">{title}</h3>
                <p className="text-brand-muted text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <Link
            href={CTA_HREF}
            data-cta="crm_mid_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-base px-8 py-3.5 rounded-2xl hover:opacity-90 active:scale-95 transition-all mt-10"
            style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3)' }}
          >
            Ativar CRM — R$47/mês
            <span>→</span>
          </Link>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          COMO FUNCIONA
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-white mb-2">Veja como funciona</h2>
            <p className="text-brand-muted">Três passos, sem sair da rotina que você já tem no WhatsApp.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {STEPS.map(({ emoji, title, desc }) => (
              <div key={title} className="text-center">
                <div className="text-4xl mb-3">{emoji}</div>
                <h3 className="font-bold text-white mb-1.5">{title}</h3>
                <p className="text-brand-muted text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          BENEFÍCIOS
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Tudo que você precisa para não perder um lead</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BENEFITS.map(({ icon, title, desc }) => (
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
          COMPARATIVO
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Por que não uma planilha?</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-5 py-4 text-left text-brand-muted font-medium">Recurso</th>
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Planilha</th>
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">CRM genérico</th>
                  <th className="px-5 py-4 text-center text-brand-primary font-bold bg-brand-primary/5">ZapScript CRM ⚡</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {COMPARISON.map(([feature, planilha, generico, zap]) => (
                  <tr key={feature} className="hover:bg-white/2 transition-colors">
                    <td className="px-5 py-3 text-white">{feature}</td>
                    <td className="px-5 py-3 text-center text-brand-muted">{planilha}</td>
                    <td className="px-5 py-3 text-center text-brand-muted">{generico}</td>
                    <td className="px-5 py-3 text-center font-semibold bg-brand-primary/5">{zap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          PREÇO
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-3">Preço simples e transparente</h2>
          <p className="text-brand-muted text-center mb-10">Um módulo, um preço. Sem letras miúdas.</p>
          <div className="max-w-xs mx-auto rounded-2xl p-6 border border-brand-primary bg-brand-primary/8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-primary text-black text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
              📊 Módulo CRM
            </div>
            <h3 className="font-bold text-white mb-1">ZapScript CRM</h3>
            <div className="flex items-baseline gap-1.5 mb-4">
              <span className="text-2xl font-bold text-white">R$47</span>
              <span className="text-brand-muted text-sm">/mês</span>
            </div>
            <ul className="space-y-2 mb-6">
              {[
                'Contatos ilimitados',
                'Estágios personalizáveis',
                'Notas, ligações, reuniões e lembretes',
                'Importação com 1 clique do WhatsApp',
                'Busca por nome, telefone ou empresa',
              ].map(f => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span className="text-brand-primary shrink-0 mt-0.5">✓</span>
                  <span className="text-brand-muted">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={CTA_HREF}
              data-cta="crm_plano_cta"
              className="block text-center font-semibold py-2.5 rounded-xl transition-all text-sm bg-brand-primary text-black hover:opacity-90"
            >
              Ativar CRM
            </Link>
          </div>
          <p className="text-center text-brand-muted text-xs mt-6">
            Requer uma conta ZapScript ativa — o CRM é um módulo, não um produto separado. Pagamento via PIX ou cartão · Cancele quando quiser
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
          style={{ background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(16,185,129,0.08) 0%, transparent 70%)' }}
        />
        <div className="relative max-w-xl mx-auto text-center">
          <div className="text-6xl mb-6">📊</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight">
            Pronto para organizar seu funil de vendas no WhatsApp?
          </h2>
          <p className="text-brand-muted text-lg mb-8">
            Ative o módulo CRM e nunca mais perca um lead no meio das conversas.
          </p>
          <Link
            href={CTA_HREF}
            data-cta="crm_footer_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-xl px-12 py-5 rounded-2xl hover:opacity-90 active:scale-95 transition-all"
            style={{ boxShadow: '0 0 40px rgba(16,185,129,0.35)' }}
          >
            Ativar CRM — R$47/mês
            <span>→</span>
          </Link>
          <p className="mt-5 text-sm text-brand-muted">
            ✓ Sem instalar nada &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ LGPD
          </p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
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
