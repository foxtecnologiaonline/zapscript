'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import ApiKeysPanel from './ApiKeysPanel';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
}

interface TeamData {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  members: TeamMember[];
  seats: { active: number; total: number; max: number };
  billing: {
    planPriceMonthly: number;
    planPriceYearly: number;
  };
  ownerPlan: { name: string; label: string } | null;
}

function EmpresarialContent() {
  const searchParams = useSearchParams();
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; name: string | null; email: string } | null>(null);

  // States
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'agent'>('agent');
  const [inviteError, setInviteError] = useState('');
  const [inviteOk, setInviteOk] = useState('');
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const inviteCodeParam = searchParams.get('accept');

  const isOwner = team && user && team.ownerId === user.id;

  async function load() {
    try {
      const [teamRes, userRes] = await Promise.all([
        api.get<{ team: TeamData | null }>('/teams/mine').catch(() => ({ team: null })),
        api.get<{ id: string; name: string | null; email: string }>('/auth/me'),
      ]);
      setTeam(teamRes.team);
      setUser(userRes);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Auto-accept invite se ?accept=CODE
  useEffect(() => {
    if (!inviteCodeParam || !user) return;
    setAccepting(true);
    api.post('/teams/accept', { inviteCode: inviteCodeParam })
      .then(() => {
        setAcceptError('');
        load();
      })
      .catch((e: any) => {
        setAcceptError(e?.message || 'Convite inválido ou expirado.');
      })
      .finally(() => setAccepting(false));
  }, [inviteCodeParam, user]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      await api.post('/teams', { name: createName });
      setCreateName('');
      load();
    } catch (err: any) {
      setCreateError(err?.message || 'Erro ao criar time.');
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviteOk('');
    setInviting(true);
    try {
      const res = await api.post<any>('/teams/invite', { email: inviteEmail, role: inviteRole });
      setInviteEmail('');
      setInviteRole('agent');
      setInviteOk(res.message || 'Convite enviado!');
      load();
    } catch (err: any) {
      setInviteError(err?.message || 'Erro ao convidar.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, role: string) {
    setRoleChanging(memberId);
    try {
      await api.patch(`/teams/members/${memberId}/role`, { role });
      load();
    } catch (err: any) {
      alert(err?.message || 'Erro ao alterar papel.');
    } finally {
      setRoleChanging(null);
    }
  }

  async function handleRemove(memberId: string) {
    setRemoving(memberId);
    try {
      await api.delete(`/teams/members/${memberId}`);
      load();
    } catch (err: any) {
      alert(err?.message || 'Erro ao remover membro.');
    } finally {
      setRemoving(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete('/teams');
      setTeam(null);
      setDeleteConfirm(false);
    } catch (err: any) {
      alert(err?.message || 'Erro ao deletar time.');
    } finally {
      setDeleting(false);
    }
  }

  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return (
      <div className="p-4 sm:p-8 max-w-3xl">
        <div className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando...</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Plano Empresas</h1>
        <p className="text-sm font-light mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Gerencie seu time e convide membros
        </p>
      </div>

      {/* ── Aceitar convite ── */}
      {inviteCodeParam && (
        <div className="rounded-2xl p-6 mb-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.3)' }}>
          {accepting ? (
            <div className="text-center text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Aceitando convite...</div>
          ) : acceptError ? (
            <div>
              <div className="text-sm font-bold text-red-400 mb-2">Erro ao aceitar convite</div>
              <p className="text-xs mb-4" style={{ color: 'rgb(var(--color-text-muted))' }}>{acceptError}</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Sem time: wizard de criação ── */}
      {!team && !inviteCodeParam && (
        <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🏢</div>
            <h2 className="font-bold text-lg mb-2">Crie seu time</h2>
            <p className="text-sm max-w-md mx-auto" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Convide sua equipe e compartilhe o acesso Empresas (Atende + CRM + Tarefas).
              <strong> Um preço fixo para até 5 usuários</strong> — não é cobrança por seat.
            </p>
          </div>

          {/* Preço */}
          <div className="rounded-xl p-4 text-center mb-6"
            style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.15)' }}>
            <div className="text-xs font-bold mb-1" style={{ color: 'rgb(var(--color-text-muted))' }}>Plano Empresas · até 5 usuários</div>
            <div className="font-black text-2xl" style={{ color: 'rgb(var(--color-primary))' }}>R$99/mês</div>
            <div className="text-[10px]" style={{ color: 'rgb(var(--color-text-muted))' }}>ou R$595/ano (compra)</div>
            <a href="/dashboard/plano" className="text-[11px] font-semibold mt-2 inline-block underline" style={{ color: 'rgb(var(--color-primary))' }}>
              Não está no Empresas ainda? Ver planos →
            </a>
          </div>

          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                Nome do time
              </label>
              <input
                className="field-input"
                placeholder="Ex: Agência Fox, Time Comercial..."
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                maxLength={60}
                required
                autoFocus
              />
            </div>
            {createError && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171' }}>
                {createError}
              </div>
            )}
            <button
              type="submit"
              disabled={creating || createName.trim().length < 2}
              className="w-full btn-primary py-3 text-sm font-bold disabled:opacity-50"
            >
              {creating ? 'Criando...' : 'Criar time →'}
            </button>
          </form>
        </div>
      )}

      {/* ── Time ativo ── */}
      {team && (
        <>
          {/* Card do time */}
          <div className="rounded-2xl p-5 mb-6"
            style={{ background: 'rgb(var(--color-surface-elevated))', border: '1.5px solid rgb(var(--color-primary))', boxShadow: '0 0 0 1px rgba(var(--color-primary)/.15)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🏢</span>
                  <h2 className="font-display font-bold text-lg">{team.name}</h2>
                </div>
                <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  {team.seats.active} de {team.seats.max} membro{team.seats.max !== 1 ? 's' : ''}
                  {isOwner && <> · Plano: <strong style={{ color: 'rgb(var(--color-primary))' }}>{team.ownerPlan?.label || 'Empresas'}</strong></>}
                </p>
              </div>
              {isOwner && (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(var(--color-primary)/.15)', color: 'rgb(var(--color-primary))' }}>
                  Dono
                </span>
              )}
            </div>

            {/* Resumo de custo (owner) */}
            {isOwner && (
              <div className="rounded-xl p-4 mb-4"
                style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.15)' }}>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    Plano Empresas · {team.seats.active} de {team.seats.max} usuários incluídos
                  </span>
                  <span className="font-black text-lg" style={{ color: 'rgb(var(--color-primary))' }}>
                    {brl(team.billing.planPriceMonthly)}<span className="text-xs font-normal">/mês</span>
                  </span>
                </div>
                <div className="text-[10px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  Preço fixo do plano — não é cobrança por seat. Módulos avulsos, quando houver, são cobrados à parte.
                </div>
              </div>
            )}

            {/* Lista de membros */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  Membros ({team.members.length})
                </h3>
                {isOwner && (
                  <button
                    onClick={() => setInviteOk('')}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: 'rgba(var(--color-primary)/.12)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(var(--color-primary)/.2)' }}
                  >
                    + Convidar
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {team.members.map(m => (
                  <div key={m.id} className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                        style={{ background: m.role === 'owner' ? 'rgba(var(--color-primary)/.2)' : 'rgba(var(--color-primary)/.08)', color: 'rgb(var(--color-primary))' }}>
                        {m.role === 'owner' ? '👑' : '👤'}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--color-text))' }}>
                          {m.name}
                          {m.status === 'invited' && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(251,191,36,.1)', color: '#fbbf24' }}>Pendente</span>
                          )}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: 'rgb(var(--color-text-muted))' }}>
                          {m.email}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {isOwner && m.role !== 'owner' ? (
                        <select
                          value={m.role}
                          onChange={e => handleRoleChange(m.id, e.target.value)}
                          disabled={roleChanging === m.id}
                          className="text-[10px] font-medium px-2 py-1 rounded-full border-0 disabled:opacity-50"
                          style={{ background: 'rgba(var(--color-primary)/.08)', color: 'rgb(var(--color-text-muted))' }}
                        >
                          <option value="admin">Admin</option>
                          <option value="manager">Manager</option>
                          <option value="agent">Agent</option>
                        </select>
                      ) : (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(var(--color-primary)/.08)', color: 'rgb(var(--color-text-muted))' }}>
                          {m.role === 'owner' ? 'Dono' : m.role === 'admin' ? 'Admin' : m.role === 'manager' ? 'Manager' : 'Agent'}
                        </span>
                      )}
                      {isOwner && m.role !== 'owner' && (
                        <button
                          onClick={() => handleRemove(m.id)}
                          disabled={removing === m.id}
                          className="text-[10px] font-medium px-2 py-1 rounded-lg transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          style={{ color: 'rgb(var(--color-text-muted))' }}
                          title="Remover membro"
                        >
                          {removing === m.id ? '...' : '✕'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Form de convite (owner) */}
            {isOwner && (
              <form onSubmit={handleInvite} className="mt-4 pt-4 flex gap-2" style={{ borderTop: '1px solid rgb(var(--color-border))' }}>
                <input
                  className="field-input flex-1"
                  placeholder="email@exemplo.com"
                  type="email"
                  value={inviteEmail}
                  onChange={e => { setInviteEmail(e.target.value); setInviteError(''); setInviteOk(''); }}
                  required
                />
                <select
                  className="field-input shrink-0 w-28"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'admin' | 'manager' | 'agent')}
                  title="Papel do membro — admin/manager configuram o Atende, agent só responde conversas"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="agent">Agent</option>
                </select>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.includes('@')}
                  className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50 shrink-0"
                >
                  {inviting ? '...' : 'Convidar'}
                </button>
              </form>
            )}
            {inviteError && (
              <div className="text-xs px-3 py-2 rounded-lg mt-2" style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>
                {inviteError}
              </div>
            )}
            {inviteOk && (
              <div className="text-xs px-3 py-2 rounded-lg mt-2" style={{ background: 'rgba(34,197,94,.1)', color: '#4ade80' }}>
                {inviteOk}
              </div>
            )}

            {/* Zona de perigo (owner) */}
            {isOwner && (
              <div className="mt-4 pt-3" style={{ borderTop: '1px solid rgb(var(--color-border))' }}>
                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="text-xs font-medium transition-colors hover:underline"
                    style={{ color: 'rgb(var(--color-text-muted))' }}
                  >
                    🗑 Deletar time
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-red-400">Tem certeza? Todos os membros perdem o acesso.</span>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 disabled:opacity-50"
                    >
                      {deleting ? '...' : 'Sim, deletar'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="text-xs font-medium"
                      style={{ color: 'rgb(var(--color-text-muted))' }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Benefícios do plano */}
          <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
            <h3 className="font-bold text-sm mb-3">O que cada membro recebe:</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                '1 número WhatsApp próprio',
                'Áudios ilimitados',
                'Conversão automática + resumo IA',
                'Modo Privado automático',
                'Exportação PDF/Docx/Csv/Excel',
                'Acesso aos módulos do time',
              ].map(f => (
                <div key={f} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
          </div>

          {/* API pública — só faz sentido pro dono do tier Empresas */}
          {isOwner && team.ownerPlan?.name === 'empresas' && <ApiKeysPanel />}
        </>
      )}
    </div>
  );
}

export default function EmpresarialPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm pt-20">Carregando...</div>}>
      <EmpresarialContent />
    </Suspense>
  );
}
