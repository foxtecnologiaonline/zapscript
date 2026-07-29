'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';

interface AtendeDashboard {
  periodDays: number;
  conversasNoPeriodo: number;
  conversasHoje: number;
  conversasEscaladas: number;
  taxaResolucaoAutomatica: number;
  mensagensEnviadas: number;
  mensagensRecebidas: number;
}

const PERIODS = [
  { days: 7,  label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

export default function AtendeDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AtendeDashboard | null>(null);

  function load(periodDays: number) {
    setLoading(true);
    api.get<AtendeDashboard>(`/atende/dashboard?days=${periodDays}`)
      .then(setData)
      .catch((e) => setError(e?.message || 'Não foi possível carregar o dashboard.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(days); }, [days]);

  const kpis = data ? [
    { label: 'Conversas hoje',            value: String(data.conversasHoje),               icon: '📅' },
    { label: 'Conversas no período',      value: String(data.conversasNoPeriodo),           icon: '💬' },
    { label: 'Resolução automática',      value: `${data.taxaResolucaoAutomatica}%`,        icon: '🤖' },
    { label: 'Conversas escaladas',       value: String(data.conversasEscaladas),           icon: '🚨' },
    { label: 'Mensagens enviadas',        value: String(data.mensagensEnviadas),            icon: '📤' },
    { label: 'Mensagens recebidas',       value: String(data.mensagensRecebidas),           icon: '📥' },
  ] : [];

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <AtendeHeader />

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-neutral-300">Métricas de atendimento</h2>
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
          <div className="mb-5 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-neutral-500 text-sm">Carregando...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {kpis.map(k => (
              <div key={k.label} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                <div className="text-xl mb-1">{k.icon}</div>
                <div className="text-lg font-black leading-tight">{k.value}</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-neutral-600 mt-5">
          Resolução automática = % de conversas no período que nunca precisaram de takeover manual.
        </p>
      </div>
    </main>
  );
}
