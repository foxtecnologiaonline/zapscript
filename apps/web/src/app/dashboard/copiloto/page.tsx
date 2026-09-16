'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';

/**
 * Painel web do Copiloto.
 *
 * v3.0 (ESCOPO_COPILOTO.md §15) — Inbox é a aba principal: fila sob demanda,
 * "Atualizar" dispara a IA pras conversas não lidas, e enviar/editar/descartar
 * acontece aqui mesmo (não mais respondendo "1/2/3" no self-chat do WhatsApp).
 *
 * Quatro abas: Inbox (fila do dia-a-dia), Conversas (navegação/histórico
 * livre, com filtro), Métricas, e Grupos (Função 2 — opt-in pro resumo
 * diário, sempre teve tela própria).
 *
 * Vive dentro de /dashboard (layout já traz sidebar/nav) — por isso não tem
 * <main> nem header próprio, diferente de quando morava em /app/copiloto.
 */

interface WNumber {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
}

// ── Conversas ────────────────────────────────────────────────────────────────

interface SuggestionRow {
  id: string;
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
  userFeedback: string | null; // anotação do dono — só editável aqui no site
}

interface BriefingRow {
  id: string;
  summary: string;
  intent: string;
  temperature: string; // quente | morno | frio
  riskLevel: string;   // baixo | medio | alto
  blocker: string | null;
  // v2.0 — null em briefing anterior à expansão de escopo (tratado como
  // "comercial" em todo o produto, ver ESCOPO_COPILOTO.md).
  tipo: string | null;      // comercial | pessoal | admin | crise | oportunidade | null
  remetente: string | null; // cliente_novo | ativo | fornecedor | parceiro | equipe | outro | null
  status: string;      // pending | awaiting_edit | acted | dismissed | expired
  createdAt: string;
  suggestions: SuggestionRow[];
}

// v3.0 — a fila sob demanda (ESCOPO_COPILOTO.md §15). `unread` = ainda não
// processada (precisa de "Atualizar"); false com latestBriefing.status=
// 'pending' = já tem análise, só falta enviar/descartar. Só vêm as opções
// 'offered' (o card nunca mostra o que os guardrails bloquearam).
interface InboxSuggestion {
  id: string;
  rank: number;
  axis: string;
  title: string;
  draft: string;
  rationale: string;
  risk: string | null;
  technique: string;
  confidence: number;
  commitmentTitle: string | null;
  commitmentDueAt: string | null;
}

interface InboxBriefing {
  id: string;
  summary: string;
  intent: string;
  temperature: string;
  riskLevel: string;
  blocker: string | null;
  tipo: string | null;
  remetente: string | null;
  sensitive: boolean;
  status: string;
  createdAt: string;
  suggestions: InboxSuggestion[];
}

