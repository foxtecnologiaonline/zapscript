'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Log de mensagens + métricas no painel (itens 5 e 7 do escopo ZapScript × Twilio).
 *
 * Por que isto existe: quando um contato diz "não recebi", até aqui o dono
 * tinha que adivinhar entre a tela de campanhas, a de conversas e nada. Esta é
 * a resposta única — com o status do provedor e o CÓDIGO do erro, não uma frase
 * genérica da Meta.
 */

interface Mensagem {
  id: string;
  direction: string;
  channel: string;
  source: string;
  status: string;
  to: string;
  from: string | null;
  type: string;
  body: string | null;
  templateName: string | null;
  error: { code: string; message: string | null } | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
}

interface Metricas {
  messages: {
    total: number;
    byStatus: Record<string, number>;
    byDirection: Record<string, number>;
    deliveryRate: number | null;
    failureRate: number | null;
    readRate: number | null;
    topErrorCodes: Array<{ code: string; count: number }>;
  };
  webhooks: {
    endpoints: { total: number; active: number; disabled: number };
    deliveries: { total: number; succeeded: number; failed: number; pending: number };
    successRate: number | null;
  };
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila', sent: 'Enviada', delivered: 'Entregue',
  read: 'Lida', failed: 'Falhou', received: 'Recebida',
};

const STATUS_COLOR: Record<string, string> = {
  queued:    '#fbbf24',
  sent:      '#60a5fa',
  delivered: '#34d399',
  read:      '#10b981',
  failed:    '#f87171',
  received:  '#a78bfa',
};

const SOURCE_LABEL: Record<string, string> = {
  api: 'API', campanha: 'Campanha', atende: 'Atende', aviso: 'Aviso',
  cobranca: 'Cobrança', copiloto: 'Copiloto', zapscreve: 'ZapScreve',
  transcricao: 'Conversão', suporte: 'Suporte', sistema: 'Sistema',
};

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtTelefone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  // Formato brasileiro com DDI; qualquer outro comprimento sai como veio.
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : '—';
}

function pct(v: number | null): string {
  return v === null ? '—' : `${v}%`;
}

