'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import BalanceCard from './_components/BalanceCard';

interface CampanhaListItem {
  id: string;
  name: string;
  status: string;
  channel: string; // 'meta' | 'evolution'
  templateName: string | null;
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
  draft: 'border-brand-border text-brand-muted',
  scheduled: 'border-blue-400/30 text-blue-500',
  running: 'border-emerald-400/30 text-emerald-600',
  paused: 'border-amber-400/30 text-amber-600',
  completed: 'border-blue-400/30 text-blue-500',
  canceled: 'border-red-400/30 text-red-500',
  failed: 'border-red-400/30 text-red-500',
};

const STATUS_FILTERS = ['todas', 'draft', 'scheduled', 'running', 'paused', 'completed'] as const;
const STATUS_FILTER_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  todas: 'Todas',
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em andamento',
  paused: 'Pausada',
  completed: 'Concluída',
};

export default function CampanhasListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [campanhas, setCampanhas] = useState<CampanhaListItem[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('todas');

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campanhas.filter((c) => {
      if (statusFilter !== 'todas' && c.status !== statusFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campanhas, search, statusFilter]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-brand-text-secondary">
        Carregando campanhas…
      </div>
    );
  }

  if (upsell) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">📣</div>
          <h1 className="text-xl font-bold mb-2 text-brand-text">Módulo Campanhas</h1>
          <p className="text-brand-text-secondary mb-6">
            Disparo em massa compliant via API oficial da Meta — incluso nos planos Profissional e Empresas.
          </p>
          <Link href="/dashboard/plano?add=campanhas" className="btn-primary inline-block px-4 py-2">
            Ver planos →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-brand-text">📣 ZapScript Campanhas</h1>
          <p className="text-brand-text-secondary mt-1">Disparo em massa compliant via API oficial da Meta.</p>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600">
            {error}
          </div>
        )}

        <BalanceCard />

        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <Link href="/dashboard/campanhas/nova" className="btn-primary px-4 py-2 text-sm">
            + Nova campanha
          </Link>
          <Link href="/dashboard/campanhas/listas" className="text-sm text-brand-text-secondary hover:text-brand-text">
            📋 Minhas listas de números →
          </Link>
          <Link href="/dashboard/campanhas/optouts" className="text-sm text-brand-text-secondary hover:text-brand-text">
            Ver opt-outs →
          </Link>
          <Link href="/dashboard/campanhas/performance" className="text-sm text-brand-text-secondary hover:text-brand-text">
            Performance por template →
          </Link>
        </div>

        {campanhas.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center">
            <p className="text-brand-muted">Nenhuma campanha ainda.</p>
            <p className="mt-2 text-sm text-brand-text-secondary">
              Alguns exemplos comuns: aviso de cobrança, reativação de clientes inativos, divulgação de promoção.
            </p>
            <Link href="/dashboard/campanhas/nova" className="btn-primary inline-block px-4 py-2 text-sm mt-4">
              + Criar minha primeira campanha
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome…"
                className="input w-auto flex-1 min-w-[180px] max-w-xs"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number])}
                className="rounded-lg border border-brand-border bg-brand-elevated px-2 py-2 text-sm text-brand-text-secondary"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>{STATUS_FILTER_LABEL[s]}</option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center text-brand-muted">
                Nenhuma campanha encontrada com esse filtro.
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((c) => {
                  const incompleteDraft = c.status === 'draft' && c.audienceCount === 0;
                  return (
                    <Link
                      key={c.id}
                      href={incompleteDraft ? `/dashboard/campanhas/nova?campanhaId=${c.id}` : `/dashboard/campanhas/${c.id}`}
                      className="card rounded-xl block p-4 hover:border-brand-primary/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium text-brand-text">{c.name}</div>
                          <div className="text-sm text-brand-muted mt-0.5">
                            {c.channel === 'evolution' ? 'Mensagem livre (Evolution)' : c.templateName}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {incompleteDraft ? (
                            <span className="text-xs rounded-full border border-brand-primary/30 text-brand-primary px-2 py-0.5 whitespace-nowrap">
                              Continuar configuração →
                            </span>
                          ) : (
                            <span
                              className={`text-xs rounded-full border px-2 py-0.5 whitespace-nowrap ${
                                STATUS_COLOR[c.status] || 'border-brand-border text-brand-muted'
                              }`}
                            >
                              {STATUS_LABEL[c.status] || c.status}
                            </span>
                          )}
                          {c.channel === 'evolution' && (
                            <span className="text-xs rounded-full border border-amber-400/30 text-amber-600 px-2 py-0.5 whitespace-nowrap">
                              Evolution
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-muted">
                        <span>{c.audienceCount} contatos</span>
                        <span>{c.sentCount} enviados</span>
                        {!!c.stats.delivered && <span>{c.stats.delivered} entregues</span>}
                        {!!c.stats.read && <span>{c.stats.read} lidos</span>}
                        {!!c.stats.failed && <span className="text-red-500">{c.stats.failed} falharam</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
