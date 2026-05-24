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

/* ── Feature cards ── */
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
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
    ),
    iconBg: 'rgba(245,158,11,.15)', iconColor: 'rgb(245,158,11)',
    title: 'Ponto Chave',
    desc: 'Receba automaticamente o ponto principal de cada áudio — direto e objetivo.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
    ),
    iconBg: 'rgba(16,185,129,.10)', iconColor: 'rgb(52,211,153)',
    title: 'Privacidade',
    desc: 'Áudio nunca armazenado. Transcrições criptografadas no banco. Processamento via Whisper (OpenAI) e Claude (Anthropic).',
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

/* ── Plans ── */
const PLANS = [
  {
    name: 'free', label: 'Free', price: 'R$0', per: '/mês',
    desc: 'Para experimentar',
    feats: ['20 min/mês', '1 número WhatsApp', 'Transcrição automática', 'Ponto chave IA'],
    excl: ['Agenda Automática', 'Modo privado'],
    cta: 'Começar grátis', href: '/cadastro', popular: false, accent: null as string | null,
  },
  {
    name: 'pro', label: 'Pro', price: 'R$29,90', per: '/mês',
    desc: 'Para profissionais',
    feats: ['150 min/mês', '2 números WhatsApp', 'Transcrição automática', 'Ponto chave IA'],
    excl: ['Agenda Automática', 'Modo privado'],
    cta: 'Assinar Pro', href: '/cadastro', popular: false, accent: '#3b82f6' as string | null,
  },
  {
    name: 'ultra', label: 'Ultra', price: 'R$59,90', per: '/mês',
    desc: 'Para profissionais avançados',
    feats: ['300 min/mês', '3 números WhatsApp', 'Transcrição automática', 'Ponto chave IA', '✨ Agenda Automática'],
    excl: ['Modo privado'],
    cta: 'Assinar Ultra', href: '/cadastro', popular: true, accent: null as string | null,
  },
  {
    name: 'executive', label: 'Executive', price: 'R$89,90', per: '/mês',
    desc: 'Para líderes e executivos',
    feats: ['500 min/mês', '5 números WhatsApp', 'Transcrição automática', 'Ponto chave IA', 'Agenda Automática', '🔒 Modo privado'],
    excl: [],
    cta: 'Assinar Executive', href: '/cadastro', popular: false, accent: '#f59e0b' as string | null,
  },
];

