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
      <div className="rounded-lg border border-brand-border bg-brand-surface p-4 animate-pulse">
        <div className="h-6 bg-brand-border rounded w-1/3 mb-2" />
        <div className="h-4 bg-brand-border rounded w-1/2" />
      </div>
    );
  }

  const statusColor = !status.enabled ? 'text-red-400' : 'text-brand-primary';
  const statusText = !status.enabled ? 'Offline' : 'Online';
  const bgColor = !status.enabled ? 'from-red-400/10' : 'from-brand-primary/10';

  return (
    <div className={`rounded-lg border border-brand-border bg-gradient-to-br ${bgColor} to-brand-elevated p-4`}>
      {/* Header com Status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${status.enabled ? 'bg-brand-primary animate-pulse' : 'bg-red-500'}`} />
          <h4 className={`font-semibold ${statusColor}`}>Atende {statusText}</h4>
        </div>
        {status.respondingTime && (
          <span className="text-xs text-brand-text-secondary">Resposta em {status.respondingTime}s</span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-brand-elevated/50 p-3">
          <div className="text-[10px] text-brand-muted uppercase tracking-wider">Últimas 24h</div>
          <div className="text-xl font-bold text-brand-text mt-1">{status.messagesLastHour}</div>
          <div className="text-[11px] text-brand-muted mt-1">mensagens</div>
        </div>

        <div className="rounded-lg bg-brand-elevated/50 p-3">
          <div className="text-[10px] text-brand-muted uppercase tracking-wider">Confiança</div>
          <div className={`text-xl font-bold mt-1 ${(status.confidence ?? 0) > 70 ? 'text-brand-primary' : 'text-amber-400'}`}>
            {status.confidence ?? 0}%
          </div>
        </div>

        <div className="rounded-lg bg-brand-primary/50 p-3 border border-brand-primary/40">
          <div className="text-[10px] text-brand-primary uppercase tracking-wider">✅ Automático</div>
          <div className="text-lg font-bold text-brand-primary mt-1">{status.autoResolved}</div>
        </div>

        <div className="rounded-lg bg-amber-950/50 p-3 border border-amber-800/40">
          <div className="text-[10px] text-amber-600 uppercase tracking-wider">👤 Escalado</div>
          <div className="text-lg font-bold text-amber-400 mt-1">{status.escalated}</div>
        </div>
      </div>

      {/* FAQ Count */}
      <div className="rounded-lg bg-brand-elevated/40 p-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-brand-muted">FAQ Base</span>
          <span className="text-sm font-semibold text-brand-text-secondary">{status.faqCount} perguntas ativas</span>
        </div>
      </div>

      {/* Erro Indicator */}
      {status.errors > 0 && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-2 flex items-center gap-2">
          <span className="text-red-400">❌</span>
          <span className="text-xs text-red-400">{status.errors} erro(s) detectado(s)</span>
        </div>
      )}

      {/* Last Message Indicator */}
      {status.lastMessage && (
        <div className="mt-4 pt-4 border-t border-brand-border">
          <div className="text-xs text-brand-muted mb-2">Última mensagem</div>
          <div className="flex items-center gap-2">
            {status.lastMessage.status === 'responding' && (
              <span className="text-sm text-blue-400">⏱️ Respondendo...</span>
            )}
            {status.lastMessage.status === 'responded' && (
              <>
                <span className="text-sm text-brand-primary">✅ Respondida</span>
                {status.lastMessage.confidence && (
                  <span className="text-xs text-brand-muted">· {status.lastMessage.confidence}% conf</span>
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
