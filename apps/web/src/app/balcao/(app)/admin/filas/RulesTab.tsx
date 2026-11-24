'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { CHANNEL_LABEL } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, ConfirmDialog, DataTable, Select, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, errFull, useLoad } from '../usuarios/_shared';
import RuleForm, { describeConditions } from './RuleForm';
import VersionHistory from './VersionHistory';
import { CHANNELS, type Queue, type Rule } from './types';

interface SimResult { ruleId: string | null; queueId: string | null; queueName: string | null; priority: number; outsideHours: boolean }

function Simulator({ rules, onResult }: { rules: Rule[]; onResult: (id: string | null) => void }) {
  const [channel, setChannel] = useState<string>('WHATSAPP');
  const [contactCategory, setContactCategory] = useState('');
  const [category, setCategory] = useState('');
  const [intent, setIntent] = useState('');
  const [waitSec, setWaitSec] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SimResult | null>(null);
  const cats = useLoad(() => bv.get<{ items?: string[]; categories?: string[] } | string[]>('/contacts/categories').then((r) => (Array.isArray(r) ? r : r.items ?? r.categories ?? [])).catch(() => [] as string[]), []);

  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const w = waitSec.trim() === '' ? undefined : Number(waitSec);
    if (w !== undefined && (!Number.isInteger(w) || w < 0)) { setErr('Tempo de espera: informe segundos (inteiro, 0 ou mais).'); return; }
    setBusy(true);
    try {
      const r = await bv.post<SimResult>('/routing-rules/test', { channel, ...(contactCategory.trim() ? { contactCategory: contactCategory.trim() } : {}), ...(category.trim() ? { category: category.trim() } : {}), ...(intent.trim() ? { intent: intent.trim() } : {}), ...(w !== undefined ? { waitSec: w } : {}), ...(at ? { at: new Date(at).toISOString() } : {}) });
      setRes(r); onResult(r.ruleId);
    } catch (e2) { setErr(errFull(e2)); setRes(null); onResult(null); } finally { setBusy(false); }
  };
  const rule = res?.ruleId ? rules.find((r) => r.id === res.ruleId) : null;
  return (
    <Card title="Simulador de roteamento">
      <p className="mb-3 text-sm text-bv-muted">Informe uma conversa hipotética para ver qual regra e qual fila seriam usadas. Nada é gravado.</p>
      <form onSubmit={run} noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select>
        <div>
          <TextField label="Categoria do contato" list="sim-contact-cats" value={contactCategory} onChange={(e) => setContactCategory(e.target.value)} />
          <datalist id="sim-contact-cats">{(cats.data ?? []).map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <TextField label="Categoria da demanda" value={category} onChange={(e) => setCategory(e.target.value)} />
        <TextField label="Intenção" value={intent} onChange={(e) => setIntent(e.target.value)} />
        <TextField label="Tempo de espera (segundos)" type="number" min={0} value={waitSec} onChange={(e) => setWaitSec(e.target.value)} />
        <TextField label="Data e hora (opcional)" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} hint="Vazio usa o momento atual." />
        <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" loading={busy}>Simular</Button></div>
      </form>
      <div role="status" aria-live="polite" className="mt-3">
        {err && <Banner tone="danger">{err}</Banner>}
        {res && (
          <Banner tone="primary" title="Resultado da simulação">
            <ul className="list-disc pl-5">
              <li>Regra aplicada: {rule ? <strong>{rule.name}</strong> : res.ruleId ? 'regra removida' : 'nenhuma (roteamento padrão por categoria/canal)'}</li>
              <li>Fila de destino: <strong>{res.queueName ?? 'nenhuma fila encontrada'}</strong></li>
              <li>Prioridade resultante: <strong>{res.priority}</strong></li>
              <li>{res.outsideHours ? 'Neste momento está fora do horário comercial.' : 'Neste momento está dentro do horário comercial.'}</li>
            </ul>
          </Banner>
        )}
      </div>
    </Card>
  );
}

