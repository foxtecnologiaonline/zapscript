'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

/* ─────────────────────────────────────────────────────────────────
   OnboardingBanner — Hero progressivo de ativação
   Exibido enquanto activeNumbers === 0.
   Guia o usuário em 3 checkpoints: Conta → Número → Áudio.
   Inclui drawer lateral com passo a passo + accordion de erros.
───────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'zs_onboarding_dismissed';

/* ── Erros e soluções ─────────────────────────────────────────── */
const TROUBLESHOOT = [
  {
    q: 'O código de conexão não aparece',
    a: [
      'Aguarde alguns segundos — o código de 8 dígitos é gerado automaticamente ao abrir a conexão.',
      'Se não aparecer, feche e abra a janela de conexão novamente.',
      'Você também pode tocar em "Gerar QR Code" e escanear com a câmera do WhatsApp.',
    ],
  },
  {
    q: 'O WhatsApp mostra "localização suspeita"',
    a: [
      'É normal e esperado em plataformas de automação — basta confirmar a conexão.',
      'O aviso acontece porque o WhatsApp identifica IPs de servidores em nuvem, independente do país.',
      'Sua conexão é segura: nenhuma mensagem sua é lida além dos áudios que você envia para converter.',
    ],
  },
  {
    q: 'Conectei o número mas o áudio não chega',
    a: [
      'Confirme que o status aparece como "Conectado" (verde) no painel de Números.',
      'Envie o áudio para o MESMO número que você conectou — não para outro contato.',
      'Se ainda não chegar, clique em "Reconectar" no painel de Números.',
    ],
  },
  {
    q: 'Número banido ou bloqueado pelo WhatsApp',
    a: [
      'Use um número de chip físico ativo (não VoIP ou número virtual).',
      'Prefira números com histórico de uso normal — números recém-ativados têm mais risco.',
      'Se o número foi banido: aguarde 24–48h e considere usar um número diferente.',
      'Evite enviar mensagens em massa ou comportamento automatizado excessivo.',
    ],
  },
  {
    q: '"Número já cadastrado" ao tentar conectar',
    a: [
      'Este número já está registrado em outra conta do ZapScript.',
      'Se é sua conta anterior, entre em contato com o suporte para transferência: suporte@zapscript.me',
    ],
  },
  {
    q: 'Status fica em "Conectando..." sem avançar',
    a: [
      'Aguarde até 30 segundos e recarregue a página.',
      'Confirme que você digitou o código completo no WhatsApp do celular.',
      'Se o problema persistir, clique em "Reconectar" ou fale com o suporte: suporte@zapscript.me',
    ],
  },
];

/* ── Passo a passo (fluxo único e guiado) ───────────────────────────
   O ZapScript já hospeda toda a infraestrutura. O usuário NÃO escolhe
   provedor nem informa URL/API Key — apenas conecta o WhatsApp dele. */
const STEPS = [
  {
    num: '1',
    title: 'Abra "Números" e clique em "Conectar novo número"',
    body: 'Dê um nome para identificar o aparelho (ex: "Meu WhatsApp" ou "Comercial"). Só isso — sem configuração técnica.',
  },
  {
    num: '2',
    title: 'Pegue seu código de conexão',
    body: 'Um código de 8 dígitos aparece automaticamente na tela. Se preferir, toque em "Gerar QR Code" para escanear.',
  },
  {
    num: '3',
    title: 'No celular, conecte o aparelho',
    body: 'Abra o WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho → "Conectar com número de telefone" e digite o código.',
  },
  {
    num: '4',
    title: 'Pronto! Envie um áudio de teste',
    body: 'Mande um áudio de qualquer duração para o número conectado. Em segundos você recebe a conversão e o resumo de volta na mesma conversa.',
  },
];

