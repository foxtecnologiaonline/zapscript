'use client';
import React, { useState, useCallback, useEffect } from 'react';

/* ── Tipos ─────────────────────────────────────────────── */
export type Tab = 'dashboard' | 'metas' | 'suporte' | 'monitoramento' | 'comunicacao' | 'usuarios' | 'financeiro' | 'afiliados';

/* ── Constantes ────────────────────────────────────────── */
const API  = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PAGE = 20;

/* ── Formatadores ──────────────────────────────────────── */
const brl     = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt     = (d: string) => new Date(d).toLocaleDateString('pt-BR');
const fmtFull = (d: string) => new Date(d).toLocaleString('pt-BR');
const fmtMin  = (m: number) => `${m.toFixed(1)} min`;

/* ── Estilos por plano / status ─────────────────────────── */
const PLAN_CLS: Record<string, string> = {
  free:         'text-gray-400 bg-gray-400/10 border-gray-400/20',
  pro:          'text-teal-400 bg-teal-400/10 border-teal-400/20',
  ultra:        'text-purple-400 bg-purple-400/10 border-purple-400/20',
  executive:    'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'pro-tester': 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
};
const STATUS_CLS: Record<string, string> = {
  active:      'text-green-400 bg-green-400/10 border-green-400/20',
  pending:     'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  canceled:    'text-red-400 bg-red-400/10 border-red-400/20',
  past_due:    'text-orange-400 bg-orange-400/10 border-orange-400/20',
  open:        'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  in_progress: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  closed:      'text-gray-400 bg-gray-400/10 border-gray-400/20',
  connected:   'text-green-400 bg-green-400/10 border-green-400/20',
  disconnected:'text-red-400 bg-red-400/10 border-red-400/20',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo', pending: 'Pendente', canceled: 'Cancelado', past_due: 'Atrasado',
  open: 'Aberto', in_progress: 'Em andamento', closed: 'Fechado',
  connected: 'Conectado', disconnected: 'Desconectado',
};

/* ── Helpers ───────────────────────────────────────────── */
function maskEmail(email: string): string {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const masked = local.length > 2 ? local[0] + '•'.repeat(Math.min(local.length - 2, 4)) + local[local.length - 1] : local[0] + '•';
  return `${masked}@${domain}`;
}

function maskTesterName(name: string, code: string): string {
  if (!name) return code?.slice(0, 8) || '—';
  return `${name[0].toUpperCase()}. ···${code?.slice(-6) || ''}`;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 6) return '••••••';
  return clean.slice(0, 2) + '•'.repeat(Math.max(0, clean.length - 6)) + clean.slice(-4);
}

/* ── Tipos das props ───────────────────────────────────── */
interface DashCtx {
  stats: any;
  tab: Tab;
  growth: number;
  loading: boolean;
  subLoading: boolean;
  users: any[];
  userTotal: number;
  userSearch: string;
  userOffset: number;
  tickets: any[];
  ticketTotal: number;
  ticketStatus: string;
  ticketOffset: number;
  detailId: string | null;
  invites: any[];
  inviteTotal: number;
  inviteName: string;
  invitePhone: string;
  inviteLoading: boolean;
  lastInviteResult: {
    link: string; message: string; whatsappSent: boolean;
    whatsappChannel?: string; whatsappError?: string;
  } | null;
  creatingPlan: boolean;
  syncingPlans: boolean;
  toast: { text: string; type: 'ok' | 'err' | 'warn' } | null;
  token: string;
}

interface DashFn {
  refreshStats: () => void;
  goTab: (t: Tab) => void;
  setTab: (t: Tab) => void;
  setUserSearch: (s: string) => void;
  setUserOffset: (o: number) => void;
  loadUsers: (search: string, offset: number) => void;
  setTicketStatus: (s: string) => void;
  setTicketOffset: (o: number) => void;
  loadTickets: (status: string, offset: number) => void;
  updateTicketStatus: (id: string, status: string) => void;
  loadInvites: () => void;
  deleteInvite: (id: string, name: string) => void;
  createInvite: (e: React.FormEvent) => void;
  createProTesterPlan: () => void;
  syncPlans: () => void;
  setDetailId: (id: string | null) => void;
  setInviteName: (s: string) => void;
  setInvitePhone: (s: string) => void;
  notify: (text: string, type?: 'ok' | 'err' | 'warn') => void;
  setToast: (t: any) => void;
  setLastInviteResult: (r: any) => void;
}

/* ══════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL DO PAINEL
══════════════════════════════════════════════════════════ */

