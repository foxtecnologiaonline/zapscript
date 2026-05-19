'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ThemeToggleButton } from '@/components/ThemeProvider';

/* ══════════════════════════════════════════════════════
   Landing Page — Clone fiel do zapscript-audio.youware.app
   Design: Space Grotesk + DM Sans | Dark theme padrão
   Max-width: 430px (mobile-first)
   Cores, layout, textos e efeitos extraídos do HTML original
══════════════════════════════════════════════════════ */

/* ── Rotating words ── */
const ROTATING_WORDS = ['Textos', 'Resumos', 'Tarefas', 'Insights'];

function RotatingText() {
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setIdx(i => (i + 1) % ROTATING_WORDS.length);
      setKey(k => k + 1);
    }, 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-block overflow-hidden" style={{ verticalAlign: 'bottom' }}>
      <span
        key={key}
        className="inline-block text-gradient font-bold"
        style={{ animation: 'rotateWordIn .45s cubic-bezier(.4,0,.2,1) both' }}
      >
        {ROTATING_WORDS[idx]}
      </span>
    </span>
  );
}

/* ── Feature cards — ícones e textos do original ── */
const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 013 3v7a3 3 0 11-6 0V5a3 3 0 013-3z"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/>
      </svg>
    ),
    iconBg: 'rgba(16,185,129,.15)', iconColor: 'rgb(52,211,153)',
    title: 'Transcrição Instantânea',
    desc: 'Converta áudios longos em texto em segundos com alta precisão.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
    ),
    iconBg: 'rgba(245,158,11,.15)', iconColor: 'rgb(245,158,11)',
    title: 'Resumos Inteligentes',
    desc: 'Receba os pontos principais de cada conversa de forma automática.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
        <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
      </svg>
    ),
    iconBg: 'rgba(139,92,246,.15)', iconColor: 'rgb(167,139,250)',
    title: 'Etiquetas de Prioridade',
    desc: 'Classifique seus áudios por prioridade (Alta, Média, Baixa) para focar no que importa.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
      </svg>
    ),
    iconBg: 'rgba(96,165,250,.15)', iconColor: 'rgb(96,165,250)',
    title: 'Exportação Direta',
    desc: 'Envie tarefas e insights diretamente para seu calendário ou lista de afazeres.',
  },
];

