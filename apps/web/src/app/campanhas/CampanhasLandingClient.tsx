'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggleButton } from '@/components/ThemeProvider';
import { AffiliateCapture } from '@/components/AffiliateCapture';
import { SupportChatButton } from '@/components/SupportChatButton';

const STEPS = [
  {
    n: '1',
    title: 'Conecte seu WhatsApp oficial',
    desc: 'Registre seu número no WhatsApp Business Platform da Meta — o mesmo canal oficial usado por grandes empresas. Não é QR Code.',
  },
  {
    n: '2',
    title: 'Escolha um template aprovado',
    desc: 'Selecione um modelo de mensagem já aprovado pela Meta no seu Gerenciador de Negócios. Sem template aprovado, não sai disparo — é a própria Meta quem exige isso.',
  },
  {
    n: '3',
    title: 'Suba sua lista de contatos',
    desc: 'Importe um CSV com telefone, nome e as variáveis da mensagem. Contatos que já pediram para não receber são ignorados automaticamente.',
  },
  {
    n: '4',
    title: 'Dispare e acompanhe',
    desc: 'Veja o status de cada contato em tempo real — enviado, entregue, lido ou falhou — e pause a campanha quando quiser.',
  },
];

const BENEFITS = [
  {
    icon: '🛡️',
    title: '100% oficial, sem risco de banimento',
    desc: 'Envio pela API oficial da Meta (WhatsApp Business Platform) — não é automação não autorizada nem bot via QR Code de terceiro.',
  },
  {
    icon: '🚫',
    title: 'Opt-out automático',
    desc: 'Quem responde PARAR, SAIR, STOP, CANCELAR ou UNSUBSCRIBE é excluído automaticamente de futuras campanhas — conforme a LGPD.',
  },
  {
    icon: '📊',
    title: 'Acompanhamento em tempo real',
    desc: 'Enviado, entregue, lido ou falhou — contato a contato, sem precisar adivinhar o resultado da campanha.',
  },
];

const COMPARISON = [
  { label: 'Risco de banimento do número', bot: 'Alto', manual: 'Nenhum', zap: 'Nenhum' },
  { label: 'Templates aprovados pela Meta', bot: 'Não', manual: '—', zap: 'Sim' },
  { label: 'Rastreamento de entrega', bot: 'Não', manual: 'Não', zap: 'Sim' },
  { label: 'Opt-out automático', bot: 'Manual', manual: 'Manual', zap: 'Automático' },
  { label: 'Escala', bot: 'Alta', manual: 'Baixa (um a um)', zap: 'Alta' },
];

const FAQS = [
  {
    q: 'O que aconteceu com os bots não autorizados no WhatsApp?',
    a: 'A Meta reforçou o combate a automações não autorizadas (fora da API oficial) usadas para disparo em massa — números que dependiam desse tipo de bot passaram a correr risco real de banimento.',
  },
  {
    q: 'O ZapScript Campanhas corre esse mesmo risco?',
    a: 'Não. O envio é feito pela API oficial da Meta (WhatsApp Business Platform) — a mesma usada por grandes empresas, com número registrado e mensagens em templates aprovados pela própria Meta.',
  },
  {
    q: 'O que são "templates aprovados"?',
    a: 'São modelos de mensagem cadastrados no Gerenciador de Negócios da Meta e aprovados antes de poder ser usados em disparos. É uma exigência da própria Meta para evitar spam — o ZapScript Campanhas busca e lista os templates já aprovados da sua conta.',
  },
  {
    q: 'Preciso conectar um número novo?',
    a: 'Você conecta um número ao WhatsApp Business Platform da Meta pelo fluxo oficial de cadastro — diferente da conexão por QR Code usada no ZapScript Core (conversão de áudio).',
  },
  {
    q: 'Como funciona o opt-out?',
    a: 'Contatos que respondem PARAR, SAIR, STOP, CANCELAR ou UNSUBSCRIBE são excluídos automaticamente de futuras campanhas, conforme a LGPD. Não é possível reverter manualmente — exige novo consentimento do contato.',
  },
  {
    q: 'Quanto custa?',
    a: 'R$59,90/mês pela plataforma ZapScript Campanhas. Tarifas de mensagem cobradas diretamente pela Meta (conforme categoria do template e política vigente) não estão incluídas nesse valor.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>{q}</span>
        <span
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full"
          style={{
            background: 'rgb(var(--color-surface-elevated))',
            color: 'rgb(var(--color-primary))',
            transform: open ? 'rotate(45deg)' : 'none',
            transition: 'transform .2s ease',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 1v8M1 5h8" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4" style={{ animation: 'fadeInUp .2s ease both' }}>
          <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>{a}</p>
        </div>
      )}
    </div>
  );
}

