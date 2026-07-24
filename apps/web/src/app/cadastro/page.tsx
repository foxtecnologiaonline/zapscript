'use client';
import { useState, useEffect, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { captureAffiliateFromUrl, readAffiliateCode, clearAffiliateCode } from '@/lib/affiliate';
import { readUtm } from '@/lib/utm';

function CadastroForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const inviteCode    = searchParams.get('invite') || '';
  const referralCode  = searchParams.get('ref')    || '';
  // Captura o ?aff= (limpando a barra) e lê o código guardado (30 dias)
  const [affiliateCode, setAffiliateCode] = useState('');
  useEffect(() => {
    captureAffiliateFromUrl();
    setAffiliateCode(readAffiliateCode());
  }, []);
  const [isTesterInvite, setIsTesterInvite] = useState(false);

  const [form, setForm]   = useState({ name: '', email: '', password: '' });
  // Handoff da demo: e-mail já digitado na isca chega em ?email= e vem pré-preenchido
  const prefillEmail = searchParams.get('email') || '';
  useEffect(() => {
    if (prefillEmail) setForm(f => (f.email ? f : { ...f, email: prefillEmail }));
  }, [prefillEmail]);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // Magic link (expresso): o usuário já provou valor na demo, só quer acessar
  const [magicSent, setMagicSent] = useState(false);
  const [magicSending, setMagicSending] = useState(false);

  async function handleMagicRegister() {
    const emailVal = form.email.trim().toLowerCase();
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setError('Informe um e-mail válido para criar sua conta.');
      return;
    }
    setMagicSending(true);
    setError('');
    try {
      await api.post('/auth/magic-register', { email: emailVal });
      setMagicSent(true);
      setUserEmail(emailVal);
    } catch (e: any) {
      setError(e?.message || 'Erro ao criar conta. Tente novamente.');
    } finally {
      setMagicSending(false);
    }
  }

  // Consentimentos LGPD — único aceite cobre todos os documentos
  const [cbAll, setCbAll] = useState(false);
  const [consentError, setConsentError] = useState(false);

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

    // Validação do consentimento unificado
    if (!cbAll) {
      setConsentError(true);
      setError('Aceite os termos para continuar.');
      return;
    }

    if (form.password.length < 8) { setError('Senha deve ter ao menos 8 caracteres.'); return; }

    setLoading(true);
    try {
      const utm = readUtm();
      const res = await api.post<{ token: string }>('/auth/register', {
        name:       form.name,
        email:      form.email,
        password:   form.password,
        cbTos:      cbAll,
        cbContrato: cbAll,
        cbLgpd:     cbAll,
        cbMarketing: cbAll,
        docVersion: 'tos_v2.0,contrato_v2.0,pp_v2.0',
        ...(inviteCode    ? { inviteCode }    : {}),
        ...(referralCode  ? { referralCode }  : {}),
        ...(affiliateCode ? { affiliateCode } : {}),
        ...(utm.source    ? { utmSource: utm.source }     : {}),
        ...(utm.campaign  ? { utmCampaign: utm.campaign }  : {}),
        ...(utm.medium    ? { utmMedium: utm.medium }      : {}),
      });
      track('signup', { utmSource: utm.source, utmCampaign: utm.campaign, utmMedium: utm.medium });
      // Opção A: login automático — o usuário já entra usando o ZapScript.
      // A verificação de e-mail e o CPF são exigidos só na assinatura.
      if (res?.token) {
        api.setToken(res.token);
        clearAffiliateCode();
        router.push('/dashboard');
        return;
      }
      // Fallback (caso a API não retorne token): mantém a tela de confirmação.
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
  if (done || magicSent) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="bg-brand-surface rounded-2xl p-8"
            style={{ border: '1px solid rgba(var(--color-primary)/.15)' }}>
            <div className="w-16 h-16 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">{magicSent ? '⚡' : '📧'}</span>
            </div>
            <h2 className="text-xl font-bold text-brand-primary mb-2">
              {magicSent ? 'Link de acesso enviado!' : 'Verifique seu e-mail'}
            </h2>
            <p className="text-sm text-brand-text-secondary mb-1">
              {magicSent ? 'Enviamos um link mágico para:' : 'Enviamos um link de confirmação para:'}
            </p>
            <p className="text-sm font-semibold text-brand-text mb-4 break-all">{userEmail}</p>
            <p className="text-xs text-brand-muted mb-6 leading-relaxed">
              {magicSent
                ? <>Clique no link e acesse seu painel <strong className="text-brand-primary">direto, sem senha</strong>.<br />Sem burocracia — sua conta já está ativa.</>
                : <>Abra o e-mail e clique em{' '}
                    <strong className="text-brand-primary">Confirmar meu e-mail</strong>{' '}
                    para ativar sua conta.<br />O link expira em 24 horas.</>}
            </p>
            {!magicSent && (
              <div className="rounded-xl px-4 py-3 mb-4 text-left"
                style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)' }}>
                <p className="text-xs text-brand-text leading-relaxed">
                  <span className="font-bold text-brand-primary">🔥 50% OFF no 1º mês:</span>{' '}
                  confirme seu e-mail e assine o Pro por <strong>R$18 no 1º mês</strong> (depois R$37/mês).
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Link href="/login" className="btn-primary block w-full py-3 text-center text-sm">
                {magicSent ? 'Já acessei — Ir para o painel' : 'Já confirmei — Fazer login'}
              </Link>
              <button
                onClick={() => { setDone(false); setMagicSent(false); setForm(f => ({ ...f, password: '' })); }}
                className="block w-full text-xs text-brand-muted hover:text-brand-primary transition-colors py-2">
                {magicSent ? 'Tentar com outro e-mail' : 'Voltar e usar outro e-mail'}
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
            <Link href="/" className="inline-flex items-center justify-center">
              <Image src="/logo.png" alt="ZapScript" width={148} height={32} className="object-contain" />
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
            <>
              <h1 className="text-brand-text text-lg sm:text-xl font-semibold mt-3 leading-tight">
                Para quem prefere ler a ouvir.
              </h1>
              <p className="text-brand-text-secondary text-sm mt-1.5 font-light">
                Comece com 15 áudios grátis — sem cartão de crédito.
              </p>
            </>
          )}
        </div>

        <div className="bg-brand-surface rounded-2xl p-5 sm:p-7"
          style={{ border: '1px solid rgba(var(--color-primary)/.10)' }}>
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
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Senha</label>
              <div className="relative">
                <input
                  className="field-input pr-10"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Mínimo 8 caracteres"
                  value={form.password}
                  onChange={set('password')}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-primary transition-colors"
                  tabIndex={-1}
                  aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPwd ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Consentimento unificado LGPD */}
            <label className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${consentError ? 'bg-red-500/10 border border-red-500/30' : 'bg-white/3 border border-white/8 hover:bg-white/5'}`}>
              <input
                type="checkbox"
                checked={cbAll}
                onChange={e => { setCbAll(e.target.checked); if (e.target.checked) setConsentError(false); }}
                className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0"
              />
              <span className="text-[12px] text-brand-text-secondary leading-relaxed">
                Li e aceito os{' '}
                <Link href="/termos" target="_blank" className="text-brand-primary hover:underline font-medium">Termos de Serviço</Link>
                {', o '}
                <Link href="/contrato" target="_blank" className="text-brand-primary hover:underline font-medium">Contrato de Prestação</Link>
                {' e a '}
                <Link href="/privacidade" target="_blank" className="text-brand-primary hover:underline font-medium">Política de Privacidade</Link>
                {', e autorizo o tratamento dos meus dados conforme a LGPD.'}
              </span>
            </label>

            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50">
              {loading ? 'Criando conta...' : 'Criar conta grátis →'}
            </button>

            {/* Magic link expresso — para quem não quer digitar senha */}
            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-brand-border/50" />
              </div>
              <div className="relative flex justify-center text-[10px]">
                <span className="px-2 text-brand-muted bg-brand-surface">ou, sem senha</span>
              </div>
            </div>
            <button type="button" onClick={handleMagicRegister} disabled={magicSending}
              className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-80 active:scale-[.98] disabled:opacity-50"
              style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-primary))' }}>
              {magicSending ? 'Enviando link…' : '⚡ Criar conta com link mágico'}
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
