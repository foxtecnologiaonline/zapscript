'use client';
import { useState } from 'react';
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
      <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.15)] rounded-2xl p-8">
            <div className="w-16 h-16 rounded-full bg-[rgba(16,185,129,.12)] flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">📬</span>
            </div>
            <h2 className="text-xl font-bold text-[#10b981] mb-2">E-mail enviado!</h2>
            <p className="text-sm text-[#6ee7b7] mb-1">Se <strong className="text-white">{email}</strong> estiver cadastrado,</p>
            <p className="text-sm text-[#6ee7b7] mb-6">você receberá as instruções em breve.</p>
            <Link href="/login"
              className="block w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] transition-colors">
              Voltar ao login
            </Link>
            <p className="text-xs text-[rgba(16,185,129,.3)] mt-4">Não recebeu? Verifique o spam.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold text-[#10b981]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] animate-pulse"/>ZapScript
          </Link>
          <p className="text-[#6ee7b7] text-sm mt-2 font-light">Recuperar acesso à conta</p>
        </div>

        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-2xl p-7">
          <p className="text-sm text-[#6ee7b7] mb-5 leading-relaxed">
            Digite o e-mail da sua conta e enviaremos um link para criar uma nova senha.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#6ee7b7] mb-1.5">E-mail cadastrado</label>
              <input
                className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] transition-colors placeholder-[#064e3b]"
                type="email" placeholder="seu@email.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] transition-colors disabled:opacity-50">
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>
          </form>

          <p className="text-center text-xs text-[rgba(16,185,129,.4)] mt-5">
            Lembrou a senha?{' '}
            <Link href="/login" className="text-[#10b981] font-semibold hover:underline">Fazer login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
