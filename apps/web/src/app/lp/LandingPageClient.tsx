'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { captureAffiliateFromUrl } from '@/lib/affiliate';
import { Testimonials } from '@/components/Testimonials';
import ConversationDemo from '@/components/ConversationDemo';
import PriceAnchor from '@/components/PriceAnchor';
import { CORE_AUDIO_QUOTA, PROFISSIONAL_PRICE_MONTHLY, PROFISSIONAL_PRICE_YEARLY, EMPRESAS_PRICE_MONTHLY, EMPRESAS_PRICE_YEARLY } from '@/lib/promo';

/* ── Tipos ──────────────────────────────────────────────────────────── */
export interface Variant {
  badge:    string;
  headline: string;
  sub:      string;
  cta:      string;
  ctaHref:  string;
  /** Nicho (opcional) — quando presente, renderiza a seção "Feito para …". */
  audience?: string;                                          // ex: 'corretores de imóveis'
  pains?:    { icon: string; title: string; desc: string }[]; // 3 dores específicas
  /** FAQ específico do nicho (opcional) — substitui o FAQ genérico + gera schema.org. */
  faqs?:     { q: string; a: string }[];
  /** Slug da página (ex: 'corretores') — quando presente, gera schema.org BreadcrumbList. */
  slug?:        string;
  breadcrumbLabel?: string; // ex: 'Corretores de Imóveis'
}

