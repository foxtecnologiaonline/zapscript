'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function EmailConfirmadoPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('error=')) {
      setStatus('error');
    } else {
      setStatus('success');
    }
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"/>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-brand-surface rounded-2xl p-8"
            style={{ border: '1px solid rgba(239,68,68,.2)' }}>
            <div className="w-16 h-16 rounded-full bg-red-400/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <h2 className="text-xl font-bold text-red-400 mb-2">Link inválido ou expirado</h2>
            <p className="text-sm text-brand-text-secondary mb-6 leading-relaxed">
              O link de confirmação expirou ou já foi usado.<br/>
              Tente criar sua conta novamente para receber um novo link.
            </p>
            <Link href="/cadastro"
              className="btn-primary block w-full py-3 text-center text-sm">
              Criar conta novamente
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="bg-brand-surface rounded-2xl p-8"
          style={{ border: '1px solid rgba(var(--color-primary)/.15)' }}>
          <div className="w-16 h-16 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-brand-primary mb-2">E-mail confirmado!</h2>
          <p className="text-sm text-brand-text-secondary mb-6 leading-relaxed">
            Sua identidade foi verificada com sucesso.<br/>
            Agora você pode acessar o ZapScript.
          </p>
          <Link href="/login"
            className="btn-primary block w-full py-3 text-center text-sm">
            Fazer login
          </Link>
        </div>
        <p className="text-xs text-brand-muted mt-4">
          <Link href="/" className="hover:text-brand-primary transition-colors">zapscript.me</Link>
        </p>
      </div>
    </div>
  );
}
