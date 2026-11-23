'use client';
import React, { useCallback, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Checkbox, ConfirmDialog, DataTable, Dialog, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, copyText, fieldErrors, useLoad } from './_shared';

interface ApiToken { id: string; name: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

/** Escopos que um token de API pode receber (o backend recusa user:manage, org:manage e security:manage). */
const SCOPES: Array<{ id: string; label: string }> = [
  { id: 'report:read', label: 'Ler relatórios e indicadores' },
  { id: 'report:export', label: 'Exportar relatórios' },
  { id: 'fiscal:read', label: 'Ler consumo por item (painel do fiscal)' },
  { id: 'audit:read', label: 'Ler a trilha de auditoria' },
  { id: 'conversation:read_all', label: 'Ler todas as conversas' },
  { id: 'conversation:monitor', label: 'Monitorar conversas em tempo real' },
  { id: 'contact:read', label: 'Ler contatos' },
  { id: 'kb:read', label: 'Ler a base de conhecimento' },
  { id: 'task:read', label: 'Ler tarefas' },
  { id: 'quota:manage', label: 'Gerenciar cotas de consumo' },
];

function CreateTokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (t: { name: string; token: string }) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setScopes((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Informe um nome (mínimo de 2 caracteres).';
    if (!scopes.length) errs.scopes = 'Selecione ao menos um escopo.';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    setBusy(true);
    try {
      const r = await bv.post<{ name: string; token: string }>('/admin/tokens', { name: name.trim(), scopes });
      onCreated({ name: r.name, token: r.token }); onClose();
    } catch (err) { const m = fieldErrors(err); setErrors(m); setFormErr(Object.keys(m).length ? 'Corrija os campos destacados.' : errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Novo token de API" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-token" loading={busy}>Criar token</Button></>}>
      <form id="form-token" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <TextField label="Nome" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} hint="Identifica quem usa o token (ex.: Power BI do TJ-TO)." />
        <fieldset aria-describedby={errors.scopes ? 'tok-scopes-err' : undefined} className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-medium">Escopos (somente leitura/BI) <span className="bv-sr-only">(obrigatório)</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((s) => <Checkbox key={s.id} label={s.label} hint={s.id} checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} />)}
          </div>
          {errors.scopes && <p id="tok-scopes-err" role="alert" className="mt-2 text-sm text-bv-danger">{errors.scopes}</p>}
        </fieldset>
        <p className="text-xs text-bv-muted">Tokens nunca recebem permissões de gestão de usuários, órgão ou segurança.</p>
      </form>
    </Dialog>
  );
}

function ShowTokenDialog({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => { const ok = await copyText(token); setCopied(ok); if (!ok) toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.'); };
  return (
    <Dialog open onClose={onClose} title="Token criado" footer={<Button onClick={onClose}>Já guardei o token, fechar</Button>}>
      <div className="flex flex-col gap-3">
        <Banner tone="warning" title="Este token é exibido apenas uma vez">Guarde-o agora em um cofre de segredos. Se for perdido, revogue-o e crie outro.</Banner>
        <p className="text-sm">Token <strong>{name}</strong>:</p>
        <code className="select-all break-all rounded-md border border-bv-border bg-bv-subtle px-3 py-2 font-mono text-sm" aria-label="Token de API">{token}</code>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={copy}>Copiar token</Button>
          <span role="status" className="text-sm text-bv-success">{copied ? 'Token copiado.' : ''}</span>
        </div>
      </div>
    </Dialog>
  );
}

export default function TokensTab() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => bv.get<{ items: ApiToken[] }>('/admin/tokens').then((r) => r.items), []);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);
  const [revoke, setRevoke] = useState<ApiToken | null>(null);
  const closeCreate = useCallback(() => setCreating(false), []);
  const closeShown = useCallback(() => setShown(null), []);
  const closeRevoke = useCallback(() => setRevoke(null), []);

  const doRevoke = async () => { if (!revoke) return; try { await bv.del(`/admin/tokens/${revoke.id}`); toast.success('Token revogado.'); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const columns: Column<ApiToken>[] = [
    { key: 'n', header: 'Nome', render: (t) => <span className="font-medium">{t.name}</span> },
    { key: 's', header: 'Escopos', render: (t) => <span className="text-xs">{t.scopes.join(', ')}</span> },
    { key: 'c', header: 'Criado em', render: (t) => fmtDateTime(t.createdAt) },
    { key: 'u', header: 'Último uso', render: (t) => (t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : 'Nunca usado') },
    { key: 'st', header: 'Situação', render: (t) => (t.revokedAt ? <Badge tone="danger">Revogado em {fmtDateTime(t.revokedAt)}</Badge> : <Badge tone="success">Ativo</Badge>) },
    { key: 'a', header: 'Ações', render: (t) => (t.revokedAt ? '—' : <Button size="sm" variant="secondary" aria-label={`Revogar token ${t.name}`} onClick={() => setRevoke(t)}>Revogar</Button>) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Tokens de API permitem que ferramentas de BI e integrações leiam dados com escopo restrito, sem usar login de pessoa.</p>
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}>Novo token</Button></div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando tokens" />
        : <DataTable caption="Tokens de API" columns={columns} rows={data ?? []} rowKey={(t) => t.id} empty="Nenhum token criado." />}
      {creating && <CreateTokenDialog onClose={closeCreate} onCreated={(t) => { setTimeout(() => setShown(t), 80); reload(); }} />}
      {shown && <ShowTokenDialog name={shown.name} token={shown.token} onClose={closeShown} />}
      {revoke && <ConfirmDialog open danger title="Revogar token" confirmLabel="Revogar" message={`Revogar o token "${revoke.name}"? Quem o utiliza perderá o acesso imediatamente. Esta ação não pode ser desfeita.`} onConfirm={doRevoke} onClose={closeRevoke} />}
    </div>
  );
}
