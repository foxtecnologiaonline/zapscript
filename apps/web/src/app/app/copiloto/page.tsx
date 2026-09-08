'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/**
 * Painel web do Copiloto — SÓ LEITURA. A ação de verdade (escolher 1/2/3,
 * editar antes de enviar, ignorar) continua exclusivamente no self-chat do
 * WhatsApp ("Mensagens para você mesmo") — ver ESCOPO_COPILOTO.md §1. Esta
 * tela existe pra navegar o histórico com filtro, não pra substituir aquele
 * fluxo.
 *
 * Duas abas: Conversas (Função 1 — briefing individual) e Grupos (Função 2 —
 * opt-in pro resumo diário, única parte que sempre teve tela própria).
 */

interface WNumber {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
}

// ── Conversas ────────────────────────────────────────────────────────────────

interface SuggestionRow {
  rank: number;
  axis: string;
  title: string;
  draft: string;
  technique: string;
  status: string; // offered | sent | edited | discarded
  sentText: string | null;
  outcome: string | null; // replied | no_reply | null
  commitmentTitle: string | null;
  commitmentDueAt: string | null;
}

interface BriefingRow {
  id: string;
  summary: string;
  intent: string;
  temperature: string; // quente | morno | frio
  riskLevel: string;   // baixo | medio | alto
  blocker: string | null;
  status: string;      // pending | awaiting_edit | acted | dismissed | expired
  createdAt: string;
  suggestions: SuggestionRow[];
}

interface ConversationListItem {
  id: string;
  numberId: string;
  number: { id: string; displayName: string | null; phoneNumber: string | null } | null;
  contactName: string | null;
  contactPhone: string;
  lastMessageAt: string;
  latestBriefing: BriefingRow | null;
}

interface ConversationMessage {
  id: string;
  direction: string; // in | out
  content: string;
  fromCopiloto: boolean;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  contactName: string | null;
  contactPhone: string;
  messages: ConversationMessage[];
  briefings: BriefingRow[];
}

interface CopilotoGroupRow {
  groupJid: string;
  name: string;
  active: boolean;
}

const TEMP_LABEL: Record<string, string> = { quente: '🔥 Quente', morno: '🌤️ Morno', frio: '❄️ Frio' };
const RISK_LABEL: Record<string, string> = { baixo: 'risco baixo', medio: '⚠️ risco médio', alto: '🚨 risco alto' };
const BLOCKER_LABEL: Record<string, string> = {
  preco: 'trava: preço', prazo: 'trava: prazo', confianca: 'trava: confiança',
  autoridade: 'trava: quem decide', urgencia: 'trava: falta de urgência',
};
const BRIEFING_STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando você', awaiting_edit: 'Editando no self-chat',
  acted: 'Resolvido', dismissed: 'Ignorado', expired: 'Expirado',
};
const SUGGESTION_STATUS_LABEL: Record<string, string> = {
  offered: 'Oferecida', sent: '✅ Enviada', edited: '✏️ Editada e enviada', discarded: '🚫 Bloqueada',
};
const OUTCOME_LABEL: Record<string, string> = { replied: 'Cliente respondeu depois', no_reply: 'Sem resposta ainda' };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

