'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold mb-2">Algo deu errado</h2>
        <p className="text-[#6ee7b7] text-sm font-light mb-6">{error.message || 'Ocorreu um erro inesperado.'}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="bg-[#10b981] text-[#011a12] font-bold px-6 py-2.5 rounded-lg text-sm hover:bg-[#34d399] transition-colors">
            Tentar novamente
          </button>
          <a href="/" className="border border-[rgba(16,185,129,.2)] text-[#6ee7b7] font-semibold px-6 py-2.5 rounded-lg text-sm hover:border-[rgba(16,185,129,.4)] transition-colors">
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}
