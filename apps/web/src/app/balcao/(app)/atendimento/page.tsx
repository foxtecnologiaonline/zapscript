import { Suspense } from 'react';
import type { Metadata } from 'next';
import AtendimentoConsole from './AtendimentoConsole';

export const metadata: Metadata = { title: 'Atendimento' };

export default function AtendimentoPage() {
  return (
    <Suspense fallback={<p role="status" className="p-6 text-sm">Carregando atendimento…</p>}>
      <AtendimentoConsole />
    </Suspense>
  );
}