/* ── TicketSupportSection — seção Suporte completa ─────────────── */
function TicketSupportSection({
  tickets, ticketTotal, ticketStatus, ticketOffset, subLoading, token,
  onStatusChange, onFilterChange, onPage, notify,
}: {
  tickets: any[]; ticketTotal: number; ticketStatus: string; ticketOffset: number;
  subLoading: boolean; token: string;
  onStatusChange: (id: string, s: string) => void;
  onFilterChange: (s: string) => void;
  onPage: (o: number) => void;
  notify: (t: string, type?: 'ok' | 'err' | 'warn') => void;
}) {
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  async function sendReply(ticketId: string, closeAfter: boolean) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/tickets/${ticketId}/reply`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ message: replyText.trim(), close: closeAfter }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao enviar resposta');
      notify(`✅ Resposta enviada por e-mail${closeAfter ? ' · Ticket fechado' : ''}`, 'ok');
      setReplyId(null);
      setReplyText('');
      onStatusChange(ticketId, closeAfter ? 'closed' : 'in_progress');
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally {
      setReplyLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {([['', 'Todos'], ['open', 'Abertos'], ['in_progress', 'Em andamento'], ['closed', 'Fechados']] as [string, string][]).map(([v, label]) => (
          <button key={v}
            onClick={() => onFilterChange(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
              ticketStatus === v
                ? 'bg-[rgba(16,185,129,.12)] text-[#10b981] border-[rgba(16,185,129,.2)]'
                : 'border-transparent text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] flex items-center justify-between">
          <span className="text-xs font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide">
            {ticketTotal} ticket(s) de suporte
          </span>
          <span className="text-[10px] text-[rgba(16,185,129,.3)]">Clique em "Responder" para enviar e-mail ao usuário</span>
        </div>
        {subLoading ? (
          <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">✅ Nenhum ticket encontrado</div>
        ) : tickets.map((t: any) => (
          <div key={t.id} className="border-b border-[rgba(16,185,129,.05)] last:border-0">
            <div className="px-5 py-4 hover:bg-[rgba(16,185,129,.02)]">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[#d1fae5]">{t.name}</span>
                  <span className="text-xs text-[rgba(16,185,129,.5)]">{maskEmail(t.email)}</span>
                  <Badge label={t.category} cls="text-blue-400 bg-blue-400/10 border-blue-400/20" />
                  <Badge label={STATUS_LABEL[t.status] || t.status} cls={STATUS_CLS[t.status]} />
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[10px] text-[rgba(16,185,129,.3)]">{fmtFull(t.createdAt)}</span>
                  {t.status !== 'closed' && (
                    <>
                      <Btn variant="ghost" onClick={() => { setReplyId(replyId === t.id ? null : t.id); setReplyText(''); }}>
                        {replyId === t.id ? '✕' : '✉ Responder'}
                      </Btn>
                      <Btn variant="ghost" onClick={() => onStatusChange(t.id, t.status === 'open' ? 'in_progress' : 'closed')}>
                        {t.status === 'open' ? '▶ Atender' : '✓ Fechar'}
                      </Btn>
                    </>
                  )}
                </div>
              </div>
              <p className="text-sm text-[rgba(16,185,129,.6)] line-clamp-3">{t.description}</p>
            </div>
            {/* Inline reply form */}
            {replyId === t.id && (
              <div className="px-5 pb-4 bg-[rgba(16,185,129,.025)] border-t border-[rgba(16,185,129,.08)]">
                <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-2 pt-3">
                  ✉️ Resposta por e-mail → {t.email}
                </div>
                <textarea
                  rows={4}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Olá! Obrigado por entrar em contato..."
                  className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)] resize-none mb-2"
                />
                <div className="flex gap-2">
                  <Btn variant="primary" disabled={replyLoading || !replyText.trim()}
                    onClick={() => sendReply(t.id, true)} cls="flex-1 justify-center text-xs py-1.5">
                    {replyLoading ? '⟳ Enviando...' : '📧 Enviar e fechar ticket'}
                  </Btn>
                  <Btn variant="ghost" disabled={replyLoading || !replyText.trim()}
                    onClick={() => sendReply(t.id, false)} cls="flex-1 justify-center text-xs py-1.5">
                    📤 Enviar e manter aberto
                  </Btn>
                  <Btn variant="ghost" disabled={replyLoading}
                    onClick={() => { setReplyId(null); setReplyText(''); }} cls="text-xs py-1.5">
                    Cancelar
                  </Btn>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Pagination offset={ticketOffset} total={ticketTotal} loading={subLoading} onPage={onPage} />
    </div>
  );
}

/* ── PlanosPanel — gerenciar configuração dos planos ────────────── */
function PlanosPanel({ apiBase, token, notify }: { apiBase: string; token: string; notify: (t: string, type?: 'ok'|'err'|'warn') => void }) {
  const [plans,       setPlans]       = useState<any[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<any>(null);
  const [editing,     setEditing]     = useState<string | null>(null);  // planId em edição
  const [editData,    setEditData]    = useState<any>({});
  const [saving,      setSaving]      = useState(false);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  async function loadPlans() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/plans`, { headers: h });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao carregar planos');
      setPlans(Array.isArray(d) ? d : []);
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setLoading(false); }
  }

  async function applyLimits() {
    if (!confirm('Recalibrar minutos disponíveis de TODOS os usuários ativos com base nos limites atuais dos planos?\n\nOperação segura e idempotente.')) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/sync-plans`, { method: 'POST', headers: h });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      setSyncResult(d);
      notify(`✅ ${d.message}`, 'ok');
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setSyncing(false); }
  }

  function startEdit(plan: any) {
    setEditing(plan.id);
    setEditData({
      label:           plan.label,
      minutesPerMonth: plan.minutesPerMonth,
      maxNumbers:      plan.maxNumbers,
      priceBrl:        plan.priceBrl,
      features:        Array.isArray(plan.features) ? plan.features.join('\n') : '',
    });
  }

  async function savePlan(id: string) {
    setSaving(true);
    try {
      const features = editData.features
        .split('\n')
        .map((f: string) => f.trim())
        .filter(Boolean);
      const body = {
        label:           editData.label,
        minutesPerMonth: Number(editData.minutesPerMonth),
        maxNumbers:      Number(editData.maxNumbers),
        priceBrl:        Number(editData.priceBrl),
        features,
      };
      const res = await fetch(`${apiBase}/sys/g5r8t2/plans/${id}`, {
        method:  'PATCH',
        headers: h,
        body:    JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao salvar');
      setPlans(prev => prev.map(p => p.id === id ? d : p));
      setEditing(null);
      notify('✅ Plano atualizado! Clique em "Aplicar limites" para sincronizar os usuários.', 'ok');
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setSaving(false); }
  }

  const PLAN_COLOR: Record<string, string> = {
    free: 'text-gray-400', pro: 'text-teal-400', ultra: 'text-purple-400',
    executive: 'text-amber-400', 'pro-tester': 'text-emerald-300',
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-bold text-[#d1fae5]">📋 Gerenciar Planos</div>
          <div className="text-xs text-[rgba(16,185,129,.4)] mt-0.5">
            Edite configurações e aplique os limites atuais a todos os usuários ativos
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadPlans} disabled={loading}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] hover:bg-[rgba(16,185,129,.18)] disabled:opacity-50 transition-colors">
            {loading ? '⟳ Carregando...' : plans.length ? '🔄 Recarregar' : '📂 Carregar planos'}
          </button>
          {plans.length > 0 && (
            <button onClick={applyLimits} disabled={syncing}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50 transition-colors">
              {syncing ? '⟳ Aplicando...' : '⚡ Aplicar limites a todos os usuários'}
            </button>
          )}
        </div>
      </div>

      {/* Resultado do sync */}
      {syncResult && (
        <div className={`rounded-xl p-4 border text-xs ${syncResult.ok ? 'bg-[rgba(16,185,129,.06)] border-[rgba(16,185,129,.2)]' : 'bg-yellow-900/10 border-yellow-400/20'}`}>
          <div className="font-bold text-[#10b981] mb-2">{syncResult.message}</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-[#132621] rounded-lg p-2 text-center">
              <div className="text-lg font-black text-teal-400">{syncResult.created ?? 0}</div>
              <div className="text-[9px] text-[rgba(16,185,129,.4)]">Criados</div>
            </div>
            <div className="bg-[#132621] rounded-lg p-2 text-center">
              <div className="text-lg font-black text-[#10b981]">{syncResult.updated ?? 0}</div>
              <div className="text-[9px] text-[rgba(16,185,129,.4)]">Recalibrados</div>
            </div>
            <div className="bg-[#132621] rounded-lg p-2 text-center">
              <div className="text-lg font-black text-[#d1fae5]">{syncResult.total ?? 0}</div>
              <div className="text-[9px] text-[rgba(16,185,129,.4)]">Total</div>
            </div>
          </div>
          {syncResult.errors?.length > 0 && (
            <details>
              <summary className="text-[10px] text-red-400 cursor-pointer">{syncResult.errors.length} erro(s) ↓</summary>
              <div className="mt-2 space-y-1 max-h-28 overflow-auto">
                {syncResult.errors.map((e: string, i: number) => (
                  <div key={i} className="text-[10px] text-red-300/70 bg-red-900/10 rounded px-2 py-1">{e}</div>
                ))}
              </div>
            </details>
          )}
          <button onClick={() => setSyncResult(null)} className="text-[10px] text-[rgba(16,185,129,.3)] hover:text-[rgba(16,185,129,.6)] mt-2 block">Fechar</button>
        </div>
      )}

      {/* Lista de planos */}
      {plans.length === 0 && !loading && (
        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.1)] rounded-xl p-10 text-center text-xs text-[rgba(16,185,129,.3)]">
          Clique em "Carregar planos" para ver os planos atuais do banco.
        </div>
      )}

      <div className="space-y-4">
        {plans.map(plan => (
          <div key={plan.id} className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[rgba(16,185,129,.08)] flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={`text-base font-black ${PLAN_COLOR[plan.name] || 'text-gray-400'}`}>{plan.label}</span>
                <span className="text-[10px] font-mono text-[rgba(16,185,129,.35)] bg-[rgba(16,185,129,.06)] border border-[rgba(16,185,129,.1)] px-2 py-0.5 rounded">{plan.name}</span>
              </div>
              {editing === plan.id ? (
                <div className="flex gap-2">
                  <button onClick={() => savePlan(plan.id)} disabled={saving}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#10b981] text-[#011a12] hover:bg-[#34d399] disabled:opacity-50 transition-colors">
                    {saving ? '⟳' : '✓ Salvar'}
                  </button>
                  <button onClick={() => setEditing(null)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[rgba(16,185,129,.6)] hover:text-[#10b981] transition-colors">
                    ✕ Cancelar
                  </button>
                </div>
              ) : (
                <button onClick={() => startEdit(plan)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[#10b981] hover:bg-[rgba(16,185,129,.16)] transition-colors">
                  ✏️ Editar
                </button>
              )}
            </div>

            {editing === plan.id ? (
              <div className="px-5 py-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Label (exibível)</label>
                  <input value={editData.label} onChange={e => setEditData((p: any) => ({ ...p, label: e.target.value }))}
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)]" />
                </div>
                <div>
                  <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Minutos/mês</label>
                  <input type="number" value={editData.minutesPerMonth} onChange={e => setEditData((p: any) => ({ ...p, minutesPerMonth: e.target.value }))}
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)]" />
                </div>
                <div>
                  <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Preço (R$)</label>
                  <input type="number" step="0.01" value={editData.priceBrl} onChange={e => setEditData((p: any) => ({ ...p, priceBrl: e.target.value }))}
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)]" />
                </div>
                <div>
                  <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Máx. números</label>
                  <input type="number" value={editData.maxNumbers} onChange={e => setEditData((p: any) => ({ ...p, maxNumbers: e.target.value }))}
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">
                    Features (uma por linha)
                  </label>
                  <textarea rows={5} value={editData.features} onChange={e => setEditData((p: any) => ({ ...p, features: e.target.value }))}
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-xs text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] font-mono resize-none" />
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Minutos/mês</div>
                  <div className="text-xl font-black text-[#10b981]">{plan.minutesPerMonth}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Preço</div>
                  <div className="text-xl font-black text-[#d1fae5]">
                    {plan.priceBrl === 0 ? 'Grátis' : `R$ ${Number(plan.priceBrl).toFixed(2).replace('.', ',')}`}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Máx. números</div>
                  <div className="text-xl font-black text-[#d1fae5]">{plan.maxNumbers}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1">Features</div>
                  <div className="text-sm font-bold text-[#d1fae5]">{Array.isArray(plan.features) ? plan.features.length : 0} itens</div>
                </div>
                {Array.isArray(plan.features) && plan.features.length > 0 && (
                  <div className="col-span-2 sm:col-span-4">
                    <div className="flex flex-wrap gap-1.5">
                      {(plan.features as string[]).map((f, i) => (
                        <span key={i} className="text-[10px] bg-[#132621] border border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.7)] rounded-full px-2 py-0.5">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── TesterUpgradePanel — lista e upgrade executivo ─────────────── */
const ADMIN_API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

function TesterUpgradePanel({ token, notify }: { token: string; notify: (t: string, type?: 'ok'|'err'|'warn') => void }) {
  const [list,              setList]              = useState<any[]>([]);
  const [loaded,            setLoaded]            = useState(false);
  const [loading,           setLoading]           = useState(false);
  const [upgrading,         setUpgrading]         = useState(false);
  const [upgradingPT,       setUpgradingPT]       = useState(false);
  const [downgradingPro,    setDowngradingPro]    = useState(false);
  const [result,            setResult]            = useState<any>(null);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  async function loadTesters() {
    setLoading(true);
    try {
      const res = await fetch(`${ADMIN_API}/sys/g5r8t2/testers`, { headers: h });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao carregar testers');
      setList(d.testers || []);
      setLoaded(true);
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  async function upgradeAll() {
    if (!confirm(`Confirma upgrade de ${list.length} tester(s) para o plano Executive?`)) return;
    setUpgrading(true);
    setResult(null);
    try {
      const res = await fetch(`${ADMIN_API}/sys/g5r8t2/testers/upgrade-executive`, { method: 'POST', headers: h });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro no upgrade');
      setResult(d);
      notify(`✅ ${d.upgraded} tester(s) migrado(s) para Executive!`, 'ok');
      loadTesters();
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally {
      setUpgrading(false);
    }
  }

  async function downgradeToProPlan() {
    const elegivel = list.filter(t => t.planName !== 'pro');
    if (!confirm(`Reverter ${elegivel.length} tester(s) para o plano Pro?\n\nEssa ação reduz minutos e limites de todos exceto quem já é Pro.`)) return;
    setDowngradingPro(true);
    setResult(null);
    try {
      const res = await fetch(`${ADMIN_API}/sys/g5r8t2/testers/downgrade-pro`, { method: 'POST', headers: h });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro no downgrade');
      setResult(d);
      notify(`↩️ ${d.downgraded} tester(s) revertido(s) para Pro!`, 'ok');
      loadTesters();
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally {
      setDowngradingPro(false);
    }
  }

  async function upgradeProTester() {
    const elegivel = list.filter(t => t.planName !== 'executive' && t.planName !== 'pro-tester');
    if (!confirm(`Migrar ${elegivel.length} tester(s) para Pro-Tester (150 min, 2 números, todas as features)?\n\nTesters já em Executive não serão alterados.`)) return;
    setUpgradingPT(true);
    setResult(null);
    try {
      const res = await fetch(`${ADMIN_API}/sys/g5r8t2/testers/upgrade-pro-tester`, { method: 'POST', headers: h });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro no upgrade');
      setResult(d);
      notify(`✅ ${d.upgraded} tester(s) migrado(s) para Pro-Tester!`, 'ok');
      loadTesters();
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally {
      setUpgradingPT(false);
    }
  }

  const PLAN_COLOR: Record<string, string> = {
    executive:    'text-amber-400',
    ultra:        'text-purple-400',
    pro:          'text-teal-400',
    'pro-tester': 'text-emerald-300',
    free:         'text-gray-400',
  };

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-xl p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="text-sm font-bold text-[#d1fae5]">👥 Base de Testers</div>
          <div className="text-xs text-[rgba(16,185,129,.4)] mt-0.5">Visualize e libere acesso Executive para todos os testers</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadTesters}
            disabled={loading}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] hover:bg-[rgba(16,185,129,.18)] transition-colors disabled:opacity-50"
          >
            {loading ? '⟳ Carregando...' : loaded ? '🔄 Recarregar' : '🔍 Carregar testers'}
          </button>
          {loaded && list.length > 0 && (
            <>
              <button
                onClick={downgradeToProPlan}
                disabled={downgradingPro || upgradingPT || upgrading}
                className="text-xs font-bold px-4 py-2 rounded-lg bg-teal-500/20 border border-teal-500/30 text-teal-300 hover:bg-teal-500/30 transition-colors disabled:opacity-50"
              >
                {downgradingPro ? '⟳ Revertendo...' : `↩️ Pro · ${list.filter(t => t.planName !== 'pro').length} elegíveis`}
              </button>
              <button
                onClick={upgradeProTester}
                disabled={upgradingPT || upgrading || downgradingPro}
                className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
              >
                {upgradingPT ? '⟳ Migrando...' : `🧪 Pro-Tester · 150min (${list.filter(t => t.planName !== 'executive' && t.planName !== 'pro-tester').length})`}
              </button>
              <button
                onClick={upgradeAll}
                disabled={upgrading || upgradingPT || downgradingPro}
                className="text-xs font-bold px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {upgrading ? '⟳ Atualizando...' : `⭐ Executive · 500min (${list.filter(t => t.planName !== 'executive').length})`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Resultado do upgrade */}
      {result && (
        <div className="mb-4 p-3 rounded-lg bg-[rgba(16,185,129,.06)] border border-[rgba(16,185,129,.2)] text-xs">
          <div className="font-bold text-[#10b981] mb-1">Resultado: {result.upgraded} migrado(s) · {result.skipped} ignorado(s)</div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {result.results?.map((r: any, i: number) => (
              <div key={i} className={`font-mono ${r.action.includes('skipped') ? 'text-[rgba(16,185,129,.4)]' : 'text-[#6ee7b7]'}`}>
                {r.action.includes('skipped') ? '✓' : '↑'} {r.email} — {r.from} → {r.to} {r.action.includes('skipped') ? '(já executive)' : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de testers */}
      {loaded && (
        list.length === 0 ? (
          <div className="text-center text-xs text-[rgba(16,185,129,.3)] py-8">Nenhum tester encontrado na base.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[rgba(16,185,129,.08)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[rgba(16,185,129,.08)]">
                  {['#', 'Nome', 'E-mail', 'Plano atual', 'Minutos', 'Números', 'Tester desde'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[rgba(16,185,129,.4)] font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((t, i) => (
                  <tr key={t.id} className="border-b border-[rgba(16,185,129,.05)] hover:bg-[rgba(16,185,129,.03)] transition-colors">
                    <td className="px-3 py-2.5 text-[rgba(16,185,129,.3)]">{i + 1}</td>
                    <td className="px-3 py-2.5 text-[#d1fae5] font-medium">{t.name || '—'}</td>
                    <td className="px-3 py-2.5 text-[rgba(16,185,129,.6)] font-mono">{t.email}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-bold ${PLAN_COLOR[t.planName] || 'text-gray-400'}`}>
                        {t.planLabel}
                        {t.planName === 'executive' && ' ✓'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[rgba(16,185,129,.6)]">{t.minutesAvail.toFixed(1)} min</td>
                    <td className="px-3 py-2.5 text-[rgba(16,185,129,.6)]">{t.numbersConnected} conectado(s)</td>
                    <td className="px-3 py-2.5 text-[rgba(16,185,129,.4)]">
                      {t.testerSince ? new Date(t.testerSince).toLocaleDateString('pt-BR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

export default function AdminDashboard({ ctx, fn }: { ctx: DashCtx; fn: DashFn }) {
  const {
    stats, tab, growth, loading, subLoading, users, userTotal, userSearch, userOffset,
    tickets, ticketTotal, ticketStatus, ticketOffset, detailId, invites, inviteTotal,
    inviteName, invitePhone, inviteLoading, lastInviteResult, creatingPlan, syncingPlans, toast, token,
  } = ctx;
  const {
    refreshStats, goTab, setTab, setUserSearch, setUserOffset, loadUsers,
    setTicketStatus, setTicketOffset, loadTickets, updateTicketStatus, loadInvites,
    deleteInvite, createInvite, createProTesterPlan, syncPlans, setDetailId, setInviteName,
    setInvitePhone, notify, setToast, setLastInviteResult,
  } = fn;

  // ── Bulk selection state (local) ────────────────────────
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction]       = useState('add-minutes');
  const [bulkValue,  setBulkValue]        = useState('');
  const [bulkLoading, setBulkLoading]     = useState(false);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  function toggleSelect(id: string) {
    setSelectedUsers(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map((u: any) => u.id)));
    }
  }

  async function executeBulkAction() {
    if (selectedUsers.size === 0 || !bulkAction) return;
    if (!confirm(`Aplicar "${bulkAction}" para ${selectedUsers.size} usuário(s)?`)) return;
    setBulkLoading(true);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/users/bulk-action`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ userIds: Array.from(selectedUsers), action: bulkAction, value: bulkValue || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      notify(`✅ ${d.message}`, 'ok');
      setSelectedUsers(new Set());
      loadUsers(userSearch, userOffset);
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setBulkLoading(false); }
  }

  return (
    <div className="min-h-screen bg-[#040b09] p-4 md:p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#d1fae5]">🛡️ Painel Admin</h1>
            <p className="text-[rgba(16,185,129,.5)] text-xs mt-0.5">ZapScript.me</p>
          </div>
          <Btn onClick={refreshStats} disabled={loading}>
            {loading ? '⟳ Atualizando...' : '⟳ Atualizar'}
          </Btn>
        </div>

        {/* Tabs — responsivo mobile */}
        <div className="overflow-x-auto mb-6 -mx-2 px-2">
          <div className="flex gap-1.5 bg-[#0d1c19] border border-[rgba(16,185,129,.08)] rounded-xl p-1.5 w-max min-w-full sm:w-fit sm:min-w-0">
            {([
              ['dashboard',     '📊', 'Dashboard'],
              ['metas',         '🎯', 'Metas'],
              ['suporte',       '🎧', 'Suporte'],
              ['monitoramento', '🖥️', 'Monitoramento'],
              ['comunicacao',   '📣', 'Comunicação'],
              ['usuarios',      '👥', 'Usuários'],
              ['financeiro',    '💰', 'Financeiro'],
              ['afiliados',     '🤝', 'Afiliados'],
            ] as [Tab, string, string][]).map(([t, icon, label]) => (
              <button key={t} onClick={() => goTab(t)}
                className={`whitespace-nowrap px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  tab === t
                    ? 'bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.2)]'
                    : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'
                }`}>
                <span>{icon}</span><span className="hidden sm:inline">{label}</span><span className="sm:hidden">{label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ DASHBOARD — 1 card mais importante de cada aba ═══ */}
        {tab === 'dashboard' && stats && (
          <div className="space-y-5">
            <div className="text-xs text-[rgba(16,185,129,.4)]">Resumo executivo — o indicador-chave de cada área. Clique para abrir.</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {/* 🎯 Metas → novos cadastros no mês */}
              <KpiCard icon="🎯" title="Metas · Cadastros no mês" value={stats.users.month}
                sub={`${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)} vs mês anterior`}
                color={growth >= 0 ? '#10b981' : '#f87171'} onClick={() => goTab('metas')} />
              {/* 🎧 Suporte → tickets abertos */}
              <KpiCard icon="🎧" title="Suporte · Tickets abertos" value={stats.tickets.open}
                sub={`${stats.tickets.total} no total`} color="#fbbf24" onClick={() => goTab('suporte')} />
              {/* 🖥️ Monitoramento → WhatsApp conectados */}
              <KpiCard icon="🖥️" title="Monitoramento · WhatsApp" value={`${stats.whatsapp?.connected || 0}/${stats.whatsapp?.total || 0}`}
                sub="números conectados" color="#60a5fa" onClick={() => goTab('monitoramento')} />
              {/* 📣 Comunicação → transcrições processadas */}
              <KpiCard icon="📣" title="Comunicação · Transcrições" value={stats.transcriptions.total}
                sub={`+${stats.transcriptions.today} hoje`} color="#34d399" onClick={() => goTab('comunicacao')} />
              {/* 👥 Usuários → base total */}
              <KpiCard icon="👥" title="Usuários · Base total" value={stats.users.total}
                sub={`+${stats.users.today} hoje · ${stats.conversion?.testers || 0} tester(s)`} onClick={() => goTab('usuarios')} />
              {/* 💰 Financeiro → MRR */}
              <KpiCard icon="💰" title="Financeiro · MRR" value={brl(stats.mrr || 0)}
                sub={`${stats.conversion?.paid || 0} pagantes · ${(stats.conversion?.rate || 0).toFixed(1)}% conv.`}
                color="#a78bfa" onClick={() => goTab('financeiro')} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Planos */}
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-bold text-[#d1fae5]">Distribuição por Plano</div>
                  <Btn variant="ghost" onClick={syncPlans} disabled={syncingPlans} cls="text-[10px]">
                    {syncingPlans ? '⟳ Sincronizando...' : '🔄 Sincronizar planos'}
                  </Btn>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(stats.byPlan || {}).map(([plan, count]: any) => (
                    <div key={plan} className="bg-[#132621] rounded-xl p-4 text-center">
                      <div className="text-2xl font-black text-[#10b981] mb-2">{count}</div>
                      <Badge label={plan} cls={PLAN_CLS[plan] || PLAN_CLS.free} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Status assinaturas */}
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
                <div className="text-sm font-bold text-[#d1fae5] mb-4">Status das Assinaturas</div>
                <div className="space-y-3">
                  {Object.entries(stats.subscriptions || {}).map(([s, count]: any) => {
                    const total = Object.values(stats.subscriptions || {}).reduce((a: number, b: any) => a + b, 0) as number;
                    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={s}>
                        <div className="flex items-center justify-between mb-1.5">
                          <Badge label={STATUS_LABEL[s] || s} cls={STATUS_CLS[s]} />
                          <span className="text-sm font-bold text-[#d1fae5]">{count} <span className="text-xs text-[rgba(16,185,129,.4)] font-normal">({pct}%)</span></span>
                        </div>
                        <ProgressBar pct={pct} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ METAS — atuais semanais e mensais ═══ */}
        {tab === 'metas' && (
          <MetasTab apiBase={API} token={token} notify={notify} />
        )}

        {/* ═══ USUÁRIOS (lista sintética + seção Testers) ═══ */}
        {tab === 'usuarios' && (
          <div className="space-y-4">
            <form onSubmit={e => { e.preventDefault(); setUserOffset(0); loadUsers(userSearch, 0); }}
              className="flex gap-2">
              <input
                className="flex-1 bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] placeholder-[rgba(16,185,129,.3)]"
                placeholder="Buscar por nome ou e-mail..."
                value={userSearch} onChange={e => setUserSearch(e.target.value)}
              />
              <Btn variant="ghost" cls="px-5">Buscar</Btn>
            </form>

            {/* Barra de ações em lote — fora da <table> (div não é filho válido de table) */}
            {selectedUsers.size > 0 && (
              <div className="px-4 py-3 rounded-xl bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.2)] flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[#10b981]">{selectedUsers.size} selecionado(s)</span>
                <select value={bulkAction} onChange={e => setBulkAction(e.target.value)}
                  className="text-xs bg-[#132621] border border-[rgba(16,185,129,.2)] rounded px-2 py-1 text-[#d1fae5] outline-none">
                  <option value="add-minutes">± Adicionar minutos</option>
                  <option value="set-plan">🔄 Mudar plano</option>
                  <option value="ban">🚫 Banir</option>
                  <option value="unban">✅ Desbanir</option>
                  <optgroup label="── LGPD ──">
                    <option value="anonymize">🔒 Anonimizar dados (LGPD)</option>
                    <option value="export-data">📋 Solicitar exportação (LGPD)</option>
                  </optgroup>
                </select>
                {(bulkAction === 'add-minutes' || bulkAction === 'set-plan') && (
                  <input
                    value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                    placeholder={bulkAction === 'add-minutes' ? 'Minutos (ex: 60)' : 'Plano (ex: pro)'}
                    className="text-xs bg-[#132621] border border-[rgba(16,185,129,.2)] rounded px-2 py-1 text-[#d1fae5] outline-none w-36" />
                )}
                <Btn variant="primary" disabled={bulkLoading} onClick={executeBulkAction} cls="text-xs py-1 px-3">
                  {bulkLoading ? '⟳' : '▶ Executar'}
                </Btn>
                <Btn variant="ghost" onClick={() => setSelectedUsers(new Set())} cls="text-xs py-1 px-2">✕ Cancelar</Btn>
              </div>
            )}

            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-[rgba(16,185,129,.08)]">
                    <th className="px-3 py-3">
                      <input type="checkbox"
                        checked={users.length > 0 && selectedUsers.size === users.length}
                        onChange={toggleAll}
                        className="accent-[#10b981] cursor-pointer" />
                    </th>
                    {['ID', 'E-mail', 'Plano', 'Minutos', 'Assinatura', 'Números', 'E-mail ✓', 'Cadastro', 'Ações'].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-[10px] font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subLoading ? (
                    <tr><td colSpan={10} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={10} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum usuário encontrado</td></tr>
                  ) : users.map((u: any) => {
                    const plan      = u.subscription?.plan?.name || 'free';
                    const status    = u.subscription?.status || '—';
                    const mins      = u.balance?.availableMinutes;
                    const nums      = (u.numbers || []) as any[];
                    const connected = nums.filter((n: any) => n.status === 'connected').length;
                    const total     = nums.length;
                    const selected  = selectedUsers.has(u.id);
                    return (
                      <tr key={u.id} className={`border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.025)] transition-colors group ${selected ? 'bg-[rgba(16,185,129,.05)]' : ''}`}>
                        <td className="px-3 py-3">
                          <input type="checkbox" checked={selected} onChange={() => toggleSelect(u.id)} className="accent-[#10b981] cursor-pointer" />
                        </td>
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)] font-mono max-w-[100px] truncate">{u.id.slice(0,10)}…</td>
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)] max-w-[170px] truncate">{maskEmail(u.email)}</td>
                        <td className="px-4 py-3"><Badge label={plan} cls={PLAN_CLS[plan]} /></td>
                        <td className="px-4 py-3 text-xs font-mono text-right text-[#d1fae5]">
                          {typeof mins === 'number' ? mins.toFixed(1) : '—'}
                        </td>
                        <td className="px-4 py-3"><Badge label={STATUS_LABEL[status] || status} cls={STATUS_CLS[status]} /></td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {total === 0 ? (
                            <span className="text-[rgba(16,185,129,.25)] text-xs">—</span>
                          ) : (
                            <span className={`text-xs font-bold font-mono ${connected > 0 ? 'text-green-400' : 'text-red-400/70'}`}>
                              {connected}/{total}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.emailVerified
                            ? <span className="text-green-400 text-sm">✅</span>
                            : <span className="text-red-400 text-sm">❌</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.4)] whitespace-nowrap">{fmt(u.createdAt)}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => setDetailId(u.id)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[#10b981] hover:bg-[rgba(16,185,129,.16)] transition-colors whitespace-nowrap">
                            Ver detalhes →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination offset={userOffset} total={userTotal} loading={subLoading}
              onPage={o => { setUserOffset(o); loadUsers(userSearch, o); }} />
          </div>
        )}

        {/* ═══ SUPORTE (TICKETS) ═══ */}
        {tab === 'suporte' && (
          <TicketSupportSection
            tickets={tickets}
            ticketTotal={ticketTotal}
            ticketStatus={ticketStatus}
            ticketOffset={ticketOffset}
            subLoading={subLoading}
            token={ctx.token}
            onStatusChange={updateTicketStatus}
            onFilterChange={(s) => { setTicketStatus(s); setTicketOffset(0); loadTickets(s, 0); }}
            onPage={(o) => { setTicketOffset(o); loadTickets(ticketStatus, o); }}
            notify={notify}
          />
        )}

        {/* ═══ SEÇÃO TESTERS (dentro de Usuários) ═══ */}
        {tab === 'usuarios' && (
          <div className="space-y-5 mt-8">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[rgba(16,185,129,.12)]" />
              <span className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wider">🧪 Testers</span>
              <div className="h-px flex-1 bg-[rgba(16,185,129,.12)]" />
            </div>
            {/* ── Painel: Base de Testers + Upgrade Executive ── */}
            <TesterUpgradePanel token={ctx.token} notify={fn.notify} />

            {/* Gerador de convite */}
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-xl p-6">
              <div className="text-sm font-bold text-[#d1fae5] mb-4">🧪 Gerar Convite Tester</div>
              <form onSubmit={createInvite} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)]"
                    placeholder="Nome do convidado (ex: João Silva)"
                    value={inviteName} onChange={e => setInviteName(e.target.value)} required
                  />
                  <div className="flex flex-col gap-1">
                    <input
                      className="bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)]"
                      placeholder="Ex: 34991790254"
                      value={invitePhone} onChange={e => setInvitePhone(e.target.value)}
                      type="tel"
                    />
                    <span className="text-[10px] text-[rgba(16,185,129,.35)] px-1">DDD + número, sem espaços (55 é adicionado automaticamente)</span>
                  </div>
                </div>
                <Btn variant="primary" cls="w-full justify-center py-2.5" disabled={inviteLoading}>
                  {inviteLoading ? '⟳ Gerando e enviando...' : '📲 Gerar convite + enviar WhatsApp'}
                </Btn>
              </form>
              <p className="text-xs text-[rgba(16,185,129,.4)] mt-3">
                Ao aceitar o convite, o usuário recebe <strong className="text-[#10b981]">Plano PRO grátis por 1 ano</strong> + Medalha Tester Oficial.
                {' '}O WhatsApp é enviado exclusivamente pelo número <strong className="text-[#10b981]">5534991790254</strong> via Evolution API — esse número precisa estar conectado.
                {' '}Convite expira em <strong className="text-[#10b981]">24h</strong>.
              </p>
            </div>

            {/* Resultado do último convite */}
            {lastInviteResult && (
              <div className={`border rounded-xl p-5 ${lastInviteResult.whatsappSent ? 'bg-[rgba(16,185,129,.06)] border-[rgba(16,185,129,.2)]' : 'bg-[rgba(251,191,36,.04)] border-[rgba(251,191,36,.15)]'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-bold text-[#10b981]">
                    {lastInviteResult.whatsappSent
                      ? '✅ Convite gerado e enviado via Evolution API (53499179****)'
                      : '✅ Convite gerado (sem envio automático)'}
                  </div>
                  {!lastInviteResult.whatsappSent && lastInviteResult.whatsappError && (
                    <span className="text-[10px] text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-2 py-0.5">
                      ⚠️ {lastInviteResult.whatsappError}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 text-xs text-[#6ee7b7] bg-[#132621] rounded-lg px-3 py-2 font-mono break-all">{lastInviteResult.link}</code>
                  <Btn variant="ghost" onClick={() => { navigator.clipboard.writeText(lastInviteResult!.link); notify('✅ Link copiado!', 'ok'); }}>
                    Copiar link
                  </Btn>
                </div>
                <details className="mt-1">
                  <summary className="text-[10px] text-[rgba(16,185,129,.5)] cursor-pointer hover:text-[rgba(16,185,129,.8)] transition-colors">
                    Ver mensagem completa ↓
                  </summary>
                  <div className="mt-2 relative">
                    <pre className="text-xs text-[rgba(16,185,129,.7)] bg-[#132621] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans">{lastInviteResult.message}</pre>
                    <Btn variant="ghost" cls="absolute top-2 right-2 text-[10px]"
                      onClick={() => { navigator.clipboard.writeText(lastInviteResult!.message); notify('✅ Mensagem copiada!', 'ok'); }}>
                      Copiar
                    </Btn>
                  </div>
                </details>
                <button onClick={() => setLastInviteResult(null)} className="text-xs text-[rgba(16,185,129,.3)] hover:text-[rgba(16,185,129,.6)] mt-3 transition-colors">
                  Fechar
                </button>
              </div>
            )}

            {/* Lista de convites */}
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide">{inviteTotal} convite(s)</span>
                  {invites.length > 0 && (() => {
                    const converted = invites.filter((i: any) => i.usedAt).length;
                    const clicks    = invites.reduce((s: number, i: any) => s + (i.clickCount || 0), 0);
                    return (
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-blue-400">👁 {clicks} cliques</span>
                        <span className="text-teal-400">✅ {converted} conversão(ões)</span>
                        {clicks > 0 && <span className="text-[rgba(16,185,129,.4)]">{Math.round(converted/clicks*100)}% conv.</span>}
                      </div>
                    );
                  })()}
                </div>
                <Btn onClick={loadInvites} disabled={inviteLoading}>🔄 Atualizar</Btn>
              </div>
              {inviteLoading ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
              ) : invites.length === 0 ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum convite gerado ainda</div>
              ) : invites.map((inv: any) => (
                <div key={inv.id} className="px-5 py-3 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)] flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#d1fae5]">{inv.name}</span>
                      {inv.phone && <span className="text-[10px] text-[rgba(16,185,129,.5)] font-mono">📱 {maskPhone(inv.phone)}</span>}
                    </div>
                    <div className="text-xs text-[rgba(16,185,129,.35)] font-mono mt-0.5">{inv.code}</div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-[10px] text-[rgba(16,185,129,.35)]">criado {fmt(inv.createdAt)}</span>
                      {(inv.clickCount ?? 0) > 0 && (
                        <span className="text-[10px] text-blue-400 font-semibold">👁 {inv.clickCount} clique(s)</span>
                      )}
                      {inv.usedAt && (
                        <span className="text-[10px] text-gray-400">✅ usado {fmt(inv.usedAt)}</span>
                      )}
                      {inv.expiresAt && !inv.usedAt && (
                        <span className={`text-[10px] ${new Date(inv.expiresAt) < new Date() ? 'text-red-400' : 'text-yellow-400/70'}`}>
                          {new Date(inv.expiresAt) < new Date() ? '⏰ Expirado' : `⏳ Expira ${fmtFull(inv.expiresAt)}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {inv.usedAt
                      ? <Badge label="Convertido" cls="text-teal-400 bg-teal-400/10 border-teal-400/20" />
                      : inv.expiresAt && new Date(inv.expiresAt) < new Date()
                        ? <Badge label="Expirado" cls="text-red-400 bg-red-400/10 border-red-400/20" />
                        : <Badge label="Ativo" cls={STATUS_CLS.active} />
                    }
                    {!inv.usedAt && !(inv.expiresAt && new Date(inv.expiresAt) < new Date()) && (
                      <Btn variant="ghost" onClick={() => { navigator.clipboard.writeText(inv.link); notify('✅ Link copiado!', 'ok'); }}>
                        Copiar
                      </Btn>
                    )}
                    <Btn variant="danger" onClick={() => deleteInvite(inv.id, inv.name)}>
                      🗑
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ MONITORAMENTO ═══ */}
        {tab === 'monitoramento' && (
          <div className="space-y-5">
            {/* Monitor Saúde — sintético por serviço (clique abre analítico) */}
            <ServicesHealth apiBase={API} token={token} />

            {/* Histórico de Uptime */}
            <UptimeHistory apiBase={API} token={token} />

            {/* Monitor de Saúde (histórico horário) */}
            <HealthMonitorPanel apiBase={API} token={token} />

            {/* Gráfico de transcrições por hora */}
            <HourlyChart apiBase={API} token={token} />

            {/* Monitor de Fila */}
            <QueuePanel apiBase={API} token={token} />

            {/* Diagnóstico WhatsApp */}
            <DiagnoseWhatsApp apiBase={API} token={token} />

            {/* Configuração de Alertas */}
            <AlertConfigPanel apiBase={API} token={token} />

            {/* Amostrador de Transcrições */}
            <TranscriptionSampler apiBase={API} token={token} />

            {/* Erros Recentes */}
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] flex items-center justify-between">
                <span className="text-sm font-bold text-[#d1fae5]">🐛 Erros Recentes</span>
                <span className="text-xs font-mono text-[rgba(16,185,129,.4)]">{(stats?.recentErrors || []).length} registro(s)</span>
              </div>
              {(stats?.recentErrors || []).length === 0 ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">✅ Nenhum erro registrado</div>
              ) : (stats?.recentErrors || []).map((e: any, i: number) => (
                <div key={i} className="px-5 py-3 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded mr-2">{e.service}</span>
                      <span className="text-sm text-[#d1fae5]">{e.message}</span>
                    </div>
                    <div className="text-[10px] text-[rgba(16,185,129,.3)] whitespace-nowrap flex-shrink-0">{fmtFull(e.createdAt)}</div>
                  </div>
                  {e.stack && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-[rgba(16,185,129,.3)] cursor-pointer">Stack trace</summary>
                      <pre className="text-[10px] text-red-300/60 mt-1 overflow-x-auto bg-red-900/10 rounded p-2 max-h-32">{e.stack}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ COMUNICAÇÃO / MARKETING ═══ */}
        {tab === 'comunicacao' && (
          <div className="space-y-8">
            {/* Seção Comunicação — campanhas por tipo/segmento, filtros, utilização */}
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#d1fae5]">📣 Comunicação</span>
                <div className="h-px flex-1 bg-[rgba(16,185,129,.12)]" />
              </div>
              <CampanhasTab apiBase={API} token={token} notify={notify} />
            </div>

            {/* Seção Propaganda — mensuração de propagandas e ações */}
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#d1fae5]">📢 Propaganda</span>
                <div className="h-px flex-1 bg-[rgba(16,185,129,.12)]" />
              </div>
              <PropagandaPanel apiBase={API} token={token} notify={notify} />
            </div>
          </div>
        )}

        {/* ═══ FINANCEIRO ═══ */}
        {tab === 'financeiro' && (
          <div className="space-y-5">
            {/* Custos, receita, margem, DRE, lucro — com inputs persistidos */}
            <FinanceiroPanel apiBase={API} token={token} notify={notify} stats={stats} />
            <MRRCohort   apiBase={API} token={token} />
            <ChurnRisk   apiBase={API} token={token} />
            <NPSPanel    apiBase={API} token={token} />
            {/* Gestão de Planos */}
            <PlanosPanel apiBase={API} token={token} notify={notify} />
          </div>
        )}

        {tab === 'afiliados' && (
          <div className="space-y-5">
            <AffiliatesPanel apiBase={API} token={token} notify={notify} />
          </div>
        )}

      </div>

      {/* Painel individual do usuário */}
      {detailId && (
        <UserDetailPanel
          userId={detailId}
          token={token}
          onClose={() => { setDetailId(null); loadUsers(userSearch, userOffset); }}
          onAction={notify}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   COMPONENTES AUXILIARES
══════════════════════════════════════════════════════════ */

function Badge({ label, cls }: { label: string; cls?: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border ${cls || 'text-gray-400 bg-gray-400/10 border-gray-400/20'}`}>
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   PAINEL DE AFILIADOS (aprovação + payout manual via Pix)
══════════════════════════════════════════════════════════ */
const AFF_STATUS_CLS: Record<string, string> = {
  pending:   'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  approved:  'text-green-400 bg-green-400/10 border-green-400/20',
  rejected:  'text-red-400 bg-red-400/10 border-red-400/20',
  suspended: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
};
const AFF_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', approved: 'Aprovado', rejected: 'Recusado', suspended: 'Suspenso',
};
const COMM_STATUS_CLS: Record<string, string> = {
  pending:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  paid:     'text-green-400 bg-green-400/10 border-green-400/20',
  canceled: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
};

function AffiliatesPanel({ apiBase, token, notify }: {
  apiBase: string; token: string; notify: (t: string, type?: 'ok' | 'err' | 'warn') => void;
}) {
  const [view, setView]       = useState<'cadastros' | 'comissoes'>('cadastros');
  const [affStatus, setAffStatus]   = useState('pending');
  const [commStatus, setCommStatus] = useState('pending');
  const [affiliates, setAffiliates] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);

  const hdr = { 'x-admin-token': token } as Record<string, string>;

  const loadAffiliates = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/sys/g5r8t2/affiliates?status=${status}`, { headers: hdr });
      const d = await r.json();
      setAffiliates(d.affiliates || []);
    } catch { notify('Erro ao carregar afiliados', 'err'); }
    finally { setLoading(false); }
  }, [apiBase, token]);

  const loadCommissions = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/sys/g5r8t2/affiliates/commissions?status=${status}`, { headers: hdr });
      const d = await r.json();
      setCommissions(d.commissions || []);
    } catch { notify('Erro ao carregar comissões', 'err'); }
    finally { setLoading(false); }
  }, [apiBase, token]);

  useEffect(() => {
    if (view === 'cadastros') loadAffiliates(affStatus);
    else loadCommissions(commStatus);
  }, [view, affStatus, commStatus, loadAffiliates, loadCommissions]);

  async function approve(id: string) {
    try {
      const r = await fetch(`${apiBase}/sys/g5r8t2/affiliates/${id}/approve`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error();
      notify('Afiliado aprovado ✓', 'ok');
      loadAffiliates(affStatus);
    } catch { notify('Erro ao aprovar', 'err'); }
  }
  async function reject(id: string) {
    const reason = window.prompt('Motivo da recusa (opcional):') ?? '';
    try {
      const r = await fetch(`${apiBase}/sys/g5r8t2/affiliates/${id}/reject`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      if (!r.ok) throw new Error();
      notify('Afiliado recusado', 'warn');
      loadAffiliates(affStatus);
    } catch { notify('Erro ao recusar', 'err'); }
  }
  async function markPaid(id: string) {
    const reference = window.prompt('Referência do pagamento Pix (ex.: ID/comprovante):') ?? '';
    try {
      const r = await fetch(`${apiBase}/sys/g5r8t2/affiliates/commissions/${id}/mark-paid`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ reference }) });
      if (!r.ok) throw new Error();
      notify('Comissão marcada como paga ✓', 'ok');
      loadCommissions(commStatus);
    } catch { notify('Erro ao marcar pagamento', 'err'); }
  }

  const totalPending = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.commissionAmount, 0);

  return (
    <div className="space-y-4">
      {/* Sub-abas */}
      <div className="flex gap-2">
        {([['cadastros', 'Cadastros'], ['comissoes', 'Comissões']] as [typeof view, string][]).map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              view === v ? 'bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.2)]' : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7] border border-transparent'
            }`}>{l}</button>
        ))}
      </div>

      {view === 'cadastros' && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {['pending', 'approved', 'rejected', 'all'].map(s => (
              <button key={s} onClick={() => setAffStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${affStatus === s ? 'bg-[rgba(16,185,129,.15)] text-[#10b981]' : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'}`}>
                {s === 'all' ? 'Todos' : (AFF_STATUS_LABEL[s] || s)}
              </button>
            ))}
          </div>
          {loading ? <div className="text-[rgba(16,185,129,.4)] text-sm py-6">Carregando...</div> : (
            <div className="space-y-2">
              {affiliates.length === 0 && <div className="text-[rgba(16,185,129,.4)] text-sm py-6 text-center">Nenhum afiliado nesse filtro.</div>}
              {affiliates.map(a => (
                <div key={a.id} className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#d1fae5]">{a.name || a.email}</span>
                        <Badge label={AFF_STATUS_LABEL[a.status] || a.status} cls={AFF_STATUS_CLS[a.status]} />
                        <span className="text-[10px] font-mono text-[rgba(16,185,129,.5)] bg-[rgba(16,185,129,.08)] px-2 py-0.5 rounded">{a.code}</span>
                      </div>
                      <div className="text-[11px] text-[rgba(16,185,129,.4)] mt-1">{a.email} · {a.commissionType === 'onetime' ? 'Única 30%' : 'Recorrente 5%/mês'} · {a.referrals} indicação(ões)</div>
                      {a.audience && <div className="text-[11px] text-[rgba(16,185,129,.35)] mt-1 italic">“{a.audience}”</div>}
                      {(a.pixKey || a.payoutName) && <div className="text-[11px] text-[rgba(16,185,129,.4)] mt-1">Pix: {a.pixKey || '—'} {a.pixKeyType ? `(${a.pixKeyType})` : ''} · {a.payoutName || '—'}</div>}
                      {a.rejectedReason && <div className="text-[11px] text-red-400/70 mt-1">Recusa: {a.rejectedReason}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-[rgba(16,185,129,.4)]">A receber</div>
                      <div className="text-sm font-bold text-yellow-400">{brl(a.pendingAmount || 0)}</div>
                      <div className="text-[10px] text-[rgba(16,185,129,.35)]">pago {brl(a.paidAmount || 0)}</div>
                    </div>
                  </div>
                  {a.status === 'pending' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => approve(a.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.25)] hover:bg-[rgba(16,185,129,.25)]">Aprovar</button>
                      <button onClick={() => reject(a.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-400/10 text-red-400 border border-red-400/20 hover:bg-red-400/20">Recusar</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'comissoes' && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1.5 flex-wrap">
              {['pending', 'paid', 'all'].map(s => (
                <button key={s} onClick={() => setCommStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${commStatus === s ? 'bg-[rgba(16,185,129,.15)] text-[#10b981]' : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'}`}>
                  {s === 'all' ? 'Todas' : s === 'pending' ? 'A pagar' : 'Pagas'}
                </button>
              ))}
            </div>
            {commStatus === 'pending' && <div className="text-xs text-[rgba(16,185,129,.5)]">Total a pagar: <strong className="text-yellow-400">{brl(totalPending)}</strong></div>}
          </div>
          {loading ? <div className="text-[rgba(16,185,129,.4)] text-sm py-6">Carregando...</div> : (
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[rgba(16,185,129,.4)] border-b border-[rgba(16,185,129,.08)]">
                    <th className="px-4 py-2.5 font-medium">Data</th>
                    <th className="px-4 py-2.5 font-medium">Afiliado</th>
                    <th className="px-4 py-2.5 font-medium">Pix</th>
                    <th className="px-4 py-2.5 font-medium">Comissão</th>
                    <th className="px-4 py-2.5 font-medium">Tipo</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-[rgba(16,185,129,.4)]">Nenhuma comissão.</td></tr>}
                  {commissions.map(c => (
                    <tr key={c.id} className="border-b border-[rgba(16,185,129,.05)]">
                      <td className="px-4 py-2.5 text-[rgba(16,185,129,.5)]">{fmt(c.createdAt)}</td>
                      <td className="px-4 py-2.5 text-[#d1fae5]">{c.affiliateName || c.affiliateEmail}<div className="text-[10px] font-mono text-[rgba(16,185,129,.4)]">{c.affiliateCode}</div></td>
                      <td className="px-4 py-2.5 text-[rgba(16,185,129,.5)] text-xs">{c.pixKey || '—'}<div className="text-[10px] text-[rgba(16,185,129,.35)]">{c.pixKeyType || ''}</div></td>
                      <td className="px-4 py-2.5 font-semibold text-[#d1fae5]">{brl(c.commissionAmount)}<div className="text-[10px] text-[rgba(16,185,129,.35)]">venda {brl(c.saleAmount)}</div></td>
                      <td className="px-4 py-2.5 text-[rgba(16,185,129,.5)] text-xs">{c.commissionType === 'onetime' ? 'Única' : `Rec. ${c.monthIndex}/12`}</td>
                      <td className="px-4 py-2.5"><Badge label={c.status === 'pending' ? 'A pagar' : c.status === 'paid' ? 'Pago' : 'Cancelada'} cls={COMM_STATUS_CLS[c.status]} /></td>
                      <td className="px-4 py-2.5">{c.status === 'pending' && <button onClick={() => markPaid(c.id)} className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.25)] hover:bg-[rgba(16,185,129,.25)] whitespace-nowrap">Marcar pago</button>}{c.status === 'paid' && c.paidReference && <span className="text-[10px] text-[rgba(16,185,129,.4)]">{c.paidReference}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({ title, value, sub, color = '#10b981', icon, onClick }: {
  title: string; value: string | number; sub: string; color?: string; icon?: string; onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div onClick={onClick}
      className={`bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5 transition-colors ${clickable ? 'cursor-pointer hover:border-[rgba(16,185,129,.35)] hover:bg-[rgba(16,185,129,.03)]' : 'hover:border-[rgba(16,185,129,.18)]'}`}>
      {icon && <div className="text-2xl mb-2">{icon}</div>}
      <div className="text-xs text-[rgba(16,185,129,.4)] font-medium mb-2">{title}</div>
      <div className="text-2xl font-black leading-none mb-1" style={{ color }}>{value}</div>
      <div className="text-xs text-[rgba(16,185,129,.35)]">{sub}</div>
      {clickable && <div className="text-[10px] text-[rgba(16,185,129,.3)] mt-2">abrir →</div>}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = 'ghost', cls = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost' | 'warn'; cls?: string;
}) {
  const base = 'text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap';
  const v = {
    primary: 'bg-[#10b981] text-[#011a12] hover:bg-[#34d399]',
    danger:  'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20',
    warn:    'bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20',
    ghost:   'bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[#10b981] hover:bg-[rgba(16,185,129,.16)]',
  };
  return (
    <button className={`${base} ${v[variant]} ${cls}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function DiagnoseWhatsApp({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]     = useState(false);
  const [phone, setPhone]   = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const body: any = {};
      if (phone.trim()) body.phone = phone.trim();
      const res = await fetch(`${apiBase}/sys/g5r8t2/diagnose-whatsapp`, {
        method: 'POST',
        headers: { 'x-admin-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(await res.json());
    } catch (e: any) {
      setResult({ error: e.message });
    } finally { setLoading(false); }
  }

  return (
    <div className="mt-3 border border-[rgba(16,185,129,.1)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open && !result) run(); }}
        className="w-full text-left px-4 py-2.5 text-xs text-[rgba(16,185,129,.5)] hover:text-[rgba(16,185,129,.8)] flex items-center gap-2 transition-colors">
        🔬 {open ? '▲' : '▼'} Diagnóstico WhatsApp — Evolution API
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-1.5 text-xs text-[#d1fae5] outline-none placeholder-[rgba(16,185,129,.3)]"
              placeholder="Telefone para teste de envio (opcional, ex: 34991790254)"
              value={phone} onChange={e => setPhone(e.target.value)}
            />
            <button
              type="button" onClick={run} disabled={loading}
              className="text-xs bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-3 py-1.5 rounded-lg hover:bg-[rgba(16,185,129,.2)] disabled:opacity-40 transition-colors">
              {loading ? '⟳' : '▶ Rodar'}
            </button>
          </div>
          {result && (
            <pre className="text-[10px] text-[rgba(16,185,129,.7)] bg-[#040b09] rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function QueuePanel({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any>(null);
  const [retrying, setRetrying]   = useState(false);
  const [clearing, setClearing]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/queue`, {
        headers: { 'x-admin-token': token },
      });
      setData(await res.json());
    } catch (e: any) {
      setData({ error: e.message });
    } finally { setLoading(false); }
  }

  async function retryFailed() {
    setRetrying(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/queue/retry-failed`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const r = await res.json();
      alert(`✅ ${r.retried} jobs re-enfileirados`);
      load();
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setRetrying(false); }
  }

  async function clearFailed() {
    if (!confirm(`Deseja remover permanentemente TODOS os jobs falhos da fila?`)) return;
    setClearing(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/queue/clear-failed`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const r = await res.json();
      alert(`🗑️ ${r.cleared} jobs falhos removidos`);
      load();
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setClearing(false); }
  }

  const counts = data?.queue?.counts;
  const hasFailed = counts?.failed > 0;

  return (
    <div className="mt-3 border border-[rgba(16,185,129,.1)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-4 py-2.5 text-xs text-[rgba(16,185,129,.5)] hover:text-[rgba(16,185,129,.8)] flex items-center justify-between transition-colors">
        <span>📊 {open ? '▲' : '▼'} Monitor de Fila (Transcrições)</span>
        {hasFailed && <span className="text-red-400 font-bold">{counts.failed} falhos ⚠️</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={load} disabled={loading}
              className="text-xs bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-3 py-1.5 rounded-lg hover:bg-[rgba(16,185,129,.2)] disabled:opacity-40 transition-colors">
              {loading ? '⟳ Carregando...' : '↻ Atualizar'}
            </button>
            {hasFailed && (
              <>
                <button type="button" onClick={retryFailed} disabled={retrying}
                  className="text-xs bg-amber-400/10 border border-amber-400/20 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-400/20 disabled:opacity-40 transition-colors">
                  {retrying ? '⟳' : '🔁 Re-tentar todos os falhos'}
                </button>
                <button type="button" onClick={clearFailed} disabled={clearing}
                  className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-colors">
                  {clearing ? '⟳' : '🗑️ Limpar fila de falhos'}
                </button>
              </>
            )}
          </div>

          {data?.queue && (
            <>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: 'Aguardando', key: 'waiting',   color: '#60a5fa' },
                  { label: 'Ativos',     key: 'active',    color: '#34d399' },
                  { label: 'Falhos',     key: 'failed',    color: '#f87171' },
                  { label: 'Concluídos', key: 'completed', color: '#4ade80' },
                  { label: 'Agendados',  key: 'delayed',   color: '#fbbf24' },
                ].map(({ label, key, color }) => (
                  <div key={key} className="bg-[#040b09] rounded-lg p-2.5 text-center">
                    <div className="text-xl font-black" style={{ color }}>{counts?.[key] ?? '—'}</div>
                    <div className="text-[9px] text-[rgba(16,185,129,.4)] mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {data.active?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-[rgba(16,185,129,.6)] mb-1">Jobs ativos:</p>
                  {data.active.map((j: any) => (
                    <div key={j.id} className="text-[10px] text-[rgba(16,185,129,.5)] bg-[#040b09] rounded px-2 py-1 mb-1 font-mono">
                      [{j.source}] {j.userId} — iniciado {j.processedOn ? new Date(j.processedOn).toLocaleTimeString('pt-BR') : '?'}
                    </div>
                  ))}
                </div>
              )}

              {data.failed?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-red-400 mb-1">Últimos falhos:</p>
                  <div className="max-h-48 overflow-auto space-y-1">
                    {data.failed.map((j: any) => (
                      <div key={j.id} className="text-[10px] bg-[#1a0505] border border-red-900/30 rounded px-2 py-1.5">
                        <div className="flex justify-between">
                          <span className="text-red-400 font-bold">[{j.source ?? j.name}]</span>
                          <span className="text-[rgba(255,100,100,.5)]">{j.attempts} tentativa(s)</span>
                        </div>
                        <div className="text-red-300/60 truncate mt-0.5">{j.failedReason}</div>
                        {j.finishedOn && <div className="text-red-400/30 mt-0.5">{new Date(j.finishedOn).toLocaleString('pt-BR')}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {data?.error && (
            <p className="text-xs text-red-400">Erro: {data.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ServicesHealth({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const [health, emailH] = await Promise.all([
        fetch(`${apiBase}/sys/g5r8t2/health/run`, { method: 'POST', headers: { 'x-admin-token': token } }).then(r => r.json()),
        fetch(`${apiBase}/sys/g5r8t2/email-health`, { headers: { 'x-admin-token': token } }).then(r => r.json()),
      ]);
      setData({ health: health.report, email: emailH });
    } catch (e: any) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }

  const services = data?.health ? [
    { name: 'API / Render',      ok: true,                               detail: 'Online — respondendo' },
    { name: 'Banco (DB)',        ok: data.health.checks.db.ok,           detail: data.health.checks.db.ok ? `${data.health.checks.db.latencyMs}ms` : data.health.checks.db.error },
    { name: 'Redis',             ok: data.health.checks.redis.ok,        detail: data.health.checks.redis.ok ? `${data.health.checks.redis.latencyMs}ms` : data.health.checks.redis.error },
    { name: 'Fila (BullMQ)',     ok: data.health.checks.queue.ok,        detail: `⏳${data.health.checks.queue.waiting} | ▶️${data.health.checks.queue.active} | ❌${data.health.checks.queue.failed}` },
    { name: 'WhatsApp (Evol.)',  ok: data.health.checks.whatsapp?.ok,    detail: `${data.health.checks.whatsapp?.connected ?? 0} conectado(s)` },
    { name: 'Worker',            ok: data.health.checks.worker.ok,       detail: data.health.checks.worker.note },
    { name: 'E-mail',            ok: data.email?.testResult?.ok,         detail: data.email?.provider ? `${data.email.provider}${data.email.testResult?.ok ? ' ✅' : ' ❌ ' + (data.email.testResult?.error || '')}` : 'Não configurado' },
  ] : [];

  const allOk = services.length > 0 && services.every(s => s.ok);

  return (
    <div className="mt-3 border border-[rgba(16,185,129,.1)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-4 py-2.5 text-xs text-[rgba(16,185,129,.5)] hover:text-[rgba(16,185,129,.8)] flex items-center justify-between transition-colors">
        <span>🌐 {open ? '▲' : '▼'} Saúde dos Serviços</span>
        {data && !loading && (
          <span className={`font-bold text-[10px] ${allOk ? 'text-green-400' : 'text-red-400'}`}>
            {allOk ? '✅ Todos online' : '⚠️ Verificar'}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <button type="button" onClick={load} disabled={loading}
            className="text-xs bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-3 py-1.5 rounded-lg hover:bg-[rgba(16,185,129,.2)] disabled:opacity-40 transition-colors">
            {loading ? '⟳ Verificando...' : '↻ Verificar agora'}
          </button>
          {data?.error && <p className="text-xs text-red-400">Erro: {data.error}</p>}
          {services.length > 0 && (
            <div className="space-y-1.5">
              {services.map((s, i) => (
                <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 border text-xs ${s.ok ? 'bg-green-900/10 border-green-500/15 text-green-300' : s.ok === false ? 'bg-red-900/10 border-red-500/15 text-red-300' : 'bg-yellow-900/10 border-yellow-500/15 text-yellow-300'}`}>
                  <span className="font-semibold">{s.ok ? '✅' : s.ok === false ? '❌' : '⚠️'} {s.name}</span>
                  <span className="text-[10px] opacity-70 font-mono">{s.detail ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HealthMonitorPanel({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [data, setData]       = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/health`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } catch (e: any) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/health/run`, {
        method: 'POST', headers: { 'x-admin-token': token },
      });
      const r = await res.json();
      setData((prev: any) => ({ ...prev, lastReport: r.report }));
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setRunning(false); }
  }

  const report = data?.lastReport;
  const statusColor = report?.status === 'critical' ? '#f87171'
    : report?.status === 'warn' ? '#fbbf24' : '#34d399';
  const statusIcon  = report?.status === 'critical' ? '🔴'
    : report?.status === 'warn' ? '⚠️' : '✅';

  return (
    <div className="mt-3 border border-[rgba(16,185,129,.1)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-4 py-2.5 text-xs text-[rgba(16,185,129,.5)] hover:text-[rgba(16,185,129,.8)] flex items-center justify-between transition-colors">
        <span>🩺 {open ? '▲' : '▼'} Monitor de Saúde dos Serviços (horário)</span>
        {report && (
          <span style={{ color: statusColor }} className="font-bold text-[10px]">
            {statusIcon} {report.status.toUpperCase()} — {report.alerts.length} alerta(s)
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-5 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className="text-xs bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-3 py-1.5 rounded-lg hover:bg-[rgba(16,185,129,.2)] disabled:opacity-40 transition-colors">
              {loading ? '⟳ Carregando...' : '↻ Atualizar'}
            </button>
            <button type="button" onClick={runNow} disabled={running}
              className="text-xs bg-blue-400/10 border border-blue-400/20 text-blue-400 px-3 py-1.5 rounded-lg hover:bg-blue-400/20 disabled:opacity-40 transition-colors">
              {running ? '⟳ Verificando...' : '▶ Rodar agora'}
            </button>
          </div>

          {data?.error && <p className="text-xs text-red-400">Erro: {data.error}</p>}

          {!report && !loading && !data?.error && (
            <p className="text-xs text-[rgba(16,185,129,.35)]">Nenhuma verificação realizada ainda — clique em "Rodar agora"</p>
          )}

          {report && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-black" style={{ color: statusColor }}>{statusIcon} {report.status.toUpperCase()}</span>
                <span className="text-[10px] text-[rgba(16,185,129,.35)]">{new Date(report.ts).toLocaleString('pt-BR')}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Banco',     ok: report.checks.db.ok,          detail: report.checks.db.latencyMs ? `${report.checks.db.latencyMs}ms` : report.checks.db.error || '—' },
                  { label: 'Redis',     ok: report.checks.redis.ok,        detail: report.checks.redis.latencyMs ? `${report.checks.redis.latencyMs}ms` : report.checks.redis.error || '—' },
                  { label: 'Fila',      ok: report.checks.queue.ok,        detail: `⏳${report.checks.queue.waiting} ▶️${report.checks.queue.active} ❌${report.checks.queue.failed}` },
                  { label: 'WhatsApp',  ok: report.checks.whatsapp?.ok,    detail: `${report.checks.whatsapp?.connected ?? 0} conectado(s)` },
                ].map(({ label, ok, detail }) => (
                  <div key={label} className={`rounded-lg p-3 border ${ok ? 'bg-green-900/10 border-green-500/20' : 'bg-red-900/10 border-red-500/20'}`}>
                    <div className="text-sm font-black mb-0.5" style={{ color: ok ? '#34d399' : '#f87171' }}>
                      {ok ? '✅' : '❌'} {label}
                    </div>
                    <div className="text-[10px] text-[rgba(255,255,255,.4)] font-mono">{detail}</div>
                  </div>
                ))}
              </div>

              <div className={`rounded-lg px-3 py-2 border text-xs ${report.checks.worker.ok ? 'bg-green-900/10 border-green-500/20 text-green-400' : 'bg-red-900/10 border-red-500/20 text-red-400'}`}>
                {report.checks.worker.ok ? '✅' : '❌'} Worker: {report.checks.worker.note}
              </div>

              {report.alerts.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide">Alertas</p>
                  {report.alerts.map((a: string, i: number) => (
                    <div key={i} className={`text-xs px-3 py-2 rounded-lg ${a.startsWith('🔴') ? 'bg-red-900/15 text-red-300' : 'bg-yellow-900/15 text-yellow-300'}`}>
                      {a}
                    </div>
                  ))}
                </div>
              )}

              {report.suggestions.filter((s: string) => !s.startsWith('✅')).length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide">Sugestões de Otimização</p>
                  {report.suggestions.filter((s: string) => !s.startsWith('✅')).map((s: string, i: number) => (
                    <div key={i} className="text-xs px-3 py-2 rounded-lg bg-blue-900/10 text-blue-300 border border-blue-500/15">
                      💡 {s}
                    </div>
                  ))}
                </div>
              )}

              {data?.recentHistory?.length > 1 && (
                <div>
                  <p className="text-[10px] font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-1">Tendência (últimas verificações)</p>
                  <div className="flex gap-1 flex-wrap">
                    {[...data.recentHistory].reverse().map((h: any, i: number) => (
                      <div key={i} className="text-[9px] text-center bg-[#040b09] rounded px-2 py-1 border border-[rgba(16,185,129,.08)]">
                        <div style={{ color: h.status === 'critical' ? '#f87171' : h.status === 'warn' ? '#fbbf24' : '#34d399' }}>
                          {h.status === 'critical' ? '🔴' : h.status === 'warn' ? '⚠️' : '✅'}
                        </div>
                        <div className="text-[rgba(16,185,129,.35)] mt-0.5 font-mono">{new Date(h.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                        {h.queue.failed > 0 && <div className="text-red-400">❌{h.queue.failed}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}


function Pagination({ offset, total, loading, onPage }: {
  offset: number; total: number; loading: boolean; onPage: (o: number) => void;
}) {
  const page  = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="flex items-center justify-between text-xs text-[rgba(16,185,129,.4)]">
      <span>{total} resultado(s)</span>
      <div className="flex items-center gap-2">
        <Btn disabled={offset === 0 || loading} onClick={() => onPage(Math.max(0, offset - PAGE))}>← Anterior</Btn>
        <span className="font-mono">{page} / {pages}</span>
        <Btn disabled={offset + PAGE >= total || loading} onClick={() => onPage(offset + PAGE)}>Próxima →</Btn>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color = '#10b981' }: { pct: number; color?: string }) {
  const c = pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : color;
  return (
    <div className="w-full bg-[#132621] rounded-full h-1.5 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: c }} />
    </div>
  );
}

function Toast({ msg, onClose }: { msg: { text: string; type: 'ok' | 'err' | 'warn' }; onClose: () => void }) {
  const cls = msg.type === 'ok' ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : msg.type === 'err' ? 'bg-red-400/10 border-red-400/20 text-red-400'
            : 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400';
  return (
    <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-xl border text-sm font-semibold shadow-2xl flex items-center gap-3 ${cls}`}>
      <span>{msg.text}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100 text-lg leading-none">✕</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PAINEL INDIVIDUAL DO USUÁRIO
══════════════════════════════════════════════════════════ */
function UserDetailPanel({ userId, token, onClose, onAction }: {
  userId: string; token: string; onClose: () => void;
  onAction: (msg: string, type: 'ok' | 'err' | 'warn') => void;
}) {
  const [data, setData]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [acting, setActing]       = useState<string | null>(null);
  const [timeline, setTimeline]   = useState<any[] | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  const [showTl, setShowTl]       = useState(false);

  // Envio de mensagem individual
  const [showMsg, setShowMsg]         = useState(false);
  const [msgChannel, setMsgChannel]   = useState<'whatsapp' | 'email' | 'both'>('both');
  const [msgText, setMsgText]         = useState('');
  const [msgSubject, setMsgSubject]   = useState('');
  const [msgSending, setMsgSending]   = useState(false);
  const [msgResult, setMsgResult]     = useState<any>(null);

  const [editPlan, setEditPlan]       = useState('');
  const [editMins, setEditMins]       = useState('');
  const [editMode, setEditMode]       = useState<'set' | 'add'>('set');
  const [editSaving, setEditSaving]   = useState(false);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/users/${userId}/detail`, { headers: h });
      const d   = await res.json();
      setData(d);
      setEditPlan(d.user?.subscription?.plan?.name || 'free');
      setEditMins(String(d.user?.balance?.availableMinutes ?? 0));
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, token]);

  useState(() => { load(); });

  async function impersonate() {
    setActing('impersonate');
    try {
      const res = await fetch(`${API}/sys/g5r8t2/users/${userId}/impersonate`, { method: 'POST', headers: h });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      // Abre nova aba com token de impersonação
      const url = `${window.location.origin}/dashboard?impersonate_token=${d.token}`;
      window.open(url, '_blank');
      onAction('⚠️ Sessão de impersonação aberta (1h) — feche quando terminar', 'warn');
    } catch (e: any) { onAction(`❌ ${e.message}`, 'err'); }
    finally { setActing(null); }
  }

  async function loadTimeline() {
    if (timeline) { setShowTl(t => !t); return; }
    setTlLoading(true); setShowTl(true);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/users/${userId}/timeline`, { headers: h });
      const d = await res.json();
      setTimeline(d.events || []);
    } catch (e: any) { onAction(`❌ ${e.message}`, 'err'); setShowTl(false); }
    finally { setTlLoading(false); }
  }

  async function act(endpoint: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object) {
    setActing(endpoint);
    try {
      const url = endpoint ? `${API}/sys/g5r8t2/users/${userId}/${endpoint}` : `${API}/sys/g5r8t2/users/${userId}`;
      const res = await fetch(url, {
        method, headers: h, body: body ? JSON.stringify(body) : undefined,
      });
      const d = method !== 'DELETE' ? await res.json() : null;
      if (!res.ok) throw new Error(d?.error || 'Erro');
      onAction(d?.message || '✅ Ação realizada', 'ok');
      await load();
    } catch (e: any) {
      onAction(`❌ ${e.message}`, 'err');
    } finally { setActing(null); }
  }

  async function saveEdit() {
    setEditSaving(true);
    const body: any = {};
    if (editPlan !== data.user?.subscription?.plan?.name) body.planName = editPlan;
    const m = parseFloat(editMins);
    if (!isNaN(m)) { body.minutes = m; body.minutesMode = editMode; }
    if (!Object.keys(body).length) { setEditSaving(false); return; }
    try {
      const res = await fetch(`${API}/sys/g5r8t2/users/${userId}`, {
        method: 'PATCH', headers: h, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      onAction('✅ Usuário atualizado', 'ok');
      await load();
    } catch (e: any) {
      onAction(`❌ ${e.message}`, 'err');
    } finally { setEditSaving(false); }
  }

  async function sendMessage() {
    if (!msgText.trim()) return;
    setMsgSending(true); setMsgResult(null);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/users/${userId}/send-message`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ channel: msgChannel, message: msgText, subject: msgSubject || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      setMsgResult(d);
      onAction(
        d.ok ? '✅ Mensagem enviada!' : '⚠️ Não foi possível enviar — veja os detalhes',
        d.ok ? 'ok' : 'warn',
      );
    } catch (e: any) { onAction(`❌ ${e.message}`, 'err'); }
    finally { setMsgSending(false); }
  }

  if (loading) return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="text-[#10b981] text-sm animate-pulse">Carregando...</div>
    </div>
  );
  if (!data) return null;

  const { user, stats, transcriptions, numbers, auditLogs } = data;
  const plan   = user?.subscription?.plan?.name || 'free';
  const status = user?.subscription?.status || '—';

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-stretch justify-end"
      onClick={onClose}>
      <div className="w-full max-w-2xl bg-[#050d0a] border-l border-[rgba(16,185,129,.15)] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        <div className="sticky top-0 bg-[#050d0a] border-b border-[rgba(16,185,129,.10)] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="font-bold text-[#d1fae5] text-base">{user.email}</div>
            <div className="text-xs text-[rgba(16,185,129,.5)] font-mono mt-0.5">{user.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge label={plan} cls={PLAN_CLS[plan]} />
            <Badge label={STATUS_LABEL[status] || status} cls={STATUS_CLS[status]} />
            <button onClick={onClose} className="ml-3 text-[rgba(16,185,129,.4)] hover:text-[#d1fae5] text-xl transition-colors">✕</button>
          </div>
        </div>

        <div className="p-6 space-y-6">

          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">Ações</div>
            <div className="flex flex-wrap gap-2">
              <Btn variant="ghost" disabled={!!acting}
                onClick={() => act('confirm-email', 'POST')}>
                {acting === 'confirm-email' ? '⟳' : '✅'} Confirmar e-mail
              </Btn>
              <Btn variant="warn" disabled={!!acting}
                onClick={() => act('reset-password', 'POST')}>
                {acting === 'reset-password' ? '⟳' : '🔑'} Enviar reset de senha
              </Btn>
              <Btn variant="ghost" disabled={!!acting} onClick={() => act('resend-activation', 'POST')}>
                {acting === 'resend-activation' ? '⟳' : '📧'} Reenviar ativação
              </Btn>
              <Btn variant="ghost" disabled={!!acting} onClick={load}>
                🔄 Atualizar dados
              </Btn>
              <Btn variant="danger" disabled={!!acting}
                onClick={() => {
                  if (confirm(`Excluir permanentemente ${user.email}? Esta ação não pode ser desfeita.`)) {
                    act('', 'DELETE').then(onClose);
                  }
                }}>
                🗑️ Excluir usuário
              </Btn>
              <Btn variant="ghost" disabled={!!acting} onClick={impersonate}>
                {acting === 'impersonate' ? '⟳' : '🎭'} Impersonar (1h)
              </Btn>
              <Btn variant="ghost" disabled={tlLoading} onClick={loadTimeline}>
                {tlLoading ? '⟳' : '📅'} {showTl ? 'Ocultar timeline' : 'Ver timeline'}
              </Btn>
            </div>
          </div>

          {/* Enviar Mensagem */}
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
            <button type="button" onClick={() => setShowMsg(m => !m)}
              className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
              <span className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide">📨 Enviar Mensagem</span>
              <span className="text-xs text-[rgba(16,185,129,.4)]">{showMsg ? '▲' : '▼'}</span>
            </button>
            {showMsg && (
              <div className="px-4 pb-4 space-y-3">
                {/* Canal */}
                <div className="flex gap-1.5">
                  {([['whatsapp', '📱 WhatsApp'], ['email', '📧 E-mail'], ['both', '📨 Ambos']] as const).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setMsgChannel(v)}
                      className={`flex-1 py-1.5 text-xs rounded-lg border font-semibold transition-colors ${
                        msgChannel === v
                          ? 'bg-[rgba(16,185,129,.15)] border-[rgba(16,185,129,.3)] text-[#10b981]'
                          : 'bg-[#132621] border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.4)]'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* Assunto (email) */}
                {(msgChannel === 'email' || msgChannel === 'both') && (
                  <input
                    value={msgSubject} onChange={e => setMsgSubject(e.target.value)}
                    placeholder="Assunto do e-mail (opcional)"
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)]"
                  />
                )}
                {/* Mensagem */}
                <textarea
                  value={msgText} onChange={e => setMsgText(e.target.value)}
                  placeholder="Digite a mensagem..."
                  rows={4}
                  className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)] resize-none"
                />
                <Btn variant="primary" disabled={msgSending || !msgText.trim()} onClick={sendMessage} cls="w-full justify-center py-2">
                  {msgSending ? '⟳ Enviando...' : '📨 Enviar mensagem'}
                </Btn>
                {/* Resultado */}
                {msgResult && (
                  <div className="bg-[#132621] rounded-lg p-3 space-y-1">
                    {msgResult.results?.whatsapp && (
                      <div className={`text-xs flex items-center gap-1.5 ${msgResult.results.whatsapp.ok ? 'text-green-400' : 'text-red-400'}`}>
                        {msgResult.results.whatsapp.ok ? '✅' : '❌'} WhatsApp: {msgResult.results.whatsapp.ok ? 'enviado' : msgResult.results.whatsapp.error}
                      </div>
                    )}
                    {msgResult.results?.email && (
                      <div className={`text-xs flex items-center gap-1.5 ${msgResult.results.email.ok ? 'text-green-400' : 'text-red-400'}`}>
                        {msgResult.results.email.ok ? '✅' : '❌'} E-mail: {msgResult.results.email.ok ? 'enviado' : msgResult.results.email.error}
                      </div>
                    )}
                    {msgResult.warning && <div className="text-xs text-yellow-400">⚠️ {msgResult.warning}</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timeline */}
          {showTl && (
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
              <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">📅 Timeline de Eventos</div>
              {tlLoading ? (
                <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4 animate-pulse">Carregando...</div>
              ) : timeline && timeline.length === 0 ? (
                <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhum evento encontrado</div>
              ) : (
                <div className="relative pl-6 space-y-3">
                  <div className="absolute left-2 top-0 bottom-0 w-px bg-[rgba(16,185,129,.15)]" />
                  {(timeline || []).map((ev: any, i: number) => (
                    <div key={i} className="relative">
                      <div className="absolute -left-4 w-4 h-4 rounded-full bg-[#0d1c19] border border-[rgba(16,185,129,.3)] flex items-center justify-center text-[8px]">
                        {ev.icon}
                      </div>
                      <div className="bg-[#132621] rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#d1fae5]">{ev.label}</span>
                          <span className="text-[10px] text-[rgba(16,185,129,.3)] font-mono flex-shrink-0">{fmtFull(ev.ts)}</span>
                        </div>
                        {ev.detail && <div className="text-[10px] text-[rgba(16,185,129,.5)] mt-0.5">{ev.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-4">Uso de Minutos</div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#132621] rounded-xl p-3 text-center">
                <div className="text-xl font-black text-[#10b981]">{fmtMin(stats.availableMinutes)}</div>
                <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-1">Disponíveis</div>
              </div>
              <div className="bg-[#132621] rounded-xl p-3 text-center">
                <div className="text-xl font-black text-[#fbbf24]">{fmtMin(stats.totalMinutesUsed)}</div>
                <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-1">Usados (total)</div>
              </div>
              <div className="bg-[#132621] rounded-xl p-3 text-center">
                <div className="text-xl font-black text-[#d1fae5]">{fmtMin(stats.planLimit)}</div>
                <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-1">Limite do plano</div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-[rgba(16,185,129,.5)]">
                <span>Consumo do período</span>
                <span className="font-mono font-bold">{stats.usagePct}%</span>
              </div>
              <ProgressBar pct={stats.usagePct} />
            </div>
          </div>

          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-4">Editar Plano & Minutos</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] text-[rgba(16,185,129,.4)] mb-1.5">PLANO</label>
                <select value={editPlan} onChange={e => setEditPlan(e.target.value)}
                  className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)]">
                  <option value="free">🆓 Free</option>
                  <option value="pro">⚡ Pro</option>
                  <option value="ultra">🚀 Ultra</option>
                  <option value="executive">💎 Executive</option>
                  <option value="pro-tester">🧪 Pro Tester</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[rgba(16,185,129,.4)] mb-1.5">MINUTOS</label>
                <input type="number" step="1" value={editMins}
                  onChange={e => setEditMins(e.target.value)}
                  className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] font-mono outline-none focus:border-[rgba(16,185,129,.35)]" />
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              {(['set', 'add'] as const).map(m => (
                <button key={m} type="button" onClick={() => setEditMode(m)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    editMode === m
                      ? 'bg-[rgba(16,185,129,.15)] border-[rgba(16,185,129,.3)] text-[#10b981]'
                      : 'bg-[#132621] border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.4)]'
                  }`}>
                  {m === 'set' ? '= Definir' : '± Adicionar / subtrair'}
                </button>
              ))}
            </div>
            <Btn variant="primary" disabled={editSaving} onClick={saveEdit} cls="w-full justify-center py-2">
              {editSaving ? '⟳ Salvando...' : '💾 Salvar alterações'}
            </Btn>
          </div>

          {numbers.length > 0 && (
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
              <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">
                WhatsApp ({numbers.length})
              </div>
              <div className="space-y-2">
                {numbers.map((n: any) => (
                  <div key={n.id} className="flex items-center justify-between bg-[#132621] rounded-lg px-3 py-2.5">
                    <div>
                      <div className="text-sm text-[#d1fae5] font-medium">{n.displayName || '—'}</div>
                      <div className="text-xs text-[rgba(16,185,129,.4)] font-mono">{n.id.slice(0, 16)}…</div>
                    </div>
                    <Badge label={STATUS_LABEL[n.status] || n.status} cls={STATUS_CLS[n.status]} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">
              Últimas Transcrições ({stats.totalTranscriptions})
            </div>
            {transcriptions.length === 0 ? (
              <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhuma transcrição ainda</div>
            ) : (
              <div className="space-y-2">
                {transcriptions.map((t: any) => (
                  <div key={t.id} className="bg-[#132621] rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge label="ok" cls={STATUS_CLS.active} />
                        <span className="text-[10px] text-[rgba(16,185,129,.4)] font-mono">{fmtMin(t.durationSec ? t.durationSec / 60 : 0)}</span>
                        {t.language && <span className="text-[10px] text-[rgba(16,185,129,.3)]">{t.language}</span>}
                        {t.source && <span className="text-[10px] text-[rgba(16,185,129,.3)]">{t.source}</span>}
                      </div>
                      <span className="text-[10px] text-[rgba(16,185,129,.3)]">{fmt(t.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {auditLogs.length > 0 && (
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
              <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">Auditoria</div>
              <div className="space-y-1.5">
                {auditLogs.map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-[#10b981] font-mono">{a.action}</span>
                    <span className="text-[rgba(16,185,129,.4)]">{fmtFull(a.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">Informações da Conta</div>
            <div className="space-y-2 text-xs">
              <Row label="ID" value={user.id} mono />
              <Row label="Cadastro" value={fmtFull(user.createdAt)} />
              <Row label="E-mail verificado" value={user.emailVerified ? '✅ Sim' : '❌ Não'} />
              <Row label="Admin" value={user.isAdmin ? '✅ Sim' : 'Não'} />
              {user.subscription?.currentPeriodEnd && (
                <Row label="Período atual até" value={fmt(user.subscription.currentPeriodEnd)} />
              )}
              {user.subscription?.asaasCustomerId && (
                <Row label="Asaas Customer ID" value={user.subscription.asaasCustomerId} mono />
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[rgba(16,185,129,.4)] flex-shrink-0">{label}</span>
      <span className={`text-[#d1fae5] text-right break-all ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   NOVOS COMPONENTES — 10 Features Admin
══════════════════════════════════════════════════════════ */

// ── #5 Gráfico de transcrições por hora ────────────────────────────────────────
function HourlyChart({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any[] | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/analytics/transcriptions/hourly`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } catch { setData([]); }
    finally { setLoading(false); }
  }

  const maxVal = data ? Math.max(...data.map(d => d.total), 1) : 1;
  const total  = data ? data.reduce((a, d) => a + d.total, 0) : 0;

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">📈 Transcrições por Hora (24h)</span>
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'} {data ? `${total} total` : ''}</span>
      </button>
      {open && (
        <div className="px-5 pb-5">
          <button type="button" onClick={load} disabled={loading}
            className="text-xs text-[rgba(16,185,129,.5)] hover:text-[#10b981] mb-3 transition-colors">
            {loading ? '⟳ Carregando...' : '↻ Atualizar'}
          </button>
          {data && data.length === 0 && (
            <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhuma transcrição nas últimas 24h</div>
          )}
          {data && data.length > 0 && (
            <div className="flex items-end gap-1 h-32 mt-2">
              {data.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group" title={`${new Date(d.hour).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}: ${d.total}`}>
                  <span className="text-[8px] text-[rgba(16,185,129,.5)] opacity-0 group-hover:opacity-100 transition-opacity">{d.total}</span>
                  <div className="w-full bg-[#10b981] rounded-t transition-all"
                    style={{ height: `${Math.max(4, (d.total / maxVal) * 100)}%`, opacity: 0.6 + 0.4 * (d.total / maxVal) }} />
                  <span className="text-[7px] text-[rgba(16,185,129,.3)] rotate-90 mt-1 whitespace-nowrap">
                    {new Date(d.hour).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── #6 Histórico de uptime ─────────────────────────────────────────────────────
function UptimeHistory({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any | null>(null);
  const [days, setDays]       = useState(7);

  async function load(d = days) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/uptime-history?days=${d}`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } catch { setData(null); }
    finally { setLoading(false); }
  }

  const uptimeColor = (pct: number) => pct >= 99 ? '#10b981' : pct >= 95 ? '#fbbf24' : '#f87171';

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">🕐 Histórico de Uptime</span>
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'} últimos {days}d</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <div className="flex gap-1.5 items-center">
            {[1, 3, 7, 14, 30].map(d => (
              <button key={d} type="button" onClick={() => { setDays(d); load(d); }}
                className={`text-xs px-2 py-1 rounded transition-colors ${days === d ? 'bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.25)]' : 'text-[rgba(16,185,129,.4)] hover:text-[#10b981]'}`}>
                {d}d
              </button>
            ))}
            <button type="button" onClick={() => load()} disabled={loading}
              className="text-xs text-[rgba(16,185,129,.4)] hover:text-[#10b981] ml-2 transition-colors">
              {loading ? '⟳' : '↻'}
            </button>
          </div>
          {!data && !loading && <div className="text-xs text-[rgba(16,185,129,.3)]">Sem dados ainda — o checker roda a cada 5 min no worker.</div>}
          {data?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {data.summary.map((s: any) => (
                <div key={s.service} className="bg-[#132621] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-[#d1fae5] capitalize">{s.service}</span>
                    <span className="text-xs font-black" style={{ color: uptimeColor(s.uptime) }}>{s.uptime}%</span>
                  </div>
                  <div className="w-full bg-[rgba(16,185,129,.1)] rounded h-1.5 mb-2">
                    <div className="h-full rounded transition-all" style={{ width: `${s.uptime}%`, background: uptimeColor(s.uptime) }} />
                  </div>
                  <div className="text-[9px] text-[rgba(16,185,129,.4)]">
                    {s.avgLatencyMs != null ? `⚡ ${s.avgLatencyMs}ms` : ''} · {s.checks} verificações
                  </div>
                  <div className="text-[9px] mt-0.5" style={{ color: s.latest?.status === 'up' ? '#10b981' : '#f87171' }}>
                    {s.latest ? `Último: ${s.latest.status}` : 'Sem dados'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── #4 Configuração de Alertas ─────────────────────────────────────────────────
function AlertConfigPanel({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]     = useState(false);
  const [cfg, setCfg]       = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/alert-config`, { headers: h });
      setCfg(await res.json());
    } finally { setLoading(false); }
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      await fetch(`${apiBase}/sys/g5r8t2/alert-config`, { method: 'POST', headers: h, body: JSON.stringify(cfg) });
      alert('✅ Configuração salva!');
    } catch { alert('❌ Erro ao salvar'); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !cfg) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">🔔 Configuração de Alertas Automáticos</span>
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          {loading && <div className="text-xs text-[rgba(16,185,129,.3)] animate-pulse">Carregando...</div>}
          {cfg && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { key: 'alertPhone', label: '📱 WhatsApp para alertas', placeholder: '5511999999999' },
                  { key: 'alertEmail', label: '📧 E-mail para alertas', placeholder: 'admin@example.com' },
                  { key: 'queueMaxWaiting', label: '⏳ Alerta fila: máx. jobs aguardando', placeholder: '20' },
                  { key: 'errorRatePct', label: '❌ Alerta: taxa de erro (% jobs falhos)', placeholder: '10' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-[10px] text-[rgba(16,185,129,.4)] mb-1.5 uppercase tracking-wide">{label}</label>
                    <input
                      value={cfg[key] == null || cfg[key] === 'null' ? '' : String(cfg[key])}
                      onChange={e => setCfg(prev => ({ ...prev!, [key]: e.target.value || null }))}
                      placeholder={placeholder}
                      className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] font-mono outline-none focus:border-[rgba(16,185,129,.35)]"
                    />
                  </div>
                ))}
              </div>
              <button type="button" onClick={save} disabled={saving}
                className="text-xs bg-[#10b981] text-[#011a12] font-bold px-4 py-2 rounded-lg hover:bg-[#34d399] disabled:opacity-50 transition-colors">
                {saving ? '⟳ Salvando...' : '💾 Salvar configuração'}
              </button>
              <p className="text-[10px] text-[rgba(16,185,129,.3)]">Alertas via WhatsApp são enviados automaticamente quando thresholds são excedidos (checker roda a cada 5min no worker).</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── #9 Amostrador de transcrições ─────────────────────────────────────────────
function TranscriptionSampler({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any[] | null>(null);
  const [n, setN]             = useState(5);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/transcriptions/sample?n=${n}`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } catch { setData([]); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">🎲 Amostrador de Transcrições</span>
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-center gap-2">
            <select value={n} onChange={e => setN(Number(e.target.value))}
              className="text-xs bg-[#132621] border border-[rgba(16,185,129,.15)] rounded px-2 py-1 text-[#d1fae5] outline-none">
              {[3, 5, 10, 20].map(v => <option key={v} value={v}>{v} amostras</option>)}
            </select>
            <button type="button" onClick={load} disabled={loading}
              className="text-xs bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-3 py-1.5 rounded-lg hover:bg-[rgba(16,185,129,.2)] disabled:opacity-40 transition-colors">
              {loading ? '⟳ Amostrando...' : '🎲 Nova amostra'}
            </button>
          </div>
          {data && data.length === 0 && <div className="text-xs text-[rgba(16,185,129,.3)]">Nenhuma transcrição encontrada.</div>}
          {data && data.map((t: any, i: number) => (
            <div key={i} className="bg-[#132621] rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[rgba(16,185,129,.5)] font-mono">{t.id?.slice(0,10)}…</span>
                  <span className="text-[10px] bg-[rgba(16,185,129,.1)] px-1.5 py-0.5 rounded text-[#10b981]">{t.language}</span>
                  <span className="text-[10px] text-[rgba(16,185,129,.4)]">{t.source}</span>
                </div>
                <span className="text-[10px] text-[rgba(16,185,129,.3)]">{t.createdAt ? new Date(t.createdAt).toLocaleString('pt-BR') : '—'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#d1fae5]">{t.contactName || 'Sem nome'}</span>
                <span className="text-[10px] text-[rgba(16,185,129,.4)]">{t.durationSec ? `${(t.durationSec / 60).toFixed(1)} min` : '—'}</span>
                <span className="text-[10px] text-[rgba(16,185,129,.4)] font-mono">{t.userEmail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── #7 MRR por Coorte ──────────────────────────────────────────────────────────
function MRRCohort({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/analytics/mrr-cohort`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } finally { setLoading(false); }
  }

  const maxMrr = data?.cohorts ? Math.max(...data.cohorts.map((c: any) => c.mrr), 1) : 1;

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">💰 MRR por Coorte de Cadastro</span>
        {data && <span className="text-xs font-bold text-[#10b981]">R$ {data.totalMrr?.toFixed(2)} total</span>}
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <button type="button" onClick={load} disabled={loading}
            className="text-xs text-[rgba(16,185,129,.4)] hover:text-[#10b981] transition-colors">
            {loading ? '⟳ Carregando...' : '↻ Atualizar'}
          </button>
          {data?.cohorts && data.cohorts.length === 0 && (
            <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhum assinante pago ainda.</div>
          )}
          {data?.cohorts && data.cohorts.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[rgba(16,185,129,.08)]">
                  {['Coorte', 'Usuários', 'MRR', ''].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c: any) => (
                  <tr key={c.cohort} className="border-b border-[rgba(16,185,129,.04)] last:border-0">
                    <td className="py-2 px-3 font-mono text-[#d1fae5]">{c.cohort}</td>
                    <td className="py-2 px-3 text-[rgba(16,185,129,.7)]">{c.users}</td>
                    <td className="py-2 px-3 font-bold text-[#10b981]">R$ {c.mrr.toFixed(2)}</td>
                    <td className="py-2 px-3 w-32">
                      <div className="bg-[rgba(16,185,129,.1)] rounded h-1.5">
                        <div className="h-full rounded bg-[#10b981]" style={{ width: `${(c.mrr / maxMrr) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[rgba(16,185,129,.15)]">
                  <td className="py-2 px-3 font-bold text-[rgba(16,185,129,.6)]">Total</td>
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3 font-black text-[#10b981]">R$ {data.totalMrr?.toFixed(2)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── #8 Risco de Churn ──────────────────────────────────────────────────────────
function ChurnRisk({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any | null>(null);
  const [days, setDays]       = useState(14);

  async function load(d = days) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/analytics/churn-risk?days=${d}`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">⚠️ Risco de Churn</span>
        {data && <span className={`text-xs font-bold ${data.total > 0 ? 'text-red-400' : 'text-green-400'}`}>{data.total} usuário(s) em risco</span>}
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-center gap-2">
            {[7, 14, 30].map(d => (
              <button key={d} type="button" onClick={() => { setDays(d); load(d); }}
                className={`text-xs px-2 py-1 rounded transition-colors ${days === d ? 'bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.25)]' : 'text-[rgba(16,185,129,.4)] hover:text-[#10b981]'}`}>
                {d}d sem atividade
              </button>
            ))}
            <button type="button" onClick={() => load()} disabled={loading}
              className="text-xs text-[rgba(16,185,129,.4)] hover:text-[#10b981] transition-colors">{loading ? '⟳' : '↻'}</button>
          </div>
          {data?.atRisk && data.atRisk.length === 0 && (
            <div className="text-xs text-green-400 text-center py-4">✅ Nenhum usuário em risco de churn!</div>
          )}
          {data?.atRisk && data.atRisk.map((u: any, i: number) => (
            <div key={i} className="bg-[#132621] border border-red-500/10 rounded-lg px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#d1fae5]">{u.email}</div>
                  <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-0.5">Plano: {u.plan} · R$ {u.priceBrl}/mês</div>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-bold ${u.neverUsed ? 'text-red-400' : 'text-yellow-400'}`}>
                    {u.neverUsed ? '🚨 Nunca usou' : `${u.daysSinceLast}d sem atividade`}
                  </div>
                  {u.minutesLeft != null && (
                    <div className="text-[10px] text-[rgba(16,185,129,.4)]">{u.minutesLeft.toFixed(0)} min restantes</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── #10 Painel NPS (admin view) ────────────────────────────────────────────────
function NPSPanel({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any | null>(null);
  const [days, setDays]       = useState(90);

  async function load(d = days) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/nps?days=${d}`, { headers: { 'x-admin-token': token } });
      setData(await res.json());
    } finally { setLoading(false); }
  }

  const npsColor = (s: number | null) => s == null ? '#60a5fa' : s >= 50 ? '#10b981' : s >= 0 ? '#fbbf24' : '#f87171';

  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[rgba(16,185,129,.02)] transition-colors">
        <span className="text-sm font-bold text-[#d1fae5]">⭐ NPS — Net Promoter Score</span>
        {data && <span className="text-xs font-bold" style={{ color: npsColor(data.npsScore) }}>{data.npsScore != null ? `NPS: ${data.npsScore > 0 ? '+' : ''}${data.npsScore}` : 'Sem dados'}</span>}
        <span className="text-xs text-[rgba(16,185,129,.4)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div className="flex items-center gap-2">
            {[30, 90, 180, 365].map(d => (
              <button key={d} type="button" onClick={() => { setDays(d); load(d); }}
                className={`text-xs px-2 py-1 rounded transition-colors ${days === d ? 'bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.25)]' : 'text-[rgba(16,185,129,.4)] hover:text-[#10b981]'}`}>
                {d}d
              </button>
            ))}
            <button type="button" onClick={() => load()} disabled={loading}
              className="text-xs text-[rgba(16,185,129,.4)] hover:text-[#10b981] transition-colors">{loading ? '⟳' : '↻'}</button>
          </div>

          {data && data.total === 0 && (
            <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhuma resposta NPS no período. O modal aparece para usuários com 5+ transcrições.</div>
          )}

          {data && data.total > 0 && (
            <>
              {/* Score principal */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'NPS Score', value: data.npsScore != null ? `${data.npsScore > 0 ? '+' : ''}${data.npsScore}` : '—', color: npsColor(data.npsScore) },
                  { label: 'Avg Score', value: data.avgScore ?? '—', color: '#60a5fa' },
                  { label: 'Promotores', value: `${data.promoters} (${data.total ? Math.round(data.promoters/data.total*100) : 0}%)`, color: '#10b981' },
                  { label: 'Detratores', value: `${data.detractors} (${data.total ? Math.round(data.detractors/data.total*100) : 0}%)`, color: '#f87171' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-[#132621] rounded-lg p-3 text-center">
                    <div className="text-lg font-black" style={{ color }}>{value}</div>
                    <div className="text-[9px] text-[rgba(16,185,129,.4)] mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {/* Distribuição 0-10 */}
              <div>
                <div className="text-[10px] text-[rgba(16,185,129,.4)] mb-2 uppercase tracking-wide">Distribuição por nota</div>
                <div className="flex items-end gap-1 h-16">
                  {Object.entries(data.distribution).map(([score, count]: [string, any]) => {
                    const maxC = Math.max(...Object.values(data.distribution) as number[], 1);
                    const pct  = (count / maxC) * 100;
                    const col  = Number(score) >= 9 ? '#10b981' : Number(score) >= 7 ? '#fbbf24' : '#f87171';
                    return (
                      <div key={score} className="flex-1 flex flex-col items-center gap-0.5" title={`${score}: ${count}`}>
                        <div className="w-full rounded-t transition-all" style={{ height: `${Math.max(4, pct)}%`, background: col, opacity: 0.7 }} />
                        <span className="text-[7px] text-[rgba(16,185,129,.4)]">{score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Comentários recentes */}
              {data.recent.some((r: any) => r.comment) && (
                <div>
                  <div className="text-[10px] text-[rgba(16,185,129,.4)] mb-2 uppercase tracking-wide">Comentários recentes</div>
                  <div className="space-y-2">
                    {data.recent.filter((r: any) => r.comment).slice(0, 5).map((r: any, i: number) => (
                      <div key={i} className="bg-[#132621] rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold" style={{ color: npsColor(null) }}>{'⭐'.repeat(Math.round(r.score / 2))} {r.score}/10</span>
                          <span className="text-[10px] text-[rgba(16,185,129,.3)]">{r.email}</span>
                          <span className="text-[10px] text-[rgba(16,185,129,.3)] ml-auto">{r.createdAt ? new Date(r.createdAt).toLocaleDateString('pt-BR') : '—'}</span>
                        </div>
                        <p className="text-xs text-[#d1fae5]/80 italic">"{r.comment}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   CAMPANHAS — envio em massa com filtros
══════════════════════════════════════════════════════════ */
function CampanhasTab({ apiBase, token, notify }: {
  apiBase: string; token: string;
  notify: (text: string, type?: 'ok' | 'err' | 'warn') => void;
}) {
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  // Filtros
  const [plans, setPlans]                 = useState<string[]>([]);
  const [minDaysInactive, setMinDays]     = useState('');
  const [hasNeverUsed, setNeverUsed]      = useState(false);
  const [emailVerifiedF, setEmailVerified] = useState(false);
  const [includeTesters, setTesters]      = useState(false);
  const [includeFree, setFree]            = useState(false);
  const [hasDocument, setHasDocument]     = useState(false);

  // Modo de seleção: por filtro automático OU escolha manual de usuários
  const [mode, setMode]             = useState<'filter' | 'manual'>('filter');
  const [userQuery, setUserQuery]   = useState('');
  const [userResults, setUserResults] = useState<any[]>([]);
  const [searching, setSearching]   = useState(false);
  const [selected, setSelected]     = useState<Record<string, string>>({}); // id -> email

  // Mensagem
  const [channel, setChannel]   = useState<'whatsapp' | 'email' | 'both'>('email');
  const [message, setMessage]   = useState('');
  const [subject, setSubject]   = useState('');

  // Preview
  const [preview, setPreview]       = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);

  // Envio
  const [sending, setSending]         = useState(false);
  const [result, setResult]           = useState<any>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  function togglePlan(p: string) {
    setPlans(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }

  function buildFilters() {
    // Modo manual: ignora todos os filtros e usa apenas os usuários escolhidos.
    if (mode === 'manual') {
      return { userIds: Object.keys(selected) };
    }
    return {
      plans:            plans.length > 0 ? plans : undefined,
      minDaysInactive:  minDaysInactive ? Number(minDaysInactive) : undefined,
      hasNeverUsed:     hasNeverUsed || undefined,
      emailVerified:    emailVerifiedF || undefined,
      includeTesters:   includeTesters || undefined,
      includeFree:      includeFree || undefined,
      hasDocument:      hasDocument || undefined,
    };
  }

  async function searchCampaignUsers() {
    if (!userQuery.trim()) { setUserResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `${apiBase}/sys/g5r8t2/users?search=${encodeURIComponent(userQuery.trim())}&limit=25`,
        { headers: h },
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro na busca');
      setUserResults(d.users || []);
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally {
      setSearching(false);
    }
  }

  function toggleSelectedUser(id: string, email: string) {
    setSelected(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = email;
      return next;
    });
    setPreview(null);
    setResult(null);
  }

  // ── Templates de campanha prontos ────────────────────────────────────────────
  const TEMPLATES = [
    {
      icon: '🎙️',
      name: 'Boas-vindas',
      desc: 'Free · 1ª transcrição',
      applyFilters: () => { setPlans([]); setFree(true); setNeverUsed(true); setMinDays(''); setHasDocument(false); setTesters(false); },
      subject: '🎙️ Sua primeira transcrição está a um passo — faça agora!',
      msg: `Olá! Tudo bem?

Você criou sua conta no ZapScript há pouco tempo — mas ainda não fez a sua primeira transcrição.

Sabe aquele áudio longo que você recebe no WhatsApp e fica com preguiça de ouvir? O ZapScript resolve isso em segundos: transcreve, resume em tópicos e ainda te diz o que é importante.

✨ Para começar agora mesmo:
1. Acesse zapscript.me/dashboard
2. Clique em "Números" e conecte seu WhatsApp (leva menos de 1 minuto)
3. Receba qualquer áudio — o ZapScript transcreve automaticamente!

Seu plano gratuito já vem com minutos prontos para usar. Não deixa expirar 😉

👉 https://www.zapscript.me/dashboard

Qualquer dúvida é só responder este e-mail — respondemos rápido.

Um abraço,
Equipe ZapScript`,
    },
    {
      icon: '📱',
      name: 'Conectar número',
      desc: 'Free · sem número WA',
      applyFilters: () => { setPlans([]); setFree(true); setNeverUsed(true); setMinDays(''); setHasDocument(false); setTesters(false); },
      subject: '📱 Conecte seu WhatsApp e comece a transcrever',
      msg: `Olá! Aqui é o time do ZapScript 👋

Notamos que você criou sua conta mas ainda não conectou nenhum número de WhatsApp — e sem isso o ZapScript não consegue transcrever seus áudios.

A boa notícia: conectar é bem simples e leva menos de 60 segundos!

Como fazer:
1️⃣ Acesse: https://www.zapscript.me/dashboard/numeros
2️⃣ Clique em "Adicionar número"
3️⃣ Abra o WhatsApp no celular → Menu → Dispositivos conectados → Escanear QR code
4️⃣ Pronto! A partir daí, todo áudio que você receber será transcrito automaticamente.

Sem mensalidade agora, sem cartão de crédito. O plano gratuito já te dá minutos para experimentar.

👉 Conectar agora: https://www.zapscript.me/dashboard/numeros

Qualquer dúvida, responda este e-mail — estamos aqui!

Equipe ZapScript`,
    },
    {
      icon: '⚡',
      name: 'Upgrade por limite',
      desc: 'Free ativos · limite',
      applyFilters: () => { setPlans([]); setFree(true); setNeverUsed(false); setMinDays(''); setHasDocument(false); setTesters(false); },
      subject: '⚡ Seus minutos estão acabando — não pare agora',
      msg: `Olá! Boas notícias e uma notícia chata 😅

A boa: você já está usando o ZapScript e sabe como ele economiza tempo.
A chata: no plano gratuito os minutos são limitados — e podem acabar logo.

Quando zerar, você fica sem transcrições até o próximo ciclo. Já imaginou perder um áudio importante por isso?

O plano Pro resolve de vez:
⚡ 300 minutos/mês — 10x mais que o gratuito
🔍 Busca nas suas transcrições antigas
📤 Exportação em CSV para organizar tudo
📱 Conecte até 3 números simultâneos

Tudo por R$39,90/mês — menos que uma pizza. Cancele quando quiser.

👉 Fazer upgrade: https://www.zapscript.me/dashboard/plano

Não perca o ritmo que você já criou 💪

Equipe ZapScript`,
    },
    {
      icon: '💎',
      name: 'Upgrade Executive',
      desc: 'Pro · upsell Executive',
      applyFilters: () => { setPlans(['pro']); setFree(false); setNeverUsed(false); setMinDays(''); setHasDocument(false); setTesters(false); },
      subject: '💎 Você usa muito o ZapScript — hora de ir para o Executive',
      msg: `Olá! Você é um dos nossos usuários mais ativos no plano Pro. Isso é incrível! 🎉

Mas percebemos que usuários no seu perfil costumam bater no limite de minutos antes do fim do mês — e a gente não quer que isso aconteça com você.

O plano Executive foi feito para quem usa de verdade:
💎 300 minutos/mês (o triplo do Pro)
🔒 Modo Privado: transcrição enviada só para você, não para o remetente
📤 Exportação em PDF, DOCX, CSV e XLS
📱 Até 3 números simultâneos

Por apenas R$20,00/mês a mais — ou seja, R$49,90 total.

👉 Ver plano Executive: https://www.zapscript.me/dashboard/plano

Se quiser conversar antes de decidir, é só responder este e-mail.

Equipe ZapScript`,
    },
    {
      icon: '🏢',
      name: 'Para Empresas',
      desc: 'CNPJs cadastrados',
      applyFilters: () => { setPlans([]); setFree(true); setNeverUsed(false); setMinDays(''); setHasDocument(true); setTesters(false); },
      subject: '🏢 Sua empresa merece um ZapScript à altura',
      msg: `Olá! Vimos que você usa o ZapScript com um CNPJ — isso nos diz que você tem uma operação profissional para cuidar.

Empresas que usam o ZapScript para times de vendas, jurídico ou atendimento normalmente precisam de mais do que os planos individuais oferecem.

Por isso criamos o plano Executive — feito para empresas:
💎 1.200 minutos/mês para toda a equipe
🔒 Modo privado: transcrições chegam só no número da empresa, não para o contato
🔗 Webhook personalizado: integre com CRM, ERP ou qualquer sistema via API
📱 Números ilimitados para cada membro do time
🏷️ Tags e exportação avançada para relatórios

Tudo por R$49,90/mês — sem taxa de implantação, sem fidelidade.

👉 Ver plano Executive: https://www.zapscript.me/dashboard/plano

Ou se preferir, me responda que conversamos sobre o que faz mais sentido para o seu caso.

Equipe ZapScript`,
    },
  ] as const;

  async function doPreview() {
    // Guarda crítica: em modo manual sem ninguém selecionado, o backend
    // trataria userIds vazio como "sem seleção" e cairia no filtro de todos
    // os pagantes. Bloqueamos aqui para evitar envio acidental em massa.
    if (mode === 'manual' && Object.keys(selected).length === 0) {
      notify('Selecione ao menos um usuário', 'warn');
      return;
    }
    setPreviewing(true); setPreview(null); setResult(null);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/campaigns/preview`, {
        method: 'POST', headers: h, body: JSON.stringify(buildFilters()),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      setPreview(d);
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setPreviewing(false); }
  }

  async function doSend() {
    if (!message.trim()) { notify('❌ Digite a mensagem', 'err'); return; }
    if (mode === 'manual' && Object.keys(selected).length === 0) {
      notify('Selecione ao menos um usuário', 'warn'); return;
    }
    setSending(true); setConfirmSend(false); setResult(null);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/campaigns/send`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ ...buildFilters(), channel, message, subject: subject || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      setResult(d);
      notify(`✅ Campanha enviada: ${d.sent} de ${d.total}`, 'ok');
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setSending(false); }
  }

  const planOpts: [string, string][] = [
    ['free',       '🆓 Free'],
    ['pro',        '⚡ Pro'],
    ['ultra',      '🚀 Ultra'],
    ['executive',  '💎 Executive'],
    ['pro-tester', '🧪 Pro Tester'],
  ];

  return (
    <div className="space-y-5">

      {/* Templates prontos */}
      <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
        <div className="text-sm font-bold text-[#d1fae5] mb-1">📋 Templates Prontos</div>
        <p className="text-[10px] text-[rgba(16,185,129,.4)] mb-4">Clique para carregar filtros + mensagem automaticamente.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.name}
              type="button"
              onClick={() => {
                tpl.applyFilters();
                setSubject(tpl.subject);
                setMessage(tpl.msg);
                setPreview(null);
                setResult(null);
                setConfirmSend(false);
                notify(`✅ Template "${tpl.name}" carregado`, 'ok');
              }}
              className="flex flex-col items-start gap-1 bg-[#132621] hover:bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.1)] hover:border-[rgba(16,185,129,.25)] rounded-xl p-3 text-left transition-colors group"
            >
              <span className="text-xl">{tpl.icon}</span>
              <span className="text-xs font-bold text-[#d1fae5] group-hover:text-[#10b981] transition-colors">{tpl.name}</span>
              <span className="text-[10px] text-[rgba(16,185,129,.4)]">{tpl.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Filtros de segmentação */}
      <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="text-sm font-bold text-[#d1fae5]">🎯 Segmentação</div>
          <div className="flex gap-1 bg-[#132621] rounded-lg p-1 border border-[rgba(16,185,129,.1)]">
            {([['filter', '🎯 Por filtro'], ['manual', '👤 Selecionar usuários']] as const).map(([m, label]) => (
              <button key={m} type="button"
                onClick={() => { setMode(m); setPreview(null); setResult(null); setConfirmSend(false); }}
                className={`text-[11px] px-3 py-1 rounded-md font-semibold transition-colors ${
                  mode === m
                    ? 'bg-[rgba(16,185,129,.15)] text-[#10b981]'
                    : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'filter' && (
        <div className="space-y-4">

          {/* Planos */}
          <div>
            <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-2">Planos (vazio = todos pagantes)</div>
            <div className="flex flex-wrap gap-2">
              {planOpts.map(([p, label]) => (
                <button key={p} type="button" onClick={() => togglePlan(p)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                    plans.includes(p)
                      ? 'bg-[rgba(16,185,129,.15)] border-[rgba(16,185,129,.3)] text-[#10b981]'
                      : 'bg-[#132621] border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.4)]'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Checkboxes + inatividade */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-[rgba(16,185,129,.4)] mb-1.5 uppercase tracking-wide">Dias sem atividade (mín.)</label>
              <input type="number" min="1" value={minDaysInactive} onChange={e => setMinDays(e.target.value)}
                placeholder="Ex: 14"
                className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] font-mono outline-none focus:border-[rgba(16,185,129,.35)]" />
            </div>
            {([
              [hasNeverUsed,    setNeverUsed,      'Nunca usou o sistema'],
              [emailVerifiedF,  setEmailVerified,  'E-mail verificado'],
              [includeTesters,  setTesters,        'Incluir testers'],
              [includeFree,     setFree,           'Incluir plano free'],
              [hasDocument,     setHasDocument,    '🏢 Apenas empresas (CNPJ)'],
            ] as [boolean, (v: boolean) => void, string][]).map(([val, setter, label]) => (
              <label key={label} className="flex items-center gap-2.5 cursor-pointer bg-[#132621] rounded-lg px-3 py-2 border border-[rgba(16,185,129,.08)] hover:border-[rgba(16,185,129,.2)] transition-colors">
                <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} className="accent-[#10b981] w-3.5 h-3.5" />
                <span className="text-xs text-[rgba(16,185,129,.7)]">{label}</span>
              </label>
            ))}
          </div>

        </div>
        )}

        {/* Seleção manual de usuários */}
        {mode === 'manual' && (
          <div className="space-y-3">
            <p className="text-[10px] text-[rgba(16,185,129,.4)]">
              Busque por e-mail ou nome e marque exatamente quem deve receber. Os filtros automáticos são ignorados neste modo.
            </p>
            <div className="flex gap-2">
              <input
                value={userQuery}
                onChange={e => setUserQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchCampaignUsers(); }}
                placeholder="Buscar por e-mail ou nome..."
                className="flex-1 bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)]"
              />
              <Btn variant="ghost" disabled={searching} onClick={searchCampaignUsers} cls="px-4">
                {searching ? '⟳' : '🔍 Buscar'}
              </Btn>
            </div>

            {/* Selecionados */}
            {Object.keys(selected).length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mr-1">
                  {Object.keys(selected).length} selecionado(s):
                </span>
                {Object.entries(selected).map(([id, email]) => (
                  <span key={id} className="flex items-center gap-1.5 text-[10px] bg-[rgba(16,185,129,.12)] border border-[rgba(16,185,129,.25)] text-[#10b981] rounded-full pl-2.5 pr-1.5 py-1">
                    {maskEmail(email)}
                    <button type="button" onClick={() => toggleSelectedUser(id, email)} className="hover:text-red-400">✕</button>
                  </span>
                ))}
                <button type="button" onClick={() => { setSelected({}); setPreview(null); setResult(null); }}
                  className="text-[10px] text-red-400/70 hover:text-red-400 px-2">limpar tudo</button>
              </div>
            )}

            {/* Resultados da busca */}
            {userResults.length > 0 && (
              <div className="max-h-60 overflow-auto rounded-lg border border-[rgba(16,185,129,.1)] divide-y divide-[rgba(16,185,129,.06)]">
                {userResults.map((u: any) => {
                  const isSel = !!selected[u.id];
                  const plan = u.subscription?.plan?.name || u.plan || 'free';
                  return (
                    <button key={u.id} type="button" onClick={() => toggleSelectedUser(u.id, u.email)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        isSel ? 'bg-[rgba(16,185,129,.08)]' : 'hover:bg-[rgba(16,185,129,.04)]'
                      }`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                        isSel ? 'bg-[#10b981] border-[#10b981] text-[#011a12]' : 'border-[rgba(16,185,129,.3)]'
                      }`}>{isSel ? '✓' : ''}</span>
                      <span className="flex-1 text-xs text-[#d1fae5] truncate">{u.email}</span>
                      <Badge label={plan} cls={PLAN_CLS[plan] || PLAN_CLS.free} />
                    </button>
                  );
                })}
              </div>
            )}
            {userQuery && !searching && userResults.length === 0 && (
              <p className="text-[10px] text-[rgba(16,185,129,.4)]">Nenhum usuário encontrado — ajuste a busca e tente de novo.</p>
            )}
          </div>
        )}

        <Btn variant="ghost" disabled={previewing} onClick={doPreview} cls="px-5 mt-4">
          {previewing ? '⟳ Calculando...'
            : mode === 'manual'
              ? `🔍 Confirmar ${Object.keys(selected).length} selecionado(s)`
              : '🔍 Calcular destinatários'}
        </Btn>

        {/* Resultado do preview */}
        {preview && (
          <div className="mt-4 bg-[#132621] rounded-xl p-4 border border-[rgba(16,185,129,.12)]">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl font-black text-[#10b981]">{preview.total}</span>
              <span className="text-sm text-[rgba(16,185,129,.6)]">destinatário(s)</span>
            </div>
            {preview.sample?.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1.5">Amostra</div>
                {preview.sample.map((u: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="text-[rgba(16,185,129,.6)]">{maskEmail(u.email)}</span>
                    <Badge label={u.plan} cls={PLAN_CLS[u.plan] || PLAN_CLS.free} />
                    {u.hasPhone && <span className="text-[10px] text-green-400">📱 WA</span>}
                  </div>
                ))}
                {preview.total > preview.sample.length && (
                  <div className="text-[10px] text-[rgba(16,185,129,.3)] mt-1">+ {preview.total - preview.sample.length} outros</div>
                )}
              </div>
            )}
            {preview.total === 0 && (
              <p className="text-xs text-yellow-400">⚠️ Nenhum destinatário encontrado com esses filtros.</p>
            )}
          </div>
        )}
      </div>

      {/* Composição da mensagem */}
      <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
        <div className="text-sm font-bold text-[#d1fae5] mb-4">✍️ Mensagem</div>
        <div className="space-y-3">

          {/* Canal */}
          <div>
            <div className="text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-2">Canal de envio</div>
            <div className="flex gap-1.5">
              {([['whatsapp', '📱 WhatsApp'], ['email', '📧 E-mail'], ['both', '📨 Ambos']] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setChannel(v)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border font-semibold transition-colors ${
                    channel === v
                      ? 'bg-[rgba(16,185,129,.15)] border-[rgba(16,185,129,.3)] text-[#10b981]'
                      : 'bg-[#132621] border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.4)]'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            {channel === 'whatsapp' && (
              <p className="text-[10px] text-yellow-400 mt-2">⚠️ WhatsApp usa o número Evolution API configurado. Apenas usuários com número conectado receberão.</p>
            )}
          </div>

          {/* Assunto (email) */}
          {(channel === 'email' || channel === 'both') && (
            <div>
              <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1.5">Assunto do e-mail</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Ex: Novidade no ZapScript para você!"
                className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)]"
              />
            </div>
          )}

          {/* Texto */}
          <div>
            <label className="block text-[10px] text-[rgba(16,185,129,.4)] uppercase tracking-wide mb-1.5">Texto da mensagem</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Olá! Temos uma novidade no ZapScript..."
              rows={6}
              className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)] resize-none"
            />
            <div className="text-[10px] text-[rgba(16,185,129,.3)] mt-1 text-right">{message.length} chars</div>
          </div>

          {/* Botão enviar */}
          {!confirmSend ? (
            <Btn variant="primary"
              disabled={!message.trim() || !preview || preview.total === 0 || sending}
              onClick={() => setConfirmSend(true)}
              cls="w-full justify-center py-2.5">
              📣 Enviar campanha para {preview?.total ?? '?'} destinatário(s)
            </Btn>
          ) : (
            <div className="bg-yellow-900/20 border border-yellow-400/20 rounded-xl p-4">
              <div className="text-sm font-bold text-yellow-400 mb-3">
                ⚠️ Confirmar envio para {preview?.total} destinatário(s)?
              </div>
              <p className="text-xs text-yellow-400/70 mb-4">
                Esta ação não pode ser desfeita. Os usuários receberão a mensagem agora.
              </p>
              <div className="flex gap-2">
                <Btn variant="danger" disabled={sending} onClick={doSend} cls="flex-1 justify-center py-2">
                  {sending ? '⟳ Enviando...' : '🚀 Sim, enviar agora'}
                </Btn>
                <Btn variant="ghost" disabled={sending} onClick={() => setConfirmSend(false)} cls="flex-1 justify-center py-2">
                  ✕ Cancelar
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resultado do envio */}
      {result && (
        <div className={`border rounded-xl p-5 ${result.failed === 0 ? 'bg-[rgba(16,185,129,.06)] border-[rgba(16,185,129,.2)]' : 'bg-yellow-900/10 border-yellow-400/20'}`}>
          <div className="text-sm font-bold text-[#d1fae5] mb-3">📊 Resultado da Campanha</div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-[#132621] rounded-lg p-3 text-center">
              <div className="text-2xl font-black text-[#10b981]">{result.sent}</div>
              <div className="text-[10px] text-[rgba(16,185,129,.4)]">Enviados</div>
            </div>
            <div className="bg-[#132621] rounded-lg p-3 text-center">
              <div className="text-2xl font-black text-red-400">{result.failed}</div>
              <div className="text-[10px] text-[rgba(16,185,129,.4)]">Falhos</div>
            </div>
            <div className="bg-[#132621] rounded-lg p-3 text-center">
              <div className="text-2xl font-black text-[#d1fae5]">{result.total}</div>
              <div className="text-[10px] text-[rgba(16,185,129,.4)]">Total</div>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <details className="mt-2">
              <summary className="text-[10px] text-red-400 cursor-pointer hover:text-red-300">
                {result.errors.length} erro(s) ↓
              </summary>
              <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                {result.errors.slice(0, 20).map((e: any, i: number) => (
                  <div key={i} className="text-[10px] text-red-300/70 bg-red-900/10 rounded px-2 py-1">
                    {maskEmail(e.email)}: {e.error}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   METAS — atuais semanais/mensais + metas (targets) editáveis
══════════════════════════════════════════════════════════ */
function MetasTab({ apiBase, token, notify }: {
  apiBase: string; token: string; notify: (t: string, ty?: 'ok' | 'err' | 'warn') => void;
}) {
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [targets, setTargets] = useState<any>({ week: {}, month: {} });

  async function load() {
    setLoading(true);
    try {
      const d = await (await fetch(`${apiBase}/sys/g5r8t2/metas`, { headers: h })).json();
      setData(d);
      setTargets(d.targets || { week: {}, month: {} });
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function saveTargets() {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/alert-config`, {
        method: 'POST', headers: h, body: JSON.stringify({ 'metas.targets': targets }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      notify('✅ Metas salvas', 'ok');
      setEdit(false);
      load();
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setSaving(false); }
  }

  const fields: [string, string, boolean][] = [
    ['cadastros',   'Cadastros',   false],
    ['ativacoes',   'Ativações',   false],
    ['assinaturas', 'Assinaturas', false],
    ['receita',     'Receita',     true],
  ];

  function Period({ id, label }: { id: 'week' | 'month'; label: string }) {
    const actual = data?.[id]?.actual || {};
    const tgt    = targets?.[id] || {};
    return (
      <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
        <div className="text-sm font-bold text-[#d1fae5] mb-4">{label}</div>
        <div className="space-y-4">
          {fields.map(([key, lbl, isMoney]) => {
            const a   = Number(actual[key] || 0);
            const t   = Number(tgt[key] || 0);
            const pct = t > 0 ? Math.min(Math.round((a / t) * 100), 100) : 0;
            const fmtV = (v: number) => isMoney ? brl(v) : String(v);
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[rgba(16,185,129,.6)]">{lbl}</span>
                  {edit ? (
                    <input type="number" value={tgt[key] ?? ''} placeholder="meta"
                      onChange={e => setTargets((p: any) => ({ ...p, [id]: { ...p[id], [key]: e.target.value === '' ? undefined : Number(e.target.value) } }))}
                      className="w-24 text-xs bg-[#132621] border border-[rgba(16,185,129,.2)] rounded px-2 py-1 text-[#d1fae5] outline-none text-right" />
                  ) : (
                    <span className="text-sm font-bold text-[#d1fae5]">
                      {fmtV(a)} {t > 0 && <span className="text-xs text-[rgba(16,185,129,.4)] font-normal">/ {fmtV(t)}</span>}
                    </span>
                  )}
                </div>
                {!edit && t > 0 && <ProgressBar pct={pct} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando metas...</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-[rgba(16,185,129,.4)]">Acompanhamento de metas — valores reais do período vs. metas definidas.</div>
        {edit ? (
          <div className="flex gap-2">
            <Btn variant="primary" onClick={saveTargets} disabled={saving}>{saving ? '⟳' : '💾 Salvar metas'}</Btn>
            <Btn variant="ghost" onClick={() => { setEdit(false); setTargets(data?.targets || { week: {}, month: {} }); }}>Cancelar</Btn>
          </div>
        ) : (
          <Btn variant="ghost" onClick={() => setEdit(true)}>✏️ Definir metas</Btn>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Period id="week"  label="📅 Semanal" />
        <Period id="month" label="🗓️ Mensal" />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PROPAGANDA — registro e mensuração de propagandas/ações
══════════════════════════════════════════════════════════ */
function PropagandaPanel({ apiBase, token, notify }: {
  apiBase: string; token: string; notify: (t: string, ty?: 'ok' | 'err' | 'warn') => void;
}) {
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState<any>({ nome: '', canal: '', publicoAlvo: '', custo: '', retornoQtd: '', retornoValor: '' });

  async function load() {
    setLoading(true);
    try {
      const d = await (await fetch(`${apiBase}/sys/g5r8t2/alert-config`, { headers: h })).json();
      setItems(Array.isArray(d['marketing.propaganda']) ? d['marketing.propaganda'] : []);
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function persist(next: any[]) {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/alert-config`, {
        method: 'POST', headers: h, body: JSON.stringify({ 'marketing.propaganda': next }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      setItems(next);
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setSaving(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) { notify('Informe o nome da ação', 'warn'); return; }
    const entry = {
      id:           Date.now().toString(36),
      nome:         form.nome.trim(),
      canal:        form.canal.trim(),
      publicoAlvo:  form.publicoAlvo.trim(),
      custo:        Number(form.custo) || 0,
      retornoQtd:   Number(form.retornoQtd) || 0,
      retornoValor: Number(form.retornoValor) || 0,
      data:         new Date().toISOString(),
    };
    await persist([entry, ...items]);
    setForm({ nome: '', canal: '', publicoAlvo: '', custo: '', retornoQtd: '', retornoValor: '' });
    notify('✅ Ação registrada', 'ok');
  }

  async function remove(id: string) {
    if (!confirm('Excluir esta ação?')) return;
    await persist(items.filter(i => i.id !== id));
    notify('🗑 Removida', 'ok');
  }

  const totals = items.reduce((a, i) => ({
    custo:        a.custo + (i.custo || 0),
    retornoQtd:   a.retornoQtd + (i.retornoQtd || 0),
    retornoValor: a.retornoValor + (i.retornoValor || 0),
  }), { custo: 0, retornoQtd: 0, retornoValor: 0 });
  const roi = totals.custo > 0 ? ((totals.retornoValor - totals.custo) / totals.custo) * 100 : null;

  const inp = "bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-2 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.3)]";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon="💸" title="Custo total" value={brl(totals.custo)} sub={`${items.length} ação(ões)`} color="#f87171" />
        <KpiCard icon="👥" title="Retorno (qtd)" value={totals.retornoQtd} sub="conversões / leads" color="#60a5fa" />
        <KpiCard icon="💰" title="Retorno (valor)" value={brl(totals.retornoValor)} sub="receita atribuída" color="#34d399" />
        <KpiCard icon="📈" title="ROI" value={roi === null ? '—' : `${roi.toFixed(0)}%`} sub="retorno sobre custo" color={roi !== null && roi >= 0 ? '#10b981' : '#f87171'} />
      </div>

      <form onSubmit={add} className="bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-xl p-5 space-y-3">
        <div className="text-sm font-bold text-[#d1fae5]">➕ Registrar propaganda / ação</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className={inp} placeholder="Nome (ex: Anúncio Instagram)" value={form.nome} onChange={e => setForm((f: any) => ({ ...f, nome: e.target.value }))} required />
          <input className={inp} placeholder="Canal (ex: Meta Ads)" value={form.canal} onChange={e => setForm((f: any) => ({ ...f, canal: e.target.value }))} />
          <input className={inp} placeholder="Público-alvo" value={form.publicoAlvo} onChange={e => setForm((f: any) => ({ ...f, publicoAlvo: e.target.value }))} />
          <input className={inp} type="number" step="0.01" placeholder="Custo (R$)" value={form.custo} onChange={e => setForm((f: any) => ({ ...f, custo: e.target.value }))} />
          <input className={inp} type="number" placeholder="Retorno (qtd)" value={form.retornoQtd} onChange={e => setForm((f: any) => ({ ...f, retornoQtd: e.target.value }))} />
          <input className={inp} type="number" step="0.01" placeholder="Retorno (R$)" value={form.retornoValor} onChange={e => setForm((f: any) => ({ ...f, retornoValor: e.target.value }))} />
        </div>
        <Btn variant="primary" cls="w-full justify-center py-2.5" disabled={saving}>{saving ? '⟳ Salvando...' : '➕ Adicionar'}</Btn>
      </form>

      <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-[rgba(16,185,129,.08)]">
              {['Ação', 'Canal', 'Público', 'Custo', 'Ret. Qtd', 'Ret. Valor', 'ROI', ''].map(c => (
                <th key={c} className="px-4 py-3 text-left text-[10px] font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhuma ação registrada</td></tr>
            ) : items.map(i => {
              const r = i.custo > 0 ? ((i.retornoValor - i.custo) / i.custo) * 100 : null;
              return (
                <tr key={i.id} className="border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)]">
                  <td className="px-4 py-3 text-xs text-[#d1fae5] font-semibold">{i.nome}<div className="text-[10px] text-[rgba(16,185,129,.3)]">{fmt(i.data)}</div></td>
                  <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)]">{i.canal || '—'}</td>
                  <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)]">{i.publicoAlvo || '—'}</td>
                  <td className="px-4 py-3 text-xs text-red-400/80 font-mono">{brl(i.custo)}</td>
                  <td className="px-4 py-3 text-xs text-blue-400 font-mono text-right">{i.retornoQtd}</td>
                  <td className="px-4 py-3 text-xs text-green-400 font-mono">{brl(i.retornoValor)}</td>
                  <td className={`px-4 py-3 text-xs font-bold font-mono ${r === null ? 'text-[rgba(16,185,129,.3)]' : r >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r === null ? '—' : `${r.toFixed(0)}%`}</td>
                  <td className="px-4 py-3"><Btn variant="danger" onClick={() => remove(i.id)}>🗑</Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   FINANCEIRO — custos, receita, margem, DRE, lucro
══════════════════════════════════════════════════════════ */
function FinanceiroPanel({ apiBase, token, notify, stats }: {
  apiBase: string; token: string; notify: (t: string, ty?: 'ok' | 'err' | 'warn') => void; stats: any;
}) {
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };
  const [custos, setCustos] = useState<{ custoFixo: number; custoVariavel: number }>({ custoFixo: 0, custoVariavel: 0 });
  const [draft, setDraft]   = useState<{ custoFixo: string; custoVariavel: string }>({ custoFixo: '', custoVariavel: '' });
  const [edit, setEdit]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await (await fetch(`${apiBase}/sys/g5r8t2/alert-config`, { headers: h })).json();
      const c = d['financeiro.custos'] || {};
      const next = { custoFixo: Number(c.custoFixo) || 0, custoVariavel: Number(c.custoVariavel) || 0 };
      setCustos(next);
      setDraft({ custoFixo: String(next.custoFixo), custoVariavel: String(next.custoVariavel) });
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function save() {
    setSaving(true);
    const next = { custoFixo: Number(draft.custoFixo) || 0, custoVariavel: Number(draft.custoVariavel) || 0 };
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/alert-config`, {
        method: 'POST', headers: h, body: JSON.stringify({ 'financeiro.custos': next }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      setCustos(next); setEdit(false);
      notify('✅ Custos salvos', 'ok');
    } catch (e: any) { notify(`❌ ${e.message}`, 'err'); }
    finally { setSaving(false); }
  }

  const receita       = Number(stats?.mrr) || 0;
  const custoTotal    = custos.custoFixo + custos.custoVariavel;
  const margemContrib = receita - custos.custoVariavel;
  const lucro         = receita - custoTotal;
  const margemPct     = receita > 0 ? (lucro / receita) * 100 : 0;

  const inp = "w-32 text-sm bg-[#132621] border border-[rgba(16,185,129,.2)] rounded px-2 py-1 text-[#d1fae5] outline-none text-right";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon="💰" title="Receita (MRR)" value={brl(receita)} sub="recorrente mensal" color="#34d399" />
        <KpiCard icon="💸" title="Custo do mês" value={brl(custoTotal)} sub={`fixo ${brl(custos.custoFixo)} · var ${brl(custos.custoVariavel)}`} color="#f87171" />
        <KpiCard icon="🧮" title="Margem" value={`${margemPct.toFixed(0)}%`} sub="lucro / receita" color={margemPct >= 0 ? '#10b981' : '#f87171'} />
        <KpiCard icon="📊" title="Lucro do mês" value={brl(lucro)} sub={lucro >= 0 ? 'resultado positivo' : 'resultado negativo'} color={lucro >= 0 ? '#10b981' : '#f87171'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-[#d1fae5]">Custos</div>
            {edit ? (
              <div className="flex gap-2">
                <Btn variant="primary" onClick={save} disabled={saving}>{saving ? '⟳' : '💾 Salvar'}</Btn>
                <Btn variant="ghost" onClick={() => { setEdit(false); setDraft({ custoFixo: String(custos.custoFixo), custoVariavel: String(custos.custoVariavel) }); }}>Cancelar</Btn>
              </div>
            ) : <Btn variant="ghost" onClick={() => setEdit(true)}>✏️ Editar</Btn>}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[rgba(16,185,129,.6)]">Custo fixo (mensal)</span>
              {edit ? <input className={inp} type="number" step="0.01" value={draft.custoFixo} onChange={e => setDraft(d => ({ ...d, custoFixo: e.target.value }))} />
                    : <span className="text-sm font-bold text-[#d1fae5]">{brl(custos.custoFixo)}</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[rgba(16,185,129,.6)]">Custo variável (mensal)</span>
              {edit ? <input className={inp} type="number" step="0.01" value={draft.custoVariavel} onChange={e => setDraft(d => ({ ...d, custoVariavel: e.target.value }))} />
                    : <span className="text-sm font-bold text-[#d1fae5]">{brl(custos.custoVariavel)}</span>}
            </div>
            <div className="pt-2 border-t border-[rgba(16,185,129,.08)] flex items-center justify-between">
              <span className="text-xs text-[rgba(16,185,129,.6)]">Risco × Retorno</span>
              <span className="text-xs font-bold text-[#d1fae5]">
                {custos.custoFixo > 0 ? `${(lucro / custos.custoFixo).toFixed(2)}× ` : '— '}
                <span className="text-[10px] text-[rgba(16,185,129,.4)] font-normal">(lucro / custo fixo)</span>
              </span>
            </div>
          </div>
          {loading && <div className="text-[10px] text-[rgba(16,185,129,.3)] mt-3">Carregando custos...</div>}
        </div>

        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
          <div className="text-sm font-bold text-[#d1fae5] mb-4">DRE mensal</div>
          <div className="space-y-2">
            {([
              ['Receita bruta (MRR)', receita, '#34d399'],
              ['(−) Custo variável', -custos.custoVariavel, '#f87171'],
              ['= Margem de contribuição', margemContrib, '#d1fae5'],
              ['(−) Custo fixo', -custos.custoFixo, '#f87171'],
            ] as [string, number, string][]).map(([lbl, val, color]) => (
              <div key={lbl} className="flex items-center justify-between">
                <span className="text-xs text-[rgba(16,185,129,.6)]">{lbl}</span>
                <span className="font-mono text-sm" style={{ color }}>{brl(val)}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-[rgba(16,185,129,.12)] flex items-center justify-between">
              <span className="text-xs font-bold text-[#d1fae5]">= Lucro líquido</span>
              <span className="font-mono text-base font-black" style={{ color: lucro >= 0 ? '#10b981' : '#f87171' }}>{brl(lucro)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
