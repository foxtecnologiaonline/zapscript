'use client';
import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { track, trackOnce } from '@/lib/analytics';
import { readUtm } from '@/lib/utm';

function SuccessContent() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const plan        = searchParams.get('plan') || '';
  const ref         = searchParams.get('ref') || searchParams.get('payment') || '';
  const value       = Number(searchParams.get('value')) || undefined;

  // Conversão "assinatura" — dispara 1x por referência de pagamento (evita
  // duplo-disparo em refresh). Sem ref, dispara direto (página é one-shot).
  useEffect(() => {
    const utm = readUtm();
    const params = {
      ...(value != null ? { value, currency: 'BRL', transactionId: ref || undefined } : {}),
      ...(utm.source    ? { utmSource: utm.source }     : {}),
      ...(utm.campaign  ? { utmCampaign: utm.campaign }  : {}),
      ...(utm.medium    ? { utmMedium: utm.medium }      : {}),
    };
    if (ref) trackOnce(`sub_${ref}`, 'subscribe', params);
    else     track('subscribe', params);
  }, [ref, value]);

  // Redirecionar para /dashboard/plano após 5 segundos
  useEffect(() => {
    const id = setTimeout(() => {
      router.push(`/dashboard/plano?upgrade=success${plan ? `&plan=${plan}` : ''}`);
    }, 5000);
    return () => clearTimeout(id);
  }, [router, plan]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'rgb(var(--color-bg))' }}>
      <div className="w-full max-w-sm text-center">

        {/* Ícone de sucesso */}
        <div className="w-20 h-20 rounded-full bg-brand-primary/10 border-2 border-brand-primary/30 flex items-center justify-center mx-auto mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgb(var(--color-primary))' }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-brand-text mb-2">Pagamento confirmado!</h1>
        <p className="text-sm text-brand-text-secondary mb-1">
          {plan
            ? <>Seu plano <strong style={{ color: 'rgb(var(--color-primary))' }} className="capitalize">{plan}</strong> está ativo.</>
            : 'Sua assinatura está ativa.'}
        </p>
        <p className="text-xs text-brand-muted mb-8">
          Seu plano foi atualizado. Redirecionando em instantes…
        </p>

        <div className="space-y-2">
          <Link
            href={`/dashboard/plano?upgrade=success${plan ? `&plan=${plan}` : ''}`}
            className="btn-primary block w-full py-3 text-sm font-semibold"
          >
            Ir para o painel →
          </Link>
          <Link href="/dashboard/invoices" className="btn-ghost block w-full py-2 text-xs">
            🧾 Ver faturas
          </Link>
        </div>

      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-brand-muted text-sm">Carregando...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
