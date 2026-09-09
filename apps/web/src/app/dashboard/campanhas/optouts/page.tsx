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
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>
        <h1 className="text-2xl font-bold mt-2 mb-2 text-brand-text">Opt-outs</h1>
        <p className="text-brand-text-secondary text-sm mb-6">
          Contatos que responderam PARAR, SAIR, STOP, CANCELAR ou UNSUBSCRIBE. Eles são excluídos automaticamente
          de futuras campanhas — não é possível reverter manualmente por aqui, exige novo consentimento do contato.
        </p>

        {loading ? (
          <p className="text-brand-muted">Carregando…</p>
        ) : error ? (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
            {error}
          </div>
        ) : optOuts.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center text-brand-muted">
            Nenhum opt-out registrado ainda.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-brand-border">
            <table className="w-full text-sm">
              <thead className="bg-brand-elevated text-brand-text-secondary text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Telefone</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {optOuts.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2 text-brand-text-secondary">{o.phone}</td>
                    <td className="px-3 py-2 text-brand-text-secondary">
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-600">
                        {o.reason || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-brand-muted">
                      {new Date(o.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