interface InboxRow {
  id: string;
  numberId: string;
  number: { id: string; displayName: string | null; phoneNumber: string | null } | null;
  contactName: string | null;
  contactPhone: string;
  lastMessageAt: string;
  unread: boolean;
  latestBriefing: InboxBriefing | null;
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

interface CopilotoGroupDigestBlock {
  grupo: string;
  decidido: string | null;
  pendente: string | null;
  ruido: number;
  messageCount: number;
}

interface CopilotoGroupDigestRow {
  id: string;
  date: string; // 'YYYY-MM-DD'
  groupsIncluded: number;
  summaryMd: string; // já vem formatado por grupo ("👥 *Grupo* ...") — ver apps/worker/src/copiloto.ts
  blocksJson: CopilotoGroupDigestBlock[] | null; // mesmo conteúdo, estruturado — alimenta a tendência abaixo
  createdAt: string;
}

// ── Métricas ─────────────────────────────────────────────────────────────────

interface CopilotoMetrics {
  since: string;
  days: number;
  snapshot: { totalContacts: number; unreadConversations: number; readConversations: number };
  activity: {
    messagesIn: number; messagesOut: number;
    briefingsGenerated: number; briefingsDismissed: number;
    suggestionsSent: number; customerReplies: number; tasksCreated: number;
    byTipo: Array<{ tipo: string; count: number }>;
  };
}

const TEMP_LABEL: Record<string, string> = { quente: '🔥 Quente', morno: '🌤️ Morno', frio: '❄️ Frio' };
const RISK_LABEL: Record<string, string> = { baixo: 'risco baixo', medio: '⚠️ risco médio', alto: '🚨 risco alto' };
const BLOCKER_LABEL: Record<string, string> = {
  preco: 'trava: preço', prazo: 'trava: prazo', confianca: 'trava: confiança',
  autoridade: 'trava: quem decide', urgencia: 'trava: falta de urgência',
};
// v2.0 — escopo ampliado de "só comercial" pra 5 tipos de conversa. null
// (briefing anterior à v2.0) usa o mesmo rótulo de "comercial".
const TIPO_LABEL: Record<string, string> = {
  comercial: '💼 Comercial', pessoal: '👋 Pessoal', admin: '🧾 Admin',
  crise: '🆘 Crise', oportunidade: '🌱 Oportunidade',
};
const BRIEFING_STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando você', awaiting_edit: 'Editando no self-chat',
  acted: 'Resolvido', dismissed: 'Ignorado', expired: 'Expirado',
};
const SUGGESTION_STATUS_LABEL: Record<string, string> = {
  offered: 'Oferecida', sent: '✅ Enviada', edited: '✏️ Editada e enviada', discarded: '🚫 Bloqueada',
};
const OUTCOME_LABEL: Record<string, string> = { replied: 'Cliente respondeu depois', no_reply: 'Sem resposta ainda' };
// Português de loja em vez do jargão de técnica de vendas — nem todo dono de
// pequeno negócio reconhece "fechamento-assumido" ou "ancoragem" de cara.
const TECHNIQUE_LABEL: Record<string, string> = {
  // comercial (v1.0)
  'fechamento-assumido': 'Fechar a venda',
  'qualificacao':        'Perguntar antes de propor',
  'loop-objecao':        'Contornar objeção',
  'ancoragem':           'Ancorar valor',
  'prova-social':        'Prova social',
  'saida-digna':         'Dar saída sem perder a venda',
  'reciprocidade':       'Reciprocidade',
  'escuta-ativa':        'Confirmar antes de responder',
  'proximo-passo':       'Propor próximo passo',
  // pessoal (v2.0)
  'conexao-pessoal':     'Aprofundar conexão',
  'curiosidade-genuina': 'Curiosidade genuína',
  'reconhecimento':      'Reconhecer o ponto sem se justificar',
  // admin (v2.0)
  'resolucao-direta':    'Resolver direto',
  'prazo-real':          'Dar prazo real',
  'encaminhamento-claro': 'Encaminhar com clareza',
  // crise (v2.0)
  'responsabilidade-imediata': 'Assumir responsabilidade rápido',
  'escuta-de-crise':     'Entender o problema antes de prometer',
  'validacao-sem-culpa': 'Validar sem admitir culpa indevida',
  // oportunidade (v2.0)
  'interesse-qualificado': 'Mostrar interesse qualificado',
  'filtro-estrategico':  'Filtrar se vale a pena',
  'porta-aberta':        'Pedir tempo sem fechar a porta',
};

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
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState(s.userFeedback ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function saveFeedback() {
    setSaving(true);
    try {
      await api.put(`/copiloto/suggestions/${s.id}/feedback`, { feedback });
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silencioso — não é crítico, o dono pode tentar de novo
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-lg border p-3 text-sm ${blocked ? 'border-red-900/60 bg-red-950/20 opacity-70' : 'border-neutral-800 bg-neutral-950'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium text-neutral-200">{s.rank} · {s.title}</span>
        <span className="text-[10px] text-neutral-500">⟨{TECHNIQUE_LABEL[s.technique] || s.technique}⟩</span>
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

      {/* Feedback do dono — só editável aqui, entra no próximo briefing dessa
          conversa (ver processBrief em apps/worker/src/copiloto.ts). */}
      {editing ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Ex.: cliente não fala assim, preço tá errado…"
            maxLength={500}
            rows={2}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-600 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveFeedback}
              disabled={saving}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-700/80 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              onClick={() => { setEditing(false); setFeedback(s.userFeedback ?? ''); }}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : s.userFeedback ? (
        <button onClick={() => setEditing(true)} className="mt-2 flex items-start gap-1.5 text-left w-full">
          <span className="text-[11px] text-amber-300/90">📝 {s.userFeedback}</span>
        </button>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-400">
          + Anotar feedback
        </button>
      )}
      {saved && <span className="block mt-1 text-[10px] text-emerald-400">✓ Salvo — vale a partir da próxima sugestão pra esse contato</span>}
    </div>
  );
}

function BriefingCard({ b }: { b: BriefingRow }) {
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-neutral-500">{new Date(b.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] rounded-full bg-neutral-800 px-2 py-0.5 text-emerald-400">
            {TIPO_LABEL[b.tipo ?? 'comercial'] || b.tipo}
          </span>
          <span className="text-[11px] rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">
            {BRIEFING_STATUS_LABEL[b.status] || b.status}
          </span>
        </div>
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

// ── Inbox (v3.0 — fila sob demanda, ver ESCOPO_COPILOTO.md §15) ─────────────

function InboxSuggestionCard({ s, onSent }: { s: InboxSuggestion; onSent: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      await api.post(`/copiloto/suggestions/${s.id}/send`, { text });
      onSent();
    } catch (e: any) {
      setError(e?.message || 'Não consegui enviar. Tenta de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium text-neutral-200">{s.rank} · {s.title}</span>
        <span className="text-[10px] text-neutral-500">⟨{TECHNIQUE_LABEL[s.technique] || s.technique}⟩</span>
      </div>

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-emerald-600 resize-none"
        />
      ) : (
        <p className="text-neutral-400 mt-1 whitespace-pre-wrap">&ldquo;{text}&rdquo;</p>
      )}

      <p className="text-[11px] text-neutral-600 mt-1.5">{s.rationale}</p>
      {s.risk && <p className="text-[11px] text-amber-400/80 mt-0.5">⚠️ {s.risk}</p>}
      {s.commitmentTitle && (
        <span className="inline-block mt-1.5 rounded-full bg-amber-900/30 px-2 py-0.5 text-[11px] text-amber-300">
          📌 vira tarefa: {s.commitmentTitle}
        </span>
      )}

      {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}

      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-emerald-700/80 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {sending ? 'Enviando…' : editing ? 'Enviar editado' : 'Enviar'}
        </button>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[12px] text-neutral-400 hover:text-neutral-200">
            Editar antes
          </button>
        )}
        {editing && (
          <button
            onClick={() => { setEditing(false); setText(s.draft); }}
            className="text-[12px] text-neutral-500 hover:text-neutral-300"
          >
            Cancelar edição
          </button>
        )}
      </div>
    </div>
  );
}

