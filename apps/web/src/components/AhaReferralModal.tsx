'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Props {
  transcriptionsTotal: number;
  refCode: string | null;
}

const LS_KEY = 'zs_aha_referral_shown';
const AHA_THRESHOLD = 5;

export default function AhaReferralModal({ transcriptionsTotal, refCode }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Só dispara se atingiu o threshold E nunca foi mostrado neste navegador
    if (transcriptionsTotal < AHA_THRESHOLD) return;
    try {
      if (localStorage.getItem(LS_KEY)) return;
    } catch { /* se localStorage falhar, mostra assim mesmo */ }
    setVisible(true);
  }, [transcriptionsTotal]);

  const dismiss = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(LS_KEY, '1'); } catch {}
  }, []);

  const copyLink = useCallback(() => {
    if (!refCode) return;
    navigator.clipboard.writeText(`https://www.zapscript.me/cadastro?ref=${refCode}`);
  }, [refCode]);

  const shareWhatsApp = useCallback(() => {
    const link = `https://www.zapscript.me/cadastro?ref=${refCode ?? ''}`;
    const msg = `Eu uso o ZapScript para converter áudios do WhatsApp automaticamente com IA — e você ganha 5 áudios grátis ao se cadastrar pelo meu link: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }, [refCode]);

  // Fecha no Esc
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6 sm:p-8 text-center animate-in"
        style={{
          background: 'linear-gradient(160deg, #0f172a 0%, #1a2332 100%)',
          border: '1px solid rgba(16,185,129,.25)',
          boxShadow: '0 0 60px rgba(16,185,129,.15), 0 20px 60px rgba(0,0,0,.5)',
        }}
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-brand-muted hover:text-white hover:bg-white/5 transition-colors"
          aria-label="Fechar"
        >
          ✕
        </button>

        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-5">
          🎁 Programa de Indicação
        </div>

        {/* Headline */}
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 leading-tight">
          Você já converteu{' '}
          <span className="text-brand-primary">{transcriptionsTotal} áudios</span>!
        </h2>
        <p className="text-brand-muted text-sm mb-1 leading-relaxed">
          O ZapScript já economiza horas do seu mês.
        </p>
        <p className="text-brand-text text-sm font-semibold mb-6 leading-relaxed">
          Indique um amigo e{' '}
          <span className="text-brand-primary">ganhe 1 mês grátis de Pro</span> para
          cada indicação que se cadastrar.
        </p>

        {/* Referral link */}
        {refCode && (
          <div className="flex gap-2 mb-4">
            <input
              readOnly
              className="flex-1 rounded-xl px-3 py-2.5 text-xs font-mono bg-brand-elevated border border-white/10 text-brand-text focus:outline-none"
              value={`zapscript.me/cadastro?ref=${refCode}`}
            />
            <button
              onClick={copyLink}
              className="bg-brand-primary text-black font-bold text-xs px-4 py-2.5 rounded-xl hover:opacity-90 transition-opacity flex-shrink-0"
            >
              Copiar
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
          <button
            onClick={shareWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white font-semibold text-sm py-2.5 rounded-xl hover:bg-green-500 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
            Compartilhar no WhatsApp
          </button>
        </div>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="text-xs text-brand-muted hover:text-white transition-colors"
        >
          Agora não — depois eu indico
        </button>

        {/* Footer note */}
        <p className="text-[10px] text-brand-muted/60 mt-4">
          Seu link de indicação também está disponível no painel, em "Indique o ZapScript".
        </p>
      </div>

      {/* Simple CSS keyframe for entrance */}
      <style jsx>{`
        @keyframes ahaFadeIn {
          from { opacity: 0; transform: scale(.92) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-in { animation: ahaFadeIn .35s cubic-bezier(.16,1,.3,1); }
      `}</style>
    </div>
  );
}
