'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

/* ─────────────────────────────────────────────────────────────────
   AchievementBanner — upsell contextual pós-ativação.

   Aparece APÓS a 1ª transcrição REAL do usuário (via webhook/API),
   oferecendo upgrade para o Pro. Guarda localStorage para mostrar
   apenas 1 vez (zs_achievement_upsell_shown).

   Destaca o valor já entregue + o que o usuário DESBLOQUEIA
   ao assinar. Timing: visível por 8s ou até o usuário interagir.
───────────────────────────────────────────────────────────────── */

interface Props {
  /** Nome amigável extraído do plano (ex: "Pro") ou null */
  planLabel?: string | null;
  savedLabelMonth?: string;
  transcriptionsTotal: number;
}

const LS_KEY = 'zs_achievement_upsell_shown';

export default function AchievementBanner({
  planLabel,
  savedLabelMonth,
  transcriptionsTotal,
}: Props) {
  const [visible, setVisible] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY)) setDismissed(true);
      else localStorage.setItem(LS_KEY, '1');
    } catch { /* ignora */ }
  }, []);

  if (dismissed || !visible) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden mb-6"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,.12) 0%, rgba(245,158,11,.06) 100%)',
        border: '1px solid rgba(16,185,129,.25)',
      }}
    >
      <div className="relative p-5 sm:p-6">
        {/* Fechar */}
        <button
          onClick={() => setVisible(false)}
          className="absolute top-4 right-4 text-brand-muted hover:text-brand-text transition-colors"
          aria-label="Dispensar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-start gap-3 mb-4 pr-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
            style={{ background: 'rgba(16,185,129,.18)' }}>
            🏆
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgb(var(--color-primary))' }}>
              {transcriptionsTotal >= 5 ? '🔥 Aha moment atingido!' : '🚀 Primeira conversão!'}
            </div>
            <h2 className="text-base font-bold text-brand-text leading-snug">
              {transcriptionsTotal >= 5
                ? 'Você já leu 5+ áudios sem ouvir um segundo'
                : 'Seu primeiro áudio convertido com sucesso!'
              }
            </h2>
            <p className="text-xs text-brand-text-secondary mt-0.5 leading-relaxed">
              {savedLabelMonth
                ? `Neste mês você já economizou ${savedLabelMonth}.`
                : 'Cada áudio vira texto e resumo automaticamente.'
              }
              {' '}Com o <strong>Pro</strong>, você desbloqueia áudios ilimitados e Modo Privado.
            </p>
          </div>
        </div>

        {/* Valor destacado */}
        <div className="flex items-center gap-3 mb-4 rounded-xl px-4 py-3"
          style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)' }}>
          <span className="text-xl">🔓</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-brand-text">Áudios ilimitados</div>
            <div className="text-[11px] text-brand-muted">Sem se preocupar com cota mensal</div>
          </div>
          <div style={{ width: 1, height: 28, background: 'rgba(16,185,129,.2)' }} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-brand-text">Modo Privado</div>
            <div className="text-[11px] text-brand-muted">Resumo só no seu WhatsApp</div>
          </div>
          <div style={{ width: 1, height: 28, background: 'rgba(16,185,129,.2)' }} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-brand-text">2 números</div>
            <div className="text-[11px] text-brand-muted">WhatsApp comercial + pessoal</div>
          </div>
        </div>

        {/* Preço + CTA */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div>
            <div className="text-xs text-brand-text-secondary">A partir de</div>
            <div className="flex items-baseline gap-1">
              <span className="font-display font-black text-2xl text-brand-primary">R$37</span>
              <span className="text-xs text-brand-muted">/mês</span>
            </div>
            {(!planLabel || planLabel === 'Free') && (
              <div className="text-[11px] text-brand-muted mt-0.5">menos de R$1,23/dia</div>
            )}
          </div>
          <Link
            href="/dashboard/plano"
            className="btn-primary flex items-center justify-center gap-2 py-2.5 px-6 text-sm font-bold"
            style={{ borderRadius: '0.875rem' }}
          >
            {(!planLabel || planLabel === 'Free') ? 'Assinar Pro →' : 'Ver planos →'}
          </Link>
          <button
            onClick={() => setVisible(false)}
            className="text-xs text-brand-muted hover:text-brand-text transition-colors sm:ml-auto"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
