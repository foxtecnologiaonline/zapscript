'use client';
import { useState } from 'react';
import Link from 'next/link';

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
}

/* ── FAQ Accordion ──────────────────────────────────────────────────── */
const FAQS = [
  {
    q: 'Precisa instalar algum app no celular?',
    a: 'Não. O ZapScript funciona em segundo plano — você conecta seu número via QR code uma única vez no painel web. Nada é instalado no celular. Funciona em qualquer celular Android ou iPhone.',
  },
  {
    q: 'Quanto tempo leva para receber a transcrição?',
    a: 'Em média 10 a 30 segundos após o áudio ser recebido. O tempo varia conforme a duração do áudio e a demanda do servidor, mas para áudios comuns (até 3 min) é praticamente instantâneo.',
  },
  {
    q: 'Meus dados estão seguros?',
    a: 'Sim. Todas as transcrições são criptografadas com AES-256-GCM — o mesmo padrão dos bancos. O áudio não fica armazenado — apenas o texto. Servidores em São Paulo, conformidade total com a LGPD.',
  },
  {
    q: 'O remetente sabe que eu transcreveu o áudio?',
    a: 'Não, se você ativar o Modo Privado. Com ele, a transcrição chega para você sem que o áudio seja marcado como "ouvido" na conversa original.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, a qualquer momento. Não há fidelidade ou multa. O cancelamento é feito pelo próprio painel em menos de 1 minuto.',
  },
];

function FAQAccordion() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {FAQS.map((faq, i) => (
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

/* ── Planos ─────────────────────────────────────────────────────────── */
const PLANS = [
  {
    name: 'Free',
    price: 'R$0',
    period: '/mês',
    highlight: false,
    features: [
      '20 min de transcrição/mês',
      '1 número conectado',
      'Transcrição automática',
      'Resumo por IA',
      'Histórico de transcrições',
      'Filtros por data e contato',
      'Busca por transcrição',
    ],
    cta: 'Começar Grátis',
  },
  {
    name: 'Pro',
    price: 'R$39,90',
    period: '/mês',
    highlight: true,
    badge: 'Mais popular',
    features: [
      '200 min de transcrição/mês',
      '2 números conectados',
      'Transcrição automática + áudios no site',
      'Resumo por IA',
      'Histórico, filtros e busca',
      'Exportar áudios em PDF, Docx, Csv e Excel',
      'Transcrição Profissional (PDF com marcação temporal)',
      'Notas Pessoais de Voz',
      'Modo Privado de transcrição',
    ],
    cta: 'Assinar Pro',
  },
  // Executive: plano legacy — não exibido na landing page
];

/* ── Componente principal ───────────────────────────────────────────── */
export default function LandingPageClient({ variant }: { variant: Variant }) {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

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
            {variant.badge}
          </div>

          {/* Headline dinâmica */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-5">
            {variant.headline}
          </h1>

          {/* Sub dinâmico */}
          <p className="text-lg sm:text-xl text-brand-muted leading-relaxed max-w-2xl mx-auto mb-8">
            {variant.sub}
          </p>

          {/* CTA principal */}
          <Link
            href={variant.ctaHref}
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
                  <div className="text-xs text-brand-muted mb-1.5">João • transcrição automática</div>
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
            { n: '<30s', label: 'Tempo de transcrição', sub: 'Para áudios até 3 min' },
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
          COMO FUNCIONA — 3 passos
      ════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-2">Como funciona</h2>
          <p className="text-brand-muted mb-12">Pronto em menos de 2 minutos. Sem instalar nada.</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { step: '1', emoji: '📱', title: 'Crie sua conta', desc: 'Cadastro em 30 segundos. Sem cartão de crédito.' },
              { step: '2', emoji: '🔗', title: 'Conecte seu número', desc: 'Escaneie o QR code no painel. Leva 1 minuto.' },
              { step: '3', emoji: '⚡', title: 'Receba as transcrições', desc: 'Cada áudio vira texto + resumo automaticamente.' },
            ].map(({ step, emoji, title, desc }) => (
              <div key={step} className="relative">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 h-full">
                  <div className="w-8 h-8 rounded-full bg-brand-primary/20 border border-brand-primary/30 text-brand-primary text-sm font-bold flex items-center justify-center mb-4 mx-auto">
                    {step}
                  </div>
                  <div className="text-4xl mb-3">{emoji}</div>
                  <h3 className="font-bold text-white mb-2">{title}</h3>
                  <p className="text-brand-muted text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
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
              { icon: '🤖', title: 'Transcrição com IA', desc: 'Motor Whisper — 95%+ de precisão em português brasileiro, incluindo sotaques.' },
              { icon: '📋', title: 'Resumo em bullets', desc: 'Claude (Anthropic) extrai os 3–5 pontos mais importantes de cada áudio.' },
              { icon: '🔒', title: 'Modo Privado', desc: 'Leia o conteúdo do áudio sem marcar como "ouvido" para o remetente.' },
              { icon: '🔍', title: 'Histórico pesquisável', desc: 'Todas as transcrições ficam salvas e pesquisáveis por palavras-chave.' },
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
          PLANOS — rápidos
      ════════════════════════════════════════════════════════════ */}
      <section className="py-12 px-4 bg-white/2 border-y border-white/5">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-3">Planos simples e transparentes</h2>
          <p className="text-brand-muted text-center mb-10">Comece grátis. Faça upgrade quando quiser.</p>
          <div className="grid sm:grid-cols-2 gap-4 max-w-xl mx-auto">
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
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-2xl font-bold text-white">{plan.price}</span>
                  <span className="text-brand-muted text-sm">{plan.period}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className="text-brand-primary shrink-0 mt-0.5">✓</span>
                      <span className="text-brand-muted">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/cadastro"
                  className={`block text-center font-semibold py-2.5 rounded-xl transition-all text-sm ${plan.highlight
                    ? 'bg-brand-primary text-black hover:opacity-90'
                    : 'bg-white/8 text-white border border-white/10 hover:bg-white/12'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          {/* Empresas teaser */}
          <div className="max-w-xl mx-auto mt-4 rounded-2xl border border-white/10 bg-white/3 px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-brand-muted">Em breve</span>
              <p className="font-bold text-white">🏢 Plano Empresas</p>
              <p className="text-xs text-brand-muted mt-0.5">Multi-usuário · Webhook · Para times e agências</p>
            </div>
            <span className="shrink-0 text-xs border border-white/15 text-brand-muted rounded-full px-3 py-1">Em breve</span>
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
          <FAQAccordion />
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
            Junte-se a quem já automatizou a transcrição de áudios do WhatsApp. Grátis para começar, sem cartão.
          </p>
          <Link
            href={variant.ctaHref}
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-xl px-12 py-5 rounded-2xl hover:opacity-90 active:scale-95 transition-all"
            style={{ boxShadow: '0 0 40px rgba(16,185,129,0.35)' }}
          >
            {variant.cta}
            <span>→</span>
          </Link>
          <p className="mt-5 text-sm text-brand-muted">
            ✓ Grátis &nbsp;·&nbsp; ✓ Sem cartão &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ LGPD
          </p>
        </div>
      </section>

      {/* ── Footer mínimo ────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-6 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-brand-muted">
          <span>© 2026 ZapScript · FOX TecnologIA · CNPJ: XX.XXX.XXX/0001-XX</span>
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
