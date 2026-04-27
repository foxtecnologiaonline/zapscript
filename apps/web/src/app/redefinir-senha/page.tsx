'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenError, setTokenError]   = useState(false);
  const [form, setForm]               = useState({ password: '', confirm: '' });
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(false);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const type  = params.get('type');
    if (!token || type !== 'recovery') {
      setTokenError(true);
    } else {
      setAccessToken(token);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('As senhas não coincidem.'); return; }
    if (form.password.length < 6)       { setError('Senha deve ter ao menos 6 caracteres.'); return; }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', {
        access_token: accessToken,
        new_password: form.password,
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch (err: any) {
      setError(err.message || 'Erro ao redefinir senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  // ── Token inválido ─────────────────────────────────────────────────────
  if (tokenError) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-brand-surface rounded-2xl p-8"
            style={{ border: '1px solid rgba(239,68,68,.2)' }}>
            <span className="text-3xl block mb-4">⏰</span>
            <h2 className="text-xl font-bold text-red-400 mb-2">Link inválido ou expirado</h2>
            <p className="text-sm text-brand-text-secondary mb-6 leading-relaxed">
              O link de redefinição expirou ou já foi usado.<br/>
              Solicite um novo link de recuperação.
            </p>
            <Link href="/esqueci-senha"
              className="btn-primary block w-full py-3 text-center text-sm">
              Solicitar novo link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Senha redefinida com sucesso ──────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-brand-surface rounded-2xl p-8"
            style={{ border: '1px solid rgba(var(--color-primary), .15)' }}>
            <span className="text-3xl block mb-4">🎉</span>
            <h2 className="text-xl font-bold text-brand-primary mb-2">Senha redefinida!</h2>
            <p className="text-sm text-brand-text-secondary mb-6">
              Sua nova senha foi salva com sucesso.<br/>
              Você será redirecionado para o login...
            </p>
            <Link href="/login"
              className="btn-primary block w-full py-3 text-center text-sm">
              Ir para o login agora
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Formulário de nova senha ──────────────────────────────────────────
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold text-brand-primary">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-pulse"/>ZapScript
          </Link>
          <p className="text-brand-text-secondary text-sm mt-2 font-light">Criar nova senha</p>
        </div>

        <div className="bg-brand-surface rounded-2xl p-7"
          style={{ border: '1px solid rgba(var(--color-primary), .10)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Nova senha</label>
              <input
                className="field-input"
                type="password" placeholder="Mínimo 6 caracteres"
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required minLength={6} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Confirmar nova senha</label>
              <input
                className="field-input"
                type="password" placeholder="Repita a nova senha"
                value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                required />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || !accessToken}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50">
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
