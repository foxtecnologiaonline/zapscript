'use client';
import React, { useMemo, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { CHANNEL_LABEL, fmtDuration, PRESENCE_LABEL, ROLE_LABEL } from '@/lib/balcao/format';
import { Banner, Button, Checkbox, Dialog, Select, TextField, useToast } from '../../../_ui/ui';
import BusinessHoursEditor, { DAY_ORDER, validateHours, type Hours } from '../orgao/BusinessHoursEditor';
import { fieldErrors, hasCode } from '../usuarios/_shared';
import { CHANNELS, STRATEGY_HINT, STRATEGY_LABEL, type Agent, type Queue, type Strategy } from './types';

const list = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const secHint = (s: string) => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) ? fmtDuration(n) : undefined; };
const normHours = (h: Hours): Hours => { const o: Hours = {}; for (const d of DAY_ORDER) o[d] = h[d] ?? []; return o; };

/** Seleção múltipla de atendentes (lista de caixas de seleção com filtro). */
function MemberPicker({ agents, value, onChange }: { agents: Agent[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => agents.filter((a) => !q.trim() || `${a.name} ${a.email}`.toLowerCase().includes(q.trim().toLowerCase())), [agents, q]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="rounded-md border border-bv-border p-3">
      <legend className="px-1 text-sm font-medium">Atendentes da fila</legend>
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <TextField label="Filtrar atendentes" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} className="min-w-[14rem]" />
        <Button size="sm" variant="secondary" onClick={() => onChange([...new Set([...value, ...shown.map((a) => a.id)])])}>Selecionar os exibidos</Button>
        <Button size="sm" variant="secondary" onClick={() => onChange(value.filter((id) => !shown.some((a) => a.id === id)))}>Desmarcar os exibidos</Button>
      </div>
      <p role="status" aria-live="polite" className="mb-2 text-sm text-bv-muted">{value.length} atendente(s) selecionado(s) de {agents.length}.</p>
      <div className="max-h-56 overflow-y-auto rounded-md border border-bv-border p-2">
        {shown.length === 0 ? <p className="text-sm text-bv-muted">Nenhum atendente encontrado.</p> : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {shown.map((a) => (
              <li key={a.id}><Checkbox label={a.name} hint={`${ROLE_LABEL[a.role] ?? a.role} · ${PRESENCE_LABEL[a.presence] ?? a.presence}${a.skills.length ? ` · ${a.skills.join(', ')}` : ''}`} checked={value.includes(a.id)} onChange={() => toggle(a.id)} /></li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

export default function QueueForm({ queue, queues, sectors, agents, initialMembers, onClose, onSaved }: {
  queue: Queue | null; queues: Queue[]; sectors: Array<{ id: string; name: string; active: boolean }>; agents: Agent[]; initialMembers: string[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(queue?.name ?? '');
  const [slug, setSlug] = useState(queue?.slug ?? '');
  const [categories, setCategories] = useState((queue?.categories ?? []).join(', '));
  const [skills, setSkills] = useState((queue?.requiredSkills ?? []).join(', '));
  const [channels, setChannels] = useState<string[]>(queue?.channels ?? []);
  const [priority, setPriority] = useState(String(queue?.priority ?? 0));
  const [strategy, setStrategy] = useState<Strategy>(queue?.strategy ?? 'LEAST_BUSY');
  const [first, setFirst] = useState(String(queue?.slaFirstResponseSec ?? 300));
  const [resol, setResol] = useState(queue?.slaResolutionSec != null ? String(queue.slaResolutionSec) : '');
  const [maxWait, setMaxWait] = useState(queue?.maxWaitSec != null ? String(queue.maxWaitSec) : '');
  const [overflow, setOverflow] = useState(queue?.overflowQueueId ?? '');
  const [sectorId, setSectorId] = useState(queue?.sectorId ?? '');
  const [ownHours, setOwnHours] = useState(!!queue?.businessHours);
  const [hours, setHours] = useState<Hours>(normHours(queue?.businessHours ?? { mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']], thu: [['08:00', '18:00']], fri: [['08:00', '18:00']] }));
  const [active, setActive] = useState(queue?.active ?? true);
  const [members, setMembers] = useState<string[]>(initialMembers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggleCh = (c: string) => setChannels((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Informe o nome da fila.';
    if (slug.trim() && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug.trim())) errs.slug = 'Use letras minúsculas, números e hífen.';
    const pr = Number(priority); if (!Number.isInteger(pr) || pr < -1000 || pr > 1000) errs.priority = 'Informe um inteiro de -1000 a 1000.';
    const f = Number(first); if (!Number.isInteger(f) || f < 10) errs.slaFirstResponseSec = 'Informe segundos (mínimo de 10).';
    const r = intOrNull(resol); if (r !== null && (!Number.isInteger(r) || r < 60)) errs.slaResolutionSec = 'Deixe vazio ou informe segundos (mínimo de 60).';
    const mw = intOrNull(maxWait); if (mw !== null && (!Number.isInteger(mw) || mw < 10)) errs.maxWaitSec = 'Deixe vazio ou informe segundos (mínimo de 10).';
    if (mw === null && overflow) errs.maxWaitSec = 'Para usar fila de transbordo, informe o tempo máximo de espera.';
    if (ownHours) { const hv = validateHours(hours); for (const [d, m] of Object.entries(hv)) errs[`businessHours.${d}`] = m; }
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    const body = {
      name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}), categories: list(categories), requiredSkills: list(skills), channels, priority: pr, strategy,
      slaFirstResponseSec: f, slaResolutionSec: r, maxWaitSec: mw, overflowQueueId: overflow || null, sectorId: sectorId || null, active,
      businessHours: ownHours ? hours : null,
    };
    setBusy(true);
    try {
      if (queue) {
        await bv.patch(`/queues/${queue.id}`, body);
        if (JSON.stringify([...members].sort()) !== JSON.stringify([...initialMembers].sort())) await bv.put(`/queues/${queue.id}/members`, { userIds: members });
      } else await bv.post('/queues', { ...body, memberIds: members });
      toast.success(queue ? 'Fila atualizada.' : 'Fila criada.'); onSaved(); onClose();
    } catch (err) {
      const m = fieldErrors(err);
      if (hasCode(err, 'queue.slug_taken')) m.slug = errMsg(err);
      if (hasCode(err, 'queue.invalid_overflow')) m.overflowQueueId = errMsg(err);
      setErrors(m);
      setFormErr(hasCode(err, 'queue.invalid_members') ? errMsg(err) : Object.keys(m).length ? 'Corrija os campos destacados.' : errMsg(err));
    } finally { setBusy(false); }
  };
  const hoursErr: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith('businessHours.')) hoursErr[k.split('.')[1]] = v;

  return (
    <Dialog open onClose={onClose} title={queue ? `Editar fila` : 'Nova fila'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-fila" loading={busy}>Salvar</Button></>}>
      <form id="form-fila" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <TextField label="Identificador (slug)" value={slug} onChange={(e) => setSlug(e.target.value)} error={errors.slug} hint="Opcional; gerado a partir do nome. Letras minúsculas, números e hífen." />
          <TextField label="Categorias atendidas" value={categories} onChange={(e) => setCategories(e.target.value)} error={errors.categories} hint="Separe por vírgula. Conversas dessas categorias vão para esta fila." />
          <TextField label="Habilidades exigidas" value={skills} onChange={(e) => setSkills(e.target.value)} error={errors.requiredSkills} hint="Separe por vírgula. O atendente precisa ter todas." />
        </div>
        <fieldset className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-medium">Canais atendidos</legend>
          <div className="flex flex-wrap gap-4">{CHANNELS.map((c) => <Checkbox key={c} label={CHANNEL_LABEL[c]} checked={channels.includes(c)} onChange={() => toggleCh(c)} />)}</div>
          <p className="mt-1 text-xs text-bv-muted">Nenhum marcado significa todos os canais.</p>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Prioridade" type="number" min={-1000} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} error={errors.priority} hint="Maior número é atendido antes." />
          <Select label="Estratégia de distribuição" value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)} hint={STRATEGY_HINT[strategy]}>
            {(Object.keys(STRATEGY_LABEL) as Strategy[]).map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
          </Select>
          <TextField label="SLA de 1ª resposta (segundos)" type="number" min={10} required value={first} onChange={(e) => setFirst(e.target.value)} error={errors.slaFirstResponseSec} hint={secHint(first)} />
          <TextField label="SLA de resolução (segundos)" type="number" min={60} value={resol} onChange={(e) => setResol(e.target.value)} error={errors.slaResolutionSec} hint={secHint(resol) ?? 'Opcional; vazio usa o padrão do órgão.'} />
          <TextField label="Tempo máximo de espera (segundos)" type="number" min={10} value={maxWait} onChange={(e) => setMaxWait(e.target.value)} error={errors.maxWaitSec} hint={secHint(maxWait) ?? 'Opcional; acima disso a conversa transborda.'} />
          <Select label="Fila de transbordo" value={overflow} onChange={(e) => setOverflow(e.target.value)} error={errors.overflowQueueId} hint="Para onde vai a conversa que passou do tempo máximo. Sem fila, a prioridade sobe.">
            <option value="">Nenhuma (aumentar prioridade)</option>
            {queues.filter((q) => q.id !== queue?.id).map((q) => <option key={q.id} value={q.id}>{q.name}{q.active ? '' : ' (inativa)'}</option>)}
          </Select>
          <Select label="Setor" value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Sem setor</option>
            {sectors.filter((s) => s.active || s.id === queue?.sectorId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <div className="flex items-end"><Checkbox label="Fila ativa" hint="Filas inativas não recebem conversas." checked={active} onChange={(e) => setActive(e.target.checked)} /></div>
        </div>
        <div className="flex flex-col gap-2">
          <Checkbox label="Usar horário de atendimento próprio" hint="Desmarcado: usa o horário comercial do órgão." checked={ownHours} onChange={(e) => setOwnHours(e.target.checked)} />
          {ownHours && <BusinessHoursEditor value={hours} onChange={setHours} errors={hoursErr} legend="Horário desta fila" />}
        </div>
        <MemberPicker agents={agents} value={members} onChange={setMembers} />
      </form>
    </Dialog>
  );
}
