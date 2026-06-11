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
    q: 'QR Code não aparece na tela',
    a: [
      'Verifique se a URL da Evolution API está correta — ex: https://evolution.seudominio.com (sem barra no final).',
      'Confirme que a porta está aberta e acessível pela internet (padrão: 8080).',
      'Teste a URL no navegador: deve retornar um JSON. Se der erro de conexão, o servidor não está acessível.',
      'Se estiver usando ngrok ou túnel, certifique-se de que ele está ativo.',
    ],
  },
  {
    q: 'Conectei o número mas o áudio não chega',
    a: [
      'O webhook é configurado automaticamente ao clicar em "Conectar". Verifique se o status aparece como "Conectado" (verde) no painel de Números.',
      'Se o número já estava em uso em outro sistema (ex: outro chatbot), o webhook pode ter sido sobrescrito. Reconecte clicando no botão "Reconectar".',
      'Certifique-se de enviar o áudio para o número cadastrado, não para outro.',
    ],
  },
  {
    q: 'Erro "Unauthorized" ou "API Key inválida"',
    a: [
      'A API Key informada está incorreta. Copie-a novamente do painel da sua Evolution API (normalmente em Configurações → API Key).',
      'Se estiver usando Evolution local, a key padrão está nas variáveis de ambiente da instalação (arquivo .env: AUTHENTICATION_API_KEY).',
      'A key é case-sensitive — verifique maiúsculas e minúsculas.',
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
      'A Evolution API pode estar demorando para criar a instância. Aguarde até 30 segundos e recarregue a página.',
      'Verifique os logs da sua Evolution API — pode haver um erro de permissão ou de banco de dados.',
      'Se o problema persistir, delete a instância no painel da Evolution e reconecte pelo ZapScript.',
    ],
  },
];

/* ── Passos do drawer (Evolution API — recomendado) ─────────────── */
const STEPS_EVOLUTION = [
  {
    num: '1',
    title: 'Tenha uma Evolution API rodando',
    body: 'Você precisa de uma instância da Evolution API acessível pela internet. Pode ser no seu próprio servidor (VPS, Railway, Render) ou em um serviço gerenciado.',
    link: { label: 'Ver como instalar a Evolution API →', href: 'https://doc.evolution-api.com', external: true },
  },
  {
    num: '2',
    title: 'Anote a URL e a API Key',
    body: 'URL: o endereço onde a Evolution está rodando (ex: https://evolution.seudominio.com). API Key: encontrada nas configurações da Evolution (variável AUTHENTICATION_API_KEY).',
  },
  {
    num: '3',
    title: 'Acesse "Números" no menu lateral',
    body: 'Clique em "Conectar novo número", informe a URL e a API Key da Evolution, escolha um nome para identificar este número e clique em Conectar.',
  },
  {
    num: '4',
    title: 'Escaneie o QR Code',
    body: 'Abra o WhatsApp no celular → Configurações → Aparelhos conectados → Conectar um aparelho. Aponte a câmera para o QR Code que aparecerá na tela.',
  },
  {
    num: '5',
    title: 'Pronto! Envie um áudio de teste',
    body: 'Envie um áudio de qualquer duração para o número cadastrado. Em segundos você receberá a transcrição e o resumo de volta na mesma conversa.',
  },
];

