'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Mensagens e métricas no painel (itens 5, 6 e 7 do escopo ZapScript × Twilio).
 *
 * Responde a pergunta que não tinha dono: "esta mensagem saiu?". Mostra os
 * envios da API pública com o CÓDIGO do erro (não só a frase do provedor) e as
 * mensagens recebidas — registro que a v1 não guardava, só empurrava por webhook.
 */

interface Envio {
  id: string;
  to: string;
  body: string | null;
  status: string;
  source: string;
  attempts: number;
  error: { code: string | null; reason: string | null; docUrl: string | null } | null;
  sentAt: string | null;
  createdAt: string;
}

interface Recebida {
  id: string;
  from: string;
  channel: string;
  type: string;
  body: string | null;
  receivedAt: string;
}

interface Metricas {
  outbound: {
    total: number;
    byStatus: Record<string, number>;
    sentRate: number | null;
    failureRate: number | null;
    topErrorCodes: Array<{ code: string; count: number }>;
  };
  inbound: { total: number; byType: Record<string, number> };
  webhooks: { attempts: number; succeeded: number; failed: number; successRate: number | null };
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila', sent: 'Enviada', failed: 'Falhou',
};
const STATUS_COLOR: Record<string, string> = {
  queued: '#fbbf24', sent: '#34d399', failed: '#f87171',
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function fone(digits: string): string {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : '—';
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export default function MensagensPanel() {
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [aba, setAba] = useState<'saida' | 'entrada'>('saida');

  const [envios, setEnvios] = useState<Envio[]>([]);
  const [recebidas, setRecebidas] = useState<Recebida[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async (opts: { append?: boolean; startingAfter?: string | null } = {}) => {
    setErro('');
    if (!opts.append) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (busca.trim()) params.set('search', busca.trim());
      if (opts.startingAfter) params.set('startingAfter', opts.startingAfter);

      if (aba === 'saida') {
        if (status) params.set('status', status);
        const res = await api.get<{ messages: Envio[]; hasMore: boolean; nextCursor: string | null }>(
          `/platform/outbound?${params.toString()}`,
        );
        setEnvios(prev => (opts.append ? [...prev, ...res.messages] : res.messages));
        setHasMore(res.hasMore);
        setCursor(res.nextCursor);
      } else {
        const res = await api.get<{ messages: Recebida[]; hasMore: boolean; nextCursor: string | null }>(
          `/platform/inbound?${params.toString()}`,
        );
        setRecebidas(prev => (opts.append ? [...prev, ...res.messages] : res.messages));
        setHasMore(res.hasMore);
        setCursor(res.nextCursor);
      }
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível carregar.');
    } finally {
      setLoading(false);
    }
  }, [aba, status, busca]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    api.get<{ metrics: Metricas }>('/platform/metrics')
      .then(res => setMetricas(res.metrics))
      .catch(() => setMetricas(null));
  }, []);

  const o = metricas?.outbound;

  return (
    <div className="space-y-5">
      {/* ── Métricas (item 7) ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Envios (7 dias)',   value: o ? String(o.total) : '—' },
          { label: 'Taxa de envio',     value: pct(o?.sentRate ?? null) },
          { label: 'Taxa de falha',     value: pct(o?.failureRate ?? null) },
          { label: 'Recebidas',         value: metricas ? String(metricas.inbound.total) : '—' },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-4"
            style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide"
              style={{ color: 'rgb(var(--color-text-muted))' }}>{c.label}</div>
            <div className="font-black text-xl mt-1" style={{ color: 'rgb(var(--color-primary))' }}>{c.value}</div>
          </div>
        ))}
      </div>

      <p className="text-[10px] -mt-3" style={{ color: 'rgb(var(--color-text-muted))' }}>
        Não há taxa de entrega: o envio sai pela Evolution, que confirma
        &ldquo;aceitei para envio&rdquo;, não &ldquo;o aparelho recebeu&rdquo;. Mostrar
        uma taxa de entrega aqui seria apresentar uma coisa como a outra.
      </p>

      {o && o.topErrorCodes.length > 0 && (
        <div className="rounded-xl p-4"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-xs font-bold mb-2">Principais motivos de falha</div>
          <div className="flex flex-wrap gap-2">
            {o.topErrorCodes.map(e => (
              <span key={e.code} className="text-[11px] font-mono px-2 py-1 rounded-lg"
                style={{ background: 'rgba(248,113,113,.12)', color: '#f87171' }}>
                {e.code} · {e.count}
              </span>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Códigos estáveis — os mesmos que a API devolve em <code className="font-mono">code</code>.
          </p>
        </div>
      )}

      {/* ── Saída / entrada ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {([['saida', 'Saída'], ['entrada', 'Entrada']] as const).map(([id, label]) => (
            <button key={id} onClick={() => { setAba(id); setCursor(null); }}
              className="text-xs font-bold px-3 py-1.5 rounded-lg"
              style={aba === id
                ? { background: 'rgba(var(--color-primary)/.15)', color: 'rgb(var(--color-primary))' }
                : { background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-text-muted))' }}>
              {label}
            </button>
          ))}
        </div>
        {aba === 'saida' && (
          <select className="field-input w-auto text-xs" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        <input className="field-input flex-1 min-w-[180px] text-xs" placeholder="Buscar no conteúdo..."
          value={busca} onChange={e => setBusca(e.target.value)} />
      </div>

      {erro && (
        <div className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{erro}</div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando...</div>
      ) : aba === 'saida' ? (
        envios.length === 0 ? (
          <div className="rounded-xl p-8 text-center"
            style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
            <div className="text-3xl mb-2">📤</div>
            <p className="text-sm font-semibold">Nenhum envio pela API</p>
            <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Envios feitos por <code className="font-mono">POST /public/v1/messages</code> aparecem aqui.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {envios.map(m => (
              <div key={m.id} className="rounded-xl px-4 py-3"
                style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${STATUS_COLOR[m.status] ?? '#888'}22`, color: STATUS_COLOR[m.status] ?? '#888' }}>
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                      <span className="text-[10px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                        {m.source === 'public_api' ? 'API' : 'Painel'}
                        {m.attempts > 1 && ` · ${m.attempts} tentativas`}
                      </span>
                    </div>
                    <div className="text-sm font-semibold mt-1.5">{fone(m.to)}</div>
                    <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                      {m.body}
                    </div>
                    {m.error && (
                      <div className="text-[11px] mt-1.5 px-2 py-1 rounded-lg inline-block"
                        style={{ background: 'rgba(248,113,113,.1)', color: '#f87171' }}>
                        {m.error.code && <span className="font-mono font-bold">{m.error.code}</span>}
                        {m.error.reason ? `${m.error.code ? ' — ' : ''}${m.error.reason}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 text-[10px] leading-relaxed"
                    style={{ color: 'rgb(var(--color-text-muted))' }}>
                    <div>{fmt(m.createdAt)}</div>
                    {m.sentAt && <div>enviada {fmt(m.sentAt)}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : recebidas.length === 0 ? (
        <div className="rounded-xl p-8 text-center"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-3xl mb-2">📥</div>
          <p className="text-sm font-semibold">Nenhuma mensagem recebida no período</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recebidas.map(m => (
            <div key={m.id} className="rounded-xl px-4 py-3"
              style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(167,139,250,.12)', color: '#a78bfa' }}>
                      {m.type}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                      {m.channel === 'meta' ? 'Oficial' : 'Evolution'}
                    </span>
                  </div>
                  <div className="text-sm font-semibold mt-1.5">{fone(m.from)}</div>
                  <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    {m.body || <em style={{ color: 'rgb(var(--color-text-muted))' }}>sem texto</em>}
                  </div>
                </div>
                <div className="text-[10px] shrink-0" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  {fmt(m.receivedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <button onClick={() => carregar({ append: true, startingAfter: cursor })}
          className="w-full text-xs font-semibold py-2.5 rounded-xl"
          style={{ background: 'rgba(var(--color-primary)/.08)', color: 'rgb(var(--color-primary))' }}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
