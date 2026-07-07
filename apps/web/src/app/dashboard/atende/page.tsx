'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

interface AtendeConfig {
  habilitado: boolean;
  autoEnvioAtivo: boolean;
  categoriasSensiveis: string[];
  toneOverride: string | null;
  negocioDescricao: string | null;
}

interface QueueItem {
  id: string;
  conversaId: string;
  contatoNome: string | null;
  remoteJid: string;
  resumoConversa: string;
  categoria: string | null;
  prioridade: string | null;
  confiancaResposta: number | null;
  requerEscalacao: boolean;
  categoriaSensivel: boolean;
  rascunho: string | null;
  criadoEm: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  alta: 'text-red-400', media: 'text-amber-400', baixa: 'text-brand-text-secondary',
};

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'red' | 'amber' | 'green' }) {
  const tones: Record<string, string> = {
    muted: 'bg-white/5 text-brand-text-secondary',
    red:   'bg-red-500/15 text-red-300',
    amber: 'bg-amber-500/15 text-amber-300',
    green: 'bg-green-500/15 text-green-300',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${tones[tone]}`}>{children}</span>;
}

export default function AtendePage() {
  const [userId, setUserId]   = useState('');
  const [cfg, setCfg]         = useState<AtendeConfig | null>(null);
  const [queue, setQueue]     = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSaving]= useState(false);
  const [drafts, setDrafts]   = useState<Record<string, string>>({});
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [catInput, setCatInput] = useState('');

  const loadQueue = useCallback(async () => {
    const q = await api.get<{ mensagens: QueueItem[] }>('/atende/queue').catch(() => ({ mensagens: [] }));
    setQueue(q.mensagens);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [me, c] = await Promise.all([
          api.get<any>('/auth/me').catch(() => null),
          api.get<AtendeConfig>('/atende/config'),
        ]);
        if (me?.id) setUserId(me.id);
        setCfg(c);
        await loadQueue();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadQueue]);

  useSocket(userId, { 'atende:novo': () => { loadQueue(); } });

  async function saveCfg(patch: Partial<AtendeConfig>) {
    if (!cfg) return;
    setSaving(true);
    try {
      const next = { ...cfg, ...patch };
      const saved = await api.put<Partial<AtendeConfig>>('/atende/config', {
        autoEnvioAtivo:      next.autoEnvioAtivo,
        categoriasSensiveis: next.categoriasSensiveis,
        toneOverride:        next.toneOverride,
        negocioDescricao:    next.negocioDescricao,
      });
      setCfg({ ...next, ...saved } as AtendeConfig);
    } finally {
      setSaving(false);
    }
  }

  function addCategoria() {
    const v = catInput.trim();
    if (!v || !cfg) return;
    if (cfg.categoriasSensiveis.includes(v)) { setCatInput(''); return; }
    saveCfg({ categoriasSensiveis: [...cfg.categoriasSensiveis, v] });
    setCatInput('');
  }
  function removeCategoria(c: string) {
    if (!cfg) return;
    saveCfg({ categoriasSensiveis: cfg.categoriasSensiveis.filter(x => x !== c) });
  }

  async function act(id: string, fn: () => Promise<any>) {
    setBusyId(id);
    try { await fn(); await loadQueue(); }
    catch (e: any) { alert(e?.error || e?.message || 'Erro'); }
    finally { setBusyId(null); }
  }

  const approve = (m: QueueItem) => act(m.id, () =>
    api.post(`/atende/mensagem/${m.id}/approve`, { texto: drafts[m.id] ?? m.rascunho ?? '' }));
  const escalate = (m: QueueItem) => act(m.id, () => api.post(`/atende/mensagem/${m.id}/escalate`, {}));
  const markSpam = (m: QueueItem) => act(m.id, () => api.post(`/atende/mensagem/${m.id}/spam`, {}));
  const regenerate = (m: QueueItem) => act(m.id, async () => {
    const instrucao = prompt('Como reescrever o rascunho?', 'Deixe mais cordial e objetivo.');
    if (instrucao === null) return;
    const r = await api.post<{ rascunho: string }>(`/atende/mensagem/${m.id}/regenerate`, { instrucao });
    setDrafts(d => ({ ...d, [m.id]: r.rascunho }));
  });

  if (loading) return <div className="p-6 text-brand-text-secondary text-sm">Carregando…</div>;

  if (!cfg?.habilitado) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-brand-text mb-2">💬 ZapScript Atende</h1>
        <p className="text-sm text-brand-text-secondary max-w-lg">
          O Atende ainda não está habilitado nesta conta. Fale com o suporte para ativar o
          agente de atendimento no seu número conectado.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-brand-text">💬 ZapScript Atende</h1>
        <p className="text-sm text-brand-text-secondary">
          Respostas automáticas aos clientes do seu WhatsApp, com revisão humana.
        </p>
      </div>

      {/* ── Configuração / kill switch ─────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-brand-text text-sm">Auto-envio (respostas verdes)</div>
            <div className="text-xs text-brand-text-secondary max-w-md">
              Quando ligado, casos simples e de alta confiança são respondidos sozinhos.
              Casos sensíveis nunca são enviados automaticamente — sempre entram na fila.
            </div>
          </div>
          <button
            onClick={() => saveCfg({ autoEnvioAtivo: !cfg.autoEnvioAtivo })}
            disabled={savingCfg}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${cfg.autoEnvioAtivo ? 'bg-green-500' : 'bg-white/15'}`}
            aria-label="Alternar auto-envio"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${cfg.autoEnvioAtivo ? 'translate-x-6' : ''}`} />
          </button>
        </div>

        <div>
          <div className="font-semibold text-brand-text text-sm mb-1">Categorias sensíveis</div>
          <div className="text-xs text-brand-text-secondary mb-2">
            Assuntos que nunca devem ser respondidos automaticamente (além do piso jurídico/financeiro, sempre ativo).
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {cfg.categoriasSensiveis.map(c => (
              <span key={c} className="text-xs bg-white/10 rounded-full px-3 py-1 flex items-center gap-2">
                {c}
                <button onClick={() => removeCategoria(c)} className="text-brand-text-secondary hover:text-red-400">×</button>
              </span>
            ))}
            {cfg.categoriasSensiveis.length === 0 && (
              <span className="text-xs text-brand-text-secondary">Nenhuma cadastrada.</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={catInput}
              onChange={e => setCatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategoria(); }}
              placeholder="ex: contrato, desconto, prazo de entrega"
              className="flex-1 text-sm bg-brand-bg border border-white/10 rounded-lg px-3 py-2 text-brand-text"
            />
            <button onClick={addCategoria} className="text-sm px-3 py-2 rounded-lg bg-brand-primary/20 text-brand-primary font-semibold">Adicionar</button>
          </div>
        </div>
      </section>

      {/* ── Fila de aprovação ──────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-brand-text text-sm">Fila de aprovação ({queue.length})</h2>
          <button onClick={loadQueue} className="text-xs text-brand-primary">Atualizar</button>
        </div>

        {queue.length === 0 && (
          <div className="text-sm text-brand-text-secondary rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            Nenhuma mensagem aguardando. 🎉
          </div>
        )}

        {queue.map(m => {
          const draft = drafts[m.id] ?? m.rascunho ?? '';
          const busy = busyId === m.id;
          return (
            <div key={m.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold text-brand-text text-sm">
                  {m.contatoNome || m.remoteJid.replace('@s.whatsapp.net', '')}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {m.categoria && <Badge>{m.categoria}</Badge>}
                  {m.prioridade && <span className={`text-[10px] font-semibold ${PRIORITY_COLOR[m.prioridade] || ''}`}>{m.prioridade}</span>}
                  {typeof m.confiancaResposta === 'number' && <Badge>conf {m.confiancaResposta}%</Badge>}
                  {m.categoriaSensivel && <Badge tone="red">sensível</Badge>}
                  {m.requerEscalacao && !m.categoriaSensivel && <Badge tone="amber">revisar</Badge>}
                </div>
              </div>

              {m.resumoConversa && (
                <div className="text-xs text-brand-text-secondary">Resumo: {m.resumoConversa}</div>
              )}

              <textarea
                value={draft}
                onChange={e => setDrafts(d => ({ ...d, [m.id]: e.target.value }))}
                rows={3}
                className="w-full text-sm bg-brand-bg border border-white/10 rounded-lg px-3 py-2 text-brand-text"
              />

              <div className="flex gap-2 flex-wrap">
                <button disabled={busy} onClick={() => approve(m)}
                  className="text-sm px-3 py-1.5 rounded-lg bg-green-500/20 text-green-300 font-semibold disabled:opacity-50">
                  Aprovar e enviar
                </button>
                <button disabled={busy} onClick={() => regenerate(m)}
                  className="text-sm px-3 py-1.5 rounded-lg bg-white/10 text-brand-text-secondary disabled:opacity-50">
                  Regenerar
                </button>
                <button disabled={busy} onClick={() => escalate(m)}
                  className="text-sm px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 disabled:opacity-50">
                  Escalar
                </button>
                <button disabled={busy} onClick={() => markSpam(m)}
                  className="text-sm px-3 py-1.5 rounded-lg bg-white/10 text-brand-text-secondary disabled:opacity-50">
                  Spam
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
