'use client';
import React, { useCallback, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { Badge, Banner, Button, ConfirmDialog, DataTable, Dialog, TextArea, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, fieldErrors, fmtDay, hasCode, useLoad } from './_shared';

interface Holiday { id: string; day: string; name: string }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => DAY_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

function HolidayDialog({ holiday, year, onClose, onSaved }: { holiday: Holiday | null; year: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [day, setDay] = useState(holiday?.day ?? `${year}-01-01`);
  const [name, setName] = useState(holiday?.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!validDay(day)) errs.day = 'Informe uma data válida.';
    if (name.trim().length < 2) errs.name = 'Informe o nome do feriado (mínimo de 2 caracteres).';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    setBusy(true);
    try {
      if (holiday) await bv.patch(`/admin/holidays/${holiday.id}`, { day, name: name.trim() }); else await bv.post('/admin/holidays', { day, name: name.trim() });
      toast.success(holiday ? 'Feriado atualizado.' : 'Feriado adicionado.'); onSaved(); onClose();
    } catch (err) {
      const m = fieldErrors(err);
      if (hasCode(err, 'holiday.exists')) m.day = errMsg(err);
      setErrors(m); setFormErr(Object.keys(m).length ? 'Corrija os campos destacados.' : errMsg(err));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={holiday ? 'Editar feriado' : 'Novo feriado'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-feriado" loading={busy}>Salvar</Button></>}>
      <form id="form-feriado" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <TextField label="Data" type="date" required value={day} onChange={(e) => setDay(e.target.value)} error={errors.day} />
        <TextField label="Nome" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      </form>
    </Dialog>
  );
}

interface ParsedHoliday { line: number; day: string; name: string; error?: string }
/** Aceita `AAAA-MM-DD;Nome` ou `DD/MM/AAAA;Nome` (separador `;`, `,` ou tab). */
function parseHolidays(text: string): ParsedHoliday[] {
  const out: ParsedHoliday[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    const m = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s*[;,\t]\s*(.+)$/.exec(line);
    if (!m) { out.push({ line: i + 1, day: '', name: line, error: 'Use "AAAA-MM-DD;Nome" ou "DD/MM/AAAA;Nome".' }); return; }
    let day = m[1]; if (day.includes('/')) { const [d, mo, y] = day.split('/'); day = `${y}-${mo}-${d}`; }
    const name = m[2].trim().replace(/^"|"$/g, '');
    const error = !validDay(day) ? 'Data inválida.' : name.length < 2 || name.length > 120 ? 'Nome deve ter de 2 a 120 caracteres.' : undefined;
    out.push({ line: i + 1, day, name, error });
  });
  return out;
}

function BulkHolidays({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedHoliday[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = rows?.filter((r) => !r.error) ?? [];
  const cols: Column<ParsedHoliday>[] = [
    { key: 'l', header: 'Linha', render: (r) => r.line },
    { key: 'd', header: 'Data', render: (r) => (r.day ? fmtDay(r.day) : '—') },
    { key: 'n', header: 'Nome', render: (r) => r.name },
    { key: 's', header: 'Validação', render: (r) => r.error ? <div><Badge tone="danger">Com erro</Badge><p className="mt-1 text-xs">{r.error}</p></div> : <Badge tone="success">Válida</Badge> },
  ];
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await bv.post<{ count: number }>('/admin/holidays/bulk', { items: ok.map((x) => ({ day: x.day, name: x.name })) });
      toast.success(`${r.count} feriado(s) importado(s). Datas já existentes foram atualizadas.`); onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Importar feriados em lote" size="lg"
      footer={rows
        ? <><Button variant="secondary" onClick={() => setRows(null)}>Voltar</Button><Button loading={busy} disabled={!ok.length || ok.length > 500} onClick={() => void send()}>Importar {ok.length} feriado(s)</Button></>
        : <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => { if (!text.trim()) { setErr('Cole ao menos uma linha.'); return; } setErr(null); setRows(parseHolidays(text)); }}>Pré-visualizar</Button></>}>
      {!rows ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Uma linha por feriado: <code>AAAA-MM-DD;Nome</code> ou <code>DD/MM/AAAA;Nome</code>. Datas que já existem têm o nome atualizado (até 500 por vez).</p>
          <TextArea label="Feriados" rows={8} value={text} onChange={(e) => setText(e.target.value)} error={err} className="font-mono text-sm" spellCheck={false} placeholder={'2027-01-01;Confraternização Universal\n21/04/2027;Tiradentes'} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm"><strong>{ok.length}</strong> válida(s) e <strong>{rows.length - ok.length}</strong> com erro.</p>
          {ok.length > 500 && <Banner tone="danger">Máximo de 500 feriados por importação.</Banner>}
          {err && <Banner tone="danger">{err}</Banner>}
          <DataTable caption="Pré-visualização dos feriados" columns={cols} rows={rows} rowKey={(r) => String(r.line)} />
        </div>
      )}
    </Dialog>
  );
}

export default function HolidaysTab() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [yearTxt, setYearTxt] = useState(String(year));
  const { data, error, loading, reload } = useLoad(() => bv.get<{ items: Holiday[] }>('/admin/holidays', { year }).then((r) => r.items), [year]);
  const [edit, setEdit] = useState<{ h: Holiday | null } | null>(null);
  const [del, setDel] = useState<Holiday | null>(null);
  const [bulk, setBulk] = useState(false);
  const closeEdit = useCallback(() => setEdit(null), []);
  const closeDel = useCallback(() => setDel(null), []);
  const closeBulk = useCallback(() => setBulk(false), []);

  const remove = async () => { if (!del) return; try { await bv.del(`/admin/holidays/${del.id}`); toast.success('Feriado excluído.'); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const weekday = (d: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const columns: Column<Holiday>[] = [
    { key: 'd', header: 'Data', render: (h) => <span className="font-medium">{fmtDay(h.day)}</span> },
    { key: 'w', header: 'Dia da semana', render: (h) => weekday(h.day) },
    { key: 'n', header: 'Nome', render: (h) => h.name },
    {
      key: 'a', header: 'Ações', render: (h) => (
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" aria-label={`Editar feriado ${h.name}`} onClick={() => setEdit({ h })}>Editar</Button>
          <Button size="sm" variant="secondary" aria-label={`Excluir feriado ${h.name}`} onClick={() => setDel(h)}>Excluir</Button>
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Feriados são considerados dias fechados no cálculo de horário comercial e de SLA.</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const y = Number(yearTxt); if (Number.isInteger(y) && y >= 2000 && y <= 2100) setYear(y); else toast.error('Informe um ano entre 2000 e 2100.'); }}>
          <TextField label="Ano" type="number" min={2000} max={2100} value={yearTxt} onChange={(e) => setYearTxt(e.target.value)} className="w-28" />
          <Button type="submit" variant="secondary">Filtrar</Button>
        </form>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setBulk(true)}>Importar em lote</Button>
          <Button onClick={() => setEdit({ h: null })}>Novo feriado</Button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-bv-muted">{loading ? 'Carregando…' : `${data?.length ?? 0} feriado(s) em ${year}.`}</p>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando feriados" />
        : <DataTable caption={`Feriados de ${year}`} columns={columns} rows={data ?? []} rowKey={(h) => h.id} empty={`Nenhum feriado cadastrado em ${year}.`} />}
      {edit && <HolidayDialog key={edit.h?.id ?? 'novo'} holiday={edit.h} year={year} onClose={closeEdit} onSaved={reload} />}
      {bulk && <BulkHolidays onClose={closeBulk} onSaved={reload} />}
      {del && <ConfirmDialog open danger title="Excluir feriado" confirmLabel="Excluir" message={`Excluir "${del.name}" (${fmtDay(del.day)})?`} onConfirm={remove} onClose={closeDel} />}
    </div>
  );
}