/* ── Example transcriptions — textos EXATOS do original ── */
const EXAMPLES = [
  {
    label: 'Voz Feminina',
    title: 'Voz Feminina - Gestão de Equipe',
    subtitle: 'Áudio enviado hoje',
    avatarBg: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    priority: { label: 'Alta Prioridade', color: '#ef4444', bg: 'rgba(239,68,68,.12)' },
    bullets: [
      'Definir procedimentos claros para a equipe seguir.',
      'Reuniões semanais de alinhamento para revisar processos.',
      'Reconhecer publicamente conquistas individuais.',
      'Criar um ambiente de feedback contínuo e positivo.',
    ],
    transcript: 'Oi, tudo bem? Então, eu queria conversar com você sobre os procedimentos do departamento. Eu acredito que a gente precisa padronizar algumas coisas, sabe? Primeiro, definir quem faz o quê, com checklists bem claros. Segunda coisa, toda semana a gente faz uma reuniãozinha de alinhamento, quinze minutos só, pra ver o que cada um fez e o que tá pendente. E o mais importante: reconhecer o trabalho da galera. Quando alguém faz um bom trabalho, eu gosto de mencionar no grupo, dar aquele feedback positivo. Isso motiva muito a equipe. E claro, sempre ficar aberto pra ouvir sugestões, porque quem tá na linha de frente muitas vezes tem as melhores ideias.',
  },
  {
    label: 'Voz Masculina',
    title: 'Voz Masculina - Organização Pessoal',
    subtitle: 'Áudio enviado hoje',
    avatarBg: 'linear-gradient(135deg,#0ea5e9,#0d9488)',
    priority: { label: 'Média Prioridade', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    bullets: [
      'Recebe muitos áudios no WhatsApp todos os dias.',
      'Dificuldade em organizar e acompanhar todas as tarefas.',
      'Precisa de uma forma de não perder informações importantes.',
      'Quer transformar áudios em tarefas organizadas.',
    ],
    transcript: 'E aí, brother, tudo bem? Cara, to meio perdido, sabe? É o seguinte, todo dia eu recebo uma avalanche de áudio no WhatsApp. Do trabalho, da família, dos amigos... É muita coisa, cara. Aí eu fico lá, ouço um áudio, anoto qualquer coisa, aí vem outro, aí eu esqueço o que o primeiro disse. Não consigo acompanhar, cara. Preciso muito de uma ferramenta que pegue esses áudio e transforme em texto, em tarefa, pra mim não perder nada, entende? Porque informação que entra por áudio às vezes se perde, né? Então se tiver como organizar isso, eu vou ganhar muito tempo.',
  },
];

/* ── Plans (manifesto) ── */
const PLANS = [
  {
    name: 'Grátis', price: 'R$0', per: '/mês',
    desc: 'Para experimentar',
    feats: ['10 min/mês', '1 número WhatsApp', 'Painel simples', 'Resumos e transcrições'],
    cta: 'Começar Grátis', href: '/cadastro', popular: false,
  },
  {
    name: 'Pro', price: 'R$29,90', per: '/mês',
    desc: 'Para profissionais',
    feats: ['200 min/mês', '2 números WhatsApp', 'Painel avançado', 'Resumos e transcrições', 'Alertas de consumo'],
    cta: 'Assinar Pro', href: '/cadastro', popular: true,
  },
  {
    name: 'Ultra', price: 'R$59,90', per: '/mês',
    desc: 'Para equipes',
    feats: ['500 min/mês', '3+ números WhatsApp', 'Painel avançado', 'Marcação de prioridade', 'Resumos e transcrições', 'Suporte prioritário'],
    cta: 'Assinar Ultra', href: '/cadastro', popular: false,
  },
];

export default function HomePage() {
  const [exTab, setExTab] = useState(0);
  const [contentTab, setContentTab] = useState<'resumo' | 'transcricao'>('resumo');
  const ex = EXAMPLES[exTab];

  return (
    <div className="min-h-screen bg-mesh font-sans text-brand-text overflow-x-hidden relative">
      {/* Fixed mesh overlay */}
      <div className="fixed inset-0 bg-mesh pointer-events-none" />

      <div className="relative z-10 max-w-mobile mx-auto">

        {/* ══ HEADER ══ */}
        <header className="relative pt-10 px-6 pb-28 overflow-hidden">
          {/* Glow orbs */}
          <div className="absolute top-0 right-0 -translate-y-1/3 translate-x-1/4 w-72 h-72 rounded-full blur-[100px]"
            style={{ background: 'rgb(var(--color-primary)/.10)' }} />
          <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 w-64 h-64 rounded-full blur-[80px]"
            style={{ background: 'rgb(var(--color-accent)/.10)' }} />

          {/* Nav */}
          <div className="flex items-center gap-3 mb-12" style={{ animation: 'fadeInUp .6s ease .1s both' }}>
            {/* Logo box */}
            <div className="w-11 h-11 bg-brand-primary rounded-2xl flex items-center justify-center shadow-glow-green">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
              </svg>
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-brand-text">ZapScript</span>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggleButton />
              <Link href="/login"
                className="w-10 h-10 rounded-xl border border-[rgba(var(--color-border-light))] flex items-center justify-center transition-all hover:scale-105"
                style={{ background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-text-secondary))' }}
                title="Entrar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
                </svg>
              </Link>
            </div>
          </div>

          {/* Hero */}
          <div>
            {/* Badge */}
            <div className="mb-5" style={{ animation: 'fadeInUp .6s ease .2s both' }}>
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide"
                style={{ background: 'rgba(var(--color-primary-light)/.6)', color: 'rgb(var(--color-primary))' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(var(--color-primary))' }} />
                Transcrição com IA
              </span>
            </div>

            {/* H1 */}
            <h1 className="font-display font-bold leading-[1.05] tracking-tight mb-6"
              style={{ fontSize: 'clamp(38px, 10vw, 52px)', animation: 'fadeInUp .6s ease .25s both' }}>
              <span className="text-brand-text">Transforme seus</span>{' '}
              <span className="text-gradient">áudios</span>{' '}
              <span className="text-brand-text">em</span>{' '}
              <RotatingText />
            </h1>

            {/* Subtitle */}
            <p className="text-lg leading-relaxed mb-10 max-w-[340px]"
              style={{ color: 'rgb(var(--color-text-secondary))', animation: 'fadeInUp .6s ease .3s both' }}>
              Transcrição automática, resumos inteligentes e etiquetas de prioridade. Tudo o que você precisa para não perder nada importante.
            </p>

            {/* CTAs */}
            <div className="flex flex-col gap-3.5" style={{ animation: 'fadeInUp .6s ease .35s both' }}>
              <Link href="/cadastro" className="btn-primary w-full py-4 px-8 text-lg flex items-center justify-center gap-2.5">
                Começar Agora
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
              <Link href="#planos" className="text-sm font-medium text-center py-2 transition-colors"
                style={{ color: 'rgb(var(--color-text-secondary))' }}>
                Ver planos e preços →
              </Link>
            </div>
          </div>
        </header>

        {/* ══ STATS GLASS CARD ══ */}
        <section className="relative z-20 -mt-14 px-6" style={{ animation: 'fadeInUp .6s ease .4s both' }}>
          <div className="max-w-mobile mx-auto">
            <div className="glass rounded-3xl p-5 border shadow-medium flex justify-around items-center"
              style={{ borderColor: 'rgb(var(--color-border-light))' }}>
              {[['10x', 'Mais rápido'], ['99%', 'Precisão'], ['PT-BR', 'Otimizado']].map(([val, lbl], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <div style={{ width: 1, height: 40, background: 'rgb(var(--color-border))', marginRight: 20 }} />}
                  <div className="text-center">
                    <p className="font-display text-xl font-bold text-brand-text">{val}</p>
                    <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{lbl}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ FEATURES ══ */}
        <section className="relative z-10 py-20 px-6">
          <div className="mb-14" style={{ animation: 'fadeInUp .6s ease both' }}>
            <span className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'rgb(var(--color-accent))' }}>
              Funcionalidades
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight">
              Por que usar o ZapScript?
            </h2>
          </div>
          <div className="space-y-5">
            {FEATURES.map((f, i) => (
              <div key={i} className="card rounded-2xl p-5 hover:-translate-y-0.5 hover:shadow-medium"
                style={{ borderRadius: '1rem' }}>
                <div className="flex gap-4 items-start">
                  <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center flex-shrink-0"
                    style={{ background: f.iconBg, color: f.iconColor }}>
                    {f.icon}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base mb-1.5 leading-tight">{f.title}</h3>
                    <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ PRIVACY BANNER ══ */}
        <section className="px-6 pb-10">
          <div className="rounded-2xl p-5 flex flex-col gap-3"
            style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.18)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🔒</span>
              <span className="font-display font-bold text-sm" style={{ color: 'rgb(var(--color-primary))' }}>
                Sua privacidade é prioridade
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {[
                { icon: '🚫', text: 'Áudio nunca armazenado' },
                { icon: '🔐', text: 'Transcrições criptografadas no banco' },
                { icon: '🤖', text: 'Processamento via Whisper (OpenAI) e Claude (Anthropic)' },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-2.5">
                  <span className="text-sm">{icon}</span>
                  <span className="text-xs font-medium" style={{ color: 'rgb(var(--color-text-secondary))' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ EXAMPLES ══ */}
        <section className="px-6 pb-20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2a3 3 0 013 3v7a3 3 0 11-6 0V5a3 3 0 013-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/></svg>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-primary))' }}>Exemplo real</p>
              <h2 className="font-display font-bold text-2xl tracking-tight">Veja como funciona</h2>
            </div>
          </div>

          {/* Tab switcher (Voz Feminina / Masculina) */}
          <div className="flex gap-2 mb-5">
            {EXAMPLES.map((e, i) => (
              <button key={i} onClick={() => { setExTab(i); setContentTab('resumo'); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  border: '1.5px solid',
                  borderColor: exTab === i ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
                  background:  exTab === i ? 'rgba(16,185,129,.1)' : 'transparent',
                  color:       exTab === i ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-secondary))',
                  fontFamily: 'inherit',
                }}>
                {e.label}
              </button>
            ))}
          </div>

          {/* Card */}
          <div className="card rounded-2xl p-5" key={exTab} style={{ animation: 'fadeInUp .3s ease both' }}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold font-display flex-shrink-0"
                style={{ background: ex.avatarBg }}>
                {ex.title[0]}
              </div>
              <div className="flex-1">
                <p className="font-display font-bold text-sm">{ex.title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{ex.subtitle}</p>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: ex.priority.bg, color: ex.priority.color }}>
                ● {ex.priority.label}
              </span>
            </div>

            {/* Resumo / Transcrição tabs */}
            <div className="flex p-1 rounded-xl mb-4" style={{ background: 'rgb(var(--color-surface-elevated))' }}>
              {(['resumo', 'transcricao'] as const).map(t => (
                <button key={t} onClick={() => setContentTab(t)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: contentTab === t ? 'rgb(var(--color-surface-elevated))' : 'transparent',
                    color: contentTab === t ? 'rgb(var(--color-text))' : 'rgb(var(--color-text-muted))',
                    border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                  }}>
                  {t === 'resumo' ? 'Resumo' : 'Transcrição'}
                </button>
              ))}
            </div>

            {contentTab === 'resumo' ? (
              <div className="space-y-2.5">
                {ex.bullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5 5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgb(var(--color-text-secondary))' }}>{b}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl p-4" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgb(var(--color-border-light))' }}>
                <p className="text-sm leading-relaxed font-light italic" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  "{ex.transcript}"
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ══ PLANS ══ */}
        <section id="planos" className="px-6 pb-20">
          <div className="mb-10">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              Planos
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">Escolha seu plano</h2>
            <p className="text-sm mt-2 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Comece grátis. Sem cartão de crédito.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {PLANS.map((plan, i) => (
              <div key={i} className="relative rounded-2xl p-6 border transition-all"
                style={{
                  background: plan.popular ? 'rgb(var(--color-surface-elevated))' : 'rgb(var(--color-surface))',
                  borderColor: plan.popular ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
                  boxShadow: plan.popular ? 'var(--shadow-glow), var(--shadow-md)' : 'var(--shadow-sm)',
                }}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-primary text-white text-[11px] font-bold px-3.5 py-1 rounded-full uppercase tracking-wide whitespace-nowrap">
                    Mais popular
                  </div>
                )}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-display font-bold text-lg">{plan.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.desc}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-display font-bold text-2xl" style={{ color: plan.popular ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text))' }}>
                      {plan.price}
                    </span>
                    <span className="text-xs ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.per}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 mb-5">
                  {plan.feats.map((f, fi) => (
                    <div key={fi} className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgb(var(--color-primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 7.5l3 3 7-7"/>
                      </svg>
                      <span className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>{f}</span>
                    </div>
                  ))}
                </div>
                <Link href={plan.href}
                  className="block w-full py-3 rounded-2xl text-sm font-semibold text-center transition-all"
                  style={{
                    background: plan.popular ? 'rgb(var(--color-primary))' : 'transparent',
                    border: plan.popular ? 'none' : `1.5px solid rgb(var(--color-border))`,
                    color: plan.popular ? '#fff' : 'rgb(var(--color-text))',
                    boxShadow: plan.popular ? 'rgba(16,185,129,.25) 0 4px 14px' : 'none',
                  }}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ══ CTA FINAL ══ */}
        <section className="px-6 pb-16">
          <div className="rounded-[1.75rem] p-8 text-center"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,.15) 0%, rgba(245,158,11,.08) 100%)',
              border: '1px solid rgba(16,185,129,.2)',
            }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <h2 className="font-display font-bold text-2xl mb-3 tracking-tight leading-tight">
              Pronto para organizar sua vida?
            </h2>
            <p className="text-base leading-relaxed mb-7 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Comece gratuitamente e descubra como o ZapScript pode transformar sua produtividade.
            </p>
            <Link href="/cadastro"
              className="btn-primary inline-flex items-center justify-center py-4 px-8 text-base gap-2">
              Começar Gratuitamente
            </Link>
          </div>
        </section>

        {/* ══ FOOTER ══ */}
        <footer className="px-6 py-6 border-t text-center" style={{ borderColor: 'rgb(var(--color-border))' }}>
          <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
            © 2026 ZapScript. Todos os direitos reservados.
          </p>
          <div className="flex justify-center gap-4 mt-3">
            {['Termos', 'Privacidade'].map(l => (
              <Link key={l} href={`/${l.toLowerCase()}`}
                className="text-xs transition-colors hover:text-brand-text"
                style={{ color: 'rgb(var(--color-text-muted))' }}>
                {l}
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
