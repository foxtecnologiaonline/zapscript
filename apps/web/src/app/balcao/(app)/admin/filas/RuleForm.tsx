'use client';
import React, { useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { CHANNEL_LABEL } from '@/lib/balcao/format';
import { Banner, Button, Checkbox, Dialog, Select, TextField, useToast } from '../../../_ui/ui';
import { WEEKDAY_PT, fieldErrors, hasCode } from '../usuarios/_shared';
import { CHANNELS, type Queue, type Rule, type RuleConditions } from './types';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const list = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
const NUM_DAY = (d: number | string) => (typeof d === 'number' ? DAYS[d] : d);

/** Resumo legível das condições (usado na tabela e no simulador). */
export function describeConditions(c: RuleConditions): string {
  const p: string[] = [];
  if (c.channels?.length) p.push(`canal: ${c.channels.map((x) => CHANNEL_LABEL[x] ?? x).join(' ou ')}`);
  if (c.contactCategories?.length) p.push(`contato: ${c.contactCategories.join(' ou ')}`);
  if (c.categories?.length) p.push(`categoria: ${c.categories.join(' ou ')}`);
  if (c.intents?.length) p.push(`intenção: ${c.intents.join(' ou ')}`);
  if (c.outsideHours === true) p.push('fora do horário'); else if (c.outsideHours === false) p.push('dentro do horário');
  if (c.weekdays?.length) p.push(`dias: ${c.weekdays.map((d) => (WEEKDAY_PT[NUM_DAY(d)] ?? String(d)).replace('-feira', '')).join(', ')}`);
  if (c.minWaitSec) p.push(`espera ≥ ${c.minWaitSec}s`);
  return p.length ? p.join(' · ') : 'Qualquer conversa';
}

export default function RuleForm({ rule, queues, onClose, onSaved }: { rule: Rule | null; queues: Queue[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const c0 = rule?.conditions ?? {};
  const [name, setName] = useState(rule?.name ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [channels, setChannels] = useState<string[]>(c0.channels ?? []);
  const [contactCats, setContactCats] = useState((c0.contactCategories ?? []).join(', '));
  const [cats, setCats] = useState((c0.categories ?? []).join(', '));
  const [intents, setIntents] = useState((c0.intents ?? []).join(', '));
  const [outside, setOutside] = useState(c0.outsideHours === true ? 'yes' : c0.outsideHours === false ? 'no' : '');
  const [weekdays, setWeekdays] = useState<string[]>((c0.weekdays ?? []).map(NUM_DAY));
  const [minWait, setMinWait] = useState(c0.minWaitSec != null ? String(c0.minWaitSec) : '');
  const [queueId, setQueueId] = useState(rule?.action.queueId ?? '');
  const [boost, setBoost] = useState(rule?.action.priorityBoost != null ? String(rule.action.priorityBoost) : '');
  const [setCat, setSetCat] = useState(rule?.action.setCategory ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tog = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Informe o nome da regra.';
    if (!queueId) errs['action.queueId'] = 'Escolha a fila de destino.';
    const mw = minWait.trim() === '' ? undefined : Number(minWait); if (mw !== undefined && (!Number.isInteger(mw) || mw < 0)) errs['conditions.minWaitSec'] = 'Informe segundos (inteiro, 0 ou mais).';
    const bo = boost.trim() === '' ? undefined : Number(boost); if (bo !== undefined && (!Number.isInteger(bo) || bo < -1000 || bo > 1000)) errs['action.priorityBoost'] = 'Informe um inteiro de -1000 a 1000.';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    const conditions: RuleConditions = {
      ...(channels.length ? { channels } : {}), ...(list(contactCats).length ? { contactCategories: list(contactCats) } : {}), ...(list(cats).length ? { categories: list(cats) } : {}),
      ...(list(intents).length ? { intents: list(intents) } : {}), ...(outside ? { outsideHours: outside === 'yes' } : {}), ...(weekdays.length ? { weekdays: DAYS.filter((d) => weekdays.includes(d)) } : {}),
      ...(mw !== undefined ? { minWaitSec: mw } : {}),
    };
    const action = { queueId, ...(bo !== undefined ? { priorityBoost: bo } : {}), ...(setCat.trim() ? { setCategory: setCat.trim() } : {}) };
    setBusy(true);
    try {
      if (rule) await bv.patch(`/routing-rules/${rule.id}`, { name: name.trim(), active, conditions, action }); else await bv.post('/routing-rules', { name: name.trim(), active, conditions, action });
      toast.success(rule ? 'Regra atualizada.' : 'Regra criada no fim da lista.'); onSaved(); onClose();
    } catch (err) {
      const m = fieldErrors(err);
      if (hasCode(err, 'rule.invalid_queue')) m['action.queueId'] = errMsg(err);
      setErrors(m); setFormErr(Object.keys(m).length ? 'Corrija os campos destacados.' : errMsg(err));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} title={rule ? 'Editar regra de roteamento' : 'Nova regra de roteamento'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-regra" loading={busy}>Salvar</Button></>}>
      <form id="form-regra" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome da regra" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <div className="flex items-end"><Checkbox label="Regra ativa" hint="Regras inativas são ignoradas." checked={active} onChange={(e) => setActive(e.target.checked)} /></div>
        </div>
        <fieldset className="flex flex-col gap-3 rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-medium">Condições (todas precisam ser verdadeiras; campo vazio = qualquer valor)</legend>
          <fieldset><legend className="text-sm">Canais</legend><div className="flex flex-wrap gap-4">{CHANNELS.map((ch) => <Checkbox key={ch} label={CHANNEL_LABEL[ch]} checked={channels.includes(ch)} onChange={() => tog(channels, setChannels, ch)} />)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Categoria do contato" value={contactCats} onChange={(e) => setContactCats(e.target.value)} error={errors['conditions.contactCategories']} hint="Ex.: ADVOGADO, MP. Separe por vírgula." />
            <TextField label="Categoria da demanda" value={cats} onChange={(e) => setCats(e.target.value)} error={errors['conditions.categories']} hint="Separe por vírgula." />
            <TextField label="Intenção detectada" value={intents} onChange={(e) => setIntents(e.target.value)} error={errors['conditions.intents']} hint="Separe por vírgula." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Horário" value={outside} onChange={(e) => setOutside(e.target.value)}><option value="">Indiferente</option><option value="yes">Somente fora do horário comercial</option><option value="no">Somente dentro do horário comercial</option></Select>
            <TextField label="Espera mínima na fila (segundos)" type="number" min={0} value={minWait} onChange={(e) => setMinWait(e.target.value)} error={errors['conditions.minWaitSec']} hint="Ex.: 300 para agir só depois de 5 minutos de espera." />
          </div>
          <fieldset><legend className="text-sm">Dias da semana</legend><div className="flex flex-wrap gap-4">{DAYS.map((d) => <Checkbox key={d} label={WEEKDAY_PT[d]} checked={weekdays.includes(d)} onChange={() => tog(weekdays, setWeekdays, d)} />)}</div></fieldset>
        </fieldset>
        <fieldset className="grid gap-3 rounded-md border border-bv-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">Ação</legend>
          <Select label="Enviar para a fila" required value={queueId} onChange={(e) => setQueueId(e.target.value)} error={errors['action.queueId']}>
            <option value="">Selecione…</option>
            {queues.map((q) => <option key={q.id} value={q.id}>{q.name}{q.active ? '' : ' (inativa)'}</option>)}
          </Select>
          <TextField label="Ajuste de prioridade" type="number" min={-1000} max={1000} value={boost} onChange={(e) => setBoost(e.target.value)} error={errors['action.priorityBoost']} hint="Somado à prioridade da fila." />
          <TextField label="Definir categoria" value={setCat} onChange={(e) => setSetCat(e.target.value)} error={errors['action.setCategory']} hint="Opcional." />
        </fieldset>
      </form>
    </Dialog>
  );
}