function SuggestionCard({ s }: { s: SuggestionRow }) {
  const blocked = s.status === 'discarded';
  return (
    <div className={`rounded-lg border p-3 text-sm ${blocked ? 'border-red-900/60 bg-red-950/20 opacity-70' : 'border-neutral-800 bg-neutral-950'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium text-neutral-200">{s.rank} · {s.title}</span>
        <span className="text-[10px] text-neutral-500">⟨{s.technique}⟩</span>
      </div>
      <p className="text-neutral-400 mt-1 whitespace-pre-wrap">&ldquo;{s.draft}&rdquo;</p>
      <div className="flex items-center gap-2 flex-wrap mt-2 text-[11px]">
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">
          {SUGGESTION_STATUS_LABEL[s.status] || s.status}
        </span>
        {s.outcome && (
          <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-emerald-300">
            {OUTCOME_LABEL[s.outcome] || s.outcome}
          </span>
        )}
        {s.commitmentTitle && (
          <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-amber-300">
            📌 {s.commitmentTitle}
          </span>
        )}
      </div>
    </div>
  );
}

function BriefingCard({ b }: { b: BriefingRow }) {
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-neutral-500">{new Date(b.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <span className="text-[11px] rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">
          {BRIEFING_STATUS_LABEL[b.status] || b.status}
        </span>
      </div>
      {b.summary && <p className="text-sm text-neutral-200">{b.summary}</p>}
      {b.intent && <p className="text-xs text-neutral-500">O que ele quer: {b.intent}</p>}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-neutral-400">
        <span>{TEMP_LABEL[b.temperature] || b.temperature}</span>
        <span>·</span>
        <span>{RISK_LABEL[b.riskLevel] || b.riskLevel}</span>
        {b.blocker && <><span>·</span><span>{BLOCKER_LABEL[b.blocker] || b.blocker}</span></>}
      </div>
      {b.suggestions.length > 0 && (
        <div className="space-y-2 pt-1">
          {b.suggestions.map((s) => <SuggestionCard key={s.rank} s={s} />)}
        </div>
      )}
    </div>
  );
}

function ConversasTab({ numbers, numberId, onNotEntitled }: {
  numbers: WNumber[]; numberId: string; onNotEntitled: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [temperature, setTemperature] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (numberId)     params.set('numberId', numberId);
    if (temperature)  params.set('temperature', temperature);
    if (status)       params.set('status', status);
    if (q.trim())     params.set('q', q.trim());
    setLoading(true);
    api.get<{ conversations: ConversationListItem[] }>(`/copiloto/conversations?${params.toString()}`)
      .then((res) => { setConversations(res.conversations); setError(null); })
      .catch((e: any) => {
        if (e?.moduleRequired) onNotEntitled();
        else setError(e?.message || 'Não foi possível carregar as conversas.');
      })
      .finally(() => setLoading(false));
  }, [numberId, temperature, status, q, onNotEntitled]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const loadDetail = useCallback((id: string) => {
    setLoadingDetail(true);
    api.get<{ conversation: ConversationDetail }>(`/copiloto/conversations/${id}`)
      .then((res) => setDetail(res.conversation))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, []);

  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  const timeline = useMemo(() => {
    if (!detail) return [];
    type Item = { kind: 'message'; data: ConversationMessage } | { kind: 'briefing'; data: BriefingRow };
    const items: Array<Item & { createdAt: string }> = [
      ...detail.messages.map((m) => ({ kind: 'message' as const, data: m, createdAt: m.createdAt })),
      ...detail.briefings.map((b) => ({ kind: 'briefing' as const, data: b, createdAt: b.createdAt })),
    ];
    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [detail]);

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="flex-1 min-w-[180px] rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
        />
        <select
          value={temperature} onChange={(e) => setTemperature(e.target.value)}
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
        >
          <option value="">Toda temperatura</option>
          <option value="quente">🔥 Quente</option>
          <option value="morno">🌤️ Morno</option>
          <option value="frio">❄️ Frio</option>
        </select>
        <select
          value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
        >
          <option value="">Todo status</option>
          <option value="pending">Aguardando você</option>
          <option value="awaiting_edit">Editando no self-chat</option>
          <option value="acted">Resolvido</option>
          <option value="dismissed">Ignorado</option>
          <option value="expired">Expirado</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">Carregando conversas…</div>
      ) : conversations.length === 0 ? (
        <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">
          Nenhuma conversa {temperature || status || q ? 'bate com esse filtro' : 'ainda — assim que o Copiloto avaliar uma conversa, ela aparece aqui'}.
        </div>
      ) : (
        <div className="flex gap-0 md:gap-4 rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden" style={{ minHeight: 480 }}>
          {/* Lista */}
          <div className={`${selectedId ? 'hidden md:block' : 'block'} w-full md:w-80 md:border-r md:border-neutral-800 overflow-y-auto`} style={{ maxHeight: 680 }}>
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-neutral-800/60 hover:bg-neutral-800/50 transition-colors ${selectedId === c.id ? 'bg-neutral-800/70' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{c.contactName || c.contactPhone}</span>
                  <span className="text-[11px] text-neutral-500 flex-shrink-0">{timeAgo(c.lastMessageAt)}</span>
                </div>
                {c.latestBriefing ? (
                  <>
                    <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                      <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                        {TEMP_LABEL[c.latestBriefing.temperature] || c.latestBriefing.temperature}
                      </span>
                      <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                        {BRIEFING_STATUS_LABEL[c.latestBriefing.status] || c.latestBriefing.status}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-500 truncate mt-1">{c.latestBriefing.summary}</p>
                  </>
                ) : (
                  <p className="text-xs text-neutral-600 mt-1">Sem briefing ainda</p>
                )}
              </button>
            ))}
          </div>

          {/* Detalhe */}
          <div className={`${selectedId ? 'block' : 'hidden md:block'} flex-1 flex flex-col`} style={{ maxHeight: 680 }}>
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">Selecione uma conversa</div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
                  <button onClick={() => setSelectedId(null)} className="md:hidden text-neutral-400 hover:text-neutral-200 flex-shrink-0">←</button>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{selected.contactName || selected.contactPhone}</div>
                    <div className="text-xs text-neutral-500 truncate">
                      {selected.contactPhone}{selected.number?.displayName ? ` · ${selected.number.displayName}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {loadingDetail ? (
                    <p className="text-neutral-500 text-sm">Carregando…</p>
                  ) : timeline.length === 0 ? (
                    <p className="text-neutral-500 text-sm">Sem histórico ainda.</p>
                  ) : (
                    timeline.map((item) =>
                      item.kind === 'message' ? (
                        <div key={`m-${item.data.id}`} className={`flex ${item.data.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                            item.data.direction === 'out' ? 'bg-emerald-700/80 text-white rounded-br-sm' : 'bg-neutral-800 text-neutral-100 rounded-bl-sm'
                          }`}>
                            <p className="whitespace-pre-wrap">{item.data.content}</p>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] opacity-70">
                              <span>{new Date(item.data.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                              {item.data.fromCopiloto && <span>· via Copiloto</span>}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <BriefingCard key={`b-${item.data.id}`} b={item.data} />
                      ),
                    )
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Grupos ───────────────────────────────────────────────────────────────────

function GruposTab({ numberId, onNotEntitled }: { numberId: string; onNotEntitled: () => void }) {
  const [groups, setGroups] = useState<CopilotoGroupRow[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyJid, setBusyJid] = useState<string | null>(null);

  const loadGroups = useCallback((id: string) => {
    if (!id) return;
    setLoadingGroups(true);
    setError(null);
    api.get<{ groups: CopilotoGroupRow[] }>(`/copiloto/numbers/${id}/groups`)
      .then((res) => setGroups(res.groups))
      .catch((e: any) => {
        if (e?.moduleRequired) onNotEntitled();
        else setError(e?.message || 'Não foi possível carregar os grupos.');
      })
      .finally(() => setLoadingGroups(false));
  }, [onNotEntitled]);

  useEffect(() => { if (numberId) loadGroups(numberId); }, [numberId, loadGroups]);

  async function toggle(group: CopilotoGroupRow) {
    setBusyJid(group.groupJid);
    const nextActive = !group.active;
    setGroups((gs) => gs.map((g) => (g.groupJid === group.groupJid ? { ...g, active: nextActive } : g)));
    try {
      await api.post(`/copiloto/numbers/${numberId}/groups`, {
        groupJid: group.groupJid,
        name:     group.name,
        active:   nextActive,
      });
    } catch (e: any) {
      setGroups((gs) => gs.map((g) => (g.groupJid === group.groupJid ? { ...g, active: !nextActive } : g)));
      setError(e?.message || 'Não foi possível atualizar o grupo.');
    } finally {
      setBusyJid(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      <h2 className="text-sm font-bold text-neutral-300 mb-3">
        Grupos ({groups.filter((g) => g.active).length} ativo{groups.filter((g) => g.active).length !== 1 ? 's' : ''})
      </h2>

      {loadingGroups ? (
        <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">Carregando grupos...</div>
      ) : groups.length === 0 ? (
        <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">Nenhum grupo encontrado nesse número.</div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <label key={g.groupJid} className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 cursor-pointer">
              <input type="checkbox" checked={g.active} disabled={busyJid === g.groupJid} onChange={() => toggle(g)} />
              <span className="text-sm flex-1 min-w-0 truncate">{g.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function CopilotoPage() {
  const [numbers, setNumbers] = useState<WNumber[]>([]);
  const [numberId, setNumberId] = useState('');
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [notEntitled, setNotEntitled] = useState(false);
  const [tab, setTab] = useState<'conversas' | 'grupos'>('conversas');

  useEffect(() => {
    api.get<WNumber[]>('/numbers')
      .then((nums) => {
        const connected = nums.filter((n) => n.status === 'connected');
        setNumbers(connected);
        if (connected.length > 0) setNumberId(connected[0].id);
      })
      .catch(() => null)
      .finally(() => setLoadingNumbers(false));
  }, []);

  const onNotEntitled = useCallback(() => setNotEntitled(true), []);

  if (loadingNumbers) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="text-neutral-500">Carregando...</div>
      </main>
    );
  }

  if (notEntitled) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-5 py-10">
        <div className="max-w-md w-full rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <div className="text-4xl mb-4">🎯</div>
          <h1 className="text-xl font-bold mb-2">Copiloto</h1>
          <p className="text-neutral-400 mb-6">
            Lê suas conversas, resume pra você e sugere 3 ações — liberado usuário a usuário, não vendido. Fale com o suporte se quiser entrar no MVP.
          </p>
          <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">← Voltar aos módulos</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900/60 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/app" className="text-neutral-500 hover:text-neutral-300 text-sm">← Módulos</Link>
          <h1 className="text-lg font-bold flex items-center gap-2">🎯 Copiloto</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 mb-6 text-sm text-neutral-400">
          Esta tela é só pra acompanhar — pra agir numa sugestão (enviar, editar, ignorar), responda no próprio WhatsApp,
          no chat <strong className="text-neutral-200">&ldquo;Mensagens para você mesmo&rdquo;</strong>. Mande
          <code className="mx-1 px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">copiloto status</code>
          por lá pra ver o que está pendente ali também.
        </div>

        {numbers.length > 1 && (
          <div className="mb-4">
            <label className="block text-xs text-neutral-500 mb-1">Número</label>
            <select
              value={numberId} onChange={(e) => setNumberId(e.target.value)}
              className="w-full sm:w-64 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
            >
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>{n.displayName || n.phoneNumber || n.id}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-1 mb-5 border-b border-neutral-800">
          {(['conversas', 'grupos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {t === 'conversas' ? 'Conversas' : 'Grupos'}
            </button>
          ))}
        </div>

        {tab === 'conversas'
          ? <ConversasTab numbers={numbers} numberId={numberId} onNotEntitled={onNotEntitled} />
          : <GruposTab numberId={numberId} onNotEntitled={onNotEntitled} />}
      </div>
    </main>
  );
}