function InboxCard({ row, onChanged }: { row: InboxRow; onChanged: () => void }) {
  const who = row.contactName || row.contactPhone;
  const b = row.latestBriefing;
  const [dismissing, setDismissing] = useState(false);

  async function dismiss(noise: boolean) {
    if (!b) return;
    setDismissing(true);
    try {
      await api.post(`/copiloto/briefings/${b.id}/dismiss`, { noise });
      onChanged();
    } catch {
      setDismissing(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium text-neutral-100">{who}</span>
        <span className="text-[11px] text-neutral-500">{timeAgo(row.lastMessageAt)}</span>
      </div>

      {row.unread || !b ? (
        <p className="text-sm text-neutral-500">Ainda não processada — clique em &ldquo;Atualizar&rdquo; no topo.</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] rounded-full bg-neutral-800 px-2 py-0.5 text-emerald-400">
              {TIPO_LABEL[b.tipo ?? 'comercial'] || b.tipo}
            </span>
            <span className="text-[11px]">{TEMP_LABEL[b.temperature] || b.temperature}</span>
            <span className="text-[11px] text-neutral-500">·</span>
            <span className="text-[11px] text-neutral-400">{RISK_LABEL[b.riskLevel] || b.riskLevel}</span>
            {b.blocker && <span className="text-[11px] text-neutral-400">· {BLOCKER_LABEL[b.blocker] || b.blocker}</span>}
            {b.sensitive && <span className="text-[11px] text-sky-300">🕊️ sensível</span>}
          </div>
          {b.summary && <p className="text-sm text-neutral-200">{b.summary}</p>}
          {b.intent && <p className="text-xs text-neutral-500">O que ele quer: {b.intent}</p>}

          {b.suggestions.length > 0 ? (
            <div className="space-y-2 pt-1">
              {b.suggestions.map((s) => (
                <InboxSuggestionCard key={s.id} s={s} onSent={onChanged} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">Sem sugestão segura desta vez — responda você mesmo.</p>
          )}

          <div className="pt-1">
            <button
              onClick={() => dismiss(false)}
              disabled={dismissing}
              className="text-[12px] text-neutral-500 hover:text-neutral-300 mr-3"
            >
              Descartar
            </button>
            <button
              onClick={() => dismiss(true)}
              disabled={dismissing}
              className="text-[12px] text-neutral-600 hover:text-neutral-400"
            >
              Descartar e avisar que isso não devia ter aparecido
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function InboxTab({ numberId, onNotEntitled }: { numberId: string; onNotEntitled: () => void }) {
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feedback do que aconteceu no último clique em "Atualizar" — sem isso, o
  // botão só mostrava "Processando…" e voltava ao normal sem dizer se
  // processou algo, o que passava a impressão de não estar funcionando.
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (numberId) params.set('numberId', numberId);
    return api.get<{ inbox: InboxRow[]; unreadCount: number }>(`/copiloto/inbox?${params.toString()}`)
      .then((res) => { setInbox(res.inbox); setError(null); return res; })
      .catch((e: any) => {
        if (e?.moduleRequired) onNotEntitled();
        else setError(e?.message || 'Não foi possível carregar a fila.');
        return null;
      });
  }, [numberId, onNotEntitled]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  // "Atualizar": dispara o processamento e faz polling curto até as
  // conversas enfileiradas AGORA saírem do estado "não lida" (ou até um teto
  // de tempo, pra nunca ficar girando pra sempre se algo travar no worker).
  // Conta pelas conversas desta rodada (`targetIds`), não pelo total de não
  // lidas — uma mensagem nova chegando durante o polling não pode fazer o
  // botão parecer que nunca termina.
  async function refresh() {
    setRefreshing(true);
    setError(null);
    setStatus(null);
    try {
      const res = await api.post<{ enqueued: number; pending: number; conversationIds: string[] }>(
        '/copiloto/inbox/refresh', { numberId: numberId || undefined },
      );
      if (res.pending === 0) {
        setStatus('Nada novo pra processar — já está tudo em dia.');
        await load();
        return;
      }

      const targetIds = new Set(res.conversationIds);
      const deadline = Date.now() + 45_000;
      let stillPending = targetIds.size;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const result = await load();
        if (!result) continue;
        stillPending = result.inbox.filter((row) => targetIds.has(row.id) && row.unread).length;
        if (stillPending === 0) break;
      }

      setStatus(
        stillPending === 0
          ? `Pronto — ${res.pending} conversa${res.pending !== 1 ? 's' : ''} processada${res.pending !== 1 ? 's' : ''}.`
          : `Processou ${res.pending - stillPending} de ${res.pending} — o restante pode levar mais um pouco (tente Atualizar de novo).`,
      );
    } catch (e: any) {
      setError(e?.message || 'Não consegui atualizar agora.');
    } finally {
      setRefreshing(false);
    }
  }

  const unreadCount = inbox.filter((i) => i.unread).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm text-neutral-400">
          {unreadCount > 0
            ? `${unreadCount} conversa${unreadCount !== 1 ? 's' : ''} ainda não processada${unreadCount !== 1 ? 's' : ''}.`
            : 'Tudo processado.'}
        </p>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-sm font-medium px-4 py-2 rounded-full bg-emerald-700/80 text-white hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0"
        >
          {refreshing ? 'Processando…' : '🔄 Atualizar'}
        </button>
      </div>

      {status && <p className="text-xs text-emerald-400/90 mb-3">{status}</p>}

      {error && (
        <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">Carregando…</div>
      ) : inbox.length === 0 ? (
        <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">
          Nada pendente agora — inbox zerada. 🎉
        </div>
      ) : (
        <div className="space-y-3">
          {inbox.map((row) => <InboxCard key={row.id} row={row} onChanged={load} />)}
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
  const [tipo, setTipo] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (numberId)     params.set('numberId', numberId);
    if (temperature)  params.set('temperature', temperature);
    if (status)       params.set('status', status);
    if (tipo)         params.set('tipo', tipo);
    if (q.trim())     params.set('q', q.trim());
    setLoading(true);
    api.get<{ conversations: ConversationListItem[] }>(`/copiloto/conversations?${params.toString()}`)
      .then((res) => { setConversations(res.conversations); setError(null); })
      .catch((e: any) => {
        if (e?.moduleRequired) onNotEntitled();
        else setError(e?.message || 'Não foi possível carregar as conversas.');
      })
      .finally(() => setLoading(false));
  }, [numberId, temperature, status, tipo, q, onNotEntitled]);

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
        <select
          value={tipo} onChange={(e) => setTipo(e.target.value)}
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
        >
          <option value="">Todo tipo</option>
          <option value="comercial">💼 Comercial</option>
          <option value="pessoal">👋 Pessoal</option>
          <option value="admin">🧾 Admin</option>
          <option value="crise">🆘 Crise</option>
          <option value="oportunidade">🌱 Oportunidade</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">Carregando conversas…</div>
      ) : conversations.length === 0 ? (
        <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">
          Nenhuma conversa {temperature || status || tipo || q ? 'bate com esse filtro' : 'ainda — assim que o Copiloto avaliar uma conversa, ela aparece aqui'}.
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
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] flex-wrap">
                      <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-emerald-400">
                        {TIPO_LABEL[c.latestBriefing.tipo ?? 'comercial'] || c.latestBriefing.tipo}
                      </span>
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

function GruposTab({ numberId, onNotEntitled }: { numberId: string; onNotEntitled: () => void }) {
  const [groups, setGroups] = useState<CopilotoGroupRow[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyJid, setBusyJid] = useState<string | null>(null);

  const [digestHour, setDigestHour] = useState(20);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [savingHour, setSavingHour] = useState(false);
  const [hourSaved, setHourSaved] = useState(false);

  const [digests, setDigests] = useState<CopilotoGroupDigestRow[]>([]);
  const [loadingDigests, setLoadingDigests] = useState(false);

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

  useEffect(() => {
    if (!numberId) return;
    api.get<{ groupDigestHour: number; groupDigestFrequency: 'daily' | 'weekly' }>(`/copiloto/numbers/${numberId}/config`)
      .then((res) => { setDigestHour(res.groupDigestHour); setFrequency(res.groupDigestFrequency ?? 'daily'); })
      .catch(() => null);
  }, [numberId]);

  useEffect(() => {
    if (!numberId) return;
    setLoadingDigests(true);
    api.get<{ digests: CopilotoGroupDigestRow[] }>(`/copiloto/numbers/${numberId}/digests`)
      .then((res) => setDigests(res.digests.filter((d) => d.summaryMd)))
      .catch(() => null)
      .finally(() => setLoadingDigests(false));
  }, [numberId]);

  async function saveDigestHour(hour: number) {
    setDigestHour(hour);
    setSavingHour(true);
    setHourSaved(false);
    try {
      await api.put(`/copiloto/numbers/${numberId}/config`, { groupDigestHour: hour });
      setHourSaved(true);
      setTimeout(() => setHourSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar o horário.');
    } finally {
      setSavingHour(false);
    }
  }

  async function saveFrequency(freq: 'daily' | 'weekly') {
    setFrequency(freq);
    setSavingHour(true);
    setHourSaved(false);
    try {
      await api.put(`/copiloto/numbers/${numberId}/config`, { groupDigestFrequency: freq });
      setHourSaved(true);
      setTimeout(() => setHourSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar a frequência.');
    } finally {
      setSavingHour(false);
    }
  }

  // Tendência (Função 2): agrega os últimos 7 resumos com conteúdo — grupo
  // mais falado da semana e grupos sem nenhuma decisão/pendência (candidatos a
  // "vale a pena continuar acompanhando esse grupo?"). Só usa dado que já veio
  // no fetch dos digests — sem rota nova.
  const trend = useMemo(() => {
    const recent = digests.slice(0, 7).flatMap((d) => d.blocksJson ?? []);
    if (recent.length === 0) return null;

    const byGroup = new Map<string, { messages: number; hadContent: boolean }>();
    for (const b of recent) {
      const cur = byGroup.get(b.grupo) ?? { messages: 0, hadContent: false };
      cur.messages += b.messageCount;
      if (b.decidido || b.pendente) cur.hadContent = true;
      byGroup.set(b.grupo, cur);
    }

    const ranked = [...byGroup.entries()].sort((a, b) => b[1].messages - a[1].messages);
    const busiest = ranked[0];
    const quiet = ranked.filter(([, v]) => !v.hadContent).map(([name]) => name);

    return { busiest: busiest ? { name: busiest[0], messages: busiest[1].messages } : null, quiet };
  }, [digests]);

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

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-medium text-neutral-200">Frequência e horário do resumo</div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Diário ou semanal, a partir de que horário pode sair — chega no seu próprio WhatsApp
            (&ldquo;Mensagens para você mesmo&rdquo;), no mesmo número conectado.
          </p>
        </div>
        <select
          value={frequency}
          disabled={savingHour}
          onChange={(e) => saveFrequency(e.target.value as 'daily' | 'weekly')}
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="daily">Todo dia</option>
          <option value="weekly">Toda segunda (semanal)</option>
        </select>
        <select
          value={digestHour}
          disabled={savingHour}
          onChange={(e) => saveDigestHour(parseInt(e.target.value, 10))}
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm disabled:opacity-50"
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
          ))}
        </select>
        {hourSaved && <span className="text-xs text-emerald-400">✓ Salvo</span>}
      </div>

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

      {trend && (trend.busiest || trend.quiet.length > 0) && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 mb-5 text-sm space-y-1.5">
          <div className="text-xs font-semibold text-neutral-400 mb-1">Tendência (últimos resumos)</div>
          {trend.busiest && (
            <p className="text-neutral-300">
              📈 Grupo mais falado: <strong className="text-neutral-100">{trend.busiest.name}</strong> ({trend.busiest.messages} msgs)
            </p>
          )}
          {trend.quiet.length > 0 && (
            <p className="text-neutral-400">
              💤 Sem nada pra decidir há um tempo: {trend.quiet.join(', ')}
            </p>
          )}
        </div>
      )}

      <h2 className="text-sm font-bold text-neutral-300 mb-3 mt-7">Resumos entregues</h2>
      {loadingDigests ? (
        <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">Carregando resumos...</div>
      ) : digests.length === 0 ? (
        <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">
          Nenhum resumo ainda — chega aqui e no seu self-chat assim que sair o primeiro, no horário configurado acima.
        </div>
      ) : (
        <div className="space-y-3">
          {digests.map((d) => (
            <div key={d.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-neutral-300">
                  {new Date(`${d.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                <span className="text-[11px] text-neutral-500">
                  {d.groupsIncluded} grupo{d.groupsIncluded !== 1 ? 's' : ''} com conversa
                </span>
              </div>
              <p className="text-sm text-neutral-300 whitespace-pre-wrap">{d.summaryMd}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-2xl font-bold text-neutral-100">{value}</p>
      <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-neutral-600 mt-1">{hint}</p>}
    </div>
  );
}

function MetricasTab({ numberId, onNotEntitled }: { numberId: string; onNotEntitled: () => void }) {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<CopilotoMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (numberId) params.set('numberId', numberId);
    params.set('days', String(days));
    setLoading(true);
    api.get<CopilotoMetrics>(`/copiloto/metrics?${params.toString()}`)
      .then((res) => { setMetrics(res); setError(null); })
      .catch((e: any) => {
        if (e?.moduleRequired) onNotEntitled();
        else setError(e?.message || 'Não foi possível carregar as métricas.');
      })
      .finally(() => setLoading(false));
  }, [numberId, days, onNotEntitled]);

  useEffect(() => { load(); }, [load]);

  if (loading && !metrics) {
    return <div className="text-sm text-neutral-600 text-center py-10 rounded-xl border border-neutral-800">Carregando métricas…</div>;
  }
  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>;
  }
  if (!metrics) return null;

  const { snapshot, activity } = metrics;
  const totalTipo = activity.byTipo.reduce((s, t) => s + t.count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-neutral-500">
          Atividade dos últimos <strong className="text-neutral-300">{days} dias</strong> — o estado das conversas (não lidas/lidas/contatos) é sempre o de agora.
        </p>
        <select
          value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs"
        >
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </div>

      <p className="text-xs font-medium text-neutral-400 mb-2">Conversas agora</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Contatos" value={snapshot.totalContacts} hint="conversas que já trocaram mensagem" />
        <StatCard label="Não lidas" value={snapshot.unreadConversations} hint="ainda não viraram briefing" />
        <StatCard label="Lidas" value={snapshot.readConversations} hint="em dia com o Copiloto" />
      </div>

      <p className="text-xs font-medium text-neutral-400 mb-2">Atividade no período</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Mensagens recebidas" value={activity.messagesIn} />
        <StatCard label="Mensagens enviadas" value={activity.messagesOut} hint="por você, via Copiloto ou não" />
        <StatCard label="Briefings gerados" value={activity.briefingsGenerated} />
        <StatCard label="Sugestões enviadas" value={activity.suggestionsSent} hint="você escolheu 1, 2 ou 3" />
        <StatCard label="Clientes que responderam" value={activity.customerReplies} hint="depois de uma sugestão sua" />
        <StatCard label="Tarefas criadas" value={activity.tasksCreated} hint="compromisso assumido numa sugestão" />
      </div>

      {activity.byTipo.length > 0 && (
        <>
          <p className="text-xs font-medium text-neutral-400 mb-2">Briefings por tipo</p>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-2">
            {activity.byTipo.map((t) => (
              <div key={t.tipo} className="flex items-center gap-2">
                <span className="text-xs w-28 flex-shrink-0 text-neutral-300">{TIPO_LABEL[t.tipo] || t.tipo}</span>
                <div className="flex-1 h-2 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600"
                    style={{ width: `${totalTipo > 0 ? Math.round((t.count / totalTipo) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-xs text-neutral-500 w-8 text-right flex-shrink-0">{t.count}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {activity.briefingsDismissed > 0 && (
        <p className="text-[11px] text-neutral-600 mt-4">
          {activity.briefingsDismissed} briefing{activity.briefingsDismissed !== 1 ? 's' : ''} descartado{activity.briefingsDismissed !== 1 ? 's' : ''} no período — descarte com &ldquo;e avisar&rdquo; ajuda a calibrar a triagem.
        </p>
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
  const [tab, setTab] = useState<'inbox' | 'conversas' | 'grupos' | 'metricas'>('inbox');
  const [usage, setUsage] = useState<{ calls: number } | null>(null);

  useEffect(() => {
    api.get<WNumber[]>('/numbers')
      .then((nums) => {
        const connected = nums.filter((n) => n.status === 'connected');
        setNumbers(connected);
        if (connected.length > 0) setNumberId(connected[0].id);
      })
      .catch(() => null)
      .finally(() => setLoadingNumbers(false));

    // Custo de IA do mês — só informativo, não bloqueia nada.
    api.get<{ calls: number }>('/copiloto/usage').then(setUsage).catch(() => null);
  }, []);

  const onNotEntitled = useCallback(() => setNotEntitled(true), []);

  if (loadingNumbers) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl">
        <div className="text-neutral-500 text-sm">Carregando...</div>
      </div>
    );
  }

  if (notEntitled) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl">
        <div className="max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <div className="text-4xl mb-4">🎯</div>
          <h1 className="text-xl font-bold mb-2 text-neutral-100">Copiloto</h1>
          <p className="text-neutral-400">
            Lê suas conversas, resume pra você e sugere 3 ações — liberado usuário a usuário, não vendido. Fale com o suporte se quiser entrar no MVP.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl text-neutral-100">
      <h1 className="text-lg font-bold flex items-center gap-2 mb-1">🎯 Copiloto</h1>
      <p className="text-xs text-neutral-500 mb-4">
        {usage && usage.calls > 0 ? `${usage.calls} chamada${usage.calls !== 1 ? 's' : ''} de IA este mês` : ' '}
      </p>

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
        {(['inbox', 'conversas', 'metricas', 'grupos'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t === 'inbox' ? 'Inbox' : t === 'conversas' ? 'Conversas' : t === 'metricas' ? 'Métricas' : 'Grupos'}
          </button>
        ))}
      </div>

      {tab === 'inbox'
        ? <InboxTab numberId={numberId} onNotEntitled={onNotEntitled} />
        : tab === 'conversas'
        ? <ConversasTab numbers={numbers} numberId={numberId} onNotEntitled={onNotEntitled} />
        : tab === 'metricas'
        ? <MetricasTab numberId={numberId} onNotEntitled={onNotEntitled} />
        : <GruposTab numberId={numberId} onNotEntitled={onNotEntitled} />}
    </div>
  );
}
