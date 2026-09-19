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
      <div className="rounded-xl border border-brand-border bg-brand-surface p-6 animate-pulse">
        <div className="h-6 bg-brand-border rounded w-1/3 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-brand-border rounded" />
          ))}
        </div>
      </div>
    );
  }

  const trendIcon = metrics.trend === 'up' ? '📈' : metrics.trend === 'down' ? '📉' : '→';
  const trendColor = metrics.trend === 'up' ? 'text-brand-primary' : metrics.trend === 'down' ? 'text-red-400' : 'text-brand-text-secondary';

  return (
    <div className="rounded-xl border border-brand-border bg-gradient-to-br from-brand-surface to-brand-elevated p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-brand-text">📈 Performance (24h)</h3>
        <div className={`flex items-center gap-1 text-sm font-medium ${trendColor}`}>
          {trendIcon}
          <span>{metrics.trendPercent > 0 ? '+' : ''}{metrics.trendPercent}%</span>
        </div>
      </div>

      {/* Métricas em grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* Auto-resolvidas */}
        <div className="rounded-lg bg-brand-primary/50 border border-brand-primary/40 p-4">
          <div className="text-xs text-brand-primary uppercase tracking-wider mb-1">Automático</div>
          <div className="text-2xl font-bold text-brand-primary">{metrics.autoResolved}%</div>
          <div className="text-[10px] text-brand-primary mt-1">de respostas</div>
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
      <div className="rounded-lg border border-brand-border bg-brand-surface/50 p-3 text-center">
        <span className="text-sm text-brand-text-secondary">
          <span className="font-semibold text-brand-text">{metrics.messagesLast24h}</span> mensagens processadas
        </span>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-brand-border">
        <p className="text-xs text-brand-muted text-center">
          Atualizado há poucos segundos • Dados dos últimos 24 horas
        </p>
      </div>
    </div>
  );
}
