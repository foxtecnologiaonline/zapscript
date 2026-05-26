'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function EsqueciSenhaPage() {
  const [email, setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="bg-brand-surface rounded-2xl p-8"
            style={{ border: '1px solid rgba(var(--color-primary), .15)' }}>
            <div className="w-16 h-16 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">📬</span>
            </div>
            <h2 className="text-xl font-bold text-brand-primary mb-2">E-mail enviado!</h2>
            <p className="text-sm text-brand-text-secondary mb-1">
              Se <strong className="text-brand-text">{email}</strong> estiver cadastrado,
            </p>
            <p className="text-sm text-brand-text-secondary mb-6">você receberá as instruções em breve.</p>
            <Link href="/login"
              className="btn-primary block w-full py-3 text-center text-sm">
              Voltar ao login
            </Link>
            <p className="text-xs text-brand-muted mt-4">Não recebeu? Verifique o spam.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center">
            <Image src="/logo.png" alt="ZapScript" width={148} height={32} className="object-contain" />
          </Link>
          <p className="text-brand-text-secondary text-sm mt-2 font-light">Recuperar acesso à conta</p>
        </div>

        <div className="bg-brand-surface rounded-2xl p-7"
          style={{ border: '1px solid rgba(var(--color-primary), .10)' }}>
          <p className="text-sm text-brand-text-secondary mb-5 leading-relaxed">
            Digite o e-mail da sua conta e enviaremos um link para criar uma nova senha.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">E-mail cadastrado</label>
              <input
                className="field-input"
                type="email" placeholder="seu@email.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50">
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>
          </form>

          <p className="text-center text-xs text-brand-muted mt-5">
            Lembrou a senha?{' '}
            <Link href="/login" className="text-brand-primary font-semibold hover:underline">Fazer login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