/* ── FAQ Accordion ──────────────────────────────────────────────────── */
const FAQS = [
  {
    q: 'Precisa instalar algum app no celular?',
    a: 'Não. O ZapScript funciona em segundo plano — você conecta seu número via QR code uma única vez no painel web. Nada é instalado no celular. Funciona em qualquer celular Android ou iPhone.',
  },
  {
    q: 'Quanto tempo leva para receber a conversão?',
    a: 'Em média 10 a 30 segundos após o áudio ser recebido. O tempo varia conforme a duração do áudio e a demanda do servidor, mas para áudios comuns (até 3 min) é praticamente instantâneo.',
  },
  {
    q: 'Meus dados estão seguros?',
    a: 'Sim. Todas as conversões são criptografadas com AES-256-GCM — o mesmo padrão dos bancos. O áudio não fica armazenado — apenas o texto. Servidores em São Paulo, conformidade total com a LGPD.',
  },
  {
    q: 'O remetente sabe que eu converteu o áudio?',
    a: 'Não, se você ativar o Modo Privado. Com ele, a conversão chega para você sem que o áudio seja marcado como "ouvido" na conversa original.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, a qualquer momento. Não há fidelidade ou multa. O cancelamento é feito pelo próprio painel em menos de 1 minuto.',
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

/* ── Planos (ZapScript 2.0) ─────────────────────────────────────────── */
const PLANS = [
  {
    name: 'Core',
    price: 'R$0',
    period: '/mês',
    highlight: false,
    features: [
      `Até ${CORE_AUDIO_QUOTA} áudios/mês`,
      '1 número WhatsApp',
      'Conversão automática',
      'Resumo por IA',
      'Modo Privado (opcional)',
      'Histórico, filtros e busca',
    ],
    cta: 'Começar Grátis',
  },
  {
    name: 'Profissional',
    buyPrice: PROFISSIONAL_PRICE_YEARLY,
    rentPrice: PROFISSIONAL_PRICE_MONTHLY,
    highlight: true,
    badge: '⭐ Mais popular',
    features: [
      'Tudo do Core, sem limite de áudios',
      'Atendimento automático 24/7 por IA',
      'Fila de conversas + métricas + escalação',
      'Avisos ao cliente (cobrança, agendamento...)',
      'Base de conhecimento própria + resumo periódico',
    ],
  },
  {
    name: 'Empresas',
    buyPrice: EMPRESAS_PRICE_YEARLY,
    rentPrice: EMPRESAS_PRICE_MONTHLY,
    highlight: false,
    features: [
      'Tudo do Profissional',
      'CRM — funil de vendas no WhatsApp',
      'Tarefas — designação e controle na equipe',
      'Até 5 usuários com papéis',
      'Até 5 números WhatsApp',
    ],
  },
];

/* ── Landing por dor ────────────────────────────────────────────────────
   Override do hero por ?dor= na URL (anúncio/segmentação por dor específica).
   Só afeta badge/headline/sub do hero — o resto da página é mantido.
   Ex.: /vendas?dor=tempo   /dentistas?dor=esquecer
   ──────────────────────────────────────────────────────────────────────── */
const PAIN_VARIANTS: Record<string, Pick<Variant, 'badge' | 'headline' | 'sub'>> = {
  tempo: {
    badge: '⏱️ Recupere seu tempo',
    headline: 'Recupere as horas que você perde ouvindo áudio.',
    sub: 'O ZapScript converte cada áudio do WhatsApp em texto e resumo automático. Você lê em segundos o que levaria minutos para ouvir.',
  },
  'audios-longos': {
    badge: '🎤 Áudio de 5 minutos?',
    headline: 'Aquele áudio interminável? Leia em segundos.',
    sub: 'Transcrição completa + resumo com os pontos principais, sem precisar ouvir do começo ao fim. Direto no seu WhatsApp.',
  },
  esquecer: {
    badge: '📌 Nada se perde',
    headline: 'Nunca mais perca um detalhe importante de um áudio.',
    sub: 'Cada áudio vira texto pesquisável, com resumo dos pontos-chave. Endereço, valor, prazo — tudo registrado, fácil de achar depois.',
  },
  ocupado: {
    badge: '🤫 Ouça sem ouvir',
    headline: 'Sem tempo (ou silêncio) para ouvir áudio agora?',
    sub: 'Leia a transcrição na hora, em qualquer lugar — reunião, transporte, fila. O áudio volta em texto sozinho, direto no WhatsApp.',
  },
};

/* ── Componente principal ───────────────────────────────────────────── */
export default function LandingPageClient({ variant }: { variant: Variant }) {
  // Captura o ?aff= e remove o código da barra de endereços
  useEffect(() => { captureAffiliateFromUrl(); }, []);

  // Landing por dor: override do hero via ?dor= (client-side, não muda SEO)
  const [pain, setPain] = useState<Pick<Variant, 'badge' | 'headline' | 'sub'> | null>(null);
  useEffect(() => {
    try {
      const dor = new URLSearchParams(window.location.search).get('dor');
      if (dor && PAIN_VARIANTS[dor]) setPain(PAIN_VARIANTS[dor]);
    } catch { /* noop */ }
  }, []);
  const hero = pain ? { ...variant, ...pain } : variant;

  const faqs = variant.faqs ?? FAQS;
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const breadcrumbJsonLd = variant.slug ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
      { '@type': 'ListItem', position: 2, name: variant.breadcrumbLabel ?? variant.slug, item: `https://www.zapscript.me/${variant.slug}` },
    ],
  } : null;

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      {/* Schema.org FAQPage — rich snippets no Google */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      {breadcrumbJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      )}

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
        {/* Gradiente de fundo */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.12) 0%, transparent 70%)',
          }}
        />

        <div className="relative max-w-3xl mx-auto">
          {/* Badge dinâmico */}
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            {hero.badge}
          </div>

          {/* Headline dinâmica */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-5">
            {hero.headline}
          </h1>

          {/* Sub dinâmico */}
          <p className="text-lg sm:text-xl text-brand-muted leading-relaxed max-w-2xl mx-auto mb-8">
            {hero.sub}
          </p>

          {/* CTA principal */}
          <Link
            href={variant.ctaHref}
            data-cta="lp_hero_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-lg"
            style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3)' }}
          >
            {variant.cta}
            <span>→</span>
          </Link>

          <p className="mt-4 text-sm text-brand-muted">
            ✓ Grátis para começar &nbsp;·&nbsp; ✓ Sem cartão de crédito &nbsp;·&nbsp; ✓ Cancele quando quiser
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          DEMO VISUAL — antes e depois
      ════════════════════════════════════════════════════════════ */}
      <section className="py-10 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Antes */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-4">❌ Sem ZapScript</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-2xl">🎙️</span>
                  <div>
                    <div className="text-xs text-brand-muted mb-1">João • 3min 24s</div>
                    <div className="text-sm text-white">▶ Áudio &nbsp;———————</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-2xl">🎙️</span>
                  <div>
                    <div className="text-xs text-brand-muted mb-1">Cliente • 5min 12s</div>
                    <div className="text-sm text-white">▶ Áudio &nbsp;————————————</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-2xl">🎙️</span>
                  <div>
                    <div className="text-xs text-brand-muted mb-1">Maria • 2min 08s</div>
                    <div className="text-sm text-white">▶ Áudio &nbsp;——————</div>
                  </div>
                </div>
              </div>
              <p className="text-center text-brand-muted text-sm mt-4">~11 min para ouvir tudo 😩</p>
            </div>

            {/* Depois */}
            <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-2xl p-6">
              <p className="text-xs font-bold text-brand-primary uppercase tracking-widest mb-4">✅ Com ZapScript</p>
              <div className="space-y-3">
                <div className="bg-white/5 border border-white/8 rounded-xl px-4 py-3">
                  <div className="text-xs text-brand-muted mb-1.5">João • conversão automática</div>
                  <p className="text-sm text-white leading-relaxed">• Reunião confirmada sexta 14h<br/>• Traz o contrato assinado<br/>• Prefere sala 3</p>
                </div>
                <div className="bg-white/5 border border-white/8 rounded-xl px-4 py-3">
                  <div className="text-xs text-brand-muted mb-1.5">Cliente • resumo IA</div>
                  <p className="text-sm text-white leading-relaxed">• Aprovou a proposta ✓<br/>• Prazo: 20 dias (era 30)<br/>• Precisa confirmar até sexta</p>
                </div>
                <div className="bg-white/5 border border-white/8 rounded-xl px-4 py-3">
                  <div className="text-xs text-brand-muted mb-1.5">Maria • pontos principais</div>
                  <p className="text-sm text-white leading-relaxed">• Orçamento aprovado R$8k<br/>• Quer entrega em SP<br/>• Aguarda NF para pagar</p>
                </div>
              </div>
              <p className="text-center text-brand-primary text-sm font-semibold mt-4">~30 segundos para ler tudo ⚡</p>
            </div>
          </div>
          <p className="text-center text-brand-muted text-sm mt-6 max-w-xl mx-auto">
            Áudio é ótimo pra quem manda. <span className="text-white font-medium">Pra quem recebe, ler é melhor.</span>
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          NICHO — "Feito para …" (só renderiza se variant.pains existir)
      ════════════════════════════════════════════════════════════ */}
      {variant.audience && variant.pains && variant.pains.length > 0 && (
        <section className="py-14 px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
              Feito para <span className="text-brand-primary">{variant.audience}</span>
            </h2>
            <p className="text-brand-muted mb-10 max-w-xl mx-auto">
              Seu dia já tem áudio demais. Veja como o ZapScript resolve a sua rotina.
            </p>
            <div className="grid sm:grid-cols-3 gap-4 text-left">
              {variant.pains.map(({ icon, title, desc }) => (
                <div key={title} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                  <div className="text-3xl mb-3">{icon}</div>
                  <h3 className="font-semibold text-white mb-1.5 text-sm">{title}</h3>
                  <p className="text-brand-muted text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <Link
              href={variant.ctaHref}
              data-cta="lp_mid_cta"
              className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-base px-8 py-3.5 rounded-2xl hover:opacity-90 active:scale-95 transition-all mt-10"
              style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3)' }}
            >
              {variant.cta}
              <span>→</span>
            </Link>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════
          PROVA SOCIAL — números
      ════════════════════════════════════════════════════════════ */}
      <section className="py-10 px-4 border-y border-white/5 bg-white/2">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-6 text-center">
          {[
            { n: '95%+', label: 'Precisão em PT-BR', sub: 'Motor Whisper (OpenAI)' },
            { n: '<30s', label: 'Tempo de conversão', sub: 'Para áudios até 3 min' },
            { n: 'AES-256', label: 'Criptografia de dados', sub: 'Padrão bancário' },
          ].map(({ n, label, sub }) => (
            <div key={label}>
              <div className="text-3xl sm:text-4xl font-bold text-white mb-1">{n}</div>
              <div className="text-sm font-semibold text-brand-text mb-0.5">{label}</div>
              <div className="text-xs text-brand-muted">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          VEJA NA PRÁTICA — mockup real da conversa
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-white mb-2">Veja como aparece no seu WhatsApp</h2>
            <p className="text-brand-primary font-medium mb-1">O áudio chega e a transcrição + resumo voltam na mesma conversa, automaticamente.</p>
            <p className="text-brand-muted">Você lê em segundos o que levaria minutos ouvindo — sem abrir o áudio.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <ConversationDemo />
            <div className="space-y-5">
              {[
                { emoji: '📱', title: 'Conecte uma vez', desc: 'Escaneie o QR code no painel. Leva 1 minuto, sem instalar nada.' },
                { emoji: '🎤', title: 'Receba o áudio normalmente', desc: 'Nada muda no seu WhatsApp. O áudio chega como sempre.' },
                { emoji: '⚡', title: 'A transcrição volta sozinha', desc: 'Texto completo + resumo com IA aparecem na hora, na própria conversa.' },
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
          BENEFÍCIOS — 6 cards
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Tudo que você precisa, incluído</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '🤖', title: 'Conversão com IA', desc: 'Motor Whisper — 95%+ de precisão em português brasileiro, incluindo sotaques.' },
              { icon: '📋', title: 'Resumo em bullets', desc: 'Claude (Anthropic) extrai os 3–5 pontos mais importantes de cada áudio.' },
              { icon: '🔒', title: 'Modo Privado', desc: 'Leia o conteúdo do áudio sem marcar como "ouvido" para o remetente.' },
              { icon: '🔍', title: 'Histórico pesquisável', desc: 'Todas as conversões ficam salvas e pesquisáveis por palavras-chave.' },
              { icon: '🔗', title: 'Webhook & API', desc: 'Integre com CRM, Zapier ou Make via webhook automático (Executive).' },
              { icon: '🛡️', title: 'LGPD & Segurança', desc: 'AES-256-GCM, servidores em SP, conformidade LGPD, sem venda de dados.' },
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
          COMPARATIVO — ZapScript vs. Manual vs. Bots
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Por que ZapScript?</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-5 py-4 text-left text-brand-muted font-medium">Recurso</th>
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Manual</th>
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Bots (ViraTexto)</th>
                  <th className="px-5 py-4 text-center text-brand-primary font-bold bg-brand-primary/5">ZapScript ⚡</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ['100% automático',        '❌', '❌', '✅'],
                  ['Resumo por IA',           '❌', '⚠️ Básico', '✅ Claude'],
                  ['Modo privado',            '❌', '❌', '✅'],
                  ['Histórico pesquisável',   '❌', '❌', '✅'],
                  ['Sem encaminhar áudios',   '❌', '❌', '✅'],
                  ['Webhook / API',           '❌', '❌', '✅'],
                  ['Dados criptografados',    '—', '⚠️', '✅ AES-256'],
                  ['Servidores no Brasil',    '—', '❌', '✅ São Paulo'],
                ].map(([feature, manual, bots, zap]) => (
                  <tr key={feature} className="hover:bg-white/2 transition-colors">
                    <td className="px-5 py-3 text-white">{feature}</td>
                    <td className="px-5 py-3 text-center text-brand-muted">{manual}</td>
                    <td className="px-5 py-3 text-center text-brand-muted">{bots}</td>
                    <td className="px-5 py-3 text-center font-semibold bg-brand-primary/5">{zap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          DEPOIMENTOS — renderiza só quando houver
      ════════════════════════════════════════════════════════════ */}
      <Testimonials />

      {/* ════════════════════════════════════════════════════════════
          PLANOS — rápidos
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-3">Planos simples e transparentes</h2>
          <p className="text-brand-muted text-center mb-10">Comece grátis. Faça upgrade quando quiser — aluguel (mensal) ou compra (anual), via PIX ou cartão.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className={`rounded-2xl p-6 border ${plan.highlight
                  ? 'border-brand-primary bg-brand-primary/8 relative'
                  : 'border-white/10 bg-white/5'
                }`}
              >
                {plan.highlight && plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-primary text-black text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    {plan.badge}
                  </div>
                )}
                <h3 className="font-bold text-white mb-1">{plan.name}</h3>
                {'price' in plan ? (
                  <div className="flex items-baseline gap-1.5 mb-4 flex-wrap">
                    <span className="text-2xl font-bold text-white">{plan.price}</span>
                    <span className="text-brand-muted text-sm">{plan.period}</span>
                  </div>
                ) : (
                  <div className="mb-4" />
                )}
                <ul className="space-y-2 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className="text-brand-primary shrink-0 mt-0.5">✓</span>
                      <span className="text-brand-muted">{f}</span>
                    </li>
                  ))}
                </ul>
                {'price' in plan ? (
                  <Link
                    href="/cadastro"
                    data-cta={`lp_plano_${plan.name}`}
                    className={`block text-center font-semibold py-2.5 rounded-xl transition-all text-sm ${plan.highlight
                      ? 'bg-brand-primary text-black hover:opacity-90'
                      : 'bg-white/8 text-white border border-white/10 hover:bg-white/12'
                    }`}
                  >
                    {plan.cta}
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/cadastro?cycle=yearly"
                      data-cta={`lp_plano_${plan.name}_comprar`}
                      className={`block text-center font-semibold py-2.5 rounded-xl transition-all text-sm ${plan.highlight
                        ? 'bg-brand-primary text-black hover:opacity-90'
                        : 'bg-white/8 text-white border border-white/10 hover:bg-white/12'
                      }`}
                    >
                      Comprar por {plan.buyPrice}
                    </Link>
                    <Link
                      href="/cadastro?cycle=monthly"
                      data-cta={`lp_plano_${plan.name}_alugar`}
                      className="block text-center text-xs text-brand-muted hover:text-white transition-colors mt-2"
                    >
                      ou alugar por {plan.rentPrice}
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-brand-muted text-xs mt-6">
            Pagamento via PIX ou cartão de crédito · Cancele quando quiser · Sem fidelidade
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FAQ
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Perguntas frequentes</h2>
          <FAQAccordion items={faqs} />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          CTA FINAL — big, green, irresistível
      ════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(16,185,129,0.08) 0%, transparent 70%)',
          }}
        />
        <div className="relative max-w-xl mx-auto text-center">
          <div className="text-6xl mb-6">⚡</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight">
            Pronto para nunca mais ouvir áudio por obrigação?
          </h2>
          <p className="text-brand-muted text-lg mb-8">
            Junte-se a quem já automatizou a conversão de áudios do WhatsApp. Grátis para começar, sem cartão.
          </p>
          <Link
            href={variant.ctaHref}
            data-cta="lp_footer_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-xl px-12 py-5 rounded-2xl hover:opacity-90 active:scale-95 transition-all"
            style={{ boxShadow: '0 0 40px rgba(16,185,129,0.35)' }}
          >
            {variant.cta}
            <span>→</span>
          </Link>
          <p className="mt-5 text-sm text-brand-muted">
            ✓ Grátis &nbsp;·&nbsp; ✓ Sem cartão &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ LGPD
          </p>
          <PriceAnchor
            prefix="Plano Profissional por "
            compare
            className="block text-sm text-brand-muted mt-4"
            compareClassName="block text-xs text-brand-muted/70 mt-1"
          />
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
