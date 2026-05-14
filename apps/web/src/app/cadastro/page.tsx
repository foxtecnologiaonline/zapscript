'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function CadastroPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const inviteCode   = searchParams.get('invite') || '';
  const [isTesterInvite, setIsTesterInvite] = useState(false);
  const [inviteName, setInviteName]         = useState('');

  const [form, setForm]   = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    if (!inviteCode) return;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
    fetch(`${apiUrl}/invites/validate/${inviteCode}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) {
          setIsTesterInvite(true);
          setInviteName(d.invite?.name || '');
        }
      })
      .catch(() => {});
  }, [inviteCode]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('As senhas não coincidem.'); return; }
    if (form.password.length < 8)       { setError('Senha deve ter ao menos 8 caracteres.'); return; }

    setLoading(true);
    try {
      await api.post('/auth/register', {
        name:       form.name,
        email:      form.email,
        password:   form.password,
        ...(inviteCode ? { inviteCode } : {}),
      });
      setUserEmail(form.email);
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao criar conta.');
      if (err.message?.includes('login')) setTimeout(() => router.push('/login'), 2000);
    } finally {
      setLoading(false);
    }
  }

  // ── Tela pós-cadastro ────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="bg-brand-surface rounded-2xl p-8"
            style={{ border: '1px solid rgba(var(--color-primary), .15)' }}>
            <div className="w-16 h-16 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">📧</span>
            </div>
            <h2 className="text-xl font-bold text-brand-primary mb-2">Verifique seu e-mail</h2>
            <p className="text-sm text-brand-text-secondary mb-1">Enviamos um link de confirmação para:</p>
            <p className="text-sm font-semibold text-brand-text mb-4 break-all">{userEmail}</p>
            <p className="text-xs text-brand-muted mb-6 leading-relaxed">
              Abra o e-mail e clique em{' '}
              <strong className="text-brand-primary">Confirmar meu e-mail</strong>{' '}
              para ativar sua conta.<br />O link expira em 24 horas.
            </p>
            <div className="space-y-2">
              <Link href="/login"
                className="btn-primary block w-full py-3 text-center text-sm">
                Já confirmei — Fazer login
              </Link>
              <button
                onClick={() => { setDone(false); setForm(f => ({ ...f, password: '', confirm: '' })); }}
                className="block w-full text-xs text-brand-muted hover:text-brand-primary transition-colors py-2">
                Voltar e usar outro e-mail
              </button>
            </div>
          </div>
          <p className="text-xs text-brand-muted mt-4">Não recebeu? Verifique a caixa de spam.</p>
        </div>
      </div>
    );
  }

  // ── Formulário de cadastro ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold text-brand-primary">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-pulse"/>ZapScript
          </Link>
          {isTesterInvite ? (
            <div className="mt-3 inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-2">
              <span>🧪</span>
              <div className="text-left">
                <div className="text-xs font-black text-amber-400 uppercase tracking-wider">Tester Oficial</div>
                <div className="text-[10px] text-amber-400/70">Plano PRO grátis por 1 ano</div>
              </div>
            </div>
          ) : (
            <p className="text-brand-text-secondary text-sm mt-2 font-light">10 minutos grátis, sem cartão de crédito</p>
          )}
        </div>

        <div className="bg-brand-surface rounded-2xl p-7"
          style={{ border: '1px solid rgba(var(--color-primary), .10)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Nome completo</label>
              <input className="field-input" placeholder="Seu nome" value={form.name} onChange={set('name')} required/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">E-mail</label>
              <input className="field-input" type="email" placeholder="seu@email.com" value={form.email} onChange={set('email')} required/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Senha</label>
              <input className="field-input" type="password" placeholder="Mínimo 8 caracteres" value={form.password} onChange={set('password')} required minLength={8}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Confirmar senha</label>
              <input className="field-input" type="password" placeholder="Repita a senha" value={form.confirm} onChange={set('confirm')} required/>
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50 mt-2">
              {loading ? 'Criando conta...' : 'Criar conta grátis'}
            </button>
          </form>

          <p className="text-center text-xs text-brand-muted mt-5">
            Já tem conta?{' '}
            <Link href="/login" className="text-brand-primary font-semibold hover:underline">Entrar</Link>
          </p>
          <p className="text-center text-[10px] text-brand-muted mt-3 leading-relaxed">
            Ao criar sua conta você concorda com os{' '}
            <Link href="/termos" className="underline">Termos de Uso</Link>
            {' '}e{' '}
            <Link href="/privacidade" className="underline">Política de Privacidade</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
