'use client';
import { useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PAGE = 20;

const fmt     = (d: string) => new Date(d).toLocaleDateString('pt-BR');
const fmtFull = (d: string) => new Date(d).toLocaleString('pt-BR');
const fmtMin  = (m: number) => `${m.toFixed(1)} min`;

const PLAN_CLS: Record<string, string> = {
  free:  'text-gray-400 bg-gray-400/10 border-gray-400/20',
  pro:   'text-teal-400 bg-teal-400/10 border-teal-400/20',
  ultra: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
};
const STATUS_CLS: Record<string, string> = {
  active:      'text-green-400 bg-green-400/10 border-green-400/20',
  pending:     'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  canceled:    'text-red-400 bg-red-400/10 border-red-400/20',
  connected:   'text-green-400 bg-green-400/10 border-green-400/20',
  disconnected:'text-red-400 bg-red-400/10 border-red-400/20',
};

function Badge({ label, cls }: { label: string; cls?: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border ${cls || 'text-gray-400 bg-gray-400/10 border-gray-400/20'}`}>
      {label}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[rgba(16,185,129,.4)] flex-shrink-0 text-xs">{label}</span>
      <span className={`text-[#d1fae5] text-right break-all text-xs ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = 'ghost', cls = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost'; cls?: string;
}) {
  const base = 'text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap';
  const v = {
    primary: 'bg-[#10b981] text-[#011a12] hover:bg-[#34d399]',
    danger:  'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20',
    ghost:   'bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[#10b981] hover:bg-[rgba(16,185,129,.16)]',
  };
  return (
    <button className={`${base} ${v[variant]} ${cls}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

type MasterTab = 'users' | 'testers' | 'invites';

/* ── Painel de detalhe do usuário Master ── */
function MasterDetailPanel({ userId, token, onClose }: {
  userId: string; token: string; onClose: () => void;
}) {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  useState(() => {
    fetch(`${API}/sys/g5r8t2/master/users/${userId}/detail`, { headers: h })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  });

  if (loading) return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="text-[#10b981] text-sm animate-pulse">Carregando...</div>
    </div>
  );
  if (!data) return null;

  const { user, stats, transcriptions, numbers } = data;
  const plan   = user?.subscription?.plan?.name || 'free';
  const status = user?.subscription?.status || '—';

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-stretch justify-end"
      onClick={onClose}>
      <div className="w-full max-w-2xl bg-[#050d0a] border-l border-[rgba(16,185,129,.15)] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        <div className="sticky top-0 bg-[#050d0a] border-b border-[rgba(16,185,129,.10)] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="font-bold text-[#d1fae5]">{user.name || '—'}</div>
            <div className="text-xs text-[rgba(16,185,129,.5)]">{user.email}</div>
            {user.isTester && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5 mt-1">
                🏅 Tester Oficial
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge label={plan} cls={PLAN_CLS[plan]} />
            <button onClick={onClose} className="ml-3 text-[rgba(16,185,129,.4)] hover:text-[#d1fae5] text-xl">✕</button>
          </div>
        </div>

        <div className="p-6 space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#132621] rounded-xl p-3 text-center">
              <div className="text-xl font-black text-[#10b981]">{fmtMin(stats.availableMinutes)}</div>
              <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-1">Disponíveis</div>
            </div>
            <div className="bg-[#132621] rounded-xl p-3 text-center">
              <div className="text-xl font-black text-[#fbbf24]">{stats.totalTranscriptions}</div>
              <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-1">Conversões</div>
            </div>
            <div className="bg-[#132621] rounded-xl p-3 text-center">
              <div className="text-xl font-black text-[#d1fae5]">{fmtMin(stats.planLimit)}</div>
              <div className="text-[10px] text-[rgba(16,185,129,.4)] mt-1">Limite plano</div>
            </div>
          </div>

          {/* Info */}
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4 space-y-2">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">Informações Completas</div>
            <Row label="ID" value={user.id} mono />
            <Row label="Nome" value={user.name || '—'} />
            <Row label="E-mail" value={user.email} />
            <Row label="CPF/CNPJ" value={user.document || '—'} />
            <Row label="refCode" value={user.refCode || '—'} mono />
            <Row label="Indicado por" value={user.referredBy || '—'} mono />
            <Row label="Cadastro" value={fmtFull(user.createdAt)} />
            <Row label="E-mail verificado" value={user.emailVerified ? '✅ Sim' : '❌ Não'} />
            <Row label="Admin" value={user.isAdmin ? '✅ Sim' : 'Não'} />
            <Row label="Tester" value={user.isTester ? `✅ desde ${user.testerSince ? fmt(user.testerSince) : '—'}` : 'Não'} />
            {user.subscription?.currentPeriodEnd && (
              <Row label="Assinatura até" value={fmt(user.subscription.currentPeriodEnd)} />
            )}
            {user.subscription?.asaasCustomerId && (
              <Row label="Asaas Customer" value={user.subscription.asaasCustomerId} mono />
            )}
          </div>

          {/* Números WhatsApp */}
          {numbers.length > 0 && (
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
              <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">WhatsApp ({numbers.length})</div>
              <div className="space-y-2">
                {numbers.map((n: any) => (
                  <div key={n.id} className="flex items-center justify-between bg-[#132621] rounded-lg px-3 py-2.5">
                    <div>
                      <div className="text-sm text-[#d1fae5] font-medium">{n.displayName || n.phoneNumber || '—'}</div>
                      <div className="text-xs text-[rgba(16,185,129,.4)]">{n.phoneNumber}</div>
                      <div className="text-[10px] text-[rgba(16,185,129,.3)]">{n.messageCount} msgs · {fmtMin(n.minutesUsed || 0)}</div>
                    </div>
                    <Badge label={n.status} cls={STATUS_CLS[n.status]} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conversões completas */}
          <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-4">
            <div className="text-xs font-bold text-[rgba(16,185,129,.5)] uppercase tracking-wide mb-3">
              Conversões ({stats.totalTranscriptions})
            </div>
            {transcriptions.length === 0 ? (
              <div className="text-xs text-[rgba(16,185,129,.3)] text-center py-4">Nenhuma conversão</div>
            ) : (
              <div className="space-y-3">
                {transcriptions.map((t: any) => (
                  <div key={t.id} className="bg-[#132621] rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[rgba(16,185,129,.4)] font-mono">{fmtMin(t.durationSec ? t.durationSec / 60 : 0)}</span>
                        {t.contactName && <span className="text-[10px] text-[#d1fae5]">{t.contactName}</span>}
                        {t.contactPhone && <span className="text-[10px] text-[rgba(16,185,129,.4)]">{t.contactPhone}</span>}
                        {t.language && <span className="text-[10px] text-[rgba(16,185,129,.3)]">{t.language}</span>}
                      </div>
                      <span className="text-[10px] text-[rgba(16,185,129,.3)]">{fmt(t.createdAt)}</span>
                    </div>
                    {t.originalText && (
                      <details>
                        <summary className="text-[10px] text-[rgba(16,185,129,.4)] cursor-pointer">Ver conversão</summary>
                        <p className="text-xs text-[rgba(16,185,129,.6)] mt-1.5 leading-relaxed line-clamp-4">{t.originalText}</p>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PÁGINA ADMIN MASTER
══════════════════════════════════════════════════════════ */
export default function AdminMasterPage() {
  const [token, setToken] = useState('');
  const [auth, setAuth]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginErr, setLoginErr] = useState('');
  const [tab, setTab]     = useState<MasterTab>('users');

  // Users
  const [users, setUsers]       = useState<any[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userOffset, setUserOffset] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState(false);

  // Testers
  const [testers, setTesters]     = useState<any[]>([]);
  const [testerTotal, setTesterTotal] = useState(0);

  // Invites
  const [invites, setInvites]     = useState<any[]>([]);
  const [inviteTotal, setInviteTotal] = useState(0);

  const [toast, setToast] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  const h = { 'x-admin-token': token, 'content-type': 'application/json' };

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setLoginErr('');
    try {
      const res = await fetch(`${API}/sys/g5r8t2/master/users?limit=1`, { headers: h });
      if (!res.ok) throw new Error('Token inválido');
      setAuth(true);
      loadUsers('', 0);
    } catch (err: any) { setLoginErr(err.message); }
    finally { setLoading(false); }
  }

  async function loadUsers(search: string, offset: number) {
    setSubLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search) p.set('search', search);
      const d = await (await fetch(`${API}/sys/g5r8t2/master/users?${p}`, { headers: h })).json();
      setUsers(d.users || []);
      setUserTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  async function loadTesters() {
    setSubLoading(true);
    try {
      const d = await (await fetch(`${API}/sys/g5r8t2/master/testers`, { headers: h })).json();
      setTesters(d.testers || []);
      setTesterTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  async function loadInvites() {
    setSubLoading(true);
    try {
      const d = await (await fetch(`${API}/sys/g5r8t2/master/invites?limit=100`, { headers: h })).json();
      setInvites(d.invites || []);
      setInviteTotal(d.total || 0);
    } finally { setSubLoading(false); }
  }

  function goTab(t: MasterTab) {
    setTab(t);
    if (t === 'users'   && users.length === 0)   loadUsers('', 0);
    if (t === 'testers' && testers.length === 0) loadTesters();
    if (t === 'invites' && invites.length === 0) loadInvites();
  }

  if (!auth) return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#0d1c19] border border-[rgba(16,185,129,.12)] rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">👑</div>
          <div className="font-bold text-lg text-[#d1fae5]">Admin Master</div>
          <div className="text-xs text-[rgba(16,185,129,.4)] mt-1">Acesso completo — dados sensíveis</div>
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
            {loading ? '⟳ Verificando...' : 'Acessar painel master'}
          </button>
        </form>
        <p className="text-center text-xs text-[rgba(16,185,129,.3)] mt-4">
          Acesso restrito ao administrador
        </p>
      </div>
    </div>
  );

  return (
    <>
    <div className="min-h-screen bg-[#040b09] p-4 md:p-6">
      <div className="max-w-7xl mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#d1fae5]">👑 Admin Master</h1>
            <p className="text-[rgba(16,185,129,.4)] text-xs mt-0.5">Dados completos — nomes, telefones, conversões, refCodes</p>
          </div>
          <a href="/g5r8t2"
            className="text-xs text-[rgba(16,185,129,.5)] hover:text-[#10b981] transition-colors border border-[rgba(16,185,129,.15)] rounded-lg px-3 py-1.5">
            ← Admin padrão
          </a>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-6 bg-[#0d1c19] border border-[rgba(16,185,129,.08)] rounded-xl p-1.5 w-fit">
          {([
            ['users',   '👥', `Usuários (${userTotal})`],
            ['testers', '🧪', `Testers (${testerTotal})`],
            ['invites', '🎟️', `Convites (${inviteTotal})`],
          ] as [MasterTab, string, string][]).map(([t, icon, label]) => (
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
              <button type="submit" className="bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.15)] text-[#10b981] text-xs font-semibold px-5 rounded-lg hover:bg-[rgba(16,185,129,.16)] transition-colors">
                Buscar
              </button>
            </form>

            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-[rgba(16,185,129,.08)]">
                    {['Nome', 'E-mail', 'Telefones', 'refCode', 'Plano', 'Tester', 'Cadastro', 'Ações'].map(col => (
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
                    <tr><td colSpan={8} className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum usuário</td></tr>
                  ) : users.map((u: any) => {
                    const plan = u.subscription?.plan?.name || 'free';
                    const phones = (u.numbers || []).map((n: any) => n.phoneNumber).join(', ') || '—';
                    return (
                      <tr key={u.id} className="border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.025)] transition-colors">
                        <td className="px-4 py-3 text-sm text-[#d1fae5] font-medium max-w-[120px] truncate">{u.name || '—'}</td>
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.6)] max-w-[160px] truncate">{u.email}</td>
                        <td className="px-4 py-3 text-xs text-[rgba(16,185,129,.5)] max-w-[120px] truncate">{phones}</td>
                        <td className="px-4 py-3 text-[10px] text-[rgba(16,185,129,.4)] font-mono max-w-[80px] truncate">{u.refCode || '—'}</td>
                        <td className="px-4 py-3"><Badge label={plan} cls={PLAN_CLS[plan]} /></td>
                        <td className="px-4 py-3 text-center">
                          {u.isTester ? <span className="text-amber-400">🧪</span> : <span className="text-[rgba(16,185,129,.2)]">—</span>}
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

            <div className="flex items-center justify-between text-xs text-[rgba(16,185,129,.4)]">
              <span>{userTotal} usuário(s)</span>
              <div className="flex items-center gap-2">
                <Btn disabled={userOffset === 0 || subLoading} onClick={() => { const o = Math.max(0, userOffset - PAGE); setUserOffset(o); loadUsers(userSearch, o); }}>← Anterior</Btn>
                <Btn disabled={userOffset + PAGE >= userTotal || subLoading} onClick={() => { const o = userOffset + PAGE; setUserOffset(o); loadUsers(userSearch, o); }}>Próxima →</Btn>
              </div>
            </div>
          </div>
        )}

        {/* ═══ TESTERS ═══ */}
        {tab === 'testers' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-sm text-[rgba(16,185,129,.5)]">{testerTotal} tester(s) oficial(is)</div>
              <Btn onClick={loadTesters} disabled={subLoading}>🔄 Atualizar</Btn>
            </div>
            {subLoading ? (
              <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
            ) : testers.length === 0 ? (
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-8 text-center text-[rgba(16,185,129,.3)] text-sm">
                Nenhum tester ainda
              </div>
            ) : (
              <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
                {testers.map((t: any) => (
                  <div key={t.id} className="px-5 py-4 border-b border-[rgba(16,185,129,.05)] last:border-0 hover:bg-[rgba(16,185,129,.02)] flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#d1fae5]">{t.name || '—'}</span>
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">🧪 Tester</span>
                      </div>
                      <div className="text-xs text-[rgba(16,185,129,.5)] mt-0.5">{t.email}</div>
                      <div className="text-[10px] text-[rgba(16,185,129,.3)] font-mono mt-0.5">refCode: {t.refCode || '—'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] text-[rgba(16,185,129,.4)]">
                        Tester desde: {t.testerSince ? fmt(t.testerSince) : '—'}
                      </div>
                      <div className="text-[10px] text-[rgba(16,185,129,.3)] mt-0.5">
                        {(t.numbers || []).map((n: any) => n.phoneNumber).join(', ') || 'Sem número'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ CONVITES ═══ */}
        {tab === 'invites' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-sm text-[rgba(16,185,129,.5)]">{inviteTotal} convite(s) gerado(s)</div>
              <Btn onClick={loadInvites} disabled={subLoading}>🔄 Atualizar</Btn>
            </div>
            <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl overflow-hidden">
              {subLoading ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Carregando...</div>
              ) : invites.length === 0 ? (
                <div className="p-8 text-center text-[rgba(16,185,129,.3)] text-sm">Nenhum convite</div>
              ) : invites.map((inv: any) => (
                <div key={inv.id} className="px-5 py-3 border-b border-[rgba(16,185,129,.05)] last:border-0 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-[#d1fae5]">{inv.name}</div>
                    <div className="text-xs font-mono text-[rgba(16,185,129,.4)]">{inv.code}</div>
                    {inv.usedBy && <div className="text-[10px] text-[rgba(16,185,129,.3)]">Usado por: {inv.usedBy}</div>}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge
                      label={inv.usedAt ? 'Usado' : 'Disponível'}
                      cls={inv.usedAt ? 'text-gray-400 bg-gray-400/10 border-gray-400/20' : STATUS_CLS.active}
                    />
                    <span className="text-[10px] text-[rgba(16,185,129,.3)]">{fmt(inv.createdAt)}</span>
                    {!inv.usedAt && (
                      <Btn variant="ghost" onClick={() => { navigator.clipboard.writeText(inv.link); notify('✅ Link copiado!'); }}>
                        Copiar link
                      </Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>

    {detailId && (
      <MasterDetailPanel userId={detailId} token={token} onClose={() => setDetailId(null)} />
    )}

    {toast && (
      <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-xl border text-sm font-semibold shadow-2xl flex items-center gap-3 ${
        toast.type === 'ok' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-400/10 border-red-400/20 text-red-400'
      }`}>
        {toast.text}
        <button onClick={() => setToast(null)} className="opacity-60 hover:opacity-100 text-lg">✕</button>
      </div>
    )}
    </>
  );
}
