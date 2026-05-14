'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm]   = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendOk, setResendOk]   = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function resendConfirmation() {
    setResending(true);
    try {
      await api.post('/auth/resend-confirmation', { email: form.email });
      setResendOk(true);
    } catch {
      // silently ignore — backend always returns success
      setResendOk(true);
    } finally {
      setResending(false);
    }
  }

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
    <div className="min-h-screen bg-mesh font-sans flex items-center justify-center px-4 py-4 sm:py-12">
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
              <div className="relative">
                <input className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-colors"
                  style={{ background: 'rgb(var(--color-surface-elevated))', border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text))' }}
                  type={showPass ? 'text' : 'password'} placeholder="••••••••" value={form.password} onChange={set('password')} required />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-80"
                  style={{ color: 'rgb(var(--color-text-muted))' }}
                  aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}>
                  {showPass ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs px-3 py-2.5 rounded-xl" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171' }}>
                {error}
                {needsVerification && !resendOk && (
                  <p className="mt-1.5" style={{ color: '#fca5a5' }}>
                    Não recebeu o e-mail?{' '}
                    <button type="button" disabled={resending} onClick={resendConfirmation}
                      className="underline font-semibold disabled:opacity-50">
                      {resending ? 'Reenviando...' : 'Reenviar link de ativação'}
                    </button>
                  </p>
                )}
                {resendOk && (
                  <p className="mt-1.5 text-green-400">Link reenviado! Verifique sua caixa de entrada.</p>
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