/* ── Tipos de integração ─────────────────────────────────────────── */
const INTEGRATIONS = [
  {
    id: 'evolution',
    icon: '⚡',
    name: 'Evolution API',
    badge: 'Recomendado',
    badgeColor: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    desc: 'Gratuito, open-source, roda no seu servidor. Mais flexível.',
  },
  {
    id: 'official',
    icon: '✅',
    name: 'WhatsApp Oficial (Meta)',
    badge: 'Pago',
    badgeColor: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    desc: 'API oficial do WhatsApp Business. Requer aprovação da Meta.',
  },
  {
    id: 'twilio',
    icon: '📡',
    name: 'Twilio',
    badge: 'Pago',
    badgeColor: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
    desc: 'Plataforma de comunicação. Precisa de conta Twilio ativa.',
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
  const [integration,  setIntegration]  = useState('evolution');

  /* Lê dismiss do localStorage */
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setDismissed(true);
    } catch {}
  }, []);

  /* Se tiver número conectado, não exibe */
  if (hasNumber || dismissed) return null;

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
                Quase lá!
              </div>
              <h2 className="text-base font-bold text-brand-text leading-snug">
                Conecte seu WhatsApp e comece a transcrever
              </h2>
              <p className="text-xs text-brand-text-secondary mt-0.5">
                Leva menos de 5 minutos. Sem configuração complexa.
              </p>
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

              {/* Escolha de integração */}
              <div>
                <p className="text-xs font-semibold text-brand-text-secondary uppercase tracking-wide mb-2">
                  Tipo de integração
                </p>
                <div className="space-y-2">
                  {INTEGRATIONS.map(int => (
                    <button
                      key={int.id}
                      onClick={() => setIntegration(int.id)}
                      className="w-full text-left rounded-xl p-3 transition-all"
                      style={{
                        background: integration === int.id
                          ? 'rgba(16,185,129,.08)'
                          : 'rgb(var(--color-surface-elevated))',
                        border: `1px solid ${integration === int.id ? 'rgba(16,185,129,.3)' : 'rgba(var(--color-border-light)/1)'}`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{int.icon}</span>
                          <span className="text-xs font-semibold text-brand-text">{int.name}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${int.badgeColor}`}>
                          {int.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-brand-muted mt-1 pl-6">{int.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Passos por tipo */}
              {integration === 'evolution' && (
                <div>
                  <p className="text-xs font-semibold text-brand-text-secondary uppercase tracking-wide mb-3">
                    Passo a passo — Evolution API
                  </p>
                  <div className="space-y-3">
                    {STEPS_EVOLUTION.map((step, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5"
                          style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
                          {step.num}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-brand-text mb-0.5">{step.title}</p>
                          <p className="text-[11px] text-brand-text-secondary leading-relaxed">{step.body}</p>
                          {step.link && (
                            <a href={step.link.href} target="_blank" rel="noopener noreferrer"
                              className="text-[11px] text-brand-primary hover:underline inline-flex items-center gap-1 mt-1">
                              {step.link.label}
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {integration === 'official' && (
                <div className="rounded-xl p-4 text-xs leading-relaxed space-y-2"
                  style={{ background: 'rgba(59,130,246,.05)', border: '1px solid rgba(59,130,246,.15)' }}>
                  <p className="font-semibold text-blue-400">WhatsApp Business API (Meta)</p>
                  <p className="text-brand-text-secondary">Requer uma conta Meta Business verificada e aprovação da Meta para uso da API.</p>
                  <ol className="space-y-1.5 text-brand-text-secondary list-none pl-0">
                    <li className="flex gap-2"><span className="text-blue-400 flex-shrink-0">1.</span>Acesse developers.facebook.com e crie um app do tipo Business</li>
                    <li className="flex gap-2"><span className="text-blue-400 flex-shrink-0">2.</span>Adicione o produto WhatsApp e configure o número de telefone</li>
                    <li className="flex gap-2"><span className="text-blue-400 flex-shrink-0">3.</span>Obtenha o Phone Number ID e o Access Token</li>
                    <li className="flex gap-2"><span className="text-blue-400 flex-shrink-0">4.</span>Informe os dados na tela de Números do ZapScript</li>
                  </ol>
                </div>
              )}

              {integration === 'twilio' && (
                <div className="rounded-xl p-4 text-xs leading-relaxed space-y-2"
                  style={{ background: 'rgba(139,92,246,.05)', border: '1px solid rgba(139,92,246,.15)' }}>
                  <p className="font-semibold text-purple-400">Twilio — WhatsApp Sandbox / Business</p>
                  <p className="text-brand-text-secondary">Requer conta Twilio ativa com o addon WhatsApp habilitado.</p>
                  <ol className="space-y-1.5 text-brand-text-secondary list-none pl-0">
                    <li className="flex gap-2"><span className="text-purple-400 flex-shrink-0">1.</span>Acesse console.twilio.com e vá em Messaging → WhatsApp</li>
                    <li className="flex gap-2"><span className="text-purple-400 flex-shrink-0">2.</span>Obtenha o Account SID e o Auth Token nas configurações da conta</li>
                    <li className="flex gap-2"><span className="text-purple-400 flex-shrink-0">3.</span>Copie o número WhatsApp no formato: +14155238886</li>
                    <li className="flex gap-2"><span className="text-purple-400 flex-shrink-0">4.</span>Informe os dados na tela de Números do ZapScript</li>
                  </ol>
                </div>
              )}

              {/* Dica de segurança */}
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: 'rgba(16,185,129,.04)', border: '1px solid rgba(16,185,129,.1)' }}>
                <p className="text-brand-muted leading-relaxed">
                  🔒 <span className="font-semibold text-brand-primary">Suas credenciais são seguras.</span>
                  {' '}API Keys são armazenadas criptografadas e nunca exibidas em texto puro após salvar.
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
