'use client';
/**
 * Aba IQA (indicador 07): definição exata, apuração por mês de contrato e — para quem tem `org:manage` — formulário da
 * configuração (`GET/PUT /reports/iqa/config`): base do denominador, metas por mês de contrato e faixas de glosa.
 */
import React, { useEffect, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, ConfirmDialog, DataTable, Select, TextField, useToast } from '../../_ui/ui';
import { errFull } from '../admin/usuarios/_shared';
import { ChartFrame, LineChart } from './charts';
import { DownloadButton, StateGate, addDays, fmtUnit, fmtYmd, num, useApi, type TabProps } from './lib';

type Denominator = 'ALL_BOT' | 'AUTOMATABLE';
interface IqaConfig { denominator: Denominator; goals: Array<{ fromMonth: number; goalPct: number }>; glosa: Array<{ maxGapPp: number | null; glosaPct: number }> }

const DENOM_LABEL: Record<Denominator, string> = {
  ALL_BOT: 'Todos os atendimentos via chatbot (padrão do edital)',
  AUTOMATABLE: 'Somente os atendimentos via chatbot classificados como automatizáveis',
};
const DENOM_SHORT: Record<Denominator, string> = { ALL_BOT: 'todos os atendimentos via chatbot', AUTOMATABLE: 'atendimentos via chatbot automatizáveis' };
const DEFAULT_GOALS = [{ a: '1', b: '40' }, { a: '4', b: '60' }, { a: '7', b: '80' }];
const DEFAULT_GLOSA = [{ a: '10', b: '10' }, { a: '20', b: '15' }];
const DEFAULT_LAST = '20';

interface Row { a: string; b: string }
const toNum = (s: string): number | null => { const t = s.trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };

