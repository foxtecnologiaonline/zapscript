'use client';
import React, { useCallback, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, ConfirmDialog, DataTable, StatCard, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, Unavailable, errFull, useLoad } from '../usuarios/_shared';

interface Usage { table: string; column: string; byKid: Record<string, number>; plaintext: number; total: number }
interface Status { currentKid: string; knownKids: string[]; usage: Usage[] }
interface RotateResult { currentKid: string; tables: Array<{ table: string; column: string; rotated: number; skipped: number; failed: number; remaining: number }>; rotated: number; failed: number; remaining: number; done: boolean }

const TABLE_LABEL: Record<string, string> = {
  BvMessage: 'Mensagens', BvContact: 'Documento dos contatos (CPF/CNPJ)', BvUser: 'Segredos de MFA dos usuários', BvIntegration: 'Credenciais das integrações', BvConversationEvent: 'Sugestões de IA',
};

export default function KeysTab() {
  const toast = useToast();
  const { data, error, loading, unavailable, reload } = useLoad(() => bv.get<Status>('/security/keys/status'), []);
  const [confirm, setConfirm] = useState(false);
  const [res, setRes] = useState<RotateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = useCallback(() => setConfirm(false), []);
  if (unavailable) return <Unavailable what="A gestão de chaves de criptografia" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading label="Carregando status das chaves" />;

  const rotate = async () => {
    setErr(null);
    try { const r = await bv.post<RotateResult>('/security/keys/rotate', {}); setRes(r); toast.success(r.done ? 'Rotação concluída.' : 'Rotação parcial: execute novamente para continuar.'); reload(); }
    catch (e) { setErr(errFull(e)); }
  };
  const pending = (u: Usage) => u.plaintext + Object.entries(u.byKid).filter(([k]) => k !== data.currentKid).reduce((a, [, n]) => a + n, 0);
  const totalPending = data.usage.reduce((a, u) => a + pending(u), 0);

  const cols: Column<Usage>[] = [
    { key: 't', header: 'Dado cifrado', render: (u) => <div><div className="font-medium">{TABLE_LABEL[u.table] ?? u.table}</div><div className="text-xs text-bv-muted">{u.table}.{u.column}</div></div> },
    { key: 'n', header: 'Registros', render: (u) => fmtNumber(u.total) },
    { key: 'k', header: 'Por versão da chave', render: (u) => { const e = Object.entries(u.byKid); return e.length ? <ul className="text-xs">{e.map(([k, n]) => <li key={k}>Versão {k}{k === data.currentKid ? ' (atual)' : ''}: {fmtNumber(n)}</li>)}</ul> : '—'; } },
    { key: 'p', header: 'Sem cifra', render: (u) => (u.plaintext ? <Badge tone="danger">{fmtNumber(u.plaintext)} em texto claro</Badge> : <Badge tone="success">Nenhum</Badge>) },
    { key: 'r', header: 'A recifrar', render: (u) => (pending(u) ? <Badge tone="warning">{fmtNumber(pending(u))} pendente(s)</Badge> : <Badge tone="success">Em dia</Badge>) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Campos sensíveis (conteúdo de mensagens, documentos, segredos de MFA, credenciais) são cifrados em repouso com AES-256-GCM. Cada registro guarda a versão da chave usada. Aqui só aparecem contagens; o material das chaves nunca é exibido.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Versão da chave atual" value={data.currentKid} />
        <StatCard label="Versões conhecidas" value={data.knownKids.join(', ')} />
        <StatCard label="Registros a recifrar" value={fmtNumber(totalPending)} tone={totalPending ? 'warning' : 'success'} hint={totalPending ? 'Execute a rotação' : 'Tudo na chave atual'} />
      </div>
      <DataTable caption="Uso das chaves de criptografia por tipo de dado" columns={cols} rows={data.usage} rowKey={(u) => `${u.table}.${u.column}`} />
      <Card title="Rotação de chaves">
        <div className="flex flex-col gap-3 text-sm">
          <p>A rotação recifra, em lotes, os registros que ainda usam uma chave antiga (ou estão sem cifra) para a <strong>chave atual</strong>. É seguro repetir e pode ser retomada.</p>
          <Banner tone="primary">Para trocar a chave atual, primeiro configure a nova versão no servidor (variáveis <code>BV_FIELD_KEYS</code> e <code>BV_FIELD_KEY_CURRENT</code>) e reinicie a API; depois execute a rotação aqui.</Banner>
          <div><Button onClick={() => setConfirm(true)}>Rotacionar chaves…</Button></div>
          <div role="status" aria-live="polite">
            {err && <Banner tone="danger">{err}</Banner>}
            {res && (
              <div className="flex flex-col gap-2">
                <Banner tone={res.done && !res.failed ? 'success' : 'warning'} title={res.done ? 'Rotação concluída' : 'Rotação parcial'}>
                  {fmtNumber(res.rotated)} registro(s) recifrado(s), {fmtNumber(res.failed)} falha(s), {fmtNumber(res.remaining)} restante(s) para a chave {res.currentKid}.{!res.done && ' Execute novamente para continuar.'}
                </Banner>
                <ul className="list-disc pl-5 text-xs">{res.tables.map((t) => <li key={t.table}>{TABLE_LABEL[t.table] ?? t.table}: {fmtNumber(t.rotated)} recifrado(s), {fmtNumber(t.remaining)} restante(s){t.failed ? `, ${t.failed} falha(s)` : ''}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      </Card>
      {confirm && <ConfirmDialog open title="Rotacionar chaves de criptografia" confirmLabel="Rotacionar" message={`Recifrar até 20.000 registros para a chave versão ${data.currentKid}? A operação é segura e pode ser repetida, mas pode levar alguns minutos e aumentar a carga do banco.`} onConfirm={rotate} onClose={close} />}
    </div>
  );
}