/* ════════════════════════════════════════════════════════════════
   Componente principal
════════════════════════════════════════════════════════════════ */
export default function OnboardingBanner({ hasNumber, hasTranscription }: {
  hasNumber: boolean;
  hasTranscription: boolean;
}) {
  const [dismissed,    setDismissed]    = useState(false);
  const [drawerOpen,   setDrawerOpen]   = useState(false);
  const [openFaq,      setOpenFaq]      = useState<number | null>(null);
  const [openHelp,     setOpenHelp]     = useState(false);

  /* Lê dismiss do localStorage */
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setDismissed(true);
    } catch {}
  }, []);

  /* Só esconde quando os 3 passos estiverem completos (já converteu) */
  if (hasTranscription || dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setDismissed(true);
  }

  /* Checkpoints */
  const steps = [
    { icon: '✓',  label: 'Conta criada',    done: true,          active: false },
    { icon: '📱', label: 'Conectar número', done: hasNumber,     active: !hasNumber },
    { icon: '🎙', label: '1º áudio',        done: hasTranscription, active: hasNumber && !hasTranscription },
  ];
  const stepIndex = (hasNumber ? 2 : 1); // passo atual em que o usuário está (1, 2 ou 3)

  return (
    <>
      {/* ── Banner ───────────────────────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden mb-6"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,.08) 0%, rgba(16,185,129,.04) 50%, rgba(245,158,11,.04) 100%)',
          border: '1px solid rgba(16,185,129,.2)',
        }}
      >
        {/* Glow decorativo */}
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-[80px] pointer-events-none"
          style={{ background: 'rgba(16,185,129,.06)' }} />

        <div className="relative p-5 sm:p-6">
          {/* Fechar */}
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 text-brand-muted hover:text-brand-text transition-colors"
            aria-label="Dispensar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          {/* Topo: badge + título */}
          <div className="flex items-start gap-3 mb-5 pr-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(16,185,129,.15)' }}>
              <span className="text-lg">🚀</span>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-widest mb-0.5"
                style={{ color: 'rgb(var(--color-primary))' }}>
                {hasNumber ? 'Passo 3/3 — Tudo pronto!' : 'Passo 2/3 — Quase lá!'}
              </div>
              <h2 className="text-base font-bold text-brand-text leading-snug">
                {hasNumber ? 'Conexão concluída com sucesso! 🎉' : 'Conecte seu WhatsApp e comece a converter'}
              </h2>
              <p className="text-xs text-brand-text-secondary mt-0.5">
                {hasNumber
                  ? 'Agora, ao receber áudios no número conectado, a conversão em texto e o resumo são feitos automaticamente. Envie um áudio de teste para conferir.'
                  : 'Leva menos de 5 minutos. Sem configuração complexa.'}
              </p>
              {!hasNumber && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-brand-muted">
                  <span>🔒 Criptografia AES-256</span>
                  <span>🇧🇷 Servidores no Brasil (LGPD)</span>
                  <span>✋ Lemos só os áudios que você envia</span>
                  <span>↩️ Cancele quando quiser</span>
                </div>
              )}
            </div>
          </div>

          {/* Checkpoints */}
          <div className="flex items-center gap-0 mb-5">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center flex-1 min-w-0">
                {/* Step pill */}
                <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold flex-shrink-0 transition-all ${
                  s.done
                    ? 'bg-brand-primary/15 text-brand-primary'
                    : s.active
                      ? 'bg-brand-primary text-white shadow-[0_0_12px_rgba(16,185,129,.4)]'
                      : 'bg-brand-border/40 text-brand-muted'
                }`}>
                  {s.done ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    <span>{s.icon}</span>
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {/* Linha conectora */}
                {i < steps.length - 1 && (
                  <div className="flex-1 h-px mx-1.5" style={{
                    background: s.done
                      ? 'rgba(16,185,129,.4)'
                      : 'rgba(var(--color-border)/.6)',
                  }} />
                )}
              </div>
            ))}
          </div>

          {/* Labels dos steps (mobile) */}
          <div className="flex justify-between sm:hidden text-[10px] text-brand-muted mb-4 px-0.5">
            {steps.map((s, i) => (
              <span key={i} className={`text-center ${s.active ? 'text-brand-primary font-semibold' : ''}`}>
                {s.label}
              </span>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            {hasNumber ? (
              <Link
                href="/dashboard/transcricoes"
                className="btn-primary flex items-center justify-center gap-2 py-3 text-sm font-semibold"
                style={{ borderRadius: '0.875rem' }}
              >
                <span>🎙️</span>
                Mande um áudio no seu WhatsApp e veja aqui
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <button
                onClick={() => setDrawerOpen(true)}
                className="btn-primary flex items-center justify-center gap-2 py-3 text-sm font-semibold"
                style={{ borderRadius: '0.875rem' }}
              >
                <span>📱</span>
                Conectar meu WhatsApp agora
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
            <Link
              href="/dashboard/numeros"
              className="btn-ghost flex items-center justify-center gap-2 py-3 text-sm"
            >
              Ir para Números
            </Link>
          </div>

          {/* Accordion de ajuda */}
          <div className="mt-4 border-t pt-3" style={{ borderColor: 'rgba(var(--color-border)/.5)' }}>
            <button
              onClick={() => setOpenHelp(h => !h)}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-text-secondary hover:text-brand-text transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              Preciso de ajuda
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: openHelp ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {openHelp && (
              <div className="mt-3 space-y-1.5">
                {TROUBLESHOOT.map((item, i) => (
                  <div key={i} className="rounded-xl overflow-hidden"
                    style={{ background: 'rgba(var(--color-surface-elevated)/1)', border: '1px solid rgba(var(--color-border-light)/.8)' }}>
                    <button
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left gap-3"
                    >
                      <span className="text-xs font-semibold text-brand-text">{item.q}</span>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                        className="flex-shrink-0 text-brand-muted"
                        style={{ transform: openFaq === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    {openFaq === i && (
                      <div className="px-4 pb-3 space-y-1.5">
                        {item.a.map((line, j) => (
                          <p key={j} className="text-xs text-brand-text-secondary leading-relaxed flex items-start gap-2">
                            <span className="text-brand-primary flex-shrink-0 mt-0.5">→</span>
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Drawer lateral ───────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />

          {/* Painel */}
          <div
            className="fixed inset-y-0 right-0 z-50 w-full max-w-sm flex flex-col overflow-hidden"
            style={{
              background: 'rgb(var(--color-surface))',
              borderLeft: '1px solid rgba(var(--color-border)/.8)',
              animation: 'slideInRight .22s cubic-bezier(.4,0,.2,1) both',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: 'rgb(var(--color-border-light))' }}>
              <div>
                <h3 className="font-bold text-sm text-brand-text">Como conectar seu WhatsApp</h3>
                <p className="text-xs text-brand-text-secondary mt-0.5">Siga os passos abaixo</p>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="text-brand-muted hover:text-brand-text transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Conteúdo scrollável */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Passo a passo único — sem escolhas */}
              <div>
                <p className="text-xs font-semibold text-brand-text-secondary uppercase tracking-wide mb-3">
                  Passo a passo
                </p>
                <div className="space-y-3">
                  {STEPS.map((step, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5"
                        style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
                        {step.num}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-brand-text mb-0.5">{step.title}</p>
                        <p className="text-[11px] text-brand-text-secondary leading-relaxed">{step.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dica de segurança */}
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: 'rgba(16,185,129,.04)', border: '1px solid rgba(16,185,129,.1)' }}>
                <p className="text-brand-muted leading-relaxed">
                  🔒 <span className="font-semibold text-brand-primary">Conexão segura.</span>
                  {' '}Tudo com criptografia <strong className="text-brand-text-secondary">AES-256</strong> e servidores no <strong className="text-brand-text-secondary">Brasil (LGPD)</strong>. Só convertemos os áudios que você envia — nenhuma outra mensagem é lida. Você pode desconectar o número quando quiser.
                </p>
              </div>
            </div>

            {/* Rodapé com botão */}
            <div className="px-5 py-4 border-t" style={{ borderColor: 'rgb(var(--color-border-light))' }}>
              <Link
                href="/dashboard/numeros"
                onClick={() => setDrawerOpen(false)}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold"
                style={{ borderRadius: '0.875rem' }}
              >
                Ir para Números e conectar
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <p className="text-center text-[10px] text-brand-muted mt-2">
                Precisa de ajuda?{' '}
                <a href="mailto:suporte@zapscript.me" className="text-brand-primary hover:underline">
                  suporte@zapscript.me
                </a>
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
