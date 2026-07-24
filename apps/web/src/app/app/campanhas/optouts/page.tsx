'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface OptOut {
  id: string;
  phone: string;
  reason: string | null;
  createdAt: string;
}

export default function OptOutsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ optOuts: OptOut[] }>('/modules/campanhas/optouts');
        setOptOuts(res.optOuts || []);
      } catch (e: any) {
        if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar os opt-outs.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/app/campanhas" className="text-sm text-neutral-500 hover:text-neutral-300">← Campanhas</Link>
        <h1 className="text-2xl font-bold mt-2 mb-2">Opt-outs</h1>
        <p className="text-neutral-400 text-sm mb-6">
          Contatos que responderam PARAR, SAIR, STOP, CANCELAR ou UNSUBSCRIBE. Eles são excluídos automaticamente
          de futuras campanhas — não é possível reverter manualmente por aqui, exige novo consentimento do contato.
        </p>

        {loading ? (
          <p className="text-neutral-500">Carregando…</p>
        ) : error ? (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {error}
          </div>
        ) : optOuts.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center text-neutral-500">
            Nenhum opt-out registrado ainda.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Telefone</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {optOuts.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2 text-neutral-300">{o.phone}</td>
                    <td className="px-3 py-2 text-neutral-400">
                      <span className="rounded-full border border-amber-800 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-300">
                        {o.reason || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      {new Date(o.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
