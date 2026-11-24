'use client';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { bv, errMsg, storeSession } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { HOME_BY_ROLE } from '@/lib/balcao/nav';
import { Banner, Spinner } from '../../_ui/ui';

/** Destino do redirecionamento do IdP (config.frontendRedirect = .../balcao/login/oidc): troca o código de uso único por sessão. */
function Exchange() {
  const params = useSearchParams();
  const router = useRouter();
  const { reload } = useBvSession();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // o código é de uso único: nunca trocar duas vezes (StrictMode)
    ran.current = true;
    const code = params.get('code');
    if (!code) { setError('Código de acesso ausente. Volte e tente entrar novamente.'); return; }
    (async () => {
      try {
        const tokens = await bv.anon.post<any>('/integrations/oidc/exchange', { code });
        storeSession(tokens);
        await reload();
        router.replace(HOME_BY_ROLE[tokens.user?.role] ?? '/balcao');
      } catch (e) { setError(errMsg(e, 'Não foi possível concluir o login. O código pode ter expirado.')); }
    })();
  }, [params, reload, router]);

  return (
    <main id="bv-main" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4">
      {error ? (<><Banner tone="danger">{error}</Banner><Link className="text-bv-primary underline" href="/balcao/login">Voltar ao login</Link></>)
        : (<><Spinner size={32} label="Concluindo o login" /><p>Concluindo o login…</p></>)}
    </main>
  );
}
export default function OidcReturnPage() { return <Suspense fallback={null}><Exchange /></Suspense>; }
