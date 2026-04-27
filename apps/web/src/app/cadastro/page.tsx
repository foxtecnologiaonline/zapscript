'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

function formatDocument(val: string): string {
  const n = val.replace(/\D/g, '').slice(0, 14);
  if (n.length <= 11) {
    if (n.length <= 3)  return n;
    if (n.length <= 6)  return `${n.slice(0,3)}.${n.slice(3)}`;
    if (n.length <= 9)  return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6)}`;
    return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
  }
  if (n.length <= 12) return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8)}`;
  return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`;
}

export default function CadastroPage() {
  const router = useRouter();
  const [form, setForm]   = useState({ name: '', email: '', document: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);
  const [userEmail, setUserEmail] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: k === 'document' ? formatDocument(e.target.value) : e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('As senhas não coincidem.'); return; }
    if (form.password.length < 6)       { setError('Senha deve ter ao menos 6 caracteres.'); return; }

    setLoading(true);
    try {
      await api.post('/auth/register', {
        name:     form.name,
        email:    form.email,
        document: form.document.replace(/\D/g, '') || undefined,
        password: form.password,
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
          <p className="text-brand-text-secondary text-sm mt-2 font-light">10 minutos grátis, sem cartão de crédito</p>
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
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">CPF / CNPJ</label>
              <input className="field-input" placeholder="000.000.000-00" value={form.document} onChange={set('document')} maxLength={18}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Senha</label>
              <input className="field-input" type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={set('password')} required minLength={6}/>
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