export default function MessageLogPanel() {
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async (opts: { append?: boolean; startingAfter?: string | null } = {}) => {
    setErro('');
    if (!opts.append) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (status) params.set('status', status);
      if (direction) params.set('direction', direction);
      if (busca.trim()) params.set('search', busca.trim());
      if (opts.startingAfter) params.set('startingAfter', opts.startingAfter);

      const res = await api.get<{ messages: Mensagem[]; hasMore: boolean; nextCursor: string | null }>(
        `/messages?${params.toString()}`,
      );
      setMensagens(prev => (opts.append ? [...prev, ...res.messages] : res.messages));
      setHasMore(res.hasMore);
      setCursor(res.nextCursor);
    } catch (err: any) {
      // O envelope novo traz error.message; api.ts já extrai a mensagem.
      setErro(err?.message || 'Não foi possível carregar o log.');
    } finally {
      setLoading(false);
    }
  }, [status, direction, busca]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    api.get<{ metrics: Metricas }>('/messages/metrics')
      .then(res => setMetricas(res.metrics))
      .catch(() => setMetricas(null));
  }, []);

  const m = metricas?.messages;

  return (
    <div className="space-y-5">
      {/* ── Métricas (item 7) ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Mensagens (7 dias)', value: m ? String(m.total) : '—' },
          { label: 'Taxa de entrega',    value: pct(m?.deliveryRate ?? null) },
          { label: 'Taxa de falha',      value: pct(m?.failureRate ?? null) },
          { label: 'Taxa de leitura',    value: pct(m?.readRate ?? null) },
        ].map(card => (
          <div key={card.label} className="rounded-xl p-4"
            style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide"
              style={{ color: 'rgb(var(--color-text-muted))' }}>{card.label}</div>
            <div className="font-black text-xl mt-1" style={{ color: 'rgb(var(--color-primary))' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {m && m.topErrorCodes.length > 0 && (
        <div className="rounded-xl p-4"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-xs font-bold mb-2">Principais motivos de falha</div>
          <div className="flex flex-wrap gap-2">
            {m.topErrorCodes.map(e => (
              <span key={e.code} className="text-[11px] font-mono px-2 py-1 rounded-lg"
                style={{ background: 'rgba(248,113,113,.12)', color: '#f87171' }}>
                {e.code} · {e.count}
              </span>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Códigos estáveis — os mesmos que a API devolve e o webhook envia.
          </p>
        </div>
      )}

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <select className="field-input w-auto text-xs" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field-input w-auto text-xs" value={direction} onChange={e => setDirection(e.target.value)}>
          <option value="">Entrada e saída</option>
          <option value="outbound">Só saída</option>
          <option value="inbound">Só entrada</option>
        </select>
        <input
          className="field-input flex-1 min-w-[180px] text-xs"
          placeholder="Buscar no conteúdo da mensagem..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
      </div>

      {erro && (
        <div className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{erro}</div>
      )}

      {/* ── Lista ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando...</div>
      ) : mensagens.length === 0 ? (
        <div className="rounded-xl p-8 text-center"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-3xl mb-2">📭</div>
          <p className="text-sm font-semibold">Nenhuma mensagem no período</p>
          <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Toda mensagem que entra ou sai — campanha, Atende, aviso ou API — aparece aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mensagens.map(msg => (
            <div key={msg.id} className="rounded-xl px-4 py-3"
              style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${STATUS_COLOR[msg.status] ?? '#888'}22`, color: STATUS_COLOR[msg.status] ?? '#888' }}>
                      {STATUS_LABEL[msg.status] ?? msg.status}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(var(--color-primary)/.08)', color: 'rgb(var(--color-text-muted))' }}>
                      {msg.direction === 'inbound' ? '← entrada' : '→ saída'}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                      {SOURCE_LABEL[msg.source] ?? msg.source} · {msg.channel === 'meta' ? 'Oficial' : 'Evolution'}
                    </span>
                  </div>

                  <div className="text-sm font-semibold mt-1.5 truncate">
                    {msg.direction === 'inbound' ? fmtTelefone(msg.from || '') : fmtTelefone(msg.to)}
                  </div>

                  <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    {msg.templateName
                      ? <span className="font-mono">template: {msg.templateName}</span>
                      : (msg.body || <em style={{ color: 'rgb(var(--color-text-muted))' }}>{msg.type}</em>)}
                  </div>

                  {msg.error && (
                    <div className="text-[11px] mt-1.5 px-2 py-1 rounded-lg inline-block"
                      style={{ background: 'rgba(248,113,113,.1)', color: '#f87171' }}>
                      <span className="font-mono font-bold">{msg.error.code}</span>
                      {msg.error.message ? ` — ${msg.error.message}` : ''}
                    </div>
                  )}
                </div>

                <div className="text-right shrink-0 text-[10px] leading-relaxed"
                  style={{ color: 'rgb(var(--color-text-muted))' }}>
                  <div>{fmtData(msg.queuedAt)}</div>
                  {msg.deliveredAt && <div>entregue {fmtData(msg.deliveredAt)}</div>}
                  {msg.readAt && <div>lida {fmtData(msg.readAt)}</div>}
                  {msg.failedAt && <div style={{ color: '#f87171' }}>falhou {fmtData(msg.failedAt)}</div>}
                </div>
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={() => carregar({ append: true, startingAfter: cursor })}
              className="w-full text-xs font-semibold py-2.5 rounded-xl transition-colors"
              style={{ background: 'rgba(var(--color-primary)/.08)', color: 'rgb(var(--color-primary))' }}
            >
              Carregar mais
            </button>
          )}
        </div>
      )}
    </div>
  );
}
