'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import ConnectionCard, { MetaConnection } from './_components/ConnectionCard';

interface CampanhaListItem {
  id: string;
  name: string;
  status: string;
  templateName: string;
  audienceCount: number;
  sentCount: number;
  createdAt: string;
  whatsappNumber: { id: string; phoneNumber: string | null; displayName: string | null } | null;
  stats: Record<string, number>;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em andamento',
  paused: 'Pausada',
  completed: 'Concluída',
  canceled: 'Cancelada',
  failed: 'Falhou',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'border-neutral-700 text-neutral-400',
  scheduled: 'border-blue-700 text-blue-400',
  running: 'border-emerald-700 text-emerald-400',
  paused: 'border-amber-700 text-amber-400',
  completed: 'border-blue-700 text-blue-400',
  canceled: 'border-red-800 text-red-400',
  failed: 'border-red-800 text-red-400',
};

export default function CampanhasListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [campanhas, setCampanhas] = useState<CampanhaListItem[]>([]);
  const [meta, setMeta] = useState<MetaConnection | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ campanhas: CampanhaListItem[] }>('/modules/campanhas/');
        setCampanhas(res.campanhas || []);
      } catch (e: any) {
        if (e?.moduleRequired) setUpsell(true);
        else if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar suas campanhas.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando campanhas…
      </main>
    );
  }

  if (upsell) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 px-5">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">📣</div>
          <h1 className="text-xl font-bold mb-2">Contrate o ZapScript Campanhas</h1>
          <p className="text-neutral-400 mb-6">
            Disparo em massa compliant via API oficial da Meta — R$ 59,90/mês.
          </p>
          <Link
            href="/dashboard/plano?add=campanhas"
            className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
          >
            Contratar módulo →
          </Link>
          <div className="mt-4">
            <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">← Voltar aos módulos</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">← Módulos</Link>
          <h1 className="text-2xl font-bold mt-2">📣 ZapScript Campanhas</h1>
          <p className="text-neutral-400 mt-1">Disparo em massa compliant via API oficial da Meta.</p>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        <div className="mb-6">
          <ConnectionCard onReady={setMeta} />
        </div>

        <div className="mb-6 flex items-center gap-3">
          {meta ? (
            <Link
              href="/app/campanhas/nova"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Nova campanha
            </Link>
          ) : (
            <span className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-500">
              Conecte um número para criar campanhas
            </span>
          )}
          <Link href="/app/campanhas/optouts" className="text-sm text-neutral-400 hover:text-neutral-200">
            Ver opt-outs →
          </Link>
        </div>

        {campanhas.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center text-neutral-500">
            Nenhuma campanha ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {campanhas.map((c) => (
              <Link
                key={c.id}
                href={`/app/campanhas/${c.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900 p-4 hover:border-emerald-700 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-sm text-neutral-500 mt-0.5">{c.templateName}</div>
                  </div>
                  <span
                    className={`text-xs rounded-full border px-2 py-0.5 whitespace-nowrap ${
                      STATUS_COLOR[c.status] || 'border-neutral-700 text-neutral-400'
                    }`}
                  >
                    {STATUS_LABEL[c.status] || c.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <span>{c.audienceCount} contatos</span>
                  <span>{c.sentCount} enviados</span>
                  {!!c.stats.delivered && <span>{c.stats.delivered} entregues</span>}
                  {!!c.stats.read && <span>{c.stats.read} lidos</span>}
                  {!!c.stats.failed && <span className="text-red-400">{c.stats.failed} falharam</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
