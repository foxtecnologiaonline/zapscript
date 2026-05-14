'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export default function ConvitePage() {
  const params   = useParams();
  const code     = params.code as string;

  const [state, setState] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [invite, setInvite] = useState<{ name: string; code: string } | null>(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!code) { setState('invalid'); return; }
    fetch(`${API}/invites/validate/${code}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) {
          setInvite(d.invite);
          setState('valid');
        } else {
          setError(d.error || 'Convite inválido.');
          setState('invalid');
        }
      })
      .catch(() => { setError('Erro ao verificar convite.'); setState('invalid'); });
  }, [code]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-primary text-sm animate-pulse">Verificando convite...</div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 overflow-x-hidden">
        <div className="w-full max-w-sm min-w-0 text-center">
          <div className="bg-brand-surface rounded-2xl p-5 sm:p-8" style={{ border: '1px solid rgba(239,68,68,.2)' }}>
            <span className="text-4xl block mb-4">❌</span>
            <h2 className="text-xl font-bold text-red-400 mb-2">Convite inválido</h2>
            <p className="text-sm text-brand-text-secondary mb-6 leading-relaxed">
              {error || 'Este convite não existe ou já foi utilizado.'}
            </p>
            <Link href="/" className="btn-primary block w-full py-3 text-center text-sm">
              Conhecer o ZapScript
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12 overflow-x-hidden">
      <div className="w-full max-w-md min-w-0">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold text-brand-primary">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-pulse"/>ZapScript
          </Link>
        </div>

        {/* Card principal */}
        <div className="bg-brand-surface rounded-2xl p-5 sm:p-8" style={{ border: '1px solid rgba(var(--color-primary), .15)' }}>

          {/* Selo Tester */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex flex-col items-center gap-2 bg-amber-400/15 border-2 border-amber-400/50 rounded-2xl px-6 py-4">
              <span className="text-4xl">🏅</span>
              <span className="text-xs font-black text-amber-300 uppercase tracking-widest">Tester Oficial</span>
              <span className="text-[11px] font-semibold text-amber-400">ZapScript Beta</span>
            </div>
          </div>

          <h1 className="text-2xl font-black text-center text-brand-primary mb-2">
            Você foi convidado!
          </h1>
          <p className="text-brand-text-secondary text-center text-sm mb-6 leading-relaxed">
            {invite?.name ? (
              <>Este convite foi preparado especialmente para <strong className="text-brand-text">{invite.name}</strong>.</>
            ) : (
              'Um convite exclusivo para se tornar Tester Oficial.'
            )}
          </p>

          {/* Benefícios */}
          <div className="space-y-3 mb-8">
            <div className="flex items-center gap-3 bg-brand-bg rounded-xl px-4 py-3">
              <span className="text-2xl flex-shrink-0">⚡</span>
              <div>
                <div className="text-sm font-bold text-brand-primary">Plano PRO grátis por 1 ano</div>
                <div className="text-xs text-brand-text-secondary">Transcrição ilimitada, sem cartão de crédito</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-brand-bg rounded-xl px-4 py-3">
              <span className="text-2xl flex-shrink-0">🏅</span>
              <div>
                <div className="text-sm font-bold text-brand-primary">Selo Tester Oficial</div>
                <div className="text-xs text-brand-text-secondary">Acesso antecipado a novos recursos</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-brand-bg rounded-xl px-4 py-3">
              <span className="text-2xl flex-shrink-0">🎙️</span>
              <div>
                <div className="text-sm font-bold text-brand-primary">Transcrição de áudios do WhatsApp</div>
                <div className="text-xs text-brand-text-secondary">Com IA — Groq Whisper + resumo em tópicos</div>
              </div>
            </div>
          </div>

          <Link
            href={`/cadastro?invite=${code}`}
            className="btn-primary block w-full py-4 text-center font-bold text-sm rounded-xl">
            Criar minha conta Tester →
          </Link>

          <p className="text-center text-xs text-brand-muted mt-4 leading-relaxed">
            Ao criar sua conta você concorda com os{' '}
            <Link href="/termos" className="underline">Termos de Uso</Link>
            {' '}e{' '}
            <Link href="/privacidade" className="underline">Política de Privacidade</Link>.
            <br/>O código de convite é de uso único.
          </p>
        </div>

      </div>
    </div>
  );
}
