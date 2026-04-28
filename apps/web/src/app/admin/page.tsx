'use client';
import { useState } from 'react';

const API  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const PAGE = 20;

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmt = (d: string) => new Date(d).toLocaleDateString('pt-BR');
const fmtFull = (d: string) => new Date(d).toLocaleString('pt-BR');

const PLAN_CLS: Record<string, string> = {
  free:  'text-gray-400 bg-gray-400/10',
  pro:   'text-teal-400 bg-teal-400/10',
  ultra: 'text-purple-400 bg-purple-400/10',
};

const STATUS_CLS: Record<string, string> = {
  active:   'text-green-400 bg-green-400/10',
  pending:  'text-yellow-400 bg-yellow-400/10',
  canceled: 'text-red-400 bg-red-400/10',
  past_due: 'text-orange-400 bg-orange-400/10',
  open:     'text-yellow-400 bg-yellow-400/10',
  closed:   'text-gray-400 bg-gray-400/10',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo', pending: 'Pendente', canceled: 'Cancelado',
  past_due: 'Atrasado', open: 'Aberto', closed: 'Fechado',
};

function Badge({ label, cls }: { label: string; cls?: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${cls || 'text-gray-400 bg-gray-400/10'}`}>
      {label}
    </span>
  );
}

function KpiCard({ title, value, sub, color = '#10b981' }: {
  title: string; value: string | number; sub: string; color?: string;
}) {
  return (
    <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
      <div className="text-xs text-[rgba(16,185,129,.4)] font-medium mb-3">{title}</div>
      <div className="text-3xl font-black leading-none mb-1" style={{ color }}>{value}</div>
      <div className="text-xs text-[rgba(16,185,129,.4)]">{sub}</div>
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
        <button disabled={offset === 0 || loading}
          onClick={() => onPage(Math.max(0, offset - PAGE))}
          className="px-3 py-1.5 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.12)] text-[#10b981] font-semibold disabled:opacity-30">
          ← Anterior
        </button>
        <span>{page} / {pages}</span>
        <button disabled={offset + PAGE >= total || loading}
          onClick={() => onPage(offset + PAGE)}
          className="px-3 py-1.5 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.12)] text-[#10b981] font-semibold disabled:opacity-30">
          Próxima →
        </button>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'users' | 'tickets' | 'errors';

interface EditState {
  user:         any;
  planName:     string;
  minutesVal:   string;
  minutesMode:  'set' | 'add';
  saving:       boolean;
  msg:          string;
}

export default function AdminPage() {
  const [token, setToken]       = useState('');
  const [auth, setAuth]         = useState(false);
  const [stats, setStats]       = useState<any>(null);
  const [tab, setTab]           = useState<Tab>('overview');
  const [loading, setLoading]   = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [loginErr, setLoginErr] = useState('');

  // Users
  const [users, setUsers]           = useState<any[]>([]);
  const [userTotal, setUserTotal]   = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userOffset, setUserOffset] = useState(0);

  // Edit modal
  const [edit, setEdit] = useState<EditState | null>(null);

  // Tickets
  const [tickets, setTickets]             = useState<any[]>([]);
  const [ticketTotal, setTicketTotal]     = useState(0);
  const [ticketStatus, setTicketStatus]   = useState('');
  const [ticketOffset, setTicketOffset]   = useState(0);

  const h = { 'x-admin-token': token };

  // ── Auth ──────────────────────────────────────────────────
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setLoginErr('');
    try {
      const res = await fetch(`${API}/admin/stats`, { headers: h });
      if (!res.ok) throw new Error('Token inválido');
      setStats(await res.json());
      setAuth(true);
    } catch (err: any) { setLoginErr(err.message); }
    finally { setLoading(false); }
  }

  async function refreshStats() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/stats`, { headers: h });
      setStats(await res.json());
    } finally { setLoading(false); }
  }

  // ── Data loaders ──────────────────────────────────────────
  async function loadUsers(search: string, offset: number) {
    setSubLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search) p.set('search', search);
      const d = await (await fetch(`${API}/admin/users?${p}`, { headers: h })).json();
      setUsers(d.users || []);
      setUserTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  async function loadTickets(status: string, offset: number) {
    setSubLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (status) p.set('status', status);
      const d = await (await fetch(`${API}/admin/tickets?${p}`, { headers: h })).json();
      setTickets(d.tickets || []);
      setTicketTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  // ── Edit user ─────────────────────────────────────────────
  function openEdit(u: any) {
    setEdit({
      user:        u,
      planName:    u.subscription?.plan?.name || 'free',
      minutesVal:  String(u.balance?.availableMinutes ?? 0),
      minutesMode: 'set',
      saving:      false,
      msg:         '',
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setEdit(prev => prev ? { ...prev, saving: true, msg: '' } : prev);

    const body: any = {};
    const origPlan = edit.user.subscription?.plan?.name || 'free';
    if (edit.planName !== origPlan) body.planName = edit.planName;

    const minsNum = parseFloat(edit.minutesVal);
    if (!isNaN(minsNum)) {
      body.minutes     = minsNum;
      body.minutesMode = edit.minutesMode;
    }

    if (Object.keys(body).length === 0) {
      setEdit(prev => prev ? { ...prev, saving: false, msg: '⚠️ Nenhuma alteração detectada.' } : prev);
      return;
    }

    try {
      const res = await fetch(`${API}/admin/users/${edit.user.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json', 'x-admin-token': token },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');

      // Atualizar linha na tabela
      setUsers(prev => prev.map(u => u.id === data.id ? data : u));
      setEdit(prev => prev ? { ...prev, saving: false, msg: '✅ Salvo com sucesso!' } : prev);
      setTimeout(() => setEdit(null), 1200);
    } catch (err: any) {
      setEdit(prev => prev ? { ...prev, saving: false, msg: `❌ ${err.message}` } : prev);
    }
  }

  // ── Tab navigation ────────────────────────────────────────
  function goTab(t: Tab) {
    setTab(t);
    if (t === 'users'   && users.length === 0)   loadUsers('', 0);
    if (t === 'tickets' && tickets.length === 0) loadTickets('', 0);
  }

  // ── Login screen ──────────────────────────────────────────
  if (!auth) return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-2xl p-8">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🛡️</div>
          <div className="font-bold text-lg text-[#d1fae5]">Admin ZapScript</div>
          <div className="text-xs text-[rgba(16,185,129,.4)] mt-1">Acesso restrito</div>
        </div>
        <form onSubmit={login} className="space-y-4">
          <input
            className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] placeholder-[rgba(16,185,129,.3)]"
            type="password" placeholder="ADMIN_TOKEN" value={token}
            onChange={e => setToken(e.target.value)} required
          />
          {loginErr && <p className="text-red-400 text-xs">{loginErr}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-2.5 rounded-lg hover:bg-[#34d399] disabled:opacity-50 transition-colors">
            {loading ? 'Verificando...' : 'Acessar painel'}
          </button>
        </form>
      </div>
    </div>
  );

  const growth = stats ? (stats.users.month - stats.users.lastMonth) : 0;

  // ── Dashboard ─────────────────────────────────────────────
  return (
    <>
    <div className="min-h-screen bg-[#040b09] p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#d1fae5]">🛡️ Painel Admin</h1>
            <p className="text-[#6ee7b7] text-sm mt-0.5 font-light">ZapScript.me — gestão do negócio</p>
          </div>
          <button onClick={refreshStats} disabled={loading}
            className="text-sm bg-[rgba(16,185,129,.10)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-4 py-2 rounded-lg font-semibold hover:bg-[rgba(16,185,129,.18)] disabled:opacity-50 transition-colors">
            {loading ? '⟳ Atualizando...' : '⟳ Atualizar'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {([
            ['overview', '📊 Visão Geral'],
            ['users',    '👥 Usuários'],
            ['tickets',  '🎫 Tickets'],
            ['errors',   '🐛 Erros'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => goTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t
                  ? 'bg-[rgba(16,185,129,.12)] text-[#10b981] border border-[rgba(16,185,129,.2)]'
                  : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════
            VISÃO GERAL
        ═══════════════════════════════════════════════════ */}
        {tab === 'overview' && stats && (
          <div className="space-y-5">

            {/* KPIs — operacional */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Usuários totais"
                value={stats.users.total}
                sub={`+${stats.users.today} hoje`} />
              <KpiCard title="Transcrições"
                value={stats.transcriptions.total}
                sub={`+${stats.transcriptions.today} hoje`} />
              <KpiCard title="Minutos processados"
                value={`${(stats.minutes.total || 0).toFixed(0)}`}
                sub={`${(stats.minutes.today || 0).toFixed(1)} min hoje`} />
              <KpiCard title="Tickets abertos"
                value={stats.tickets.open}
                sub={`${stats.tickets.total} total`}
                color="#fbbf24" />
            </div>

            {/* KPIs — negócio */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="MRR"
                value={brl(stats.mrr || 0)}
                sub="receita mensal recorrente"
                color="#a78bfa" />
              <KpiCard title="Pagantes ativos"
                value={stats.conversion?.paid || 0}
                sub={`${(stats.conversion?.rate || 0).toFixed(1)}% de conversão`}
                color="#34d399" />
              <KpiCard title="Novos este mês"
                value={stats.users.month}
                sub={`${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)} vs mês anterior`}
                color={growth >= 0 ? '#10b981' : '#f87171'} />
              <KpiCard title="WhatsApp conectados"
                value={stats.whatsapp?.connected || 0}
                sub={`${stats.whatsapp?.total || 0} números cadastrados`}
                color="#60a5fa" />
            </div>

            {/* Linha 3: planos + status assinaturas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Distribuição por plano */}
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
                <div className="text-sm font-bold text-[#d1fae5] mb-4">Distribuição por Plano</div>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(stats.byPlan || {}).map(([plan, count]: any) => (
                    <div key={plan} className="bg-[#132621] rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-[#10b981] mb-2">{count}</div>
                      <Badge label={plan} cls={PLAN_CLS[plan]} />
                    </div>
                  ))}
                  {Object.keys(stats.byPlan || {}).length === 0 && (
                    <div className="col-span-3 text-center text-xs text-[rgba(16,185,129,.3)] py-4">Nenhum dado</div>
                  )}
                </div>
              </div>

              {/* Status das assinaturas */}
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
                <div className="text-sm font-bold text-[#d1fae5] mb-4">Status das Assinaturas</div>
                <div className="space-y-3">
                  {Object.entries(stats.subscriptions || {}).map(([status, count]: any) => {
                    const total = Object.values(stats.subscriptions || {}).reduce((a: number, b: any) => a + b, 0) as number;
                    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={status}>
                        <div className="flex items-center justify-between mb-1">
                          <Badge label={STATUS_LABEL[status] || status} cls={STATUS_CLS[status]} />
                          <span className="text-sm font-bold text-[#d1fae5]">{count} <span className="text-xs text-[rgba(16,185,129,.4)] font-normal">({pct}%)</span></span>
                        </div>
                        <div className="w-full bg-[#132621] rounded-full h-1">
                          <div className="h-1 rounded-full" style={{ width: `${pct}%`, backgroundColor: STATUS_CLS[status]?.includes('green') ? '#10b981' : STATUS_CLS[status]?.includes('yellow') ? '#fbbf24' : STATUS_CLS[status]?.includes('red') ? '#f87171' : '#6b7280' }} />
                        </div>
                      </div>
                    );
                  })}
                  {Object.keys(stats.subscriptions || {}).length === 0 && (
                    <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhuma assinatura ainda</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            USUÁRIOS
        ═══════════════════════════════════════════════════ */}
        {tab === 'users' && (
          <div className="space-y-4">

            {/* Busca */}
            <form
              onSubmit={e => { e.preventDefault(); setUserOffset(0); loadUsers(userSearch, 0); }}
              className="flex gap-2">
              <input
                className="flex-1 bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.3)] placeholder-[rgba(16,185,129,.3)]"
                placeholder="Buscar por nome ou e-mail..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
              <button type="submit"
                className="px-5 py-2.5 bg-[rgba(16,185,129,.12)] border border-[rgba(16,185,129,.2)] text-[#10b981] text-sm font-semibold rounded-lg hover:bg-[rgba(16,185,129,.18)]">
                Buscar
              </button>
            </form>

            {/* Tabela */}
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-x-auto">
              <table className="w-full min-w-[740px]">
                <thead>
                  <tr className="border-b border-[rgba(16,185,129,.08)]">
                    {['Nome', 'E-mail', 'Plano', 'Saldo (min)', 'Assinatura', 'Cadastro', ''].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subLoading ? (
                    <tr><td colSpan={7} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum usuário encontrado</td></tr>
                  ) : users.map((u: any) => {
                    const plan   = u.subscription?.plan?.name || 'free';
                    const status = u.subscription?.status || '—';
                    const mins   = u.balance?.availableMinutes;
                    return (
                      <tr key={u.id} className="border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.03)] transition-colors">
                        <td className="px-5 py-3 text-sm text-[#d1fae5] font-medium max-w-[140px] truncate">{u.name || '—'}</td>
                        <td className="px-5 py-3 text-sm text-[rgba(16,185,129,.6)] max-w-[180px] truncate">{u.email}</td>
                        <td className="px-5 py-3"><Badge label={plan} cls={PLAN_CLS[plan]} /></td>
                        <td className="px-5 py-3 text-sm text-[#d1fae5] text-right font-mono">
                          {typeof mins === 'number' ? mins.toFixed(1) : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <Badge label={STATUS_LABEL[status] || status} cls={STATUS_CLS[status]} />
                        </td>
                        <td className="px-5 py-3 text-xs text-[rgba(16,185,129,.4)] whitespace-nowrap">{fmt(u.createdAt)}</td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => openEdit(u)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[#10b981] hover:bg-[rgba(16,185,129,.16)] transition-colors font-semibold whitespace-nowrap">
                            ✏️ Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              offset={userOffset}
              total={userTotal}
              loading={subLoading}
              onPage={o => { setUserOffset(o); loadUsers(userSearch, o); }}
            />
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            TICKETS
        ═══════════════════════════════════════════════════ */}
        {tab === 'tickets' && (
          <div className="space-y-4">

            {/* Filtro por status */}
            <div className="flex gap-2">
              {([['', 'Todos'], ['open', 'Abertos'], ['closed', 'Fechados']] as [string, string][]).map(([v, label]) => (
                <button key={v}
                  onClick={() => { setTicketStatus(v); setTicketOffset(0); loadTickets(v, 0); }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    ticketStatus === v
                      ? 'bg-[rgba(16,185,129,.12)] text-[#10b981] border border-[rgba(16,185,129,.2)]'
                      : 'text-[rgba(16,185,129,.4)] hover:text-[#6ee7b7]'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Lista */}
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] text-xs font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide">
                {ticketTotal} ticket(s)
              </div>
              {subLoading ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
              ) : tickets.length === 0 ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">✅ Nenhum ticket encontrado</div>
              ) : tickets.map((t: any) => (
                <div key={t.id} className="px-5 py-4 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)] transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#d1fae5]">{t.name}</span>
                      <span className="text-xs text-[rgba(16,185,129,.5)]">{t.email}</span>
                      <Badge label={t.category} cls="text-blue-400 bg-blue-400/10" />
                      <Badge label={STATUS_LABEL[t.status] || t.status} cls={STATUS_CLS[t.status]} />
                    </div>
                    <span className="text-[10px] text-[rgba(16,185,129,.3)] whitespace-nowrap flex-shrink-0">
                      {fmtFull(t.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-[rgba(16,185,129,.6)] line-clamp-2">{t.description}</p>
                </div>
              ))}
            </div>

            <Pagination
              offset={ticketOffset}
              total={ticketTotal}
              loading={subLoading}
              onPage={o => { setTicketOffset(o); loadTickets(ticketStatus, o); }}
            />
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            ERROS
        ═══════════════════════════════════════════════════ */}
        {tab === 'errors' && (
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[rgba(16,185,129,.08)] text-sm font-bold text-[#d1fae5]">
              Erros Recentes ({(stats?.recentErrors || []).length})
            </div>
            {(stats?.recentErrors || []).length === 0 ? (
              <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">✅ Nenhum erro registrado</div>
            ) : (stats?.recentErrors || []).map((e: any, i: number) => (
              <div key={i} className="px-5 py-3 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded mr-2">{e.service}</span>
                    <span className="text-sm text-[#d1fae5]">{e.message}</span>
                  </div>
                  <div className="text-[10px] text-[rgba(16,185,129,.3)] whitespace-nowrap flex-shrink-0">
                    {fmtFull(e.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>

    {/* ═══════════════════════════════════════════════════
        MODAL — EDITAR USUÁRIO
    ═══════════════════════════════════════════════════ */}
    {edit && (
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => !edit.saving && setEdit(null)}>
        <div
          className="w-full max-w-md bg-[#0d1c19] border border-[rgba(16,185,129,.2)] rounded-2xl p-6 shadow-2xl"
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-bold text-base text-[#d1fae5]">✏️ Editar usuário</div>
              <div className="text-xs text-[rgba(16,185,129,.5)] mt-0.5 truncate max-w-[300px]">
                {edit.user.name ? `${edit.user.name} · ` : ''}{edit.user.email}
              </div>
            </div>
            <button onClick={() => setEdit(null)} disabled={edit.saving}
              className="text-[rgba(16,185,129,.4)] hover:text-[#d1fae5] text-xl leading-none transition-colors">✕</button>
          </div>

          <form onSubmit={saveEdit} className="space-y-4">

            {/* Plano */}
            <div>
              <label className="block text-xs font-bold text-[rgba(16,185,129,.5)] mb-1.5 uppercase tracking-wide">
                Plano
              </label>
              <select
                value={edit.planName}
                onChange={e => setEdit(prev => prev ? { ...prev, planName: e.target.value } : prev)}
                className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] cursor-pointer">
                <option value="free">🆓  Free</option>
                <option value="pro">⚡  Pro</option>
                <option value="ultra">🚀  Ultra</option>
              </select>
              <p className="text-[10px] text-[rgba(16,185,129,.3)] mt-1">
                Trocar o plano reseta os minutos para a cota do novo plano (a menos que você ajuste abaixo).
              </p>
            </div>

            {/* Minutos */}
            <div>
              <label className="block text-xs font-bold text-[rgba(16,185,129,.5)] mb-1.5 uppercase tracking-wide">
                Minutos disponíveis
              </label>
              <div className="flex gap-2 mb-2">
                {(['set', 'add'] as const).map(m => (
                  <button key={m} type="button"
                    onClick={() => setEdit(prev => prev ? { ...prev, minutesMode: m } : prev)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors border ${
                      edit.minutesMode === m
                        ? 'bg-[rgba(16,185,129,.15)] border-[rgba(16,185,129,.3)] text-[#10b981]'
                        : 'bg-[#132621] border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.4)]'
                    }`}>
                    {m === 'set' ? '= Definir valor' : '± Adicionar / subtrair'}
                  </button>
                ))}
              </div>
              <input
                type="number"
                step="0.1"
                placeholder={edit.minutesMode === 'set' ? 'Ex: 60' : 'Ex: 30  ou  -10'}
                value={edit.minutesVal}
                onChange={e => setEdit(prev => prev ? { ...prev, minutesVal: e.target.value } : prev)}
                className="w-full bg-[#132621] border border-[rgba(16,185,129,.15)] rounded-lg px-4 py-2.5 text-sm text-[#d1fae5] outline-none focus:border-[rgba(16,185,129,.35)] placeholder-[rgba(16,185,129,.25)] font-mono"
              />
              <p className="text-[10px] text-[rgba(16,185,129,.3)] mt-1">
                Saldo atual: <span className="text-[#10b981] font-bold font-mono">
                  {typeof edit.user.balance?.availableMinutes === 'number'
                    ? edit.user.balance.availableMinutes.toFixed(1)
                    : '—'} min
                </span>
              </p>
            </div>

            {/* Feedback */}
            {edit.msg && (
              <div className={`text-xs px-3 py-2 rounded-lg ${
                edit.msg.startsWith('✅')
                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                  : edit.msg.startsWith('⚠️')
                  ? 'bg-yellow-400/10 border border-yellow-400/20 text-yellow-400'
                  : 'bg-red-400/10 border border-red-400/20 text-red-400'
              }`}>{edit.msg}</div>
            )}

            {/* Botões */}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setEdit(null)} disabled={edit.saving}
                className="flex-1 py-2.5 rounded-lg border border-[rgba(16,185,129,.15)] text-[rgba(16,185,129,.5)] text-sm font-semibold hover:border-[rgba(16,185,129,.3)] transition-colors disabled:opacity-40">
                Cancelar
              </button>
              <button type="submit" disabled={edit.saving}
                className="flex-1 py-2.5 rounded-lg bg-[#10b981] text-[#011a12] text-sm font-bold hover:bg-[#34d399] disabled:opacity-50 transition-colors">
                {edit.saving ? '⟳ Salvando...' : '💾 Salvar alterações'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
}
