'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface AtendeToggleProps {
  initialEnabled?: boolean;
  onStatusChange?: (enabled: boolean) => void;
}

export default function AtendeToggle({ initialEnabled = false, onStatusChange }: AtendeToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ auto: number; escalated: number; avgTime: number } | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const data = await api.get<any>('/atende/status');
      setEnabled(data.enabled ?? initialEnabled);
      setStats(data.stats);
    } catch (e) {
      console.error('Failed to fetch Atende status:', e);
    }
  }

  async function handleToggle() {
    setLoading(true);
    try {
      const result = await api.post<{ enabled: boolean }>('/atende/toggle', { enabled: !enabled });
      setEnabled(result.enabled);
      onStatusChange?.(result.enabled);
    } catch (e: any) {
      alert(e?.message || 'Erro ao alternar status do Atende');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-800/60 bg-gradient-to-br from-emerald-950/40 to-neutral-950 p-6">
      <div className="flex items-center justify-between gap-4">
        {/* Status e Label */}
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${enabled ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-600'}`} />
            Atende {enabled ? 'Online' : 'Offline'}
          </h3>
          <p className="text-sm text-neutral-500 mt-1">
            {enabled ? 'Respondendo automaticamente' : 'Modo manual - conversas vão para aprovação'}
          </p>
        </div>

        {/* Toggle Button */}
        <button
          onClick={handleToggle}
          disabled={loading}
          className={`flex-shrink-0 relative inline-flex h-10 w-20 rounded-full transition-colors ${
            enabled ? 'bg-emerald-600' : 'bg-neutral-700'
          } ${loading ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}`}
        >
          <span
            className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
              enabled ? 'translate-x-10' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Stats - Mostrar se online e tiver dados */}
      {enabled && stats && (
        <div className="mt-4 grid grid-cols-3 gap-3 pt-4 border-t border-neutral-800">
          <div className="text-center">
            <div className="text-xs text-neutral-500">Automático</div>
            <div className="text-lg font-semibold text-emerald-400">{stats.auto}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-neutral-500">Escalado</div>
            <div className="text-lg font-semibold text-amber-400">{stats.escalated}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-neutral-500">Tempo médio</div>
            <div className="text-lg font-semibold text-blue-400">{stats.avgTime}s</div>
          </div>
        </div>
      )}
    </div>
  );
}
