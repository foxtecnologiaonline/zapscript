'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface MetricsData {
  autoResolved: number;
  escalated: number;
  avgConfidence: number;
  avgResponseTime: number;
  messagesLast24h: number;
  trend: 'up' | 'down' | 'stable';
  trendPercent: number;
}

export default function PerformanceMetricsBadge() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // 30s
    return () => clearInterval(interval);
  }, []);

  async function fetchMetrics() {
    try {
      const data = await api.get<MetricsData>('/atende/metrics');
      setMetrics(data);
    } catch (e) {
      console.error('Failed to fetch metrics:', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading || !metrics) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 animate-pulse">
        <div className="h-6 bg-neutral-700 rounded w-1/3 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const trendIcon = metrics.trend === 'up' ? '📈' : metrics.trend === 'down' ? '📉' : '→';
  const trendColor = metrics.trend === 'up' ? 'text-emerald-400' : metrics.trend === 'down' ? 'text-red-400' : 'text-neutral-400';

  return (
    <div className="rounded-xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-neutral-100">📈 Performance (24h)</h3>
        <div className={`flex items-center gap-1 text-sm font-medium ${trendColor}`}>
          {trendIcon}
          <span>{metrics.trendPercent > 0 ? '+' : ''}{metrics.trendPercent}%</span>
        </div>
      </div>

      {/* Métricas em grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* Auto-resolvidas */}
        <div className="rounded-lg bg-emerald-950/50 border border-emerald-800/40 p-4">
          <div className="text-xs text-emerald-600 uppercase tracking-wider mb-1">Automático</div>
          <div className="text-2xl font-bold text-emerald-400">{metrics.autoResolved}%</div>
          <div className="text-[10px] text-emerald-600 mt-1">de respostas</div>
        </div>

        {/* Escaladas */}
        <div className="rounded-lg bg-amber-950/50 border border-amber-800/40 p-4">
          <div className="text-xs text-amber-600 uppercase tracking-wider mb-1">Escalado</div>
          <div className="text-2xl font-bold text-amber-400">{metrics.escalated}%</div>
          <div className="text-[10px] text-amber-600 mt-1">para humano</div>
        </div>

        {/* Confiança */}
        <div className="rounded-lg bg-blue-950/50 border border-blue-800/40 p-4">
          <div className="text-xs text-blue-600 uppercase tracking-wider mb-1">Confiança</div>
          <div className="text-2xl font-bold text-blue-400">{metrics.avgConfidence}%</div>
          <div className="text-[10px] text-blue-600 mt-1">média</div>
        </div>

        {/* Tempo de resposta */}
        <div className="rounded-lg bg-purple-950/50 border border-purple-800/40 p-4">
          <div className="text-xs text-purple-600 uppercase tracking-wider mb-1">Resposta</div>
          <div className="text-2xl font-bold text-purple-400">{metrics.avgResponseTime}s</div>
          <div className="text-[10px] text-purple-600 mt-1">tempo médio</div>
        </div>
      </div>

      {/* Mensagens */}
      <div className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-3 text-center">
        <span className="text-sm text-neutral-400">
          <span className="font-semibold text-neutral-200">{metrics.messagesLast24h}</span> mensagens processadas
        </span>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-neutral-800">
        <p className="text-xs text-neutral-500 text-center">
          Atualizado há poucos segundos • Dados dos últimos 24 horas
        </p>
      </div>
    </div>
  );
}
