'use client';

import { useState, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────────
   QuickDemoCard — experimente o ZapScript sem conectar WhatsApp.

   Simula o fluxo real: áudio recebido → transcrevendo → resultado.
   Mostra o valor do produto em ~5 segundos, sem configuração.
   Exibido APENAS para usuários com 0 transcrições reais.

   3 estágios animados:
     1. "Áudio recebido" (onda sonora)
     2. "Transcrevendo..." (spinner)
     3. Transcrição + bullets de resumo
───────────────────────────────────────────────────────────────── */

const SAMPLE_TEXT =
  'Beleza, então fica assim: o orçamento final para o apartamento da Vila Olímpia ficou em R$ 187 mil, sendo R$ 112 mil de material e R$ 75 mil de mão de obra. A reforma começa dia 5 de agosto, segunda-feira, com previsão de 45 dias úteis. A gente precisa da sua assinatura no contrato até sexta pra garantir o desconto de 5% nos materiais.';

const SAMPLE_BULLETS = [
  'Orçamento final: R$ 187 mil (R$ 112 mil material + R$ 75 mil mão de obra)',
  'Início da reforma: 5 de agosto (segunda-feira)',
  'Prazo: 45 dias úteis',
  'Assinar contrato até sexta para garantir 5% de desconto nos materiais',
];

type Stage = 'idle' | 'receiving' | 'transcribing' | 'done';

export default function QuickDemoCard() {
  const [stage, setStage] = useState<Stage>('idle');
  const [dismissed, setDismissed] = useState(false);
  const [dots, setDots] = useState('');

  const start = useCallback(() => {
    setStage('receiving');
    // Áudio "chegando" — 1.2s com onda sonora animada
    setTimeout(() => {
      setStage('transcribing');
      // "Transcrevendo" — 2s com pontinhos
      let c = 0;
      const iv = setInterval(() => {
        c = (c + 1) % 4;
        setDots('.'.repeat(c));
      }, 350);
      setTimeout(() => {
        clearInterval(iv);
        setStage('done');
      }, 2200);
    }, 1200);
  }, []);

  const reset = useCallback(() => {
    setStage('idle');
  }, []);

  if (dismissed) return null;

  return (
    <div
      className="relative rounded-2xl overflow-hidden mb-6"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,.08) 0%, rgba(16,185,129,.02) 50%, rgba(245,158,11,.04) 100%)',
        border: '1px solid rgba(16,185,129,.2)',
      }}
    >
      {/* Glow decorativo */}
      <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-[80px] pointer-events-none"
        style={{ background: 'rgba(16,185,129,.06)' }} />

      <div className="relative p-5 sm:p-6">
        {/* Fechar */}
        {stage === 'idle' && (
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-4 right-4 text-brand-muted hover:text-brand-text transition-colors"
            aria-label="Dispensar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        {stage === 'idle' && (
          /* ── ESTÁGIO 1: CTA para experimentar ── */
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,.15)' }}>
                <span className="text-lg">🎙️</span>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgb(var(--color-primary))' }}>
                  Veja como funciona
                </div>
                <h2 className="text-base font-bold text-brand-text leading-snug">
                  Experimente agora sem conectar seu WhatsApp
                </h2>
                <p className="text-xs text-brand-text-secondary mt-0.5">
                  Clique no botão e veja como o ZapScript transforma áudios em texto + resumo em segundos.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                onClick={start}
                className="btn-primary flex items-center justify-center gap-2 py-3 text-sm font-semibold"
                style={{ borderRadius: '0.875rem' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Ver demonstração agora
              </button>
            </div>

            <p className="text-[11px] text-brand-muted flex items-center gap-1.5 mt-3">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Sem enviar arquivo, sem cadastrar cartão — só clique e veja
            </p>
          </div>
        )}

        {stage === 'receiving' && (
          /* ── ESTÁGIO 2: Áudio "chegando" ── */
          <div className="text-center py-6">
            <div className="text-lg font-bold text-brand-text mb-3" style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>
              📩 Áudio recebido!
            </div>
            <div className="flex items-center justify-center gap-[3px] h-10 mb-2">
              {[4, 8, 12, 18, 14, 20, 10, 16, 6, 12, 8, 14, 5, 10, 7, 16, 11, 8, 15, 10].map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full animate-pulse"
                  style={{
                    height: h,
                    background: i < 5 ? 'rgb(var(--color-primary))' : 'rgb(var(--color-primary-light))',
                    animationDelay: `${i * 0.06}s`,
                    animationDuration: '0.8s',
                  }}
                />
              ))}
            </div>
            <p className="text-xs text-brand-muted flex items-center justify-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
              Processando automaticamente...
            </p>
          </div>
        )}

        {stage === 'transcribing' && (
          /* ── ESTÁGIO 3: Transcrevendo ── */
          <div className="text-center py-6">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <svg className="animate-spin" viewBox="0 0 24 24" width="64" height="64" style={{ color: 'rgb(var(--color-primary))' }}>
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl">⚡</span>
            </div>
            <div className="text-base font-bold text-brand-text mb-1">
              Transcrevendo{dots}
            </div>
            <p className="text-xs text-brand-muted">
              Whisper (OpenAI) + Claude (Anthropic) · 99% de precisão
            </p>
            {/* Barra de progresso simulada */}
            <div className="mt-5 max-w-xs mx-auto">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(var(--color-primary)/.12)' }}>
                <div className="h-full rounded-full" style={{
                  background: 'rgb(var(--color-primary))',
                  animation: 'demoProgress 2.2s ease-in-out forwards',
                }} />
              </div>
            </div>
          </div>
        )}

        {stage === 'done' && (
          /* ── ESTÁGIO 4: Resultado ── */
          <div>
            {/* Header */}
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,.15)' }}>
                <span className="text-lg">✨</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgb(var(--color-primary))' }}>
                    Conversão concluída
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/20">
                    ⚡ 3 segundos
                  </span>
                </div>
                <p className="text-xs text-brand-text-secondary mt-0.5">
                  É assim que cada áudio chega pra você — sem ouvir, sem fazer nada.
                </p>
              </div>
            </div>

            {/* Balão de transcrição — estilo WhatsApp */}
            <div
              className="rounded-2xl p-4 mb-3"
              style={{
                background: '#d9fdd3',
                color: '#111b21',
                boxShadow: '0 2px 8px rgba(0,0,0,.06)',
              }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-bold" style={{ color: '#1f7a3f' }}>📝 Transcrição</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: '#1f7a3f', color: '#fff' }}>ZapScript</span>
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: '#111b21' }}>
                &ldquo;{SAMPLE_TEXT}&rdquo;
              </p>
            </div>

            {/* Resumo com bullets */}
            <div
              className="rounded-2xl p-4 mb-4"
              style={{
                background: '#d9fdd3',
                color: '#111b21',
                boxShadow: '0 2px 8px rgba(0,0,0,.06)',
              }}
            >
              <div className="text-[11px] font-bold mb-2" style={{ color: '#1f7a3f' }}>✨ Resumo</div>
              <ul className="space-y-1.5">
                {SAMPLE_BULLETS.map((b, i) => (
                  <li key={i} className="text-[12px] leading-snug flex gap-1.5" style={{ color: '#1b3b27' }}>
                    <span className="flex-shrink-0 mt-0.5" style={{ color: '#1f7a3f' }}>•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                onClick={reset}
                className="btn-ghost flex items-center justify-center gap-2 py-2.5 text-xs flex-1"
              >
                🔄 Ver de novo
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="btn-primary flex items-center justify-center gap-2 py-2.5 text-xs font-semibold flex-1"
                style={{ borderRadius: '0.875rem' }}
              >
                Entendi! Quero conectar meu WhatsApp →
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes demoProgress {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  );
}