export default function RulesTab() {
  const toast = useToast();
  const rulesQ = useLoad(() => bv.get<{ items: Rule[] }>('/routing-rules').then((r) => r.items), []);
  const queues = useLoad(() => bv.get<{ items: Queue[] }>('/queues').then((r) => r.items), []);
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<{ rule: Rule | null } | null>(null);
  const [del, setDel] = useState<Rule | null>(null);
  const [hist, setHist] = useState<Rule | null>(null);
  const closeHist = useCallback(() => setHist(null), []);
  const [hit, setHit] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const focusAfter = useRef<string | null>(null);
  const closeForm = useCallback(() => setForm(null), []);
  const closeDel = useCallback(() => setDel(null), []);

  useEffect(() => { if (rulesQ.data) setRules([...rulesQ.data].sort((a, b) => a.position - b.position)); }, [rulesQ.data]);
  useEffect(() => {
    if (!focusAfter.current) return;
    const id = focusAfter.current; focusAfter.current = null;
    const [kind, rid] = id.split(':');
    const el = document.getElementById(`rule-${kind}-${rid}`) as HTMLButtonElement | null;
    const target = el && !el.disabled ? el : (document.getElementById(`rule-${kind === 'up' ? 'down' : 'up'}-${rid}`) as HTMLButtonElement | null);
    target?.focus();
  }, [rules]);

  const queueName = (id: string) => queues.data?.find((q) => q.id === id)?.name ?? '(fila removida)';

  const move = async (idx: number, dir: -1 | 1) => {
    const to = idx + dir; if (to < 0 || to >= rules.length) return;
    const prev = rules; const next = [...rules]; const [m] = next.splice(idx, 1); next.splice(to, 0, m);
    setRules(next); focusAfter.current = `${dir < 0 ? 'up' : 'down'}:${m.id}`;
    setAnnounce(`Regra ${m.name} movida para a posição ${to + 1} de ${next.length}.`);
    try { await bv.post('/routing-rules/reorder', { ids: next.map((r) => r.id) }); }
    catch (e) { setRules(prev); setAnnounce(''); toast.error(errMsg(e)); rulesQ.reload(); }
  };
  const toggle = async (r: Rule) => { try { await bv.patch(`/routing-rules/${r.id}`, { active: !r.active }); toast.success(r.active ? 'Regra desativada.' : 'Regra ativada.'); rulesQ.reload(); } catch (e) { toast.error(errMsg(e)); } };
  const remove = async () => { if (!del) return; try { await bv.del(`/routing-rules/${del.id}`); toast.success('Regra excluída.'); rulesQ.reload(); } catch (e) { toast.error(errMsg(e)); } };

  const columns: Column<Rule>[] = [
    { key: 'pos', header: 'Ordem', render: (r) => <span className="font-semibold">{rules.indexOf(r) + 1}º</span> },
    { key: 'n', header: 'Regra', render: (r) => <div><div className="font-medium">{r.name}</div>{hit === r.id && <Badge tone="primary">Aplicada na simulação</Badge>}</div> },
    { key: 'c', header: 'Condições', render: (r) => <span className="text-xs">{describeConditions(r.conditions)}</span> },
    { key: 'a', header: 'Ação', render: (r) => <span className="text-xs">Fila <strong>{queueName(r.action.queueId)}</strong>{r.action.priorityBoost ? `, prioridade ${r.action.priorityBoost > 0 ? '+' : ''}${r.action.priorityBoost}` : ''}{r.action.setCategory ? `, categoria ${r.action.setCategory}` : ''}</span> },
    { key: 's', header: 'Situação', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge> },
    {
      key: 'act', header: 'Ações', render: (r) => {
        const i = rules.indexOf(r);
        return (
          <div className="flex flex-wrap gap-1">
            <Button id={`rule-up-${r.id}`} size="sm" variant="secondary" disabled={i === 0} aria-label={`Mover ${r.name} para cima`} onClick={() => void move(i, -1)}>Subir</Button>
            <Button id={`rule-down-${r.id}`} size="sm" variant="secondary" disabled={i === rules.length - 1} aria-label={`Mover ${r.name} para baixo`} onClick={() => void move(i, 1)}>Descer</Button>
            <Button size="sm" variant="secondary" aria-label={`Editar regra ${r.name}`} onClick={() => setForm({ rule: r })}>Editar</Button>
            <Button size="sm" variant="secondary" aria-label={`${r.active ? 'Desativar' : 'Ativar'} regra ${r.name}`} onClick={() => void toggle(r)}>{r.active ? 'Desativar' : 'Ativar'}</Button>
            <Button size="sm" variant="secondary" aria-label={`Histórico de versões da regra ${r.name}`} onClick={() => setHist(r)}>Histórico</Button>
            <Button size="sm" variant="secondary" aria-label={`Excluir regra ${r.name}`} onClick={() => setDel(r)}>Excluir</Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">As regras são avaliadas de cima para baixo; vale a primeira que combinar e cuja fila esteja ativa. Sem regra aplicável, a conversa segue o roteamento padrão por categoria e canal.</p>
      <div className="flex justify-end"><Button onClick={() => setForm({ rule: null })}>Nova regra</Button></div>
      <div aria-live="polite" className="bv-sr-only">{announce}</div>
      {rulesQ.error ? <ErrorBox message={rulesQ.error} onRetry={rulesQ.reload} /> : rulesQ.loading && !rulesQ.data ? <Loading label="Carregando regras" />
        : <DataTable caption="Regras de roteamento em ordem de avaliação" columns={columns} rows={rules} rowKey={(r) => r.id} empty="Nenhuma regra cadastrada. Sem regras, vale o roteamento padrão." />}
      <Simulator rules={rules} onResult={setHit} />
      {form && <RuleForm key={form.rule?.id ?? 'nova'} rule={form.rule} queues={queues.data ?? []} onClose={closeForm} onSaved={rulesQ.reload} />}
      {hist && <VersionHistory kind="rule" id={hist.id} name={hist.name} names={Object.fromEntries((queues.data ?? []).map((q) => [q.id, q.name]))} onClose={closeHist} />}
      {del && <ConfirmDialog open danger title="Excluir regra" confirmLabel="Excluir" message={`Excluir a regra "${del.name}"? As demais regras mantêm a ordem.`} onConfirm={remove} onClose={closeDel} />}
    </div>
  );
}