// ── Formulário de configuração ───────────────────────────────────────────────
function ConfigForm({ cfg, onSaved }: { cfg: IqaConfig; onSaved: () => void }) {
  const toast = useToast();
  const [denom, setDenom] = useState<Denominator>(cfg.denominator);
  const [goals, setGoals] = useState<Row[]>(cfg.goals.map((g) => ({ a: String(g.fromMonth), b: String(g.goalPct) })));
  const [bands, setBands] = useState<Row[]>(cfg.glosa.filter((g) => g.maxGapPp != null).map((g) => ({ a: String(g.maxGapPp), b: String(g.glosaPct) })));
  const [last, setLast] = useState(String(cfg.glosa.find((g) => g.maxGapPp == null)?.glosaPct ?? DEFAULT_LAST));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<IqaConfig | null>(null);
  const [saved, setSaved] = useState('');

  // reinicia quando a configuração efetiva muda no servidor (após salvar)
  useEffect(() => {
    setDenom(cfg.denominator);
    setGoals(cfg.goals.map((g) => ({ a: String(g.fromMonth), b: String(g.goalPct) })));
    setBands(cfg.glosa.filter((g) => g.maxGapPp != null).map((g) => ({ a: String(g.maxGapPp), b: String(g.glosaPct) })));
    setLast(String(cfg.glosa.find((g) => g.maxGapPp == null)?.glosaPct ?? DEFAULT_LAST));
  }, [cfg]);

  const denomChanged = denom !== cfg.denominator;
  const upd = (set: React.Dispatch<React.SetStateAction<Row[]>>, i: number, k: 'a' | 'b', v: string) => set((l) => l.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const validate = (): IqaConfig | null => {
    const e: Record<string, string> = {};
    const g: IqaConfig['goals'] = [];
    goals.forEach((r, i) => {
      const m = toNum(r.a), p = toNum(r.b);
      if (m == null || !Number.isInteger(m) || m < 1 || m > 60) e[`g${i}a`] = 'Informe um mês inteiro de 1 a 60.';
      if (p == null || p < 0 || p > 100) e[`g${i}b`] = 'Informe um percentual de 0 a 100.';
      if (m != null && p != null && !e[`g${i}a`] && !e[`g${i}b`]) g.push({ fromMonth: m, goalPct: p });
    });
    if (goals.length < 1 || goals.length > 12) e.goals = 'Informe de 1 a 12 metas.';
    else {
      const months = goals.map((r) => toNum(r.a));
      months.forEach((m, i) => { if (m != null && months.indexOf(m) !== i) e[`g${i}a`] = 'Este mês já foi usado em outra meta.'; });
      if (!months.includes(1)) e.goals = 'É preciso haver uma meta com início no mês 1.';
    }
    const b: IqaConfig['glosa'] = [];
    bands.forEach((r, i) => {
      const gap = toNum(r.a), p = toNum(r.b);
      if (gap == null || gap < 0 || gap > 100) e[`b${i}a`] = 'Informe a distância máxima de 0 a 100 p.p.';
      if (p == null || p < 0 || p > 100) e[`b${i}b`] = 'Informe a glosa de 0 a 100%.';
      if (gap != null && p != null && !e[`b${i}a`] && !e[`b${i}b`]) b.push({ maxGapPp: gap, glosaPct: p });
    });
    const gaps = bands.map((r) => toNum(r.a));
    gaps.forEach((gp, i) => { if (gp != null && !e[`b${i}a`] && gaps.indexOf(gp) !== i) e[`b${i}a`] = 'Distância repetida em outra faixa.'; });
    if (bands.length > 9) e.bands = 'No máximo 9 faixas, além da faixa final.';
    const lp = toNum(last);
    if (lp == null || lp < 0 || lp > 100) e.last = 'Informe a glosa da faixa final de 0 a 100%.';
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      denominator: denom,
      goals: [...g].sort((x, y) => x.fromMonth - y.fromMonth),
      glosa: [...b].sort((x, y) => (x.maxGapPp ?? 0) - (y.maxGapPp ?? 0)).concat([{ maxGapPp: null, glosaPct: lp! }]),
    };
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault(); setServerErr(null); setSaved('');
    const body = validate();
    if (!body) { setServerErr('Corrija os campos indicados antes de salvar.'); return; }
    if (denomChanged) setConfirm(body); else void save(body);
  };
  const save = async (body: IqaConfig) => {
    try {
      await bv.put('/reports/iqa/config', body);
      toast.success('Configuração do IQA salva.'); setSaved('Configuração do IQA salva. Os valores abaixo foram recalculados.'); onSaved();
    } catch (e) { setServerErr(errFull(e)); }
  };
  const reset = () => { setGoals(DEFAULT_GOALS); setBands(DEFAULT_GLOSA); setLast(DEFAULT_LAST); setErrors({}); setSaved(''); };

  return (
    <Card title="Configuração do IQA">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Base de cálculo (denominador)</legend>
          <Select label="Denominador do IQA" value={denom} onChange={(e) => setDenom(e.target.value as Denominator)}
            hint="Numerador (fixo): atendimentos via chatbot resolvidos no 1º contato e classificados como automatizáveis.">
            <option value="ALL_BOT">{DENOM_LABEL.ALL_BOT}</option>
            <option value="AUTOMATABLE">{DENOM_LABEL.AUTOMATABLE}</option>
          </Select>
          {denomChanged && <Banner tone="warning" title="Atenção: a mudança de base altera o resultado">Trocar a base muda o valor do IQA de todos os meses (inclusive os já encerrados), o enquadramento na meta e, portanto, a glosa apurada. Confirme com o fiscal do contrato antes de salvar.</Banner>}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Metas por mês de contrato</legend>
          <p className="text-xs text-bv-muted">Cada meta vale a partir do mês indicado até a próxima. Deve existir uma meta iniciando no mês 1.</p>
          {goals.map((r, i) => (
            <div key={i} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <TextField label={`Meta ${i + 1} — a partir do mês`} type="number" min={1} max={60} step={1} value={r.a} error={errors[`g${i}a`]} onChange={(e) => upd(setGoals, i, 'a', e.target.value)} />
              <TextField label={`Meta ${i + 1} — percentual (%)`} type="number" min={0} max={100} step="any" value={r.b} error={errors[`g${i}b`]} onChange={(e) => upd(setGoals, i, 'b', e.target.value)} />
              <div className="sm:pt-6"><Button variant="secondary" size="sm" disabled={goals.length <= 1} aria-label={`Remover meta ${i + 1}`} onClick={() => setGoals((l) => l.filter((_, j) => j !== i))}>Remover</Button></div>
            </div>
          ))}
          {errors.goals && <p role="alert" className="text-sm text-bv-danger">{errors.goals}</p>}
          <div><Button variant="secondary" size="sm" disabled={goals.length >= 12} onClick={() => setGoals((l) => [...l, { a: '', b: '' }])}>Adicionar meta</Button></div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Faixas de glosa</legend>
          <p className="text-xs text-bv-muted">A glosa só é apurada em mês encerrado e depende de quantos pontos percentuais (p.p.) o IQA ficou abaixo da meta. Meta atingida = sem glosa.</p>
          {[...bands].map((r, i) => (
            <div key={i} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <TextField label={`Faixa ${i + 1} — até (p.p. abaixo da meta)`} type="number" min={0} max={100} step="any" value={r.a} error={errors[`b${i}a`]} onChange={(e) => upd(setBands, i, 'a', e.target.value)} />
              <TextField label={`Faixa ${i + 1} — glosa (%)`} type="number" min={0} max={100} step="any" value={r.b} error={errors[`b${i}b`]} onChange={(e) => upd(setBands, i, 'b', e.target.value)} />
              <div className="sm:pt-6"><Button variant="secondary" size="sm" aria-label={`Remover faixa ${i + 1}`} onClick={() => setBands((l) => l.filter((_, j) => j !== i))}>Remover</Button></div>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div><p className="text-sm font-medium">Faixa final</p><p className="text-sm text-bv-muted">Mais de {bands.length ? `${bands.map((r) => toNum(r.a) ?? 0).reduce((m, x) => Math.max(m, x), 0)}` : '0'} p.p. abaixo da meta (demais casos)</p></div>
            <TextField label="Faixa final — glosa (%)" type="number" min={0} max={100} step="any" value={last} error={errors.last} onChange={(e) => setLast(e.target.value)} />
          </div>
          {errors.bands && <p role="alert" className="text-sm text-bv-danger">{errors.bands}</p>}
          <div><Button variant="secondary" size="sm" disabled={bands.length >= 9} onClick={() => setBands((l) => [...l, { a: '', b: '' }])}>Adicionar faixa</Button></div>
        </fieldset>

        {serverErr && <Banner tone="danger">{serverErr}</Banner>}
        <div role="status" aria-live="polite">{saved && <Banner tone="success">{saved}</Banner>}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Salvar configuração</Button>
          <Button variant="ghost" onClick={reset}>Preencher metas e faixas com o padrão</Button>
        </div>
        <p className="text-xs text-bv-muted">As faixas de glosa (10/15/20%) seguem a interpretação adotada pelo sistema; confirme com o contrato. A alteração é registrada em auditoria.</p>
      </form>
      {confirm && (
        <ConfirmDialog open danger title="Trocar a base do IQA?" confirmLabel="Trocar e salvar" onClose={() => setConfirm(null)} onConfirm={() => save(confirm)}
          message={<>A base passará de “{DENOM_SHORT[cfg.denominator]}” para “{DENOM_SHORT[confirm.denominator]}”. O valor do IQA, o enquadramento na meta e a glosa de todos os meses serão recalculados com a nova base. Deseja continuar?</>} />
      )}
    </Card>
  );
}

// ── Aba ──────────────────────────────────────────────────────────────────────
export function IqaTab({ q }: TabProps) {
  const { can } = useBvSession();
  const canManage = can('org:manage');
  const [start, setStart] = useState('');
  const iq = { channel: q.channel, queueId: q.queueId, agentId: q.agentId, startDate: start || undefined };
  const { data, loading, error, reload } = useApi<any>('/reports/iqa', iq);
  const cfg = useApi<IqaConfig>(canManage ? '/reports/iqa/config' : null);
  const months: any[] = data?.months ?? [];
  const bands: any[] = data?.glosaBands ?? [];
  const kind: Denominator = data?.denominator === 'AUTOMATABLE' ? 'AUTOMATABLE' : 'ALL_BOT';
  const status = (m: any) => (m.value == null ? <Badge>Sem dados</Badge> : m.reachedGoal ? <Badge tone="success">✔ Meta atingida</Badge> : <Badge tone="danger">✖ Abaixo da meta</Badge>);
  const labels = months.map((m) => `Mês ${m.contractMonth}`);
  const denomText = (m: any) => (m.denominatorKind === 'AUTOMATABLE' ? `${fmtNumber(m.numerator)} de ${fmtNumber(m.denominator)} automatizáveis` : `${fmtNumber(m.numerator)} de ${fmtNumber(m.denominator)} via chatbot`);
  const onSaved = () => { void reload(); void cfg.reload(); };

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs"><TextField label="Início do contrato (opcional)" type="date" value={start} onChange={(e) => setStart(e.target.value)} hint="Em branco: usa a data configurada para o órgão." /></div>
      <StateGate loading={loading} error={error} data={data} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-end gap-2"><DownloadButton path="/reports/iqa" filename="iqa.csv" query={{ ...iq, format: 'csv' }} /></div>
            <Card title="Definição do indicador">
              <p className="text-sm"><strong>{data.indicator}</strong>: {data.definition}.</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                <li><strong>Numerador:</strong> atendimentos via chatbot resolvidos pelo assistente no 1º contato e classificados como automatizáveis.</li>
                <li><strong>Denominador (base atual):</strong> {DENOM_LABEL[kind]}.</li>
                <li>Metas: {(data.goals ?? []).map((g: any) => `meses ${g.months} → ${g.goalPct}%`).join('; ')}. Meses de contrato começam em {fmtYmd(data.contract?.startDate)}{data.contract?.source !== 'settings' ? ' (data inferida da 1ª conversa; configure o início do contrato nas configurações do órgão)' : ''}.</li>
              </ul>
              {kind === 'ALL_BOT' && <p className="mt-2 text-xs text-bv-muted">Atendimentos ainda abertos e os não classificados como automatizáveis também entram no denominador desta base.</p>}
            </Card>
            <ChartFrame title="IQA por mês de contrato" summary={months.length ? `${months.length} mês(es) de contrato. Último: ${labels[months.length - 1]} com ${fmtUnit('percent', months[months.length - 1].value)} (meta ${months[months.length - 1].goal}%).` : 'Sem meses de contrato apurados.'}
              table={<DataTable caption="IQA por mês de contrato" rows={months} rowKey={(m) => String(m.contractMonth)} empty="Sem meses de contrato apurados." columns={[
                { key: 'm', header: 'Mês de contrato', render: (m) => `Mês ${m.contractMonth}` }, { key: 'p', header: 'Período', render: (m) => `${fmtYmd(m.from.slice(0, 10))} a ${fmtYmd(addDays(m.to.slice(0, 10), -1))}` },
                { key: 'b', header: 'Via chatbot', render: (m) => fmtNumber(m.botInvolved) }, { key: 'a', header: 'Automatizáveis', render: (m) => fmtNumber(m.automatable) },
                { key: 'n', header: 'Numerador', render: (m) => fmtNumber(m.numerator) },
                { key: 'd', header: 'Denominador', render: (m) => <><span>{fmtNumber(m.denominator)}</span><span className="block text-xs text-bv-muted">{m.denominatorKind === 'AUTOMATABLE' ? 'automatizáveis' : 'via chatbot'}</span></> },
                { key: 'v', header: 'IQA', render: (m) => <><span>{fmtUnit('percent', m.value)}</span>{m.value != null && <span className="block text-xs text-bv-muted">{denomText(m)}</span>}</> },
                { key: 'g', header: 'Meta', render: (m) => `${m.goal}%` }, { key: 's', header: 'Situação', render: status },
                { key: 'gap', header: 'Distância da meta', render: (m) => (m.gapPp == null ? '—' : m.gapPp <= 0 ? 'Meta superada' : `${fmtNumber(m.gapPp, 1)} p.p. abaixo`) },
                { key: 'gl', header: 'Faixa de glosa', render: (m) => (m.glosaPct == null ? (m.value == null ? '—' : 'Mês em andamento') : `${m.glosaPct}%`) }]} />}>
              <LineChart title="IQA e meta por mês de contrato" desc={months.map((m, i) => `${labels[i]}: IQA ${fmtUnit('percent', m.value)}, meta ${m.goal}%`).join('; ')} labels={labels}
                series={[{ name: 'IQA (%)', values: months.map((m) => num(m.value)) }, { name: 'Meta (%)', values: months.map((m) => m.goal) }]} yFmt={(n) => `${fmtNumber(n, 0)}%`} yMax={100} />
            </ChartFrame>
            <Card title="Faixas de glosa aplicadas">
              <ul className="list-disc pl-5 text-sm">{bands.map((b: any, i: number) => <li key={i}>{b.maxGapPp == null ? `Mais de ${bands[i - 1]?.maxGapPp ?? 0} p.p. abaixo da meta` : `Até ${b.maxGapPp} p.p. abaixo da meta`}: glosa de {b.glosaPct}%.</li>)}</ul>
              <p className="mt-2 text-xs text-bv-muted">Glosa apurada apenas em mês encerrado; meta atingida = 0%. Interpretação adotada pelo sistema — confirmar com o contrato.</p>
            </Card>
          </div>
        )}
      </StateGate>
      {canManage && (
        <StateGate loading={cfg.loading} error={cfg.error} data={cfg.data} onRetry={cfg.reload}>
          {cfg.data && <ConfigForm cfg={cfg.data} onSaved={onSaved} />}
        </StateGate>
      )}
    </div>
  );
}