export default function CampanhasLandingClient() {
  return (
    <div className="min-h-screen bg-mesh font-sans text-brand-text overflow-x-hidden">
      <AffiliateCapture />

      <div className="landing-inner relative z-10 w-full max-w-[430px] sm:max-w-[500px] mx-auto bg-mesh min-h-screen">

        {/* ══ HEADER ══ */}
        <header className="relative pt-7 px-5 pb-14 overflow-hidden">
          <div className="absolute -top-10 -right-10 w-60 h-60 rounded-full blur-[90px] pointer-events-none"
            style={{ background: 'rgb(var(--color-primary)/.12)' }} />
          <div className="absolute bottom-0 -left-10 w-52 h-52 rounded-full blur-[70px] pointer-events-none"
            style={{ background: 'rgb(var(--color-accent)/.10)' }} />

          <div className="relative flex items-center gap-3 mb-7">
            <Link href="/" className="flex-1" style={{ minWidth: 0 }}>
              <Image src="/logo.png" alt="ZapScript" width={148} height={32} className="object-contain object-left" />
            </Link>
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <ThemeToggleButton />
            </div>
          </div>

          <div className="relative">
            <div className="mb-4">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(var(--color-primary-light)/.6)', color: 'rgb(var(--color-primary))' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(var(--color-primary))' }} />
                📣 ZapScript Campanhas — 100% oficial
              </span>
            </div>

            <h1 className="font-display font-bold leading-[1.06] tracking-tight mb-3"
              style={{ fontSize: 'clamp(28px, 8vw, 42px)' }}>
              <span className="text-brand-text">Chega de bot não autorizado.</span>{' '}
              <span className="text-gradient">Dispare em massa pela API oficial da Meta.</span>
            </h1>

            <p className="text-[15px] leading-relaxed mb-5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              A Meta reforçou o combate a automações não autorizadas — números que dependiam desses bots passam por risco real de banimento.
              O ZapScript Campanhas dispara pelo canal oficial: templates aprovados, entrega rastreada e opt-out automático.
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  <span>👋</span> Novo por aqui?
                </p>
                <Link href="/cadastro?utm_source=lp&utm_campaign=campanhas" data-cta="campanhas_hero_cadastro"
                  className="btn-primary w-full py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2">
                  Criar conta e conhecer
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
                <span className="block text-center text-xs mt-2 text-brand-muted">R$59,90/mês · sem taxa de adesão</span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
                <span className="text-[11px] font-medium select-none" style={{ color: 'rgb(var(--color-text-muted))' }}>ou</span>
                <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
              </div>

              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  <span>🔑</span> Já tem uma conta ZapScript?
                </p>
                <Link href="/dashboard/plano?add=campanhas" data-cta="campanhas_hero_contratar"
                  className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-80 active:scale-[.98]"
                  style={{
                    border: '1.5px solid rgb(var(--color-border))',
                    color: 'rgb(var(--color-text-secondary))',
                    background: 'rgb(var(--color-surface))',
                  }}>
                  Contratar o módulo Campanhas
                </Link>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-5">
              {['API oficial da Meta', 'Templates aprovados', 'Opt-out automático (LGPD)'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--color-primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </header>

        {/* ══ O QUE MUDOU ══ */}
        <section className="px-5 pt-2 pb-10">
          <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-accent)/.25)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgb(var(--color-accent))' }}>
              O que mudou
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Se o seu disparo em massa parou de funcionar ou seu número foi banido, o motivo provável é esse: automações não autorizadas
              deixaram de ser toleradas. A saída não é arriscar outro número da mesma forma — é migrar para o canal que a própria Meta reconhece
              como oficial.
            </p>
          </div>
        </section>

        {/* ══ COMO FUNCIONA ══ */}
        <section className="px-5 pb-10">
          <div className="mb-6">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>Como funciona</span>
            <h2 className="font-display text-2xl font-bold mt-2 leading-tight tracking-tight">Do CSV ao disparo, em 4 passos</h2>
          </div>
          <div className="space-y-4">
            {STEPS.map((s) => (
              <div key={s.n} className="card rounded-2xl p-5 flex gap-4 items-start">
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-display font-bold text-sm"
                  style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
                  {s.n}
                </div>
                <div>
                  <h3 className="font-display font-bold text-base mb-1 leading-tight">{s.title}</h3>
                  <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ BENEFÍCIOS ══ */}
        <section className="px-5 pb-10">
          <div className="mb-6">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>Por que oficial importa</span>
            <h2 className="font-display text-2xl font-bold mt-2 leading-tight tracking-tight">Feito para não colocar seu número em risco</h2>
          </div>
          <div className="space-y-4">
            {BENEFITS.map((f) => (
              <div key={f.title} className="card rounded-2xl p-5">
                <div className="flex gap-4 items-start">
                  <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center flex-shrink-0 text-xl"
                    style={{ background: 'rgba(16,185,129,.12)' }}>
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

        {/* ══ COMPARATIVO ══ */}
        <section className="px-5 pb-10">
          <div className="mb-6">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>Comparativo</span>
            <h2 className="font-display text-2xl font-bold mt-2 leading-tight tracking-tight">Bot não autorizado vs. manual vs. ZapScript</h2>
          </div>
          <div className="card rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                  <th className="text-left px-3 py-3 font-semibold" style={{ color: 'rgb(var(--color-text-secondary))' }}>Critério</th>
                  <th className="text-center px-2 py-3 font-semibold" style={{ color: 'rgb(var(--color-text-secondary))' }}>Bot não autorizado</th>
                  <th className="text-center px-2 py-3 font-semibold" style={{ color: 'rgb(var(--color-text-secondary))' }}>Manual</th>
                  <th className="text-center px-2 py-3 font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>ZapScript</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={row.label} style={{ borderTop: '1px solid rgb(var(--color-border-light))', background: i % 2 ? 'transparent' : 'rgba(0,0,0,.01)' }}>
                    <td className="px-3 py-3 font-medium" style={{ color: 'rgb(var(--color-text))' }}>{row.label}</td>
                    <td className="text-center px-2 py-3" style={{ color: 'rgb(var(--color-text-muted))' }}>{row.bot}</td>
                    <td className="text-center px-2 py-3" style={{ color: 'rgb(var(--color-text-muted))' }}>{row.manual}</td>
                    <td className="text-center px-2 py-3 font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>{row.zap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ══ PREÇO ══ */}
        <section id="preco" className="px-5 pb-10">
          <div className="mb-6">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>Investimento</span>
            <h2 className="font-display text-2xl font-bold mt-2 leading-tight tracking-tight">Um plano, sem pegadinha</h2>
          </div>
          <div className="rounded-3xl p-6 text-center"
            style={{ background: 'rgb(var(--color-surface))', border: '2px solid rgb(var(--color-primary))', boxShadow: 'var(--shadow-glow)' }}>
            <p className="text-sm font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>ZapScript Campanhas</p>
            <p className="font-display font-bold mt-2" style={{ fontSize: 'clamp(32px, 9vw, 44px)' }}>
              R$59,90<span className="text-base font-medium" style={{ color: 'rgb(var(--color-text-muted))' }}>/mês</span>
            </p>
            <ul className="text-sm text-left mt-5 space-y-2.5">
              {[
                'Envio pela API oficial da Meta (WhatsApp Business Platform)',
                'Busca automática dos seus templates aprovados',
                'Importação de contatos via CSV',
                'Acompanhamento de entrega em tempo real',
                'Opt-out automático por palavra-chave',
              ].map((li) => (
                <li key={li} className="flex items-start gap-2">
                  <svg className="flex-shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--color-primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <span style={{ color: 'rgb(var(--color-text-secondary))' }}>{li}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] mt-5 leading-relaxed" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Valor referente ao uso da plataforma ZapScript. Tarifas de mensagem cobradas diretamente pela Meta
              (conforme categoria do template e política vigente) não estão incluídas.
            </p>
            <Link href="/cadastro?utm_source=lp&utm_campaign=campanhas_preco" data-cta="campanhas_preco_cta"
              className="btn-primary w-full py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2 mt-6">
              Quero contratar
            </Link>
          </div>
        </section>

        {/* ══ FAQ ══ */}
        <section className="px-5 pb-16">
          <div className="mb-7">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>FAQ</span>
            <h2 className="font-display text-2xl font-bold mt-2 leading-tight tracking-tight">Perguntas frequentes</h2>
          </div>
          <div className="space-y-2">
            {FAQS.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
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
              Dúvidas sobre migração do seu número ou sobre templates aprovados? Nossa equipe ajuda.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-lg mx-auto">
            <a
              href="mailto:contato@zapscript.me"
              className="flex items-center gap-4 rounded-2xl p-5 border transition-all hover:scale-[1.02]"
              style={{ background: 'rgb(var(--color-surface-elevated))', borderColor: 'rgb(var(--color-border))' }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 7l-10 7L2 7" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>E-mail</p>
                <p className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--color-primary))' }}>contato@zapscript.me</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Resposta em até 24h</p>
              </div>
            </a>

            <SupportChatButton />
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
              <span className="text-2xl">📣</span>
            </div>
            <h2 className="font-display font-bold text-2xl mb-3 tracking-tight leading-tight">
              Volte a disparar em massa — do jeito que a Meta reconhece.
            </h2>
            <p className="text-base leading-relaxed mb-7 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Conecte seu WhatsApp oficial e crie sua primeira campanha ainda hoje.
            </p>
            <Link href="/cadastro?utm_source=lp&utm_campaign=campanhas_footer" data-cta="campanhas_footer_cadastro"
              className="btn-primary inline-flex items-center justify-center py-4 px-8 text-base gap-2">
              Criar conta e conhecer
            </Link>
            <span className="block text-sm mt-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>R$59,90/mês</span>
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
              <Link key={l} href={href} className="text-xs transition-colors hover:text-brand-text" style={{ color: 'rgb(var(--color-text-muted))' }}>
                {l}
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
