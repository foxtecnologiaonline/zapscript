'use client';
import React, { useRef, useState } from 'react';
import { API_ORIGIN, errMsg, getAccessToken, refreshSession } from '@/lib/balcao/api';
import { ROLE_LABEL } from '@/lib/balcao/format';
import { Badge, Banner, Button, DataTable, Dialog, TextArea, useToast, type Column } from '../../../_ui/ui';
import { csvCell, downloadText } from './_shared';
import { BULK_MAX, BULK_TEMPLATE, parseBulk, type BulkRow } from './bulk';
import type { Sector } from './UserDialogs';

interface BulkResult { row: number; email: string; ok: boolean; id?: string; temporaryPassword?: string; error?: { code: string; message: string } }
interface BulkResponse { total: number; created: number; failed: number; results: BulkResult[] }

/** POST /admin/users/bulk. O 422 ("nada criado") também traz o resultado por linha, então não usa o cliente genérico. */
async function postBulk(users: unknown[]): Promise<BulkResponse> {
  const send = () => fetch(`${API_ORIGIN}/balcao/admin/users/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: JSON.stringify({ users }),
  });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  const body = await res.json().catch(() => null);
  if (res.ok || (res.status === 422 && body?.results)) return body as BulkResponse;
  throw new Error(body?.error?.message ?? 'Não foi possível concluir o cadastro em massa.');
}

type Step = 'input' | 'preview' | 'result';

export default function BulkImport({ open, onClose, sectors, onDone }: { open: boolean; onClose: () => void; sectors: Sector[]; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [inErr, setInErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<BulkResponse | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [map, setMap] = useState<number[]>([]); // índice do payload → linha original
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setInErr('Arquivo grande demais (máximo de 2 MB).'); return; }
    setText(await f.text()); setInErr(null);
  };

  const preview = () => {
    if (!text.trim()) { setInErr('Cole o conteúdo do CSV ou envie um arquivo.'); return; }
    const { rows: r } = parseBulk(text, sectors);
    if (!r.length) { setInErr('Nenhuma linha de dados encontrada.'); return; }
    setInErr(null); setRows(r); setStep('preview');
  };

  const valid = rows.filter((r) => !r.errors.length);
  const invalid = rows.length - valid.length;

  const send = async () => {
    if (valid.length > BULK_MAX) { setSendErr(`No máximo ${BULK_MAX} linhas por vez; divida o arquivo.`); return; }
    setBusy(true); setSendErr(null);
    try {
      const payload = valid.map((r) => ({ email: r.email, name: r.name, role: r.role, ...(r.skills.length ? { skills: r.skills } : {}), ...(r.sectorId ? { sectorId: r.sectorId } : {}) }));
      setMap(valid.map((r) => r.line));
      const r = await postBulk(payload);
      setResp(r); setStep('result'); onDone();
      toast.success(`${r.created} usuário(s) criado(s)${r.failed ? `, ${r.failed} com falha` : ''}.`);
    } catch (e) { setSendErr(errMsg(e)); } finally { setBusy(false); }
  };

  const downloadResult = () => {
    if (!resp) return;
    const lines = [['linha', 'email', 'ok', 'senha_temporaria', 'erro'].join(','),
      ...resp.results.map((r) => [map[r.row - 1] ?? r.row, r.email, r.ok ? 'sim' : 'nao', r.temporaryPassword ?? '', r.error?.message ?? ''].map(csvCell).join(','))];
    downloadText('usuarios-importados.csv', lines.join('\r\n') + '\r\n');
  };

  const previewCols: Column<BulkRow>[] = [
    { key: 'line', header: 'Linha', render: (r) => r.line },
    { key: 'email', header: 'E-mail', render: (r) => r.email || '—' },
    { key: 'name', header: 'Nome', render: (r) => r.name || '—' },
    { key: 'role', header: 'Perfil', render: (r) => (r.role ? ROLE_LABEL[r.role] : r.roleRaw || '—') },
    { key: 'skills', header: 'Habilidades', render: (r) => r.skills.join(', ') || '—' },
    { key: 'sector', header: 'Setor', render: (r) => r.sectorRaw || '—' },
    { key: 'st', header: 'Validação', render: (r) => r.errors.length ? <div><Badge tone="danger">Com erro</Badge><ul className="mt-1 list-disc pl-4 text-xs">{r.errors.map((m) => <li key={m}>{m}</li>)}</ul></div> : <Badge tone="success">Válida</Badge> },
  ];
  const resultCols: Column<BulkResult>[] = [
    { key: 'line', header: 'Linha', render: (r) => map[r.row - 1] ?? r.row },
    { key: 'email', header: 'E-mail', render: (r) => r.email || '—' },
    { key: 'st', header: 'Resultado', render: (r) => r.ok ? <Badge tone="success">Criado</Badge> : <div><Badge tone="danger">Falhou</Badge><p className="mt-1 text-xs">{r.error?.message}</p></div> },
  ];

  const title = step === 'input' ? 'Cadastro em massa de usuários' : step === 'preview' ? 'Pré-visualização do cadastro' : 'Resultado do cadastro';
  const footer = step === 'input'
    ? <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={preview}>Pré-visualizar</Button></>
    : step === 'preview'
      ? <><Button variant="secondary" onClick={() => setStep('input')}>Voltar e corrigir</Button><Button loading={busy} disabled={!valid.length} onClick={() => void send()}>Cadastrar {valid.length} usuário(s)</Button></>
      : <><Button variant="secondary" onClick={downloadResult} disabled={!resp?.created}>Baixar CSV com senhas temporárias</Button><Button onClick={onClose}>Concluir</Button></>;

  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg" footer={footer}>
      {step === 'input' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Formato: <code>email,nome,perfil,habilidades;separadas,setor</code> (uma pessoa por linha, até {BULK_MAX}). O perfil aceita ATENDENTE, SUPERVISOR, ADMIN ou FISCAL; o setor deve já existir. A primeira linha pode ser um cabeçalho.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="bulk-file" className="text-sm font-medium">Enviar arquivo CSV</label>
              <input id="bulk-file" ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="text-sm" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
            <Button variant="ghost" onClick={() => downloadText('modelo-usuarios.csv', BULK_TEMPLATE)}>Baixar modelo</Button>
          </div>
          <TextArea label="Ou cole o conteúdo aqui" rows={8} value={text} onChange={(e) => setText(e.target.value)} error={inErr} spellCheck={false} className="font-mono text-sm" />
        </div>
      )}
      {step === 'preview' && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm"><strong>{valid.length}</strong> linha(s) válida(s) e <strong>{invalid}</strong> com erro. Apenas as válidas serão cadastradas.</p>
          {invalid > 0 && <Banner tone="warning">Corrija as linhas com erro e volte à etapa anterior, ou prossiga sem elas.</Banner>}
          {sendErr && <Banner tone="danger">{sendErr}</Banner>}
          <DataTable caption="Pré-visualização das linhas do CSV" columns={previewCols} rows={rows} rowKey={(r) => String(r.line)} />
        </div>
      )}
      {step === 'result' && resp && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm"><strong>{resp.created}</strong> criado(s) e <strong>{resp.failed}</strong> com falha, de {resp.total}.</p>
          {resp.created > 0 && <Banner tone="warning" title="Baixe agora as senhas temporárias">Elas não serão exibidas novamente. Cada usuário precisará trocar a senha no primeiro acesso. Trate o arquivo como dado sensível e apague-o após repassar as senhas.</Banner>}
          <DataTable caption="Resultado por linha" columns={resultCols} rows={resp.results} rowKey={(r) => String(r.row)} />
        </div>
      )}
    </Dialog>
  );
}
