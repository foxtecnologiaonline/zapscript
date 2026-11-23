'use client';
import React, { useCallback, useState } from 'react';
import { bv, BvApiError, errMsg } from '@/lib/balcao/api';
import { Badge, Banner, Button, Checkbox, ConfirmDialog, DataTable, Dialog, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, fieldErrors, hasCode, useLoad } from './_shared';
import type { Sector } from './UserDialogs';

function SectorDialog({ sector, onClose, onSaved }: { sector: Sector | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(sector?.name ?? '');
  const [email, setEmail] = useState(sector?.email ?? '');
  const [active, setActive] = useState(sector?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Informe o nome do setor (mínimo de 2 caracteres).';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'E-mail inválido.';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    setBusy(true);
    try {
      if (sector) await bv.patch(`/admin/sectors/${sector.id}`, { name: name.trim(), email: email.trim() || null, active });
      else await bv.post('/admin/sectors', { name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}) });
      toast.success(sector ? 'Setor atualizado.' : 'Setor criado.'); onSaved(); onClose();
    } catch (err) {
      const m = fieldErrors(err);
      if (hasCode(err, 'sector.name_taken')) m.name = errMsg(err);
      setErrors(m); setFormErr(Object.keys(m).length ? 'Corrija os campos destacados.' : errMsg(err));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={sector ? 'Editar setor' : 'Novo setor'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-setor" loading={busy}>Salvar</Button></>}>
      <form id="form-setor" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <TextField label="Nome" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <TextField label="E-mail do setor" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} hint="Opcional. Caixa que recebe as notificações do setor." />
        {sector && <Checkbox label="Setor ativo" hint="Setores inativos deixam de aparecer para novos cadastros." checked={active} onChange={(e) => setActive(e.target.checked)} />}
      </form>
    </Dialog>
  );
}

export default function SectorsTab() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => bv.get<{ items: Sector[] }>('/admin/sectors').then((r) => r.items), []);
  const [edit, setEdit] = useState<{ sector: Sector | null } | null>(null);
  const [del, setDel] = useState<Sector | null>(null);
  const closeEdit = useCallback(() => setEdit(null), []);
  const closeDel = useCallback(() => setDel(null), []);

  const toggle = async (s: Sector) => {
    try { await bv.patch(`/admin/sectors/${s.id}`, { active: !s.active }); toast.success(s.active ? 'Setor desativado.' : 'Setor ativado.'); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    if (!del) return;
    try { await bv.del(`/admin/sectors/${del.id}`); toast.success('Setor excluído.'); reload(); }
    catch (e) {
      if (e instanceof BvApiError && e.code === 'sector.in_use') toast.error('O setor está em uso por usuários ou filas. Desative-o em vez de excluir.');
      else toast.error(errMsg(e));
    }
  };

  const columns: Column<Sector>[] = [
    { key: 'name', header: 'Setor', render: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'email', header: 'E-mail', render: (s) => s.email || '—' },
    { key: 'st', header: 'Situação', render: (s) => <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Ativo' : 'Inativo'}</Badge> },
    {
      key: 'act', header: 'Ações', render: (s) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" aria-label={`Editar setor ${s.name}`} onClick={() => setEdit({ sector: s })}>Editar</Button>
          <Button size="sm" variant="secondary" aria-label={`${s.active ? 'Desativar' : 'Ativar'} setor ${s.name}`} onClick={() => void toggle(s)}>{s.active ? 'Desativar' : 'Ativar'}</Button>
          <Button size="sm" variant="secondary" aria-label={`Excluir setor ${s.name}`} onClick={() => setDel(s)}>Excluir</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button onClick={() => setEdit({ sector: null })}>Novo setor</Button></div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando setores" />
        : <DataTable caption="Setores do órgão" columns={columns} rows={data ?? []} rowKey={(s) => s.id} empty="Nenhum setor cadastrado." />}
      {edit && <SectorDialog key={edit.sector?.id ?? 'novo'} sector={edit.sector} onClose={closeEdit} onSaved={reload} />}
      {del && <ConfirmDialog open danger title="Excluir setor" confirmLabel="Excluir" message={`Excluir o setor "${del.name}"? Se houver usuários ou filas vinculados, a exclusão será recusada.`} onConfirm={remove} onClose={closeDel} />}
    </div>
  );
}
