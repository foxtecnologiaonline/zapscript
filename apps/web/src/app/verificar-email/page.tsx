'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { api } from '@/lib/api';

type Status = 'loading' | 'success' | 'error';

function VerificarEmailInner() {
  const searchParams = useSearchParams();
  const token        = searchParams.get('token') || '';
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Link inválido — token ausente.');
      return;
    }
    let active = true;
    api.post('/auth/verify-email', { token })
      .then(() => { if (active) setStatus('success'); })
      .catch((err: any) => {
        if (!active) return;
        setStatus('error');
        setMessage(err.message || 'Não foi possível confirmar seu e-mail.');
      });
    return () => { active = false; };
  }, [token]);

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="bg-brand-surface rounded-2xl p-8"
          style={{ border: '1px solid rgba(var(--color-primary)/.15)' }}>
          <Link href="/" className="inline-flex items-center justify-center mb-6">
            <Image src="/logo.png" alt="ZapScript" width={140} height={30} className="object-contain" />
          </Link>

          {status === 'loading' && (
            <>
              <div className="w-16 h-16 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl animate-pulse">⏳</span>
              </div>
              <h2 className="text-xl font-bold text-brand-primary mb-2">Confirmando seu e-mail…</h2>
              <p className="text-sm text-brand-text-secondary">Só um instante.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">✅</span>
              </div>
              <h2 className="text-xl font-bold text-brand-primary mb-2">E-mail confirmado!</h2>
              <p className="text-sm text-brand-text-secondary mb-6 leading-relaxed">
                Tudo certo. Agora você já pode assinar um plano e liberar todos os recursos do ZapScript.
              </p>
              <div className="space-y-2">
                <Link href="/dashboard/plano" className="btn-primary block w-full py-3 text-center text-sm">
                  Ver planos →
                </Link>
                <Link href="/dashboard" className="block w-full text-xs text-brand-muted hover:text-brand-primary transition-colors py-2">
                  Ir para o painel
                </Link>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">⚠️</span>
              </div>
              <h2 className="text-xl font-bold text-brand-primary mb-2">Não foi possível confirmar</h2>
              <p className="text-sm text-brand-text-secondary mb-6 leading-relaxed">
                {message || 'O link pode ter expirado.'} Faça login e reenvie o link de verificação pelo painel.
              </p>
              <div className="space-y-2">
                <Link href="/dashboard" className="btn-primary block w-full py-3 text-center text-sm">
                  Ir para o painel
                </Link>
                <Link href="/login" className="block w-full text-xs text-brand-muted hover:text-brand-primary transition-colors py-2">
                  Fazer login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerificarEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-primary text-sm animate-pulse">Carregando...</div>
      </div>
    }>
      <VerificarEmailInner />
    </Suspense>
  );
}
