'use client';
import React, { useCallback, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { Banner, Button, ConfirmDialog, DataTable, Dialog, TextArea, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, fieldErrors, hasCode, useLoad } from '../usuarios/_shared';
import type { Canned } from './types';

function CannedDialog({ item, onClose, onSaved }: { item: Canned | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [shortcut, setShortcut] = useState(item?.shortcut ?? '');
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const sc = shortcut.trim().replace(/^\/+/, '').toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(sc)) errs.shortcut = 'Use de 1 a 32 letras, números, _ ou -.';
    if (!title.trim()) errs.title = 'Informe o título.';
    if (!body.trim()) errs.body = 'Informe o texto da resposta.';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    setBusy(true);
    try {
      const payload = { shortcut: sc, title: title.trim(), body: body.trim() };
      if (item) await bv.patch(`/canned-responses/${item.id}`, payload); else await bv.post('/canned-responses', payload);
      toast.success(item ? 'Resposta atualizada.' : 'Resposta criada.'); onSaved(); onClose();
    } catch (err) {
      const m = fieldErrors(err);
      if (hasCode(err, 'canned.shortcut_taken')) m.shortcut = errMsg(err);
      setErrors(m); setFormErr(Object.keys(m).length ? 'Corrija os campos destacados.' : errMsg(err));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={item ? 'Editar resposta pronta' : 'Nova resposta pronta'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-pronta" loading={busy}>Salvar</Button></>}>
      <form id="form-pronta" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <TextField label="Atalho" required value={shortcut} onChange={(e) => setShortcut(e.target.value)} error={errors.shortcut} hint="O atendente digita /atalho na conversa. Sem a barra, em minúsculas." maxLength={33} />
        <TextField label="Título" required value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} maxLength={120} />
        <TextArea label="Texto da resposta" required rows={6} value={body} onChange={(e) => setBody(e.target.value)} error={errors.body} maxLength={4096} />
      </form>
    </Dialog>
  );
}

export default function CannedTab() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => bv.get<{ items: Canned[] }>('/canned-responses').then((r) => r.items), []);
  const [edit, setEdit] = useState<{ item: Canned | null } | null>(null);
  const [del, setDel] = useState<Canned | null>(null);
  const closeEdit = useCallback(() => setEdit(null), []);
  const closeDel = useCallback(() => setDel(null), []);
  const remove = async () => { if (!del) return; try { await bv.del(`/canned-responses/${del.id}`); toast.success('Resposta excluída.'); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const rows = (data ?? []).filter((c) => !q.trim() || `${c.shortcut} ${c.title} ${c.body}`.toLowerCase().includes(q.trim().toLowerCase()));
  const columns: Column<Canned>[] = [
    { key: 's', header: 'Atalho', render: (c) => <code>/{c.shortcut}</code> },
    { key: 't', header: 'Título', render: (c) => <span className="font-medium">{c.title}</span> },
    { key: 'b', header: 'Texto', render: (c) => <span className="line-clamp-2 whitespace-pre-line text-xs">{c.body}</span> },
    {
      key: 'a', header: 'Ações', render: (c) => (
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" aria-label={`Editar resposta /${c.shortcut}`} onClick={() => setEdit({ item: c })}>Editar</Button>
          <Button size="sm" variant="secondary" aria-label={`Excluir resposta /${c.shortcut}`} onClick={() => setDel(c)}>Excluir</Button>
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Respostas prontas ficam disponíveis para todos os atendentes do órgão.</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} className="w-72 max-w-full" />
        <Button onClick={() => setEdit({ item: null })}>Nova resposta pronta</Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-bv-muted">{loading ? 'Carregando…' : `${rows.length} resposta(s).`}</p>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando respostas prontas" />
        : <DataTable caption="Respostas prontas" columns={columns} rows={rows} rowKey={(c) => c.id} empty="Nenhuma resposta pronta encontrada." />}
      {edit && <CannedDialog key={edit.item?.id ?? 'nova'} item={edit.item} onClose={closeEdit} onSaved={reload} />}
      {del && <ConfirmDialog open danger title="Excluir resposta pronta" confirmLabel="Excluir" message={`Excluir a resposta /${del.shortcut}?`} onConfirm={remove} onClose={closeDel} />}
    </div>
  );
}
