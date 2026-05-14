'use client';
import { useState, useCallback } from 'react';

const API  = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PAGE = 20;

/* ── Formatadores ──────────────────────────────────────── */
const brl     = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt     = (d: string) => new Date(d).toLocaleDateString('pt-BR');
const fmtFull = (d: string) => new Date(d).toLocaleString('pt-BR');
const fmtMin  = (m: number) => `${m.toFixed(1)} min`;

/* ── Estilos por plano / status ─────────────────────────── */
const PLAN_CLS: Record<string, string> = {
  free:  'text-gray-400 bg-gray-400/10 border-gray-400/20',
  pro:   'text-teal-400 bg-teal-400/10 border-teal-400/20',
  ultra: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
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

/* ── Componentes base ──────────────────────────────────── */
function Badge({ label, cls }: { label: string; cls?: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border ${cls || 'text-gray-400 bg-gray-400/10 border-gray-400/20'}`}>
      {label}
    </span>
  );
}

function KpiCard({ title, value, sub, color = '#10b981', icon }: {
  title: string; value: string | number; sub: string; color?: string; icon?: string;
}) {
  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5 hover:border-[rgba(16,185,129,.18)] transition-colors">
      {icon && <div className="text-2xl mb-2">{icon}</div>}
      <div className="text-xs text-[rgba(16,185,129,.4)] font-medium mb-2">{title}</div>
      <div className="text-2xl font-black leading-none mb-1" style={{ color }}>{value}</div>
      <div className="text-xs text-[rgba(16,185,129,.35)]">{sub}</div>
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

type Tab = 'overview' | 'users' | 'tickets' | 'errors' | 'testers';

/* ══════════════════════════════════════════════════════════
   PAINEL INDIVIDUAL DO USUÁRIO
══════════════════════════════════════════════════════════ */
function UserDetailPanel({ userId, token, onClose, onAction }: {
  userId: string; token: string; onClose: () => void;
  onAction: (msg: string, type: 'ok' | 'err' | 'warn') => void;
}) {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);

  // Edit inline
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

        {/* Header */}
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

          {/* ── Ações rápidas ── */}
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
            </div>
          </div>

          {/* ── Uso de minutos ── */}
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

          {/* ── Editar plano / minutos ── */}
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

          {/* ── WhatsApp números ── */}
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

          {/* ── Últimas transcrições ── */}
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

          {/* ── Auditoria ── */}
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

          {/* ── Info da conta ── */}
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
   PÁGINA PRINCIPAL
══════════════════════════════════════════════════════════ */
export default function AdminPage() {
  const [token, setToken]     = useState('');
  const [auth, setAuth]       = useState(false);
  const [stats, setStats]     = useState<any>(null);
  const [tab, setTab]         = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [loginErr, setLoginErr]     = useState('');
  const [toast, setToast]     = useState<{ text: string; type: 'ok' | 'err' | 'warn' } | null>(null);

  // Users
  const [users, setUsers]         = useState<any[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userOffset, setUserOffset] = useState(0);
  const [detailId, setDetailId]   = useState<string | null>(null);

  // Tickets
  const [tickets, setTickets]           = useState<any[]>([]);
  const [ticketTotal, setTicketTotal]   = useState(0);
  const [ticketStatus, setTicketStatus] = useState('');
  const [ticketOffset, setTicketOffset] = useState(0);

  // Testers / Invites
  const [invites, setInvites]         = useState<any[]>([]);
  const [inviteTotal, setInviteTotal] = useState(0);
  const [inviteName, setInviteName]   = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [lastInviteResult, setLastInviteResult] = useState<{
    link: string; message: string; whatsappSent: boolean; whatsappError?: string;
  } | null>(null);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  const notify = (text: string, type: 'ok' | 'err' | 'warn' = 'ok') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  /* ── Auth ── */
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setLoginErr('');
    try {
      const res = await fetch(`${API}/sys/g5r8t2/stats`, { headers: h });
      if (!res.ok) throw new Error('Token inválido');
      setStats(await res.json());
      setAuth(true);
    } catch (err: any) { setLoginErr(err.message); }
    finally { setLoading(false); }
  }

  async function refreshStats() {
    setLoading(true);
    try { setStats(await (await fetch(`${API}/sys/g5r8t2/stats`, { headers: h })).json()); }
    finally { setLoading(false); }
  }

  /* ── Loaders ── */
  async function loadUsers(search: string, offset: number) {
    setSubLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search) p.set('search', search);
      const d = await (await fetch(`${API}/sys/g5r8t2/users?${p}`, { headers: h })).json();
      setUsers(d.users || []);
      setUserTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  async function loadTickets(status: string, offset: number) {
    setSubLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (status) p.set('status', status);
      const d = await (await fetch(`${API}/sys/g5r8t2/tickets?${p}`, { headers: h })).json();
      setTickets(d.tickets || []);
      setTicketTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  async function updateTicketStatus(id: string, status: string) {
    await fetch(`${API}/sys/g5r8t2/tickets/${id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ status }),
    });
    loadTickets(ticketStatus, ticketOffset);
  }

  async function loadInvites() {
    setInviteLoading(true);
    try {
      const d = await (await fetch(`${API}/sys/g5r8t2/invites?limit=100`, { headers: h })).json();
      setInvites(d.invites || []);
      setInviteTotal(d.total || 0);
    } finally { setInviteLoading(false); }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteName.trim()) return;
    setInviteLoading(true);
    try {
      const body: any = { name: inviteName.trim() };
      if (invitePhone.trim()) body.phone = invitePhone.trim();
      const res = await fetch(`${API}/sys/g5r8t2/invites`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro');
      setLastInviteResult({ link: d.link, message: d.message, whatsappSent: d.whatsappSent, whatsappError: d.whatsappError });
      setInviteName('');
      setInvitePhone('');
      loadInvites();
      notify(d.whatsappSent ? '✅ Convite gerado e WhatsApp enviado!' : '✅ Convite gerado!', 'ok');
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setInviteLoading(false); }
  }

  function goTab(t: Tab) {
    setTab(t);
    if (t === 'users'   && users.length === 0)   loadUsers('', 0);
    if (t === 'tickets' && tickets.length === 0) loadTickets('', 0);
    if (t === 'testers') loadInvites();
  }

  /* ── Login ── */
  if (!auth) return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🛡️</div>
          <div className="font-bold text-lg text-[#d1fae5]">Admin ZapScript</div>
          <div className="text-xs text-[rgba(16,185,129,.4)] mt-1">Acesso restrito</div>
        </div>
        <form onSubmit={login} className="space-y-4">
          <input
            className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-3 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] placeholder-[rgba(16,185,129,.3)]"
            type="password" placeholder="ADMIN_TOKEN"
            value={token} onChange={e => setToken(e.target.value)} required
          />
          {loginErr && <p className="text-red-400 text-xs">{loginErr}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] disabled:opacity-50 transition-colors">
            {loading ? '⟳ Verificando...' : 'Acessar painel'}
          </button>
        </form>
      </div>
    </div>
  );

  const growth = stats ? (stats.users.month - stats.users.lastMonth) : 0;

  return (
    <>
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

        {/* Tabs */}
        <div className="flex gap-1.5 mb-6 bg-[#0d1c19] border border-[rgba(16,185,129,.08)] rounded-xl p-1.5 w-fit">
          {([
            ['overview', '📊', 'Visão Geral'],
            ['users',    '👥', 'Usuários'],
            ['tickets',  '🎫', 'Tickets'],
            ['testers',  '🧪', 'Testers'],
            ['errors',   '🐛', 'Erros'],
          ] as [Tab, string, string][]).map(([t, icon, label]) => (
            <button key={t} onClick={() => goTab(t)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                tab === t
                  ? 'bg-[rgba(16,185,129,.15)] text-[#10b981] border border-[rgba(16,185,129,.2)]'
                  : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'
              }`}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>

        {/* ═══ VISÃO GERAL ═══ */}
        {tab === 'overview' && stats && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon="👥" title="Usuários totais" value={stats.users.total} sub={`+${stats.users.today} hoje`} />
              <KpiCard icon="🎙️" title="Transcrições" value={stats.transcriptions.total} sub={`+${stats.transcriptions.today} hoje`} />
              <KpiCard icon="⏱️" title="Minutos processados" value={(stats.minutes.total || 0).toFixed(0)} sub={`${(stats.minutes.today || 0).toFixed(1)} min hoje`} />
              <KpiCard icon="🎫" title="Tickets abertos" value={stats.tickets.open} sub={`${stats.tickets.total} total`} color="#fbbf24" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon="💰" title="MRR" value={brl(stats.mrr || 0)} sub="receita mensal recorrente" color="#a78bfa" />
              <KpiCard icon="💳" title="Pagantes ativos" value={stats.conversion?.paid || 0} sub={`${(stats.conversion?.rate || 0).toFixed(1)}% conversão`} color="#34d399" />
              <KpiCard icon="📈" title="Novos este mês" value={stats.users.month}
                sub={`${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)} vs mês anterior`}
                color={growth >= 0 ? '#10b981' : '#f87171'} />
              <KpiCard icon="📱" title="WhatsApp conectados" value={stats.whatsapp?.connected || 0} sub={`${stats.whatsapp?.total || 0} cadastrados`} color="#60a5fa" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Planos */}
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
                <div className="text-sm font-bold text-[#d1fae5] mb-4">Distribuição por Plano</div>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(stats.byPlan || {}).map(([plan, count]: any) => (
                    <div key={plan} className="bg-[#132621] rounded-xl p-4 text-center">
                      <div className="text-2xl font-black text-[#10b981] mb-2">{count}</div>
                      <Badge label={plan} cls={PLAN_CLS[plan]} />
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

        {/* ═══ USUÁRIOS ═══ */}
        {tab === 'users' && (
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

            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-[rgba(16,185,129,.08)]">
                    {['ID', 'E-mail', 'Plano', 'Minutos', 'Assinatura', 'E-mail ✓', 'Cadastro', 'Ações'].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-[10px] font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subLoading ? (
                    <tr><td colSpan={8} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum usuário encontrado</td></tr>
                  ) : users.map((u: any) => {
                    const plan   = u.subscription?.plan?.name || 'free';
                    const status = u.subscription?.status || '—';
                    const mins   = u.balance?.availableMinutes;
                    return (
                      <tr key={u.id} className="border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.025)] transition-colors group">
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)] font-mono max-w-[100px] truncate">{u.id.slice(0,10)}…</td>
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)] max-w-[170px] truncate">{u.email}</td>
                        <td className="px-4 py-3"><Badge label={plan} cls={PLAN_CLS[plan]} /></td>
                        <td className="px-4 py-3 text-xs font-mono text-right text-[#d1fae5]">
                          {typeof mins === 'number' ? mins.toFixed(1) : '—'}
                        </td>
                        <td className="px-4 py-3"><Badge label={STATUS_LABEL[status] || status} cls={STATUS_CLS[status]} /></td>
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

        {/* ═══ TICKETS ═══ */}
        {tab === 'tickets' && (
          <div className="space-y-4">
            <div className="flex gap-1.5">
              {([['', 'Todos'], ['open', 'Abertos'], ['in_progress', 'Em andamento'], ['closed', 'Fechados']] as [string, string][]).map(([v, label]) => (
                <button key={v}
                  onClick={() => { setTicketStatus(v); setTicketOffset(0); loadTickets(v, 0); }}
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
              <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] text-xs font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide">
                {ticketTotal} ticket(s)
              </div>
              {subLoading ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
              ) : tickets.length === 0 ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">✅ Nenhum ticket encontrado</div>
              ) : tickets.map((t: any) => (
                <div key={t.id} className="px-5 py-4 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)]">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#d1fae5]">{t.name}</span>
                      <span className="text-xs text-[rgba(16,185,129,.5)]">{t.email}</span>
                      <Badge label={t.category} cls="text-blue-400 bg-blue-400/10 border-blue-400/20" />
                      <Badge label={STATUS_LABEL[t.status] || t.status} cls={STATUS_CLS[t.status]} />
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-[rgba(16,185,129,.3)]">{fmtFull(t.createdAt)}</span>
                      {t.status !== 'closed' && (
                        <Btn variant="ghost" onClick={() => updateTicketStatus(t.id, t.status === 'open' ? 'in_progress' : 'closed')}>
                          {t.status === 'open' ? '▶ Atender' : '✓ Fechar'}
                        </Btn>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-[rgba(16,185,129,.6)] line-clamp-2">{t.description}</p>
                </div>
              ))}
            </div>

            <Pagination offset={ticketOffset} total={ticketTotal} loading={subLoading}
              onPage={o => { setTicketOffset(o); loadTickets(ticketStatus, o); }} />
          </div>
        )}

        {/* ═══ TESTERS ═══ */}
        {tab === 'testers' && (
          <div className="space-y-5">
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
                Ao aceitar o convite, o usuário recebe <strong className="text-[#10b981]">Plano PRO grátis por 1 ano</strong> + Selo Tester Oficial.
                {' '}Se o telefone for informado, a mensagem é enviada automaticamente via WhatsApp.
              </p>
            </div>

            {/* Resultado do último convite */}
            {lastInviteResult && (
              <div className={`border rounded-xl p-5 ${lastInviteResult.whatsappSent ? 'bg-[rgba(16,185,129,.06)] border-[rgba(16,185,129,.2)]' : 'bg-[rgba(251,191,36,.04)] border-[rgba(251,191,36,.15)]'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-bold text-[#10b981]">
                    {lastInviteResult.whatsappSent ? '✅ Convite gerado e WhatsApp enviado!' : '✅ Convite gerado'}
                  </div>
                  {!lastInviteResult.whatsappSent && lastInviteResult.whatsappError && (
                    <span className="text-[10px] text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-2 py-0.5">
                      ⚠️ {lastInviteResult.whatsappError}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 text-xs text-[#6ee7b7] bg-[#132621] rounded-lg px-3 py-2 font-mono break-all">{lastInviteResult.link}</code>
                  <Btn variant="ghost" onClick={() => { navigator.clipboard.writeText(lastInviteResult.link); notify('✅ Link copiado!', 'ok'); }}>
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
                      onClick={() => { navigator.clipboard.writeText(lastInviteResult.message); notify('✅ Mensagem copiada!', 'ok'); }}>
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
              <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] flex items-center justify-between">
                <span className="text-xs font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide">{inviteTotal} convite(s)</span>
                <Btn onClick={loadInvites} disabled={inviteLoading}>🔄 Atualizar</Btn>
              </div>
              {inviteLoading ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
              ) : invites.length === 0 ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum convite gerado ainda</div>
              ) : invites.map((inv: any) => (
                <div key={inv.id} className="px-5 py-3 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)] flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-[#d1fae5]">{inv.name}</div>
                    <div className="text-xs text-[rgba(16,185,129,.4)] font-mono mt-0.5">{inv.code}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {inv.usedAt
                      ? <Badge label="Usado" cls="text-gray-400 bg-gray-400/10 border-gray-400/20" />
                      : <Badge label="Disponível" cls={STATUS_CLS.active} />
                    }
                    <span className="text-[10px] text-[rgba(16,185,129,.3)]">{fmt(inv.createdAt)}</span>
                    {!inv.usedAt && (
                      <Btn variant="ghost" onClick={() => { navigator.clipboard.writeText(inv.link); notify('✅ Link copiado!', 'ok'); }}>
                        Copiar link
                      </Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ ERROS ═══ */}
        {tab === 'errors' && (
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] text-sm font-bold text-[#d1fae5]">
              Erros Recentes ({(stats?.recentErrors || []).length})
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
                  <div className="text-[10px] text-[rgba(16,185,129,.3)] whitespace-nowrap flex-shrink-0">
                    {fmtFull(e.createdAt)}
                  </div>
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
        )}

      </div>
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
    </>
  );
}
