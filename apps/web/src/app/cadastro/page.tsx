'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

function formatDocument(val: string): string {
  const n = val.replace(/\D/g, '').slice(0, 14);
  if (n.length <= 11) {
    // CPF: 000.000.000-00
    if (n.length <= 3)  return n;
    if (n.length <= 6)  return `${n.slice(0,3)}.${n.slice(3)}`;
    if (n.length <= 9)  return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6)}`;
    return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
  }
  // CNPJ: 00.000.000/0000-00
  if (n.length <= 12) return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8)}`;
  return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`;
}

export default function CadastroPage() {
  const router = useRouter();
  const [form, setForm]   = useState({ name: '', email: '', document: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);      // estado pós-cadastro
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
      // Cadastro concluído — exibir tela de "verifique seu e-mail"
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
      <div className="min-h-screen bg-[#0c0c12] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.15)] rounded-2xl p-8">
            <div className="w-16 h-16 rounded-full bg-[rgba(16,185,129,.12)] flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">📧</span>
            </div>
            <h2 className="text-xl font-bold text-[#10b981] mb-2">Verifique seu e-mail</h2>
            <p className="text-sm text-[#6ee7b7] mb-1">Enviamos um link de confirmação para:</p>
            <p className="text-sm font-semibold text-white mb-4 break-all">{userEmail}</p>
            <p className="text-xs text-[rgba(16,185,129,.5)] mb-6 leading-relaxed">
              Abra o e-mail e clique em <strong className="text-[rgba(16,185,129,.8)]">Confirmar meu e-mail</strong> para ativar sua conta.<br />
              O link expira em 24 horas.
            </p>
            <div className="space-y-2">
              <Link href="/login"
                className="block w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] transition-colors text-center">
                Já confirmei — Fazer login
              </Link>
              <button
                onClick={() => { setDone(false); setForm(f => ({ ...f, password: '', confirm: '' })); }}
                className="block w-full text-xs text-[rgba(16,185,129,.4)] hover:text-[#10b981] transition-colors py-2">
                Voltar e usar outro e-mail
              </button>
            </div>
          </div>
          <p className="text-xs text-[rgba(16,185,129,.3)] mt-4">
            Não recebeu? Verifique a caixa de spam.
          </p>
        </div>
      </div>
    );
  }

  // ── Formulário de cadastro ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0c0c12] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold text-[#10b981]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] animate-pulse"/>ZapScript
          </Link>
          <p className="text-[#6ee7b7] text-sm mt-2 font-light">10 minutos grátis, sem cartão de crédito</p>
        </div>

        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-2xl p-7">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#6ee7b7] mb-1.5">Nome completo</label>
              <input className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] transition-colors placeholder-[#064e3b]"
                placeholder="Seu nome" value={form.name} onChange={set('name')} required/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#6ee7b7] mb-1.5">E-mail</label>
              <input className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] transition-colors placeholder-[#064e3b]"
                type="email" placeholder="seu@email.com" value={form.email} onChange={set('email')} required/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#6ee7b7] mb-1.5">CPF / CNPJ</label>
              <input className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] transition-colors placeholder-[#064e3b]"
                placeholder="000.000.000-00" value={form.document} onChange={set('document')} maxLength={18}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#6ee7b7] mb-1.5">Senha</label>
              <input className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] transition-colors placeholder-[#064e3b]"
                type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={set('password')} required minLength={6}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#6ee7b7] mb-1.5">Confirmar senha</label>
              <input className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] transition-colors placeholder-[#064e3b]"
                type="password" placeholder="Repita a senha" value={form.confirm} onChange={set('confirm')} required/>
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] transition-colors disabled:opacity-50 mt-2">
              {loading ? 'Criando conta...' : 'Criar conta grátis'}
            </button>
          </form>

          <p className="text-center text-xs text-[rgba(16,185,129,.4)] mt-5">
            Já tem conta?{' '}
            <Link href="/login" className="text-[#10b981] font-semibold hover:underline">Entrar</Link>
          </p>
          <p className="text-center text-[10px] text-[rgba(16,185,129,.3)] mt-3 leading-relaxed">
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
