'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Endpoints de webhook (item 2 do escopo ZapScript × Twilio).
 *
 * Diferença em relação à tela antiga (uma URL por conta, sem histórico): aqui o
 * dono escolhe QUAIS eventos quer, vê cada tentativa de entrega com o status
 * HTTP que o endpoint devolveu, e reenvia uma entrega que falhou.
 */

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  signatureScheme: string;
  health: {
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    disabledAt: string | null;
    disabledReason: string | null;
  };
  createdAt: string;
  secret?: string;
}

interface Entrega {
  id: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: { code: string; message: string | null } | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  event: { id: string; type: string; createdAt: string };
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function WebhooksPanel() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  const [url, setUrl] = useState('');
  const [descricao, setDescricao] = useState('');
  const [todosEventos, setTodosEventos] = useState(true);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [criando, setCriando] = useState(false);
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);

  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [carregandoEntregas, setCarregandoEntregas] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await api.get<{ endpoints: Endpoint[] }>('/webhook-endpoints');
      setEndpoints(res.endpoints || []);
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível carregar os endpoints.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    api.get<{ eventTypes: string[] }>('/webhook-endpoints/event-types')
      .then(res => setEventTypes(res.eventTypes || []))
      .catch(() => setEventTypes([]));
  }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setCriando(true);
    try {
      const res = await api.post<{ endpoint: Endpoint }>('/webhook-endpoints', {
        url,
        ...(descricao.trim() ? { description: descricao.trim() } : {}),
        events: todosEventos ? ['*'] : selecionados,
      });
      // O segredo só volta aqui, uma vez — igual a uma chave de API.
      setSegredoNovo(res.endpoint.secret ?? null);
      setUrl('');
      setDescricao('');
      carregar();
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível criar o endpoint.');
    } finally {
      setCriando(false);
    }
  }

  async function alternarAtivo(ep: Endpoint) {
    try {
      await api.patch(`/webhook-endpoints/${ep.id}`, { active: !ep.active });
      carregar();
    } catch (err: any) {
      alert(err?.message || 'Não foi possível alterar o endpoint.');
    }
  }

  async function remover(id: string) {
    try {
      await api.delete(`/webhook-endpoints/${id}`);
      if (abertoId === id) setAbertoId(null);
      carregar();
    } catch (err: any) {
      alert(err?.message || 'Não foi possível remover o endpoint.');
    }
  }

  async function abrirEntregas(id: string) {
    if (abertoId === id) { setAbertoId(null); return; }
    setAbertoId(id);
    setCarregandoEntregas(true);
    try {
      const res = await api.get<{ deliveries: Entrega[] }>(`/webhook-endpoints/${id}/deliveries?limit=25`);
      setEntregas(res.deliveries || []);
    } catch {
      setEntregas([]);
    } finally {
      setCarregandoEntregas(false);
    }
  }

  async function reenviar(endpointId: string, deliveryId: string) {
    try {
      await api.post(`/webhook-endpoints/${endpointId}/deliveries/${deliveryId}/retry`, {});
      abrirEntregas(endpointId);
      setAbertoId(endpointId);
    } catch (err: any) {
      alert(err?.message || 'Não foi possível reenviar.');
    }
  }

  if (loading) return <div className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando...</div>;

  return (
    <div className="space-y-5">
      {/* ── Novo endpoint ─────────────────────────────────────────────────── */}
      <form onSubmit={criar} className="rounded-2xl p-5 space-y-3"
        style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
        <div>
          <h3 className="font-bold text-sm">Novo endpoint</h3>
          <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
            O ZapScript faz POST nesta URL a cada evento assinado, com assinatura HMAC no header
            <code className="mx-1 font-mono">X-ZapScript-Signature</code>. Falha é reentregue com
            espera crescente, por até 6 tentativas.
          </p>
        </div>

        <input
          className="field-input"
          placeholder="https://seusistema.com/webhooks/zapscript"
          value={url}
          onChange={e => setUrl(e.target.value)}
          required
        />
        <input
          className="field-input"
          placeholder="Descrição (opcional) — ex.: integração com o ERP"
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          maxLength={200}
        />

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={todosEventos} onChange={e => setTodosEventos(e.target.checked)} />
          <span>Assinar <strong>todos</strong> os eventos (inclusive os que criarmos depois)</span>
        </label>

        {!todosEventos && (
          <div className="grid sm:grid-cols-2 gap-1.5">
            {eventTypes.map(t => (
              <label key={t} className="flex items-center gap-2 text-[11px] cursor-pointer font-mono">
                <input
                  type="checkbox"
                  checked={selecionados.includes(t)}
                  onChange={() => setSelecionados(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])}
                />
                {t}
              </label>
            ))}
          </div>
        )}

        {erro && (
          <div className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{erro}</div>
        )}

        <button
          type="submit"
          disabled={criando || !url.trim() || (!todosEventos && selecionados.length === 0)}
          className="btn-primary px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          {criando ? 'Criando...' : 'Criar endpoint'}
        </button>
      </form>

      {segredoNovo && (
        <div className="rounded-2xl p-5"
          style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.3)' }}>
          <div className="text-sm font-bold mb-1">Guarde o segredo de assinatura</div>
          <p className="text-xs mb-2" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Use-o para validar o header <code className="font-mono">X-ZapScript-Signature</code>.
            Ele não volta a ser exibido nesta tela.
          </p>
          <code className="block text-[11px] font-mono break-all px-3 py-2 rounded-lg"
            style={{ background: 'rgb(var(--color-surface))' }}>{segredoNovo}</code>
          <button onClick={() => setSegredoNovo(null)} className="text-[11px] font-semibold mt-2 underline"
            style={{ color: 'rgb(var(--color-primary))' }}>Já guardei</button>
        </div>
      )}

      {/* ── Lista ─────────────────────────────────────────────────────────── */}
      {endpoints.length === 0 ? (
        <div className="rounded-xl p-8 text-center"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-3xl mb-2">🔔</div>
          <p className="text-sm font-semibold">Nenhum endpoint configurado</p>
          <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Sem endpoint, os eventos não são gravados — o que aconteceu continua no log de mensagens.
          </p>
        </div>
      ) : endpoints.map(ep => (
        <div key={ep.id} className="rounded-2xl p-5"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={ep.active
                    ? { background: 'rgba(52,211,153,.15)', color: '#34d399' }
                    : { background: 'rgba(248,113,113,.15)', color: '#f87171' }}>
                  {ep.active ? 'Ativo' : 'Desativado'}
                </span>
                {ep.signatureScheme === 'legacy' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(251,191,36,.12)', color: '#fbbf24' }}
                    title="Criado a partir da configuração antiga de webhook — mantém o formato de assinatura sha256=<hmac> que sua integração já valida.">
                    formato legado
                  </span>
                )}
              </div>
              <div className="text-sm font-mono mt-1.5 break-all">{ep.url}</div>
              {ep.description && (
                <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{ep.description}</div>
              )}
              <div className="text-[11px] font-mono mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
                {ep.events.join(', ')}
              </div>
              <div className="text-[10px] mt-1.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
                Último sucesso: {fmt(ep.health.lastSuccessAt)} · Última falha: {fmt(ep.health.lastFailureAt)}
                {ep.health.consecutiveFailures > 0 && ` · ${ep.health.consecutiveFailures} falha(s) seguida(s)`}
              </div>
              {ep.health.disabledReason && (
                <div className="text-[11px] mt-1.5 px-2 py-1 rounded-lg inline-block"
                  style={{ background: 'rgba(248,113,113,.1)', color: '#f87171' }}>
                  {ep.health.disabledReason}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={() => abrirEntregas(ep.id)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(var(--color-primary)/.1)', color: 'rgb(var(--color-primary))' }}>
                {abertoId === ep.id ? 'Fechar' : 'Entregas'}
              </button>
              <button onClick={() => alternarAtivo(ep)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(var(--color-primary)/.06)', color: 'rgb(var(--color-text-muted))' }}>
                {ep.active ? 'Desativar' : 'Reativar'}
              </button>
              <button onClick={() => remover(ep.id)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg hover:bg-red-500/10"
                style={{ color: 'rgb(var(--color-text-muted))' }}>
                Remover
              </button>
            </div>
          </div>

          {abertoId === ep.id && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgb(var(--color-border))' }}>
              {carregandoEntregas ? (
                <div className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando entregas...</div>
              ) : entregas.length === 0 ? (
                <div className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  Nenhuma entrega registrada ainda.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {entregas.map(d => (
                    <div key={d.id} className="flex items-start justify-between gap-2 text-[11px] px-3 py-2 rounded-lg"
                      style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                      <div className="min-w-0">
                        <span className="font-mono font-bold">{d.event.type}</span>
                        <span style={{ color: 'rgb(var(--color-text-muted))' }}> · {fmt(d.createdAt)}</span>
                        <div style={{ color: 'rgb(var(--color-text-muted))' }}>
                          {d.attempts} tentativa(s)
                          {d.responseStatus !== null && ` · HTTP ${d.responseStatus}`}
                          {d.error && <span style={{ color: '#f87171' }}> · {d.error.code}</span>}
                          {d.nextRetryAt && ` · próxima às ${fmt(d.nextRetryAt)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold"
                          style={{ color: d.status === 'succeeded' ? '#34d399' : d.status === 'failed' ? '#f87171' : '#fbbf24' }}>
                          {d.status === 'succeeded' ? 'entregue' : d.status === 'failed' ? 'falhou' : 'pendente'}
                        </span>
                        {d.status !== 'succeeded' && (
                          <button onClick={() => reenviar(ep.id, d.id)}
                            className="font-semibold underline" style={{ color: 'rgb(var(--color-primary))' }}>
                            reenviar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
