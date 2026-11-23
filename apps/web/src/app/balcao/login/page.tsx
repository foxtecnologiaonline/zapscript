'use client';
import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBvSession, type LoginResult } from '@/lib/balcao/session';
import { errMsg, BvApiError } from '@/lib/balcao/api';
import { HOME_BY_ROLE } from '@/lib/balcao/nav';
import { A11yToolbar } from '@/lib/balcao/a11y';
import { Banner, Button, TextField, Select } from '../_ui/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, loginMfa } = useBvSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgs, setOrgs] = useState<Array<{ slug: string; name: string }>>([]);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (r: LoginResult) => {
    if (r.kind === 'ok') {
      const forced = r.me.mustChangePassword || r.me.mfaSetupRequired;
      router.replace(forced ? '/balcao/conta' : (params.get('next') || HOME_BY_ROLE[r.me.user.role] || '/balcao'));
    } else if (r.kind === 'mfa') { setMfaToken(r.mfaToken); setError(null); }
    else { setOrgs(r.orgs); setError('Seu e-mail existe em mais de um órgão. Selecione o órgão para continuar.'); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      done(mfaToken ? await loginMfa(mfaToken, code.trim()) : await login(email.trim(), password, orgSlug || undefined));
    } catch (err) {
      if (err instanceof BvApiError && err.code === 'auth.locked') setError('Conta bloqueada temporariamente por tentativas inválidas. Tente novamente em alguns minutos.');
      else if (err instanceof BvApiError && err.code === 'auth.rate_limited') setError('Muitas tentativas. Aguarde alguns minutos.');
      else setError(errMsg(err, 'Não foi possível entrar.'));
      if (mfaToken && err instanceof BvApiError && err.status === 401) setCode('');
    } finally { setBusy(false); }
  };

  return (
    <main id="bv-main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <a className="bv-skip" href="#bv-form">Ir para o formulário</a>
      <div className="mb-4 flex justify-end"><A11yToolbar /></div>
      <div className="rounded-lg border border-bv-border bg-bv-surface p-6">
        <h1 className="text-2xl font-semibold">Balcão Virtual</h1>
        <p className="mb-4 text-sm text-bv-muted">Acesso restrito a atendentes, supervisores e gestores.</p>
        {params.get('sessao') === 'expirada' && <div className="mb-3"><Banner tone="warning">Sua sessão expirou. Entre novamente.</Banner></div>}
        <form id="bv-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {!mfaToken ? (
            <>
              <TextField label="E-mail institucional" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <TextField label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              {orgs.length > 0 && (
                <Select label="Órgão" required value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}>
                  <option value="">Selecione…</option>
                  {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                </Select>
              )}
            </>
          ) : (
            <TextField label="Código do aplicativo autenticador" hint="6 dígitos, do Google Authenticator, Authy ou similar." inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          )}
          {error && <Banner tone="danger">{error}</Banner>}
          <Button type="submit" loading={busy}>{mfaToken ? 'Verificar' : 'Entrar'}</Button>
          {mfaToken && <Button variant="ghost" onClick={() => { setMfaToken(null); setCode(''); setError(null); }}>Voltar</Button>}
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
