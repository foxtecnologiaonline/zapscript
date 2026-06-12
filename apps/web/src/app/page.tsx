'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
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

/* ── Chat Demo — Veja como funciona ── */
const WAVE_HEIGHTS = [4,8,12,15,10,6,13,16,11,7,5,10,15,11,6,9,14,12,7,5,9,13];

function ChatDemo() {
  const [tab, setTab] = useState(0);
  const [phase, setPhase] = useState<0|1|2>(0); // 0=audio, 1=typing, 2=result
  const [bullets, setBullets] = useState(0);
  const [playing, setPlaying] = useState(false);
  const ex = EXAMPLES[tab];

  useEffect(() => {
    setPhase(0); setBullets(0); setPlaying(false);
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    const ts = [
      setTimeout(() => setPhase(1),   1800),
      setTimeout(() => setPhase(2),   3600),
      setTimeout(() => setBullets(1), 4700),
      setTimeout(() => setBullets(2), 5500),
      setTimeout(() => setBullets(3), 6300),
      setTimeout(() => setBullets(4), 7100),
    ];
    return () => ts.forEach(clearTimeout);
  }, [tab]);

  function togglePlay() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (playing) { window.speechSynthesis.cancel(); setPlaying(false); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(ex.transcript);
    utt.lang = 'pt-BR'; utt.rate = 1.05;
    utt.onend = () => setPlaying(false);
    utt.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utt);
    setPlaying(true);
  }

  // Avatar iniciais
  const initials = (s: string) => s.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 2a3 3 0 013 3v7a3 3 0 11-6 0V5a3 3 0 013-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/>
          </svg>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-primary))' }}>Demo ao vivo</p>
          <h2 className="font-display font-bold text-2xl tracking-tight">Veja como funciona</h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {EXAMPLES.map((e, i) => (
          <button key={i} onClick={() => setTab(i)}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              border: '1.5px solid',
              borderColor: tab === i ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
              background:  tab === i ? 'rgba(16,185,129,.1)' : 'transparent',
              color:       tab === i ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-secondary))',
              fontFamily:  'inherit', cursor: 'pointer',
            }}>{e.label}</button>
        ))}
      </div>

      {/* Chat window */}
      <div className="rounded-2xl overflow-hidden"
        style={{ border: '1.5px solid rgba(16,185,129,.22)', boxShadow: '0 8px 32px rgba(0,0,0,.35)' }}>

        {/* WA-style header */}
        <div className="flex items-center gap-3 px-4 py-3"
          style={{ background: '#0d2416', borderBottom: '1px solid rgba(16,185,129,.12)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Z</div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">ZapScript Bot</p>
            <p className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#10b981' }} />
              online
            </p>
          </div>
          <div className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>
            automático
          </div>
        </div>

        {/* Messages area */}
        <div className="px-4 pt-4 pb-3 flex flex-col gap-4"
          style={{ background: '#0a1d12', minHeight: 300 }}>

          {/* ── Received audio bubble ── */}
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: ex.avatarBg }}>
              {initials(ex.label)}
            </div>
            <div className="rounded-2xl rounded-bl-sm overflow-hidden max-w-[82%]"
              style={{ background: '#1e2d26', border: '1px solid rgba(255,255,255,.06)' }}>
              {/* Audio player row */}
              <div className="flex items-center gap-2.5 px-3 pt-3 pb-1">
                <button onClick={togglePlay}
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{ background: playing ? 'rgba(16,185,129,.3)' : 'rgba(16,185,129,.15)',
                           color: '#10b981', border: 'none', cursor: 'pointer' }}>
                  {playing
                    ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="4" height="10" rx="1"/><rect x="7" y="1" width="4" height="10" rx="1"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 1.5l9 4.5-9 4.5z"/></svg>
                  }
                </button>
                {/* Waveform bars */}
                <div className="flex items-center gap-[2px] flex-1">
                  {WAVE_HEIGHTS.map((h, i) => (
                    <div key={i} style={{
                      width: 2.5, height: h, borderRadius: 2,
                      background: playing ? '#10b981' : '#3d5248',
                      transformOrigin: 'center',
                      animation: playing
                        ? `waveBar ${0.45 + (i % 5) * 0.08}s ease ${(i * 0.028).toFixed(3)}s infinite alternate`
                        : 'none',
                    }} />
                  ))}
                </div>
                <span className="text-[11px] font-mono flex-shrink-0" style={{ color: '#6b7280' }}>1:23</span>
              </div>
              <p className="text-right text-[10px] pb-2 pr-3" style={{ color: '#4b5e56' }}>14:32</p>
            </div>
          </div>

          {/* ── Typing indicator ── */}
          {phase === 1 && (
            <div className="flex items-end gap-2" key="typing"
              style={{ animation: 'fadeInUp .3s ease both' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Z</div>
              <div className="rounded-2xl rounded-bl-sm px-4 py-3"
                style={{ background: '#083d22', border: '1px solid rgba(16,185,129,.15)' }}>
                <div className="flex items-center gap-1.5">
                  <div className="chat-typing-dot" style={{ animationDelay: '0s' }} />
                  <div className="chat-typing-dot" style={{ animationDelay: '.15s' }} />
                  <div className="chat-typing-dot" style={{ animationDelay: '.3s' }} />
                </div>
              </div>
            </div>
          )}

          {/* ── ZapScript result ── */}
          {phase === 2 && (
            <div className="flex items-end gap-2" key="result"
              style={{ animation: 'fadeInUp .4s ease both' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Z</div>
              <div className="rounded-2xl rounded-bl-sm px-4 py-3.5 max-w-[90%]"
                style={{ background: '#083d22', border: '1px solid rgba(16,185,129,.2)' }}>
                {/* Transcript */}
                <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#6ee7b7' }}>📝 Transcrição:</p>
                <p className="text-sm leading-relaxed italic" style={{ color: '#a7f3d0', fontStyle: 'italic' }}>
                  &ldquo;{ex.transcript.slice(0, 108)}&hellip;&rdquo;
                </p>
                {/* Bullets */}
                {bullets > 0 && (
                  <div className="mt-3 pt-3 space-y-2"
                    style={{ borderTop: '1px solid rgba(16,185,129,.12)' }}>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: '#6ee7b7' }}>🎯 Pontos-chave:</p>
                    {ex.bullets.slice(0, bullets).map((b, i) => (
                      <div key={i} className="flex items-start gap-2"
                        style={{ animation: 'fadeInUp .3s ease both' }}>
                        <span className="flex-shrink-0 text-sm leading-none mt-0.5" style={{ color: '#10b981' }}>✅</span>
                        <span className="text-xs leading-relaxed" style={{ color: '#d1fae5' }}>{b}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-right text-[10px] mt-2" style={{ color: '#0d4a29' }}>
                  14:32 · ZapScript ✓✓
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 text-center"
          style={{ background: '#071510', borderTop: '1px solid rgba(255,255,255,.04)' }}>
          <p className="text-[11px]" style={{ color: 'rgba(16,185,129,.5)' }}>
            ▶ Toque no play para ouvir o áudio real · Simulação em loop automático
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── FAQ ── */
const FAQ_ITEMS = [
  {
    q: 'Como o ZapScript funciona?',
    a: 'Você conecta seu número de WhatsApp ao ZapScript. A partir daí, qualquer áudio que você receber é automaticamente transcrito e resumido em tópicos usando IA. Você recebe o texto de volta no próprio WhatsApp, em segundos.',
  },
  {
    q: 'Meus áudios ficam armazenados?',
    a: 'Não. Os arquivos de áudio nunca são armazenados — são processados em memória e descartados imediatamente após a transcrição. Apenas o texto transcrito é salvo, criptografado com AES-256-GCM.',
  },
  {
    q: 'Funciona com qualquer conta do WhatsApp?',
    a: 'Sim, funciona com qualquer número de WhatsApp — pessoal ou empresarial. Você conecta escaneando um QR Code, sem precisar instalar nada no celular.',
  },
  {
    q: 'O que acontece quando os minutos acabam?',
    a: 'As transcrições são pausadas até o início do próximo ciclo mensal. Você recebe alertas por WhatsApp e e-mail ao atingir 50%, 80% e 100% do seu limite. Pode fazer upgrade a qualquer momento para continuar.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, sem multa e sem fidelidade. Você cancela diretamente pelo dashboard. O acesso continua até o fim do período já pago.',
  },
  {
    q: 'Em quais idiomas funciona?',
    a: 'O ZapScript transcreve áudios em qualquer idioma suportado pelo Whisper (português, inglês, espanhol e mais de 50 idiomas). Os resumos são exibidos no idioma detectado do áudio.',
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, i) => (
        <div key={i} className="card rounded-2xl overflow-hidden">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
              {item.q}
            </span>
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-transform"
              style={{
                background: 'rgb(var(--color-surface-elevated))',
                color: 'rgb(var(--color-primary))',
                transform: open === i ? 'rotate(45deg)' : 'none',
                transition: 'transform .2s ease',
              }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 1v8M1 5h8"/>
              </svg>
            </span>
          </button>
          {open === i && (
            <div className="px-5 pb-4" style={{ animation: 'fadeInUp .2s ease both' }}>
              <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                {item.a}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
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
    feats: [
      '20 min/mês',
      '1 número WhatsApp',
      '🎙️ Transcrição automática',
      '✨ Resumo com IA',
      '📋 Histórico de transcrições',
      '📅 Filtros por data e contato',
      '🔍 Busca por transcrição',
    ],
    excl: ['🖥️ Transcrição de áudios no site'],
    cta: 'Começar grátis', href: '/cadastro', popular: false, accent: null as string | null,
  },
  {
    name: 'pro', label: 'Pro', price: 'R$39,90', per: '/mês',
    desc: 'Para profissionais',
    feats: [
      '200 min/mês',
      '2 números WhatsApp',
      '🎙️ Transcrição automática',
      '🖥️ Transcrição de áudios no site',
      '✨ Resumo com IA',
      '📋 Histórico de transcrições',
      '📅 Filtros por data e contato',
      '🔍 Busca por transcrição',
      '📤 Exportar áudios em PDF, Docx, Csv e Excel',
      '📄 Transcrição Profissional (PDF com marcação temporal)',
      '🔒 Modo Privado de transcrição',
    ],
    excl: [],
    cta: 'Assinar Pro', href: '/cadastro', popular: true, accent: '#3b82f6' as string | null,
  },
  // Executive: legacy plan — mantido no sistema mas não exibido na LP
  {
    name: 'executive', label: 'Executive', price: 'R$49,90', per: '/mês',
    desc: 'Para uso profissional e privacidade total',
    feats: [
      '300 min/mês', '3 números WhatsApp',
      '🎙️ Transcrição automática', '🖥️ Transcrição de áudios no site',
      '✨ Resumo com IA', '📋 Histórico de transcrições',
      '📤 Exportação PDF · DOCX · CSV · XLS',
      '🔒 Modo Privado de transcrição',
    ],
    excl: [],
    cta: 'Assinar Executive', href: '/cadastro', popular: false, accent: null as string | null,
  },
];

/* ── Tabela comparativa ── */
type CmpVal = string | boolean;
const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Minutos/mês',                        vals: ['20', '200'] },
  { feature: 'Números WhatsApp',                   vals: ['1', '2'] },
  { feature: '🎙️ Transcrição automática',           vals: [true, true] },
  { feature: '✨ Resumo com IA',                    vals: [true, true] },
  { feature: '📋 Histórico de transcrições',        vals: [true, true] },
  { feature: '📅 Filtros por data e contato',       vals: [true, true] },
  { feature: '🔍 Busca por transcrição',             vals: [true, true] },
  { feature: '🖥️ Transcrição no site (upload)',     vals: [false, true] },
  { feature: '📤 Exportar áudios (PDF/Docx/Csv/Excel)', vals: [false, true] },
  { feature: '📄 Transcrição Profissional (PDF)',    vals: [false, true] },
  { feature: '🔒 Modo Privado de transcrição',       vals: [false, true] },
];

export default function HomePage() {
  // Planos — tabela comparativa
  const [showTable, setShowTable] = useState(false);


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
            <Image src="/logo.png" alt="ZapScript" width={148} height={32} className="object-contain object-left flex-1" style={{ minWidth: 0 }} />
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
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

        {/* ══ COMO FUNCIONA — 3 passos ══ */}
        <section className="px-5 pt-10 pb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-5 text-center"
            style={{ color: 'rgb(var(--color-primary))' }}>
            Como funciona
          </p>
          <div className="flex items-start justify-between gap-1">
            {[
              { icon: '🎙️', label: 'Receba o áudio',      sub: 'No WhatsApp' },
              { icon: '⚡',  label: 'IA processa',         sub: 'Em segundos' },
              { icon: '📄', label: 'Texto entregue',      sub: 'Na mesma conversa' },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-1 flex-1">
                {/* Seta entre steps */}
                {i > 0 && (
                  <div className="flex-shrink-0 mt-5 text-base" style={{ color: 'rgb(var(--color-text-muted))' }}>›</div>
                )}
                <div className="flex-1 flex flex-col items-center text-center">
                  {/* Ícone */}
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl mb-2 flex-shrink-0"
                    style={{ background: 'rgba(var(--color-primary)/.1)', border: '1px solid rgba(var(--color-primary)/.15)' }}>
                    {step.icon}
                  </div>
                  <p className="text-xs font-semibold leading-tight" style={{ color: 'rgb(var(--color-text))' }}>
                    {step.label}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
                    {step.sub}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {/* Linha visual conectando os passos */}
          <div className="relative mt-4 mb-1 h-px mx-6"
            style={{ background: 'linear-gradient(90deg, rgba(var(--color-primary)/.4), rgba(var(--color-primary)/.1))' }} />
        </section>

        {/* ══ FEATURES ══ */}
        <section className="relative z-10 py-10 px-5">
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

        {/* ══ CHAT DEMO ══ */}
        <section className="px-5 pb-16">
          <ChatDemo />
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

          {/* Cards — apenas Free e Pro (Executive mantido em legacy) */}
          <div className="flex flex-col gap-4">
            {PLANS.filter(p => p.name !== 'executive').map((plan, i) => {
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
                      {PLANS.filter(p => p.name !== 'executive').map(p => (
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

          {/* Em breve */}
          <div className="mt-10 rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(16,185,129,.18)' }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-4"
              style={{ background: 'rgba(16,185,129,.08)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(16,185,129,.2)' }}>
              🚀 EM BREVE
            </div>
            <h3 className="font-display font-bold text-xl leading-snug mb-2">
              Mais poder para seus áudios
            </h3>
            <p className="text-sm font-light mb-5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              + funcionalidades, + produtividade, + organização, + ZapScript
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { icon: '👥', label: 'Resumo de Grupos' },
                { icon: '✅', label: 'Tarefas e Planner de áudios' },
                { icon: '🗓️', label: 'Organização e Calendário' },
                { icon: '🔗', label: 'Integração com Sistemas' },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5"
                  style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ DEPOIMENTOS ══ */}
        <section className="px-5 pb-16">
          <div className="mb-7">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              Depoimentos
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">
              Quem já usa o ZapScript
            </h2>
          </div>
          <div className="flex flex-col gap-4">
            {[
              {
                text: 'Minha equipe recebia mais de 50 áudios por dia. Com o ZapScript, viramos texto em segundos. Triplicou nossa agilidade no atendimento ao cliente.',
                name: 'Fernanda S.',
                role: 'Advogada · São Paulo/SP',
                initials: 'FS',
                color: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              },
              {
                text: 'Antes eu ouvia o mesmo áudio três vezes para não perder nada. Agora leio o resumo em 10 segundos e sigo em frente. Mudou minha rotina de vendas.',
                name: 'Ricardo M.',
                role: 'Consultor Comercial · Campinas/SP',
                initials: 'RM',
                color: 'linear-gradient(135deg,#0ea5e9,#0d9488)',
              },
              {
                text: 'Trabalho com 4 executivos e cada um manda áudio o dia inteiro. O ZapScript organiza tudo em tópicos claros. Nunca mais perdi uma tarefa importante.',
                name: 'Camila T.',
                role: 'Assistente Executiva · Belo Horizonte/MG',
                initials: 'CT',
                color: 'linear-gradient(135deg,#10b981,#059669)',
              },
            ].map((d, i) => (
              <div key={i} className="card rounded-2xl p-5">
                <p className="text-sm leading-relaxed mb-4 font-light"
                  style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  "{d.text}"
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: d.color }}>
                    {d.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{d.name}</p>
                    <p className="text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>{d.role}</p>
                  </div>
                  <div className="ml-auto text-yellow-400 text-sm">★★★★★</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ FAQ ══ */}
        <section className="px-5 pb-16">
          <div className="mb-7">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              FAQ
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">
              Perguntas frequentes
            </h2>
          </div>
          <FaqSection />
        </section>

        {/* ══ FALE CONOSCO ══ */}
        <section className="px-5 pb-16">
          <div className="text-center mb-8">
            <span className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3"
              style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(16,185,129,.2)' }}>
              Suporte
            </span>
            <h2 className="font-display font-bold text-2xl tracking-tight mb-2">Fale Conosco</h2>
            <p className="text-sm font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Tem dúvidas, sugestões ou precisa de ajuda? Nossa equipe está aqui para você.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-lg mx-auto">
            {/* E-mail */}
            <a
              href="mailto:contato@zapscript.me"
              className="flex items-center gap-4 rounded-2xl p-5 border transition-all hover:scale-[1.02]"
              style={{
                background: 'rgb(var(--color-surface-elevated))',
                borderColor: 'rgb(var(--color-border))',
              }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M22 7l-10 7L2 7"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>E-mail</p>
                <p className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--color-primary))' }}>
                  contato@zapscript.me
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Resposta em até 24h</p>
              </div>
            </a>

            {/* Chat de suporte */}
            <button
              type="button"
              onClick={() => {
                const btn = document.querySelector<HTMLButtonElement>('[aria-label="Suporte"]');
                btn?.click();
              }}
              className="flex items-center gap-4 rounded-2xl p-5 border transition-all hover:scale-[1.02] text-left"
              style={{
                background: 'rgb(var(--color-surface-elevated))',
                borderColor: 'rgb(var(--color-border))',
              }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Chat ao vivo</p>
                <p className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>Abrir suporte</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Clique no ícone 💬 abaixo</p>
              </div>
            </button>
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
            © 2026 ZapScript v2.0 · FOX TecnologIA · Todos os direitos reservados.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))', opacity: 0.6 }}>
            Código-fonte, design e marca protegidos pela Lei nº 9.610/1998. Reprodução proibida.
          </p>
          <div className="flex justify-center gap-4 mt-3">
            {[['Termos', '/termos'], ['Privacidade', '/privacidade'], ['Contrato', '/contrato']].map(([l, href]) => (
              <Link key={l} href={href}
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
