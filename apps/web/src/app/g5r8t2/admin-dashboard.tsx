'use client';
import React, { useState, useCallback } from 'react';

/* ── Tipos ─────────────────────────────────────────────── */
export type Tab = 'overview' | 'users' | 'tickets' | 'errors' | 'testers';

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
export default function AdminDashboard({ ctx, fn }: { ctx: DashCtx; fn: DashFn }) {
  const {
    stats, tab, growth, loading, subLoading, users, userTotal, userSearch, userOffset,
    tickets, ticketTotal, ticketStatus, ticketOffset, detailId, invites, inviteTotal,
    inviteName, invitePhone, inviteLoading, lastInviteResult, creatingPlan, toast, token,
  } = ctx;
  const {
    refreshStats, goTab, setTab, setUserSearch, setUserOffset, loadUsers,
    setTicketStatus, setTicketOffset, loadTickets, updateTicketStatus, loadInvites,
    deleteInvite, createInvite, createProTesterPlan, setDetailId, setInviteName,
    setInvitePhone, notify, setToast, setLastInviteResult,
  } = fn;

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
              <KpiCard icon="💳" title="Pagantes ativos" value={stats.conversion?.paid || 0} sub={`${(stats.conversion?.rate || 0).toFixed(1)}% conv. · ${stats.conversion?.testers || 0} tester(s)`} color="#34d399" />
              <KpiCard icon="📈" title="Novos este mês" value={stats.users.month}
                sub={`${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)} vs mês anterior`}
                color={growth >= 0 ? '#10b981' : '#f87171'} />
              <KpiCard icon="📱" title="WhatsApp conectados" value={stats.whatsapp?.connected || 0} sub={`${stats.whatsapp?.total || 0} cadastrados`} color="#60a5fa" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Planos */}
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-bold text-[#d1fae5]">Distribuição por Plano</div>
                  {!stats.byPlan?.['pro-tester'] && (
                    <Btn variant="ghost" onClick={createProTesterPlan} disabled={creatingPlan} cls="text-[10px]">
                      {creatingPlan ? '⟳' : '➕'} Criar plano PRO-Tester
                    </Btn>
                  )}
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
                    {['ID', 'E-mail', 'Plano', 'Minutos', 'Assinatura', 'Números', 'E-mail ✓', 'Cadastro', 'Ações'].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-[10px] font-bold text-[rgba(16,185,129,.4)] uppercase tracking-wide whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subLoading ? (
                    <tr><td colSpan={9} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={9} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum usuário encontrado</td></tr>
                  ) : users.map((u: any) => {
                    const plan      = u.subscription?.plan?.name || 'free';
                    const status    = u.subscription?.status || '—';
                    const mins      = u.balance?.availableMinutes;
                    const nums      = (u.numbers || []) as any[];
                    const connected = nums.filter((n: any) => n.status === 'connected').length;
                    const total     = nums.length;
                    return (
                      <tr key={u.id} className="border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.025)] transition-colors group">
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
                Ao aceitar o convite, o usuário recebe <strong className="text-[#10b981]">Plano PRO grátis por 1 ano</strong> + Medalha Tester Oficial.
                {' '}O WhatsApp é enviado exclusivamente pelo número <strong className="text-[#10b981]">5534991790254</strong> via Evolution API — esse número precisa estar conectado.
                {' '}Convite expira em <strong className="text-[#10b981]">24h</strong>.
              </p>
              <ServicesHealth apiBase={API} token={token} />
              <HealthMonitorPanel apiBase={API} token={token} />
              <DiagnoseWhatsApp apiBase={API} token={token} />
              <QueuePanel apiBase={API} token={token} />
              <AuditNumbers apiBase={API} token={token} />
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
                      {inv.phone && <span className="text-[10px] text-[rgba(16,185,129,.5)] font-mono">📱 {inv.phone}</span>}
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
  const [retrying, setRetrying] = useState(false);

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
              <button type="button" onClick={retryFailed} disabled={retrying}
                className="text-xs bg-amber-400/10 border border-amber-400/20 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-400/20 disabled:opacity-40 transition-colors">
                {retrying ? '⟳' : '🔁 Re-tentar todos os falhos'}
              </button>
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

function AuditNumbers({ apiBase, token }: { apiBase: string; token: string }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing]   = useState(false);
  const [data, setData]       = useState<any>(null);

  async function load() {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/audit-numbers`, {
        headers: { 'x-admin-token': token },
      });
      setData(await res.json());
    } catch (e: any) {
      setData({ error: e.message });
    } finally { setLoading(false); }
  }

  async function fixIsolation() {
    if (!confirm('⚠️ Isso irá desconectar números duplicados (mantendo o mais recente por instância). Continuar?')) return;
    setFixing(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/fix-number-isolation`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const r = await res.json();
      alert(`✅ ${r.fixed} violação(ões) corrigida(s). Atualizando...`);
      load();
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setFixing(false); }
  }

  async function deleteAllNumbers() {
    const confirmText = prompt('⛔ ATENÇÃO: isso apaga TODOS os números de TODOS os usuários.\n\nDigite APAGAR_TUDO para confirmar:');
    if (confirmText !== 'APAGAR_TUDO') { alert('Cancelado.'); return; }
    setFixing(true);
    try {
      const res = await fetch(`${apiBase}/sys/g5r8t2/numbers/all?confirm=APAGAR_TUDO`, {
        method: 'DELETE',
        headers: { 'x-admin-token': token },
      });
      const r = await res.json();
      alert(`✅ ${r.deleted} número(s) excluído(s). Tabela zerada.`);
      load();
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setFixing(false); }
  }

  const summary  = data?.summary;
  const hasViolations = summary?.violations > 0;

  return (
    <div className="mt-3 border border-[rgba(16,185,129,.1)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}
        className="w-full text-left px-4 py-2.5 text-xs text-[rgba(16,185,129,.5)] hover:text-[rgba(16,185,129,.8)] flex items-center justify-between transition-colors">
        <span>🔒 {open ? '▲' : '▼'} Auditoria de Isolamento (Números WhatsApp)</span>
        {hasViolations && <span className="text-red-400 font-bold animate-pulse">{summary.violations} violação(ões) ⚠️</span>}
        {data && !hasViolations && summary && <span className="text-green-400 text-[10px]">✅ OK</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className="text-xs bg-[rgba(16,185,129,.1)] border border-[rgba(16,185,129,.2)] text-[#10b981] px-3 py-1.5 rounded-lg hover:bg-[rgba(16,185,129,.2)] disabled:opacity-40 transition-colors">
              {loading ? '⟳ Verificando...' : '↻ Re-verificar'}
            </button>
            {hasViolations && (
              <button type="button" onClick={fixIsolation} disabled={fixing}
                className="text-xs bg-red-500/10 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-colors">
                {fixing ? '⟳ Corrigindo...' : '🔧 Corrigir violações agora'}
              </button>
            )}
            <button type="button" onClick={deleteAllNumbers} disabled={fixing}
              className="text-xs bg-red-900/20 border border-red-600/30 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-900/40 disabled:opacity-40 transition-colors">
              {fixing ? '⟳' : '⛔ Apagar todos os números'}
            </button>
          </div>

          {summary && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total números', value: summary.totalNumbers,  color: '#60a5fa' },
                { label: 'Conectados',    value: summary.connected,     color: '#34d399' },
                { label: 'Órfãos',        value: summary.orphans,       color: '#fbbf24' },
                { label: 'Violações',     value: summary.violations,    color: hasViolations ? '#f87171' : '#34d399' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-[#040b09] rounded-lg p-2.5 text-center">
                  <div className="text-xl font-black" style={{ color }}>{value}</div>
                  <div className="text-[9px] text-[rgba(16,185,129,.4)] mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}

          {hasViolations && data.violations.map((v: any, i: number) => (
            <div key={i} className="bg-red-900/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-xs font-bold text-red-400 mb-2">⚠️ Instância {v.instanceId} — {v.activeCount} número(s) ativos</p>
              {v.numbers.map((n: any) => (
                <div key={n.id} className="text-[10px] text-red-300/70 font-mono bg-[#0a0000] rounded px-2 py-1 mb-1">
                  [{n.status}] {n.phoneNumber || 'sem número'} — user: {n.userEmail || n.userId} — atualizado: {n.updatedAt ? new Date(n.updatedAt).toLocaleString('pt-BR') : '?'}
                </div>
              ))}
            </div>
          ))}

          {!hasViolations && data?.byUser && (
            <div className="max-h-64 overflow-auto space-y-2">
              {data.byUser.map((u: any) => (
                <div key={u.userId} className="bg-[#040b09] rounded-lg px-3 py-2">
                  <p className="text-[10px] font-bold text-[rgba(16,185,129,.7)] mb-1">
                    {u.userEmail || u.userId} ({u.numbers.length} número(s))
                  </p>
                  {u.numbers.map((n: any) => (
                    <div key={n.id} className="text-[10px] text-[rgba(16,185,129,.5)] font-mono ml-2">
                      • {n.phoneNumber || n.displayName || n.id} — <span className={n.status === 'connected' ? 'text-green-400' : 'text-red-400/60'}>{n.status}</span>
                      {n.zapiInstanceId ? ` (inst: ${n.zapiInstanceId})` : ' (sem instância)'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {data?.error && <p className="text-xs text-red-400">Erro: {data.error}</p>}
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
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);

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
            </div>
          </div>

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
