'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function FailedContent() {
  const searchParams = useSearchParams();
  const plan         = searchParams.get('plan') || '';

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'rgb(var(--color-bg))' }}>
      <div className="w-full max-w-sm text-center">

        {/* Ícone de erro */}
        <div className="w-20 h-20 rounded-full bg-red-400/10 border-2 border-red-400/25 flex items-center justify-center mx-auto mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#f87171' }}>
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-brand-text mb-2">Pagamento não concluído</h1>
        <p className="text-sm text-brand-text-secondary mb-1">
          Não conseguimos processar seu pagamento.
        </p>
        <p className="text-xs text-brand-muted mb-8">
          Nenhuma cobrança foi realizada. Você pode tentar novamente com outro método de pagamento.
        </p>

        <div className="space-y-2">
          <Link
            href={`/dashboard/plano${plan ? `?retry=${plan}` : ''}`}
            className="btn-primary block w-full py-3 text-sm font-semibold"
          >
            Tentar novamente →
          </Link>
          <Link href="/dashboard" className="btn-ghost block w-full py-2 text-xs">
            Voltar ao painel
          </Link>
        </div>

        <p className="text-xs text-brand-muted mt-6">
          Dúvidas? Fale conosco em{' '}
          <a href="mailto:contato@zapscript.me" className="text-brand-primary hover:underline">
            contato@zapscript.me
          </a>
        </p>
      </div>
    </div>
  );
}

export default function PaymentFailedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-brand-muted text-sm">Carregando...</div>}>
      <FailedContent />
    </Suspense>
  );
}
