'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface StatusData {
  enabled: boolean;
  respondingTime?: number;
  confidence?: number;
  messagesLastHour: number;
  autoResolved: number;
  escalated: number;
  errors: number;
  faqCount: number;
  lastMessage?: {
    timestamp: string;
    status: 'responding' | 'responded' | 'error';
    confidence?: number;
  };
}

export default function StatusIndicator() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const data = await api.get<StatusData>('/atende/status-detailed');
      setStatus(data);
    } catch (e) {
      console.error('Failed to fetch status:', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading || !status) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 animate-pulse">
        <div className="h-6 bg-neutral-700 rounded w-1/3 mb-2" />
        <div className="h-4 bg-neutral-700 rounded w-1/2" />
      </div>
    );
  }

  const statusColor = !status.enabled ? 'text-red-400' : 'text-emerald-400';
  const statusText = !status.enabled ? 'Offline' : 'Online';
  const bgColor = !status.enabled ? 'from-red-950/30' : 'from-emerald-950/30';

  return (
    <div className={`rounded-lg border border-neutral-800 bg-gradient-to-br ${bgColor} to-neutral-950 p-4`}>
      {/* Header com Status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${status.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <h4 className={`font-semibold ${statusColor}`}>Atende {statusText}</h4>
        </div>
        {status.respondingTime && (
          <span className="text-xs text-neutral-400">Resposta em {status.respondingTime}s</span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-neutral-800/50 p-3">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Últimas 24h</div>
          <div className="text-xl font-bold text-neutral-100 mt-1">{status.messagesLastHour}</div>
          <div className="text-[11px] text-neutral-500 mt-1">mensagens</div>
        </div>

        <div className="rounded-lg bg-neutral-800/50 p-3">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Confiança</div>
          <div className={`text-xl font-bold mt-1 ${(status.confidence ?? 0) > 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {status.confidence ?? 0}%
          </div>
        </div>

        <div className="rounded-lg bg-emerald-950/50 p-3 border border-emerald-800/40">
          <div className="text-[10px] text-emerald-600 uppercase tracking-wider">✅ Automático</div>
          <div className="text-lg font-bold text-emerald-400 mt-1">{status.autoResolved}</div>
        </div>

        <div className="rounded-lg bg-amber-950/50 p-3 border border-amber-800/40">
          <div className="text-[10px] text-amber-600 uppercase tracking-wider">👤 Escalado</div>
          <div className="text-lg font-bold text-amber-400 mt-1">{status.escalated}</div>
        </div>
      </div>

      {/* FAQ Count */}
      <div className="rounded-lg bg-neutral-800/40 p-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">FAQ Base</span>
          <span className="text-sm font-semibold text-neutral-300">{status.faqCount} perguntas ativas</span>
        </div>
      </div>

      {/* Erro Indicator */}
      {status.errors > 0 && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/30 p-2 flex items-center gap-2">
          <span className="text-red-400">❌</span>
          <span className="text-xs text-red-300">{status.errors} erro(s) detectado(s)</span>
        </div>
      )}

      {/* Last Message Indicator */}
      {status.lastMessage && (
        <div className="mt-4 pt-4 border-t border-neutral-800">
          <div className="text-xs text-neutral-500 mb-2">Última mensagem</div>
          <div className="flex items-center gap-2">
            {status.lastMessage.status === 'responding' && (
              <span className="text-sm text-blue-400">⏱️ Respondendo...</span>
            )}
            {status.lastMessage.status === 'responded' && (
              <>
                <span className="text-sm text-emerald-400">✅ Respondida</span>
                {status.lastMessage.confidence && (
                  <span className="text-xs text-neutral-500">· {status.lastMessage.confidence}% conf</span>
                )}
              </>
            )}
            {status.lastMessage.status === 'error' && (
              <span className="text-sm text-red-400">❌ Erro</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
