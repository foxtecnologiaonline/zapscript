'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { fmtBytes, fmtDateTime, fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, DataTable, Dialog, Select, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, Unavailable, copyText, errFull, hasCode, useLoad } from '../usuarios/_shared';
import ExportLinkDialog from './ExportLinkDialog';

type Fmt = 'JSON' | 'CSV' | 'XML' | 'SQL';
interface Job {
  id: string; format: Fmt; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; createdAt: string; finishedAt: string | null; expiresAt: string | null; sha256: string | null; sizeBytes: number | null;
  error: string | null; progress: { percent?: number; rowsDone?: number; rowsTotal?: number } | null; includeDocuments: boolean; totals: { dataFiles?: number; rows?: number; copiedFiles?: number; bytes?: number } | null; downloadable: boolean;
}
const FMT_HINT: Record<Fmt, string> = { JSON: 'Um arquivo por tabela, legível por qualquer sistema.', CSV: 'Planilhas por tabela (UTF-8).', XML: 'Estruturado, um arquivo por tabela.', SQL: 'Comandos INSERT para restaurar em um banco PostgreSQL.' };
const STATUS: Record<Job['status'], { label: string; tone: 'neutral' | 'primary' | 'success' | 'danger' }> = { PENDING: { label: 'Na fila', tone: 'neutral' }, RUNNING: { label: 'Em andamento', tone: 'primary' }, DONE: { label: 'Concluída', tone: 'success' }, FAILED: { label: 'Falhou', tone: 'danger' } };

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [format, setFormat] = useState<Fmt>('JSON');
  const [files, setFiles] = useState(true); const [docs, setDocs] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await bv.post('/security/export', { format, includeFiles: files, includeDocuments: docs }); toast.success('Exportação iniciada. Acompanhe o progresso na lista.'); onCreated(); onClose(); }
    catch (e2) { setErr(hasCode(e2, 'export.busy') ? 'Já existe uma exportação integral em andamento. Aguarde a conclusão.' : errFull(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Nova exportação integral" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-export" loading={busy}>Iniciar exportação</Button></>}>
      <form id="form-export" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {err && <Banner tone="danger">{err}</Banner>}
        <Select label="Formato dos dados" required value={format} onChange={(e) => setFormat(e.target.value as Fmt)} hint={FMT_HINT[format]}>
          {(['JSON', 'CSV', 'XML', 'SQL'] as Fmt[]).map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Checkbox label="Incluir anexos e gravações" hint="Copia os arquivos para dentro do pacote (aumenta o tamanho)." checked={files} onChange={(e) => setFiles(e.target.checked)} />
        <Checkbox label="Incluir CPF/CNPJ em texto claro" hint="Por padrão o documento não é exportado. Marque só se o contrato exigir." checked={docs} onChange={(e) => setDocs(e.target.checked)} />
        {docs && <Banner tone="warning" title="Dado pessoal sensível">O pacote conterá documentos em texto claro. Guarde-o cifrado e registre a entrega; o pedido é auditado.</Banner>}
        <p className="text-xs text-bv-muted">O pacote (.tar.gz) traz todos os dados do órgão, um <code>manifest.json</code> com contagem de linhas e SHA-256 de cada arquivo, e fica disponível até a data de expiração. Só uma exportação pode rodar por vez.</p>
      </form>
    </Dialog>
  );
}

export default function ExportTab() {
  const { data, error, loading, unavailable, reload } = useLoad(() => bv.get<{ items: Job[] }>('/security/exports').then((r) => r.items), []);
  const [creating, setCreating] = useState(false);
  const [linkJob, setLinkJob] = useState<Job | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const close = useCallback(() => setCreating(false), []);
  const closeLink = useCallback(() => setLinkJob(null), []);
  const running = (data ?? []).some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => { if (!running) return; const t = setInterval(() => reloadRef.current(), 4000); return () => clearInterval(t); }, [running]);
  if (unavailable) return <Unavailable what="A exportação final de contrato" />;

  const copySha = async (j: Job) => { if (j.sha256 && (await copyText(j.sha256))) { setCopied(j.id); setTimeout(() => setCopied(null), 3000); } };

  const cols: Column<Job>[] = [
    { key: 'd', header: 'Solicitada em', render: (j) => fmtDateTime(j.createdAt) },
    { key: 'f', header: 'Formato', render: (j) => <div>{j.format}{j.includeDocuments && <div><Badge tone="warning">Com CPF/CNPJ</Badge></div>}</div> },
    {
      key: 's', header: 'Situação e progresso', render: (j) => {
        const pct = j.status === 'DONE' ? 100 : Math.max(0, Math.min(100, Math.round(j.progress?.percent ?? 0)));
        return (
          <div className="flex min-w-[10rem] flex-col gap-1">
            <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
            {(j.status === 'RUNNING' || j.status === 'PENDING') && <><progress max={100} value={pct} aria-label={`Progresso da exportação de ${fmtDateTime(j.createdAt)}`} className="w-full" /><span className="text-xs text-bv-muted">{pct}%{j.progress?.rowsTotal ? ` · ${fmtNumber(j.progress.rowsDone ?? 0)} de ${fmtNumber(j.progress.rowsTotal)} linhas` : ''}</span></>}
            {j.status === 'FAILED' && <span className="text-xs text-bv-danger">{j.error ?? 'Erro desconhecido.'}</span>}
          </div>
        );
      },
    },
    { key: 'm', header: 'Manifesto', render: (j) => (j.totals ? <ul className="text-xs"><li>{fmtNumber(j.totals.dataFiles ?? 0)} arquivo(s) de dados</li><li>{fmtNumber(j.totals.rows ?? 0)} linha(s)</li><li>{fmtNumber(j.totals.copiedFiles ?? 0)} anexo(s)/gravação(ões)</li></ul> : '—') },
    { key: 'z', header: 'Pacote', render: (j) => (j.sizeBytes != null ? <div className="text-xs"><div>{fmtBytes(j.sizeBytes)}</div>{j.sha256 && <div className="break-all font-mono text-bv-muted">SHA-256 {j.sha256}</div>}{j.expiresAt && <div>Expira em {fmtDateTime(j.expiresAt)}</div>}</div> : '—') },
    {
      key: 'a', header: 'Ações', render: (j) => j.downloadable ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" aria-label={`Baixar exportação de ${fmtDateTime(j.createdAt)}`} onClick={() => setLinkJob(j)}>Baixar</Button>
          {j.sha256 && <Button size="sm" variant="secondary" aria-label="Copiar SHA-256 do pacote" onClick={() => void copySha(j)}>{copied === j.id ? 'Copiado' : 'Copiar SHA-256'}</Button>}
        </div>
      ) : '—',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Exportação final do contrato: gera um pacote com todos os dados do órgão (conversas, contatos, tarefas, auditoria etc.), anexos e gravações, acompanhado de manifesto com somas de verificação, para entrega ao contratante.</p>
      <div className="flex justify-end"><Button disabled={running} onClick={() => setCreating(true)}>Nova exportação</Button></div>
      {running && <Banner tone="primary" title="Exportação em andamento">A lista é atualizada automaticamente a cada poucos segundos.</Banner>}
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando exportações" />
        : <DataTable caption="Exportações integrais" columns={cols} rows={data ?? []} rowKey={(j) => j.id} empty="Nenhuma exportação solicitada." />}
      <Card title="Conferência de integridade"><p className="text-sm">O download usa um link de uso único, válido por 60 segundos, gerado ao clicar em “Baixar”. Depois do download, confira a soma SHA-256 do arquivo (<code>sha256sum balcao-export-….tar.gz</code>) com o valor exibido acima. O <code>manifest.json</code> dentro do pacote lista a soma de cada arquivo interno.</p></Card>
      {linkJob && <ExportLinkDialog job={linkJob} onClose={closeLink} />}
      {creating && <CreateDialog onClose={close} onCreated={reload} />}
    </div>
  );
}
