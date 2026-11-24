'use client';
/**
 * Editor de URA (ivr:manage). Lista fluxos por nome/versão (DRAFT · ACTIVE · ARCHIVED), cria rascunhos, nova versão a
 * partir de qualquer versão, publica (troca atômica), compara versões e mostra o mapeamento DID → fluxo.
 * API: GET/POST /voice/ivr/flows, GET/PUT/DELETE /voice/ivr/flows/:id, POST /voice/ivr/flows/:id/publish.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { bv, BvApiError, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, ConfirmDialog, DataTable, Dialog, EmptyState, PageHeader, Select, Spinner, TextField, useToast, type Column } from '../../../_ui/ui';
import Editor from './Editor';
import { NEW_FLOW_TEMPLATE, STATUS_LABEL, STATUS_TONE, diffDefs, type FlowFull, type FlowSummary, type Issue } from './ivrTypes';

export default function UraPage() {
  const { can, status } = useBvSession();
  const toast = useToast();
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [pub, setPub] = useState<FlowSummary | null>(null);
  const [del, setDel] = useState<FlowSummary | null>(null);
  const [cmp, setCmp] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setFlows((await bv.get<{ items: FlowSummary[] }>('/voice/ivr/flows')).items); }
    catch (e) { setError(errMsg(e)); setFlows([]); }
  }, []);
  useEffect(() => { if (status === 'authed' && can('ivr:manage')) void load(); }, [status, can, load]);

  const groups = useMemo(() => {
    const m = new Map<string, FlowSummary[]>();
    (flows ?? []).forEach((f) => m.set(f.name, [...(m.get(f.name) ?? []), f]));
    m.forEach((v) => v.sort((a, b) => b.version - a.version));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [flows]);

  const newVersion = async (f: FlowSummary) => {
    setBusyId(f.id);
    try {
      const full = await bv.get<FlowFull>(`/voice/ivr/flows/${f.id}`);
      const created = await bv.post<FlowFull>('/voice/ivr/flows', { name: f.name, language: f.language, definition: full.definition });
      toast.success(`Rascunho da versão ${created.version} criado a partir da versão ${f.version}.`);
      await load(); setEditing(created.id);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusyId(null); }
  };

  if (status === 'authed' && !can('ivr:manage')) return <><PageHeader title="URA (atendimento por voz)" /><Banner tone="warning" title="Acesso restrito">Seu perfil não pode gerenciar a URA.</Banner></>;
  if (editing) return (
    <div>
      <PageHeader title="Editor da URA" subtitle="Edite o rascunho, valide, simule e publique." />
      <Editor flowId={editing} onClose={() => { setEditing(null); void load(); }} onChanged={() => void load()} />
    </div>
  );

  const cols = (name: string, list: FlowSummary[]): Column<FlowSummary>[] => [
    { key: 'v', header: 'Versão', render: (f) => `v${f.version}` },
    { key: 's', header: 'Situação', render: (f) => <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge> },
    { key: 'd', header: 'Números (DID)', render: (f) => (f.dids.length ? f.dids.join(', ') : 'padrão (sem número específico)') },
    { key: 'p', header: 'Publicada em', render: (f) => (f.publishedAt ? fmtDateTime(f.publishedAt) : '—') },
    { key: 'c', header: 'Criada em', render: (f) => fmtDateTime(f.createdAt) },
    {
      key: 'a', header: 'Ações', render: (f) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" onClick={() => setEditing(f.id)} aria-label={`${f.status === 'DRAFT' ? 'Editar' : 'Ver'} ${name} versão ${f.version}`}>{f.status === 'DRAFT' ? 'Editar' : 'Ver'}</Button>
          <Button size="sm" variant="secondary" loading={busyId === f.id} onClick={() => void newVersion(f)} aria-label={`Nova versão a partir de ${name} versão ${f.version}`}>Nova versão a partir desta</Button>
          {f.status !== 'ACTIVE' && <Button size="sm" onClick={() => setPub(f)} aria-label={`${f.status === 'ARCHIVED' ? 'Reativar' : 'Publicar'} ${name} versão ${f.version}`}>{f.status === 'ARCHIVED' ? 'Reativar' : 'Publicar'}</Button>}
          {f.status === 'DRAFT' && <Button size="sm" variant="danger" onClick={() => setDel(f)} aria-label={`Excluir rascunho ${name} versão ${f.version}`}>Excluir</Button>}
          {list.length > 1 && <Button size="sm" variant="ghost" onClick={() => setCmp(f.id)} aria-label={`Comparar ${name} versão ${f.version} com outra`}>Comparar</Button>}
        </div>
      ),
    },
  ];

  const active = (flows ?? []).filter((f) => f.status === 'ACTIVE');
  const didRows = active.flatMap((f) => (f.dids.length ? f.dids.map((d) => ({ key: `${f.id}-${d}`, did: d, flow: f })) : [{ key: `${f.id}-default`, did: '', flow: f }]));

  return (
    <div>
      <PageHeader title="URA (atendimento por voz)" subtitle="Fluxos de atendimento telefônico. Publicar troca o fluxo ativo sem parar o serviço." actions={<Button onClick={() => setNewOpen(true)}>Novo fluxo</Button>} />
      {error && <div className="mb-3"><Banner tone="danger" title="Não foi possível carregar os fluxos">{error} <Button size="sm" variant="secondary" onClick={() => void load()}>Tentar de novo</Button></Banner></div>}
      {flows === null ? <div className="flex justify-center p-8"><Spinner size={28} /></div>
        : !groups.length && !error ? <EmptyState title="Nenhum fluxo de URA cadastrado">Crie o primeiro fluxo com o botão "Novo fluxo". Sem fluxo ativo, as ligações não recebem URA.</EmptyState>
        : (
          <div className="flex flex-col gap-4">
            {!active.length && !error && <Banner tone="warning" title="Nenhum fluxo ativo">Publique uma versão para que as ligações recebidas sejam atendidas pela URA.</Banner>}
            {groups.map(([name, list]) => (
              <Card key={name} title={name}><DataTable caption={`Versões do fluxo ${name}`} columns={cols(name, list)} rows={list} rowKey={(f) => f.id} /></Card>
            ))}
            <Card title="Mapeamento número (DID) → fluxo ativo">
              {!didRows.length ? <p className="text-sm text-bv-muted">Nenhum fluxo ativo.</p> : (
                <DataTable caption="Números atendidos por cada fluxo ativo" rows={didRows} rowKey={(r) => r.key}
                  columns={[
                    { key: 'n', header: 'Número', render: (r) => r.did || 'Todos os demais números (fluxo padrão)' },
                    { key: 'f', header: 'Fluxo ativo', render: (r) => `${r.flow.name} (v${r.flow.version})` },
                    { key: 'o', header: 'Ação', render: (r) => <Button size="sm" variant="secondary" onClick={() => setEditing(r.flow.id)}>Ver fluxo</Button> },
                  ]} />
              )}
              <p className="mt-2 text-xs text-bv-muted">Os números são definidos nas configurações de cada fluxo (editor). Um número só pode ser atendido por um fluxo ativo; ligações para números sem fluxo próprio usam o fluxo ativo sem números.</p>
            </Card>
          </div>
        )}

      <NewFlowDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={async (id) => { await load(); setEditing(id); }} />
      <ConfirmDialog open={!!pub} title={pub ? `${pub.status === 'ARCHIVED' ? 'Reativar' : 'Publicar'} "${pub.name}" v${pub.version}` : ''} confirmLabel={pub?.status === 'ARCHIVED' ? 'Reativar agora' : 'Publicar agora'}
        message="A versão passa a atender as novas ligações e a versão ativa atual é arquivada. A troca é atômica e não interrompe o serviço: ligações em andamento terminam com a versão que já usavam."
        onClose={() => setPub(null)}
        onConfirm={async () => {
          if (!pub) return;
          try { await bv.post(`/voice/ivr/flows/${pub.id}/publish`); toast.success(`Versão ${pub.version} de "${pub.name}" publicada.`); await load(); }
          catch (e) {
            const errs = e instanceof BvApiError ? ((e.details as any)?.errors as Issue[] | undefined) : undefined;
            toast.error(errs?.length ? `Não foi possível publicar: ${errs.slice(0, 3).map((x) => x.message).join('; ')}. Abra o editor para corrigir.` : errMsg(e));
          }
        }} />
      <ConfirmDialog open={!!del} title="Excluir rascunho" danger confirmLabel="Excluir" message={del ? `Excluir o rascunho "${del.name}" v${del.version}? Esta ação não pode ser desfeita.` : ''} onClose={() => setDel(null)}
        onConfirm={async () => { if (!del) return; try { await bv.del(`/voice/ivr/flows/${del.id}`); toast.success('Rascunho excluído.'); await load(); } catch (e) { toast.error(errMsg(e)); } }} />
      {cmp && <CompareDialog base={flows?.find((f) => f.id === cmp)} list={(flows ?? []).filter((f) => f.name === flows?.find((x) => x.id === cmp)?.name)} onClose={() => setCmp(null)} />}
    </div>
  );
}

function NewFlowDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void | Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(''); setErr(null); } }, [open]);
  const create = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) { setErr('Informe um nome para o fluxo.'); return; }
    setBusy(true); setErr(null);
    try {
      const f = await bv.post<FlowFull>('/voice/ivr/flows', { name: name.trim(), definition: NEW_FLOW_TEMPLATE });
      toast.success('Rascunho criado a partir do modelo básico.'); onClose(); await onCreated(f.id);
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Novo fluxo de URA" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={() => void create()}>Criar rascunho</Button></>}>
      <form onSubmit={create} className="flex flex-col gap-3">
        <TextField label="Nome do fluxo" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={err} hint="Se já existir um fluxo com este nome, será criada uma nova versão." />
        <p className="text-sm text-bv-muted">O rascunho começa com um modelo simples (menu → atendimento humano / encerrar) que você edita em seguida.</p>
      </form>
    </Dialog>
  );
}

function CompareDialog({ base, list, onClose }: { base?: FlowSummary; list: FlowSummary[]; onClose: () => void }) {
  const [a, setA] = useState(base?.id ?? ''); const [b, setB] = useState(list.find((x) => x.id !== base?.id)?.id ?? '');
  const [res, setRes] = useState<{ fa: FlowFull; fb: FlowFull } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!a || !b || a === b) { setRes(null); return; }
    let off = false; setBusy(true); setErr(null);
    Promise.all([bv.get<FlowFull>(`/voice/ivr/flows/${a}`), bv.get<FlowFull>(`/voice/ivr/flows/${b}`)])
      .then(([fa, fb]) => !off && setRes({ fa, fb })).catch((e) => !off && setErr(errMsg(e))).finally(() => !off && setBusy(false));
    return () => { off = true; };
  }, [a, b]);
  const d = res ? diffDefs(res.fa.definition, res.fb.definition) : null;
  const opts = list.map((f) => <option key={f.id} value={f.id}>v{f.version} — {STATUS_LABEL[f.status]}</option>);
  return (
    <Dialog open onClose={onClose} size="lg" title={`Comparar versões de "${base?.name ?? ''}"`} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Versão A (base)" value={a} onChange={(e) => setA(e.target.value)}>{opts}</Select>
          <Select label="Versão B (comparada)" value={b} onChange={(e) => setB(e.target.value)}>{opts}</Select>
        </div>
        {a === b && <Banner tone="warning">Escolha duas versões diferentes.</Banner>}
        {busy && <Spinner />}
        {err && <Banner tone="danger">{err}</Banner>}
        {d && res && (
          <div role="status" className="flex flex-col gap-3 text-sm">
            {!d.added.length && !d.removed.length && !d.changed.length && !d.meta.length && <p>As duas versões são idênticas.</p>}
            {d.meta.length > 0 && <div><h3 className="font-semibold">Configurações</h3><ul className="list-disc pl-5">{d.meta.map((m) => <li key={m}>{m}</li>)}</ul></div>}
            {d.added.length > 0 && <div><h3 className="font-semibold">Nós adicionados na B ({d.added.length})</h3><p>{d.added.join(', ')}</p></div>}
            {d.removed.length > 0 && <div><h3 className="font-semibold">Nós removidos na B ({d.removed.length})</h3><p>{d.removed.join(', ')}</p></div>}
            {d.changed.length > 0 && (
              <div><h3 className="font-semibold">Nós alterados ({d.changed.length})</h3>
                {d.changed.map((id) => (
                  <details key={id} className="mt-1 rounded-md border border-bv-border p-2"><summary className="cursor-pointer font-medium">{id}</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div><p className="text-xs font-semibold">Versão A</p><pre className="max-h-64 overflow-auto rounded bg-bv-subtle p-2 text-xs">{JSON.stringify(res.fa.definition.nodes[id], null, 2)}</pre></div>
                      <div><p className="text-xs font-semibold">Versão B</p><pre className="max-h-64 overflow-auto rounded bg-bv-subtle p-2 text-xs">{JSON.stringify(res.fb.definition.nodes[id], null, 2)}</pre></div>
                    </div></details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
