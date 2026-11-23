'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime, ROLE_LABEL } from '@/lib/balcao/format';
import { Badge, Button, ConfirmDialog, DataTable, LoadMore, Select, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, useCursorList, useLoad } from './_shared';
import BulkImport from './BulkImport';
import { ROLE_OPTIONS, TempPasswordDialog, UserFormDialog, type AdminUser, type Sector } from './UserDialogs';

type Confirm = { kind: 'deactivate' | 'reset-password' | 'reset-mfa'; user: AdminUser } | null;

export default function UsersTab() {
  const { me } = useBvSession();
  const toast = useToast();
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState('');
  const [role, setRole] = useState(''); const [active, setActive] = useState(''); const [sectorId, setSectorId] = useState('');
  useEffect(() => { const t = setTimeout(() => setQApplied(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const sectors = useLoad(() => bv.get<{ items: Sector[] }>('/admin/sectors').then((r) => r.items), []);
  const list = useCursorList<AdminUser>('/admin/users', { q: qApplied, role, active, sectorId, limit: 50 });
  const sectorName = (id: string | null) => (id ? sectors.data?.find((s) => s.id === id)?.name ?? '—' : '—');

  const [form, setForm] = useState<{ user: AdminUser | null } | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string; title: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [bulk, setBulk] = useState(false);
  const closeForm = useCallback(() => setForm(null), []);
  const closeTemp = useCallback(() => setTemp(null), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const closeBulk = useCallback(() => setBulk(false), []);

  /** Abre o diálogo da senha depois que o diálogo anterior devolveu o foco (evita roubo de foco). */
  const showTemp = (t: { email: string; password: string; title: string }) => { setTimeout(() => setTemp(t), 80); };
  const patchRow = (u: AdminUser) => list.setItems((l) => l.map((x) => (x.id === u.id ? u : x)));

  const act = async (u: AdminUser, action: 'activate' | 'unlock') => {
    try { const r = await bv.post<AdminUser>(`/admin/users/${u.id}/${action}`); patchRow(r); toast.success(action === 'activate' ? `${u.name} foi ativado.` : `${u.name} foi desbloqueado.`); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    try {
      if (kind === 'deactivate') { patchRow(await bv.post<AdminUser>(`/admin/users/${user.id}/deactivate`)); toast.success(`${user.name} foi desativado e suas sessões encerradas.`); }
      else if (kind === 'reset-mfa') { patchRow(await bv.post<AdminUser>(`/admin/users/${user.id}/reset-mfa`)); toast.success('Verificação em duas etapas redefinida. O usuário precisará configurá-la de novo.'); }
      else { const r = await bv.post<{ user: AdminUser; temporaryPassword: string }>(`/admin/users/${user.id}/reset-password`); patchRow(r.user); showTemp({ email: user.email, password: r.temporaryPassword, title: 'Nova senha temporária' }); }
    } catch (e) { toast.error(errMsg(e)); }
  };

  const now = Date.now();
  const columns: Column<AdminUser>[] = [
    { key: 'name', header: 'Usuário', render: (u) => <div><div className="font-medium">{u.name}</div><div className="text-xs text-bv-muted">{u.email}</div></div> },
    { key: 'role', header: 'Perfil', render: (u) => ROLE_LABEL[u.role] ?? u.role },
    { key: 'sector', header: 'Setor', render: (u) => sectorName(u.sectorId) },
    { key: 'caps', header: 'Habilidades / capacidade', render: (u) => <div className="text-xs"><div>{u.skills.length ? u.skills.join(', ') : 'Sem habilidades'}</div><div className="text-bv-muted">Simultâneas: {u.maxConcurrent}{u.sipExtension ? ` · Ramal ${u.sipExtension}` : ''}</div></div> },
    {
      key: 'status', header: 'Situação', render: (u) => {
        const locked = u.lockedUntil && Date.parse(u.lockedUntil) > now;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={u.active ? 'success' : 'neutral'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>
            {locked && <Badge tone="danger">Bloqueado até {fmtDateTime(u.lockedUntil)}</Badge>}
            <Badge tone={u.totpEnabled ? 'success' : 'warning'}>{u.totpEnabled ? 'MFA ativo' : 'MFA inativo'}</Badge>
            {u.mustChangePassword && <Badge tone="warning">Troca de senha pendente</Badge>}
          </div>
        );
      },
    },
    { key: 'last', header: 'Último acesso', render: (u) => fmtDateTime(u.lastLoginAt) },
    {
      key: 'actions', header: 'Ações', render: (u) => {
        const self = u.id === me?.user.id;
        const locked = !!u.lockedUntil && Date.parse(u.lockedUntil) > now;
        return (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="secondary" aria-label={`Editar ${u.name}`} onClick={() => setForm({ user: u })}>Editar</Button>
            {u.active
              ? <Button size="sm" variant="secondary" disabled={self} title={self ? 'Você não pode desativar a própria conta.' : undefined} aria-label={`Desativar ${u.name}`} onClick={() => setConfirm({ kind: 'deactivate', user: u })}>Desativar</Button>
              : <Button size="sm" variant="secondary" aria-label={`Ativar ${u.name}`} onClick={() => void act(u, 'activate')}>Ativar</Button>}
            <Button size="sm" variant="secondary" disabled={self} title={self ? 'Para alterar a própria senha use Minha conta.' : undefined} aria-label={`Redefinir senha de ${u.name}`} onClick={() => setConfirm({ kind: 'reset-password', user: u })}>Redefinir senha</Button>
            <Button size="sm" variant="secondary" disabled={!u.totpEnabled} aria-label={`Redefinir MFA de ${u.name}`} onClick={() => setConfirm({ kind: 'reset-mfa', user: u })}>Redefinir MFA</Button>
            {locked && <Button size="sm" variant="secondary" aria-label={`Desbloquear ${u.name}`} onClick={() => void act(u, 'unlock')}>Desbloquear</Button>}
          </div>
        );
      },
    },
  ];

  const confirmText: Record<NonNullable<Confirm>['kind'], { title: string; label: string; msg: (u: AdminUser) => string }> = {
    deactivate: { title: 'Desativar usuário', label: 'Desativar', msg: (u) => `Desativar ${u.name}? As sessões abertas serão encerradas e o acesso será bloqueado. Você pode reativar depois.` },
    'reset-password': { title: 'Redefinir senha', label: 'Redefinir senha', msg: (u) => `Gerar uma nova senha temporária para ${u.name}? A senha atual deixa de valer e as sessões abertas são encerradas.` },
    'reset-mfa': { title: 'Redefinir verificação em duas etapas', label: 'Redefinir MFA', msg: (u) => `Remover o segundo fator de ${u.name}? Ele precisará configurar o aplicativo autenticador novamente.` },
  };

  return (
    <div className="flex flex-col gap-4">
      <form role="search" aria-label="Filtrar usuários" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); setQApplied(q.trim()); }}>
        <TextField label="Buscar por nome ou e-mail" type="search" value={q} onChange={(e) => setQ(e.target.value)} className="lg:col-span-2" />
        <Select label="Perfil" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Todos</option>{ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
        <Select label="Situação" value={active} onChange={(e) => setActive(e.target.value)}><option value="">Todas</option><option value="true">Ativos</option><option value="false">Inativos</option></Select>
        <Select label="Setor" value={sectorId} onChange={(e) => setSectorId(e.target.value)}><option value="">Todos</option>{sectors.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm text-bv-muted">
          {list.loading ? 'Carregando usuários…' : list.total != null ? `${list.total} usuário(s) encontrado(s); exibindo ${list.items.length}.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setBulk(true)}>Cadastro em massa</Button>
          <Button onClick={() => setForm({ user: null })}>Novo usuário</Button>
        </div>
      </div>

      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} />
        : list.loading && !list.items.length ? <Loading label="Carregando usuários" />
          : <DataTable caption="Usuários do órgão" columns={columns} rows={list.items} rowKey={(u) => u.id} empty="Nenhum usuário encontrado com estes filtros." />}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={() => void list.loadMore()} />

      {form && <UserFormDialog key={form.user?.id ?? 'novo'} open onClose={closeForm} user={form.user} sectors={sectors.data ?? []} isSelf={form.user?.id === me?.user.id}
        onSaved={(r) => {
          if (form.user) patchRow(r.user); else list.reload();
          if (r.temporaryPassword) showTemp({ email: r.user.email, password: r.temporaryPassword, title: 'Usuário criado' });
        }} />}
      {temp && <TempPasswordDialog open onClose={closeTemp} email={temp.email} password={temp.password} title={temp.title} />}
      {confirm && <ConfirmDialog open danger={confirm.kind !== 'reset-password'} title={confirmText[confirm.kind].title} confirmLabel={confirmText[confirm.kind].label}
        message={confirmText[confirm.kind].msg(confirm.user)} onConfirm={runConfirm} onClose={closeConfirm} />}
      {bulk && <BulkImport open onClose={closeBulk} sectors={sectors.data ?? []} onDone={list.reload} />}
    </div>
  );
}
