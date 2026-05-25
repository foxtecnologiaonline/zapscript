'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

function CadastroForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const inviteCode   = searchParams.get('invite') || '';
  const [isTesterInvite, setIsTesterInvite] = useState(false);

  const [form, setForm]   = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // Consentimentos LGPD
  const [cbTos,       setCbTos]       = useState(false);
  const [cbContrato,  setCbContrato]  = useState(false);
  const [cbLgpd,      setCbLgpd]      = useState(false);
  const [cbMarketing, setCbMarketing] = useState(false);
  const [consentErrors, setConsentErrors] = useState({ tos: false, contrato: false, lgpd: false });

  useEffect(() => {
    if (!inviteCode) return;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
    fetch(`${apiUrl}/invites/validate/${inviteCode}`)
      .then(r => r.json())
      .then(d => { if (d.valid) setIsTesterInvite(true); })
      .catch(() => {});
  }, [inviteCode]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validação dos consentimentos obrigatórios
    const errs = { tos: !cbTos, contrato: !cbContrato, lgpd: !cbLgpd };
    setConsentErrors(errs);
    if (errs.tos || errs.contrato || errs.lgpd) {
      setError('Aceite todos os termos obrigatórios para continuar.');
      return;
    }

    if (form.password !== form.confirm) { setError('As senhas não coincidem.'); return; }
    if (form.password.length < 8)       { setError('Senha deve ter ao menos 8 caracteres.'); return; }

    setLoading(true);
    try {
      await api.post('/auth/register', {
        name:       form.name,
        email:      form.email,
        phone:      form.phone || undefined,
        password:   form.password,
        cbTos,
        cbContrato,
        cbLgpd,
        cbMarketing,
        docVersion: 'tos_v2.0,contrato_v2.0,pp_v2.0',
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
              <Link href="/login" className="btn-primary block w-full py-3 text-center text-sm">
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
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-4 sm:py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-4 sm:mb-8">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold text-brand-primary">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-pulse"/>ZapScript
            </Link>
          </div>
          {isTesterInvite ? (
            <div className="mt-3 flex justify-center">
              <div className="inline-flex items-center gap-3 bg-amber-400/15 border-2 border-amber-400/50 rounded-xl px-5 py-2 max-w-full">
                <span className="text-xl flex-shrink-0">🏅</span>
                <div className="text-left min-w-0">
                  <div className="text-xs font-black text-amber-300 uppercase tracking-widest">Tester Oficial</div>
                  <div className="text-[11px] font-semibold text-amber-400">Plano PRO grátis por 1 ano</div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-brand-text-secondary text-sm mt-2 font-light">10 minutos grátis, sem cartão de crédito</p>
          )}
        </div>

        <div className="bg-brand-surface rounded-2xl p-5 sm:p-7"
          style={{ border: '1px solid rgba(var(--color-primary), .10)' }}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Nome completo</label>
              <input className="field-input" placeholder="Seu nome" value={form.name} onChange={set('name')} required/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">E-mail</label>
              <input className="field-input" type="email" placeholder="seu@email.com" value={form.email} onChange={set('email')} required/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">
                Celular <span className="font-normal text-brand-muted">(opcional)</span>
              </label>
              <input
                className="field-input"
                type="tel"
                placeholder="(11) 99999-9999"
                value={form.phone}
                onChange={set('phone')}
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Senha</label>
              <input className="field-input" type="password" placeholder="Mínimo 8 caracteres" value={form.password} onChange={set('password')} required minLength={8}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Confirmar senha</label>
              <input className="field-input" type="password" placeholder="Repita a senha" value={form.confirm} onChange={set('confirm')} required/>
            </div>

            {/* Consentimentos LGPD */}
            <div className="rounded-xl p-3 mt-1 space-y-1"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-[10px] text-brand-muted uppercase tracking-widest font-mono mb-2">
                Consentimentos legais
              </p>

              {/* Termos de Serviço — obrigatório */}
              <label className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${consentErrors.tos ? 'bg-red-500/10' : 'hover:bg-white/5'}`}>
                <input
                  type="checkbox"
                  checked={cbTos}
                  onChange={e => { setCbTos(e.target.checked); if (e.target.checked) setConsentErrors(prev => ({ ...prev, tos: false })); }}
                  className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0"
                />
                <span className="text-[12px] text-brand-text-secondary leading-relaxed">
                  Li e concordo com os{' '}
                  <Link href="/termos" target="_blank" className="text-brand-primary hover:underline font-medium">Termos de Serviço</Link>
                  {' '}<span className="font-mono text-[10px] text-brand-primary bg-brand-primary/10 px-1 rounded">obrigatório</span>
                </span>
              </label>
              {consentErrors.tos && <p className="text-[11px] text-red-400 pl-7">Aceite obrigatório para acessar o serviço.</p>}

              {/* Contrato de Prestação — obrigatório */}
              <label className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${consentErrors.contrato ? 'bg-red-500/10' : 'hover:bg-white/5'}`}>
                <input
                  type="checkbox"
                  checked={cbContrato}
                  onChange={e => { setCbContrato(e.target.checked); if (e.target.checked) setConsentErrors(prev => ({ ...prev, contrato: false })); }}
                  className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0"
                />
                <span className="text-[12px] text-brand-text-secondary leading-relaxed">
                  Li e aceito o{' '}
                  <Link href="/contrato" target="_blank" className="text-brand-primary hover:underline font-medium">Contrato de Prestação de Serviços</Link>
                  , incluindo SLA e condições de rescisão.{' '}
                  <span className="font-mono text-[10px] text-brand-primary bg-brand-primary/10 px-1 rounded">obrigatório</span>
                </span>
              </label>
              {consentErrors.contrato && <p className="text-[11px] text-red-400 pl-7">Aceite obrigatório para contratar o serviço.</p>}

              {/* LGPD — obrigatório */}
              <label className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${consentErrors.lgpd ? 'bg-red-500/10' : 'hover:bg-white/5'}`}>
                <input
                  type="checkbox"
                  checked={cbLgpd}
                  onChange={e => { setCbLgpd(e.target.checked); if (e.target.checked) setConsentErrors(prev => ({ ...prev, lgpd: false })); }}
                  className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0"
                />
                <span className="text-[12px] text-brand-text-secondary leading-relaxed">
                  Autorizo o tratamento dos meus dados para criação de conta conforme a{' '}
                  <Link href="/privacidade" target="_blank" className="text-brand-primary hover:underline font-medium">Política de Privacidade</Link>
                  {' '}e a LGPD.{' '}
                  <span className="font-mono text-[10px] text-brand-primary bg-brand-primary/10 px-1 rounded">obrigatório</span>
                </span>
              </label>
              {consentErrors.lgpd && <p className="text-[11px] text-red-400 pl-7">Autorização necessária para criarmos sua conta.</p>}

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

              {/* Marketing — opcional */}
              <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                <input
                  type="checkbox"
                  checked={cbMarketing}
                  onChange={e => setCbMarketing(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0"
                />
                <span className="text-[12px] text-brand-muted leading-relaxed">
                  Autorizo o envio de novidades e ofertas por e-mail. Posso revogar a qualquer momento.{' '}
                  <span className="font-mono text-[10px] text-brand-muted/60 bg-white/5 px-1 rounded">opcional</span>
                </span>
              </label>

              <p className="text-[10px] text-brand-muted/50 font-mono leading-relaxed pt-1 px-1">
                Aceites #1–3 são necessários para execução do contrato (Art. 7º V LGPD). Todos registrados com timestamp e versão dos documentos (Art. 8º §2º LGPD).
              </p>
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50">
              {loading ? 'Criando conta...' : 'Criar conta grátis →'}
            </button>
          </form>

          <p className="text-center text-xs text-brand-muted mt-4">
            Já tem conta?{' '}
            <Link href="/login" className="text-brand-primary font-semibold hover:underline">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CadastroPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-primary text-sm animate-pulse">Carregando...</div>
      </div>
    }>
      <CadastroForm />
    </Suspense>
  );
}
