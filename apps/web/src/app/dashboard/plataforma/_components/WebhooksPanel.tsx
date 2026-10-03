'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Webhook de saída no painel (item 2 do escopo ZapScript × Twilio).
 *
 * A v1 tem UMA URL por conta (WebhookConfig) com seleção de eventos. O que
 * faltava na tela era o lado observável: quais eventos estão assinados e,
 * sobretudo, **o que aconteceu em cada tentativa de entrega** — "o evento saiu?
 * que status minha URL devolveu?". Sem isso, webhook quebrado só era descoberto
 * pela ausência de dado do outro lado.
 */

interface Config {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  createdAt: string;
  /** Catálogo de eventos — vem do próprio GET, para a tela nunca desatualizar. */
  availableEvents?: string[];
}

interface Entrega {
  id: string;
  event: string;
  url: string;
  success: boolean;
  httpStatus: number | null;
  attempt: number;
  error: string | null;
  createdAt: string;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function WebhooksPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [semPlano, setSemPlano] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const [url, setUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [soFalhas, setSoFalhas] = useState(false);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const res = await api.get<Config>('/webhook-config');
      setConfig(res);
      setUrl(res.url);
      setSelecionados(res.events || []);
      if (res.availableEvents?.length) setEventTypes(res.availableEvents);
      setSemPlano(false);
    } catch (err: any) {
      // 404 = nunca configurado (não é erro, é o estado inicial) — e o corpo do
      // 404 já traz o catálogo de eventos. 402 = plano não inclui webhook.
      if (err?.status === 404) {
        setConfig(null);
        setSemPlano(false);
        if (Array.isArray(err?.availableEvents)) setEventTypes(err.availableEvents);
      } else if (err?.status === 402) {
        setSemPlano(true);
      } else {
        setErro(err?.message || 'Não foi possível carregar a configuração.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const carregarEntregas = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (soFalhas) params.set('success', 'false');
      const res = await api.get<{ deliveries: Entrega[] }>(`/platform/webhook-deliveries?${params.toString()}`);
      setEntregas(res.deliveries || []);
    } catch {
      setEntregas([]);
    }
  }, [soFalhas]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarEntregas(); }, [carregarEntregas]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setAviso(''); setSalvando(true);
    try {
      const res = await api.post<Config>('/webhook-config', {
        url,
        ...(selecionados.length ? { events: selecionados } : {}),
      });
      if (res.secret) setAviso(`Guarde o segredo de assinatura: ${res.secret}`);
      else setAviso('Configuração salva.');
      carregar();
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEventos() {
    setErro(''); setAviso(''); setSalvando(true);
    try {
      await api.patch('/webhook-config/events', { events: selecionados });
      setAviso('Eventos atualizados.');
      carregar();
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível atualizar os eventos.');
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setErro(''); setAviso(''); setTestando(true);
    try {
      const res = await api.post<{ ok: boolean; status?: number; message: string }>('/webhook-config/test', {});
      setAviso(res.message);
      carregarEntregas();
    } catch (err: any) {
      setErro(err?.message || 'Falha ao testar.');
    } finally {
      setTestando(false);
    }
  }

  if (loading) return <div className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando...</div>;

  if (semPlano) {
    return (
      <div className="rounded-xl p-8 text-center"
        style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
        <div className="text-3xl mb-2">🔔</div>
        <p className="text-sm font-semibold">Webhooks não estão no seu plano</p>
        <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: 'rgb(var(--color-text-muted))' }}>
          O integrador com chave de API também pode se configurar sozinho por
          <code className="mx-1 font-mono">POST /public/v1/webhooks</code>.
        </p>
        <a href="/dashboard/plano" className="inline-block mt-4 btn-primary px-4 py-2 text-sm font-bold">Ver planos</a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={salvar} className="rounded-2xl p-5 space-y-3"
        style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
        <div>
          <h3 className="font-bold text-sm">{config ? 'Seu webhook' : 'Configurar webhook'}</h3>
          <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
            O ZapScript faz POST nesta URL a cada evento assinado, assinado em
            <code className="mx-1 font-mono">X-ZapScript-Signature</code>. Falha é reentregue pela fila.
          </p>
        </div>

        <input className="field-input" placeholder="https://seusistema.com/webhooks/zapscript"
          value={url} onChange={e => setUrl(e.target.value)} required />

        <div>
          <div className="text-xs font-semibold mb-1.5">Eventos assinados</div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {eventTypes.map(t => (
              <label key={t} className="flex items-center gap-2 text-[11px] cursor-pointer font-mono">
                <input type="checkbox" checked={selecionados.includes(t)}
                  onChange={() => setSelecionados(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])} />
                {t}
              </label>
            ))}
          </div>
        </div>

        {erro && (
          <div className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{erro}</div>
        )}
        {aviso && (
          <div className="text-xs px-3 py-2 rounded-lg break-all"
            style={{ background: 'rgba(52,211,153,.1)', color: '#34d399' }}>{aviso}</div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={salvando || !url.trim()}
            className="btn-primary px-4 py-2 text-sm font-bold disabled:opacity-50">
            {salvando ? 'Salvando...' : config ? 'Salvar URL' : 'Configurar'}
          </button>
          {config && (
            <>
              <button type="button" onClick={salvarEventos} disabled={salvando || selecionados.length === 0}
                className="text-sm font-semibold px-3 py-2 rounded-xl disabled:opacity-50"
                style={{ background: 'rgba(var(--color-primary)/.1)', color: 'rgb(var(--color-primary))' }}>
                Salvar eventos
              </button>
              <button type="button" onClick={testar} disabled={testando}
                className="text-sm font-medium px-3 py-2 rounded-xl disabled:opacity-50"
                style={{ background: 'rgba(var(--color-primary)/.06)', color: 'rgb(var(--color-text-muted))' }}>
                {testando ? 'Testando...' : 'Enviar teste'}
              </button>
            </>
          )}
        </div>
      </form>

      {/* ── Entregas ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5"
        style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-bold text-sm">Entregas</h3>
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer"
            style={{ color: 'rgb(var(--color-text-muted))' }}>
            <input type="checkbox" checked={soFalhas} onChange={e => setSoFalhas(e.target.checked)} />
            só falhas
          </label>
        </div>

        {entregas.length === 0 ? (
          <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Nenhuma tentativa registrada {soFalhas ? 'com falha ' : ''}ainda.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entregas.map(d => (
              <div key={d.id} className="flex items-start justify-between gap-2 text-[11px] px-3 py-2 rounded-lg"
                style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                <div className="min-w-0">
                  <span className="font-mono font-bold">{d.event}</span>
                  <span style={{ color: 'rgb(var(--color-text-muted))' }}> · {fmt(d.createdAt)}</span>
                  <div style={{ color: 'rgb(var(--color-text-muted))' }}>
                    tentativa {d.attempt}
                    {d.httpStatus !== null && ` · HTTP ${d.httpStatus}`}
                    {d.error && <span style={{ color: '#f87171' }}> · {d.error}</span>}
                  </div>
                </div>
                <span className="font-bold shrink-0" style={{ color: d.success ? '#34d399' : '#f87171' }}>
                  {d.success ? 'entregue' : 'falhou'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
