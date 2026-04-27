'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setNeedsVerification(false);
    try {
      const res = await api.post<{ token: string }>('/auth/login', form);
      api.setToken(res.token);
      router.push('/dashboard');
    } catch (err: any) {
      if (err.needsVerification) {
        setNeedsVerification(true);
      }
      setError(err.message || 'Credenciais inválidas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mesh font-sans flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[390px]">

        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <div className="w-10 h-10 bg-brand-primary rounded-xl flex items-center justify-center shadow-glow-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
              </svg>
            </div>
            <span className="font-display font-bold text-xl">ZapScript</span>
          </div>
          <p className="text-sm font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>Bem-vindo de volta</p>
        </div>

        <div className="card rounded-2xl p-7">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>E-mail</label>
              <input className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'rgb(var(--color-surface-elevated))', border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text))' }}
                type="email" placeholder="seu@email.com" value={form.email} onChange={set('email')} required />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold" style={{ color: 'rgb(var(--color-text-secondary))' }}>Senha</label>
                <Link href="/esqueci-senha"
                  className="text-xs hover:underline"
                  style={{ color: 'rgb(var(--color-primary))' }}>
                  Esqueci minha senha
                </Link>
              </div>
              <input className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'rgb(var(--color-surface-elevated))', border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text))' }}
                type="password" placeholder="••••••••" value={form.password} onChange={set('password')} required />
            </div>

            {error && (
              <div className="text-xs px-3 py-2.5 rounded-xl" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171' }}>
                {error}
                {needsVerification && (
                  <p className="mt-1.5" style={{ color: '#fca5a5' }}>
                    Não recebeu o e-mail?{' '}
                    <Link href="/cadastro" className="underline font-semibold">Crie sua conta novamente</Link>
                    {' '}ou verifique o spam.
                  </p>
                )}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-3.5 text-sm mt-1 disabled:opacity-50">
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Não tem conta?{' '}
            <Link href="/cadastro" className="font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>
              Cadastrar grátis
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