/* ── Tabela comparativa ── */
type CmpVal = string | boolean;
const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Minutos/mês',              vals: ['20', '150', '300', '500'] },
  { feature: 'Números WhatsApp',          vals: ['1', '2', '3', '5'] },
  { feature: 'Transcrição automática',    vals: [true, true, true, true] },
  { feature: 'Ponto chave IA',            vals: [true, true, true, true] },
  { feature: '🔍 Busca full-text',        vals: [false, true, true, true] },
  { feature: '📤 Exportação CSV',         vals: [false, true, true, true] },
  { feature: '🏷️ Tags & Categorias',     vals: [false, false, true, true] },
  { feature: '🌐 Tradução automática',    vals: [false, false, true, true] },
  { feature: '🔗 Webhook personalizado', vals: [false, false, false, true] },
  { feature: '🔒 Modo privado',           vals: [false, false, false, true] },
  { feature: 'Agenda Automática',         vals: [false, false, true, true] },
];

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export default function HomePage() {
  const [exTab, setExTab] = useState(0);
  const [contentTab, setContentTab] = useState<'resumo' | 'transcricao'>('resumo');
  const ex = EXAMPLES[exTab];

  // Planos — tabela comparativa + Para Empresas
  const [showTable, setShowTable] = useState(false);
  const [empresasForm, setEmpresasForm] = useState({ whatsappNumbers: '', audiosPerMonth: '', integrations: '', email: '' });
  const [empresasLoading, setEmpresasLoading] = useState(false);
  const [empresasSent, setEmpresasSent] = useState(false);
  const [empresasErr, setEmpresasErr] = useState('');

  async function handleEmpresasSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmpresasLoading(true);
    setEmpresasErr('');
    try {
      const res = await fetch(`${API_BASE}/support/enterprise-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(empresasForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar.');
      setEmpresasSent(true);
    } catch (err: any) {
      setEmpresasErr(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setEmpresasLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mesh font-sans text-brand-text overflow-x-hidden">

      <div className="landing-inner relative z-10 w-full max-w-[430px] sm:max-w-[500px] mx-auto bg-mesh min-h-screen">

        {/* ══ HEADER ══ */}
        <header className="relative pt-7 px-5 pb-16 overflow-hidden">
          {/* Glow orbs — contidos dentro do header */}
          <div className="absolute -top-10 -right-10 w-60 h-60 rounded-full blur-[90px] pointer-events-none"
            style={{ background: 'rgb(var(--color-primary)/.12)' }} />
          <div className="absolute bottom-0 -left-10 w-52 h-52 rounded-full blur-[70px] pointer-events-none"
            style={{ background: 'rgb(var(--color-accent)/.10)' }} />

          {/* Nav */}
          <div className="relative flex items-center gap-3 mb-7" style={{ animation: 'fadeInUp .6s ease .1s both' }}>
            <div className="w-10 h-10 bg-brand-primary rounded-2xl flex items-center justify-center shadow-glow-green flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
              </svg>
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-brand-text">ZapScript</span>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggleButton />
            </div>
          </div>

          {/* Hero */}
          <div className="relative">
            {/* Badge */}
            <div className="mb-4" style={{ animation: 'fadeInUp .6s ease .2s both' }}>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(var(--color-primary-light)/.6)', color: 'rgb(var(--color-primary))' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(var(--color-primary))' }} />
                Transcrição com IA
              </span>
            </div>

            {/* H1 */}
            <h1 className="font-display font-bold leading-[1.06] tracking-tight mb-3"
              style={{ fontSize: 'clamp(30px, 8.5vw, 44px)', animation: 'fadeInUp .6s ease .25s both' }}>
              <span className="text-brand-text">Transforme seus</span>{' '}
              <span className="text-gradient">áudios</span>{' '}
              <span className="text-brand-text">em</span>{' '}
              <RotatingText />
            </h1>

            {/* Subtitle */}
            <p className="text-[15px] leading-relaxed mb-5"
              style={{ color: 'rgb(var(--color-text-secondary))', animation: 'fadeInUp .6s ease .3s both' }}>
              Transcrição automática e ponto chave para você não perder nada importante.
            </p>

            {/* ── CTAs ── */}
            <div className="flex flex-col gap-3" style={{ animation: 'fadeInUp .6s ease .35s both' }}>

              {/* PRIMARY — Começar */}
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium mb-2"
                  style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  <span>👋</span> Novo por aqui?
                </p>
                <Link href="/cadastro"
                  className="btn-primary w-full py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2">
                  Começar Agora
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </Link>
              </div>

              {/* Divisor "ou" */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
                <span className="text-[11px] font-medium select-none" style={{ color: 'rgb(var(--color-text-muted))' }}>ou</span>
                <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
              </div>

              {/* SECONDARY — Login */}
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium mb-2"
                  style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  <span>🔑</span> Já tem uma conta?
                </p>
                <Link href="/login"
                  className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-80 active:scale-[.98]"
                  style={{
                    border: '1.5px solid rgb(var(--color-border))',
                    color: 'rgb(var(--color-text-secondary))',
                    background: 'rgb(var(--color-surface))',
                  }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
                  </svg>
                  Entrar na minha conta
                </Link>
              </div>

            </div>
          </div>
        </header>

        {/* ══ STATS GLASS CARD ══ */}
        <section className="relative z-20 -mt-10 px-5" style={{ animation: 'fadeInUp .6s ease .4s both' }}>
          <div className="w-full">
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
        <section className="relative z-10 py-16 px-5">
          <div className="mb-8" style={{ animation: 'fadeInUp .6s ease both' }}>
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

        {/* ══ EXAMPLES ══ */}
        <section className="px-5 pb-16">
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

        {/* ══ PLANS — Opção 3 Híbrido ══ */}
        <section id="planos" className="px-5 pb-16">
          <div className="mb-8">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              Planos
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">Escolha seu plano</h2>
            <p className="text-sm mt-2 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Comece grátis. Sem cartão de crédito.
            </p>
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-4">
            {PLANS.map((plan, i) => {
              const borderCol = plan.popular
                ? 'rgb(var(--color-primary))'
                : plan.accent ? plan.accent + '55' : 'rgb(var(--color-border))';
              const priceCol = plan.popular
                ? 'rgb(var(--color-primary))'
                : plan.accent || 'rgb(var(--color-text))';
              return (
                <div key={i} className="relative rounded-2xl p-6 border transition-all"
                  style={{
                    background:  plan.popular ? 'rgb(var(--color-surface-elevated))' : 'rgb(var(--color-surface))',
                    borderColor: borderCol,
                    boxShadow:   plan.popular ? 'var(--shadow-glow), var(--shadow-md)' : 'var(--shadow-sm)',
                  }}>
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-[11px] font-bold px-3.5 py-1 rounded-full uppercase tracking-wide whitespace-nowrap"
                      style={{ background: 'rgb(var(--color-primary))' }}>
                      ⭐ Mais popular
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-display font-bold text-lg">{plan.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.desc}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-display font-bold text-2xl" style={{ color: priceCol }}>{plan.price}</span>
                      <span className="text-xs ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.per}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 mb-5">
                    {plan.feats.map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          stroke={plan.popular ? 'rgb(var(--color-primary))' : plan.accent || 'rgb(var(--color-primary))'}>
                          <path d="M2 7.5l3 3 7-7"/>
                        </svg>
                        <span className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>{f}</span>
                      </div>
                    ))}
                    {plan.excl.map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2" style={{ opacity: 0.35 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgb(var(--color-text-muted))" strokeWidth="2" strokeLinecap="round">
                          <path d="M3 3l8 8M11 3l-8 8"/>
                        </svg>
                        <span className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>{f}</span>
                      </div>
                    ))}
                  </div>
                  <Link href={plan.href}
                    className="block w-full py-3 rounded-2xl text-sm font-semibold text-center transition-all"
                    style={{
                      background:  plan.popular ? 'rgb(var(--color-primary))' : 'transparent',
                      border:      plan.popular ? 'none' : `1.5px solid ${plan.accent || 'rgb(var(--color-border))'}`,
                      color:       plan.popular ? '#fff' : plan.accent || 'rgb(var(--color-text))',
                      boxShadow:   plan.popular ? 'rgba(16,185,129,.25) 0 4px 14px' : 'none',
                    }}>
                    {plan.cta}
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Toggle tabela comparativa */}
          <button
            onClick={() => setShowTable(v => !v)}
            className="w-full mt-5 py-3 rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
            style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-secondary))', background: 'transparent' }}>
            {showTable ? 'Ocultar comparativo ↑' : 'Comparar todos os recursos ↓'}
          </button>

          {showTable && (
            <div className="mt-3 rounded-2xl overflow-hidden" style={{ border: '1px solid rgb(var(--color-border))' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[340px]" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                      <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'rgb(var(--color-text-muted))' }}>Recurso</th>
                      {PLANS.map(p => (
                        <th key={p.name} className="px-3 py-3 text-[11px] font-bold text-center"
                          style={{ color: p.popular ? 'rgb(var(--color-primary))' : p.accent || 'rgb(var(--color-text-secondary))' }}>
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TABLE_ROWS.map((row, ri) => (
                      <tr key={ri} style={{ borderTop: '1px solid rgb(var(--color-border-light))' }}>
                        <td className="px-4 py-3 text-xs font-medium" style={{ color: 'rgb(var(--color-text-secondary))' }}>{row.feature}</td>
                        {row.vals.map((v, vi) => (
                          <td key={vi} className="px-3 py-3 text-center text-xs">
                            {typeof v === 'boolean' ? (
                              v
                                ? <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>
                                : <span style={{ color: 'rgb(var(--color-text-muted))', opacity: .4 }}>✗</span>
                            ) : (
                              <span className="font-mono font-bold" style={{ color: 'rgb(var(--color-text))' }}>{v}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Para Empresas */}
          <div className="mt-10 rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(245,158,11,.25)' }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-5"
              style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.2)' }}>
              🏢 PARA EMPRESAS
            </div>
            <h3 className="font-display font-bold text-xl leading-snug mb-2">
              Precisa de mais?<br />Monte seu plano.
            </h3>
            <p className="text-sm font-light mb-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Times maiores, volumes customizados, integrações específicas — montamos uma proposta no tamanho certo para o seu negócio.
            </p>
            <div className="flex flex-col gap-2 mb-6">
              {['Múltiplos Usuários', 'Múltiplos Números', 'Volume Ajustável de Minutos', 'Integrações customizadas (CRM, ERP, Outlook, Google Calendar)'].map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  <span style={{ color: '#f59e0b' }}>✓</span> {f}
                </div>
              ))}
            </div>

            {empresasSent ? (
              <div className="rounded-xl py-8 text-center" style={{ background: 'rgba(16,185,129,.05)', border: '1px solid rgba(16,185,129,.15)' }}>
                <div className="text-3xl mb-2">✅</div>
                <div className="font-bold text-sm" style={{ color: 'rgb(var(--color-primary))' }}>Proposta solicitada!</div>
                <div className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>Respondemos em até 24h</div>
              </div>
            ) : (
              <form onSubmit={handleEmpresasSubmit} className="flex flex-col gap-3">
                {([
                  { key: 'whatsappNumbers', label: 'Números de WhatsApp', placeholder: 'Quantos números você precisa?', type: 'text' },
                  { key: 'audiosPerMonth',  label: 'Recebe em média quantos áudios por mês?', placeholder: 'Ex: 500 áudios por mês', type: 'text' },
                  { key: 'integrations',   label: 'Precisa de integração com algum sistema?', placeholder: 'Ex: Google Calendar, Salesforce, ERP...', type: 'text' },
                  { key: 'email',          label: 'E-mail corporativo', placeholder: 'voce@empresa.com.br', type: 'email' },
                ] as { key: keyof typeof empresasForm; label: string; placeholder: string; type: string }[]).map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                      {field.label}
                    </label>
                    <input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={empresasForm[field.key]}
                      onChange={e => setEmpresasForm(f => ({ ...f, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                      style={{
                        background: 'rgb(var(--color-surface))',
                        border: '1.5px solid rgb(var(--color-border))',
                        color: 'rgb(var(--color-text))',
                      }}
                      required={field.key === 'email'}
                    />
                  </div>
                ))}
                {empresasErr && (
                  <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{empresasErr}</p>
                )}
                <button type="submit" disabled={empresasLoading}
                  className="w-full py-3 rounded-xl font-semibold text-sm transition-all mt-1 disabled:opacity-60"
                  style={{ background: '#f59e0b', color: '#1c1204' }}>
                  {empresasLoading ? 'Enviando...' : 'Receber proposta comercial →'}
                </button>
                <p className="text-center text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  Respondemos em até 24h · Sem compromisso
                </p>
              </form>
            )}
          </div>
        </section>

        {/* ══ CTA FINAL ══ */}
        <section className="px-5 pb-14">
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
        <footer className="px-5 py-8 border-t text-center" style={{ borderColor: 'rgb(var(--color-border))' }}>
          <p className="text-xs font-medium" style={{ color: 'rgb(var(--color-text-muted))' }}>
            © 2026 ZapScript · FOX TecnologIA · Todos os direitos reservados.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))', opacity: 0.6 }}>
            Código-fonte, design e marca protegidos pela Lei nº 9.610/1998. Reprodução proibida.
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
