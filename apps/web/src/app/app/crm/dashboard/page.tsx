'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBrl } from '@/lib/modules';
import { CrmDashboard, formatPhone } from '../lib';

const PERIODS = [
  { days: 7,  label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

export default function CrmDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notEntitled, setNotEntitled] = useState(false);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CrmDashboard | null>(null);

  const load = useCallback(async (periodDays: number) => {
    setLoading(true);
    try {
      const res = await api.get<CrmDashboard>(`/crm/dashboard?days=${periodDays}`);
      setData(res);
      setError(null);
    } catch (e: any) {
      if (e?.moduleRequired) {
        setNotEntitled(true);
      } else if (typeof window !== 'undefined' && !localStorage.getItem('zs_token')) {
        router.push('/login');
      } else {
        setError(e?.message || 'Não foi possível carregar o dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(days); }, [load, days]);

  if (loading && !data) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="text-neutral-500">Carregando...</div>
      </main>
    );
  }

  if (notEntitled) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-5 py-10">
        <div className="max-w-md w-full rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <div className="text-4xl mb-4">📈</div>
          <h1 className="text-xl font-bold mb-2">Dashboard do CRM</h1>
          <p className="text-neutral-400 mb-6">
            Acompanhe faturamento fechado, novos leads e seus clientes mais ativos direto do funil de vendas.
          </p>
          <Link href="/dashboard/plano?add=crm" className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500">
            Contratar módulo CRM
          </Link>
        </div>
      </main>
    );
  }

  const kpis = data ? [
    { label: 'Faturamento fechado', value: formatBrl(data.faturamentoFechado), icon: '💰' },
    { label: 'Negócios fechados',   value: String(data.negociosFechados),      icon: '✅' },
    { label: 'Negócios perdidos',   value: String(data.negociosPerdidos),      icon: '❌' },
    { label: 'Novos leads',         value: String(data.novosLeads),            icon: '🧲' },
    { label: 'Atendimentos/semana', value: String(data.atendimentosSemana),    icon: '💬' },
  ] : [];

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900/60 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/app/crm" className="text-neutral-500 hover:text-neutral-300 text-sm">← CRM</Link>
            <h1 className="text-lg font-bold flex items-center gap-2">📈 Dashboard</h1>
          </div>
          <div className="inline-flex rounded-lg border border-neutral-800 overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === p.days ? 'bg-emerald-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </header>

      <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
          {kpis.map(k => (
            <div key={k.label} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <div className="text-xl mb-1">{k.icon}</div>
              <div className="text-lg font-black leading-tight">{k.value}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        <h2 className="text-sm font-bold text-neutral-300 mb-3">Clientes mais ativos no período</h2>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
          {(!data || data.topClientes.length === 0) ? (
            <div className="text-sm text-neutral-600 text-center py-8">Nenhuma atividade registrada no período.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-[11px] text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Empresa</th>
                  <th className="px-4 py-2.5 font-medium text-right">Interações</th>
                  <th className="px-4 py-2.5 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.topClientes.map(c => (
                  <tr key={c.id} className="border-b border-neutral-800/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-neutral-500">{formatPhone(c.phone)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-400">{c.company || '—'}</td>
                    <td className="px-4 py-2.5 text-right">{c.activityCount}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-400">{c.value != null ? formatBrl(c.value) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
