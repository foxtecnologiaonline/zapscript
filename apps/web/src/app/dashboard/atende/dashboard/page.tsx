'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';

interface AtendeDashboard {
  periodDays: number;
  conversasNoPeriodo: number;
  conversasHoje: number;
  conversasResolvidasAuto: number;
  conversasEscaladas: number;
  conversasSobTakeover: number;
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
    { label: 'Resolvidas pelo bot',       value: String(data.conversasResolvidasAuto),      icon: '✅' },
    { label: 'Aguardando você (escaladas)', value: String(data.conversasEscaladas),         icon: '🚨' },
    { label: 'Sob atendimento manual',    value: String(data.conversasSobTakeover),         icon: '🙋' },
    { label: 'Mensagens enviadas',        value: String(data.mensagensEnviadas),            icon: '📤' },
    { label: 'Mensagens recebidas',       value: String(data.mensagensRecebidas),           icon: '📥' },
  ] : [];

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="max-w-3xl mx-auto">
        <AtendeHeader />

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-brand-text-secondary">Métricas de atendimento</h2>
          <div className="inline-flex rounded-lg border border-brand-border overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === p.days ? 'bg-brand-primary text-white' : 'bg-brand-surface text-brand-text-secondary hover:text-brand-text'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-brand-muted text-sm">Carregando...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {kpis.map(k => (
              <div key={k.label} className="rounded-xl border border-brand-border bg-brand-surface/60 p-4">
                <div className="text-xl mb-1">{k.icon}</div>
                <div className="text-lg font-black leading-tight">{k.value}</div>
                <div className="text-[11px] text-brand-muted mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-brand-muted mt-5">
          Resolução automática = % de conversas no período que nunca precisaram de takeover manual.
        </p>
      </div>
    </div>
  );
}
