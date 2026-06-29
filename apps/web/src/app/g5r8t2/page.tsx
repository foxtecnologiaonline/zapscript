'use client';
import React, { useState } from 'react';
import AdminDashboard, { type Tab } from './admin-dashboard';

const API  = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PAGE = 20;

export default function AdminPage() {
  const [token, setToken]     = useState('');
  const [auth, setAuth]       = useState(false);
  const [stats, setStats]     = useState<any>(null);
  const [tab, setTab]         = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [loginErr, setLoginErr]     = useState('');
  const [toast, setToast]     = useState<{ text: string; type: 'ok' | 'err' | 'warn' } | null>(null);

  // Users
  const [users, setUsers]         = useState<any[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userOffset, setUserOffset] = useState(0);
  const [userWhatsapp, setUserWhatsapp] = useState('');  // '' | 'connected' | 'disconnected'
  const [detailId, setDetailId]   = useState<string | null>(null);

  // Tickets
  const [tickets, setTickets]           = useState<any[]>([]);
  const [ticketTotal, setTicketTotal]   = useState(0);
  const [ticketStatus, setTicketStatus] = useState('open');
  const [ticketOffset, setTicketOffset] = useState(0);

  // Plans
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [syncingPlans, setSyncingPlans] = useState(false);

  // Testers / Invites
  const [invites, setInvites]         = useState<any[]>([]);
  const [inviteTotal, setInviteTotal] = useState(0);
  const [inviteName, setInviteName]   = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [lastInviteResult, setLastInviteResult] = useState<{
    link: string; message: string; whatsappSent: boolean; whatsappChannel?: string; whatsappError?: string;
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
  async function loadUsers(search: string, offset: number, whatsapp?: string) {
    setSubLoading(true);
    try {
      const wa = whatsapp !== undefined ? whatsapp : userWhatsapp;
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search) p.set('search', search);
      if (wa) p.set('whatsapp', wa);
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

  async function deleteInvite(id: string, name: string) {
    if (!confirm(`Excluir convite de "${name}"?`)) return;
    await fetch(`${API}/sys/g5r8t2/invites/${id}`, { method: 'DELETE', headers: h });
    setInvites((prev: any[]) => prev.filter((i: any) => i.id !== id));
    setInviteTotal((t: number) => t - 1);
    notify('🗑 Convite excluído', 'ok');
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
      setLastInviteResult({ link: d.link, message: d.message, whatsappSent: d.whatsappSent, whatsappChannel: d.whatsappChannel, whatsappError: d.whatsappError });
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
    if (t === 'usuarios') {
      if (users.length === 0) loadUsers('', 0);
      loadInvites(); // seção Testers foi unificada em Usuários
    }
    if (t === 'suporte' && tickets.length === 0) loadTickets(ticketStatus || 'open', 0);
    // 'metas', 'monitoramento', 'comunicacao' e 'financeiro' carregam dados internamente em seus componentes
  }

  async function syncPlans() {
    setSyncingPlans(true);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/sync-plans`, {
        method: 'POST',
        headers: h,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao sincronizar planos');
      notify(`✅ ${d.message || 'Planos sincronizados!'}`, 'ok');
      refreshStats();
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setSyncingPlans(false); }
  }

  async function createProTesterPlan() {
    setCreatingPlan(true);
    try {
      const res = await fetch(`${API}/sys/g5r8t2/plans`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          name:           'pro-tester',
          label:          'Pro Tester',
          minutesPerMonth: 300,
          audiosPerMonth:  0,
          maxNumbers:      3,
          priceBrl:        0,
          features:        ['Áudios ilimitados', 'Até 3 números WhatsApp', 'Resumos inteligentes', 'Acesso antecipado a novidades'],
        }),
      });
      const d = await res.json();
      if (res.status === 409) { notify(`ℹ️ ${d.error}`, 'warn'); return; }
      if (!res.ok) throw new Error(d.error || 'Erro');
      notify('✅ Plano Pro Tester criado!', 'ok');
      refreshStats();
    } catch (e: any) {
      notify(`❌ ${e.message}`, 'err');
    } finally { setCreatingPlan(false); }
  }

  const growth = stats ? (stats.users.month - stats.users.lastMonth) : 0;

  /* ── Login screen ── */
  if (!auth) {
    return (
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
  }

  return (
    <AdminDashboard
      ctx={{
        stats, tab, growth, loading, subLoading,
        users, userTotal, userSearch, userOffset, userWhatsapp,
        tickets, ticketTotal, ticketStatus, ticketOffset,
        detailId, invites, inviteTotal,
        inviteName, invitePhone, inviteLoading, lastInviteResult,
        creatingPlan, syncingPlans, toast, token,
      }}
      fn={{
        refreshStats, goTab, setTab, setUserSearch, setUserOffset, setUserWhatsapp, loadUsers,
        setTicketStatus, setTicketOffset, loadTickets, updateTicketStatus,
        loadInvites, deleteInvite, createInvite, createProTesterPlan, syncPlans,
        setDetailId, setInviteName, setInvitePhone, notify, setToast, setLastInviteResult,
      }}
    />
  );
}
